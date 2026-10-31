"""Safety Island adapter: the `supervisor` role (design section 15).

Listens on DDS domain 1 to the command that the arbiter acts on, and applies the arbiter's rule.
Run it in the image from adapters/safety_island/Dockerfile. See README.md next to this file.
"""

import argparse
import asyncio
import threading
import time

import rclpy
from autoware_control_msgs.msg import Control
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from adapters import ws
from adapters.safety_island import supervisor

TOPIC = "/control/trajectory_follower/control_cmd"


def now_ms() -> float:
    return time.monotonic() * 1000.0


async def run(args: argparse.Namespace) -> None:
    last: list = [None]  # (arrival, steer_rad, accel_mps2), written by the ROS thread

    def on_cmd(msg: Control) -> None:
        last[0] = (
            time.monotonic(),
            msg.lateral.steering_tire_angle,
            msg.longitudinal.acceleration,
        )

    rclpy.init()
    node = Node("dashboard_safety_island")
    qos = QoSProfile(
        depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.VOLATILE
    )
    node.create_subscription(Control, TOPIC, on_cmd, qos)
    threading.Thread(target=rclpy.spin, args=(node,), daemon=True).start()

    def step(prev: str | None, tick: int) -> tuple[str, list[dict]]:
        cmd = last[0]
        auth = supervisor.authority(cmd[0] if cmd else None, time.monotonic())
        msgs = supervisor.messages(
            now_ms(), auth, prev, tick, cmd[1:] if cmd else None, args.stack_name, args.device
        )
        return auth, msgs

    endpoint = ws.Endpoint(supervisor.hello(now_ms(), args.device), lambda: step(None, 0)[1])
    await endpoint.start(args.host, args.port)
    print(f"supervisor endpoint on ws://{args.host}:{args.port}, topic {TOPIC}", flush=True)
    prev, tick = None, 0
    while True:
        auth, msgs = step(prev, tick)
        for m in msgs:
            endpoint.broadcast(m)
        prev, tick = auth, tick + 1
        await asyncio.sleep(0.1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stack-name", default="Stack", help="the name in the takeover alert text")
    ap.add_argument(
        "--device", default=supervisor.DEVICE, help="the Safety Island core on the page"
    )
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8092)
    asyncio.run(run(ap.parse_args()))
