import { describe, it, expect } from "vitest";
import { leadLabelText, viewportScale } from "./hud";

describe("viewportScale", () => {
  it("is 1 at the 1080 px booth monitor and follows the viewport height", () => {
    expect(viewportScale(1080)).toBe(1);
    expect(viewportScale(720)).toBeCloseTo(2 / 3);
    expect(viewportScale(2160)).toBe(2);
  });
});

describe("leadLabelText", () => {
  it("shows the distance and the time gap like the status panel", () => {
    expect(leadLabelText(32.4, 2.6875)).toBe("32 m · 2.7 s");
  });

  it("leaves out the gap when there is none (ego below 0.5 m/s)", () => {
    expect(leadLabelText(14.6, null)).toBe("15 m");
  });
});
