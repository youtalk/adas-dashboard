// Schema §5.2: severity is "info", "warn" or "critical".
// The pill shows only warn/critical (info is silent).
export type AlertSeverity = "warn" | "critical";

export type ActiveAlert = {
  code: string;
  severity: AlertSeverity;
  text: string;
  target?: string;
};

type RawAlertEntry = { code: string; severity: string; text: string; target?: string };

// Union of the warn and critical alerts in a set of alerts messages (design section 4).
export function collectAlerts(msgs: Record<string, unknown>[]): ActiveAlert[] {
  return msgs
    .flatMap((m) => (m.alerts as RawAlertEntry[] | undefined) ?? [])
    .filter((a) => a.severity === "warn" || a.severity === "critical")
    .map((a) => ({
      code: a.code,
      severity: a.severity as AlertSeverity,
      text: a.text,
      target: a.target,
    }));
}

// A state message that replaces the alert text (design section 6.3): "lost" for
// Stack lost, "takeover" for Takeover and Stopped.
export type Banner = { text: string; code?: string; kind: "lost" | "takeover"; opacity?: number };

type PillState = "idle" | "active" | "holding";

const HOLD_S = 0.5;

export class AlertPill {
  private el: HTMLElement;
  private textEl: HTMLElement;
  private codeEl: HTMLElement;
  private pillState: PillState = "idle";
  private severity: AlertSeverity = "warn";
  private holdTimer = 0;
  private pulseTime = 0;
  private heldAlerts: ActiveAlert[] = [];
  private top: ActiveAlert | null = null;
  private banner: Banner | null = null;

  constructor(
    el: HTMLElement = document.getElementById("alert-pill") as HTMLElement,
    textEl: HTMLElement = document.getElementById("alert-pill-text") as HTMLElement,
    codeEl: HTMLElement = document.getElementById("alert-pill-code") as HTMLElement,
  ) {
    this.el = el;
    this.textEl = textEl;
    this.codeEl = codeEl;
  }

  // Show the highest-severity alert from the active list.
  // Call with an empty array to clear.
  setAlerts(alerts: ActiveAlert[]): void {
    const visible = alerts.filter((a) => a.severity === "critical" || a.severity === "warn");
    if (visible.length === 0) {
      this.startHold();
      return;
    }

    // Pick the highest severity to display.
    const top = visible.find((a) => a.severity === "critical") ?? visible[0];

    if (this.pillState !== "active" || this.severity !== top.severity) {
      this.pulseTime = 0;
    }
    this.pillState = "active";
    this.holdTimer = 0;
    this.severity = top.severity;
    this.heldAlerts = visible;
    this.top = top;
    if (!this.banner) this.showTop();
  }

  // Show a state message instead of the alerts, or null to go back to them.
  // The alert list keeps its hold timing underneath.
  setBanner(banner: Banner | null): void {
    const had = this.banner !== null;
    this.banner = banner;
    if (banner) {
      this.textEl.textContent = banner.text;
      this.codeEl.textContent = banner.code ?? "";
      this.el.dataset.severity = banner.kind;
      this.el.hidden = false;
      this.el.style.opacity = String(banner.opacity ?? 1);
    } else if (had) {
      if (this.pillState === "idle") this.hide();
      else this.showTop();
    }
  }

  // Currently held alert list (non-empty while active or holding, empty when idle).
  // Use this in main.ts for target dispatching so targets also hold for 500 ms.
  get held(): ActiveAlert[] {
    return this.heldAlerts;
  }

  // Reset to idle immediately (call on stack reconnect and on key r).
  reset(): void {
    this.pillState = "idle";
    this.heldAlerts = [];
    this.top = null;
    this.holdTimer = 0;
    if (!this.banner) this.hide();
  }

  private showTop(): void {
    if (!this.top) return;
    this.textEl.textContent = this.top.text;
    this.codeEl.textContent = this.top.code;
    this.el.dataset.severity = this.top.severity;
    this.el.hidden = false;
    this.el.style.opacity = "1";
  }

  private hide(): void {
    this.el.hidden = true;
    this.el.style.opacity = "1";
  }

  private startHold(): void {
    if (this.pillState === "active") {
      this.pillState = "holding";
      this.holdTimer = 0;
      if (!this.banner) this.el.style.opacity = "1";
    }
  }

  tick(dt: number): void {
    if (this.pillState === "idle") return;

    if (this.pillState === "holding") {
      this.holdTimer += dt;
      if (this.holdTimer >= HOLD_S) {
        this.pillState = "idle";
        this.heldAlerts = [];
        this.top = null;
        if (!this.banner) this.hide();
      }
      return;
    }

    // A banner is steady; the pulse belongs to the Alert state only.
    if (this.banner) return;

    // Active with critical severity: 1 Hz sine pulse (opacity 0.3 → 1.0).
    if (this.severity === "critical") {
      this.pulseTime += dt;
      const t = 0.5 + 0.5 * Math.sin(2 * Math.PI * this.pulseTime);
      this.el.style.opacity = String(0.3 + 0.7 * t);
    } else {
      this.el.style.opacity = "1";
    }
  }
}
