import * as THREE from "three";
import { fetchConfig } from "./config";
import { connectEndpoint } from "./ws";
import { setRoles, recordMessage, getState, latestByRole } from "./state";
import { createScene } from "./scene";
import { createCameraController, type CameraController } from "./camera";
import { mapToScene, yawToSceneRotation } from "./frames";

type PoseMap = { x: number; y: number; yaw: number };
type EgoMsg = { pose_map?: PoseMap; speed_mps: number };
type MapFeature = { kind: string; pts: [number, number][] };
type MapMsg = { features: MapFeature[]; t_ms: number };

const status = document.getElementById("status")!;
const rejected = new Map<string, number>();
let pendingNames: string[] = [];

function renderStatus() {
  if (rejected.size > 0) {
    const [name, schema] = [...rejected.entries()][0];
    status.textContent = `${name}: unsupported schema ${schema}`;
    return;
  }
  const connected = [...getState().keys()];
  if (connected.length === 0) {
    status.textContent = `Waiting for vehicle... ${pendingNames.join(", ")}`;
    return;
  }
  status.textContent = `Connected: ${connected.join(", ")}`;
}

// --- scene bootstrap ---
const container = document.getElementById("scene")!;
const { scene, camera, renderer, egoMesh } = createScene(container);

let cameraController: CameraController | null = null;

// Map geometry: rebuilt only when a new map message arrives (not every frame).
const DRAWABLE_KINDS = new Set(["lane_solid", "lane_dashed", "road_edge"]);
const mapLineMaterial = new THREE.LineBasicMaterial({ color: 0x4b5661 }); // map lanes 6.5
const mapLines: THREE.Object3D[] = [];
let lastMapTms: number | undefined;

function rebuildMapGeometry(mapMsg: MapMsg) {
  for (const line of mapLines) scene.remove(line);
  mapLines.length = 0;

  for (const feature of mapMsg.features) {
    if (!DRAWABLE_KINDS.has(feature.kind)) continue; // silently ignore reserved kinds
    const pts = feature.pts;
    if (pts.length < 2) continue;

    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      const s = mapToScene(pts[i][0], pts[i][1]);
      positions[i * 3] = s.x;
      positions[i * 3 + 1] = 0.01; // slightly above road to prevent z-fighting
      positions[i * 3 + 2] = s.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geom, mapLineMaterial);
    scene.add(line);
    mapLines.push(line);
  }
}

function animate() {
  requestAnimationFrame(animate);

  const rawEgo = latestByRole("vehicle", "ego");
  if (rawEgo) {
    const ego = rawEgo as unknown as EgoMsg;
    if (ego.pose_map) {
      const { x, y, yaw } = ego.pose_map;
      const s = mapToScene(x, y);

      egoMesh.position.x = s.x;
      egoMesh.position.z = s.z;
      egoMesh.rotation.y = yawToSceneRotation(yaw);

      cameraController?.update(s.x, egoMesh.position.y, s.z, yaw);

      // Rebuild map geometry when a new map message arrives and ego pose is known.
      const rawMap = latestByRole("map", "map");
      if (rawMap) {
        const mapMsg = rawMap as unknown as MapMsg;
        if (mapMsg.t_ms !== lastMapTms) {
          lastMapTms = mapMsg.t_ms;
          rebuildMapGeometry(mapMsg);
        }
      }
    }
  }

  renderer.render(scene, camera);
}
animate();

// --- connection setup ---
fetchConfig()
  .then((c) => {
    pendingNames = Object.keys(c.endpoints);
    renderStatus();

    cameraController = createCameraController(camera, c.camera);

    for (const [name, url] of Object.entries(c.endpoints)) {
      connectEndpoint(name, url, {
        onHello: (n, hello) => {
          setRoles(n, hello.roles);
          renderStatus();
        },
        onSchemaMismatch: (n, schema) => {
          rejected.set(n, schema);
          renderStatus();
        },
        onMessage: (n, msg) => {
          recordMessage(n, msg);
        },
        onClose: () => {
          renderStatus();
        },
      });
    }
  })
  .catch((e: unknown) => {
    status.textContent = `config.json not loaded: ${String(e)}`;
  });

(window as unknown as { getState: typeof getState }).getState = getState;
