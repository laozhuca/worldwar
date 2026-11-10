import test from 'node:test';
import assert from 'node:assert/strict';
import { Relief } from '../src/relief.js';
import { createMap } from '../src/map.js';

test('relief: craters hold water, trenches get spoil ridges, updates stay local', () => {
  const map = createMap(1916);
  const snow = new Float32Array(map.w * map.h);
  const rf = new Relief(map, 16);
  rf.update(map, { S: 0, snowTile: snow });
  assert.equal(rf.dirty.w, rf.mw, 'first update covers the whole map');
  const wet = rf.water.filter((_, i) => i % 4 === 3 && _ > 128).length;
  assert.ok(wet > 100, `some craters hold water (${wet} px)`);

  // a fresh deep crater in open ground
  rf.dirty = null;
  const t = map.tiles.find((q) => !q.trench && !q.crater && q.x > 25 && q.x < 35);
  t.crater = 3; t.mud = 1;
  rf.update(map, { S: 0, snowTile: snow }, { x0: t.x, y0: t.y, x1: t.x, y1: t.y });
  assert.ok(rf.dirty.w <= 16 * 6 && rf.dirty.h <= 16 * 6, 'incremental update touches only a small window');
  const shadeVals = [];
  for (let y = t.y * 16; y < (t.y + 1) * 16; y++) for (let x = t.x * 16; x < (t.x + 1) * 16; x++) shadeVals.push(rf.shade[(y * rf.mw + x) * 4]);
  assert.ok(Math.max(...shadeVals) - Math.min(...shadeVals) > 40, 'the crater is lit and shaded');
});
