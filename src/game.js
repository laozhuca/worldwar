// Core simulation. No DOM access here so it can run headless (tests, AI-vs-AI).
import {
  PLAYER, ENEMY, UNIT_TYPES, TRENCH_COVER, TRENCH_ARTY, BUILD, SUPPLY_INTERVAL,
  BASE_INCOME, CAPTURE_BONUS, START_RES, SUPPRESSION_DECAY, CHARGE_SPEED, MELEE_RANGE,
  WIRE_SLOW, BUILD_RADIUS_FRIENDLY, BUILD_RADIUS_ENEMY, DIG_RADIUS, DIG_RATE,
} from './config.js';
import { createMap, tileAt, frontLine } from './map.js';
import { createAI, updateAI } from './ai.js';

let nextId = 1;
const rand = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const teamDir = (team) => (team === PLAYER ? 1 : -1);

export function createGame(opts = {}) {
  const { seed = 1916, aiTeams = [ENEMY] } = opts;
  const map = createMap(seed);
  const state = {
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
    for (const y of [3, 7, 11, 15, 24, 28, 32, 36]) {
      if (front[y] >= 0) spawnUnit(state, 'rifle', team, front[y] + 0.5, y + 0.5);
    }
    for (const y of [9, 19, 30]) {
      if (front[y] >= 0) spawnUnit(state, 'mg', team, front[y] + 0.5, y + 0.5);
    }
    // Support line reserves and batteries.
    const fx = front[20];
    const support = nearestTrenchInRow(map, team, fx - dir * 6, 20);
    spawnUnit(state, 'rifle', team, support + 0.5, 18.5);
    spawnUnit(state, 'rifle', team, support + 0.5, 22.5);
    spawnUnit(state, 'artillery', team, fx - dir * 8 + 0.5, 13.5);
    spawnUnit(state, 'artillery', team, fx - dir * 8 + 0.5, 26.5);
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
  const list = units.filter((u) => !u.dead && !(kind === 'charge' && u.type === 'artillery'));
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
    x = clamp(x, 0.3, map.w - 0.3);
    y = clamp(y, 0.3, map.h - 0.3);
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
    if (Math.hypot(u.x - tx, u.y - ty) > t.artyRange) continue;
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

export function buyUnit(state, team, type) {
  const t = UNIT_TYPES[type];
  const res = state.resources[team];
  if (!canAfford(res, t.cost)) return 'Not enough resources';
  pay(res, t.cost);
  const hq = state.map.hq[team];
  const dir = teamDir(team);
  const u = spawnUnit(state, type, team, hq.x + 0.5 + dir * 0.8, hq.y + 0.5 + (rand() - 0.5) * 3);
  orderMove(state, [u], hq.x + 0.5 + dir * 4, hq.y + 0.5 + (rand() - 0.5) * 8);
  return u;
}

export function canReinforce(state, u) {
  if (u.dead) return false;
  const full = UNIT_TYPES[u.type].men;
  if (u.men >= full) return false;
  const tile = tileAt(state.map, u.x, u.y);
  const hq = state.map.hq[u.team];
  const nearHq = Math.hypot(u.x - hq.x, u.y - hq.y) < 8;
  return nearHq || !!(tile && tile.trench && tile.owner === u.team);
}

export function reinforce(state, u) {
  if (!canReinforce(state, u)) return 'Must be in a friendly trench to reinforce';
  const t = UNIT_TYPES[u.type];
  const res = state.resources[u.team];
  const missing = t.men - u.men;
  const n = Math.min(missing, Math.floor(res.men), Math.floor(res.supplies));
  if (n <= 0) return 'Not enough men or supplies';
  res.men -= n; res.supplies -= n;
  u.hp = Math.min(t.men * t.hpPerMan, u.hp + n * t.hpPerMan);
  u.men = Math.ceil(u.hp / t.hpPerMan - 1e-6);
  return n;
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
  if (type === 'trench' && (t.trench || t.wire)) return { ok: false, reason: 'Tile not clear' };
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

export function placeBuild(state, team, type, x, y) {
  const c = canBuild(state, team, type, x, y);
  if (!c.ok) return c;
  const t = tileAt(state.map, x, y);
  state.resources[team].supplies -= BUILD[type].supplies;
  t.build = { type, team, progress: 0, work: BUILD[type].work };
  state.map.dirty = true;
  return { ok: true };
}

export function cancelBuild(state, team, x, y) {
  const t = tileAt(state.map, x, y);
  if (!t || !t.build || t.build.team !== team) return false;
  state.resources[team].supplies += Math.floor(BUILD[t.build.type].supplies * 0.5);
  t.build = null;
  state.map.dirty = true;
  return true;
}

function completeBuild(state, tile) {
  const b = tile.build;
  tile.build = null;
  if (b.type === 'trench') { tile.trench = 1; tile.owner = b.team; tile.decor = null; tile.crater = 0; }
  else if (b.type === 'upgrade') { tile.trench = Math.min(3, tile.trench + 1); }
  else if (b.type === 'wire') { tile.wire = 100; tile.decor = null; }
  state.map.dirty = true;
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
      u.moving = true;
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
    if (u.chargeBonus > 0) dmg *= 1.5;
    if (u.suppression > 50) dmg *= 0.5;
    damageUnit(state, u.closest, dmg);
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
  const cover = target.inTrench && tt ? TRENCH_COVER[tt.trench] : 1;
  damageUnit(state, target, hits * t.damage * cover);

  let sup = shots * t.suppressPerShot;
  if (target.order && target.order.kind === 'charge') sup *= 0.5;
  if (target.inTrench) sup *= 0.6;
  target.suppression = Math.min(100, target.suppression + sup);

  u.firing = t.burst ? 0.4 : 0.15;
  const sx = (target.x - u.x) - (target.y - u.y);
  if (Math.abs(sx) > 0.05) u.facing = Math.sign(sx);
  state.effects.push({ type: t.burst ? 'tracer' : 'volley', x: u.x, y: u.y, tx: target.x, ty: target.y, age: 0, life: t.burst ? 0.35 : 0.18, team: u.team, n: shots * ammoFactor });
  state.events.push({ type: t.burst ? 'mg' : 'rifle', x: u.x, y: u.y });
}

export function damageUnit(state, u, amount) {
  if (u.dead || amount <= 0) return;
  const t = UNIT_TYPES[u.type];
  const before = u.men;
  u.hp -= amount;
  u.men = Math.max(0, Math.ceil(u.hp / t.hpPerMan - 1e-6));
  state.stats.lost[u.team] += before - u.men;
  for (let i = 0; i < Math.min(3, before - u.men); i++) {
    state.decals.push({ x: u.x + (rand() - 0.5) * 0.7, y: u.y + (rand() - 0.5) * 0.7, team: u.team, t: state.time, rot: (rand() - 0.5) * 1.2 });
  }
  if (state.decals.length > 260) state.decals = state.decals.filter((d) => state.time - d.t < 140).slice(-260);
  if (u.hp <= 0) {
    u.dead = true;
    u.men = 0;
    if (u.team === PLAYER) pushMessage(state, `${t.name} wiped out`, 'loss');
    state.effects.push({ type: 'smoke', x: u.x, y: u.y, age: 0, life: 2.5 });
  }
}

function launchShell(state, u, tx, ty) {
  const d = Math.hypot(tx - u.x, ty - u.y);
  const spread = 1.0 + d * 0.04;
  const a = rand() * Math.PI * 2;
  const r = Math.pow(rand(), 0.7) * spread;
  const flight = 1.2 + d * 0.05;
  state.shells.push({ x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r, t: flight, flight, team: u.team, fromX: u.x, fromY: u.y });
  state.effects.push({ type: 'gunflash', x: u.x, y: u.y, age: 0, life: 0.35, facing: u.facing });
  state.events.push({ type: 'artyfire', x: u.x, y: u.y });
}

function explode(state, s) {
  const { map } = state;
  for (const u of state.units) {
    if (u.dead) continue;
    const d = Math.hypot(u.x - s.x, u.y - s.y);
    if (d < 1.6) {
      const tt = tileAt(map, u.x, u.y);
      const cover = u.inTrench && tt ? TRENCH_ARTY[tt.trench] : (u.pinned ? 0.8 : 1);
      damageUnit(state, u, 45 * (1 - (d / 1.6) * 0.6) * cover);
    }
    if (d < 3.2) {
      let sup = 60 * (1 - d / 3.2) + 15;
      if (u.order && u.order.kind === 'charge') sup *= 0.5;
      u.suppression = Math.min(100, u.suppression + sup);
    }
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = tileAt(map, s.x + dx, s.y + dy);
    if (!t) continue;
    const d = Math.hypot(t.x + 0.5 - s.x, t.y + 0.5 - s.y);
    if (d > 1.3) continue;
    if (t.wire > 0) t.wire = Math.max(0, t.wire - (d < 0.7 ? 80 : 45));
    if (t.build) { t.build.progress = Math.max(0, t.build.progress - 4); }
    if (t.decor === 'tree' && rand() < 0.5) t.decor = 'stump';
    else if (t.decor === 'ruin' && d < 0.8 && rand() < 0.3) t.decor = null;
  }
  const center = tileAt(map, s.x, s.y);
  if (center) {
    if (center.trench) {
      if (center.trench > 1 && rand() < 0.3) center.trench--;
    } else {
      center.crater = Math.min(3, center.crater + 1);
      center.mud = 1;
    }
  }
  map.dirty = true;
  state.effects.push({ type: 'boom', x: s.x, y: s.y, age: 0, life: 0.7 });
  state.effects.push({ type: 'smoke', x: s.x, y: s.y, age: 0, life: 5 + rand() * 4 });
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
      if (t.build && t.build.team !== u.team) { t.build = null; map.dirty = true; }
      if (t.trench && t.owner !== u.team) {
        if (u.team === PLAYER) playerCaptured++; else if (t.owner === PLAYER) playerLost++;
        t.owner = u.team;
        map.dirty = true;
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
