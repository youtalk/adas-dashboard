import asyncio
import json
import pathlib
import time

import pytest
import websockets

from tools import replay

HELLO = {"source": "t", "type": "hello", "t_ms": 0, "schema": 1, "roles": ["vehicle"]}


def write_jsonl(path: pathlib.Path, msgs: list[dict]) -> None:
    path.write_text("".join(json.dumps(m) + "\n" for m in msgs))


def ego(t_ms: float, v: float) -> dict:
    return {"source": "t", "type": "ego", "t_ms": t_ms, "speed_mps": v}


async def collect(port: int, n: int) -> tuple[list[dict], float]:
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        t0 = time.monotonic()
        out = [json.loads(await ws.recv()) for _ in range(n)]
        return out, time.monotonic() - t0


def test_load_rejects_a_file_without_hello_first(tmp_path):
    p = tmp_path / "a.jsonl"
    write_jsonl(p, [ego(0, 1.0), HELLO])
    with pytest.raises(ValueError, match="hello"):
        replay.load(p)


def test_serves_hello_then_messages_with_timing(tmp_path):
    p = tmp_path / "a.jsonl"
    write_jsonl(p, [HELLO, ego(1000, 1.0), ego(1300, 2.0), ego(1600, 3.0)])

    async def run():
        servers = await replay.serve({"a": (p, 18701)}, speed=2.0)
        try:
            return await collect(18701, 4)
        finally:
            for s in servers:
                s.close()
                await s.wait_closed()

    msgs, elapsed = asyncio.run(run())
    assert [m["type"] for m in msgs] == ["hello", "ego", "ego", "ego"]
    assert [m["speed_mps"] for m in msgs[1:]] == [1.0, 2.0, 3.0]
    # 600 ms of recording at 2x speed is about 300 ms of wall time.
    assert 0.2 < elapsed < 0.6


def test_loop_restarts_from_hello(tmp_path):
    p = tmp_path / "a.jsonl"
    write_jsonl(p, [HELLO, ego(0, 1.0), ego(10, 2.0)])

    async def run():
        servers = await replay.serve({"a": (p, 18702)}, speed=100.0, loop=True)
        try:
            return await collect(18702, 6)
        finally:
            for s in servers:
                s.close()
                await s.wait_closed()

    msgs, _ = asyncio.run(run())
    assert [m["type"] for m in msgs] == ["hello", "ego", "ego", "hello", "ego", "ego"]


def test_parse_endpoint():
    name, path, port = replay.parse_endpoint("stack=recordings/x/stack.jsonl:8090")
    assert (name, str(path), port) == ("stack", "recordings/x/stack.jsonl", 8090)


def test_hello_is_never_delayed_even_when_its_t_ms_is_later(tmp_path):
    # hello.t_ms is schema-legal but larger than every later message's t_ms. hello
    # must still go out immediately, not after the ~4.9 s gap a naive delay
    # calculation would produce.
    p = tmp_path / "a.jsonl"
    late_hello = {"source": "t", "type": "hello", "t_ms": 5000, "schema": 1, "roles": ["vehicle"]}
    write_jsonl(p, [late_hello, ego(100, 1.0), ego(200, 2.0)])

    async def run():
        servers = await replay.serve({"a": (p, 18703)}, speed=1.0)
        try:
            return await collect(18703, 1)
        finally:
            for s in servers:
                s.close()
                await s.wait_closed()

    msgs, elapsed = asyncio.run(run())
    assert msgs[0]["type"] == "hello"
    assert elapsed < 0.5
