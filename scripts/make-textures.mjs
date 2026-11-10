// Generates the game's seamless PNG textures into assets/textures/.
// Zero dependencies: periodic fractal noise + a tiny rasteriser + a PNG encoder on node:zlib.
//   node scripts/make-textures.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'textures');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- PNG encoder
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
      : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);

/** Periodic value noise on a px × py lattice: wraps seamlessly. */
function noise2(px, py, r) {
  const g = new Float32Array(px * py).map(() => r());
  return (x, y) => {
    x = ((x % px) + px) % px; y = ((y % py) + py) % py;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = g[y0 * px + x0], b = g[y0 * px + x1], c = g[y1 * px + x0], d = g[y1 * px + x1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
}
/** Fractal noise sampled with u,v in [0,1); seamless because every octave period is an integer. */
function fbm(r, periods, persistence = 0.55, sx = 1, sy = 1) {
  const oct = periods.map((p) => ({ p, n: noise2(Math.max(1, Math.round(p * sx)), Math.max(1, Math.round(p * sy)), r) }));
  return (u, v) => {
    let s = 0, amp = 1, tot = 0;
    for (const o of oct) {
      s += o.n(u * Math.max(1, Math.round(o.p * sx)), v * Math.max(1, Math.round(o.p * sy))) * amp;
      tot += amp; amp *= persistence;
    }
    return s / tot;
  };
}

class Tex {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Float32Array(w * h * 3); }
  fill(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = fn(x / this.w, y / this.h, x, y);
      const i = (y * this.w + x) * 3;
      this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2];
    }
  }
  blend(x, y, c, a) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 3;
    this.d[i] = lerp(this.d[i], c[0], a); this.d[i + 1] = lerp(this.d[i + 1], c[1], a); this.d[i + 2] = lerp(this.d[i + 2], c[2], a);
  }
  add(x, y, c, a) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 3;
    this.d[i] += c[0] * a; this.d[i + 1] += c[1] * a; this.d[i + 2] += c[2] * a;
  }
  /** Anti-aliased disc (or ellipse with sy) that wraps around the edges. */
  disc(cx, cy, r, c, alpha = 1, sy = 1) {
    const ry = r * sy;
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy) * r;
        const cov = clamp(r + 0.5 - d);
        if (cov > 0) this.blend(x, y, c, cov * alpha);
      }
    }
  }
  line(x0, y0, x1, y1, width, c, alpha = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len * 1.5));
    const r = Math.max(0.5, width / 2), a = alpha * Math.min(1, width) / 1.5;
    for (let i = 0; i <= n; i++) this.disc(lerp(x0, x1, i / n), lerp(y0, y1, i / n), r, c, a);
  }
  save(name) {
    const out = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0, j = 0; i < this.d.length; i += 3, j += 4) {
      out[j] = clamp(Math.round(this.d[i]), 0, 255);
      out[j + 1] = clamp(Math.round(this.d[i + 1]), 0, 255);
      out[j + 2] = clamp(Math.round(this.d[i + 2]), 0, 255);
      out[j + 3] = 255;
    }
    const png = encodePNG(this.w, this.h, out);
    writeFileSync(join(OUT, name + '.png'), png);
    console.log(`${name}.png  ${this.w}x${this.h}  ${(png.length / 1024).toFixed(0)} KB`);
  }
}

// ---------------------------------------------------------------- textures

/** Height field with wrap-around bumps; gives textures real relief once lit. */
class Height {
  constructor(w, h, fn) {
    this.w = w; this.h = h; this.d = new Float32Array(w * h);
    if (fn) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.d[y * w + x] = fn(x / w, y / h);
  }
  at(x, y) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; return this.d[y * this.w + x]; }
  bump(cx, cy, r, amp, sy = 1) {
    const ry = r * sy;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x - cx) / r, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const xx = ((x % this.w) + this.w) % this.w, yy = ((y % this.h) + this.h) % this.h;
      this.d[yy * this.w + xx] += amp * (1 - d) * (1 - d);
    }
  }
  /** Directional light from the upper-left: returns 1 on flat ground, more or less on slopes. */
  light(x, y, k) {
    const gx = this.at(x + 1, y) - this.at(x - 1, y), gy = this.at(x, y + 1) - this.at(x, y - 1);
    return clamp(1 + (gx * 0.7 + gy * 0.7) * -k, 0.35, 1.7);
  }
  normalize() {
    let lo = Infinity, hi = -Infinity;
    for (const v of this.d) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < this.d.length; i++) this.d[i] = (this.d[i] - lo) / (hi - lo || 1);
  }
}
const lit = (c, s) => (s >= 1 ? mix(c, [c[0] * 1.5 + 25, c[1] * 1.5 + 25, c[2] * 1.5 + 28], (s - 1) * 0.9) : [c[0] * s, c[1] * s, c[2] * s]);

function mud() {
  const r = rng(11), W = 512, t = new Tex(W, W);
  const n = fbm(r, [4, 8, 16, 32, 64]);
  const H = new Height(W, W, (u, v) => n(u, v) * 0.9);
  for (let i = 0; i < 2600; i++) H.bump(r() * W, r() * W, 2 + r() * r() * 9, (r() - 0.35) * 0.22);
  for (let i = 0; i < 40; i++) { // boot and wheel ruts
    const x = r() * W, y = r() * W, a = r() * Math.PI, l = 20 + r() * 60;
    for (let k = 0; k < l; k += 2) H.bump(x + Math.cos(a) * k, y + Math.sin(a) * k, 3.2, -0.05);
  }
  H.normalize();
  const tone = fbm(r, [3, 6, 12]);
  t.fill((u, v, x, y) => {
    const h = H.at(x, y);
    let c = mix([22, 17, 14], [66, 54, 43], clamp(h * 1.15 - 0.05));
    c = mix(c, [38, 34, 30], tone(u, v) * 0.35);
    let s = H.light(x, y, 16);
    if (h < 0.16) { // water lying in the hollows
      const w = clamp((0.16 - h) * 14);
      c = mix(c, mix([26, 30, 36], [96, 106, 120], clamp(tone(u * 2 % 1, v) * 1.4 - 0.3)), w * 0.75);
      s = lerp(s, 1, w);
    }
    return lit(c, s);
  });
  for (let i = 0; i < 260; i++) t.disc(r() * W, r() * W, 0.6 + r() * 1.2, [92, 88, 82], 0.5);
  t.save('mud');
}

function earth() {
  const r = rng(22), W = 512, t = new Tex(W, W);
  const n = fbm(r, [8, 16, 32, 64]);
  const H = new Height(W, W, (u, v) => n(u, v) * 0.6);
  for (let i = 0; i < 2400; i++) H.bump(r() * W, r() * W, 2 + r() * r() * 13, (r() * 0.9 + 0.1) * 0.3);
  H.normalize();
  t.fill((u, v, x, y) => lit(mix([16, 12, 10], [62, 51, 41], H.at(x, y)), H.light(x, y, 20)));
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = r() * W, a = r() * Math.PI * 2, l = 4 + r() * 12;
    t.line(x + 1, y + 1, x + 1 + Math.cos(a) * l, y + 1 + Math.sin(a) * l, 1.4, [10, 8, 6], 0.6);
    t.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 1.3, [160, 138, 104], 0.85);
  }
  for (let i = 0; i < 300; i++) t.disc(r() * W, r() * W, 0.8 + r() * 1.6, [96, 94, 90], 0.6);
  t.save('earth');
}

function snow() {
  const r = rng(33), W = 512, t = new Tex(W, W);
  const n = fbm(r, [3, 6, 12, 24]);
  const warp = fbm(r, [4, 8]);
  const H = new Height(W, W, (u, v) => n(u, v) + Math.sin((v * 3 + u + warp(u, v) * 1.6) * Math.PI * 2) * 0.06);
  for (let i = 0; i < 500; i++) H.bump(r() * W, r() * W, 4 + r() * 16, (r() - 0.4) * 0.12);
  for (let i = 0; i < 30; i++) { // trodden paths
    let x = r() * W, y = r() * W, a = r() * Math.PI * 2;
    for (let k = 0; k < 30; k++) { H.bump(x, y, 3, -0.06); x += Math.cos(a) * 5; y += Math.sin(a) * 5; a += (r() - 0.5) * 0.4; }
  }
  H.normalize();
  const fine = fbm(r, [64, 128], 0.6);
  t.fill((u, v, x, y) => {
    const s = H.light(x, y, 22);
    let c = mix([204, 212, 224], [238, 242, 248], H.at(x, y));
    c = s < 1 ? mix(c, [120, 136, 162], (1 - s) * 0.9) : mix(c, [255, 255, 255], (s - 1) * 0.6);
    const f = (fine(u, v) - 0.5) * 10;
    return [c[0] + f, c[1] + f, c[2] + f];
  });
  for (let i = 0; i < 3000; i++) t.blend(Math.floor(r() * W), Math.floor(r() * W), [255, 255, 255], 0.9);
  for (let i = 0; i < 200; i++) t.disc(r() * W, r() * W, 0.6 + r() * 0.8, [54, 48, 42], 0.3);
  t.save('snow');
}

function grass() {
  const r = rng(44), W = 512, t = new Tex(W, W);
  const n = fbm(r, [4, 8, 16, 32]);
  const H = new Height(W, W, (u, v) => n(u, v) * 0.5);
  const tufts = Array.from({ length: 700 }, () => ({ x: r() * W, y: r() * W, s: 4 + r() * 7 }));
  for (const q of tufts) H.bump(q.x, q.y, q.s, 0.25);
  H.normalize();
  t.fill((u, v, x, y) => lit(mix([30, 29, 23], [74, 70, 54], H.at(x, y)), H.light(x, y, 10)));
  const cols = [[132, 118, 86], [98, 94, 70], [52, 50, 38], [116, 108, 84], [150, 136, 104], [84, 86, 70]];
  for (const q of tufts) { // clumps of dead blades radiating from a crown
    const m = 10 + Math.floor(r() * 14);
    for (let i = 0; i < m; i++) {
      const a = r() * Math.PI * 2, l = q.s * (0.8 + r() * 1.2);
      const x1 = q.x + Math.cos(a) * l, y1 = q.y + Math.sin(a) * l;
      t.line(q.x + 1, q.y + 1, x1 + 1.5, y1 + 1.5, 1, [18, 16, 12], 0.35);
      t.line(q.x, q.y, x1, y1, 0.9, cols[Math.floor(r() * cols.length)], 0.8);
    }
  }
  for (let i = 0; i < 3000; i++) {
    const x = r() * W, y = r() * W, a = r() * Math.PI * 2, l = 2 + r() * 4;
    t.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.8, cols[Math.floor(r() * cols.length)], 0.45);
  }
  for (let i = 0; i < 1400; i++) t.blend(Math.floor(r() * W), Math.floor(r() * W), [226, 232, 238], 0.6); // hoar frost
  t.save('grass');
}

function ice() {
  const r = rng(55), t = new Tex(256, 256);
  const n = fbm(r, [4, 8, 16, 32]);
  t.fill((u, v) => mix([120, 134, 150], [196, 206, 220], n(u, v)));
  for (let k = 0; k < 26; k++) {
    let x = r() * 256, y = r() * 256, a = r() * Math.PI * 2;
    for (let s = 0; s < 6 + r() * 10; s++) {
      const l = 5 + r() * 14, nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l;
      t.line(x + 0.8, y + 0.8, nx + 0.8, ny + 0.8, 0.9, [70, 82, 98], 0.35);
      t.line(x, y, nx, ny, 0.8, [240, 245, 250], 0.7);
      x = nx; y = ny; a += (r() - 0.5) * 1.4;
    }
  }
  for (let i = 0; i < 40; i++) t.disc(r() * 256, r() * 256, 3 + r() * 8, [230, 236, 244], 0.18);
  t.save('ice');
}

function water() {
  const r = rng(66), t = new Tex(256, 256);
  const n = fbm(r, [2, 4, 8, 16]);
  const rip = fbm(r, [8, 16], 0.5, 1, 4);
  t.fill((u, v) => {
    let c = mix([28, 34, 42], [108, 120, 138], clamp((n(u, v) - 0.3) * 1.6));
    const q = rip(u, v);
    if (q > 0.74) c = mix(c, [150, 162, 180], (q - 0.74) * 1.2);
    return c;
  });
  t.save('water');
}

function planks() {
  const r = rng(77), t = new Tex(256, 128);
  const grain = fbm(r, [2, 4, 8], 0.5, 1, 16);
  const stain = fbm(r, [2, 4, 8]);
  const tone = Array.from({ length: 8 }, () => r());
  t.fill((u, v, x, y) => {
    const p = Math.floor(y / 16);
    const g = grain(u, v);
    let c = mix([52, 41, 31], [96, 78, 58], clamp(tone[p] * 0.6 + g * 0.6 - 0.1));
    if (y % 16 === 0) c = [18, 14, 11];
    if (y % 16 === 1) c = mix(c, [120, 100, 76], 0.4);
    const s = stain(u, v);
    c = mix(c, [24, 19, 15], clamp((v - 0.55) * 1.6) * 0.6 * s); // mud splashed on the lower boards
    return c;
  });
  for (let px = 0; px < 256; px += 64) { // upright posts
    for (let y = 0; y < 128; y++) {
      for (let dx = 0; dx < 7; dx++) {
        const c = dx === 0 ? [96, 80, 60] : dx === 6 ? [12, 10, 8] : mix([30, 24, 19], [46, 37, 29], grain(dx / 7, y / 128));
        t.blend(px + dx, y, c, 1);
      }
    }
  }
  for (let px = 0; px < 256; px += 64) for (let y = 8; y < 128; y += 16) { t.disc(px + 12, y, 0.9, [140, 140, 136], 0.9); t.disc(px + 60, y, 0.9, [140, 140, 136], 0.9); }
  t.save('planks');
}

function sandbags() {
  const r = rng(88), t = new Tex(128, 64);
  const burlap = fbm(r, [32, 64], 0.6);
  t.fill(() => [26, 22, 18]);
  for (let row = 0; row < 4; row++) {
    for (let col = -1; col < 5; col++) {
      const cx = col * 32 + (row % 2 ? 16 : 0) + 16, cy = row * 16 + 8;
      const tone = 0.8 + r() * 0.35;
      for (let y = -8; y < 8; y++) for (let x = -16; x < 16; x++) {
        const ex = x / 15, ey = y / 7.2;
        const d = Math.pow(Math.pow(Math.abs(ex), 2.6) + Math.pow(Math.abs(ey), 2.6), 1 / 2.6);
        if (d > 1) continue;
        const shade = 1 - d * 0.45 - ey * 0.18 - ex * 0.05;
        const b = burlap(((cx + x) % 128 + 128) % 128 / 128, ((cy + y) % 64 + 64) % 64 / 64) - 0.5;
        const c = [116 * tone * shade + b * 30, 104 * tone * shade + b * 28, 82 * tone * shade + b * 22];
        t.blend(cx + x, cy + y, c, clamp((1 - d) * 6));
      }
    }
  }
  t.save('sandbags');
}

function duckboard() {
  const r = rng(99), t = new Tex(128, 64);
  const grain = fbm(r, [2, 4, 8], 0.5, 8, 1);
  const mudN = fbm(r, [4, 8, 16]);
  t.fill((u, v, x, y) => {
    let c = [16, 12, 10];
    if (x % 8 < 6) c = mix([58, 46, 34], [92, 74, 54], grain(u, v));
    if (y > 10 && y < 15 || y > 48 && y < 53) c = mix(c, [34, 27, 20], 0.7); // rails underneath
    return mix(c, [26, 21, 17], clamp((mudN(u, v) - 0.5) * 2.5) * 0.8);
  });
  t.save('duckboard');
}

mud(); earth(); snow(); grass(); ice(); water(); planks(); sandbags(); duckboard();
