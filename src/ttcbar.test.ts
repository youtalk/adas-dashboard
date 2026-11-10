import { describe, it, expect } from "vitest";
import { ttcBarView } from "./ttcbar";

describe("ttcBarView", () => {
  it("hides without a TTC or at 4 s and more", () => {
    expect(ttcBarView(null, 3, false).visible).toBe(false);
    expect(ttcBarView(4, 3, false).visible).toBe(false);
  });
  it("places the marker and the warning zone on a 0 to 4 s scale", () => {
    expect(ttcBarView(2.1, 3, false)).toEqual({
      visible: true,
      aeb: false,
      markFrac: 0.525,
      warnFrac: 0.75,
      label: "TTC 2.1 s",
    });
    expect(ttcBarView(2.1, 6, false).warnFrac).toBe(1);
  });
  it("shows a red bar during AEB even without a TTC", () => {
    expect(ttcBarView(null, 3, true)).toEqual({
      visible: true,
      aeb: true,
      markFrac: 0,
      warnFrac: 0.75,
      label: "",
    });
  });
});
