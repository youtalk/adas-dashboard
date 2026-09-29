"""Safety Island adapter logic with no `rclpy` import, so CI can test it (design section 15)."""

SOURCE = "safety_island"
NAME = "Safety Island"
DEVICE = "Cortex-R52"
FRESH_S = 0.5  # the arbiter's SI_FRESH_SEC: a command this recent means the Safety Island drives
STATUS_EVERY = 10  # status and alerts at 1 Hz from the 10 Hz loop, and on every change


def _envelope(type_: str, t_ms: float) -> dict:
    return {"source": SOURCE, "type": type_, "t_ms": round(t_ms, 1)}


def hello(t_ms: float) -> dict:
    return {
        **_envelope("hello", t_ms),
        "schema": 1,
        "roles": ["supervisor"],
        "name": NAME,
        "device": DEVICE,
    }


def authority(last_rx: float | None, now: float) -> str:
    """`supervisor` while the last command arrived at most FRESH_S ago, else `stack`."""
    return "supervisor" if last_rx is not None and now - last_rx <= FRESH_S else "stack"


def messages(
    t_ms: float,
    auth: str,
    prev: str | None,
    tick: int,
    cmd: tuple[float, float] | None,
    stack_name: str,
) -> list[dict]:
    """One loop step. cmd is the last (steer_rad, accel_mps2). prev is None on a first step."""
    control = {**_envelope("control", t_ms), "authority": auth}
    if auth == "supervisor" and cmd is not None:
        control["steer_rad"], control["accel_mps2"] = round(cmd[0], 4), round(cmd[1], 2)
    out = [control]
    if auth != prev or tick % STATUS_EVERY == 0:
        engaged = auth == "supervisor"
        alert = {
            "code": "SI_STOP",
            "severity": "critical",
            "text": f"{stack_name} lost. Safety Island stopping",
        }
        out.append(
            {
                **_envelope("status", t_ms),
                "name": NAME,
                "device": DEVICE,
                "mode": "active" if engaged else "standby",
            },
        )
        out.append({**_envelope("alerts", t_ms), "alerts": [alert] if engaged else []})
    return out
