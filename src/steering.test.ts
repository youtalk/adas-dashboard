import { describe, expect, it } from "vitest";
import { wheelIconDeg } from "./hud";

describe("wheelIconDeg", () => {
  it("turns the wheel icon by the road wheel angle times the steering ratio", () => {
    // 0.1 rad at the road wheels is about 86 degrees at the steering wheel.
    // CSS rotate() is clockwise positive, so a left turn is negative.
    expect(wheelIconDeg(0.1)).toBeCloseTo(-85.9, 1);
    expect(wheelIconDeg(-0.1)).toBeCloseTo(85.9, 1);
    expect(wheelIconDeg(0)).toBeCloseTo(0);
  });
});
