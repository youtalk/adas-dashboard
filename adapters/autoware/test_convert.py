"""Run: python3 -m pytest adapters/autoware/test_convert.py (from the repository root)."""

import math

import pytest

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


def test_ahead_starts_at_the_point_nearest_the_ego():
    path = [(float(i), 0.0) for i in range(-5, 11)]  # Autoware keeps 5 m behind the ego
    assert convert.ahead(path, 0.2, 0.1) == path[5:]
    assert convert.ahead([], 0.0, 0.0) == []


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


def test_lead_just_past_a_plan_that_stops_behind_it():
    # Autoware ends its plan at the stop point, several meters behind the car it stops for.
    idx, dist = convert.lead([obj(x=31.0)], straight(21), 0.95)
    assert idx == 0 and math.isclose(dist, 31.0)
    assert convert.lead([obj(x=20.0 + convert.LEAD_BEYOND_M + 2.0)], straight(21), 0.95) is None
    assert convert.lead([obj(x=26.0, y=3.5)], straight(21), 0.95) is None


def test_lead_past_the_plan_end_only_heads_our_way():
    # Stopped at a stop line, a car that crosses the junction just ahead is not a lead.
    crossing = convert.Obj(b"x", 1, 28.0, 0.5, math.pi / 2, 4.5, 1.9, 1.5)
    assert convert.lead([crossing], straight(21), 0.95) is None


def test_lead_not_past_a_plan_too_short_to_point_anywhere():
    # A stopped learned planner puts every point at the ego. Its tiny jitter has no direction.
    jitter = [(0.0, 0.0), (0.001, 0.0005), (0.002, 0.001)]
    assert convert.lead([obj(x=10.0, y=5.0)], jitter, 0.95) is None


def test_lead_none_without_path_or_objects():
    assert convert.lead([obj()], [], 0.95) is None
    assert convert.lead([obj()], [(0.0, 0.0)], 0.95) is None
    assert convert.lead([], straight(), 0.95) is None


def test_lead_survives_repeated_points():
    path = [(0.0, 0.0), (0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (20.0, 0.0)]
    idx, dist = convert.lead([obj(x=15.0)], path, 0.95)
    assert idx == 0 and math.isclose(dist, 15.0)


OSM = """<osm>
  <node id="1"><tag k="local_x" v="0"/><tag k="local_y" v="0"/></node>
  <node id="2"><tag k="local_x" v="10"/><tag k="local_y" v="0"/></node>
  <node id="3"><tag k="local_x" v="0"/><tag k="local_y" v="3"/></node>
  <node id="4"><tag k="local_x" v="10"/><tag k="local_y" v="3"/></node>
  <way id="10"><nd ref="1"/><nd ref="2"/>
    <tag k="type" v="line_thin"/><tag k="subtype" v="dashed"/></way>
  <way id="11"><nd ref="3"/><nd ref="4"/>
    <tag k="type" v="line_thin"/><tag k="subtype" v="solid_solid"/></way>
  <way id="12"><nd ref="1"/><nd ref="3"/>
    <tag k="type" v="curbstone"/><tag k="subtype" v="high"/></way>
  <way id="13"><nd ref="2"/><nd ref="4"/><tag k="type" v="road_border"/></way>
  <way id="14"><nd ref="1"/><nd ref="4"/><tag k="type" v="virtual"/></way>
  <way id="15"><nd ref="2"/><nd ref="3"/><tag k="type" v="stop_line"/></way>
  <relation id="19"><member type="way" ref="11" role="left"/>
    <member type="way" ref="10" role="right"/><tag k="type" v="lanelet"/>
    <tag k="subtype" v="crosswalk"/><tag k="speed_limit" v="18"/></relation>
  <relation id="20"><member type="way" ref="11" role="left"/>
    <member type="way" ref="10" role="right"/><tag k="type" v="lanelet"/>
    <tag k="subtype" v="road"/><tag k="speed_limit" v="36"/></relation>
  <relation id="21"><member type="way" ref="11" role="left"/>
    <member type="way" ref="10" role="right"/><tag k="type" v="lanelet"/></relation>
</osm>"""


def test_parse_osm_kinds():
    features, _ = convert.parse_osm(OSM)
    kinds = sorted((f["kind"], tuple(map(tuple, f["pts"]))) for f in features)
    assert kinds == [
        ("lane_dashed", ((0.0, 0.0), (10.0, 0.0))),
        ("lane_solid", ((0.0, 3.0), (10.0, 3.0))),
        ("road_edge", ((0.0, 0.0), (0.0, 3.0))),
        ("road_edge", ((10.0, 0.0), (10.0, 3.0))),
    ]


def test_speed_limit_inside_and_outside():
    _, lanelets = convert.parse_osm(OSM)
    assert len(lanelets) == 1
    assert math.isclose(convert.speed_limit_at(lanelets, 5.0, 1.5), 10.0)
    assert convert.speed_limit_at(lanelets, 5.0, 4.0) is None


def test_parse_osm_needs_local_coordinates():
    bad = (
        '<osm><node id="7" lat="35.6" lon="139.7"/>'
        '<way id="1"><nd ref="7"/><tag k="type" v="road_border"/></way></osm>'
    )
    with pytest.raises(ValueError, match="node 7"):
        convert.parse_osm(bad)


def test_map_msg_is_valid():
    features, _ = convert.parse_osm(OSM)
    schema.validate(convert.map_msg(1.0, features))


@pytest.mark.parametrize(
    "mode, enabled, mrm, expected",
    [
        (convert.AUTONOMOUS, True, 1, "stack"),
        (convert.STOP, False, 1, "stack"),  # before engage and after ARRIVED
        (convert.AUTONOMOUS, False, 1, "driver"),  # the driver took the wheel
        (convert.LOCAL, True, 1, "driver"),
        (convert.REMOTE, True, 1, "remote"),
        (convert.AUTONOMOUS, True, convert.MRM_OPERATING, "supervisor"),
        (convert.STOP, True, convert.MRM_SUCCEEDED, "supervisor"),
    ],
)
def test_authority(mode, enabled, mrm, expected):
    assert convert.authority(mode, enabled, mrm) == expected


def test_stack_status_active_only_in_autonomous():
    on = convert.stack_status(
        1.0, "Autoware Universe (rule-based)", "RTX 5090", convert.AUTONOMOUS, 8.333
    )
    off = convert.stack_status(
        1.0, "Autoware Universe (rule-based)", "RTX 5090", convert.STOP, None
    )
    for m in (on, off):
        schema.validate(m)
        assert "latency_ms" not in m
    assert (on["mode"], on["speed_limit_mps"]) == ("active", 8.33)
    assert off["mode"] == "standby" and "speed_limit_mps" not in off


def test_mrm_alert_and_clear():
    m = convert.mrm_alerts(1.0, convert.MRM_OPERATING, convert.EMERGENCY_STOP)
    schema.validate(m)
    assert m["alerts"] == [
        {"code": "MRM", "severity": "critical", "text": "Autoware MRM: emergency stop"}
    ]
    assert convert.mrm_alerts(1.0, 1, 1)["alerts"] == []


def test_hello_control_and_supervisor_status_are_valid():
    for m in (
        convert.hello(0.0, ["vehicle", "map"], "Autoware Universe (rule-based)", "RTX 5090"),
        convert.control_msg(1.0, "stack"),
        convert.supervisor_status(1.0, convert.MRM_OPERATING),
    ):
        schema.validate(m)
    assert convert.supervisor_status(1.0, 1)["mode"] == "standby"
