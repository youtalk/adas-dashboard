import { describe, it, expect } from "vitest";
import { keyAction } from "./keys";

const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  keyAction({ key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("keyAction", () => {
  it("maps the six operator keys of design section 7", () => {
    expect(press("c")).toBe("pip");
    expect(press("t")).toBe("theme");
    expect(press("f")).toBe("fullscreen");
    expect(press("1")).toBe("chase");
    expect(press("2")).toBe("high");
    expect(press("r")).toBe("reset");
  });

  it("accepts upper case (Caps Lock or Shift)", () => {
    expect(press("C")).toBe("pip");
  });

  it("ignores other keys", () => {
    expect(press("x")).toBeNull();
    expect(press("Escape")).toBeNull();
  });

  it("leaves browser shortcuts and auto-repeat alone", () => {
    expect(press("r", { ctrlKey: true })).toBeNull();
    expect(press("f", { metaKey: true })).toBeNull();
    expect(press("t", { altKey: true })).toBeNull();
    expect(press("c", { repeat: true })).toBeNull();
  });
});
