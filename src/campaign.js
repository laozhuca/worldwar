// Campaign mode: five levels, each a battle with its own setup, objectives, timed events and medals.
// DOM-free (driven from main.js, and headlessly from the tests). A level's progress lives in
// state.campaign as plain data, so a campaign battle saves and loads like any other.
import { PLAYER, ENEMY, DIFFICULTY } from './config.js';
import { createGame, spawnUnit, pushMessage, orderMove } from './game.js';
import { frontLine, teamDir, tileAt, noSquares, makesSquare } from './map.js';

const DAY_LENGTH = 420; // seconds of game time per 24 hours (as atmosphere.js)

/** Hours since midnight of day 1 at the battle's current time. */
export function clockHours(state) {
  return (state.startHour ?? 9) + (state.time / (state.dayLength || DAY_LENGTH)) * 24;
}
/** "Day 2, 14:30" for a number of hours since midnight of day 1. */
export function dayTime(h) {
  const day = Math.floor(h / 24) + 1, hh = Math.floor(h % 24), mm = Math.floor((h % 1) * 60);
  return `Day ${day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
const left = (h) => { const d = Math.floor(h / 24), r = Math.floor(h % 24), m = Math.floor((h % 1) * 60); return d ? `${d} d ${r} h` : r ? `${r} h ${m} min` : `${m} min`; };

/** The player's front-line trench tiles (indices into map.tiles) as the battle begins. */
function frontTiles(state) {
  const f = frontLine(state.map, PLAYER), out = [];
  f.forEach((x, y) => { if (x >= 0) out.push(y * state.map.w + x); });
  return out;
}
const frontHeld = (state) => state.campaign.front.filter((i) => state.map.tiles[i].owner === PLAYER).length;

/**
 * A building standing on the battlefield: its tiles are made impassable, and any trench it stands on is dug
 * round it instead (each stretch it cut is joined up again by the shortest way round), units standing
 * there step out to the nearest open ground.
 */
function blockBuilding(state, b) {
  const { map } = state, W = map.w;
  const inside = (t) => Math.abs(t.x + 0.5 - b.x) <= b.hx && Math.abs(t.y + 0.5 - b.y) <= b.hy;
  // a clear tile all round every building: no trench right against a wall
  const near = (t) => (state.buildingsAll || [b]).some((q) => Math.abs(t.x + 0.5 - q.x) <= q.hx + 1 && Math.abs(t.y + 0.5 - q.y) <= q.hy + 1);
  const nearThis = (t) => Math.abs(t.x + 0.5 - b.x) <= b.hx + 1 && Math.abs(t.y + 0.5 - b.y) <= b.hy + 1;
  const hqs = new Set(map.hq.map((q) => q.y * W + q.x));
  const cut = [];
  for (const t of map.tiles) {
    if (t.off || !nearThis(t)) continue;
    if (t.trench && !hqs.has(t.y * W + t.x)) { cut.push({ t, level: t.trench, owner: t.owner }); t.trench = 0; t.owner = t.origOwner = -1; }
    if (inside(t)) { t.block = 1; t.decor = null; t.crater = 0; t.wire = 0; }
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < map.h ? map.tiles[y * W + x] : null);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // the trench ends left either side of the building, grouped by which stretch of trench they belong to
  const ends = [];
  for (const c of cut) for (const [dx, dy] of N4) { const n = at(c.t.x + dx, c.t.y + dy); if (n && n.trench && !n.block && n.owner === c.owner && !ends.some((e) => e.t === n)) ends.push({ t: n, level: c.level, owner: c.owner }); }
  // join each stretch to the first by a trench dug round the building (breadth-first: the shortest way)
  // (every cut end, even when the stretches still meet somewhere else: the line runs on round the building)
  for (let gi = 1; gi < ends.length; gi++) {
    const from = [ends[gi]], goal = new Set(ends.slice(0, gi).map((e) => e.t.y * W + e.t.x));
    const prev = new Map(), q = from.map((e) => e.t);
    for (const t of q) prev.set(t.y * W + t.x, -1);
    let hit = -1;
    for (let k = 0; k < q.length && hit < 0; k++) {
      const t = q[k];
      for (const [dx, dy] of N4) {
        const n = at(t.x + dx, t.y + dy), j = n ? n.y * W + n.x : -1;
        if (!n || n.off || n.block || n.rock || prev.has(j) || (near(n) && !goal.has(j))) continue;
        prev.set(j, t.y * W + t.x);
        if (goal.has(j)) { hit = j; break; }
        if (Math.abs(n.x + 0.5 - b.x) > b.hx + 2.5 || Math.abs(n.y + 0.5 - b.y) > b.hy + 2.5) continue; // keep close round the building
        q.push(n);
      }
    }
    for (let j = hit; j >= 0; j = prev.get(j)) { const t = map.tiles[j]; if (!t.trench) { t.trench = from[0].level; t.owner = t.origOwner = from[0].owner; t.wire = 0; t.decor = null; t.mud = 0; } }
  }
  // anyone standing where the building now is steps out to the nearest open tile
  for (const u of state.units) {
    const t = at(Math.floor(u.x), Math.floor(u.y));
    if (!t || !(t.block || (u.inTrench && !t.trench))) continue; // in the building, or in a trench filled in
    let best = null, bd = Infinity;
    for (const n of map.tiles) if (!n.off && !n.block && !n.rock && (n.trench || !u.inTrench)) { const d = Math.hypot(n.x + 0.5 - u.x, n.y + 0.5 - u.y) + (n.trench ? 0 : 0.6); if (d < bd) { bd = d; best = n; } }
    if (best) { u.x = best.x + 0.5; u.y = best.y + 0.5; u.inTrench = !!best.trench; }
  }
}

/** A wave of squads coming up from a team's HQ. */
function reinforce(state, team, n, kind = 'rifle') {
  const q = state.map.hq[team], dir = teamDir(team), out = [];
  for (let i = 0; i < n; i++) {
    const u = spawnUnit(state, kind, team, q.x + 0.5 + dir * (1 + (i % 3) * 0.6), q.y + 0.5 + (i - (n - 1) / 2) * 1.4);
    orderMove(state, [u], q.x + 0.5 + dir * 4, q.y + 0.5 + (i - (n - 1) / 2) * 2);
    out.push(u);
  }
  return out;
}

/**
 * A relieving force marching onto the battlefield from the team's rear edge: one squad every second
 * row along the whole front, each making for the front-line trench in its row. Returns the squads.
 */
function relieve(state, team, nation) {
  const { map } = state, f = frontLine(map, team), west = teamDir(team) > 0, out = [];
  for (let y = 1; y < map.h - 1; y += 2) {
    if (f[y] < 0) continue;
    let x = west ? 0 : map.w - 1;
    while (map.tiles[y * map.w + x].off && x >= 0 && x < map.w) x += west ? 1 : -1; // the battlefield's edge in this row
    const u = spawnUnit(state, 'rifle', team, x + 0.5, y + 0.5);
    if (nation) u.nation = nation; // allies in their own uniform
    orderMove(state, [u], f[y] + 0.5, y + 0.5);
    u.reliefTo = { x: f[y] + 0.5, y: y + 0.5 };
    out.push(u);
  }
  return out;
}

/**
 * Impassable rock outcrops (the Alpine karst): small clusters of 1-4 tiles, kept clear of trenches,
 * wire, headquarters and troops, and apart from each other so men can always walk round them.
 */
function scatterRocks(state, count, seed) {
  const { map } = state;
  let r = seed >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const near = (t, d, f) => { for (let y = t.y - d; y <= t.y + d; y++) for (let x = t.x - d; x <= t.x + d; x++) { const n = tileAt(map, x, y); if (n && f(n)) return true; } return false; };
  const ok = (t) => t && !t.off && !t.trench && !t.wire && !t.rock && !t.build
    && !near(t, 2, (n) => n.trench || n.wire) && !near(t, 3, (n) => n.rock)
    && [map.hq[0], map.hq[1]].every((q) => Math.hypot(q.x - t.x, q.y - t.y) > 5)
    && !state.units.some((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 2);
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < count; tries++) {
    const t = map.tiles[Math.floor(rnd() * map.tiles.length)];
    if (!ok(t)) continue;
    const cluster = [t];
    t.rock = 1 + Math.floor(rnd() * 4);
    const extra = Math.floor(rnd() * 4);
    for (let k = 0; k < extra; k++) {
      const b = cluster[Math.floor(rnd() * cluster.length)], dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
      const n = tileAt(map, b.x + dir[0], b.y + dir[1]);
      if (n && !n.off && !n.trench && !n.wire && !n.rock && !near(n, 1, (q) => q.trench || q.wire)) { n.rock = 1 + Math.floor(rnd() * 4); cluster.push(n); }
    }
    for (const c of cluster) { c.decor = null; c.crater = 0; }
    placed++;
  }
  map.rocks = true;
  map.dirty = true;
}

/**
 * The Isonzo valley (battle 2): the battlefield cut down to a long, narrow band across the screen, walled
 * with rock, fought from left to right. Our lines and guns at the left; three enemy strongpoints along it,
 * far apart, each a short trench round a concrete MG nest behind a single belt of wire; rocky spurs and
 * boulders scattered between them, leaving narrow winding lanes. The enemy has no headquarters here (a hidden rally point
 * only) and holds his ground: no recruiting, no offensives, only his guns.
 */
const TAU = Math.PI * 2;
function buildValley(state) {
  const { map } = state, W = map.w, V0 = W - 1, B = 15, BK = 25; // the valley's half-width; how far its rock wall reaches back
  map.band = B; map.bandBack = BK;
  let seed = 916;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // u: along the valley (screen right), v: across it (screen down); a tile for (u, v)
  const at = (u, v) => {
    let x = Math.round((u + v + V0) / 2), y = Math.round((v - u + V0) / 2);
    return tileAt(map, x + 0.5, y + 0.5);
  };
  const uv = (t) => [t.x - t.y, t.x + t.y - V0];
  // a clean slate: the band, nothing dug, no units
  for (const t of map.tiles) {
    const v = t.x + t.y - V0;
    Object.assign(t, { trench: 0, owner: -1, origOwner: -1, wire: 0, origWire: -1, crater: 0, dmg: 0, build: null, rock: 0, block: 0, decor: null });
    if (v > B || v < -BK) t.off = true;
    t.mud = 0; t.ground = 0;
  }
  // the ground: broad patches of churned mud, frost-bitten alpine grass and lying snow, with ragged edges
  const ph = Array.from({ length: 8 }, () => rnd() * TAU);
  const field = (u, v, a, b) => Math.sin(u * 0.21 + ph[a]) * Math.cos(v * 0.33 + ph[b]) + 0.6 * Math.sin((u + v) * 0.13 + ph[a + 1]) + 0.35 * Math.sin((u - 2 * v) * 0.29 + ph[b + 1]);
  for (const t of map.tiles) {
    if (t.off) continue;
    const u = t.x - t.y, v = t.x + t.y - V0, j = (rnd() - 0.5) * 0.5;
    const wet = field(u, v, 0, 2) + j, cold = field(v * 1.3, u * 0.8, 4, 6) + j;
    if (cold > 0.75) t.ground = 2; // a snowfield
    else if (wet < -0.35) t.mud = 1; // a mud patch
    else if (wet > 0.15) t.ground = 1; // a stretch of alpine grass
    else t.mud = rnd() < 0.3 ? 1 : 0;
  }
  state.units = [];
  // digging: a 4-connected trench from tile a to tile b
  const dig = (a, b, team, level) => {
    if (!a || !b) return;
    let x = a.x, y = a.y;
    for (let n = 0; n < 200; n++) {
      const t = tileAt(map, x + 0.5, y + 0.5);
      if (t) { t.trench = Math.max(t.trench, level); t.owner = t.origOwner = team; t.mud = 0; }
      if (x === b.x && y === b.y) break;
      const dx = b.x - x, dy = b.y - y;
      if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy);
    }
  };
  const nearestTrench = (u, v, team) => {
    let best = null, bd = Infinity;
    for (const t of map.tiles) if (t.trench && t.owner === team) { const [tu, tv] = uv(t), d = Math.hypot(tu - u, tv - v); if (d < bd) { bd = d; best = t; } }
    return best;
  };
  // ---- our side, at the left: HQ, a front and a support line, a communication trench
  const hq = at(-31, 0);
  map.hq[PLAYER] = { x: hq.x, y: hq.y };
  dig(at(-21, -12), at(-21, 12), PLAYER, 1);
  dig(at(-25, -8), at(-25, 8), PLAYER, 1);
  dig(hq, at(-21, 0), PLAYER, 2);
  hq.trench = 3;
  // ---- the three strongpoints, far apart along the valley, alternately high and low
  const POINTS = [[-3, -6, 3], [14, 6, -3], [29, -3, 3]]; // u, v of the nest; where the gap in its wire is
  for (const [u0, vc] of POINTS) {
    dig(at(u0, vc - 4), at(u0, vc + 4), ENEMY, 2);
    dig(at(u0 + 3, vc - 1), at(u0 + 3, vc + 1), ENEMY, 2);
    dig(at(u0, vc), at(u0 + 3, vc), ENEMY, 2);
  }
  // ---- the enemy's hidden rally point (no HQ to take in this battle)
  const ehq = at(34, 0);
  map.hq[ENEMY] = { x: ehq.x, y: ehq.y, hidden: true };
  noSquares(map);
  // wire in front of each strongpoint, with one gap
  POINTS.forEach(([u0, vc, gap]) => {
    for (let v = vc - 5; v <= vc + 5; v++) {
      if (Math.abs(v - (vc + gap)) <= 1) continue;
      const t = at(u0 - 3, v); if (t && !t.trench && !t.off) { t.wire = 100; t.origWire = ENEMY; t.mud = 0; }
    }
  });
  // ---- rock: ragged valley walls, and long spurs and boulder fields scattered along it, leaving narrow
  // winding lanes between them for the attacker
  const rock = (t) => { if (t && !t.off && !t.trench && !t.wire && !(t.x === hq.x && t.y === hq.y)) { t.rock = 1 + Math.floor(rnd() * 4); t.mud = 0; } };
  const wall = []; // how far the wall reaches into the valley, varying smoothly along it
  for (let u = -40; u <= 40; u++) wall[u + 40] = [12.6 + 1.6 * Math.sin(u * 0.37) + rnd() * 0.9, 12.6 + 1.6 * Math.sin(u * 0.29 + 2) + rnd() * 0.9];
  for (const t of map.tiles) {
    if (t.off) continue;
    const [u, v] = uv(t), w = wall[Math.max(0, Math.min(80, u + 40))];
    if (v <= -w[0] || v >= w[1] || Math.abs(v) >= 15) rock(t);
  }
  const hashRnd = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  // a spur: a ridge of rock from (u0, v0) to (u1, v1), ragged, thickness r
  const spur = (u0, v0, u1, v1, r, knoll = false) => {
    for (const t of map.tiles) {
      if (t.off) continue;
      const [u, v] = uv(t), du = u1 - u0, dv = v1 - v0, L = du * du + dv * dv;
      const k = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / L));
      const d = Math.hypot(u - (u0 + du * k), v - (v0 + dv * k));
      if (d <= r + (hashRnd(t.x, t.y) - 0.5) * 1.2) { rock(t); if (t.rock && knoll) t.knoll = 1; }
    }
  };
  const SPURS = [
    // (a sixth value marks a grassy knoll of dwarf pine rather than rock: as impassable)
    [-18, 6, -6, 9, 1.1, true], [-17, -1, -7, 1, 1.1], [-15, -8, -5, -6, 1], // before the first nest
    [1, -1, 10, 1, 1.1], [2, 5, 9, 8, 1, true], [4, -7, 11, -9, 1], // between the first and the second
    [17, -2, 24, 0, 1.1, true], [18, 4, 25, 7, 1], [17, -9, 23, -11, 1], [16, 10, 22, 12, 0.9, true], // between the second and the third
  ];
  for (const sp of SPURS) spur(...sp);
  for (let n = 0; n < 8; n++) { // lone boulders and small clusters in the open
    const u = -18 + rnd() * 48, v = -11 + rnd() * 22;
    if (POINTS.some(([pu, pv]) => Math.abs(u - pu) < 6 && Math.abs(v - pv) < 7)) continue;
    spur(u, v, u + (rnd() - 0.5) * 2, v + (rnd() - 0.5) * 2, 0.4 + rnd() * 0.5, rnd() < 0.5);
  }
  // the valley wall's foot grown over with dwarf pine in places
  for (const t of map.tiles) {
    if (!t.rock || t.knoll) continue;
    const [u, v] = uv(t);
    if (v > -15 && v < 15 && Math.abs(v) >= 11 && Math.sin(u * 0.23 + (v > 0 ? 2.1 : 0.4)) > 0.45) t.knoll = 1;
  }
  // scree: loose stones lying on the open ground (passable, but slow), in patches and at the rocks' feet
  for (const t of map.tiles) {
    if (t.off || t.rock || t.trench || t.wire || t.ground === 2) continue;
    const [u, v] = uv(t), near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const n = tileAt(map, t.x + dx + 0.5, t.y + dy + 0.5); return n && n.rock && !n.knoll; });
    const f = Math.sin(u * 0.41 + 1.7) * Math.cos(v * 0.53 - 0.6) + 0.5 * Math.sin((u - v) * 0.31);
    if ((near && rnd() < 0.35) || f > 1.05 || rnd() < 0.025) { t.ground = 3; t.mud = 0; }
  }
  // great crags, three times the size of any in the valley, along the back of its rock wall like the foot of
  // the mountain: on the map's own (impassable) rock, each standing over the rock tiles beneath it
  map.giants = [];
  for (let u = -28; u <= 28; u += 7 + Math.floor(rnd() * 3)) {
    const uu = u + Math.round((rnd() - 0.5) * 3), vv = -20 - Math.floor(rnd() * 2);
    const g = { x: Math.round((uu + vv + V0) / 2) + 0.5, y: Math.round((vv - uu + V0) / 2) + 0.5, v: Math.floor(rnd() * 3), m: rnd() < 0.5 };
    map.giants.push(g);
    for (const t of map.tiles) if (t.rock && Math.abs(t.x + 0.5 - g.x) <= 3 && Math.abs(t.y + 0.5 - g.y) <= 3) t.hidden = 1; // drawn by the great crag
  }
  // a few trees and stumps in the open
  for (const t of map.tiles) if (!t.off && !t.trench && !t.wire && !t.rock && rnd() < 0.03) t.decor = rnd() < 0.5 ? 'stump' : 'tree';
  map.rocks = true;
  map.dirty = true;
  map.startView = (() => { const t = at(-16, 0); return { x: t.x + 0.5, y: t.y + 0.5 }; })();
  // ---- our troops: rifle squads and machine guns in the line, batteries behind it
  const put = (type, team, t) => (t ? spawnUnit(state, type, team, t.x + 0.5, t.y + 0.5) : null);
  for (const v of [-10, -6, -2, 2, 6, 10]) put('rifle', PLAYER, nearestTrench(-21, v, PLAYER));
  for (const v of [-4, 4]) put('mg', PLAYER, nearestTrench(-21, v, PLAYER));
  for (const v of [-5, 5]) put('rifle', PLAYER, nearestTrench(-25, v, PLAYER));
  for (const v of [-9, 0, 9]) put('artillery', PLAYER, at(-28, v));
  // ---- the enemy: in each strongpoint the nest (concrete all round it), two squads guarding it, and a
  // machine gun in the rear line of the two farther ones; his batteries at the far end
  const nests = POINTS.map(([u0, vc], i) => {
    const t = nearestTrench(u0, vc, ENEMY);
    const u = put('mg', ENEMY, t);
    u.ai.role = 'nest'; u.nest = true; u.inTrench = true; u.setup = 0;
    for (let y = t.y - 1; y <= t.y + 1; y++) for (let x = t.x - 1; x <= t.x + 1; x++) { const n = tileAt(map, x + 0.5, y + 0.5); if (n && n.trench && n.owner === ENEMY) n.trench = 3; }
    for (const dv of [-3, 3]) { const g = put('rifle', ENEMY, nearestTrench(u0, vc + dv, ENEMY)); if (g) g.ai.role = 'hold'; }
    if (i > 0) { const m = put('mg', ENEMY, nearestTrench(u0 + 4, vc, ENEMY)); if (m) { m.ai.role = 'hold'; m.setup = 0; } }
    return u;
  });
  for (const v of [-8, 7]) put('artillery', ENEMY, at(33, v));
  state.bunkers = nests.map((u) => ({ id: u.id, x: u.x, y: u.y }));
  state.campaign.nests = nests.map((u) => u.id);
  state.campaign.silenced = [];
  // short of everything: ammunition above all
  state.resources[PLAYER] = { men: 24, ammo: 240, supplies: 120 };
  state.resources[ENEMY] = { men: 0, ammo: 400, supplies: 0 };
  state.barrageLimit = { [PLAYER]: 8 };
  const ai = state.ais[0];
  ai.level = { ...DIFFICULTY.hard, static: true, defensiveGap: 30 };
}

/** The trench tile of a team's line `off` tiles behind its front line in row y (front = 0, support = 7, reserve = 11). */
function trenchBehind(map, team, y, off) {
  const f = frontLine(map, team), x0 = f[y] - teamDir(team) * off;
  let best = null, bd = Infinity;
  for (let dy = 0; dy <= 2 && !best; dy++) for (const yy of [y - dy, y + dy]) for (let x = x0 - 2; x <= x0 + 2; x++) {
    const t = tileAt(map, x, yy);
    if (t && t.trench && t.origOwner === team && Math.abs(x - x0) + Math.abs(yy - y) < bd) { bd = Math.abs(x - x0) + Math.abs(yy - y); best = t; }
  }
  return best;
}

// ------------------------------------------------------------------ the levels
export const LEVELS = [
  {
    id: 'ypres', n: 1, title: 'The Sailors of Dixmude', place: 'Dixmude, Belgium', date: 'October 1914',
    nations: ['marins', 'germany'], allies: ['france'], season: 'mud', start: 'west', startHour: 6.5,
    pictures: ['assets/art/scene-dixmude-relief.webp', 'assets/art/story-dixmude-dawn.webp', 'assets/art/story-leguen.webp', 'assets/art/story-moreau.webp'],
    // the opening scene, like the prologue's: two sailors behind the barricade before the attack
    opening: [
      { who: 'Dixmude, Belgium — October 1914', text: 'Just before dawn. Two French sailors stand behind a makeshift barricade. A cold mist hangs over the empty road.', img: 'assets/art/story-dixmude-dawn.webp', wide: true, hold: 3 },
      { who: 'Le Guen', text: 'You think the Germans will come today?', img: 'assets/art/story-leguen.webp' },
      { who: 'Moreau', text: 'They\'ve been shelling us for three days. I\'d say they\'re getting impatient.', img: 'assets/art/story-moreau.webp' },
      { who: 'Le Guen', text: 'I joined the Navy to see the world. Not to die in a Belgian ditch.', img: 'assets/art/story-leguen.webp' },
      { who: 'Moreau', text: 'Well, you\'ve seen Belgium.', img: 'assets/art/story-moreau.webp' },
      { who: '', text: 'A distant whistle cuts through the morning silence.', img: 'assets/art/story-dixmude-dawn.webp', wide: true, sound: 'incoming' },
      { who: 'Moreau', text: 'Down!', img: 'assets/art/story-moreau.webp', hold: 0.9 },
    ],
    // ...and the first shells strike: the German attack begins
    openingEnd(state) {
      const f = state.campaign.front, d = teamDir(PLAYER);
      for (let k = 0; k < 4 && f.length; k++) {
        const t = state.map.tiles[f[Math.floor((0.3 + 0.13 * k) * f.length)]], tx = t.x + 0.5 + d * (2.5 + k % 2), ty = t.y + 0.5 + (k - 1.5);
        const flight = 0.6 + k * 0.45;
        state.shells.push({ x: tx, y: ty, t: flight, flight, team: ENEMY, fromX: tx + d * 30, fromY: ty, incoming: true });
      }
      const ai = state.ais[0];
      if (ai) ai.offensive = Math.min(ai.offensive, 20);
      pushMessage(state, 'The first shell strikes. The German attack begins.', 'warn');
    },
    works: 'light', // 1914: the first, hastily dug lines, a front line and a support line
    advance: { [PLAYER]: 6 }, // our lines stand forward of the town, leaving room for it behind the HQ
    history: 'October 1914. The German army is driving for the Channel ports along the river Yser, and only a thin line stands in its way. At Dixmude, Admiral Ronarc\'h and his brigade of French naval infantry, the Fusiliers Marins, sailors who have never fought on land, are ordered to hold the town and its bridgehead for at least four days, until reinforcements can come up. Dig in, and hold.',
    objectives: ['Hold until the relief arrives at dawn on day 4.', 'Do not let the enemy take your headquarters.', 'Do not lose more than half of your front line.'],
    rules: ['Your trenches are strong: sandbagged all along your line.', 'Supplies are short: the convoys bring 70% of the usual.', 'The enemy attacks in strength every few hours, day and night, and fresh battalions come up behind him.'],
    medals: ['Held until relieved', 'Not a yard given: no more than 4 front-line sections lost at the end', 'A careful commander: fewer than 350 men lost'],
    debrief: {
      won: 'The reinforcements came up through the mud at dawn on the fourth day and found the sailors still in their trenches. Ordered to hold Dixmude for four days, Ronarc\'h\'s Fusiliers Marins held it for more than three weeks, at the cost of half their number. By then the Yser valley had been flooded, and the German drive on the Channel ports was over.',
      lost: 'Your line broke before the reinforcements could reach you. At Dixmude in 1914 it did not: the Fusiliers Marins, ordered to hold for four days, held for more than three weeks, and the Germans never reached the Channel ports.',
    },
    setup(state) {
      // the town of Dixmude on the battlefield behind our headquarters: its buildings are impassable
      const hq = state.map.hq[PLAYER];
      const town = { img: 'assets/art/town-dixmude.webp', x: hq.x + 0.5 - teamDir(PLAYER) * 4.7, y: hq.y + 0.5, ax: 440, ay: 444, k: 0.5, hx: 2.1, hy: 4.4 };
      state.backdrop = town;
      // a corner of the town round headquarters: at each end of the church quarter a house carries its line
      // on, and a building turns towards the front (each from its own 3D model, rendered like the town)
      const dd = teamDir(PLAYER), X = (off) => hq.x + 0.5 + dd * off, Y = (off) => hq.y + 0.5 + off;
      const B = (name, ax, ay, ox, oy, hx, hy) => ({ img: `assets/art/town-dixmude-${name}.webp`, x: X(ox), y: Y(oy), ax, ay, k: 0.5, hx, hy });
      state.buildings = [
        B('dawn', 175, 157, -3.3, -5.9, 1.25, 1.45), // a burnt-out house north of the church
        B('station', 165, 213, 0.5, -6.1, 2.2, 1.1), // the railway station, turning towards the front
        B('home', 101, 170, -3.3, 5.9, 0.8, 1.45), // a shelled gabled house south of the church
        B('cottage', 123, 156, -0.1, 6.3, 1.4, 0.8), // a cottage, turning towards the front
      ];
      // and ruined houses out among our trench lines (copies of the two shelled houses, each turned another
      // way): the trenches they stand on are dug round them instead
      state.buildings.push(
        B('dawn-b', 152, 188, 2.6, -10.3, 1.45, 1.25), // just beyond the station
        B('home-b', 129, 165, 6.2, -2.7, 1.45, 0.8), // alone, a little ahead of headquarters
        B('dawn-c', 154, 171, 9.4, 4.6, 1.25, 1.45), // well forward, between the middle and the front lines
        B('home-c', 136, 133, 3.1, 10.9, 0.8, 1.45), // off the town's southern corner
        // and behind the church, towards the rear
        B('home', 101, 170, -10.5, 0.5, 0.8, 1.45),
        B('dawn-b', 152, 188, -8.5, 3.0, 1.45, 1.25),
        B('home-b', 129, 165, -8.4, -2.6, 1.45, 0.8),
      );
      state.buildingsAll = [town, ...state.buildings];
      for (const b of state.buildingsAll) blockBuilding(state, b);
      delete state.buildingsAll;
      state.map.rocks = true;
      state.map.extraTop = 120; // a strip of ground beyond the map's top edge, for the bell tower to rise against
      // strong works: our trenches sandbagged
      for (const t of state.map.tiles) if (t.trench && t.owner === PLAYER) t.trench = Math.max(t.trench, 2);
      state.map.dirty = true;
      state.resources[PLAYER] = { men: 18, ammo: 260, supplies: 110 };
      state.playerIncome = 0.7;
      // a relentless enemy: hard, attacking early and often with big forces
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.hard, firstAttack: 170, attackGap: [160, 220], force: 6, steps: 3 };
      ai.offensive = 170;
      // the battalion reserve: squads and a machine gun around headquarters
      reinforce(state, PLAYER, 3);
      const q = state.map.hq[PLAYER], d = teamDir(PLAYER);
      spawnUnit(state, 'mg', PLAYER, q.x + 0.5 + d * 2, q.y + 0.5);
      spawnUnit(state, 'mg', PLAYER, q.x + 0.5 + d * 2, q.y + 2.5); // and a second gun covering headquarters
      noSquares(state.map); // the trenches dug round the buildings keep the usual shape
      state.campaign.front = frontTiles(state);
    },
    events: [
      { at: 24 + 0, run: (s) => pushMessage(s, 'Day 2. The relief is still two days away.', 'side') },
      { at: 48 + 0, run: (s) => pushMessage(s, 'Day 3. The reinforcements are on the road from Dunkirk. Hold on one more day.', 'side') },
      ...[13, 29, 38, 52, 62, 71].map((at) => ({ at, run: (s) => { reinforce(s, ENEMY, 4); pushMessage(s, 'Fresh German reserves are coming up behind their line.', 'warn'); } })),
      { at: 72 + 6, run: (s) => {
        s.campaign.relief = relieve(s, PLAYER, 'france').map((u) => u.id);
        s.campaign.relievedAt = s.time;
        pushMessage(s, 'The reinforcements have arrived! A fresh French division is marching up to our line.', 'good');
        // a picture of the moment, shown with the announcement (main.js)
        s.campaign.scene = { at: s.time, img: 'assets/art/scene-dixmude-relief.webp', who: 'Dixmude, dawn of the fourth day', text: 'The reinforcements have arrived! A fresh French division is marching up to our line.' };
        s.events.push({ type: 'cheer' });
      } },
    ],
    check(state) {
      const c = state.campaign;
      if (c.relievedAt !== undefined) {
        // won when most of the relief has reached the front line (or, failing that, after a minute)
        const rel = state.units.filter((u) => c.relief.includes(u.id) && !u.dead);
        const there = rel.filter((u) => Math.hypot(u.x - u.reliefTo.x, u.y - u.reliefTo.y) < 2.5).length;
        if (!c.manned && (there >= rel.length * 0.8 || state.time - c.relievedAt > 60)) {
          c.manned = state.time;
          pushMessage(state, 'The reinforcements are in our trenches. Dixmude is held!', 'good');
          state.events.push({ type: 'cheer' });
        }
        if (c.manned && state.time - c.manned > 4) return { result: 'won', reason: 'Relieved. You held the line.' };
      }
      if (frontHeld(state) < c.front.length / 2) return { result: 'lost', reason: 'More than half of your front line has fallen.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      return [
        'Hold until relieved',
        c.relievedAt !== undefined ? 'The relief has arrived.' : `Relief: dawn of day 4, in ${left(Math.max(0, 78 - h))}`,
        `Front line held: ${frontHeld(state)} / ${c.front.length} (no fewer than ${Math.ceil(c.front.length / 2)})`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.front.length - frontHeld(state) <= 4, won && state.stats.lost[PLAYER] < 350];
    },
  },
  {
    id: 'isonzo', n: 2, title: 'The Nests of San Michele', place: 'The Isonzo, Italy', date: 'August 1916',
    nations: ['italy', 'austria'], season: 'thaw', start: 'west', startHour: 5,
    pictures: ['assets/art/scene-san-michele-victory.webp', 'assets/art/story-san-michele.webp', 'assets/art/story-bianchi.webp', 'assets/art/story-rossi.webp'],
    // the opening scene, like the prologue's: two Italian soldiers in a rocky trench before the assault
    opening: [
      { who: 'Monte San Michele, Isonzo Front — August 6, 1916', text: 'Early morning. Two Italian soldiers crouch in a rocky trench. The smell of coffee mingles with damp earth. Above them, Austrian machine-gun positions overlook the valley.', img: 'assets/art/story-san-michele.webp', wide: true, hold: 3 },
      { who: 'Private Bianchi', text: 'Mamma mia. This coffee tastes like mud.', img: 'assets/art/story-bianchi.webp' },
      { who: 'Sergeant Rossi', text: 'That\'s because you\'re drinking from my shaving cup.', img: 'assets/art/story-rossi.webp' },
      { who: 'Bianchi', text: 'At least the Austrians can\'t ruin our coffee.', img: 'assets/art/story-bianchi.webp' },
      { who: 'Rossi', text: 'They\'ve already ruined the view.', img: 'assets/art/story-rossi.webp' },
      { who: '', text: 'Bianchi looks up at the steep, rocky mountain.', img: 'assets/art/story-san-michele.webp', wide: true },
      { who: 'Bianchi', text: 'You know, back home in Naples, we have a mountain too.', img: 'assets/art/story-bianchi.webp' },
      { who: 'Rossi', text: 'Vesuvius?', img: 'assets/art/story-rossi.webp' },
      { who: 'Bianchi', text: 'Sì. But at least that one only tries to kill us every few hundred years.', img: 'assets/art/story-bianchi.webp' },
      { who: '', text: 'A distant Italian artillery battery opens fire. The ground trembles.', img: 'assets/art/story-san-michele.webp', wide: true, sound: 'artyfire' },
      { who: 'Rossi', text: 'Finish your coffee, Bianchi. We\'re climbing.', img: 'assets/art/story-rossi.webp' },
      { who: 'Bianchi', text: 'Without breakfast?', img: 'assets/art/story-bianchi.webp' },
      { who: 'Rossi', text: 'Complain to the King.', img: 'assets/art/story-rossi.webp' },
      { who: 'Bianchi', text: 'I will. If he survives my mother\'s letter.', img: 'assets/art/story-bianchi.webp' },
    ],
    // ...and the Italian guns roar: the assault begins
    openingEnd(state) {
      for (let k = 0; k < 4; k++) state.events.push({ type: 'artyfire' });
      pushMessage(state, 'The Italian guns roar. The assault begins.', 'warn');
    },
    history: 'The Sixth Battle of the Isonzo. Five times the Italian army has thrown itself at the Austro-Hungarian line above the river, and five times it has been cut down by machine guns firing from concrete emplacements in the rock. This time the guns must be found and silenced first. Three nests command the whole sector; until they fall, no attack can cross the open ground. Your batteries have been given shells for only a handful of barrages: make every one count.',
    objectives: ['Silence all three machine-gun nests, one after another along the valley.', 'Do it before nightfall on day 2.', 'Do not let the enemy take your headquarters.'],
    rules: ['The valley is narrow and strewn with great boulders: your men must work along the narrow lanes between them.', 'Each nest is a concrete pillbox at the heart of its own strongpoint, behind wire. Shells only keep its crew\'s heads down: the infantry must take it.', 'Ammunition is short: 8 battery barrages for the whole battle. Bring the guns forward to reach the farther nests.'],
    medals: ['The guns are silenced', 'Swift work: all three silenced before nightfall on day 1', 'Shells to spare: 3 or more barrages unused'],
    debrief: {
      won: 'With the machine guns silent, the Italian infantry crossed the open ground at last. In August 1916 the Sixth Battle of the Isonzo took Monte Sabotino and San Michele, and Gorizia fell: the greatest Italian victory of the war until its final year.',
      lost: 'The nests were still firing when night fell on the second day, and the attack was called off. Eleven times the Italians attacked on the Isonzo; most of those battles ended like this, with a few hundred yards gained at a terrible price.',
    },
    setup(state) {
      buildValley(state);
    },
    events: [
      { at: 5.2, run: (s) => pushMessage(s, 'Three machine-gun nests hold the valley, one behind the other. Work up the narrow lanes between the rocks and silence them all before nightfall tomorrow — the guns can only pin a nest down; the infantry must take it.', 'side') },
      { at: 24 + 5, run: (s) => pushMessage(s, 'Day 2. The attack must succeed by nightfall.', 'side') },
      { at: 24 + 16, run: (s) => pushMessage(s, 'Three hours of daylight left.', 'warn') },
    ],
    check(state) {
      const c = state.campaign;
      for (const id of c.nests) {
        if (c.silenced.includes(id)) continue;
        const u = state.units.find((q) => q.id === id);
        if (!u || u.dead) {
          c.silenced.push(id);
          if (c.silenced.length === 1) c.firstAt = clockHours(state);
          pushMessage(state, c.silenced.length < 3 ? `A machine-gun nest is silenced! ${3 - c.silenced.length} still firing.` : 'The last machine-gun nest is silenced!', 'good');
          state.events.push({ type: 'cheer' });
        }
      }
      if (c.silenced.length >= c.nests.length) {
        c.doneAt = c.doneAt ?? clockHours(state);
        if (c.wonAt === undefined) {
          c.wonAt = state.time;
          // a picture of the moment, shown with the announcement (main.js), before the battle ends
          c.scene = { at: state.time, img: 'assets/art/scene-san-michele-victory.webp', who: 'Monte San Michele, August 1916', text: 'The last nest is silenced! The tricolour flies over the Austrian guns.' };
        }
        if (state.time - c.wonAt > 9) return { result: 'won', reason: 'The guns are silenced.' };
        return null;
      }
      if (clockHours(state) >= 24 + 19) return { result: 'lost', reason: 'Night fell on the second day with the nests still firing.' };
      return null;
    },
    // after the opening the camera visits each nest in turn, marking it for a moment (main.js); no rings after
    tour(state) {
      return state.campaign.nests.map((id) => state.units.find((u) => u.id === id)).filter((u) => u && !u.dead).map((u, i) => ({ x: u.x, y: u.y, label: `MG nest ${i + 1}` }));
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      return [
        'Silence the guns',
        `Nests silenced: ${c.silenced.length} / ${c.nests.length}`,
        `Barrages left: ${state.barrageLimit[PLAYER]}`,
        `Nightfall on day 2 in ${left(Math.max(0, 43 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.doneAt < 19.5, won && state.barrageLimit[PLAYER] >= 3];
    },
  },
  {
    id: 'brusilov', n: 3, title: 'Brusilov\'s Storm', place: 'Galicia', date: 'June 1916',
    nations: ['russia', 'austria'], season: 'summer', start: 'west', startHour: 4,
    radius: 51, // a wider battlefield: half as long again each way
    works: 'network', // trench systems grown over months: wandering lines, winding communication trenches
    history: 'June 1916. General Brusilov has broken every rule of the Western Front. There is no single great blow aimed at one point: his armies attack together along hundreds of miles, after a short, sharp bombardment, from saps dug right up to the enemy wire. Opposite you the Austro-Hungarian line is held by plenty of infantry but few machine guns, its best divisions and guns sent away to Italy. It will not stay that way: reserves are already on the railway. Break the line, push on past it, and take all three of their headquarters before it can be shored up.',
    objectives: ['Take all three enemy headquarters.', 'Do it within three days: by midnight on day 3.', 'Do not let the enemy take your headquarters.'],
    rules: ['A battle of riflemen: both sides are rich in infantry and poor in machine guns and guns.', 'Your saps run right up to the enemy wire: your assault troops start in them.', 'Austrian reserves arrive on the evening of day 1 and again on day 2: break through and press on to the headquarters before they come.'],
    medals: ['The breakthrough', 'Before the second reserves: all three headquarters taken by day 2, 20:00', 'A broad front: half the enemy front line in your hands at the end'],
    debrief: {
      won: 'The Austro-Hungarian line gave way along its whole length. The Brusilov Offensive was the greatest Russian victory of the war: in a few weeks it took some 400,000 prisoners and nearly knocked Austria-Hungary out of the war, before German reserves and Russian exhaustion brought it to a halt.',
      lost: 'The reserves came up in time and the line held. Even the Brusilov Offensive, the most successful attack of the war on any front until 1918, was in the end stopped this way, and its cost in Russian lives helped bring the revolution of 1917.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2), d = teamDir(PLAYER);
      const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < map.h ? map.tiles[y * W + x] : null);
      // ---- early summer: the ground left to chance, as farmland under a battle is: patches of mud, meadow,
      // wheat and rough grass of every shape, the mud and shell holes thickening towards the middle of no
      // man's land along a wandering band, never with a straight edge
      map.summer = true;
      const f = frontLine(map, PLAYER), ef = frontLine(map, ENEMY);
      let seed = 1606;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const G = 16, grid = Array.from({ length: 4 }, () => Array.from({ length: G * G }, rnd)); // value noise
      const noise = (k, x, y, sc) => {
        const u = (x * sc) % (G - 1), v = (y * sc) % (G - 1), i0 = Math.floor(u), j0 = Math.floor(v), a = u - i0, b = v - j0, g = grid[k];
        const sm = (q) => q * q * (3 - 2 * q), A = sm(a), B = sm(b);
        return (g[j0 * G + i0] * (1 - A) + g[j0 * G + i0 + 1] * A) * (1 - B) + (g[(j0 + 1) * G + i0] * (1 - A) + g[(j0 + 1) * G + i0 + 1] * A) * B;
      };
      const mid = (y) => (f[y] >= 0 && ef[y] >= 0 ? (f[y] + ef[y]) / 2 : W / 2) + (noise(3, 0, y, 0.09) - 0.5) * 16; // the middle of the fighting, wandering
      for (const t of map.tiles) {
        if (t.off) continue;
        const band = Math.exp(-(((t.x - mid(t.y)) / 11) ** 2)); // 1 in the middle of no man's land, fading out irregularly
        const churn = band * 0.42 + (noise(0, t.x, t.y, 0.11) - 0.5) * 0.95 + (noise(1, t.x, t.y, 0.29) - 0.5) * 0.45;
        t.mud = churn > 0.36 || rnd() < 0.03 ? 1 : 0;
        t.crater = rnd() < Math.max(0, band * 0.12 + churn * 0.1) ? 1 + Math.floor(rnd() * 3) : 0;
        if (t.decor === 'tree') t.decor = churn > 0.35 ? 'stump' : rnd() < 0.6 ? 'birch' : null; // no dead woods of the Western Front here
        if (t.mud || t.crater || t.trench || t.wire) { t.ground = 0; continue; }
        const wheat = noise(2, t.x, t.y, 0.17) + (noise(1, t.x + 40, t.y, 0.5) - 0.5) * 0.25;
        t.ground = wheat > 0.64 && churn < 0.2 ? 4 : churn < 0.3 && rnd() < 0.9 ? 1 : 0;
      }
      const churnAt = (t) => Math.exp(-(((t.x - mid(t.y)) / 11) ** 2));
      // ---- saps: both sides have pushed saps out into no man's land, long and short, branching, linked
      // to one another, the two networks winding in among each other (never quite touching)
      const sapTiles = [];
      const foeNear = (x, y, team) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = at(x + dx, y + dy); if (n && n.trench && n.owner !== team && n.owner >= 0) return true; } return false; };
      const digSap = (x, y, team) => {
        const t = at(x, y);
        if (!t || t.off || foeNear(x, y, team)) return false;
        if (t.trench) return t.owner === team;
        if (makesSquare(map, x, y)) return false;
        t.trench = 1; t.owner = t.origOwner = team; t.wire = 0; t.mud = 0; t.ground = 0; t.crater = 0; t.decor = null;
        sapTiles.push(t);
        return true;
      };
      // grow a sap forward from (x, y): a run of a tile or two, then a jog; it may fork sideways
      const grow = (team, x, y, len, depth) => {
        const dir = teamDir(team);
        for (let n = 0; n < len; n++) {
          const run = 1 + Math.floor(rnd() * 2);
          for (let k = 0; k < run; k++) { if (!digSap(x + dir, y, team)) return; x += dir; }
          if (rnd() < 0.55) { const j = rnd() < 0.5 ? -1 : 1; if (digSap(x, y + j, team)) y += j; }
          if (depth < 2 && rnd() < 0.22) { // a branch: off to one side, then on forward (it often meets the next sap)
            let bx = x, by = y;
            const j = rnd() < 0.5 ? -1 : 1, side = 2 + Math.floor(rnd() * 4);
            for (let k = 0; k < side; k++) { if (!digSap(bx, by + j, team)) break; by += j; if (rnd() < 0.3 && digSap(bx + dir, by, team)) bx += dir; }
            grow(team, bx, by, 1 + Math.floor(rnd() * 4), depth + 1);
          }
        }
      };
      const starts = [];
      for (const team of [PLAYER, ENEMY]) {
        const fl = team === PLAYER ? f : ef;
        for (let y = M - 40 + Math.floor(rnd() * 4); y <= M + 40; y += 3 + Math.floor(rnd() * 5)) if (fl[y] >= 0) starts.push({ team, x: fl[y], y, len: rnd() < 0.45 ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 8) });
      }
      for (let k = starts.length - 1; k > 0; k--) { const q = Math.floor(rnd() * (k + 1)); [starts[k], starts[q]] = [starts[q], starts[k]]; } // the two sides dug at the same time
      for (const st of starts) grow(st.team, st.x, st.y, st.len, 0);
      // wire strung out in no man's land round the saps: short ragged belts and lone coils, each side's in
      // front of its own saps
      for (const t of sapTiles) {
        if (rnd() > 0.16) continue;
        const team = t.owner, dir = teamDir(team);
        let x = t.x + dir * (1 + Math.floor(rnd() * 2)), y = t.y + Math.floor(rnd() * 3) - 1;
        const len = 1 + Math.floor(rnd() * 4), j = rnd() < 0.5 ? -1 : 1;
        for (let k = 0; k < len; k++) {
          const q = at(x, y);
          if (q && !q.off && !q.trench && !q.wire && !q.decor) { q.wire = rnd() < 0.3 ? 50 : 100; q.origWire = team; q.ground = 0; }
          y += j; if (rnd() < 0.35) x += rnd() < 0.5 ? -1 : 1;
        }
      }
      for (let k = 0; k < 40; k++) { // and odd coils lying about further out
        const t = map.tiles[Math.floor(rnd() * map.tiles.length)];
        if (!t.off && !t.trench && !t.wire && churnAt(t) > 0.5) { t.wire = 50; t.origWire = rnd() < 0.5 ? PLAYER : ENEMY; t.ground = 0; }
      }
      // weeks of shelling: stretches of the saps blown in (a shell hole where the trench was) and others
      // knocked about, half fallen in
      for (const t of sapTiles) {
        if (!t.trench) continue;
        const r = rnd();
        if (r < 0.1) { // a breach, a tile or two long
          for (const q of [t, ...(rnd() < 0.5 ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => at(t.x + dx, t.y + dy)).filter((n) => n && n.trench && sapTiles.includes(n)).slice(0, 1) : [])]) {
            q.trench = 0; q.owner = q.origOwner = -1; q.crater = 2 + Math.floor(rnd() * 2); q.mud = 1;
          }
        } else if (r < 0.27) t.dmg = 30 + Math.floor(rnd() * 60); // damaged or wrecked
      }
      noSquares(map);
      // ---- the armies: riflemen against riflemen; few machine guns, few guns. Laid out along the whole front
      state.units = [];
      const f2 = f, ef2 = ef; // (the lines as dug, before the saps)
      const trenchNear = (team, x0, y0) => { let best = null, bd = Infinity; for (let y = y0 - 2; y <= y0 + 2; y++) for (let x = x0 - 4; x <= x0 + 4; x++) { const t = at(x, y); if (t && t.trench && t.owner === team && !state.units.some((u) => Math.floor(u.x) === x && Math.floor(u.y) === y)) { const dd = Math.abs(x - x0) + Math.abs(y - y0); if (dd < bd) { bd = dd; best = t; } } } return best; };
      const put = (type, team, t) => { if (!t) return null; const u = spawnUnit(state, type, team, t.x + 0.5, t.y + 0.5); u.inTrench = !!t.trench; return u; };
      for (let dy = -33; dy <= 33; dy += 3) if (f[M + dy] >= 0) put('rifle', PLAYER, trenchNear(PLAYER, f[M + dy], M + dy)); // the front line, ready to go over
      for (const dy of [-18, -6, 6, 18]) if (f2[M + dy] >= 0) put('rifle', PLAYER, trenchNear(PLAYER, f2[M + dy] - d * 7, M + dy)); // support
      if (f2[M] >= 0) put('mg', PLAYER, trenchNear(PLAYER, f2[M - 2], M - 2));
      for (const dy of [-10, 10]) put('artillery', PLAYER, at(f2[M + dy] - d * 9, M + dy));
      for (let dy = -30; dy <= 30; dy += 4) if (ef2[M + dy] >= 0) put('rifle', ENEMY, trenchNear(ENEMY, ef2[M + dy], M + dy)); // plenty of infantry
      for (const dy of [-14, 0, 14]) if (ef2[M + dy] >= 0) put('rifle', ENEMY, trenchNear(ENEMY, ef2[M + dy] + d * 7, M + dy));
      if (ef2[M + 3] >= 0) put('mg', ENEMY, trenchNear(ENEMY, ef2[M + 3], M + 3)); // and a single machine gun
      put('artillery', ENEMY, at(ef2[M] + d * 10, M));
      // ---- birch woods: white birches in groves and lines along the field edges, mostly behind the lines
      for (let k = 0; k < 34; k++) { // (two in three of the groves on our side, behind the Russian line)
        const cx = k % 3 < 2 ? Math.floor(rnd() * (W / 2 - 4)) : Math.floor(rnd() * W), cy = Math.floor(rnd() * map.h), rr = 1.5 + rnd() * 3.5;
        for (const t of map.tiles) {
          if (t.off || t.trench || t.wire || t.decor || t.ground === 4 || t.mud || churnAt(t) > 0.3) continue;
          const dd = Math.hypot(t.x - cx, (t.y - cy) * 1.2);
          if (dd < rr && rnd() < 0.55 * (1 - dd / rr) + 0.15) t.decor = 'birch';
        }
      }
      for (const t of map.tiles) if (!t.off && !t.trench && !t.wire && !t.decor && t.ground !== 4 && !t.mud && churnAt(t) < 0.3 && rnd() < ((t.x - W / 2) * d < 0 ? 0.04 : 0.012)) t.decor = 'birch'; // scattered birches, many more on our side
      // ---- three headquarters: the centre one and one on each flank, behind the support line
      const hq = map.hq[ENEMY];
      hq.posts = [];
      for (const dy of [-20, 20]) {
        const y = M + dy;
        const t = trenchNear(ENEMY, ef2[y] + d * 9, y) || trenchNear(ENEMY, ef2[y] + d * 6, y);
        if (!t) continue;
        t.trench = 3;
        hq.posts.push({ x: t.x, y: t.y });
      }
      map.dirty = true;
      state.resources[PLAYER] = { men: 40, ammo: 260, supplies: 160 };
      state.resources[ENEMY] = { men: 12, ammo: 120, supplies: 60 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 1200, attackGap: [600, 800], income: 0.6 };
      ai.offensive = 1200;
      state.campaign.efront = (() => { const out = []; ef.forEach((x, y) => { if (x >= 0) out.push(y * W + x); }); return out; })();
    },
    events: [
      { at: 4.1, run: (s) => pushMessage(s, 'Break the enemy line and press on: three headquarters must fall before his reserves come up.', 'side') },
      { at: 16, run: (s) => pushMessage(s, 'Air reconnaissance: Austrian reserves are coming up by rail. They will reach the line this evening.', 'warn') },
      { at: 20, run: (s) => { reinforce(s, ENEMY, 5); pushMessage(s, 'Austrian reserves have reached their line.', 'warn'); } },
      { at: 24 + 4, run: (s) => pushMessage(s, 'Day 2. More reserves are on the way, German divisions among them.', 'side') },
      { at: 24 + 20, run: (s) => { reinforce(s, ENEMY, 6); pushMessage(s, 'Fresh enemy reserves have reached their line.', 'warn'); } },
      { at: 48 + 4, run: (s) => pushMessage(s, 'Day 3. The breakthrough must be made today.', 'side') },
    ],
    check(state) {
      if (clockHours(state) >= 72) return { result: 'lost', reason: 'Three days have passed and the enemy line still holds.' };
      return null;
    },
    // after the opening the camera points out the three headquarters (main.js)
    tour(state) {
      const hq = state.map.hq[ENEMY];
      return [hq.posts[0], hq, hq.posts[1]].filter(Boolean).map((q, i) => ({ x: q.x + 0.5, y: q.y + 0.5, label: ['Northern HQ', 'Central HQ', 'Southern HQ'][i] }));
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const held = c.efront.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      const next = h < 20 ? `Enemy reserves arrive in ${left(20 - h)}` : h < 44 ? `More enemy reserves in ${left(44 - h)}` : 'All enemy reserves have arrived';
      const hq = state.map.hq[ENEMY], posts = [hq, ...(hq.posts || [])];
      const taken = posts.filter((q) => tileAt(state.map, q.x, q.y).owner === PLAYER).length;
      return [
        'Take the three enemy headquarters',
        `Headquarters taken: ${taken} / ${posts.length}`,
        next,
        `Enemy front line taken: ${held} / ${c.efront.length}`,
        `Time left: ${left(Math.max(0, 72 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      const held = c.efront.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      return [won, won && c.endHour < 44, won && held >= c.efront.length / 2];
    },
  },
  {
    id: 'chunuk', n: 4, title: 'Dawn on Chunuk Bair', place: 'Gallipoli', date: 'August 1915',
    nations: ['ottoman', 'uk'], season: 'mud', start: 'west', startHour: 4.5,
    history: 'August 1915. In a night attack the British and New Zealanders have climbed the ridge of Chunuk Bair and seized the heights at the centre of your line. From there they can look down on the Dardanelles: if they hold it, the whole peninsula is lost. Lieutenant-Colonel Mustafa Kemal has ordered a counter-attack at first light. Every hour you wait, the enemy digs deeper and strings more wire. Take back every yard before dusk.',
    objectives: ['Retake every section of your front line the enemy has seized.', 'Do it before dusk on day 1 (19:30).', 'Do not let the enemy take your headquarters.'],
    rules: ['The enemy holds the centre of your front line with infantry and a machine gun.', 'Every hour he holds it he digs in deeper and wires it more thickly, and fresh men come up to him.', 'Your men may attack at once: the sooner, the cheaper.'],
    medals: ['The heights retaken', 'At first light: every section retaken before 10:00', 'Fewer than 300 men lost'],
    debrief: {
      won: 'At dawn on 10 August 1915 Mustafa Kemal led the counter-attack in person and swept the British off Chunuk Bair. It was the turning point of the August offensive: the Allies never came so close again, and four months later they left Gallipoli. Kemal went on to found modern Turkey.',
      lost: 'The enemy held the heights through the day. At Gallipoli the Ottoman line on Chunuk Bair was in fact retaken, at dawn on 10 August, by a counter-attack led from the front; without it, the campaign might have ended very differently.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2);
      const front = frontTiles(state);
      // the enemy has the centre of our front line: every front-line section within 6 rows of the middle
      const lost = front.filter((i) => Math.abs(Math.floor(i / W) - M) <= 6);
      for (const i of lost) map.tiles[i].owner = ENEMY;
      // our men who held it are gone; the enemy's are in it
      const inLost = (u) => lost.some((i) => Math.hypot(u.x - ((i % W) + 0.5), u.y - (Math.floor(i / W) + 0.5)) < 1.2);
      state.units = state.units.filter((u) => !(u.team === PLAYER && inLost(u)));
      const at = (i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
      lost.forEach((i, k) => {
        if (k % 3 !== 1) return;
        const p = at(i), g = spawnUnit(state, k === Math.floor(lost.length / 2) || k === Math.floor(lost.length / 2) + 1 ? 'mg' : 'rifle', ENEMY, p.x, p.y);
        g.ai.role = 'garrison';
      });
      const mid = at(lost[Math.floor(lost.length / 2)]);
      if (!state.units.some((u) => u.team === ENEMY && u.type === 'mg' && u.ai.role === 'garrison')) spawnUnit(state, 'mg', ENEMY, mid.x, mid.y).ai.role = 'garrison';
      map.dirty = true;
      // a strong reserve of our own behind the line, ready to go in
      reinforce(state, PLAYER, 4);
      state.resources[PLAYER] = { men: 30, ammo: 360, supplies: 120 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 1500, attackGap: [600, 800] };
      ai.offensive = 1500;
      state.campaign.lost = lost;
      state.campaign.dug = 0;
    },
    events: [
      { at: 4.6, run: (s) => pushMessage(s, 'The enemy holds the heights in the centre of our line. Counter-attack at once!', 'side') },
      // every hour the enemy holds on he digs in, wires himself in, and is reinforced
      ...[5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5].map((at, k) => ({ at, run: (s) => {
        const { map } = s, c = s.campaign, d = teamDir(PLAYER);
        let any = false;
        for (const i of c.lost) {
          const t = map.tiles[i];
          if (t.owner !== ENEMY) continue;
          any = true;
          if (k % 2 === 1) t.trench = Math.min(3, t.trench + 1); // sandbags, then concrete
          for (const back of [1, 2]) { // wire on our side of the captured trench
            const w = map.tiles[i - d * back];
            if (w && !w.off && !w.trench && Math.random() < 0.35 + k * 0.05) { w.wire = 100; w.origWire = ENEMY; }
          }
        }
        if (!any) return;
        map.dirty = true; c.dug++;
        if (k % 3 === 2) {
          const q = c.lost.map((i) => map.tiles[i]).find((t) => t.owner === ENEMY);
          for (const u of reinforce(s, ENEMY, 2)) { orderMove(s, [u], q.x + 0.5, q.y + 0.5); u.ai.role = 'garrison'; }
          pushMessage(s, 'The enemy is digging in deeper, and fresh men are coming up to him.', 'warn');
        } else pushMessage(s, 'The enemy is wiring and sandbagging the captured trenches.', 'warn');
      } })),
    ],
    check(state) {
      const c = state.campaign;
      const left2 = c.lost.filter((i) => state.map.tiles[i].owner !== PLAYER).length;
      if (!left2) {
        c.doneAt = c.doneAt ?? clockHours(state);
        if (!c.cheered) { c.cheered = true; pushMessage(state, 'Every yard of the heights is ours again!', 'good'); state.events.push({ type: 'cheer' }); }
        c.wonAt = c.wonAt ?? state.time;
        if (state.time - c.wonAt > 4) return { result: 'won', reason: 'The heights are retaken.' };
        return null;
      }
      if (clockHours(state) >= 19.5) return { result: 'lost', reason: 'Dusk fell with the enemy still on the heights.' };
      return null;
    },
    markers(state) {
      const c = state.campaign, W = state.map.w;
      const held = c.lost.filter((i) => state.map.tiles[i].owner !== PLAYER);
      // one marker for every few enemy-held sections, so the line reads clearly without a ring on every tile
      return held.filter((_, k) => k % 4 === 0).map((i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, label: 'Retake' }));
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const back = c.lost.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      return [
        'Retake the heights',
        `Sections retaken: ${back} / ${c.lost.length}`,
        h < 18.5 ? `The enemy digs in deeper in ${left(Math.max(0, Math.floor(h - 0.5) + 1.5 - h))}` : 'The enemy is dug in',
        `Dusk in ${left(Math.max(0, 19.5 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.doneAt < 10, won && state.stats.lost[PLAYER] < 300];
    },
  },
  {
    id: 'amiens', n: 5, title: 'The Black Day', place: 'Amiens, France', date: 'August 1918',
    nations: ['usa', 'germany'], allies: ['uk'], season: 'mud', start: 'west', startHour: 4.33,
    history: 'August 1918. Four years of war have taught the Allied armies how to win. At 04:20, in thick fog, more than two thousand guns open fire at once, with no warning bombardment, and the infantry go forward close behind the barrage. American and British divisions stand side by side. The German line is deep, three trench lines bristling with machine guns, and he will counter-attack whatever you take. But this time you have the guns, the shells and the men. Break all three lines and take his headquarters before the day is out.',
    objectives: ['Break all three enemy trench lines.', 'Take the enemy headquarters before midnight.', 'Do not let the enemy take your headquarters.'],
    rules: ['You have six batteries, plenty of shells and a large army, Americans and British together.', 'The enemy defends in depth: machine guns in every line, not just the front.', 'Every few hours his reserves counter-attack whatever you have just taken.', 'A long summer day: the clock runs slower than in other battles. His wire is mostly crushed and his divisions are understrength.'],
    medals: ['The Black Day of the German army', 'By noon: the enemy headquarters taken before 12:00', 'Fewer than 500 men lost'],
    debrief: {
      won: 'On 8 August 1918 the Allied armies advanced eight miles in a single day, and whole German units surrendered. General Ludendorff called it "the black day of the German army". It began the Hundred Days Offensive, and three months later the war was over.',
      lost: 'The German line held its depth until nightfall. In August 1918 it did not: the Allied attack at Amiens broke through in a single day. It was the beginning of the end of the war.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2);
      state.resources[PLAYER] = { men: 60, ammo: 900, supplies: 240 };
      state.playerIncome = 1.3;
      // the army: Americans and British side by side, and six batteries
      const brits = reinforce(state, PLAYER, 6);
      brits.forEach((u, i) => { if (i % 2 === 0) u.nation = 'uk'; });
      state.units.filter((u) => u.team === PLAYER && u.type !== 'artillery').forEach((u, i) => { if (i % 3 === 0) u.nation = 'uk'; });
      const d = teamDir(PLAYER), f = frontLine(map, PLAYER);
      for (const dy of [-14, -4, 4, 14]) { const g = spawnUnit(state, 'artillery', PLAYER, f[M + dy] - d * 5 + 0.5, M + dy + 0.5); if (dy > 0) g.nation = 'uk'; }
      // defence in depth: machine guns in his support and reserve lines too
      const e = teamDir(ENEMY), ef = frontLine(map, ENEMY);
      const lineTiles = (off) => {
        const out = [];
        for (let y = 0; y < map.h; y++) {
          if (ef[y] < 0) continue;
          for (const dx of [-1, 0, 1]) {
            const x = ef[y] - e * off + dx, t = map.tiles[y * W + x];
            if (t && !t.off && t.trench && t.origOwner === ENEMY && !out.includes(y * W + x)) out.push(y * W + x);
          }
        }
        return out;
      };
      const lines = [lineTiles(0), lineTiles(7), lineTiles(11)];
      for (const [off, rows] of [[7, [0]], [11, [0]]]) {
        for (const dy of rows) {
          const y = M + dy, x = ef[y] >= 0 ? ef[y] - e * off : -1;
          const t = x >= 0 && map.tiles[y * W + x];
          if (t && t.trench) { const g = spawnUnit(state, 'mg', ENEMY, x + 0.5, y + 0.5); g.ai.role = 'garrison'; }
        }
      }
      // 1918: his divisions are understrength (half his rifle squads gone), and the tanks have
      // crushed most of his wire
      const rifles = state.units.filter((u) => u.team === ENEMY && u.type === 'rifle');
      const gone = new Set(rifles.filter((_, i) => i % 2 === 1).map((u) => u.id));
      state.units = state.units.filter((u) => !gone.has(u.id));
      let k = 0;
      for (const t of map.tiles) if (t.wire && t.origWire === ENEMY && k++ % 4) t.wire = 0;
      map.dirty = true;
      // one long summer day: the clock runs at a third of its usual speed
      state.dayLength = DAY_LENGTH * 3;
      state.resources[ENEMY] = { men: 20, ammo: 400, supplies: 100 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 3600, attackGap: [1200, 1500], income: 0.5 };
      ai.offensive = 3600;
      state.campaign.lines = lines;
    },
    events: [
      { at: 4.4, run: (s) => pushMessage(s, 'Zero hour. The guns are firing on every line: go in behind the barrage.', 'side') },
      ...[8, 11, 14, 17, 20].map((at) => ({ at, run: (s) => {
        // a counter-attack on the ground we took most recently: the enemy-side-most trench we hold that was his
        const { map } = s;
        let best = null;
        for (const t of map.tiles) if (t.trench && t.origOwner === ENEMY && t.owner === PLAYER && (!best || (teamDir(ENEMY) < 0 ? t.x > best.x : t.x < best.x))) best = t;
        const units = reinforce(s, ENEMY, 3);
        if (best) { orderMove(s, units, best.x + 0.5, best.y + 0.5, 'charge'); pushMessage(s, 'German reserves are counter-attacking the trenches we have taken!', 'warn'); }
        else pushMessage(s, 'German reserves have come up into their line.', 'warn');
      } })),
    ],
    check(state) {
      if (clockHours(state) >= 24) return { result: 'lost', reason: 'Midnight came with the enemy headquarters still in his hands.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const names = ['Front line', 'Support line', 'Reserve line'];
      return [
        'Break through and take the enemy HQ',
        ...c.lines.map((L2, k) => { const n = L2.filter((i) => state.map.tiles[i].owner === PLAYER).length; return `${names[k]}: ${n >= L2.length / 2 ? 'broken' : 'holding'} (${n} / ${L2.length} taken)`; }),
        `Midnight in ${left(Math.max(0, 24 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.endHour < 12, won && state.stats.lost[PLAYER] < 500];
    },
  },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id);

/** The prologue: the tutorial, briefed like a campaign battle (it is played by tutorial.js). */
export const PROLOGUE = {
  id: 'prologue', title: 'Over the Top', place: 'The Somme, France', date: '1 July 1916', nations: ['uk', 'germany'],
  history: 'Before dawn on 1 July 1916, the first day of the Battle of the Somme. For a week the British guns have shelled the German line without pause, and the men in the trenches have been told that nothing could live through it. Two privates of the same company, Hale and Archer, wait in the front line for the whistle. This is where you learn your trade: how to bombard, how to go over the top, and what a machine gun does to men in the open.',
  objectives: ['Follow the orders as they come.', 'Bring your battery to bear on the enemy trench.', 'Lead the company over the top and across no man\'s land.'],
  rules: ['The battle waits for your orders: take your time.', 'Highlighted buttons and markers show what to do next.', 'Some lessons of the Somme can only be learned the hard way.'],
};

/** A new battle for a campaign level. */
export function createLevelGame(id, opts = {}) {
  const L = levelById(id);
  const state = createGame({ seed: opts.seed ?? 1915 + L.n, season: L.season, nations: L.nations, start: L.start, difficulty: 'hard', aiTeams: opts.aiTeams, advance: L.advance, works: L.works, radius: L.radius });
  state.startHour = L.startHour;
  state.campaign = { id, fired: [], result: null, reason: '' };
  L.setup(state);
  return state;
}

/**
 * Run a campaign level: timed events, then its win / loss check. A result ends the battle (it sets
 * state.winner); the HQ falling or the army breaking end it too, through the ordinary rules.
 */
export function stepCampaign(state) {
  const c = state.campaign;
  if (!c || c.result) return;
  const L = levelById(c.id);
  if (state.winner >= 0) { // the ordinary rules ended it
    c.endHour = clockHours(state);
    c.result = state.winner === PLAYER ? 'won' : 'lost';
    c.reason = c.reason || (state.winner === PLAYER ? (tileAt(state.map, state.map.hq[ENEMY].x, state.map.hq[ENEMY].y).owner === PLAYER ? 'The enemy headquarters has fallen.' : 'The enemy is broken.') : 'Our headquarters has fallen.');
    return;
  }
  const h = clockHours(state);
  L.events.forEach((e, i) => { if (h >= e.at && !c.fired.includes(i)) { c.fired.push(i); e.run(state); } });
  if (L.markers) state.markers = L.markers(state);
  const r = L.check(state);
  if (r) { c.result = r.result; c.reason = r.reason; state.winner = r.result === 'won' ? PLAYER : ENEMY; }
}

// ------------------------------------------------------------------ progress (the browser keeps it)
const KEY = 'ww-campaign';
/** { unlocked: highest open level, medals: { id: best }, tutorial: prologue done }. */
export function loadProgress() {
  let p;
  try { p = JSON.parse(localStorage.getItem(KEY)); } catch {}
  p = p || { unlocked: 1, medals: {} };
  if (p.tutorial === undefined) p.tutorial = p.unlocked > 1 || Object.keys(p.medals).length > 0; // players from before the prologue keep their access
  return p;
}
/** The prologue (tutorial) is done: battle 1 opens. */
export function markTutorialDone() {
  const p = loadProgress();
  p.tutorial = true;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}
/** Record a finished level: medals (best kept) and the next level unlocked on a win. */
export function recordResult(state) {
  const c = state.campaign, L = levelById(c.id), p = loadProgress();
  const medals = L.medalsEarned(state);
  const got = medals.filter(Boolean).length;
  p.medals[c.id] = Math.max(p.medals[c.id] || 0, got);
  if (c.result === 'won') p.unlocked = Math.max(p.unlocked, L.n + 1);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  return medals;
}
