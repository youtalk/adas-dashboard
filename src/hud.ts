export type HudData = {
  speedDisplay: number; // in display units (mph or km/h)
  units: "mph" | "km/h";
  limitDisplay: number | null; // in display units; null = field absent, hide the box
  leadDistM: number | null; // null = no lead vehicle
  leadGapS: number | null; // null = no lead or speed below threshold
  steeringRad: number; // CCW-positive (ego frame); positive = left turn
  accelMps2: number; // signed m/s²; positive = accelerating, negative = braking
  statusLine: string; // "<name> · <latency_ms> ms · <device>"
};

// Full-scale for the pedal bar (design §6.4, to be tuned in W5 on the booth monitor).
const ACCEL_FULL_SCALE = 3; // m/s²

const fmtInt = (n: number) => Math.round(n).toString();

export class Hud {
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

  update(d: HudData): void {
    this.speedEl.textContent = fmtInt(d.speedDisplay);
    this.speedUnitEl.textContent = d.units;

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

    const deg = (d.steeringRad * 180) / Math.PI;
    (this.wheelEl as HTMLElement).style.transform = `rotate(${-deg}deg)`;

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
