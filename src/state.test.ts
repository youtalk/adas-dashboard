import { describe, it, expect, beforeEach } from "vitest";
import { setRoles, recordMessage, closeEndpoint, allByRole, latestByRole } from "./state";

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
