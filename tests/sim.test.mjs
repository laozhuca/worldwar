import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, update, orderBarrage, orderMove, placeBuild, buyUnit, reinforce, damageUnit } from '../src/game.js';
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
  const ammo0 = s.resources[PLAYER].ammo;
  assert.equal(orderBarrage(s, [gun], wireTile.x + 0.5, wireTile.y + 0.5), 1);
  step(s, 15);
  assert.ok(s.resources[PLAYER].ammo <= ammo0 - UNIT_TYPES.artillery.shellAmmo * UNIT_TYPES.artillery.barrageShells + 5);
  const nearby = s.map.tiles.filter((t) => t.origWire === ENEMY && Math.hypot(t.x - wireTile.x, t.y - wireTile.y) < 2);
  assert.ok(nearby.some((t) => t.wire < 100), 'some wire was cut');
  assert.ok(gun.cooldown > 0, 'battery reloading');
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
  sq.x = 14.5; sq.y = 25.5; sq.order = null;
  const sup0 = s.resources[PLAYER].supplies;
  const r = placeBuild(s, PLAYER, 'trench', 15.5, 25.5);
  assert.ok(r.ok, r.reason);
  assert.equal(s.resources[PLAYER].supplies, sup0 - BUILD.trench.supplies);
  step(s, 12);
  assert.equal(tileAt(s.map, 15.5, 25.5).trench, 1);
  assert.equal(placeBuild(s, PLAYER, 'trench', 40.5, 20.5).ok, false, 'cannot build far from troops');
});

test('recruiting and reinforcing consume resources', () => {
  const s = createGame({ aiTeams: [] });
  const res = s.resources[PLAYER];
  const men0 = res.men;
  const u = buyUnit(s, PLAYER, 'rifle');
  assert.equal(typeof u, 'object');
  assert.equal(res.men, men0 - 10);
  const sq = s.units.find((x) => x.team === PLAYER && x.type === 'rifle' && x.inTrench);
  damageUnit(s, sq, 35);
  assert.equal(sq.men, 7);
  assert.equal(reinforce(s, sq), 3);
  assert.equal(sq.men, 10);
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
