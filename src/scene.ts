import * as THREE from "three";

export function createScene(container: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14); // design section 6.5 background token

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000, // far enough for a 400 m map
  );
  // Placeholder position until the first ego message drives the chase camera.
  camera.position.set(0, 8, -14);
  camera.lookAt(0, 0, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(10, 20, 10);
  light.castShadow = true;
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x334455, 0.4));

  // Road plane: 100 m wide, 600 m long — covers the full kill-route map extent.
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 600),
    new THREE.MeshStandardMaterial({ color: 0x161d26 }), // road token from 6.5
  );
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  scene.add(road);

  // Placeholder ego vehicle box (W2 replaces with .glb mesh).
  // Sized roughly to a car: 4.5 m long, 1.8 m wide, 1.5 m tall.
  const egoMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.5, 4.5), // width, height, length
    new THREE.MeshStandardMaterial({ color: 0xd9d9d9 }), // ego token from 6.5
  );
  egoMesh.position.y = 0.75; // sit on the road plane
  egoMesh.castShadow = true;
  scene.add(egoMesh);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, egoMesh };
}
