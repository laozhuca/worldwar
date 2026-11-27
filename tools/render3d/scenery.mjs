// SDF models for the skirmish battlefields' scenery: hedgerows, thorn scrub, reed beds, date palms,
// telegraph poles, a railhead water tower, dry-stone walls, and the ground works baked into the ground
// image (duckboard tracks, a railway, paving). Same camera, light and materials as scenes.mjs.
import { sdRoundBox, sdCapsule, smin, vnoise, fbm, clamp, mix3 } from './core.mjs';

/** A well-mixed hash of its arguments (0..1): core's hash() mixes its last argument too weakly for scattering. */
function hash(...a) {
  let h = 0x811c9dc5;
  for (const v of a) { h = Math.imul(h ^ Math.floor(v * 1000 + 0.5), 0x01000193); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;
const SNOW = [0.88, 0.91, 0.96];
const snowCol = (k) => mix3(SNOW, [0.7, 0.75, 0.84], clamp(k, 0, 0.45));
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
/** A ground plane that only catches the shadow, within radius r of the middle. */
const catcher = (x, y, z, r = 0.55) => (z < -0.004 || Math.hypot(x, y) > r ? { kind: 'none' } : { kind: 'catcher' });
// Where the shadow of a point `height` up falls on the ground: away from the sun (core.mjs's light).
const SUNX = 0.62 / 0.69, SUNY = 0.38 / 0.69;
/**
 * The ground under something tall: the whole length of its shadow (a capsule from its foot to where the
 * shadow of its top falls, r wide), fading out softly at the edge rather than cut off round the foot.
 */
function shadowGround(height, r) {
  const ex = height * SUNX, ey = height * SUNY, L2 = ex * ex + ey * ey;
  const dist = (x, y) => { const t = clamp((x * ex + y * ey) / L2, 0, 1); return Math.hypot(x - ex * t, y - ey * t); };
  return {
    plane: (x, y, z) => z * 0.7 + (dist(x, y) < r ? 0 : 1),
    shade: (x, y, z) => (z < -0.004 || dist(x, y) > r ? { kind: 'none' } : { kind: 'catcher', fade: clamp((r - dist(x, y)) / (r * 0.45), 0, 1) }),
    bounds: [Math.min(-r, ex - r), Math.min(-r, ey - r), Math.max(r, ex + r), Math.max(r, ey + r)],
  };
}

// ===================================================================== hedgerow
/**
 * A stretch of thick hedge (hawthorn and hazel) filling its tile: lumpy masses of leaf on a few stems,
 * gaps showing at the foot. snow: bare twigs and snow on top in winter.
 */
export function hedgeScene(variant, snow) {
  const H = (k, j = 0) => hash(variant * 23 + 7, j, k);
  const lumps = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + H(1, k), d = 0.08 + H(2, k) * 0.26;
    const r = 0.17 + H(3, k) * 0.1;
    lumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, z: 0.2 + H(4, k) * 0.2, r });
  }
  const top = Math.max(...lumps.map((l) => l.z + l.r));
  const leaf = (x, y, z) => {
    // (outside a region the hedge lies well within: the distance to it plus that margin, still a lower bound,
    // and not so loose that shadow rays grazing it see a near miss)
    if (z > top + 0.2 || Math.hypot(x, y) > 0.85) return Math.max(z - top - 0.2, Math.hypot(x, y) - 0.85) + 0.1;
    let d = 1;
    for (const l of lumps) d = smin(d, Math.hypot(x - l.x, y - l.y, (z - l.z) * 1.15) - l.r, 0.08);
    return Math.max(d, 0.06 - z) + (fbm(x * 26, y * 26, z * 26, 3) - 0.45) * (snow ? 0.09 : 0.07) + (vnoise(x * 90, y * 90, z * 90) - 0.5) * 0.02;
  };
  const stems = (x, y, z) => { let d = 1; for (let k = 0; k < 5; k++) { const a = H(10, k) * TAU, r = H(11, k) * 0.22; d = Math.min(d, sdCapsule(x, y, z, Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2, 0.25, 0.022, 0.012)); } return d; };
  const sdf = (x, y, z) => Math.min(leaf(x, y, z), stems(x, y, z), z * 0.7 + (Math.hypot(x, y) < 0.55 ? 0 : 1));
  const shade = (x, y, z, nx, ny, nz) => {
    const dl = leaf(x, y, z), ds = stems(x, y, z);
    if (Math.min(dl, ds) > 0.02) return catcher(x, y, z);
    if (ds < dl) return { kind: 'solid', col: [0.2, 0.16, 0.12], spec: 0.02 };
    const n = fbm(x * 30, y * 30, z * 30, 3), n2 = fbm(x * 7, y * 7, z * 7, 2);
    if (snow) {
      if (nz > 0.35 && fbm(x * 14 + 3, y * 14, z * 14, 2) > 0.38) return { kind: 'solid', col: snowCol(0.5 - nz * 0.5), spec: 0.1, aoMin: 0.5 };
      return { kind: 'solid', col: mix3([0.17, 0.14, 0.11], [0.32, 0.27, 0.21], n), spec: 0.02, aoMin: 0.35 }; // bare twigs
    }
    return { kind: 'solid', col: mix3(mix3([0.12, 0.19, 0.07], [0.3, 0.4, 0.14], n), [0.36, 0.36, 0.16], clamp(n2 * 1.6 - 0.9, 0, 0.5)), spec: 0.03, aoMin: 0.4, fill: 1.15 };
  };
  return { bounds: [-0.62, -0.62, -0.05, 0.62, 0.62, top + 0.12], sdf, shade, supersample: 2 };
}

// ===================================================================== thorn scrub
/** Low thorn scrub (juniper and sumac on the karst, prickly scrub above a beach): a sprawling cushion. */
export function scrubScene(variant, snow) {
  const H = (k, j = 0) => hash(variant * 31 + 3, j, k);
  const lumps = [];
  for (let k = 0; k < 5; k++) { const a = H(1, k) * TAU, d = H(2, k) * 0.2; lumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.11 + H(3, k) * 0.08, h: 0.09 + H(4, k) * 0.08 }); }
  const twigs = [];
  for (let k = 0; k < 10; k++) { const a = H(10, k) * TAU, l = 0.18 + H(11, k) * 0.14; twigs.push([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.05, Math.cos(a) * l, Math.sin(a) * l, 0.14 + H(12, k) * 0.16]); }
  const bush = (x, y, z) => {
    if (z > 0.5 || Math.hypot(x, y) > 0.7) return Math.max(z - 0.5, Math.hypot(x, y) - 0.7) + 0.08;
    let d = 1;
    for (const l of lumps) d = smin(d, Math.hypot((x - l.x) / l.r, (y - l.y) / l.r, (z - l.h * 0.6) / l.h) - 1, 0.5);
    return d * 0.09 + (fbm(x * 34, y * 34, z * 34, 3) - 0.45) * 0.05;
  };
  const twig = (x, y, z) => { let d = 1; for (const t of twigs) d = Math.min(d, sdCapsule(x, y, z, ...t, 0.008, 0.003)); return d; };
  const sdf = (x, y, z) => Math.min(bush(x, y, z), twig(x, y, z), z * 0.7 + (Math.hypot(x, y) < 0.5 ? 0 : 1));
  const shade = (x, y, z, nx, ny, nz) => {
    const db = bush(x, y, z), dt = twig(x, y, z);
    if (Math.min(db, dt) > 0.015) return catcher(x, y, z, 0.48);
    if (dt < db) return { kind: 'solid', col: [0.22, 0.18, 0.14], spec: 0.02 };
    const n = fbm(x * 36, y * 36, z * 36, 3);
    if (snow && nz > 0.4 && fbm(x * 16, y * 16, z * 16, 2) > 0.42) return { kind: 'solid', col: snowCol(0.3), spec: 0.1, aoMin: 0.5 };
    return { kind: 'solid', col: mix3([0.2, 0.22, 0.12], [0.42, 0.42, 0.26], n), spec: 0.03, aoMin: 0.4, fill: 1.1 };
  };
  return { bounds: [-0.55, -0.55, -0.04, 0.55, 0.55, 0.42], sdf, shade, supersample: 2 };
}

// ===================================================================== reed bed
/** A reed bed at the water's edge: tall leaning blades, brown seed heads; pale straw and snow in winter. */
export function reedsScene(variant, snow) {
  const H = (k, j = 0) => hash(variant * 37 + 11, j, k);
  const blades = [];
  for (let k = 0; k < 70; k++) {
    const x = (H(1, k) - 0.5) * 0.8, y = (H(2, k) - 0.5) * 0.8, h = 0.32 + H(3, k) * 0.36, lx = (H(4, k) - 0.5) * 0.16 + 0.05, ly = (H(5, k) - 0.5) * 0.16;
    blades.push({ x, y, h, lx, ly, head: H(6, k) < 0.3 });
  }
  const blade = (x, y, z) => {
    if (z > 0.9 || Math.abs(x) > 0.72 || Math.abs(y) > 0.72) return Math.max(z - 0.9, Math.abs(x) - 0.72, Math.abs(y) - 0.72) + 0.12;
    let d = 0.15;
    for (const b of blades) {
      if (Math.abs(x - b.x) > 0.3 || Math.abs(y - b.y) > 0.3) continue; // (a blade leans at most 0.13 off its foot: skipped ones are over 0.15 away)
      d = Math.min(d, sdCapsule(x, y, z, b.x, b.y, 0, b.x + b.lx, b.y + b.ly, b.h, 0.016, 0.004));
      if (b.head) d = Math.min(d, sdCapsule(x, y, z, b.x + b.lx * 0.86, b.y + b.ly * 0.86, b.h * 0.8, b.x + b.lx * 0.97, b.y + b.ly * 0.97, b.h * 0.95, 0.016));
    }
    return d;
  };
  const sdf = (x, y, z) => Math.min(blade(x, y, z), z * 0.7 + (Math.hypot(x, y) < 0.56 ? 0 : 1));
  const shade = (x, y, z, nx, ny, nz) => {
    if (blade(x, y, z) > 0.01) return z < -0.004 || Math.hypot(x, y) > 0.56 ? { kind: 'none' } : { kind: 'catcher', fade: clamp((0.56 - Math.hypot(x, y)) / 0.25, 0, 1) };
    const b = blades.reduce((m, q) => (Math.hypot(q.x + q.lx * (z / q.h) - x, q.y + q.ly * (z / q.h) - y) < Math.hypot(m.x + m.lx * (z / m.h) - x, m.y + m.ly * (z / m.h) - y) ? q : m), blades[0]);
    const k = z / b.h;
    if (b.head && k > 0.78) return { kind: 'solid', col: [0.3, 0.2, 0.12], spec: 0.04 };
    if (snow && nz > 0.3) return { kind: 'solid', col: SNOW, spec: 0.1 };
    const n = fbm(x * 40, y * 40, z * 20, 2);
    const col = snow ? mix3([0.5, 0.44, 0.32], [0.72, 0.66, 0.5], n) : mix3(mix3([0.26, 0.32, 0.12], [0.46, 0.5, 0.22], n), [0.62, 0.55, 0.34], clamp(k - 0.5, 0, 0.5));
    return { kind: 'solid', col, spec: 0.04, aoMin: 0.45, fill: 1.15 };
  };
  return { bounds: [-0.58, -0.58, -0.04, 0.68, 0.58, 0.78], sdf, shade, supersample: 2 };
}

// ===================================================================== date palm
/** A date palm: a tall ringed trunk, leaning and curving, a crown of drooping fronds, clusters of dates. */
export function palmScene(variant) {
  const H = (k, j = 0) => hash(variant * 41 + 13, j, k);
  const h = 1.5 + H(1) * 0.6, lx = (H(2) - 0.5) * 0.5, ly = (H(3) - 0.5) * 0.5;
  const axis = (z) => { const t = z / h; return [lx * t * t, ly * t * t]; };
  const [tx, ty] = axis(h);
  const trunk = (x, y, z) => {
    if (z > h + 0.05) return z - h;
    const [ax, ay] = axis(z), r = 0.055 - 0.015 * (z / h);
    const ring = Math.abs(((z * 14) % 1) - 0.5) * 0.012; // the scars of old fronds
    return Math.max(Math.hypot(x - ax, y - ay) - r - ring, -z);
  };
  // fronds: each a chain of segments rising out and drooping, flattened into a blade
  const fronds = [];
  const nf = 13;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * TAU + H(10, k) * 0.4, len = 0.65 + H(11, k) * 0.3, rise = 0.18 + H(12, k) * 0.22;
    const pts = [];
    for (let s = 0; s <= 5; s++) { const t = s / 5, r = len * t; pts.push([tx + Math.cos(a) * r, ty + Math.sin(a) * r, h + rise * Math.sin(t * Math.PI * 0.8) - t * t * (0.3 + H(13, k) * 0.35)]); }
    fronds.push({ pts, a });
  }
  const frond = (x, y, z) => {
    if (z < h - 0.95 || Math.hypot(x - tx, y - ty) > 1.25) return Math.max(h - 0.95 - z, Math.hypot(x - tx, y - ty) - 1.25) + 0.15;
    let d = 1;
    for (const f of fronds) for (let s = 0; s < 5; s++) {
      const p = f.pts[s], q = f.pts[s + 1], w = 0.055 * (1 - s / 6);
      const c = sdCapsule(x, y, z, ...p, ...q, w, w * 0.8);
      // flatten across the blade: thin vertically
      d = Math.min(d, c * 0.6 + Math.abs(z - (p[2] + q[2]) / 2) * 0);
    }
    return d + (vnoise(x * 70, y * 70, z * 70) - 0.5) * 0.02;
  };
  const dates = (x, y, z) => { let d = 1; for (let k = 0; k < 3; k++) { const a = H(20, k) * TAU; d = Math.min(d, Math.hypot(x - tx - Math.cos(a) * 0.09, y - ty - Math.sin(a) * 0.09, z - h + 0.12) - 0.06); } return d + (vnoise(x * 120, y * 120, z * 120) - 0.5) * 0.02; };
  const gr = shadowGround(h + 0.1, 1.15);
  const sdf = (x, y, z) => Math.min(trunk(x, y, z), frond(x, y, z), dates(x, y, z), gr.plane(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    const dt = trunk(x, y, z), df = frond(x, y, z), dd = dates(x, y, z), m = Math.min(dt, df, dd);
    if (m > 0.02) return gr.shade(x, y, z); // (the crown's whole shadow, fading at its edge)
    if (dd === m) return { kind: 'solid', col: mix3([0.42, 0.22, 0.08], [0.62, 0.36, 0.12], fbm(x * 60, y * 60, z * 60, 2)), spec: 0.1 };
    if (dt === m) return { kind: 'solid', col: mix3([0.3, 0.24, 0.17], [0.48, 0.4, 0.3], fbm(x * 20, y * 20, z * 50, 3)), spec: 0.03 };
    const n = fbm(x * 30, y * 30, z * 30, 3);
    return { kind: 'solid', col: mix3(mix3([0.2, 0.3, 0.12], [0.42, 0.5, 0.22], n), [0.55, 0.5, 0.3], clamp(fbm(x * 5, y * 5, z * 5, 2) - 0.55, 0, 0.4)), spec: 0.05, aoMin: 0.45, fill: 1.15 };
  };
  const E = 1.1, [bx0, by0, bx1, by1] = gr.bounds;
  return { bounds: [Math.min(bx0, -E + Math.min(0, tx)), Math.min(by0, -E + Math.min(0, ty)), -0.05, Math.max(bx1, E + Math.max(0, tx)), Math.max(by1, E + Math.max(0, ty)), h + 0.55], sdf, shade, supersample: 2, shadowK: 48 }; // (the sun through the fronds: a crisp, broken shadow)
}

// ===================================================================== telegraph pole
/** A telegraph pole: a tarred post, a crossarm with white insulators (the wires are drawn in the game). */
export function poleScene(variant, snow) {
  const h = 1.25, lean = (hash(variant, 1) - 0.5) * 0.05;
  const post = (x, y, z) => Math.max(Math.hypot(x - lean * z, y) - 0.032 + z * 0.006, -z, z - h);
  const arm = (x, y, z) => sdRoundBox(x - lean * (h - 0.1), y, z - (h - 0.1), 0.03, 0.26, 0.025, 0.006);
  const ins = (x, y, z) => { let d = 1; for (const o of [-0.2, -0.08, 0.08, 0.2]) d = Math.min(d, sdCapsule(x, y, z, lean * (h - 0.1), o, h - 0.07, lean * (h - 0.1), o, h - 0.02, 0.016, 0.012)); return d; };
  const gr = shadowGround(h, 0.4);
  const sdf = (x, y, z) => Math.min(post(x, y, z), arm(x, y, z), ins(x, y, z), gr.plane(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    const dp = post(x, y, z), da = arm(x, y, z), di = ins(x, y, z), m = Math.min(dp, da, di);
    if (m > 0.015) return gr.shade(x, y, z);
    if (di === m) return { kind: 'solid', col: [0.86, 0.85, 0.8], spec: 0.5, shin: 40 };
    if (snow && nz > 0.6) return { kind: 'solid', col: SNOW, spec: 0.1 };
    return { kind: 'solid', col: mix3([0.16, 0.13, 0.1], [0.3, 0.25, 0.19], fbm(x * 40, y * 40, z * 12, 3)), spec: 0.04 };
  };
  return { bounds: [gr.bounds[0], gr.bounds[1], -0.04, gr.bounds[2], gr.bounds[3], h + 0.08], sdf, shade, supersample: 2 };
}

// ===================================================================== water tower
/** A railhead water tower: a riveted iron tank on four braced timber legs, a ladder, a conical lid. */
export function towerScene() {
  const L = 0.34, H = 1.35, TH = 0.42, R = 0.42;
  const legs = (x, y, z) => { let d = 1; for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) d = Math.min(d, sdCapsule(x, y, z, sx * L, sy * L, 0, sx * L * 0.82, sy * L * 0.82, H, 0.035, 0.03)); return d; };
  const braces = (x, y, z) => {
    let d = 1;
    for (const zz of [0.35, 0.8]) for (const [a, b] of [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]]) {
      const k0 = 1 - zz / H * 0.18, k1 = 1 - (zz + 0.35) / H * 0.18;
      d = Math.min(d, sdCapsule(x, y, z, a[0] * L * k0, a[1] * L * k0, zz, b[0] * L * k1, b[1] * L * k1, zz + 0.35, 0.012));
    }
    return d;
  };
  const tank = (x, y, z) => Math.max(Math.hypot(x, y) - R, Math.abs(z - H - TH / 2) - TH / 2) + (Math.abs(((z - H) * 12) % 1 - 0.5) < 0.05 ? 0.003 : 0);
  const lid = (x, y, z) => Math.max((Math.hypot(x, y) - (R + 0.03)) * 0.6 + (z - H - TH) * 0.8, H + TH - z);
  const spout = (x, y, z) => sdCapsule(x, y, z, R * 0.9, 0, H + 0.1, R + 0.25, 0, H - 0.05, 0.03);
  const gr = shadowGround(H + TH + 0.2, 0.75);
  const sdf = (x, y, z) => Math.min(legs(x, y, z), braces(x, y, z), tank(x, y, z), lid(x, y, z), spout(x, y, z), gr.plane(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    const p = [legs, braces, tank, lid, spout].map((f) => f(x, y, z)), m = Math.min(...p);
    if (m > 0.015) return gr.shade(x, y, z);
    if (p[0] === m || p[1] === m) return { kind: 'solid', col: mix3([0.26, 0.2, 0.15], [0.42, 0.34, 0.25], fbm(x * 30, y * 30, z * 10, 3)), spec: 0.03 };
    const rust = fbm(x * 12, y * 12, z * 20, 3);
    return { kind: 'solid', col: mix3(mix3([0.3, 0.27, 0.24], [0.44, 0.4, 0.35], rust), [0.42, 0.24, 0.14], clamp(rust * 2 - 1.1, 0, 0.6)), spec: 0.2, shin: 30 };
  };
  return { bounds: [gr.bounds[0], gr.bounds[1], -0.04, gr.bounds[2], gr.bounds[3], H + TH + 0.3], sdf, shade, supersample: 2 };
}

// ===================================================================== dry-stone wall
/**
 * A dry-stone wall along its tile (axis 'x' or 'y'): two courses of rough limestone, a row of capstones,
 * a few fallen. snow: snow along the top.
 */
export function wallScene(axis, variant, snow) {
  const stones = [];
  for (let row = 0; row < 3; row++) {
    let a = -0.55 + hash(variant, row, 1) * 0.08;
    while (a < 0.55) {
      const l = 0.07 + hash(variant, row, a * 100) * 0.07, hz = row === 2 ? 0.035 : 0.05 + hash(variant, row, a * 50) * 0.02;
      const z = row === 0 ? hz : row === 1 ? 0.1 + hz : 0.21 + hz;
      stones.push({ a: a + l, c: (hash(variant, row, a * 70) - 0.5) * 0.025, z, la: l, lc: row === 2 ? 0.11 : 0.1 - row * 0.012, hz, rot: (hash(variant, row, a * 30) - 0.5) * 0.3 });
      a += l * 2 + 0.008;
    }
  }
  for (let k = 0; k < 2; k++) stones.push({ a: (hash(variant, 9, k) - 0.5) * 0.8, c: 0.2 + hash(variant, 8, k) * 0.12, z: 0.04, la: 0.07, lc: 0.05, hz: 0.04, rot: hash(variant, 7, k) * 3 }); // fallen
  const loc = (x, y) => (axis === 'x' ? [x, y] : [y, x]);
  const wall = (x, y, z) => {
    const [a, c] = loc(x, y);
    if (z > 0.45 || Math.abs(c) > 0.5) return Math.max(z - 0.45, Math.abs(c) - 0.5) + 0.08;
    let d = 0.04; // (stones further along than this are skipped)
    for (const s of stones) {
      if (Math.abs(a - s.a) > s.la + 0.05) continue;
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot), u = (a - s.a) * cr + (c - s.c) * sr, v = -(a - s.a) * sr + (c - s.c) * cr;
      d = Math.min(d, sdRoundBox(u, v, z - s.z, s.la, s.lc, s.hz, 0.018));
    }
    return d + (fbm(x * 40, y * 40, z * 40, 2) - 0.5) * 0.014;
  };
  const sdf = (x, y, z) => Math.min(wall(x, y, z), z * 0.7 + (Math.max(Math.abs(x), Math.abs(y)) < 0.55 ? 0 : 1));
  const shade = (x, y, z, nx, ny, nz) => {
    if (wall(x, y, z) > 0.012) return catcher(x, y, z, 0.62);
    if (snow && nz > 0.55 && z > 0.18) return { kind: 'solid', col: snowCol(0.2), spec: 0.1 };
    const n = fbm(x * 22, y * 22, z * 22, 3);
    let col = mix3([0.4, 0.39, 0.36], [0.66, 0.64, 0.58], n);
    col = mix3(col, [0.33, 0.37, 0.24], clamp(fbm(x * 50 + 7, y * 50, z * 50, 2) * 2 - 1.15, 0, 0.45)); // lichen and moss
    return { kind: 'solid', col, spec: 0.06, aoMin: 0.3 };
  };
  return { bounds: [-0.62, -0.62, -0.04, 0.62, 0.62, 0.34], sdf, shade, supersample: 2 };
}

// ===================================================================== ground works (baked into the ground)
/** A tile of duckboard track along axis: slats nailed across two runners, muddy, some broken. */
export function duckScene(axis, variant, snow) {
  const loc = (x, y) => (axis === 'x' ? [x, y] : [y, x]);
  const W = 0.2, T = 0.016;
  const slat = (a, c, z) => {
    const k = Math.round(a / 0.085), a0 = k * 0.085, miss = hash(variant, k, 3) < 0.07;
    if (miss || Math.abs(a) > 0.53) return 1;
    const tilt = (hash(variant, k, 4) - 0.5) * 0.08;
    return sdRoundBox(a - a0 - c * tilt, c - (hash(variant, k, 5) - 0.5) * 0.02, z - 0.045, 0.034, W + hash(variant, k, 6) * 0.03, T, 0.004);
  };
  const runners = (a, c, z) => Math.min(sdRoundBox(a, c - W * 0.6, z - 0.02, 0.55, 0.025, 0.02, 0.005), sdRoundBox(a, c + W * 0.6, z - 0.02, 0.55, 0.025, 0.02, 0.005));
  const sdf = (x, y, z) => { const [a, c] = loc(x, y); return Math.min(slat(a, c, z), runners(a, c, z), z); };
  const shade = (x, y, z, nx, ny, nz) => {
    const [a, c] = loc(x, y), s = slat(a, c, z), r = runners(a, c, z);
    if (Math.min(s, r) > 0.006) return Math.abs(c) < W + 0.12 && Math.abs(a) < 0.6 && z > -0.004 ? { kind: 'catcher' } : { kind: 'none' };
    if (snow && nz > 0.6 && fbm(x * 16, y * 16, 3, 3) > 0.5) return { kind: 'solid', col: SNOW, spec: 0.1 };
    let col = mix3([0.24, 0.19, 0.14], [0.44, 0.36, 0.26], fbm(a * 8, c * 80, z * 40, 3));
    col = mix3(col, [0.13, 0.11, 0.09], clamp(fbm(x * 9 + 3, y * 9, 1.7, 2) * 1.8 - 0.75, 0, 0.6)); // mud trodden on
    if (s <= r) col = mul3(col, 0.82 + hash(variant, Math.round(a / 0.085), 9) * 0.3);
    else col = mul3(col, 0.7);
    return { kind: 'solid', col, spec: 0.05 };
  };
  return { bounds: [-0.6, -0.6, -0.02, 0.6, 0.6, 0.08], sdf, shade, supersample: 2 };
}

/** A tile of railway along axis: a ballast bed, timber sleepers, two steel rails. */
export function railScene(axis, snow) {
  const loc = (x, y) => (axis === 'x' ? [x, y] : [y, x]);
  const bed = (a, c, z) => (z - 0.05 * clamp(1 - (Math.abs(c) - 0.22) / 0.2, 0, 1) - (fbm(a * 40, c * 40, 1, 2) - 0.5) * 0.012) * 0.7;
  const sleepers = (a, c, z) => { const k = Math.round(a / 0.16), a0 = k * 0.16; return Math.abs(a) > 0.56 ? 1 : sdRoundBox(a - a0, c, z - 0.06, 0.03, 0.27, 0.016, 0.004); };
  const rails = (a, c, z) => Math.min(sdRoundBox(a, c - 0.14, z - 0.09, 0.6, 0.012, 0.018, 0.003), sdRoundBox(a, c + 0.14, z - 0.09, 0.6, 0.012, 0.018, 0.003));
  const sdf = (x, y, z) => { const [a, c] = loc(x, y); return Math.min(bed(a, c, z), sleepers(a, c, z), rails(a, c, z)); };
  const shade = (x, y, z, nx, ny, nz) => {
    const [a, c] = loc(x, y), b = bed(a, c, z), s = sleepers(a, c, z), r = rails(a, c, z), m = Math.min(b, s, r);
    if (Math.abs(a) > 0.58 || Math.abs(c) > 0.44 || z < -0.004) return { kind: 'none' };
    if (r === m) return { kind: 'solid', col: nz > 0.8 ? [0.62, 0.6, 0.58] : [0.26, 0.17, 0.12], spec: nz > 0.8 ? 0.6 : 0.05, shin: 50 };
    if (snow && nz > 0.6 && fbm(x * 14, y * 14, 5, 3) > 0.42) return { kind: 'solid', col: SNOW, spec: 0.1 };
    if (s === m) return { kind: 'solid', col: mix3([0.17, 0.13, 0.1], [0.3, 0.24, 0.18], fbm(a * 30, c * 6, z * 30, 3)), spec: 0.03 };
    const g = vnoise(x * 120, y * 120, 1), edge = clamp((0.44 - Math.abs(c)) * 8, 0, 1);
    return { kind: 'solid', col: mix3([0.28, 0.27, 0.25], [0.5, 0.48, 0.44], g), spec: 0.04, alpha: edge };
  };
  return { bounds: [-0.62, -0.62, -0.02, 0.62, 0.62, 0.13], sdf, shade, supersample: 2 };
}

/** A tile of paving: rows of worn granite setts, the joints dark with grime; whole tile. */
export function settsScene(variant, snow) {
  const S = 0.1;
  const sett = (x, y, z) => {
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return Math.max(Math.abs(x) - 0.5, Math.abs(y) - 0.5, z);
    const row = Math.floor(y / S), off = (row % 2) * S * 0.5, col = Math.floor((x + off) / S);
    const cx = (col + 0.5) * S - off, cy = (row + 0.5) * S, hgt = 0.018 + hash(variant, row, col) * 0.008;
    return sdRoundBox(x - cx, y - cy, z - hgt / 2, S * 0.44, S * 0.42, hgt / 2, 0.012);
  };
  const sdf = (x, y, z) => Math.min(sett(x, y, z), z + 0.002);
  const shade = (x, y, z, nx, ny, nz) => {
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5 || z < -0.004) return { kind: 'none' };
    if (sett(x, y, z) > 0.004) return { kind: 'solid', col: [0.14, 0.13, 0.12], spec: 0.02 }; // the joints
    if (snow && fbm(x * 8, y * 8, 2, 3) > 0.48) return { kind: 'solid', col: snowCol(0.25), spec: 0.1 };
    const row = Math.floor(y / S), col = Math.floor((x + (row % 2) * S * 0.5) / S), t = hash(variant, row * 7, col * 3);
    let c = mix3([0.36, 0.35, 0.33], [0.55, 0.53, 0.5], t * 0.7 + fbm(x * 60, y * 60, 1, 2) * 0.4);
    c = mix3(c, [0.2, 0.18, 0.15], clamp(fbm(x * 6, y * 6, 3, 2) * 1.6 - 0.8, 0, 0.5)); // mud carried in
    return { kind: 'solid', col: c, spec: 0.08 };
  };
  return { bounds: [-0.52, -0.52, -0.02, 0.52, 0.52, 0.04], sdf, shade, supersample: 2 };
}
