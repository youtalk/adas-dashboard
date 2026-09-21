"""Validate dashboard messages against schema/v1 (design section 5)."""

import functools
import json
import pathlib

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
