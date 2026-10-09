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

// The GLBs were exported by trimesh as unit cubes with Z up and the vehicle's
// front at +X (verified on car.glb). Every footprint is square, so the long
// axis cannot be auto-detected; the orientation is set explicitly instead:
//   rotation.x = -π/2 : model +Z (up)    → +Y
//   rotation.y = -π/2 : model +X (front) → +Z (outer group's forward axis)
const DEFAULT_PITCH_FIX = -Math.PI / 2;
const DEFAULT_YAW_FIX = -Math.PI / 2;

// Per-class overrides, only needed if some GLB uses a different convention.
//   pitch: 0 → model is already Y-up; Math.PI / 2 → comes out upside down
//   yaw:   Math.PI / 2 → front was at -X; 0 → front at +Z; Math.PI → front at -Z
const PITCH_FIX_OVERRIDE: Partial<Record<string, number>> = {
  // e.g. pedestrian: 0,
};
const YAW_FIX_OVERRIDE: Partial<Record<string, number>> = {
  // e.g. bus: Math.PI / 2,
};

// Classes whose model ends up facing backwards after alignment.
// Add a class here only if that vehicle drives "rear-first".
const FLIP_180 = new Set<string>([
  // e.g. "truck",
]);

// Set to true to draw a red arrow on each object showing its heading (+Z of
// the outer group). Useful to tell mesh-orientation issues from yaw-data issues.
const DEBUG_HEADING_ARROWS = false;

// Logs one line per object when it first appears (raw yaw vs computed scene yaw).
const DEBUG_YAW_LOG = false;

// --- Object yaw interpretation -------------------------------------------
// +1: yaw is counter-clockwise (toward +y / left), matching the ego frame.
// -1: yaw is clockwise. Flip this if objects skew AWAY from the lane's curve.
const OBJECT_YAW_SIGN = 1;

// false: in "ego" frame, object yaw is relative to the ego heading (egoYaw is added).
// true:  object yaw is already absolute (map frame); egoYaw is NOT added.
// Flip this if every object is skewed by about the same angle as the ego's heading.
const OBJECT_YAW_IS_ABSOLUTE = false;

// 0 = no smoothing, closer to 1 = smoother but laggier. Removes detector jitter.
const YAW_SMOOTHING = 0.7;

const FADE_IN_S = 0.3;
const FADE_OUT_S = 0.5;

// Dark matte material token (design section 6.5).
const OBJECT_COLOR = 0x2a3540;

type Entry = {
  outer: THREE.Group; // positioned + rotated by pose, scaled to object dims
  inner: THREE.Object3D; // cloned normalized template or fallback box
  mats: THREE.MeshStandardMaterial[]; // per-object clones for opacity
  fadingOut: boolean;
  opacity: number;
  ry: number | null; // smoothed scene yaw; null until first pose
};

// Wrap an angle to (-π, π].
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// 1. Pitch the model upright (Z-up → Y-up).
// 2. Yaw it so its front faces +Z (the outer group's forward axis).
// 3. Center it at the origin and scale it to a unit cube, so the outer group's
//    (width, height, length) scale maps exactly onto the object's dimensions.
function normalizeTemplate(
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
  // Centered at origin; after unit scaling the bottom sits at y = -0.5.
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
    ry: (OBJECT_YAW_IS_ABSOLUTE ? 0 : egoYaw) + OBJECT_YAW_SIGN * oyaw,
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
        const pitch = PITCH_FIX_OVERRIDE[name] ?? DEFAULT_PITCH_FIX;
        const yaw = YAW_FIX_OVERRIDE[name] ?? DEFAULT_YAW_FIX;
        this.templates.set(name, normalizeTemplate(gltf.scene, pitch, yaw, FLIP_180.has(name)));
      }),
    );
    this.ready = true;
  }

  private selectTemplate(cls: string, height: number, length: number): THREE.Group | null {
    // A car with a tall silhouette (SUV proportions) uses the SUV mesh.
    const key = cls === "car" && height / length > 0.36 ? "suv" : cls;
    return this.templates.get(key) ?? null;
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: OBJECT_COLOR,
      roughness: 0.85,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
    });
  }

  private buildEntry(obj: RawObject): Entry {
    const mats: THREE.MeshStandardMaterial[] = [];
    const outer = new THREE.Group();
    // Scale outer group so the unit-cube mesh fills the object's footprint.
    outer.scale.set(obj.width, obj.height, obj.length);

    const template = this.selectTemplate(obj.class, obj.height, obj.length);
    let inner: THREE.Object3D;

    if (template) {
      // Template is already upright, oriented (+Z forward), centered and
      // unit-sized, so no extra rotation is applied here.
      inner = template.clone(true);
      inner.traverse((child) => {
        const m = child as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = this.makeMaterial();
        m.material = mat;
        m.castShadow = true;
        mats.push(mat);
      });
    } else {
      // Unknown class: plain box scaled by outer group to object dims.
      const mat = this.makeMaterial();
      inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      (inner as THREE.Mesh).castShadow = true;
      mats.push(mat);
    }

    // Lift inner so its bottom (y = -0.5) sits at y = 0 of the outer group.
    // After outer scale, y = 0.5 in outer-group space becomes height/2 in world.
    inner.position.y = 0.5;
    outer.add(inner);

    if (DEBUG_HEADING_ARROWS) {
      outer.add(
        new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(0, 1.2, 0),
          0.8,
          0xff4040,
        ),
      );
    }

    return { outer, inner, mats, fadingOut: false, opacity: 0, ry: null };
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
        pos = { x: obj.y, z: obj.x, ry: OBJECT_YAW_SIGN * obj.yaw };
      }

      let entry = this.tracked.get(obj.id);
      if (!entry) {
        entry = this.buildEntry(obj);
        this.scene.add(entry.outer);
        this.tracked.set(obj.id, entry);
        if (DEBUG_YAW_LOG) {
          const deg = (r: number) => +((r * 180) / Math.PI).toFixed(1);
          console.log(`[ObjectManager] id=${obj.id} class=${obj.class}`, {
            frame,
            x: +obj.x.toFixed(2),
            y: +obj.y.toFixed(2),
            yawRad: obj.yaw,
            yawDeg: deg(obj.yaw),
            egoYawDeg: deg(egoYaw),
            sceneRyDeg: deg(pos.ry),
            dims: [obj.length, obj.width, obj.height],
          });
        }
      }

      entry.outer.position.set(pos.x, 0, pos.z);
      // Smooth along the shortest angular path so 179° → -179° doesn't spin.
      entry.ry =
        entry.ry === null
          ? pos.ry
          : wrapAngle(entry.ry + (1 - YAW_SMOOTHING) * wrapAngle(pos.ry - entry.ry));
      entry.outer.rotation.y = entry.ry;
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
