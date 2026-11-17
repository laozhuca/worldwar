import test from 'node:test';
import assert from 'node:assert/strict';
import { update, createGame } from '../src/game.js';
import { PLAYER, ENEMY } from '../src/config.js';
import { createLevelGame, stepCampaign, clockHours, levelById } from '../src/campaign.js';

const run = (s, seconds) => { for (let t = 0; t < seconds && s.winner < 0; t += 0.1) { update(s, 0.1); stepCampaign(s); } };

test('The Sailors of Dixmude: strong works, short supply, a hard enemy, waves of reinforcements', () => {
  const s = createLevelGame('ypres');
  assert.equal(s.campaign.id, 'ypres');
  assert.ok(s.campaign.front.length > 30, 'the front line is recorded');
  assert.ok(s.campaign.front.every((i) => s.map.tiles[i].trench >= 2), 'sandbagged');
  assert.equal(s.playerIncome, 0.7);
  assert.ok(s.ais[0].level.force >= 6 && s.ais[0].level.firstAttack < 200, "a relentless enemy");
  assert.ok(Math.abs(clockHours(s) - 6.5) < 1e-6, 'dawn of day 1');
  const enemies0 = s.units.filter((u) => u.team === ENEMY).length;
  run(s, 300); // past 13:00 on day 1: the first German reinforcements
  assert.ok(s.units.filter((u) => u.team === ENEMY).length + s.stats.lost[ENEMY] / 4 > enemies0, 'enemy reinforced');
  assert.ok(s.campaign.fired.length >= 1);
  createGame();
});

test('The Sailors of Dixmude: the relief at dawn on day 4 wins; losing half the front loses', () => {
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

test('The Nests of San Michele: three concrete nests, rationed barrages, win on silencing them, lose at nightfall on day 2', async () => {
  const { orderBarrage } = await import('../src/game.js');
  const s = createLevelGame('isonzo');
  const c = s.campaign;
  assert.equal(c.nests.length, 3);
  for (const id of c.nests) {
    const u = s.units.find((q) => q.id === id);
    assert.equal(u.team, ENEMY); assert.equal(u.type, 'mg'); assert.equal(u.ai.role, 'nest');
    assert.equal(s.map.tiles[Math.floor(u.y) * s.map.w + Math.floor(u.x)].trench, 3, 'concrete');
  }
  // rationed: each battery barrage uses one of the 8
  const guns = s.units.filter((u) => u.team === PLAYER && u.type === 'artillery');
  assert.equal(guns.length, 3);
  const nest = s.units.find((q) => q.id === c.nests[0]);
  const fired = orderBarrage(s, guns, nest.x, nest.y);
  assert.equal(s.barrageLimit[PLAYER], 8 - fired);
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

test('Brusilov\'s Storm: a thin line, reserves on day 1 and 2, win by taking the HQ, lose after 3 days', () => {
  const s = createLevelGame('brusilov');
  const foes = () => s.units.filter((u) => !u.dead && u.team === ENEMY && u.type !== 'artillery').length;
  const mine = s.units.filter((u) => u.team === PLAYER).length;
  const start = foes();
  assert.ok(mine > 20, 'a big army');
  s.time = ((20 - 4) / 24) * 420 + 0.1; stepCampaign(s);
  assert.equal(foes(), start + 5, 'first reserves');
  s.time = ((44 - 4) / 24) * 420 + 0.1; stepCampaign(s);
  assert.equal(foes(), start + 11, 'second reserves');
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

test('Dawn on Chunuk Bair: retake the lost centre before dusk while the enemy digs in', () => {
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

test('Rocks: the valley of battle 2 is walled; a squad sent across a barrier finds a gap and never stands on rock', async () => {
  const { orderMove } = await import('../src/game.js');
  const { rockAt } = await import('../src/map.js');
  const s = createLevelGame('isonzo');
  const rocks = s.map.tiles.filter((t) => t.rock);
  assert.ok(rocks.length > 60, 'rock walls and barriers');
  assert.ok(rocks.every((t) => !t.trench && !t.wire));
  s.ais.length = 0;
  const u = s.units.find((q) => q.team === PLAYER && q.type === 'rifle');
  s.units = s.units.filter((q) => q.team === ENEMY || q === u);
  for (const q of s.units) if (q !== u) q.holdFire = true;
  // from just in front of our line to beyond the first barrier (u = -13), in the middle of the valley
  const at = (uu, v) => ({ x: Math.round((uu + v + 68) / 2) + 0.5, y: Math.round((v - uu + 68) / 2) + 0.5 });
  const a = at(-18, 0), b = at(-9, 0);
  u.x = a.x; u.y = a.y; u.order = null; u.climb = null; u.hp = 1000;
  orderMove(s, [u], b.x, b.y);
  assert.ok(u.path && u.path.length > 1, 'a route round the barrier');
  for (let i = 0; i < 30 * 90 && u.order; i++) { update(s, 1 / 30); assert.ok(!rockAt(s.map, u.x, u.y), 'never on rock, never out of the valley'); }
  assert.ok(!u.order && Math.hypot(u.x - b.x, u.y - b.y) < 1, 'through a gap and arrived');
  createGame();
});

test('Artillery cannot fire on the move: moving ends a barrage, and the guns unlimber before firing', async () => {
  const { orderBarrage, orderMove } = await import('../src/game.js');
  const s = createGame();
  s.ais.length = 0;
  const g = s.units.find((u) => u.team === PLAYER && u.type === 'artillery');
  const tx = g.x + 20 * (s.map.hq[ENEMY].x > g.x ? 1 : -1), ty = g.y;
  assert.equal(orderBarrage(s, [g], tx, ty), 1);
  orderMove(s, [g], g.x, g.y + 3);
  assert.equal(g.barrage, null, 'moving ends the barrage');
  const shells = () => s.shells.length;
  for (let i = 0; i < 30 * 3 && g.order; i++) { update(s, 1 / 30); assert.equal(shells(), 0, 'no shells on the move'); }
  // a new barrage waits for the guns to be unlimbered
  g.order = null; g.setup = 4; g.cooldown = 0;
  assert.equal(orderBarrage(s, [g], tx, ty), 1);
  for (let i = 0; i < 30 * 3.5; i++) update(s, 1 / 30);
  assert.equal(shells(), 0, 'still unlimbering');
  for (let i = 0; i < 30 * 2; i++) update(s, 1 / 30);
  assert.ok(shells() > 0, 'firing once set up');
  createGame();
});

test('Climbing out of and into trenches takes time and slows the men', async () => {
  const { orderMove } = await import('../src/game.js');
  const s = createGame(); s.ais.length = 0;
  const u = s.units.find((q) => q.team === PLAYER && q.type === 'rifle' && q.inTrench);
  s.units = [u];
  // out over the parapet towards the enemy
  orderMove(s, [u], u.x + 3 * (s.map.hq[ENEMY].x > u.x ? 1 : -1), u.y);
  let climbedOut = false, outTime = 0;
  for (let i = 0; i < 30 * 12 && u.order; i++) { update(s, 1 / 30); if (u.climb && u.climb.out) { climbedOut = true; outTime += 1 / 30; } }
  assert.ok(climbedOut, 'climbs out');
  assert.ok(outTime > 1.5, `the climb takes time (${outTime.toFixed(1)} s)`);
  assert.ok(!u.inTrench);
  // and back down into it
  const back = s.map.tiles.find((t) => t.trench && Math.hypot(t.x + 0.5 - u.x, t.y + 0.5 - u.y) < 4);
  orderMove(s, [u], back.x + 0.5, back.y + 0.5);
  let climbedIn = false;
  for (let i = 0; i < 30 * 12 && u.order; i++) { update(s, 1 / 30); if (u.climb && !u.climb.out) climbedIn = true; }
  assert.ok(climbedIn, 'climbs down into the trench');
  createGame();
});

test('MG teams climb out of trenches too, group by group', async () => {
  const { orderMove, spawnUnit, CLIMB, CLIMB_GAP } = await import('../src/game.js');
  for (const type of ['mg']) {
    const s = createGame(); s.ais.length = 0;
    const t = s.map.tiles.find((q) => q.trench && q.owner === PLAYER && !tileOk(s, q.x + 1, q.y));
    function tileOk(st, x, y) { const n = st.map.tiles[y * st.map.w + x]; return n && n.trench; }
    const u = spawnUnit(s, type, PLAYER, t.x + 0.5, t.y + 0.5);
    s.units = [u];
    update(s, 1 / 30);
    assert.ok(u.inTrench);
    orderMove(s, [u], t.x + 3.5, t.y + 0.5);
    let time = 0;
    for (let i = 0; i < 30 * 20 && u.order; i++) { update(s, 1 / 30); if (u.climb && u.climb.out) time += 1 / 30; }
    const want = CLIMB[type].out * (1 + CLIMB_GAP * (CLIMB[type].groups - 1));
    assert.ok(time > want * 0.9, `${type} climbs out in turn (${time.toFixed(1)} s of ${want.toFixed(1)})`);
  }
  createGame();
});

test('A machine gun packs up before it moves and sets up again before it fires', async () => {
  const { orderMove, MG_PACK } = await import('../src/game.js');
  const s = createGame(); s.ais.length = 0;
  const u = s.units.find((q) => q.team === PLAYER && q.type === 'mg');
  s.units = [u]; u.setup = 0; u.order = null;
  const x0 = u.x;
  orderMove(s, [u], u.x - 2 * Math.sign(s.map.hq[ENEMY].x - u.x), u.y);
  assert.ok(u.packing > 0, 'packing up');
  for (let i = 0; i < 30 * (MG_PACK - 0.3); i++) update(s, 1 / 30);
  assert.ok(Math.abs(u.x - x0) < 1e-6, 'does not move while packing');
  for (let i = 0; i < 30 * 8 && u.order; i++) update(s, 1 / 30);
  assert.ok(!u.order && Math.abs(u.x - x0) > 1, 'moved off');
  assert.ok(u.setup > 0, 'must set up again');
  createGame();
});

test('Path finding: along a trench it stays in the trench; through wire it goes round; it is quick to plan', async () => {
  const { orderMove, planRoute } = await import('../src/game.js');
  const { frontLine } = await import('../src/map.js');
  // 1. along the front line: two trench tiles ten rows apart, the line zigzagging between them
  const s = createGame(); s.ais.length = 0;
  const f = frontLine(s.map, PLAYER), M = 34;
  const u = s.units.find((q) => q.team === PLAYER && q.type === 'rifle');
  s.units = s.units.filter((q) => q.team === ENEMY || q === u); // keep the enemy, so the battle does not end
  for (const q of s.units) if (q !== u) { q.x = s.map.hq[ENEMY].x + 0.5; q.y = s.map.hq[ENEMY].y + 0.5; q.order = null; q.holdFire = true; }
  u.x = f[M - 5] + 0.5; u.y = M - 5 + 0.5; u.order = null; u.climb = null;
  update(s, 1 / 30);
  orderMove(s, [u], f[M + 5] + 0.5, M + 5 + 0.5);
  assert.ok(u.path && u.path.length > 1, 'a route, not the straight line');
  let climbs = 0, steps = 0;
  for (; steps < 30 * 40 && u.order; steps++) { update(s, 1 / 30); if (u.climb && u.climb.t < 1 / 25) climbs++; }
  assert.ok(!u.order, 'arrived');
  assert.equal(climbs, 0, 'never left the trench');
  // 2. through wire: the route goes round it, and arrives sooner than the straight line
  const w = createGame(); w.ais.length = 0;
  const v = w.units.find((q) => q.team === PLAYER && q.type === 'rifle');
  w.units = w.units.filter((q) => q.team === ENEMY || q === v);
  for (const q of w.units) if (q !== v) { q.x = w.map.hq[ENEMY].x + 0.5; q.y = w.map.hq[ENEMY].y + 0.5; q.order = null; q.holdFire = true; }
  const y0 = M + 8;
  for (let x = 30; x <= 34; x++) for (let y = y0 - 3; y <= y0 + 3; y++) w.map.tiles[y * w.map.w + x].wire = 100;
  const travel = (usePath) => {
    v.x = 27.5; v.y = y0 + 0.5; v.order = null; v.climb = null; v.suppression = 0; v.pinned = false; v.hp = 1000;
    orderMove(w, [v], 37.5, y0 + 0.5);
    if (!usePath) v.path = null;
    let t = 0;
    for (; t < 120 && v.order; t += 1 / 30) update(w, 1 / 30);
    return t;
  };
  const straight = travel(false), routed = travel(true);
  assert.ok(routed < straight * 0.8, `round the wire (${routed.toFixed(1)} s) beats through it (${straight.toFixed(1)} s)`);
  // 3. quick to plan, corner to corner of the battlefield
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) planRoute(w, { type: 'rifle', x: 8.5, y: 34.5 }, 60.5, 34.5 + (i % 5) - 2);
  assert.ok((performance.now() - t0) / 20 < 25, 'under 25 ms a route');
  createGame();
});

test('A battery never goes into a trench: it lays planks over it and crosses at ground level; trenches never form squares', async () => {
  const { orderMove, BRIDGE_TIME, canBuild } = await import('../src/game.js');
  const { frontLine, makesSquare } = await import('../src/map.js');
  const s = createGame(); s.ais.length = 0;
  const g = s.units.find((q) => q.team === PLAYER && q.type === 'artillery');
  s.units = s.units.filter((q) => q.team === ENEMY || q === g);
  for (const q of s.units) if (q !== g) { q.x = s.map.hq[ENEMY].x + 0.5; q.y = s.map.hq[ENEMY].y + 0.5; q.order = null; q.holdFire = true; }
  // from behind our front line to the far side of it, straight across
  const f = frontLine(s.map, PLAYER), row = 30, dir = Math.sign(s.map.hq[ENEMY].x - g.x);
  g.x = f[row] - dir * 2 + 0.5; g.y = row + 0.5; g.order = null; g.setup = 0; g.packing = 0;
  orderMove(s, [g], f[row] + dir * 2 + 0.5, row + 0.5);
  let bridged = 0, inTrench = false;
  for (let i = 0; i < 30 * 60 && g.order; i++) { update(s, 1 / 30); if (g.bridging) bridged += 1 / 30; if (g.inTrench) inTrench = true; }
  assert.ok(!g.order, 'crossed');
  assert.ok(!inTrench, 'never down in the trench');
  assert.ok(bridged >= BRIDGE_TIME * 0.9, `laid planks first (${bridged.toFixed(1)} s)`);
  assert.ok(s.map.tiles.some((t) => t.bridge), 'the planks stay');
  // no 2x2 blocks of trench on any map, and none can be dug
  const sq = (st) => { const m = st.map, T = (x, y) => { const t = m.tiles[y * m.w + x]; return t && !t.off && t.trench; }; let n = 0; for (let y = 0; y < m.h - 1; y++) for (let x = 0; x < m.w - 1; x++) if (T(x, y) && T(x + 1, y) && T(x, y + 1) && T(x + 1, y + 1)) n++; return n; };
  assert.equal(sq(s), 0);
  for (const id of ['ypres', 'isonzo', 'brusilov', 'chunuk', 'amiens']) assert.equal(sq(createLevelGame(id)), 0, id);
  const t = s.map.tiles.find((q) => !q.trench && !q.off && makesSquare(s.map, q.x, q.y));
  if (t) assert.equal(canBuild(s, PLAYER, 'trench', t.x + 0.5, t.y + 0.5).reason, 'Trenches cannot form a square');
  createGame();
});

test('Planks can be shelled away, and a battery on them is lost with them', async () => {
  const { BRIDGE_HP } = await import('../src/game.js');
  const s = createGame(); s.ais.length = 0;
  const t = s.map.tiles.find((q) => q.trench && q.owner === PLAYER && q.x > 8);
  t.bridge = 1; s.map.bridges = null;
  const g = s.units.find((q) => q.team === PLAYER && q.type === 'artillery');
  g.x = t.x + 0.5; g.y = t.y + 0.5; g.order = null;
  const bystander = s.units.find((q) => q.team === PLAYER && q.type === 'artillery' && q !== g);
  // shells on the planks until they go
  let hits = 0;
  while (t.bridge && hits < 10) { s.shells.push({ x: t.x + 0.5, y: t.y + 0.5, t: 0.05, flight: 0.05, team: ENEMY, fromX: t.x + 6, fromY: t.y, incoming: false }); for (let i = 0; i < 30 && s.shells.length; i++) update(s, 1 / 30); hits++; }
  assert.ok(!t.bridge, `planks smashed after ${hits} shells`);
  assert.ok(hits >= 2, 'it takes more than one shell');
  assert.ok(g.dead, 'the battery on them is lost');
  assert.ok(!bystander || !bystander.dead || Math.floor(bystander.x) === t.x, 'batteries elsewhere are not');
  assert.ok(BRIDGE_HP > 0);
  createGame();
});

test('New infantry and machine guns muster in the trenches by headquarters; batteries on firm ground', async () => {
  const { buyUnit } = await import('../src/game.js');
  const s = createGame(); s.ais.length = 0;
  s.resources[PLAYER] = { men: 999, ammo: 999, supplies: 999 };
  const made = [];
  for (const type of ['rifle', 'rifle', 'rifle', 'mg', 'artillery']) made.push(buyUnit(s, PLAYER, type));
  const tile = (u) => s.map.tiles[Math.floor(u.y) * s.map.w + Math.floor(u.x)];
  for (const u of made.slice(0, 4)) {
    assert.ok(tile(u).trench && tile(u).owner === PLAYER, `${u.type} starts in our trench`);
    assert.equal(u.order, null, 'and stays there');
  }
  assert.ok(new Set(made.slice(0, 3).map((u) => `${Math.floor(u.x)},${Math.floor(u.y)}`)).size >= 2, 'spread along the trench, not piled up');
  const g = made[4];
  assert.ok(!tile(g).trench && !g.order, 'the battery waits on firm ground');
  createGame();
});

test('The enemy never bombards its own men: no barrage on them, and a barrage lifts when they reach it', async () => {
  const { orderBarrage } = await import('../src/game.js');
  const s = createGame(); // the enemy is AI-controlled
  const g = s.units.find((u) => u.team === ENEMY && u.type === 'artillery'); g.setup = 0; g.cooldown = 0;
  const inf = s.units.find((u) => u.team === ENEMY && u.type === 'rifle');
  const tx = g.x - 20 * Math.sign(g.x - s.map.hq[PLAYER].x), ty = g.y;
  // his own squad on the target: he will not open fire
  inf.x = tx; inf.y = ty;
  assert.equal(orderBarrage(s, [g], tx, ty), 0, 'no barrage on his own men');
  // an empty target: he fires; then his squad walks into it and the guns lift
  inf.x = tx + 8; inf.y = ty;
  assert.equal(orderBarrage(s, [g], tx, ty), 1);
  inf.x = tx + 1; inf.y = ty; inf.order = null;
  for (let i = 0; i < 30 * 2; i++) update(s, 1 / 30);
  assert.equal(g.barrage, null, 'the barrage lifts');
  // the player's guns obey: they may fire where their own men are, if so ordered
  const pg = s.units.find((u) => u.team === PLAYER && u.type === 'artillery'); pg.setup = 0; pg.cooldown = 0;
  const pi = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  const px = pg.x + 20 * Math.sign(s.map.hq[ENEMY].x - pg.x);
  pi.x = px; pi.y = pg.y;
  assert.equal(orderBarrage(s, [pg], px, pg.y), 1, 'the player decides for himself');
  createGame();
});
