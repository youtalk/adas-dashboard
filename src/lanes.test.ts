import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { LaneManager, type RawLane } from "./lanes";

function makeScene() {
  return new THREE.Scene();
}

function laneLines(scene: THREE.Scene): THREE.Line[] {
  return scene.children.filter((c) => c instanceof THREE.Line) as THREE.Line[];
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

  it("adds one THREE.Line per lane boundary after rebuild", () => {
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

  it("stackLost sets opacity to 0.15 on all lines", () => {
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.stackLost();
    const mats = laneLines(scene).map((l) => l.material as THREE.LineBasicMaterial);
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(0.15, 2);
    }
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
    // Point 0: ego (x=10, y=1.75) → scene (x=1.75, z=10)
    expect(pos.getX(0)).toBeCloseTo(1.75, 3);
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
    expect(pos.getX(0)).toBeCloseTo(50, 3);
    expect(pos.getZ(0)).toBeCloseTo(100, 3);
  });
});

// ---------------------------------------------------------------------------
// Alert coloring
// ---------------------------------------------------------------------------

describe("LaneManager — alert coloring", () => {
  it("colors the matching kind red when setAlertKind is called", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    mgr.setMsg([leftLane, rightLane], "ego");
    mgr.rebuild(0, 0, 0);
    const lines = laneLines(scene);
    // Before alert: both lines should be the cyan lane color (0x22d3ee).
    const leftLine = lines.find((_, i) => {
      const m = scene.children.filter((c) => c instanceof THREE.Line)[i];
      return m === lines[0];
    });
    mgr.setAlertKind("left");
    const mats = scene.children
      .filter((c) => c instanceof THREE.Line)
      .map((c) => (c as THREE.Line).material as THREE.LineBasicMaterial);
    const redMat = mats.find((m) => m.color.getHex() === 0xb91c1c);
    const cyanMat = mats.find((m) => m.color.getHex() === 0x22d3ee);
    expect(redMat).toBeDefined();
    expect(cyanMat).toBeDefined();
  });

  it("restores cyan when setAlertKind is cleared", () => {
    const scene = makeScene();
    const mgr = new LaneManager(scene);
    mgr.setMsg([leftLane], "ego");
    mgr.rebuild(0, 0, 0);
    mgr.setAlertKind("left");
    mgr.setAlertKind(null);
    const mat = laneLines(scene)[0].material as THREE.LineBasicMaterial;
    expect(mat.color.getHex()).toBe(0x22d3ee);
  });
});
