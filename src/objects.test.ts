import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { egoToScene } from "./frames";
import { ObjectManager, type RawObject } from "./objects";

// ---------------------------------------------------------------------------
// egoToScene — pure function
// ---------------------------------------------------------------------------

describe("egoToScene", () => {
  it("places object directly ahead when ego faces north (yaw = 0)", () => {
    // Ego at origin, yaw 0. Object 10 m ahead (x = 10, y = 0 in ego frame).
    // scene.z = map.x = 10, scene.x = map.y = 0.
    const p = egoToScene(10, 0, 0, 0, 0, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(10);
    expect(p.ry).toBeCloseTo(0);
  });

  it("places object to the left when ego faces north", () => {
    // Ego at origin, yaw 0. Object 5 m to the left (x = 0, y = 5).
    // scene.x = map.y = 5, scene.z = 0.
    const p = egoToScene(0, 5, 0, 0, 0, 0);
    expect(p.x).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(0);
  });

  it("rotates ego-frame offset by egoYaw = π/2 (east)", () => {
    // Ego at origin, yaw π/2. Object 10 m ahead in ego frame should appear
    // 10 m to the right in the scene (east).
    // scene.x = 0 + 10*sin(π/2) + 0 = 10
    // scene.z = 0 + 10*cos(π/2) - 0 ≈ 0
    const p = egoToScene(10, 0, 0, 0, 0, Math.PI / 2);
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(0);
  });

  it("offsets from a non-zero ego scene position", () => {
    const p = egoToScene(0, 0, 0, 100, 200, 0);
    expect(p.x).toBeCloseTo(100);
    expect(p.z).toBeCloseTo(200);
  });

  it("adds egoYaw and object yaw for scene rotation", () => {
    const p = egoToScene(0, 0, Math.PI / 4, 0, 0, Math.PI / 4);
    expect(p.ry).toBeCloseTo(Math.PI / 2);
  });
});

// ---------------------------------------------------------------------------
// ObjectManager — fade and stack-lost behaviour
// ---------------------------------------------------------------------------

function makeScene() {
  return new THREE.Scene();
}

function makeObj(id: number, lead = false): RawObject {
  return { id, class: "unknown", x: 0, y: 0, yaw: 0, length: 4, width: 2, height: 1.5, lead };
}

function forceReady(mgr: ObjectManager) {
  (mgr as unknown as { ready: boolean }).ready = true;
}

describe("ObjectManager fade", () => {
  let scene: THREE.Scene;
  let mgr: ObjectManager;

  beforeEach(() => {
    scene = makeScene();
    mgr = new ObjectManager(scene);
    forceReady(mgr);
  });

  it("starts with opacity 0 and fades in over FADE_IN_S = 0.3 s", () => {
    mgr.update([makeObj(1)], "map");
    const tracked = (mgr as unknown as { tracked: Map<number, { opacity: number }> }).tracked;

    mgr.tick(0.15, 0, 0, 0); // half of fade-in
    expect(tracked.get(1)!.opacity).toBeCloseTo(0.5, 1);

    mgr.tick(0.15, 0, 0, 0); // full fade-in
    expect(tracked.get(1)!.opacity).toBeCloseTo(1, 1);
  });

  it("fades out and removes the object after FADE_OUT_S = 0.5 s", () => {
    mgr.update([makeObj(1)], "map");
    mgr.tick(0.3, 0, 0, 0); // fully faded in

    mgr.update([], "map"); // object gone
    mgr.tick(0.25, 0, 0, 0); // half of fade-out
    const tracked = (mgr as unknown as { tracked: Map<number, { opacity: number }> }).tracked;
    expect(tracked.get(1)!.opacity).toBeCloseTo(0.5, 1);

    mgr.tick(0.25, 0, 0, 0); // full fade-out
    expect(tracked.has(1)).toBe(false);
    expect(scene.children.length).toBe(0);
  });

  it("stackLost fades objects to 15% opacity and holds them", () => {
    mgr.update([makeObj(1)], "map");
    mgr.tick(0.3, 0, 0, 0); // fully faded in

    mgr.stackLost();
    mgr.tick(0.5, 0, 0, 0); // enough time to reach 15%

    const tracked = (mgr as unknown as { tracked: Map<number, { opacity: number }> }).tracked;
    expect(tracked.get(1)!.opacity).toBeCloseTo(0.15, 2);

    mgr.tick(1.0, 0, 0, 0); // further ticks must not go below 15%
    expect(tracked.get(1)!.opacity).toBeCloseTo(0.15, 2);
    expect(tracked.has(1)).toBe(true); // object stays in scene
  });

  it("setLeadAlert(false) hides ring on former lead when lead flag moves to another id", () => {
    mgr.update([makeObj(1, true), makeObj(2, false)], "map");
    mgr.tick(0.3, 0, 0, 0);
    mgr.setLeadAlert(true); // id 1 gets a ring
    const tracked = (mgr as unknown as { tracked: Map<number, { ring: THREE.LineLoop | null }> })
      .tracked;
    expect(tracked.get(1)!.ring?.visible).toBe(true);

    // Lead flag moves: id 1 is no longer lead.
    mgr.update([makeObj(1, false), makeObj(2, true)], "map");
    mgr.tick(0, 0, 0, 0);
    mgr.setLeadAlert(true); // id 2 should get ring, id 1's ring should be hidden
    expect(tracked.get(1)!.ring?.visible).toBe(false);
    expect(tracked.get(2)!.ring?.visible).toBe(true);
  });

  it("leadLabelPoint is 0.5 m above the live lead's roof, null once the stack is lost", () => {
    // Map (30, 2) is scene (x=2, z=30); makeObj height is 1.5 m.
    mgr.update([{ ...makeObj(1, true), x: 30, y: 2 }], "map");
    mgr.tick(0, 0, 0, 0);
    const p = mgr.leadLabelPoint()!;
    expect([p.x, p.y, p.z]).toEqual([2, 2, 30]);
    mgr.stackLost();
    expect(mgr.leadLabelPoint()).toBeNull();
  });

  it("leadDistM prefers distance_m from the stack", () => {
    mgr.update([{ ...makeObj(1, true), x: 32.1, y: 3, distance_m: 29.8 }], "ego");
    expect(mgr.leadDistM(0, 0)).toBeCloseTo(29.8);
  });

  it("leadDistM measures map-frame leads from ego, not from the map origin", () => {
    // Ego at map (1200, -40) is scene (x=-40, z=1200). Lead 30 m ahead at map (1230, -40).
    mgr.update([{ ...makeObj(1, true), x: 1230, y: -40 }], "map");
    expect(mgr.leadDistM(-40, 1200)).toBeCloseTo(30);
  });

  it("leadDistM is null without a lead and after stackLost", () => {
    mgr.update([makeObj(1, false)], "ego");
    expect(mgr.leadDistM(0, 0)).toBeNull();
    mgr.update([{ ...makeObj(1, true), x: 20 }], "ego");
    expect(mgr.leadDistM(0, 0)).toBeCloseTo(20);
    mgr.stackLost();
    expect(mgr.leadDistM(0, 0)).toBeNull();
  });

  it("unfreezes and resumes normal tracking when object reappears after stackLost", () => {
    mgr.update([makeObj(1)], "map");
    mgr.tick(0.3, 0, 0, 0);
    mgr.stackLost();
    mgr.tick(0.5, 0, 0, 0);

    // Stack reconnects and sends the object again.
    mgr.update([makeObj(1)], "map");
    mgr.tick(0.3, 0, 0, 0);

    const tracked = (mgr as unknown as { tracked: Map<number, { opacity: number }> }).tracked;
    expect(tracked.get(1)!.opacity).toBeCloseTo(1, 1);
  });
});
