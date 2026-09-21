"""Validate dashboard messages against schema/v1 (design section 5).

Usage: python3 -m tools.schema [FILE.jsonl ...]   (standard input when no file is given)
Prints the first failure per file and exits non-zero if any file failed.
"""

import functools
import json
import pathlib
import sys

import jsonschema

SCHEMA_DIR = pathlib.Path(__file__).resolve().parent.parent / "schema" / "v1"


@functools.cache
def _validator(msg_type: str) -> jsonschema.Draft202012Validator:
    path = SCHEMA_DIR / f"{msg_type}.json"
    if not path.exists():
        raise jsonschema.ValidationError(f"unknown message type {msg_type!r}")
    return jsonschema.Draft202012Validator(json.loads(path.read_text()))


def validate(msg: dict) -> None:
    if not isinstance(msg, dict) or "type" not in msg:
        raise jsonschema.ValidationError("message is not an object with a type")
    _validator(str(msg["type"])).validate(msg)


def validate_line(line: str) -> dict:
    msg = json.loads(line)
    validate(msg)
    return msg


if __name__ == "__main__":
    bad = False
    for name in sys.argv[1:] or ["-"]:
        text = sys.stdin.read() if name == "-" else pathlib.Path(name).read_text()
        for i, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            try:
                validate_line(line)
            except (json.JSONDecodeError, jsonschema.ValidationError) as e:
                print(f"{name}:{i}: {str(e).splitlines()[0]}")
                bad = True
                break
    sys.exit(1 if bad else 0)
