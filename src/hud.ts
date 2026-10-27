export type HudData = {
  speedDisplay: number; // in display units (mph or km/h)
  units: "mph" | "km/h";
  limitDisplay: number | null; // in display units; null = field absent, hide the box
  leadDistM: number | null; // null = no lead vehicle
  leadGapS: number | null; // null = no lead or speed below threshold
  steeringRad: number; // CCW-positive (ego frame); positive = left turn
  accelMps2: number; // signed m/s²; positive = accelerating, negative = braking
  statusLine: string; // "<name> · <latency_ms> ms · <device>"
  takeover: boolean; // Takeover or Stopped: amber pedal bar and status line (design §6.4)
  speedFalling: boolean; // Takeover: down arrow next to the speed (design §6.3)
  stateLine: string | null; // supervisor line, e.g. "Safety Island braking"; null hides it
};

// Full-scale for the pedal bar (design §6.4, to be tuned in W5 on the booth monitor).
const ACCEL_FULL_SCALE = 3; // m/s²

// steer_rad is the road wheel angle. The icon is a steering wheel, which turns
// about this many times more (a typical car's steering ratio).
const STEERING_RATIO = 15;

const fmtInt = (n: number) => Math.round(n).toString();

// Scene label above the lead vehicle, e.g. "32 m · 2.7 s" (mockup 01). Same
// numbers as the status panel; gapS is null below 0.5 m/s.
export function leadLabelText(distM: number, gapS: number | null): string {
  return gapS !== null ? `${fmtInt(distM)} m · ${gapS.toFixed(1)} s` : `${fmtInt(distM)} m`;
}

export class Hud {
  private panel = document.getElementById("hud") as HTMLElement;
  private arrowEl = document.getElementById("hud-speed-arrow") as HTMLElement;
  private stateLineEl = document.getElementById("hud-state-line") as HTMLElement;
  private speedEl = document.getElementById("hud-speed")!;
  private speedUnitEl = document.getElementById("hud-speed-unit")!;
  private limitBox = document.getElementById("hud-limit-box") as HTMLElement;
  private limitEl = document.getElementById("hud-limit")!;
  private limitUnitEl = document.getElementById("hud-limit-unit")!;
  private leadDistEl = document.getElementById("hud-lead-dist")!;
  private leadGapEl = document.getElementById("hud-lead-gap")!;
  private leadRow = document.getElementById("hud-lead-row") as HTMLElement;
  private wheelEl = document.getElementById("hud-wheel") as HTMLElement;
  private accelNegEl = document.getElementById("hud-accel-neg") as HTMLElement;
  private accelPosEl = document.getElementById("hud-accel-pos") as HTMLElement;
  private statusEl = document.getElementById("hud-status")!;

  // Connecting shows nothing large (design §6.3), so the panel hides.
  setVisible(visible: boolean): void {
    this.panel.hidden = !visible;
  }

  update(d: HudData): void {
    this.speedEl.textContent = fmtInt(d.speedDisplay);
    this.speedUnitEl.textContent = d.units;
    this.arrowEl.hidden = !d.speedFalling;
    this.panel.classList.toggle("takeover", d.takeover);
    this.stateLineEl.hidden = d.stateLine === null;
    this.stateLineEl.textContent = d.stateLine ?? "";

    if (d.limitDisplay !== null) {
      this.limitBox.hidden = false;
      this.limitEl.textContent = fmtInt(d.limitDisplay);
      this.limitUnitEl.textContent = d.units;
    } else {
      this.limitBox.hidden = true;
    }

    if (d.leadDistM !== null) {
      this.leadRow.hidden = false;
      this.leadDistEl.textContent = fmtInt(d.leadDistM);
      this.leadGapEl.textContent = d.leadGapS !== null ? d.leadGapS.toFixed(1) : "--";
    } else {
      this.leadRow.hidden = true;
    }

    this.wheelEl.style.transform = `rotate(${wheelIconDeg(d.steeringRad)}deg)`;

    const pct = Math.min(1, Math.abs(d.accelMps2) / ACCEL_FULL_SCALE) * 100;
    if (d.accelMps2 >= 0) {
      this.accelPosEl.style.width = `${pct}%`;
      this.accelNegEl.style.width = "0%";
    } else {
      this.accelNegEl.style.width = `${pct}%`;
      this.accelPosEl.style.width = "0%";
    }

    this.statusEl.textContent = d.statusLine;
  }
}

// CSS rotate() angle of the wheel icon: clockwise positive, so a left turn
// (positive steer_rad) turns it counterclockwise.
export function wheelIconDeg(steerRad: number): number {
  return (-steerRad * STEERING_RATIO * 180) / Math.PI;
}
