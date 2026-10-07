// Coordinate frame mapping between the message schema and three.js world space.
//
// Message schema frames (design doc section 5.1):
//   ego / map: x-forward, y-left, z-up
//
// three.js world:
//   x-right, y-up, z-forward (into scene)
//
// The chase camera looks along +z with +y up, so screen-right is world -x.
// To place ego-left (+y) on screen-left we need scene.x = +y (not -y).
//
// Derived mapping for the ground plane:
//   scene.x =  frame.y   (ego left = world +x = screen left with chase camera)
//   scene.z =  frame.x   (ego forward = world +z)

export function mapToScene(x: number, y: number): { x: number; z: number } {
  return { x: y, z: x };
}

// Ego yaw is CCW-positive around z-up.
// three.js rotation.y is CCW-positive around y-up; at rotation.y=0 the mesh
// faces +z. A left turn (positive yaw in ego) rotates toward world +x, which
// is a positive rotation.y.
export function yawToSceneRotation(yaw: number): number {
  return yaw;
}

// Unit heading vector in scene space derived from ego yaw.
// yaw=0    → heading (0, 1) in (x,z)  i.e. +z (forward)
// yaw=π/2  → heading (1, 0)  i.e. +x (left turn)
export function headingFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}
