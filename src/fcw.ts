import type { ActiveAlert } from "./alert";

// The page's own forward collision warning (design section 4): time to
// collision (TTC) to the lead vehicle, from the stack's lead distance_m and the
// ego speed. VisionPilot's own FCW is a braking label, not an early warning.

export const FCW_DEFAULT_TTC_S = 3.0;
export const TTC_BAR_MAX_S = 4;

// First values. The desktop traces set them (design section 7).
const WINDOW_S = 1.0; // distance history for the closing speed
const MIN_SAMPLES = 3; // samples before the slope counts
const JUMP_M = 6; // a larger distance step is a different object
const MIN_EGO_MPS = 1.0;
const MIN_CLOSING_MPS = 0.1;
const HYST_S = 0.3; // the warning ends at threshold + HYST_S

export type FcwState = { ttcS: number | null; warn: boolean };

export const FCW_ALERT: ActiveAlert = {
  code: "FCW",
  severity: "critical",
  text: "Brake: vehicle ahead",
  target: "lead",
};

export function nextWarn(prev: boolean, ttcS: number | null, thresholdS: number): boolean {
  if (ttcS === null) return false;
  return prev ? ttcS <= thresholdS + HYST_S : ttcS < thresholdS;
}

// distance_m of the object marked lead in a stack objects message, or null.
export function leadDistance(objectsMsg: Record<string, unknown>): number | null {
  const objs = objectsMsg.objects as { lead?: boolean; distance_m?: unknown }[] | undefined;
  const d = objs?.find((o) => o.lead === true)?.distance_m;
  return typeof d === "number" ? d : null;
}

// The stack's FCW is a braking label, so the page's own warning replaces it.
export function withPageFcw(alerts: ActiveAlert[], warn: boolean): ActiveAlert[] {
  const rest = alerts.filter((a) => a.code !== "FCW");
  return warn ? [...rest, FCW_ALERT] : rest;
}

export class Fcw {
  private samples: { t: number; d: number }[] = [];
  private newObject = false;
  private last: FcwState = { ttcS: null, warn: false };

  constructor(public thresholdS = FCW_DEFAULT_TTC_S) {}

  get state(): FcwState {
    return this.last;
  }

  reset(): void {
    this.samples = [];
    this.newObject = false;
    this.last = { ttcS: null, warn: false };
  }

  // tMs is the stack clock. Never pass a vehicle time.
  update(tMs: number, leadDistM: number | null, egoMps: number): FcwState {
    const prev = this.samples.at(-1);
    if (prev && tMs <= prev.t) this.reset();
    if (leadDistM === null) return (this.last = { ttcS: null, warn: false });

    this.samples = this.samples.filter((s) => tMs - s.t <= WINDOW_S * 1000);
    const kept = this.samples.at(-1);
    if (!kept) this.newObject = false;
    else if (Math.abs(leadDistM - kept.d) > JUMP_M) {
      // A different object, for example a stopped car after a cut-out.
      // Until a history builds up, treat it as stopped.
      this.samples = [];
      this.newObject = true;
    }
    this.samples.push({ t: tMs, d: leadDistM });

    let closing: number | null;
    if (this.samples.length >= MIN_SAMPLES) {
      closing = -slope(this.samples);
      this.newObject = false; // the fallback is for the first frames after a jump only
    } else closing = this.newObject ? egoMps : null;

    const ttcS =
      closing === null || egoMps < MIN_EGO_MPS || closing < MIN_CLOSING_MPS
        ? null
        : leadDistM / closing;
    return (this.last = { ttcS, warn: nextWarn(this.last.warn, ttcS, this.thresholdS) });
  }
}

// Least-squares slope of distance over time, in m/s.
function slope(s: { t: number; d: number }[]): number {
  const tm = s.reduce((a, p) => a + p.t, 0) / s.length;
  const dm = s.reduce((a, p) => a + p.d, 0) / s.length;
  let num = 0;
  let den = 0;
  for (const p of s) {
    num += (p.t - tm) * (p.d - dm);
    den += (p.t - tm) ** 2;
  }
  return (num / den) * 1000;
}
