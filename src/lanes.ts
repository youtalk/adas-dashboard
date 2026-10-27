import * as THREE from "three";
import { toScene } from "./frames";
import {
  LINE_WIDTH_M,
  palette,
  setTransparent,
  STACK_LOST_FADE_S,
  STACK_LOST_OPACITY,
} from "./style";
import { strip } from "./strip";

export type RawLane = { kind: string; pts: [number, number][] };

// A lane line is a flat strip mesh (strip.ts).
type LaneLine = { kind: string; line: THREE.Mesh; capacity: number };

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
      (line.material as THREE.MeshBasicMaterial).color.setHex(
        kinds.includes(kind) ? palette.alert : palette.lane,
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

    // Synchronise the number of lane meshes with the incoming lane count.
    while (this.lines.length > this.rawLanes.length) {
      const { line } = this.lines.pop()!;
      (line.material as THREE.MeshBasicMaterial).dispose();
      line.geometry.dispose();
      this.scene.remove(line);
    }
    while (this.lines.length < this.rawLanes.length) {
      const geom = new THREE.BufferGeometry();
      const mat = new THREE.MeshBasicMaterial({ color: palette.lane, side: THREE.DoubleSide });
      const line = new THREE.Mesh(geom, mat);
      line.renderOrder = -1; // over the map lanes (-2), under the trajectory (0), design 6.2
      this.scene.add(line);
      this.lines.push({ kind: "", line, capacity: 0 });
    }

    for (let i = 0; i < this.rawLanes.length; i++) {
      const lane = this.rawLanes[i];
      const entry = this.lines[i];

      // Update kind and color when a new message arrives with different structure.
      if (entry.kind !== lane.kind) {
        entry.kind = lane.kind;
        (entry.line.material as THREE.MeshBasicMaterial).color.setHex(
          this.alertKinds.includes(lane.kind) ? palette.alert : palette.lane,
        );
      }

      const n = lane.pts.length;
      if (n < 2) {
        entry.line.visible = false;
        continue;
      }
      entry.line.visible = true;

      // Reallocate buffer only when size changes (avoids GPU reallocation each frame).
      // The strip has 6 vertices per segment.
      if (entry.capacity !== n) {
        entry.line.geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array((n - 1) * 18), 3),
        );
        entry.capacity = n;
      }

      const posAttr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
      const pts = lane.pts.map(([lx, ly]) =>
        toScene(this.frame, lx, ly, egoSceneX, egoSceneZ, egoYaw),
      );
      // 0.02 m: slightly above road and map lanes to avoid z-fighting.
      (posAttr.array as Float32Array).set(strip(pts, LINE_WIDTH_M, 0.02));

      posAttr.needsUpdate = true;
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
      const mat = line.material as THREE.MeshBasicMaterial;
      setTransparent(mat, opacity < 1);
      mat.opacity = opacity;
    }
  }

  clear(): void {
    for (const { line } of this.lines) {
      (line.material as THREE.MeshBasicMaterial).dispose();
      line.geometry.dispose();
      this.scene.remove(line);
    }
    this.lines = [];
    this.rawLanes = [];
  }
}
