// Computer commander. Works for either team (used for the enemy, and for both in tests).
import { PLAYER, UNIT_TYPES, DIFFICULTY } from './config.js';
import { tileAt, frontLine, clampToMap } from './map.js';
import { buyUnit, orderMove, orderBarrage, orderHalt, placeBuild, teamDir } from './game.js';

const rand = Math.random;
/** A tactic the commander's level allows (a level without the flag: allowed - campaign levels built on the old table). */
const can = (ai, k) => ((ai.level || DIFFICULTY.medium)[k] ?? true) !== false;

/**
 * The commander's version, shown in the game (top bar) and on the campaign screen, so a report of how the enemy
 * behaved can be matched to the code. Raise it with every change to how the computer plays.
 * 1.x: the first commander. 2.0: safer routes (trenches, round the wire), the double across the open, every
 * resource into units, large prepared attacks with every gun, falling back, counter-battery fire.
 * 2.1: minds the men's wind (no charge until they have it back); batteries in pairs on the
 * high-value targets (machine guns, guns), above all in support of an attack and while it goes in; more batteries;
 * batteries kept behind our own trench line unless a target deep in the enemy's ground calls them forward.
 * 2.2: the difficulty levels differ in how he fights, not only in what he has (config.js DIFFICULTY: reactions,
 * marksmanship, routes, the double, preparation, counter-battery and concentrated fire, falling back, repairs).
 */
export const AI_VERSION = '2.2';

export function createAI(team, difficulty = 'medium') {
  const level = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  return {
    team,
    level,
    think: 0.5,
    harass: 35 + rand() * 15,
    defensive: 0,
    offensive: level.firstAttack + rand() * 40,
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

/** The nearest tile of our own trench to (x, y) within r tiles (optionally only those that pass `ok`), or null. */
function ownTrenchNear(state, team, x, y, r, ok = null) {
  const { map } = state;
  let best = null, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = tileAt(map, x + dx, y + dy);
    if (!t || !t.trench || t.owner !== team || (ok && !ok(t))) continue;
    const d = Math.hypot(t.x + 0.5 - x, t.y + 0.5 - y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Have the men their wind back for a charge? (enough of it to run the whole way: on average across the riflemen) */
const rested = (units) => { const r = units.filter((u) => u.type === 'rifle'); return !r.length || r.reduce((a, u) => a + (u.stamina ?? 100), 0) / r.length >= 45; };

const readyBatteries = (mine) =>
  mine.filter((u) => u.type === 'artillery' && u.ai.role === 'battery' && u.cooldown <= 0 && !u.barrage);

/**
 * The guns of an enemy that only holds its positions: they shell the attackers' infantry when it is out in
 * the open near the defenders, a battery at a time, every defensiveGap seconds.
 */
function staticGuns(state, ai, mine, foes, res, L) {
  if (ai.defensive > 0 || res.ammo < UNIT_TYPES.artillery.shellAmmo * UNIT_TYPES.artillery.barrageShells) return;
  const guns = mine.filter((u) => u.type === 'artillery' && u.cooldown <= 0 && !u.barrage && !u.order);
  if (!guns.length) return;
  const posts = mine.filter((u) => u.type !== 'artillery');
  const threats = foes.filter((f) => f.type !== 'artillery' && !f.inTrench && posts.some((p) => Math.hypot(p.x - f.x, p.y - f.y) < 11));
  if (!threats.length) return;
  const tgt = densest(threats);
  if (orderBarrage(state, [guns[0]], tgt.x, tgt.y)) ai.defensive = L.defensiveGap;
}

export function updateAI(state, ai, dt) {
  if (ai.op) updateOp(state, ai, dt);
  ai.think -= dt; ai.harass -= dt; ai.defensive -= dt; ai.offensive -= dt; ai.wireTimer -= dt;
  if (ai.think > 0) return;
  ai.think = (ai.level || DIFFICULTY.medium).think || 1; // (how fast he reacts)

  const me = ai.team, foe = 1 - me, dir = teamDir(me);
  const { map } = state;
  const res = state.resources[me];
  const L = ai.level || DIFFICULTY.medium;
  const mine = state.units.filter((u) => !u.dead && u.team === me);
  const foes = state.units.filter((u) => !u.dead && u.team === foe);
  if (L.static) { // holding fixed positions (a campaign level): no recruiting, no moves, only the guns
    staticGuns(state, ai, mine, foes, res, L);
    return;
  }
  const front = frontLine(map, me);
  const frontX = median(front);
  if (frontX < 0) return;

  // --- recruitment: every man, round and sandbag goes into new units, as fast as they come in - guns enough to
  // prepare an attack (three, and one more for every five squads, up to six), machine guns to hold the line (one for
  // every four squads), the rest riflemen
  const count = { rifle: 0, mg: 0, artillery: 0, tank: 0 };
  for (const u of mine) count[u.type] = (count[u.type] || 0) + 1;
  for (let n = 0; n < 4; n++) {
    const wantGuns = Math.min(6, 3 + Math.floor(count.rifle / 5)), wantMg = Math.min(8, 3 + Math.floor(count.rifle / 4));
    const order = count.artillery < wantGuns ? ['artillery', 'mg', 'rifle'] : count.mg < wantMg ? ['mg', 'rifle'] : ['rifle'];
    let got = null;
    for (const type of order) {
      if (type === 'rifle' && count.rifle >= L.rifleCap * 1.6) continue;
      const r = buyUnit(state, me, type);
      if (r && typeof r === 'object') { got = type; break; }
    }
    if (!got) break;
    count[got]++;
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
      const t = ownTrenchNear(state, me, frontX - dir * 6 + 0.5, map.h / 2 + (rand() - 0.5) * 14, 6);
      if (t) orderMove(state, [u], t.x + 0.5, t.y + 0.5); else orderMove(state, [u], frontX - dir * 6 + 0.5, map.h / 2 + (rand() - 0.5) * 14);
    }
  }

  // --- batteries keep behind our own trench line: one out of range of an offensive's objective moves only as far
  // as it must (forward into no man's land only when the target lies too deep for it from our side), one too close
  // falls back; with no offensive, one left out in front of our line comes back behind it
  {
    const A = UNIT_TYPES.artillery, tg = ai.op && ai.op.target;
    const ourLine = (y) => { const f = front[Math.max(0, Math.min(map.h - 1, Math.floor(y)))]; return f >= 0 ? f + 0.5 : frontX + 0.5; };
    const reach = (p, t) => { const d = Math.hypot(p.x - t.x, p.y - t.y); return d <= A.artyRange - 1 && d >= A.artyMinRange + 1; };
    for (const g of mine) {
      if (g.type !== 'artillery' || g.barrage || g.order || g.ai.role !== 'battery') continue;
      if (tg) {
        const d = Math.hypot(g.x - tg.x, g.y - tg.y);
        if (d <= A.artyRange - 2 && d >= A.artyMinRange + 1) continue;
        const want = d > A.artyRange - 2 ? A.artyRange - 6 : A.artyMinRange + 5, k = (d - want) / Math.max(1, d);
        let p = clampToMap(g.x + (tg.x - g.x) * k, g.y + (tg.y - g.y) * k, 1.5);
        const back = clampToMap(ourLine(p.y) - dir * 3, p.y, 1.5); // (the same row, just behind our line)
        if ((p.x - ourLine(p.y)) * dir > -2 && reach(back, tg)) p = back;
        orderMove(state, [g], p.x, p.y);
      } else if ((g.x - ourLine(g.y)) * dir > -1) {
        const p = clampToMap(ourLine(g.y) - dir * 5, g.y, 1.5);
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
      // two batteries on the attackers out in the open if two can be spared
      const tgt = densest(threats);
      const n = Math.min(ready.length - (ai.op ? 1 : 0), can(ai, 'concentrate') ? 2 : 1);
      let fired = false;
      for (let k = 0; k < n; k++) if (orderBarrage(state, [ready[k]], tgt.x + (k ? (rand() - 0.5) * 2 : 0), tgt.y + (k ? (rand() - 0.5) * 2 : 0))) fired = true;
      if (fired) ai.defensive = L.defensiveGap;
      ready = readyBatteries(mine);
    }
  }
  // --- artillery: harassing fire on the enemy line
  if (ready.length && ammoOk && ai.harass <= 0 && !ai.op) {
    // their batteries first (counter-battery fire), then their machine guns, then wherever their men are thickest
    const A = UNIT_TYPES.artillery, reach = (f) => { const d = Math.hypot(f.x - ready[0].x, f.y - ready[0].y); return d <= A.artyRange && d >= A.artyMinRange; };
    const guns = foes.filter((f) => f.type === 'artillery' && reach(f)), mgs = foes.filter((f) => f.type === 'mg' && reach(f));
    const tgt = (can(ai, 'counterBattery') ? guns[0] || densest(mgs) : null) || densest(foes.filter((f) => f.type !== 'artillery'));
    // two batteries together on a high-value target (a gun or a machine gun), to be sure of it
    const pair = tgt && tgt.type !== 'rifle' && can(ai, 'concentrate') ? ready.slice(0, 2) : ready.slice(0, 1);
    let fired = false;
    for (const g of pair) if (tgt && orderBarrage(state, [g], tgt.x, tgt.y)) fired = true;
    if (fired) ai.harass = 30 + rand() * 25;
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
      // a big push, not a trickle: he waits until he has a large force together (or has waited long enough)
      const need = L.rush ? 2 : Math.max(4, Math.round(L.force * 1.25));
      ai.massing = (ai.massing || 0) + 1;
      const ready2 = reserves.length >= need || (reserves.length >= 3 && ai.massing > L.attackGap[1]);
      if (ready2 && res.ammo > 120) {
        ai.massing = 0;
        const foeFront = frontLine(map, foe), foeHq = map.hq[foe];
        let best = null, bs = Infinity;
        for (let y = 3; y < map.h - 3; y++) {
          if (foeFront[y] < 0) continue;
          const tx = foeFront[y] + 0.5, ty = y + 0.5;
          const men = foes.filter((f) => f.type !== 'artillery' && Math.hypot(f.x - tx, f.y - ty) < 6).reduce((a, f) => a + f.men * (f.type === 'mg' ? 3 : 1), 0);
          let wire = 0;
          for (let k = 1; k <= 5; k++) { const t = tileAt(map, tx - dir * k, ty); if (t && t.wire > 0) wire++; }
          const score = men * 2 + wire * 4 + Math.abs(ty - foeHq.y - 0.5) * (L.centre || 0.6) + rand() * 4; // (a level may make him go for the centre)
          if (score < bs) { bs = score; best = { x: tx, y: ty }; }
        }
        // rushing: once he is into their works he presses on from his furthest point towards their
        // headquarters, never back to their front line behind him
        if (L.rush) {
          const ahead = mine.filter((u) => u.type === 'rifle' && !u.dead && !u.afloat && !u.onShip && foeFront[Math.floor(u.y)] >= 0 && (u.x - foeFront[Math.floor(u.y)] - 0.5) * dir > -1.5);
          if (ahead.length) { const lead = ahead.reduce((a, u) => ((u.x - a.x) * dir > 0 ? u : a)); best = nextObjective(state, ai, { x: lead.x, y: lead.y }); }
        }
        if (best) {
          // reserves, topped up from squads holding our line near the point of attack
          const line = rifles.filter((u) => u.ai.role === 'post' && Math.abs(u.y - best.y) < 7 && u.men >= 4)
            .sort((a, b) => Math.abs(a.y - best.y) - Math.abs(b.y - best.y));
          const force = reserves.concat(line).slice(0, Math.max(L.force, reserves.length)); // (every reserve goes)
          if (force.length >= (L.rush ? 2 : 4)) startOp(state, ai, 'attack', best, force, front);
        }
      }
      ai.offensive = ai.op ? L.attackGap[0] + rand() * (L.attackGap[1] - L.attackGap[0]) : 25;
    }
  }

  // --- survival: a squad cut down to a couple of men leaves the attack for the nearest trench of ours behind it;
  // and squads holding ground or waiting in reserve out in the open get down into a trench nearby
  if (can(ai, 'fallBack')) for (const u of mine) {
    if (u.type !== 'rifle' || u.dead) continue;
    const t = tileAt(map, u.x, u.y);
    if (u.ai.role === 'op' && u.men <= 3 && !(u.order && u.order.kind === 'charge' && u.closest && Math.hypot(u.closest.x - u.x, u.closest.y - u.y) < 2)) {
      const back = ownTrenchNear(state, me, u.x - dir * 3, u.y, 8, (q) => (q.x + 0.5 - u.x) * dir <= 0.5);
      if (back) { if (ai.op) ai.op.ids = ai.op.ids.filter((id) => id !== u.id); u.ai.role = 'hold'; orderMove(state, [u], back.x + 0.5, back.y + 0.5); }
    } else if ((u.ai.role === 'hold' || u.ai.role === 'reserve') && !u.order && !(t && t.trench)) {
      // out in the open with no attack going on: into the nearest trench of ours, back the way it came if need be
      const near = ownTrenchNear(state, me, u.x, u.y, 4) || ownTrenchNear(state, me, u.x - dir * 5, u.y, 9);
      if (near) orderMove(state, [u], near.x + 0.5, near.y + 0.5);
    }
  }

  // --- repair our wire belts
  if (ai.wireTimer <= 0 && can(ai, 'repair')) {
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
  ai.stats = ai.stats || { attacks: 0, counters: 0 }; ai.stats[kind === 'attack' ? 'attacks' : 'counters']++; // (for tuning)
  ai.op = { kind, target, ids: units.map((u) => u.id), stage: 'assemble', timer: 40, steps: 0 };
  for (const u of units) { u.ai.role = 'op'; u.ai.post = null; }
  // rushing: no going back to form up - every man goes for the objective from where he stands
  if ((ai.level || DIFFICULTY.medium).rush) { ai.op.stage = 'charge'; ai.op.timer = 40; ai.op.guns = []; orderMove(state, units, target.x, target.y, 'charge'); return; }
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
  if (men < 22 && op.stage !== 'charge' && (ai.level || DIFFICULTY.medium).topUp) {
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
    for (const u of units) { u.ai.role = 'hold'; if (u.order && u.order.kind === 'charge') u.order = null; } // (a charge stops; men falling back keep going)
    ai.op = null;
  };
  if (!units.length || men < 7) return end(); // spent
  op.timer -= dt;
  const mine = state.units.filter((u) => !u.dead && u.team === me);
  const foes = state.units.filter((u) => !u.dead && u.team === foe);
  const T = op.target, A = UNIT_TYPES.artillery;
  const inRange = (g, x, y) => { const d = Math.hypot(g.x - x, g.y - y); return d <= A.artyRange && d >= A.artyMinRange; };

  const Lv = ai.level || DIFFICULTY.medium;
  if (op.stage === 'assemble') {
    if ((units.every((u) => !u.order) && (!can(ai, 'rested') || rested(units))) || op.timer <= 0) {
      if (Lv.rush) { orderMove(state, units, T.x, T.y, 'charge'); op.stage = 'charge'; op.timer = 40; op.guns = []; } // straight in with the bayonet
      else { op.stage = 'prep'; op.timer = 25; op.guns = []; }
    }
  } else if (op.stage === 'prep') {
    // every ready battery in range (at least three), concentrated: two at a time on the high-value targets covering
    // the objective - its machine guns, nearest first, and a battery of theirs within reach - and the rest on the
    // objective itself, which always has two; the trench is shelled before the men go
    const light = (ai.level || DIFFICULTY.medium).prep === 'light';
    const ready = readyBatteries(mine).filter((g) => inRange(g, T.x, T.y)).slice(0, light ? 1 : Math.max(3, (ai.level || DIFFICULTY.medium).guns));
    if (ready.length) {
      const near = (f, r) => Math.hypot(f.x - T.x, f.y - T.y) < r;
      const mgs = foes.filter((f) => f.type === 'mg' && near(f, 8) && !near(f, 2.5)).sort((a, b) => Math.hypot(a.x - T.x, a.y - T.y) - Math.hypot(b.x - T.x, b.y - T.y));
      const guns = foes.filter((f) => f.type === 'artillery' && ready.some((g) => inRange(g, f.x, f.y)));
      const high = [...mgs.slice(0, 2), ...guns.slice(0, 1)];
      const free = [...ready], plan = [];
      const take = (tg, n) => { for (let k = 0; k < n; k++) { const i = free.findIndex((g) => inRange(g, tg.x, tg.y)); if (i < 0) break; plan.push([free.splice(i, 1)[0], tg]); } };
      take(T, light ? 1 : 2);
      if (!light) for (const h of high) take(h, can(ai, 'concentrate') ? 2 : 1);
      for (const g of free) plan.push([g, T]);
      for (const [g, tg] of plan) if (orderBarrage(state, [g], tg.x, tg.y)) op.guns.push({ id: g.id, x: tg.x, y: tg.y });
      op.stage = 'wait'; op.timer = 60;
    } else if (op.timer <= -45 || (op.timer <= 0 && !mine.some((g) => g.type === 'artillery' && inRange(g, T.x, T.y)))) { op.stage = 'wait'; op.timer = 0; } // (no going in without the guns, if the guns can be had within the minute)
  } else if (op.stage === 'wait') {
    // go so as to arrive as the last shells on the objective fall
    const lead = units.reduce((a, u) => Math.min(a, Math.hypot(u.x - T.x, u.y - T.y)), Infinity);
    const travel = lead / (UNIT_TYPES.rifle.speed * 2);
    const onTarget = op.guns.map((g) => state.units.find((u) => u.id === g.id)).filter((g) => g && g.barrage && Math.hypot(g.barrage.x - T.x, g.barrage.y - T.y) < 1);
    const left = onTarget.reduce((a, g) => Math.max(a, g.barrage.remaining * A.shellInterval), 0);
    // ...with their wind: a charge by blown men stalls short of the trench (a little grace, then they go anyway)
    if ((left <= travel + 2 || op.timer <= 0) && (!can(ai, 'rested') || rested(units) || op.timer <= -20)) {
      orderMove(state, units, T.x, T.y, 'charge');
      op.stage = 'charge'; op.timer = 40; op.support = 0;
    }
  } else if (op.stage === 'charge') {
    // while the men go in, the batteries that are free go for the machine guns firing on them, two at a time
    // (not one our men are already on top of)
    op.support = (op.support || 0) - dt;
    if (op.support <= 0 && can(ai, 'support')) {
      op.support = 2;
      const free = readyBatteries(mine);
      const mg = foes.filter((f) => f.type === 'mg' && f.target && Math.hypot(f.x - T.x, f.y - T.y) < 10 && !units.some((u) => Math.hypot(u.x - f.x, u.y - f.y) < 3.5))
        .sort((a, b) => Math.hypot(a.x - T.x, a.y - T.y) - Math.hypot(b.x - T.x, b.y - T.y))[0];
      if (mg) for (const g of free.filter((g) => inRange(g, mg.x, mg.y)).slice(0, 2)) orderBarrage(state, [g], mg.x, mg.y);
    }
    // lift the barrage off the objective as the first men get close
    const lead = units.reduce((a, u) => Math.min(a, Math.hypot(u.x - T.x, u.y - T.y)), Infinity);
    if (lead < 3.5) for (const g of op.guns) { const gun = state.units.find((u) => u.id === g.id); if (gun && gun.barrage && Math.hypot(gun.barrage.x - T.x, gun.barrage.y - T.y) < 1.5) orderHalt(state, [gun]); }
    const tile = tileAt(state.map, T.x, T.y);
    const clear = !foes.some((f) => f.type !== 'artillery' && Math.hypot(f.x - T.x, f.y - T.y) < 2.5);
    const taken = tile && tile.owner === me && clear;
    if (taken) {
      op.steps++;
      if (op.kind === 'counter' || (!Lv.rush && op.steps >= Lv.steps)) return end(); // (rushing, he never stops of his own accord: on to the next, and the next, to their headquarters)
      // on to the next objective; a squad stays to hold this one
      const hold = units.length > 3 ? units.reduce((a, u) => (u.men < a.men ? u : a)) : null;
      if (hold) { op.ids = op.ids.filter((id) => id !== hold.id); hold.ai.role = 'hold'; hold.order = null; }
      op.target = nextObjective(state, ai, T);
      op.stage = 'regroup'; op.timer = 12;
      const rest = units.filter((u) => u !== hold);
      orderMove(state, rest, T.x, T.y);
    } else if (op.timer <= 0 || units.every((u) => !u.order)) {
      // the charge stalled short of the trench: go to ground and try again with the guns
      if (units.every((u) => !u.order) && !taken && (op.retries = (op.retries || 0) + 1) <= (Lv.retries || 2)) {
        if (Lv.rush) { orderMove(state, units, T.x, T.y, 'charge'); op.stage = 'charge'; op.timer = 40; }
        else if (can(ai, 'fallBack')) { // back to the shelter of our nearest trench while the guns are got ready again, then once more
          for (const u of units) { const b = ownTrenchNear(state, me, u.x - dir * 3, u.y, 9); if (b) orderMove(state, [u], b.x + 0.5, b.y + 0.5); }
          op.stage = 'assemble'; op.timer = 30;
        } else { op.stage = 'prep'; op.timer = 25; op.guns = []; } // (lies where it is and tries again)
      } else { // given up: back into our trenches, not left lying out in front of theirs
        if (can(ai, 'fallBack')) for (const u of units) { const b = ownTrenchNear(state, me, u.x - dir * 3, u.y, 9); if (b) orderMove(state, [u], b.x + 0.5, b.y + 0.5); }
        return end();
      }
    }
  } else if (op.stage === 'regroup') {
    // (on to the next, once they are there: no lingering in a trench just taken, which the enemy is shelling - the
    // wait for the guns gives them their breather)
    if (units.every((u) => !u.order) || op.timer <= 0) { if (Lv.rush) { orderMove(state, units, op.target.x, op.target.y, 'charge'); op.stage = 'charge'; op.timer = 40; } else { op.stage = 'prep'; op.timer = 25; op.guns = []; } }
  }
}
