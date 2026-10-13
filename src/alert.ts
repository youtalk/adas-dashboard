// Schema §5.2: severity is "info", "warn" or "critical".
// The pill shows only warn/critical (info is silent).
export type AlertSeverity = "warn" | "critical";

export type ActiveAlert = {
  code: string;
  severity: AlertSeverity;
  text: string;
  target?: string;
};

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

    this.textEl.textContent = top.text;
    this.codeEl.textContent = top.code;
    this.el.dataset.severity = top.severity;
    this.el.hidden = false;
    this.el.style.opacity = "1";
  }

  private startHold(): void {
    if (this.pillState === "active") {
      this.pillState = "holding";
      this.holdTimer = 0;
      this.el.style.opacity = "1";
    }
  }

  tick(dt: number): void {
    if (this.pillState === "idle") return;

    if (this.pillState === "holding") {
      this.holdTimer += dt;
      if (this.holdTimer >= HOLD_S) {
        this.pillState = "idle";
        this.el.hidden = true;
        this.el.style.opacity = "1";
      }
      return;
    }

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
