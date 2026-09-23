import json
import pathlib

import jsonschema
import pytest

from tools import schema

EXAMPLES = sorted((schema.SCHEMA_DIR / "examples").glob("*.json"))
TYPES = ["hello", "ego", "objects", "lanes", "trajectory", "map", "alerts", "control", "status"]


def test_every_type_has_a_schema_and_an_example():
    assert sorted(p.stem for p in EXAMPLES) == sorted(TYPES)
    for t in TYPES:
        assert (schema.SCHEMA_DIR / f"{t}.json").exists()


@pytest.mark.parametrize("path", EXAMPLES, ids=[p.stem for p in EXAMPLES])
def test_example_validates(path: pathlib.Path):
    msg = json.loads(path.read_text())
    assert msg["type"] == path.stem
    schema.validate(msg)


def test_unknown_field_is_allowed():
    msg = json.loads((schema.SCHEMA_DIR / "examples/ego.json").read_text())
    msg["future_field"] = 1
    schema.validate(msg)


def test_missing_envelope_field_fails():
    msg = json.loads((schema.SCHEMA_DIR / "examples/ego.json").read_text())
    del msg["t_ms"]
    with pytest.raises(jsonschema.ValidationError):
        schema.validate(msg)


def test_unknown_type_fails():
    with pytest.raises(jsonschema.ValidationError):
        schema.validate({"source": "x", "type": "nope", "t_ms": 0})


def test_bad_enum_fails():
    msg = json.loads((schema.SCHEMA_DIR / "examples/control.json").read_text())
    msg["authority"] = "alien"
    with pytest.raises(jsonschema.ValidationError):
        schema.validate(msg)


def test_validate_line_returns_the_message():
    line = (schema.SCHEMA_DIR / "examples/hello.json").read_text().strip()
    assert schema.validate_line(line)["type"] == "hello"
