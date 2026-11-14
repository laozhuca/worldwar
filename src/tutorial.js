// The tutorial: "1 July 1916". A scripted scene in the ordinary engine that teaches selecting, moving,
// bombarding and charging through a short story: two privates talk in the trench, the whistle blows,
// they go over the top, the guns open up, they charge, and a machine gun the barrage missed kills them.
// The scene is a script of awaits on what the player does; captions show dialogue and instructions.
import { PLAYER, ENEMY, UNIT_TYPES } from './config.js';
import { createGame, spawnUnit, damageUnit } from './game.js';
import { frontLine } from './map.js';
import { iso } from './render.js';

const HALE = 'Pte. Tom Hale', ARCHER = 'Pte. Will Archer', LT = 'Lieutenant';

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
  // the rest of the company stays in the trench either side
  for (const dy of [-4, 4]) if (ours[M + dy] >= 0) { const u = spawnUnit(s, 'rifle', PLAYER, ours[M + dy] + 0.5, M + dy + 0.5); u.invulnerable = true; }
  const gun = spawnUnit(s, 'artillery', PLAYER, ours[M] - 4 + 0.5, M + 1.5); // in range of the enemy trench
  gun.invulnerable = true; gun.story = 'gun';
  // the enemy: a machine gun in the trench straight ahead, riflemen beside it; silent until the charge
  const mg = spawnUnit(s, 'mg', ENEMY, theirs[M] + 0.5, M + 0.5);
  mg.holdFire = true; mg.invulnerable = true; mg.story = 'mg';
  for (const dy of [-3, 3]) if (theirs[M + dy] >= 0) { const u = spawnUnit(s, 'rifle', ENEMY, theirs[M + dy] + 0.5, M + dy + 0.5); u.holdFire = true; u.invulnerable = true; }
  return s;
}

/**
 * The script. ctx: { app, ui, renderer, sound, onEnd(state) }. Returns { tick(dt), stop() }; tick runs
 * while the battle runs (not paused).
 */
export function runTutorial(state, ctx) {
  const { ui, renderer, sound } = ctx;
  const box = document.getElementById('story');
  const who = box.querySelector('.who'), line = box.querySelector('.line'), hint = box.querySelector('.hint');
  const find = (tag) => state.units.find((u) => u.story === tag);
  const pair = find('pair'), gun = find('gun'), mg = find('mg');
  let stopped = false, follow = null;
  const waits = []; // { test, resolve }
  let clock = 0, speech = null; // { done, until }

  const touch = matchMedia('(pointer: coarse)').matches;
  const show = (speaker, text, instruction = '') => {
    box.classList.remove('hidden');
    who.textContent = speaker || '';
    line.textContent = text || '';
    line.classList.toggle('hidden', !text);
    hint.textContent = instruction;
    hint.classList.toggle('hidden', !instruction);
  };
  const stop = () => { stopped = true; box.classList.add('hidden'); state.marker = null; for (const w of waits) w.reject(new Error('stopped')); waits.length = 0; };
  const waitFor = (test) => new Promise((resolve, reject) => { if (stopped) return reject(new Error('stopped')); waits.push({ test, resolve, reject }); });
  // one line of dialogue: shown for a time that suits its length; a click or Space moves on
  const say = (speaker, text) => {
    show(speaker, text, '');
    const until = clock + 2.2 + text.split(' ').length * 0.3;
    return new Promise((resolve, reject) => {
      speech = { until, resolve };
      waits.push({ test: () => speech === null || clock >= until, resolve: () => { speech = null; resolve(); }, reject });
    });
  };
  const skip = () => { if (speech) speech.until = 0; };
  box.onclick = skip;
  // during the scene Space / Enter only move the dialogue on (not 'jump to the front')
  const onKey = (e) => { if (!stopped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); skip(); } };
  window.addEventListener('keydown', onKey, true);
  // each instruction brings the section (and what to click) back into view
  const instruct = (text, mouse, tap, focus = pair) => { if (!follow) renderer.centerOn(focus.x + 3, focus.y); show('', '', `${text} ${touch ? tap : mouse}`); };
  const after = (s) => { const t = clock + s; return waitFor(() => clock >= t); };
  const near = (u, p, d) => Math.hypot(u.x - p.x, u.y - p.y) <= d;

  const start = { x: pair.x, y: pair.y };
  const out = { x: pair.x + 7, y: pair.y }; // a shell hole out in no man's land
  const objective = { x: mg.x, y: mg.y };

  async function script() {
    ui.selected.clear();
    renderer.cam.zoom = 2.4;
    renderer.centerOn(pair.x + 2, pair.y);
    await after(1.2);
    await say('', 'The Somme. 1 July 1916, 07:20. Ten minutes to zero hour.');
    await say(ARCHER, 'Seven days the guns have been going. Can\'t be a German left alive over there.');
    await say(HALE, 'That\'s what the officers say. Wire\'s all cut. We just walk across.');
    await say(ARCHER, 'Walk. With sixty pounds on our backs.');
    await say(HALE, 'Will... if I don\'t come back, give this letter to my mum.');
    await say(ARCHER, 'Give it her yourself. We\'ll be in their trench by breakfast.');
    await say(LT, 'Two minutes, lads. Fix bayonets.');

    // 1. select
    instruct('These two are your section, Hale and Archer.', 'Click them to select them.', 'Tap them to select them.');
    await waitFor(() => ui.selected.has(pair.id));
    await after(0.6);

    // 2. the whistle, over the top
    sound.play('whistle', 1);
    await say(LT, 'Over the top!');
    state.marker = { ...out, label: 'Shell hole' };
    instruct('Order them out of the trench to the shell hole in no man\'s land.', 'Right-click the marked ground.', 'Tap the marked ground.');
    await waitFor(() => Math.hypot(pair.x - start.x, pair.y - start.y) > 3);
    state.marker = null;
    follow = pair;
    await say(HALE, 'Stay close, Will.');
    await say(ARCHER, 'Quiet as a church out here...');
    await waitFor(() => !pair.order || near(pair, out, 1.5));

    // 3. the guns
    // pull back to see the whole of no man's land, our men and the enemy trench
    follow = null;
    renderer.cam.zoom = 1.35;
    renderer.centerOn((pair.x + objective.x) / 2, (pair.y + objective.y) / 2);
    state.marker = { ...objective, label: 'Enemy trench' };
    show('', '', `Your field battery stands ready behind the lines. Shell the enemy trench: ${touch ? 'press Bombard, then tap the marked trench.' : 'press B (or Bombard), then click the marked trench.'}`);
    await waitFor(() => gun.barrage || gun.cooldown > 0);
    if (gun.barrage) gun.barrage.remaining = Math.min(gun.barrage.remaining, 5); // a short barrage for the scene
    state.marker = null;
    // from here the camera keeps both the men and the enemy trench in view
    follow = { get x() { return pair.x + (objective.x - pair.x) * 0.45; }, get y() { return pair.y; } };
    await say(ARCHER, 'Go on, give it to \'em!');
    await say(HALE, 'Nothing could live through that.');
    await waitFor(() => !gun.barrage);
    await say('', 'The barrage lifts onto the German support line.');

    // 4. the charge
    state.marker = { ...objective, label: 'Enemy trench' };
    show('', '', '');
    instruct('Charge them home before the defenders recover:', 'press C (or Charge), then click the enemy trench.', 'press Charge, then tap the enemy trench.');
    await waitFor(() => pair.order && pair.order.kind === 'charge');
    state.marker = null;
    show('', '', '');
    box.classList.add('hidden');

    // 5. the machine gun the barrage missed
    await waitFor(() => near(pair, mg, UNIT_TYPES.mg.range - 0.5) || !pair.order);
    for (const u of state.units) if (u.team === ENEMY) u.holdFire = false;
    mg.setup = 0; mg.target = pair;
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
  };

  script().then(async () => {
    if (stopped) return;
    // silence over them, then the epitaph
    box.classList.add('hidden');
    await after(5);
    stop();
    ctx.onEnd(state);
  }).catch(() => {}).finally(() => window.removeEventListener('keydown', onKey, true));
  return { tick, stop };
}
