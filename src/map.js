import { MAP_W, MAP_H, PLAYER, ENEMY } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Initial front-line columns for each side.
export const FRONT_X = { [PLAYER]: 18, [ENEMY]: MAP_W - 19 };

export function tileAt(map, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h) return null;
  return map.tiles[iy * map.w + ix];
}

/** For each row y, the x of the team's most forward owned trench tile (or -1). */
export function frontLine(map, team) {
  const out = new Array(map.h).fill(-1);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t.trench > 0 && t.owner === team) {
        if (out[y] < 0) out[y] = x;
        else if (team === PLAYER ? x > out[y] : x < out[y]) out[y] = x;
      }
    }
  }
  return out;
}

export function createMap(seed = 1916) {
  const rnd = mulberry32(seed);
  const w = MAP_W, h = MAP_H;
  const tiles = new Array(w * h);
  const nmlA = FRONT_X[PLAYER] + 1, nmlB = FRONT_X[ENEMY] - 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mudChance = 0;
      if (x > nmlA + 1 && x < nmlB - 1) mudChance = 0.85;
      else if (x >= nmlA - 3 && x <= nmlB + 3) mudChance = 0.4;
      else mudChance = 0.04;
      tiles[y * w + x] = {
        x, y,
        mud: rnd() < mudChance ? 1 : 0,
        shade: rnd(),
        crater: 0,
        trench: 0,
        owner: -1,
        origOwner: -1,
        wire: 0,
        origWire: -1,
        build: null,
        decor: null,
      };
    }
  }

  const map = { w, h, tiles, dirty: true, hq: [] };
  const T = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? tiles[y * w + x] : null);

  function dig(x, y, owner, level) {
    const t = T(x, y);
    if (!t) return;
    t.trench = Math.max(t.trench, level);
    t.owner = owner;
    t.origOwner = owner;
    t.mud = 0;
    t.decor = null;
    t.wire = 0;
  }

  // A fire trench with traverses: x shifts by `amp` every 3 rows.
  function line(baseX, owner, level, amp, y0 = 1, y1 = h - 2) {
    let prevX = null;
    for (let y = y0; y <= y1; y++) {
      const x = baseX + (Math.floor(y / 3) % 2 ? amp : 0);
      if (prevX !== null && prevX !== x) {
        for (let xx = Math.min(prevX, x); xx <= Math.max(prevX, x); xx++) dig(xx, y, owner, level);
      }
      dig(x, y, owner, level);
      prevX = x;
    }
  }

  function comm(x0, x1, y, owner, level) {
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    const mid = Math.floor((a + b) / 2);
    for (let x = a; x <= b; x++) dig(x, x < mid ? y : y + 1, owner, level);
    dig(mid, y, owner, level);
  }

  const midY = Math.floor(h / 2);

  // ---- Player (west) ----
  line(FRONT_X[PLAYER], PLAYER, 1, -1);
  line(11, PLAYER, 1, -1);
  line(5, PLAYER, 2, 0, 6, h - 7);
  for (const y of [7, 19, 31]) comm(5, FRONT_X[PLAYER] - 1, y, PLAYER, 1);
  map.hq[PLAYER] = { x: 2, y: midY };
  comm(2, 5, midY, PLAYER, 2);
  dig(2, midY, PLAYER, 3);

  // ---- Enemy (east) ----
  line(FRONT_X[ENEMY], ENEMY, 2, 1);
  line(w - 12, ENEMY, 2, 1);
  line(w - 6, ENEMY, 2, 0, 6, h - 7);
  for (const y of [8, 20, 32]) comm(FRONT_X[ENEMY] + 1, w - 6, y, ENEMY, 1);
  map.hq[ENEMY] = { x: w - 3, y: midY };
  comm(w - 6, w - 3, midY, ENEMY, 2);
  dig(w - 3, midY, ENEMY, 3);

  // ---- Barbed wire belts ----
  for (let y = 1; y < h - 1; y++) {
    // Player belt: sally-port gaps every 9 rows.
    if (y % 9 !== 4 && y % 9 !== 5) {
      for (const [x, p] of [[FRONT_X[PLAYER] + 2, 0.92], [FRONT_X[PLAYER] + 3, 0.55]]) {
        const t = T(x, y);
        if (t && !t.trench && rnd() < p) { t.wire = 100; t.origWire = PLAYER; }
      }
    }
    // Enemy belt: deeper and denser.
    for (const [x, p] of [[FRONT_X[ENEMY] - 2, 0.97], [FRONT_X[ENEMY] - 3, 0.85], [FRONT_X[ENEMY] - 4, 0.4]]) {
      const t = T(x, y);
      if (t && !t.trench && rnd() < p) { t.wire = 100; t.origWire = ENEMY; }
    }
  }

  // ---- Old shell craters in no man's land ----
  for (let i = 0; i < 170; i++) {
    const x = nmlA + 3 + Math.floor(rnd() * (nmlB - nmlA - 5));
    const y = Math.floor(rnd() * h);
    const t = T(x, y);
    if (t && !t.trench && !t.wire) { t.crater = 1 + Math.floor(rnd() * 3); t.mud = 1; }
  }

  // ---- Decoration ----
  for (const t of tiles) {
    if (t.trench || t.wire || t.crater) continue;
    const inNml = t.x > nmlA && t.x < nmlB;
    const r = rnd();
    if (inNml) { if (r < 0.04) t.decor = 'stump'; else if (r < 0.065) t.decor = 'log'; }
    else if (r < 0.045) t.decor = 'tree';
    else if (r < 0.06) t.decor = 'log';
    else if (r < 0.058) t.decor = 'ruin';
  }
  for (const team of [PLAYER, ENEMY]) {
    const q = map.hq[team];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = T(q.x + dx, q.y + dy);
      if (t) t.decor = null;
    }
  }

  return map;
}
