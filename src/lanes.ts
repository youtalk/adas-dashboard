import * as THREE from "three";
import { egoToScene } from "./objects";
import { mapToScene } from "./frames";

export type RawLane = { kind: string; pts: [number, number][] };

const LANE_COLOR = 0x22d3ee; // cyan §6.5
const ALERT_COLOR = 0xb91c1c; // alert red §6.5
const STACK_LOST_OPACITY = 0.15;

type LaneLine = { kind: string; line: THREE.Line; capacity: number };

export class LaneManager {
  private scene: THREE.Scene;
  private lines: LaneLine[] = [];
  private rawLanes: RawLane[] = [];
  private frame: "ego" | "map" = "ego";
  private alertKind: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setMsg(lanes: RawLane[], frame: "ego" | "map"): void {
    this.rawLanes = lanes;
    this.frame = frame;
    // Restore full opacity after a stackLost ghost.
    for (const { line } of this.lines) {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.transparent = false;
      mat.opacity = 1;
    }
  }

  setAlertKind(kind: string | null): void {
    if (kind === this.alertKind) return;
    this.alertKind = kind;
    // Recolor existing lines immediately without waiting for next rebuild.
    for (const { kind: k, line } of this.lines) {
      (line.material as THREE.LineBasicMaterial).color.setHex(
        k === kind ? ALERT_COLOR : LANE_COLOR,
      );
    }
  }

  // Rebuild line geometries with the current ego pose (called every frame for
  // ego-frame lanes so they track the moving ego between 10 Hz message arrivals).
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
          lane.kind === this.alertKind ? ALERT_COLOR : LANE_COLOR,
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
        let sx: number, sz: number;
        if (this.frame === "ego") {
          const p = egoToScene(lx, ly, 0, egoSceneX, egoSceneZ, egoYaw);
          sx = p.x;
          sz = p.z;
        } else {
          const p = mapToScene(lx, ly);
          sx = p.x;
          sz = p.z;
        }
        arr[j * 3] = sx;
        arr[j * 3 + 1] = 0.02; // slightly above road to avoid z-fighting
        arr[j * 3 + 2] = sz;
      }

      posAttr.needsUpdate = true;
      entry.line.geometry.setDrawRange(0, n);
      entry.line.geometry.computeBoundingSphere();
    }
  }

  // Fade all lane lines to ghost opacity (design §6.3 Stack lost).
  stackLost(): void {
    for (const { line } of this.lines) {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = STACK_LOST_OPACITY;
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
