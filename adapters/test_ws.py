"""Run: python3 -m pytest adapters/test_ws.py (from the repository root)."""

import asyncio
import json
import math

import websockets

from adapters import ws

HELLO = {
    "source": "t",
    "type": "hello",
    "t_ms": 0,
    "schema": 1,
    "roles": ["vehicle"],
}


def ego(v: float) -> dict:
    return {"source": "t", "type": "ego", "t_ms": 1, "speed_mps": v}


async def recv(conn) -> dict:
    return json.loads(await asyncio.wait_for(conn.recv(), 2))


def test_new_client_gets_hello_initial_then_broadcasts():
    async def run():
        ep = ws.Endpoint(HELLO, lambda: [ego(1.0)])
        server = await ep.start("127.0.0.1", 18711)
        try:
            async with websockets.connect("ws://127.0.0.1:18711") as a:
                assert (await recv(a))["type"] == "hello"
                assert (await recv(a))["speed_mps"] == 1.0
                async with websockets.connect("ws://127.0.0.1:18711") as b:
                    assert (await recv(b))["type"] == "hello"
                    assert (await recv(b))["speed_mps"] == 1.0
                    ep.broadcast(ego(2.0))
                    assert (await recv(a))["speed_mps"] == 2.0
                    assert (await recv(b))["speed_mps"] == 2.0
                # A reload closes one page. The other page keeps its stream.
                await asyncio.sleep(0.1)
                ep.broadcast(ego(3.0))
                assert (await recv(a))["speed_mps"] == 3.0
                assert len(ep.clients) == 1
        finally:
            server.close()
            await server.wait_closed()

    asyncio.run(run())


def test_nan_is_dropped_not_sent(capsys):
    async def run():
        ep = ws.Endpoint(HELLO)
        server = await ep.start("127.0.0.1", 18712)
        try:
            async with websockets.connect("ws://127.0.0.1:18712") as a:
                assert (await recv(a))["type"] == "hello"
                await asyncio.sleep(0.05)
                ep.broadcast(ego(math.nan))
                ep.broadcast(ego(4.0))
                assert (await recv(a))["speed_mps"] == 4.0
        finally:
            server.close()
            await server.wait_closed()

    asyncio.run(run())
    assert "dropped one ego message" in capsys.readouterr().err
