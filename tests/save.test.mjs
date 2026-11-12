import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, update, orderMove, placeBuild } from '../src/game.js';
import { serialize, deserialize, describe } from '../src/save.js';
import { PLAYER, ENEMY } from '../src/config.js';
import { teamDir } from '../src/map.js';

test('a saved battle loads back identical and plays on', () => {
  const s = createGame({ aiTeams: [PLAYER, ENEMY], start: 'east', nations: ['france', 'ottoman'], season: 'mud' });
  for (let t = 0; t < 120; t += 0.1) update(s, 0.1);
  const json = serialize(s);
  assert.ok(json.length < 1.5e6, `save is ${Math.round(json.length / 1024)} kB`);
  const info = describe(json);
  assert.deepEqual(info.nations, ['france', 'ottoman']);
  assert.equal(info.season, 'mud');

  createGame(); // the module state moves on (west start, new ids) before loading
  const l = deserialize(json);
  assert.equal(teamDir(PLAYER), -1, 'the player is back in the east');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
  near(l.time, s.time);
  assert.equal(l.units.length, s.units.length);
  for (const team of [0, 1]) for (const k of ['men', 'ammo', 'supplies']) near(l.resources[team][k], s.resources[team][k]);
  s.units.forEach((u, i) => { near(l.units[i].x, u.x); near(l.units[i].y, u.y); assert.equal(l.units[i].men, u.men); });
  for (let i = 0; i < s.map.tiles.length; i++) {
    const a = s.map.tiles[i], b = l.map.tiles[i];
    for (const k of ['trench', 'owner', 'wire', 'crater', 'decor', 'off']) assert.equal(b[k], a[k], `tile ${i} ${k}`);
  }
  for (const u of l.units) {
    if (u.target) assert.ok(l.units.includes(u.target), 'targets point at loaded units');
  }
  // new units get fresh ids, and the battle runs on
  const ids = new Set(l.units.map((u) => u.id));
  orderMove(l, l.units.filter((u) => u.team === PLAYER).slice(0, 2), l.map.w / 2, l.map.h / 2);
  placeBuild(l, PLAYER, 'trench', l.map.hq[PLAYER].x - 2.5, l.map.hq[PLAYER].y + 0.5);
  for (let t = 0; t < 60; t += 0.1) update(l, 0.1);
  assert.ok(l.time > s.time + 59);
  const fresh = l.units.filter((u) => !ids.has(u.id));
  for (const u of fresh) assert.ok(u.id > Math.max(...ids));
  createGame();
});

test('bad saves are refused', () => {
  assert.equal(describe('not json'), null);
  assert.equal(describe(JSON.stringify({ version: 999 })), null);
  assert.throws(() => deserialize(JSON.stringify({ version: 999, map: {} })));
});
