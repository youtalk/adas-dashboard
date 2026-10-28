"""Autoware adapter logic with no `rclpy` import, so CI can test it (design section 15).

Every position is in Autoware's `map` frame, which is right-handed like the dashboard's.
`base_link` is the rear axle, so the odometry pose is already `pose_map`.
"""

import math
from typing import NamedTuple

SOURCE = "autoware"
MIN_SIZE_M = 0.1  # the schema needs sizes above 0. A polygon shape has no box dimensions.
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
