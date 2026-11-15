// Campaign mode: five levels, each a battle with its own setup, objectives, timed events and medals.
// DOM-free (driven from main.js, and headlessly from the tests). A level's progress lives in
// state.campaign as plain data, so a campaign battle saves and loads like any other.
import { PLAYER, ENEMY, DIFFICULTY } from './config.js';
import { createGame, spawnUnit, pushMessage, orderMove } from './game.js';
import { frontLine, teamDir, tileAt } from './map.js';

const DAY_LENGTH = 420; // seconds of game time per 24 hours (as atmosphere.js)

/** Hours since midnight of day 1 at the battle's current time. */
export function clockHours(state) {
  return (state.startHour ?? 9) + (state.time / (state.dayLength || DAY_LENGTH)) * 24;
}
/** "Day 2, 14:30" for a number of hours since midnight of day 1. */
export function dayTime(h) {
  const day = Math.floor(h / 24) + 1, hh = Math.floor(h % 24), mm = Math.floor((h % 1) * 60);
  return `Day ${day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
const left = (h) => { const d = Math.floor(h / 24), r = Math.floor(h % 24), m = Math.floor((h % 1) * 60); return d ? `${d} d ${r} h` : r ? `${r} h ${m} min` : `${m} min`; };

/** The player's front-line trench tiles (indices into map.tiles) as the battle begins. */
function frontTiles(state) {
  const f = frontLine(state.map, PLAYER), out = [];
  f.forEach((x, y) => { if (x >= 0) out.push(y * state.map.w + x); });
  return out;
}
const frontHeld = (state) => state.campaign.front.filter((i) => state.map.tiles[i].owner === PLAYER).length;

/** A wave of squads coming up from a team's HQ. */
function reinforce(state, team, n, kind = 'rifle') {
  const q = state.map.hq[team], dir = teamDir(team), out = [];
  for (let i = 0; i < n; i++) {
    const u = spawnUnit(state, kind, team, q.x + 0.5 + dir * (1 + (i % 3) * 0.6), q.y + 0.5 + (i - (n - 1) / 2) * 1.4);
    orderMove(state, [u], q.x + 0.5 + dir * 4, q.y + 0.5 + (i - (n - 1) / 2) * 2);
    out.push(u);
  }
  return out;
}

/**
 * A relieving force marching onto the battlefield from the team's rear edge: one squad every second
 * row along the whole front, each making for the front-line trench in its row. Returns the squads.
 */
function relieve(state, team, nation) {
  const { map } = state, f = frontLine(map, team), west = teamDir(team) > 0, out = [];
  for (let y = 1; y < map.h - 1; y += 2) {
    if (f[y] < 0) continue;
    let x = west ? 0 : map.w - 1;
    while (map.tiles[y * map.w + x].off && x >= 0 && x < map.w) x += west ? 1 : -1; // the battlefield's edge in this row
    const u = spawnUnit(state, 'rifle', team, x + 0.5, y + 0.5);
    if (nation) u.nation = nation; // allies in their own uniform
    orderMove(state, [u], f[y] + 0.5, y + 0.5);
    u.reliefTo = { x: f[y] + 0.5, y: y + 0.5 };
    out.push(u);
  }
  return out;
}

/**
 * Impassable rock outcrops (the Alpine karst): small clusters of 1-4 tiles, kept clear of trenches,
 * wire, headquarters and troops, and apart from each other so men can always walk round them.
 */
function scatterRocks(state, count, seed) {
  const { map } = state;
  let r = seed >>> 0;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const near = (t, d, f) => { for (let y = t.y - d; y <= t.y + d; y++) for (let x = t.x - d; x <= t.x + d; x++) { const n = tileAt(map, x, y); if (n && f(n)) return true; } return false; };
  const ok = (t) => t && !t.off && !t.trench && !t.wire && !t.rock && !t.build
    && !near(t, 2, (n) => n.trench || n.wire) && !near(t, 3, (n) => n.rock)
    && [map.hq[0], map.hq[1]].every((q) => Math.hypot(q.x - t.x, q.y - t.y) > 5)
    && !state.units.some((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 2);
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < count; tries++) {
    const t = map.tiles[Math.floor(rnd() * map.tiles.length)];
    if (!ok(t)) continue;
    const cluster = [t];
    t.rock = 1 + Math.floor(rnd() * 4);
    const extra = Math.floor(rnd() * 4);
    for (let k = 0; k < extra; k++) {
      const b = cluster[Math.floor(rnd() * cluster.length)], dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
      const n = tileAt(map, b.x + dir[0], b.y + dir[1]);
      if (n && !n.off && !n.trench && !n.wire && !n.rock && !near(n, 1, (q) => q.trench || q.wire)) { n.rock = 1 + Math.floor(rnd() * 4); cluster.push(n); }
    }
    for (const c of cluster) { c.decor = null; c.crater = 0; }
    placed++;
  }
  map.rocks = true;
  map.dirty = true;
}

/** The trench tile of a team's line `off` tiles behind its front line in row y (front = 0, support = 7, reserve = 11). */
function trenchBehind(map, team, y, off) {
  const f = frontLine(map, team), x0 = f[y] - teamDir(team) * off;
  let best = null, bd = Infinity;
  for (let dy = 0; dy <= 2 && !best; dy++) for (const yy of [y - dy, y + dy]) for (let x = x0 - 2; x <= x0 + 2; x++) {
    const t = tileAt(map, x, yy);
    if (t && t.trench && t.origOwner === team && Math.abs(x - x0) + Math.abs(yy - y) < bd) { bd = Math.abs(x - x0) + Math.abs(yy - y); best = t; }
  }
  return best;
}

// ------------------------------------------------------------------ the levels
export const LEVELS = [
  {
    id: 'ypres', n: 1, title: 'Hold Until Relieved', place: 'Dixmude, Belgium', date: 'October 1914',
    nations: ['france', 'germany'], season: 'mud', start: 'west', startHour: 6.5,
    history: 'October 1914. The German army is driving for the Channel ports along the river Yser, and only a thin line stands in its way. At Dixmude, Admiral Ronarc\'h and his brigade of French naval infantry, the Fusiliers Marins, sailors who have never fought on land, are ordered to hold the town and its bridgehead for at least four days, until reinforcements can come up. Dig in, and hold.',
    objectives: ['Hold until the relief arrives at dawn on day 4.', 'Do not let the enemy take your headquarters.', 'Do not lose more than half of your front line.'],
    rules: ['Your trenches are strong: sandbagged all along your line.', 'Supplies are short: the convoys bring 70% of the usual.', 'The enemy attacks in strength every few hours, day and night, and fresh battalions come up behind him.'],
    medals: ['Held until relieved', 'Not a yard given: no more than 4 front-line sections lost at the end', 'A careful commander: fewer than 350 men lost'],
    debrief: {
      won: 'The reinforcements came up through the mud at dawn on the fourth day and found the sailors still in their trenches. Ordered to hold Dixmude for four days, Ronarc\'h\'s Fusiliers Marins held it for more than three weeks, at the cost of half their number. By then the Yser valley had been flooded, and the German drive on the Channel ports was over.',
      lost: 'Your line broke before the reinforcements could reach you. At Dixmude in 1914 it did not: the Fusiliers Marins, ordered to hold for four days, held for more than three weeks, and the Germans never reached the Channel ports.',
    },
    setup(state) {
      // strong works: our trenches sandbagged
      for (const t of state.map.tiles) if (t.trench && t.owner === PLAYER) t.trench = Math.max(t.trench, 2);
      state.map.dirty = true;
      state.resources[PLAYER] = { men: 18, ammo: 260, supplies: 110 };
      state.playerIncome = 0.7;
      // a relentless enemy: hard, attacking early and often with big forces
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.hard, firstAttack: 170, attackGap: [160, 220], force: 7, steps: 3 };
      ai.offensive = 170;
      // the battalion reserve: squads and a machine gun around headquarters
      reinforce(state, PLAYER, 3);
      const q = state.map.hq[PLAYER], d = teamDir(PLAYER);
      spawnUnit(state, 'mg', PLAYER, q.x + 0.5 + d * 2, q.y + 0.5);
      state.campaign.front = frontTiles(state);
    },
    events: [
      { at: 24 + 0, run: (s) => pushMessage(s, 'Day 2. The relief is still two days away.', 'side') },
      { at: 48 + 0, run: (s) => pushMessage(s, 'Day 3. The reinforcements are on the road from Dunkirk. Hold on one more day.', 'side') },
      ...[13, 29, 38, 52, 62, 71].map((at) => ({ at, run: (s) => { reinforce(s, ENEMY, 4); pushMessage(s, 'Fresh German reserves are coming up behind their line.', 'warn'); } })),
      { at: 72 + 6, run: (s) => {
        s.campaign.relief = relieve(s, PLAYER).map((u) => u.id);
        s.campaign.relievedAt = s.time;
        pushMessage(s, 'The reinforcements have arrived! A fresh French division is marching up to our line.', 'good');
        s.events.push({ type: 'cheer' });
      } },
    ],
    check(state) {
      const c = state.campaign;
      if (c.relievedAt !== undefined) {
        // won when most of the relief has reached the front line (or, failing that, after a minute)
        const rel = state.units.filter((u) => c.relief.includes(u.id) && !u.dead);
        const there = rel.filter((u) => Math.hypot(u.x - u.reliefTo.x, u.y - u.reliefTo.y) < 2.5).length;
        if (!c.manned && (there >= rel.length * 0.8 || state.time - c.relievedAt > 60)) {
          c.manned = state.time;
          pushMessage(state, 'The reinforcements are in our trenches. Dixmude is held!', 'good');
          state.events.push({ type: 'cheer' });
        }
        if (c.manned && state.time - c.manned > 4) return { result: 'won', reason: 'Relieved. You held the line.' };
      }
      if (frontHeld(state) < c.front.length / 2) return { result: 'lost', reason: 'More than half of your front line has fallen.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      return [
        'Hold until relieved',
        c.relievedAt !== undefined ? 'The relief has arrived.' : `Relief: dawn of day 4, in ${left(Math.max(0, 78 - h))}`,
        `Front line held: ${frontHeld(state)} / ${c.front.length} (no fewer than ${Math.ceil(c.front.length / 2)})`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.front.length - frontHeld(state) <= 4, won && state.stats.lost[PLAYER] < 350];
    },
  },
  {
    id: 'isonzo', n: 2, title: 'Silence the Guns', place: 'The Isonzo, Italy', date: 'August 1916',
    nations: ['italy', 'austria'], season: 'thaw', start: 'west', startHour: 5,
    history: 'The Sixth Battle of the Isonzo. Five times the Italian army has thrown itself at the Austro-Hungarian line above the river, and five times it has been cut down by machine guns firing from concrete emplacements in the rock. This time the guns must be found and silenced first. Three nests command the whole sector; until they fall, no attack can cross the open ground. Your batteries have been given shells for only a handful of barrages: make every one count.',
    objectives: ['Silence all three machine-gun nests in the enemy lines.', 'Do it before nightfall on day 2.', 'Do not let the enemy take your headquarters.'],
    rules: ['The nests are concrete pillboxes, one in each of his three lines: front, support and reserve. Shellfire alone rarely finishes them: bombard, then send the infantry in while the crews are pinned.', 'The deeper nests lie beyond the reach of your guns from where they stand: take ground and bring the batteries forward.', 'Shells are rationed: 12 battery barrages for the whole battle.', 'The enemy holds deep wire and counter-attacks any trench he loses.'],
    medals: ['The guns are silenced', 'Swift work: all three silenced before nightfall on day 1', 'Shells to spare: 3 or more barrages unused'],
    debrief: {
      won: 'With the machine guns silent, the Italian infantry crossed the open ground at last. In August 1916 the Sixth Battle of the Isonzo took Monte Sabotino and San Michele, and Gorizia fell: the greatest Italian victory of the war until its final year.',
      lost: 'The nests were still firing when night fell on the second day, and the attack was called off. Eleven times the Italians attacked on the Isonzo; most of those battles ended like this, with a few hundred yards gained at a terrible price.',
    },
    setup(state) {
      const { map } = state, W = map.w;
      state.resources[PLAYER] = { men: 30, ammo: 420, supplies: 140 };
      state.barrageLimit = { [PLAYER]: 12 };
      // three batteries, dug in just behind the front line opposite the nests, within range of them
      const q = map.hq[PLAYER], d = teamDir(PLAYER), f = frontLine(map, PLAYER);
      spawnUnit(state, 'artillery', PLAYER, q.x + 0.5, q.y + 0.5);
      const guns = state.units.filter((u) => u.team === PLAYER && u.type === 'artillery');
      const M = Math.floor(map.h / 2);
      guns.forEach((g, i) => { const y = M + [-10, 0, 10][i]; g.x = f[y] - d * 4 + 0.5; g.y = y + 0.5; });
      // the enemy defends: late, small offensives, but he still counter-attacks lost trenches
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.hard, firstAttack: 900, attackGap: [500, 700] };
      ai.offensive = 900;
      // the nests: concrete pillboxes in depth, one in each of his three lines (front on one flank,
      // support in the centre, reserve on the other flank); they never move
      const nests = [[0, M - 10], [7, M + 1], [11, M + 10]].map(([off, y]) => {
        const t = trenchBehind(map, ENEMY, y, off);
        const u = spawnUnit(state, 'mg', ENEMY, t.x + 0.5, t.y + 0.5);
        u.ai.role = 'nest'; u.nest = true; u.inTrench = true; u.setup = 0;
        // a rifle squad guarding each side of it
        for (const dy of [-2, 2]) {
          const gt = trenchBehind(map, ENEMY, t.y + dy, off);
          spawnUnit(state, 'rifle', ENEMY, gt.x + 0.5, gt.y + 0.5).ai.role = 'hold';
        }
        for (let yy = t.y - 1; yy <= t.y + 1; yy++) for (let xx = t.x - 1; xx <= t.x + 1; xx++) {
          const n = map.tiles[yy * W + xx];
          if (n && n.trench && n.owner === ENEMY) n.trench = 3;
        }
        return u;
      });
      // the ordinary machine gun on the front line nearest the first nest makes way for it
      const near = state.units.find((u) => u.team === ENEMY && u.type === 'mg' && !u.nest && Math.abs(u.y - nests[0].y) < 3);
      if (near) state.units = state.units.filter((u) => u !== near);
      state.bunkers = nests.map((u) => ({ id: u.id, x: u.x, y: u.y }));
      scatterRocks(state, 18, 1916);
      map.dirty = true;
      state.campaign.nests = nests.map((u) => u.id);
      state.campaign.silenced = [];
    },
    events: [
      { at: 5.2, run: (s) => pushMessage(s, 'Three machine-gun nests are marked in the enemy lines, one in each line. Silence them all before nightfall tomorrow.', 'side') },
      { at: 24 + 5, run: (s) => pushMessage(s, 'Day 2. The attack must succeed by nightfall.', 'side') },
      { at: 24 + 16, run: (s) => pushMessage(s, 'Three hours of daylight left.', 'warn') },
    ],
    check(state) {
      const c = state.campaign;
      for (const id of c.nests) {
        if (c.silenced.includes(id)) continue;
        const u = state.units.find((q) => q.id === id);
        if (!u || u.dead) {
          c.silenced.push(id);
          if (c.silenced.length === 1) c.firstAt = clockHours(state);
          pushMessage(state, c.silenced.length < 3 ? `A machine-gun nest is silenced! ${3 - c.silenced.length} still firing.` : 'The last machine-gun nest is silenced!', 'good');
          state.events.push({ type: 'cheer' });
        }
      }
      if (c.silenced.length >= c.nests.length) {
        c.doneAt = c.doneAt ?? clockHours(state);
        c.wonAt = c.wonAt ?? state.time;
        if (state.time - c.wonAt > 4) return { result: 'won', reason: 'The guns are silenced.' };
        return null;
      }
      if (clockHours(state) >= 24 + 19) return { result: 'lost', reason: 'Night fell on the second day with the nests still firing.' };
      return null;
    },
    markers(state) {
      const c = state.campaign;
      return c.nests.map((id) => state.units.find((u) => u.id === id)).filter((u) => u && !u.dead).map((u) => ({ x: u.x, y: u.y, label: 'MG nest' }));
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      return [
        'Silence the guns',
        `Nests silenced: ${c.silenced.length} / ${c.nests.length}`,
        `Barrages left: ${state.barrageLimit[PLAYER]}`,
        `Nightfall on day 2 in ${left(Math.max(0, 43 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.doneAt < 19.5, won && state.barrageLimit[PLAYER] >= 3];
    },
  },
  {
    id: 'brusilov', n: 3, title: 'The Brusilov Breakthrough', place: 'Galicia', date: 'June 1916',
    nations: ['russia', 'austria'], season: 'mud', start: 'west', startHour: 4,
    history: 'June 1916. General Brusilov has broken every rule of the Western Front. There is no single great blow aimed at one point: his armies attack together along hundreds of miles, after a short, sharp bombardment, from saps dug right up to the enemy wire. Opposite you the Austro-Hungarian line is thinly held, its best divisions sent away to Italy. It will not stay that way: reserves are already on the railway. Strike fast and wide, and take their headquarters before the line can be shored up.',
    objectives: ['Take the enemy headquarters.', 'Do it within three days: by midnight on day 3.', 'Do not let the enemy take your headquarters.'],
    rules: ['The enemy line is thinly held at first: half its usual garrison, and half its wire.', 'Austrian reserves arrive on the evening of day 1 and again on day 2: the longer you wait, the stronger the line.', 'You have five batteries and a large army: attack along the whole front, not at one point.'],
    medals: ['The breakthrough', 'Before the second reserves: enemy headquarters taken by day 2, 20:00', 'A broad front: half the enemy front line in your hands at the end'],
    debrief: {
      won: 'The Austro-Hungarian line gave way along its whole length. The Brusilov Offensive was the greatest Russian victory of the war: in a few weeks it took some 400,000 prisoners and nearly knocked Austria-Hungary out of the war, before German reserves and Russian exhaustion brought it to a halt.',
      lost: 'The reserves came up in time and the line held. Even the Brusilov Offensive, the most successful attack of the war on any front until 1918, was in the end stopped this way, and its cost in Russian lives helped bring the revolution of 1917.',
    },
    setup(state) {
      const { map } = state;
      state.resources[PLAYER] = { men: 40, ammo: 520, supplies: 160 };
      // a big army: four more squads and three more batteries behind the line
      reinforce(state, PLAYER, 4);
      const d = teamDir(PLAYER), f = frontLine(map, PLAYER), M = Math.floor(map.h / 2);
      for (const dy of [-13, 0, 13]) spawnUnit(state, 'artillery', PLAYER, f[M + dy] - d * 6 + 0.5, M + dy + 0.5);
      // a thin line: half the enemy's rifle squads gone (sent to Italy)
      const rifles = state.units.filter((u) => u.team === ENEMY && u.type === 'rifle');
      const gone = new Set(rifles.filter((_, i) => i % 2 === 1).map((u) => u.id));
      const mgs = state.units.filter((u) => u.team === ENEMY && u.type === 'mg');
      gone.add(mgs[mgs.length - 1].id); // and one of his machine guns
      state.units = state.units.filter((u) => !gone.has(u.id));
      // neglected wire: half of it is gone
      let k = 0;
      for (const t of map.tiles) if (t.wire && t.origWire === ENEMY && k++ % 2) t.wire = 0;
      map.dirty = true;
      state.resources[ENEMY] = { men: 6, ammo: 200, supplies: 60 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 1200, attackGap: [600, 800], income: 0.6 };
      ai.offensive = 1200;
      state.campaign.efront = (() => { const ef = frontLine(map, ENEMY), out = []; ef.forEach((x, y) => { if (x >= 0) out.push(y * map.w + x); }); return out; })();
    },
    events: [
      { at: 4.1, run: (s) => pushMessage(s, 'The enemy line is thin. Attack everywhere at once, before his reserves come up.', 'side') },
      { at: 16, run: (s) => pushMessage(s, 'Air reconnaissance: Austrian reserves are coming up by rail. They will reach the line this evening.', 'warn') },
      { at: 20, run: (s) => { reinforce(s, ENEMY, 5); reinforce(s, ENEMY, 1, 'mg'); pushMessage(s, 'Austrian reserves have reached their line.', 'warn'); } },
      { at: 24 + 4, run: (s) => pushMessage(s, 'Day 2. More reserves are on the way, German divisions among them.', 'side') },
      { at: 24 + 20, run: (s) => { reinforce(s, ENEMY, 6); reinforce(s, ENEMY, 2, 'mg'); pushMessage(s, 'Fresh enemy reserves have reached their line.', 'warn'); } },
      { at: 48 + 4, run: (s) => pushMessage(s, 'Day 3. The breakthrough must be made today.', 'side') },
    ],
    check(state) {
      if (clockHours(state) >= 72) return { result: 'lost', reason: 'Three days have passed and the enemy line still holds.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const held = c.efront.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      const next = h < 20 ? `Enemy reserves arrive in ${left(20 - h)}` : h < 44 ? `More enemy reserves in ${left(44 - h)}` : 'All enemy reserves have arrived';
      return [
        'Take the enemy headquarters',
        next,
        `Enemy front line taken: ${held} / ${c.efront.length}`,
        `Time left: ${left(Math.max(0, 72 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      const held = c.efront.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      return [won, won && c.endHour < 44, won && held >= c.efront.length / 2];
    },
  },
  {
    id: 'chunuk', n: 4, title: 'Counter-attack at Chunuk Bair', place: 'Gallipoli', date: 'August 1915',
    nations: ['ottoman', 'uk'], season: 'mud', start: 'west', startHour: 4.5,
    history: 'August 1915. In a night attack the British and New Zealanders have climbed the ridge of Chunuk Bair and seized the heights at the centre of your line. From there they can look down on the Dardanelles: if they hold it, the whole peninsula is lost. Lieutenant-Colonel Mustafa Kemal has ordered a counter-attack at first light. Every hour you wait, the enemy digs deeper and strings more wire. Take back every yard before dusk.',
    objectives: ['Retake every section of your front line the enemy has seized.', 'Do it before dusk on day 1 (19:30).', 'Do not let the enemy take your headquarters.'],
    rules: ['The enemy holds the centre of your front line with infantry and a machine gun.', 'Every hour he holds it he digs in deeper and wires it more thickly, and fresh men come up to him.', 'Your men may attack at once: the sooner, the cheaper.'],
    medals: ['The heights retaken', 'At first light: every section retaken before 10:00', 'Fewer than 300 men lost'],
    debrief: {
      won: 'At dawn on 10 August 1915 Mustafa Kemal led the counter-attack in person and swept the British off Chunuk Bair. It was the turning point of the August offensive: the Allies never came so close again, and four months later they left Gallipoli. Kemal went on to found modern Turkey.',
      lost: 'The enemy held the heights through the day. At Gallipoli the Ottoman line on Chunuk Bair was in fact retaken, at dawn on 10 August, by a counter-attack led from the front; without it, the campaign might have ended very differently.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2);
      const front = frontTiles(state);
      // the enemy has the centre of our front line: every front-line section within 6 rows of the middle
      const lost = front.filter((i) => Math.abs(Math.floor(i / W) - M) <= 6);
      for (const i of lost) map.tiles[i].owner = ENEMY;
      // our men who held it are gone; the enemy's are in it
      const inLost = (u) => lost.some((i) => Math.hypot(u.x - ((i % W) + 0.5), u.y - (Math.floor(i / W) + 0.5)) < 1.2);
      state.units = state.units.filter((u) => !(u.team === PLAYER && inLost(u)));
      const at = (i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
      lost.forEach((i, k) => {
        if (k % 3 !== 1) return;
        const p = at(i), g = spawnUnit(state, k === Math.floor(lost.length / 2) || k === Math.floor(lost.length / 2) + 1 ? 'mg' : 'rifle', ENEMY, p.x, p.y);
        g.ai.role = 'garrison';
      });
      const mid = at(lost[Math.floor(lost.length / 2)]);
      if (!state.units.some((u) => u.team === ENEMY && u.type === 'mg' && u.ai.role === 'garrison')) spawnUnit(state, 'mg', ENEMY, mid.x, mid.y).ai.role = 'garrison';
      map.dirty = true;
      // a strong reserve of our own behind the line, ready to go in
      reinforce(state, PLAYER, 4);
      state.resources[PLAYER] = { men: 30, ammo: 360, supplies: 120 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 1500, attackGap: [600, 800] };
      ai.offensive = 1500;
      state.campaign.lost = lost;
      state.campaign.dug = 0;
    },
    events: [
      { at: 4.6, run: (s) => pushMessage(s, 'The enemy holds the heights in the centre of our line. Counter-attack at once!', 'side') },
      // every hour the enemy holds on he digs in, wires himself in, and is reinforced
      ...[5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5].map((at, k) => ({ at, run: (s) => {
        const { map } = s, c = s.campaign, d = teamDir(PLAYER);
        let any = false;
        for (const i of c.lost) {
          const t = map.tiles[i];
          if (t.owner !== ENEMY) continue;
          any = true;
          if (k % 2 === 1) t.trench = Math.min(3, t.trench + 1); // sandbags, then concrete
          for (const back of [1, 2]) { // wire on our side of the captured trench
            const w = map.tiles[i - d * back];
            if (w && !w.off && !w.trench && Math.random() < 0.35 + k * 0.05) { w.wire = 100; w.origWire = ENEMY; }
          }
        }
        if (!any) return;
        map.dirty = true; c.dug++;
        if (k % 3 === 2) {
          const q = c.lost.map((i) => map.tiles[i]).find((t) => t.owner === ENEMY);
          for (const u of reinforce(s, ENEMY, 2)) { orderMove(s, [u], q.x + 0.5, q.y + 0.5); u.ai.role = 'garrison'; }
          pushMessage(s, 'The enemy is digging in deeper, and fresh men are coming up to him.', 'warn');
        } else pushMessage(s, 'The enemy is wiring and sandbagging the captured trenches.', 'warn');
      } })),
    ],
    check(state) {
      const c = state.campaign;
      const left2 = c.lost.filter((i) => state.map.tiles[i].owner !== PLAYER).length;
      if (!left2) {
        c.doneAt = c.doneAt ?? clockHours(state);
        if (!c.cheered) { c.cheered = true; pushMessage(state, 'Every yard of the heights is ours again!', 'good'); state.events.push({ type: 'cheer' }); }
        c.wonAt = c.wonAt ?? state.time;
        if (state.time - c.wonAt > 4) return { result: 'won', reason: 'The heights are retaken.' };
        return null;
      }
      if (clockHours(state) >= 19.5) return { result: 'lost', reason: 'Dusk fell with the enemy still on the heights.' };
      return null;
    },
    markers(state) {
      const c = state.campaign, W = state.map.w;
      const held = c.lost.filter((i) => state.map.tiles[i].owner !== PLAYER);
      // one marker for every few enemy-held sections, so the line reads clearly without a ring on every tile
      return held.filter((_, k) => k % 4 === 0).map((i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, label: 'Retake' }));
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const back = c.lost.filter((i) => state.map.tiles[i].owner === PLAYER).length;
      return [
        'Retake the heights',
        `Sections retaken: ${back} / ${c.lost.length}`,
        h < 18.5 ? `The enemy digs in deeper in ${left(Math.max(0, Math.floor(h - 0.5) + 1.5 - h))}` : 'The enemy is dug in',
        `Dusk in ${left(Math.max(0, 19.5 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.doneAt < 10, won && state.stats.lost[PLAYER] < 300];
    },
  },
  {
    id: 'amiens', n: 5, title: 'The Black Day', place: 'Amiens, France', date: 'August 1918',
    nations: ['usa', 'germany'], allies: ['uk'], season: 'mud', start: 'west', startHour: 4.33,
    history: 'August 1918. Four years of war have taught the Allied armies how to win. At 04:20, in thick fog, more than two thousand guns open fire at once, with no warning bombardment, and the infantry go forward close behind the barrage. American and British divisions stand side by side. The German line is deep, three trench lines bristling with machine guns, and he will counter-attack whatever you take. But this time you have the guns, the shells and the men. Break all three lines and take his headquarters before the day is out.',
    objectives: ['Break all three enemy trench lines.', 'Take the enemy headquarters before midnight.', 'Do not let the enemy take your headquarters.'],
    rules: ['You have six batteries, plenty of shells and a large army, Americans and British together.', 'The enemy defends in depth: machine guns in every line, not just the front.', 'Every few hours his reserves counter-attack whatever you have just taken.', 'A long summer day: the clock runs slower than in other battles. His wire is mostly crushed and his divisions are understrength.'],
    medals: ['The Black Day of the German army', 'By noon: the enemy headquarters taken before 12:00', 'Fewer than 500 men lost'],
    debrief: {
      won: 'On 8 August 1918 the Allied armies advanced eight miles in a single day, and whole German units surrendered. General Ludendorff called it "the black day of the German army". It began the Hundred Days Offensive, and three months later the war was over.',
      lost: 'The German line held its depth until nightfall. In August 1918 it did not: the Allied attack at Amiens broke through in a single day. It was the beginning of the end of the war.',
    },
    setup(state) {
      const { map } = state, W = map.w, M = Math.floor(map.h / 2);
      state.resources[PLAYER] = { men: 60, ammo: 900, supplies: 240 };
      state.playerIncome = 1.3;
      // the army: Americans and British side by side, and six batteries
      const brits = reinforce(state, PLAYER, 6);
      brits.forEach((u, i) => { if (i % 2 === 0) u.nation = 'uk'; });
      state.units.filter((u) => u.team === PLAYER && u.type !== 'artillery').forEach((u, i) => { if (i % 3 === 0) u.nation = 'uk'; });
      const d = teamDir(PLAYER), f = frontLine(map, PLAYER);
      for (const dy of [-14, -4, 4, 14]) { const g = spawnUnit(state, 'artillery', PLAYER, f[M + dy] - d * 5 + 0.5, M + dy + 0.5); if (dy > 0) g.nation = 'uk'; }
      // defence in depth: machine guns in his support and reserve lines too
      const e = teamDir(ENEMY), ef = frontLine(map, ENEMY);
      const lineTiles = (off) => {
        const out = [];
        for (let y = 0; y < map.h; y++) {
          if (ef[y] < 0) continue;
          for (const dx of [-1, 0, 1]) {
            const x = ef[y] - e * off + dx, t = map.tiles[y * W + x];
            if (t && !t.off && t.trench && t.origOwner === ENEMY && !out.includes(y * W + x)) out.push(y * W + x);
          }
        }
        return out;
      };
      const lines = [lineTiles(0), lineTiles(7), lineTiles(11)];
      for (const [off, rows] of [[7, [0]], [11, [0]]]) {
        for (const dy of rows) {
          const y = M + dy, x = ef[y] >= 0 ? ef[y] - e * off : -1;
          const t = x >= 0 && map.tiles[y * W + x];
          if (t && t.trench) { const g = spawnUnit(state, 'mg', ENEMY, x + 0.5, y + 0.5); g.ai.role = 'garrison'; }
        }
      }
      // 1918: his divisions are understrength (half his rifle squads gone), and the tanks have
      // crushed most of his wire
      const rifles = state.units.filter((u) => u.team === ENEMY && u.type === 'rifle');
      const gone = new Set(rifles.filter((_, i) => i % 2 === 1).map((u) => u.id));
      state.units = state.units.filter((u) => !gone.has(u.id));
      let k = 0;
      for (const t of map.tiles) if (t.wire && t.origWire === ENEMY && k++ % 4) t.wire = 0;
      map.dirty = true;
      // one long summer day: the clock runs at a third of its usual speed
      state.dayLength = DAY_LENGTH * 3;
      state.resources[ENEMY] = { men: 20, ammo: 400, supplies: 100 };
      const ai = state.ais[0];
      ai.level = { ...DIFFICULTY.medium, firstAttack: 3600, attackGap: [1200, 1500], income: 0.5 };
      ai.offensive = 3600;
      state.campaign.lines = lines;
    },
    events: [
      { at: 4.4, run: (s) => pushMessage(s, 'Zero hour. The guns are firing on every line: go in behind the barrage.', 'side') },
      ...[8, 11, 14, 17, 20].map((at) => ({ at, run: (s) => {
        // a counter-attack on the ground we took most recently: the enemy-side-most trench we hold that was his
        const { map } = s;
        let best = null;
        for (const t of map.tiles) if (t.trench && t.origOwner === ENEMY && t.owner === PLAYER && (!best || (teamDir(ENEMY) < 0 ? t.x > best.x : t.x < best.x))) best = t;
        const units = reinforce(s, ENEMY, 3);
        if (best) { orderMove(s, units, best.x + 0.5, best.y + 0.5, 'charge'); pushMessage(s, 'German reserves are counter-attacking the trenches we have taken!', 'warn'); }
        else pushMessage(s, 'German reserves have come up into their line.', 'warn');
      } })),
    ],
    check(state) {
      if (clockHours(state) >= 24) return { result: 'lost', reason: 'Midnight came with the enemy headquarters still in his hands.' };
      return null;
    },
    tracker(state) {
      const h = clockHours(state), c = state.campaign;
      const names = ['Front line', 'Support line', 'Reserve line'];
      return [
        'Break through and take the enemy HQ',
        ...c.lines.map((L2, k) => { const n = L2.filter((i) => state.map.tiles[i].owner === PLAYER).length; return `${names[k]}: ${n >= L2.length / 2 ? 'broken' : 'holding'} (${n} / ${L2.length} taken)`; }),
        `Midnight in ${left(Math.max(0, 24 - h))}`,
      ];
    },
    medalsEarned(state) {
      const c = state.campaign, won = c.result === 'won';
      return [won, won && c.endHour < 12, won && state.stats.lost[PLAYER] < 500];
    },
  },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id);

/** A new battle for a campaign level. */
export function createLevelGame(id, opts = {}) {
  const L = levelById(id);
  const state = createGame({ seed: opts.seed ?? 1915 + L.n, season: L.season, nations: L.nations, start: L.start, difficulty: 'hard', aiTeams: opts.aiTeams });
  state.startHour = L.startHour;
  state.campaign = { id, fired: [], result: null, reason: '' };
  L.setup(state);
  return state;
}

/**
 * Run a campaign level: timed events, then its win / loss check. A result ends the battle (it sets
 * state.winner); the HQ falling or the army breaking end it too, through the ordinary rules.
 */
export function stepCampaign(state) {
  const c = state.campaign;
  if (!c || c.result) return;
  const L = levelById(c.id);
  if (state.winner >= 0) { // the ordinary rules ended it
    c.endHour = clockHours(state);
    c.result = state.winner === PLAYER ? 'won' : 'lost';
    c.reason = c.reason || (state.winner === PLAYER ? (tileAt(state.map, state.map.hq[ENEMY].x, state.map.hq[ENEMY].y).owner === PLAYER ? 'The enemy headquarters has fallen.' : 'The enemy is broken.') : 'Our headquarters has fallen.');
    return;
  }
  const h = clockHours(state);
  L.events.forEach((e, i) => { if (h >= e.at && !c.fired.includes(i)) { c.fired.push(i); e.run(state); } });
  if (L.markers) state.markers = L.markers(state);
  const r = L.check(state);
  if (r) { c.result = r.result; c.reason = r.reason; state.winner = r.result === 'won' ? PLAYER : ENEMY; }
}

// ------------------------------------------------------------------ progress (the browser keeps it)
const KEY = 'ww-campaign';
/** { unlocked: highest open level, medals: { id: best }, tutorial: prologue done }. */
export function loadProgress() {
  let p;
  try { p = JSON.parse(localStorage.getItem(KEY)); } catch {}
  p = p || { unlocked: 1, medals: {} };
  if (p.tutorial === undefined) p.tutorial = p.unlocked > 1 || Object.keys(p.medals).length > 0; // players from before the prologue keep their access
  return p;
}
/** The prologue (tutorial) is done: battle 1 opens. */
export function markTutorialDone() {
  const p = loadProgress();
  p.tutorial = true;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}
/** Record a finished level: medals (best kept) and the next level unlocked on a win. */
export function recordResult(state) {
  const c = state.campaign, L = levelById(c.id), p = loadProgress();
  const medals = L.medalsEarned(state);
  const got = medals.filter(Boolean).length;
  p.medals[c.id] = Math.max(p.medals[c.id] || 0, got);
  if (c.result === 'won') p.unlocked = Math.max(p.unlocked, L.n + 1);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  return medals;
}
