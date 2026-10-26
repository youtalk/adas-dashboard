import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { TrajectoryRibbon } from "./trajectory";

function makeScene() {
  return new THREE.Scene();
}

function ribbonMesh(scene: THREE.Scene): THREE.Mesh | undefined {
  return scene.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
}

// ---------------------------------------------------------------------------
// Basic scene management
// ---------------------------------------------------------------------------

describe("TrajectoryRibbon — scene management", () => {
  let scene: THREE.Scene;
  let ribbon: TrajectoryRibbon;

  beforeEach(() => {
    scene = makeScene();
    ribbon = new TrajectoryRibbon(scene);
  });

  it("adds a mesh to the scene after first rebuild with enough points", () => {
    ribbon.setMsg(
      [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      2.3,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    expect(ribbonMesh(scene)).toBeDefined();
  });

  it("mesh is invisible when fewer than 2 points are provided", () => {
    ribbon.setMsg([[0, 0]], undefined, "ego");
    ribbon.rebuild(0, 0, 0);
    const mesh = ribbonMesh(scene);
    // Either no mesh or not visible.
    expect(mesh === undefined || mesh.visible === false).toBe(true);
  });

  it("clear removes the mesh from the scene", () => {
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      2.0,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    ribbon.clear();
    expect(ribbonMesh(scene)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Vertex count
// ---------------------------------------------------------------------------

describe("TrajectoryRibbon — geometry", () => {
  it("creates 2*N vertices for N trajectory points", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    const pts: [number, number][] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [15, 0],
    ];
    ribbon.setMsg(pts, 2.0, "ego");
    ribbon.rebuild(0, 0, 0);
    const mesh = ribbonMesh(scene)!;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    expect(pos.count).toBe(pts.length * 2); // 2 edge vertices per point
  });

  it("ribbon is 2.3 m wide when width_m is specified", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    // Straight path along ego-z (forward), so left edge x = +half_width.
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      2.3,
      "ego",
    );
    ribbon.rebuild(0, 0, 0); // ego at origin, yaw=0
    const mesh = ribbonMesh(scene)!;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    // Left vertex of first point: x should be ≈ +1.15 (half of 2.3)
    const lx = pos.getX(0);
    const rx = pos.getX(1);
    expect(Math.abs(lx - rx)).toBeCloseTo(2.3, 2);
  });

  it("falls back to 1.9 m width when width_m is absent", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      undefined,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    const mesh = ribbonMesh(scene)!;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const lx = pos.getX(0);
    const rx = pos.getX(1);
    expect(Math.abs(lx - rx)).toBeCloseTo(1.9, 2);
  });
});

// ---------------------------------------------------------------------------
// Ego-frame tracking
// ---------------------------------------------------------------------------

describe("TrajectoryRibbon — ego-frame tracking", () => {
  it("shifts ribbon when ego pose changes (tracks moving ego at 60 Hz)", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    ribbon.setMsg(
      [
        [5, 0],
        [10, 0],
      ],
      2.0,
      "ego",
    );
    ribbon.rebuild(0, 0, 0); // ego at origin
    const mesh = ribbonMesh(scene)!;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const z0 = pos.getZ(0);
    ribbon.rebuild(0, 3, 0); // ego moved 3 m forward
    expect(pos.getZ(0)).toBeCloseTo(z0 + 3, 3);
  });
});

// ---------------------------------------------------------------------------
// Alert coloring
// ---------------------------------------------------------------------------

describe("TrajectoryRibbon — stackLost", () => {
  it("stackLost fades the ribbon from 0.4 to 0.08 over 500 ms and stops following ego", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      2.0,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    expect(ribbon.followsEgo).toBe(true);
    ribbon.stackLost();
    expect(ribbon.followsEgo).toBe(false);
    const mat = ribbonMesh(scene)!.material as THREE.MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(0.4); // no jump on the stackLost frame
    ribbon.tick(0.25);
    expect(mat.opacity).toBeCloseTo(0.24, 2);
    ribbon.tick(1.0);
    expect(mat.opacity).toBeCloseTo(0.08, 2);
    ribbon.setMsg([], undefined, "ego"); // the stack is back
    expect(mat.opacity).toBe(0.4);
  });

  it("a map-frame ribbon does not follow ego", () => {
    const ribbon = new TrajectoryRibbon(makeScene());
    ribbon.setMsg([], undefined, "map");
    expect(ribbon.followsEgo).toBe(false);
  });
});

describe("TrajectoryRibbon — alert", () => {
  it("changes material to red when setAlert(true) is called", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      2.0,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    ribbon.setAlert(true);
    const mat = ribbonMesh(scene)!.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0xb91c1c);
  });

  it("restores green when setAlert(false) is called", () => {
    const scene = makeScene();
    const ribbon = new TrajectoryRibbon(scene);
    ribbon.setMsg(
      [
        [0, 0],
        [10, 0],
      ],
      2.0,
      "ego",
    );
    ribbon.rebuild(0, 0, 0);
    ribbon.setAlert(true);
    ribbon.setAlert(false);
    const mat = ribbonMesh(scene)!.material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x22c55e);
  });
});
