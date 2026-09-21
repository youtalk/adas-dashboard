"""Serve JSONL recordings over WebSocket with their original timing (design section 10).

Usage: python3 -m tools.replay [--host H] [--speed S] [--loop] NAME=FILE:PORT ...
Each endpoint listens on HOST:PORT, 127.0.0.1 by default, and gives a client its own
playback from the start of the file.

Without --loop, an endpoint stops listening once its file has played out. A stack that
dies stops accepting connections, and the closed port is the only signal of the kill that
the recording carries, so an endpoint that kept listening would let a reconnecting page
resurrect it half a second later (design sections 5.3 and 6.3). This assumes one browser
at a time, which is the W0 use case. Restart the tool to play again.

With --loop, no endpoint ever closes and every client restarts from the first message.
Files of different lengths drift apart, so --loop never shows the end of a scenario.
"""

import argparse
import asyncio
import pathlib

import websockets

from tools import schema


def load(path: pathlib.Path) -> list[tuple[float, str]]:
    lines = [ln for ln in path.read_text().splitlines() if ln.strip()]
    if not lines:
        raise ValueError(f"{path}: empty recording")
    msgs = [(schema.validate_line(ln), ln) for ln in lines]
    if msgs[0][0]["type"] != "hello":
        raise ValueError(f"{path}: the first line must be a hello message")
    return [(float(m["t_ms"]), raw) for m, raw in msgs]


def parse_endpoint(spec: str) -> tuple[str, pathlib.Path, int]:
    try:
        name, rest = spec.split("=", 1)
        file, port = rest.rsplit(":", 1)
        return name, pathlib.Path(file), int(port)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"{spec!r} is not NAME=FILE:PORT") from e


async def _play(ws, msgs: list[tuple[float, str]], speed: float, loop: bool) -> None:
    while True:
        # hello goes out immediately. The playback clock starts at the message
        # after it, so the gap between hello and the first real message is not
        # a wait. Do not fold hello back into the delay loop.
        await ws.send(msgs[0][1])
        prev = msgs[1][0] if len(msgs) > 1 else msgs[0][0]
        for t_ms, raw in msgs[1:]:
            delay = (t_ms - prev) / 1000.0 / speed
            if delay > 0:
                await asyncio.sleep(delay)
            prev = t_ms
            await ws.send(raw)
        if not loop:
            # A real stack that dies closes its socket. Returning here, instead of
            # waiting on the client, lets the handler exit and the connection close,
            # so replay honestly reproduces a Stack lost (design section 6.3).
            return
        if len(msgs) == 1:
            await asyncio.sleep(1.0 / speed)  # a hello-only file would spin otherwise


async def serve(
    endpoints: dict[str, tuple[pathlib.Path, int]],
    speed: float = 1.0,
    loop: bool = False,
    host: str = "127.0.0.1",
) -> list[websockets.Server]:
    servers: dict[str, websockets.Server] = {}
    for name, (path, port) in endpoints.items():
        msgs = load(path)

        async def handler(ws, msgs=msgs, name=name):
            try:
                await _play(ws, msgs, speed, loop)
            except websockets.ConnectionClosed:
                return
            # The file ran out and --loop is off. Close this endpoint's server so the
            # port stops accepting connections, the way a dead stack's port does. Other
            # endpoints keep their own servers and keep playing.
            servers[name].close()

        servers[name] = await websockets.serve(handler, host, port)
        print(f"{name}: {path} ({len(msgs)} messages) on ws://{host}:{port}")
    return list(servers.values())


async def _main(args: argparse.Namespace) -> None:
    endpoints = {name: (path, port) for name, path, port in args.endpoint}
    servers = await serve(endpoints, args.speed, args.loop, args.host)
    try:
        await asyncio.Event().wait()
    finally:
        for s in servers:
            s.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("endpoint", nargs="+", type=parse_endpoint, help="NAME=FILE:PORT")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--loop", action="store_true")
    parsed = ap.parse_args()
    if parsed.speed <= 0:
        ap.error("--speed must be greater than 0")
    asyncio.run(_main(parsed))
