import { describe, expect, it } from "vitest";
import { mapToScene, yawToSceneRotation, headingFromYaw } from "./frames";

describe("mapToScene", () => {
  it("maps ego-frame forward (+x) to scene +z", () => {
    const r = mapToScene(10, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(10);
  });

  it("maps ego-frame left (+y) to scene +x", () => {
    const r = mapToScene(0, 5);
    expect(r.x).toBeCloseTo(5);
    expect(r.z).toBeCloseTo(0);
  });

  it("maps ego-frame right (-y) to scene -x", () => {
    const r = mapToScene(0, -3);
    expect(r.x).toBeCloseTo(-3);
    expect(r.z).toBeCloseTo(0);
  });

  it("maps a combined point correctly", () => {
    const r = mapToScene(3, -2);
    expect(r.x).toBeCloseTo(-2);
    expect(r.z).toBeCloseTo(3);
  });

  it("maps the origin to the origin", () => {
    const r = mapToScene(0, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(0);
  });
});

describe("yawToSceneRotation", () => {
  it("returns 0 for yaw 0 (straight ahead)", () => {
    expect(yawToSceneRotation(0)).toBeCloseTo(0);
  });

  it("preserves yaw: a left turn (positive ego yaw) is a positive scene rotation", () => {
    expect(yawToSceneRotation(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it("preserves yaw: a right turn (negative ego yaw) is a negative scene rotation", () => {
    expect(yawToSceneRotation(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4);
  });
});

describe("headingFromYaw", () => {
  it("at yaw 0 the heading is +z in scene (forward)", () => {
    const h = headingFromYaw(0);
    expect(h.x).toBeCloseTo(0);
    expect(h.z).toBeCloseTo(1);
  });

  it("at yaw PI/2 (left turn) the heading is +x in scene", () => {
    const h = headingFromYaw(Math.PI / 2);
    expect(h.x).toBeCloseTo(1);
    expect(h.z).toBeCloseTo(0);
  });

  it("at yaw -PI/2 (right turn) the heading is -x in scene", () => {
    const h = headingFromYaw(-Math.PI / 2);
    expect(h.x).toBeCloseTo(-1);
    expect(h.z).toBeCloseTo(0);
  });

  it("returns a unit vector", () => {
    const h = headingFromYaw(0.7);
    const len = Math.sqrt(h.x * h.x + h.z * h.z);
    expect(len).toBeCloseTo(1);
  });
});
