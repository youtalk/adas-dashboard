"""Record live endpoints into JSONL files (design section 10).

Usage: python3 -m tools.record [--out DIR] [--seconds N] NAME=ws://host:port/path ...
Writes DIR/NAME.jsonl with every text frame as received. Invalid frames are reported and skipped.
"""

import argparse
import asyncio
import pathlib
import sys

import jsonschema
import websockets

from tools import schema


async def record(name: str, url: str, out: pathlib.Path, seconds: float | None) -> int:
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    loop = asyncio.get_running_loop()
    deadline = None if seconds is None else loop.time() + seconds
    with (out / f"{name}.jsonl").open("w") as f:
        async with websockets.connect(url) as ws:
            while deadline is None or loop.time() < deadline:
                timeout = None if deadline is None else max(0.0, deadline - loop.time())
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout)
                except (TimeoutError, websockets.ConnectionClosed):
                    break
                try:
                    schema.validate_line(raw)
                except (ValueError, jsonschema.ValidationError) as e:
                    print(f"{name}: invalid frame skipped: {e}", file=sys.stderr)
                    continue
                f.write(raw.strip() + "\n")
                n += 1
    return n


async def _main(args: argparse.Namespace) -> None:
    tasks = []
    for spec in args.endpoint:
        name, url = spec.split("=", 1)
        tasks.append(record(name, url, pathlib.Path(args.out), args.seconds))
    for name, n in zip(args.endpoint, await asyncio.gather(*tasks), strict=True):
        print(f"{name.split('=')[0]}: {n} messages")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("endpoint", nargs="+", help="NAME=ws://host:port/path")
    ap.add_argument("--out", default="recordings/new")
    ap.add_argument("--seconds", type=float, default=None)
    asyncio.run(_main(ap.parse_args()))
