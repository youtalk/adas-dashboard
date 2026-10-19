import * as THREE from "three";
import { toScene } from "./frames";
import { ALERT_COLOR, STACK_LOST_FADE_S, STACK_LOST_OPACITY } from "./style";

export type RawLane = { kind: string; pts: [number, number][] };

const LANE_COLOR = 0x22d3ee; // cyan §6.5

type LaneLine = { kind: string; line: THREE.Line; capacity: number };

export class LaneManager {
  private scene: THREE.Scene;
  private lines: LaneLine[] = [];
  private rawLanes: RawLane[] = [];
  private frame: "ego" | "map" = "ego";
  private alertKinds: string[] = [];
  private lost = false;
  private opacity = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setMsg(lanes: RawLane[], frame: "ego" | "map"): void {
    this.rawLanes = lanes;
    this.frame = frame;
    // Restore full opacity after a stackLost ghost.
    this.lost = false;
    this.setOpacity(1);
  }

  // Ego-frame lanes move with ego. Map-frame lanes and a lost stack's ghost stay put.
  get followsEgo(): boolean {
    return this.frame === "ego" && !this.lost;
  }

  // Color every lane whose kind is in the list (e.g. ["left", "right"]).
  setAlertKinds(kinds: string[]): void {
    this.alertKinds = kinds;
    for (const { kind, line } of this.lines) {
      (line.material as THREE.LineBasicMaterial).color.setHex(
        kinds.includes(kind) ? ALERT_COLOR : LANE_COLOR,
      );
    }
  }

  // Rebuild line geometries with the current ego pose. main.ts calls it when a
  // message arrives, and on every ego move while followsEgo is true.
  rebuild(egoSceneX: number, egoSceneZ: number, egoYaw: number): void {
    if (this.rawLanes.length === 0) {
      this.clear();
      return;
    }

    // Synchronise the number of THREE.Line objects with the incoming lane count.
    while (this.lines.length > this.rawLanes.length) {
      const { line } = this.lines.pop()!;
      (line.material as THREE.LineBasicMaterial).dispose();
      line.geometry.dispose();
      this.scene.remove(line);
    }
    while (this.lines.length < this.rawLanes.length) {
      const geom = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ color: LANE_COLOR });
      const line = new THREE.Line(geom, mat);
      this.scene.add(line);
      this.lines.push({ kind: "", line, capacity: 0 });
    }

    for (let i = 0; i < this.rawLanes.length; i++) {
      const lane = this.rawLanes[i];
      const entry = this.lines[i];

      // Update kind and color when a new message arrives with different structure.
      if (entry.kind !== lane.kind) {
        entry.kind = lane.kind;
        (entry.line.material as THREE.LineBasicMaterial).color.setHex(
          this.alertKinds.includes(lane.kind) ? ALERT_COLOR : LANE_COLOR,
        );
      }

      const n = lane.pts.length;
      if (n < 2) {
        entry.line.visible = false;
        continue;
      }
      entry.line.visible = true;

      // Reallocate buffer only when size changes (avoids GPU reallocation each frame).
      if (entry.capacity !== n) {
        entry.line.geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(n * 3), 3),
        );
        entry.capacity = n;
      }

      const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;

      for (let j = 0; j < n; j++) {
        const [lx, ly] = lane.pts[j];
        const p = toScene(this.frame, lx, ly, egoSceneX, egoSceneZ, egoYaw);
        arr[j * 3] = p.x;
        arr[j * 3 + 1] = 0.02; // slightly above road to avoid z-fighting
        arr[j * 3 + 2] = p.z;
      }

      posAttr.needsUpdate = true;
      entry.line.geometry.setDrawRange(0, n);
      entry.line.geometry.computeBoundingSphere();
    }
  }

  // Start the fade to ghost opacity (design §6.3 Stack lost). tick() runs it.
  stackLost(): void {
    this.lost = true;
  }

  tick(dt: number): void {
    if (this.lost && this.opacity > STACK_LOST_OPACITY) {
      this.setOpacity(Math.max(STACK_LOST_OPACITY, this.opacity - dt / STACK_LOST_FADE_S));
    }
  }

  private setOpacity(opacity: number): void {
    this.opacity = opacity;
    for (const { line } of this.lines) {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.transparent = opacity < 1;
      mat.opacity = opacity;
    }
  }

  clear(): void {
    for (const { line } of this.lines) {
      (line.material as THREE.LineBasicMaterial).dispose();
      line.geometry.dispose();
      this.scene.remove(line);
    }
    this.lines = [];
    this.rawLanes = [];
  }
}
