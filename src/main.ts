import * as THREE from "three";
import { fetchConfig } from "./config";
import { connectEndpoint } from "./ws";
import { isWellFormed } from "./messages";
import {
  setRoles,
  recordMessage,
  closeEndpoint,
  latestByRole,
  allByRole,
  newestOfType,
  roleLost,
  roleName,
  clearType,
} from "./state";
import { createScene } from "./scene";
import { createCameraController, type CameraController } from "./camera";
import { mapToScene, yawToSceneRotation } from "./frames";
import { ObjectManager, type RawObject } from "./objects";
import { replaceEgoMesh } from "./ego";
import { Hud, scaleWithViewport, type HudData } from "./hud";
import { AlertPill, collectAlerts, type Banner } from "./alert";
import { LaneManager, type RawLane } from "./lanes";
import { TrajectoryRibbon } from "./trajectory";
import { StateMachine, isGhost, readInputs, type PageState } from "./states";
import { CameraPip } from "./pip";
import { bindKeys, toggleFullscreen } from "./keys";
import { applyTheme, type Theme } from "./theme";
import { palette } from "./style";

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
type ControlMsg = { authority?: string; accel_mps2?: number };
type StatusMsg = {
  name?: string;
  device?: string;
  mode?: string;
  latency_ms?: number;
  speed_limit_mps?: number;
};

const status = document.getElementById("status")!;
const credit = document.getElementById("credit")!;
const frameEl = document.getElementById("frame")!;
const rejected = new Map<string, number>();
let configError: string | null = null;

// Bottom-left line (design section 6.3): the schema rejection reason,
// "Waiting for vehicle..." while Connecting, or "vehicle link lost".
function statusText(state: PageState): string {
  if (configError) return configError;
  if (rejected.size > 0) {
    const [name, schema] = [...rejected.entries()][0];
    return `${name}: unsupported schema ${schema}`;
  }
  if (state === "connecting") return "Waiting for vehicle...";
  if (roleLost("vehicle")) return "vehicle link lost";
  return "";
}

// "<name> · <latency_ms> ms · <device>" (design section 6.4).
function statusLineOf(s: StatusMsg | undefined, extra: string | null = null): string {
  if (!s) return "";
  return [s.name, s.latency_ms != null ? `${s.latency_ms} ms` : null, s.device, extra]
    .filter(Boolean)
    .join(" · ");
}

// Signed acceleration with a typographic minus, e.g. "−3.0 m/s²".
function fmtAccel(a: number): string {
  return `${a < 0 ? "−" : ""}${Math.abs(a).toFixed(1)} m/s²`;
}

// --- scene bootstrap ---
const container = document.getElementById("scene")!;
const { scene, camera, renderer, egoMesh, road, light, ambient } = createScene(container);

let cameraController: CameraController | null = null;

const objManager = new ObjectManager(scene);
const laneManager = new LaneManager(scene);
const trajectory = new TrajectoryRibbon(scene);
const hud = new Hud();
scaleWithViewport(document.getElementById("bottom-left")!);
const alertPill = new AlertPill();
const machine = new StateMachine();
const pip = new CameraPip();

objManager.load().catch((e: unknown) => {
  console.warn("mesh load failed:", e);
});

replaceEgoMesh(egoMesh as THREE.Group).catch((e: unknown) => {
  console.warn("ego mesh load failed:", e);
});

// Map geometry: rebuilt only when a new map message arrives.
const DRAWABLE_KINDS = new Set(["lane_solid", "lane_dashed", "road_edge"]);
const mapLineMaterial = new THREE.LineBasicMaterial({ color: palette.mapLane });
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

// --- theme (key t, design section 6.5) ---
let theme: Theme = "dark";

function setTheme(t: Theme) {
  theme = t;
  applyTheme(t);
  (road.material as THREE.MeshStandardMaterial).color.setHex(palette.road);
  mapLineMaterial.color.setHex(palette.mapLane);
  ambient.color.setHex(palette.ambient);
  egoMesh.traverse((child) => {
    const m = child as THREE.Mesh;
    if (m.isMesh) (m.material as THREE.MeshStandardMaterial).color.setHex(palette.ego);
  });
  objManager.refreshColors();
  // Lanes and the trajectory re-read the palette every frame with their alert colors.
}
setTheme(theme);

// --- operator keys (design section 7) ---
bindKeys((action) => {
  switch (action) {
    case "pip":
      pip.toggleMinimized();
      break;
    case "theme":
      setTheme(theme === "dark" ? "light" : "dark");
      break;
    case "fullscreen":
      toggleFullscreen();
      break;
    case "chase":
    case "high":
      cameraController?.setPreset(action);
      break;
    case "reset":
      // Clear Stopped and the alerts (design section 7). A closed endpoint's
      // last control is cleared too, for example a supervisor at the end of a
      // replay, or it would put the page straight back into Stopped. A live
      // endpoint keeps its authority, which it may send only on change.
      machine.reset();
      clearType("alerts");
      clearType("control", true);
      alertPill.reset();
      break;
  }
});

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
let wasGhost = false;
let lastStatusText = "";

// Multiplier from m/s to the configured display unit.
function toDisplay(mps: number) {
  return mps * (units === "mph" ? 2.237 : 3.6);
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now() / 1000;
  const dt = lastTime !== null ? now - lastTime : 0;
  lastTime = now;
  let egoPoseChanged = false;

  // --- alerts: union across all stack/supervisor endpoints ---
  alertPill.setAlerts(
    collectAlerts([...allByRole("stack", "alerts"), ...allByRole("supervisor", "alerts")]),
  );

  // --- page state (design section 6.3) ---
  const state = machine.update(readInputs(alertPill.held.length > 0), dt);
  const takeoverLook = state === "takeover" || state === "stopped";

  // Stack lost, Takeover and Stopped: the stack layers fade to ghosts and hold.
  // They come back with the first stack message after the state ends.
  const ghost = isGhost(state);
  if (ghost && !wasGhost) {
    objManager.stackLost();
    laneManager.stackLost();
    trajectory.stackLost();
  }
  wasGhost = ghost;

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
      egoPoseChanged = s.x !== egoSceneX || s.z !== egoSceneZ || yaw !== egoRawYaw;
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
  if (rawObjects && !ghost) {
    const om = rawObjects as unknown as ObjectsMsg;
    if (om.t_ms !== lastObjectsTms) {
      lastObjectsTms = om.t_ms;
      objManager.update(om.objects, om.frame);
    }
  }

  // --- perceived lanes ---
  let lanesUpdated = false;
  const rawLanes = latestByRole("stack", "lanes");
  if (rawLanes && !ghost) {
    const lm = rawLanes as unknown as LanesMsg;
    if (lm.t_ms !== lastLanesTms) {
      lastLanesTms = lm.t_ms;
      laneManager.setMsg(lm.lanes, lm.frame);
      lanesUpdated = true;
    }
  }
  // Map-frame geometry and a lost stack's ghost change only with a new message.
  if (lanesUpdated || (egoPoseChanged && laneManager.followsEgo)) {
    laneManager.rebuild(egoSceneX, egoSceneZ, egoRawYaw);
  }

  // --- trajectory ---
  let trajUpdated = false;
  const rawTraj = latestByRole("stack", "trajectory");
  if (rawTraj && !ghost) {
    const tm = rawTraj as unknown as TrajMsg;
    if (tm.t_ms !== lastTrajTms) {
      lastTrajTms = tm.t_ms;
      trajectory.setMsg(tm.pts, tm.width_m, tm.frame);
      trajUpdated = true;
    }
  }
  if (trajUpdated || (egoPoseChanged && trajectory.followsEgo)) {
    trajectory.rebuild(egoSceneX, egoSceneZ, egoRawYaw);
  }

  // Apply alert targets to scene objects using the held list so the 500 ms
  // hold also covers the ring, trajectory, and lane colors (design §6.3).
  const targets = new Set(alertPill.held.map((a) => a.target).filter(Boolean) as string[]);
  objManager.setLeadAlert(targets.has("lead"));
  trajectory.setAlert(targets.has("trajectory"));
  laneManager.setAlertKinds(["left", "right"].filter((kind) => targets.has(`lane_${kind}`)));

  // --- who has control (Takeover and Stopped) ---
  const control = newestOfType("control") as ControlMsg | undefined;
  const supervisorName = roleName("supervisor") ?? "supervisor";
  const supervisorStatus = latestByRole("supervisor", "status") as StatusMsg | undefined;
  const controlAccel = control?.accel_mps2 ?? 0;

  // --- pill: a state message replaces the alert text (design §6.3) ---
  let banner: Banner | null = null;
  if (state === "stack_lost") {
    banner = { text: `${roleName("stack") ?? "Stack"} lost`, kind: "lost" };
  } else if (state === "takeover") {
    // The supervisor's own alert text, with the code in small print.
    const msg = latestByRole("supervisor", "alerts");
    const top = msg ? collectAlerts([msg])[0] : undefined;
    banner = {
      text: `⚠ ${top?.text ?? `${supervisorName} in control`}`,
      code: top?.code,
      kind: "takeover",
    };
  } else if (state === "stopped" || (machine.releaseFade > 0 && state !== "alert")) {
    // Held until the stack reports active, then a 1 s fade back to Driving.
    const opacity = state === "stopped" ? 1 : machine.releaseFade;
    banner = { text: `Stopped by ${supervisorName}`, kind: "takeover", opacity };
  }
  alertPill.setBanner(banner);

  // --- amber page frame ---
  const frameOpacity = takeoverLook ? 1 : machine.releaseFade;
  frameEl.hidden = frameOpacity === 0;
  frameEl.style.opacity = String(frameOpacity);

  // --- stack status: speed limit and status line (live stack only) ---
  const stackStatus = allByRole("stack", "status")[0] as unknown as StatusMsg | undefined;
  const limitMps = stackStatus?.speed_limit_mps ?? null;

  // --- lead vehicle info (same number as the scene label) ---
  const leadDistM = objManager.leadDistM(egoSceneX, egoSceneZ);
  const leadGapS = leadDistM !== null && speedMps >= 0.5 ? leadDistM / speedMps : null;

  // --- HUD (design §6.4). In Takeover the pedal bar shows control.accel_mps2
  //     and the status line shows the supervisor's status. ---
  let stateLine: string | null = null;
  if (state === "takeover") {
    stateLine = controlAccel < 0 ? `${supervisorName} braking` : `${supervisorName} in control`;
  } else if (state === "stopped") {
    stateLine = "Stopped in lane";
  }
  const hudData: HudData = {
    speedDisplay: toDisplay(speedMps),
    units,
    limitDisplay: limitMps !== null ? toDisplay(limitMps) : null,
    leadDistM,
    leadGapS,
    steeringRad: steerRad,
    accelMps2: takeoverLook ? controlAccel : accelMps2,
    statusLine: takeoverLook
      ? statusLineOf(supervisorStatus, state === "stopped" ? "holding" : fmtAccel(controlAccel))
      : statusLineOf(stackStatus),
    takeover: takeoverLook,
    speedFalling: state === "takeover",
    stateLine,
  };
  hud.setVisible(state !== "connecting");
  hud.update(hudData);

  // --- camera PiP, credit and the bottom-left line ---
  pip.setStackLost(ghost);
  // Design section 9: the credit shows in the Connecting state and in the light theme footer.
  credit.hidden = !(state === "connecting" || theme === "light");
  const text = statusText(state);
  if (text !== lastStatusText) {
    lastStatusText = text;
    status.textContent = text;
    status.hidden = text === "";
  }

  objManager.tick(dt, egoSceneX, egoSceneZ, egoRawYaw);
  laneManager.tick(dt);
  trajectory.tick(dt);
  alertPill.tick(dt);
  renderer.render(scene, camera);
}
animate();

// --- connection setup ---
fetchConfig()
  .then((c) => {
    units = c.units;
    setTheme(c.theme);
    pip.start(c.camera_url);

    cameraController = createCameraController(camera, c.camera);

    for (const [name, url] of Object.entries(c.endpoints)) {
      connectEndpoint(name, url, {
        onHello: (n, hello) => {
          // Clear stale scene state so ghost objects from the previous session
          // cannot slide to new positions if the reconnecting stack reuses ids.
          if (hello.roles.includes("stack")) {
            objManager.clear();
            laneManager.clear();
            trajectory.clear();
            alertPill.reset();
          }
          setRoles(n, hello.roles, hello.name);
        },
        onSchemaMismatch: (n, schema) => {
          rejected.set(n, schema);
        },
        onMessage: (n, msg) => {
          if (!isWellFormed(msg)) return; // one bad message must not stop the frame loop
          recordMessage(n, msg);
          machine.onMessage(n, msg);
        },
        onClose: (n) => {
          // The state machine sees the closed stack and ghosts its layers.
          closeEndpoint(n);
        },
      });
    }
  })
  .catch((e: unknown) => {
    configError = `config.json not loaded: ${String(e)}`;
  });
