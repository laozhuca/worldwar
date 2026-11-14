// The tutorial: "1 July 1916". A scripted scene in the ordinary engine that teaches selecting, moving,
// bombarding and charging through a short story: two privates talk in the trench, the whistle blows,
// they go over the top, the guns open up, they charge, and a machine gun the barrage missed kills them.
// The scene is a script of awaits on what the player does; captions show dialogue and instructions.
import { PLAYER, ENEMY, UNIT_TYPES } from './config.js';
import { createGame, spawnUnit, damageUnit, orderMove } from './game.js';
import { frontLine } from './map.js';
import { iso } from './render.js';

const HALE = 'Pte. Tom Hale', ARCHER = 'Pte. Will Archer', LT = 'Lieutenant';
// pictures shown above a speaker's lines (the letter replaces Hale's face when he speaks of it)
const FACES = { [HALE]: 'assets/art/story-hale.webp', [ARCHER]: 'assets/art/story-archer.webp' };
const LETTER = 'assets/art/story-letter.webp';
for (const src of [...Object.values(FACES), LETTER]) { const i = new Image(); i.src = src; } // ready before they are needed

/** The battlefield for the scene: our section in the front trench, a battery behind, the enemy waiting. */
export function createTutorialGame() {
  const s = createGame({ seed: 1916, season: 'mud', nations: ['uk', 'germany'], start: 'west', aiTeams: [] });
  s.tutorial = true;
  s.startHour = 7 + 20 / 60; // 07:20, ten minutes before zero hour
  s.dayLength = 86400; // the scene's clock runs in real time
  s.supplyTimer = 1e9;
  s.resources[PLAYER] = { men: 0, ammo: 2000, supplies: 0 };
  s.units = [];
  const M = Math.floor(s.map.h / 2);
  const ours = frontLine(s.map, PLAYER), theirs = frontLine(s.map, ENEMY);
  // the section: just the two of them
  const pair = spawnUnit(s, 'rifle', PLAYER, ours[M] + 0.5, M + 0.5);
  pair.men = 2; pair.hp = 2 * UNIT_TYPES.rifle.hpPerMan; pair.invulnerable = true; pair.story = 'pair';
  // the rest of the company along the trench either side: they go over the top with them
  for (let dy = -12; dy <= 12; dy += 2) {
    if (Math.abs(dy) < 2 || ours[M + dy] < 0 || theirs[M + dy] < 0) continue;
    const u = spawnUnit(s, 'rifle', PLAYER, ours[M + dy] + 0.5, M + dy + 0.5);
    u.invulnerable = true; u.story = 'company'; u.row = M + dy;
  }
  const gun = spawnUnit(s, 'artillery', PLAYER, ours[M] - 4 + 0.5, M + 1.5); // in range of the enemy trench
  gun.invulnerable = true; gun.story = 'gun';
  // the enemy: machine guns along the trench ahead, the nearest straight in front of the section, with
  // riflemen between them; silent until the charge
  const mg = spawnUnit(s, 'mg', ENEMY, theirs[M] + 0.5, M + 0.5);
  mg.holdFire = true; mg.invulnerable = true; mg.story = 'mg';
  for (const dy of [-8, 8]) if (theirs[M + dy] >= 0) { const g = spawnUnit(s, 'mg', ENEMY, theirs[M + dy] + 0.5, M + dy + 0.5); g.holdFire = true; g.invulnerable = true; }
  for (const dy of [-11, -4, 4, 11]) if (theirs[M + dy] >= 0) { const u = spawnUnit(s, 'rifle', ENEMY, theirs[M + dy] + 0.5, M + dy + 0.5); u.holdFire = true; u.invulnerable = true; }
  return s;
}

/**
 * The script. ctx: { app, ui, renderer, sound, onEnd(state) }. Returns { tick(dt), stop() }; tick runs
 * while the battle runs (not paused).
 */
export function runTutorial(state, ctx) {
  const { ui, renderer, sound } = ctx;
  const box = document.getElementById('story');
  const who = box.querySelector('.who'), line = box.querySelector('.line'), hint = box.querySelector('.hint'), pic = box.querySelector('.pic');
  const find = (tag) => state.units.find((u) => u.story === tag);
  const pair = find('pair'), gun = find('gun'), mg = find('mg');
  let stopped = false, follow = null;
  const waits = []; // { test, resolve }
  let clock = 0, speech = null; // { done, until }

  const touch = matchMedia('(pointer: coarse)').matches;
  const company = state.units.filter((u) => u.story === 'company');
  let holding = false; // the battle waits for the player's order
  const show = (speaker, text, instruction = '', image = null) => {
    box.classList.remove('hidden');
    const src = image || (text ? FACES[speaker] : null);
    pic.classList.toggle('hidden', !src);
    pic.classList.toggle('letter', src === LETTER);
    if (src && pic.getAttribute('src') !== src) pic.setAttribute('src', src);
    who.textContent = speaker || '';
    line.textContent = text || '';
    line.classList.toggle('hidden', !text);
    hint.textContent = instruction;
    hint.classList.toggle('hidden', !instruction);
    box.classList.toggle('waiting', !!instruction);
  };
  // highlights: a ring on the map (a unit or a place) and a glow on a command button
  const glow = (sel) => { document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow')); if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('tut-glow')); };
  const clear = () => { state.marker = null; glow(null); };
  const stop = () => { stopped = true; holding = false; box.classList.add('hidden'); clear(); for (const w of waits) w.reject(new Error('stopped')); waits.length = 0; };
  const waitFor = (test) => new Promise((resolve, reject) => { if (stopped) return reject(new Error('stopped')); waits.push({ test, resolve, reject }); });
  // one line of dialogue: shown for a time that suits its length; a click or Space moves on
  const say = (speaker, text, image = null) => {
    show(speaker, text, '', image);
    const until = clock + 2.2 + text.split(' ').length * 0.3;
    return new Promise((resolve, reject) => {
      speech = { until, resolve };
      waits.push({ test: () => speech === null || clock >= speech.until, resolve: () => { speech = null; resolve(); }, reject });
    });
  };
  const skip = () => { if (speech) speech.until = 0; };
  box.onclick = skip;
  // during the scene Space / Enter only move the dialogue on (not 'jump to the front')
  const onKey = (e) => { if (!stopped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); skip(); } };
  window.addEventListener('keydown', onKey, true);
  /** One step of instruction: the battle holds until the player has done it. */
  const step = async (text, test) => {
    show('', '', `${text}  (The battle waits for you.)`);
    holding = true;
    await waitFor(test);
    holding = false;
    clear();
  };
  const look = (x, y, zoom) => { if (zoom) renderer.cam.zoom = zoom; renderer.centerOn(x, y); };
  const after = (s) => { const t = clock + s; return waitFor(() => clock >= t); };
  const near = (u, p, d) => Math.hypot(u.x - p.x, u.y - p.y) <= d;
  const click = touch ? 'Tap' : 'Click', rclick = touch ? 'Tap' : 'Right-click';

  const out = { x: pair.x + 7, y: pair.y }; // a shell hole out in no man's land
  const objective = { x: mg.x, y: mg.y };
  const selectPair = () => step(`${click} Hale and Archer to select them.`, () => ui.selected.has(pair.id));

  async function script() {
    ui.selected.clear();
    look(pair.x + 2, pair.y, 2.4);
    await after(1.2);
    await say('', 'The Somme. 1 July 1916, 07:20. Ten minutes to zero hour.');
    await say(ARCHER, 'Seven days the guns have been going. Can\'t be a German left alive over there.');
    await say(HALE, 'That\'s what the officers say. Wire\'s all cut. We just walk across.');
    await say(ARCHER, 'Walk. With sixty pounds on our backs.');
    await say(HALE, 'Will... if I don\'t come back, give this letter to my mum.', LETTER);
    await say(ARCHER, 'Give it her yourself. We\'ll be in their trench by breakfast.');
    await say(LT, 'Two minutes, lads. Fix bayonets.');

    // 1. select the section
    state.marker = { unit: pair.id, label: 'Hale & Archer' };
    look(pair.x + 2, pair.y, 2.4);
    await selectPair();

    // 2. the whistle: the whole company goes over the top
    sound.play('whistle', 1);
    await say(LT, 'Over the top!');
    state.marker = { ...out, label: 'Shell hole' };
    look(pair.x + 3.5, pair.y, 2.1);
    await step(`${rclick} the marked shell hole to lead them out into no man's land.`, () => pair.order && pair.order.kind === 'move');
    orderMove(state, [pair], out.x, out.y); // to the shell hole, wherever the click landed
    for (const u of company) orderMove(state, [u], u.x + 7, u.y);
    follow = pair;
    await say(HALE, 'Stay close, Will.');
    await say(ARCHER, 'Quiet as a church out here...');
    await waitFor(() => !pair.order || near(pair, out, 1.2));

    // 3. the guns: select the battery, press Bombard, mark the target
    follow = null;
    await say(LT, 'Halt! Wait for the guns!');
    state.marker = { unit: gun.id, label: 'Field battery' };
    look(gun.x + 3, gun.y, 1.8);
    await step(`${click} the field battery behind your trench to select it.`, () => ui.selected.has(gun.id));
    glow('[data-cmd="bombard"]');
    await step(touch ? 'Press the glowing Bombard button.' : 'Press the glowing Bombard button (or B).', () => ui.mode === 'bombard');
    state.marker = { ...objective, label: 'Enemy trench' };
    look(pair.x + (objective.x - pair.x) * 0.6, objective.y, 1.05); // both the men and the trench well inside the view
    await step(`${click} the marked enemy trench to shell it.`, () => gun.barrage || gun.cooldown > 0);
    if (gun.barrage) Object.assign(gun.barrage, { x: objective.x, y: objective.y, remaining: Math.min(gun.barrage.remaining, 5) });
    // from here the camera keeps both the men and the enemy trench in view
    follow = { get x() { return pair.x + (objective.x - pair.x) * 0.45; }, get y() { return pair.y; } };
    await say(ARCHER, 'Go on, give it to \'em!');
    await say(HALE, 'Nothing could live through that.');
    await waitFor(() => !gun.barrage);
    await say('', 'The barrage lifts onto the German support line.');

    // 4. the charge: select the section, press Charge, mark the target
    follow = null;
    if (!ui.selected.has(pair.id) || ui.selected.size > 1) {
      ui.selected.clear();
      state.marker = { unit: pair.id, label: 'Hale & Archer' };
      look(pair.x + 2, pair.y, 2.1);
      await selectPair();
    }
    glow('[data-cmd="charge"]');
    await step(touch ? 'Press the glowing Charge button.' : 'Press the glowing Charge button (or C).', () => ui.mode === 'charge');
    state.marker = { ...objective, label: 'Enemy trench' };
    look(pair.x + (objective.x - pair.x) * 0.6, objective.y, 1.05); // both the men and the trench well inside the view
    await step(`${click} the marked enemy trench to charge it.`, () => pair.order && pair.order.kind === 'charge');
    orderMove(state, [pair], objective.x, objective.y, 'charge');
    for (const u of company) { const t = state.map.tiles.find((q) => q.y === u.row && q.trench && q.owner === ENEMY); orderMove(state, [u], t ? t.x + 0.5 : u.x + 20, u.row + 0.5, 'charge'); }
    sound.charge();
    renderer.cam.zoom = 1.6; // closer for the charge
    follow = { get x() { return pair.x + (objective.x - pair.x) * 0.35; }, get y() { return pair.y; } };
    box.classList.add('hidden');

    // 5. the machine guns the barrage missed
    await waitFor(() => near(pair, mg, UNIT_TYPES.mg.range - 0.5) || !pair.order);
    for (const u of state.units) if (u.team === ENEMY) { u.holdFire = false; if (u.type === 'mg') u.setup = 0; }
    for (const u of company) u.invulnerable = false;
    mg.target = pair;
    pair.invulnerable = false;
    await say(HALE, 'Machine gun! Get down —');
    if (!pair.dead) await say(ARCHER, 'Tom!');
    await waitFor(() => pair.dead);
  }

  // the kill is certain: if the gun has not finished it in a few seconds, it does now
  let exposed = null;
  const tick = (dt) => {
    if (stopped) return;
    clock += dt;
    if (!pair.dead && !pair.invulnerable) {
      exposed = exposed ?? clock;
      if (clock - exposed > 3.5) damageUnit(state, pair, 999, null, { x: mg.x, y: mg.y, kind: 'mg' });
    }
    if (follow) {
      const p = iso(follow.x + (follow === pair ? 1.5 : 0), follow.y);
      renderer.cam.x += (p.x - renderer.cam.x) * Math.min(1, dt * 1.5);
      renderer.cam.y += (p.y - renderer.cam.y) * Math.min(1, dt * 1.5);
      renderer.clampCam();
    }
    for (const w of waits.slice()) if (w.test()) { waits.splice(waits.indexOf(w), 1); w.resolve(); }
    // the map ring can follow a unit
    if (state.marker && state.marker.unit) {
      const u = state.units.find((q) => q.id === state.marker.unit);
      if (u) { state.marker.x = u.x; state.marker.y = u.y; }
    }
  };

  script().then(async () => {
    if (stopped) return;
    // silence over them, then the epitaph
    box.classList.add('hidden');
    await after(5);
    stop();
    ctx.onEnd(state);
  }).catch(() => {}).finally(() => window.removeEventListener('keydown', onKey, true));
  return { tick, stop, holding: () => holding };
}
