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
