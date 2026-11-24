// Campaign mode: five levels, each a battle with its own setup, objectives, timed events and medals.
// DOM-free (driven from main.js, and headlessly from the tests). A level's progress lives in
// state.campaign as plain data, so a campaign battle saves and loads like any other.
import { PLAYER, ENEMY, DIFFICULTY } from './config.js';
import { createGame, spawnUnit, pushMessage, orderMove, orderBarrage } from './game.js';
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
 * V Beach: the first wave comes out of the River Clyde. The moment the warships' first salvo has fallen her sally
 * ports open and twelve squads pour out onto the sand either side of her bow, two at a time, with two machine-gun
 * teams that set up at the bow; each squad charges our machine guns as soon as it is out (firstWaveCharge).
 */
function firstWaveFromClyde(s) {
  const fw = s.campaign.firstWave ||= { ids: [], mgs: [], at: s.time };
  fw.toCome = 12; fw.mgToCome = 2; fw.next = s.time;
  pushMessage(s, 'The River Clyde\'s sally ports are open - her men are pouring out onto the beach!', 'warn');
}
/** Her men out onto the sand: the tiles of beach beside her bow (found once). */
function clydeExits(s) {
  const c = s.campaign;
  if (c.clydeExits) return c.clydeExits;
  const { map } = s, W = map.w, d = teamDir(PLAYER), b = s.buildings && s.buildings[0], out = [];
  if (b) {
    const tip = Math.floor(b.x - d * b.hx);
    for (const y of [Math.floor(b.y) - 2, Math.floor(b.y) + 2, Math.floor(b.y) - 3, Math.floor(b.y) + 3]) {
      for (let x = tip + d * 3, k = 0; k < 10; k++, x -= d) { const t = map.tiles[y * W + x]; if (t && !t.off && !t.sea && !t.rock && !t.block) { out.push(t); break; } }
    }
  }
  return (c.clydeExits = out);
}
function firstWavePour(s) {
  const fw = s.campaign.firstWave;
  if (!fw || !(fw.toCome > 0 || fw.mgToCome > 0) || s.time < fw.next) return;
  fw.next = s.time + 1.2;
  const exits = clydeExits(s);
  if (!exits.length) { fw.toCome = fw.mgToCome = 0; return; }
  for (let k = 0; k < 2 && fw.toCome > 0; k++) {
    const t = exits[(fw.toCome + k) % exits.length];
    const u = spawnUnit(s, 'rifle', ENEMY, t.x + 0.3 + Math.random() * 0.4, t.y + 0.3 + Math.random() * 0.4);
    u.ai.role = 'wave'; fw.ids.push(u.id); fw.toCome--;
  }
  if (fw.mgToCome > 0 && fw.toCome <= 6) { // (the machine guns come out halfway through, and set up by her bow)
    const t = exits[fw.mgToCome % exits.length];
    const g = spawnUnit(s, 'mg', ENEMY, t.x + 0.5, t.y + 0.5);
    g.ai.role = 'hold'; fw.mgs.push(g.id); fw.mgToCome--;
  }
}
/** The first wave's riflemen: whoever is not on the move charges the nearest of our machine guns (our riflemen once they are gone). */
function firstWaveCharge(state) {
  const fw = state.campaign.firstWave;
  if (!fw || state.time - (fw.tick || 0) < 1) return;
  fw.tick = state.time;
  const ours = state.units.filter((u) => u.team === PLAYER && !u.dead && u.type !== 'artillery');
  const guns = ours.filter((u) => u.type === 'mg');
  for (const id of fw.ids) {
    const u = state.units.find((q) => q.id === id);
    if (!u || u.dead || u.order) continue;
    const pool = guns.length ? guns : ours;
    if (!pool.length) continue;
    const tgt = pool.reduce((a, b) => (Math.hypot(b.x - u.x, b.y - u.y) < Math.hypot(a.x - u.x, a.y - u.y) ? b : a));
    if (Math.hypot(tgt.x - u.x, tgt.y - u.y) < 0.6) continue; // (on top of it: fighting it out hand to hand)
    orderMove(state, [u], tgt.x, tgt.y, 'charge');
  }
  if (!fw.announced) { fw.announced = true; pushMessage(state, 'The first wave is charging our machine guns!', 'warn'); }
}

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
    pictures: ['assets/art/church-galicia.webp', 'assets/art/story-galicia.webp', 'assets/art/scene-galicia-hq.webp', 'assets/art/scene-galicia-hq-lost.webp', 'assets/art/story-ivanov.webp', 'assets/art/story-sokolov.webp'],
    // the opening scene, like the tutorial's: two Russian soldiers in their trench before the bombardment
    opening: [
      { who: 'Galicia — June 4, 1916', text: 'Before dawn. Two Russian soldiers wait in a trench.', img: 'assets/art/story-galicia.webp', wide: true, hold: 2.5 },
      { who: 'Ivanov', text: 'Vodka? The priest blessed it.', img: 'assets/art/story-ivanov.webp' },
      { who: 'Sokolov', text: 'He blessed the men, you fool. Not the bottle.', img: 'assets/art/story-sokolov.webp' },
      { who: 'Ivanov', text: 'My wife says vodka will kill me.', img: 'assets/art/story-ivanov.webp' },
      { who: 'Sokolov', text: 'My wife says the same. That\'s why I joined the army.', img: 'assets/art/story-sokolov.webp' },
      { who: '', text: 'Ivanov rubs tar onto his leaking boots.', img: 'assets/art/story-ivanov.webp' },
      { who: 'Ivanov', text: 'Think God will protect us?', img: 'assets/art/story-ivanov.webp' },
      { who: 'Sokolov', text: 'He didn\'t protect the last lot. But you\'re welcome to ask.', img: 'assets/art/story-sokolov.webp' },
      { who: '', text: 'Russian artillery opens fire.', img: 'assets/art/story-galicia.webp', wide: true, sound: 'artyfire', hold: 1.6 },
    ],
    // ...the short, sharp bombardment begins
    openingEnd(state) {
      for (let k = 0; k < 4; k++) state.events.push({ type: 'artyfire' });
      pushMessage(state, 'The Russian guns open fire. The offensive begins.', 'warn');
    },
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
      for (let dy = -33; dy <= 33; dy += 3) if (ef2[M + dy] >= 0) put('rifle', ENEMY, trenchNear(ENEMY, ef2[M + dy], M + dy)); // plenty of infantry, all along the line
      for (const dy of [-24, -14, -6, 0, 6, 14, 24]) if (ef2[M + dy] >= 0) put('rifle', ENEMY, trenchNear(ENEMY, ef2[M + dy] + d * 7, M + dy)); // and behind it in the support line
      for (const dy of [-18, 3, 20]) if (ef2[M + dy] >= 0) put('mg', ENEMY, trenchNear(ENEMY, ef2[M + dy], M + dy)); // and only a few machine guns
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
      map.forest = true; // the wind comes and goes through the woods (atmosphere.js)
      // ---- a birch forest behind the Russian line: thick in places, thinning into clearings and copses
      // towards the trenches; trees of every age
      const busy = new Set(state.units.map((u) => Math.floor(u.y) * W + Math.floor(u.x)));
      for (const t of map.tiles) {
        if (t.off || t.trench || t.wire || t.decor || busy.has(t.y * W + t.x) || f[t.y] < 0) continue;
        const behind = (f[t.y] - t.x) * d; // tiles behind our front line
        if (behind < 3) continue;
        const dense = noise(2, t.x + 17, t.y + 5, 0.21) + Math.min(0.35, (behind - 3) * 0.04) - (t.ground === 4 ? 0.25 : 0);
        if (rnd() < (dense > 0.62 ? 0.8 : dense > 0.48 ? 0.35 : 0.08)) { t.decor = 'birch'; t.mud = 0; }
      }
      // ---- three headquarters: the centre one and one on each flank, behind the support line
      const hq = map.hq[ENEMY];
      hq.posts = []; hq.byLevel = true; // (the level's check decides the win, after the last picture)
      for (const dy of [-20, 20]) {
        const y = M + dy;
        const t = trenchNear(ENEMY, ef2[y] + d * 9, y) || trenchNear(ENEMY, ef2[y] + d * 6, y);
        if (!t) continue;
        t.trench = 3;
        hq.posts.push({ x: t.x, y: t.y });
      }
      // ---- the village church, standing alone in no man's land between the lines (from its 3D model)
      { const ch = { img: 'assets/art/church-galicia.webp', ax: 219, ay: 388, k: 0.5, x: Math.round((f[M - 16] + ef[M - 16]) / 2) + 0.5, y: M - 16 + 0.5, hx: 2.2, hy: 2.8, name: 'The church' }; // (out in no man's land, between the lines: all that is left of a village)
        state.buildings = [ch]; state.buildingsAll = [ch]; blockBuilding(state, ch); delete state.buildingsAll; }
      map.dirty = true;
      state.resources[PLAYER] = { men: 40, ammo: 260, supplies: 160 };
      state.resources[ENEMY] = { men: 30, ammo: 320, supplies: 120 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.hard, firstAttack: 600, attackGap: [300, 420], income: 1 }; // (he counter-attacks what he loses, and attacks himself)
      ai.offensive = 600;
      state.campaign.efront = (() => { const out = []; ef.forEach((x, y) => { if (x >= 0) out.push(y * W + x); }); return out; })();
    },
    events: [
      { at: 4.1, run: (s) => pushMessage(s, 'Break the enemy line and press on: three headquarters must fall before his reserves come up.', 'side') },
      { at: 16, run: (s) => pushMessage(s, 'Air reconnaissance: Austrian reserves are coming up by rail. They will reach the line this evening.', 'warn') },
      { at: 20, run: (s) => { reinforce(s, ENEMY, 8); pushMessage(s, 'Austrian reserves have reached their line.', 'warn'); } },
      { at: 24 + 4, run: (s) => pushMessage(s, 'Day 2. More reserves are on the way, German divisions among them.', 'side') },
      { at: 24 + 20, run: (s) => { reinforce(s, ENEMY, 10); pushMessage(s, 'Fresh enemy reserves have reached their line.', 'warn'); } },
      { at: 48 + 4, run: (s) => pushMessage(s, 'Day 3. The breakthrough must be made today.', 'side') },
    ],
    check(state) {
      // each headquarters taken: a picture of the moment with the announcement; the battle is won (by this
      // check, not the ordinary rule, so the last picture is seen) a few seconds after the third falls
      const c = state.campaign, hq = state.map.hq[ENEMY], posts = [hq, ...(hq.posts || [])];
      c.taken = c.taken || [];
      c.held = c.held || posts.map(() => false);
      const held = posts.map((q) => tileAt(state.map, q.x, q.y).owner === PLAYER);
      held.forEach((h, i) => {
        if (h === c.held[i]) return;
        c.held[i] = h;
        const n = held.filter(Boolean).length, name = ['central', 'northern', 'southern'][i];
        if (h) { // taken (or taken back)
          if (!c.taken.includes(i)) c.taken.push(i);
          const text = n < posts.length ? `The ${name} Austrian headquarters is ours! ${posts.length - n} still to take.` : 'The last Austrian headquarters has fallen! The line is broken.';
          pushMessage(state, text, 'good');
          c.scene = { at: state.time, img: 'assets/art/scene-galicia-hq.webp', who: 'Galicia, June 1916', text };
          state.events.push({ type: 'cheer' });
        } else { // lost again to a counter-attack
          const text = `The Austrians have retaken the ${name} headquarters!`;
          pushMessage(state, text, 'loss');
          c.scene = { at: state.time, img: 'assets/art/scene-galicia-hq-lost.webp', who: 'Galicia, June 1916', text };
        }
      });
      if (held.every(Boolean)) {
        c.wonAt = c.wonAt ?? state.time;
        if (state.time - c.wonAt > 9) return { result: 'won', reason: 'All three enemy headquarters have fallen.' };
        return null;
      }
      c.wonAt = undefined;
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
    id: 'helles', n: 4, title: 'The Beach at Sedd el Bahr', place: 'Cape Helles, Gallipoli', date: '25 April 1915',
    nations: ['ottoman', 'uk'], season: 'summer', start: 'west', startHour: 5.5,
    advance: { [PLAYER]: 4 }, // our trenches on the slopes, well back above a wide beach
    pictures: ['assets/art/story-helles-fleet.webp', 'assets/art/story-helles-clyde.webp', 'assets/art/story-mehmet.webp', 'assets/art/story-hasan.webp'],
    // the opening scene: two Ottoman soldiers above the beach watch the British fleet come in
    opening: [
      { who: 'V Beach, Gallipoli — April 25, 1915', text: 'Before dawn. From the cliffs above the beach, two Ottoman soldiers watch the British fleet coming in out of the mist.', img: 'assets/art/story-helles-fleet.webp', wide: true, hold: 3 },
      { who: 'Mehmet', text: 'Sergeant, why are the British coming here?', img: 'assets/art/story-mehmet.webp' },
      { who: 'Sergeant Hasan', text: 'To take Constantinople.', img: 'assets/art/story-hasan.webp' },
      { who: 'Mehmet', text: 'May Allah help us. There are so many ships.', img: 'assets/art/story-mehmet.webp' },
      { who: 'Hasan', text: 'Allah helps those who load their rifles.', img: 'assets/art/story-hasan.webp' },
      { who: '', text: 'One ship leaves the others and comes on alone, straight for the shore.' }, // (on the map: the River Clyde steams in from beyond its edge - openingScene)
      { who: 'Mehmet', text: 'That ship is heading straight for the beach.', img: 'assets/art/story-mehmet.webp' },
      { who: 'Hasan', text: 'Perhaps the captain has been drinking.', img: 'assets/art/story-hasan.webp' },
      { who: 'Mehmet', text: 'Wine? Isn\'t that forbidden?', img: 'assets/art/story-mehmet.webp' },
      { who: 'Hasan', text: 'For us, Mehmet. Not for the British.', img: 'assets/art/story-hasan.webp' },
      { who: '', text: 'The River Clyde runs aground on the beach with a tremendous crash.', hold: 4.5 }, // (on the map she runs up onto the sand: openingScene plays the crash as she strikes)
      { who: 'Mehmet', text: 'Allah! What a terrible landing!', img: 'assets/art/story-mehmet.webp' },
      { who: 'Hasan', text: 'See? That\'s why drinking is forbidden.', img: 'assets/art/story-hasan.webp' },
      { who: '', text: 'Out in the bay, the boats are putting off from the fleet.', img: 'assets/art/story-helles-fleet.webp', wide: true },
      { who: 'Hasan', text: 'Bismillah! To your positions, men! Here they come!', img: 'assets/art/story-hasan.webp', hold: 1.2 },
    ],
    /**
     * The opening on the map: the River Clyde waits out with the fleet, beyond the edge of the map; when one ship
     * leaves the others (line IN) she steams in, the camera following her, and as she runs aground (line GROUND)
     * she grinds the last stretch up onto the sand with a shudder. Skipped or done: she lies where she grounded.
     */
    openingScene(s, o) {
      const c = s.campaign, b = s.buildings && s.buildings[0], fin = c.clyde;
      if (!b || !fin) return;
      const IN = 5, TRIP = 22, d = fin.d; // (her run in takes about as long as the lines of dialogue before she grounds)
      // she starts just beyond the edge of the map (her bow a tile past its last tile of sea), so she comes into view at once
      if (c.clydeFar === undefined) {
        const { map } = s, y = Math.floor(fin.y); let edge = Math.floor(fin.x);
        for (let x = Math.floor(fin.x); x >= 0 && x < map.w; x += d) { const t = map.tiles[y * map.w + x]; if (t && !t.off) edge = x; }
        c.clydeFar = Math.max(10, Math.abs(edge + 0.5 - fin.x) + b.hx + 1);
      }
      const FAR = c.clydeFar, v = FAR / TRIP; // (tiles a second: one steady speed all the way in)
      const place = (x) => { const dx = x - b.x; if (!dx) return; b.x = x; const mg = s.units.find((u) => u.id === c.shipGun); if (mg) mg.x += dx; };
      if (o.done) { place(fin.x); return; }
      if (o.i < IN) { place(fin.x + d * FAR); return; } // still out in the bay with the fleet
      // under way from the line where one ship leaves the others, at a steady speed until she strikes the beach
      c.clydeRun = (c.clydeRun || 0) + (o.dt || 0);
      const left = Math.max(0, FAR - v * c.clydeRun);
      place(fin.x + d * left);
      if (!c.clydeHeard && left <= v * 2.3) { c.clydeHeard = true; o.sound('grounding'); } // (the recording's crash comes 2.3 s in)
      if (left === 0 && !c.clydeStruck) { c.clydeStruck = true; o.shake(9); }
      if (!c.clydeStruck || o.i <= IN + 5) o.look(b.x - d * 4, b.y + 1, 1.2); // the camera rides along off her bow
    },
    works: 'light',
    history: 'Dawn, 25 April 1915. The Allied fleet has failed to force the Dardanelles; now the army is to land at the tip of the Gallipoli peninsula and take the forts from behind. At V Beach, a little sandy bay below the ruined fortress of Sedd el Bahr, a company of the 26th Regiment holds the slopes above the sand, with wire strung along the beach and out into the shallows. Out in the bay the British are coming in, boat after boat, and an old collier, the River Clyde, is being run aground with two thousand men hidden inside. The warships\' guns will pound your trenches. Hold the beach until nightfall.',
    objectives: ['Hold your trenches above the beach until nightfall (20:00).', 'Do not let the enemy take more than half of your front line.', 'Do not let the enemy take your headquarters.'],
    rules: ['The enemy comes in by sea: his men are helpless in their boats, and the wire on the beach holds them under your fire.', 'The River Clyde, run aground on the beach, pours out fresh men through the day.', 'Your line is thin and the warships shell it every hour or so: make every rifle and machine gun count.'],
    medals: ['The beach held', 'Not a yard given: the whole front line yours at nightfall', 'Fewer than 120 men lost'],
    debrief: {
      won: 'At V Beach on 25 April 1915 a few hundred Ottoman soldiers held the landing for the whole day. The British lost so many men in the boats, on the gangways of the River Clyde and on the wire that they could not get off the sand until darkness fell. They took the beach and the fort the next day, but the delay, at Helles and at Anzac, cost the Allies the peninsula: eight months later they left Gallipoli.',
      lost: 'Your line above the beach gave way. At V Beach in 1915 it did not: a handful of Ottoman riflemen held the landing until dark, and the British, pinned under a sandbank at the water\'s edge, lost more men there than on any other beach.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2), d = teamDir(PLAYER);
      const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < map.h ? map.tiles[y * W + x] : null);
      let seed = 2504;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      state.dayLength = DAY_LENGTH * 2.2; // a long day: the battle lasts from dawn to dusk
      map.summer = true; map.dry = true; // (no snow on these rocks)
      // ---- no enemy works: he is still at sea
      for (const t of map.tiles) {
        if (t.owner === ENEMY || t.origOwner === ENEMY) { t.trench = 0; t.owner = t.origOwner = -1; }
        if (t.wire && t.origWire === ENEMY) { t.wire = 0; t.origWire = -1; }
      }
      state.units = state.units.filter((u) => u.team === PLAYER);
      // ---- the bay: a little curve of sand between two headlands; the sea beyond it
      const f = frontLine(map, PLAYER);
      const coast = (y) => Math.round(f[M] + 21 - 4 * Math.exp(-(((y - M) / 9) ** 2)) + Math.abs(y - M) * 0.18); // (in our direction from the front line)
      for (const t of map.tiles) {
        if (t.off) continue;
        const c = coast(t.y);
        t.mud = 0; t.crater = 0; if (t.decor === 'tree') t.decor = rnd() < 0.4 ? 'stump' : null;
        if ((t.x - c) * d > 0) { t.sea = 1; t.trench = 0; t.owner = -1; t.wire = 0; t.decor = null; t.ground = 0; continue; }
        t.ground = (c - t.x) * d <= 10 && Math.abs(t.y - M) <= 13 ? 5 : rnd() < 0.35 ? 1 : 0; // sand on the beach, dry scrub above
      }
      // the headlands either side of the bay: rocky cliffs down to the water
      for (const t of map.tiles) {
        if (t.off || t.sea || t.trench) continue;
        const c = coast(t.y), up = (c - t.x) * d; // tiles above the water
        if (Math.abs(t.y - M) >= 12 && up <= 7 + (Math.abs(t.y - M) - 12) * 0.4 && rnd() < 0.85) { t.rock = 1 + Math.floor(rnd() * 4); t.ground = 0; t.decor = null; }
      }
      // the sandbank at the water's edge (where the men who reach the beach take cover), and the wire: two
      // belts across the sand, and more out in the shallows
      for (let y = M - 10; y <= M + 10; y++) {
        const c = coast(y);
        // (one unbroken bank: where the shore steps over, it runs along the step too)
        for (let x = c - d, n = Math.min(c, coast(y + 1), coast(y - 1)) - d; (x - n) * d >= 0; x -= d) { const bank = at(x, y); if (bank && !bank.rock && !bank.sea) { bank.trench = 1; bank.owner = bank.origOwner = ENEMY; bank.ground = 5; bank.wire = 0; } }
        for (const back of [3, 4]) { const t = at(c - d * back, y); if (t && !t.trench && !t.rock && !(y % 7 === 3 && back === 3)) { t.wire = 100; t.origWire = PLAYER; } }
        const sh = at(c + d, y); if (sh && rnd() < 0.6) { sh.wire = 100; sh.origWire = PLAYER; }
      }
      // ---- our works run on down the slope towards the sand: a second fire trench and a forward line on the brow
      // above the beach, zigzagging, with communication trenches back up to the main line - whoever gets off the
      // sand is fighting in our trenches at once. (The line we must hold is still the main one.)
      state.campaign.mainFront = frontTiles(state);
      {
        const ok = (t) => t && !t.off && !t.sea && !t.rock && !t.block && t.ground !== 5 || (t && t.trench && t.owner === PLAYER);
        const dig = (x, y, lvl) => { const t = at(x, y); if (!ok(t) || (!t.trench && makesSquare(map, x, y))) return false; t.trench = Math.max(t.trench, lvl); t.owner = t.origOwner = PLAYER; t.wire = 0; t.decor = null; t.mud = 0; return true; };
        const f0 = (y) => (f[y] >= 0 ? f[y] : f[M]);
        // a fire trench along x = at(y), with traverses jogging a tile in and out
        const fwd = (y) => coast(y) - d * 11, mid = (y) => Math.round((f0(y) + fwd(y)) / 2); // (the forward line one tile above the sand)
        const line = (xAt, y0, y1, lvl) => {
          let x = xAt(y0), jog = 0;
          for (let y = y0; y <= y1; y++) {
            if (rnd() < 0.35) jog = jog ? 0 : (rnd() < 0.5 ? 1 : -1);
            const nx = xAt(y) + d * jog;
            while (x !== nx) { dig(x, y, lvl); x += Math.sign(nx - x); } // (along the row to the traverse)
            dig(x, y, lvl);
          }
        };
        line(mid, M - 13, M + 13, 2); // the second fire trench
        line(fwd, M - 11, M + 11, 1); // the forward line, on the brow above the sand (hastily dug)
        // communication trenches from the main line down through both, wandering a little
        for (let y = M - 12 + Math.floor(rnd() * 3); y <= M + 12; y += 4 + Math.floor(rnd() * 3)) {
          let x = f0(y), yy = y;
          while ((fwd(yy) - x) * d > 0) { x += d; if (rnd() < 0.25) { const j = rnd() < 0.5 ? -1 : 1; if (dig(x - d, yy + j, 1)) yy += j; } dig(x, yy, 1); }
        }
        // machine guns dug in: three along the second fire trench and one in the forward line, at the middle of the bay
        const mgAt = (xAt, y) => {
          let best = null, bd = Infinity;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const t = at(xAt(y + dy) + dx, y + dy); if (t && t.trench && t.owner === PLAYER) { const q = Math.hypot(dx, dy); if (q < bd) { bd = q; best = t; } } }
          if (best) { const g = spawnUnit(state, 'mg', PLAYER, best.x + 0.5, best.y + 0.5); g.inTrench = true; g.setup = 0; }
        };
        for (const dy of [-8, 0, 8]) mgAt(mid, M + dy);
        mgAt(fwd, M - 2);
      }
      noSquares(map);
      // ---- the River Clyde, run aground at the eastern end of the beach, her bow on the sand
      const cy = M + 4, cx = coast(cy) + d * 9.8; // (a big ship: 20 tiles long)
      state.buildings = [{ img: 'assets/art/ship-river-clyde.webp', ax: 645, ay: 487, k: 0.5, x: cx + 0.5, y: cy + 0.5, hx: 9.9, hy: 1.45, name: 'The River Clyde' }];
      state.campaign.clyde = { x: cx + 0.5, y: cy + 0.5, d }; // where she runs aground (the opening brings her in from the bay)
      for (const t of map.tiles) if (Math.abs(t.x + 0.5 - state.buildings[0].x) <= 9.9 && Math.abs(t.y + 0.5 - state.buildings[0].y) <= 1.45) { t.block = 1; t.wire = 0; }
      // the enemy's 'headquarters' is the ship: his men come out of her sally ports (it cannot be taken)
      map.hq[ENEMY] = { x: Math.floor(cx - d * 6), y: cy - 3, hidden: true };
      // the machine guns on her foredeck, behind their sandbags: they fire on our trenches all day and
      // cannot be knocked out
      { const b = state.buildings[0], mg = spawnUnit(state, 'mg', ENEMY, b.x - d * (b.hx - 0.3), b.y - 0.3); // at the very tip of her bow
        mg.invulnerable = true; mg.ai.role = 'nest'; mg.setup = 0; mg.onShip = true; mg.deck = 80; mg.range = 16; state.campaign.shipGun = mg.id; } // (high on her deck, it reaches our trenches)
      state.wrecks = [];
      state.arriving = { [ENEMY]: true }; // he lands all day: never 'broken' (the level ends at nightfall)
      map.rocks = true;
      map.dirty = true;
      // ---- our side: the company on the slopes, a reserve, one battery across the straits
      reinforce(state, PLAYER, 1);
      { const q = map.hq[PLAYER]; spawnUnit(state, 'mg', PLAYER, q.x + 0.5 + d * 2, q.y + 0.5); spawnUnit(state, 'rifle', PLAYER, q.x + 0.5 + d, q.y + 2.5); } // the headquarters guard
      let guns = 0;
      state.units = state.units.filter((u) => u.type !== 'artillery' || guns++ < 1);
      state.resources[PLAYER] = { men: 8, ammo: 320, supplies: 80 };
      state.playerIncome = 0.6;
      state.resources[ENEMY] = { men: 0, ammo: 600, supplies: 200 }; // (no recruiting: every man comes by sea)
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.hard, income: 0, firstAttack: 90, attackGap: [45, 75], force: 9, steps: 4, guns: 0, centre: 3, rush: true, retries: 5 }; // (he goes for the centre, with the bayonet, again and again)
      ai.offensive = 90;
      state.campaign.front = state.campaign.mainFront; delete state.campaign.mainFront; // (the main line: the forward works may be lost and retaken)
      state.campaign.beach = { x: coast(M) - d * 2 + 0.5, y: M + 0.5 };
      state.campaign.coast = (y) => coast(y);
    },
    events: [
      // the boats: tows of cutters rowed in across the bay, wave after wave - the first, the biggest (ten boats,
      // sixty men), the moment the warships' first salvo has fallen
      ...[5.6, 6.1, 6.6, 7.6, 9.0, 11.0, 13.0, 15.0, 17.0].map((at, k) => ({ at, run: (s) => {
        const { map } = s, W = map.w, M = Math.floor(map.h / 2), d = teamDir(PLAYER), c = s.campaign.coast;
        const n = k === 0 ? 10 : k === 1 ? 5 : 3;
        if (k === 0) return; // (the first wave comes out of the River Clyde, not in boats)
        for (let i = 0; i < n; i++) {
          let y = M - 10 + Math.floor(((i + 0.5) / n) * 20) + Math.floor(Math.random() * 2);
          const ship = s.buildings && s.buildings[0];
          if (ship && Math.abs(y + 0.5 - ship.y) <= ship.hy + 1.2) y = Math.round(ship.y + (y + 0.5 < ship.y ? -ship.hy - 1.7 : ship.hy + 1.2)); // (rowing in clear of the River Clyde)
          let x = c(y) + d * (9 + (n > 5 ? (i % 2) * 3 : 0)); // (a big wave in two ranks of boats)
          while (x >= 0 && x < W && map.tiles[y * W + x] && (map.tiles[y * W + x].off || map.tiles[y * W + x].block)) x -= d;
          const u = spawnUnit(s, 'rifle', ENEMY, x + 0.5, y + 0.5);
          u.ai.role = 'reserve';
          orderMove(s, [u], c(y) - d * 1 + 0.5, y + 0.5); // to the sandbank
        }
        // and a machine-gun team in the mix with each wave (the first wave brought two): ashore it sets up behind
        // the sandbank and fires on our trenches over the heads of the riflemen
        for (let i = 0, nm = 1; i < nm; i++) {
          let y = M - 6 + Math.floor(((i + 0.5) / nm) * 12) + Math.floor(Math.random() * 3) - 1;
          const ship = s.buildings && s.buildings[0];
          if (ship && Math.abs(y + 0.5 - ship.y) <= ship.hy + 1.2) y = Math.round(ship.y - ship.hy - 1.7);
          let x = c(y) + d * 11;
          while (x >= 0 && x < W && map.tiles[y * W + x] && (map.tiles[y * W + x].off || map.tiles[y * W + x].block)) x -= d;
          const g = spawnUnit(s, 'mg', ENEMY, x + 0.5, y + 0.5);
          g.ai.role = 'hold';
          orderMove(s, [g], c(y) - d * 1 + 0.5, y + 0.5);
        }
        pushMessage(s, k === 0 ? 'The first boats are pulling for the beach!' : 'More boats are coming in across the bay.', 'warn');
      } })),
      // men out of the River Clyde's sally ports
      ...[5.6, 7.2, 8.4, 10.0, 12.0, 14.0, 16.0, 18.0].map((at, k) => ({ at, run: (s) => { // (the first: the first wave, twelve squads)
        if (k === 0) { firstWaveFromClyde(s); return; }
        const q = s.map.hq[ENEMY], c = s.campaign.coast, d = teamDir(PLAYER);
        for (let i = 0; i < 2; i++) {
          const u = spawnUnit(s, 'rifle', ENEMY, q.x + 0.5, q.y + 0.5 - i * 0.8);
          u.ai.role = 'reserve';
          orderMove(s, [u], c(q.y) - d * 1 + 0.5, q.y + 0.5 - i);
        }
        pushMessage(s, 'More men are coming out of the River Clyde.', 'warn');
      } })),
      // the warships' guns
      ...[5.52, 7.0, 8.7, 10.5, 12.5, 14.5, 16.5, 18.5].map((at) => ({ at, run: (s) => { // (the first salvo as soon as the battle opens)
        // firing blind from the bay over the cliffs: the shells fall anywhere on our side of the beach
        const c = s.campaign.coast, d = teamDir(PLAYER);
        const land = s.campaign.shoreside || (s.campaign.shoreside = s.map.tiles.filter((t) => !t.off && !t.sea && !t.rock && (c(t.y) - t.x) * d >= 8).map((t) => t.y * s.map.w + t.x));
        // ...but not where their own men are: the gunners hold off any ground the British have reached
        const ours = s.units.filter((u) => u.team === ENEMY && !u.dead && !u.afloat && !u.onShip);
        const clear = (t) => !ours.some((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 6) && !(t.trench && t.owner === ENEMY);
        for (let k = 0; k < 8; k++) {
          let t = null;
          for (let tries = 0; tries < 12 && !t; tries++) { const q = s.map.tiles[land[Math.floor(Math.random() * land.length)]]; if (clear(q)) t = q; }
          if (!t) continue;
          const flight = 0.8 + k * 0.3;
          s.shells.push({ x: t.x + Math.random(), y: t.y + Math.random(), t: flight, flight, team: ENEMY, fromX: t.x + 40, fromY: t.y, incoming: true, big: 3 }); // (a warship's heavy gun: three times a field gun's shell)
        }
        pushMessage(s, 'The warships are shelling our side of the beach!', 'warn');
      } })),
      { at: 12, run: (s) => { reinforce(s, PLAYER, 2); pushMessage(s, 'Two platoons have come down from the village to stiffen the line.', 'good'); } },
      { at: 19, run: (s) => pushMessage(s, 'The light is going. One more hour!', 'side') },
    ],
    check(state) {
      const c = state.campaign;
      firstWavePour(state); // the first wave out of the River Clyde, two squads at a time
      firstWaveCharge(state); // ...and it goes for our machine guns, and keeps going
      // its machine guns come up behind it once the riflemen are into our works, to fire from there
      const fw = c.firstWave;
      if (fw && !fw.mgsUp && state.time - fw.at > 25) {
        fw.mgsUp = true;
        const { map } = state, W = map.w, up = -teamDir(PLAYER);
        for (const id of fw.mgs) {
          const g = state.units.find((u) => u.id === id);
          if (!g || g.dead || g.afloat) continue;
          for (let ax = 1; ax <= 20; ax++) { const t = map.tiles[Math.floor(g.y) * W + Math.floor(g.x) + up * ax]; if (t && t.trench && t.owner === ENEMY && t.origOwner === PLAYER) { orderMove(state, [g], t.x + 0.5, t.y + 0.5); break; } if (t && t.trench && t.owner === PLAYER) break; }
        }
      }
      if (frontHeld(state) < c.front.length / 2) return { result: 'lost', reason: 'More than half of our line above the beach has fallen.' };
      if (clockHours(state) >= 20) {
        if (!c.cheered) { c.cheered = true; pushMessage(state, 'Night falls. The enemy is still pinned on the beach!', 'good'); state.events.push({ type: 'cheer' }); c.nightAt = state.time; }
        if (state.time - c.nightAt > 4) return { result: 'won', reason: 'The beach held until nightfall.' };
      }
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      return [
        'Hold the beach',
        `Front line held: ${frontHeld(state)} / ${c.front.length} (no fewer than ${Math.ceil(c.front.length / 2)})`,
        `Nightfall in ${left(Math.max(0, 20 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && frontHeld(state) === c.front.length, won && state.stats.lost[PLAYER] < 120];
    },
  },
  {
    id: 'amiens', n: 5, title: 'The Black Day', place: 'Amiens, France', date: 'August 1918',
    nations: ['usa', 'germany'], allies: ['uk', 'france'], season: 'mud', start: 'east', startHour: 4.33,
    radius: 59, // a broad front: three times the usual battlefield
    history: 'August 1918. Four years of war have taught the Allied armies how to win. Your American division holds the centre of a great line, with the British on one flank and the French on the other. At zero hour, in thick fog, more than two thousand guns open fire at once and the whole line goes forward behind the barrage - with you or without you. The German line is deep, three trench lines bristling with machine guns, and he will counter-attack whatever is taken. Break through and take his headquarters before the day is out.',
    objectives: ['Take the enemy headquarters before midnight.', 'Go forward with the British and French at zero hour.', 'Do not let the enemy take your headquarters.'],
    rules: ['You command the Americans in the centre. The British and French on your flanks are under their own command: at zero hour they attack whatever you do.', 'Zero hour comes after a short countdown. Be ready to go forward with them, or they will be fighting alone.', 'Tanks can be built at headquarters, at great cost: they crush wire and cross trenches, but may ditch or break down, and only carry so much ammunition.', 'The enemy defends in depth, and every few hours his reserves counter-attack what has been taken. A long summer day: the clock runs slower than in other battles.'],
    medals: ['The Black Day of the German army', 'By noon: the enemy headquarters taken before 12:00', 'Fewer than 800 men lost along the whole front, allies included'],
    debrief: {
      won: 'On 8 August 1918 the Allied armies advanced eight miles in a single day, and whole German units surrendered. General Ludendorff called it "the black day of the German army". It began the Hundred Days Offensive, and three months later the war was over.',
      lost: 'The German line held its depth until nightfall. In August 1918 it did not: the Allied attack at Amiens broke through in a single day. It was the beginning of the end of the war.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2), d = teamDir(PLAYER), e = teamDir(ENEMY);
      const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < map.h ? map.tiles[y * W + x] : null);
      const f = frontLine(map, PLAYER), ef = frontLine(map, ENEMY);
      const rows = []; for (let y = 0; y < map.h; y++) if (f[y] >= 0 && ef[y] >= 0) rows.push(y);
      const y0 = rows[0], y1 = rows[rows.length - 1], third = (y1 - y0) / 3;
      // the front in three sectors: the British on one flank, the Americans (you) in the centre, the French on the other
      const sector = (y) => (y < y0 + third ? 'uk' : y > y1 - third ? 'france' : 'usa');
      map.mirror = true; // shown mirrored left to right: the Allies attack from the lower left towards the upper right
      state.campaign.sectors = { y0, y1, a: Math.round(y0 + third), b: Math.round(y1 - third) };
      const trenchNear = (team, x0, yy) => { for (let r = 0; r <= 3; r++) for (const dy of [0, -1, 1, -2, 2]) for (const dx of [-r, r]) { const t = at(x0 + dx, yy + dy); if (t && t.trench && t.owner === team && !state.units.some((u) => Math.floor(u.x) === t.x && Math.floor(u.y) === t.y)) return t; } return null; };
      const put = (type, team, t, nation) => { if (!t) return null; const u = spawnUnit(state, type, team, t.x + 0.5, t.y + 0.5); u.inTrench = !!t.trench; if (nation && nation !== 'usa') { u.nation = nation; u.ally = true; } return u; };
      // ---- every sector garrisoned afresh, all along the broad front
      state.units = [];
      for (let y = y0 + 1; y <= y1 - 1; y += 3) {
        const n = sector(y);
        put('rifle', PLAYER, trenchNear(PLAYER, f[y], y), n);
        if ((y - y0) % 9 === 1) put('rifle', PLAYER, trenchNear(PLAYER, f[y] - d * 7, y), n); // support
        if ((y - y0) % 12 === 4) put('mg', PLAYER, trenchNear(PLAYER, f[y], y), n);
      }
      for (let y = y0 + 4; y <= y1 - 4; y += 9) { const t = at(f[y] - d * 9, y); if (t && !t.trench) put('artillery', PLAYER, t, sector(y)); }
      // the enemy: riflemen along his whole front, machine guns in every line, batteries behind
      for (let y = y0 + 1; y <= y1 - 1; y += 4) put('rifle', ENEMY, trenchNear(ENEMY, ef[y], y));
      for (let y = y0 + 3; y <= y1 - 3; y += 8) put('mg', ENEMY, trenchNear(ENEMY, ef[y], y));
      for (const off of [7, 11]) for (let y = y0 + 6; y <= y1 - 6; y += 12) { const g = put('mg', ENEMY, trenchNear(ENEMY, ef[y] - e * off, y)); if (g) g.ai.role = 'garrison'; }
      for (let y = y0 + 8; y <= y1 - 8; y += 14) { const t = at(ef[y] - e * 9, y); if (t && !t.trench) put('artillery', ENEMY, t); }
      // 1918: the tanks have crushed most of his wire
      let k = 0;
      for (const t of map.tiles) if (t.wire && t.origWire === ENEMY && k++ % 4) t.wire = 0;
      map.dirty = true;
      // his three lines (for the tracker), across the whole front
      const lineTiles = (off) => { const out = []; for (const y of rows) for (const dx of [-1, 0, 1]) { const x = ef[y] - e * off + dx, t = at(x, y); if (t && !t.off && t.trench && t.origOwner === ENEMY && !out.includes(y * W + x)) out.push(y * W + x); } return out; };
      state.campaign.lines = [lineTiles(0), lineTiles(7), lineTiles(11)];
      state.resources[PLAYER] = { men: 50, ammo: 700, supplies: 200 };
      state.playerIncome = 1.2;
      state.dayLength = DAY_LENGTH * 3; // one long summer day
      state.resources[ENEMY] = { men: 30, ammo: 500, supplies: 120 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 3600, attackGap: [1200, 1500], income: 0.7 };
      ai.offensive = 3600;
      state.special = { tank: true }; // tanks can be built at headquarters in this battle
      state.campaign.zero = 120; // zero hour, in seconds of battle time
      // ---- the British and French each have their own headquarters, in the middle of their sector, as far
      // behind their front as ours: their fresh squads come up from there (they count for nothing in the victory)
      const hqP = map.hq[PLAYER], depth = (f[hqP.y] - hqP.x) * d;
      hqP.allies = [];
      for (const [nation, y] of [['uk', Math.round((y0 + state.campaign.sectors.a) / 2)], ['france', Math.round((state.campaign.sectors.b + y1) / 2)]]) {
        const x0 = f[y] - d * depth;
        let best = null, bd = Infinity;
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
          const t = at(x0 + dx, y + dy);
          if (t && !t.off && t.trench && t.owner === PLAYER && !t.wire) { const dd = Math.hypot(dx, dy * 1.3); if (dd < bd) { bd = dd; best = t; } }
        }
        const t = best || at(x0, y);
        if (!t) continue;
        t.trench = 3; t.decor = null;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const n = at(t.x + ax, t.y + ay); if (n) n.decor = null; }
        hqP.allies.push({ x: t.x, y: t.y, nation, label: nation === 'uk' ? 'British HQ' : 'French HQ' });
      }
      // after zero hour each ally attacks again every so often: fresh squads up from his HQ, and the whole sector charges
      state.campaign.waveAt = { uk: -1e9, france: -1e9 };
      state.campaign.nextWave = { uk: 120 + 110, france: 120 + 170 };
    },
    events: [
      { at: 4.36, run: (s) => pushMessage(s, 'Zero hour is coming. The British and French will go over the top at zero hour, whether we are ready or not.', 'side') },
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
      const c = state.campaign;
      // zero hour: the allies' guns open on the German front line, and their infantry go over the top
      if (!c.wentOver && state.time >= c.zero) {
        c.wentOver = state.time;
        const ef = frontLine(state.map, ENEMY);
        for (const g of state.units.filter((u) => u.ally && u.type === 'artillery' && !u.dead)) { const y = Math.floor(g.y); if (ef[y] >= 0) orderBarrage(state, [g], ef[y] + 0.5, y + 0.5); }
        pushMessage(state, 'Zero hour! The British and French are going over the top!', 'good');
        state.events.push({ type: 'cheer' });
        if (c.waveAt) c.waveAt = { uk: state.time, france: state.time };
      }
      // every so often (each in turn) the British or the French attack again: two fresh squads come up from their
      // headquarters, and every squad of theirs that is not already fighting forward charges
      if (c.wentOver && c.nextWave) for (const n of ['uk', 'france']) {
        if (state.time < c.nextWave[n]) continue;
        c.nextWave[n] = state.time + 100 + Math.random() * 50;
        c.waveAt[n] = state.time;
        const hq = (state.map.hq[PLAYER].allies || []).find((q) => q.nation === n);
        const alive = state.units.filter((u) => u.ally && u.nation === n && !u.dead && u.type === 'rifle').length;
        if (hq && tileAt(state.map, hq.x, hq.y).owner === PLAYER && alive < 16) for (let k = 0; k < 2; k++) {
          const u = spawnUnit(state, 'rifle', PLAYER, hq.x + 0.5, hq.y + 0.5);
          u.nation = n; u.ally = true; u.inTrench = true;
        }
        for (const u of state.units) if (u.ally && u.nation === n) u.allyDone = false;
        pushMessage(state, n === 'uk' ? 'The British are attacking again!' : 'The French are attacking again!', 'side');
      }
      // in an attack the allies keep going: each squad from trench to trench of the enemy's in its own stretch of
      // the front, as far as his last line; between attacks they hold what they have taken
      if (c.wentOver && state.time - (c.allyTick || 0) > 2) {
        c.allyTick = state.time;
        const dir = teamDir(PLAYER), W = state.map.w;
        for (const u of state.units) {
          if (!u.ally || u.dead || u.type === 'artillery' || u.order || u.allyDone) continue;
          if (c.waveAt && state.time - (c.waveAt[u.nation] ?? -1e9) > 75) continue; // (the attack has spent itself)
          let best = null, bd = Infinity;
          for (let dy = -3; dy <= 3; dy++) for (let ax = 1; ax <= 90; ax++) {
            const t = state.map.tiles[(Math.floor(u.y) + dy) * W + Math.floor(u.x) + dir * ax];
            if (t && t.trench && t.owner === ENEMY) { const dd = ax + Math.abs(dy) * 0.8; if (dd < bd) { bd = dd; best = t; } }
          }
          if (best) orderMove(state, [u], best.x + 0.5, best.y + 0.5, 'charge');
          else u.allyDone = true;
        }
      }
      if (clockHours(state) >= 24) return { result: 'lost', reason: 'Midnight came with the enemy headquarters still in his hands.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const names = ['Front line', 'Support line', 'Reserve line'];
      const zero = c.wentOver ? 'The British and French have gone over the top' : (() => { const t = Math.max(0, Math.ceil(c.zero - state.time)); return `Zero hour in ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; })();
      return [
        'Break through and take the enemy HQ',
        zero,
        ...c.lines.map((L2, k) => { const n = L2.filter((i) => state.map.tiles[i].owner === PLAYER).length; return `${names[k]}: ${n >= L2.length / 2 ? 'broken' : 'holding'} (${n} / ${L2.length} taken)`; }),
        `Midnight in ${left(Math.max(0, 24 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.endHour < 12, won && state.stats.lost[PLAYER] < 800]; // (allied losses are counted with ours)
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
