import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import carUrl from "../assets/meshes/car.glb?url";
import { normalizeTemplate } from "./objects";

const EGO_WIDTH = 1.8;
const EGO_HEIGHT = 1.5;
const EGO_LENGTH = 4.5;
const EGO_COLOR = 0xd9d9d9; // design section 6.5 ego token

// Replaces the placeholder box in egoGroup with a normalised car.glb.
// Falls back silently to the existing placeholder if the GLB fails.
export async function replaceEgoMesh(egoGroup: THREE.Group): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(carUrl);
    const template = normalizeTemplate(gltf.scene, -Math.PI / 2, -Math.PI / 2, false);
    template.traverse((child) => {
      const m = child as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = new THREE.MeshStandardMaterial({
        color: EGO_COLOR,
        roughness: 0.6,
        metalness: 0.2,
      });
      m.castShadow = true;
    });

    const outer = new THREE.Group();
    outer.scale.set(EGO_WIDTH, EGO_HEIGHT, EGO_LENGTH);
    template.position.y = 0.5;
    outer.add(template);

    while (egoGroup.children.length > 0) egoGroup.remove(egoGroup.children[0]);
    egoGroup.add(outer);
  } catch (e) {
    console.warn("ego mesh load failed, keeping placeholder box:", e);
  }
}
