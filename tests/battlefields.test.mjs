import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLEFIELDS, createBattlefieldGame } from '../src/battlefields.js';
import { update } from '../src/game.js';
import { serialize, deserialize } from '../src/save.js';

test('every skirmish battlefield builds in its own format, deploys both armies and plays', () => {
  assert.equal(BATTLEFIELDS.length, 10);
  for (const bf of BATTLEFIELDS) for (const start of ['west', 'east']) {
    const s = createBattlefieldGame(bf.id, { seed: 11, start, nations: ['uk', 'germany'] });
    const { map } = s;
    assert.equal(map.bandW, bf.A, bf.id);
    for (const t of map.tiles) if (!t.off) { assert.ok(Math.abs(t.x - t.y) <= bf.A && Math.abs(t.x + t.y - 2 * map.r) <= bf.B, bf.id); }
    for (const q of map.hq) { const t = map.tiles[q.y * map.w + q.x]; assert.ok(!t.off && t.trench === 3, `${bf.id} headquarters`); }
    for (const team of [0, 1]) assert.equal(s.units.filter((u) => u.team === team).length, 15, `${bf.id} army ${team}`);
    for (const u of s.units) { const t = map.tiles[Math.floor(u.y) * map.w + Math.floor(u.x)]; assert.ok(t && !t.off && !t.block && !t.rock, `${bf.id} ${u.type} placed on open ground`); }
    for (let i = 0; i < 120; i++) update(s, 0.5);
    const back = deserialize(serialize(s));
    assert.equal(back.map.tiles.filter((t) => !t.off).length, map.tiles.filter((t) => !t.off).length, `${bf.id} save keeps the field's shape`);
  }
});
