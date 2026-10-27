import { describe, it, expect, beforeEach } from "vitest";
import { AlertPill, collectAlerts, type ActiveAlert } from "./alert";

// ---------------------------------------------------------------------------
// Minimal DOM element mock — no jsdom needed for pure state logic.
// ---------------------------------------------------------------------------
function mockEl() {
  return {
    hidden: false,
    dataset: {} as Record<string, string>,
    style: { opacity: "1" } as CSSStyleDeclaration,
    textContent: "",
  } as unknown as HTMLElement;
}

function makePill() {
  const el = mockEl();
  const textEl = mockEl();
  const codeEl = mockEl();
  const pill = new AlertPill(el, textEl, codeEl);
  return { pill, el, textEl, codeEl };
}

const warn: ActiveAlert = { code: "LLDW", severity: "warn", text: "Lane departure left" };
const crit: ActiveAlert = { code: "FCW", severity: "critical", text: "Brake: vehicle ahead" };

// ---------------------------------------------------------------------------
// setAlerts — activation
// ---------------------------------------------------------------------------

describe("AlertPill.setAlerts — activation", () => {
  it("stays idle when only info-level alerts arrive (filtered out)", () => {
    const { pill, el } = makePill();
    // info is not in ActiveAlert's severity union, but pass an empty array to
    // confirm the idle path.
    pill.setAlerts([]);
    expect(el.hidden).toBe(false); // hidden is false by default (not yet set)
    // Tick should not change state from idle.
    pill.tick(1.0);
    expect(el.hidden).toBe(false);
  });

  it("shows the pill when a warn alert arrives", () => {
    const { pill, el, textEl, codeEl } = makePill();
    pill.setAlerts([warn]);
    expect(el.hidden).toBe(false);
    expect(el.dataset.severity).toBe("warn");
    expect(textEl.textContent).toBe("Lane departure left");
    expect(codeEl.textContent).toBe("LLDW");
  });

  it("shows the pill when a critical alert arrives", () => {
    const { pill, el } = makePill();
    pill.setAlerts([crit]);
    expect(el.dataset.severity).toBe("critical");
  });

  it("prefers critical over warn when both are present", () => {
    const { pill, el, textEl } = makePill();
    pill.setAlerts([warn, crit]);
    expect(el.dataset.severity).toBe("critical");
    expect(textEl.textContent).toBe(crit.text);
  });
});

// ---------------------------------------------------------------------------
// setAlerts — hold and clear
// ---------------------------------------------------------------------------

describe("AlertPill.setAlerts — hold and clear", () => {
  it("clears after 500 ms hold when alert list becomes empty", () => {
    const { pill, el } = makePill();
    pill.setAlerts([warn]);
    pill.setAlerts([]); // triggers hold
    pill.tick(0.25); // half of hold period
    expect(el.hidden).toBe(false); // still visible during hold
    pill.tick(0.26); // total > 0.5 s
    expect(el.hidden).toBe(true);
  });

  it("does not start hold when already idle", () => {
    const { pill, el } = makePill();
    el.hidden = true;
    pill.setAlerts([]); // idle → calling clear from idle should do nothing
    pill.tick(1.0);
    expect(el.hidden).toBe(true); // unchanged
  });

  it("resumes active if a new alert arrives during hold", () => {
    const { pill, el } = makePill();
    pill.setAlerts([warn]);
    pill.setAlerts([]); // start hold
    pill.tick(0.1);
    pill.setAlerts([crit]); // new alert arrives before hold ends
    expect(el.dataset.severity).toBe("critical");
    expect(el.hidden).toBe(false);
    // Now after 500 ms without alerts it should clear
    pill.setAlerts([]);
    pill.tick(0.51);
    expect(el.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tick — critical pulse
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// held list and reset
// ---------------------------------------------------------------------------

describe("AlertPill.held and reset", () => {
  it("held returns active alerts while active", () => {
    const { pill } = makePill();
    pill.setAlerts([warn, crit]);
    expect(pill.held.length).toBe(2);
  });

  it("held returns held alerts while holding (500 ms hold not yet expired)", () => {
    const { pill } = makePill();
    pill.setAlerts([warn]);
    pill.setAlerts([]); // trigger hold
    pill.tick(0.1);
    expect(pill.held.length).toBe(1);
    expect(pill.held[0].code).toBe("LLDW");
  });

  it("held returns empty after hold expires", () => {
    const { pill } = makePill();
    pill.setAlerts([warn]);
    pill.setAlerts([]);
    pill.tick(0.51);
    expect(pill.held).toEqual([]);
  });

  it("reset sets pill to idle and clears held", () => {
    const { pill, el } = makePill();
    pill.setAlerts([crit]);
    pill.reset();
    expect(pill.held).toEqual([]);
    expect(el.hidden).toBe(true);
  });
});

describe("AlertPill.tick — critical pulse", () => {
  it("critical alert pulses opacity between 0.3 and 1.0 over time", () => {
    const { pill, el } = makePill();
    pill.setAlerts([crit]);
    // At t=0 sin(0)=0, so opacity = 0.3+0.7*0.5 = 0.65
    pill.tick(0);
    const opacity0 = parseFloat(el.style.opacity);
    pill.tick(0.25); // quarter period → sin(π/2)=1 → opacity=1.0
    const opacity1 = parseFloat(el.style.opacity);
    expect(opacity1).toBeGreaterThan(opacity0);
    expect(opacity1).toBeCloseTo(1.0, 1);
  });

  it("warn alert holds opacity at 1.0 (no pulse)", () => {
    const { pill, el } = makePill();
    pill.setAlerts([warn]);
    pill.tick(0.5);
    expect(parseFloat(el.style.opacity)).toBeCloseTo(1.0, 5);
  });
});

describe("collectAlerts", () => {
  it("unions the lists of every message and drops info", () => {
    const got = collectAlerts([
      {
        type: "alerts",
        alerts: [{ code: "FCW", severity: "critical", text: "Brake", target: "lead" }],
      },
      { type: "alerts", alerts: [{ code: "SI", severity: "info", text: "standby" }] },
      { type: "alerts", alerts: [{ code: "LLDW", severity: "warn", text: "Lane" }] },
    ]);
    expect(got.map((a) => a.code)).toEqual(["FCW", "LLDW"]);
    expect(got[0].target).toBe("lead");
  });

  it("treats a message without a list as empty", () => {
    expect(collectAlerts([{ type: "alerts" }])).toEqual([]);
  });
});

describe("AlertPill.setBanner", () => {
  it("shows the banner over an active alert and returns to the alert after", () => {
    const { pill, el, textEl } = makePill();
    pill.setAlerts([crit]);
    pill.setBanner({ text: "VisionPilot lost", kind: "lost" });
    expect(el.dataset.severity).toBe("lost");
    expect(textEl.textContent).toBe("VisionPilot lost");
    pill.setAlerts([crit]); // alerts keep arriving under the banner
    expect(textEl.textContent).toBe("VisionPilot lost");
    pill.setBanner(null);
    expect(el.dataset.severity).toBe("critical");
    expect(textEl.textContent).toBe(crit.text);
  });

  it("hides the pill when the banner ends and no alert is held", () => {
    const { pill, el } = makePill();
    pill.setBanner({ text: "Stopped by Safety Island", kind: "takeover" });
    expect(el.hidden).toBe(false);
    pill.setBanner(null);
    expect(el.hidden).toBe(true);
  });

  it("does not pulse and applies the banner opacity", () => {
    const { pill, el, codeEl } = makePill();
    pill.setAlerts([crit]);
    pill.setBanner({ text: "x", code: "SI_STOP", kind: "takeover", opacity: 0.4 });
    pill.tick(0.25);
    expect(parseFloat(el.style.opacity)).toBeCloseTo(0.4, 5);
    expect(codeEl.textContent).toBe("SI_STOP");
  });

  it("pulses the Stack lost banner like a critical alert, with no alert held", () => {
    const { pill, el } = makePill();
    const lost = { text: "VisionPilot lost", kind: "lost" } as const;
    pill.setBanner(lost);
    pill.tick(0.75); // three quarters of a period → sin=-1 → opacity 0.3
    expect(parseFloat(el.style.opacity)).toBeCloseTo(0.3, 5);
    pill.setBanner(lost); // main.ts sets the banner on every frame
    pill.tick(0.25); // one full period → sin=0 → opacity 0.65
    expect(parseFloat(el.style.opacity)).toBeCloseTo(0.65, 5);
  });

  it("starts the Stack lost pulse from its first phase, like a new critical alert", () => {
    const { pill, el } = makePill();
    pill.setAlerts([crit]);
    pill.tick(0.75); // the critical pulse is at its dimmest
    pill.setBanner({ text: "VisionPilot lost", kind: "lost" });
    pill.tick(0);
    expect(parseFloat(el.style.opacity)).toBeCloseTo(0.65, 5);
  });

  it("keeps the hold timing of the alerts under a banner", () => {
    const { pill, el } = makePill();
    pill.setAlerts([warn]);
    pill.setBanner({ text: "x", kind: "lost" });
    pill.setAlerts([]);
    pill.tick(0.51);
    expect(pill.held).toEqual([]);
    expect(el.hidden).toBe(false); // the banner is still up
    pill.setBanner(null);
    expect(el.hidden).toBe(true);
  });
});
