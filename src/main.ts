import * as THREE from "three";
import { fetchConfig } from "./config";
import { connectEndpoint } from "./ws";
import {
  setRoles,
  recordMessage,
  closeEndpoint,
  liveEndpoints,
  closedEndpoints,
  latestByRole,
  allByRole,
} from "./state";
import { createScene } from "./scene";
import { createCameraController, type CameraController } from "./camera";
import { mapToScene, yawToSceneRotation } from "./frames";
import { ObjectManager, type RawObject } from "./objects";
import { replaceEgoMesh } from "./ego";
import { Hud, type HudData } from "./hud";
import { AlertPill, type ActiveAlert } from "./alert";
import { LaneManager, type RawLane } from "./lanes";
import { TrajectoryRibbon } from "./trajectory";

type PoseMap = { x: number; y: number; yaw: number };
type EgoMsg = {
  pose_map?: PoseMap;
  speed_mps: number;
  steer_rad?: number;
  accel_mps2?: number;
};
type MapFeature = { kind: string; pts: [number, number][] };
type MapMsg = { features: MapFeature[]; t_ms: number };
type ObjectsMsg = { frame: "ego" | "map"; objects: RawObject[]; t_ms: number };
type LanesMsg = { frame: "ego" | "map"; lanes: RawLane[]; t_ms: number };
type TrajMsg = { frame: "ego" | "map"; pts: [number, number][]; width_m?: number; t_ms: number };
type RawAlertEntry = { code: string; severity: string; text: string; target?: string };
type AlertsMsg = { alerts: RawAlertEntry[] };
type StatusMsg = {
  name?: string;
  device?: string;
  mode?: string;
  latency_ms?: number;
  speed_limit_mps?: number;
};

const status = document.getElementById("status")!;
const rejected = new Map<string, number>();
let pendingNames: string[] = [];

// Roles per endpoint — needed in onClose to distinguish stack vs. other endpoint closes.
const endpointRoles = new Map<string, string[]>();

function renderStatus() {
  if (rejected.size > 0) {
    const [name, schema] = [...rejected.entries()][0];
    status.textContent = `${name}: unsupported schema ${schema}`;
    return;
  }
  const live = liveEndpoints();
  const lost = closedEndpoints();
  if (live.length === 0 && lost.length === 0) {
    status.textContent = `Waiting for vehicle... ${pendingNames.join(", ")}`;
    return;
  }
  const parts: string[] = [];
  if (live.length > 0) parts.push(`Connected: ${live.join(", ")}`);
  if (lost.length > 0) parts.push(`lost: ${lost.join(", ")}`);
  status.textContent = parts.join(" | ");
}

// --- scene bootstrap ---
const container = document.getElementById("scene")!;
const { scene, camera, renderer, egoMesh, road, light } = createScene(container);

let cameraController: CameraController | null = null;

const objManager = new ObjectManager(scene);
const laneManager = new LaneManager(scene);
const trajectory = new TrajectoryRibbon(scene);
const hud = new Hud();
const alertPill = new AlertPill();

objManager.load().catch((e: unknown) => {
  console.warn("mesh load failed:", e);
});

replaceEgoMesh(egoMesh as THREE.Group).catch((e: unknown) => {
  console.warn("ego mesh load failed:", e);
});

// Map geometry: rebuilt only when a new map message arrives.
const DRAWABLE_KINDS = new Set(["lane_solid", "lane_dashed", "road_edge"]);
const mapLineMaterial = new THREE.LineBasicMaterial({ color: 0x4b5661 });
const mapLines: THREE.Line[] = [];
let lastMapTms: number | undefined;

function rebuildMapGeometry(mapMsg: MapMsg) {
  for (const line of mapLines) {
    line.geometry.dispose();
    scene.remove(line);
  }
  mapLines.length = 0;

  for (const feature of mapMsg.features) {
    if (!DRAWABLE_KINDS.has(feature.kind)) continue;
    const pts = feature.pts;
    if (pts.length < 2) continue;

    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      const s = mapToScene(pts[i][0], pts[i][1]);
      positions[i * 3] = s.x;
      positions[i * 3 + 1] = 0.01;
      positions[i * 3 + 2] = s.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geom, mapLineMaterial);
    scene.add(line);
    mapLines.push(line);
  }
}

// Last known ego scene pose; persisted so ego-frame objects and lanes can
// be updated in tick() even when pose_map is absent in the current frame.
let egoSceneX = 0;
let egoSceneZ = 0;
let egoRawYaw = 0;

let lastObjectsTms: number | undefined;
let lastLanesTms: number | undefined;
let lastTrajTms: number | undefined;
let lastTime: number | null = null;
let units: "mph" | "km/h" = "km/h";

// Multiplier from m/s to the configured display unit.
function toDisplay(mps: number) {
  return mps * (units === "mph" ? 2.237 : 3.6);
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now() / 1000;
  const dt = lastTime !== null ? now - lastTime : 0;
  lastTime = now;

  // --- ego vehicle ---
  const rawEgo = latestByRole("vehicle", "ego");
  let speedMps = 0;
  let steerRad = 0;
  let accelMps2 = 0;

  if (rawEgo) {
    const ego = rawEgo as unknown as EgoMsg;
    speedMps = ego.speed_mps;
    steerRad = ego.steer_rad ?? 0;
    accelMps2 = ego.accel_mps2 ?? 0;

    if (ego.pose_map) {
      const { x, y, yaw } = ego.pose_map;
      const s = mapToScene(x, y);
      egoSceneX = s.x;
      egoSceneZ = s.z;
      egoRawYaw = yaw;

      egoMesh.position.x = s.x;
      egoMesh.position.z = s.z;
      egoMesh.rotation.y = yawToSceneRotation(yaw);

      road.position.x = s.x;
      road.position.z = s.z;

      cameraController?.update(s.x, egoMesh.position.y, s.z, yaw);

      light.position.set(s.x + 15, 25, s.z + 10);
      light.target.position.set(s.x, 0, s.z);
      light.target.updateMatrixWorld();
      light.shadow.camera.updateProjectionMatrix();

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

  // --- objects (outside pose_map block: ego-frame objects need updating even
  //     when the vehicle endpoint has no pose_map this frame) ---
  const rawObjects = latestByRole("stack", "objects");
  if (rawObjects) {
    const om = rawObjects as unknown as ObjectsMsg;
    if (om.t_ms !== lastObjectsTms) {
      lastObjectsTms = om.t_ms;
      objManager.update(om.objects, om.frame);
    }
  }

  // --- perceived lanes ---
  const rawLanes = latestByRole("stack", "lanes");
  if (rawLanes) {
    const lm = rawLanes as unknown as LanesMsg;
    if (lm.t_ms !== lastLanesTms) {
      lastLanesTms = lm.t_ms;
      laneManager.setMsg(lm.lanes, lm.frame);
    }
  }
  laneManager.rebuild(egoSceneX, egoSceneZ, egoRawYaw);

  // --- trajectory ---
  const rawTraj = latestByRole("stack", "trajectory");
  if (rawTraj) {
    const tm = rawTraj as unknown as TrajMsg;
    if (tm.t_ms !== lastTrajTms) {
      lastTrajTms = tm.t_ms;
      trajectory.setMsg(tm.pts, tm.width_m, tm.frame);
    }
  }
  trajectory.rebuild(egoSceneX, egoSceneZ, egoRawYaw);

  // --- alerts: union across all stack/supervisor endpoints ---
  const alertMsgs = [
    ...allByRole("stack", "alerts"),
    ...allByRole("supervisor", "alerts"),
  ] as unknown as AlertsMsg[];

  const allAlerts: RawAlertEntry[] = alertMsgs.flatMap((m) => m.alerts ?? []);
  const activeAlerts: ActiveAlert[] = allAlerts
    .filter((a) => a.severity === "warn" || a.severity === "critical")
    .map((a) => ({
      code: a.code,
      severity: a.severity as "warn" | "critical",
      text: a.text,
      target: a.target,
    }));

  alertPill.setAlerts(activeAlerts);

  // Apply alert targets to scene objects.
  const targets = new Set(activeAlerts.map((a) => a.target).filter(Boolean) as string[]);
  objManager.setLeadAlert(targets.has("lead"));
  trajectory.setAlert(targets.has("trajectory"));
  laneManager.setAlertKind(
    targets.has("lane_left") ? "left" : targets.has("lane_right") ? "right" : null,
  );

  // --- stack status: speed limit and status line ---
  const rawStatus = latestByRole("stack", "status") as unknown as StatusMsg | undefined;
  const limitMps = rawStatus?.speed_limit_mps ?? null;
  const statusLine = rawStatus
    ? [
        rawStatus.name,
        rawStatus.latency_ms != null ? `${rawStatus.latency_ms} ms` : null,
        rawStatus.device,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  // --- lead vehicle info ---
  const objects = rawObjects ? ((rawObjects as unknown as ObjectsMsg).objects ?? []) : [];
  const leadObj = objects.find((o) => o.lead);
  let leadDistM: number | null = null;
  let leadGapS: number | null = null;
  if (leadObj) {
    leadDistM =
      leadObj.distance_m != null
        ? leadObj.distance_m
        : Math.sqrt(leadObj.x * leadObj.x + leadObj.y * leadObj.y);
    if (speedMps >= 0.5) {
      leadGapS = leadDistM / speedMps;
    }
  }

  // --- HUD ---
  const hudData: HudData = {
    speedDisplay: toDisplay(speedMps),
    units,
    limitDisplay: limitMps !== null ? toDisplay(limitMps) : null,
    leadDistM,
    leadGapS,
    steeringRad: steerRad,
    accelMps2,
    statusLine,
  };
  hud.update(hudData);

  objManager.tick(dt, egoSceneX, egoSceneZ, egoRawYaw);
  alertPill.tick(dt);
  renderer.render(scene, camera);
}
animate();

// --- connection setup ---
fetchConfig()
  .then((c) => {
    pendingNames = Object.keys(c.endpoints);
    units = c.units;
    renderStatus();

    cameraController = createCameraController(camera, c.camera);

    for (const [name, url] of Object.entries(c.endpoints)) {
      connectEndpoint(name, url, {
        onHello: (n, hello) => {
          endpointRoles.set(n, hello.roles);
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
        onClose: (n) => {
          closeEndpoint(n);
          if ((endpointRoles.get(n) ?? []).includes("stack")) {
            objManager.stackLost();
            laneManager.clear();
            trajectory.clear();
          }
          renderStatus();
        },
      });
    }
  })
  .catch((e: unknown) => {
    status.textContent = `config.json not loaded: ${String(e)}`;
  });
