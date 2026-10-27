import { describe, it, expect } from "vitest";
import stackJsonl from "../recordings/ces2027-kill-route/stack.jsonl?raw";
import worldJsonl from "../recordings/ces2027-kill-route/world.jsonl?raw";
import { isWellFormed } from "./messages";

// One good message of each known type, with only the required fields.
const good: Record<string, Record<string, unknown>> = {
  ego: { source: "t", type: "ego", t_ms: 1, speed_mps: 3 },
  map: { source: "t", type: "map", t_ms: 1, frame: "map", features: [] },
  objects: { source: "t", type: "objects", t_ms: 1, frame: "ego", objects: [] },
  lanes: { source: "t", type: "lanes", t_ms: 1, frame: "ego", lanes: [] },
  trajectory: { source: "t", type: "trajectory", t_ms: 1, frame: "ego", pts: [] },
  alerts: { source: "t", type: "alerts", t_ms: 1, alerts: [] },
  control: { source: "t", type: "control", t_ms: 1, authority: "stack" },
  status: { source: "t", type: "status", t_ms: 1, name: "VisionPilot", mode: "active" },
};
const types = Object.keys(good);

describe("isWellFormed", () => {
  it.each(types)("accepts a good %s message", (type) => {
    expect(isWellFormed(good[type])).toBe(true);
  });

  it.each(types)("drops a %s message without a numeric t_ms", (type) => {
    expect(isWellFormed({ ...good[type], t_ms: undefined })).toBe(false);
    expect(isWellFormed({ ...good[type], t_ms: "1" })).toBe(false);
  });

  it.each([
    ["map", "features"],
    ["objects", "objects"],
    ["lanes", "lanes"],
    ["trajectory", "pts"],
    ["alerts", "alerts"],
  ])("drops a %s message whose %s is not an array", (type, field) => {
    for (const bad of [undefined, null, {}, "x"]) {
      expect(isWellFormed({ ...good[type], [field]: bad })).toBe(false);
    }
  });

  it("drops an ego message whose speed_mps is not a number", () => {
    for (const bad of [undefined, null, "3"]) {
      expect(isWellFormed({ ...good.ego, speed_mps: bad })).toBe(false);
    }
  });

  it("passes an unknown type", () => {
    expect(isWellFormed({ type: "signals" })).toBe(true);
  });

  it("accepts every message of the kill route recording", () => {
    const msgs = `${stackJsonl}\n${worldJsonl}`
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(msgs.filter((m) => !isWellFormed(m))).toEqual([]);
  });
});
