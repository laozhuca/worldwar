// Renders tools/sprite-art.js in headless Chromium and writes assets/sprites/*.png plus a manifest.
// Dev-only: needs Playwright with Chromium (`npx playwright install chromium` if missing).
//   node scripts/make-sprites.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'assets', 'sprites');
mkdirSync(OUT, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ content: readFileSync(join(root, 'tools', 'sprite-art.js'), 'utf8') });
const sprites = await page.evaluate(() => {
  const s = window.makeSprites();
  return Object.fromEntries(Object.entries(s).map(([k, c]) => [k, { url: c.toDataURL('image/png'), w: c.width, h: c.height }]));
});
await browser.close();

const manifest = {};
let total = 0;
for (const [name, { url, w, h }] of Object.entries(sprites)) {
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(join(OUT, name + '.png'), buf);
  manifest[name] = { w, h };
  total += buf.length;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`${Object.keys(manifest).length} sprites, ${(total / 1024).toFixed(0)} KB -> assets/sprites/`);
