// Campaign mode: five levels, each a battle with its own setup, objectives, timed events and medals.
// DOM-free (driven from main.js, and headlessly from the tests). A level's progress lives in
// state.campaign as plain data, so a campaign battle saves and loads like any other.
import { PLAYER, ENEMY, DIFFICULTY } from './config.js';
import { createGame, spawnUnit, pushMessage, orderMove } from './game.js';
import { frontLine, teamDir } from './map.js';

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

// ------------------------------------------------------------------ the levels
export const LEVELS = [
  {
    id: 'ypres', n: 1, title: 'Hold Until Relieved', place: 'Ypres, Belgium', date: 'April 1915',
    nations: ['uk', 'germany'], allies: ['france'], season: 'mud', start: 'west', startHour: 6.5,
    history: 'Spring 1915. The Germans have broken the line north of Ypres, and every battalion that can hold a rifle has been thrown into the gap. Yours holds a stretch of sandbagged trench with orders that leave no room for doubt: hold until the relieving French division comes up. It will not reach you before the dawn of the fourth day.',
    objectives: ['Hold until the relief arrives at dawn on day 4.', 'Do not let the enemy take your headquarters.', 'Do not lose more than half of your front line.'],
    rules: ['Your trenches are strong: sandbagged all along your line.', 'Supplies are short: the convoys bring 70% of the usual.', 'The enemy attacks in strength every few hours, day and night, and fresh battalions come up behind him.'],
    medals: ['Held until relieved', 'Not a yard given: no more than 4 front-line sections lost at the end', 'A careful commander: fewer than 350 men lost'],
    debrief: {
      won: 'The French relieving division came up through the mud at dawn on the fourth day and found your battalion still in its trenches. At Ypres in 1915 many such battalions held on in exactly this way, at terrible cost, and the town never fell.',
      lost: 'Your line broke before the relief could reach you. At Ypres the British line was pushed back again and again in the spring of 1915, but never broken: somewhere, another battalion held.',
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
      { at: 48 + 0, run: (s) => pushMessage(s, 'Day 3. The relief has left Poperinge. Hold on one more day.', 'side') },
      ...[13, 29, 38, 52, 62, 71].map((at) => ({ at, run: (s) => { reinforce(s, ENEMY, 4); pushMessage(s, 'A fresh German battalion is coming up behind their line.', 'warn'); } })),
      { at: 72 + 6, run: (s) => {
        s.campaign.relief = relieve(s, PLAYER, 'france').map((u) => u.id);
        s.campaign.relievedAt = s.time;
        pushMessage(s, 'The relief has arrived! A French division is marching up to our line.', 'good');
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
          pushMessage(state, 'The French are in our trenches. The line is held!', 'good');
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
  { id: 'isonzo', n: 2, title: 'Silence the Guns', place: 'The Isonzo, Italy', date: '1916', nations: ['italy', 'austria'], soon: true },
  { id: 'brusilov', n: 3, title: 'The Brusilov Breakthrough', place: 'Galicia', date: 'June 1916', nations: ['russia', 'austria'], soon: true },
  { id: 'chunuk', n: 4, title: 'Counter-attack at Chunuk Bair', place: 'Gallipoli', date: 'August 1915', nations: ['ottoman', 'uk'], soon: true },
  { id: 'amiens', n: 5, title: 'The Black Day', place: 'Amiens, France', date: 'August 1918', nations: ['usa', 'germany'], soon: true },
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
    c.result = state.winner === PLAYER ? 'won' : 'lost';
    c.reason = c.reason || (state.winner === PLAYER ? 'The enemy is broken.' : 'Our headquarters has fallen.');
    return;
  }
  const h = clockHours(state);
  L.events.forEach((e, i) => { if (h >= e.at && !c.fired.includes(i)) { c.fired.push(i); e.run(state); } });
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
