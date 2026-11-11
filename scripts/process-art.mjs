// Cuts the white studio background out of the source art in art-src/ and writes game-ready PNGs to
// assets/art/ (plus a manifest with sizes). Dev-only: uses Playwright's Chromium for image decoding.
//   node scripts/process-art.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-src'), OUT = join(root, 'assets', 'art');
mkdirSync(OUT, { recursive: true });

// Output sizes: guns are drawn ~90 px wide in game (so 4x density), soldiers are UI portraits.
const SIZE = (name) => (name.startsWith('gun') ? { w: 384 } : { h: 720 });

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

const browser = await chromium.launch();
const page = await browser.newPage();
const manifest = {};
for (const file of readdirSync(SRC).filter((f) => /\.(webp|png|jpe?g)$/i.test(f)).sort()) {
  const name = basename(file, extname(file));
  const mime = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[extname(file).toLowerCase()];
  const src = `data:${mime};base64,` + readFileSync(join(SRC, file)).toString('base64');
  const res = await page.evaluate(async ({ src, size }) => {
    const img = new Image(); img.src = src; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const im = x.getImageData(0, 0, W, H), d = im.data;
    // background = near-white, low-saturation pixels connected to the border (flood fill)
    const hasAlpha = d[3] < 250; // source already cut out: only crop
    const isBg = (i) => { if (d[i + 3] < 12) return true; if (hasAlpha) return false; const r = d[i], g = d[i + 1], b = d[i + 2]; return Math.min(r, g, b) > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 26; };
    const bg = new Uint8Array(W * H), stack = [];
    for (let px = 0; px < W; px++) stack.push(px, (H - 1) * W + px);
    for (let py = 0; py < H; py++) stack.push(py * W, py * W + W - 1);
    while (stack.length) {
      const p = stack.pop();
      if (bg[p] || !isBg(p * 4)) continue;
      bg[p] = 1;
      const px = p % W, py = (p / W) | 0;
      if (px > 0) stack.push(p - 1); if (px < W - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - W); if (py < H - 1) stack.push(p + W);
    }
    // soft, colour-decontaminated edge on pixels bordering the background
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const p = py * W + px, i = p * 4;
      if (bg[p]) { d[i + 3] = 0; continue; }
      let edge = false;
      if (hasAlpha) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; continue; }
      for (let k = -2; k <= 2 && !edge; k++) for (let j = -2; j <= 2; j++) {
        const qx = px + j, qy = py + k;
        if (qx >= 0 && qy >= 0 && qx < W && qy < H && bg[qy * W + qx]) { edge = true; break; }
      }
      if (edge) {
        const m = Math.min(d[i], d[i + 1], d[i + 2]);
        const a = Math.max(0.15, Math.min(1, (252 - m) / 60));
        for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] - (1 - a) * 255) / a));
        d[i + 3] = a * 255;
      }
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    x.putImageData(im, 0, 0);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const s = size.w ? size.w / cw : size.h / ch;
    const o = document.createElement('canvas'); o.width = Math.round(cw * s); o.height = Math.round(ch * s);
    const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high';
    ox.drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
    return { url: o.toDataURL('image/png'), w: o.width, h: o.height };
  }, { src, size: SIZE(name) });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(res.url.split(',')[1], 'base64'));
  manifest[name] = { w: res.w, h: res.h };
  console.log(`${name}.png ${res.w}x${res.h}`);
}
await browser.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
