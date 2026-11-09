"""Generate the W0 recording of the CES 2027 kill route (design sections 10 and 12).

Usage: python3 -m tools.synth [OUT_DIR]   (default recordings/ces2027-kill-route)
       python3 -m tools.synth --cut-out [OUT_DIR]   (default recordings/ces2027-cut-out)
The road is y = A * sin(x / L) in the map frame. The ego drives the lane center at CRUISE_MPS.
"""

import json
import math
import pathlib
import sys

DT = 0.1
END_S = 55.0
KILL_S = 40.0
TAKEOVER_S = 40.5
CRUISE_MPS = 12.0
BRAKE_MPS2 = 3.0
ROAD_A, ROAD_L = 6.0, 120.0
LANE_W = 3.5
STACK_T0 = 812000.0
WORLD_T0 = 1790000000000.0
SPEED_LIMIT_MPS = 13.4
TRUCK_BIRTH_S, TRUCK_DEATH_S = 8.0, 30.0
LDW_S, LDW_HOLD_S = 12.0, 2.0

# The cut-out (design section 6.3 of the forward collision warning): the ego
# follows a lead, the lead changes lanes and shows a stopped car, the page warns,
# and then the stack brakes by itself.
CUT_END_S = 25.0
CUT_EGO_MPS = 13.9
CUT_FAR_GAP_M, CUT_FAR_END_S = 45.0, 8.0  # far lead, new id every CUT_ID_FRAMES
CUT_ID_FRAMES = 3
CUT_FOLLOW_GAP_M, CUT_FOLLOW_S = 28.0, 12.0  # gap closes until CUT_FOLLOW_S
CUT_S = 15.0  # the lead leaves the lane
CUT_STOPPED_GAP_M = 35.0  # the stopped car at CUT_S
CUT_AEB_GAP_M = 15.0  # the stack sends AEB at this gap or less
CUT_AEB_MPS2 = 8.0
CUT_BODY_M = 4.5  # distance_m is bumper to bumper: half the ego plus half the car
CUT_NOISE_M = 0.3


def road_y(x: float) -> float:
    return ROAD_A * math.sin(x / ROAD_L)


def road_yaw(x: float) -> float:
    return math.atan((ROAD_A / ROAD_L) * math.cos(x / ROAD_L))


def offset(x: float, d: float) -> tuple[float, float]:
    """Point d meters left of the centerline at station x."""
    yaw = road_yaw(x)
    return x - d * math.sin(yaw), road_y(x) + d * math.cos(yaw)


def to_ego(px: float, py: float, ex: float, ey: float, eyaw: float) -> tuple[float, float]:
    dx, dy = px - ex, py - ey
    c, s = math.cos(-eyaw), math.sin(-eyaw)
    return round(dx * c - dy * s, 2), round(dx * s + dy * c, 2)


def ego_speed(t: float) -> float:
    if t < TAKEOVER_S:
        return CRUISE_MPS
    return max(0.0, CRUISE_MPS - BRAKE_MPS2 * (t - TAKEOVER_S))


def lead_gap(t: float) -> float:
    """Gap to the lead car in meters. 40 m, closes to 14 m, then opens again."""
    pts = [(0, 40.0), (20, 40.0), (24, 14.0), (27, 14.0), (33, 40.0), (END_S, 40.0)]
    for (t0, g0), (t1, g1) in zip(pts, pts[1:], strict=False):
        if t <= t1:
            return g0 + (g1 - g0) * (t - t0) / (t1 - t0)
    return 40.0


def msg(source: str, typ: str, t_ms: float, **fields) -> str:
    return json.dumps({"source": source, "type": typ, "t_ms": round(t_ms, 1), **fields})


def map_features(x_center: float) -> list[dict]:
    xs = list(range(int(x_center) - 200, int(x_center) + 201, 5))
    kinds = [("road_edge", -LANE_W / 2), ("lane_dashed", LANE_W / 2), ("lane_solid", 1.5 * LANE_W)]
    return [
        {"kind": k, "pts": [[round(p[0], 2), round(p[1], 2)] for p in (offset(x, d) for x in xs)]}
        for k, d in kinds
    ]


def generate(out_dir: pathlib.Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    stack, world = [], []
    stack.append(
        msg(
            "visionpilot",
            "hello",
            0,
            schema=1,
            roles=["stack"],
            name="VisionPilot",
            device="R-Car X5H NPU",
        )
    )
    world.append(
        msg(
            "bench",
            "hello",
            0,
            schema=1,
            roles=["vehicle", "map", "supervisor"],
            name="CARLA bench",
        )
    )
    x = 0.0
    last_map_x = -1e9
    n = int(END_S / DT) + 1
    for i in range(n):
        t = i * DT
        v = ego_speed(t)
        x += v * DT
        y, yaw = road_y(x), road_yaw(x)
        st, wt = STACK_T0 + t * 1000, WORLD_T0 + t * 1000
        # vehicle
        accel = 0.0 if t < TAKEOVER_S else (-BRAKE_MPS2 if v > 0 else 0.0)
        world.append(
            msg(
                "bench",
                "ego",
                wt,
                speed_mps=round(v, 2),
                steer_rad=round(0.02 * math.cos(x / ROAD_L), 3),
                accel_mps2=accel,
                pose_map={"x": round(x, 2), "y": round(y, 2), "yaw": round(yaw, 4)},
            )
        )
        if x - last_map_x > 20.0:
            world.append(
                msg("bench", "map", wt, frame="map", range_m=200, features=map_features(x))
            )
            last_map_x = x
        # supervisor
        if t >= TAKEOVER_S:
            world.append(
                msg(
                    "safety_island",
                    "control",
                    wt,
                    authority="supervisor",
                    steer_rad=0.0,
                    accel_mps2=-BRAKE_MPS2 if v > 0 else 0.0,
                )
            )
        engaged = t >= TAKEOVER_S
        # status and alerts are 1 Hz or on change (design section 5.2), and the
        # takeover is a change, so also emit once on the takeover step itself.
        takeover_step = engaged and (t - DT) < TAKEOVER_S
        if i % 10 == 0 or takeover_step:
            world.append(
                msg(
                    "safety_island",
                    "status",
                    wt,
                    name="Safety Island",
                    device="Cortex-R52",
                    mode="active" if engaged else "standby",
                )
            )
            world.append(
                msg(
                    "safety_island",
                    "alerts",
                    wt,
                    alerts=(
                        [
                            {
                                "code": "SI_STOP",
                                "severity": "critical",
                                "text": "VisionPilot lost. Safety Island stopping",
                            }
                        ]
                        if engaged
                        else []
                    ),
                )
            )
        # stack, until the kill
        if t > KILL_S:
            continue
        gap = lead_gap(t)

        def obj(oid, cls, station, d, size, yaw_off=0.0, x=x, y=y, yaw=yaw, **extra):
            """One object at a station ahead, d meters left of the centerline."""
            ox, oy = to_ego(*offset(x + station, d), x, y, yaw)
            return {
                "id": oid,
                "class": cls,
                "x": ox,
                "y": oy,
                "yaw": round(road_yaw(x + station) - yaw + yaw_off, 4),
                "length": size[0],
                "width": size[1],
                "height": size[2],
                **extra,
            }

        # The lead car keeps height / length at 0.333, the car ahead in the left lane
        # is at 0.375 so the suv rule fires (design section 9), and the barrier has no
        # mesh so the plain box fallback is exercised (design section 6.2). The barrier
        # stands across the shoulder like a lane taper, so one object has a yaw that a
        # missing rotation would clearly show.
        objects = [
            obj(7, "car", gap, 0.0, (4.5, 1.9, 1.5), lead=True, distance_m=round(gap, 1)),
            obj(11, "car", 45.0, LANE_W, (4.8, 2.0, 1.8), lead=False),
            obj(13, "barrier", 18.0, -LANE_W, (1.0, 0.6, 1.1), yaw_off=0.26, lead=False),
        ]
        # The truck is born and dies inside the run, so fade in and fade out have data.
        if TRUCK_BIRTH_S <= t < TRUCK_DEATH_S:
            objects.append(obj(9, "truck", 70.0, LANE_W, (10.0, 2.4, 3.2), lead=False))
        stack.append(msg("visionpilot", "objects", st, frame="ego", objects=objects))
        lanes = [
            {
                "kind": k,
                "pts": [list(to_ego(*offset(x + s, d), x, y, yaw)) for s in range(1, 81, 2)],
            }
            for k, d in (("left", LANE_W / 2), ("right", -LANE_W / 2))
        ]
        stack.append(msg("visionpilot", "lanes", st, frame="ego", lanes=lanes))
        traj = [list(to_ego(*offset(x + s, 0.0), x, y, yaw)) for s in range(1, 151, 1)]
        stack.append(msg("visionpilot", "trajectory", st, frame="ego", width_m=2.3, pts=traj))
        stack.append(
            msg(
                "visionpilot",
                "control",
                st,
                authority="stack",
                steer_rad=round(0.02 * math.cos(x / ROAD_L), 3),
                accel_mps2=0.0,
            )
        )
        alerts = []
        if gap / v < 1.5:
            alerts.append(
                {
                    "code": "FCW",
                    "severity": "critical",
                    "text": "Brake: vehicle ahead",
                    "target": "lead",
                }
            )
        # A warn alert on a lane, so the non-pulsing treatment and a target that is not
        # the lead vehicle both have data (design section 6.3).
        if LDW_S <= t < LDW_S + LDW_HOLD_S:
            alerts.append(
                {
                    "code": "LLDW",
                    "severity": "warn",
                    "text": "Lane departure left",
                    "target": "lane_left",
                }
            )
        stack.append(msg("visionpilot", "alerts", st, alerts=alerts))
        if i % 10 == 0:
            stack.append(
                msg(
                    "visionpilot",
                    "status",
                    st,
                    name="VisionPilot",
                    device="R-Car X5H NPU",
                    mode="active",
                    latency_ms=24.7,
                    stages={"pre": 1.8, "AutoDrive": 8.1, "AutoSteer": 7.2, "AutoSpeed": 6.9},
                    speed_limit_mps=SPEED_LIMIT_MPS,
                )
            )
    (out_dir / "stack.jsonl").write_text("\n".join(stack) + "\n")
    (out_dir / "world.jsonl").write_text("\n".join(world) + "\n")


def cut_follow_gap(t: float) -> float:
    """Gap to the moving lead in meters, until CUT_S."""
    if t < CUT_FAR_END_S:
        return CUT_FAR_GAP_M
    k = min(1.0, (t - CUT_FAR_END_S) / (CUT_FOLLOW_S - CUT_FAR_END_S))
    return CUT_FAR_GAP_M + (CUT_FOLLOW_GAP_M - CUT_FAR_GAP_M) * k


def generate_cut_out(out_dir: pathlib.Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    stack = [
        msg(
            "visionpilot",
            "hello",
            0,
            schema=1,
            roles=["stack"],
            name="VisionPilot",
            device="R-Car X5H NPU",
        )
    ]
    world = [msg("bench", "hello", 0, schema=1, roles=["vehicle", "map"], name="CARLA bench")]
    x = v = 0.0
    lead_x = stop_x = 0.0  # stations of the moving lead after CUT_S and of the stopped car
    braking = False
    last_map_x = -1e9
    cut_i = round(CUT_S / DT)
    for i in range(int(CUT_END_S / DT) + 1):
        t = i * DT
        v = max(0.0, v - CUT_AEB_MPS2 * DT) if braking else CUT_EGO_MPS
        x += v * DT
        y, yaw = road_y(x), road_yaw(x)
        st, wt = STACK_T0 + t * 1000, WORLD_T0 + t * 1000
        if i == cut_i:
            lead_x, stop_x = x + CUT_FOLLOW_GAP_M, x + CUT_STOPPED_GAP_M
        elif i > cut_i:
            lead_x += CUT_EGO_MPS * DT
        cut = i >= cut_i
        aeb = cut and v > 0 and stop_x - x <= CUT_AEB_GAP_M
        braking = braking or aeb
        noise = CUT_NOISE_M * math.sin(1.7 * i)

        def obj(oid, station, d, x=x, y=y, yaw=yaw, **extra):
            ox, oy = to_ego(*offset(x + station + CUT_BODY_M, d), x, y, yaw)
            return {
                "id": oid,
                "class": "car",
                "x": ox,
                "y": oy,
                "yaw": round(road_yaw(x + station + CUT_BODY_M) - yaw, 4),
                "length": 4.5,
                "width": 1.9,
                "height": 1.5,
                **extra,
            }

        if not cut:
            gap = cut_follow_gap(t)
            oid = 100 + i // CUT_ID_FRAMES if t < CUT_FAR_END_S else 7
            objects = [obj(oid, gap, 0.0, lead=True, distance_m=round(gap + noise, 2))]
        else:
            d = LANE_W * min(1.0, (t - CUT_S) / 1.0)  # into the left lane over 1 s
            gap = stop_x - x
            objects = [
                obj(7, lead_x - x, d, lead=False),
                obj(21, gap, 0.0, lead=True, distance_m=round(gap + noise, 2)),
            ]
        stack.append(msg("visionpilot", "objects", st, frame="ego", objects=objects))
        traj = [list(to_ego(*offset(x + s, 0.0), x, y, yaw)) for s in range(1, 151)]
        stack.append(msg("visionpilot", "trajectory", st, frame="ego", width_m=2.3, pts=traj))
        alerts = []
        if aeb:
            alerts.append(
                {
                    "code": "AEB",
                    "severity": "critical",
                    "text": "Emergency braking",
                    "target": "lead",
                }
            )
        stack.append(msg("visionpilot", "alerts", st, alerts=alerts))
        if i % 10 == 0:
            stack.append(
                msg(
                    "visionpilot",
                    "status",
                    st,
                    name="VisionPilot",
                    device="R-Car X5H NPU",
                    mode="active",
                    speed_limit_mps=SPEED_LIMIT_MPS,
                )
            )
        world.append(
            msg(
                "bench",
                "ego",
                wt,
                speed_mps=round(v, 2),
                steer_rad=0.0,
                accel_mps2=-CUT_AEB_MPS2 if braking and v > 0 else 0.0,
                pose_map={"x": round(x, 2), "y": round(y, 2), "yaw": round(yaw, 4)},
            )
        )
        if x - last_map_x > 20.0:
            world.append(
                msg("bench", "map", wt, frame="map", range_m=200, features=map_features(x))
            )
            last_map_x = x
    (out_dir / "stack.jsonl").write_text("\n".join(stack) + "\n")
    (out_dir / "world.jsonl").write_text("\n".join(world) + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--cut-out"]:
        generate_cut_out(pathlib.Path(args[1] if len(args) > 1 else "recordings/ces2027-cut-out"))
    else:
        generate(pathlib.Path(args[0] if args else "recordings/ces2027-kill-route"))
