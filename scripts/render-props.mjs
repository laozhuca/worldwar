// Pre-renders WorldWar's 3D props (trench tiles, barbed wire, stumps, trees, logs, debris) to
// assets/props/*.png plus manifest.json, in parallel worker threads. Zero dependencies.
//   node scripts/render-props.mjs            (all)
//   node scripts/render-props.mjs trench_m5  (only names starting with a prefix)
//   node scripts/render-props.mjs /_d[12]/   (only names matching a regular expression)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '..', 'assets');
const { NATIONS, SOLDIER_POSES, CORPSES, PARTS, FALL_FRAMES, FALLS } = await import('../tools/render3d/soldier.mjs');
export const SCALE = 3; // render at 3x so props stay crisp when zoomed in

function jobs() {
  const list = [];
  for (const snow of [false, true]) {
    const s = snow ? '_s' : '';
    for (let mask = 0; mask < 16; mask++) for (const lvl of [1, 2, 3]) for (let v = 0; v < 3; v++) list.push({ name: `trench_m${mask}_l${lvl}_v${v}${s}`, kind: 'trench', args: [mask, lvl, snow, v] });
    // shell-damaged works: damaged (d1) and wrecked (d2)
    for (let mask = 0; mask < 16; mask++) for (const lvl of [1, 2, 3]) for (const dmg of [1, 2]) list.push({ name: `trench_m${mask}_l${lvl}_d${dmg}${s}`, kind: 'trench', args: [mask, lvl, snow, 0, dmg] });
    for (const dir of ['x', 'y']) {
      for (let v = 0; v < 2; v++) list.push({ name: `wire_${dir}${v}${s}`, kind: 'wire', args: [dir, v, false, snow] });
      for (let v = 0; v < 2; v++) list.push({ name: `wired_${dir}${v}${s}`, kind: 'wire', args: [dir, v, true, snow] });
    }
    for (let v = 0; v < 4; v++) list.push({ name: `stump${v}${s}`, kind: 'trunk', args: [v, false, snow] });
    for (let v = 0; v < 2; v++) list.push({ name: `tree${v}${s}`, kind: 'trunk', args: [v, true, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `log${v}${s}`, kind: 'log', args: [v, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `debris${v}${s}`, kind: 'debris', args: [v, snow] });
  }
  for (const view of ['a', 'b']) list.push({ name: `mg_${view}`, kind: 'mg', args: [view] });
  for (const snow of [false, true]) list.push({ name: `hq${snow ? '_s' : ''}`, kind: 'hq', args: [snow] });
  for (let d = 0; d < 8; d++) for (let f = 0; f < 8; f++) list.push({ name: `gun_d${d}_f${f}`, kind: 'gun', args: [d, f] });
  for (const nation of Object.keys(NATIONS)) for (const [pose, frames] of SOLDIER_POSES) for (let f = 0; f < frames; f++) for (const view of ['a', 'b'])
    list.push({ name: `${pose}${f}_${view}`, dir: `soldiers/${nation}`, kind: 'soldier', args: [nation, pose, f, view], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (let v = 0; v < CORPSES.length; v++) for (let d = 0; d < 8; d++)
    list.push({ name: `corpse_v${v}_d${d}`, dir: `soldiers/${nation}`, kind: 'corpse', args: [nation, v, d], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (let v = 0; v < FALLS.length; v++) for (let d = 0; d < 8; d++) for (let f = 0; f < FALL_FRAMES; f++)
    list.push({ name: `fall_v${v}_d${d}_f${f}`, dir: `soldiers/${nation}`, kind: 'fall', args: [nation, v, d, f], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (const [part, dirs] of Object.entries(PARTS)) for (let d = 0; d < dirs; d++)
    list.push({ name: `part_${part}_d${d}`, dir: `soldiers/${nation}`, kind: 'part', args: [nation, part, d], scale: 4 });
  for (const nation of Object.keys(NATIONS)) list.push({ name: 'portrait', dir: `soldiers/${nation}`, kind: 'soldier', args: [nation, 'stand', 0, 'a', true], scale: 16 });
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
  const prefix = process.argv[2] || '';
  // a prefix, or /regex/ (e.g. "/trench_m.*_d/" for the damaged trench tiles)
  const re = prefix.startsWith('/') && prefix.endsWith('/') && prefix.length > 2 ? new RegExp(prefix.slice(1, -1)) : null;
  const todo = jobs().filter((j) => { const n = (j.dir ? j.dir + '/' : '') + j.name; return re ? re.test(n) : n.startsWith(prefix); });
  const manifests = {};
  const man = (dir) => {
    if (!manifests[dir]) { const p = join(ASSETS, dir, 'manifest.json'); mkdirSync(join(ASSETS, dir), { recursive: true }); manifests[dir] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; }
    return manifests[dir];
  };
  const t0 = Date.now();
  let next = 0, done = 0, bytes = 0;
  const n = Math.max(1, Math.min(cpus().length, todo.length));
  await new Promise((resolve) => {
    for (let k = 0; k < n; k++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: {} });
      const feed = () => { if (next < todo.length) w.postMessage(todo[next++]); else w.terminate(); };
      w.on('message', ({ name, dir, scale, w: W, h: H, ax, ay, data }) => {
        const buf = png(W, H, new Uint8ClampedArray(data));
        const d = dir || 'props';
        man(d);
        writeFileSync(join(ASSETS, d, name + '.png'), buf);
        man(d)[name] = { w: W, h: H, ax, ay, scale };
        bytes += buf.length;
        done++;
        process.stdout.write(`\r${done}/${todo.length} ${name}                `);
        if (done === todo.length) resolve();
        feed();
      });
      feed();
    }
  });
  for (const [d, m] of Object.entries(manifests)) writeFileSync(join(ASSETS, d, 'manifest.json'), JSON.stringify(Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]])), null, 1) + '\n');
  console.log(`\nrendered ${todo.length} props (${(bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  const core = await import('../tools/render3d/core.mjs');
  const scenes = await import('../tools/render3d/scenes.mjs');
  const make = { trench: scenes.trenchScene, wire: scenes.wireScene, trunk: scenes.trunkScene, log: scenes.logScene, debris: scenes.debrisScene, mg: scenes.mgScene, hq: scenes.hqScene, gun: scenes.gunScene, soldier: (await import('../tools/render3d/soldier.mjs')).soldierScene, corpse: (await import('../tools/render3d/soldier.mjs')).corpseScene, part: (await import('../tools/render3d/soldier.mjs')).partScene, fall: (await import('../tools/render3d/soldier.mjs')).fallScene };
  parentPort.on('message', (job) => {
    const scale = job.scale || SCALE;
    const r = core.render(make[job.kind](...job.args), core.PX_PER_UNIT * scale);
    parentPort.postMessage({ name: job.name, dir: job.dir, scale, w: r.w, h: r.h, ax: r.ax, ay: r.ay, data: r.data.buffer }, [r.data.buffer]);
  });
  void workerData;
}
