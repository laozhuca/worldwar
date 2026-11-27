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

test('shells bring a standing building down, half-destroyed and then a ruin; its ground stays impassable', async () => {
  const { update } = await import('../src/game.js');
  let s = null, b = null;
  for (let seed = 1; seed < 40 && !b; seed++) { s = createBattlefieldGame('dixmude', { seed }); b = (s.buildings || []).find((q) => q.half && !q.name); }
  assert.ok(b, 'a battlefield with an intact building');
  const img = b.img, tiles = s.map.tiles.filter((t) => t.block && Math.abs(t.x + 0.5 - b.x) <= b.hx && Math.abs(t.y + 0.5 - b.y) <= b.hy);
  assert.ok(tiles.length > 0, 'its ground is blocked');
  let shells = 0;
  let wasHalf = false;
  while (!b.ruined && shells < 20) { s.shells.push({ x: b.x, y: b.y, t: 0, team: 0 }); update(s, 0.05); shells++; if (b.img.endsWith('-half.webp')) wasHalf = true; }
  assert.ok(wasHalf, 'half-destroyed on the way down');
  assert.ok(b.ruined, 'it falls');
  assert.ok(shells >= 3 && shells <= 6, `after a few direct hits (${shells})`);
  assert.notEqual(b.img, img); assert.ok(b.img.endsWith('-ruin.webp'), 'drawn as its ruin');
  assert.ok(tiles.every((t) => t.block), 'and its ground is still impassable');
});
