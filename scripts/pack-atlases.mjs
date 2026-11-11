// Packs the rendered sprites into a few WebP sprite sheets so the game downloads ~a dozen files
// instead of ~430 separate PNGs. Dev-only (uses Playwright's Chromium to encode WebP).
//   node scripts/pack-atlases.mjs
// Output: assets/atlas/<group>-<n>.webp + assets/atlas/<group>.json
//   frames[name] = { s: sheet index, x, y, w, h, ax, ay, scale }
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = join(root, 'assets');
const OUT = join(A, 'atlas');
const SHEET = 2048, PAD = 2, QUALITY = 0.9;

const groups = {};
const props = JSON.parse(readFileSync(join(A, 'props', 'manifest.json'), 'utf8'));
for (const [k, m] of Object.entries(props)) {
  const g = k.startsWith('mg_') ? 'units' : k.endsWith('_s') ? 'props-snow' : 'props-bare';
  (groups[g] ||= []).push({ name: k, file: join(A, 'props', k + '.png'), ...m });
}
for (const nation of readdirSync(join(A, 'soldiers'))) {
  const man = JSON.parse(readFileSync(join(A, 'soldiers', nation, 'manifest.json'), 'utf8'));
  for (const [k, m] of Object.entries(man)) {
    if (k === 'portrait') continue;
    (groups['soldiers-' + nation] ||= []).push({ name: k, file: join(A, 'soldiers', nation, k + '.png'), ...m });
  }
}

/** Shelf packing, tallest first. */
function pack(items) {
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const sheets = [];
  let sheet = null, x = 0, y = 0, rowH = 0;
  const newSheet = () => { sheet = { items: [], w: 0, h: 0 }; sheets.push(sheet); x = 0; y = 0; rowH = 0; };
  newSheet();
  for (const it of items) {
    const w = it.w + PAD, h = it.h + PAD;
    if (x + w > SHEET) { x = 0; y += rowH; rowH = 0; }
    if (y + h > SHEET) newSheet();
    it.x = x; it.y = y; it.s = sheets.length - 1;
    sheet.items.push(it);
    x += w; rowH = Math.max(rowH, h);
    sheet.w = Math.max(sheet.w, x); sheet.h = Math.max(sheet.h, y + rowH);
  }
  return sheets;
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const index = {};
let total = 0;
for (const [g, items] of Object.entries(groups)) {
  const sheets = pack(items);
  const frames = {};
  for (let s = 0; s < sheets.length; s++) {
    const sh = sheets[s];
    const payload = sh.items.map((it) => ({ x: it.x, y: it.y, url: 'data:image/png;base64,' + readFileSync(it.file).toString('base64') }));
    const url = await page.evaluate(async ({ w, h, payload, q }) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      for (const p of payload) { const i = new Image(); i.src = p.url; await i.decode(); x.drawImage(i, p.x, p.y); }
      return c.toDataURL('image/webp', q);
    }, { w: sh.w, h: sh.h, payload, q: QUALITY });
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(join(OUT, `${g}-${s}.webp`), buf);
    total += buf.length;
    for (const it of sh.items) frames[it.name] = { s, x: it.x, y: it.y, w: it.w, h: it.h, ax: it.ax, ay: it.ay, scale: it.scale };
  }
  writeFileSync(join(OUT, g + '.json'), JSON.stringify({ sheets: sheets.length, frames }) + '\n');
  index[g] = sheets.length;
  console.log(`${g}: ${items.length} sprites -> ${sheets.length} sheet(s)`);
}
await browser.close();
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
