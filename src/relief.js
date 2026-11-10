// Battlefield relief: a high-resolution height field for the whole map (R px per tile) with
// trench cuts and spoil ridges, crater bowls with raised lips, wheel ruts and rolling ground.
// From it we derive soft directional lighting with ambient occlusion and wet-mud glints, plus
// masks that put snow on crests and flats, bare earth on steep blasted faces, and water in hollows.
// Pure computation (no DOM) so it can be cached and tested.

const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash2 = (x, y, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const tileHash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

function valueNoise(w, h, cell, k) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
      const a = hash2(x0, y0, k), b = hash2(x0 + 1, y0, k), c = hash2(x0, y0 + 1, k), d = hash2(x0 + 1, y0 + 1, k);
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

const baseCache = new Map();
function baseNoise(mw, mh, R) {
  const key = `${mw}x${mh}@${R}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const n1 = valueNoise(mw, mh, R * 4.5, 1), n2 = valueNoise(mw, mh, R * 1.4, 2);
  const n3 = valueNoise(mw, mh, R * 0.45, 3), n4 = valueNoise(mw, mh, R * 0.16, 4);
  const n5 = valueNoise(mw, mh, R * 0.6, 5), n6 = valueNoise(mw, mh, R * 0.22, 6);
  const big = new Float32Array(mw * mh), fine = new Float32Array(mw * mh), edge = new Float32Array(mw * mh);
  for (let i = 0; i < big.length; i++) {
    big[i] = n1[i] * 0.65 + n2[i] * 0.35;
    fine[i] = n3[i] * 0.6 + n4[i] * 0.4;
    edge[i] = n5[i] * 0.6 + n6[i] * 0.4;
  }
  const b = { big, fine, edge };
  baseCache.set(key, b);
  return b;
}

/** Separable box blur (radius r), run twice for a soft tent-like falloff. */
function blur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (a, b, horizontal) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      let acc = 0;
      const idx = (k) => (horizontal ? l * w + Math.max(0, Math.min(w - 1, k)) : Math.max(0, Math.min(h - 1, k)) * w + l);
      for (let k = -r; k <= r; k++) acc += a[idx(k)];
      for (let k = 0; k < len; k++) {
        b[horizontal ? l * w + k : k * w + l] = acc / (2 * r + 1);
        acc += a[idx(k + r + 1)] - a[idx(k - r)];
      }
    }
  };
  pass(src, tmp, true); pass(tmp, out, false);
  pass(out, tmp, true); pass(tmp, out, false);
  return out;
}

/**
 * Persistent relief for one map. update() recomputes either the whole map or only a window around
 * changed tiles (craters, trench works) and records the dirty pixel rectangle for the renderer.
 */
export class Relief {
  constructor(map, R = 16) {
    this.R = R; this.W = map.w; this.Ht = map.h;
    this.mw = map.w * R; this.mh = map.h * R;
    const N = this.mw * this.mh;
    this.shade = new Uint8ClampedArray(N * 4);
    this.snow = new Uint8ClampedArray(N * 4);
    this.earth = new Uint8ClampedArray(N * 4);
    this.water = new Uint8ClampedArray(N * 4);
    this.dirty = null;
  }

  /** rect: tile bounds {x0,y0,x1,y1} inclusive, or null for the whole map. */
  update(map, { S, snowTile }, rect = null) {
    const { R, W, Ht, mw, mh } = this;
    const full = !rect;
    if (full) rect = { x0: 0, y0: 0, x1: W - 1, y1: Ht - 1 };
    const M = full ? 0 : 4, O = full ? 0 : 2;
    const wx0 = Math.max(0, rect.x0 - M), wy0 = Math.max(0, rect.y0 - M), wx1 = Math.min(W - 1, rect.x1 + M), wy1 = Math.min(Ht - 1, rect.y1 + M);
    const ox0 = Math.max(0, rect.x0 - O), oy0 = Math.max(0, rect.y0 - O), ox1 = Math.min(W - 1, rect.x1 + O), oy1 = Math.min(Ht - 1, rect.y1 + O);
    const PX = wx0 * R, PY = wy0 * R, ww = (wx1 - wx0 + 1) * R, wh = (wy1 - wy0 + 1) * R, N = ww * wh;
    const { big, fine, edge } = baseNoise(mw, mh, R);
    const G = (x, y) => (PY + y) * mw + PX + x; // window -> global pixel index

    const mudT = new Float32Array(W * Ht), earthT = new Float32Array(W * Ht);
    for (const t of map.tiles) {
      mudT[t.y * W + t.x] = t.mud ? 1 : 0;
      earthT[t.y * W + t.x] = t.crater ? Math.min(1, 0.35 + t.crater * 0.22) : 0;
    }
    const mudP = new Float32Array(N), snowP = new Float32Array(N), earthP = new Float32Array(N);
    for (let y = 0; y < wh; y++) {
      const ty = (PY + y + 0.5) / R - 0.5, y0 = Math.max(0, Math.min(Ht - 1, Math.floor(ty))), y1 = Math.min(Ht - 1, y0 + 1), fy = Math.max(0, Math.min(1, ty - y0));
      for (let x = 0; x < ww; x++) {
        const tx = (PX + x + 0.5) / R - 0.5, x0 = Math.max(0, Math.min(W - 1, Math.floor(tx))), x1 = Math.min(W - 1, x0 + 1), fx = Math.max(0, Math.min(1, tx - x0));
        const a = y0 * W + x0, b = y0 * W + x1, c = y1 * W + x0, d = y1 * W + x1;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const i = y * ww + x;
        mudP[i] = mudT[a] * w00 + mudT[b] * w10 + mudT[c] * w01 + mudT[d] * w11;
        earthP[i] = earthT[a] * w00 + earthT[b] * w10 + earthT[c] * w01 + earthT[d] * w11;
        snowP[i] = S > 0 ? snowTile[a] * w00 + snowTile[b] * w10 + snowTile[c] * w01 + snowTile[d] * w11 : 0;
      }
    }

    // 1. rolling ground, churned harder where the mud is
    const H = new Float32Array(N);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x, g = G(x, y);
      H[i] = (big[g] - 0.5) * 0.9 + (fine[g] - 0.5) * (0.3 + 0.6 * mudP[i]);
    }

    // 2. trenches: distance to the centre-line, then cut + spoil ridges
    const D = new Float32Array(N).fill(1e6);
    const T = (x, y) => (x >= 0 && y >= 0 && x < W && y < Ht ? map.tiles[y * W + x] : null);
    const mark = (px, py) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(px) + dx - PX, y = Math.round(py) + dy - PY;
        if (x >= 0 && y >= 0 && x < ww && y < wh) D[y * ww + x] = 0;
      }
    };
    for (let ty = Math.max(0, wy0 - 1); ty <= Math.min(Ht - 1, wy1 + 1); ty++) for (let tx = Math.max(0, wx0 - 1); tx <= Math.min(W - 1, wx1 + 1); tx++) {
      const t = T(tx, ty);
      if (!t.trench) continue;
      const cx = (t.x + 0.5) * R, cy = (t.y + 0.5) * R;
      mark(cx, cy);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const n = T(t.x + dx, t.y + dy);
        if (!n || !n.trench) continue;
        for (let k = 0; k <= R / 2; k++) mark(cx + dx * k, cy + dy * k);
      }
    }
    const SQ2 = 1.4142;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      let d = D[i];
      if (x > 0) d = Math.min(d, D[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, D[i - ww] + 1);
        if (x > 0) d = Math.min(d, D[i - ww - 1] + SQ2);
        if (x < ww - 1) d = Math.min(d, D[i - ww + 1] + SQ2);
      }
      D[i] = d;
    }
    for (let y = wh - 1; y >= 0; y--) for (let x = ww - 1; x >= 0; x--) {
      const i = y * ww + x;
      let d = D[i];
      if (x < ww - 1) d = Math.min(d, D[i + 1] + 1);
      if (y < wh - 1) {
        d = Math.min(d, D[i + ww] + 1);
        if (x < ww - 1) d = Math.min(d, D[i + ww + 1] + SQ2);
        if (x > 0) d = Math.min(d, D[i + ww - 1] + SQ2);
      }
      D[i] = d;
    }
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = y * ww + x;
      const dt = D[i] / R;
      if (dt >= 1.25) continue;
      if (dt < 0.3) H[i] -= 1.1 * (1 - (dt / 0.3) ** 2);
      else H[i] += 0.8 * Math.sin((Math.PI * (dt - 0.3)) / 0.95) * (0.55 + 0.9 * fine[G(x, y)]);
    }

    // 3. shell craters: bowl + ragged raised lip
    for (let ty = Math.max(0, wy0 - 2); ty <= Math.min(Ht - 1, wy1 + 2); ty++) for (let tx = Math.max(0, wx0 - 2); tx <= Math.min(W - 1, wx1 + 2); tx++) {
      const t = T(tx, ty);
      if (!t.crater) continue;
      const h = tileHash(t.x * 3.1, t.y * 1.7);
      const cx = (t.x + 0.25 + t.shade * 0.5) * R - PX, cy = (t.y + 0.25 + h * 0.5) * R - PY;
      const rr = (0.2 + t.crater * 0.11) * (0.75 + h * 0.5) * R;
      const depth = (0.55 + t.crater * 0.3) * (0.7 + 0.6 * tileHash(t.x * 7.7, t.y * 9.1)), rim = 0.4 + t.crater * 0.1;
      const ext = rr * 1.75;
      for (let y = Math.max(0, Math.floor(cy - ext)); y < Math.min(wh, Math.ceil(cy + ext)); y++) {
        for (let x = Math.max(0, Math.floor(cx - ext)); x < Math.min(ww, Math.ceil(cx + ext)); x++) {
          const i = y * ww + x, g = G(x, y);
          const q = Math.hypot(x - cx, y - cy) / (rr * (0.85 + edge[g] * 0.3));
          if (q < 1) H[i] += -depth * (1 - q * q) + rim * q ** 4;
          else if (q < 1.75) H[i] += rim * Math.sin((Math.PI * (q - 1)) / 0.75) * (0.6 + 0.8 * fine[g]);
        }
      }
    }

    // 4. wheel ruts winding across the churned ground (fixed paths, stamped where they cross the window)
    for (let k = 0; k < 26; k++) {
      let x = hash2(k, 1, 9) * mw, y = hash2(k, 2, 9) * mh;
      let a = (hash2(k, 3, 9) - 0.5) * 1.2 + (hash2(k, 4, 9) < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      const len = (6 + hash2(k, 5, 9) * 10) * R;
      for (let s = 0; s < len; s += 2) {
        a += (hash2(k, s, 7) - 0.5) * 0.08;
        x += Math.cos(a) * 2; y += Math.sin(a) * 2;
        if (x < 2 || y < 2 || x >= mw - 2 || y >= mh - 2) break;
        const lx = Math.floor(x) - PX, ly = Math.floor(y) - PY;
        if (lx < 3 || ly < 3 || lx >= ww - 3 || ly >= wh - 3) continue;
        const ii = ly * ww + lx;
        if (mudP[ii] < 0.5 || D[ii] < R * 0.8) continue;
        for (const side of [-1, 1]) {
          const ox = lx - Math.sin(a) * side * R * 0.14, oy = ly + Math.cos(a) * side * R * 0.14;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const px = Math.floor(ox) + dx, py = Math.floor(oy) + dy;
            if (px < 0 || py < 0 || px >= ww || py >= wh) continue;
            const f = 1 - Math.hypot(dx, dy) / 2.6;
            if (f > 0) H[py * ww + px] -= 0.05 * f;
          }
        }
      }
    }

    // 5. lighting, occlusion and masks (written only for the output region)
    const Hb = blur(H, ww, wh, 5);
    const norm = (v) => { const n = Math.hypot(...v); return v.map((c) => c / n); };
    const L = norm([-0.62, -0.38, 0.69]), V = norm([0.5, 0.5, 0.71]);
    const Hh = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
    const HS = 5.5;
    const sx0 = ox0 * R - PX, sy0 = oy0 * R - PY, sx1 = (ox1 + 1) * R - PX, sy1 = (oy1 + 1) * R - PY;
    const { shade, snow, earth, water } = this;
    for (let y = sy0; y < sy1; y++) {
      for (let x = sx0; x < sx1; x++) {
        const i = y * ww + x, g = G(x, y);
        const gx = (H[y * ww + Math.min(ww - 1, x + 1)] - H[y * ww + Math.max(0, x - 1)]) * 0.5 * HS;
        const gy = (H[Math.min(wh - 1, y + 1) * ww + x] - H[Math.max(0, y - 1) * ww + x]) * 0.5 * HS;
        const nl = Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) / L[2];
        const cav = H[i] - Hb[i];
        const ao = Math.max(0.5, Math.min(1.2, 1 + cav * 0.9));
        const slope = Math.sqrt(gx * gx + gy * gy);
        const e = edge[g];

        let sn = 0;
        if (S > 0) sn = smooth01(0.44, 0.58, snowP[i] + cav * 0.7 - slope * 0.6 + (e - 0.5) * 0.65 + (fine[g] - 0.5) * 0.3);
        const er = smooth01(0.42, 0.58, earthP[i] + slope * 0.3 + (e - 0.5) * 0.45 - 0.05) * (1 - sn * 0.85);
        let wa = 0;
        if (D[i] > R * 0.45) {
          wa = Math.max(smooth01(-1.05, -1.3, H[i]), mudP[i] > 0.5 ? smooth01(-0.2, -0.3, cav) * (1 - S * 0.6) : 0);
          wa *= smooth01(0.2, 0.5, e + 0.3);
        }

        const total = (0.32 + 0.68 * diff) * ao;
        const wet = (1 - sn) * mudP[i] * (1 - S * 0.5);
        const sp = Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]);
        const spec = sp > 0.9 ? Math.pow(sp, 48) * wet : 0;
        const v = 128 + (total - 1) * 140 + spec * 95 * (0.4 + e);
        const k = g * 4;
        shade[k] = v - (1 - total) * 8; shade[k + 1] = v - (1 - total) * 3; shade[k + 2] = v + (1 - total) * 10; shade[k + 3] = 255;
        snow[k] = snow[k + 1] = snow[k + 2] = 255; snow[k + 3] = sn * 255;
        earth[k] = earth[k + 1] = earth[k + 2] = 255; earth[k + 3] = er * 255;
        water[k] = water[k + 1] = water[k + 2] = 255; water[k + 3] = wa * 255;
      }
    }
    const d = { x: PX + sx0, y: PY + sy0, w: sx1 - sx0, h: sy1 - sy0 };
    this.dirty = this.dirty ? unionRect(this.dirty, d) : d;
  }
}

function unionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
