"""Convert the rviz vehicle meshes to .glb (design section 9).

Usage: python3 assets/meshes/convert.py
Needs: pip install -r assets/meshes/requirements.txt

The meshes are by Sebastian Preusse under CC BY-SA 4.0, see LICENSE next to this file.
Each one is a unit cube centered at the origin, x forward and z up. The page scales it to
the object size, so the script refuses a mesh that is not a unit cube.
"""

import pathlib
import urllib.request

import trimesh

COMMIT = "b3d59795932ee08cad52de5f1981cb8ef9d6d37c"
SRC = (
    "https://raw.githubusercontent.com/autowarefoundation/autoware_rviz_plugins/"
    f"{COMMIT}/autoware_perception_rviz_plugin/meshes"
)
NAMES = ["car", "suv", "truck", "bus", "trailer", "pedestrian", "cyclist", "bicycle"]
OUT = pathlib.Path(__file__).parent


def fetch(name: str) -> bytes:
    with urllib.request.urlopen(f"{SRC}/{name}") as r:
        return r.read()


def main() -> None:
    for name in NAMES:
        stream = trimesh.util.wrap_as_stream(fetch(f"{name}.dae"))
        mesh = trimesh.load(stream, file_type="dae", force="scene").to_geometry()
        if abs(mesh.extents - 1).max() > 0.02:
            raise SystemExit(f"{name}: not a unit cube, extents {mesh.extents}")
        mesh.export(OUT / f"{name}.glb")
        print(f"{name}.glb {(OUT / f'{name}.glb').stat().st_size} bytes")
    (OUT / "LICENSE").write_bytes(fetch("LICENSE"))


if __name__ == "__main__":
    main()
