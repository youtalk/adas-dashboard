import { describe, it, expect } from "vitest";
import { StateMachine, isGhost, type StateInputs } from "./states";

const DT = 1 / 60;

const driving: StateInputs = {
  anyHello: true,
  stackSeen: true,
  stackAlive: true,
  authority: "stack",
  alertActive: false,
  speedMps: 12,
};

// Run the machine for `seconds` with fixed inputs and return the last state.
function run(m: StateMachine, i: StateInputs, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += DT) m.update(i, DT);
  return m.state;
}

describe("StateMachine", () => {
  it("is Connecting until an endpoint sends hello", () => {
    const m = new StateMachine();
    expect(m.update({ ...driving, anyHello: false }, DT)).toBe("connecting");
    expect(m.update(driving, DT)).toBe("driving");
  });

  it("stays Connecting until a stack endpoint says hello", () => {
    // The world endpoint is up first (CARLA before the board): not Stack lost.
    const m = new StateMachine();
    const worldOnly = { ...driving, stackSeen: false, stackAlive: false };
    expect(m.update(worldOnly, DT)).toBe("connecting");
    expect(m.update({ ...worldOnly, authority: "supervisor", speedMps: 0 }, DT)).toBe("connecting");
    expect(m.update(driving, DT)).toBe("driving");
  });

  it("is Stack lost once a stack that connected has closed", () => {
    const m = new StateMachine();
    m.update(driving, DT);
    expect(m.update({ ...driving, stackAlive: false }, DT)).toBe("stack_lost");
  });

  it("is Alert while a warn or critical alert is shown", () => {
    const m = new StateMachine();
    expect(m.update({ ...driving, alertActive: true }, DT)).toBe("alert");
    expect(m.update(driving, DT)).toBe("driving");
  });

  it("is Stack lost when the stack endpoint is not alive", () => {
    const m = new StateMachine();
    expect(m.update({ ...driving, stackAlive: false }, DT)).toBe("stack_lost");
  });

  it("Stack lost wins over an alert", () => {
    const m = new StateMachine();
    expect(m.update({ ...driving, stackAlive: false, alertActive: true }, DT)).toBe("stack_lost");
  });

  it("is Takeover when another authority has control", () => {
    for (const authority of ["supervisor", "driver", "remote"]) {
      const m = new StateMachine();
      expect(m.update({ ...driving, stackAlive: false, authority }, DT)).toBe("takeover");
    }
  });

  it("goes to Stopped after 1 s below 0.1 m/s in Takeover", () => {
    const m = new StateMachine();
    const halted = { ...driving, stackAlive: false, authority: "supervisor", speedMps: 0.05 };
    expect(run(m, halted, 0.9)).toBe("takeover");
    expect(run(m, halted, 0.2)).toBe("stopped");
  });

  it("restarts the 1 s count when the speed rises again", () => {
    const m = new StateMachine();
    const halted = { ...driving, stackAlive: false, authority: "supervisor", speedMps: 0 };
    run(m, halted, 0.8);
    m.update({ ...halted, speedMps: 0.5 }, DT);
    expect(run(m, halted, 0.8)).toBe("takeover");
  });

  it("does not stop without vehicle data", () => {
    const m = new StateMachine();
    const blind = { ...driving, stackAlive: false, authority: "supervisor", speedMps: null };
    expect(run(m, blind, 2)).toBe("takeover");
  });

  it("holds Stopped until the stack reports active, whatever the inputs", () => {
    const m = new StateMachine();
    run(m, { ...driving, authority: "supervisor", speedMps: 0 }, 1.1);
    expect(m.state).toBe("stopped");
    expect(run(m, driving, 5)).toBe("stopped");
    expect(m.releaseFade).toBe(0);
  });

  it("fades back to Driving over 1 s once the stack reports active", () => {
    const m = new StateMachine();
    run(m, { ...driving, authority: "supervisor", speedMps: 0 }, 1.1);
    m.stackActive();
    expect(m.update(driving, DT)).toBe("driving");
    expect(m.releaseFade).toBeGreaterThan(0.9);
    run(m, driving, 0.5);
    expect(m.releaseFade).toBeCloseTo(0.5, 1);
    run(m, driving, 0.6);
    expect(m.releaseFade).toBe(0);
  });

  it("stackActive outside Stopped does nothing", () => {
    const m = new StateMachine();
    m.stackActive();
    m.update(driving, DT);
    expect(m.releaseFade).toBe(0);
  });

  it("reset clears Stopped at once, with no fade", () => {
    const m = new StateMachine();
    run(m, { ...driving, authority: "supervisor", speedMps: 0 }, 1.1);
    m.reset();
    expect(m.update({ ...driving, stackAlive: false }, DT)).toBe("stack_lost");
    expect(m.releaseFade).toBe(0);
  });
});

describe("isGhost", () => {
  it("ghosts the stack layers in Stack lost, Takeover and Stopped only", () => {
    expect(isGhost("stack_lost")).toBe(true);
    expect(isGhost("takeover")).toBe(true);
    expect(isGhost("stopped")).toBe(true);
    expect(isGhost("connecting")).toBe(false);
    expect(isGhost("driving")).toBe(false);
    expect(isGhost("alert")).toBe(false);
  });
});
