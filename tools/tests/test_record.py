import asyncio
import json

from tools import record, replay

HELLO = {"source": "t", "type": "hello", "t_ms": 0, "schema": 1, "roles": ["vehicle"]}


def test_record_writes_what_replay_sends(tmp_path):
    src = tmp_path / "src.jsonl"
    msgs = [HELLO, {"source": "t", "type": "ego", "t_ms": 5, "speed_mps": 1.5}]
    src.write_text("".join(json.dumps(m) + "\n" for m in msgs))
    out = tmp_path / "out"

    async def run():
        servers = await replay.serve({"a": (src, 18703)})
        try:
            return await record.record("a", "ws://127.0.0.1:18703", out, seconds=0.5)
        finally:
            for s in servers:
                s.close()
                await s.wait_closed()

    n = asyncio.run(run())
    assert n == 2
    got = [json.loads(ln) for ln in (out / "a.jsonl").read_text().splitlines()]
    assert got == msgs


def test_record_skips_invalid_lines_but_keeps_going(tmp_path, capsys):
    out = tmp_path / "out"

    async def run():
        async def handler(ws):
            await ws.send(json.dumps(HELLO))
            await ws.send("{not json")
            await ws.send(json.dumps({"source": "t", "type": "ego", "t_ms": 1, "speed_mps": 0}))
            await ws.wait_closed()

        import websockets

        server = await websockets.serve(handler, "127.0.0.1", 18704)
        try:
            return await record.record("b", "ws://127.0.0.1:18704", out, seconds=0.5)
        finally:
            server.close()
            await server.wait_closed()

    assert asyncio.run(run()) == 2
    assert "invalid" in capsys.readouterr().err
