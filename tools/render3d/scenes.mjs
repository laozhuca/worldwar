// SDF models for WorldWar props. Each factory returns a scene for core.render().
import { sdBox2, sdRoundBox, sdCapsule, smin, vnoise, fbm, hash, clamp, mix, mix3 } from './core.mjs';

const TAU = Math.PI * 2;
const C = {
  bark: [0.2, 0.18, 0.16], barkDark: [0.08, 0.07, 0.065], lichen: [0.42, 0.44, 0.4],
  wood: [0.76, 0.66, 0.5], woodDark: [0.5, 0.42, 0.32],
  plank: [0.4, 0.34, 0.27], post: [0.2, 0.17, 0.14],
  burlap: [0.56, 0.52, 0.44], burlapDark: [0.36, 0.33, 0.28],
  rust: [0.36, 0.2, 0.12], rustLight: [0.55, 0.33, 0.2],
  concrete: [0.5, 0.5, 0.48], mud: [0.11, 0.1, 0.095], duck: [0.34, 0.28, 0.21],
  snow: [0.88, 0.91, 0.96], ice: [0.68, 0.74, 0.82], water: [0.05, 0.06, 0.075],
};
const snowAt = (x, y, z, nz, on, th = 0.5) => on && nz > th && fbm(x * 30, y * 30, z * 30, 2) > 0.32 - (nz - th) * 0.8;

// ===================================================================== trench tile
/**
 * One trench tile. mask bits: 1 = north (-y), 2 = east (+x), 4 = south (+y), 8 = west (-x).
 * level 1 hasty (sparse bags, flooded floor), 2 revetted + double sandbags + duckboards, 3 concrete.
 */
export function trenchScene(mask, level, snow) {
  const W2 = 0.22, D = 0.24, FLOOR = level === 1 ? D - 0.06 : D;
  const open2 = (x, y) => {
    let d = sdBox2(x, y, W2, W2);
    if (mask & 1) d = Math.min(d, sdBox2(x, y + 0.28, W2, 0.28));
    if (mask & 2) d = Math.min(d, sdBox2(x - 0.28, y, 0.28, W2));
    if (mask & 4) d = Math.min(d, sdBox2(x, y - 0.28, W2, 0.28));
    if (mask & 8) d = Math.min(d, sdBox2(x + 0.28, y, 0.28, W2));
    return d;
  };
  const earth = (x, y, z) => Math.max(z, -Math.max(open2(x, y), -(z + FLOOR)));
  const CELL = 0.125;
  const bagRow = (s, q, z, zc, offset, sparseKey) => {
    const sc = s + offset;
    const idx = Math.floor(sc / CELL);
    const s1 = sc - (idx + 0.5) * CELL;
    if (sparseKey !== undefined && hash(idx, sparseKey, mask) > 0.45) return 0.04 + Math.abs(q) * 0.5;
    const lump = (vnoise(s * 70 + idx * 3.1, q * 70, z * 70) - 0.5) * 0.007;
    return sdRoundBox(s1, q, z - zc, 0.058, 0.034, 0.024, 0.021) + lump;
  };
  const along = (x, y) => {
    const h = 0.002;
    const gx = open2(x + h, y) - open2(x - h, y), gy = open2(x, y + h) - open2(x, y - h);
    return Math.abs(gy) > Math.abs(gx) ? [x, Math.sign(y) || 1] : [y, (Math.sign(x) || 1) + 2];
  };
  const bags = (x, y, z) => {
    if (z > 0.16) return z - 0.12;
    const e = open2(x, y);
    if (e < -0.02) return -e - 0.01;
    if (e > 0.2) return e - 0.16;
    const [s, side] = along(x, y);
    if (level >= 3) return sdRoundBox(0, e - 0.05, z - 0.035, 1, 0.04, 0.035, 0.012) + (vnoise(x * 40, y * 40, z * 40) - 0.5) * 0.004;
    let d = bagRow(s, e - 0.05, z, 0.024, 0, level === 1 ? side : undefined);
    if (level === 2) {
      d = Math.min(d, bagRow(s, e - 0.055, z, 0.07, CELL / 2));
      d = Math.min(d, bagRow(s, e - 0.115, z, 0.024, CELL * 0.25));
    }
    return d;
  };
  const sdf = (x, y, z) => Math.min(earth(x, y, z), bags(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return { kind: 'none' };
    const dE = earth(x, y, z), dB = bags(x, y, z);
    if (dB < dE) {
      if (snowAt(x, y, z, nz, snow, 0.45)) return { kind: 'solid', col: C.snow, spec: 0.15, shin: 20 };
      if (level >= 3) { const n = fbm(x * 30, y * 30, z * 30); return { kind: 'solid', col: mix3(C.concrete, [0.32, 0.32, 0.31], n * 0.6), spec: 0.05 }; }
      const n = fbm(x * 120, y * 120, z * 120, 3);
      let col = mix3(C.burlapDark, C.burlap, 0.35 + n * 0.8);
      if (vnoise(x * 400, y * 400, z * 400) > 0.72) col = mix3(col, C.burlapDark, 0.5); // weave
      return { kind: 'solid', col, spec: 0.04 };
    }
    if (z > -0.004) return { kind: 'catcher' };
    const inside = open2(x, y);
    if (z < -FLOOR + 0.006) {
      if (level === 1) return snow ? { kind: 'solid', col: mix3(C.ice, [0.9, 0.93, 0.97], fbm(x * 40, y * 40, 1) * 0.6), spec: 0.6, shin: 60 } : { kind: 'water', col: C.water, spec: 1 };
      const [s] = along(x, y);
      const gap = ((s / 0.05) % 1 + 1) % 1 < 0.28;
      const n = fbm(x * 60, y * 60, 3);
      if (gap) return { kind: 'solid', col: [0.05, 0.045, 0.04] };
      return { kind: 'solid', col: mix3(C.mud, C.duck, clamp(n * 1.6 - 0.2, 0, 1)), spec: 0.25, shin: 30 };
    }
    // walls
    void inside;
    const runAlongY = Math.abs(nx) > Math.abs(ny);
    const a = runAlongY ? y : x;
    if (level >= 3) {
      const n = fbm(a * 20, z * 20, 5);
      return { kind: 'solid', col: mix3([0.34, 0.34, 0.33], C.concrete, n), spec: 0.04 };
    }
    const zz = z + D;
    const groove = ((zz / 0.048) % 1) < 0.1;
    const post = ((((a + 0.5) / 0.25) % 1) + 1) % 1 < 0.1;
    const grain = fbm(a * 8, zz * 60, 2, 3);
    let col = post ? mix3(C.post, C.plank, grain * 0.4) : mix3([0.24, 0.2, 0.16], C.plank, grain);
    if (groove && !post) col = [0.06, 0.05, 0.045];
    if (zz < 0.09) col = mix3(col, C.mud, clamp((0.09 - zz) / 0.09, 0, 1) * 0.8);
    return { kind: 'solid', col, spec: 0.05 };
  };
  return { bounds: [-0.56, -0.56, -D - 0.02, 0.56, 0.56, 0.13], sdf, shade, supersample: 2 };
}

// ===================================================================== barbed wire
export function wireScene(dir, variant, damaged, snow) {
  const seed = variant * 17 + (damaged ? 101 : 0);
  const A = (x, y) => (dir === 'x' ? x : y), B = (x, y) => (dir === 'x' ? y : x);
  const frames = damaged ? [-0.15 + hash(seed, 1) * 0.2] : [-0.3, 0.3];
  const zc = damaged ? 0.07 : 0.15, R0 = damaged ? 0.095 : 0.135, pitch = damaged ? 0.12 : 0.1, tube = 0.0032;
  const legs = [];
  for (const a0 of frames) {
    const tilt = damaged ? 0.7 + hash(seed, a0) * 0.5 : 0; // fallen frame leans over
    const top = 0.36 * (damaged ? 0.55 : 1);
    legs.push([a0, -0.15, 0, a0 + 0.02, 0.1 + tilt * 0.1, top * (1 - tilt * 0.3)]);
    legs.push([a0, 0.15, 0, a0 - 0.02, -0.1 + tilt * 0.12, top * (1 - tilt * 0.3)]);
    if (!damaged) legs.push([a0 - 0.05, 0, 0.19, a0 + 0.05, 0, 0.19]);
  }
  const coil = (a, b, z) => {
    const c = (z - zc) * (damaged ? 1.5 : 1);
    const rho = Math.hypot(b, c);
    const R = R0 * (1 + 0.22 * (vnoise(a * 22 + seed, Math.atan2(c, b) * 1.3, 0) - 0.5));
    if (Math.abs(rho - R) > 0.05) return Math.abs(rho - R) - 0.04;
    if (damaged && vnoise(a * 9 + seed, 3, 0) > 0.66) return 0.02;
    const phi = Math.atan2(c, b) / TAU;
    const k = Math.round(a / pitch - phi);
    const da = a - pitch * (phi + k);
    const wob = (vnoise(k * 1.7 + seed, phi * 5, 1) - 0.5) * pitch * 1.1; // loops are bent and uneven
    return Math.hypot(rho - R, (da - wob) * 0.9) - tube;
  };
  const strand = (a, b, z) => Math.min(Math.hypot(b - 0.01, z - (0.3 - 0.03 * (1 - 4 * a * a)) * (damaged ? 0.5 : 1)), Math.hypot(b + 0.09, z - 0.08 + 0.02 * (1 - 4 * a * a))) - 0.0026;
  const wood = (x, y, z) => {
    let d = 1;
    const a = A(x, y), b = B(x, y);
    for (const L of legs) d = Math.min(d, sdCapsule(a, b, z, L[0], L[1], L[2], L[3], L[4], L[5], 0.02, 0.016));
    return d;
  };
  const wireD = (x, y, z) => { const a = A(x, y), b = B(x, y); return Math.min(coil(a, b, z), damaged ? 1 : strand(a, b, z)); };
  const sdf = (x, y, z) => Math.min(z, wood(x, y, z), wireD(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    const a = A(x, y);
    if (Math.abs(a) > 0.5) return { kind: 'none' };
    const dz = z, dw = wood(x, y, z), dr = wireD(x, y, z);
    if (dz <= dw && dz <= dr) return { kind: 'catcher' };
    if (dw < dr && snowAt(x, y, z, nz, snow, 0.55)) return { kind: 'solid', col: C.snow, spec: 0.1 };
    if (dr <= dw && snow && nz > 0.8 && vnoise(x * 200, y * 200, z * 200) > 0.6) return { kind: 'solid', col: C.snow };
    if (dw < dr) return { kind: 'solid', col: mix3(C.barkDark, C.bark, fbm(x * 60, y * 60, z * 60)), spec: 0.03 };
    return { kind: 'solid', col: mix3(C.rust, C.rustLight, fbm(x * 90, y * 90, z * 90, 2)), spec: 0.5, shin: 40, alpha: 0.78 };
  };
  const ext = dir === 'x' ? [-0.52, -0.3, 0.52, 0.45] : [-0.3, -0.52, 0.45, 0.52];
  return { bounds: [ext[0], ext[1], -0.01, ext[2], ext[3], 0.38], sdf, shade, supersample: 4 };
}

// ===================================================================== stumps & dead trees
export function trunkScene(variant, tree, snow) {
  const seed = variant * 31 + (tree ? 7 : 0);
  const h = tree ? 0.95 + hash(seed, 1) * 0.35 : 0.22 + hash(seed, 1) * 0.35;
  const r0 = tree ? 0.075 : 0.065 + hash(seed, 2) * 0.02;
  const spikes = Array.from({ length: 6 }, (_, k) => ({ th: hash(seed, k, 3) * TAU, w: 0.25 + hash(seed, k, 4) * 0.5, hgt: 0.04 + hash(seed, k, 5) * (tree ? 0.12 : 0.16) }));
  const top = (th) => {
    let t = h - 0.05;
    for (const s of spikes) {
      let d = Math.abs(((th - s.th + Math.PI) % TAU + TAU) % TAU - Math.PI);
      t = Math.max(t, h - 0.05 + s.hgt * Math.max(0, 1 - d / s.w) ** 1.5);
    }
    return t;
  };
  const rad = (z) => r0 * (1 - (0.3 * z) / h) + 0.045 * Math.exp(-z * 28);
  const branches = [];
  if (tree) {
    const n = 4 + variant;
    for (let k = 0; k < n; k++) {
      const z0 = h * (0.4 + 0.5 * hash(seed, k, 8)), th = hash(seed, k, 9) * TAU, len = 0.18 + hash(seed, k, 10) * 0.22;
      const ex = Math.cos(th) * len, ey = Math.sin(th) * len, ez = z0 + len * (0.4 + hash(seed, k, 11) * 0.6);
      branches.push([Math.cos(th) * 0.04, Math.sin(th) * 0.04, z0, ex, ey, ez, 0.018, 0.005]);
      const t2 = th + (hash(seed, k, 12) - 0.5) * 1.5, l2 = len * 0.45;
      branches.push([ex * 0.6, ey * 0.6, z0 + (ez - z0) * 0.6, ex * 0.6 + Math.cos(t2) * l2, ey * 0.6 + Math.sin(t2) * l2, z0 + (ez - z0) * 0.6 + l2 * 0.6, 0.008, 0.003]);
    }
  }
  const trunk = (x, y, z) => {
    const th = Math.atan2(y, x), rr = Math.hypot(x, y);
    const ridge = 0.005 * Math.abs(Math.sin(th * 13 + vnoise(z * 14, seed, 0) * 5));
    const d = (rr - rad(Math.max(0, z)) - ridge) * 0.75;
    return Math.max(d, (z - top(th)) * 0.45, -z - 0.03);
  };
  const branchD = (x, y, z) => { let d = 1; for (const b of branches) d = Math.min(d, sdCapsule(x, y, z, b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7])); return d; };
  const sdf = (x, y, z) => Math.min(z, trunk(x, y, z), tree ? branchD(x, y, z) : 1);
  const shade = (x, y, z, nx, ny, nz) => {
    const dz = z, dt = trunk(x, y, z), db = tree ? branchD(x, y, z) : 1;
    if (dz < dt && dz < db) return { kind: 'catcher' };
    if (snowAt(x, y, z, nz, snow, 0.55)) return { kind: 'solid', col: C.snow, spec: 0.1 };
    const th = Math.atan2(y, x);
    if (dt <= db && z > top(th) - 0.05 - (nz > 0.3 ? 0.03 : 0)) {
      const n = fbm(th * 4, z * 80, seed, 3);
      return { kind: 'solid', col: mix3(C.woodDark, C.wood, n), spec: 0.08 };
    }
    const n = fbm(th * 3, z * 25, seed, 4);
    let col = mix3(C.barkDark, C.bark, n * 1.2);
    if (fbm(th * 2 + 5, z * 6, seed) > 0.62) col = mix3(col, C.lichen, 0.45);
    if (vnoise(th * 6, z * 9, seed + 2) > 0.8 && z > 0.05) col = mix3(col, C.woodDark, 0.7); // blasted bark
    return { kind: 'solid', col, spec: 0.03 };
  };
  const reach = tree ? 0.45 : 0.12, shadow = (h + 0.15) * 1.05;
  return { bounds: [-reach, -reach, -0.01, reach + shadow * 0.85, reach + shadow * 0.55, h + 0.25], sdf, shade, supersample: 2 };
}

// ===================================================================== fallen logs
export function logScene(variant, snow) {
  const seed = variant * 13 + 3;
  const ang = (hash(seed, 1) - 0.5) * 2.2 + (variant % 2 ? Math.PI / 2 : 0);
  const L = 0.32 + hash(seed, 2) * 0.15, r0 = 0.05 + hash(seed, 3) * 0.015;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const spikes = Array.from({ length: 5 }, (_, k) => ({ ph: hash(seed, k, 4) * TAU, w: 0.4 + hash(seed, k, 5) * 0.6, hgt: 0.03 + hash(seed, k, 6) * 0.09 }));
  const log = (x, y, z) => {
    const s = x * dx + y * dy, q = -x * dy + y * dx, zz = z - r0 * 0.85;
    const ph = Math.atan2(zz, q), rr = Math.hypot(q, zz);
    const rad = r0 * (1 - 0.15 * (s / L)) + 0.004 * Math.abs(Math.sin(ph * 11 + vnoise(s * 12, seed, 0) * 4));
    let end = L;
    for (const sp of spikes) { const d = Math.abs(((ph - sp.ph + Math.PI) % TAU + TAU) % TAU - Math.PI); end = Math.max(end, L + sp.hgt * Math.max(0, 1 - d / sp.w)); }
    const body = (rr - rad) * 0.8;
    return Math.max(body, (s - end) * 0.45, -s - L - 0.005 * Math.cos(ph * 3));
  };
  const sdf = (x, y, z) => Math.min(z, log(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    if (z < log(x, y, z)) return { kind: 'catcher' };
    if (snowAt(x, y, z, nz, snow, 0.82)) return { kind: 'solid', col: C.snow, spec: 0.1 };
    const s = x * dx + y * dy;
    const ndir = Math.abs(nx * dx + ny * dy);
    if (s > L - 0.02 || (s < -L + 0.01 && ndir > 0.6)) return { kind: 'solid', col: mix3(C.woodDark, C.wood, fbm(s * 80, z * 80, seed, 3)), spec: 0.06 };
    const n = fbm(s * 25, z * 60, seed, 4);
    let col = mix3(C.barkDark, C.bark, n * 1.2);
    if (fbm(s * 8, z * 8, seed + 4) > 0.62) col = mix3(col, C.lichen, 0.4);
    return { kind: 'solid', col, spec: 0.03 };
  };
  const ext = L + 0.15;
  return { bounds: [-ext, -ext, -0.01, ext + 0.2, ext + 0.15, 0.2], sdf, shade, supersample: 2 };
}

// ===================================================================== debris: planks, branches, a ration tin
export function debrisScene(variant, snow) {
  const seed = variant * 19 + 5;
  const items = Array.from({ length: 6 }, (_, k) => {
    const a = hash(seed, k, 1) * Math.PI, cx = (hash(seed, k, 2) - 0.5) * 0.4, cy = (hash(seed, k, 3) - 0.5) * 0.4;
    return { plank: hash(seed, k, 4) < 0.45, a, cx, cy, len: 0.06 + hash(seed, k, 5) * 0.1 };
  });
  const item = (it, x, y, z) => {
    const s = (x - it.cx) * Math.cos(it.a) + (y - it.cy) * Math.sin(it.a), q = -(x - it.cx) * Math.sin(it.a) + (y - it.cy) * Math.cos(it.a);
    if (it.plank) return sdRoundBox(s, q, z - 0.008, it.len, 0.016, 0.006, 0.003);
    return sdCapsule(s, q, z, -it.len, 0, 0.006, it.len, 0.01 * Math.sin(it.a * 5), 0.009, 0.007, 0.004);
  };
  const things = (x, y, z) => { let d = 1; for (const it of items) d = Math.min(d, item(it, x, y, z)); return d; };
  const sdf = (x, y, z) => Math.min(z, things(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    if (z < things(x, y, z)) return { kind: 'catcher' };
    if (snowAt(x, y, z, nz, snow, 0.9) && vnoise(x * 70, y * 70, 2) > 0.55) return { kind: 'solid', col: C.snow };
    let best = null, bd = 1;
    for (const it of items) { const d = item(it, x, y, z); if (d < bd) { bd = d; best = it; } }
    if (best && best.plank) return { kind: 'solid', col: mix3(C.post, C.plank, fbm(x * 90, y * 20, z * 90, 3)), spec: 0.04 };
    return { kind: 'solid', col: mix3(C.barkDark, C.bark, fbm(x * 90, y * 90, z * 90, 3)) };
  };
  return { bounds: [-0.32, -0.32, -0.01, 0.38, 0.38, 0.05], sdf, shade, supersample: 2 };
}

void smin; void mix;
