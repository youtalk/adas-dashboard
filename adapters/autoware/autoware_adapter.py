"""Autoware adapter: the `stack`, `vehicle`, `map` and `supervisor` roles (design section 5.4).

Subscribes to Autoware topics and serves three endpoints: `stack`, `world` (`vehicle` and `map`)
and `supervisor`. Run it in the image from adapters/autoware/Dockerfile. See README.md.
"""

import argparse
import asyncio
import pathlib
import threading
import time

import rclpy
from autoware_adapi_v1_msgs.msg import MrmState, OperationModeState
from autoware_perception_msgs.msg import PredictedObjects, Shape
from autoware_planning_msgs.msg import Trajectory
from autoware_vehicle_msgs.msg import SteeringReport
from geometry_msgs.msg import AccelWithCovarianceStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from adapters import ws
from adapters.autoware import convert
from adapters.carla.world import crop, should_resend

HZ = 20
CONTROL_EVERY = 2  # control at 10 Hz
STATUS_EVERY = 20  # status and alerts at 1 Hz, and on every change of mode or MRM state


def now_ms() -> float:
    return time.monotonic() * 1000.0


def to_obj(o) -> convert.Obj:
    pose = o.kinematics.initial_pose_with_covariance.pose
    q, dim = pose.orientation, o.shape.dimensions
    length, width = dim.x, dim.y
    if o.shape.type == Shape.POLYGON and o.shape.footprint.points:
        length, width = convert.footprint_size([(p.x, p.y) for p in o.shape.footprint.points])
    label = max(o.classification, key=lambda c: c.probability).label if o.classification else 0
    return convert.Obj(
        bytes(o.object_id.uuid),
        label,
        pose.position.x,
        pose.position.y,
        convert.yaw_from_quat(q.x, q.y, q.z, q.w),
        length,
        width,
        dim.z,
    )


async def run(args: argparse.Namespace) -> None:
    features, lanelets = convert.parse_osm(pathlib.Path(args.map).read_text())
    latest: dict = {}  # the last message per key, written by the ROS thread
    fresh: set[str] = set()  # keys with a message that the loop has not sent yet

    def keep(key: str):
        def cb(msg) -> None:
            latest[key] = msg
            fresh.add(key)

        return cb

    def take(key: str) -> bool:
        if key not in fresh:
            return False
        fresh.discard(key)
        return True

    rclpy.init()
    node = Node("dashboard_autoware")
    state = QoSProfile(
        depth=1,
        reliability=ReliabilityPolicy.RELIABLE,
        durability=DurabilityPolicy.TRANSIENT_LOCAL,
    )
    # Best effort and volatile match both reliable and best-effort writers.
    data = QoSProfile(
        depth=1, reliability=ReliabilityPolicy.BEST_EFFORT, durability=DurabilityPolicy.VOLATILE
    )
    for key, type_, topic, qos in (
        ("odom", Odometry, args.odometry, data),
        ("accel", AccelWithCovarianceStamped, args.acceleration, data),
        ("steer", SteeringReport, args.steering, data),
        ("objects", PredictedObjects, args.objects, data),
        ("trajectory", Trajectory, args.trajectory, data),
        ("mode", OperationModeState, args.operation_mode, state),
        ("mrm", MrmState, args.mrm, state),
    ):
        node.create_subscription(type_, topic, keep(key), qos)
    threading.Thread(target=rclpy.spin, args=(node,), daemon=True).start()

    def ego_xy() -> tuple[float, float] | None:
        odom = latest.get("odom")
        return (odom.pose.pose.position.x, odom.pose.pose.position.y) if odom else None

    def map_around() -> list[dict]:
        xy = ego_xy()
        return [convert.map_msg(now_ms(), crop(features, *xy))] if xy else []

    stack = ws.Endpoint(convert.hello(now_ms(), ["stack"], args.name, args.device))
    world = ws.Endpoint(
        convert.hello(now_ms(), ["vehicle", "map"], args.name, args.device), map_around
    )
    supervisor = ws.Endpoint(convert.hello(now_ms(), ["supervisor"], convert.SUPERVISOR_NAME, ""))
    ports = (args.stack_port, args.world_port, args.supervisor_port)
    for endpoint, port in zip((stack, world, supervisor), ports, strict=False):
        await endpoint.start(args.host, port)
    print(f"stack, world and supervisor endpoints on {args.host} ports {ports}", flush=True)

    ids: dict[bytes, int] = {}
    path: list[tuple[float, float]] = []
    last_map, prev, tick = None, None, 0
    while True:
        t, xy = now_ms(), ego_xy()
        if xy:
            odom, accel, steer = latest["odom"], latest.get("accel"), latest.get("steer")
            q = odom.pose.pose.orientation
            world.broadcast(
                convert.ego(
                    t,
                    *xy,
                    convert.yaw_from_quat(q.x, q.y, q.z, q.w),
                    odom.twist.twist.linear.x,
                    steer.steering_tire_angle if steer else 0.0,
                    accel.accel.accel.linear.x if accel else 0.0,
                )
            )
            if should_resend(last_map, *xy):
                world.broadcast(convert.map_msg(t, crop(features, *xy)))
                last_map = xy
        if take("trajectory"):
            pts = [(p.pose.position.x, p.pose.position.y) for p in latest["trajectory"].points]
            path = convert.ahead(pts, *xy) if xy else pts
            stack.broadcast(convert.trajectory_msg(t, path, args.vehicle_width))
        if take("objects"):
            objs = convert.finite([to_obj(o) for o in latest["objects"].objects])
            found = convert.lead(objs, path, args.vehicle_width / 2, args.lead_margin)
            if found:
                found = (found[0], convert.gap(found[1], objs[found[0]].length, args.front_m))
            stack.broadcast(convert.objects_msg(t, objs, ids, found))

        mode, mrm = latest.get("mode"), latest.get("mrm")
        op = (mode.mode, mode.is_autoware_control_enabled) if mode else (0, False)
        mrm_state = (mrm.state, mrm.behavior) if mrm else (MrmState.NORMAL, MrmState.NONE)
        auth = convert.authority(*op, mrm_state[0])
        if tick % CONTROL_EVERY == 0:
            supervisor.broadcast(convert.control_msg(t, auth))
        if (op, mrm_state) != prev or tick % STATUS_EVERY == 0:
            limit = convert.speed_limit_at(lanelets, *xy) if xy else None
            stack.broadcast(convert.stack_status(t, args.name, args.device, op[0], limit))
            supervisor.broadcast(convert.supervisor_status(t, mrm_state[0]))
            supervisor.broadcast(convert.mrm_alerts(t, *mrm_state))
        prev, tick = (op, mrm_state), tick + 1
        await asyncio.sleep(1.0 / HZ)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", required=True, help="the lanelet2_map.osm that Autoware loaded")
    ap.add_argument("--name", default="Autoware", help="the stack name on the status line")
    ap.add_argument("--device", default="", help="the device name on the status line")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--stack-port", type=int, default=8090)
    ap.add_argument("--world-port", type=int, default=8091)
    ap.add_argument("--supervisor-port", type=int, default=8092)
    ap.add_argument("--vehicle-width", type=float, default=1.9, help="m, the trajectory width")
    ap.add_argument(
        "--front-m",
        type=float,
        default=3.79,
        help="m from the rear axle to the front bumper (Autoware sample_vehicle: 2.79 + 1.0)",
    )
    ap.add_argument(
        "--lead-margin",
        type=float,
        default=convert.LEAD_MARGIN_M,
        help="m outside the trajectory width where an object still counts as the lead",
    )
    ap.add_argument("--odometry", default="/localization/kinematic_state")
    ap.add_argument("--acceleration", default="/localization/acceleration")
    ap.add_argument("--steering", default="/vehicle/status/steering_status")
    ap.add_argument("--objects", default="/perception/object_recognition/objects")
    ap.add_argument("--trajectory", default="/planning/trajectory")
    ap.add_argument("--operation-mode", default="/api/operation_mode/state")
    ap.add_argument("--mrm", default="/api/fail_safe/mrm_state")
    asyncio.run(run(ap.parse_args()))
