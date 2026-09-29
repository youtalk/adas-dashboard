"""Run: python3 -m pytest adapters/safety_island/test_supervisor.py (from the repository root)."""

from adapters.safety_island import supervisor as sv
from tools import schema


def test_authority_follows_the_arbiter_rule():
    assert sv.authority(None, 10.0) == "stack"
    assert sv.authority(9.6, 10.0) == "supervisor"
    assert sv.authority(9.4, 10.0) == "stack"


def test_supervisor_step_carries_the_command_and_the_alert():
    msgs = sv.messages(1.0, "supervisor", "stack", 3, (0.01, -3.0), "VisionPilot")
    for m in msgs:
        schema.validate(m)
    control, status, alerts = msgs
    assert control["authority"] == "supervisor"
    assert (control["steer_rad"], control["accel_mps2"]) == (0.01, -3.0)
    assert status["mode"] == "active"
    assert alerts["alerts"] == [
        {
            "code": "SI_STOP",
            "severity": "critical",
            "text": "VisionPilot lost. Safety Island stopping",
        }
    ]


def test_a_non_finite_command_field_is_dropped_and_authority_stays():
    control = sv.messages(1.0, "supervisor", "stack", 3, (float("nan"), -3.0), "VisionPilot")[0]
    schema.validate(control)
    assert control["authority"] == "supervisor"
    assert "steer_rad" not in control
    assert control["accel_mps2"] == -3.0


def test_stack_step_before_any_command():
    msgs = sv.messages(1.0, "stack", None, 0, None, "Stack")
    for m in msgs:
        schema.validate(m)
    control, status, alerts = msgs
    assert control["authority"] == "stack"
    assert "steer_rad" not in control and "accel_mps2" not in control
    assert status["mode"] == "standby"
    assert alerts["alerts"] == []


def test_status_and_alerts_at_1_hz_and_on_change():
    assert len(sv.messages(1.0, "stack", "stack", 3, None, "Stack")) == 1
    assert len(sv.messages(1.0, "stack", "stack", 10, None, "Stack")) == 3
    assert len(sv.messages(1.0, "supervisor", "stack", 3, (0.0, -3.0), "Stack")) == 3


def test_hello_validates():
    h = sv.hello(0.0)
    schema.validate(h)
    assert (h["name"], h["device"], h["roles"]) == ("Safety Island", "Cortex-R52", ["supervisor"])
