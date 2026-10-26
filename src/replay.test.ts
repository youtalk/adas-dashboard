// Replay smoke test (design sections 8 and 14): play the kill route recording
// through the page's store and state machine, the way tools/replay.py serves it
// without --loop, and check that all six states of section 6.3 are reached.
import { describe, it, expect } from "vitest";
import stackJsonl from "../recordings/ces2027-kill-route/stack.jsonl?raw";
import worldJsonl from "../recordings/ces2027-kill-route/world.jsonl?raw";
import { setRoles, recordMessage, closeEndpoint, allByRole } from "./state";
import { collectAlerts } from "./alert";
import { StateMachine, readInputs, type PageState } from "./states";

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
function deliver(m: StateMachine, e: Event) {
  if (e.kind === "hello") {
    const hello = e.msg as unknown as { roles: string[]; name: string };
    setRoles(e.endpoint, hello.roles, hello.name);
  } else if (e.kind === "msg") {
    recordMessage(e.endpoint, e.msg!);
    m.onMessage(e.endpoint, e.msg!);
  } else {
    closeEndpoint(e.endpoint);
  }
}

function step(m: StateMachine): PageState {
  const alerts = collectAlerts([
    ...allByRole("stack", "alerts"),
    ...allByRole("supervisor", "alerts"),
  ]);
  return m.update(readInputs(alerts.length > 0), DT);
}

describe("replay of the kill route", () => {
  it("plays through Connecting, Driving, Alert, Stack lost, Takeover and Stopped", () => {
    const m = new StateMachine();
    const events = [...schedule("stack", stackJsonl), ...schedule("world", worldJsonl)].sort(
      (a, b) => a.at - b.at,
    );

    // Each state and the time it was first reached.
    const firstAt = new Map<PageState, number>();
    firstAt.set(step(m), -DT); // before any endpoint has connected

    let next = 0;
    const end = events[events.length - 1].at + 2;
    for (let t = 0; t <= end; t += DT) {
      while (next < events.length && events[next].at <= t) deliver(m, events[next++]);
      const s = step(m);
      if (!firstAt.has(s)) firstAt.set(s, t);
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

    // The stack comes back (replay restarted): its first frame says active.
    const restart = schedule("stack", stackJsonl).filter((e) => e.at === 0);
    for (const e of restart) deliver(m, e);
    expect(step(m)).toBe("driving");
    expect(m.releaseFade).toBeGreaterThan(0);
    for (let t = 0; t < 1.1; t += DT) step(m);
    expect(m.releaseFade).toBe(0);
  });
});
