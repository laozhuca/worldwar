// Computer commander. Works for either team (used for the enemy, and for both in tests).
import { PLAYER, UNIT_TYPES } from './config.js';
import { tileAt, frontLine } from './map.js';
import { buyUnit, orderMove, orderBarrage, placeBuild, reinforce, teamDir } from './game.js';

const rand = Math.random;

export function createAI(team) {
  return {
    team,
    think: 0.5,
    harass: 35 + rand() * 15,
    defensive: 0,
    offensive: 170 + rand() * 40,
    wireTimer: 8,
    op: null,
  };
}

function median(arr) {
  const v = arr.filter((x) => x >= 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : -1;
}

function densest(units) {
  let best = null, bestN = -1;
  for (const u of units) {
    let n = 0;
    for (const o of units) if (Math.hypot(o.x - u.x, o.y - u.y) < 3) n += o.men;
    if (n > bestN) { bestN = n; best = u; }
  }
  return best;
}

const readyBatteries = (mine) =>
  mine.filter((u) => u.type === 'artillery' && u.ai.role === 'battery' && u.cooldown <= 0 && !u.barrage);

export function updateAI(state, ai, dt) {
  if (ai.op) updateOp(state, ai, dt);
  ai.think -= dt; ai.harass -= dt; ai.defensive -= dt; ai.offensive -= dt; ai.wireTimer -= dt;
  if (ai.think > 0) return;
  ai.think = 1;

  const me = ai.team, foe = 1 - me, dir = teamDir(me);
  const { map } = state;
  const res = state.resources[me];
  const mine = state.units.filter((u) => !u.dead && u.team === me);
  const foes = state.units.filter((u) => !u.dead && u.team === foe);
  const front = frontLine(map, me);
  const frontX = median(front);
  if (frontX < 0) return;

  // --- recruitment
  const count = { rifle: 0, mg: 0, artillery: 0 };
  for (const u of mine) count[u.type]++;
  if (count.artillery < 2) buyUnit(state, me, 'artillery');
  else if (count.mg < 4) buyUnit(state, me, 'mg');
  else if (count.rifle < 15) buyUnit(state, me, 'rifle');

  // --- reinforce depleted units sitting in our trenches
  for (const u of mine) {
    if (!u.order && u.men < UNIT_TYPES[u.type].men * 0.6 && res.men > 12) reinforce(state, u);
  }

  // --- defensive posts along the front trench
  const posts = [];
  for (let y = 2; y < map.h - 1; y += 3) if (front[y] >= 0) posts.push({ x: front[y], y });
  const key = (p) => p.x + ',' + p.y;
  const postKeys = new Set(posts.map(key));
  const taken = new Set();
  for (const u of mine) {
    if (u.ai.role !== 'post') continue;
    if (!postKeys.has(key(u.ai.post))) { u.ai.role = null; continue; }
    taken.add(key(u.ai.post));
  }
  let batteryIdx = 0;
  for (const u of mine) {
    if (u.ai.role === 'battery') batteryIdx++;
  }
  for (const u of mine) {
    if (u.ai.role) continue;
    if (u.type === 'artillery') {
      u.ai.role = 'battery';
      const y = 8 + ((batteryIdx++ * 11) % (map.h - 16));
      orderMove(state, [u], frontX - dir * 8 + 0.5, y + 0.5);
      continue;
    }
    let best = null, bd = Infinity;
    for (const p of posts) {
      if (taken.has(key(p))) continue;
      // MGs prefer the centre of the line.
      const d = Math.hypot(p.x - u.x, p.y - u.y) + (u.type === 'mg' ? Math.abs(p.y - map.h / 2) * 0.5 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      u.ai.role = 'post'; u.ai.post = best; taken.add(key(best));
      orderMove(state, [u], best.x + 0.5, best.y + 0.5);
    } else {
      u.ai.role = 'reserve';
      orderMove(state, [u], frontX - dir * 6 + 0.5, map.h / 2 + (rand() - 0.5) * 14);
    }
  }

  // --- artillery: defensive fire on troops approaching our line
  let ready = readyBatteries(mine);
  const ammoOk = res.ammo > UNIT_TYPES.artillery.shellAmmo * UNIT_TYPES.artillery.barrageShells + 20;
  if (ready.length && ammoOk && ai.defensive <= 0) {
    const threats = foes.filter((f) => !f.inTrench && (f.x - frontX) * dir > -2 && Math.abs(f.x - frontX) < 13);
    if (threats.length) {
      const tgt = densest(threats);
      if (orderBarrage(state, [ready[0]], tgt.x, tgt.y)) ai.defensive = 9;
      ready = readyBatteries(mine);
    }
  }
  // --- artillery: harassing fire on the enemy line
  if (ready.length && ammoOk && ai.harass <= 0 && !ai.op) {
    const tgt = densest(foes.filter((f) => f.type !== 'artillery'));
    if (tgt && orderBarrage(state, [ready[0]], tgt.x, tgt.y)) ai.harass = 30 + rand() * 25;
  }

  // --- counter-attacks and offensives
  if (!ai.op) {
    let lost = null, ld = Infinity;
    for (const t of map.tiles) {
      if (t.trench && t.origOwner === me && t.owner === foe) {
        const d = Math.abs(t.x - frontX);
        if (d < ld) { ld = d; lost = t; }
      }
    }
    const rifles = mine.filter((u) => u.type === 'rifle' && !u.order);
    if (lost) {
      const target = { x: lost.x + 0.5, y: lost.y + 0.5 };
      const units = rifles
        .filter((u) => u.ai.role === 'reserve' || Math.hypot(u.x - target.x, u.y - target.y) < 8)
        .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
        .slice(0, 6);
      if (units.length >= 2) startOp(state, ai, 'counter', target, units, front);
    } else if (ai.offensive <= 0) {
      const reserves = rifles.filter((u) => u.ai.role === 'reserve');
      if (reserves.length >= 4 && res.ammo > 150) {
        const foeFront = frontLine(map, foe);
        const rows = [];
        for (let y = 3; y < map.h - 3; y++) if (foeFront[y] >= 0) rows.push(y);
        if (rows.length) {
          const y = rows[Math.floor(rand() * rows.length)];
          startOp(state, ai, 'attack', { x: foeFront[y] + 0.5, y: y + 0.5 }, reserves.slice(0, 6), front);
        }
      }
      ai.offensive = 160 + rand() * 80;
    }
  }

  // --- repair our wire belts
  if (ai.wireTimer <= 0) {
    ai.wireTimer = 6;
    let placed = 0;
    for (const t of map.tiles) {
      if (placed >= 2 || res.supplies < 60) break;
      if (t.origWire !== me || t.wire > 0 || t.build) continue;
      const near = foes.some((f) => Math.hypot(f.x - t.x - 0.5, f.y - t.y - 0.5) < 6);
      if (near) continue;
      if (placeBuild(state, me, 'wire', t.x + 0.5, t.y + 0.5).ok) placed++;
    }
  }
}

function startOp(state, ai, kind, target, units, front) {
  const dir = teamDir(ai.team);
  ai.op = { kind, target, ids: units.map((u) => u.id), stage: kind === 'attack' ? 'stage' : 'bombard', timer: 30, second: 0 };
  for (const u of units) { u.ai.role = 'op'; u.ai.post = null; }
  if (kind === 'attack') {
    const row = Math.floor(target.y);
    const fx = front[row] >= 0 ? front[row] : target.x - dir * 20;
    orderMove(state, units, fx + 0.5, target.y);
  }
}

function updateOp(state, ai, dt) {
  const op = ai.op;
  const me = ai.team, dir = teamDir(me);
  const units = op.ids.map((id) => state.units.find((u) => u.id === id)).filter((u) => u && !u.dead);
  const end = () => { for (const u of units) u.ai.role = null; ai.op = null; };
  if (!units.length) return end();
  op.timer -= dt;
  const mine = state.units.filter((u) => !u.dead && u.team === me);

  if (op.stage === 'stage') {
    if (units.every((u) => !u.order) || op.timer <= 0) { op.stage = 'bombard'; op.timer = 15; }
  } else if (op.stage === 'bombard') {
    const ready = readyBatteries(mine);
    if (ready.length) {
      orderBarrage(state, [ready[0]], op.target.x, op.target.y);
      op.stage = 'wait';
      op.timer = op.kind === 'attack' ? 2 : 4;
    } else if (op.timer <= 0) { op.stage = 'wait'; op.timer = 0; }
  } else if (op.stage === 'wait') {
    if (op.timer <= 0) {
      orderMove(state, units, op.target.x, op.target.y, 'charge');
      op.stage = 'charge';
      op.timer = 45;
      op.second = 5;
    }
  } else if (op.stage === 'charge') {
    if (op.second > 0) {
      op.second -= dt;
      if (op.second <= 0) {
        const ready = readyBatteries(mine);
        // Lift the barrage beyond the objective as the infantry closes in.
        if (ready.length) orderBarrage(state, [ready[0]], op.target.x + dir * 3, op.target.y);
      }
    }
    const tile = tileAt(state.map, op.target.x, op.target.y);
    const taken = tile && tile.owner === me;
    if (op.timer <= 0 || units.every((u) => !u.order) || (taken && op.timer < 35)) end();
  }
}
