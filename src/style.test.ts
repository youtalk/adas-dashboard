import { describe, it, expect } from "vitest";
import { setTransparent } from "./style";

describe("setTransparent", () => {
  it("rebuilds the material program only when the flag changes", () => {
    const mat = { transparent: false, needsUpdate: false, version: 0 };
    Object.defineProperty(mat, "needsUpdate", {
      set(v: boolean) {
        if (v) mat.version++;
      },
      get: () => false,
    });
    setTransparent(mat, true);
    expect(mat.transparent).toBe(true);
    expect(mat.version).toBe(1);
    setTransparent(mat, true);
    expect(mat.version).toBe(1);
    setTransparent(mat, false);
    expect(mat.version).toBe(2);
  });
});
