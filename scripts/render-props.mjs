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
const { NATIONS, SOLDIER_POSES, IDLE_POSES, CORPSES, PARTS, FALL_FRAMES, FALLS, VARIANT_POSES } = await import('../tools/render3d/soldier.mjs');
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
    for (let v = 0; v < 6; v++) list.push({ name: `birch${v}${s}`, kind: 'birch', args: [v, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `log${v}${s}`, kind: 'log', args: [v, snow] });
    for (let v = 0; v < 3; v++) list.push({ name: `debris${v}${s}`, kind: 'debris', args: [v, snow] });
    for (let v = 0; v < 4; v++) list.push({ name: `rock${v}${s}`, kind: 'rock', args: [v, snow] });
    for (const size of [1, 2, 3]) for (let v = 0; v < 3; v++) list.push({ name: `boulder${size}_${v}${s}`, kind: 'crag', args: [v, size, snow] });
    for (const size of [1, 2, 3]) for (let v = 0; v < 3; v++) list.push({ name: `round${size}_${v}${s}`, kind: 'boulder', args: [v, size, snow] });
    if (!snow) for (const size of [1, 2, 3]) for (let v = 0; v < 3; v++) { list.push({ name: `boulder${size}_${v}_d`, kind: 'crag', args: [v, size, false, false, true] }); list.push({ name: `round${size}_${v}_d`, kind: 'boulder', args: [v, size, false, true] }); } // dry rock, no snow (Gallipoli)
    for (const size of [1, 2, 3]) for (let v = 0; v < 3; v++) list.push({ name: `knoll${size}_${v}${s}`, kind: 'crag', args: [v + 20, size, snow, true] }); // impassable: rock grown over with grass and conifers
    for (let v = 0; v < 4; v++) list.push({ name: `scree${v}${s}`, kind: 'scree', args: [v, snow] }); // passable loose stones // rounded boulders, mixed in among the crags
    for (let v = 0; v < 3; v++) list.push({ name: `giant${v}${s}`, kind: 'crag', args: [v + 5, 9, snow], scale: 1.5 }); // the great boulders at the back of a valley
    for (const ax of ['x', 'y']) list.push({ name: `bridge_${ax}${s}`, kind: 'bridge', args: [ax, snow] });
  }
  for (const view of ['a', 'b']) list.push({ name: `mg_${view}`, kind: 'mg', args: [view] });
  for (let v = 0; v < 3; v++) list.push({ name: `boat${v}`, kind: 'boat', args: [v, true] }); // landing boats, rowed in
  for (let v = 0; v < 3; v++) for (let f = 0; f < 4; f++) list.push({ name: `boat${v}_r${f}`, kind: 'boat', args: [v, true, f] }); // ...the stroke of the oars
  for (let k = 0; k < 4; k++) list.push({ name: `boat_piece${k}`, kind: 'boatpiece', args: [k] }); // a boat smashed by a shell
  for (let f = 0; f < 4; f++) list.push({ name: `boat_back_r${f}`, kind: 'boat', args: [1, false, f, true, true] }); // emptied, one man rowing her back out to sea
  list.push({ name: 'boat_empty', kind: 'boat', args: [7, false] });
  list.push({ name: 'clyde', kind: 'clyde', args: [], scale: 1.6 }); // the River Clyde
  for (const snow of [false, true]) list.push({ name: `hq${snow ? '_s' : ''}`, kind: 'hq', args: [snow] });
  for (const snow of [false, true]) for (const w of [false, true]) list.push({ name: `bunker${w ? '_x' : ''}${snow ? '_s' : ''}`, kind: 'bunker', args: [snow, w] });
  for (let d = 0; d < 8; d++) for (let f = 0; f < 8; f++) list.push({ name: `gun_d${d}_f${f}`, kind: 'gun', args: [d, f] });
  for (let d = 0; d < 8; d++) for (let f = 0; f < 8; f++) list.push({ name: `gun_t_d${d}_f${f}`, kind: 'gun', args: [d, f, true] }); // on the move: trail lifted, barrel down
  for (const nation of Object.keys(NATIONS)) for (const [pose, frames] of [...SOLDIER_POSES, ...IDLE_POSES]) for (let f = 0; f < frames; f++) for (const view of ['a', 'b'])
    list.push({ name: `${pose}${f}_${view}`, dir: `soldiers/${nation}`, kind: 'soldier', args: [nation, pose, f, view], scale: 4 });
  // colour variants (worn, faded) of the poses seen most
  for (const nation of Object.keys(NATIONS)) for (const v of [1, 2]) for (const [pose, frames] of VARIANT_POSES) for (let f = 0; f < frames; f++) for (const view of ['a', 'b'])
    list.push({ name: `${pose}${f}_${view}_v${v}`, dir: `soldiers/${nation}`, kind: 'soldier', args: [nation, pose, f, view, false, v], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (let v = 0; v < CORPSES.length; v++) for (let d = 0; d < 8; d++)
    list.push({ name: `corpse_v${v}_d${d}`, dir: `soldiers/${nation}`, kind: 'corpse', args: [nation, v, d], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (let v = 0; v < FALLS.length; v++) for (let d = 0; d < 8; d++) for (let f = 0; f < FALL_FRAMES; f++)
    list.push({ name: `fall_v${v}_d${d}_f${f}`, dir: `soldiers/${nation}`, kind: 'fall', args: [nation, v, d, f], scale: 4 });
  for (const nation of Object.keys(NATIONS)) for (const [part, dirs] of Object.entries(PARTS)) for (let d = 0; d < dirs; d++)
    list.push({ name: `part_${part}_d${d}`, dir: `soldiers/${nation}`, kind: 'part', args: [nation, part, d], scale: 4 });
  for (let v = 0; v < 3; v++) for (const d of [0, 2, 5]) list.push({ name: `float_v${v}_d${d}`, dir: 'soldiers/uk', kind: 'float', args: ['uk', v, d], scale: 4 }); // the dead in the sea
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

if (isMainThread && process.argv[2] === '--footprints') {
  // for repairing sprites rendered before the grazing-ray fix: each sprite's ground footprint outline
  // (in its own pixels), written as JSON for scripts/fix-edges.py
  const core = await import('../tools/render3d/core.mjs');
  const scenes = await import('../tools/render3d/scenes.mjs');
  const sold = await import('../tools/render3d/soldier.mjs');
  const make = { trench: scenes.trenchScene, wire: scenes.wireScene, trunk: scenes.trunkScene, log: scenes.logScene, debris: scenes.debrisScene, mg: scenes.mgScene, hq: scenes.hqScene, bunker: scenes.bunkerScene, rock: scenes.rockScene, boulder: scenes.boulderScene, crag: scenes.cragScene, boat: scenes.boatScene, boatpiece: scenes.boatPieceScene, float: sold.floatScene, clyde: scenes.clydeScene, birch: scenes.birchScene, knoll: scenes.knollScene, scree: scenes.screeScene, bridge: scenes.bridgeScene, gun: scenes.gunScene, soldier: sold.soldierScene, corpse: sold.corpseScene, part: sold.partScene, fall: sold.fallScene };
  const out = {};
  for (const j of jobs()) {
    const sc = make[j.kind](...j.args), scale = core.PX_PER_UNIT * (j.scale || SCALE);
    const [x0, y0, z0, x1, y1] = sc.bounds;
    const pts = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, 0]) pts.push(core.project(x, y, z, scale));
    out[(j.dir ? j.dir + '/' : 'props/') + j.name] = pts;
  }
  writeFileSync(process.argv[3], JSON.stringify(out));
  console.log('footprints', Object.keys(out).length);
  process.exit(0);
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
  const make = { trench: scenes.trenchScene, wire: scenes.wireScene, trunk: scenes.trunkScene, log: scenes.logScene, debris: scenes.debrisScene, mg: scenes.mgScene, hq: scenes.hqScene, bunker: scenes.bunkerScene, rock: scenes.rockScene, boulder: scenes.boulderScene, crag: scenes.cragScene, boat: scenes.boatScene, boatpiece: scenes.boatPieceScene, float: (await import('../tools/render3d/soldier.mjs')).floatScene, clyde: scenes.clydeScene, birch: scenes.birchScene, knoll: scenes.knollScene, scree: scenes.screeScene, bridge: scenes.bridgeScene, gun: scenes.gunScene, soldier: (await import('../tools/render3d/soldier.mjs')).soldierScene, corpse: (await import('../tools/render3d/soldier.mjs')).corpseScene, part: (await import('../tools/render3d/soldier.mjs')).partScene, fall: (await import('../tools/render3d/soldier.mjs')).fallScene };
  parentPort.on('message', (job) => {
    const scale = job.scale || SCALE;
    const r = core.render(make[job.kind](...job.args), core.PX_PER_UNIT * scale);
    parentPort.postMessage({ name: job.name, dir: job.dir, scale, w: r.w, h: r.h, ax: r.ax, ay: r.ay, data: r.data.buffer }, [r.data.buffer]);
  });
  void workerData;
}
