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
export function trenchScene(mask, level, snow, v = 0) {
  const seed = mask * 7 + level * 31 + v * 101 + 13;
  const R = (k, j = 0) => hash(seed, k, j);
  const W2 = 0.22, D = 0.25, CELL = 0.125;
  // randomness fades out toward the tile border so neighbouring tiles always join cleanly
  const fade = (x, y) => clamp((0.47 - Math.max(Math.abs(x), Math.abs(y))) / 0.13, 0, 1);
  const open0 = (x, y) => {
    let d = sdBox2(x, y, W2, W2);
    if (mask & 1) d = Math.min(d, sdBox2(x, y + 0.28, W2, 0.28));
    if (mask & 2) d = Math.min(d, sdBox2(x - 0.28, y, 0.28, W2));
    if (mask & 4) d = Math.min(d, sdBox2(x, y - 0.28, W2, 0.28));
    if (mask & 8) d = Math.min(d, sdBox2(x + 0.28, y, 0.28, W2));
    return d;
  };
  const wobAmp = level === 1 ? 0.11 : level === 2 ? 0.05 : 0.02;
  const open2 = (x, y) => open0(x, y) + (fbm(x * 6 + seed * 0.37, y * 6, 3.3, 3) - 0.5) * wobAmp * fade(x, y);
  const widen = level === 1 ? 0.08 : level === 2 ? 0.015 : 0;
  const openAt = (x, y, z) => open2(x, y) - widen * clamp(1 + z / D, 0, 1); // sloped, slumping walls
  const floorZ = (x, y) => level === 1
    ? -D + 0.04 + (fbm(x * 12 + seed, y * 12, 5.1, 3) - 0.4) * 0.14
    : -D + 0.012 + (vnoise(x * 25 + seed, y * 25, 2) - 0.5) * 0.012;
  const WATER = -D + 0.065;
  const spoil = (x, y) => {
    const e = open2(x, y) - widen;
    if (e < 0 || e > 0.32) return 0;
    const prof = Math.sin(Math.PI * clamp((e - 0.01) / 0.3, 0, 1));
    const lump = (fbm(x * 10 + seed, y * 10, 7.7, 3) - 0.5) * 0.09 * fade(x, y);
    return Math.max(0, prof * ((level === 3 ? 0.02 : 0.045) + lump));
  };
  const along = (x, y) => {
    const h = 0.002;
    const gx = open0(x + h, y) - open0(x - h, y), gy = open0(x, y + h) - open0(x, y - h);
    return Math.abs(gy) > Math.abs(gx) ? [x, Math.sign(y) || 1] : [y, (Math.sign(x) || 1) + 2];
  };

  // -------- wall-foot slumps (earth that has fallen in) and clutter on the floor
  const arms = [[0, 0, 0]];
  if (mask & 1) arms.push([0, -0.21, 1]);
  if (mask & 2) arms.push([0.21, 0, 0]);
  if (mask & 4) arms.push([0, 0.21, 1]);
  if (mask & 8) arms.push([-0.21, 0, 0]);
  const pick = (k) => arms[Math.floor(R(k, 1) * arms.length)];
  const slumps = [];
  const nSlump = level === 1 ? 2 + Math.floor(R(2) * 3) : level === 2 ? 1 + Math.floor(R(2) * 2) : Math.floor(R(2) * 2);
  for (let k = 0; k < nSlump; k++) {
    const [ax, ay, vert] = pick(10 + k);
    const side = R(11 + k) < 0.5 ? -1 : 1, run = (R(12 + k) - 0.5) * 0.14, across = side * (W2 - 0.02);
    const px = ax + (vert ? across : run), py = ay + (vert ? run : across);
    slumps.push([px, py, floorZ(px, py) + 0.01, 0.05 + R(13 + k) * 0.05]);
  }
  const items = [];
  const nItems = level === 1 ? 1 + Math.floor(R(3) * 3) : level === 2 ? 1 + Math.floor(R(3) * 3) : Math.floor(R(3) * 3);
  const types = ['crate', 'ammo', 'casings', 'plank', 'bag', 'post'];
  for (let k = 0; k < nItems; k++) {
    const [ax, ay, vert] = pick(20 + k);
    const run = (R(21 + k) - 0.5) * 0.12, across = (R(22 + k) - 0.5) * 0.12;
    const px = ax + (vert ? across : run), py = ay + (vert ? run : across);
    items.push({ type: types[Math.floor(R(23 + k) * types.length)], x: px, y: py, a: R(24 + k) * Math.PI, fz: floorZ(px, py), vert });
  }
  const rot = (it, x, y) => { const dx = x - it.x, dy = y - it.y, c = Math.cos(it.a), s = Math.sin(it.a); return [dx * c + dy * s, -dx * s + dy * c]; };
  const itemD = (it, x, y, z) => {
    const [u, w] = rot(it, x, y), fz = Math.max(it.fz, level === 1 ? WATER - 0.02 : it.fz);
    switch (it.type) {
      case 'crate': return sdRoundBox(u, w, z - fz - 0.03, 0.05, 0.034, 0.03, 0.005);
      case 'ammo': return Math.min(sdRoundBox(u, w, z - fz - 0.012, 0.032, 0.018, 0.012, 0.003), sdRoundBox(u + 0.006, w - 0.004, z - fz - 0.036, 0.03, 0.017, 0.012, 0.003));
      case 'casings': { let d = 1; for (let i = 0; i < 4; i++) { const o = (i - 1.5) * 0.02; d = Math.min(d, sdCapsule(u, w, z, o, -0.015 + i * 0.006, fz + 0.007, o + 0.006, 0.015 + i * 0.004, fz + 0.007, 0.0065)); } return d; }
      case 'plank': return sdCapsule(u, w, z, -0.1, 0, fz + 0.01, 0.1, 0, fz + 0.03 + R(30) * 0.12, 0.009);
      case 'bag': return sdRoundBox(u, w, z - fz - 0.02, 0.055, 0.033, 0.02, 0.018);
      default: return sdCapsule(u, w, z, -0.08, 0, fz + 0.012, 0.08, 0.01, fz + 0.03, 0.013);
    }
  };
  const itemsD = (x, y, z) => {
    if (z > 0.2) return [z - 0.18, -1];
    let d = 1, id = -1;
    for (let k = 0; k < items.length; k++) { const q = itemD(items[k], x, y, z); if (q < d) { d = q; id = k; } }
    return [d, id];
  };

  // -------- earth: ground with spoil heaps, cut down to the floor, plus slumped earth
  const earth = (x, y, z) => {
    const top = (z - spoil(x, y)) * 0.75;
    const hole = Math.max(openAt(x, y, z), floorZ(x, y) - z);
    let d = Math.max(top, -hole);
    for (const s of slumps) d = smin(d, Math.hypot(x - s[0], y - s[1], (z - s[2]) * 1.3) - s[3], 0.03);
    return d;
  };
  const water = (x, y, z) => (level === 1 ? Math.max(Math.abs(z - WATER) - 0.002, openAt(x, y, WATER) + 0.01) : 1);

  // -------- sandbags: jittered, slumped, burst or missing
  const bag = (s, q, z, zc, offset, row, side) => {
    const sc = s + offset, idx = Math.floor(sc / CELL);
    const cen = (idx + 0.5) * CELL - offset;
    const border = Math.abs(cen) + 0.07 > 0.5; // bags crossing the tile edge stay regular
    const hk = (j) => hash(idx, row * 7 + side, j, seed);
    if (!border) {
      const miss = level === 1 ? 0.55 : 0.14;
      if (hk(1) < miss) return 0.05 + Math.abs(q) * 0.3;
    }
    let s1 = sc - (idx + 0.5) * CELL, qq = q, zz = z - zc;
    let hx = 0.058, hy = 0.034, hz = 0.024;
    if (!border) {
      qq += (hk(2) - 0.5) * 0.03; zz += (hk(3) - 0.5) * 0.012; s1 += (hk(4) - 0.5) * 0.02;
      const a = (hk(5) - 0.5) * 0.5, c = Math.cos(a), sn = Math.sin(a);
      [s1, qq] = [s1 * c + qq * sn, -s1 * sn + qq * c];
      const sc2 = 0.85 + hk(6) * 0.25; hx *= sc2; hy *= sc2;
      if (hk(7) < 0.18) { hz *= 0.55; hy *= 1.25; zz += 0.008; } // slumped / burst
    }
    const lump = (vnoise(s * 70 + idx * 3.1, q * 70, z * 70) - 0.5) * 0.009;
    return sdRoundBox(s1, qq, zz, hx, hy, hz, Math.min(hz, 0.021) * 0.9) + lump;
  };
  const bags = (x, y, z) => {
    if (z > 0.2) return z - 0.17;
    const e = open2(x, y) - widen;
    if (e < -0.03) return -e - 0.02;
    if (e > 0.22) return e - 0.17;
    const [s, side] = along(x, y);
    const base = spoil(x, y) * 0.6;
    if (level >= 3) {
      let d = sdRoundBox(0, e - 0.05, z - 0.035 - base, 1, 0.04, 0.035, 0.012) + (vnoise(x * 40, y * 40, z * 40) - 0.5) * 0.006;
      // chunks blown out of the parapet
      for (let k = 0; k < 3; k++) { const cx = (R(40 + k) - 0.5) * 0.6; d = Math.max(d, -(Math.hypot(s - cx, e - 0.05, z - 0.07) - 0.03 * fade(x, y) - 0.001)); }
      return d;
    }
    let d = bag(s, e - 0.05, z, 0.024 + base, 0, 0, side);
    if (level === 2) {
      d = Math.min(d, bag(s, e - 0.055, z, 0.07 + base, CELL / 2, 1, side));
      d = Math.min(d, bag(s, e - 0.115, z, 0.024 + base, CELL * 0.25, 2, side));
    }
    return d;
  };

  const sdf = (x, y, z) => Math.min(earth(x, y, z), bags(x, y, z), itemsD(x, y, z)[0], water(x, y, z));

  const shade = (x, y, z, nx, ny, nz) => {
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return { kind: 'none' };
    const dE = earth(x, y, z), dB = bags(x, y, z), [dI, id] = itemsD(x, y, z), dW = water(x, y, z);
    const m = Math.min(dE, dB, dI, dW);
    const mudStain = fbm(x * 24 + 3, y * 24, z * 24, 3);
    if (m === dW) return snow ? { kind: 'solid', col: mix3(C.ice, [0.9, 0.93, 0.97], fbm(x * 40, y * 40, 1) * 0.6), spec: 0.6, shin: 60 } : { kind: 'water', col: C.water, spec: 0 };
    if (m === dI) {
      if (snowAt(x, y, z, nz, snow, 0.7)) return { kind: 'solid', col: C.snow };
      const it = items[id], n = fbm(x * 80, y * 80, z * 80, 3);
      let col;
      if (it.type === 'crate') col = (((rot(it, x, y)[0] + 0.05) / 0.025) % 1) < 0.12 ? [0.12, 0.1, 0.08] : mix3([0.3, 0.25, 0.19], [0.5, 0.42, 0.32], n);
      else if (it.type === 'ammo') col = mix3([0.18, 0.2, 0.13], [0.3, 0.32, 0.22], n);
      else if (it.type === 'casings') return { kind: 'solid', col: mix3([0.45, 0.33, 0.14], [0.72, 0.58, 0.3], n), spec: 0.9, shin: 50 };
      else if (it.type === 'bag') col = mix3(C.burlapDark, C.burlap, 0.3 + n * 0.6);
      else if (it.type === 'plank') col = mix3(C.post, C.plank, n);
      else col = mix3(C.barkDark, C.post, n);
      return { kind: 'solid', col: mix3(col, C.mud, clamp(mudStain * 1.6 - 0.7, 0, 0.8)), spec: 0.05 };
    }
    if (m === dB) {
      if (snowAt(x, y, z, nz, snow, 0.45)) return { kind: 'solid', col: C.snow, spec: 0.15, shin: 20 };
      if (level >= 3) {
        const n = fbm(x * 30, y * 30, z * 30);
        let col = mix3(C.concrete, [0.3, 0.3, 0.29], n * 0.7);
        if (Math.abs(fbm(x * 18 + 9, y * 18, z * 18, 3) - 0.5) < 0.012) col = [0.12, 0.12, 0.12]; // cracks
        return { kind: 'solid', col: mix3(col, C.mud, clamp(mudStain * 1.5 - 0.6, 0, 0.7)), spec: 0.05 };
      }
      const n = fbm(x * 120, y * 120, z * 120, 3), tone = vnoise(x * 14, y * 14, z * 14);
      let col = mix3(C.burlapDark, C.burlap, 0.25 + n * 0.7);
      col = mix3(col, [0.42, 0.42, 0.36], tone * 0.5);
      if (vnoise(x * 400, y * 400, z * 400) > 0.72) col = mix3(col, C.burlapDark, 0.5);
      return { kind: 'solid', col: mix3(col, [0.13, 0.11, 0.09], clamp(mudStain * 1.8 - 0.7, 0, 0.85)), spec: 0.04 };
    }
    // earth surfaces
    if (z > -0.03) {
      const a = clamp((z - 0.002) / 0.02, 0, 1);
      if (a <= 0.02) return { kind: 'catcher' };
      if (snowAt(x, y, z, nz, snow, 0.55)) return { kind: 'solid', col: C.snow, spec: 0.1, alpha: a };
      const n = fbm(x * 50, y * 50, z * 50, 4);
      return { kind: 'solid', col: mix3([0.06, 0.055, 0.05], [0.2, 0.18, 0.16], n), spec: 0.12, shin: 20, alpha: a };
    }
    const fz = floorZ(x, y);
    const onFloor = z < fz + 0.012 || nz > 0.75;
    if (onFloor) {
      if (snow && nz > 0.7 && fbm(x * 18, y * 18, 4) > 0.55) return { kind: 'solid', col: C.snow };
      if (level === 1) return { kind: 'solid', col: mix3([0.05, 0.045, 0.04], [0.16, 0.14, 0.12], fbm(x * 40, y * 40, 2, 3)), spec: 0.12, shin: 80 };
      const [s] = along(x, y);
      const slat = Math.floor(s / 0.05), gap = ((s / 0.05) % 1 + 1) % 1 < 0.28;
      const missing = hash(slat, seed, 9) < 0.12 && fade(x, y) > 0.5;
      const muddy = fbm(x * 14 + seed, y * 14, 3, 3) > 0.58;
      if (missing || muddy) return { kind: 'solid', col: mix3([0.04, 0.035, 0.03], [0.12, 0.1, 0.09], fbm(x * 50, y * 50, 6)), spec: 0.15, shin: 80 };
      if (gap) return { kind: 'solid', col: [0.04, 0.035, 0.03] };
      const tone = hash(slat, seed, 3);
      return { kind: 'solid', col: mix3(mix3([0.22, 0.18, 0.14], C.duck, tone), C.mud, clamp(mudStain * 1.4 - 0.5, 0, 0.7)), spec: 0.08, shin: 40 };
    }
    // walls
    const runAlongY = Math.abs(nx) > Math.abs(ny);
    const a = runAlongY ? y : x, zz = z + D;
    if (level === 1) {
      // raw clay with roots, stones, and the odd stake or hurdle panel
      const n = fbm(a * 30, zz * 30, seed, 4);
      let col = mix3([0.07, 0.06, 0.05], [0.24, 0.21, 0.17], n);
      if (Math.abs(fbm(a * 12 + 5, zz * 40, seed, 2) - 0.5) < 0.01) col = [0.04, 0.03, 0.025];
      if (vnoise(a * 60, zz * 60, 1) > 0.86) col = [0.32, 0.31, 0.29];
      const stake = ((((a + 0.5) / 0.16) % 1) + 1) % 1 < 0.07 && hash(Math.floor((a + 0.5) / 0.16), seed, 5) < 0.4;
      if (stake) col = mix3(C.post, C.plank, n * 0.4);
      return { kind: 'solid', col, spec: 0.15, shin: 25 };
    }
    if (level >= 3) {
      const n = fbm(a * 20, zz * 20, 5);
      let col = mix3([0.3, 0.3, 0.29], C.concrete, n);
      if (Math.abs(fbm(a * 10 + 2, zz * 10, seed, 3) - 0.5) < 0.012) col = [0.1, 0.1, 0.1];
      return { kind: 'solid', col: mix3(col, C.mud, clamp((0.12 - zz) / 0.12, 0, 1) * 0.7), spec: 0.04 };
    }
    const board = Math.floor(zz / 0.048), bay = Math.floor((a + 0.5) / 0.25);
    const groove = ((zz / 0.048) % 1) < 0.1;
    const post = ((((a + 0.5) / 0.25) % 1) + 1) % 1 < 0.09;
    const gone = !post && hash(board, bay, seed, runAlongY ? 1 : 2) < 0.16 && fade(x, y) > 0.3;
    const grain = fbm(a * 8, zz * 60, 2, 3), tone = hash(board, bay, seed);
    let col = post ? mix3(C.post, C.plank, grain * 0.4) : mix3(mix3([0.2, 0.17, 0.14], [0.3, 0.26, 0.21], tone), C.plank, grain * 0.7);
    if (groove && !post) col = [0.05, 0.045, 0.04];
    if (gone) col = mix3([0.06, 0.05, 0.045], [0.18, 0.16, 0.13], fbm(a * 40, zz * 40, 7)); // earth behind a missing board
    col = mix3(col, C.mud, clamp((0.1 - zz) / 0.1, 0, 1) * 0.85 + clamp(mudStain * 1.3 - 0.75, 0, 0.5));
    return { kind: 'solid', col, spec: 0.05 };
  };
  return { bounds: [-0.56, -0.56, -D - 0.02, 0.56, 0.56, 0.22], sdf, shade, supersample: 2 };
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

// ===================================================================== machine gun on tripod
export function mgScene(view) {
  const th = view === 'a' ? 0 : -Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const L = (x, y) => [x * c + y * s, -x * s + y * c];
  const parts = (x, y, z) => {
    const [f, q] = L(x, y);
    const jacket = sdCapsule(f, q, z, -0.02, 0, 0.1, 0.17, 0, 0.105, 0.022, 0.022);
    const muzzle = sdCapsule(f, q, z, 0.17, 0, 0.105, 0.22, 0, 0.105, 0.008, 0.008);
    const body = sdRoundBox(f + 0.06, q, z - 0.1, 0.05, 0.018, 0.02, 0.005);
    const grips = sdCapsule(f, q, z, -0.11, -0.012, 0.1, -0.13, 0.012, 0.1, 0.006, 0.006);
    const box = sdRoundBox(f + 0.03, q - 0.04, z - 0.09, 0.025, 0.018, 0.018, 0.003);
    const legs = Math.min(
      sdCapsule(f, q, z, 0.0, 0, 0.085, 0.12, 0.02, 0, 0.007, 0.006),
      sdCapsule(f, q, z, 0.0, 0, 0.085, -0.1, 0.08, 0, 0.007, 0.006),
      sdCapsule(f, q, z, 0.0, 0, 0.085, -0.1, -0.08, 0, 0.007, 0.006));
    const metal = Math.min(jacket, muzzle, body, grips, legs);
    return [Math.min(metal, box), box < metal ? 'box' : 'metal'];
  };
  const sdf = (x, y, z) => Math.min(z, parts(x, y, z)[0]);
  const shade = (x, y, z) => {
    const [d, m] = parts(x, y, z);
    if (z < d) return { kind: 'catcher' };
    if (m === 'box') return { kind: 'solid', col: [0.24, 0.26, 0.17], spec: 0.05 };
    return { kind: 'solid', col: mix3([0.12, 0.12, 0.12], [0.24, 0.24, 0.23], fbm(x * 90, y * 90, z * 90, 2)), spec: 0.6, shin: 40 };
  };
  return { bounds: [-0.3, -0.3, -0.01, 0.4, 0.4, 0.16], sdf, shade, supersample: 3 };
}

// ===================================================================== HQ command bunker
/**
 * Dug-in command post: earth mound with a log-and-earth roof, sandbag walls, timber-framed entrance with
 * steps on the +x side (towards the camera), a firing slit on +y, stovepipe, crates and a telephone pole.
 * Footprint ~1.6 tiles. The flag and telephone wires are drawn live by the game.
 */
export function hqScene(snow) {
  const HX = 0.36, HY = 0.3, WALL = 0.19; // bunker half-sizes and wall height
  const mound = (x, y, z) => {
    const r = Math.hypot(x / 0.8, y / 0.68);
    const h = 0.13 * Math.max(0, 1 - r * r) + 0.05 * Math.max(0, 1 - Math.max(0, sdBox2(x, y, HX, HY)) / 0.12) + (fbm(x * 9, y * 9, 1.3, 3) - 0.5) * 0.04 * Math.max(0, 1 - r);
    return (z - h) * 0.7;
  };
  // entrance cut: ramp descending along +x into the doorway
  const rampD = (x, y, z) => {
    const inside = Math.max(Math.abs(y - 0.02) - 0.085, -(x - HX + 0.02), x - 0.78);
    const floor = -0.06 + (x - HX) * -0.05;
    return Math.max(inside, -(z - floor) + 0.0);
  };
  const ground = (x, y, z) => Math.max(Math.min(z, mound(x, y, z)), -rampD(x, y, z) - 0.002);
  // sandbag walls around the bunker body
  const bagWall = (x, y, z) => {
    const e = sdBox2(x, y, HX, HY);
    if (e > 0.1 || e < -0.1 || z > WALL + 0.03) return Math.max(Math.abs(e) - 0.06, z - WALL - 0.02, 0.01);
    const onX = Math.abs(Math.abs(x) - HX) < Math.abs(Math.abs(y) - HY);
    const s = onX ? y : x, q = e;
    let d = 1;
    for (let row = 0; row < 4; row++) {
      const zc = 0.024 + row * 0.044, off = row % 2 ? 0.055 : 0;
      const idx = Math.floor((s + off) / 0.11);
      const s1 = s + off - (idx + 0.5) * 0.11;
      const j = hash(idx, row, onX ? 1 : 2);
      d = Math.min(d, sdRoundBox(s1 + (j - 0.5) * 0.012, q - 0.005, z - zc, 0.05, 0.036, 0.021, 0.019) + (vnoise(x * 70, y * 70, z * 70) - 0.5) * 0.008);
    }
    // doorway and firing slit openings
    if (onX && x > 0) d = Math.max(d, -(Math.max(Math.abs(y - 0.02) - 0.075, z - 0.17)));
    if (!onX && y > 0) d = Math.max(d, -(Math.max(Math.abs(x + 0.08) - 0.12, Math.abs(z - 0.13) - 0.022)));
    return d;
  };
  // log roof (logs across y) with earth and sandbags piled on top
  const logs = (x, y, z) => {
    const idx = Math.round(x / 0.052), xc = idx * 0.052;
    if (Math.abs(xc) > HX + 0.02) return Math.max(Math.abs(x) - HX - 0.09, Math.abs(z - WALL - 0.03) - 0.04, Math.abs(y) - HY - 0.12, 0.01);
    const len = HY + 0.015 + hash(idx, 7) * 0.03;
    return Math.max(Math.hypot(x - xc, z - WALL - 0.028) - 0.025, Math.abs(y + (hash(idx, 3) - 0.5) * 0.03) - len);
  };
  const roofEarth = (x, y, z) => {
    const r = Math.hypot(x / (HX + 0.02), y / (HY + 0.01));
    const top = WALL + 0.065 + 0.08 * Math.max(0, 1 - r * r) + (fbm(x * 12, y * 12, 4.2, 3) - 0.5) * 0.03;
    return Math.max((z - top) * 0.7, sdBox2(x, y, HX + 0.01, HY - 0.005) - 0.01, WALL + 0.03 - z);
  };
  const roofBags = (x, y, z) => {
    let d = 1;
    for (let k = 0; k < 5; k++) {
      const cx = -0.2 + k * 0.1 + (hash(k, 11) - 0.5) * 0.03, cy = 0.12 + (hash(k, 12) - 0.5) * 0.05;
      d = Math.min(d, sdRoundBox(x - cx, y - cy, z - (WALL + 0.115 - Math.abs(cx) * 0.18), 0.036, 0.05, 0.021, 0.019));
    }
    return d;
  };
  // timber door frame, steps, stovepipe, crates, telephone pole
  const timber = (x, y, z) => Math.min(
    sdRoundBox(x - HX - 0.02, y - 0.105, z - 0.09, 0.016, 0.016, 0.1, 0.004),
    sdRoundBox(x - HX - 0.02, y + 0.065, z - 0.09, 0.016, 0.016, 0.1, 0.004),
    sdRoundBox(x - HX - 0.02, y - 0.02, z - 0.19, 0.018, 0.11, 0.016, 0.004),
    sdRoundBox(x + 0.08, y - HY - 0.03, z - 0.155, 0.15, 0.014, 0.012, 0.003)); // lintel over the slit
  const steps = (x, y, z) => {
    let d = 1;
    for (let k = 0; k < 4; k++) d = Math.min(d, sdRoundBox(x - (HX + 0.06 + k * 0.085), y - 0.02, z - (-0.05 + k * 0.012), 0.03, 0.08, 0.01, 0.003));
    return d;
  };
  const pipe = (x, y, z) => Math.min(sdCapsule(x, y, z, -0.18, -0.12, WALL + 0.1, -0.18, -0.12, WALL + 0.22, 0.018), sdCapsule(x, y, z, -0.18, -0.12, WALL + 0.22, -0.15, -0.12, WALL + 0.25, 0.02));
  const crates = (x, y, z) => Math.min(
    sdRoundBox(x - 0.5, y - 0.26, z - 0.035, 0.05, 0.035, 0.035, 0.004),
    sdRoundBox(x - 0.505, y - 0.255, z - 0.105, 0.045, 0.032, 0.033, 0.004),
    sdRoundBox(x - 0.43, y - 0.33, z - 0.03, 0.035, 0.05, 0.03, 0.004),
    sdCapsule(x, y, z, 0.6, -0.2, 0.02, 0.6, -0.2, 0.07, 0.03)); // water drum
  const pole = (x, y, z) => Math.min(
    sdCapsule(x, y, z, -0.62, -0.52, 0, -0.62, -0.52, 0.74, 0.016, 0.012),
    sdRoundBox(x + 0.62, y + 0.52, z - 0.7, 0.012, 0.09, 0.008, 0.003),
    sdRoundBox(x + 0.62, y + 0.52, z - 0.64, 0.012, 0.07, 0.008, 0.003));
  const parts = (x, y, z) => {
    const list = [['ground', ground(x, y, z)], ['bags', bagWall(x, y, z)], ['logs', logs(x, y, z)], ['roof', roofEarth(x, y, z)],
      ['bags', roofBags(x, y, z)], ['timber', timber(x, y, z)], ['steps', steps(x, y, z)], ['pipe', pipe(x, y, z)], ['crate', crates(x, y, z)], ['pole', pole(x, y, z)]];
    let best = list[0];
    for (const p of list) if (p[1] < best[1]) best = p;
    return best;
  };
  // interior void behind the doorway and slit (so the openings read as dark holes)
  const interior = (x, y, z) => sdRoundBox(x, y, z - 0.08, HX - 0.05, HY - 0.05, 0.11, 0.01);
  const sdf = (x, y, z) => Math.max(parts(x, y, z)[1], -interior(x, y, z));
  const shade = (x, y, z, nx, ny, nz) => {
    if (interior(x, y, z) < 0.012) return { kind: 'solid', col: [0.025, 0.022, 0.02] };
    const [m] = parts(x, y, z);
    const n = fbm(x * 60, y * 60, z * 60, 3);
    const snowy = snowAt(x, y, z, nz, snow, 0.55);
    switch (m) {
      case 'ground': {
        const r = Math.hypot(x / 0.8, y / 0.68);
        const inRamp = rampD(x, y, z) < 0.01;
        if (z < -0.004 && !inRamp) return { kind: 'none' }; // side of the render volume
        if (r > 0.97 && !inRamp) return { kind: 'catcher' };
        if (snowy && rampD(x, y, z) > 0.01) return { kind: 'solid', col: mix3(C.snow, [0.66, 0.7, 0.77], 0.35), spec: 0.05, alpha: clamp((0.97 - r) * 2.6, 0.05, 1) };
        return { kind: 'solid', col: mix3([0.07, 0.065, 0.06], [0.22, 0.2, 0.18], n), spec: 0.08, alpha: clamp((0.97 - r) * 2.6, 0.05, 1) };
      }
      case 'roof': return snowy ? { kind: 'solid', col: C.snow, spec: 0.1 } : { kind: 'solid', col: mix3([0.08, 0.07, 0.06], [0.24, 0.21, 0.18], n), spec: 0.06 };
      case 'bags': {
        if (snowy) return { kind: 'solid', col: C.snow, spec: 0.12 };
        let col = mix3(C.burlapDark, C.burlap, 0.25 + fbm(x * 120, y * 120, z * 120, 3) * 0.7);
        col = mix3(col, [0.13, 0.11, 0.09], clamp(fbm(x * 20 + 3, y * 20, z * 20, 2) * 1.6 - 0.7, 0, 0.8) + clamp((0.06 - z) * 8, 0, 0.5));
        return { kind: 'solid', col, spec: 0.04 };
      }
      case 'logs': {
        if (snowy) return { kind: 'solid', col: C.snow };
        const endGrain = Math.abs(ny) > 0.75;
        return { kind: 'solid', col: endGrain ? mix3(C.woodDark, C.wood, n) : mix3(C.barkDark, C.bark, n * 1.2), spec: 0.04 };
      }
      case 'timber': case 'steps': return { kind: 'solid', col: mix3(C.post, C.plank, fbm(x * 10, y * 10, z * 80, 3)), spec: 0.05 };
      case 'pipe': return { kind: 'solid', col: mix3([0.1, 0.09, 0.09], [0.28, 0.18, 0.12], n), spec: 0.4, shin: 30 };
      case 'crate': {
        if (snowy) return { kind: 'solid', col: C.snow };
        const slat = ((z * 60) % 1) < 0.12;
        return { kind: 'solid', col: slat ? [0.12, 0.1, 0.08] : mix3([0.27, 0.27, 0.19], [0.4, 0.38, 0.27], n), spec: 0.05 };
      }
      case 'pole': return { kind: 'solid', col: mix3(C.barkDark, C.post, n), spec: 0.03 };
    }
    return { kind: 'none' };
  };
  return { bounds: [-0.85, -0.75, -0.1, 0.9, 0.75, 0.78], sdf, shade, supersample: 2 };
}

void smin; void mix;
