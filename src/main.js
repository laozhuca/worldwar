import { createGame, update, pushMessage } from './game.js';
import { Renderer, iso } from './render.js';
import { UI } from './ui.js';
import { Voices } from './voice.js';
import { serialize, deserialize, describe } from './save.js';
import { ModelView } from './model-view.js';
import { createTutorialGame, runTutorial } from './tutorial.js';
import { Sound } from './audio.js';
import { PLAYER, NATIONS } from './config.js';
import { hourOf } from './atmosphere.js';

const STEP = 1 / 30;

const app = {
  state: createGame(),
  paused: true,
  speed: 1,
  helpOpen: true,
  season: 'winter',
  nations: ['uk', 'germany'],
  side: 'entente', // 'entente' | 'central' | 'random'
  start: 'west', // 'west' | 'east' | 'random'
  difficulty: (() => { try { return localStorage.getItem('ww-diff') || 'medium'; } catch { return 'medium'; } })(),
  overlayOpen() { return !document.getElementById('overlay').classList.contains('hidden'); },
  togglePause() {
    this.paused = !this.paused;
    document.getElementById('btn-pause').textContent = this.paused ? '▶' : '❚❚';
  },
  started: false, // a battle is under way (begun from New game or loaded)
  /** F1 / ?: the instructions over the battle, or back to the battle. */
  toggleHelp() {
    if (this.overlayOpen()) { if (this.started && this.state.winner < 0) resumeBattle(); return; }
    showPanel('help-panel', 'game');
  },
};

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas);
const sound = new Sound();
const voices = new Voices();
voices.sound = sound;
voices.loadRecordings();
renderer.voices = voices;
const ui = new UI(app, renderer, sound, voices);
renderer.texLoading = renderer.loadTextures();
let artKeys = {};
const portraitOf = (n) => (artKeys[`soldier-${n}`] ? `assets/art/soldier-${n}.png` : `assets/soldiers/${n}/portrait.png`);
renderer.portraitOf = portraitOf;
function useArmies(state) {
  renderer.loadImpact();
  renderer.loadProps(state.season);
  renderer.nations = state.nations;
  voices.prepare(state.nations[PLAYER]);
  renderer.loadArmies(state.nations);
  const [a, b] = state.nations.map((n) => NATIONS[n].name);
  document.getElementById('matchup').textContent = `${a} vs ${b}`;
}
useArmies(app.state);
const ofSide = (side) => Object.keys(NATIONS).filter((k) => NATIONS[k].alliance === side);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** Nations to play with: the chosen ones, or a fresh random draw of side and nations. */
function chosenNations() {
  if (app.side !== 'random') return [...app.nations];
  const side = Math.random() < 0.5 ? 'entente' : 'central';
  return [pick(ofSide(side)), pick(ofSide(side === 'entente' ? 'central' : 'entente'))];
}
/** Tell the player which army they lead (once per battle, when it starts). */
function announce(state) {
  if (state.messages.some((m) => m.kind === 'side')) return;
  // a new battle: the trumpet sounds (the samples load with the battle, so wait for them briefly)
  if (sound.sampleLoad) Promise.race([sound.sampleLoad, new Promise((r) => setTimeout(r, 3000))]).then(() => sound.play('trumpet', 1));
  pushMessage(state, `You command the army of ${NATIONS[state.nations[0]].name}, starting in the ${state.start === 'east' ? 'lower right' : 'upper left'}, against ${NATIONS[state.nations[1]].name}.`, 'side');
}
/** The New Campaign screen: our army on the left, the enemy on the right, cycled with the arrows. */
const ALLIANCE = { entente: 'Entente', central: 'Central Powers' };
let fixedSide = 'entente'; // the side shown while "Random side" is off
function renderSetup() {
  const random = app.side === 'random';
  if (!random) fixedSide = app.side;
  const mySide = random ? null : app.side, foeSide = mySide === 'entente' ? 'central' : 'entente';
  if (!random) {
    if (NATIONS[app.nations[0]].alliance !== mySide) app.nations[0] = ofSide(mySide)[0];
    if (NATIONS[app.nations[1]].alliance !== foeSide) app.nations[1] = ofSide(foeSide)[0];
  }
  const show = (slot, side) => {
    const key = slot ? 'foe' : 'mine', n = app.nations[slot];
    const ribbon = document.getElementById('ribbon-' + key);
    ribbon.textContent = random ? '?' : ALLIANCE[side];
    ribbon.className = 'ribbon ' + (random ? 'unknown' : side);
    document.getElementById('plate-' + key).textContent = random ? 'Drawn at random' : NATIONS[n].name;
    const img = document.getElementById('fig-' + key);
    if (!random && img.getAttribute('src') !== portraitOf(n)) img.setAttribute('src', portraitOf(n));
    showModel(key, random ? null : n);
    document.getElementById('army-' + key).classList.toggle('random', random);
  };
  show(0, mySide); show(1, foeSide);
  document.getElementById('btn-random-side').classList.toggle('active', random);
  document.getElementById('btn-swap').disabled = random;
}
const nationButtons = renderSetup;
// 3D soldiers (assets/models/<nation>.glb) in place of the pictures where a model exists; they turn
// while the pointer is over them. Without WebGL2 or a model, the picture stays.
let modelList = {};
const viewers = {};
fetch('assets/models/manifest.json').then((r) => r.json()).then((m) => { modelList = m; renderSetup(); }).catch(() => {});
function showModel(key, nation) {
  const box = document.getElementById('fig-' + key).parentElement;
  const file = nation && modelList[nation];
  if (!file) { box.classList.remove('has-model'); return; }
  try {
    if (!viewers[key]) { viewers[key] = new ModelView(document.getElementById('model-' + key)); if (key === 'foe') viewers[key].rest = viewers[key].yaw = 0.45; } // the two face each other
  } catch { return; }
  viewers[key].show('assets/models/' + file).then((ok) => { if (ok) box.classList.add('has-model'); else if (!modelList[nation]) box.classList.remove('has-model'); });
}
/** An arrow beside a soldier: the next / previous nation of that side; one of its soldiers answers. */
document.querySelectorAll('[data-cycle]').forEach((b) => b.addEventListener('click', () => {
  if (app.side === 'random') return;
  const slot = +b.dataset.cycle, side = slot ? (app.side === 'entente' ? 'central' : 'entente') : app.side;
  const list = ofSide(side), i = list.indexOf(app.nations[slot]);
  app.nations[slot] = list[(i + +b.dataset.d + list.length) % list.length];
  renderSetup();
  sound.init(); voices.speakFor(app.nations[slot]);
}));
document.getElementById('btn-swap').addEventListener('click', () => {
  if (app.side === 'random') return;
  app.side = app.side === 'entente' ? 'central' : 'entente';
  app.nations = [app.nations[1], app.nations[0]];
  renderSetup();
  sound.init(); voices.speakFor(app.nations[0]);
});
// difficulty: remembered between visits
const showDiff = () => document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('active', x.dataset.diff === app.difficulty));
document.querySelectorAll('[data-diff]').forEach((b) => b.addEventListener('click', () => {
  app.difficulty = b.dataset.diff;
  try { localStorage.setItem('ww-diff', app.difficulty); } catch {}
  showDiff();
}));
showDiff();
document.getElementById('btn-random-side').addEventListener('click', () => { app.side = app.side === 'random' ? fixedSide : 'random'; renderSetup(); });
const chosenStart = () => (app.start === 'random' ? (Math.random() < 0.5 ? 'west' : 'east') : app.start);
document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
  app.start = b.dataset.start;
  document.querySelectorAll('[data-start]').forEach((x) => x.classList.toggle('active', x === b));
  renderSetup();
}));
nationButtons();
fetch('assets/art/manifest.json').then((r) => r.json()).then((m) => { artKeys = m; nationButtons(); }).catch(() => {});
ui.centerOnFront();
window.addEventListener('resize', () => renderer.resize());
// the map has its own area between the top bar and the command panel: follow its size as they change
if (window.ResizeObserver) new ResizeObserver(() => { renderer.resize(); renderer.clampCam(); }).observe(canvas);
window.worldwar = { app, renderer, ui, sound }; // handy for debugging in the console

document.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
  app.season = b.dataset.season;
  document.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('active', x === b));
}));
document.getElementById('btn-start').addEventListener('click', async () => {
  sound.init();
  voices.prepare();
  sound.startMusic();
  const sameNations = app.side !== 'random' && app.state.nations.join() === app.nations.join();
  const sameStart = app.start !== 'random' && app.state.start === app.start;
  if (app.state.time >= 1 || app.state.season !== app.season || !sameNations || !sameStart || app.state.difficulty !== app.difficulty) {
    app.state = createGame({ season: app.season, nations: chosenNations(), start: chosenStart(), difficulty: app.difficulty });
    useArmies(app.state);
    renderer.groundDrawn = false;
    ui.selected.clear();
    ui.setMode(null);
    ui.centerOnFront();
    endShown = false;
    lastSave = 0;
  }
  await loadBattle(app.state);
  app.started = true;
  announce(app.state);
  resumeBattle();
});
document.getElementById('btn-restart').addEventListener('click', async () => {
  app.state = createGame({ seed: Math.floor(Math.random() * 1e6), season: app.season, nations: chosenNations(), start: chosenStart(), difficulty: app.state.difficulty || app.difficulty });
  useArmies(app.state);
  ui.selected.clear();
  ui.setMode(null);
  renderer.groundDrawn = false;
  ui.centerOnFront();
  endShown = false;
  lastSave = 0;
  await loadBattle(app.state);
  announce(app.state);
  app.started = true;
  resumeBattle();
});
const FILM = ['', 'sepia(0.55) contrast(1.08) saturate(0.85)', 'grayscale(1) contrast(1.15)'];
let film = 0;
document.getElementById('btn-film').addEventListener('click', () => {
  film = (film + 1) % FILM.length;
  canvas.style.filter = FILM[film];
});
document.getElementById('btn-pause').addEventListener('click', () => app.togglePause());
document.getElementById('btn-help').addEventListener('click', () => app.toggleHelp());
document.getElementById('btn-speed').addEventListener('click', (e) => {
  app.speed = app.speed === 1 ? 2 : app.speed === 2 ? 3 : 1;
  e.target.textContent = app.speed + '×';
});
const voiceBtn = document.getElementById('btn-voice');
const showVoice = () => { voiceBtn.style.opacity = voices.on ? '1' : '0.4'; };
showVoice();
voiceBtn.addEventListener('click', () => { voices.setOn(!voices.on); showVoice(); });
const musicBtn = document.getElementById('btn-music');
const showMusic = () => { musicBtn.style.opacity = sound.musicOn ? '1' : '0.4'; };
showMusic();
musicBtn.addEventListener('click', () => { sound.init(); sound.startMusic(); sound.setMusic(!sound.musicOn); showMusic(); });
document.getElementById('btn-sound').addEventListener('click', (e) => {
  sound.init();
  sound.setEnabled(!sound.enabled);
  voices.enabled = sound.enabled;
  if (!sound.enabled && voices.synth) voices.synth.cancel();
  if (!sound.enabled) voices.stopClip();
  e.target.textContent = sound.enabled ? '🔊' : '🔇';
});

let endShown = false;
function showEnd(state) {
  endShown = true;
  clearSave(); // a finished battle can't be continued
  const won = state.winner === PLAYER;
  document.getElementById('end-title').textContent = won ? 'Victory' : 'Defeat';
  const mins = Math.floor(state.time / 60), secs = Math.floor(state.time % 60);
  document.getElementById('end-text').textContent =
    (won ? 'The enemy line has broken. ' : 'Our line has broken. ') +
    `Time in the line: ${mins}m ${secs}s. Our casualties: ${state.stats.lost[0]} men. Enemy casualties: ${state.stats.lost[1]} men.`;
  app.started = false;
  showPanel('end-panel', 'menu');
  sound.playEnding(won ? 'victory' : 'defeat');
  // the result is shown over a painting for the player's side: triumph, or a helmet left in the mud
  const side = NATIONS[state.nations[PLAYER]] ? NATIONS[state.nations[PLAYER]].alliance : 'entente';
  const scene = document.getElementById('end-scene');
  scene.classList.toggle('hidden', !won);
  document.getElementById('overlay').classList.add('result', `${won ? 'victory' : 'defeat'}-${side}`);
  // the painting is set here too, so a cached stylesheet from an older version can't leave it blank
  // victory: the winning side's painting; defeat: the poppy field, for either side
  document.getElementById('overlay').style.backgroundImage = `url('assets/art/${won ? `victory-${side}` : 'defeat-poppies'}.webp')`;
  if (won) scene.textContent = side === 'central' ? 'Triumph on the Trench Ridge' : 'Triumphant Soldiers at Dawn';
}

let last = performance.now();
let acc = 0;
let miniTimer = 0;
let clockTimer = 0;
const clockEl = document.getElementById('clock');
const clockIcon = document.getElementById('clock-icon');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

const NOISY = new Set(['rifle', 'mg', 'boom', 'artyfire', 'death', 'incoming']);
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = app.state;
  const held = tutorial && tutorial.holding(); // the tutorial's battle waits for the player's order
  if (!app.paused && !held) {
    acc += dt * app.speed;
    let n = 0;
    while (acc >= STEP && n < 12) { update(s, STEP); acc -= STEP; n++; }
    if (n >= 12) acc = 0;
  }
  if (tutorial && !app.paused) tutorial.tick(held ? dt : dt * app.speed);
  ui.update(dt);
  renderer.update(dt, app.paused || held ? 0 : dt * app.speed, s);

  // sounds, attenuated by distance from the camera centre
  const center = renderer.screenToMap(renderer.vw / 2, renderer.vh / 2);
  // a lull: after 20 s of battle time without gunfire, shells or cries, a duck or a bird calls once (until the next shot)
  if (s.events.some((ev) => NOISY.has(ev.type)) || s.quiet === undefined) { s.quiet = s.time; s.quacked = false; }
  else if (!s.quacked && s.time - s.quiet >= 20 && app.started && !app.paused) { s.quacked = true; sound.play('duck', 0.9); }
  for (const ev of s.events) {
    const d = ev.x === undefined ? 0 : Math.hypot(ev.x - center.x, ev.y - center.y);
    sound.play(ev.type, Math.max(0, 1 - d / (28 / renderer.cam.zoom)), ev.id);
    renderer.onEvent(ev);
  }
  s.events.length = 0;

  sound.tick(app.paused);
  renderer.draw(s, ui);
  miniTimer -= dt;
  if (miniTimer <= 0) { miniTimer = 0.25; renderer.drawMinimap(mctx, s, mini.width, mini.height); }

  clockTimer -= dt;
  if (clockTimer <= 0) {
    clockTimer = 0.5;
    const h = hourOf(s.time, s.startHour, s.dayLength);
    const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const night = renderer.atmo.darkness(s) > 0.3, rain = renderer.atmo.rain(s) > 0.3;
    clockEl.textContent = `${hh}:${mm}`;
    clockIcon.textContent = rain ? '🌧' : night ? '🌙' : (s.season === 'winter' ? '❄' : '☁');
  }
  if (s.winner >= 0 && !endShown) showEnd(s);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { iso };

// ------------------------------------------------------------ saving
// Five save slots plus the automatic save, all in this browser's storage.
const AUTO = 'ww-save', SLOTS = [1, 2, 3, 4, 5];
const slotKey = (n) => (n === 'auto' ? AUTO : `${AUTO}-${n}`);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const infoOf = (slot) => { const j = store.get(slotKey(slot)); return j ? describe(j) : null; };
function clearSave() { store.del(AUTO); showContinue(); } // a finished battle leaves no automatic save
let lastSave = 0;
/** Save the battle into a slot ('auto' for the automatic save). Automatic saves don't announce themselves. */
function saveGame(slot = 'auto') {
  const s = app.state, quiet = slot === 'auto';
  if (s.tutorial) { if (!quiet) pushMessage(s, 'The tutorial cannot be saved', 'warn'); return false; }
  if (s.winner >= 0 || s.time < 1) { if (!quiet) pushMessage(s, 'Nothing to save yet', 'warn'); return false; }
  try {
    store.set(slotKey(slot), serialize(s));
    if (quiet) lastSave = s.time;
    else pushMessage(s, `Battle saved in slot ${slot}`, 'good');
    showContinue();
    return true;
  } catch (e) {
    if (!quiet) pushMessage(s, 'Could not save: the browser refused the storage', 'warn');
    return false;
  }
}
async function loadGame(slot) {
  let state;
  try { state = deserialize(store.get(slotKey(slot))); } catch (e) { pushMessage(app.state, `Could not load that save (${e.message})`, 'warn'); return; }
  app.state = state;
  app.season = state.season;
  sound.init(); voices.prepare(); sound.startMusic();
  useArmies(state);
  ui.selected.clear();
  ui.setMode(null);
  renderer.groundDrawn = false;
  ui.centerOnFront();
  endShown = false;
  lastSave = state.time;
  await loadBattle(state);
  app.started = true;
  resumeBattle();
  pushMessage(state, slot === 'auto' ? 'Battle resumed' : `Battle loaded from slot ${slot}`, 'good');
}
const summary = (info) => {
  const [a, e] = info.nations.map((n) => (NATIONS[n] ? NATIONS[n].name : n));
  const m = Math.floor(info.time / 60), sec = Math.floor(info.time % 60);
  const season = info.season ? info.season[0].toUpperCase() + info.season.slice(1) : '';
  const when = new Date(info.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const diff = info.difficulty ? ` · ${info.difficulty[0].toUpperCase()}${info.difficulty.slice(1)}` : '';
  return { title: `${a} vs ${e} · ${season}${diff} · ${m}m ${sec}s in`, when: `saved ${when}` };
};
/** Start screen: "Continue" resumes the newest save of all; "Load…" lists them. */
function showContinue() {
  const all = ['auto', ...SLOTS].map((k) => ({ k, info: infoOf(k) })).filter((x) => x.info);
  const b = document.getElementById('btn-continue');
  b.classList.toggle('hidden', !all.length);
  if (!all.length) return;
  const newest = all.reduce((a, x) => (x.info.savedAt > a.info.savedAt ? x : a));
  b.dataset.slot = newest.k;
  const t = summary(newest.info);
  b.querySelector('small').textContent = `${t.title} · ${t.when}`;
}
/** The save / load panel: one row per slot. Saving is offered only during a battle. */
let panelFrom = 'game'; // 'game' (from the 💾 button) or 'menu' (from the start screen)
function showSlots() {
  const canSave = app.state.time >= 1 && app.state.winner < 0; // a battle is under way
  const rows = ['auto', ...SLOTS].map((k) => {
    const info = infoOf(k);
    const row = document.createElement('div');
    row.className = 'slot';
    const t = info && summary(info);
    row.innerHTML = `<div class="sn">${k === 'auto' ? 'Automatic' : `Slot ${k}`}</div>
      <div class="si">${info ? `${t.title}<small>${t.when}</small>` : '<span class="muted">Empty</span>'}</div>`;
    const btn = (label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = fn; row.appendChild(b); };
    if (k !== 'auto' && canSave) {
      btn(info ? 'Overwrite' : 'Save', () => {
        if (info && !confirm(`Overwrite slot ${k}?`)) return;
        if (saveGame(k)) closeSlots(true);
      });
    }
    if (info) btn('Load', () => loadGame(k));
    if (info && k !== 'auto') btn('Delete', () => { if (confirm(`Delete the battle in slot ${k}?`)) { store.del(slotKey(k)); showContinue(); showSlots(); } }, 'danger');
    return row;
  });
  document.getElementById('save-slots').replaceChildren(...rows);
}
function openSlots(from) {
  panelFrom = from;
  showSlots();
  showPanel('save-panel', from);
}
function closeSlots() { goBack(); }
showContinue();
document.getElementById('btn-continue').addEventListener('click', (e) => loadGame(e.currentTarget.dataset.slot));
document.getElementById('btn-load').addEventListener('click', () => openSlots('menu'));
document.getElementById('btn-save').addEventListener('click', () => {
  if (!document.getElementById('save-panel').classList.contains('hidden')) closeSlots();
  else openSlots(app.overlayOpen() ? 'menu' : 'game');
});
document.getElementById('btn-save-close').addEventListener('click', () => closeSlots());

// ------------------------------------------------------------ menus
const PANELS = ['menu-panel', 'setup-panel', 'help-panel', 'credits-panel', 'exit-panel', 'save-panel', 'end-panel', 'loading-panel', 'boot-panel', 'epitaph-panel'];
let backTo = 'menu'; // where a panel's Back button goes: the main menu, or straight back to the battle
/** Show one overlay panel (the battle pauses underneath). */
// New Game and Saved battles share a backdrop, drawn at random each time one of them opens
const SETUP_BACKDROPS = ['assets/art/menu-mortar-grey.webp', 'assets/art/menu-rider-grey.webp', 'assets/art/menu-assault-grey.webp', 'assets/art/menu-vickers-grey.webp'];
let lastPanel = null;
function showPanel(id, back = 'menu') {
  backTo = back;
  if ((id === 'setup-panel' || id === 'save-panel') && lastPanel !== 'setup-panel' && lastPanel !== 'save-panel') {
    const pick = SETUP_BACKDROPS[Math.floor(Math.random() * SETUP_BACKDROPS.length)];
    document.getElementById('overlay').style.setProperty('--setup-bg', `url('${pick}')`);
  }
  // loading screens: one of the four photographs (machine gun, infantry, artillery, horseman) at random
  if ((id === 'loading-panel' || id === 'boot-panel') && lastPanel !== id) {
    const pick = SETUP_BACKDROPS[Math.floor(Math.random() * SETUP_BACKDROPS.length)];
    document.getElementById('overlay').style.setProperty('--load-bg', `url('${pick}')`);
  }
  lastPanel = id;
  if (id !== 'end-panel') sound.stopEnding(); // leaving the victory / defeat screen
  document.getElementById('overlay').classList.remove('result', 'victory-entente', 'victory-central', 'defeat-entente', 'defeat-central');
  document.getElementById('overlay').style.backgroundImage = '';
  for (const p of PANELS) document.getElementById(p).classList.toggle('hidden', p !== id);
  document.getElementById('overlay').classList.toggle('menu-mode', id === 'menu-panel');
  document.getElementById('overlay').classList.toggle('loading-mode', id === 'loading-panel' || id === 'boot-panel');
  document.getElementById('overlay').classList.toggle('setup-mode', id === 'setup-panel');
  document.getElementById('overlay').classList.toggle('save-mode', id === 'save-panel');
  // the other screens: plain lettering on the darkened photo, like the main menu
  document.getElementById('overlay').classList.toggle('plain-mode', ['help-panel', 'credits-panel', 'save-panel', 'exit-panel', 'loading-panel', 'boot-panel', 'epitaph-panel'].includes(id));
  document.getElementById('overlay').classList.toggle('epitaph-mode', id === 'epitaph-panel');
  document.getElementById('overlay').classList.remove('hidden');
  app.paused = true;
  document.getElementById('btn-pause').textContent = '▶';
  if (id === 'menu-panel') {
    const live = app.started && app.state.winner < 0;
    document.getElementById('m-resume').classList.toggle('hidden', !live);
    showContinue();
    if (live) document.getElementById('btn-continue').classList.add('hidden'); // Resume is the way back in
  }
}
function resumeBattle() {
  sound.stopEnding();
  document.getElementById('overlay').classList.add('hidden');
  app.paused = false;
  document.getElementById('btn-pause').textContent = '❚❚';
}
function goBack() {
  if (backTo === 'game' && app.started && app.state.winner < 0) resumeBattle();
  else showPanel('menu-panel');
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goBack));
document.getElementById('m-resume').addEventListener('click', resumeBattle);
document.getElementById('m-new').addEventListener('click', () => {
  if (app.started && app.state.winner < 0) saveGame('auto'); // the battle being left stays in the automatic save
  showPanel('setup-panel');
});
document.getElementById('m-help').addEventListener('click', () => showPanel('help-panel'));
document.getElementById('m-credits').addEventListener('click', () => showPanel('credits-panel'));
document.getElementById('btn-menu').addEventListener('click', () => {
  if (app.overlayOpen() && !document.getElementById('menu-panel').classList.contains('hidden') && app.started) resumeBattle();
  else showPanel('menu-panel');
});
// the WORLDWAR title in the top bar opens the menu too, like ☰
document.querySelector('#topbar .title').addEventListener('click', () => document.getElementById('btn-menu').click());
document.getElementById('btn-end-menu').addEventListener('click', () => showPanel('menu-panel'));
document.getElementById('m-exit').addEventListener('click', () => {
  if (app.started && app.state.winner < 0) saveGame('auto'); // nothing is lost by leaving
  app.started = false;
  if (sound.ctx) sound.ctx.suspend(); // silence (the music preference is kept)
  showPanel('exit-panel');
  try { window.close(); } catch {} // only works when the game was opened by a script; otherwise this screen stays
});
document.getElementById('btn-exit-back').addEventListener('click', () => {
  if (sound.ctx) sound.ctx.resume();
  showPanel('menu-panel');
});
// ------------------------------------------------------------ opening loading screen
// Loads what the menus show (photos, the soldier models, the music), then waits for a click: browsers
// only allow sound after the player has clicked, and that click starts the music and opens the menu.
async function boot() {
  showPanel('boot-panel');
  const fill = document.getElementById('boot-fill'), item = document.getElementById('boot-item');
  const img = (src) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = src; });
  const jobs = [
    ['Photographs', Promise.all(['assets/art/menu-truce-clear.webp', ...SETUP_BACKDROPS].map(img))],
    ['Soldiers', fetch('assets/models/manifest.json').then((r) => r.json()).then((m) => Promise.all(app.nations.filter((n) => m[n]).map((n) => fetch('assets/models/' + m[n]).then((r) => r.arrayBuffer()))))],
    ['Portraits', Promise.all(Object.keys(NATIONS).map((n) => img(portraitOf(n))))],
    ['Music', new Promise((r) => { const a = new Audio('assets/music/ombra-di-guerra.mp3'); a.preload = 'auto'; a.oncanplaythrough = a.onerror = r; a.load(); })],
  ];
  let done = 0;
  const limit = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
  await Promise.all(jobs.map(([label, p]) => limit(p).then(() => { done++; fill.style.width = `${Math.round((done / jobs.length) * 100)}%`; item.textContent = `${label} ✓`; })));
  item.textContent = 'Ready';
  const enter = document.getElementById('btn-enter');
  enter.classList.remove('hidden');
  const go = () => {
    window.removeEventListener('keydown', go);
    sound.init(); voices.prepare(); sound.startMusic();
    showPanel('menu-panel');
  };
  enter.addEventListener('click', go, { once: true });
  window.addEventListener('keydown', go);
}
boot();
// automatic save every minute of battle, and whenever the page is hidden or closed
setInterval(() => { if (!app.paused && app.state.time - lastSave >= 60) saveGame('auto'); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveGame('auto'); });
window.addEventListener('pagehide', () => saveGame('auto'));

// ------------------------------------------------------------ loading screen
const TIPS = [
  'Cut the wire with a barrage before you send the infantry across.',
  'Charge while the shells are still falling: the defenders are keeping their heads down.',
  'Machine guns massacre troops in the open. Never walk at an MG you have not suppressed.',
  'Worn-down squads are not refilled. Recruit fresh ones at HQ.',
  'A shell-damaged trench protects far less. Dig it out again with T.',
  'Enemy troops near your HQ stop it raising new units.',
  'Double-click a unit to select every unit of its kind on screen.',
  'Artillery cannot fire at anything closer than 10 tiles.',
];
/**
 * Show the loading screen until everything the battle needs is in: ground textures, the season's
 * trenches and scenery, guns, both armies' soldiers, shell bursts, sound effects and our army's
 * voices. Each item has a time limit, so one slow download never keeps the player waiting forever
 * (the game then uses its fallbacks until it arrives).
 */
async function loadBattle(state) {
  showPanel('loading-panel');
  document.getElementById('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  sound.init();
  const nat = (k) => (NATIONS[k] ? NATIONS[k].name : k);
  const jobs = [
    ['Ground textures', renderer.texLoading],
    ['Trenches and scenery', renderer.loadProps(state.season)],
    ['Guns and machine guns', renderer.loadAtlas('units')],
    [`The ${nat(state.nations[0])} army`, renderer.loadAtlas('soldiers-' + state.nations[0])],
    [`The ${nat(state.nations[1])} army`, renderer.loadAtlas('soldiers-' + state.nations[1])],
    ['Shell bursts', renderer.loadImpact()],
    ['Sounds of battle', sound.sampleLoad],
    ['Voices', voices.prepare(state.nations[PLAYER])],
  ];
  const fill = document.getElementById('load-fill'), item = document.getElementById('load-item');
  let done = 0;
  const total = jobs.length + 1;
  const step = (label) => { done++; fill.style.width = `${Math.round((done / total) * 100)}%`; item.textContent = label; };
  fill.style.width = '0%';
  const limit = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 25000))]);
  await Promise.all(jobs.map(([label, p]) => limit(p).then(() => step(`${label} ✓`))));
  // let the battlefield ground be built behind the loading screen before the curtain goes up
  item.textContent = 'Preparing the battlefield…';
  renderer.groundDrawn = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
  step('Ready');
  await new Promise((r) => setTimeout(r, 250));
}

// ------------------------------------------------------------ tutorial: 1 July 1916
let tutorial = null;
function endTutorial() {
  if (tutorial) tutorial.stop();
  tutorial = null;
  document.body.classList.remove('tutorial');
}
document.getElementById('m-tutorial').addEventListener('click', async () => {
  if (app.started && app.state.winner < 0 && !app.state.tutorial) saveGame('auto'); // the battle being left stays in the automatic save
  endTutorial();
  const state = createTutorialGame();
  app.state = state;
  app.season = state.season;
  useArmies(state);
  ui.selected.clear(); ui.setMode(null);
  renderer.groundDrawn = false;
  endShown = false;
  document.body.classList.add('tutorial');
  await loadBattle(state);
  app.started = true;
  resumeBattle();
  tutorial = runTutorial(state, {
    ui, renderer, sound,
    onEnd: () => {
      app.started = false;
      document.body.classList.remove('tutorial');
      tutorial = null;
      showPanel('epitaph-panel');
      sound.playEnding('defeat');
      // the story rolls up from below the view until its last line rests near the middle
      const panel = document.getElementById('epitaph-panel'), roll = panel.querySelector('.roll'), text = panel.querySelector('.roll-text');
      panel.classList.remove('play');
      requestAnimationFrame(() => {
        const vh = roll.clientHeight, th = text.scrollHeight;
        const from = vh, to = Math.min(0, vh * 0.5 - th);
        panel.style.setProperty('--roll-from', `${from}px`);
        panel.style.setProperty('--roll-to', `${to}px`);
        panel.style.setProperty('--roll-time', `${Math.max(14, (from - to) / 22)}s`); // about 22 px a second
        void panel.offsetWidth; // restart the animations
        panel.classList.add('play');
      });
      // the lessons, one card at a time
      const cards = [...panel.querySelectorAll('.card')], dots = [...panel.querySelectorAll('.card-dots i')];
      let n = -1;
      const next = () => { n = (n + 1) % cards.length; cards.forEach((c, i) => c.classList.toggle('on', i === n)); dots.forEach((d, i) => d.classList.toggle('on', i === n)); };
      clearInterval(window.__cardTimer);
      cards.forEach((c) => c.classList.remove('on'));
      setTimeout(() => { next(); window.__cardTimer = setInterval(() => { if (panel.classList.contains('hidden')) clearInterval(window.__cardTimer); else next(); }, 5000); }, 2500);
    },
  });
});
document.getElementById('btn-epitaph-new').addEventListener('click', () => showPanel('setup-panel'));
// leaving the tutorial for another game ends its script
for (const id of ['btn-start', 'btn-continue', 'btn-restart']) document.getElementById(id).addEventListener('click', () => { if (app.state.tutorial || tutorial) endTutorial(); }, true);
