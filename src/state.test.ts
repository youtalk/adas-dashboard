import { describe, it, expect, beforeEach } from "vitest";
import {
  setRoles,
  recordMessage,
  closeEndpoint,
  allByRole,
  latestByRole,
  newestOfType,
  stackAlive,
  roleLost,
  roleName,
  clearType,
} from "./state";

// state.ts uses a module-level Map; reset between tests by re-registering endpoints.

describe("allByRole", () => {
  it("returns the latest message from an open endpoint with the matching role", () => {
    setRoles("ep1", ["stack"]);
    recordMessage("ep1", { type: "alerts", alerts: [{ code: "FCW" }] });
    const results = allByRole("stack", "alerts");
    expect(results.length).toBe(1);
    expect((results[0] as { alerts: { code: string }[] }).alerts[0].code).toBe("FCW");
  });

  it("skips a closed endpoint", () => {
    setRoles("ep2", ["stack"]);
    recordMessage("ep2", { type: "alerts", alerts: [{ code: "LLDW" }] });
    closeEndpoint("ep2");
    const results = allByRole("stack", "alerts");
    // ep2 is closed — its alerts must not appear.
    const codes = results.flatMap(
      (m) => (m as { alerts: { code: string }[] }).alerts?.map((a) => a.code) ?? [],
    );
    expect(codes).not.toContain("LLDW");
  });

  it("returns an empty array when no endpoints carry the role", () => {
    setRoles("ep3", ["world"]);
    recordMessage("ep3", { type: "alerts", alerts: [] });
    expect(allByRole("supervisor", "alerts")).toEqual([]);
  });
});

describe("latestByRole", () => {
  it("returns undefined when no endpoint carries the role", () => {
    expect(latestByRole("nonexistent", "ego")).toBeUndefined();
  });

  it("returns the message from a closed endpoint (ego pose held on drop)", () => {
    setRoles("vehicle", ["vehicle"]);
    recordMessage("vehicle", { type: "ego", speed_mps: 12 });
    closeEndpoint("vehicle");
    const msg = latestByRole("vehicle", "ego") as { speed_mps: number } | undefined;
    expect(msg?.speed_mps).toBe(12);
  });
});

describe("newestOfType", () => {
  it("returns the control message that arrived last, from any endpoint", () => {
    setRoles("n-stack", ["stack"]);
    setRoles("n-sup", ["supervisor"]);
    recordMessage("n-stack", { type: "control", authority: "stack" });
    recordMessage("n-sup", { type: "control", authority: "supervisor" });
    expect(newestOfType("control")?.authority).toBe("supervisor");
    recordMessage("n-stack", { type: "control", authority: "stack" });
    expect(newestOfType("control")?.authority).toBe("stack");
  });

  it("keeps a closed endpoint's last control", () => {
    setRoles("n-sup2", ["supervisor"]);
    recordMessage("n-sup2", { type: "control", authority: "supervisor" });
    closeEndpoint("n-sup2");
    expect(newestOfType("control")?.authority).toBe("supervisor");
  });
});

describe("stackAlive", () => {
  beforeEach(() => {
    // Close every stack endpoint other tests left open.
    for (const n of ["ep1", "ep2", "n-stack", "a-stack"]) closeEndpoint(n);
  });

  it("is true while a stack endpoint is open and not lost", () => {
    setRoles("a-stack", ["stack"]);
    expect(stackAlive()).toBe(true);
    recordMessage("a-stack", { type: "status", mode: "active" });
    expect(stackAlive()).toBe(true);
  });

  it("is false once the stack status says lost", () => {
    setRoles("a-stack", ["stack"]);
    recordMessage("a-stack", { type: "status", mode: "lost" });
    expect(stackAlive()).toBe(false);
  });

  it("is false once the stack endpoint closes", () => {
    setRoles("a-stack", ["stack"]);
    closeEndpoint("a-stack");
    expect(stackAlive()).toBe(false);
  });
});

describe("roleLost", () => {
  it("is false for a role no endpoint carries", () => {
    expect(roleLost("nobody")).toBe(false);
  });

  it("is true only when every endpoint carrying the role has closed", () => {
    setRoles("v1", ["telemetry"]);
    setRoles("v2", ["telemetry"]);
    closeEndpoint("v1");
    expect(roleLost("telemetry")).toBe(false);
    closeEndpoint("v2");
    expect(roleLost("telemetry")).toBe(true);
  });
});

describe("roleName", () => {
  it("prefers the status name over the hello name", () => {
    setRoles("bench", ["referee"], "CARLA bench");
    expect(roleName("referee")).toBe("CARLA bench");
    recordMessage("bench", { type: "status", name: "Safety Island" });
    expect(roleName("referee")).toBe("Safety Island");
  });
});

describe("clearType", () => {
  it("drops the latest message of a type on every endpoint", () => {
    setRoles("c1", ["judge"]);
    recordMessage("c1", { type: "verdict", v: 1 });
    clearType("verdict");
    expect(latestByRole("judge", "verdict")).toBeUndefined();
    expect(newestOfType("verdict")).toBeUndefined();
  });
});

describe("clearType on closed endpoints only", () => {
  it("keeps a live endpoint's control and drops a closed one's", () => {
    setRoles("live-sup", ["officer"]);
    setRoles("dead-sup", ["officer"]);
    recordMessage("live-sup", { type: "order", authority: "supervisor" });
    recordMessage("dead-sup", { type: "order", authority: "supervisor" });
    closeEndpoint("dead-sup");
    clearType("order", true);
    expect(allByRole("officer", "order")).toHaveLength(1); // the live one
    expect(newestOfType("order")?.authority).toBe("supervisor");
    closeEndpoint("live-sup");
    clearType("order", true);
    expect(newestOfType("order")).toBeUndefined();
  });
});
