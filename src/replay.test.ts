// Replay smoke test (design sections 8 and 14): play the kill route recording
// through the page's store and state machine, the way tools/replay.py serves it
// without --loop, and check that all six states of section 6.3 are reached.
import { describe, it, expect } from "vitest";
import stackJsonl from "../recordings/ces2027-kill-route/stack.jsonl?raw";
import worldJsonl from "../recordings/ces2027-kill-route/world.jsonl?raw";
import { setRoles, recordMessage, closeEndpoint, allByRole, hasRole, latestByRole } from "./state";
import { collectAlerts } from "./alert";
import { Fcw, leadDistance, withPageFcw } from "./fcw";
import { StateMachine, isGhost, readInputs, type PageState } from "./states";

type Msg = Record<string, unknown> & { type: string; t_ms: number };
type Event = { at: number; endpoint: string; kind: "hello" | "msg" | "close"; msg?: Msg };

const DT = 1 / 60;

// Like replay.py: hello at connect, the playback clock starts at the message
// after hello, and the endpoint closes once its file has played out.
function schedule(endpoint: string, jsonl: string): Event[] {
  const msgs = jsonl
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Msg);
  const t0 = msgs[1].t_ms;
  const events: Event[] = [{ at: 0, endpoint, kind: "hello", msg: msgs[0] }];
  for (const msg of msgs.slice(1))
    events.push({ at: (msg.t_ms - t0) / 1000, endpoint, kind: "msg", msg });
  events.push({ at: events[events.length - 1].at, endpoint, kind: "close" });
  return events;
}

// The page's message handling from main.ts, without the DOM. The state rules
// themselves live in states.ts and are shared with main.ts.
function deliver(m: StateMachine, fcw: Fcw, e: Event) {
  if (e.kind === "hello") {
    const hello = e.msg as unknown as { roles: string[]; name: string };
    if (hello.roles.includes("stack")) fcw.reset();
    setRoles(e.endpoint, hello.roles, hello.name);
  } else if (e.kind === "msg") {
    recordMessage(e.endpoint, e.msg!);
    m.onMessage(e.endpoint, e.msg!);
    feedFcw(fcw, m.state, e.endpoint, e.msg!);
  } else {
    closeEndpoint(e.endpoint);
  }
}

// Same as onMessage in main.ts.
function feedFcw(fcw: Fcw, state: PageState, endpoint: string, msg: Msg) {
  if (msg.type !== "objects" || !hasRole(endpoint, "stack") || isGhost(state)) return;
  const ego = latestByRole("vehicle", "ego") as { speed_mps?: number } | undefined;
  fcw.update(msg.t_ms, leadDistance(msg), ego?.speed_mps ?? 0);
}

function step(m: StateMachine, fcw: Fcw): PageState {
  const alerts = withPageFcw(
    collectAlerts([...allByRole("stack", "alerts"), ...allByRole("supervisor", "alerts")]),
    fcw.state.warn,
  );
  const s = m.update(readInputs(alerts.length > 0), DT);
  if (isGhost(s)) fcw.reset();
  return s;
}

describe("replay of the kill route", () => {
  it("plays through Connecting, Driving, Alert, Stack lost, Takeover and Stopped", () => {
    const m = new StateMachine();
    const fcw = new Fcw();
    const events = [...schedule("stack", stackJsonl), ...schedule("world", worldJsonl)].sort(
      (a, b) => a.at - b.at,
    );

    // Each state and the time it was first reached.
    const firstAt = new Map<PageState, number>();
    const warns: [number, boolean][] = []; // fcw.state.warn per frame
    firstAt.set(step(m, fcw), -DT); // before any endpoint has connected

    let next = 0;
    const end = events[events.length - 1].at + 2;
    for (let t = 0; t <= end; t += DT) {
      while (next < events.length && events[next].at <= t) deliver(m, fcw, events[next++]);
      const s = step(m, fcw);
      if (!firstAt.has(s)) firstAt.set(s, t);
      warns.push([t, fcw.state.warn]);
    }

    expect([...firstAt.keys()]).toEqual([
      "connecting",
      "driving",
      "alert",
      "stack_lost",
      "takeover",
      "stopped",
    ]);
    // The recording's timeline (recordings/README.md): lane departure at 12 s,
    // kill at 40 s, Safety Island takeover at 40.5 s, car stopped by 44.5 s.
    expect(firstAt.get("alert")!).toBeCloseTo(12, 0);
    expect(firstAt.get("stack_lost")!).toBeCloseTo(40, 0);
    expect(firstAt.get("takeover")!).toBeGreaterThanOrEqual(40.5);
    expect(firstAt.get("stopped")!).toBeGreaterThan(45);
    expect(firstAt.get("stopped")!).toBeLessThan(46);
    expect(m.state).toBe("stopped"); // held after both endpoints have closed

    // The page's own warning (src/fcw.ts) in place of the stack FCW.
    const firstWarnAt = warns.find(([, w]) => w)?.[0];
    const warnAt = (at: number) => warns.find(([t]) => t >= at)![1];
    const warnAfter = (at: number) => warns.some(([t, w]) => t > at && w);
    // The kill route closes from 40 m to 14 m between 20 and 24 s at 6.5 m/s, ego 12 m/s.
    // TTC < 3.0 s at 19.5 m, about 23.15 s. The gap holds at 14 m from 24 s, so the warning ends.
    expect(firstWarnAt).toBeGreaterThan(23.0);
    expect(firstWarnAt).toBeLessThan(23.4);
    expect(warnAt(25.5)).toBe(false);
    expect(warnAfter(40)).toBe(false); // no warning in Stack lost, Takeover or Stopped

    // The stack comes back (replay restarted): its first frame says active.
    const restart = schedule("stack", stackJsonl).filter((e) => e.at === 0);
    for (const e of restart) deliver(m, fcw, e);
    expect(step(m, fcw)).toBe("driving");
    expect(m.releaseFade).toBeGreaterThan(0);
    for (let t = 0; t < 1.1; t += DT) step(m, fcw);
    expect(m.releaseFade).toBe(0);
  });
});
