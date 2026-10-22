// Scene values shared by the stack layers (design sections 6.3 and 6.5).
export const ALERT_COLOR = 0xb91c1c;
// Stack lost: the stack layers fade to this opacity over STACK_LOST_FADE_S.
export const STACK_LOST_OPACITY = 0.15;
export const STACK_LOST_FADE_S = 0.5;

// Toggle a material's transparency. three.js compiles an opaque material with
// alpha forced to 1, so the program must be rebuilt when the flag changes, or
// the stack lost opacity has no effect on screen.
export function setTransparent(mat: { transparent: boolean; needsUpdate: boolean }, on: boolean) {
  if (mat.transparent === on) return;
  mat.transparent = on;
  mat.needsUpdate = true;
}
