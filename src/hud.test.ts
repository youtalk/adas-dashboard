import { describe, it, expect } from "vitest";
import { viewportScale } from "./hud";

describe("viewportScale", () => {
  it("is 1 at the 1080 px booth monitor and follows the viewport height", () => {
    expect(viewportScale(1080)).toBe(1);
    expect(viewportScale(720)).toBeCloseTo(2 / 3);
    expect(viewportScale(2160)).toBe(2);
  });
});
