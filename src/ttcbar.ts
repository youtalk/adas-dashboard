import { TTC_BAR_MAX_S } from "./fcw";

// The time to collision bar under the alert pill (design section 6.3). It runs
// from 0 to TTC_BAR_MAX_S: amber below the warning threshold, green above it,
// red during AEB.
export type TtcBarView = {
  visible: boolean;
  aeb: boolean;
  markFrac: number;
  warnFrac: number;
  label: string;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function ttcBarView(ttcS: number | null, thresholdS: number, aeb: boolean): TtcBarView {
  return {
    visible: aeb || (ttcS !== null && ttcS < TTC_BAR_MAX_S),
    aeb,
    markFrac: ttcS === null ? 0 : clamp01(ttcS / TTC_BAR_MAX_S),
    warnFrac: clamp01(thresholdS / TTC_BAR_MAX_S),
    label: ttcS === null ? "" : `TTC ${ttcS.toFixed(1)} s`,
  };
}

export class TtcBar {
  private mark: HTMLElement;
  private label: HTMLElement;

  constructor(private el: HTMLElement = document.getElementById("ttc-bar") as HTMLElement) {
    this.mark = el.querySelector(".ttc-mark") as HTMLElement;
    this.label = el.querySelector(".ttc-label") as HTMLElement;
  }

  show(v: TtcBarView): void {
    this.el.hidden = !v.visible;
    if (!v.visible) return;
    this.el.dataset.aeb = String(v.aeb);
    this.el.style.setProperty("--mark-frac", String(v.markFrac));
    this.el.style.setProperty("--warn-frac", String(v.warnFrac));
    // No TTC, for example at a stop during AEB: no marker at 0 s.
    this.mark.hidden = v.label === "";
    this.label.textContent = v.label;
  }
}
