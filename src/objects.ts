import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Vite resolves these to content-hashed URLs and includes them in the build.
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

// The GLBs follow GLTF convention: front face at -Z, right side at +X.
// Rotating π around Y maps -Z → outer +Z (the outer group's forward axis),
// so outer.rotation.y = ry then aligns the vehicle with the road heading.
const MESH_BASE_ROTATION_Y = Math.PI;

const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.5;

// Dark matte material token (design section 6.5).
const OBJECT_COLOR = 0x2a3540;

type Entry = {
  outer: THREE.Group; // positioned + rotated by pose, scaled to object dims
  inner: THREE.Object3D; // cloned GLTF scene or fallback box
  mats: THREE.MeshStandardMaterial[]; // per-object clones for opacity
  fadingOut: boolean;
  opacity: number;
};

// Convert a position in ego frame to scene (x, z) and scene rotation.y.
// Ego frame: x-forward, y-left.  Scene frame: x = ego-y, z = ego-x (mapToScene).
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
  // Rotate ego-relative (ox, oy) by egoYaw to get map offset, then apply mapToScene.
  // map_x = egoMapX + ox*c - oy*s   → scene.z = map_x
  // map_y = egoMapY + ox*s + oy*c   → scene.x = map_y
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
        const gltf = await loader.loadAsync(url);
        this.templates.set(name, gltf.scene);
      }),
    );
    this.ready = true;
  }

  private selectTemplate(cls: string, height: number, length: number): THREE.Group | null {
    // A car with a tall silhouette (SUV proportions) uses the SUV mesh.
    const key = cls === "car" && height / length > 0.36 ? "suv" : cls;
    return this.templates.get(key) ?? null;
  }

  private buildEntry(obj: RawObject): Entry {
    const mats: THREE.MeshStandardMaterial[] = [];
    const outer = new THREE.Group();
    // Scale outer group so the unit-cube mesh fills the object's footprint.
    outer.scale.set(obj.width, obj.height, obj.length);

    const template = this.selectTemplate(obj.class, obj.height, obj.length);
    let inner: THREE.Object3D;

    if (template) {
      inner = template.clone(true);
      inner.rotation.y = MESH_BASE_ROTATION_Y;
      inner.traverse((child) => {
        const m = child as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = new THREE.MeshStandardMaterial({
          color: OBJECT_COLOR,
          roughness: 0.85,
          metalness: 0.1,
          transparent: true,
          opacity: 0,
        });
        m.material = mat;
        m.castShadow = true;
        mats.push(mat);
      });
    } else {
      // Unknown class: plain box scaled by outer group to object dims.
      const mat = new THREE.MeshStandardMaterial({
        color: OBJECT_COLOR,
        roughness: 0.85,
        metalness: 0.1,
        transparent: true,
        opacity: 0,
      });
      inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      (inner as THREE.Mesh).castShadow = true;
      mats.push(mat);
    }

    // Lift inner so its bottom sits at y=0 of the outer group (ground level).
    // After outer scale, y=0.5 in outer-group space becomes height/2 in world.
    inner.position.y = 0.5;
    outer.add(inner);

    return { outer, inner, mats, fadingOut: false, opacity: 0 };
  }

  // Call every frame with the latest objects list and the ego's current scene pose.
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
      let pos: { x: number; z: number; ry: number };
      if (frame === "ego") {
        pos = egoToScene(obj.x, obj.y, obj.yaw, egoSceneX, egoSceneZ, egoYaw);
      } else {
        // map frame: apply mapToScene directly (scene.x=y, scene.z=x)
        pos = { x: obj.y, z: obj.x, ry: obj.yaw };
      }

      let entry = this.tracked.get(obj.id);
      if (!entry) {
        entry = this.buildEntry(obj);
        this.scene.add(entry.outer);
        this.tracked.set(obj.id, entry);
      }

      entry.outer.position.set(pos.x, 0, pos.z);
      entry.outer.rotation.y = pos.ry;
      entry.fadingOut = false;
    }

    for (const [id, entry] of this.tracked) {
      if (!activeIds.has(id)) entry.fadingOut = true;
    }
  }

  // Call every frame with the elapsed time in seconds to drive fade animation.
  tick(dt: number): void {
    for (const [id, entry] of this.tracked) {
      if (entry.fadingOut) {
        entry.opacity = Math.max(0, entry.opacity - dt / FADE_OUT_S);
        if (entry.opacity === 0) {
          this.scene.remove(entry.outer);
          // Dispose per-object materials; geometry is shared from the template.
          for (const mat of entry.mats) mat.dispose();
          this.tracked.delete(id);
          continue;
        }
      } else {
        entry.opacity = Math.min(1, entry.opacity + dt / FADE_IN_S);
      }
      for (const mat of entry.mats) mat.opacity = entry.opacity;
    }
  }

  // Remove all tracked objects immediately (e.g. on endpoint close).
  clear(): void {
    for (const entry of this.tracked.values()) {
      this.scene.remove(entry.outer);
      for (const mat of entry.mats) mat.dispose();
    }
    this.tracked.clear();
  }
}
