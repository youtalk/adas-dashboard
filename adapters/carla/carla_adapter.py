"""CARLA adapter: the `vehicle` and `map` roles on one endpoint (design section 15).

Run it from the repository root on the CARLA host, with the client module from the server's own
tree. On the CES bench that is ~/carla-venv against the ue58-dev package:
  ~/carla-venv/bin/python -m adapters.carla.carla_adapter [--carla HOST:PORT] [--port 8091]
It never ticks the world. Another client does that, on the bench config_carla.py.
"""

import argparse
import asyncio
import sys
import time

import carla

from adapters import ws
from adapters.carla import world

HERO_WAIT_S = 180.0


def now_ms() -> float:
    return time.monotonic() * 1000.0


def vec(v) -> tuple[float, float, float]:
    return v.x, v.y, v.z


def neighbor(wp, other) -> str:
    if other is None or other.lane_type != carla.LaneType.Driving:
        return "none"
    return "same" if other.lane_id * wp.lane_id > 0 else "opposite"


def sample(wp) -> world.Sample:
    t = wp.transform
    x, y, yaw = world.to_map(t.location.x, t.location.y, t.rotation.yaw)
    return world.Sample(
        (wp.road_id, wp.section_id, wp.lane_id),
        wp.s,
        x,
        y,
        yaw,
        wp.lane_width,
        str(wp.left_lane_marking.type),
        str(wp.right_lane_marking.type),
        neighbor(wp, wp.get_left_lane()),
        neighbor(wp, wp.get_right_lane()),
        wp.is_junction,
    )


def find_hero(client):
    """The world and the vehicle with role_name hero, or (None, None) after HERO_WAIT_S."""
    deadline = time.monotonic() + HERO_WAIT_S
    while time.monotonic() < deadline:
        try:
            w = client.get_world()
            w.wait_for_tick(5.0)  # a passive client sees no actors before its first tick
        except RuntimeError:  # the server is still starting or loading the map
            time.sleep(1.0)
            continue
        for a in w.get_actors().filter("vehicle.*"):
            if a.attributes.get("role_name") == "hero":
                return w, a
    return None, None


async def run(args: argparse.Namespace) -> None:
    host, port = args.carla.rsplit(":", 1)
    client = carla.Client(host, int(port))
    client.set_timeout(10.0)
    w, hero = await asyncio.to_thread(find_hero, client)
    if hero is None:
        sys.exit(f"no vehicle with role_name hero after {HERO_WAIT_S:.0f} s")
    wps = w.get_map().generate_waypoints(2.0)
    driving = [wp for wp in wps if wp.lane_type == carla.LaneType.Driving]
    features = world.boundaries([sample(wp) for wp in driving])
    print(f"{len(features)} lane boundaries from {len(driving)} waypoints", file=sys.stderr)
    max_steer = hero.get_physics_control().wheels[0].max_steer_angle
    last: dict = {}

    def initial() -> list[dict]:
        pose = last.get("pose_map")
        if pose is None:
            return []
        return [world.map_msg(now_ms(), world.crop(features, pose["x"], pose["y"]))]

    endpoint = ws.Endpoint(world.hello(now_ms()), initial)
    await endpoint.start(args.host, args.port)
    print(f"world endpoint on ws://{args.host}:{args.port}", file=sys.stderr)
    map_at = None
    while True:
        await asyncio.to_thread(w.wait_for_tick, 5.0)  # one ego per simulation step
        if not hero.is_alive:
            sys.exit("the hero vehicle is gone")
        t = hero.get_transform()
        last = world.ego(
            now_ms(),
            t.location.x,
            t.location.y,
            t.rotation.yaw,
            vec(hero.get_velocity()),
            vec(hero.get_acceleration()),
            vec(t.get_forward_vector()),
            hero.get_control().steer,
            max_steer,
        )
        endpoint.broadcast(last)
        x, y = last["pose_map"]["x"], last["pose_map"]["y"]
        if world.should_resend(map_at, x, y):
            endpoint.broadcast(world.map_msg(now_ms(), world.crop(features, x, y)))
            map_at = (x, y)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--carla", default="127.0.0.1:2000", help="CARLA server HOST:PORT")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8091)
    try:
        asyncio.run(run(ap.parse_args()))
    except RuntimeError as e:  # CARLA stopped. The closed port shows "vehicle link lost".
        sys.exit(f"CARLA: {e}")
