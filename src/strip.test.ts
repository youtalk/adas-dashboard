import { describe, it, expect } from "vitest";
import { dashes, strip, type Pt } from "./strip";

function length(line: Pt[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    s += Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
  }
  return s;
}

describe("dashes", () => {
  it("cuts a 20 m straight line into 3 m dashes with 6 m gaps", () => {
    const d = dashes(
      [
        { x: 0, z: 0 },
        { x: 0, z: 20 },
      ],
      3,
      6,
    );
    expect(d.length).toBe(3);
    expect(d.map((line) => line[0].z)).toEqual([0, 9, 18]);
    expect(d.map(length)).toEqual([3, 3, 2]);
  });

  it("follows the polyline through its vertices", () => {
    // Points every 5 m, as in the map messages.
    const pts = [0, 5, 10, 15, 20].map((z) => ({ x: 0, z }));
    const d = dashes(pts, 3, 6);
    expect(d.map((line) => line.map((p) => p.z))).toEqual([
      [0, 3],
      [9, 10, 12],
      [18, 20],
    ]);
  });

  it("returns nothing for a line with fewer than 2 points", () => {
    expect(dashes([{ x: 0, z: 0 }], 3, 6)).toEqual([]);
  });
});

describe("strip", () => {
  it("makes two flat triangles per segment at the given height", () => {
    const pos = strip(
      [
        { x: 0, z: 0 },
        { x: 0, z: 5 },
        { x: 0, z: 10 },
      ],
      0.15,
      0.01,
    );
    expect(pos.length).toBe(2 * 6 * 3);
    for (let i = 1; i < pos.length; i += 3) expect(pos[i]).toBe(0.01);
  });

  it("has the requested width on a diagonal line", () => {
    const pos = strip(
      [
        { x: 0, z: 0 },
        { x: 10, z: 10 },
      ],
      0.15,
      0,
    );
    const sides = new Set<number>();
    // Each vertex lies half the width away from the center line x = z.
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i] - pos[i + 2]) / Math.SQRT2).toBeCloseTo(0.075, 6);
      sides.add(Math.sign(pos[i] - pos[i + 2]));
    }
    expect(sides).toEqual(new Set([-1, 1])); // both edges are present
  });
});
