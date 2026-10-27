// Road paint geometry (design section 6.5). WebGL draws a THREE.Line 1 px wide
// at any distance, so lane lines are flat triangle strips with a width in
// meters instead: they look like paint and get thinner with distance.
// Points are scene x and z on the ground plane.

export type Pt = { x: number; z: number };

// Cut a polyline into dashes of `dash` meters with `gap` meters between them,
// measured along the line. A dash keeps the polyline's vertices inside it.
export function dashes(pts: Pt[], dash: number, gap: number): Pt[][] {
  const cum = [0]; // distance along the line at each point
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = cum[cum.length - 1];

  // The point at distance d. Calls come in increasing d, so the segment index
  // only moves forward: segment i runs from pts[i - 1] to pts[i].
  let i = 1;
  const at = (d: number): Pt => {
    while (i < pts.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const a = pts[i - 1];
    const b = pts[i];
    return { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) };
  };

  const out: Pt[][] = [];
  for (let start = 0; start < total; start += dash + gap) {
    const end = Math.min(start + dash, total);
    const line = [at(start)];
    for (let j = i; j < pts.length && cum[j] < end; j++) if (cum[j] > start) line.push(pts[j]);
    line.push(at(end));
    out.push(line);
  }
  return out;
}

// A flat strip `width` meters wide along the polyline at height y: two
// triangles per segment, as x, y, z positions for a non-indexed geometry,
// appended to `out`. Draw it with side: THREE.DoubleSide.
// ponytail: segments do not join, so a sharp corner shows a small notch on
// its outer side. At 0.15 m wide and 5 m between map points it does not show.
export function strip(pts: Pt[], width: number, y: number, out: number[] = []): number[] {
  const hw = width / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Half the width, perpendicular to the segment on the ground.
    const ox = ((a.z - b.z) / len) * hw;
    const oz = ((b.x - a.x) / len) * hw;
    for (const [p, s] of [
      [a, 1],
      [a, -1],
      [b, 1],
      [a, -1],
      [b, -1],
      [b, 1],
    ] as const) {
      out.push(p.x + s * ox, y, p.z + s * oz);
    }
  }
  return out;
}
