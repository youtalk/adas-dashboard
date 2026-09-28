import type { PerspectiveCamera } from "three";
import type { CameraPreset } from "./config";
import { headingFromYaw } from "./frames";

type Presets = { chase: CameraPreset; high: CameraPreset };

export type CameraController = {
  update: (egoX: number, egoY: number, egoZ: number, yaw: number) => void;
  dispose: () => void;
};

// Creates a chase-camera controller driven by ego pose.
// Keys 1 and 2 switch between the chase and high presets (design section 7).
export function createCameraController(
  camera: PerspectiveCamera,
  presets: Presets,
): CameraController {
  let active: CameraPreset = presets.chase;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "1") active = presets.chase;
    else if (e.key === "2") active = presets.high;
  }
  window.addEventListener("keydown", onKeyDown);

  function update(egoX: number, egoY: number, egoZ: number, yaw: number) {
    const { pitch_deg, distance_m, lookahead_m } = active;
    const pitchRad = pitch_deg * (Math.PI / 180);
    const back = distance_m * Math.cos(pitchRad);
    const up = distance_m * Math.sin(pitchRad);
    const h = headingFromYaw(yaw);

    camera.position.set(egoX - h.x * back, egoY + up, egoZ - h.z * back);
    camera.lookAt(egoX + h.x * lookahead_m, egoY, egoZ + h.z * lookahead_m);
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
  }

  return { update, dispose };
}
