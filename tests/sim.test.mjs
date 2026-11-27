import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, update, orderBarrage, orderMove, placeBuild, buyUnit, damageUnit } from '../src/game.js';
import { tileAt, frontLine, teamDir } from '../src/map.js';
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
  const s = createGame({ start: 'east', aiTeams: [PLAYER, ENEMY], difficulty: 'hard' });
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
  // shot by a squad due east: he falls with an animation, oriented by the line of fire
  s.decals = [];
  for (let i = 0; i < 30; i++) { sq.hp = 60; sq.men = 6; sq.dead = false; damageUnit(s, sq, 12, null, { x: sq.x + 6, y: sq.y, kind: 'rifle' }); }
  assert.ok(s.decals.length >= 30, 'men fell');
  assert.ok(new Set(s.decals.map((b) => b.fall.k)).size >= 4, 'in several different ways');
  for (const b of s.decals) {
    assert.ok(b.fall && b.fall.dur > 0.3, 'falls');
    assert.ok(b.fall.k >= 0 && b.fall.k <= 4 && [0, 1, 2].includes(b.v), `fall ${b.fall.k} -> corpse ${b.v}`);
    const hx = Math.cos((b.dir * Math.PI) / 4); // head direction along the line of fire (shooter due east)
    if (b.v === 0) assert.ok(hx < -0.5, `on his back, head away from the shooter (dir ${b.dir})`);
    if (b.v === 1) assert.ok(hx > 0.5, `on his face, head towards the shooter (dir ${b.dir})`);
    if (b.v === 2) assert.ok(Math.abs(hx) < 0.75, `on his side, across the line of fire (dir ${b.dir})`);
  }
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

test('shells wreck trees and slowly damage trenches; damaged trenches protect less and T repairs them', async () => {
  const { trenchCover, TRENCH_COVER } = await import('../src/config.js');
  const s = createGame({ aiTeams: [] });
  const gun = s.units.find((u) => u.team === PLAYER && u.type === 'artillery');
  // a tree within range
  const tree = s.map.tiles.find((t) => t.decor === 'tree' && Math.hypot(t.x - gun.x, t.y - gun.y) < 30);
  // an enemy front-line trench section
  const M = Math.floor(s.map.h / 2), ex = frontLine(s.map, ENEMY)[M];
  const tr = tileAt(s.map, ex + 0.5, M + 0.5);
  const lvl = tr.trench, fresh = trenchCover(TRENCH_COVER, tr);
  s.resources[PLAYER].ammo = 1e5; s.supplyTimer = 1e9;
  const shell = (x, y) => s.shells.push({ x, y, t: 0.01, flight: 1, team: PLAYER, fromX: gun.x, fromY: gun.y });
  for (let i = 0; i < 4; i++) shell(tree.x + 0.5, tree.y + 0.5);
  step(s, 0.5);
  assert.notEqual(tree.decor, 'tree', 'the tree was brought down');
  shell(tr.x + 0.5, tr.y + 0.5); step(s, 0.2);
  const one = tr.dmg;
  assert.ok(one > 0 && one < 20, `one direct hit only dents a trench (${one})`);
  assert.equal(tr.trench, lvl, 'the works keep their level');
  for (let i = 0; i < 30; i++) shell(tr.x + 0.5, tr.y + 0.5);
  step(s, 0.5);
  assert.ok(tr.dmg > 80, `a pounding wrecks it (${tr.dmg})`);
  assert.ok(trenchCover(TRENCH_COVER, tr) > fresh + 0.3, 'a wrecked trench protects much less');
  // the enemy's trench: we can't repair it; our own we can, with T
  assert.equal(placeBuild(s, PLAYER, 'trench', tr.x + 0.5, tr.y + 0.5).ok, false);
  const px = frontLine(s.map, PLAYER)[M], mine = tileAt(s.map, px + 0.5, M + 0.5);
  assert.equal(placeBuild(s, PLAYER, 'trench', mine.x + 0.5, mine.y + 0.5).ok, false, 'an undamaged trench needs no repair');
  mine.dmg = 90;
  const sq = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  sq.x = mine.x + 0.5; sq.y = mine.y + 1.5; sq.order = null;
  const r = placeBuild(s, PLAYER, 'trench', mine.x + 0.5, mine.y + 0.5);
  assert.ok(r.ok, r.reason);
  step(s, 20);
  assert.equal(mine.dmg, 0, 'dug out again');
  assert.ok(mine.trench >= 1);
});

test('death cries: about a third of the men shot down, none of those killed by shells', () => {
  const s = createGame({ aiTeams: [] });
  const sq = s.units.find((u) => u.team === PLAYER && u.type === 'rifle');
  let shot = 0, cries = 0;
  for (let i = 0; i < 300; i++) {
    sq.hp = 60; sq.men = 6; sq.dead = false; s.events.length = 0;
    damageUnit(s, sq, 10, null, { x: sq.x + 5, y: sq.y, kind: 'rifle' });
    shot++; cries += s.events.filter((e) => e.type === 'death').length;
  }
  assert.ok(cries > shot * 0.22 && cries < shot * 0.45, `${cries} cries for ${shot} men shot`);
  let shelled = 0;
  for (let i = 0; i < 100; i++) {
    sq.hp = 60; sq.men = 6; sq.dead = false; s.events.length = 0;
    damageUnit(s, sq, 10, { x: sq.x, y: sq.y, d: 0.5 });
    shelled += s.events.filter((e) => e.type === 'death').length;
  }
  assert.equal(shelled, 0);
});

test('an HQ with enemy troops nearby cannot raise new units', async () => {
  const { hqThreatened } = await import('../src/game.js');
  const s = createGame({ aiTeams: [] });
  s.resources[PLAYER] = { men: 999, ammo: 999, supplies: 999 };
  assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'object', 'recruits normally');
  const raider = s.units.find((u) => u.team === ENEMY && u.type === 'rifle');
  const q = s.map.hq[PLAYER];
  raider.x = q.x + 0.5 + 4; raider.y = q.y + 0.5;
  assert.ok(hqThreatened(s, PLAYER));
  const before = s.units.length, men = s.resources[PLAYER].men;
  assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'string', 'refused');
  assert.equal(s.units.length, before);
  assert.equal(s.resources[PLAYER].men, men, 'nothing spent');
  raider.x = q.x + 0.5 + 12; s.time += 1.1;
  assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'object', 'recruits again once they are gone');
});

test('artillery has a minimum range', () => {
  const s = createGame({ aiTeams: [] });
  const gun = s.units.find((u) => u.team === PLAYER && u.type === 'artillery');
  const A = UNIT_TYPES.artillery;
  const dx = teamDir(PLAYER);
  assert.equal(orderBarrage(s, [gun], gun.x + dx * (A.artyMinRange - 2), gun.y), 0, 'too close');
  assert.equal(gun.barrage, null);
  assert.equal(orderBarrage(s, [gun], gun.x + dx * (A.artyMinRange + 4), gun.y), 1, 'in range');
});

test('near misses: a burst in the trench cut hits in full, one beside it on the same tile does not', () => {
  const blast = (where) => {
    const s = createGame({ aiTeams: [] });
    const u = s.units.find((x) => x.team === ENEMY && x.type === 'rifle' && x.inTrench);
    s.units = [u];
    const t = tileAt(s.map, u.x, u.y);
    u.x = t.x + 0.5; u.y = t.y + 0.5;
    const joins = (dx, dy) => { const n = tileAt(s.map, t.x + dx + 0.5, t.y + dy + 0.5); return n && n.trench; };
    // along the trench (an arm towards a joined section), or across it onto the parapet of the same tile
    const arm = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => joins(dx, dy));
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !joins(dx, dy)) || [arm[1], arm[0]];
    const [dx, dy] = where === 'cut' ? arm : side;
    const hp = u.hp;
    s.shells.push({ x: u.x + dx * 0.42, y: u.y + dy * 0.42, t: 0.01, flight: 1, team: PLAYER, fromX: 0, fromY: 0 });
    update(s, 0.05);
    return hp - u.hp;
  };
  const hit = blast('cut'), miss = blast('parapet');
  assert.ok(miss > 0 && miss < hit * 0.5, `parapet burst ${miss.toFixed(1)} vs burst in the trench ${hit.toFixed(1)}, same distance`);
});

test('difficulty sets how the computer fights and what it is supplied', () => {
  const easy = createGame({ difficulty: 'easy' }), hard = createGame({ difficulty: 'hard' });
  assert.ok(easy.ais[0].level.force < hard.ais[0].level.force);
  assert.ok(easy.ais[0].offensive > hard.ais[0].offensive, 'easy attacks later');
  for (const s of [easy, hard]) { s.supplyTimer = 0.01; s.resources = [{ men: 0, ammo: 0, supplies: 0 }, { men: 0, ammo: 0, supplies: 0 }]; update(s, 0.05); }
  assert.ok(easy.resources[ENEMY].ammo < hard.resources[ENEMY].ammo, 'the enemy is supplied by level');
  assert.equal(easy.resources[PLAYER].ammo, hard.resources[PLAYER].ammo, 'the player is not');
  createGame();
});

test('a machine gun sees men in the open, and men in a trench only from close by or straight along it', async () => {
  const { mgCanSee } = await import('../src/game.js');
  // a 12 x 6 field: a straight trench along row 2 (x 0-9), a dog-leg to row 4 at x 6 (row 4: x 6-11)
  const W = 12, H = 6, tiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles.push({ x, y, trench: (y === 2 && x <= 6) || (x === 6 && y >= 2 && y <= 4) || (y === 4 && x >= 6) ? 1 : 0, off: false });
  const map = { w: W, h: H, tiles };
  const gun = { x: 0.5, y: 2.5, inTrench: true };
  assert.ok(mgCanSee(map, gun, { x: 5.5, y: 0.5, inTrench: false }), 'a man in the open');
  assert.ok(mgCanSee(map, gun, { x: 5.5, y: 2.5, inTrench: true }), 'down the same straight trench (enfilade)');
  assert.ok(!mgCanSee(map, gun, { x: 9.5, y: 4.5, inTrench: true }), 'not round the traverse');
  assert.ok(mgCanSee(map, gun, { x: 9.5, y: 4.5, inTrench: true, climb: {} }), 'but a man climbing out shows himself');
  assert.ok(!mgCanSee(map, { x: 3.5, y: 0.5, inTrench: false }, { x: 9.5, y: 4.5, inTrench: true }), 'from the open ground beside it, not down into it from afar');
  assert.ok(mgCanSee(map, { x: 9.5, y: 3.4, inTrench: false }, { x: 9.5, y: 4.5, inTrench: true }), 'but from close by, yes');
  assert.ok(mgCanSee(map, { x: 0.5, y: 0.5, deck: 80 }, { x: 9.5, y: 4.5, inTrench: true }), 'and from high up on a ship\'s deck');
});

test('machine-gun fire on men down in a trench it cannot see into pins them down but kills none', () => {
  const s = createGame({ aiTeams: [] });
  const map = s.map;
  // an enemy trench tile, and open ground of our own 6 tiles in front of it with no straight trench between
  const t = map.tiles.find((q) => q.trench && q.owner === ENEMY && !q.off && Math.abs(q.y - map.h / 2) < 6);
  const dir = teamDir(ENEMY);
  let g = null;
  for (let k = 5; k <= 7 && !g; k++) { const q = tileAt(map, t.x + 0.5 - dir * k, t.y + 0.5); if (q && !q.trench && !q.wire && !q.rock) g = q; }
  assert.ok(g, 'a spot in front of the trench');
  s.units = [];
  const foe = s.units[s.units.push({ ...createGame({ aiTeams: [] }).units.find((u) => u.type === 'rifle') }) - 1];
  Object.assign(foe, { id: 9001, team: ENEMY, x: t.x + 0.5, y: t.y + 0.5, inTrench: true, holdFire: true, order: null, path: null, target: null, suppression: 0 });
  const gun = s.units[s.units.push({ ...createGame({ aiTeams: [] }).units.find((u) => u.type === 'mg') }) - 1];
  Object.assign(gun, { id: 9002, team: PLAYER, x: g.x + 0.5, y: g.y + 0.5, inTrench: false, setup: 0, order: null, path: null, target: null });
  const men = foe.men;
  let peak = 0;
  for (let i = 0; i < 30 * 12; i++) { update(s, 1 / 30); peak = Math.max(peak, foe.suppression); }
  assert.equal(foe.men, men, 'none killed');
  assert.ok(peak > 40, `kept down (suppression ${peak.toFixed(0)})`);
  // the same men out in the open are another matter
  Object.assign(foe, { x: g.x + 0.5 + dir * 3, y: g.y + 0.5, inTrench: false });
  for (let i = 0; i < 30 * 12; i++) update(s, 1 / 30);
  assert.ok(foe.men < men || foe.dead, 'in the open they are cut down');
});

test('a charge uses up a rifle squad\'s wind: it slows when winded and gets its breath back at rest', () => {
  const s = createGame({ aiTeams: [] });
  const u = s.units.find((q) => q.type === 'rifle' && q.team === PLAYER);
  s.units = [u];
  const dir = teamDir(PLAYER);
  // a long run over open ground behind our lines
  let at = null;
  for (const t of s.map.tiles) { if (t.off || t.trench || t.wire || t.rock) continue; let ok = true; for (let k = 1; k <= 14; k++) { const q = tileAt(s.map, t.x + 0.5 - dir * k, t.y + 0.5); if (!q || q.off || q.trench || q.wire || q.rock) { ok = false; break; } } if (ok) { at = t; break; } }
  Object.assign(u, { x: at.x + 0.5, y: at.y + 0.5, inTrench: false, stamina: 100 });
  orderMove(s, [u], at.x + 0.5 - dir * 14, at.y + 0.5, 'charge');
  const x0 = u.x;
  for (let i = 0; i < 30 * 2; i++) update(s, 1 / 30);
  const fresh = Math.abs(u.x - x0) / 2;
  for (let i = 0; i < 30 * 8; i++) update(s, 1 / 30);
  assert.ok(u.stamina < 35, `winded after a long charge (${u.stamina.toFixed(0)})`);
  const x1 = u.x;
  for (let i = 0; i < 30; i++) update(s, 1 / 30);
  const tired = Math.abs(u.x - x1);
  assert.ok(u.order === null || tired < fresh * 0.85, `slower when winded (${tired.toFixed(2)} vs ${fresh.toFixed(2)} tiles a second)`);
  u.order = null; u.path = null;
  const low = u.stamina;
  for (let i = 0; i < 30 * 3; i++) update(s, 1 / 30);
  assert.ok(u.stamina > low + 25, 'its breath back at rest');
});

test('pinned down in a trench, men shoot badly but move along it as usual', () => {
  const pace = (pinned) => {
    const s = createGame({ aiTeams: [] });
    const u = s.units.find((q) => q.type === 'rifle' && q.team === PLAYER);
    s.units = [u];
    // a straight run of our trench, five tiles along a row
    const t = s.map.tiles.find((q) => { for (let k = 0; k < 6; k++) { const r = tileAt(s.map, q.x + k + 0.5, q.y + 0.5); if (!r || !r.trench || r.owner !== PLAYER) return false; } return true; });
    Object.assign(u, { x: t.x + 0.5, y: t.y + 0.5, inTrench: true, order: null, path: null });
    orderMove(s, [u], t.x + 5.5, t.y + 0.5);
    for (let i = 0; i < 30 * 2; i++) { if (pinned) { u.suppression = 90; } update(s, 1 / 30); }
    return { moved: u.x - (t.x + 0.5), pinned: u.pinned };
  };
  const calm = pace(false), under = pace(true);
  assert.ok(under.pinned, 'pinned');
  assert.ok(Math.abs(under.moved - calm.moved) < 0.05, `as fast along the trench (${under.moved.toFixed(2)} vs ${calm.moved.toFixed(2)})`);
});

test('a headquarters taken must be held for five seconds to win; retaken in time, the battle goes on', () => {
  const s = createGame({ aiTeams: [] });
  s.units = s.units.filter((u) => u.team === PLAYER).slice(0, 1); // (an army left on each side: no 'broken' ending)
  s.units.push({ ...s.units[0], id: 9100, team: ENEMY, x: 1, y: 1 });
  const hq = s.map.hq[ENEMY], tile = s.map.tiles[hq.y * s.map.w + hq.x];
  tile.owner = PLAYER;
  for (let i = 0; i < 30 * 3; i++) update(s, 1 / 30);
  assert.equal(s.winner, -1, 'not yet, after three seconds');
  tile.owner = ENEMY; update(s, 1 / 30); // (retaken)
  tile.owner = PLAYER;
  for (let i = 0; i < 30 * 3; i++) update(s, 1 / 30);
  assert.equal(s.winner, -1, 'the count starts again when it is taken again');
  for (let i = 0; i < 30 * 3; i++) update(s, 1 / 30);
  assert.equal(s.winner, PLAYER, 'held five seconds: victory');
});

test('recruiting has a one-second cool-down', () => {
  const s = createGame({ aiTeams: [] });
  s.resources[PLAYER] = { men: 999, ammo: 999, supplies: 999 };
  assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'object');
  const res = { ...s.resources[PLAYER] };
  assert.equal(typeof buyUnit(s, PLAYER, 'mg'), 'string', 'not again at once');
  assert.deepEqual(s.resources[PLAYER], res, 'nothing spent');
  s.time += 0.5; assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'string', 'nor half a second later');
  s.time += 0.6; assert.equal(typeof buyUnit(s, PLAYER, 'rifle'), 'object', 'a second on: yes');
});

test('tanks take up room: two never overlap, nor a tank and a burnt-out hulk', async () => {
  const { spawnUnit, TANK_ROOM } = await import('../src/game.js');
  const s = createGame({ aiTeams: [] });
  s.units = s.units.filter((u) => u.type !== 'artillery'); // (nothing shelling the field)
  const M = s.map.h / 2, x0 = s.map.hq[PLAYER].x + 4;
  const a = spawnUnit(s, 'tank', PLAYER, x0 + 0.5, M - 3), b = spawnUnit(s, 'tank', PLAYER, x0 + 0.5, M + 3);
  // (no random breakdowns or ditching here: this is about room, not reliability)
  const step = () => { update(s, 0.1); for (const t of [a, b]) if (t.stuck) t.stuck = null; };
  for (const t of [a, b]) orderMove(s, [t], x0 + 0.5, M + 0.5); // both sent to the same spot
  let closest = Infinity;
  for (let k = 0; k < 300; k++) { step(); closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y)); }
  assert.ok(closest >= TANK_ROOM - 0.05, `the two tanks kept apart (closest ${closest.toFixed(2)})`);
  assert.ok(!a.order && !b.order, 'and both stopped, one beside the other');
  // head on, each to where the other was: they edge past each other, never overlapping, and both arrive
  const pa = { x: b.x, y: b.y }, pb = { x: a.x, y: a.y };
  orderMove(s, [a], pa.x, pa.y); orderMove(s, [b], pb.x, pb.y);
  closest = Infinity;
  for (let k = 0; k < 900; k++) { step(); closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y)); }
  assert.ok(closest >= TANK_ROOM - 0.05, `head on, they kept apart (closest ${closest.toFixed(2)})`);
  assert.ok(Math.hypot(a.x - pa.x, a.y - pa.y) < 0.2 && Math.hypot(b.x - pb.x, b.y - pb.y) < 0.2, `and both got past to where they were going (${[a, b].map((u) => `${u.x.toFixed(2)},${u.y.toFixed(2)} ${u.order ? 'moving' : 'stopped'} ${u.dead ? 'dead' : ''}`).join(' | ')}; wanted ${pa.x.toFixed(2)},${pa.y.toFixed(2)} and ${pb.x.toFixed(2)},${pb.y.toFixed(2)})`);
  // a hulk in the way
  s.hulks = [{ x: x0 + 0.5, y: M - 6, team: PLAYER, t: 0 }];
  orderMove(s, [a], x0 + 0.5, M - 6);
  for (let k = 0; k < 300; k++) step();
  assert.ok(Math.hypot(a.x - s.hulks[0].x, a.y - s.hulks[0].y) >= TANK_ROOM - 0.05, 'a tank cannot drive into a hulk');
});

test('headquarters keeps watch like a unit: an enemy near it is seen with none of our men about', async () => {
  const { spawnUnit, HQ_SIGHT } = await import('../src/game.js');
  const s = createGame({ aiTeams: [] });
  const q = s.map.hq[PLAYER];
  s.units = s.units.filter((u) => u.team === ENEMY || Math.hypot(u.x - q.x, u.y - q.y) > 25); // (none of ours anywhere near)
  const near = spawnUnit(s, 'rifle', ENEMY, q.x + 0.5 + teamDir(PLAYER) * (HQ_SIGHT - 2), q.y + 0.5);
  const far = spawnUnit(s, 'rifle', ENEMY, q.x + 0.5 + teamDir(PLAYER) * (HQ_SIGHT + 6), q.y + 0.5);
  update(s, 0.3);
  assert.ok(near.visible, 'within its sight: seen');
  assert.ok(!far.visible || s.units.some((u) => u.team === PLAYER && Math.hypot(u.x - far.x, u.y - far.y) < 10), 'beyond it: not seen from headquarters');
});
