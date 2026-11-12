import { MAP_W, MAP_H, MAP_R, PLAYER, ENEMY } from './config.js';

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

/** Which team holds the west half of the current battlefield (set by createMap). */
export let WEST_TEAM = PLAYER;
/** +1 if the team advances towards +x (it starts in the west), -1 otherwise. */
export const teamDir = (team) => (team === WEST_TEAM ? 1 : -1);
/** Restore which team holds the west (loading a saved battle). */
export function setWestTeam(team) { WEST_TEAM = team; }
// Initial front-line columns for the west and east lines (14 tiles either side of the middle).
const MID = (MAP_W - 1) / 2; // middle tile column / row
const WEST_FRONT = MID - 14, EAST_FRONT = MAP_W - 1 - WEST_FRONT;
/** Map centre in continuous coordinates. */
export const MAP_C = MAP_W / 2;

/** Is the point (continuous map coordinates) on the battlefield, at least `margin` tiles inside its edge? */
export function inMap(x, y, margin = 0) {
  return Math.abs(x - MAP_C) + Math.abs(y - MAP_C) <= MAP_R + 0.5 - margin;
}
/** The point pulled back onto the battlefield (towards the centre) if it lies outside. */
export function clampToMap(x, y, margin = 0.35) {
  const dx = x - MAP_C, dy = y - MAP_C, d = Math.abs(dx) + Math.abs(dy), lim = MAP_R + 0.5 - margin;
  if (d <= lim) return { x, y };
  const k = lim / d;
  return { x: MAP_C + dx * k, y: MAP_C + dy * k };
}
/** Rows of tile column x that lie on the battlefield, inset by `inset` rows from the edge. */
export function rowsOf(x, inset = 0) {
  const half = MAP_R - Math.abs(x - MID) - inset;
  return half < 0 ? null : [MID - half, MID + half];
}

export function tileAt(map, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h) return null;
  const t = map.tiles[iy * map.w + ix];
  return t.off ? null : t;
}

/** For each row y, the x of the team's most forward owned trench tile (or -1). */
export function frontLine(map, team) {
  const out = new Array(map.h).fill(-1);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      if (t.trench > 0 && !t.off && t.owner === team) {
        if (out[y] < 0) out[y] = x;
        else if (teamDir(team) > 0 ? x > out[y] : x < out[y]) out[y] = x;
      }
    }
  }
  return out;
}

export function createMap(seed = 1916, westTeam = PLAYER) {
  WEST_TEAM = westTeam;
  const WT = westTeam, ET = 1 - westTeam;
  const FRONT_X = { [WT]: WEST_FRONT, [ET]: EAST_FRONT };
  const rnd = mulberry32(seed);
  const w = MAP_W, h = MAP_H;
  const tiles = new Array(w * h);
  const nmlA = FRONT_X[WT] + 1, nmlB = FRONT_X[ET] - 1;

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
        off: !inMap(x + 0.5, y + 0.5), // outside the battlefield
      };
    }
  }

  const map = { w, h, tiles, dirty: true, hq: [], changes: [], west: westTeam };
  const T = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && !tiles[y * w + x].off ? tiles[y * w + x] : null);

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

  // A fire trench with traverses: x shifts by `amp` every 3 rows. It runs the length of its column on the
  // battlefield (shorter towards the corners), or from y0 to y1.
  function line(baseX, owner, level, amp, y0, y1) {
    const r = rowsOf(baseX, 1);
    if (!r) return;
    y0 = Math.max(y0 ?? r[0], r[0]); y1 = Math.min(y1 ?? r[1], r[1]);
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

  // ---- Trench systems ----
  // One template, mirrored for the side a team starts on (west = upper left on screen, east = lower right).
  // Fortification style follows the team, not the position: the player's army holds lighter works with
  // sally ports in its wire (built to attack); the enemy holds sandbagged trenches behind deep wire.
  const system = (team) => {
    const west = team === WT, X = (x) => (west ? x : w - 1 - x), sgn = west ? 1 : -1;
    const heavy = team === ENEMY, lvl = heavy ? 2 : 1;
    const F = WEST_FRONT, SUPPORT = F - 7, RESERVE = F - 11, HQ = F - 14;
    line(X(F), team, lvl, -sgn);
    line(X(SUPPORT), team, lvl, -sgn);
    line(X(RESERVE), team, 2, 0);
    // communication trenches: from the reserve line in the middle, from the support line on the flanks
    for (const dy of heavy ? [-9, 1, 11] : [-10, 0, 10]) comm(X(Math.abs(dy) > 5 ? SUPPORT : RESERVE), X(F - 1), midY + dy, team, 1);
    map.hq[team] = { x: X(HQ), y: midY };
    comm(X(HQ), X(RESERVE), midY, team, 2);
    dig(X(HQ), midY, team, 3);
    return { X, heavy };
  };
  const sys = [system(PLAYER), system(ENEMY)];

  // ---- Barbed wire belts ----
  for (let y = 1; y < h - 1; y++) {
    for (const team of [PLAYER, ENEMY]) {
      const { X, heavy } = sys[team];
      // light works leave sally-port gaps every 9 rows; heavy works are deeper and denser
      if (!heavy && (y % 9 === 4 || y % 9 === 5)) continue;
      const belts = heavy ? [[2, 0.97], [3, 0.85], [4, 0.4]] : [[2, 0.92], [3, 0.55]];
      for (const [dx, p] of belts) {
        const t = T(X(WEST_FRONT + dx), y);
        if (t && !t.trench && rnd() < p) { t.wire = 100; t.origWire = team; }
      }
    }
  }

  // ---- Old shell craters in no man's land ----
  for (let i = 0; i < 200; i++) {
    const x = nmlA + 3 + Math.floor(rnd() * (nmlB - nmlA - 5));
    const y = Math.floor(rnd() * h);
    const t = T(x, y);
    if (t && !t.trench && !t.wire) { t.crater = 1 + Math.floor(rnd() * 3); t.mud = 1; }
  }

  // ---- Decoration ----
  for (const t of tiles) {
    if (t.off || t.trench || t.wire || t.crater) continue;
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
