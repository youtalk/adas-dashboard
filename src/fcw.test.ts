import { describe, it, expect } from "vitest";
import { Fcw, FCW_ALERT, FCW_DEFAULT_TTC_S, leadDistance, nextWarn, withPageFcw } from "./fcw";

// One sample every 100 ms, like VisionPilot at 10 Hz.
const feed = (f: Fcw, ds: (number | null)[], ego: number, t0 = 1000) =>
  ds.map((d, i) => f.update(t0 + i * 100, d, ego));
const n = <T>(k: number, g: (i: number) => T) => Array.from({ length: k }, (_, i) => g(i));

describe("Fcw", () => {
  it("measures the closing speed from the distance change", () => {
    const s = feed(
      new Fcw(),
      n(15, (i) => 40 - 0.65 * i),
      12,
    );
    expect(s.at(-1)!.ttcS).toBeCloseTo((40 - 0.65 * 14) / 6.5, 1);
    expect(s.at(-1)!.warn).toBe(false);
  });
  it("warns once the TTC falls below the threshold", () => {
    const s = feed(
      new Fcw(),
      n(40, (i) => 40 - 0.65 * i),
      12,
    );
    expect(s.findIndex((x) => x.warn)).toBe(32); // 40 - 0.65 * 32 = 19.2 m, TTC 2.95 s
  });
  it("gives no warning during steady following with noise", () => {
    const s = feed(
      new Fcw(),
      n(50, (i) => 28 + 0.3 * Math.sin(1.7 * i)),
      13.9,
    );
    expect(s.every((x) => !x.warn && (x.ttcS === null || x.ttcS > 4))).toBe(true);
  });
  it("gives no TTC for an opening gap", () => {
    expect(
      feed(
        new Fcw(),
        n(20, (i) => 20 + 0.5 * i),
        12,
      ).every((x) => x.ttcS === null),
    ).toBe(true);
  });
  it("treats the lead as stopped after a jump in distance", () => {
    const f = new Fcw();
    feed(
      f,
      n(15, () => 28),
      13.9,
    );
    const s = f.update(2500, 35, 13.9);
    expect(s.ttcS).toBeCloseTo(35 / 13.9, 2);
    expect(s.warn).toBe(true);
  });
  it("keeps the history over a short gap with no lead (short gap)", () => {
    const f = new Fcw();
    const s = feed(f, [...n(15, () => 28), null, null, 28, 28], 13.9);
    expect(s.every((x) => !x.warn)).toBe(true);
  });
  it("waits for a history after the old one aged out (long gap)", () => {
    const f = new Fcw();
    const s = feed(f, [...n(15, () => 28), ...n(15, () => null), 28, 28, 28, 28], 13.9);
    expect(s.every((x) => !x.warn)).toBe(true);
    expect(s.at(-4)!.ttcS).toBeNull();
  });
  it("uses the stopped-lead fallback once per jump (gap after a jump)", () => {
    const f = new Fcw();
    feed(
      f,
      n(15, () => 28),
      13.9,
    );
    // The new lead moves at ego speed. It drops out for 0.9 s and comes back.
    const s = feed(f, [...n(4, () => 35), ...n(9, () => null), ...n(3, () => 35)], 13.9, 2500);
    expect(s.slice(2).every((x) => !x.warn)).toBe(true);
  });
  it("gives no TTC below the ego speed floor", () => {
    const f = new Fcw();
    feed(
      f,
      n(5, () => 28),
      0.5,
    );
    expect(f.update(1500, 35, 0.5).ttcS).toBeNull();
  });
  it("starts over when time goes back (time going back)", () => {
    const f = new Fcw();
    feed(
      f,
      n(20, (i) => 40 - 0.65 * i),
      12,
    );
    expect(f.update(500, 30, 12).ttcS).toBeNull();
  });
  it("uses 3.0 s when no threshold is given (default threshold)", () => {
    expect(FCW_DEFAULT_TTC_S).toBe(3);
    expect(new Fcw().thresholdS).toBe(3);
  });
});

describe("nextWarn", () => {
  it("turns on below the threshold and off above threshold plus 0.3 s", () => {
    expect(nextWarn(false, 2.9, 3)).toBe(true);
    expect(nextWarn(false, 3.1, 3)).toBe(false);
    expect(nextWarn(true, 3.2, 3)).toBe(true);
    expect(nextWarn(true, 3.31, 3)).toBe(false);
    expect(nextWarn(true, null, 3)).toBe(false);
  });
});

describe("leadDistance", () => {
  const msg = (objects: object[]) => ({ type: "objects", objects });
  it("returns distance_m of the lead object", () => {
    expect(
      leadDistance(
        msg([
          { id: 1, lead: false, distance_m: 9 },
          { id: 2, lead: true, distance_m: 31.5 },
        ]),
      ),
    ).toBe(31.5);
  });
  it("returns null without a lead or without distance_m", () => {
    expect(leadDistance(msg([{ id: 1, lead: false }]))).toBeNull();
    expect(leadDistance(msg([{ id: 2, lead: true, x: 30 }]))).toBeNull();
  });
});

describe("withPageFcw", () => {
  const aeb = {
    code: "AEB",
    severity: "critical" as const,
    text: "Emergency braking",
    target: "lead",
  };
  const vpFcw = {
    code: "FCW",
    severity: "critical" as const,
    text: "Brake: vehicle ahead",
    target: "lead",
  };
  it("drops the stack FCW and adds the page FCW last", () => {
    expect(withPageFcw([vpFcw, aeb], true)).toEqual([aeb, FCW_ALERT]);
    expect(withPageFcw([vpFcw], false)).toEqual([]);
  });
});
