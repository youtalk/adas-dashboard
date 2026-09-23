import pathlib

from tools import schema, synth

# The classes that have a mesh (design section 6.2). Anything else draws as a box.
MESH_CLASSES = {"car", "suv", "truck", "bus", "trailer", "pedestrian", "cyclist", "bicycle"}


def lines(p: pathlib.Path) -> list[dict]:
    return [schema.validate_line(ln) for ln in p.read_text().splitlines() if ln.strip()]


def test_generate_writes_two_valid_recordings(tmp_path):
    synth.generate(tmp_path)
    stack = lines(tmp_path / "stack.jsonl")
    world = lines(tmp_path / "world.jsonl")
    assert stack[0]["type"] == "hello" and stack[0]["roles"] == ["stack"]
    assert world[0]["type"] == "hello" and set(world[0]["roles"]) == {
        "vehicle",
        "map",
        "supervisor",
    }
    # t_ms never goes backwards inside one file.
    for f in (stack, world):
        ts = [m["t_ms"] for m in f]
        assert ts == sorted(ts)


def test_scenario_reaches_every_state(tmp_path):
    synth.generate(tmp_path)
    stack = lines(tmp_path / "stack.jsonl")
    world = lines(tmp_path / "world.jsonl")
    t0 = stack[1]["t_ms"]
    # The stack file ends at the kill.
    assert abs((stack[-1]["t_ms"] - t0) / 1000 - synth.KILL_S) < 0.2
    # A critical alert with a lead target exists before the kill.
    crit = [
        m
        for m in stack
        if m["type"] == "alerts" and m["alerts"] and m["alerts"][0]["severity"] == "critical"
    ]
    assert crit and crit[0]["alerts"][0]["target"] == "lead"
    # There is a clear interval after the alert and before the kill.
    clears = [
        m
        for m in stack
        if m["type"] == "alerts" and not m["alerts"] and m["t_ms"] > crit[-1]["t_ms"]
    ]
    assert clears
    # The supervisor takes over and the car stops.
    ctrl = [m for m in world if m["type"] == "control" and m["authority"] == "supervisor"]
    assert ctrl and ctrl[0]["accel_mps2"] == -3.0
    egos = [m for m in world if m["type"] == "ego"]
    assert egos[-1]["speed_mps"] == 0.0
    assert max(m["speed_mps"] for m in egos) == synth.CRUISE_MPS
    # The world file runs to END_S, well past the stack file's kill.
    world_t0 = world[1]["t_ms"]
    assert abs((world[-1]["t_ms"] - world_t0) / 1000 - synth.END_S) < 0.2
    # The ego stops at about 44.5 s, per the scenario.
    stopped = [m for m in egos if m["speed_mps"] == 0.0]
    assert abs((stopped[0]["t_ms"] - world_t0) / 1000 - 44.5) < 0.2
    # The objects reach the lead ring, the suv height rule and the box fallback.
    objs = [o for m in stack if m["type"] == "objects" for o in m["objects"]]
    assert any(o.get("lead") for o in objs)
    assert any(o["class"] == "car" and o["height"] / o["length"] > 0.36 for o in objs)
    assert any(o["class"] == "car" and o["height"] / o["length"] <= 0.36 for o in objs)
    assert {o["class"] for o in objs} - MESH_CLASSES
    # An object appears and disappears inside the run, so the fades have data.
    seen = [{o["id"] for o in m["objects"]} for m in stack if m["type"] == "objects"]
    assert seen[0] != max(seen, key=len) and seen[0] == seen[-1]
    # A warn alert on a lane exists next to the critical lead alert.
    warns = [
        a for m in stack if m["type"] == "alerts" for a in m["alerts"] if a["severity"] == "warn"
    ]
    assert warns and warns[0]["target"] == "lane_left"
    # Map features are in the map frame and cover the drive to the last ego pose.
    maps = [m for m in world if m["type"] == "map"]
    assert maps and all(m["frame"] == "map" for m in maps)
    assert max(p[0] for f in maps[-1]["features"] for p in f["pts"]) > egos[-1]["pose_map"]["x"]


def test_generate_is_deterministic(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    synth.generate(a)
    synth.generate(b)
    assert (a / "stack.jsonl").read_bytes() == (b / "stack.jsonl").read_bytes()
    assert (a / "world.jsonl").read_bytes() == (b / "world.jsonl").read_bytes()
