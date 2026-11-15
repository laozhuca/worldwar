import test from 'node:test';
import assert from 'node:assert/strict';
import { update, createGame } from '../src/game.js';
import { PLAYER, ENEMY } from '../src/config.js';
import { createLevelGame, stepCampaign, clockHours, levelById } from '../src/campaign.js';

const run = (s, seconds) => { for (let t = 0; t < seconds && s.winner < 0; t += 0.1) { update(s, 0.1); stepCampaign(s); } };

test('Hold Until Relieved: strong works, short supply, a hard enemy, waves of reinforcements', () => {
  const s = createLevelGame('ypres');
  assert.equal(s.campaign.id, 'ypres');
  assert.ok(s.campaign.front.length > 30, 'the front line is recorded');
  assert.ok(s.campaign.front.every((i) => s.map.tiles[i].trench >= 2), 'sandbagged');
  assert.equal(s.playerIncome, 0.7);
  assert.ok(s.ais[0].level.force >= 7 && s.ais[0].level.firstAttack < 200, "a relentless enemy");
  assert.ok(Math.abs(clockHours(s) - 6.5) < 1e-6, 'dawn of day 1');
  const enemies0 = s.units.filter((u) => u.team === ENEMY).length;
  run(s, 300); // past 13:00 on day 1: the first German reinforcements
  assert.ok(s.units.filter((u) => u.team === ENEMY).length + s.stats.lost[ENEMY] / 4 > enemies0, 'enemy reinforced');
  assert.ok(s.campaign.fired.length >= 1);
  createGame();
});

test('Hold Until Relieved: the relief at dawn on day 4 wins; losing half the front loses', () => {
  const s = createLevelGame('ypres');
  s.time = ((78 - 6.5) / 24) * 420 - 1; // just before 06:00 on day 4
  stepCampaign(s);
  assert.equal(s.campaign.relievedAt, undefined);
  s.time += 2; stepCampaign(s);
  assert.ok(s.campaign.relievedAt !== undefined, 'relief arrived');
  const relief = s.units.filter((u) => s.campaign.relief.includes(u.id));
  assert.ok(relief.length >= 12, 'a big relieving force');
  assert.ok(s.events.some((e) => e.type === 'cheer'), 'the men cheer');
  s.time += 30; stepCampaign(s);
  assert.equal(s.campaign.result, null, 'not won while the relief is still marching up');
  for (const u of relief) { u.x = u.reliefTo.x; u.y = u.reliefTo.y; }
  stepCampaign(s);
  assert.ok(s.campaign.manned, 'the relief is in the line');
  s.time += 5; stepCampaign(s);
  assert.equal(s.campaign.result, 'won');
  assert.equal(s.winner, PLAYER);
  assert.ok(levelById('ypres').medalsEarned(s)[0]);

  const l = createLevelGame('ypres');
  for (const i of l.campaign.front.slice(0, Math.ceil(l.campaign.front.length / 2) + 1)) l.map.tiles[i].owner = ENEMY;
  stepCampaign(l);
  assert.equal(l.campaign.result, 'lost');
  assert.equal(l.winner, ENEMY);
  createGame();
});

test('Silence the Guns: three concrete nests, rationed barrages, win on silencing them, lose at nightfall on day 2', async () => {
  const { orderBarrage } = await import('../src/game.js');
  const s = createLevelGame('isonzo');
  const c = s.campaign;
  assert.equal(c.nests.length, 3);
  for (const id of c.nests) {
    const u = s.units.find((q) => q.id === id);
    assert.equal(u.team, ENEMY); assert.equal(u.type, 'mg'); assert.equal(u.ai.role, 'nest');
    assert.equal(s.map.tiles[Math.floor(u.y) * s.map.w + Math.floor(u.x)].trench, 3, 'concrete');
  }
  // rationed: each battery barrage uses one of the 9
  const guns = s.units.filter((u) => u.team === PLAYER && u.type === 'artillery');
  assert.equal(guns.length, 3);
  const nest = s.units.find((q) => q.id === c.nests[0]);
  const fired = orderBarrage(s, guns, nest.x, nest.y);
  assert.equal(s.barrageLimit[PLAYER], 9 - fired);
  s.barrageLimit[PLAYER] = 0;
  for (const g of guns) { g.barrage = null; g.cooldown = 0; }
  assert.equal(orderBarrage(s, guns, nest.x, nest.y), 0, 'no shells left');
  // markers on the nests while they fire
  stepCampaign(s);
  assert.equal(s.markers.length, 3);
  for (const id of c.nests) s.units.find((q) => q.id === id).dead = true;
  stepCampaign(s);
  assert.equal(c.silenced.length, 3);
  assert.equal(s.markers.length, 0);
  s.time += 5; stepCampaign(s);
  assert.equal(c.result, 'won');
  assert.equal(s.winner, PLAYER);
  const m = levelById('isonzo').medalsEarned(s);
  assert.ok(m[0] && m[1] && !m[2]);

  const l = createLevelGame('isonzo');
  l.time = ((43 - 5) / 24) * 420 + 1;
  stepCampaign(l);
  assert.equal(l.campaign.result, 'lost');
  createGame();
});
