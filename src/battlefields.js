// Skirmish battlefields: ten fields of the Great War, each with its own shape on screen, its own ground and
// its own weather (after the battlefield design guide). Every field is generated afresh from the battle's
// seed (the lie of the woods, lakes and villages, the zigzag of the lines, a front a tile or so further
// forward or back) on the same plan, so no two battles on one field are quite alike.
//
// Geometry: the field is cut from the usual diamond to a rectangle on screen, |u| <= A, |v| <= B round
// the centre (u = x - y across the screen, v = x + y down it), so its proportions are 2A : B. The fronts
// run along tile columns (diagonals on screen); every field after the first is shown mirrored in turn.
import { PLAYER, ENEMY } from './config.js';
import { setMapRadius, setWestTeam, tileAt, noSquares, mulberry32, frontLine, teamDir } from './map.js';
import { createGame, spawnUnit } from './game.js';
import { blockBuilding } from './campaign.js';

// the ruined houses of the Dixmude level, reused as farms, cabins and town blocks: image, anchor, half-size
const HOUSES = {
  dawn: [175, 157, 1.25, 1.45], 'dawn-b': [152, 188, 1.45, 1.25], 'dawn-c': [154, 171, 1.25, 1.45],
  home: [101, 170, 0.8, 1.45], 'home-b': [129, 165, 1.45, 0.8], 'home-c': [136, 133, 0.8, 1.45],
  cottage: [123, 156, 1.4, 0.8], station: [165, 213, 2.2, 1.1],
};
const SMALL = ['dawn', 'dawn-b', 'dawn-c', 'home', 'home-b', 'home-c', 'cottage'];

/**
 * The battlefields. A, B: the half-extents of the field (tiles of u and v); front: how far each front
 * line stands from the middle; season: the ground's look (snow cover); weather: rainy / snowy / dusty
 * (how much of each, 0-1), windK and windDir (strength, direction), sightK (how far men see).
 */
export const BATTLEFIELDS = [
  {
    id: 'flanders', name: 'Flanders Flats', place: 'Ypres · Passchendaele, 1917', format: '5:3', A: 40, B: 48, front: 15, season: 'mud', craters: 2.4,
    weather: { rainy: 1, windK: 1.1, windDir: 1.35, sightK: 1 },
    about: 'Reclaimed polder churned to liquid mud. Duckboard tracks are the only firm going; rain floods the shell holes and slows everything off the boards.',
    features: ['Shell craters', 'Duckboards', 'Shattered trees', 'Flooded holes', 'Wire belts', 'Sunken lanes'],
    build: flanders,
  },
  {
    id: 'picardy', name: 'Picardy Patchwork', place: 'The Somme · Amiens, 1918', format: '3:2', A: 36, B: 48, front: 13, season: 'summer', craters: 0.5,
    weather: { rainy: 0.3, windK: 0.6, windDir: 0.4, sightK: 1 },
    about: 'Hedged fields of wheat and pasture, orchards and walled farms. Cart tracks cross the lines: the best lanes for tanks.',
    features: ['Hedgerows', 'Wheat fields', 'Orchards', 'Farm compounds', 'Cart tracks', 'A creek'],
    build: picardy,
  },
  {
    id: 'dixmude', name: 'Dixmude Canal Town', place: 'The Yser, 1914', format: '4:3', A: 32, B: 48, front: 12, season: 'thaw',
    weather: { rainy: 0.5, windK: 0.9, windDir: 0.2, sightK: 0.95 },
    about: 'A canal between the lines, crossed by a few bridges; brick streets, a market square, a railway embankment and warehouses along the siding.',
    features: ['Brick blocks', 'Canal banks', 'Bridges', 'Rail embankment', 'Market square', 'Gardens', 'Warehouses'],
    build: dixmude,
  },
  {
    id: 'argonne', name: 'Argonne Woods', place: 'The Argonne Forest, 1918', format: '1:1', A: 28, B: 56, front: 11, season: 'mud',
    weather: { rainy: 0.45, windK: 0.7, windDir: 0.8, sightK: 0.8 },
    about: 'Dense forest on broken ground. Men among the trees are seen only close to; forest roads and clearings are the only open ground.',
    features: ['Dense groves', 'Clearings', 'Fallen logs', 'Forest roads', 'Ravines', 'Foxholes'],
    build: argonne,
  },
  {
    id: 'masuria', name: 'Masurian Lakes', place: 'East Prussia, 1915', format: '5:4', A: 35, B: 56, front: 13, season: 'winter',
    weather: { snowy: 0.7, windK: 1, windDir: 0.1, sightK: 0.95 },
    about: 'Lakes and marsh between pine woods. The cold has frozen the shallows into crossings; the deep water still bars the way, save by the causeways.',
    features: ['Lakes', 'Frozen shallows', 'Marsh strips', 'Pine copses', 'Causeways', 'Hamlets', 'Reed beds'],
    build: masuria,
  },
  {
    id: 'galicia', name: 'Galicia Wheat Steppe', place: 'Galicia, 1916', format: '21:9', A: 48, B: 40, front: 17, season: 'summer', craters: 0.4, wire: 0.8,
    weather: { rainy: 0.15, windK: 0.9, windDir: 0.05, sightK: 1.05 },
    about: 'Open rolling steppe of wheat belts and birch groves, wooden villages along dirt roads, a telegraph line and a slow stream. Long sight lines.',
    features: ['Wheat belts', 'Birch groves', 'Wooden villages', 'Dirt roads', 'Telegraph line', 'A stream'],
    build: galicia,
  },
  {
    id: 'karst', name: 'Karst Scar', place: 'The Isonzo, 1917', format: '4:3', A: 32, B: 48, front: 12, season: 'summer', craters: 0.7,
    weather: { windK: 1.8, windDir: 0.6, sightK: 1 },
    about: 'Bare limestone under the bora. Trenches can be dug only in the pockets of softer ground; dry-stone walls, sinkholes and boulders give the cover.',
    features: ['Limestone plates', 'Stone walls', 'Sinkholes', 'Thorn scrub', 'Boulder fields', 'Quarries'],
    build: karst,
  },
  {
    id: 'tyrol', name: 'Tyrol Snowfield', place: 'The Dolomites, 1916', format: '4:5', A: 26, B: 64, front: 12, season: 'winter', craters: 0.6,
    weather: { snowy: 1, windK: 1.3, windDir: 0.3, sightK: 0.9 },
    about: 'A high snowfield between conifer stands and crags. Drifting snow closes the view in and drags at the men; a sled track and the frozen creek are the quick ways.',
    features: ['Snow flats', 'Conifer stands', 'Frozen creek', 'Cabins', 'Sled track', 'Rock outcrops'],
    build: tyrol,
  },
  {
    id: 'gallipoli', name: 'Gallipoli Shore Strip', place: 'Cape Helles, 1915', format: '9:16', A: 20, B: 72, front: 13, season: 'summer',
    weather: { windK: 1.2, windDir: 2.6, sightK: 1 },
    about: 'A narrow strip between the sea and the scrub: beach, cliff edge and gullies, sandbagged nests along the lines, piers run out into the bay.',
    features: ['Beach', 'Scrub', 'Gullies', 'Cliff edge', 'Sandbag nests', 'Piers'],
    build: gallipoli,
  },
  {
    id: 'sinai', name: 'Sinai Wadi', place: 'Sinai · Palestine, 1917', format: '16:10', A: 40, B: 50, front: 15, season: 'summer', craters: 0.3, wire: 0.7,
    weather: { dusty: 0.8, windK: 1.4, windDir: 0.15, sightK: 1.05 },
    about: 'Sand flats and rock shelves cut by dry wadis. Three water points are the prize: each one held adds to that side\'s supplies. Dust storms blow through.',
    features: ['Wadi beds', 'Sand flats', 'Rock shelves', 'Date palms', 'Stone walls', 'Water tower', 'Water points'],
    build: sinai,
  },
];
BATTLEFIELDS.forEach((b, i) => { b.mirror = i % 2 === 1; }); // (alternating: the fronts lean one way, then the other)
export const battlefieldOf = (id) => BATTLEFIELDS.find((b) => b.id === id) || BATTLEFIELDS[0];

/** Put the map module's geometry back for a battle (building a map for a preview changes it). */
export function useGeometry(map) {
  setMapRadius(map.r, map.bandW ? { A: map.bandW, B: map.band } : null);
  setWestTeam(map.west);
}

// ---------------------------------------------------------------------------------------------- generator

/** Smooth value noise (0..1) over the tiles: noise(x, y, frequency, octave seed). */
function makeNoise(rnd) {
  const P = 64, g = Float32Array.from({ length: P * P }, rnd);
  const G = (a, b) => g[(((a % P) + P) % P) * P + (((b % P) + P) % P)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, f, o = 0) => {
    x = x * f + o * 17.31; y = y * f + o * 9.17;
    const xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
    const a = G(xi, yi), b = G(xi + 1, yi), c = G(xi, yi + 1), d = G(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** A min-heap of [cost, index] for the trench planner. */
class Heap {
  constructor() { this.a = []; }
  push(c, i) { const a = this.a; a.push([c, i]); let k = a.length - 1; while (k) { const p = (k - 1) >> 1; if (a[p][0] <= a[k][0]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === k) break; [a[m], a[k]] = [a[k], a[m]]; k = m; } } return top; }
  get size() { return this.a.length; }
}

/**
 * Build a battlefield's map: the field cut to its format, the ground laid out by its own builder, then
 * both trench systems dug along the zigzag fronts round what stands in their way, wire put out in front,
 * old shell holes in no man's land.
 */
export function buildBattlefieldMap(bf, seed, westTeam = PLAYER) {
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const { A, B } = bf, R = Math.max(A, B), w = 2 * R + 1;
  setMapRadius(R, { A, B });
  setWestTeam(westTeam);
  const tiles = new Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const u = x - y, v = x + y - 2 * R;
    tiles[y * w + x] = { x, y, mud: 0, shade: rnd(), crater: 0, trench: 0, owner: -1, origOwner: -1, wire: 0, origWire: -1, build: null, decor: null, ground: 0, off: Math.abs(u) > A || Math.abs(v) > B };
  }
  const map = { w, h: w, r: R, tiles, dirty: true, hq: [], changes: [], west: westTeam, band: B, bandBack: B, bandW: A, mirror: bf.mirror, battlefield: bf.id };
  const T = (x, y) => (x >= 0 && y >= 0 && x < w && y < w && !tiles[y * w + x].off ? tiles[y * w + x] : null);
  const WT = westTeam, ET = 1 - westTeam, dir = (team) => (team === WT ? 1 : -1);

  // ---- the fronts: a column either side of the middle (a tile or so further forward or back each battle),
  // bending gently along its length, with traverses that zigzag irregularly
  const dF = bf.front + Math.floor(rnd() * 3) - 1;
  const D = Math.max(6, Math.min(13, Math.floor((A + B - 8) / 2) - dF)); // how deep each trench system runs
  const fx = [], sx = [];
  for (const team of [WT, ET]) {
    const base = R - dir(team) * dF, ph = rnd() * 6.28, f = 0.05 + rnd() * 0.05;
    const line = new Array(w).fill(-1), sup = new Array(w).fill(-1);
    let off = 0, hold = 0, soff = 0, shold = 0;
    for (let y = 0; y < w; y++) {
      if (hold-- <= 0) { off = Math.max(-2, Math.min(2, off + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)))); hold = 2 + Math.floor(rnd() * 3); }
      if (shold-- <= 0) { soff = Math.max(-1, Math.min(1, soff + (rnd() < 0.5 ? -1 : 1))); shold = 3 + Math.floor(rnd() * 4); }
      const bend = Math.round(Math.sin(y * f + ph) * 1.5);
      line[y] = base + bend + off;
      sup[y] = base + bend - dir(team) * Math.min(6, D - 3) + soff;
    }
    fx[team] = line; sx[team] = sup;
  }
  // ---- headquarters: behind the middle of each line, as deep as the field's shape allows
  const h = dF + D, k = (2 * h) / (A + B - 8);
  const hu = -(A - 4) * k, hv = -(B - 4) * k;
  const hqW = { x: Math.round(R + (hu + hv) / 2), y: Math.round(R + (hv - hu) / 2) };
  map.hq[WT] = hqW;
  map.hq[ET] = { x: 2 * R - hqW.x, y: 2 * R - hqW.y };

  // ---- the ground, by the field's own builder
  const noise = makeNoise(rnd);
  const ctx = {
    map, rnd, noise, T, R, A, B, w, fx, sx, WT, ET, dir, dF, buildings: [], objectives: [],
    uv: (t) => [t.x - t.y, t.x + t.y - 2 * R],
    P: (u, v) => T(Math.round(R + (u + v) / 2), Math.round(R + (v - u) / 2)),
    /** Tiles within r of either headquarters. */
    nearHq: (t, r) => map.hq.some((q) => Math.abs(q.x - t.x) <= r && Math.abs(q.y - t.y) <= r),
    /** On (or within d of) either side's front or support line. */
    onLines: (t, d = 1) => [WT, ET].some((tm) => Math.abs(t.x - fx[tm][t.y]) <= d || Math.abs(t.x - sx[tm][t.y]) <= d),
    /** In no man's land (between the fronts), at least `inset` tiles from either. */
    nml: (t, inset = 0) => { const a = Math.min(fx[WT][t.y], fx[ET][t.y]), b = Math.max(fx[WT][t.y], fx[ET][t.y]); return t.x > a + inset && t.x < b - inset; },
    /** Which side's ground the tile is on: WT, ET, or -1 in no man's land. */
    sideOf: (t) => (t.x < fx[WT][t.y] ? WT : t.x > fx[ET][t.y] ? ET : -1),
    each(f) { for (const t of tiles) if (!t.off) f(t); },
    /** An irregular blob round (cx, cy): f(tile, how far out 0..1). */
    blob(cx, cy, rx, ry, f, jag = 0.35) {
      const o = rnd() * 50;
      for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        const t = T(x, y); if (!t) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (noise(x, y, 0.35, o) - 0.5) * jag * 2;
        if (d < 1) f(t, d);
      }
    },
    /**
     * A winding line of tiles from (x0, y0) to (x1, y1), 4-connected: each step goes the way that closes
     * the distance, wandering sideways by `wob`. f(tile, i) for each tile on the field.
     */
    trail(x0, y0, x1, y1, f, wob = 0.25) {
      let x = Math.round(x0), y = Math.round(y0), i = 0, drift = rnd() < 0.5 ? -1 : 1;
      x1 = Math.round(x1); y1 = Math.round(y1);
      const out = [];
      const visit = () => { const t = T(x, y); if (t) { out.push(t); if (f) f(t, i); } i++; };
      visit();
      for (let n = 0; n < 6 * w && (x !== x1 || y !== y1); n++) {
        const dx = x1 - x, dy = y1 - y, stepX = dx !== 0 && (dy === 0 || rnd() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)));
        if (rnd() < 0.2) drift = -drift;
        if (rnd() < wob * 0.5) { if (stepX) y += drift; else x += drift; }
        else if (stepX) x += Math.sign(dx);
        else y += Math.sign(dy);
        visit();
      }
      return out;
    },
    /** A random tile on the field meeting `ok`, or null. */
    pick(ok, tries = 400) { for (let n = 0; n < tries; n++) { const t = tiles[Math.floor(rnd() * tiles.length)]; if (!t.off && ok(t)) return t; } return null; },
    /** A building (one of the ruined houses) at (x, y), unless something is in the way. */
    house(name, x, y) {
      const [ax, ay, hx, hy] = HOUSES[name];
      const b = { img: `assets/art/town-dixmude-${name}.webp`, ax, ay, k: 0.5, x: x + 0.5, y: y + 0.5, hx, hy };
      for (let yy = Math.floor(b.y - hy - 1); yy <= b.y + hy + 1; yy++) for (let xx = Math.floor(b.x - hx - 1); xx <= b.x + hx + 1; xx++) {
        const t = T(xx, yy); if (!t || t.pond || t.rock || t.sea || t.house || ctx.nearHq(t, 3)) return null;
      }
      for (let yy = Math.floor(b.y - hy); yy <= b.y + hy; yy++) for (let xx = Math.floor(b.x - hx); xx <= b.x + hx; xx++) { const t = T(xx, yy); if (t) { t.house = 1; t.decor = null; } }
      ctx.buildings.push(b);
      return b;
    },
    church(x, y) {
      const b = { img: 'assets/art/church-galicia.webp', ax: 219, ay: 388, k: 0.5, x: x + 0.5, y: y + 0.5, hx: 2.2, hy: 2.8, name: 'The church' };
      for (let yy = Math.floor(b.y - 4); yy <= b.y + 4; yy++) for (let xx = Math.floor(b.x - 3); xx <= b.x + 3; xx++) { const t = T(xx, yy); if (!t || t.pond || t.house || ctx.nearHq(t, 3)) return null; }
      for (let yy = Math.floor(b.y - b.hy); yy <= b.y + b.hy; yy++) for (let xx = Math.floor(b.x - b.hx); xx <= b.x + b.hx; xx++) { const t = T(xx, yy); if (t) { t.house = 1; t.decor = null; } }
      ctx.buildings.push(b);
      return b;
    },
    /** Water: deep water bars the way; shallow water is a frozen crossing on a frozen field. */
    water(t, deep = true) {
      if (!t || t.house || ctx.nearHq(t, 2)) return;
      Object.assign(t, { pond: 1, mud: 1, decor: null, crater: 0, ground: 0, road: 0 });
      if (deep || !map.frozen) { t.sea = 1; t.block = 1; } else { t.sea = 0; t.block = 0; }
    },
    rock(t, knoll = false) {
      if (!t || t.house || t.pond || t.road || ctx.nearHq(t, 3) || ctx.onLines(t, 1)) return false;
      t.rock = 1 + Math.floor(rnd() * 4); if (knoll) t.knoll = 1; t.decor = null; t.crater = 0;
      return true;
    },
    road(t, kind = 1) { if (t && !t.pond && !t.rock && !t.house) { t.road = kind; t.decor = null; t.mud = kind === 1 ? t.mud : 0; } },
    decor(t, kind) { if (t && !t.pond && !t.rock && !t.house && !t.road && !t.sea) t.decor = kind; },
  };
  bf.build(ctx);

  // ---- the trench systems
  const blocked = (t) => !t || t.pond || t.rock || t.sea;
  const dig = (x, y, team, level) => {
    const t = T(x, y);
    if (blocked(t)) return false;
    t.trench = Math.max(t.trench, level); t.owner = t.origOwner = team;
    t.mud = 0; t.decor = null; t.wire = 0; t.crater = 0; t.road = 0;
    return true;
  };
  for (const team of [WT, ET]) {
    const heavy = team === ENEMY, lvl = heavy ? 2 : 1, d = dir(team);
    // the fire trench, and the support line behind it in stretches
    for (const [line, level, gaps] of [[fx[team], lvl, false], [sx[team], lvl, true]]) {
      let prev = null, run = 0, gap = 0;
      for (let y = 0; y < w; y++) {
        if (gaps) { if (gap > 0) { gap--; prev = null; continue; } if (run-- <= 0) { run = 7 + Math.floor(rnd() * 10); gap = rnd() < 0.7 ? 2 + Math.floor(rnd() * 3) : 0; } }
        const x = line[y];
        if (!T(x, y)) { prev = null; continue; }
        if (prev !== null && prev !== x) for (let xx = Math.min(prev, x); xx <= Math.max(prev, x); xx++) dig(xx, y, team, level);
        dig(x, y, team, level);
        prev = x;
      }
    }
    // pieces of a reserve line, where the field is deep enough
    if (D >= 10) for (let y = Math.floor(rnd() * 6); y < w;) {
      const len = 4 + Math.floor(rnd() * 6), x = fx[team][y] - d * (D - 2);
      for (let k = 0; k < len; k++) dig(x, y + k, team, 2);
      y += len + 5 + Math.floor(rnd() * 8);
    }
    const q = map.hq[team];
    q.x = Math.max(0, Math.min(w - 1, q.x));
    { const t = T(q.x, q.y); if (t) Object.assign(t, { pond: 0, sea: 0, block: 0, rock: 0, knoll: 0, house: 0 }); }
    dig(q.x, q.y, team, 3);
    // communication trenches: shortest winding ways (each tile its own random cost, an existing trench of ours
    // cheaper) from the front back to headquarters and to points along the support line
    const N = w * w, cost = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = new Heap();
    for (const t of tiles) if (!t.off && t.trench && t.owner === team && Math.abs(t.x - fx[team][t.y]) <= 2) { cost[t.y * w + t.x] = 0; heap.push(0, t.y * w + t.x); }
    const rough = new Float32Array(N); for (let i = 0; i < N; i++) rough[i] = 0.6 + rnd() * 0.9;
    while (heap.size) {
      const [c, i] = heap.pop();
      if (c > cost[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = T(x + ax, y + ay); if (blocked(n) || (n.x - fx[team][n.y]) * d > 0) continue;
        const j = n.y * w + n.x, nc = c + (n.trench && n.owner === team ? 0.35 : rough[j]) + (ay ? 0.25 : 0) + (n.house ? 6 : 0);
        if (nc < cost[j]) { cost[j] = nc; from[j] = i; heap.push(nc, j); }
      }
    }
    const walk = (t, level) => { for (let i = t.y * w + t.x, n = 0; i >= 0 && n < 400; i = from[i], n++) dig(i % w, (i / w) | 0, team, level); };
    walk(T(q.x, q.y), 2);
    let next = Math.floor(rnd() * 5);
    for (let y = 0; y < w; y++) {
      if (y < next) continue;
      const t = T(sx[team][y], y);
      if (t && t.trench && t.owner === team) { walk(t, 1); next = y + 7 + Math.floor(rnd() * 6); }
    }
  }

  // ---- sandbagged nests along the fire trenches (a field that has them)
  if (map.nests) for (const team of [WT, ET]) for (let y = Math.floor(rnd() * 6); y < w; y += 6 + Math.floor(rnd() * 6)) {
    for (let k = 0; k < 2; k++) { const t = T(fx[team][y + k], y + k); if (t && t.trench && t.owner === team) t.trench = 3; }
  }
  delete map.nests;
  // ---- barbed wire before each line: light works leave sally gaps, heavy works are deep and dense
  for (let y = 1; y < w - 1; y++) for (const team of [WT, ET]) {
    const heavy = team === ENEMY;
    if (!heavy && (y % 9 === 4 || y % 9 === 5)) continue;
    for (const [dx, p] of heavy ? [[2, 0.95], [3, 0.8], [4, 0.35]] : [[2, 0.9], [3, 0.5]]) {
      const t = T(fx[team][y] + dir(team) * dx, y);
      if (t && !t.trench && !blocked(t) && !t.house && !t.road && rnd() < p * (bf.wire ?? 1)) { t.wire = 100; t.origWire = team; t.decor = null; }
    }
  }
  // ---- old shell holes in no man's land (and some behind the lines)
  const holes = Math.round((bf.craters ?? 1) * A * B * 0.11);
  for (let n = 0; n < holes; n++) {
    const t = tiles[Math.floor(rnd() * tiles.length)];
    if (t.off || t.trench || t.wire || blocked(t) || t.house || t.road === 2) continue;
    if (!ctx.nml(t, 1) && rnd() > 0.15) continue;
    t.crater = 1 + Math.floor(rnd() * 3); t.mud = 1; t.decor = null;
  }
  // headquarters stand clear
  for (const q of map.hq) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const t = T(q.x + dx, q.y + dy); if (t) { t.decor = null; t.wire = 0; } }
  for (const t of tiles) { if (t.trench) { t.decor = null; t.rock = 0; t.knoll = 0; } delete t.house; }
  if (tiles.some((t) => t.rock)) map.rocks = true;
  noSquares(map);
  map._extra = { buildings: ctx.buildings, objectives: ctx.objectives };
  return map;
}

/**
 * The armies in their lines: riflemen spread along the fire trench, machine guns at the middle and towards
 * either end, two squads in reserve, two batteries behind the lines; whatever the field's shape.
 */
function deployOnField(state) {
  const { map } = state;
  for (const team of [PLAYER, ENEMY]) {
    const dir = teamDir(team), front = frontLine(map, team);
    const rows = []; for (let y = 0; y < map.h; y++) if (front[y] >= 0) rows.push(y);
    if (!rows.length) continue;
    const at = (k) => { const y = rows[Math.min(rows.length - 1, Math.max(0, Math.round(k * (rows.length - 1))))]; return { x: front[y] + 0.5, y: y + 0.5 }; };
    for (let i = 0; i < 8; i++) { const p = at(0.08 + (i / 7) * 0.84); spawnUnit(state, 'rifle', team, p.x, p.y); }
    for (const k of [0.22, 0.5, 0.78]) { const p = at(k + 0.03); spawnUnit(state, 'mg', team, p.x, p.y); }
    // the reserve: on our trenches, half-way between the front and headquarters
    const q = map.hq[team];
    const own = map.tiles.filter((t) => t.trench && t.owner === team && !t.off);
    const mid = { x: (q.x + front[rows[rows.length >> 1]]) / 2, y: (q.y + rows[rows.length >> 1]) / 2 };
    own.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
    for (const t of own.slice(0, 2)) spawnUnit(state, 'rifle', team, t.x + 0.5, t.y + 0.5);
    // the guns: open ground behind the line, either side of the way to headquarters
    const open = map.tiles.filter((t) => !t.off && !t.trench && !t.rock && !t.block && !t.pond && !t.wire && (t.x - front[t.y]) * dir <= -5 && (t.x - front[t.y]) * dir >= -10 && front[t.y] >= 0);
    const c = rows[rows.length >> 1];
    for (const off of [-6, 6]) {
      let best = null, bd = Infinity;
      for (const t of open) { const d = Math.abs(t.y - (c + off)) + Math.abs((t.x - front[t.y]) * dir + 8) * 0.5; if (d < bd) { bd = d; best = t; } }
      if (best) spawnUnit(state, 'artillery', team, best.x + 0.5, best.y + 0.5);
    }
  }
}

/** A new skirmish on a battlefield. opts: seed, nations, start ('west' / 'east'), difficulty. */
export function createBattlefieldGame(id, opts = {}) {
  const bf = battlefieldOf(id);
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6);
  const map = buildBattlefieldMap(bf, seed, opts.start === 'east' ? ENEMY : PLAYER);
  const extra = map._extra; delete map._extra;
  return createGame({
    ...opts, seed, map, season: bf.season,
    prepare(state) {
      state.battlefield = bf.id;
      state.weather = { ...bf.weather, phase: (seed % 628) / 100 };
      state.objectives = extra.objectives.map((o) => ({ ...o, owner: -1 }));
      if (extra.buildings.length) {
        state.buildings = extra.buildings; state.buildingsAll = extra.buildings;
        for (const b of extra.buildings) blockBuilding(state, b);
        delete state.buildingsAll;
        noSquares(state.map);
      }
    },
    deploy: deployOnField,
  });
}

// -------------------------------------------------------------------------------------------- the fields
// Each builder lays out the ground on the empty field (ctx: see buildBattlefieldMap). The trench systems
// are dug afterwards, round lakes and rocks, across roads and through hedges.

/** Tiles along a row-wise wandering line across the battle (west rear to east rear), at about row y0. */
function across(ctx, y0, f, wob = 0.3) { return ctx.trail(0, y0, ctx.w - 1, y0 + Math.round((ctx.rnd() - 0.5) * ctx.w * 0.3), f, wob); }
/** Tiles along a column-wise wandering line (parallel to the fronts), at about column x0. */
function along(ctx, x0, f, wob = 0.3) { return ctx.trail(x0, 0, x0 + Math.round((ctx.rnd() - 0.5) * 6), ctx.w - 1, f, wob); }
/** Rows of the field the lines run through, spread evenly (for roads and the like crossing the battle). */
function spreadRows(ctx, n) {
  const ys = []; for (let y = 0; y < ctx.w; y++) if (ctx.T(ctx.R, y) || ctx.T(ctx.fx[ctx.WT][y], y)) ys.push(y);
  if (!ys.length) return [];
  return Array.from({ length: n }, (_, i) => ys[Math.round(((i + 0.5) / n) * (ys.length - 1))] + Math.round((ctx.rnd() - 0.5) * 4));
}

function flanders(ctx) {
  const { rnd, noise, map } = ctx;
  ctx.each((t) => {
    const wet = noise(t.x, t.y, 0.12, 1);
    t.mud = ctx.nml(t, -3) ? (rnd() < 0.92 ? 1 : 0) : rnd() < 0.35 + wet * 0.4 ? 1 : 0;
    if (!t.mud && wet < 0.35 && rnd() < 0.6) t.ground = 1;
    // flooded shell holes and standing water in the low ground
    if (wet > 0.72 && rnd() < 0.5 && !ctx.onLines(t, 1)) ctx.water(t, false);
  });
  // shattered trees: the remains of copses, thickest behind the lines
  for (let n = 0; n < 9; n++) { const c = ctx.pick((t) => !ctx.nml(t, -2)); if (c) ctx.blob(c.x, c.y, 2 + rnd() * 3, 2 + rnd() * 3, (t) => { if (!t.pond && rnd() < 0.5) ctx.decor(t, rnd() < 0.55 ? 'tree' : rnd() < 0.5 ? 'stump' : 'log'); }); }
  ctx.each((t) => { if (!t.decor && !t.pond && rnd() < (ctx.nml(t) ? 0.035 : 0.02)) ctx.decor(t, rnd() < 0.6 ? 'stump' : 'log'); });
  // duckboard tracks winding up from the rear to each side's lines
  for (const team of [ctx.WT, ctx.ET]) for (const y of spreadRows(ctx, 3)) {
    const x1 = ctx.fx[team][Math.max(0, Math.min(ctx.w - 1, y))] - ctx.dir(team) * 1;
    ctx.trail(team === ctx.WT ? 0 : ctx.w - 1, y + Math.round((rnd() - 0.5) * 10), x1, y, (t) => ctx.road(t, 2), 0.35);
  }
  // sunken lanes: old farm roads parallel to the lines, behind them
  for (const team of [ctx.WT, ctx.ET]) along(ctx, ctx.R - ctx.dir(team) * (ctx.dF + 9), (t) => ctx.road(t, 1), 0.2);
  // old wire left out in no man's land, and the ruins of a farm or two
  ctx.each((t) => { if (ctx.nml(t, 3) && !t.pond && rnd() < 0.025) { t.wire = 50; t.origWire = rnd() < 0.5 ? 0 : 1; } });
  for (let n = 0; n < 4; n++) { const t = ctx.pick((t) => !ctx.onLines(t, 3) && rnd() < 0.5); if (t) ctx.house(SMALL[Math.floor(rnd() * 3)], t.x, t.y); }
  ctx.each((t) => { if (!t.decor && !t.pond && !ctx.nml(t) && rnd() < 0.006) ctx.decor(t, 'ruin'); });
  map.waterTint = [74, 66, 50];
}

function picardy(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.summer = true;
  // fields: cells of a coarse grid, jittered; each one wheat, pasture, plough or orchard
  const S = 9, cell = new Map(), kind = (cx, cy) => { const k = cx * 997 + cy; if (!cell.has(k)) { const r = rnd(); cell.set(k, r < 0.38 ? 'wheat' : r < 0.68 ? 'pasture' : r < 0.86 ? 'plough' : 'orchard'); } return cell.get(k); };
  const cellOf = (t) => { const j = (noise(t.x, t.y, 0.18, 2) - 0.5) * 4; return [Math.floor((t.x + j) / S), Math.floor((t.y - j) / S)]; };
  ctx.each((t) => {
    const [cx, cy] = cellOf(t), f = kind(cx, cy), torn = ctx.nml(t, -2);
    if (torn) { t.mud = rnd() < 0.5 ? 1 : 0; t.ground = t.mud ? 0 : 1; return; }
    t.ground = f === 'wheat' ? 4 : f === 'plough' ? 0 : 1;
    if (f === 'plough') t.mud = rnd() < 0.3 ? 1 : 0;
    if (f === 'orchard' && t.x % 2 === 0 && t.y % 2 === 0 && rnd() < 0.85) ctx.decor(t, 'birch');
    // hedgerows along the field boundaries, with gaps
    const [ex, ey] = cellOf(T(t.x + 1, t.y) || t), [sx2, sy2] = cellOf(T(t.x, t.y + 1) || t);
    if ((ex !== cx || ey !== cy || sx2 !== cx || sy2 !== cy) && noise(t.x, t.y, 0.5, 3) > 0.38) ctx.decor(t, 'hedge');
  });
  ctx.each((t) => { if (ctx.nml(t, -1) && t.decor === 'hedge' && rnd() < 0.6) t.decor = rnd() < 0.5 ? 'stump' : null; });
  // cart tracks across the lines (the tanks' lanes), and one along behind each side
  for (const y of spreadRows(ctx, 3)) across(ctx, y, (t) => ctx.road(t, 1), 0.25);
  // a creek winding across one flank, fordable where the tracks cross it
  const cy = spreadRows(ctx, 5)[rnd() < 0.5 ? 0 : 4];
  across(ctx, cy, (t) => { if (!t.road) ctx.water(t, true); else t.mud = 1; }, 0.45).forEach((t) => { for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const n = T(t.x + a, t.y + b); if (n && !n.pond && !n.road && rnd() < 0.5) ctx.decor(n, rnd() < 0.5 ? 'reeds' : 'birch'); } });
  // farm compounds: a house or two and a barn, behind each side's lines and one in no man's land
  for (const team of [ctx.WT, ctx.ET, -1]) for (let n = 0; n < (team < 0 ? 1 : 3); n++) {
    const c = ctx.pick((t) => (team < 0 ? ctx.nml(t, 4) : ctx.sideOf(t) === team && !ctx.onLines(t, 3)) && !t.pond);
    if (!c) continue;
    ctx.house(SMALL[Math.floor(rnd() * SMALL.length)], c.x, c.y);
    ctx.house(SMALL[Math.floor(rnd() * SMALL.length)], c.x + 3, c.y + (rnd() < 0.5 ? 3 : -3));
  }
  map.waterTint = [70, 82, 70];
}

function dixmude(ctx) {
  const { rnd, noise, map, T, R, w } = ctx;
  ctx.each((t) => { t.mud = ctx.nml(t, -2) ? (rnd() < 0.6 ? 1 : 0) : rnd() < 0.18 ? 1 : 0; if (!t.mud && noise(t.x, t.y, 0.15, 1) > 0.5) t.ground = 1; });
  // the canal, two tiles wide, down the middle of no man's land; bridges across it
  const cx = R + Math.floor(rnd() * 3) - 1, bridges = new Set(spreadRows(ctx, 4).map((y) => y));
  for (let y = 0; y < w; y++) {
    const bridge = [...bridges].some((b) => Math.abs(b - y) <= 0);
    for (const x of [cx, cx + 1]) { const t = T(x, y); if (!t) continue; if (bridge) { ctx.road(t, 4); t.mud = 0; } else ctx.water(t, true); }
    if (!bridge) for (const x of [cx - 1, cx + 2]) { const t = T(x, y); if (t && rnd() < 0.3) ctx.decor(t, 'reeds'); } // its banks
  }
  for (const y of bridges) for (let x = cx - 3; x <= cx + 4; x++) ctx.road(T(x, y), 4); // the roads onto the bridges
  // the town: streets (paving) across and along a block of rows on each bank, houses between them
  const ys = spreadRows(ctx, 6), y0 = ys[1], y1 = ys[4];
  for (const team of [ctx.WT, ctx.ET]) {
    const d = ctx.dir(team), xa = ctx.R - d * (ctx.dF + 3), xb = ctx.R - d * (ctx.dF + 16);
    for (let y = y0; y <= y1; y += 7) ctx.trail(xa, y, xb, y, (t) => ctx.road(t, 4), 0);
    for (let y = y0; y <= y1; y += 7) for (let x = Math.min(xa, xb) + 2; x <= Math.max(xa, xb) - 2; x += 4) if (rnd() < 0.72) ctx.house(SMALL[Math.floor(rnd() * SMALL.length)], x, y + 3 + (rnd() < 0.5 ? 0 : 1));
    // gardens behind the houses
    ctx.blob((xa + xb) / 2, y1 + 6, 6, 3, (t) => { t.ground = 1; t.mud = 0; if (rnd() < 0.18) ctx.decor(t, 'birch'); else if (rnd() < 0.08) ctx.decor(t, 'hedge'); });
  }
  // the market square, paved and open, on one bank
  { const d = ctx.dir(ctx.WT) * (rnd() < 0.5 ? 1 : -1), mx = R - d * (ctx.dF + 9), my = Math.round((y0 + y1) / 2); for (let y = my - 2; y <= my + 2; y++) for (let x = mx - 2; x <= mx + 2; x++) { const t = T(x, y); if (t && !t.house) { ctx.road(t, 4); t.ground = 0; } } }
  // the railway embankment across the field on one flank, the station and warehouses along its siding
  const ry = rnd() < 0.5 ? ys[0] - 3 : ys[5] + 3;
  const rail = ctx.trail(0, ry, w - 1, ry, null, 0);
  for (const t of rail) if (!t.pond) ctx.road(t, 3); else { t.pond = 0; t.sea = 0; t.block = 0; t.mud = 0; ctx.road(t, 3); } // (a rail bridge over the canal)
  for (const team of [ctx.WT, ctx.ET]) { const x = R - ctx.dir(team) * (ctx.dF + 8 + Math.floor(rnd() * 6)); ctx.house('station', x, ry + (rnd() < 0.5 ? 3 : -3)); }
  ctx.each((t) => { if (!t.decor && !t.road && !t.pond && rnd() < 0.008) ctx.decor(t, 'ruin'); });
  map.waterTint = [60, 72, 70];
}

function argonne(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.forest = true;
  ctx.each((t) => {
    const wood = noise(t.x, t.y, 0.09, 1) * 0.7 + noise(t.x, t.y, 0.25, 2) * 0.3, nml = ctx.nml(t, -1);
    t.mud = rnd() < (nml ? 0.55 : 0.2) ? 1 : 0;
    if (wood < 0.36) { t.ground = 1; if (rnd() < 0.03) ctx.decor(t, 'log'); return; } // a clearing
    const r = rnd();
    if (nml) { if (r < 0.2) ctx.decor(t, 'tree'); else if (r < 0.32) ctx.decor(t, 'stump'); else if (r < 0.42) ctx.decor(t, 'log'); return; } // shattered by the shelling
    if (wood > 0.62 && r < 0.42 && !ctx.onLines(t, 2)) { ctx.rock(t, true); return; } // a dense stand of fir: no way through
    if (r < 0.38) ctx.decor(t, 'birch'); else if (r < 0.5) ctx.decor(t, 'tree'); else if (r < 0.6) ctx.decor(t, 'log');
  });
  // forest roads across the lines
  for (const y of spreadRows(ctx, 2)) across(ctx, y, (t) => { t.rock = 0; t.knoll = 0; ctx.road(t, 1); for (const [a, b] of [[0, 1], [0, -1]]) { const n = T(t.x + a, t.y + b); if (n && n.knoll) { n.rock = 0; n.knoll = 0; } } }, 0.3);
  // ravines: rocky gullies winding across the battle, with a crossing every so often
  for (let n = 0; n < 2; n++) {
    const y = spreadRows(ctx, 5)[n * 3 + 1] + Math.round((rnd() - 0.5) * 6);
    across(ctx, y, (t, i) => { if (i % 9 < 7 && !t.road) { ctx.rock(t, false); const s = T(t.x, t.y + 1); if (s && rnd() < 0.5) ctx.rock(s, false); } }, 0.4);
  }
  // foxholes: single pits out ahead of each line
  for (const team of [ctx.WT, ctx.ET]) for (let y = 0; y < ctx.w; y += 3 + Math.floor(rnd() * 4)) {
    const t = T(ctx.fx[team][y] + ctx.dir(team) * (3 + Math.floor(rnd() * 3)), y);
    if (t && !t.rock && !t.pond && !t.road) { t.trench = 1; t.owner = t.origOwner = team; t.decor = null; t.mud = 0; t.foxhole = 1; }
  }
  for (let n = 0; n < 2; n++) { const t = ctx.pick((t) => !ctx.onLines(t, 4) && !ctx.nml(t) && !t.rock); if (t) ctx.house('cottage', t.x, t.y); } // a forester's house
}

function masuria(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.frozen = true;
  ctx.each((t) => { t.ground = noise(t.x, t.y, 0.1, 1) > 0.45 ? 2 : 0; t.mud = !t.ground && rnd() < 0.25 ? 1 : 0; });
  // the lakes: long, irregular, lying across the field; their shallows frozen hard
  const lakes = [];
  for (let n = 0; n < 4; n++) {
    const c = ctx.pick((t) => !ctx.nearHq(t, 9) && lakes.every((l) => Math.hypot(l.x - t.x, l.y - t.y) > 16));
    if (!c) continue;
    lakes.push(c);
    const long = rnd() < 0.5;
    ctx.blob(c.x, c.y, long ? 9 + rnd() * 5 : 4 + rnd() * 3, long ? 3 + rnd() * 2 : 7 + rnd() * 5, (t, d) => ctx.water(t, d < 0.62), 0.45);
  }
  // marsh and reeds round the shores; the ice is snow-dusted
  ctx.each((t) => {
    if (t.pond) return;
    const shore = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]].some(([a, b]) => { const n = T(t.x + a, t.y + b); return n && n.pond; });
    if (shore) { t.mud = rnd() < 0.6 ? 1 : 0; if (rnd() < 0.4) ctx.decor(t, 'reeds'); }
  });
  // causeways over the lakes: roads straight across them
  for (const y of spreadRows(ctx, 3)) across(ctx, y, (t) => { if (t.pond) { Object.assign(t, { pond: 0, sea: 0, block: 0 }); } ctx.road(t, 1); }, 0.12);
  // pine copses and birches
  for (let n = 0; n < 10; n++) { const c = ctx.pick((t) => !t.pond && !ctx.nml(t, -2)); if (c) ctx.blob(c.x, c.y, 2 + rnd() * 3, 2 + rnd() * 3, (t) => { if (!t.pond && !t.road && rnd() < 0.55) { if (!ctx.rock(t, true)) ctx.decor(t, 'birch'); } }); }
  ctx.each((t) => { if (!t.decor && !t.pond && !t.rock && rnd() < (ctx.nml(t) ? 0.02 : 0.02)) ctx.decor(t, ctx.nml(t) ? 'stump' : 'birch'); });
  // hamlets: a few houses by the roads
  for (let n = 0; n < 4; n++) { const c = ctx.pick((t) => t.road === 1 && !ctx.nml(t, -3)); if (c) { ctx.house(SMALL[Math.floor(rnd() * SMALL.length)], c.x + 2, c.y + 2); ctx.house('cottage', c.x - 2, c.y - 3); } }
  map.waterTint = [56, 68, 80];
}

function galicia(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.summer = true;
  // belts of wheat lying along the lines, pasture between them
  ctx.each((t) => {
    const belt = Math.sin((t.x - t.y * 0.2) * 0.32 + noise(t.x, t.y, 0.1, 1) * 4) > 0.1;
    if (ctx.nml(t, -1)) { t.mud = rnd() < 0.3 ? 1 : 0; t.ground = t.mud ? 0 : 1; return; }
    t.ground = belt ? 4 : 1;
  });
  // birch groves
  for (let n = 0; n < 9; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 3)); if (c) ctx.blob(c.x, c.y, 2.5 + rnd() * 3, 2.5 + rnd() * 3, (t) => { if (rnd() < 0.5) ctx.decor(t, 'birch'); }); }
  // dirt roads across the steppe, and the telegraph line along the first of them
  const rows = spreadRows(ctx, 3);
  const roads = rows.map((y) => across(ctx, y, (t) => ctx.road(t, 1), 0.2));
  { const line = roads[1] || roads[0]; let prev = null; for (let i = 0; i < line.length; i += 4) { const t = line[i], s = T(t.x, t.y - 1); if (!s || s.road || s.pond) continue; s.decor = 'pole'; if (prev) prev.wireTo = [s.x, s.y]; prev = s; } }
  // a stream winding across one flank, with fords where the roads cross
  const sy = rows[0] - 6 + Math.floor(rnd() * 3);
  across(ctx, sy, (t) => { if (!t.road) ctx.water(t, true); for (const [a, b] of [[0, 1], [0, -1]]) { const n = T(t.x + a, t.y + b); if (n && !n.pond && !n.road && rnd() < 0.35) ctx.decor(n, rnd() < 0.6 ? 'reeds' : 'birch'); } }, 0.5);
  // wooden villages along the roads; the church of one of them still stands
  let church = false;
  for (let n = 0; n < 5; n++) {
    const c = ctx.pick((t) => t.road === 1 && !ctx.onLines(t, 4));
    if (!c) continue;
    if (!church && ctx.church(c.x + 3, c.y - 4)) { church = true; continue; }
    for (let k = 0; k < 3; k++) ctx.house(SMALL[Math.floor(rnd() * SMALL.length)], c.x + k * 3 - 3, c.y + (k % 2 ? 3 : -3));
  }
  map.waterTint = [72, 80, 64];
}

function karst(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.summer = true; map.dry = true;
  // limestone plates everywhere but the pockets of red earth, where a trench can be dug
  ctx.each((t) => {
    const soft = noise(t.x, t.y, 0.13, 1) * 0.75 + noise(t.x, t.y, 0.4, 2) * 0.25;
    if (soft > 0.52) { t.ground = 1; t.mud = rnd() < 0.2 ? 1 : 0; } else { t.hard = 1; t.ground = soft < 0.3 && rnd() < 0.35 ? 3 : 0; } // (bare plates, loose stone here and there)
  });
  // boulder fields and crags
  for (let n = 0; n < 14; n++) { const c = ctx.pick((t) => t.hard && !ctx.onLines(t, 2)); if (c) ctx.blob(c.x, c.y, 1.5 + rnd() * 2.5, 1.5 + rnd() * 2.5, (t) => { if (rnd() < 0.45) ctx.rock(t); }); }
  // sinkholes (dolines): round hollows, a crater at the bottom, scree round the rim
  for (let n = 0; n < 10; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 2) && !ctx.nearHq(t, 6)); if (c) ctx.blob(c.x, c.y, 2, 2, (t, d) => { t.rock = 0; if (d < 0.55) { t.crater = 3; t.mud = 0; t.hard = 0; t.ground = 1; } else { t.ground = rnd() < 0.5 ? 3 : 0; t.hard = 1; } }, 0.2); }
  // dry-stone walls, along and across the battle, with gaps
  for (let n = 0; n < 7; n++) {
    const c = ctx.pick((t) => !ctx.onLines(t, 2)), len = 6 + Math.floor(rnd() * 10), alongY = rnd() < 0.5;
    if (c) for (let k = 0; k < len; k++) { const t = T(c.x + (alongY ? 0 : k), c.y + (alongY ? k : 0)); if (!t || t.rock || ctx.onLines(t, 0)) continue; if (rnd() < 0.85) { ctx.decor(t, 'wall'); t.wallY = alongY ? 1 : 0; } }
  }
  // thorn scrub in the soft pockets
  ctx.each((t) => { if (!t.hard && !t.decor && !t.rock && rnd() < 0.09) ctx.decor(t, 'scrub'); });
  // quarries: a ring of rock round a floor of pale stone dust, open on one side
  for (let n = 0; n < 2; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 6) && !ctx.nearHq(t, 7)); if (c) { const gap = rnd() * 6.28; ctx.blob(c.x, c.y, 3.5, 3, (t, d) => { const a = Math.atan2(t.y - c.y, t.x - c.x); if (d > 0.7 && Math.abs(Math.sin((a - gap) / 2)) > 0.3) ctx.rock(t); else if (d <= 0.7) { t.ground = 5; t.hard = 1; t.decor = null; } }, 0.1); } }
  // a mule track across the plateau
  for (const y of spreadRows(ctx, 2)) across(ctx, y, (t) => { if (!t.rock) ctx.road(t, 1); }, 0.35);
}

function tyrol(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.frozen = true;
  ctx.each((t) => { t.ground = noise(t.x, t.y, 0.12, 1) > 0.25 ? 2 : 0; });
  // conifer stands and crags
  for (let n = 0; n < 12; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 3)); if (c) ctx.blob(c.x, c.y, 2 + rnd() * 3, 2 + rnd() * 4, (t) => { if (rnd() < 0.6) ctx.rock(t, true); }); }
  for (let n = 0; n < 8; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 2)); if (c) ctx.blob(c.x, c.y, 1.5 + rnd() * 2, 1.5 + rnd() * 2, (t) => { if (rnd() < 0.6) ctx.rock(t, false); }); }
  // the frozen creek winding down the field (across the battle): ice to walk on
  const rows = spreadRows(ctx, 4);
  across(ctx, rows[rnd() < 0.5 ? 1 : 2] + 4, (t) => { if (!t.rock) { ctx.water(t, false); for (const [a, b] of [[0, 1], [0, -1]]) { const n = T(t.x + a, t.y + b); if (n && !n.pond && rnd() < 0.25) ctx.decor(n, 'scrub'); } } }, 0.45);
  // the sled track
  across(ctx, rows[rnd() < 0.5 ? 0 : 3], (t) => { if (!t.pond) { t.rock = 0; t.knoll = 0; ctx.road(t, 1); } }, 0.3);
  // cabins
  for (let n = 0, built = 0; n < 40 && built < 5; n++) { const c = ctx.pick((t) => !ctx.onLines(t, 4) && !t.rock && !t.pond); if (c && ctx.house(rnd() < 0.6 ? 'cottage' : 'home-b', c.x, c.y)) built++; }
  ctx.each((t) => { if (!t.decor && !t.rock && !t.pond && !t.road && rnd() < 0.012) ctx.decor(t, ctx.nml(t) ? 'stump' : 'tree'); });
}

function gallipoli(ctx) {
  const { rnd, noise, map, T, A } = ctx;
  map.summer = true; map.dry = true;
  const side = rnd() < 0.5 ? 1 : -1; // the sea down the right or the left of the strip
  ctx.each((t) => {
    const [u] = ctx.uv(t), s = u * side, coast = A - 5 + Math.round(noise(t.x, t.y, 0.15, 1) * 3 - 1.5);
    if (s > coast) { Object.assign(t, { sea: 1, block: 1, pond: 0, ground: 0 }); return; }
    if (s > coast - 3) { t.ground = 5; return; } // the beach
    t.ground = rnd() < 0.55 ? 1 : 0;
    if (s > coast - 5 && rnd() < 0.75 && !ctx.onLines(t, 1)) ctx.rock(t, false); // the cliff edge above the beach
    else if (rnd() < 0.08) ctx.decor(t, 'scrub');
  });
  // gullies: rocky clefts running inland from the cliffs, a way up through the cliff at their foot
  for (const y of spreadRows(ctx, 5)) {
    const start = ctx.pick((t) => Math.abs(t.y - y) < 3 && ctx.uv(t)[0] * side > A - 9 && ctx.uv(t)[0] * side < A - 6, 200);
    if (!start) continue;
    ctx.trail(start.x, start.y, start.x - side * 9, start.y + side * 9, (t, i) => { if (i < 2) { t.rock = 0; t.ground = 5; } else { const n = T(t.x + 1, t.y); if (i % 2) ctx.rock(t, rnd() < 0.3); if (n && rnd() < 0.4) ctx.decor(n, 'scrub'); } }, 0.3);
  }
  // piers run out into the bay
  for (const y of spreadRows(ctx, 3).slice(0, 2)) { const t0 = ctx.pick((t) => Math.abs(t.y - y) < 4 && t.ground === 5 && T(t.x + side, t.y - side)?.sea, 200); if (t0) for (let k = 1; k < 7; k++) { const t = T(t0.x + side * k, t0.y - side * k) || null; const t2 = T(t0.x + side * k, t0.y - side * (k - 1)); for (const q of [t, t2]) if (q && q.sea) q.road = 2; } }
  // a track along the strip behind each line
  for (const team of [ctx.WT, ctx.ET]) along(ctx, ctx.R - ctx.dir(team) * (ctx.dF + 6), (t) => { if (!t.sea && !t.rock) ctx.road(t, 1); }, 0.2);
  // sandbag nests: stretches of the fire trench built up with sandbags (done after the lines are dug: marked here)
  map.nests = true;
  ctx.each((t) => { if (!t.decor && !t.rock && !t.sea && t.ground !== 5 && rnd() < 0.03) ctx.decor(t, rnd() < 0.5 ? 'stump' : 'scrub'); });
}

function sinai(ctx) {
  const { rnd, noise, map, T } = ctx;
  map.summer = true; map.dry = true;
  ctx.each((t) => { t.ground = 5; });
  // wadis: broad dry beds of gravel winding across the battle, rock shelves along their banks
  for (const y of spreadRows(ctx, 2)) {
    const bed = across(ctx, y, null, 0.4);
    for (const c of bed) for (let dy = -2; dy <= 2; dy++) { const t = T(c.x, c.y + dy); if (!t) continue; if (Math.abs(dy) <= 1) { t.ground = dy === 0 && rnd() < 0.6 ? 3 : 0; t.wadi = 1; t.mud = 0; } else if (rnd() < 0.35) ctx.rock(t); }
  }
  // rock shelves out on the sand
  for (let n = 0; n < 9; n++) { const c = ctx.pick((t) => !t.rock && !ctx.onLines(t, 2)); if (c) ctx.blob(c.x, c.y, 2 + rnd() * 3, 1 + rnd() * 2, (t) => { if (rnd() < 0.5) ctx.rock(t); else t.ground = rnd() < 0.3 ? 3 : 0; }); }
  // the water points: one out in no man's land, one behind each side's flank; palms and walled gardens round them
  const spots = [ctx.pick((t) => ctx.nml(t, 4) && !t.rock && Math.abs(t.y - ctx.R) < ctx.B / 3, 600), ...[ctx.WT, ctx.ET].map((team) => ctx.pick((t) => (t.x - ctx.fx[team][t.y]) * ctx.dir(team) < -4 && (t.x - ctx.fx[team][t.y]) * ctx.dir(team) > -12 && !t.rock && !ctx.nearHq(t, 6), 600))];
  const names = ['the wells of Bir el Abd', 'the Romani wells', 'the Katia oasis'];
  spots.forEach((c, i) => {
    if (!c) return;
    ctx.blob(c.x, c.y, 1.3, 1.3, (t) => ctx.water(t, true), 0.1);
    ctx.blob(c.x, c.y, 5, 5, (t, d) => { if (t.pond) return; t.ground = d < 0.6 ? 1 : 5; if (d > 0.3 && rnd() < 0.3) ctx.decor(t, 'palm'); if (d > 0.85 && rnd() < 0.6) { ctx.decor(t, 'wall'); t.wallY = Math.abs(t.x - c.x) > Math.abs(t.y - c.y) ? 1 : 0; } }, 0.2);
    ctx.objectives.push({ x: c.x + 2.5, y: c.y + 0.5, name: names[i] });
  });
  // the water tower by the railhead behind each side
  for (const team of [ctx.WT, ctx.ET]) { const t = ctx.pick((t) => (t.x - ctx.fx[team][t.y]) * ctx.dir(team) < -7 && !t.rock && !t.pond && !ctx.nearHq(t, 3)); if (t) ctx.decor(t, 'tower'); }
  ctx.each((t) => { if (!t.decor && !t.rock && !t.pond && rnd() < 0.006) ctx.decor(t, 'palm'); });
}
