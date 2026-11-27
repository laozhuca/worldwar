// The tutorial: "1 July 1916". A scripted scene in the ordinary engine that teaches selecting, moving,
// bombarding and charging through a short story: two privates talk in the trench, the whistle blows,
// they go over the top, the guns open up, they charge, and a machine gun the barrage missed kills them.
// The scene is a script of awaits on what the player does; captions show dialogue and instructions.
import { PLAYER, ENEMY, UNIT_TYPES } from './config.js';
import { createGame, spawnUnit, damageUnit, orderMove, orderBarrage } from './game.js';
import { frontLine } from './map.js';
import { iso } from './render.js';

const HALE = 'Pte. Tom Hale', ARCHER = 'Pte. Will Archer', LT = 'Lieutenant';
// pictures shown above a speaker's lines (the letter replaces Hale's face when he speaks of it)
const FACES = { [HALE]: 'assets/art/story-hale.webp', [ARCHER]: 'assets/art/story-archer.webp' };
const LETTER = 'assets/art/story-letter.webp';
const TRENCH = 'assets/art/story-trench.webp'; // the opening scene: the front line before zero hour
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
  // the rest of the divisional artillery along the line: they fire with ours, each on its own stretch
  for (const dy of [-13, -7, 6, 12]) {
    const r = M + dy;
    if (ours[r] < 0 || theirs[r] < 0) continue;
    const g = spawnUnit(s, 'artillery', PLAYER, ours[r] - 4 + 0.5, r + 0.5);
    g.invulnerable = true; g.story = 'guns'; g.storyTarget = { x: theirs[r] + 0.5, y: r + 0.5 };
  }
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
  for (const src of [TRENCH, LETTER, ...Object.values(FACES)]) new Image().src = src; // the scene's pictures, ready when needed
  const box = document.getElementById('story');
  const who = box.querySelector('.who'), line = box.querySelector('.line'), hint = box.querySelector('.hint'), pic = box.querySelector('.pic');
  // the instruction's illustration (keyboard or mouse), drawn as vector art under the words; desktop only
  const illus = box.querySelector('.tut-illus') || box.appendChild(Object.assign(document.createElement('div'), { className: 'tut-illus hidden' }));
  const cap = (x, y, w, label, key, arrow = false) => `<g class="cap" data-k="${key}" transform="translate(${x} ${y})"><rect class="cap-s" x="0" y="3" width="${w}" height="34" rx="6"/><g class="cap-in"><rect class="cap-t" x="0" y="0" width="${w}" height="32" rx="6"/>${arrow
    ? `<path class="cap-l" d="${{ up: 'M0 5 L-6 -3 L6 -3 Z', down: 'M0 -5 L-6 3 L6 3 Z', left: 'M-5 0 L3 -6 L3 6 Z', right: 'M5 0 L-3 -6 L-3 6 Z' }[label]}" transform="translate(${w / 2} 16)${label === 'up' ? ' rotate(180)' : label === 'down' ? ' rotate(180)' : ''}"/>`
    : `<text class="cap-l" x="${w / 2}" y="22" text-anchor="middle">${label}</text>`}</g></g>`; // (the key top and its label go down together)
  const KEYS_SVG = `<svg viewBox="0 0 300 92" width="300" height="92" aria-hidden="true">
      ${cap(46, 4, 36, 'W', 'up')}${cap(6, 46, 36, 'A', 'left')}${cap(46, 46, 36, 'S', 'down')}${cap(86, 46, 36, 'D', 'right')}
      <text class="or" x="150" y="60" text-anchor="middle">or</text>
      ${cap(218, 4, 36, 'up', 'up', true)}${cap(178, 46, 36, 'left', 'left', true)}${cap(218, 46, 36, 'down', 'down', true)}${cap(258, 46, 36, 'right', 'right', true)}
    </svg>`;
  const MOUSE_SVG = `<svg viewBox="0 0 80 112" width="64" height="90" aria-hidden="true">
      <path class="m-body" d="M40 4 C 18 4, 8 22, 8 44 L 8 72 C 8 94, 22 108, 40 108 C 58 108, 72 94, 72 72 L 72 44 C 72 22, 62 4, 40 4 Z"/>
      <path class="m-btn" data-b="0" d="M38 6 C 20 7, 10 22, 10 44 L 38 44 Z"/>
      <path class="m-btn" data-b="2" d="M42 6 C 60 7, 70 22, 70 44 L 42 44 Z"/>
      <rect class="m-wheel" x="36" y="16" width="8" height="16" rx="4"/>
    </svg>`;
  const KEY_SVG = (label) => `<svg viewBox="0 0 48 44" width="58" height="53" aria-hidden="true">${cap(6, 4, 36, label, 'one')}</svg>`;
  const WHEEL_SVG = MOUSE_SVG.replace('<rect class="m-wheel"', '<path class="w-arrow" data-w="in" d="M40 -14 L29 1 L51 1 Z"/><path class="w-arrow" data-w="out" d="M40 64 L29 49 L51 49 Z"/><rect class="m-wheel want"')
    .replace('viewBox="0 0 80 112" width="64" height="90"', 'viewBox="0 -16 80 128" width="84" height="134"');
  const showIllus = (kind, btn = 0) => {
    if (touch || !kind) { illus.classList.add('hidden'); illus.innerHTML = ''; return; }
    illus.className = 'tut-illus ' + kind;
    illus.innerHTML = kind === 'key' ? KEY_SVG(btn) + `<span class="m-say">Press ${btn}</span>` : kind === 'keys' ? KEYS_SVG : kind === 'wheel' ? WHEEL_SVG + '<span class="m-say">Roll the wheel:<br>up to zoom in, down to zoom out</span>' : MOUSE_SVG + `<span class="m-say">${btn === 2 ? 'Right button' : 'Left button'}</span>`;
    if (kind === 'mouse') illus.querySelector(`.m-btn[data-b="${btn}"]`).classList.add('want');
  };
  // the mouse buttons actually pressed flash on the drawing
  const onDown = (e) => { const b = illus.querySelector(`.m-btn[data-b="${e.button}"]`); if (b) { b.classList.remove('hit'); void b.getBBox(); b.classList.add('hit'); } };
  window.addEventListener('mousedown', onDown, true);
  // the map keys: which of the four ways have been pressed, and which are held now
  const DIRS = { w: 'up', arrowup: 'up', a: 'left', arrowleft: 'left', s: 'down', arrowdown: 'down', d: 'right', arrowright: 'right' };
  const pressed = new Set(), held = new Set();
  const paintKeys = () => illus.querySelectorAll('.cap').forEach((g) => { g.classList.toggle('done', pressed.has(g.dataset.k)); g.classList.toggle('held', held.has(g.dataset.k)); });
  const onKeyDir = (e) => {
    const one = illus.querySelector('.cap[data-k="one"]');
    if (one && (e.key || '').toUpperCase() === one.textContent.trim()) { one.classList.toggle('held', e.type === 'keydown'); if (e.type === 'keydown') one.classList.add('done'); }
    const d = DIRS[(e.key || '').toLowerCase()]; if (!d) return; if (e.type === 'keydown') { held.add(d); pressed.add(d); } else held.delete(d); paintKeys(); };
  window.addEventListener('keydown', onKeyDir, true); window.addEventListener('keyup', onKeyDir, true);
  const find = (tag) => state.units.find((u) => u.story === tag);
  const pair = find('pair'), gun = find('gun'), mg = find('mg');
  let stopped = false, follow = null;
  const waits = []; // { test, resolve }
  let clock = 0, speech = null; // { done, until }

  const touch = matchMedia('(pointer: coarse)').matches;
  const company = state.units.filter((u) => u.story === 'company');
  const batteries = state.units.filter((u) => u.story === 'guns');
  let holding = false; // the battle waits for the player's order
  // the conversation as in the campaign's openings: Archer on the left (turned to face him), Hale on the right, each
  // line in a speech bubble beside its speaker; the lieutenant's orders and the narration between them; the scene
  // pictures (the trench, the letter) large in the middle of the screen
  const duo = document.getElementById('duo'), sides = [...duo.querySelectorAll('.side')], bubble = duo.querySelector('.bubble'), narr = duo.querySelector('.narr'), duoHint = duo.querySelector('.hint');
  const PAIR = [ARCHER, HALE];
  sides.forEach((sd, k) => { sd.classList.remove('away'); const im = sd.querySelector('img'); im.src = FACES[PAIR[k]]; im.classList.toggle('flip', k === 0); sd.querySelector('.name').textContent = PAIR[k]; });
  const showDuo = (speaker, text) => {
    box.classList.add('hidden');
    duo.classList.remove('hidden');
    duo.style.bottom = (document.getElementById('bottom')?.offsetHeight || 0) + 'px'; // (above the command panel)
    const k = PAIR.indexOf(speaker);
    sides.forEach((sd, j) => sd.classList.toggle('quiet', j !== k));
    bubble.classList.toggle('hidden', k < 0); narr.classList.toggle('hidden', k >= 0);
    if (k >= 0) { bubble.className = 'bubble from-' + (k ? 'right' : 'left'); bubble.textContent = text; bubble.style.animation = 'none'; void bubble.offsetWidth; bubble.style.animation = ''; }
    else narr.textContent = speaker ? `${speaker}: \u201c${text}\u201d` : text;
    duoHint.classList.add('hidden');
  };
  const show = (speaker, text, instruction = '', image = null) => {
    // a line of the conversation (no picture of its own): the two of them, a bubble
    if (text && !instruction && !image) { showDuo(speaker, text); return; } // (every line of dialogue or narration with no picture of its own)
    duo.classList.add('hidden');
    box.classList.remove('hidden');
    box.classList.toggle('opening', !!image); // (scene pictures sized as the campaign's)
    const src = image || (text ? FACES[speaker] : null);
    pic.classList.toggle('hidden', !src);
    pic.classList.toggle('letter', src === LETTER);
    pic.classList.toggle('wide', src === TRENCH);
    pic.classList.toggle('natural', src === TRENCH); // (a 4:3 picture: shown whole)
    if (src && pic.getAttribute('src') !== src) pic.setAttribute('src', src);
    who.textContent = speaker || '';
    line.textContent = text || '';
    line.classList.toggle('hidden', !text);
    hint.textContent = instruction;
    hint.classList.toggle('hidden', !instruction);
    box.classList.toggle('waiting', !!instruction);
    box.classList.toggle('center', !!text); // dialogue in the middle of the screen; instructions at the top
  };
  // highlights: a ring on the map (a unit or a place) and a glow on a command button
  const glow = (sel) => { document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow')); if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('tut-glow')); };
  const clear = () => { state.marker = null; glow(null); };
  const stop = () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKeyDir, true); window.removeEventListener('keyup', onKeyDir, true); illus.classList.add('hidden'); stopped = true; holding = false; box.classList.add('hidden'); box.classList.remove('opening'); duo.classList.add('hidden'); duo.onclick = null; clear(); for (const w of waits) w.reject(new Error('stopped')); waits.length = 0; };
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
  duo.onclick = skip;
  // during the scene Space / Enter only move the dialogue on (not 'jump to the front')
  const onKey = (e) => { if (!stopped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); skip(); } };
  window.addEventListener('keydown', onKey, true);
  /** One step of instruction: the battle holds until the player has done it. */
  const step = async (text, test, art = null) => {
    show('', '', `${text}  (The battle waits for you.)`);
    showIllus(art && art.kind, art && (art.button ?? art.key));
    holding = true;
    await waitFor(test);
    holding = false;
    showIllus(null);
    clear();
  };
  const look = (x, y, zoom) => { if (zoom) renderer.cam.zoom = renderer.fitZoom(zoom); renderer.centerOn(x, y); }; // (zoom fitted to the screen: a phone shows less)
  const after = (s) => { const t = clock + s; return waitFor(() => clock >= t); };
  const near = (u, p, d) => Math.hypot(u.x - p.x, u.y - p.y) <= d;
  const click = touch ? 'Tap' : 'Click', rclick = touch ? 'Tap' : 'Right-click';

  const out = { x: pair.x + 7, y: pair.y }; // a shell hole out in no man's land
  const objective = { x: mg.x, y: mg.y };
  const selectPair = () => step(`${click} Hale and Archer to select them.`, () => ui.selected.has(pair.id), { kind: 'mouse', button: 0 });

  async function script() {
    ui.selected.clear();
    look(pair.x + 2, pair.y, 2.4);
    await after(1.2);
    await say('', 'The Somme. 1 July 1916, 07:20. Ten minutes to zero hour.', TRENCH);
    await say(ARCHER, 'Seven days the guns have been going. Can\'t be a German left alive over there.');
    await say(HALE, 'That\'s what the officers say. Wire\'s all cut. We just walk across.');
    await say(ARCHER, 'Walk. With sixty pounds on our backs.');
    await say(HALE, 'Will... if I don\'t come back, give this letter to my mum.', LETTER);
    await say(ARCHER, 'Give it her yourself. We\'ll be in their trench by breakfast.');
    await say(LT, 'The guns open the attack, lads. Stand to.');

    // 0. moving the map: look around the line, then back
    const cam0 = { x: renderer.cam.x, y: renderer.cam.y };
    pressed.clear();
    await step(touch ? 'Move the map: drag it with one finger to look along the line.' : 'Move the map: press each of W A S D (or the arrow keys) to look around.',
      touch ? () => Math.hypot(renderer.cam.x - cam0.x, renderer.cam.y - cam0.y) > 220 : () => pressed.size >= 4, { kind: 'keys' });
    await say('', touch ? 'Good. Drag the map whenever you need to see more of the battlefield.' : 'Good. W A S D (or the arrow keys, or dragging with the middle mouse button) move the map at any time.');
    // zooming: in and out again (the wheel, or a pinch)
    look(pair.x + 2, pair.y, 1.6); // (from a middle zoom: room to go both ways)
    const z0 = renderer.cam.zoom, zoomed = { in: false, out: false };
    let zmax = z0;
    const paintZoom = () => illus.querySelectorAll('.w-arrow').forEach((a) => a.classList.toggle('done', zoomed[a.dataset.w]));
    await step(touch ? 'Zoom: spread two fingers apart to zoom in, then pinch them together to zoom out.' : 'Zoom: roll the mouse wheel up to zoom in, then down to zoom out.',
      () => {
        const z = renderer.cam.zoom; zmax = Math.max(zmax, z);
        if (z > z0 * 1.12) zoomed.in = true;
        if (z < (zoomed.in ? zmax : z0) * 0.85) zoomed.out = true; // (out again from wherever it got to, or out from the start)
        paintZoom();
        return zoomed.in && zoomed.out;
      }, { kind: 'wheel' });
    await say('', touch ? 'Good. Pinch to zoom whenever you need a closer look, or to see more of the field.' : 'Good. The mouse wheel zooms at any time: close in to see your men, out to see the whole field.');
    look(pair.x + 2, pair.y, 2.4);
    await after(0.6);

    // 1. the guns first: select the battery, press Bombard, mark the target
    state.marker = { unit: gun.id, label: 'Field battery' };
    look(gun.x + 3, gun.y, 1.8);
    await step(`${click} the field battery behind your trench to select it.`, () => ui.selected.has(gun.id), { kind: 'mouse', button: 0 });
    glow('[data-cmd="bombard"]');
    await step(touch ? 'Press the glowing Bombard button.' : 'Press B (or the glowing Bombard button).', () => ui.mode === 'bombard', { kind: 'key', key: 'B' });
    state.marker = { ...objective, label: 'Enemy trench' };
    look(pair.x + (objective.x - pair.x) * 0.6, objective.y, 1.05); // both our trench and theirs well inside the view
    await step(`${click} the marked enemy trench to shell it. The other batteries will fire along the rest of the line.`, () => gun.barrage || gun.cooldown > 0, { kind: 'mouse', button: 0 });
    if (gun.barrage) Object.assign(gun.barrage, { x: objective.x, y: objective.y, remaining: 99 }); // (it fires until it is told to stop)
    // the other batteries open up with ours, all along the enemy line
    batteries.forEach((g, i) => {
      orderBarrage(state, [g], g.storyTarget.x, g.storyTarget.y);
      if (g.barrage) Object.assign(g.barrage, { remaining: 99, timer: 0.4 + i * 0.7 });
    });
    // the men wait in the trench while the shells fall
    follow = { get x() { return pair.x + (objective.x - pair.x) * 0.4; }, get y() { return pair.y; } };
    await say(ARCHER, 'Go on, give it to \'em!');
    await say(HALE, 'Nothing could live through that.');
    await say(LT, 'Two minutes, lads. Fix bayonets.');
    // the barrage must be lifted before the men go: the player halts the battery (H), and the rest of the guns with it
    await say(LT, 'Cease fire! Lift the barrage!');
    if (gun.barrage) {
      if (!ui.selected.has(gun.id)) {
        state.marker = { unit: gun.id, label: 'Field battery' };
        await step(`${click} the field battery to select it.`, () => ui.selected.has(gun.id) || !gun.barrage, { kind: 'mouse', button: 0 });
      }
      glow('[data-cmd="halt"]');
      await step(touch ? 'Press the glowing Halt button to stop the battery firing.' : 'Press H (or the glowing Halt button) to stop the battery firing.', () => !gun.barrage, { kind: 'key', key: 'H' });
    }
    // the rest of the guns cease fire with ours: no more shells are fired, and those in the air land
    for (const g of [gun, ...batteries]) if (g.barrage) { g.barrage = null; g.cooldown = 4; }
    await waitFor(() => state.shells.length === 0);
    follow = null;
    await say('', 'The barrage lifts onto the German support line.');

    // 2. the whistle: select the section, and the whole company goes over the top
    ui.selected.clear();
    state.marker = { unit: pair.id, label: 'Hale & Archer' };
    look(pair.x + 2, pair.y, 2.4);
    sound.play('whistle', 1);
    await say(LT, 'Over the top!');
    await selectPair();
    state.marker = { ...out, label: 'Shell hole' };
    look(pair.x + 3.5, pair.y, 2.1);
    await step(`${rclick} the marked shell hole to lead them out into no man's land.`, () => pair.order && pair.order.kind === 'move', { kind: 'mouse', button: 2 });
    orderMove(state, [pair], out.x, out.y); // to the shell hole, wherever the click landed
    for (const u of company) orderMove(state, [u], u.x + 7, u.y);
    follow = pair;
    await say(HALE, 'Stay close, Will.');
    // halting: once they are out in the open, stop them while the rest of the line comes up, then go on
    await waitFor(() => !pair.order || (!pair.inTrench && !pair.climb && !pair.overTop));
    if (!ui.selected.has(pair.id)) { ui.selected.clear(); ui.selected.add(pair.id); }
    await say(LT, 'Halt! Wait for the line!');
    glow('[data-cmd="halt"]');
    await step(touch ? 'Press the glowing Halt button to stop them where they are.' : 'Press H (or the glowing Halt button) to stop them where they are.', () => !pair.order, { kind: 'key', key: 'H' });
    await say(ARCHER, 'Quiet as a church out here...');
    await say(LT, 'Line\'s dressed. Forward!');
    if (!ui.selected.has(pair.id)) { ui.selected.clear(); ui.selected.add(pair.id); }
    state.marker = { ...out, label: 'Shell hole' };
    await step(`${rclick} the shell hole again to go on.`, () => pair.order && pair.order.kind === 'move', { kind: 'mouse', button: 2 });
    orderMove(state, [pair], out.x, out.y);
    await waitFor(() => !pair.order || near(pair, out, 1.2));

    // 3. the charge: select the section, press Charge, mark the target
    follow = null;
    if (!ui.selected.has(pair.id) || ui.selected.size > 1) {
      ui.selected.clear();
      state.marker = { unit: pair.id, label: 'Hale & Archer' };
      look(pair.x + 2, pair.y, 2.1);
      await selectPair();
    }
    glow('[data-cmd="charge"]');
    await step(touch ? 'Press the glowing Charge button.' : 'Press C (or the glowing Charge button).', () => ui.mode === 'charge', { kind: 'key', key: 'C' });
    state.marker = { ...objective, label: 'Enemy trench' };
    look(pair.x + (objective.x - pair.x) * 0.6, objective.y, 1.05); // both the men and the trench well inside the view
    await step(`${click} the marked enemy trench to charge it.`, () => pair.order && pair.order.kind === 'charge', { kind: 'mouse', button: 0 });
    orderMove(state, [pair], objective.x, objective.y, 'charge');
    for (const u of company) { const t = state.map.tiles.find((q) => q.y === u.row && q.trench && q.owner === ENEMY); orderMove(state, [u], t ? t.x + 0.5 : u.x + 20, u.row + 0.5, 'charge'); }
    sound.charge();
    renderer.cam.zoom = 1.6; // closer for the charge
    follow = { get x() { return pair.x + (objective.x - pair.x) * 0.35; }, get y() { return pair.y; } };
    box.classList.add('hidden');

    // 4. the machine guns the barrage missed
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
