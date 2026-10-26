import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { LaneManager, type RawLane } from "./lanes";

function makeScene() {
  return new THREE.Scene();
}

function laneLines(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
}

const leftLane: RawLane = {
  kind: "left",
  pts: [
    [1, 1.75],
    [5, 1.75],
    [10, 1.75],
  ],
};
const rightLane: RawLane = {
  kind: "right",
  pts: [
    [1, -1.75],
    [5, -1.75],
    [10, -1.75],
  ],
};

// ---------------------------------------------------------------------------
// Basic scene management
// ---------------------------------------------------------------------------

describe("LaneManager — scene management", () => {
  let scene: THREE.Scene;
  let mgr: LaneManager;

  beforeEach(() => {
    scene = makeScene();
    mgr = new LaneManager(scene);
  });

  it("adds one strip mesh per lane boundary after rebuild", () => {
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    expect(laneLines(scene).length).toBe(2);
  });

  it("reduces line count when lanes message has fewer boundaries", () => {
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.setMsg([leftLane], "ego");
    mgr.rebuild(0, 0, 0);
    expect(laneLines(scene).length).toBe(1);
  });

  it("clear removes all lines from scene", () => {
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.clear();
    expect(laneLines(scene).length).toBe(0);
  });

  it("skips a lane with fewer than 2 points", () => {
    const tiny: RawLane = { kind: "left", pts: [[1, 1]] };
    mgr.setMsg([tiny], "ego");
    mgr.rebuild(0, 0, 0);
    // Line slot is created but hidden.
    const lines = laneLines(scene);
    expect(lines.length).toBe(1);
    expect(lines[0].visible).toBe(false);
  });

  it("stackLost fades all lines to 0.15 over 500 ms and holds", () => {
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.stackLost();
    const mats = laneLines(scene).map((l) => l.material as THREE.MeshBasicMaterial);
    expect(mats[0].opacity).toBe(1); // no jump on the stackLost frame
    mgr.tick(0.25);
    expect(mats[0].opacity).toBeCloseTo(0.5, 2);
    mgr.tick(1.0);
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(0.15, 2);
    }
    mgr.setMsg([leftLane, rightLane], "ego"); // stack is back
    expect(mats[0].opacity).toBe(1);
  });

  it("followsEgo only for live ego-frame lanes", () => {
    mgr.setMsg([leftLane], "ego");
    expect(mgr.followsEgo).toBe(true);
    mgr.stackLost();
    expect(mgr.followsEgo).toBe(false); // ghost holds its world position
    mgr.setMsg([leftLane], "map");
    expect(mgr.followsEgo).toBe(false);
  });

  it("lane slot is hidden when pts has fewer than 2 points", () => {
    const twoLane: RawLane = {
      kind: "left",
      pts: [
        [0, 0],
        [5, 0],
      ],
    };
    const onePoint: RawLane = { kind: "left", pts: [[0, 0]] };
    mgr.setMsg([twoLane], "ego");
    mgr.rebuild(0, 0, 0);
    expect(laneLines(scene)[0].visible).toBe(true);
    mgr.setMsg([onePoint], "ego");
    mgr.rebuild(0, 0, 0);
    expect(laneLines(scene)[0].visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ego-frame coordinate transform
// ---------------------------------------------------------------------------

describe("LaneManager — ego-frame transform", () => {
  it("transforms ego-frame pts to scene space: ego-forward (x) → scene-z", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    // One lane, two points: both 10 m ahead (ego x=10) and 1.75 m left (ego y=1.75)
    const lane: RawLane = { kind: "left", pts: [[10, 1.75]] }; // single pt, will be skipped
    const twoLane: RawLane = {
      kind: "left",
      pts: [
        [10, 1.75],
        [20, 1.75],
      ],
    };
    mgr.setMsg([twoLane], "ego");
    mgr.rebuild(0, 0, 0); // ego at origin, yaw=0
    const line = laneLines(scene)[0];
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    // Point 0: ego (x=10, y=1.75) → scene (x=1.75, z=10), between the strip's
    // first two vertices, which are 0.15 m apart across the lane.
    expect((pos.getX(0) + pos.getX(1)) / 2).toBeCloseTo(1.75, 3);
    expect(Math.abs(pos.getX(0) - pos.getX(1))).toBeCloseTo(0.15, 3);
    expect(pos.getZ(0)).toBeCloseTo(10, 3);
  });

  it("updates positions when ego pose changes (tracks moving ego at 60 Hz)", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    const lane: RawLane = {
      kind: "left",
      pts: [
        [5, 1.75],
        [10, 1.75],
      ],
    };
    mgr.setMsg([lane], "ego");
    mgr.rebuild(0, 0, 0);
    const line = laneLines(scene)[0];
    const posAttr = line.geometry.attributes.position as THREE.BufferAttribute;
    const z0 = posAttr.getZ(0); // should be ~5
    // Now ego moves 3 m forward (egoSceneZ = 3).
    mgr.rebuild(0, 3, 0);
    expect(posAttr.getZ(0)).toBeCloseTo(z0 + 3, 3);
  });
});

// ---------------------------------------------------------------------------
// Map-frame coordinate transform
// ---------------------------------------------------------------------------

describe("LaneManager — map-frame transform", () => {
  it("transforms map-frame pts via mapToScene: map-x → scene-z", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    const lane: RawLane = {
      kind: "left",
      pts: [
        [100, 50],
        [110, 50],
      ],
    };
    mgr.setMsg([lane], "map");
    mgr.rebuild(0, 0, 0); // ego pose irrelevant for map frame
    const pos = laneLines(scene)[0].geometry.attributes.position as THREE.BufferAttribute;
    // mapToScene(100, 50) → { x: 50, z: 100 }
    expect((pos.getX(0) + pos.getX(1)) / 2).toBeCloseTo(50, 3);
    expect(pos.getZ(0)).toBeCloseTo(100, 3);
  });
});

// ---------------------------------------------------------------------------
// Alert coloring
// ---------------------------------------------------------------------------

describe("LaneManager — alert coloring", () => {
  it("colors the matching kind red when setAlertKinds is called", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    const lines = laneLines(scene);
    // Before alert: both lines should be the cyan lane color (0x22d3ee).
    const leftLine = lines.find((_, i) => {
      const m = scene.children.filter((c) => c instanceof THREE.Mesh)[i];
      return m === lines[0];
    });
    mgr.setAlertKinds(["left"]);
    const mats = scene.children
      .filter((c) => c instanceof THREE.Mesh)
      .map((c) => (c as THREE.Mesh).material as THREE.MeshBasicMaterial);
    const redMat = mats.find((m) => m.color.getHex() === 0xb91c1c);
    const cyanMat = mats.find((m) => m.color.getHex() === 0x22d3ee);
    expect(redMat).toBeDefined();
    expect(cyanMat).toBeDefined();
  });

  it("restores cyan when setAlertKinds is cleared", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    mgr.setMsg([leftLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.setAlertKinds(["left"]);
    mgr.setAlertKinds([]);
    const mat = laneLines(scene)[0].material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x22d3ee);
  });

  it("colors both lanes red when both are targets", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.setAlertKinds(["left", "right"]);
    for (const line of laneLines(scene)) {
      expect((line.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xb91c1c);
    }
  });
});
