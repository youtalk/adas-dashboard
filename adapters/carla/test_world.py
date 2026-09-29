"""Run: python3 -m pytest adapters/carla/test_world.py (from the repository root)."""

import math

from adapters.carla import world
from tools import schema


def sample(lane_id, s, y, left, right, left_n, right_n) -> world.Sample:
    return world.Sample((1, 0, lane_id), s, s, y, 0.0, 3.5, left, right, left_n, right_n)


def road(n: int = 50) -> list[world.Sample]:
    """A straight one-way road along +x. Two lanes, centers at y = 0 and y = -3.5."""
    inner = [sample(-1, 2.0 * i, 0.0, "Solid", "Broken", "none", "same") for i in range(n)]
    outer = [sample(-2, 2.0 * i, -3.5, "Broken", "NONE", "same", "none") for i in range(n)]
    return inner + outer


def test_to_map_flips_y_and_yaw():
    x, y, yaw = world.to_map(1.0, 2.0, 90.0)
    assert (x, y) == (1.0, -2.0)
    assert math.isclose(yaw, -math.pi / 2)


def test_ego_projects_on_forward_and_flips_steer():
    m = world.ego(
        5.0, 10.0, 20.0, 0.0, (3.0, 4.0, 0.0), (-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), 0.5, 70.0
    )
    schema.validate(m)
    assert m["speed_mps"] == 3.0
    assert m["accel_mps2"] == -1.0
    assert m["steer_rad"] == round(-0.5 * math.radians(70.0), 4)
    assert m["pose_map"] == {"x": 10.0, "y": -20.0, "yaw": 0.0}


def test_boundaries_send_each_line_once():
    feats = world.boundaries(road())
    got = sorted((f["kind"], f["pts"][0][1]) for f in feats)
    assert got == [("lane_dashed", -1.75), ("lane_solid", 1.75), ("road_edge", -5.25)]


def test_boundary_splits_where_the_marking_changes():
    lane = [
        sample(-1, 2.0 * i, 0.0, "Solid", "Broken" if i < 10 else "Solid", "none", "none")
        for i in range(20)
    ]
    right = [f for f in world.boundaries(lane) if f["pts"][0][1] < 0]
    assert [f["kind"] for f in right] == ["lane_dashed", "lane_solid"]
    assert [len(f["pts"]) for f in right] == [10, 10]


def test_boundary_splits_at_a_gap():
    lane = [sample(-1, s, 0.0, "Solid", "Solid", "none", "none") for s in (0, 2, 4, 20, 22, 24)]
    left = [f for f in world.boundaries(lane) if f["pts"][0][1] > 0]
    assert [len(f["pts"]) for f in left] == [3, 3]


def test_opposite_neighbor_keeps_the_center_line():
    lane = [sample(-1, 2.0 * i, 0.0, "SolidSolid", "NONE", "opposite", "none") for i in range(5)]
    assert {f["kind"] for f in world.boundaries(lane)} == {"lane_solid", "road_edge"}


def test_enum_repr_names_are_accepted():
    lane = [
        sample(-1, 2.0 * i, 0.0, "LaneMarkingType.Solid", "NONE", "none", "none") for i in range(5)
    ]
    assert {f["kind"] for f in world.boundaries(lane)} == {"lane_solid", "road_edge"}


def test_crop_keeps_the_circle_and_splits():
    line = {"kind": "lane_solid", "pts": [[float(x), 0.0] for x in range(0, 1001, 2)]}
    (inside,) = world.crop([line], 500.0, 0.0)
    assert inside["pts"][0] == [300.0, 0.0]
    assert inside["pts"][-1] == [700.0, 0.0]
    zigzag = {
        "kind": "road_edge",
        "pts": [[-150.0, 0.0], [-100.0, 0.0], [0.0, 300.0], [100.0, 0.0], [150.0, 0.0]],
    }
    assert [len(f["pts"]) for f in world.crop([zigzag], 0.0, 0.0)] == [2, 2]


def test_map_message_validates():
    m = world.map_msg(1.0, world.crop(world.boundaries(road()), 20.0, 0.0))
    schema.validate(m)
    assert m["frame"] == "map"
    assert m["features"]


def test_should_resend_every_20_m():
    assert world.should_resend(None, 0.0, 0.0)
    assert not world.should_resend((0.0, 0.0), 19.0, 0.0)
    assert world.should_resend((0.0, 0.0), 21.0, 0.0)


def test_hello_validates():
    h = world.hello(0.0)
    schema.validate(h)
    assert h["roles"] == ["vehicle", "map"]
