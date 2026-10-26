// Page states (design section 6.3). Two independent signals decide the state:
// whether the stack endpoint is alive, and who has control.authority.
import { anyHello, hasRole, latestByRole, newestOfType, roleSeen, stackAlive } from "./state";

export type PageState = "connecting" | "driving" | "alert" | "stack_lost" | "takeover" | "stopped";

export type StateInputs = {
  anyHello: boolean;
  stackSeen: boolean; // a stack endpoint has said hello at least once
  stackAlive: boolean;
  authority: string; // newest control.authority, "stack" when no control has arrived
  alertActive: boolean; // a warn or critical alert is shown (including the 500 ms hold)
  speedMps: number | null; // null when no vehicle data has arrived
};

// Takeover and below this speed for STOP_HOLD_S means Stopped.
const STOP_SPEED_MPS = 0.1;
const STOP_HOLD_S = 1;
// Stopped fades back to Driving over this time once it is released.
export const RELEASE_FADE_S = 1;

// States in which the stack layers are drawn as ghosts.
export function isGhost(state: PageState): boolean {
  return state === "stack_lost" || state === "takeover" || state === "stopped";
}

// Read the inputs from the per-endpoint store. Shared by main.ts and the replay test.
export function readInputs(alertActive: boolean): StateInputs {
  const control = newestOfType("control") as { authority?: string } | undefined;
  const ego = latestByRole("vehicle", "ego") as { speed_mps?: number } | undefined;
  return {
    anyHello: anyHello(),
    stackSeen: roleSeen("stack"),
    stackAlive: stackAlive(),
    authority: control?.authority ?? "stack",
    alertActive,
    speedMps: ego?.speed_mps ?? null,
  };
}

export class StateMachine {
  state: PageState = "connecting";
  private stopped = false;
  private activeSeen = false; // a stack "active" status arrived while Stopped
  private slowS = 0; // time spent below STOP_SPEED_MPS during Takeover
  private releaseS = 0; // time left in the fade back from Stopped

  // 1 while the Stopped look is fully on, falling to 0 over the fade back.
  get releaseFade(): number {
    return this.releaseS / RELEASE_FADE_S;
  }

  // Feed every received message. A stack status with mode "active" is one of
  // the two signals that release Stopped. Shared by main.ts and the replay test.
  onMessage(endpoint: string, msg: Record<string, unknown>): void {
    if (msg.type === "status" && msg.mode === "active" && hasRole(endpoint, "stack")) {
      this.stackActive();
    }
  }

  stackActive(): void {
    if (this.stopped) this.activeSeen = true;
  }

  // Key r: clear Stopped at once, with no fade.
  reset(): void {
    this.stopped = false;
    this.activeSeen = false;
    this.slowS = 0;
    this.releaseS = 0;
  }

  update(i: StateInputs, dt: number): PageState {
    this.releaseS = Math.max(0, this.releaseS - dt);
    this.state = this.next(i, dt);
    return this.state;
  }

  private next(i: StateInputs, dt: number): PageState {
    // A stack that has not connected yet is not lost (design section 6.3:
    // Stack lost is a closed stack endpoint), so wait for its hello.
    if (!i.anyHello || !i.stackSeen) return "connecting";
    // Stopped holds until the stack reports active and has control back. The two
    // can arrive in either order, for example the stack first and the supervisor
    // handing control back after it.
    if (this.stopped) {
      if (!this.activeSeen || i.authority !== "stack") return "stopped";
      this.stopped = false;
      this.activeSeen = false;
      this.releaseS = RELEASE_FADE_S;
    }
    // driver and remote get the same treatment as supervisor in schema 1.
    if (i.authority !== "stack") {
      this.slowS = i.speedMps !== null && i.speedMps < STOP_SPEED_MPS ? this.slowS + dt : 0;
      if (this.slowS >= STOP_HOLD_S) {
        this.stopped = true;
        this.activeSeen = false;
        this.releaseS = 0;
        return "stopped";
      }
      return "takeover";
    }
    this.slowS = 0;
    if (!i.stackAlive) return "stack_lost";
    if (i.alertActive) return "alert";
    return "driving";
  }
}
