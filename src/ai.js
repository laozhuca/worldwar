// Computer commander. Works for either team (used for the enemy, and for both in tests).
import { PLAYER, UNIT_TYPES } from './config.js';
import { tileAt, frontLine, clampToMap } from './map.js';
import { buyUnit, orderMove, orderBarrage, orderHalt, placeBuild, teamDir } from './game.js';

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
  else if (count.rifle < 15 || (count.rifle < 22 && res.men > 24)) buyUnit(state, me, 'rifle');
  else if (count.artillery < 3 && res.supplies > 120) buyUnit(state, me, 'artillery');

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
      // batteries spread along the line behind the front (the battlefield narrows towards the rear)
      const y = map.h / 2 - 8 + ((batteryIdx++ * 7) % 17);
      const p = clampToMap(frontX - dir * 8 + 0.5, y, 1.5);
      orderMove(state, [u], p.x, p.y);
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

  // --- batteries follow an offensive: a gun out of range of the objective moves up behind it
  if (ai.op) {
    const A = UNIT_TYPES.artillery, tg = ai.op.target;
    for (const g of mine) {
      if (g.type !== 'artillery' || g.barrage || g.order) continue;
      const d = Math.hypot(g.x - tg.x, g.y - tg.y);
      if (d > A.artyRange - 2 || d < A.artyMinRange + 1) {
        const want = A.artyRange * 0.55, k = (d - want) / Math.max(1, d);
        const p = clampToMap(g.x + (tg.x - g.x) * k, g.y + (tg.y - g.y) * k, 1.5);
        orderMove(state, [g], p.x, p.y);
      }
    }
  }

  // --- artillery: defensive fire on troops approaching our line
  let ready = readyBatteries(mine);
  const ammoOk = res.ammo > UNIT_TYPES.artillery.shellAmmo * UNIT_TYPES.artillery.barrageShells + 20;
  if (ready.length > (ai.op ? 1 : 0) && ammoOk && ai.defensive <= 0) {
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
      else ai.offensive = Math.min(ai.offensive, 20);
    } else if (ai.offensive <= 0) {
      // an offensive at the weakest point of their line: few defenders, little wire, towards their HQ
      const reserves = rifles.filter((u) => u.ai.role === 'reserve' || u.ai.role === 'hold');
      if (reserves.length >= 3 && res.ammo > 120) {
        const foeFront = frontLine(map, foe), foeHq = map.hq[foe];
        let best = null, bs = Infinity;
        for (let y = 3; y < map.h - 3; y++) {
          if (foeFront[y] < 0) continue;
          const tx = foeFront[y] + 0.5, ty = y + 0.5;
          const men = foes.filter((f) => f.type !== 'artillery' && Math.hypot(f.x - tx, f.y - ty) < 6).reduce((a, f) => a + f.men * (f.type === 'mg' ? 3 : 1), 0);
          let wire = 0;
          for (let k = 1; k <= 5; k++) { const t = tileAt(map, tx - dir * k, ty); if (t && t.wire > 0) wire++; }
          const score = men * 2 + wire * 4 + Math.abs(ty - foeHq.y - 0.5) * 0.6 + rand() * 4;
          if (score < bs) { bs = score; best = { x: tx, y: ty }; }
        }
        if (best) {
          // reserves, topped up from squads holding our line near the point of attack
          const line = rifles.filter((u) => u.ai.role === 'post' && Math.abs(u.y - best.y) < 7 && u.men >= 4)
            .sort((a, b) => Math.abs(a.y - best.y) - Math.abs(b.y - best.y));
          const force = reserves.concat(line).slice(0, 8);
          if (force.length >= 4) startOp(state, ai, 'attack', best, force, front);
        }
      }
      ai.offensive = ai.op ? 120 + rand() * 60 : 25;
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
    // dig out our badly damaged trench sections
    for (const t of map.tiles) {
      if (placed >= 3 || res.supplies < 50) break;
      if (!t.trench || t.owner !== me || (t.dmg || 0) < 40 || t.build) continue;
      if (foes.some((f) => Math.hypot(f.x - t.x - 0.5, f.y - t.y - 0.5) < 5)) continue;
      if (placeBuild(state, me, 'trench', t.x + 0.5, t.y + 0.5).ok) placed++;
    }
  }
}

function startOp(state, ai, kind, target, units, front) {
  const dir = teamDir(ai.team);
  ai.op = { kind, target, ids: units.map((u) => u.id), stage: 'assemble', timer: 40, steps: 0 };
  for (const u of units) { u.ai.role = 'op'; u.ai.post = null; }
  // jump-off: our own trench facing the objective
  const row = Math.floor(target.y);
  const fx = front[row] >= 0 ? front[row] + 0.5 : target.x - dir * 8;
  orderMove(state, units, fx, target.y);
}

/** Living units of the operation, with more men from the reserve when it is wearing thin. */
function opUnits(state, ai) {
  const op = ai.op;
  let units = op.ids.map((id) => state.units.find((u) => u.id === id)).filter((u) => u && !u.dead);
  const men = units.reduce((a, u) => a + u.men, 0);
  if (men < 22 && op.stage !== 'charge') {
    const extra = state.units.filter((u) => !u.dead && u.team === ai.team && u.type === 'rifle' && u.ai.role === 'reserve' && !u.order).slice(0, 2);
    for (const u of extra) {
      u.ai.role = 'op'; op.ids.push(u.id);
      const c = units[0] || op.target;
      orderMove(state, [u], c.x - teamDir(ai.team) * 1.5, c.y);
    }
    units = units.concat(extra);
  }
  return units;
}

/** The next objective beyond the one just taken: their nearest trench further on in this sector, then their HQ. */
function nextObjective(state, ai, from) {
  const me = ai.team, foe = 1 - me, dir = teamDir(me), hq = state.map.hq[foe];
  let best = null, bd = Infinity;
  for (const t of state.map.tiles) {
    if (!t.trench || t.owner !== foe) continue;
    const ahead = (t.x + 0.5 - from.x) * dir;
    if (ahead < 1.5 || Math.abs(t.y + 0.5 - from.y) > 6) continue;
    const d = ahead + Math.abs(t.y + 0.5 - from.y) * 0.7 + Math.abs(t.y - hq.y) * 0.15;
    if (d < bd) { bd = d; best = { x: t.x + 0.5, y: t.y + 0.5 }; }
  }
  return best || { x: hq.x + 0.5, y: hq.y + 0.5 };
}

function updateOp(state, ai, dt) {
  const op = ai.op;
  const me = ai.team, foe = 1 - me, dir = teamDir(me);
  const units = opUnits(state, ai);
  const men = units.reduce((a, u) => a + u.men, 0);
  // the operation ends: the men dig in where they stand, they do not walk back
  const end = () => {
    for (const u of units) { u.ai.role = 'hold'; u.order = null; }
    ai.op = null;
  };
  if (!units.length || men < 7) return end(); // spent
  op.timer -= dt;
  const mine = state.units.filter((u) => !u.dead && u.team === me);
  const foes = state.units.filter((u) => !u.dead && u.team === foe);
  const T = op.target, A = UNIT_TYPES.artillery;
  const inRange = (g, x, y) => { const d = Math.hypot(g.x - x, g.y - y); return d <= A.artyRange && d >= A.artyMinRange; };

  if (op.stage === 'assemble') {
    if (units.every((u) => !u.order) || op.timer <= 0) { op.stage = 'prep'; op.timer = 25; op.guns = []; }
  } else if (op.stage === 'prep') {
    // every ready battery in range: the objective, then any machine gun covering the approach
    const ready = readyBatteries(mine).filter((g) => inRange(g, T.x, T.y));
    if (ready.length) {
      const mgs = foes.filter((f) => f.type === 'mg' && Math.hypot(f.x - T.x, f.y - T.y) < 7 && Math.hypot(f.x - T.x, f.y - T.y) > 2.5);
      ready.forEach((g, i) => {
        const tg = i > 0 && mgs[i - 1] && inRange(g, mgs[i - 1].x, mgs[i - 1].y) ? mgs[i - 1] : T;
        if (orderBarrage(state, [g], tg.x, tg.y)) op.guns.push({ id: g.id, x: tg.x, y: tg.y });
      });
      op.stage = 'wait'; op.timer = 60;
    } else if (op.timer <= 0) { op.stage = 'wait'; op.timer = 0; }
  } else if (op.stage === 'wait') {
    // go so as to arrive as the last shells on the objective fall
    const lead = units.reduce((a, u) => Math.min(a, Math.hypot(u.x - T.x, u.y - T.y)), Infinity);
    const travel = lead / (UNIT_TYPES.rifle.speed * 2);
    const onTarget = op.guns.map((g) => state.units.find((u) => u.id === g.id)).filter((g) => g && g.barrage && Math.hypot(g.barrage.x - T.x, g.barrage.y - T.y) < 1);
    const left = onTarget.reduce((a, g) => Math.max(a, g.barrage.remaining * A.shellInterval), 0);
    if (left <= travel + 2 || op.timer <= 0) {
      orderMove(state, units, T.x, T.y, 'charge');
      op.stage = 'charge'; op.timer = 40;
    }
  } else if (op.stage === 'charge') {
    // lift the barrage off the objective as the first men get close
    const lead = units.reduce((a, u) => Math.min(a, Math.hypot(u.x - T.x, u.y - T.y)), Infinity);
    if (lead < 3.5) for (const g of op.guns) { const gun = state.units.find((u) => u.id === g.id); if (gun && gun.barrage && Math.hypot(gun.barrage.x - T.x, gun.barrage.y - T.y) < 1.5) orderHalt(state, [gun]); }
    const tile = tileAt(state.map, T.x, T.y);
    const clear = !foes.some((f) => f.type !== 'artillery' && Math.hypot(f.x - T.x, f.y - T.y) < 2.5);
    const taken = tile && tile.owner === me && clear;
    if (taken) {
      op.steps++;
      if (op.kind === 'counter' || op.steps > 6) return end();
      // on to the next objective; a squad stays to hold this one
      const hold = units.length > 3 ? units.reduce((a, u) => (u.men < a.men ? u : a)) : null;
      if (hold) { op.ids = op.ids.filter((id) => id !== hold.id); hold.ai.role = 'hold'; hold.order = null; }
      op.target = nextObjective(state, ai, T);
      op.stage = 'regroup'; op.timer = 12;
      const rest = units.filter((u) => u !== hold);
      orderMove(state, rest, T.x, T.y);
    } else if (op.timer <= 0 || units.every((u) => !u.order)) {
      // the charge stalled short of the trench: go to ground and try again with the guns
      if (units.every((u) => !u.order) && !taken && (op.retries = (op.retries || 0) + 1) <= 2) { op.stage = 'prep'; op.timer = 25; op.guns = []; }
      else return end();
    }
  } else if (op.stage === 'regroup') {
    if (units.every((u) => !u.order) || op.timer <= 0) { op.stage = 'prep'; op.timer = 25; op.guns = []; }
  }
}
