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

test('The Brusilov Breakthrough: a thin line, reserves on day 1 and 2, win by taking the HQ, lose after 3 days', () => {
  const s = createLevelGame('brusilov');
  const foes = () => s.units.filter((u) => !u.dead && u.team === ENEMY && u.type !== 'artillery').length;
  const mine = s.units.filter((u) => u.team === PLAYER).length;
  const start = foes();
  assert.ok(mine > 20, 'a big army');
  s.time = ((20 - 4) / 24) * 420 + 0.1; stepCampaign(s);
  assert.equal(foes(), start + 6, 'first reserves');
  s.time = ((44 - 4) / 24) * 420 + 0.1; stepCampaign(s);
  assert.equal(foes(), start + 14, 'second reserves');
  assert.equal(s.campaign.result, null);
  const hq = s.map.hq[ENEMY];
  s.map.tiles[hq.y * s.map.w + hq.x].owner = PLAYER;
  update(s, 1 / 30); stepCampaign(s);
  assert.equal(s.campaign.result, 'won');
  assert.equal(s.campaign.reason, 'The enemy headquarters has fallen.');
  assert.ok(levelById('brusilov').medalsEarned(s)[0]);

  const l = createLevelGame('brusilov');
  l.time = ((72 - 4) / 24) * 420 + 1; stepCampaign(l);
  assert.equal(l.campaign.result, 'lost');
  createGame();
});

test('Counter-attack at Chunuk Bair: retake the lost centre before dusk while the enemy digs in', () => {
  const s = createLevelGame('chunuk'), c = s.campaign;
  assert.ok(c.lost.length >= 8);
  assert.ok(c.lost.every((i) => s.map.tiles[i].owner === ENEMY && s.map.tiles[i].origOwner === PLAYER));
  assert.ok(s.units.some((u) => u.team === ENEMY && u.ai.role === 'garrison' && u.type === 'mg'));
  const t0 = c.lost.map((i) => s.map.tiles[i].trench).reduce((a, b) => a + b);
  s.time = ((7 - 4.5) / 24) * 420; stepCampaign(s);
  assert.ok(c.dug >= 2, 'dug in');
  assert.ok(c.lost.map((i) => s.map.tiles[i].trench).reduce((a, b) => a + b) > t0, 'deeper works');
  for (const i of c.lost) s.map.tiles[i].owner = PLAYER;
  stepCampaign(s);
  s.time += 5; stepCampaign(s);
  assert.equal(c.result, 'won');
  assert.ok(levelById('chunuk').medalsEarned(s)[1], 'before 10:00');

  const l = createLevelGame('chunuk');
  l.time = ((19.5 - 4.5) / 24) * 420 + 1; stepCampaign(l);
  assert.equal(l.campaign.result, 'lost');
  createGame();
});

test('The Black Day: three lines, Anglo-American army, counter-attacks, take the HQ by midnight', () => {
  const s = createLevelGame('amiens'), c = s.campaign;
  assert.equal(c.lines.length, 3);
  assert.ok(c.lines.every((l) => l.length > 5));
  assert.ok(s.units.some((u) => u.team === PLAYER && u.nation === 'uk'), 'British alongside');
  assert.equal(s.units.filter((u) => u.team === PLAYER && u.type === 'artillery').length, 6);
  assert.ok(s.units.filter((u) => u.team === ENEMY && u.type === 'mg').length >= 4, 'machine guns in depth');
  const n = s.units.length;
  s.time = ((8 - 4.33) / 24) * 1260 + 0.1; stepCampaign(s);
  assert.ok(s.units.length >= n + 3, 'reserves come up');
  const hq = s.map.hq[ENEMY];
  s.map.tiles[hq.y * s.map.w + hq.x].owner = PLAYER;
  update(s, 1 / 30); stepCampaign(s);
  assert.equal(c.result, 'won');
  assert.ok(levelById('amiens').medalsEarned(s)[1], 'by noon');

  const l = createLevelGame('amiens');
  l.time = ((24 - 4.33) / 24) * 1260 + 1; stepCampaign(l);
  assert.equal(l.campaign.result, 'lost');
  createGame();
});
