// Coordinate frame mapping between the message schema and three.js world space.
//
// Message schema frames (design doc section 5.1):
//   ego / map: x-forward, y-left, z-up
//
// three.js world:
//   x-right, y-up, z-forward (into scene, toward viewer is -z)
//
// Derived mapping for the ground plane (z-up collapses to y=0):
//   scene.x = -frame.y   (left in ego/map = -x in three.js)
//   scene.z =  frame.x   (forward in ego/map = +z in three.js)

export function mapToScene(x: number, y: number): { x: number; z: number } {
  return { x: -y, z: x };
}

// Ego yaw is CCW-positive around z-up (looking from above).
// three.js rotation.y is CCW-positive around y-up; at rotation.y=0 the mesh
// faces +z (forward in our scene). A left turn (positive yaw in ego) rotates
// the mesh away from +z toward -x, which is a negative rotation.y.
export function yawToSceneRotation(yaw: number): number {
  return -yaw;
}

// Unit heading vector in scene space derived from ego yaw.
// yaw=0  → heading (0, 1) in (x,z)  i.e. +z
// yaw=π/2 (left) → heading (-1, 0)  i.e. -x
export function headingFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: Math.cos(yaw) };
}
