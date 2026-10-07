import type { PerspectiveCamera } from "three";
import type { CameraPreset } from "./config";
import { headingFromYaw } from "./frames";

type Presets = { chase: CameraPreset; high: CameraPreset };

export type CameraController = {
  update: (egoX: number, egoY: number, egoZ: number, yaw: number) => void;
  dispose: () => void;
};

const YAW_TAU = 0.3; // seconds — time constant for the exponential yaw lerp

// Creates a chase-camera controller driven by ego pose.
// Keys 1 and 2 switch between the chase and high presets (design section 7).
export function createCameraController(
  camera: PerspectiveCamera,
  presets: Presets,
): CameraController {
  let active: CameraPreset = presets.chase;
  let lerpedYaw = 0;
  let lastTime: number | null = null;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "1") active = presets.chase;
    else if (e.key === "2") active = presets.high;
  }
  window.addEventListener("keydown", onKeyDown);

  function update(egoX: number, egoY: number, egoZ: number, yaw: number) {
    const now = performance.now() / 1000;

    if (lastTime === null) {
      // First call: snap to ego yaw immediately (no lerp history).
      lerpedYaw = yaw;
    } else {
      const dt = now - lastTime;
      // Wrap angle difference to [-π, π] to avoid spinning the long way round.
      let diff = yaw - lerpedYaw;
      diff -= 2 * Math.PI * Math.round(diff / (2 * Math.PI));
      lerpedYaw += diff * (1 - Math.exp(-dt / YAW_TAU));
    }
    lastTime = now;

    const { pitch_deg, distance_m, lookahead_m } = active;
    const pitchRad = pitch_deg * (Math.PI / 180);
    const back = distance_m * Math.cos(pitchRad);
    const up = distance_m * Math.sin(pitchRad);
    const h = headingFromYaw(lerpedYaw);

    camera.position.set(egoX - h.x * back, egoY + up, egoZ - h.z * back);
    camera.lookAt(egoX + h.x * lookahead_m, egoY, egoZ + h.z * lookahead_m);
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
  }

  return { update, dispose };
}
