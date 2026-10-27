import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { egoToScene, mapToScene } from "./frames";
import { palette, STACK_LOST_FADE_S, STACK_LOST_OPACITY } from "./style";

import carUrl from "../assets/meshes/car.glb?url";
import suvUrl from "../assets/meshes/suv.glb?url";
import truckUrl from "../assets/meshes/truck.glb?url";
import busUrl from "../assets/meshes/bus.glb?url";
import trailerUrl from "../assets/meshes/trailer.glb?url";
import pedestrianUrl from "../assets/meshes/pedestrian.glb?url";
import cyclistUrl from "../assets/meshes/cyclist.glb?url";
import bicycleUrl from "../assets/meshes/bicycle.glb?url";

export type RawObject = {
  id: number;
  class: string;
  x: number;
  y: number;
  yaw: number;
  length: number;
  width: number;
  height: number;
  lead?: boolean;
  distance_m?: number;
};

const MESH_URLS: Record<string, string> = {
  car: carUrl,
  suv: suvUrl,
  truck: truckUrl,
  bus: busUrl,
  trailer: trailerUrl,
  pedestrian: pedestrianUrl,
  cyclist: cyclistUrl,
  bicycle: bicycleUrl,
};

// GLBs are Z-up, +X-forward (trimesh export). Two-step fix:
//   Rx(-π/2): Z-up → Y-up
//   Ry(-π/2): +X-forward → +Z-forward (outer group's forward axis)
const PITCH_FIX = -Math.PI / 2;
const YAW_FIX = -Math.PI / 2;

const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.5;

// Shared geometry for unknown-class fallback boxes (design section 6.2).
const BOX_GEOM = new THREE.BoxGeometry(1, 1, 1);

// Lead vehicle: alert ring geometry (unit circle lying flat, shared across all instances).
const RING_GEOM = (() => {
  const pts: THREE.Vector3[] = [];
  const segs = 40;
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(theta) * 1.2, 0, Math.sin(theta) * 1.2));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
})();

// An object pose in its message frame (design section 5.1).
export type Pose = { x: number; y: number; yaw: number };
// A move from the pose drawn when a message arrived to that message's pose.
export type Motion = { from: Pose; to: Pose; atMs: number; durMs: number };

// After a long gap (a lost stack, a late id) the move takes this long at most.
const MAX_MOVE_MS = 250;

// The pose drawn at nowMs: from → to over durMs, never past to.
export function poseAt(m: Motion, nowMs: number): Pose {
  const a = m.durMs > 0 ? Math.min(1, Math.max(0, (nowMs - m.atMs) / m.durMs)) : 1;
  return {
    x: m.from.x + a * (m.to.x - m.from.x),
    y: m.from.y + a * (m.to.y - m.from.y),
    yaw: wrapAngle(m.from.yaw + a * wrapAngle(m.to.yaw - m.from.yaw)),
  };
}

// Starts a move to a new message pose from the pose drawn now, so the object
// does not jump. The move takes one message interval: the object reaches the
// pose about when the next message is due, and stops there if none comes.
export function retarget(m: Motion | null, to: Pose, nowMs: number): Motion {
  if (!m) return { from: to, to, atMs: nowMs, durMs: 0 };
  return {
    from: poseAt(m, nowMs),
    to,
    atMs: nowMs,
    durMs: Math.min(MAX_MOVE_MS, nowMs - m.atMs),
  };
}

type Entry = {
  outer: THREE.Group;
  inner: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  meshes: THREE.Mesh[];
  fadingOut: boolean;
  frozen: boolean; // Stack lost: fades to STACK_LOST_OPACITY and holds
  opacity: number;
  isLead: boolean;
  frame: "ego" | "map";
  // Ego-frame poses stay in the ego frame: tick() places them with the live
  // ego pose each frame, so objects track the moving ego correctly.
  motion: Motion | null;
  distM?: number; // the stack's distance_m, when it sends one
  // Lead vehicle alert ring (created lazily when the lead first gets an alert).
  ring: THREE.LineLoop | null; // child of outer
};

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Normalises a GLB model to a unit cube facing +Z.
// Exported so main.ts can reuse it for the ego car mesh.
export function normalizeTemplate(
  model: THREE.Object3D,
  pitch: number,
  yaw: number,
  flip: boolean,
): THREE.Group {
  const upright = new THREE.Group();
  upright.rotation.x = pitch;
  upright.add(model);
  upright.updateMatrixWorld(true);

  const oriented = new THREE.Group();
  oriented.rotation.y = yaw + (flip ? Math.PI : 0);
  oriented.add(upright);
  oriented.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(oriented);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  oriented.position.sub(center);

  const unit = new THREE.Group();
  unit.add(oriented);
  unit.scale.set(
    1 / Math.max(size.x, 1e-6),
    1 / Math.max(size.y, 1e-6),
    1 / Math.max(size.z, 1e-6),
  );
  return unit;
}

export class ObjectManager {
  private scene: THREE.Scene;
  private templates = new Map<string, THREE.Group>();
  private tracked = new Map<number, Entry>();
  private ready = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(
      Object.entries(MESH_URLS).map(async ([name, url]) => {
        try {
          const gltf = await loader.loadAsync(url);
          this.templates.set(name, normalizeTemplate(gltf.scene, PITCH_FIX, YAW_FIX, false));
        } catch (e) {
          console.warn(`mesh ${name} failed to load, will draw a box:`, e);
        }
      }),
    );
    this.ready = true;
  }

  private selectTemplate(cls: string, height: number, length: number): THREE.Group | null {
    const key = cls === "car" && height / length > 0.36 ? "suv" : cls;
    return this.templates.get(key) ?? null;
  }

  private makeMaterial(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
    });
  }

  private buildEntry(obj: RawObject): Entry {
    const isLead = obj.lead ?? false;
    const color = isLead ? palette.lead : palette.traffic;
    const mats: THREE.MeshStandardMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    const outer = new THREE.Group();
    outer.scale.set(obj.width, obj.height, obj.length);

    const template = this.selectTemplate(obj.class, obj.height, obj.length);
    let inner: THREE.Object3D;

    if (template) {
      inner = template.clone(true);
      inner.traverse((child) => {
        const m = child as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = this.makeMaterial(color);
        m.material = mat;
        m.castShadow = true;
        mats.push(mat);
        meshes.push(m);
      });
    } else {
      const mat = this.makeMaterial(color);
      const mesh = new THREE.Mesh(BOX_GEOM, mat);
      mesh.castShadow = true;
      inner = mesh;
      mats.push(mat);
      meshes.push(mesh);
    }

    inner.position.y = 0.5;
    outer.add(inner);

    return {
      outer,
      inner,
      mats,
      meshes,
      fadingOut: false,
      frozen: false,
      opacity: 0,
      isLead,
      frame: "map", // overwritten by update() on first message
      motion: null,
      ring: null,
    };
  }

  update(objects: RawObject[], frame: "ego" | "map"): void {
    if (!this.ready) return;

    const activeIds = new Set(objects.map((o) => o.id));
    const nowMs = performance.now();

    for (const obj of objects) {
      let entry = this.tracked.get(obj.id);
      if (!entry) {
        entry = this.buildEntry(obj);
        entry.frame = frame;
        this.scene.add(entry.outer);
        this.tracked.set(obj.id, entry);
      }

      // Update scale every frame — tracker may correct dimensions mid-track.
      entry.outer.scale.set(obj.width, obj.height, obj.length);

      // Update color when lead status changes.
      const newLead = obj.lead ?? false;
      if (newLead !== entry.isLead) {
        entry.isLead = newLead;
        const color = newLead ? palette.lead : palette.traffic;
        for (const mat of entry.mats) mat.color.setHex(color);
      }

      entry.motion = retarget(entry.motion, { x: obj.x, y: obj.y, yaw: obj.yaw }, nowMs);
      entry.distM = obj.distance_m;
      entry.fadingOut = false;
      entry.frozen = false;
    }

    for (const [id, entry] of this.tracked) {
      if (!activeIds.has(id)) {
        // update() is only called while the stack is connected, so any id absent
        // from the current message must fade out — including previously frozen ids
        // that were not re-reported after a reconnect.
        entry.frozen = false;
        entry.fadingOut = true;
      }
    }
  }

  tick(dt: number, egoSceneX: number, egoSceneZ: number, egoYaw: number): void {
    const nowMs = performance.now();

    for (const [id, entry] of this.tracked) {
      // Stack lost: fade toward 15% opacity and hold position.
      if (entry.frozen) {
        if (entry.opacity > STACK_LOST_OPACITY) {
          entry.opacity = Math.max(STACK_LOST_OPACITY, entry.opacity - dt / STACK_LOST_FADE_S);
        }
        for (const mat of entry.mats) mat.opacity = entry.opacity;
        const frozenShadow = entry.opacity > 0.5;
        for (const mesh of entry.meshes) mesh.castShadow = frozenShadow;
        continue;
      }

      if (entry.fadingOut) {
        entry.opacity = Math.max(0, entry.opacity - dt / FADE_OUT_S);
        if (entry.opacity === 0) {
          this.scene.remove(entry.outer);
          this.disposeEntry(entry);
          this.tracked.delete(id);
          continue;
        }
      } else {
        entry.opacity = Math.min(1, entry.opacity + dt / FADE_IN_S);
      }

      // Move toward the newest message pose and apply.
      if (entry.motion) {
        const p = poseAt(entry.motion, nowMs);
        if (entry.frame === "ego") {
          // Re-derive scene pose from live ego position every frame — this is
          // what prevents the oscillation: the world-space result updates at
          // 60 Hz even though object messages arrive at 10 Hz.
          const s = egoToScene(p.x, p.y, p.yaw, egoSceneX, egoSceneZ, egoYaw);
          entry.outer.position.set(s.x, 0, s.z);
          entry.outer.rotation.y = s.ry;
        } else {
          const s = mapToScene(p.x, p.y);
          entry.outer.position.set(s.x, 0, s.z);
          entry.outer.rotation.y = p.yaw;
        }
      }

      for (const mat of entry.mats) mat.opacity = entry.opacity;
      // Shadow only when the mesh is mostly visible to avoid ghost shadows.
      const shadow = entry.opacity > 0.5;
      for (const mesh of entry.meshes) mesh.castShadow = shadow;
    }
  }

  // Distance in meters: the stack's distance_m when sent, otherwise measured from ego.
  // It uses the newest message pose, not the drawn one.
  private getDistM(entry: Entry, egoSceneX: number, egoSceneZ: number): number {
    if (entry.distM != null) return entry.distM;
    const { x, y } = entry.motion!.to;
    // ego frame: distance = hypot of raw detector position
    if (entry.frame === "ego") return Math.hypot(x, y);
    // map frame: measure from ego scene position, not map origin
    const s = mapToScene(x, y);
    return Math.hypot(s.x - egoSceneX, s.z - egoSceneZ);
  }

  // The lead vehicle while the stack is live: not frozen and not fading out.
  private liveLead(): Entry | undefined {
    for (const entry of this.tracked.values()) {
      if (entry.isLead && entry.motion && !entry.frozen && !entry.fadingOut) return entry;
    }
  }

  // Distance to the live lead vehicle, or null when there is none or the stack
  // is lost. The HUD uses it so the panel and the label show the same number.
  leadDistM(egoSceneX: number, egoSceneZ: number): number | null {
    const lead = this.liveLead();
    return lead ? this.getDistM(lead, egoSceneX, egoSceneZ) : null;
  }

  // Scene point 0.5 m above the live lead vehicle's roof, where main.ts puts
  // the distance label. Null when leadDistM is null.
  leadLabelPoint(): THREE.Vector3 | null {
    const lead = this.liveLead();
    if (!lead) return null;
    return lead.outer.position.clone().setY(lead.outer.scale.y + 0.5);
  }

  // Show or hide the alert ring on the lead vehicle (design §6.3 Alert state).
  setLeadAlert(show: boolean): void {
    for (const entry of this.tracked.values()) {
      if (show && entry.isLead && !entry.ring) {
        const mat = new THREE.LineBasicMaterial({ color: palette.alert });
        const ring = new THREE.LineLoop(RING_GEOM, mat);
        ring.position.y = 0.3; // just above ground in outer-local space
        entry.outer.add(ring);
        entry.ring = ring;
      }
      // Update every entry so rings on former leads are hidden when the lead flag moves.
      if (entry.ring) entry.ring.visible = show && entry.isLead;
    }
  }

  // Re-apply the palette after a theme change (design section 6.5, key t).
  refreshColors(): void {
    for (const entry of this.tracked.values()) {
      const color = entry.isLead ? palette.lead : palette.traffic;
      for (const mat of entry.mats) mat.color.setHex(color);
      if (entry.ring) (entry.ring.material as THREE.LineBasicMaterial).color.setHex(palette.alert);
    }
  }

  // Freeze all tracked objects at 15% opacity (design section 6.3 Stack lost).
  stackLost(): void {
    for (const entry of this.tracked.values()) {
      entry.frozen = true;
      entry.fadingOut = false;
    }
  }

  private disposeEntry(entry: Entry): void {
    for (const mat of entry.mats) mat.dispose();
    if (entry.ring) {
      (entry.ring.material as THREE.LineBasicMaterial).dispose();
    }
  }

  // Remove all tracked objects immediately (e.g. hard reset).
  clear(): void {
    for (const entry of this.tracked.values()) {
      this.scene.remove(entry.outer);
      this.disposeEntry(entry);
    }
    this.tracked.clear();
  }
}
