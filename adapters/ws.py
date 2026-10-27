"""WebSocket broadcast endpoint for live dashboard adapters."""

from __future__ import annotations

import json
import sys
from collections.abc import Callable

import websockets


def dump(msg: dict) -> str | None:
    """JSON text for msg, or None for a message with NaN or infinity, which JSON cannot carry."""
    try:
        return json.dumps(msg, allow_nan=False)
    except ValueError as e:
        print(f"dropped one {msg.get('type')} message: {e}", file=sys.stderr)
        return None


class Endpoint:
    def __init__(self, hello: dict, initial: Callable[[], list[dict]] = list) -> None:
        self.hello = dump(hello)
        self.initial = initial
        self.clients: set = set()

    async def _handler(self, conn) -> None:
        try:
            await conn.send(self.hello)
            self.clients.add(conn)
            for text in filter(None, map(dump, self.initial())):
                await conn.send(text)
            await conn.wait_closed()
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(conn)

    async def start(self, host: str, port: int) -> websockets.Server:
        return await websockets.serve(self._handler, host, port)

    def broadcast(self, msg: dict) -> None:
        text = dump(msg)
        if text is not None:
            websockets.broadcast(self.clients, text)
