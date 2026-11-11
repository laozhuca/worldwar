// Tiny offline 3D renderer for WorldWar props: signed-distance-field ray marching with soft shadows,
// ambient occlusion and procedural materials, seen through the game's exact isometric camera.
// World units: 1 = one map tile; X/Y on the ground (map axes), Z up.

/** Pixels per world unit at 1x zoom for the 2:1 dimetric projection (tile = 64x32 px). */
export const PX_PER_UNIT = 45.2548;

// Orthographic camera: azimuth 45 deg, elevation 30 deg (gives exactly the 2:1 tile diamond).
const RX = 0.70711, RY = -0.70711, RZ = 0;              // screen right
const UX = -0.35355, UY = -0.35355, UZ = 0.86603;      // screen up
const FX = -0.61237, FY = -0.61237, FZ = -0.5;         // view direction (into the scene)

/** Screen position (px, y down) of a world point at a given render scale. */
export function project(x, y, z, scale) {
  return [scale * (x * RX + y * RY + z * RZ), -scale * (x * UX + y * UY + z * UZ)];
}

// Sun: same light the terrain relief uses (from the upper left of the screen).
const SL = Math.hypot(-0.62, -0.38, 0.69);
const LX = -0.62 / SL, LY = -0.38 / SL, LZ = 0.69 / SL;
const HL = Math.hypot(LX - FX, LY - FY, LZ - FZ);
const HX = (LX - FX) / HL, HY = (LY - FY) / HL, HZ = (LZ - FZ) / HL;
const SUN = [1.0, 0.97, 0.93], SKY = [0.5, 0.58, 0.72], BOUNCE = [0.2, 0.2, 0.21];

// ---------------------------------------------------------------- noise
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function hash(...a) {
  let h = 2166136261;
  for (const v of a) h = Math.imul(h ^ Math.floor(v * 9973 + 0.5), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
  const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
  const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
  return y1 + (y2 - y1) * fz;
}
export function fbm(x, y, z, oct = 4) {
  let s = 0, a = 0.5, t = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x, y, z) * a; t += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return s / t;
}

// ---------------------------------------------------------------- SDF helpers
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function sdBox2(x, y, hx, hy) {
  const dx = Math.abs(x) - hx, dy = Math.abs(y) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
export function sdRoundBox(x, y, z, hx, hy, hz, r) {
  const dx = Math.abs(x) - hx + r, dy = Math.abs(y) - hy + r, dz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - r;
}
/** Capsule / round cone between a and b with radii ra, rb (approximate for ra != rb). */
export function sdCapsule(px, py, pz, ax, ay, az, bx, by, bz, ra, rb = ra) {
  const bax = bx - ax, bay = by - ay, baz = bz - az, pax = px - ax, pay = py - ay, paz = pz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - mix(ra, rb, h);
}
export function smin(a, b, k) { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); }

// ---------------------------------------------------------------- renderer
const srgb2lin = (c) => Math.pow(c, 2.2);
const lin2srgb = (c) => Math.pow(clamp(c, 0, 1), 1 / 2.2);

/**
 * scene: {
 *   bounds: [x0,y0,z0,x1,y1,z1],
 *   sdf(x,y,z) -> distance,
 *   shade(x,y,z,nx,ny,nz) -> { kind: 'solid'|'water'|'catcher'|'none', col:[r,g,b] sRGB, spec, shin }
 * }
 * Returns { w, h, ax, ay, data: Uint8ClampedArray RGBA } where (ax, ay) is the pixel of world origin.
 */
export function render(scene, scale) {
  const [x0, y0, z0, x1, y1, z1] = scene.bounds;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const [sx, sy] = project(x, y, z, scale);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  const ax = Math.ceil(-minX) + 2, ay = Math.ceil(-minY) + 2;
  const W = Math.ceil(maxX - minX) + 4, H = Math.ceil(maxY - minY) + 4;
  const data = new Uint8ClampedArray(W * H * 4);
  const sdf = scene.sdf;
  const EPS = 0.9 / scale;
  const inv = [1 / FX, 1 / FY, 1 / FZ];
  const SS = scene.supersample || 1;

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let accR = 0, accG = 0, accB = 0, accA = 0;
      for (let sj = 0; sj < SS; sj++) for (let si = 0; si < SS; si++) {
        const sx = i + (si + 0.5) / SS - ax, sy = j + (sj + 0.5) / SS - ay;
        const pr = sx / scale, pu = -sy / scale;
        const ox = RX * pr + UX * pu - FX * 8, oy = RY * pr + UY * pu - FY * 8, oz = RZ * pr + UZ * pu - FZ * 8;
        // slab test against bounds
        let tmin = -Infinity, tmax = Infinity;
        const o = [ox, oy, oz], lo = [x0, y0, z0], hi = [x1, y1, z1];
        for (let k = 0; k < 3; k++) {
          let ta = (lo[k] - o[k]) * inv[k], tb = (hi[k] - o[k]) * inv[k];
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          tmin = Math.max(tmin, ta); tmax = Math.min(tmax, tb);
        }
        if (tmax < tmin) continue;
        let t = Math.max(0, tmin), hit = false, px = 0, py = 0, pz = 0;
        for (let k = 0; k < 220 && t <= tmax; k++) {
          px = ox + FX * t; py = oy + FY * t; pz = oz + FZ * t;
          const d = sdf(px, py, pz);
          if (d < EPS) { hit = true; break; }
          t += Math.max(d * 0.8, EPS * 0.5);
        }
        if (!hit) continue;
        // normal (tetrahedron)
        const e = 0.6 / scale;
        const d1 = sdf(px + e, py - e, pz - e), d2 = sdf(px - e, py - e, pz + e), d3 = sdf(px - e, py + e, pz - e), d4 = sdf(px + e, py + e, pz + e);
        let nx = d1 - d2 - d3 + d4, ny = -d1 - d2 + d3 + d4, nz = -d1 + d2 - d3 + d4;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const m = scene.shade(px, py, pz, nx, ny, nz);
        if (!m || m.kind === 'none') continue;
        // soft shadow toward the sun
        let sh = 1, st = 0.004;
        const sox = px + nx * 0.004, soy = py + ny * 0.004, soz = pz + nz * 0.004;
        for (let k = 0; k < 48 && st < 2.5; k++) {
          const h = sdf(sox + LX * st, soy + LY * st, soz + LZ * st);
          if (h < 0.0004) { sh = 0; break; }
          sh = Math.min(sh, (10 * h) / st);
          st += clamp(h, 0.003, 0.08);
        }
        sh = clamp(sh, 0, 1);
        // ambient occlusion
        let occ = 0, w = 1;
        for (let k = 1; k <= 5; k++) {
          const hh = 0.012 * k;
          occ += (hh - sdf(px + nx * hh, py + ny * hh, pz + nz * hh)) * w;
          w *= 0.65;
        }
        const ao = clamp(1 - occ * 9, 0, 1);

        if (m.kind === 'catcher' && nz < 0.8) continue;
        if (m.kind === 'catcher') {
          // transparent ground that only receives shadow and contact occlusion
          const a = clamp((1 - sh) * 0.5 + (1 - ao) * 0.55, 0, 0.72);
          accR += 0.03 * a; accG += 0.035 * a; accB += 0.05 * a; accA += a;
          continue;
        }
        const alb = [srgb2lin(m.col[0]), srgb2lin(m.col[1]), srgb2lin(m.col[2])];
        const dif = Math.max(0, nx * LX + ny * LY + nz * LZ) * sh;
        const skyT = 0.5 + 0.5 * nz;
        const amb = [mix(BOUNCE[0], SKY[0], skyT), mix(BOUNCE[1], SKY[1], skyT), mix(BOUNCE[2], SKY[2], skyT)];
        const ndh = Math.max(0, nx * HX + ny * HY + nz * HZ);
        const spec = (m.spec || 0) * Math.pow(ndh, m.shin || 24) * sh;
        let c = [0, 0, 0];
        for (let k = 0; k < 3; k++) c[k] = alb[k] * (SUN[k] * dif * 1.35 + amb[k] * 0.62 * ao) + spec * SUN[k];
        if (m.kind === 'water') {
          const ndv = Math.max(0, -(nx * FX + ny * FY + nz * FZ));
          const fres = 0.04 + 0.96 * Math.pow(1 - ndv, 5);
          const murk = 0.5 + 0.5 * fbm(px * 30, py * 30, 1, 3); // brown silt and scum on the water
          for (let k = 0; k < 3; k++) c[k] = mix(c[k] * murk, SKY[k] * 0.09 * ao, clamp(fres + 0.1, 0, 1)) + Math.pow(ndh, 140) * sh * 0.35;
        }
        const al = m.alpha ?? 1;
        accR += lin2srgb(c[0]) * al; accG += lin2srgb(c[1]) * al; accB += lin2srgb(c[2]) * al; accA += al;
      }
      const n = SS * SS;
      if (accA <= 0) continue;
      const k = (j * W + i) * 4;
      // colours were accumulated premultiplied by coverage; un-premultiply
      data[k] = (accR / accA) * 255; data[k + 1] = (accG / accA) * 255; data[k + 2] = (accB / accA) * 255;
      data[k + 3] = (accA / n) * 255;
    }
  }
  return { w: W, h: H, ax, ay, data };
}
