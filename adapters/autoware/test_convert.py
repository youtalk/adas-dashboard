"""Run: python3 -m pytest adapters/autoware/test_convert.py (from the repository root)."""

import math

from adapters.autoware import convert
from tools import schema


def obj(uuid=b"a", label=1, x=10.0, y=0.0, length=4.5, width=1.9, height=1.5):
    return convert.Obj(uuid, label, x, y, 0.0, length, width, height)


def test_yaw_from_quat_quarter_turn():
    s = math.sin(math.pi / 4)
    assert math.isclose(convert.yaw_from_quat(0.0, 0.0, s, s), math.pi / 2)


def test_ego_is_valid_and_rounded():
    m = convert.ego(5.0, 81234.5678, 50012.3456, 1.234567, 11.987, -0.023456, 0.456)
    schema.validate(m)
    assert m["source"] == "autoware"
    assert m["pose_map"] == {"x": 81234.57, "y": 50012.35, "yaw": 1.2346}
    assert (m["speed_mps"], m["steer_rad"], m["accel_mps2"]) == (11.99, -0.0235, 0.46)


def test_stable_id_keeps_and_counts():
    ids: dict[bytes, int] = {}
    assert [convert.stable_id(ids, u) for u in (b"a", b"b", b"a")] == [0, 1, 0]


def test_footprint_size_is_the_extent():
    assert convert.footprint_size([(-1.0, -0.5), (2.0, -0.5), (2.0, 0.7), (-1.0, 0.7)]) == (
        3.0,
        1.2,
    )


def test_finite_drops_only_the_bad_object():
    good, bad = obj(b"g"), obj(b"n", x=math.nan)
    assert convert.finite([good, bad, obj(b"i", y=math.inf)]) == [good]


def test_objects_msg_classes_sizes_and_lead():
    objs = [obj(b"a", label=1), obj(b"b", label=0, length=0.0, width=0.0), obj(b"c", label=5)]
    m = convert.objects_msg(1.0, objs, {}, (0, 32.14))
    schema.validate(m)
    assert m["frame"] == "map"
    assert [o["class"] for o in m["objects"]] == ["car", "unknown", "motorcycle"]
    assert [o["id"] for o in m["objects"]] == [0, 1, 2]
    assert m["objects"][1]["length"] == convert.MIN_SIZE_M
    assert m["objects"][0]["lead"] is True and m["objects"][0]["distance_m"] == 32.1
    assert m["objects"][1]["lead"] is False and "distance_m" not in m["objects"][1]


def test_objects_msg_unknown_label_is_a_box():
    m = convert.objects_msg(1.0, [obj(label=42)], {}, None)
    assert m["objects"][0]["class"] == "unknown"


def straight(n=101):
    return [(float(i), 0.0) for i in range(n)]  # 100 m along +x, 1 m apart


def test_trajectory_msg_downsamples_and_keeps_the_end():
    m = convert.trajectory_msg(1.0, [(i * 0.1, 0.0) for i in range(1000)], 1.9)
    schema.validate(m)
    assert m["frame"] == "map" and m["width_m"] == 1.9
    assert len(m["pts"]) <= convert.TRAJ_MAX_PTS
    assert m["pts"][0] == [0.0, 0.0] and m["pts"][-1] == [99.9, 0.0]


def test_trajectory_msg_accepts_an_empty_plan():
    m = convert.trajectory_msg(1.0, [], 1.9)
    schema.validate(m)
    assert m["pts"] == []


def test_lead_is_the_nearest_object_in_the_path():
    objs = [
        obj(b"far", x=50.0),
        obj(b"near", x=30.0, y=0.3),
        obj(b"side", x=20.0, y=3.5),
        obj(b"back", x=-10.0),
    ]
    idx, dist = convert.lead(objs, straight(), 0.95)
    assert idx == 1 and math.isclose(dist, 30.0)


def test_lead_measures_along_a_curve():
    r = 20.0
    arc = [
        (r * math.sin(a / 100), r - r * math.cos(a / 100)) for a in range(158)
    ]  # a quarter circle
    on_arc = obj(x=r * math.sin(1.0), y=r - r * math.cos(1.0))
    idx, dist = convert.lead([on_arc], arc, 0.95)
    assert idx == 0 and abs(dist - r * 1.0) < 0.1


def test_lead_none_without_path_or_objects():
    assert convert.lead([obj()], [], 0.95) is None
    assert convert.lead([obj()], [(0.0, 0.0)], 0.95) is None
    assert convert.lead([], straight(), 0.95) is None


def test_lead_survives_repeated_points():
    path = [(0.0, 0.0), (0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (20.0, 0.0)]
    idx, dist = convert.lead([obj(x=15.0)], path, 0.95)
    assert idx == 0 and math.isclose(dist, 15.0)
