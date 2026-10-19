import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { egoToScene } from "./frames";
import { ALERT_COLOR, STACK_LOST_FADE_S, STACK_LOST_OPACITY } from "./style";

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

// Design section 6.5: traffic blue, lead red.
const TRAFFIC_COLOR = 0x3b82f6;
const LEAD_COLOR = 0xef4444;

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

const LABEL_COLOR = "#ef4444"; // lead red §6.5, used in canvas text

// Ego-frame record: raw detector position used to re-derive scene pose each
// frame with the current ego pose, so objects track the moving ego correctly.
// distM is the stack's distance_m, when it sends one.
type EgoRecord = { ox: number; oy: number; oyaw: number; atMs: number; distM?: number };
// Map-frame record: scene position is fixed in world space between messages.
type SceneRecord = { x: number; z: number; ry: number; atMs: number; distM?: number };

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
  prev: EgoRecord | SceneRecord | null;
  curr: EgoRecord | SceneRecord | null;
  // Lead vehicle extras (created lazily when isLead first becomes true).
  ring: THREE.LineLoop | null; // alert ring, child of outer
  labelSprite: THREE.Sprite | null; // distance label, direct child of scene
  labelCanvas: HTMLCanvasElement | null;
  labelTexture: THREE.CanvasTexture | null;
  lastLabelDistM: number; // track last rendered value to avoid needless redraws
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
      frame: "map", // overwritten by update() on first message
      prev: null,
      curr: null,
      ring: null,
      labelSprite: null,
      labelCanvas: null,
      labelTexture: null,
      lastLabelDistM: -1,
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
        const color = newLead ? LEAD_COLOR : TRAFFIC_COLOR;
        for (const mat of entry.mats) mat.color.setHex(color);
      }

      // Store the record type that matches the frame so tick() can interpolate
      // correctly. Ego-frame records keep raw detector coords; tick() applies
      // egoToScene with the live ego pose each frame so objects track the ego
      // even between 10 Hz message arrivals.
      entry.prev = entry.curr;
      const distM = obj.distance_m;
      if (frame === "ego") {
        entry.curr = { ox: obj.x, oy: obj.y, oyaw: obj.yaw, atMs: nowMs, distM } as EgoRecord;
      } else {
        entry.curr = { x: obj.y, z: obj.x, ry: obj.yaw, atMs: nowMs, distM } as SceneRecord;
      }
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
        if (entry.labelSprite) entry.labelSprite.material.opacity = entry.opacity;
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

      // Interpolate position between the last two received poses and apply.
      if (entry.curr) {
        let x: number;
        let z: number;
        let ry: number;

        if (entry.frame === "ego") {
          const curr = entry.curr as EgoRecord;
          let ox = curr.ox;
          let oy = curr.oy;
          let oyaw = curr.oyaw;

          if (entry.prev) {
            const prev = entry.prev as EgoRecord;
            const interval = curr.atMs - prev.atMs;
            if (interval > 0) {
              // Alpha is measured from prev so position reaches curr immediately
              // when the message arrives, then dead-reckons forward one interval.
              const alpha = Math.min(2, Math.max(0, (nowMs - prev.atMs) / interval));
              ox = prev.ox + alpha * (curr.ox - prev.ox);
              oy = prev.oy + alpha * (curr.oy - prev.oy);
              oyaw = wrapAngle(prev.oyaw + alpha * wrapAngle(curr.oyaw - prev.oyaw));
            }
          }

          // Re-derive scene pose from live ego position every frame — this is
          // what prevents the oscillation: the world-space result updates at
          // 60 Hz even though object messages arrive at 10 Hz.
          const p = egoToScene(ox, oy, oyaw, egoSceneX, egoSceneZ, egoYaw);
          x = p.x;
          z = p.z;
          ry = p.ry;
        } else {
          const curr = entry.curr as SceneRecord;
          x = curr.x;
          z = curr.z;
          ry = curr.ry;

          if (entry.prev) {
            const prev = entry.prev as SceneRecord;
            const interval = curr.atMs - prev.atMs;
            if (interval > 0) {
              const alpha = Math.min(2, Math.max(0, (nowMs - prev.atMs) / interval));
              x = prev.x + alpha * (curr.x - prev.x);
              z = prev.z + alpha * (curr.z - prev.z);
              ry = wrapAngle(prev.ry + alpha * wrapAngle(curr.ry - prev.ry));
            }
          }
        }

        entry.outer.position.set(x, 0, z);
        entry.outer.rotation.y = ry;
      }

      for (const mat of entry.mats) mat.opacity = entry.opacity;
      // Shadow only when the mesh is mostly visible to avoid ghost shadows.
      const shadow = entry.opacity > 0.5;
      for (const mesh of entry.meshes) mesh.castShadow = shadow;

      // Lead vehicle label: distance text above the vehicle.
      if (entry.isLead && entry.curr) {
        if (!entry.labelSprite) {
          const canvas = document.createElement("canvas");
          canvas.width = 128;
          canvas.height = 48;
          const texture = new THREE.CanvasTexture(canvas);
          const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
          const sprite = new THREE.Sprite(mat);
          sprite.scale.set(3, 1.1, 1);
          this.scene.add(sprite);
          entry.labelCanvas = canvas;
          entry.labelTexture = texture;
          entry.labelSprite = sprite;
        }
        // Position label 1 m above the vehicle top in world space.
        entry.labelSprite.position.set(
          entry.outer.position.x,
          entry.outer.scale.y + 1,
          entry.outer.position.z,
        );
        entry.labelSprite.material.opacity = entry.opacity;
        entry.labelSprite.visible = true;

        // Redraw canvas only when rounded distance changes.
        const distM = entry.curr ? this.getDistM(entry.curr, egoSceneX, egoSceneZ) : null;
        const rounded = distM !== null ? Math.round(distM) : -1;
        if (rounded !== entry.lastLabelDistM) {
          entry.lastLabelDistM = rounded;
          const ctx = entry.labelCanvas!.getContext("2d")!;
          ctx.clearRect(0, 0, 128, 48);
          if (rounded >= 0) {
            ctx.fillStyle = LABEL_COLOR;
            ctx.font = "bold 22px system-ui,sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${rounded} m`, 64, 24);
          }
          entry.labelTexture!.needsUpdate = true;
        }
      } else if (entry.labelSprite) {
        entry.labelSprite.visible = false;
      }
    }
  }

  // Distance in meters: the stack's distance_m when sent, otherwise measured from ego.
  private getDistM(rec: EgoRecord | SceneRecord, egoSceneX: number, egoSceneZ: number): number {
    if (rec.distM != null) return rec.distM;
    // ego frame: distance = hypot of raw detector position
    if ("ox" in rec) return Math.hypot(rec.ox, rec.oy);
    // map frame: measure from ego scene position, not map origin
    return Math.hypot(rec.x - egoSceneX, rec.z - egoSceneZ);
  }

  // Distance to the live lead vehicle, or null when there is none or the stack
  // is lost. The HUD uses it so the panel and the label show the same number.
  leadDistM(egoSceneX: number, egoSceneZ: number): number | null {
    for (const entry of this.tracked.values()) {
      if (entry.isLead && entry.curr && !entry.frozen && !entry.fadingOut) {
        return this.getDistM(entry.curr, egoSceneX, egoSceneZ);
      }
    }
    return null;
  }

  // Show or hide the alert ring on the lead vehicle (design §6.3 Alert state).
  setLeadAlert(show: boolean): void {
    for (const entry of this.tracked.values()) {
      if (show && entry.isLead && !entry.ring) {
        const mat = new THREE.LineBasicMaterial({ color: ALERT_COLOR });
        const ring = new THREE.LineLoop(RING_GEOM, mat);
        ring.position.y = 0.3; // just above ground in outer-local space
        entry.outer.add(ring);
        entry.ring = ring;
      }
      // Update every entry so rings on former leads are hidden when the lead flag moves.
      if (entry.ring) entry.ring.visible = show && entry.isLead;
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
    if (entry.labelSprite) {
      this.scene.remove(entry.labelSprite);
      entry.labelTexture?.dispose();
      (entry.labelSprite.material as THREE.SpriteMaterial).dispose();
    }
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
