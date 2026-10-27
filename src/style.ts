// Scene values shared by the stack layers (design sections 6.3 and 6.5).
// Stack lost: the stack layers fade to this opacity over STACK_LOST_FADE_S.
export const STACK_LOST_OPACITY = 0.15;
export const STACK_LOST_FADE_S = 0.5;

// Painted lines on the road (design section 6.5): lane lines, road edges and
// the lead vehicle ring are this wide. A dashed lane is DASH_M on, GAP_M off.
export const LINE_WIDTH_M = 0.15;
export const DASH_M = 3;
export const GAP_M = 6;

// Toggle a material's transparency. three.js compiles an opaque material with
// alpha forced to 1, so the program must be rebuilt when the flag changes, or
// the stack lost opacity has no effect on screen.
export function setTransparent(mat: { transparent: boolean; needsUpdate: boolean }, on: boolean) {
  if (mat.transparent === on) return;
  mat.transparent = on;
  mat.needsUpdate = true;
}

// Scene colors (design section 6.5). index.html defines every color as a CSS
// custom property, and theme.ts copies the active theme's values in here, so
// the light theme only redefines tokens. The defaults are the dark theme.
export const palette = {
  road: 0x161d26,
  mapLane: 0x4b5661,
  lane: 0x22d3ee,
  traj: 0x22c55e,
  traffic: 0x3b82f6,
  lead: 0xef4444,
  ego: 0xd9d9d9,
  alert: 0xb91c1c,
  ambient: 0x334455,
};

export type Palette = typeof palette;

export const PALETTE_TOKENS: Record<keyof Palette, string> = {
  road: "--road",
  mapLane: "--map-lane",
  lane: "--lane",
  traj: "--traj",
  traffic: "--traffic",
  lead: "--lead",
  ego: "--ego",
  alert: "--alert",
  ambient: "--ambient",
};

// Parse "#rrggbb" or "#rgb". Returns null for anything else.
export function parseHex(value: string): number | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return parseInt(v.slice(1), 16);
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return parseInt([...v.slice(1)].map((c) => c + c).join(""), 16);
  }
  return null;
}

// Copy the palette from CSS custom properties. `get` returns a token's value,
// for example getComputedStyle(root).getPropertyValue. A token that is missing
// or not a hex color keeps its current value.
export function loadPalette(get: (token: string) => string): void {
  for (const key of Object.keys(PALETTE_TOKENS) as (keyof Palette)[]) {
    const hex = parseHex(get(PALETTE_TOKENS[key]));
    if (hex !== null) palette[key] = hex;
  }
}

// "#rrggbb" for canvas text.
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
