// Core simulation. No DOM access here so it can run headless (tests, AI-vs-AI).
import {
  PLAYER, ENEMY, UNIT_TYPES, HQ_THREAT_RADIUS, TRENCH_COVER, TRENCH_ARTY, BUILD, SUPPLY_INTERVAL, TRENCH_HIT, TRENCH_NEAR, TRENCH_TOUGH, TRENCH_NEAR_MISS, TRENCH_WRECK_LOSS, trenchCover,
  BASE_INCOME, CAPTURE_BONUS, START_RES, SUPPRESSION_DECAY, CHARGE_SPEED, MELEE_RANGE,
  WIRE_SLOW, BUILD_RADIUS_FRIENDLY, BUILD_RADIUS_ENEMY, DIG_RADIUS, DIG_RATE,
} from './config.js';
import { createMap, tileAt, frontLine, teamDir, clampToMap } from './map.js';
import { createAI, updateAI } from './ai.js';

let nextId = 1;
/** Continue unit ids after the highest one in use (loading a saved battle). */
export function setNextId(n) { nextId = n; }
const rand = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export { teamDir };

export function createGame(opts = {}) {
  const { seed = 1916, aiTeams = [ENEMY], season = 'winter', nations = ['uk', 'germany'], start = 'west' } = opts;
  const map = createMap(seed, start === 'east' ? ENEMY : PLAYER);
  const state = {
    season,
    start,
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
    ais: aiTeams.map((t) => createAI(t)),
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
  const u = {
    id: nextId++,
    type, team, x, y,
    men: t.men,
    hp: t.men * t.hpPerMan,
    order: null,
    fireTimer: rand() * (t.fireInterval || 1),
    setup: 0,
    suppression: 0,
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
  };
  const tile = tileAt(state.map, x, y);
  u.inTrench = !!tile && tile.trench > 0;
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
    u.order = { kind, x, y };
    u.digSite = null;
  });
  return n;
}

export function orderHalt(state, units) {
  for (const u of units) { u.order = null; if (u.barrage) { u.barrage = null; u.cooldown = 4; } }
}

/** Order the given batteries to bombard (tx,ty). Returns number of batteries that fired. */
export function orderBarrage(state, units, tx, ty) {
  let n = 0;
  for (const u of units) {
    if (u.dead || u.type !== 'artillery' || u.barrage || u.cooldown > 0) continue;
    const t = UNIT_TYPES.artillery;
    const d = Math.hypot(u.x - tx, u.y - ty);
    if (d > t.artyRange || d < t.artyMinRange) continue; // out of range, or too close for the guns
    u.barrage = { x: tx, y: ty, remaining: t.barrageShells, timer: n * 0.35 };
    u.order = null;
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
  if (!canAfford(res, t.cost)) return 'Not enough resources';
  pay(res, t.cost);
  const hq = state.map.hq[team];
  const dir = teamDir(team);
  const u = spawnUnit(state, type, team, hq.x + 0.5 + dir * 0.8, hq.y + 0.5 + (rand() - 0.5) * 3);
  orderMove(state, [u], hq.x + 0.5 + dir * 4, hq.y + 0.5 + (rand() - 0.5) * 8);
  return u;
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

  for (const ai of state.ais) updateAI(state, ai, dt);

  for (const u of state.units) if (!u.dead) updateUnit(state, u, dt);

  for (const s of state.shells) {
    s.t -= dt;
    if (s.t <= 0) explode(state, s);
  }
  state.shells = state.shells.filter((s) => s.t > 0);

  if (state.units.some((u) => u.dead)) state.units = state.units.filter((u) => !u.dead);

  state.captureTimer -= dt;
  state.captureMsgCooldown -= dt;
  if (state.captureTimer <= 0) { state.captureTimer = 0.5; updateCapture(state); }

  state.visTimer -= dt;
  if (state.visTimer <= 0) { state.visTimer = 0.25; refreshVisibility(state); }

  checkVictory(state);
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
    for (const k of ['men', 'ammo', 'supplies']) {
      gain[k] = Math.round(BASE_INCOME[k] * ramp + CAPTURE_BONUS[k] * captured);
      res[k] += gain[k];
    }
    if (team === PLAYER) {
      pushMessage(state, `Supply convoy arrived: +${gain.men} men, +${gain.ammo} ammo, +${gain.supplies} supplies`, 'supply');
      state.events.push({ type: 'supply' });
    }
  }
}

function terrainFactor(tile) {
  if (!tile) return 1;
  let f = 1;
  if (tile.wire > 0) f *= tile.wire > 50 ? WIRE_SLOW : WIRE_SLOW * 2;
  if (tile.crater) f *= 0.85;
  if (tile.mud) f *= 0.88;
  if (tile.trench) f *= 0.8;
  return f;
}

function updateUnit(state, u, dt) {
  const t = UNIT_TYPES[u.type];
  const tile = tileAt(state.map, u.x, u.y);
  u.inTrench = !!tile && tile.trench > 0;
  u.suppression = Math.max(0, u.suppression - dt * SUPPRESSION_DECAY);
  if (u.shock > 0) { u.shock -= dt; u.suppression = Math.max(u.suppression, 75); }
  const charging = !!(u.order && u.order.kind === 'charge');
  if (charging || u.inTrench) u.pinned = false;
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
  if (charging && closeD < MELEE_RANGE) { u.order = null; u.chargeBonus = 3; }

  // --- movement
  u.moving = false;
  if (u.order) {
    const dx = u.order.x - u.x, dy = u.order.y - u.y;
    const d = Math.hypot(dx, dy);
    let speed = t.speed * terrainFactor(tile) * (u.order.kind === 'charge' ? CHARGE_SPEED : 1);
    if (u.pinned) speed *= 0.3;
    else if (u.order.kind !== 'charge' && u.suppression > 40) speed *= 0.6;
    const step = speed * dt;
    if (d <= step || d < 0.02) {
      u.x = u.order.x; u.y = u.order.y;
      if (u.order.kind === 'charge') u.chargeBonus = 3;
      u.order = null;
    } else {
      u.x += (dx / d) * step; u.y += (dy / d) * step;
      ({ x: u.x, y: u.y } = clampToMap(u.x, u.y));
      u.moving = true;
      u.hx = dx / d; u.hy = dy / d;
      u.roll += step;
      const sx = dx - dy; // screen-space horizontal direction
      if (Math.abs(sx) > 0.05) u.facing = Math.sign(sx);
    }
    u.setup = t.setup || 0;
  } else if (u.setup > 0) {
    u.setup = Math.max(0, u.setup - dt);
  }

  // --- artillery barrage
  if (u.barrage) {
    const b = u.barrage;
    b.timer -= dt;
    if (b.timer <= 0) {
      const res = state.resources[u.team];
      if (res.ammo < t.shellAmmo) {
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
  if (u.closest && closeD < MELEE_RANGE) {
    let dmg = u.men * t.melee * dt * 1.5;
    if (u.chargeBonus > 0) dmg *= 2.0; // the shock of a bayonet charge
    if (u.suppression > 50) dmg *= 0.5;
    damageUnit(state, u.closest, dmg, null, { x: u.x, y: u.y, kind: 'melee' });
    u.closest.suppression = Math.min(100, u.closest.suppression + dt * 10);
    if (rand() < dt * 2) state.events.push({ type: 'rifle', x: u.x, y: u.y });
    return;
  }

  // --- small-arms fire
  u.fireTimer = Math.max(0, u.fireTimer - dt * (u.moving ? 0.6 : 1));
  if (t.range && !charging && u.target && u.setup <= 0 && u.fireTimer <= 0) {
    if (dist(u, u.target) <= t.range) {
      fire(state, u, u.target, t);
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

function findTargets(state, u, t) {
  let best = null, bestScore = Infinity, closest = null, cd = Infinity;
  for (const e of state.units) {
    if (e.dead || e.team === u.team) continue;
    const d = dist(u, e);
    if (d < cd) { cd = d; closest = e; }
    if (t.range && d <= t.range) {
      const score = d * (e.inTrench ? 1.4 : 1) * (e.type === 'artillery' ? 1.3 : 1);
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
  let acc = t.hitChance * (1 - 0.55 * (d / t.range));
  if (u.suppression > 50) acc *= 0.35;
  else if (u.suppression > 25) acc *= 0.7;
  if (u.moving) acc *= 0.6;
  if (target.pinned && !target.inTrench) acc *= 0.6;
  if (target.order && target.order.kind === 'charge') acc *= 1.1;

  let hits = 0;
  for (let i = 0; i < shots; i++) if (rand() < acc) hits++;
  const tt = tileAt(state.map, target.x, target.y);
  const cover = target.inTrench && tt && tt.trench ? trenchCover(TRENCH_COVER, tt) : 1;
  damageUnit(state, target, hits * t.damage * cover, null, { x: u.x, y: u.y, kind: t.burst ? 'mg' : 'rifle' });

  let sup = shots * t.suppressPerShot;
  if (target.order && target.order.kind === 'charge') sup *= 0.5;
  if (target.inTrench) sup *= 0.6;
  target.suppression = Math.min(100, target.suppression + sup);

  u.firing = t.burst ? 0.4 : 0.15;
  const sx = (target.x - u.x) - (target.y - u.y);
  if (Math.abs(sx) > 0.05) u.facing = Math.sign(sx);
  if (d > 0.01) { u.hx = (target.x - u.x) / d; u.hy = (target.y - u.y) / d; }
  state.effects.push({ type: t.burst ? 'tracer' : 'volley', x: u.x, y: u.y, tx: target.x, ty: target.y, age: 0, life: t.burst ? 0.35 : 0.18, team: u.team, n: shots * ammoFactor });
  state.events.push({ type: t.burst ? 'mg' : 'rifle', x: u.x, y: u.y, id: u.id });
}

/**
 * Casualties. `blast` ({x, y, d}) marks a shell burst: some of the fallen are thrown through the air
 * away from it, and many are torn apart; small-arms deaths drop where they stand, intact.
 */
export function damageUnit(state, u, amount, blast = null, shooter = null) {
  if (u.dead || amount <= 0) return;
  const t = UNIT_TYPES[u.type];
  const before = u.men;
  u.hp -= amount;
  u.men = Math.max(0, Math.ceil(u.hp / t.hpPerMan - 1e-6));
  state.stats.lost[u.team] += before - u.men;
  for (let i = 0; i < Math.min(3, before - u.men); i++) fallen(state, u, blast, shooter);
  if (state.decals.length > 260) state.decals = state.decals.filter((d) => state.time - d.t < 140).slice(-260);
  if (u.hp <= 0) {
    u.dead = true;
    u.men = 0;
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
  const body = { x: x0, y: y0, team: u.team, t: state.time, v: torn ? 3 + Math.floor(rand() * 3) : Math.floor(rand() * 3), dir: Math.floor(rand() * 8) };
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
    state.decals.push({ x: land.x, y: land.y, team: u.team, t: state.time, part, dir: Math.floor(rand() * 4),
      fly: { x0, y0, h, dur: 0.6 + h * 0.45, spin: (rand() < 0.5 ? -1 : 1) * (9 + rand() * 9) } });
  }
}

function launchShell(state, u, tx, ty) {
  const d = Math.hypot(tx - u.x, ty - u.y);
  const spread = 1.0 + d * 0.04;
  const a = rand() * Math.PI * 2;
  const r = Math.pow(rand(), 0.7) * spread;
  const flight = 1.2 + d * 0.05;
  state.shells.push({ x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r, t: flight, flight, team: u.team, fromX: u.x, fromY: u.y });
  if (d > 0.01) { u.hx = u.aimX = (tx - u.x) / d; u.hy = u.aimY = (ty - u.y) / d; }
  state.effects.push({ type: 'gunflash', x: u.x, y: u.y, age: 0, life: 0.35, facing: u.facing, hx: u.hx, hy: u.hy });
  state.events.push({ type: 'artyfire', x: u.x, y: u.y });
}

function explode(state, s) {
  const { map } = state;
  const hitTile = tileAt(map, s.x, s.y);
  const outside = !(hitTile && hitTile.trench); // the shell burst outside any trench
  // share of an outside burst that reaches men in this trench tile (wrecked works shelter less)
  const nearMiss = (tt) => TRENCH_NEAR_MISS + (1 - TRENCH_NEAR_MISS) * TRENCH_WRECK_LOSS * Math.min(1, (tt.dmg || 0) / 100);
  for (const u of state.units) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - s.x, u.y - s.y);
    const tt = u.inTrench ? tileAt(map, u.x, u.y) : null;
    const sheltered = outside && tt && tt.trench;
    if (d < 1.6) {
      let cover = tt && tt.trench ? trenchCover(TRENCH_ARTY, tt) : (u.pinned ? 0.8 : 1);
      if (sheltered) cover *= nearMiss(tt);
      damageUnit(state, u, 90 * (1 - (d / 1.6) * 0.6) * cover, { x: s.x, y: s.y, d }); // heavy shell: twice the old blast
    }
    if (d < 3.2) {
      // shell shock: men near a heavy impact stay down for several seconds, so a slow but steady
      // bombardment keeps a trench quiet between shells
      u.shock = Math.max(u.shock || 0, 2 + 6 * (1 - d / 3.2));
      let sup = 120 * (1 - d / 3.2) + 30;
      if (u.order && u.order.kind === 'charge') sup *= 0.5;
      if (sheltered) sup *= 0.7;
      u.suppression = Math.min(100, u.suppression + sup);
    }
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = tileAt(map, s.x + dx, s.y + dy);
    if (!t) continue;
    const d = Math.hypot(t.x + 0.5 - s.x, t.y + 0.5 - s.y);
    if (d > 1.3) continue;
    if (t.wire > 0) t.wire = Math.max(0, t.wire - (d < 0.7 ? 160 : 90));
    if (t.build) { t.build.progress = Math.max(0, t.build.progress - 4); }
    const hit = d < 0.7; // the shell landed on this tile
    // trees and their stems: a tree takes two hits to fall (to a shattered stump or a log), a stump or
    // log one or two more before it is blown to splinters
    if (t.decor === 'tree' || t.decor === 'stump' || t.decor === 'log') {
      const hp = t.decorHp ?? (t.decor === 'tree' ? 2 : t.decor === 'stump' ? 2 : 1);
      const left = hp - (hit ? 2 : rand() < 0.6 ? 1 : 0);
      if (left > 0) t.decorHp = left;
      else if (t.decor === 'tree') { t.decor = rand() < 0.6 ? 'stump' : 'log'; t.decorHp = t.decor === 'stump' ? 2 : 1; }
      else { t.decor = null; t.decorHp = undefined; t.splinters = 1; }
      markChanged(map, t.x, t.y);
    } else if (t.decor === 'ruin' && d < 0.8 && rand() < 0.3) t.decor = null;
    // trench works: hard to damage, harder still when sandbagged or concreted
    if (t.trench) {
      t.dmg = Math.min(100, (t.dmg || 0) + (hit ? TRENCH_HIT : TRENCH_NEAR) * (0.75 + rand() * 0.5) / TRENCH_TOUGH[t.trench]);
      if (t.build && t.build.type === 'trench' && t.build.repair) t.build.progress = 0; // the repair starts again
      markChanged(map, t.x, t.y);
    }
  }
  const center = tileAt(map, s.x, s.y);
  if (center && !center.trench) {
    center.crater = Math.min(3, center.crater + 1);
    center.mud = 1;
  }
  map.dirty = true;
  (map.changes || (map.changes = [])).push({ x: Math.floor(s.x), y: Math.floor(s.y) });
  state.effects.push({ type: 'boom', x: s.x, y: s.y, age: 0, life: 0.7 });
  state.effects.push({ type: 'smoke', x: s.x, y: s.y, age: 0, life: 5 + rand() * 4, shell: true });
  state.effects.push({ type: 'impact', x: s.x, y: s.y, age: 0, life: 4.6, flip: rand() < 0.5, scale: 0.85 + rand() * 0.3 });
  const parts = [];
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2, sp = 20 + rand() * 50;
    parts.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vz: 60 + rand() * 90 });
  }
  state.effects.push({ type: 'dirt', x: s.x, y: s.y, age: 0, life: 1.1, parts });
  state.events.push({ type: 'boom', x: s.x, y: s.y });
}

function updateEffects(state, dt) {
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
    e.visible = mine.some((u) => Math.hypot(u.x - e.x, u.y - e.y) <= UNIT_TYPES[u.type].sight);
  }
}

function checkVictory(state) {
  const { map } = state;
  for (const team of [PLAYER, ENEMY]) {
    const hq = map.hq[1 - team];
    if (tileAt(map, hq.x, hq.y).owner === team) {
      state.winner = team;
      pushMessage(state, team === PLAYER ? 'The enemy headquarters has fallen. Victory!' : 'Our headquarters has been overrun.', team === PLAYER ? 'good' : 'loss');
      return;
    }
  }
  for (const team of [PLAYER, ENEMY]) {
    const alive = state.units.some((u) => u.team === team && u.type !== 'artillery');
    if (!alive && state.resources[team].men < UNIT_TYPES.rifle.cost.men && state.time > 5) {
      state.winner = 1 - team;
      pushMessage(state, team === ENEMY ? 'The enemy army is broken. Victory!' : 'Our army is broken.', team === ENEMY ? 'good' : 'loss');
      return;
    }
  }
}
