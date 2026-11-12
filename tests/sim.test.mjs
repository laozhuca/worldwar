import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, update, orderBarrage, orderMove, placeBuild, buyUnit, damageUnit } from '../src/game.js';
import { tileAt, frontLine } from '../src/map.js';
import { PLAYER, ENEMY, UNIT_TYPES, BUILD } from '../src/config.js';

const step = (state, seconds, dt = 1 / 30) => { for (let t = 0; t < seconds; t += dt) update(state, dt); };

test('map has trench lines, wire and HQs for both sides', () => {
  const s = createGame();
  for (const team of [PLAYER, ENEMY]) {
    const front = frontLine(s.map, team);
    assert.ok(front.filter((x) => x >= 0).length > 30, 'front line spans the map');
    const hq = s.map.hq[team];
    assert.equal(tileAt(s.map, hq.x, hq.y).owner, team);
  }
  assert.ok(s.map.tiles.some((t) => t.wire > 0 && t.origWire === ENEMY));
  assert.ok(s.units.filter((u) => u.team === PLAYER).length >= 10);
});

test('artillery barrage suppresses, damages, cuts wire and costs ammo', () => {
  const s = createGame({ aiTeams: [] });
  const gun = s.units.find((u) => u.team === PLAYER && u.type === 'artillery');
  const wireTile = s.map.tiles.find((t) => t.origWire === ENEMY && Math.hypot(t.x - gun.x, t.y - gun.y) < 35);
  s.supplyTimer = 1e9; // no convoys during the measurement
  const ammo0 = s.resources[PLAYER].ammo;
  assert.equal(orderBarrage(s, [gun], wireTile.x + 0.5, wireTile.y + 0.5), 1);
  const A = UNIT_TYPES.artillery;
  step(s, A.barrageShells * A.shellInterval * 1.2 + 4); // whole barrage plus the last shell's flight
  assert.ok(s.resources[PLAYER].ammo <= ammo0 - UNIT_TYPES.artillery.shellAmmo * UNIT_TYPES.artillery.barrageShells + 5);
  const nearby = s.map.tiles.filter((t) => t.origWire === ENEMY && Math.hypot(t.x - wireTile.x, t.y - wireTile.y) < 2);
  assert.ok(nearby.some((t) => t.wire < 100), 'some wire was cut');
  assert.equal(gun.barrage, null, 'barrage finished');
});

test('machine gun shreds infantry walking across the open', () => {
  const s = createGame({ aiTeams: [] });
  const mg = s.units.find((u) => u.team === ENEMY && u.type === 'mg');
  s.units = s.units.filter((u) => u === mg || u.team === PLAYER);
  const sq = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  sq.x = mg.x - 12; sq.y = mg.y;
  orderMove(s, [sq], mg.x, mg.y, 'move');
  step(s, 20);
  assert.ok(sq.dead || sq.men <= 5, `squad should be badly hurt, has ${sq.men}`);
});

test('digging a trench needs supplies and a working party', () => {
  const s = createGame({ aiTeams: [] });
  const sq = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  // between the support line and the front line, five rows above the middle
  const M = Math.floor(s.map.h / 2), fx = frontLine(s.map, PLAYER)[M];
  const bx = fx - 2.5, by = M - 4.5;
  assert.equal(tileAt(s.map, bx, by).trench, 0);
  sq.x = bx - 1; sq.y = by; sq.order = null;
  const sup0 = s.resources[PLAYER].supplies;
  const r = placeBuild(s, PLAYER, 'trench', bx, by);
  assert.ok(r.ok, r.reason);
  assert.equal(s.resources[PLAYER].supplies, sup0 - BUILD.trench.supplies);
  step(s, 12);
  assert.equal(tileAt(s.map, bx, by).trench, 1);
  assert.equal(placeBuild(s, PLAYER, 'trench', s.map.w / 2, M + 0.5).ok, false, 'cannot build far from troops');
});

test('recruiting costs resources; casualties are permanent (no squad refill)', () => {
  const s = createGame({ aiTeams: [ENEMY] });
  const res = s.resources[PLAYER];
  const men0 = res.men;
  const u = buyUnit(s, PLAYER, 'rifle');
  assert.equal(typeof u, 'object');
  assert.equal(res.men, men0 - UNIT_TYPES.rifle.cost.men);
  assert.equal(u.men, UNIT_TYPES.rifle.men);
  // a squad sitting in its own trench, and an enemy squad in theirs, stay depleted
  const mine = s.units.find((x) => x.team === PLAYER && x.type === 'rifle' && x.inTrench);
  const theirs = s.units.find((x) => x.team === ENEMY && x.type === 'rifle' && x.inTrench);
  damageUnit(s, mine, 25); damageUnit(s, theirs, 25);
  const m0 = mine.men, t0 = theirs.men;
  assert.ok(m0 < UNIT_TYPES.rifle.men && t0 < UNIT_TYPES.rifle.men);
  for (let t = 0; t < 60; t += 0.1) update(s, 0.1);
  assert.ok(mine.men <= m0 && theirs.men <= t0, 'no refill for either side');
});

test('AI vs AI: ten minutes of war runs without errors and things happen', () => {
  const s = createGame({ aiTeams: [PLAYER, ENEMY] });
  for (let t = 0; t < 600 && s.winner < 0; t += 0.1) {
    update(s, 0.1);
    for (const u of s.units) {
      assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y), 'finite position');
      assert.ok(u.men >= 0);
    }
    for (const k of ['men', 'ammo', 'supplies']) assert.ok(Number.isFinite(s.resources[0][k]));
  }
  assert.ok(s.stats.lost[0] + s.stats.lost[1] > 20, `casualties: ${s.stats.lost}`);
  console.log('casualties', s.stats.lost, 'winner', s.winner, 'time', s.time.toFixed(0), 'units', s.units.length);
});

test('the battlefield is a diamond: nothing exists or moves outside it', () => {
  const s = createGame({ aiTeams: [PLAYER, ENEMY] });
  const C = s.map.w / 2, R = (s.map.w - 1) / 2;
  for (const t of s.map.tiles) {
    if (t.off) assert.ok(!t.trench && !t.wire && !t.crater && !t.decor, `nothing at ${t.x},${t.y}`);
  }
  assert.equal(tileAt(s.map, 0.5, 0.5), null, 'corner of the grid is off the map');
  const on = s.map.tiles.filter((t) => !t.off).length;
  assert.ok(on > 2200 && on < 2500, `about as many tiles as before (${on})`);
  for (let t = 0; t < 240; t += 0.1) {
    update(s, 0.1);
    for (const u of s.units) assert.ok(Math.abs(u.x - C) + Math.abs(u.y - C) <= R + 0.5, `unit ${u.type} inside: ${u.x.toFixed(1)},${u.y.toFixed(1)}`);
  }
});

test('player can start on the east line', () => {
  const s = createGame({ start: 'east', aiTeams: [PLAYER, ENEMY] });
  assert.ok(s.map.hq[PLAYER].x > s.map.w / 2, 'player HQ in the east');
  assert.ok(s.map.hq[ENEMY].x < s.map.w / 2, 'enemy HQ in the west');
  const mine = s.units.filter((u) => u.team === PLAYER);
  assert.ok(mine.every((u) => u.x > s.map.w / 2), 'player army deployed in the east');
  const pf = frontLine(s.map, PLAYER).filter((x) => x >= 0), ef = frontLine(s.map, ENEMY).filter((x) => x >= 0);
  assert.ok(Math.min(...pf) > Math.max(...ef), 'player front is east of the enemy front');
  // the player\'s units face west and the war runs normally
  assert.ok(mine.every((u) => u.hx < 0));
  for (let t = 0; t < 300; t += 0.1) update(s, 0.1);
  assert.ok(s.stats.lost[0] + s.stats.lost[1] > 5);
  for (const u of s.units) assert.ok(Number.isFinite(u.x) && u.x >= 0 && u.x <= s.map.w);
  createGame(); // restore the default west start for any later tests
});

test('the fallen: shell bursts tear bodies and throw the pieces, small arms leave them where they fall', () => {
  const s = createGame({ aiTeams: [] });
  const sq = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  damageUnit(s, sq, 25); // rifle fire
  const shot = s.decals.slice();
  assert.ok(shot.length >= 2);
  for (const b of shot) { assert.ok(!b.fly, 'not thrown'); assert.ok(b.v >= 0 && b.v <= 2, 'intact'); assert.ok(b.dir >= 0 && b.dir < 8); }
  s.decals = [];
  for (let i = 0; i < 40; i++) {
    const u = s.units.find((x) => x.team === ENEMY && x.type === 'rifle' && !x.dead);
    if (!u) break;
    damageUnit(s, u, 30, { x: u.x + 0.3, y: u.y, d: 0.3 });
  }
  const bodies = s.decals.filter((b) => !b.part), parts = s.decals.filter((b) => b.part);
  assert.ok(bodies.length > 20);
  const torn = bodies.filter((b) => b.v >= 3);
  assert.ok(torn.length > 0 && torn.length < bodies.length, 'some bodies are torn apart, not all');
  // torn bodies leave their limbs flying; pieces fly high, bodies only jolt
  assert.ok(parts.filter((b) => b.part === 'leg' || b.part === 'arm').length >= torn.length, 'every torn body throws its limbs');
  for (const b of parts) assert.ok(b.fly && b.fly.h > 0.7, 'pieces are thrown high');
  for (const b of bodies.filter((x) => x.fly)) assert.ok(b.fly.h < 0.35 && Math.hypot(b.x - b.fly.x0, b.y - b.fly.y0) < 1.05, 'bodies only jolt');
  for (const b of s.decals.filter((x) => x.fly)) {
    assert.ok(b.fly.dur > 0.5);
    assert.ok(Math.abs(b.x - s.map.w / 2) + Math.abs(b.y - s.map.h / 2) <= s.map.w / 2, 'lands on the battlefield');
  }
});
