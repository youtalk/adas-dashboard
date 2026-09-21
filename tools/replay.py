"""Serve JSONL recordings over WebSocket with their original timing (design section 10).

Usage: python3 -m tools.replay [--speed S] [--loop] NAME=FILE:PORT ...
Each endpoint listens on 127.0.0.1:PORT. Every client gets its own playback from the start.
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
    name, rest = spec.split("=", 1)
    file, port = rest.rsplit(":", 1)
    return name, pathlib.Path(file), int(port)


async def _play(ws, msgs: list[tuple[float, str]], speed: float, loop: bool) -> None:
    while True:
        # hello goes out immediately, and the playback clock starts at the message
        # after it: hello's own t_ms=0 must not become `prev`, or the gap between
        # hello and the first real message gets counted as a wait. Don't "fix" this
        # back to `prev = t_ms` unconditionally.
        prev = msgs[1][0] if len(msgs) > 1 else msgs[0][0]
        for i, (t_ms, raw) in enumerate(msgs):
            delay = (t_ms - prev) / 1000.0 / speed
            if delay > 0:
                await asyncio.sleep(delay)
            if i > 0:
                prev = t_ms
            await ws.send(raw)
        if not loop:
            await ws.wait_closed()
            return


async def serve(
    endpoints: dict[str, tuple[pathlib.Path, int]], speed: float = 1.0, loop: bool = False
) -> list[websockets.Server]:
    servers = []
    for name, (path, port) in endpoints.items():
        msgs = load(path)

        async def handler(ws, msgs=msgs, name=name):
            try:
                await _play(ws, msgs, speed, loop)
            except websockets.ConnectionClosed:
                pass

        servers.append(await websockets.serve(handler, "127.0.0.1", port))
        print(f"{name}: {path} ({len(msgs)} messages) on ws://127.0.0.1:{port}")
    return servers


async def _main(args: argparse.Namespace) -> None:
    endpoints = {n: (p, port) for n, p, port in map(parse_endpoint, args.endpoint)}
    servers = await serve(endpoints, args.speed, args.loop)
    try:
        await asyncio.Event().wait()
    finally:
        for s in servers:
            s.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("endpoint", nargs="+", help="NAME=FILE:PORT")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--loop", action="store_true")
    asyncio.run(_main(ap.parse_args()))
