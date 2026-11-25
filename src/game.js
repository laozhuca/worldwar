// Core simulation. No DOM access here so it can run headless (tests, AI-vs-AI).
import {
  PLAYER, ENEMY, UNIT_TYPES, HQ_THREAT_RADIUS, TRENCH_COVER, TRENCH_ARTY, BUILD, SUPPLY_INTERVAL, TRENCH_HIT, TRENCH_NEAR, TRENCH_TOUGH, TRENCH_NEAR_MISS, TRENCH_WRECK_LOSS, trenchCover,
  BASE_INCOME, CAPTURE_BONUS, START_RES, SUPPRESSION_DECAY, CHARGE_SPEED, STAMINA, MELEE_RANGE,
  WIRE_SLOW, BUILD_RADIUS_FRIENDLY, BUILD_RADIUS_ENEMY, DIG_RADIUS, DIG_RATE,
} from './config.js';
import { createMap, tileAt, frontLine, teamDir, clampToMap, rockAt, offRock, makesSquare } from './map.js';
import { findPath } from './path.js';
import { createAI, updateAI } from './ai.js';

let nextId = 1;
/** Continue unit ids after the highest one in use (loading a saved battle). */
export function setNextId(n) { nextId = n; }
const rand = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export { teamDir };

export function createGame(opts = {}) {
  const { seed = 1916, aiTeams = [ENEMY], season = 'winter', nations = ['uk', 'germany'], start = 'west', difficulty = 'medium', advance = {}, works = 'full', radius } = opts;
  const map = createMap(seed, start === 'east' ? ENEMY : PLAYER, advance, works, radius);
  const state = {
    season,
    start,
    difficulty,
    nations,
    time: 0,
    map,
    units: [],
    shells: [],
    effects: [],
    decals: [],
    events: [],
    messages: [],
    resources: [{ ...START_RES }, { ...START_RES }],
    supplyTimer: SUPPLY_INTERVAL,
    winner: -1,
    ais: aiTeams.map((t) => createAI(t, difficulty)),
    visTimer: 0,
    captureTimer: 0,
    captureMsgCooldown: 0,
    stats: { lost: [0, 0] },
  };
  deployInitialForces(state);
  refreshVisibility(state);
  return state;
}

function deployInitialForces(state) {
  const { map } = state;
  for (const team of [PLAYER, ENEMY]) {
    const front = frontLine(map, team);
    const dir = teamDir(team);
    const M = Math.floor(map.h / 2); // middle row
    for (const dy of [-17, -13, -9, -5, 4, 8, 12, 16]) {
      if (front[M + dy] >= 0) spawnUnit(state, 'rifle', team, front[M + dy] + 0.5, M + dy + 0.5);
    }
    for (const dy of [-11, -1, 10]) {
      if (front[M + dy] >= 0) spawnUnit(state, 'mg', team, front[M + dy] + 0.5, M + dy + 0.5);
    }
    // Support line reserves and batteries.
    const fx = front[M];
    const support = nearestTrenchInRow(map, team, fx - dir * 6, M);
    spawnUnit(state, 'rifle', team, support + 0.5, M - 1.5);
    spawnUnit(state, 'rifle', team, support + 0.5, M + 2.5);
    spawnUnit(state, 'artillery', team, fx - dir * 8 + 0.5, M - 6.5);
    spawnUnit(state, 'artillery', team, fx - dir * 8 + 0.5, M + 6.5);
  }
}

function nearestTrenchInRow(map, team, x, y) {
  let best = x, bd = Infinity;
  for (let xx = 0; xx < map.w; xx++) {
    const t = map.tiles[y * map.w + xx];
    if (t.trench && t.owner === team && Math.abs(xx - x) < bd) { bd = Math.abs(xx - x); best = xx; }
  }
  return best;
}

export function spawnUnit(state, type, team, x, y) {
  const t = UNIT_TYPES[type];
  const tankStores = type === 'tank' ? { shells: t.shells, mgRounds: t.mgRounds, cannonTimer: 2 } : {};
  const u = {
    id: nextId++,
    type, team, x, y,
    men: t.men,
    hp: t.men * t.hpPerMan,
    order: null,
    fireTimer: rand() * (t.fireInterval || 1),
    setup: type === 'mg' || type === 'artillery' ? t.setup : 0, // a new MG team or battery arrives packed / limbered: it must set up before it can fire
    suppression: 0,
    stamina: 100, // (a rifle squad's wind)
    pinned: false,
    target: null,
    closest: null,
    targetTimer: rand() * 0.3,
    barrage: null,
    cooldown: 0,
    digSite: null,
    digTimer: rand() * 0.5,
    digging: false,
    inTrench: false,
    visible: team === PLAYER,
    moving: false,
    firing: 0,
    chargeBonus: 0,
    facing: teamDir(team),
    hx: teamDir(team), // heading on the ground (unit vector), for sprite facing
    aimX: teamDir(team), // where a gun is laid (towards the enemy until it fires)
    aimY: 0,
    roll: 0, // distance travelled, for wheel animation
    hy: 0,
    seed: rand(),
    dead: false,
    ai: {},
    ...tankStores,
  };
  const tile = tileAt(state.map, x, y);
  u.inTrench = !!tile && tile.trench > 0;
  if (type === 'artillery') { // a battery is never placed down in a trench: onto the nearest firm ground
    const at = tileAt(state.map, u.x, u.y);
    if (at && at.trench) {
      let best = null, bd = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const q = tileAt(state.map, at.x + dx + 0.5, at.y + dy + 0.5);
        if (q && !q.trench && !q.rock && !q.block && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); best = q; }
      }
      if (best) { u.x = best.x + 0.5; u.y = best.y + 0.5; }
    }
  }
  state.units.push(u);
  return u;
}

export function pushMessage(state, text, kind = 'info') {
  state.messages.push({ text, kind, time: state.time });
  if (state.messages.length > 30) state.messages.shift();
}

// ---------------------------------------------------------------- orders

function snapToTrench(map, x, y) {
  const t = tileAt(map, x, y);
  if (t && t.trench) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  let best = null, bd = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const n = tileAt(map, x + dx, y + dy);
    if (!n || !n.trench) continue;
    const d = Math.hypot(n.x + 0.5 - x, n.y + 0.5 - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best && bd < 1.3 ? { x: best.x + 0.5, y: best.y + 0.5 } : { x, y };
}

export function orderMove(state, units, tx, ty, kind = 'move') {
  const { map } = state;
  const list = units.filter((u) => !u.dead && !(kind === 'charge' && u.type !== 'rifle')); // only riflemen go over the top
  const n = list.length;
  if (!n) return 0;
  const targetTile = tileAt(map, tx, ty);
  const wantTrench = !!(targetTile && targetTile.trench);
  list.sort((a, b) => a.y - b.y);
  const perRow = n > 8 ? Math.ceil(n / 2) : n;
  list.forEach((u, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const rowCount = Math.min(perRow, n - row * perRow);
    let x = tx - row * teamDir(u.team) * 1.0;
    let y = ty + (col - (rowCount - 1) / 2) * 1.25;
    ({ x, y } = clampToMap(x, y));
    if (wantTrench && n > 1) ({ x, y } = snapToTrench(map, x, y));
    ({ x, y } = offRock(map, x, y)); // nobody can stand on the rocks
    // a machine gun that is set up must first be dismounted and packed before its team can move off
    if (u.type === 'mg' && !u.order && !(u.setup > 0) && !(u.packing > 0)) u.packing = MG_PACK;
    // a battery in action must limber up (guns hooked up, trails lifted) before it moves
    if (u.type === 'artillery' && !u.order && !(u.setup > 0) && !(u.packing > 0)) u.packing = GUN_LIMBER;
    u.order = { kind, x, y };
    u.path = planRoute(state, u, x, y); // the quickest way there, not the straight line
    u.bridging = null;
    u.digSite = null;
    if (u.barrage) u.barrage = null; // a battery limbers up to move: its barrage is over
  });
  return n;
}

export function orderHalt(state, units) {
  for (const u of units) { u.order = null; u.path = null; if (u.barrage) { u.barrage = null; u.cooldown = 4; } }
}

/** Order the given batteries to bombard (tx,ty). Returns number of batteries that fired. */
export function orderBarrage(state, units, tx, ty) {
  let n = 0;
  for (const u of units) {
    if (u.dead || u.type !== 'artillery' || u.barrage || u.cooldown > 0) continue;
    const t = UNIT_TYPES.artillery;
    const d = Math.hypot(u.x - tx, u.y - ty);
    if (d > t.artyRange || d < t.artyMinRange) continue; // out of range, or too close for the guns
    if (aiTeam(state, u.team) && friendsNear(state, u.team, tx, ty, FRIENDLY_CLEAR)) continue; // the AI never shells its own men
    const lim = state.barrageLimit;
    if (lim && lim[u.team] !== undefined) { if (lim[u.team] <= 0) continue; lim[u.team]--; } // rationed shells
    u.barrage = { x: tx, y: ty, remaining: t.barrageShells, timer: n * 0.35 };
    u.order = null; u.path = null;
    n++;
  }
  return n;
}

export function canAfford(res, cost) {
  return res.men >= (cost.men || 0) && res.ammo >= (cost.ammo || 0) && res.supplies >= (cost.supplies || 0);
}
function pay(res, cost) {
  res.men -= cost.men || 0; res.ammo -= cost.ammo || 0; res.supplies -= cost.supplies || 0;
}

/** Is an enemy unit close enough to this team's HQ to stop it raising new units? */
export function hqThreatened(state, team) {
  const q = state.map.hq[team];
  return state.units.some((u) => u.team !== team && !u.dead && Math.hypot(u.x - q.x - 0.5, u.y - q.y - 0.5) <= HQ_THREAT_RADIUS);
}

export function buyUnit(state, team, type) {
  const t = UNIT_TYPES[type];
  const res = state.resources[team];
  if (hqThreatened(state, team)) return 'HQ under attack, no recruiting';
  if (t.special && !(state.special && state.special[type])) return 'Not available in this battle';
  if (!canAfford(res, t.cost)) return 'Not enough resources';
  pay(res, t.cost);
  const hq = state.map.hq[team];
  const dir = teamDir(team);
  if (type !== 'artillery' && type !== 'tank') {
    // infantry and machine guns muster in the trenches near headquarters (not on the open ground beside
    // them, to climb in again at once): the least crowded spot of our own trench within a few tiles
    const spot = musterSpot(state, team);
    if (spot) return spawnUnit(state, type, team, spot.x + 0.5, spot.y + 0.5);
  }
  // a battery is placed on firm ground beside headquarters and waits there (it never goes down into a trench):
  // the open tile nearest a spot a little in front of the HQ, a few rows to one side or the other
  const want = { x: hq.x + 0.5 + dir * 2.5, y: hq.y + 0.5 + (rand() - 0.5) * 6 };
  let spot = null, bd = Infinity;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const t = tileAt(state.map, hq.x + dx + 0.5, hq.y + dy + 0.5);
    if (!t || t.trench || t.rock || t.block || t.wire || (dx === 0 && dy === 0)) continue;
    const d = Math.hypot(t.x + 0.5 - want.x, t.y + 0.5 - want.y) + state.units.filter((q) => !q.dead && Math.hypot(q.x - t.x - 0.5, q.y - t.y - 0.5) < 1).length * 2;
    if (d < bd) { bd = d; spot = t; }
  }
  return spawnUnit(state, type, team, spot ? spot.x + 0.5 : hq.x + 0.5 + dir * 0.8, spot ? spot.y + 0.5 : hq.y + 0.5);
}

/** Where new infantry gather: a tile of the team's own trench 2-8 tiles from its HQ, the least crowded. */
function musterSpot(state, team) {
  const { map } = state, hq = map.hq[team];
  let best = null, bs = Infinity;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const t = tileAt(map, hq.x + dx + 0.5, hq.y + dy + 0.5);
    if (!t || !t.trench || t.owner !== team) continue;
    const d = Math.hypot(dx, dy);
    if (d < 2 || d > 8) continue;
    let crowd = 0;
    for (const u of state.units) if (!u.dead && Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 1.2) crowd++;
    const score = crowd * 10 + d * 0.5 + rand() * 0.8; // empty first, then near headquarters
    if (score < bs) { bs = score; best = t; }
  }
  return best;
}


// ---------------------------------------------------------------- engineering

export function canBuild(state, team, type, x, y) {
  const { map } = state;
  const t = tileAt(map, x, y);
  const b = BUILD[type];
  if (!t || !b) return { ok: false, reason: 'Out of bounds' };
  if (t.build) return { ok: false, reason: 'Works already in progress' };
  const isHq = map.hq.some((q) => q.x === t.x && q.y === t.y);
  if (isHq) return { ok: false, reason: 'Cannot build on HQ' };
  if (type === 'trench' && t.trench) {
    // T on a shell-damaged trench digs it out again
    if (!((t.dmg || 0) >= 5)) return { ok: false, reason: 'This trench is not damaged' };
    if (t.owner >= 0 && t.owner !== team) return { ok: false, reason: 'Not our trench' };
  } else if (type === 'trench' && t.wire) return { ok: false, reason: 'Tile not clear' };
  else if (type === 'trench' && makesSquare(map, t.x, t.y)) return { ok: false, reason: 'Trenches cannot form a square' };
  if (type === 'wire' && (t.trench || t.wire)) return { ok: false, reason: 'Tile not clear' };
  if (type === 'upgrade') {
    if (!t.trench) return { ok: false, reason: 'No trench here' };
    if (t.trench >= 3) return { ok: false, reason: 'Already fully reinforced' };
    if (t.owner !== team) return { ok: false, reason: 'Not our trench' };
  }
  const cx = t.x + 0.5, cy = t.y + 0.5;
  let friendly = false;
  for (const u of state.units) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - cx, u.y - cy);
    if (u.team !== team && d < BUILD_RADIUS_ENEMY) return { ok: false, reason: 'Too close to the enemy' };
    if (u.team === team && u.type !== 'artillery' && d < BUILD_RADIUS_FRIENDLY) friendly = true;
  }
  if (!friendly) return { ok: false, reason: 'No friendly troops nearby' };
  if (state.resources[team].supplies < b.supplies) return { ok: false, reason: 'Not enough supplies' };
  return { ok: true };
}

function markChanged(map, x, y) {
  map.dirty = true;
  map.netVersion = (map.netVersion || 0) + 1;
  (map.changes || (map.changes = [])).push({ x: Math.floor(x), y: Math.floor(y) });
}

export function placeBuild(state, team, type, x, y) {
  const c = canBuild(state, team, type, x, y);
  if (!c.ok) return c;
  const t = tileAt(state.map, x, y);
  state.resources[team].supplies -= BUILD[type].supplies;
  const repair = type === 'trench' && t.trench > 0;
  t.build = { type, team, progress: 0, work: repair ? BUILD.trench.work * Math.max(0.4, (t.dmg || 0) / 100) : BUILD[type].work, repair };
  markChanged(state.map, t.x, t.y);
  return { ok: true };
}

export function cancelBuild(state, team, x, y) {
  const t = tileAt(state.map, x, y);
  if (!t || !t.build || t.build.team !== team) return false;
  state.resources[team].supplies += Math.floor(BUILD[t.build.type].supplies * 0.5);
  t.build = null;
  markChanged(state.map, t.x, t.y);
  return true;
}

function completeBuild(state, tile) {
  const b = tile.build;
  tile.build = null;
  if (b.type === 'trench' && tile.trench) { tile.dmg = 0; } // dug out and repaired
  else if (b.type === 'trench') { tile.trench = 1; tile.owner = b.team; tile.decor = null; tile.crater = 0; tile.dmg = 0; }
  else if (b.type === 'upgrade') { tile.trench = Math.min(3, tile.trench + 1); }
  else if (b.type === 'wire') { tile.wire = 100; tile.decor = null; }
  state.map.dirty = true;
  (state.map.changes || (state.map.changes = [])).push({ x: tile.x, y: tile.y });
  state.map.netVersion = (state.map.netVersion || 0) + 1;
}

// ---------------------------------------------------------------- simulation

export function update(state, dt) {
  updateEffects(state, dt);
  if (state.winner >= 0) return;
  state.time += dt;

  // Supply convoys from the rear.
  state.supplyTimer -= dt;
  if (state.supplyTimer <= 0) {
    state.supplyTimer += SUPPLY_INTERVAL;
    deliverSupplies(state);
  }

  for (const ai of state.ais) (ai.update || updateAI)(state, ai, dt); // (an experiment may give one side another commander)

  for (const u of state.units) if (!u.dead) updateUnit(state, u, dt);

  for (const s of state.shells) {
    s.t -= dt;
    // one shell in five is heard coming in: a falling whistle, 2 s before it lands
    if (s.incoming && s.t <= 2) { s.incoming = false; state.events.push({ type: 'incoming', x: s.x, y: s.y }); }
    if (s.t <= 0) explode(state, s);
  }
  state.shells = state.shells.filter((s) => s.t > 0);

  if (state.units.some((u) => u.dead)) state.units = state.units.filter((u) => !u.dead);

  state.captureTimer -= dt;
  state.captureMsgCooldown -= dt;
  if (state.captureTimer <= 0) { state.captureTimer = 0.5; updateCapture(state); }

  state.visTimer -= dt;
  if (state.visTimer <= 0) { state.visTimer = 0.25; refreshVisibility(state); }

  if (!state.tutorial) checkVictory(state); // the tutorial's story ends the scene itself
}

export function territory(state, team) {
  let captured = 0, owned = 0;
  for (const t of state.map.tiles) {
    if (t.trench && t.owner === team) { owned++; if (t.origOwner === 1 - team) captured++; }
  }
  return { captured, owned };
}

function deliverSupplies(state) {
  const ramp = 1 + Math.min(1, state.time / 900) * 0.3; // the war effort mobilises over time
  for (const team of [PLAYER, ENEMY]) {
    const { captured } = territory(state, team);
    const res = state.resources[team];
    const gain = {};
    const ai = state.ais.find((a) => a.team === team);
    const share = ai && ai.level ? ai.level.income : (state.playerIncome ?? 1); // difficulty / campaign level: the supply share
    for (const k of ['men', 'ammo', 'supplies']) {
      gain[k] = Math.round((BASE_INCOME[k] * ramp + CAPTURE_BONUS[k] * captured) * share);
      res[k] += gain[k];
    }
    if (team === PLAYER) {
      pushMessage(state, `Supply convoy arrived: +${gain.men} men, +${gain.ammo} ammo, +${gain.supplies} supplies`, 'supply');
      state.events.push({ type: 'supply' });
    }
  }
}

/**
 * Walking round the rocks: a unit with an outcrop ahead turns aside (always to the same side until the
 * way ahead is clear again) by as little as it can. Outcrops are small and kept apart, so this is enough.
 */
function steer(map, u, mx, my) {
  const clear = (ax, ay) => !rockAt(map, u.x + ax * 0.08, u.y + ay * 0.08) && !rockAt(map, u.x + ax * 0.3, u.y + ay * 0.3) && !rockAt(map, u.x + ax * 0.65, u.y + ay * 0.65);
  if (clear(mx, my)) { u.detour = 0; return { mx, my }; }
  for (const deg of [25, 50, 75, 100, 125, 150]) {
    for (const sg of u.detour ? [u.detour] : [1, -1]) {
      const a = (deg * Math.PI / 180) * sg, c = Math.cos(a), s = Math.sin(a);
      const rx = mx * c - my * s, ry = mx * s + my * c;
      if (clear(rx, ry)) { u.detour = sg; return { mx: rx, my: ry }; }
    }
  }
  return { mx: -mx, my: -my };
}

// the AI's artillery keeps clear of its own troops: it will not open fire within FRIENDLY_CLEAR tiles of
// them, and lifts a barrage when they come within FRIENDLY_LIFT of where it falls (shells scatter ~2 tiles)
export const FRIENDLY_CLEAR = 3, FRIENDLY_LIFT = 2.6;
const aiTeam = (state, team) => state.ais.some((a) => a.team === team && !a.legacy); // (legacy: an experiment's old-style commander)
export const HQ_HOLD = 5; // seconds a captured headquarters must be held for the victory
const AI_DOUBLE = 1.35; // the computer's riflemen at the double across open ground
/** True if any of the team's men (not its guns) are within r tiles of (x, y). */
export function friendsNear(state, team, x, y, r) {
  for (const u of state.units) if (!u.dead && u.team === team && u.type !== 'artillery' && Math.hypot(u.x - x, u.y - y) < r) return true;
  return false;
}

export const BRIDGE_HP = 100; // a bridge's strength: shells hitting it take 60, bursting near it 22 (on average)

/** The planks over a trench are smashed: gone from the map, and a battery on them is lost in the trench. */
export function breakBridge(state, t) {
  const { map } = state;
  t.bridge = 0; t.bridgeHp = undefined; t.splinters = 1;
  if (map.bridges) map.bridges = map.bridges.filter((b) => b.x !== t.x || b.y !== t.y);
  markChanged(map, t.x, t.y);
  for (const u of state.units) {
    if (u.dead || u.type !== 'artillery' || Math.floor(u.x) !== t.x || Math.floor(u.y) !== t.y) continue;
    damageUnit(state, u, u.hp + 1, null); // the gun and its crew crash down into the trench
    if (u.team === PLAYER) pushMessage(state, 'The planks gave way under one of our batteries: the gun and its crew are lost in the trench.', 'loss');
  }
  state.effects.push({ type: 'debris', x: t.x + 0.5, y: t.y + 0.5, age: 0, life: 1.2 });
}

export const BRIDGE_TIME = 5; // seconds for a gun crew to lay planks over a trench before the gun can cross
export const GUN_LIMBER = 3; // seconds for a battery to limber up before moving (unlimbering after takes UNIT_TYPES.artillery.setup)
export const MG_PACK = 2.5; // seconds to dismount and pack a machine gun before its team can move (setting up again takes UNIT_TYPES.mg.setup)
export const CLIMB_D = 0.55 * 0.195 * 1.35; // tiles a man's climbing animation carries him forward (0.55 m, at the 1.35 drawing scale)
export const CLIMB_GAP = 0.8; // each group starts climbing at 80% of the previous group's climb
/** Seconds each group takes to climb out of / into a trench, and how many groups climb in turn. */
export const CLIMB = { rifle: { out: 2.0, in: 1.4, groups: 2 }, mg: { out: 2.2, in: 1.6, groups: 2 }, artillery: { out: 2.6, in: 2.0, groups: 3 } };

/** How fast a unit goes on a tile, relative to open ground (0: it cannot go there). */
const speedAt = (tile) => (tile.rock || tile.block ? 0 : terrainFactor(tile));

/**
 * The quickest route for a unit to (x, y), as waypoints, or null for the straight line. A climb into or
 * out of a trench costs what it costs the unit in time: the climb is made at a quarter of its speed.
 */
export function planRoute(state, u, x, y) {
  if (globalThis.NO_PATH) return null; // (simulation experiments)
  const C = CLIMB[u.type] || CLIMB.rifle, sp = UNIT_TYPES[u.type].speed || 0.8;
  if (u.type === 'tank') return findPath(state.map, u.x, u.y, x, y, (t) => (t.rock || t.block ? 0 : t.trench ? 0.6 : t.wire ? 0.9 : terrainFactor(t)), () => 0); // (it rolls over wire and trenches)
  if (u.type === 'artillery') { // a battery crosses a trench on planks it lays over it, never down in it
    const enter = (t) => (t.trench && !t.bridge ? BRIDGE_TIME * sp + 1 : 0);
    return findPath(state.map, u.x, u.y, x, y, (t) => (t.trench ? (t.bridge ? 1 : 0.9) : speedAt(t)), () => 0, enter);
  }
  const climb = (out) => (out ? C.out : C.in) * (1 + CLIMB_GAP * (C.groups - 1)) * 0.75 * sp;
  // the computer's men weigh danger as well as time: they keep to the trenches where a trench goes their way,
  // cross open ground only where they must, and go round wire wherever there is a way round
  if (aiTeam(state, u.team)) return findPath(state.map, u.x, u.y, x, y, safeAt, climb);
  return findPath(state.map, u.x, u.y, x, y, speedAt, climb);
}
const AI_OPEN = 0.7, AI_WIRE = 0.12; // (how much worse than its walking time open ground and wire count, to the computer)
const safeAt = (tile) => (tile.rock || tile.block ? 0 : tile.trench ? terrainFactor(tile) / 0.8 : terrainFactor(tile) * AI_OPEN * (tile.wire > 0 ? AI_WIRE : 1));

export const TANK_DITCH = 0.2; // chance of ditching in each enemy trench a tank crosses (never in its own: the crossings are known)
export const TANK_HIT = 0.34, TANK_NEAR = 0.1; // share of a tank's full strength a shell takes away: bursting right on it (three
// hits knock it out), or close beside it (within 1.5 tiles)
export const TANK_BREAKDOWN = 1 / 1500; // chance per second, on the move, of a mechanical failure
/**
 * A tank's own business each tick: it flattens the wire it rolls over; crossing a trench it may ditch
 * (nose down, tracks spinning) and on the move it may break down - either way it moves no more, though it
 * fights on; and its side guns fire on what lies abeam while it has shells.
 */
function tankTick(state, u, tile, dt) {
  const t = UNIT_TYPES.tank;
  if (tile && tile.wire > 0) { tile.wire = 0; markChanged(state.map, tile.x, tile.y); }
  // it rides down the trees in its way: a standing tree is pushed over (a fallen trunk), a stump snapped to
  // splinters - on the tile under it and those its hull reaches (within 0.8 of its centre)
  if (u.moving) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const q = tileAt(state.map, u.x + dx, u.y + dy);
    if (!q || !q.decor || Math.hypot(q.x + 0.5 - u.x, q.y + 0.5 - u.y) > 0.8) continue;
    if (q.decor === 'tree' || q.decor === 'birch') { q.decor = 'log'; q.decorHp = 1; }
    else if (q.decor === 'stump') { q.decor = null; q.decorHp = undefined; q.splinters = 1; }
    else continue;
    markChanged(state.map, q.x, q.y);
    if (rand() < 0.5) state.events.push({ type: 'crash', x: q.x + 0.5, y: q.y + 0.5 });
  }
  const key = tile ? tile.y * state.map.w + tile.x : -1;
  if (key !== u.lastTile) {
    // on rolling down into a trench (not along one): it may ditch in the enemy's broad trenches
    const into = tile && tile.trench && !u.wasOnTrench;
    if (into && !u.stuck && tile.origOwner !== u.team && rand() < TANK_DITCH) { u.stuck = 'ditched'; if (u.team === PLAYER) pushMessage(state, 'A tank has ditched in a trench!', 'warn'); }
    u.wasOnTrench = !!(tile && tile.trench);
    u.lastTile = key;
  }
  if (u.moving && !u.stuck && rand() < TANK_BREAKDOWN * dt) { u.stuck = 'broken'; if (u.team === PLAYER) pushMessage(state, 'A tank has broken down!', 'warn'); }
  if (u.stuck) { u.order = null; u.path = null; }
  // the side guns: at whatever lies abeam (within 50 degrees of square to its heading), riflemen and guns first
  u.cannonTimer = (u.cannonTimer || 0) - dt;
  if (u.cannonTimer > 0 || !(u.shells > 0)) return;
  const hl = Math.hypot(u.hx, u.hy) || 1, hx = u.hx / hl, hy = u.hy / hl;
  let best = null, bs = Infinity;
  for (const e of state.units) {
    if (e.dead || e.team === u.team || !e.visible && e.team !== PLAYER) continue;
    const dx = e.x - u.x, dy = e.y - u.y, d = Math.hypot(dx, dy);
    if (d < 1.5 || d > t.cannonRange) continue;
    if (Math.abs((dx * hx + dy * hy) / d) > 0.64) continue; // not abeam
    const sc = d * (e.type === 'mg' ? 0.6 : e.type === 'artillery' ? 0.7 : e.type === 'tank' ? 0.5 : 1);
    if (sc < bs) { bs = sc; best = e; }
  }
  if (!best) { u.cannonTimer = 0.5; return; }
  u.shells--; u.cannonTimer = t.cannonInterval * (0.85 + rand() * 0.3);
  const sp = 0.25 + dist(u, best) * 0.05, a = rand() * Math.PI * 2, r = rand() * sp;
  const side = Math.sign((best.x - u.x) * -hy + (best.y - u.y) * hx) || 1;
  const fx = -hy * side, fy = hx * side;
  state.effects.push({ type: 'gunflash', x: u.x + fx * 0.6, y: u.y + fy * 0.6, age: 0, life: 0.3, hx: fx, hy: fy, facing: Math.sign(fx - fy) || 1 });
  state.events.push({ type: 'artyfire', x: u.x, y: u.y });
  u.firing = 0.3; u.lastShot = state.time; u.cannonSide = side;
  explode(state, { x: best.x + Math.cos(a) * r, y: best.y + Math.sin(a) * r, team: u.team, big: 0.55 }); // (a 6-pounder: a small burst)
  if (u.shells === 0 && u.team === PLAYER) pushMessage(state, 'A tank has fired its last shell.', 'warn');
}

function terrainFactor(tile) {
  if (!tile) return 1;
  let f = 1;
  if (tile.wire > 0) f *= tile.wire > 50 ? WIRE_SLOW : WIRE_SLOW * 2;
  if (tile.crater) f *= 0.85;
  if (tile.mud) f *= 0.88;
  if (tile.sea) f *= 0.5; // rowing in
  if (tile.ground === 3) f *= 0.82; // scree: loose stones underfoot
  if (tile.trench) f *= 0.8;
  return f;
}

function updateUnit(state, u, dt) {
  const t = UNIT_TYPES[u.type];
  const tile = tileAt(state.map, u.x, u.y);
  const wasIn = u.inTrench;
  u.inTrench = !!tile && tile.trench > 0 && u.type !== 'artillery' && u.type !== 'tank'; // a battery never goes down into a trench (it bridges it); a tank rolls over it
  if (u.type === 'tank') tankTick(state, u, tile, dt);
  // at sea: the men are in a boat (rowed in to the beach); stepping ashore leaves the boat beached at the water's edge
  const afloat = !!(tile && tile.sea) && !u.onShip; // (the guns on the River Clyde's deck are not in a boat)
  // the men jump out on the beach at once; one of the crew rows the empty boat back out to sea
  if (u.afloat && !afloat && state.wrecks) (state.returning || (state.returning = [])).push({ x: u.x - 0.6 * teamDir(u.team), y: u.y, dir: -teamDir(u.team), t: state.time });
  u.afloat = afloat;
  // climbing out of a trench, or down into one, takes time: the men haul themselves over the parapet.
  // Out: as soon as the ground just ahead is no longer trench (the men are at the trench wall).
  // In: on stepping onto a trench tile.
  if (u.order && !u.climb && u.type !== 'artillery' && u.type !== 'tank') {
    const charge = u.order.kind === 'charge';
    // the unit climbs group by group (a rifle squad's two ranks, an MG team's two pairs, a battery crew's
    // three pairs, hauling the gun): each group takes `rank` seconds, the next starting as the one before is
    // most of the way over (CLIMB_GAP), so the whole climb lasts rank * (1 + CLIMB_GAP * (groups - 1))
    // the climb is made straight across the trench edge (a tile side): hx, hy is that axis direction, and
    // the unit goes CLIMB_D across it while the men's own climbing animation carries them over
    const C = CLIMB[u.type], climb = (out) => {
      const r = out ? (charge && u.type === 'rifle' ? 1.4 : C.out) : C.in;
      const ax = Math.abs(u.hx) >= Math.abs(u.hy), hx = ax ? Math.sign(u.hx) || 1 : 0, hy = ax ? 0 : Math.sign(u.hy) || 1;
      return { t: 0, rank: r, dur: r * (1 + CLIMB_GAP * (C.groups - 1)), out, tx: tile.x, ty: tile.y, x0: u.x, y0: u.y, hx, hy };
    };
    if (u.inTrench && wasIn === false) u.climb = climb(false);
    else if (u.inTrench && !u.overTop) {
      const wq = u.path && u.path.length ? u.path[0] : [u.order.x, u.order.y];
      const dx = wq[0] - u.x, dy = wq[1] - u.y, d = Math.hypot(dx, dy) || 1;
      const ahead = (d > 0.45 || (u.path && u.path.length > 1)) && tileAt(state.map, u.x + (dx / d) * 0.4, u.y + (dy / d) * 0.4);
      if (ahead && !ahead.trench) u.climb = climb(true);
    }
  }
  if (u.climb) {
    u.climb.t += dt;
    if (u.climb.t >= u.climb.dur || !u.order) { if (u.climb.out && u.order && u.inTrench) u.overTop = true; u.climb = null; }
  }
  // out over the parapet: walking on top of the trench's edge until clear of it (no second climb)
  if (u.overTop && (!u.inTrench || !u.order)) u.overTop = false;
  u.suppression = Math.max(0, u.suppression - dt * SUPPRESSION_DECAY);
  if (u.shock > 0) { u.shock -= dt; u.suppression = Math.max(u.suppression, 75); }
  if (u.type === 'tank') { u.suppression = 0; u.shock = 0; } // (armour: the crew are neither suppressed nor pinned)
  const charging = !!(u.order && u.order.kind === 'charge');
  if (charging || u.type === 'tank') u.pinned = false; // (heavy fire pins men down in a trench too: heads down, hardly able to fire back)
  else if (u.suppression > 60) u.pinned = true;
  else if (u.suppression < 30) u.pinned = false;
  u.cooldown = Math.max(0, u.cooldown - dt);
  u.firing = Math.max(0, u.firing - dt);
  u.chargeBonus = Math.max(0, u.chargeBonus - dt);

  // --- target acquisition
  u.targetTimer -= dt;
  if (u.targetTimer <= 0) { u.targetTimer = 0.3 + rand() * 0.15; findTargets(state, u, t); }
  if (u.target && u.target.dead) u.target = null;
  if (u.closest && u.closest.dead) u.closest = null;
  const closeD = u.closest ? dist(u, u.closest) : Infinity;

  // Charging troops stop to fight when they hit the enemy.
  if (charging && closeD < MELEE_RANGE) { u.order = null; u.path = null; u.chargeBonus = 3; }

  // --- movement
  u.moving = false;
  if (u.packing > 0) { u.packing = u.order ? Math.max(0, u.packing - dt) : 0; } // dismounting the gun first
  else if (u.bridging) { // laying planks over the trench ahead
    const b = u.bridging;
    b.t += dt;
    if (!u.order) u.bridging = null;
    else if (b.t >= b.dur) {
      const bt = tileAt(state.map, b.x + 0.5, b.y + 0.5);
      if (bt) { bt.bridge = b.axis; (state.map.bridges ||= []).push({ x: bt.x, y: bt.y, axis: b.axis }); }
      u.bridging = null;
    }
  }
  else if (u.order && u.climb && u.climb.x0 !== undefined) {
    // climbing: the unit goes straight across the edge, exactly as far as the men's climb carries them
    const c = u.climb, k = Math.min(1, c.t / c.dur);
    u.x = c.x0 + c.hx * CLIMB_D * k; u.y = c.y0 + c.hy * CLIMB_D * k;
    u.moving = true; u.setup = t.setup || 0;
  }
  else if (u.order) {
    // the next waypoint of the route (the destination itself at the end)
    const wp = u.path && u.path.length ? u.path[0] : null, gx = wp ? wp[0] : u.order.x, gy = wp ? wp[1] : u.order.y;
    const dx = gx - u.x, dy = gy - u.y;
    const d = Math.hypot(dx, dy);
    // a battery stops at a trench it has no planks over, and its crew bridges it
    if (u.type === 'artillery' && d > 0.05) {
      const ah = tileAt(state.map, u.x + (dx / d) * 0.55, u.y + (dy / d) * 0.55);
      if (ah && ah.trench && !ah.bridge && ah !== tile) {
        const ax = Math.abs(dx) >= Math.abs(dy);
        u.bridging = { t: 0, dur: BRIDGE_TIME, x: ah.x, y: ah.y, axis: ax ? 1 : 2 };
        u.hx = dx / d; u.hy = dy / d;
        return;
      }
    }
    // a charge at the run, as fast as the men's wind allows: winded, it slows towards a walk
    const run = u.order.kind !== 'charge' ? 1 : u.type !== 'rifle' ? CHARGE_SPEED : 1 + (CHARGE_SPEED - 1) * Math.min(1, (u.stamina ?? 100) / STAMINA.winded);
    let speed = t.speed * (u.type === 'artillery' && tile && tile.trench ? 1 : terrainFactor(tile)) * run;
    // the computer's riflemen cross open ground at the double (not through wire), and keep to a walk in the trenches
    if (u.type === 'rifle' && u.order.kind !== 'charge' && !u.inTrench && !(tile && tile.wire > 0) && aiTeam(state, u.team)) speed *= AI_DOUBLE;
    if (u.climb) speed *= 0.25; // over the parapet, or down into the trench
    // (down in a trench, fire overhead only spoils their aim: they move along it as usual; in the open they crawl)
    if (u.inTrench && !u.climb) { /* full pace */ }
    else if (u.pinned) speed *= 0.3;
    else if (u.order.kind !== 'charge' && u.suppression > 40) speed *= 0.6;
    const step = speed * dt;
    if (wp && (d <= step || d < 0.02)) {
      u.x = gx; u.y = gy; u.path.shift(); // on to the next leg
      if (!u.path.length) u.path = null;
      u.moving = true;
    } else if (d <= step || d < 0.02) {
      u.x = u.order.x; u.y = u.order.y;
      if (u.order.kind === 'charge') u.chargeBonus = 3;
      u.order = null; u.path = null;
    } else {
      let mx = dx / d, my = dy / d;
      const rocky = state.map.rocks ?? (state.map.rocks = state.map.tiles.some((q) => q.rock || q.block));
      if (rocky) ({ mx, my } = steer(state.map, u, mx, my));
      const nx = u.x + mx * step, ny = u.y + my * step;
      if (!rocky || !rockAt(state.map, nx, ny)) { u.x = nx; u.y = ny; }
      else if (!rockAt(state.map, nx, u.y)) u.x = nx; // slide along the face of the rock
      else if (!rockAt(state.map, u.x, ny)) u.y = ny;
      ({ x: u.x, y: u.y } = clampToMap(u.x, u.y));
      u.moving = true;
      u.hx = mx; u.hy = my;
      u.roll += step;
      const sx = mx - my; // screen-space horizontal direction
      if (Math.abs(sx) > 0.05) u.facing = Math.sign(sx);
    }
    u.setup = t.setup || 0;
  } else if (u.setup > 0) {
    u.setup = Math.max(0, u.setup - dt);
  }

  // --- the men's wind: the charge uses it up, hand-to-hand fighting too; it comes back at rest, slowly on the walk
  if (u.type === 'rifle') {
    const melee = !!(u.closest && closeD < MELEE_RANGE);
    const rate = melee ? -STAMINA.melee : u.moving ? (charging ? -STAMINA.charge : STAMINA.walk) : STAMINA.rest;
    u.stamina = Math.max(0, Math.min(100, (u.stamina ?? 100) + rate * dt));
  }

  // --- artillery barrage: never on the move, and only once the guns are unlimbered
  if (u.barrage && !u.order && !(u.setup > 0)) {
    const b = u.barrage;
    b.timer -= dt;
    if (b.timer <= 0) {
      const res = state.resources[u.team];
      // the AI's guns lift as soon as its own infantry reach (or take) the target
      if (aiTeam(state, u.team) && friendsNear(state, u.team, b.x, b.y, FRIENDLY_LIFT)) { u.barrage = null; u.cooldown = 3; }
      else if (res.ammo < t.shellAmmo) {
        u.barrage = null; u.cooldown = 3;
        if (u.team === PLAYER) pushMessage(state, 'Battery out of ammunition!', 'warn');
      } else {
        res.ammo -= t.shellAmmo;
        launchShell(state, u, b.x, b.y);
        b.remaining--;
        const crewFactor = Math.min(3, t.men / Math.max(1, u.men));
        b.timer = t.shellInterval * crewFactor * (0.85 + rand() * 0.3);
        u.firing = 0.3;
        if (b.remaining <= 0) { u.barrage = null; u.cooldown = t.cooldown; }
      }
    }
  }

  // --- melee (bayonets, clubs, grenades)
  if (u.closest && closeD < MELEE_RANGE && u.type !== 'tank') {
    let dmg = u.men * t.melee * dt * 1.5;
    if (u.chargeBonus > 0) dmg *= 2.0; // the shock of a bayonet charge
    if (u.type === 'rifle') dmg *= 0.6 + 0.4 * Math.min(1, (u.stamina ?? 100) / STAMINA.winded); // (blown men fight weakly)
    if (u.suppression > 50) dmg *= 0.5;
    damageUnit(state, u.closest, dmg, null, { x: u.x, y: u.y, kind: 'melee' });
    u.closest.suppression = Math.min(100, u.closest.suppression + dt * 10);
    if (rand() < dt * 2) state.events.push({ type: 'rifle', x: u.x, y: u.y });
    return;
  }

  // --- small-arms fire
  u.fireTimer = Math.max(0, u.fireTimer - dt * (u.moving ? 0.6 : 1));
  if (t.range && (!charging || u.type === 'tank') && !u.holdFire && !u.afloat && !(u.onShip && u.pinned) && !(u.type === 'tank' && !(u.mgRounds > 0)) && u.target && u.setup <= 0 && !(u.packing > 0) && u.fireTimer <= 0) {
    if (dist(u, u.target) <= (u.range || t.range)) { // (a unit may have its own reach: the River Clyde's guns)
      fire(state, u, u.target, t);
      if (u.type === 'tank') u.mgRounds--;
      u.fireTimer = t.fireInterval * (0.85 + rand() * 0.3);
    }
  }

  // --- digging works
  if (t.canDig && !u.order && !(u.target && dist(u, u.target) <= t.range)) {
    u.digTimer -= dt;
    if (u.digTimer <= 0) { u.digTimer = 0.5; u.digSite = findDigSite(state, u); }
    u.digging = false;
    if (u.digSite) {
      const site = u.digSite.build;
      if (!site || site.team !== u.team) u.digSite = null;
      else {
        site.progress += u.men * DIG_RATE * dt;
        u.digging = true;
        if (site.progress >= site.work) { completeBuild(state, u.digSite); u.digSite = null; }
      }
    }
  } else u.digging = false;
}

/**
 * Can a machine gun see this man to hit him? Anyone out of a trench, yes (in the open, or climbing out over the
 * parapet). A man down in a trench only from close by (looking down into it), along the trench itself (the gun in
 * a straight run of trench with him, no traverse between: enfilade), or from high up (a ship's deck). Out of its
 * sight in his trench, its fire only pins him down (fire).
 */
export function mgCanSee(map, u, e) {
  if (!e.inTrench || e.climb || e.overTop) return true;
  if (u.deck || Math.hypot(e.x - u.x, e.y - u.y) <= 1.5) return true;
  if (!u.inTrench) return false;
  const d = Math.hypot(e.x - u.x, e.y - u.y), n = Math.ceil(d * 4);
  for (let i = 1; i < n; i++) { const t = tileAt(map, u.x + ((e.x - u.x) * i) / n, u.y + ((e.y - u.y) * i) / n); if (!t || !t.trench) return false; }
  return true;
}

function findTargets(state, u, t) {
  let best = null, bestScore = Infinity, closest = null, cd = Infinity;
  for (const e of state.units) {
    if (e.dead || e.team === u.team) continue;
    const d = dist(u, e);
    if (d < cd) { cd = d; closest = e; }
    if (t.range && d <= (u.range || t.range)) {
      // (a machine gun would rather fire at men it can see: at men down in a trench out of its sight it can only keep their heads down)
      const score = d * (e.inTrench ? 1.4 : 1) * (e.type === 'artillery' ? 1.3 : 1) * (u.type === 'mg' && !mgCanSee(state.map, u, e) ? 3 : 1);
      if (score < bestScore) { bestScore = score; best = e; }
    }
  }
  u.target = best;
  u.closest = closest;
}

function findDigSite(state, u) {
  const { map } = state;
  let best = null, bd = Infinity;
  const r = Math.ceil(DIG_RADIUS);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(map, u.x + dx, u.y + dy);
    if (!t || !t.build || t.build.team !== u.team) continue;
    const d = Math.hypot(t.x + 0.5 - u.x, t.y + 0.5 - u.y);
    if (d <= DIG_RADIUS && d < bd) { bd = d; best = t; }
  }
  return best;
}

function fire(state, u, target, t) {
  const res = state.resources[u.team];
  let shots = t.burst ? (u.men >= 2 ? t.burst : Math.ceil(t.burst / 2)) : u.men;
  const need = shots * t.ammoPerShot;
  let ammoFactor = 1;
  if (res.ammo >= need) res.ammo -= need;
  else { ammoFactor = 0.25; shots = Math.max(1, Math.floor(shots * 0.25)); }

  const d = dist(u, target);
  let acc = t.hitChance * (1 - 0.55 * (d / (u.range || t.range)));
  if (u.suppression > 50) acc *= 0.35;
  else if (u.suppression > 25) acc *= 0.7;
  if (u.moving) acc *= 0.6;
  if (target.pinned && !target.inTrench) acc *= 0.6;
  if (target.order && target.order.kind === 'charge') acc *= 1.1;

  let hits = 0;
  for (let i = 0; i < shots; i++) if (rand() < acc) hits++;
  const tt = tileAt(state.map, target.x, target.y);
  const cover = target.inTrench && tt && tt.trench ? trenchCover(TRENCH_COVER, tt) : 1;
  // a machine gun firing on men down in a trench it cannot see into pins them down, but its bullets go over their heads
  const seen = u.type !== 'mg' || mgCanSee(state.map, u, target);
  if (seen) damageUnit(state, target, hits * t.damage * cover, null, { x: u.x, y: u.y, kind: t.burst ? 'mg' : 'rifle' });

  let sup = shots * t.suppressPerShot;
  if (target.order && target.order.kind === 'charge') sup *= 0.5;
  if (target.inTrench) sup *= 0.6;
  target.suppression = Math.min(100, target.suppression + sup);

  u.firing = t.burst ? 0.4 : 0.15;
  u.lastShot = state.time; // (a man firing from under planks shows himself)
  if (u.type !== 'tank') { // (a tank's machine guns fire every way: the hull does not swing round to shoot, ditched or not)
    const sx = (target.x - u.x) - (target.y - u.y);
    if (Math.abs(sx) > 0.05) u.facing = Math.sign(sx);
    if (d > 0.01) { u.hx = (target.x - u.x) / d; u.hy = (target.y - u.y) / d; }
  }
  state.effects.push({ type: t.burst ? 'tracer' : 'volley', x: u.x, y: u.y, tx: target.x, ty: target.y, age: 0, life: t.burst ? 0.35 : 0.18, team: u.team, n: shots * ammoFactor, deck: u.deck || 0 });
  state.events.push({ type: t.burst ? 'mg' : 'rifle', x: u.x, y: u.y, id: u.id });
}

/**
 * Casualties. `blast` ({x, y, d}) marks a shell burst: some of the fallen are thrown through the air
 * away from it, and many are torn apart; small-arms deaths drop where they stand, intact.
 */
export function damageUnit(state, u, amount, blast = null, shooter = null) {
  if (u.dead || amount <= 0 || u.invulnerable) return; // invulnerable: kept alive by a scripted scene
  if (u.type === 'tank') { // armour: bullets glance off; a shell right on it or close beside it costs it a share of its strength
    if (!blast || blast.d > 1.5) return;
    const full = UNIT_TYPES.tank.men * UNIT_TYPES.tank.hpPerMan;
    amount = Math.min(u.hp, full * (blast.d <= 0.8 ? TANK_HIT : TANK_NEAR));
    if (amount >= u.hp) {
      state.effects.push({ type: 'smoke', x: u.x, y: u.y, age: 0, life: 40 }, { type: 'boom', x: u.x, y: u.y, age: 0, life: 0.7 });
      if (u.team === PLAYER) pushMessage(state, 'A tank has been knocked out!', 'loss');
    } else {
      state.effects.push({ type: 'smoke', x: u.x, y: u.y, age: 0, life: 6 });
      if (u.team === PLAYER) pushMessage(state, 'A tank has been hit by a shell!', 'warn');
    }
  }
  const t = UNIT_TYPES[u.type];
  const before = u.men;
  if (u.afloat) amount *= blast ? 0.5 : 1.4; // men packed in an open boat: exposed to rifle and machine-gun fire, but low in the water, shell splinters mostly spent on the sea
  const smashed = u.afloat && blast && blast.d < 0.5; // only a shell right on a boat smashes it, and every man in it; a near miss kills some, the boat rows on
  if (smashed) amount = u.hp;
  u.hp -= amount;
  u.men = Math.max(0, Math.ceil(u.hp / t.hpPerMan - 1e-6));
  state.stats.lost[u.team] += before - u.men;
  if (!u.afloat && u.type !== 'tank') for (let i = 0; i < Math.min(3, before - u.men); i++) fallen(state, u, blast, shooter);
  else { // at sea the dead go over the side and float, drifting, until they sink from sight
    const fl = state.floaters || (state.floaters = []);
    for (let i = 0; i < Math.min(smashed ? 4 : 2, before - u.men); i++) fl.push({ kind: 'body', x: u.x + (rand() - 0.5) * (smashed ? 1.4 : 0.8), y: u.y + (rand() - 0.5) * (smashed ? 1.0 : 0.6), v: Math.floor(rand() * 3), d: [0, 2, 5][Math.floor(rand() * 3)], t: state.time, life: 22 + rand() * 18, m: rand() < 0.5 });
    if (smashed) for (let i = 0; i < 3; i++) fl.push({ kind: 'piece', x: u.x + (rand() - 0.5) * 1.6, y: u.y + (rand() - 0.5) * 1.1, v: i === 0 ? 3 : Math.floor(rand() * 3), t: state.time, life: 28 + rand() * 20, m: rand() < 0.5 });
    if (fl.length > 160) fl.splice(0, fl.length - 160);
  }
  if (state.decals.length > 260) state.decals = state.decals.filter((d) => state.time - d.t < 140).slice(-260);
  if (u.hp <= 0) {
    u.dead = true;
    u.men = 0;
    if (u.afloat && state.wrecks && !smashed) state.wrecks.push({ x: u.x, y: u.y, v: 'empty', t: state.time }); // the boat drifts, empty (a shell leaves only pieces)
    if (u.team === PLAYER) pushMessage(state, `${t.name} wiped out`, 'loss');
    state.effects.push({ type: 'smoke', x: u.x, y: u.y, age: 0, life: 2.5 });
  }
}

/**
 * One body left on the field: pose variant (0-2 intact, 3-5 torn), one of 8 directions. A shell burst
 * jolts the body a short way and throws pieces high into the air: the torn-off limbs, the helmet,
 * sometimes the rifle. They land and stay on the field as small decals.
 */
const TORN_PARTS = { 3: ['leg'], 4: ['arm'], 5: ['leg', 'leg'] };
function fallen(state, u, blast, shooter) {
  const x0 = u.x + (rand() - 0.5) * 0.7, y0 = u.y + (rand() - 0.5) * 0.7;
  const torn = blast && rand() < 0.6;
  const body = { x: x0, y: y0, team: u.team, nation: u.nation, t: state.time, v: torn ? 3 + Math.floor(rand() * 3) : Math.floor(rand() * 3), dir: Math.floor(rand() * 8) };
  // blood sprays away from the shooter or the burst
  const src = blast || shooter;
  if (src) {
    let bx = x0 - src.x, by = y0 - src.y;
    const bn = Math.hypot(bx, by) || 1;
    bx /= bn; by /= bn;
    const drops = [];
    for (let i = 0; i < (blast ? 14 : 9); i++) {
      const sp = 14 + rand() * 30, a = (rand() - 0.5) * 1.3, c = Math.cos(a), sn = Math.sin(a);
      // screen-space velocity of each drop (the iso projection of the spray direction)
      const dx = bx * c - by * sn, dy = bx * sn + by * c;
      drops.push({ vx: (dx - dy) * sp, vy: (dx + dy) * sp * 0.5, vz: 20 + rand() * 40, s: 1 + rand() * 1.6 });
    }
    state.effects.push({ type: 'blood', x: x0, y: y0, age: 0, life: 0.75, drops });
  }
  if (!blast && shooter) {
    // shot down, in one of five falls: backward (on his back, head away from the shooter), pitching
    // forward onto his face (head towards the shooter, mostly when charging at them), twisting onto his
    // side, down on his knees first and then forward, or staggering back before he collapses
    const charging = u.order && u.order.kind === 'charge';
    const r = rand();
    const kind = charging ? (r < 0.45 ? 1 : r < 0.8 ? 3 : 2) : (r < 0.3 ? 0 : r < 0.5 ? 4 : r < 0.65 ? 1 : r < 0.8 ? 3 : 2);
    body.v = [0, 1, 2, 1, 0][kind];
    const away = Math.atan2(y0 - shooter.y, x0 - shooter.x);
    const head = body.v === 0 ? away : body.v === 1 ? away + Math.PI : away + (rand() < 0.5 ? 1 : -1) * Math.PI / 2;
    const a = head + (rand() - 0.5) * 0.6;
    body.dir = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    const dur = [0.8, 0.8, 0.9, 1.25, 1.2][kind] * (shooter.kind === 'mg' ? 0.85 : 1);
    body.fall = { k: kind, dur, mg: shooter.kind === 'mg' };
  }
  body.bleed = blast ? 1.6 : 1; // how big the pool of blood under him grows
  state.decals.push(body);
  // a death cry for about a third of the men shot down; shell victims die without a sound of their own
  if (!blast && rand() < 0.33) state.events.push({ type: 'death', x: x0, y: y0 });
  if (!blast) return;
  let ax = x0 - blast.x, ay = y0 - blast.y;
  const n = Math.hypot(ax, ay);
  if (n < 0.05) { const a = rand() * Math.PI * 2; ax = Math.cos(a); ay = Math.sin(a); } else { ax /= n; ay /= n; }
  const near = Math.max(0, 1 - blast.d / 1.6);
  const throwIt = (b, dist, h, spin) => {
    const land = clampToMap(x0 + ax * dist, y0 + ay * dist);
    b.fly = { x0, y0, h, dur: 0.6 + h * 0.45, spin };
    b.x = land.x; b.y = land.y;
  };
  // the body: a short, low jolt
  if (rand() < 0.4 + near * 0.5) throwIt(body, 0.25 + near * 0.5 + rand() * 0.25, 0.12 + near * 0.18, (rand() - 0.5) * 3);
  // the pieces: high and far, spinning fast, each a little off the blast direction
  const pieces = (TORN_PARTS[body.v] || []).slice();
  if (rand() < 0.35 + near * 0.4) pieces.push('helmet');
  if (rand() < 0.2 + near * 0.2) pieces.push('rifle');
  for (const part of pieces) {
    const a = (rand() - 0.5) * 1.4, c = Math.cos(a), sn = Math.sin(a);
    const dx = ax * c - ay * sn, dy = ax * sn + ay * c;
    const dist = 0.8 + near * 2 + rand() * 1.2, h = 0.8 + near * 1.4 + rand() * 0.8;
    const land = clampToMap(x0 + dx * dist, y0 + dy * dist);
    state.decals.push({ x: land.x, y: land.y, team: u.team, nation: u.nation, t: state.time, part, dir: Math.floor(rand() * 4),
      fly: { x0, y0, h, dur: 0.6 + h * 0.45, spin: (rand() < 0.5 ? -1 : 1) * (9 + rand() * 9) } });
  }
}

function launchShell(state, u, tx, ty) {
  const d = Math.hypot(tx - u.x, ty - u.y);
  const spread = 1.0 + d * 0.04;
  const a = rand() * Math.PI * 2;
  const r = Math.pow(rand(), 0.7) * spread;
  const flight = 1.2 + d * 0.05;
  state.shells.push({ x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r, t: flight, flight, team: u.team, fromX: u.x, fromY: u.y, incoming: rand() < 0.2 });
  if (d > 0.01) { u.hx = u.aimX = (tx - u.x) / d; u.hy = u.aimY = (ty - u.y) / d; }
  state.effects.push({ type: 'gunflash', x: u.x, y: u.y, age: 0, life: 0.35, facing: u.facing, hx: u.hx, hy: u.hy });
  state.events.push({ type: 'artyfire', x: u.x, y: u.y });
}

/**
 * The trench tile whose cut the point (x, y) lies in, or null. A trench is narrower than its tile: the
 * cut is the middle of the tile (half-width 0.25) plus arms running to the trench tiles it joins; the
 * rest of the tile is parapet and open ground.
 */
const CUT = 0.25;
function trenchCutAt(map, x, y) {
  const t = tileAt(map, x, y);
  if (!t || !t.trench) return null;
  const lx = x - t.x - 0.5, ly = y - t.y - 0.5;
  if (Math.abs(lx) <= CUT && Math.abs(ly) <= CUT) return t;
  const joins = (dx, dy) => { const n = tileAt(map, t.x + dx + 0.5, t.y + dy + 0.5); return n && n.trench; };
  if (Math.abs(lx) <= CUT && ((ly < 0 && joins(0, -1)) || (ly > 0 && joins(0, 1)))) return t;
  if (Math.abs(ly) <= CUT && ((lx < 0 && joins(-1, 0)) || (lx > 0 && joins(1, 0)))) return t;
  return null;
}
/** Are two trench tiles part of the same trench run, within `steps` connected sections of each other? */
function sameTrench(map, a, b, steps = 2) {
  if (a === b) return true;
  let frontier = [a]; const seen = new Set([a]);
  for (let k = 0; k < steps; k++) {
    const next = [];
    for (const t of frontier) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tileAt(map, t.x + dx + 0.5, t.y + dy + 0.5);
      if (!n || !n.trench || seen.has(n)) continue;
      if (n === b) return true;
      seen.add(n); next.push(n);
    }
    frontier = next;
  }
  return false;
}

function explode(state, s) {
  const { map } = state;
  const K = s.big || 1; // a heavy naval shell: K times the blast, its reach and its burst
  // where the shell burst: inside a trench cut, or outside (parapet, open ground)
  const cut = trenchCutAt(map, s.x, s.y);
  // share of an outside burst that reaches men in this trench tile (wrecked works shelter less)
  const nearMiss = (tt) => TRENCH_NEAR_MISS + (1 - TRENCH_NEAR_MISS) * TRENCH_WRECK_LOSS * Math.min(1, (tt.dmg || 0) / 100);
  for (const u of state.units) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - s.x, u.y - s.y);
    const tt = u.inTrench ? tileAt(map, u.x, u.y) : null;
    // a burst in this man's own trench (his section or one joined to it) reaches him in full; one on the
    // parapet, in the open, or in a different trench spends itself on the earth walls
    const sheltered = tt && tt.trench && !(cut && sameTrench(map, cut, tt));
    if (d < 1.6 * K) {
      let cover = tt && tt.trench ? trenchCover(TRENCH_ARTY, tt) : (u.pinned ? 0.8 : 1);
      if (sheltered) cover *= nearMiss(tt);
      if (u.nest) cover = 0; // a concrete emplacement: a shell pins the crew down, it cannot kill them
      damageUnit(state, u, 90 * (1 - (d / (1.6 * K)) * 0.6) * cover, { x: s.x, y: s.y, d }); // heavy shell: twice the old blast (a naval shell: the same damage, over K times the reach)
    }
    if (d < 3.2 * K) {
      // shell shock: men near a heavy impact stay down for several seconds, so a slow but steady
      // bombardment keeps a trench quiet between shells
      u.shock = Math.max(u.shock || 0, 2 + 6 * (1 - d / (3.2 * K)));
      let sup = 120 * (1 - d / (3.2 * K)) + 30;
      if (u.order && u.order.kind === 'charge') sup *= 0.5;
      if (sheltered) sup *= 0.7;
      u.suppression = Math.min(100, u.suppression + sup);
    }
  }
  const RT = Math.ceil(1.3 * K);
  for (let dy = -RT; dy <= RT; dy++) for (let dx = -RT; dx <= RT; dx++) {
    const t = tileAt(map, s.x + dx, s.y + dy);
    if (!t) continue;
    const d = Math.hypot(t.x + 0.5 - s.x, t.y + 0.5 - s.y) / K; // (in units of an ordinary shell's reach)
    if (d > 1.3) continue;
    if (t.wire > 0) t.wire = Math.max(0, t.wire - (d < 0.7 ? 160 : 90));
    if (t.build) { t.build.progress = Math.max(0, t.build.progress - 4); }
    const hit = d < 0.7; // the shell landed on this tile
    // trees and their stems: a tree takes two hits to fall (to a shattered stump or a log), a stump or
    // log one or two more before it is blown to splinters
    if (t.decor === 'tree' || t.decor === 'birch' || t.decor === 'stump' || t.decor === 'log') {
      const hp = t.decorHp ?? (t.decor === 'tree' ? 2 : t.decor === 'stump' ? 2 : 1); // (a slender birch falls to one hit)
      const left = hp - (hit ? 2 : rand() < 0.6 ? 1 : 0);
      if (left > 0) t.decorHp = left;
      else if (t.decor === 'tree' || t.decor === 'birch') { t.decor = rand() < 0.6 ? 'stump' : 'log'; t.decorHp = t.decor === 'stump' ? 2 : 1; }
      else { t.decor = null; t.decorHp = undefined; t.splinters = 1; }
      markChanged(map, t.x, t.y);
    } else if (t.decor === 'ruin' && d < 0.8 && rand() < 0.3) t.decor = null;
    // planks over a trench: a direct hit or two and a near miss or three smash them; whatever battery is on
    // them goes down into the trench with them
    if (t.bridge) {
      t.bridgeHp = (t.bridgeHp ?? BRIDGE_HP) - (hit ? 60 : 22) * (0.75 + rand() * 0.5);
      if (t.bridgeHp <= 0) breakBridge(state, t);
    }
    // trench works: hard to damage, harder still when sandbagged or concreted
    if (t.trench) {
      t.dmg = Math.min(100, (t.dmg || 0) + (hit ? TRENCH_HIT : TRENCH_NEAR) * (0.75 + rand() * 0.5) / TRENCH_TOUGH[t.trench]);
      if (t.build && t.build.type === 'trench' && t.build.repair) t.build.progress = 0; // the repair starts again
      markChanged(map, t.x, t.y);
    }
  }
  const center = tileAt(map, s.x, s.y);
  if (center && center.sea) { // a shell in the sea: a column of white water, no crater, no earth
    const mud = !!center.pond; // (a pool of the broken river: brown with mud, not white)
    state.effects.push({ type: 'impact', water: true, mud, x: s.x, y: s.y, age: 0, life: 3.2, flip: rand() < 0.5, scale: (0.8 + rand() * 0.3) * K }); // (pre-rendered frames, graded as water)
    state.effects.push({ type: 'splash', mud, x: s.x, y: s.y, age: 0, life: 3.4, scale: (0.85 + rand() * 0.35) * K, seed: rand() });
    state.events.push({ type: 'splash', x: s.x, y: s.y }); // (its own sound: a burst under water)
    return;
  }
  if (center && !center.trench) {
    center.crater = Math.min(3, center.crater + K);
    center.mud = 1;
  }
  map.dirty = true;
  (map.changes || (map.changes = [])).push({ x: Math.floor(s.x), y: Math.floor(s.y) });
  state.effects.push({ type: 'boom', x: s.x, y: s.y, age: 0, life: 0.7 });
  state.effects.push({ type: 'smoke', x: s.x, y: s.y, age: 0, life: (5 + rand() * 4) * Math.sqrt(K), shell: true, scale: K });
  state.effects.push({ type: 'impact', x: s.x, y: s.y, age: 0, life: 4.6, flip: rand() < 0.5, scale: (0.85 + rand() * 0.3) * K });
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2, sp = 20 + rand() * 50;
    parts.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vz: 60 + rand() * 90 });
  }
  state.effects.push({ type: 'dirt', x: s.x, y: s.y, age: 0, life: 1.1, parts });
  state.events.push({ type: 'boom', x: s.x, y: s.y });
}

function updateEffects(state, dt) {
  // boats rowed back out to sea after landing their men, until they pass out of sight off the map
  if (state.returning && state.returning.length) {
    for (const b of state.returning) b.x += b.dir * 1.1 * dt;
    state.returning = state.returning.filter((b) => { const t = tileAt(state.map, b.x, b.y); return t && !t.off; });
  }
  if (state.floaters && state.floaters.length) { // the dead and the wreckage drift on the swell, then sink
    for (const f of state.floaters) { f.x += 0.05 * dt; f.y += 0.02 * dt; }
    state.floaters = state.floaters.filter((f) => state.time - f.t < f.life);
  }
  for (const e of state.effects) e.age += dt;
  state.effects = state.effects.filter((e) => e.age < e.life);
  if (state.effects.length > 700) state.effects.splice(0, state.effects.length - 700);
}

function updateCapture(state) {
  const { map } = state;
  let playerCaptured = 0, playerLost = 0;
  for (const u of state.units) {
    if (u.dead || u.type === 'artillery') continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(map, u.x + dx, u.y + dy);
      if (!t) continue;
      const cx = t.x + 0.5, cy = t.y + 0.5;
      if (Math.hypot(u.x - cx, u.y - cy) > 1.0) continue;
      const contested = state.units.some((e) => !e.dead && e.team !== u.team && Math.hypot(e.x - cx, e.y - cy) < 1.5);
      if (contested) continue;
      if (t.build && t.build.team !== u.team) { t.build = null; markChanged(map, t.x, t.y); }
      if (t.trench && t.owner !== u.team) {
        if (u.team === PLAYER) playerCaptured++; else if (t.owner === PLAYER) playerLost++;
        t.owner = u.team;
        markChanged(map, t.x, t.y);
      }
    }
  }
  if (state.captureMsgCooldown <= 0) {
    if (playerCaptured) { pushMessage(state, 'Our troops have taken enemy trenches!', 'good'); state.captureMsgCooldown = 6; }
    else if (playerLost) { pushMessage(state, 'The enemy has broken into our trenches!', 'warn'); state.captureMsgCooldown = 6; }
  }
}

function refreshVisibility(state) {
  const mine = state.units.filter((u) => u.team === PLAYER && !u.dead);
  for (const e of state.units) {
    if (e.team === PLAYER) { e.visible = true; continue; }
    e.visible = !!e.afloat || !!e.onShip || mine.some((u) => Math.hypot(u.x - e.x, u.y - e.y) <= UNIT_TYPES[u.type].sight);
  }
}

function checkVictory(state) {
  const { map } = state;
  for (const team of [PLAYER, ENEMY]) {
    const hq = map.hq[1 - team];
    if (hq.hidden || (hq.byLevel && team === PLAYER)) continue; // (or a level decides when its headquarters are taken) // (a level without one: nothing to take)
    // a side may hold several command posts (hq.posts): all of them must be taken
    const posts = [hq, ...(hq.posts || [])];
    // headquarters taken must be held for HQ_HOLD seconds: a counter-attack retaking it in time saves the day
    const hold = state.hqHold || (state.hqHold = [null, null]);
    if (posts.every((q) => tileAt(map, q.x, q.y).owner === team)) {
      if (hold[team] === null) {
        hold[team] = state.time;
        pushMessage(state, team === PLAYER ? `The enemy headquarters is ours! Hold it for ${HQ_HOLD} seconds.` : `The enemy is in our headquarters! Retake it within ${HQ_HOLD} seconds!`, team === PLAYER ? 'good' : 'warn');
      }
      if (state.time - hold[team] >= HQ_HOLD) {
        state.winner = team;
        pushMessage(state, team === PLAYER ? (posts.length > 1 ? 'The last enemy headquarters has fallen. Victory!' : 'The enemy headquarters has fallen. Victory!') : 'Our headquarters has been overrun.', team === PLAYER ? 'good' : 'loss');
        return;
      }
    } else if (hold[team] !== null) {
      hold[team] = null;
      pushMessage(state, team === PLAYER ? 'The enemy has retaken his headquarters!' : 'Our headquarters is ours again!', team === PLAYER ? 'warn' : 'good');
    }
  }
  for (const team of [PLAYER, ENEMY]) {
    if (state.arriving && state.arriving[team]) continue; // (an army still coming ashore is not broken)
    const alive = state.units.some((u) => u.team === team && u.type !== 'artillery');
    if (!alive && state.resources[team].men < UNIT_TYPES.rifle.cost.men && state.time > 5) {
      state.winner = 1 - team;
      pushMessage(state, team === ENEMY ? 'The enemy army is broken. Victory!' : 'Our army is broken.', team === ENEMY ? 'good' : 'loss');
      return;
    }
  }
}
