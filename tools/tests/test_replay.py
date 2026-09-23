import argparse
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


def test_parse_endpoint_reports_a_bad_spec_as_an_argparse_error():
    for spec in ("stack.jsonl:8090", "stack=stack.jsonl", "stack=stack.jsonl:eighty"):
        with pytest.raises(argparse.ArgumentTypeError, match="NAME=FILE:PORT"):
            replay.parse_endpoint(spec)


def test_a_finished_endpoint_stops_listening(tmp_path):
    # The closed socket is the only kill signal the recording carries, so a page that
    # reconnects must fail to connect instead of replaying the file from the start
    # (design sections 5.3 and 6.3).
    p = tmp_path / "a.jsonl"
    write_jsonl(p, [HELLO, ego(0, 1.0), ego(10, 2.0)])

    async def run():
        servers = await replay.serve({"a": (p, 18704)}, speed=100.0)
        async with websockets.connect("ws://127.0.0.1:18704") as ws:
            with pytest.raises(websockets.ConnectionClosed):
                while True:
                    await ws.recv()
        await servers[0].wait_closed()
        with pytest.raises(OSError):
            await websockets.connect("ws://127.0.0.1:18704")

    asyncio.run(run())


def test_a_finished_endpoint_does_not_close_its_siblings(tmp_path):
    # The handler closes servers[name] -- its own server only (replay.py's comment
    # above that call). A refactor that closed every server instead would leave
    # test_a_finished_endpoint_stops_listening green, since that test only checks the
    # endpoint that finished, and would silently bring the bug back for every other
    # endpoint. Pin isolation directly: a live sibling must still answer right after
    # the short endpoint's server closes.
    short = tmp_path / "short.jsonl"
    write_jsonl(short, [HELLO, ego(0, 1.0), ego(10, 2.0)])
    long = tmp_path / "long.jsonl"
    write_jsonl(long, [HELLO, ego(0, 1.0), ego(60000, 2.0)])

    async def run():
        servers = await replay.serve({"short": (short, 18705), "long": (long, 18706)}, speed=100.0)
        try:
            async with websockets.connect("ws://127.0.0.1:18706") as long_ws:
                assert json.loads(await long_ws.recv())["type"] == "hello"

                async with websockets.connect("ws://127.0.0.1:18705") as short_ws:
                    with pytest.raises(websockets.ConnectionClosed):
                        while True:
                            await short_ws.recv()
                await servers[0].wait_closed()

                with pytest.raises(OSError):
                    await websockets.connect("ws://127.0.0.1:18705")

                async with websockets.connect("ws://127.0.0.1:18706") as fresh:
                    assert json.loads(await fresh.recv())["type"] == "hello"
        finally:
            servers[1].close()
            await servers[1].wait_closed()

    asyncio.run(run())


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
