"""CARLA adapter logic with no `carla` import, so CI can test it (design section 15).

CARLA is left-handed: y points right and yaw turns clockwise, in degrees. The dashboard's `map`
frame is right-handed, so y and yaw change sign on the way in.
"""

import math
from collections import defaultdict
from typing import NamedTuple

SOURCE = "carla"
MAP_RANGE_M = 200.0
MAP_RESEND_M = 20.0
SPLIT_GAP_M = 3.0  # waypoints come every 2 m. A larger step is another piece of road.
# Town04 junctions: through lanes bend up to 54 degrees, turns at a crossing 68 or more.
TURN_RAD = math.radians(60.0)
HEADING_RAD = math.radians(15.0)  # a lane end this close in heading continues the junction lane
# vehicle.lincoln.mkz, the bench hero: its rear wheel bones are 1.397 m behind the actor origin.
REAR_AXLE_M = 1.4
SOLID = {"Solid", "SolidSolid", "SolidBroken", "BrokenSolid", "Curb"}
BROKEN = {"Broken", "BrokenBroken", "BottsDots"}


class Sample(NamedTuple):
    """One waypoint of a Driving lane, already in the map frame."""

    lane: tuple[int, int, int]  # road_id, section_id, lane_id
    s: float
    x: float
    y: float
    yaw: float  # radians, counterclockwise
    width: float
    left: str  # lane marking type name, for example "Broken"
    right: str
    left_neighbor: str  # "none" (missing or not Driving), "same" or "opposite" direction
    right_neighbor: str
    junction: bool = False


def to_map(x: float, y: float, yaw_deg: float) -> tuple[float, float, float]:
    return x, -y, -math.radians(yaw_deg)


def _envelope(type_: str, t_ms: float) -> dict:
    return {"source": SOURCE, "type": type_, "t_ms": round(t_ms, 1)}


def hello(t_ms: float) -> dict:
    return {**_envelope("hello", t_ms), "schema": 1, "roles": ["vehicle", "map"], "name": "CARLA"}


def ego(
    t_ms: float,
    x: float,
    y: float,
    yaw_deg: float,
    velocity: tuple[float, float, float],
    accel: tuple[float, float, float],
    forward: tuple[float, float, float],
    steer: float,
    max_steer_deg: float,
    rear_axle_m: float,
) -> dict:
    """Vectors are CARLA (x, y, z). A dot product gives the same value in both frames.

    x, y is the actor origin. pose_map is the rear axle (design section 5.1), rear_axle_m behind it.
    """
    yaw = math.radians(yaw_deg)
    mx, my, myaw = to_map(x - rear_axle_m * math.cos(yaw), y - rear_axle_m * math.sin(yaw), yaw_deg)
    return {
        **_envelope("ego", t_ms),
        "speed_mps": round(math.sumprod(velocity, forward), 2),
        # CARLA steer is normalized and positive to the right. The schema is radians, left positive.
        "steer_rad": round(-steer * math.radians(max_steer_deg), 4),
        "accel_mps2": round(math.sumprod(accel, forward), 2),
        "pose_map": {"x": round(mx, 2), "y": round(my, 2), "yaw": round(myaw, 4)},
    }


def _kind(p: Sample, side: str) -> str | None:
    marking = (p.left if side == "left" else p.right).rsplit(".", 1)[-1]
    neighbor = p.left_neighbor if side == "left" else p.right_neighbor
    if side == "left" and neighbor == "same":
        return None  # the left neighbor sends this line as its right boundary
    if marking in SOLID:
        return "lane_solid"
    if marking in BROKEN:
        return "lane_dashed"
    return "road_edge" if neighbor == "none" else None


def _offset(p: Sample, side: str) -> list[float]:
    d = p.width / 2 if side == "left" else -p.width / 2
    return [round(p.x - d * math.sin(p.yaw), 2), round(p.y + d * math.cos(p.yaw), 2)]


def _flush(out: list[dict], kind: str | None, run: list[list[float]]) -> None:
    if kind is not None and len(run) >= 2:
        out.append({"kind": kind, "pts": run})


def _turn(a: float, b: float) -> float:
    return abs((b - a + math.pi) % (2 * math.pi) - math.pi)


def _through(lanes: dict[tuple[int, int, int], list[Sample]]) -> None:
    """Keep the junction lanes that go through, marked like the lane that meets them.

    CARLA marks most junction lanes NONE, so the lines would stop at every junction. Turning
    lanes stay out, because they would cross the through lanes.
    """
    ends = [p for pts in lanes.values() if not pts[0].junction for p in (pts[0], pts[-1])]

    def gap(e: Sample, pts: list[Sample]) -> float:
        """Distance from a lane end to the nearer end of pts that has the same heading."""
        return min(
            (
                math.dist((e.x, e.y), (p.x, p.y))
                for p in (pts[0], pts[-1])
                if _turn(e.yaw, p.yaw) < HEADING_RAD
            ),
            default=math.inf,
        )

    # ponytail: every junction lane against every lane end, 0.07 s for Town04 at start.
    for key, pts in list(lanes.items()):
        if not pts[0].junction:
            continue
        del lanes[key]
        if _turn(pts[0].yaw, pts[-1].yaw) > TURN_RAD:
            continue
        src = min(ends, key=lambda e: gap(e, pts), default=None)
        if src is None or gap(src, pts) > SPLIT_GAP_M:
            continue
        lanes[key] = [
            p._replace(
                left=src.left,
                right=src.right,
                left_neighbor=src.left_neighbor,
                right_neighbor=src.right_neighbor,
            )
            for p in pts
        ]


def boundaries(samples: list[Sample]) -> list[dict]:
    """Lane boundary polylines for the whole map. Built once at start."""
    lanes: dict[tuple[int, int, int], list[Sample]] = defaultdict(list)
    for p in samples:
        lanes[p.lane].append(p)
    for pts in lanes.values():
        pts.sort(key=lambda p: p.s)
    _through(lanes)
    out: list[dict] = []
    for pts in lanes.values():
        for side in ("left", "right"):
            run: list[list[float]] = []
            run_kind = None
            for p in pts:
                kind, q = _kind(p, side), _offset(p, side)
                if kind != run_kind or (run and math.dist(run[-1], q) > SPLIT_GAP_M):
                    _flush(out, run_kind, run)
                    run = []
                run_kind = kind
                run.append(q)
            _flush(out, run_kind, run)
    return out


def crop(features: list[dict], x: float, y: float, r: float = MAP_RANGE_M) -> list[dict]:
    """The parts of the features within r of (x, y). A polyline that leaves the circle splits."""
    # ponytail: scans every point of the map, about 10 ms for a town. Add a grid index if it lags.
    out: list[dict] = []
    for f in features:
        run: list[list[float]] = []
        for p in f["pts"]:
            if math.dist(p, (x, y)) <= r:
                run.append(p)
                continue
            _flush(out, f["kind"], run)
            run = []
        _flush(out, f["kind"], run)
    return out


def map_msg(t_ms: float, features: list[dict]) -> dict:
    return {**_envelope("map", t_ms), "frame": "map", "range_m": MAP_RANGE_M, "features": features}


def should_resend(last: tuple[float, float] | None, x: float, y: float) -> bool:
    return last is None or math.dist(last, (x, y)) > MAP_RESEND_M
