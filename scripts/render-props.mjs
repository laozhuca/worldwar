// Pre-renders WorldWar's 3D props (trench tiles, barbed wire, stumps, trees, logs, debris) to
// assets/props/*.png plus manifest.json, in parallel worker threads. Zero dependencies.
//   node scripts/render-props.mjs            (all)
//   node scripts/render-props.mjs trench_m5  (only names starting with a prefix)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'assets', 'props');
export const SCALE = 3; // render at 3x so props stay crisp when zoomed in

function jobs() {
  const list = [];
  for (const snow of [false, true]) {
    const s = snow ? '_s' : '';
    for (let mask = 0; mask < 16; mask++) for (const lvl of [1, 2, 3]) for (let v = 0; v < 3; v++) list.push({ name: `trench_m${mask}_l${lvl}_v${v}${s}`, kind: 'trench', args: [mask, lvl, snow, v] });
    for (const dir of ['x', 'y']) {
      for (let v = 0; v < 2; v++) list.push({ name: `wire_${dir}${v}${s}`, kind: 'wire', args: [dir, v, false, snow] });
      for (let v = 0; v < 2; v++) list.push({ name: `wired_${dir}${v}${s}`, kind: 'wire', args: [dir, v, true, snow] });
    }
    for (let v = 0; v < 4; v++) list.push({ name: `stump${v}${s}`, kind: 'trunk', args: [v, false, snow] });
    for (let v = 0; v < 2; v++) list.push({ name: `tree${v}${s}`, kind: 'trunk', args: [v, true, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `log${v}${s}`, kind: 'log', args: [v, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `debris${v}${s}`, kind: 'debris', args: [v, snow] });
  }
  return list;
}

// ---------------------------------------------------------------- PNG
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

if (isMainThread) {
  mkdirSync(OUT, { recursive: true });
  const prefix = process.argv[2] || '';
  const todo = jobs().filter((j) => j.name.startsWith(prefix));
  const manifestPath = join(OUT, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const t0 = Date.now();
  let next = 0, done = 0, bytes = 0;
  const n = Math.max(1, Math.min(cpus().length, todo.length));
  await new Promise((resolve) => {
    for (let k = 0; k < n; k++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: {} });
      const feed = () => { if (next < todo.length) w.postMessage(todo[next++]); else w.terminate(); };
      w.on('message', ({ name, w: W, h: H, ax, ay, data }) => {
        const buf = png(W, H, new Uint8ClampedArray(data));
        writeFileSync(join(OUT, name + '.png'), buf);
        manifest[name] = { w: W, h: H, ax, ay, scale: SCALE };
        bytes += buf.length;
        done++;
        process.stdout.write(`\r${done}/${todo.length} ${name}                `);
        if (done === todo.length) resolve();
        feed();
      });
      feed();
    }
  });
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  writeFileSync(manifestPath, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`\nrendered ${todo.length} props (${(bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  const core = await import('../tools/render3d/core.mjs');
  const scenes = await import('../tools/render3d/scenes.mjs');
  const make = { trench: scenes.trenchScene, wire: scenes.wireScene, trunk: scenes.trunkScene, log: scenes.logScene, debris: scenes.debrisScene };
  parentPort.on('message', (job) => {
    const r = core.render(make[job.kind](...job.args), core.PX_PER_UNIT * SCALE);
    parentPort.postMessage({ name: job.name, w: r.w, h: r.h, ax: r.ax, ay: r.ay, data: r.data.buffer }, [r.data.buffer]);
  });
  void workerData;
}
