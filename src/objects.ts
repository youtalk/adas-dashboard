import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
const STACK_LOST_OPACITY = 0.15;

// Design section 6.5: traffic blue, lead red.
const TRAFFIC_COLOR = 0x3b82f6;
const LEAD_COLOR = 0xef4444;

// Shared geometry for unknown-class fallback boxes (design section 6.2).
const BOX_GEOM = new THREE.BoxGeometry(1, 1, 1);

type Pose = { x: number; z: number; ry: number };

type Entry = {
  outer: THREE.Group;
  inner: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  meshes: THREE.Mesh[];
  fadingOut: boolean;
  frozen: boolean; // Stack lost: fades to STACK_LOST_OPACITY and holds
  opacity: number;
  isLead: boolean;
  prev: { pose: Pose; atMs: number } | null;
  curr: { pose: Pose; atMs: number } | null;
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

// Convert a position in ego frame to scene (x, z) and scene rotation.y.
// Ego frame: x-forward, y-left.  Scene frame: x = ego-y, z = ego-x.
export function egoToScene(
  ox: number,
  oy: number,
  oyaw: number,
  egoSceneX: number,
  egoSceneZ: number,
  egoYaw: number,
): { x: number; z: number; ry: number } {
  const c = Math.cos(egoYaw);
  const s = Math.sin(egoYaw);
  return {
    x: egoSceneX + ox * s + oy * c,
    z: egoSceneZ + ox * c - oy * s,
    ry: egoYaw + oyaw,
  };
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
    const color = isLead ? LEAD_COLOR : TRAFFIC_COLOR;
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
      prev: null,
      curr: null,
    };
  }

  update(
    objects: RawObject[],
    frame: "ego" | "map",
    egoSceneX: number,
    egoSceneZ: number,
    egoYaw: number,
  ): void {
    if (!this.ready) return;

    const activeIds = new Set(objects.map((o) => o.id));

    for (const obj of objects) {
      const pose: Pose =
        frame === "ego"
          ? egoToScene(obj.x, obj.y, obj.yaw, egoSceneX, egoSceneZ, egoYaw)
          : { x: obj.y, z: obj.x, ry: obj.yaw };

      let entry = this.tracked.get(obj.id);
      if (!entry) {
        entry = this.buildEntry(obj);
        this.scene.add(entry.outer);
        this.tracked.set(obj.id, entry);
      }

      // Update scale every frame — tracker may correct dimensions mid-track.
      entry.outer.scale.set(obj.width, obj.height, obj.length);

      // Update color when lead status changes.
      const newLead = obj.lead ?? false;
      if (newLead !== entry.isLead) {
        entry.isLead = newLead;
        const color = newLead ? LEAD_COLOR : TRAFFIC_COLOR;
        for (const mat of entry.mats) mat.color.setHex(color);
      }

      // Record pose for interpolation in tick().
      const nowMs = performance.now();
      entry.prev = entry.curr;
      entry.curr = { pose, atMs: nowMs };
      entry.fadingOut = false;
      entry.frozen = false;
    }

    for (const [id, entry] of this.tracked) {
      if (!activeIds.has(id) && !entry.frozen) entry.fadingOut = true;
    }
  }

  tick(dt: number): void {
    const nowMs = performance.now();

    for (const [id, entry] of this.tracked) {
      // Stack lost: fade toward 15% opacity and hold position.
      if (entry.frozen) {
        if (entry.opacity > STACK_LOST_OPACITY) {
          entry.opacity = Math.max(STACK_LOST_OPACITY, entry.opacity - dt / FADE_OUT_S);
        }
        for (const mat of entry.mats) mat.opacity = entry.opacity;
        continue;
      }

      if (entry.fadingOut) {
        entry.opacity = Math.max(0, entry.opacity - dt / FADE_OUT_S);
        if (entry.opacity === 0) {
          this.scene.remove(entry.outer);
          for (const mat of entry.mats) mat.dispose();
          this.tracked.delete(id);
          continue;
        }
      } else {
        entry.opacity = Math.min(1, entry.opacity + dt / FADE_IN_S);
      }

      // Interpolate position between the last two received poses.
      if (entry.curr) {
        let x = entry.curr.pose.x;
        let z = entry.curr.pose.z;
        let ry = entry.curr.pose.ry;

        if (entry.prev) {
          const interval = entry.curr.atMs - entry.prev.atMs;
          if (interval > 0) {
            // Display lags by one interval so the transition from prev→curr
            // plays out smoothly between message arrivals.
            const alpha = Math.max(0, Math.min(1, (nowMs - interval - entry.prev.atMs) / interval));
            x = entry.prev.pose.x + alpha * (entry.curr.pose.x - entry.prev.pose.x);
            z = entry.prev.pose.z + alpha * (entry.curr.pose.z - entry.prev.pose.z);
            ry = wrapAngle(
              entry.prev.pose.ry + alpha * wrapAngle(entry.curr.pose.ry - entry.prev.pose.ry),
            );
          }
        }

        entry.outer.position.set(x, 0, z);
        entry.outer.rotation.y = ry;
      }

      for (const mat of entry.mats) mat.opacity = entry.opacity;
      // Shadow only when the mesh is mostly visible to avoid ghost shadows.
      const shadow = entry.opacity > 0.5;
      for (const mesh of entry.meshes) mesh.castShadow = shadow;
    }
  }

  // Freeze all tracked objects at 15% opacity (design section 6.3 Stack lost).
  stackLost(): void {
    for (const entry of this.tracked.values()) {
      entry.frozen = true;
      entry.fadingOut = false;
    }
  }

  // Remove all tracked objects immediately (e.g. hard reset).
  clear(): void {
    for (const entry of this.tracked.values()) {
      this.scene.remove(entry.outer);
      for (const mat of entry.mats) mat.dispose();
    }
    this.tracked.clear();
  }
}
