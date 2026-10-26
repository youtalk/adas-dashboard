import { describe, it, expect } from "vitest";
import { viewportScale } from "./hud";

describe("viewportScale", () => {
  it("is 1 at the 1080 px booth monitor and follows the viewport height", () => {
    expect(viewportScale(1080)).toBe(1);
    expect(viewportScale(720)).toBeCloseTo(2 / 3);
    expect(viewportScale(2160)).toBe(2);
  });

  it("multiplies by ui_scale", () => {
    expect(viewportScale(1080, 2)).toBe(2);
    expect(viewportScale(720, 1.5)).toBeCloseTo(1);
  });
});
