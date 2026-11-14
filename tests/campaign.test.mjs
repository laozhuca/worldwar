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
  s.time += 13; stepCampaign(s);
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
