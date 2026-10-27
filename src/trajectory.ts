import * as THREE from "three";
import { toScene } from "./frames";
import { palette, STACK_LOST_FADE_S } from "./style";

const DEFAULT_WIDTH_M = 1.9; // ego vehicle width fallback (design §5.2)
const TRAJ_Y = 0.03; // just above road surface
// See-through ribbon and its Stack lost ghost (design §6.5, mockups 01 and 03).
const OPACITY = 0.4;
const GHOST_OPACITY = 0.08;

export class TrajectoryRibbon {
  private scene: THREE.Scene;
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.BufferGeometry | null = null;
  private mat: THREE.MeshBasicMaterial;
  private rawPts: [number, number][] = [];
  private rawWidthM = DEFAULT_WIDTH_M;
  private frame: "ego" | "map" = "ego";
  private vertexCapacity = 0;
  private lost = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.mat = new THREE.MeshBasicMaterial({
      color: palette.traj,
      side: THREE.DoubleSide,
      depthWrite: false,
      transparent: true,
      opacity: OPACITY,
    });
  }

  setMsg(pts: [number, number][], widthM: number | undefined, frame: "ego" | "map"): void {
    this.rawPts = pts;
    this.rawWidthM = widthM ?? DEFAULT_WIDTH_M;
    this.frame = frame;
    // Restore the opacity after a stackLost ghost.
    this.lost = false;
    this.mat.opacity = OPACITY;
  }

  // An ego-frame ribbon moves with ego. A map-frame ribbon and a lost stack's ghost stay put.
  get followsEgo(): boolean {
    return this.frame === "ego" && !this.lost;
  }

  setAlert(isAlert: boolean): void {
    this.mat.color.setHex(isAlert ? palette.alert : palette.traj);
  }

  // Start the fade to ghost opacity (design §6.3 Stack lost). tick() runs it.
  stackLost(): void {
    this.lost = true;
  }

  tick(dt: number): void {
    if (this.lost && this.mat.opacity > GHOST_OPACITY) {
      const step = ((OPACITY - GHOST_OPACITY) * dt) / STACK_LOST_FADE_S;
      this.mat.opacity = Math.max(GHOST_OPACITY, this.mat.opacity - step);
    }
  }

  // Rebuild ribbon geometry with the current ego pose. main.ts calls it when a
  // message arrives, and on every ego move while followsEgo is true.
  rebuild(egoSceneX: number, egoSceneZ: number, egoYaw: number): void {
    const pts = this.rawPts;
    if (pts.length < 2) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    // Convert raw points to scene space.
    const sp = pts.map(([lx, ly]) => toScene(this.frame, lx, ly, egoSceneX, egoSceneZ, egoYaw));

    const n = sp.length;
    const hw = this.rawWidthM / 2;
    // 2 vertices per point (left and right edge of ribbon).
    const vertCount = n * 2;

    if (!this.geom) {
      this.geom = new THREE.BufferGeometry();
      this.mesh = new THREE.Mesh(this.geom, this.mat);
      this.scene.add(this.mesh);
    }

    // Reallocate buffers only when ribbon length changes (avoids GPU realloc each frame).
    if (this.vertexCapacity !== n) {
      this.vertexCapacity = n;
      this.geom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3),
      );
      const idxCount = (n - 1) * 6;
      const idx = new Uint16Array(idxCount);
      for (let i = 0; i < n - 1; i++) {
        const li = i * 2;
        const ri = i * 2 + 1;
        const ln = (i + 1) * 2;
        const rn = (i + 1) * 2 + 1;
        const b = i * 6;
        idx[b] = li;
        idx[b + 1] = ri;
        idx[b + 2] = ln;
        idx[b + 3] = ri;
        idx[b + 4] = rn;
        idx[b + 5] = ln;
      }
      this.geom.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    const posAttr = this.geom.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < n; i++) {
      // Direction at this point: centered difference for interior, forward/back for ends.
      let dx: number, dz: number;
      if (i === 0) {
        dx = sp[1].x - sp[0].x;
        dz = sp[1].z - sp[0].z;
      } else if (i === n - 1) {
        dx = sp[n - 1].x - sp[n - 2].x;
        dz = sp[n - 1].z - sp[n - 2].z;
      } else {
        dx = sp[i + 1].x - sp[i - 1].x;
        dz = sp[i + 1].z - sp[i - 1].z;
      }
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= len;
      dz /= len;
      // Perpendicular in the xz plane (90° CCW: left side of forward direction).
      const px = -dz;
      const pz = dx;

      const base = i * 6;
      // Left edge vertex.
      arr[base] = sp[i].x + hw * px;
      arr[base + 1] = TRAJ_Y;
      arr[base + 2] = sp[i].z + hw * pz;
      // Right edge vertex.
      arr[base + 3] = sp[i].x - hw * px;
      arr[base + 4] = TRAJ_Y;
      arr[base + 5] = sp[i].z - hw * pz;
    }

    posAttr.needsUpdate = true;
    this.geom.computeBoundingSphere();
    this.mesh!.visible = true;
  }

  clear(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.geom?.dispose();
      this.mesh = null;
      this.geom = null;
    }
    this.vertexCapacity = 0;
    this.rawPts = [];
  }
}
