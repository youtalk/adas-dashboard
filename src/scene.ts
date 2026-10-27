import * as THREE from "three";
import { EGO_REAR_AXLE_TO_CENTER } from "./ego";
import { palette } from "./style";

export function createScene(container: HTMLElement) {
  // No scene background: the canvas is transparent so the page's CSS gradient
  // (--bg-top to --bg-bottom, design section 6.5) shows behind the road.
  const scene = new THREE.Scene();

  // 45° vertical field of view (design section 7).
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, -14);
  camera.lookAt(0, 0, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // Draw at the screen's own pixels: browser zoom raises devicePixelRatio, and
  // without this the scene would be drawn smaller and stretched.
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.radius = 4;
  light.shadow.bias = -0.001;
  // Shadow camera covers a ±40 m box around the ego; main.ts moves it each frame.
  light.shadow.camera.left = -40;
  light.shadow.camera.right = 40;
  light.shadow.camera.top = 40;
  light.shadow.camera.bottom = -40;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 100;
  scene.add(light);
  scene.add(light.target); // must be in scene for updateMatrixWorld to be called
  const ambient = new THREE.AmbientLight(palette.ambient, 0.4);
  scene.add(ambient);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 600),
    new THREE.MeshStandardMaterial({ color: palette.road }),
  );
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  scene.add(road);

  // Ego vehicle: main.ts replaces this placeholder box with car.glb once loaded.
  const egoGroup = new THREE.Group();
  const egoBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.5, 4.5),
    new THREE.MeshStandardMaterial({ color: palette.ego }),
  );
  egoBox.position.z = EGO_REAR_AXLE_TO_CENTER;
  egoBox.castShadow = true;
  egoGroup.add(egoBox);
  egoGroup.position.y = 0.75;
  scene.add(egoGroup);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, egoMesh: egoGroup, road, light, ambient };
}
