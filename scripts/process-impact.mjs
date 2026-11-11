// Prepares the hand-drawn shell-impact frames (art-src/fx/earth-impact.png, 6x6 atlas) for the game:
// edge feathering and smoothed ground alignment (from the supplied impact pack), then a colour grade into
// the battlefield palette, packed into assets/fx/impact.webp + impact.json. Dev-only (uses Playwright).
//   node scripts/process-impact.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-src', 'fx');
const OUT = join(root, 'assets', 'fx');
mkdirSync(OUT, { recursive: true });
const meta = JSON.parse(readFileSync(join(SRC, 'earth-impact.json'), 'utf8'));
const CELL = 256;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

const browser = await chromium.launch();
const page = await browser.newPage();
const src = 'data:image/png;base64,' + readFileSync(join(SRC, 'earth-impact.png')).toString('base64');
const url = await page.evaluate(async ({ src, CELL }) => {
  const atlas = new Image(); atlas.src = src; await atlas.decode();
  const N = 36, cell = atlas.width / 6;
  // 1. cut, feather edges, and find each frame's ground-contact point (as in the impact pack)
  const raw = [], offsets = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas'); c.width = c.height = CELL;
    const g = c.getContext('2d');
    g.drawImage(atlas, (i % 6) * cell, Math.floor(i / 6) * cell, cell, cell, 0, 0, CELL, CELL);
    g.globalCompositeOperation = 'destination-in';
    let m = g.createLinearGradient(0, 0, CELL, 0);
    m.addColorStop(0, 'transparent'); m.addColorStop(0.1, 'white'); m.addColorStop(0.9, 'white'); m.addColorStop(1, 'transparent');
    g.fillStyle = m; g.fillRect(0, 0, CELL, CELL);
    m = g.createLinearGradient(0, 0, 0, CELL);
    m.addColorStop(0, 'transparent'); m.addColorStop(0.08, 'white'); m.addColorStop(0.88, 'white'); m.addColorStop(1, 'transparent');
    g.fillStyle = m; g.fillRect(0, 0, CELL, CELL);
    const px = g.getImageData(0, 0, CELL, CELL).data;
    let bottom = 0, sum = 0, w = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (px[(y * CELL + x) * 4 + 3] > 12) bottom = Math.max(bottom, y);
    for (let y = Math.max(0, bottom - 18); y <= bottom; y++) for (let x = 0; x < CELL; x++) { const a = px[(y * CELL + x) * 4 + 3]; if (a > 12) { sum += x * a; w += a; } }
    raw.push(c);
    // Horizontal: centre on the whole cloud's alpha-weighted centre of mass. The source rows drift left
    // and reset every 6 frames (a sawtooth that reads as jiggling); the game adds real wind drift instead.
    let mx = 0, mw = 0;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) { const a = px[(y * CELL + x) * 4 + 3]; mx += x * a; mw += a; }
    offsets.push({ x: mw ? CELL / 2 - mx / mw : (w ? CELL / 2 - sum / w : 0), y: bottom ? CELL * 0.95 - bottom : 0 });
  }
  // 2. align with smoothed offsets, then grade into the battlefield palette
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // cold palette measured from the concept art: churned black-brown earth -> grey-blue smoke
  const STOPS = [[0, [20, 19, 19]], [0.28, [44, 41, 40]], [0.55, [76, 75, 78]], [0.8, [112, 113, 119]], [1, [150, 153, 161]]];
  const pal = (u) => {
    u = Math.max(0, Math.min(1, u));
    for (let k = 1; k < STOPS.length; k++) if (u <= STOPS[k][0]) {
      const [u0, c0] = STOPS[k - 1], [u1, c1] = STOPS[k], t = (u - u0) / (u1 - u0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
    return STOPS[STOPS.length - 1][1];
  };
  const alphas = [];
  const out = document.createElement('canvas'); out.width = out.height = CELL * 6;
  const og = out.getContext('2d');
  for (let i = 0; i < N; i++) {
    let x = 0, y = 0, wt = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(N - 1, i + 1); j++) { const k = j === i ? 2 : 1; y += offsets[j].y * k; wt += k; }
    x = offsets[i].x * wt; // horizontal: each frame's own centre (smoothing would re-introduce the row jumps)
    const c = document.createElement('canvas'); c.width = c.height = CELL;
    const g = c.getContext('2d');
    g.drawImage(raw[i], x / wt, y / wt);
    const im = g.getImageData(0, 0, CELL, CELL), d = im.data;
    const earth = 1 - sm(8, 24, i); // early frames: thrown-up soil; later: smoke
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] === 0) continue;
      const r = d[p], gg = d[p + 1], b = d[p + 2];
      const l = 0.3 * r + 0.59 * gg + 0.11 * b;
      let u = (l - 33) / 126;
      u = 0.5 + (u - 0.5) * (1.15 + 0.2 * earth); // keep the sunlit / shadow modelling readable
      u = u * (1 - 0.12 * earth) - 0.02 * earth; // soil reads a little darker than smoke
      let c3 = pal(u);
      // keep a trace of the original colour so it is not flat grey; a touch warmer in the soil
      const keep = 0.12 + 0.1 * earth;
      c3 = [c3[0] + (r - l) * keep, c3[1] + (gg - l) * keep, c3[2] + (b - l) * keep];
      // the muzzle-bright core of the first frames keeps its glow, slightly desaturated
      if (i < 4 && l > 150 && r > gg) { const f = sm(150, 215, l) * (1 - i / 4); c3 = [lerp(c3[0], r * 0.85 + l * 0.15, f), lerp(c3[1], gg * 0.8 + l * 0.2, f), lerp(c3[2], b * 0.7 + l * 0.3, f)]; }
      d[p] = c3[0]; d[p + 1] = c3[1]; d[p + 2] = c3[2];
    }
    g.putImageData(im, 0, 0);
    og.drawImage(c, (i % 6) * CELL, Math.floor(i / 6) * CELL);
    const al = new Float32Array((CELL / 4) * (CELL / 4));
    for (let y = 0; y < CELL / 4; y++) for (let x = 0; x < CELL / 4; x++) al[y * (CELL / 4) + x] = d[((y * 4) * CELL + x * 4) * 4 + 3] / 255;
    alphas.push(al);
  }
  // visual difference between neighbouring frames (mean absolute alpha change)
  const pairDiff = [];
  for (let i = 0; i < N - 1; i++) { let e = 0; const a = alphas[i], b = alphas[i + 1]; for (let k = 0; k < a.length; k++) e += Math.abs(a[k] - b[k]); pairDiff.push(e / a.length); }
  return { url: out.toDataURL('image/webp', 0.92), pairDiff };
}, { src, CELL });
const { pairDiff } = url;
await browser.close();
writeFileSync(join(OUT, 'impact.webp'), Buffer.from(url.url.split(',')[1], 'base64'));

// Re-time the frames so the visual rate of change follows a smooth curve: each interval gets a duration
// proportional to how much its two frames actually differ, against a smoothed version of the original
// pace (the fast burst / slow smoke envelope is kept; total length unchanged).
const T0 = meta.frameTimesSeconds, n = T0.length;
const rate = pairDiff.map((d, j) => Math.max(1e-4, d) / (T0[j + 1] - T0[j]));
const lr = rate.map(Math.log), sm = lr.map((_, j) => { let s2 = 0, w2 = 0; for (let q = -3; q <= 3; q++) { const k = j + q; if (k < 0 || k >= lr.length) continue; const w = Math.exp(-(q * q) / (2 * 1.6 * 1.6)); s2 += lr[k] * w; w2 += w; } return Math.exp(s2 / w2); });
let dts = pairDiff.map((d, j) => Math.max(1e-4, d) / sm[j]);
// keep each interval within a sane range of its original length
dts = dts.map((v, j) => Math.max(0.5, Math.min(2, v / (T0[j + 1] - T0[j]))) * (T0[j + 1] - T0[j]));
const scale = (T0[n - 1] - T0[0]) / dts.reduce((a, b) => a + b, 0);
const frameTimes = [0]; for (const v of dts) frameTimes.push(+(frameTimes[frameTimes.length - 1] + v * scale).toFixed(4));
console.log('pair diffs', pairDiff.map((v) => v.toFixed(3)).join(' '));
console.log('re-timed', frameTimes.join(' '));
writeFileSync(join(OUT, 'impact.json'), JSON.stringify({
  columns: 6, frameSize: CELL, frameCount: 36, frameTimes, sourceFrameTimes: meta.frameTimesSeconds, duration: meta.durationSeconds, anchor: { x: 0.5, y: 0.95 },
}, null, 1) + '\n');
console.log('wrote assets/fx/impact.webp');
