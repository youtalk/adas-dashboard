import { describe, it, expect, afterEach } from "vitest";
import { cssHex, loadPalette, palette, parseHex, PALETTE_TOKENS, setTransparent } from "./style";

const dark = { ...palette };

afterEach(() => {
  Object.assign(palette, dark);
});

describe("parseHex", () => {
  it("parses #rrggbb and #rgb, with surrounding space", () => {
    expect(parseHex("#22d3ee")).toBe(0x22d3ee);
    expect(parseHex(" #FB923C ")).toBe(0xfb923c);
    expect(parseHex("#fff")).toBe(0xffffff);
  });

  it("rejects anything else", () => {
    expect(parseHex("")).toBeNull();
    expect(parseHex("red")).toBeNull();
    expect(parseHex("rgba(0, 0, 0, 0.5)")).toBeNull();
  });
});

describe("loadPalette", () => {
  it("defaults to the dark theme tokens of design section 6.5", () => {
    expect(palette.lane).toBe(0x22d3ee);
    expect(palette.traj).toBe(0x22c55e);
    expect(palette.traffic).toBe(0x3b82f6);
    expect(palette.lead).toBe(0xef4444);
    expect(palette.ego).toBe(0xd9d9d9);
    expect(palette.alert).toBe(0xb91c1c);
  });

  it("copies every token from the CSS custom properties", () => {
    const css: Record<string, string> = {};
    for (const token of Object.values(PALETTE_TOKENS)) css[token] = "#123456";
    loadPalette((t) => css[t] ?? "");
    for (const value of Object.values(palette)) expect(value).toBe(0x123456);
  });

  it("keeps the current value for a missing or invalid token", () => {
    loadPalette((t) => (t === "--lane" ? "#0891b2" : t === "--traj" ? "green" : ""));
    expect(palette.lane).toBe(0x0891b2);
    expect(palette.traj).toBe(0x22c55e);
    expect(palette.road).toBe(dark.road);
  });
});

describe("cssHex", () => {
  it("pads to six digits", () => {
    expect(cssHex(0x0891b2)).toBe("#0891b2");
  });
});

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
