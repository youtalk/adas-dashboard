"""Autoware adapter logic with no `rclpy` import, so CI can test it (design section 15).

Every position is in Autoware's `map` frame, which is right-handed like the dashboard's.
`base_link` is the rear axle, so the odometry pose is already `pose_map`.
"""

import math
import xml.etree.ElementTree as ET
from typing import NamedTuple

from adapters.carla.world import MAP_RANGE_M

SOURCE = "autoware"
MIN_SIZE_M = 0.1  # the schema needs sizes above 0. A polygon shape has no box dimensions.
TRAJ_MAX_PTS = 150
LEAD_MARGIN_M = 0.5  # how far outside the trajectory ribbon an object still counts as lead
# autoware_adapi_v1_msgs OperationModeState.mode, MrmState.state and MrmState.behavior
STOP, AUTONOMOUS, LOCAL, REMOTE = 1, 2, 3, 4
MRM_OPERATING, MRM_SUCCEEDED, MRM_FAILED = 2, 3, 4
EMERGENCY_STOP, COMFORTABLE_STOP, PULL_OVER = 2, 3, 4
MRM_TEXT = {
    EMERGENCY_STOP: "Autoware MRM: emergency stop",
    COMFORTABLE_STOP: "Autoware MRM: comfortable stop",
    PULL_OVER: "Autoware MRM: pulling over",
}
SUPERVISOR_NAME = "Autoware MRM"
# autoware_perception_msgs/ObjectClassification labels
CLASSES = {
    0: "unknown",
    1: "car",
    2: "truck",
    3: "bus",
    4: "trailer",
    5: "motorcycle",
    6: "bicycle",
    7: "pedestrian",
}


class Lanelet(NamedTuple):
    poly: list[tuple[float, float]]  # the left bound, then the right bound reversed
    limit_mps: float


class Obj(NamedTuple):
    """One perceived object, already reduced to plain values."""

    uuid: bytes
    label: int
    x: float
    y: float
    yaw: float
    length: float
    width: float
    height: float


def _envelope(type_: str, t_ms: float) -> dict:
    return {"source": SOURCE, "type": type_, "t_ms": round(t_ms, 1)}


def yaw_from_quat(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def ego(
    t_ms: float,
    x: float,
    y: float,
    yaw: float,
    speed_mps: float,
    steer_rad: float,
    accel_mps2: float,
) -> dict:
    return {
        **_envelope("ego", t_ms),
        "speed_mps": round(speed_mps, 2),
        "steer_rad": round(steer_rad, 4),
        "accel_mps2": round(accel_mps2, 2),
        "pose_map": {"x": round(x, 2), "y": round(y, 2), "yaw": round(yaw, 4)},
    }


def footprint_size(pts: list[tuple[float, float]]) -> tuple[float, float]:
    """Length along x and width along y of a footprint polygon, in the object frame."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return max(xs) - min(xs), max(ys) - min(ys)


def finite(objs: list[Obj]) -> list[Obj]:
    """Drop objects with a NaN or infinite value. One such value would drop the whole message."""
    return [o for o in objs if all(math.isfinite(v) for v in o[2:])]


def stable_id(ids: dict[bytes, int], uuid: bytes) -> int:
    # ponytail: ids grow by one per object for the whole run, a few thousand per hour.
    return ids.setdefault(uuid, len(ids))


def objects_msg(
    t_ms: float, objs: list[Obj], ids: dict[bytes, int], lead: tuple[int, float] | None
) -> dict:
    """lead is the index in objs of the lead vehicle and its distance along the trajectory."""
    out = []
    for i, o in enumerate(objs):
        d = {
            "id": stable_id(ids, o.uuid),
            "class": CLASSES.get(o.label, "unknown"),
            "x": round(o.x, 2),
            "y": round(o.y, 2),
            "yaw": round(o.yaw, 4),
            "length": max(round(o.length, 2), MIN_SIZE_M),
            "width": max(round(o.width, 2), MIN_SIZE_M),
            "height": max(round(o.height, 2), MIN_SIZE_M),
            "lead": lead is not None and lead[0] == i,
        }
        if d["lead"]:
            d["distance_m"] = round(lead[1], 1)
        out.append(d)
    return {**_envelope("objects", t_ms), "frame": "map", "objects": out}


def trajectory_msg(t_ms: float, pts: list[tuple[float, float]], width_m: float) -> dict:
    """At most TRAJ_MAX_PTS points: every k-th point, and always the last one."""
    k = max(1, math.ceil(len(pts) / (TRAJ_MAX_PTS - 1)))
    kept = pts[::k]
    if pts and (len(pts) - 1) % k:
        kept.append(pts[-1])
    return {
        **_envelope("trajectory", t_ms),
        "frame": "map",
        "width_m": round(width_m, 2),
        "pts": [[round(x, 2), round(y, 2)] for x, y in kept],
    }


def ahead(path: list[tuple[float, float]], x: float, y: float) -> list[tuple[float, float]]:
    """The path from its point nearest to the ego. Autoware's plan starts a few meters behind."""
    if not path:
        return []
    return path[min(range(len(path)), key=lambda i: math.dist(path[i], (x, y))) :]


def _project(p: tuple[float, float], path: list[tuple[float, float]]) -> tuple[float, float]:
    """(lateral distance, arc length) of the point on path nearest to p."""
    best, s0 = (math.inf, 0.0), 0.0
    for a, b in zip(path, path[1:], strict=False):
        dx, dy = b[0] - a[0], b[1] - a[1]
        seg = math.hypot(dx, dy)
        if seg == 0.0:
            continue
        t = min(max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (seg * seg), 0.0), 1.0)
        d = math.dist(p, (a[0] + t * dx, a[1] + t * dy))
        if d < best[0]:
            best = (d, s0 + t * seg)
        s0 += seg
    return best


def lead(
    objs: list[Obj],
    path: list[tuple[float, float]],
    half_width_m: float,
    margin_m: float = LEAD_MARGIN_M,
) -> tuple[int, float] | None:
    """Index and arc distance of the nearest object ahead within the trajectory ribbon.

    path starts at the ego (see `ahead`), so the arc length from its first point is the distance.
    """
    # ponytail: every object against every segment, about 150 x 100 per frame at 20 Hz.
    found = None
    for i, o in enumerate(objs):
        d, arc = _project((o.x, o.y), path)
        if d <= half_width_m + margin_m and arc > 0.0 and (found is None or arc < found[1]):
            found = (i, arc)
    return found


def _kind(tags: dict[str, str]) -> str | None:
    if tags.get("type") in ("road_border", "curbstone"):
        return "road_edge"
    if tags.get("type") in ("line_thin", "line_thick"):
        subtype = tags.get("subtype", "")
        if "solid" in subtype:
            return "lane_solid"
        if "dashed" in subtype:
            return "lane_dashed"
    return None


def parse_osm(text: str) -> tuple[list[dict], list[Lanelet]]:
    """Lane lines and road edges of a Lanelet2 map, and the lanelets that have a speed limit.

    Positions come from the `local_x` and `local_y` node tags, which are Autoware's map frame.
    """
    root = ET.fromstring(text)
    nodes = {n.get("id"): n for n in root.iter("node")}

    def xy(ref: str) -> tuple[float, float]:
        tags = {t.get("k"): t.get("v") for t in nodes[ref].iter("tag")}
        if "local_x" not in tags or "local_y" not in tags:
            raise ValueError(f"node {ref} has no local_x/local_y")
        return float(tags["local_x"]), float(tags["local_y"])

    def tags_of(e: ET.Element) -> dict[str, str]:
        return {t.get("k"): t.get("v") for t in e.iter("tag")}

    ways = {w.get("id"): w for w in root.iter("way")}
    features = []
    for w in ways.values():
        kind = _kind(tags_of(w))
        if kind is not None:
            pts = [xy(nd.get("ref")) for nd in w.iter("nd")]
            features.append({"kind": kind, "pts": [[round(x, 2), round(y, 2)] for x, y in pts]})
    lanelets = []
    for r in root.iter("relation"):
        tags = tags_of(r)
        # A crosswalk or walkway lanelet overlaps the road and can carry its own limit.
        if tags.get("type") != "lanelet" or tags.get("subtype", "road") != "road":
            continue
        if "speed_limit" not in tags:
            continue
        bound = {m.get("role"): m.get("ref") for m in r.iter("member")}
        left = [xy(nd.get("ref")) for nd in ways[bound["left"]].iter("nd")]
        right = [xy(nd.get("ref")) for nd in ways[bound["right"]].iter("nd")]
        lanelets.append(Lanelet(left + right[::-1], float(tags["speed_limit"]) / 3.6))
    return features, lanelets


def _inside(poly: list[tuple[float, float]], x: float, y: float) -> bool:
    """Even-odd ray test."""
    inside = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1], strict=False):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def speed_limit_at(lanelets: list[Lanelet], x: float, y: float) -> float | None:
    # ponytail: first match, overlapping junction lanelets usually share a limit.
    return next((ll.limit_mps for ll in lanelets if _inside(ll.poly, x, y)), None)


def map_msg(t_ms: float, features: list[dict]) -> dict:
    return {**_envelope("map", t_ms), "frame": "map", "range_m": MAP_RANGE_M, "features": features}


def _in_mrm(mrm_state: int) -> bool:
    return mrm_state in (MRM_OPERATING, MRM_SUCCEEDED, MRM_FAILED)


def hello(t_ms: float, roles: list[str], name: str, device: str) -> dict:
    m = {**_envelope("hello", t_ms), "schema": 1, "roles": roles, "name": name}
    return {**m, "device": device} if device else m


def authority(mode: int, control_enabled: bool, mrm_state: int) -> str:
    """Who drives. STOP is `stack`: Autoware holds the car before engage and after arrival."""
    if _in_mrm(mrm_state):
        return "supervisor"
    if mode == LOCAL or (mode == AUTONOMOUS and not control_enabled):
        return "driver"
    return "remote" if mode == REMOTE else "stack"


def stack_status(
    t_ms: float, name: str, device: str, mode: int, speed_limit_mps: float | None
) -> dict:
    m = {
        **_envelope("status", t_ms),
        "name": name,
        "mode": "active" if mode == AUTONOMOUS else "standby",
    }
    if device:
        m["device"] = device
    if speed_limit_mps is not None:
        m["speed_limit_mps"] = round(speed_limit_mps, 2)
    return m


def control_msg(t_ms: float, auth: str) -> dict:
    return {**_envelope("control", t_ms), "authority": auth}


def supervisor_status(t_ms: float, mrm_state: int) -> dict:
    mode = "active" if _in_mrm(mrm_state) else "standby"
    return {**_envelope("status", t_ms), "name": SUPERVISOR_NAME, "mode": mode}


def mrm_alerts(t_ms: float, mrm_state: int, behavior: int) -> dict:
    alert = {
        "code": "MRM",
        "severity": "critical",
        "text": MRM_TEXT.get(behavior, "Autoware MRM: stopping"),
    }
    return {**_envelope("alerts", t_ms), "alerts": [alert] if _in_mrm(mrm_state) else []}
