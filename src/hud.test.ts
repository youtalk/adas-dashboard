import { describe, it, expect } from "vitest";
import { leadLabelText } from "./hud";

describe("leadLabelText", () => {
  it("shows the distance and the time gap like the status panel", () => {
    expect(leadLabelText(32.4, 2.6875)).toBe("32 m · 2.7 s");
  });

  it("leaves out the gap when there is none (ego below 0.5 m/s)", () => {
    expect(leadLabelText(14.6, null)).toBe("15 m");
  });
});
