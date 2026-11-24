import { createGame, update, pushMessage } from './game.js';
import { Renderer, iso } from './render.js';
import { UI } from './ui.js';
import { Voices } from './voice.js';
import { serialize, deserialize, describe } from './save.js';
import { ModelView } from './model-view.js';
import { createTutorialGame, runTutorial } from './tutorial.js';
import { LEVELS, PROLOGUE, levelById, createLevelGame, stepCampaign, loadProgress, recordResult, markTutorialDone, clockHours, dayTime } from './campaign.js';
import { Sound } from './audio.js';
import { PLAYER, NATIONS } from './config.js';
import { hourOf } from './atmosphere.js';

// An element by id, or a detached stand-in, so one missing element (an old cached page) cannot stop the rest of the wiring.
const byId = (id) => document.getElementById(id) || document.createElement('div');

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
const ofSide = (side) => Object.keys(NATIONS).filter((k) => NATIONS[k].alliance === side && !NATIONS[k].campaign);
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
    if (!viewers[key]) { viewers[key] = new ModelView(document.getElementById('model-' + key)); if (key.endsWith('foe')) viewers[key].rest = viewers[key].yaw = 0.45; viewers[key].auto = true; } // the two face each other; every soldier turns slowly on its own (faster under the mouse)
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
byId('btn-swap').addEventListener('click', () => {
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
byId('btn-random-side').addEventListener('click', () => { app.side = app.side === 'random' ? fixedSide : 'random'; renderSetup(); });
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
window.worldwar = { app, renderer, ui, sound };
// no browser right-click menu anywhere in the game, and no page zoom on phones (double-tap or pinch outside
// the map; the map's own pinch zoom is handled in ui.js)
window.addEventListener('contextmenu', (e) => e.preventDefault());
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault()); // iOS Safari
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 320 && !e.target.closest('#view')) e.preventDefault(); lastTouchEnd = now; }, { passive: false });
document.addEventListener('dblclick', (e) => { if (!e.target.closest('#view')) e.preventDefault(); }); // handy for debugging in the console

document.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
  app.season = b.dataset.season;
  document.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('active', x === b));
}));
byId('btn-start').addEventListener('click', async () => {
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
byId('btn-restart').addEventListener('click', async () => {
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
byId('btn-film').addEventListener('click', () => {
  film = (film + 1) % FILM.length;
  canvas.style.filter = FILM[film];
});
byId('btn-pause').addEventListener('click', () => app.togglePause());
byId('btn-help').addEventListener('click', () => app.toggleHelp());
byId('btn-speed').addEventListener('click', (e) => {
  app.speed = app.speed === 1 ? 2 : app.speed === 2 ? 3 : 1;
  e.target.textContent = app.speed + '×';
});
const voiceBtn = document.getElementById('btn-voice');
const showVoice = () => { voiceBtn.style.opacity = voices.on ? '1' : '0.4'; };
showVoice();
voiceBtn.addEventListener('click', () => { voices.setOn(!voices.on); showVoice(); });
const musicBtn = document.getElementById('btn-music');
const menuMusic = document.getElementById('m-music'); // the same switch on the main menu
const showMusic = () => {
  musicBtn.style.opacity = sound.musicOn ? '1' : '0.4';
  if (menuMusic) { menuMusic.textContent = sound.musicOn ? '♪ Music on' : '♪ Music off'; menuMusic.classList.toggle('off', !sound.musicOn); }
};
showMusic();
const toggleMusic = () => { sound.init(); sound.startMusic(); sound.setMusic(!sound.musicOn); showMusic(); };
musicBtn.addEventListener('click', toggleMusic);
byId('m-music').addEventListener('click', toggleMusic);
byId('btn-sound').addEventListener('click', (e) => {
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
  if (state.campaign) { clearSave(); app.started = false; showDebrief(state); return; }
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
let campaignTimer = 0;
const clockEl = document.getElementById('clock');
const clockIcon = document.getElementById('clock-icon');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

const NOISY = new Set(['rifle', 'mg', 'boom', 'artyfire', 'death', 'incoming', 'splash']);
const pauseSign = document.getElementById('pause-sign');
pauseSign.addEventListener('click', () => { if (app.paused) app.togglePause(); });
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = app.state;
  if (loading) { last = now; requestAnimationFrame(frame); return; } // nothing is drawn while the loading screen is up
  const held = (tutorial && tutorial.holding()) || !!opening; // the tutorial's battle waits for the player's order; a level's opening scene holds it too
  if (!app.paused && !held) {
    acc += dt * app.speed;
    let n = 0;
    while (acc >= STEP && n < 12) { update(s, STEP); if (s.campaign) stepCampaign(s); acc -= STEP; n++; }
    if (n >= 12) acc = 0;
  }
  if (tutorial && !app.paused) tutorial.tick(held ? dt : dt * app.speed);
  if (opening && !app.paused) opening.tick(dt);
  campaignScene(s, dt);
  ui.update(dt);
  renderer.update(dt, app.paused || held ? 0 : dt * app.speed, s);
  if (renderer.atmo.gustStarted) { sound.windGust(renderer.atmo.gustStarted.dur + renderer.atmo.gustStarted.travel); renderer.atmo.gustStarted = null; } // the wind in the woods
  if (renderer.atmo.gust) sound.setWindPan(renderer.atmo.gustPan(renderer)); // carried across the screen with the gust front

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
  // the battle paused in play (not behind a menu): a big pause sign in the middle, and the music waits
  const pausedInPlay = app.started && app.paused && s.winner < 0 && document.getElementById('overlay').classList.contains('hidden');
  pauseSign.classList.toggle('hidden', !pausedInPlay);
  sound.holdMusic(pausedInPlay);
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
    clockIcon.textContent = rain ? '🌧' : night ? '🌙' : (s.season === 'winter' ? '❄' : s.season === 'summer' ? '☀' : '☁');
  }
  campaignTimer -= dt;
  if (campaignTimer <= 0) { campaignTimer = 0.5; showObjectives(s); }
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
  if (info.level && levelById(info.level)) { const L = levelById(info.level), mm = Math.floor(info.time / 60); return { title: `Campaign ${L.n}: ${L.title} · ${mm}m in`, when: `saved ${new Date(info.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` }; }
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
byId('btn-continue').addEventListener('click', (e) => loadGame(e.currentTarget.dataset.slot));
byId('btn-load').addEventListener('click', () => openSlots('menu'));
byId('btn-save').addEventListener('click', () => {
  if (!document.getElementById('save-panel').classList.contains('hidden')) closeSlots();
  else openSlots(app.overlayOpen() ? 'menu' : 'game');
});
byId('btn-save-close').addEventListener('click', () => closeSlots());

// ------------------------------------------------------------ menus
const PANELS = ['menu-panel', 'setup-panel', 'help-panel', 'credits-panel', 'exit-panel', 'save-panel', 'end-panel', 'loading-panel', 'boot-panel', 'epitaph-panel', 'campaign-panel', 'briefing-panel', 'debrief-panel'];
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
  document.getElementById('overlay').classList.toggle('plain-mode', ['help-panel', 'credits-panel', 'save-panel', 'exit-panel', 'loading-panel', 'boot-panel', 'epitaph-panel', 'campaign-panel', 'briefing-panel', 'debrief-panel'].includes(id));
  document.getElementById('overlay').classList.toggle('debrief-mode', id === 'debrief-panel');
  document.getElementById('overlay').classList.toggle('epitaph-mode', id === 'epitaph-panel');
  document.getElementById('overlay').classList.remove('hidden');
  app.paused = true;
  document.getElementById('btn-pause').textContent = '▶';
  if (id === 'menu-panel') {
    labelCampaign();
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
byId('m-resume').addEventListener('click', resumeBattle);
byId('m-new').addEventListener('click', () => {
  if (app.started && app.state.winner < 0) saveGame('auto'); // the battle being left stays in the automatic save
  showPanel('setup-panel');
});
byId('m-help').addEventListener('click', () => showPanel('help-panel'));
byId('m-credits').addEventListener('click', () => showPanel('credits-panel'));
byId('btn-menu').addEventListener('click', () => {
  if (app.overlayOpen() && !document.getElementById('menu-panel').classList.contains('hidden') && app.started) resumeBattle();
  else showPanel('menu-panel');
});
// the WORLDWAR title in the top bar opens the menu too, like ☰
document.querySelector('#topbar .title').addEventListener('click', () => document.getElementById('btn-menu').click());
byId('btn-end-menu').addEventListener('click', () => showPanel('menu-panel'));
byId('m-exit').addEventListener('click', () => {
  if (app.started && app.state.winner < 0) saveGame('auto'); // nothing is lost by leaving
  app.started = false;
  if (sound.ctx) sound.ctx.suspend(); // silence (the music preference is kept)
  showPanel('exit-panel');
  try { window.close(); } catch {} // only works when the game was opened by a script; otherwise this screen stays
});
byId('btn-exit-back').addEventListener('click', () => {
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
/** Raise the loading screen and let it be painted; the battlefield is not drawn until loadBattle allows it. */
let loading = false;
async function showLoading() {
  loading = true;
  showPanel('loading-panel');
  document.getElementById('load-fill').style.width = '0%';
  document.getElementById('load-item').textContent = 'Preparing the battlefield…';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
}
async function loadBattle(state) {
  loading = true;
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
    ...((state.campaign && levelById(state.campaign.id).allies) || []).map((n) => [`The ${nat(n)} army`, renderer.loadAtlas('soldiers-' + n)]),
    ...(state.backdrop ? [[state.backdrop.name || 'The town', renderer.loadBackdrop(state.backdrop)]] : []),
    ...(state.buildings && state.buildings.length ? [['The town', Promise.all(state.buildings.map((b) => renderer.loadBackdrop(b)))]] : []),
    ...((state.campaign && levelById(state.campaign.id).pictures) || []).map((src) => ['Pictures', new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = src; })]),
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
  loading = false; // (now the ground is built, behind the loading screen)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
  step('Ready');
  await new Promise((r) => setTimeout(r, 250));
}

// ------------------------------------------------------------ tutorial: 1 July 1916
let tutorial = null;
function endTutorial() {
  stopOpening();
  if (tutorial) tutorial.stop();
  tutorial = null;
  document.body.classList.remove('tutorial');
}
async function startTutorial() {
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
      markTutorialDone();
      showPanel('epitaph-panel');
      sound.playEnding('defeat');
      // the story rolls up from below the view until its last line rests near the middle
      const panel = document.getElementById('epitaph-panel'), roll = panel.querySelector('.roll'), text = panel.querySelector('.roll-text');
      panel.classList.remove('play');
      requestAnimationFrame(() => {
        const vh = roll.clientHeight, th = text.scrollHeight;
        const from = vh, to = -th; // rolls on until the last line has left the top
        panel.style.setProperty('--roll-from', `${from}px`);
        panel.style.setProperty('--roll-to', `${to}px`);
        panel.style.setProperty('--roll-time', `${Math.max(10, (from - to) / 38)}s`); // about 38 px a second
        void panel.offsetWidth; // restart the animations
        text.classList.remove('rested');
        text.style.removeProperty('--rest-y');
        panel.classList.add('play');
        // once the last line has rolled out, the text fades back in, centred, and stays
        text.onanimationend = () => {
          text.style.setProperty('--rest-y', `${Math.max(0, (roll.clientHeight - text.scrollHeight) / 2)}px`);
          text.classList.add('rested');
        };
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
}
byId('btn-epitaph-new').addEventListener('click', () => showPanel('setup-panel'));
// leaving the tutorial for another game ends its script
for (const id of ['btn-start', 'btn-continue', 'btn-restart']) document.getElementById(id).addEventListener('click', () => { if (app.state.tutorial || tutorial) endTutorial(); }, true);

// ------------------------------------------------------------ campaign
/** The objectives panel during a campaign battle. */
function showObjectives(s) {
  const box = document.getElementById('objectives');
  const L = s.campaign && levelById(s.campaign.id);
  box.classList.toggle('hidden', !L || !app.started);
  if (!L || !app.started) return;
  const [head, ...rest] = L.tracker(s);
  box.innerHTML = `<div class="ob-when">${dayTime(clockHours(s))}</div><div class="ob-head">${head}</div>` + rest.map((t) => `<div>${t}</div>`).join('');
}
const medalHtml = (names, got) => names.map((m, i) => `<li class="${got[i] ? 'got' : ''}"><b>${got[i] ? '★' : '☆'}</b> ${m}</li>`).join('');
function showCampaign() {
  const p = loadProgress();
  const pro = document.createElement('button');
  pro.className = 'level prologue';
  pro.innerHTML = `<span class="ln">·</span><span class="lt">Tutorial: 1 July 1916<small>The Somme</small></span><span class="lm">${p.tutorial ? '✓ Done' : 'Start here'}</span>`;
  pro.onclick = () => showBriefing('prologue');
  document.getElementById('level-list').replaceChildren(pro, ...LEVELS.map((L) => {
    const open = L.n <= p.unlocked && !L.soon && p.tutorial, b = document.createElement('button');
    b.className = 'level' + (open ? '' : ' locked');
    const stars = p.medals[L.id] || 0;
    b.innerHTML = `<span class="ln">${L.n}</span><span class="lt">${L.title}<small>${L.place} · ${L.date}</small></span><span class="lm">${L.soon ? 'Coming soon' : open ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : 'Locked'}</span>`;
    b.disabled = !open;
    b.onclick = () => showBriefing(L.id);
    return b;
  }));
  showPanel('campaign-panel');
}
let briefed = null;
function showBriefing(id) {
  const L = id === 'prologue' ? PROLOGUE : levelById(id), p = loadProgress();
  briefed = id;
  const P = document.getElementById('briefing-panel');
  P.querySelector('.brief-num').textContent = L.n ? `Battle ${L.n} of ${LEVELS.length}` : 'Tutorial';
  P.querySelector('.brief-title').textContent = L.title;
  // the two armies of the battle, in 3D (fixed: a historical battle)
  [['mine', L.nations[0]], ['foe', L.nations[1]]].forEach(([k, n]) => {
    const box = P.querySelector('.brief-army.' + k);
    box.querySelector('.side-name').textContent = k === 'mine' ? 'You' : 'Enemy';
    box.querySelector('.nation-name').textContent = NATIONS[n].name;
    const img = document.getElementById('fig-b' + k);
    if (img.getAttribute('src') !== portraitOf(n)) img.setAttribute('src', portraitOf(n));
    showModel('b' + k, n);
  });
  P.querySelector('.brief-where').textContent = `${L.place} · ${L.date} · ${NATIONS[L.nations[0]].name} against ${NATIONS[L.nations[1]].name}`;
  P.querySelector('.brief-history').textContent = L.history;
  P.querySelector('.brief-objectives').innerHTML = L.objectives.map((t) => `<li>${t}</li>`).join('');
  P.querySelector('.brief-rules').innerHTML = L.rules.map((t) => `<li>${t}</li>`).join('');
  const best = p.medals[id] || 0, medals = L.medals || [];
  P.querySelector('.brief-medals').innerHTML = medalHtml(medals, medals.map((_, i) => i < best));
  P.querySelector('.brief-medals').hidden = P.querySelector('.brief-medals-h').hidden = !medals.length; // the prologue has none
  showPanel('briefing-panel');
}
// a campaign level's picture of a moment (the relief arriving), shown with its announcement for a few seconds
let sceneShown = null, sceneTimer = 0;
function hideScene() {
  sceneTimer = 0;
  const box = document.getElementById('story');
  if (box.classList.contains('scene')) { box.className = 'hidden'; box.onclick = null; }
}
function campaignScene(s, dt) {
  const sc = s.campaign && s.campaign.scene;
  if (sc && sceneShown !== sc && !tutorial && s.time - sc.at < 9 && s.winner < 0) {
    sceneShown = sc;
    const box = document.getElementById('story'), pic = box.querySelector('.pic');
    box.className = 'center scene';
    pic.className = 'pic scene'; pic.src = sc.img;
    box.querySelector('.who').textContent = sc.who || '';
    box.querySelector('.line').textContent = sc.text || '';
    box.querySelector('.hint').textContent = '';
    box.onclick = hideScene;
    sceneTimer = 9;
  }
  if (sceneTimer > 0 && !app.paused) { sceneTimer -= dt; if (sceneTimer <= 0 || s.winner >= 0) hideScene(); }
}

async function startLevel(id) {
  hideScene(); sceneShown = null;
  if (app.started && app.state.winner < 0 && !app.state.tutorial && !app.state.campaign) saveGame('auto');
  endTutorial();
  // the loading screen goes up at once, before anything heavy is done (a large battlefield takes a moment)
  await showLoading();
  const state = createLevelGame(id);
  app.state = state;
  app.season = state.season;
  useArmies(state);
  ui.selected.clear(); ui.setMode(null);
  renderer.groundDrawn = false;
  ui.centerOnFront();
  endShown = false;
  lastSave = 0;
  await loadBattle(state);
  app.started = true;
  resumeBattle();
  const L = levelById(id);
  const begin = () => { if (L.openingEnd) L.openingEnd(state); announce(state); };
  const afterOpening = () => (L.tour ? playTour(state, L.tour(state), begin) : begin());
  if (L.opening) playOpening(state, L.opening, afterOpening, L.openingScene);
  else afterOpening();
}

// ------------------------------------------------------------ a level's opening scene
// Like the prologue's: pictures and lines of dialogue in the story box, each shown for a time that suits
// its length (a click, Space or Enter moves on; Esc skips the scene). The battle waits until it ends.
let opening = null;
function stopOpening() {
  if (!opening) return;
  opening.stop();
  opening = null;
}
/**
 * The camera visits each place in turn (a level's objectives), gliding there and marking it for a few
 * seconds, then comes back to where it started. The battle waits meanwhile; a click, Space or Esc skips it.
 */
function playTour(state, points, done) {
  stopOpening();
  if (!points.length) { done(); return; }
  const r = renderer, home = { x: r.cam.x, y: r.cam.y, z: r.cam.zoom }, GLIDE = 1.1, HOLD = 2.4, ZOOM = Math.max(home.z, 1.5);
  const stops = [...points.map((p) => { const w = iso(p.x, p.y); return { ...p, w: { x: r.M * w.x, y: w.y - 20 } }; }), { home: true, w: home }]; // (camera space: mirrored on a mirrored level)
  let i = 0, t = 0, from = { ...home };
  const finish = () => { if (opening !== self) return; cleanup(); opening = null; r.cam.zoom = home.z; r.cam.x = home.x; r.cam.y = home.y; r.clampCam(); done(); };
  const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); } };
  const onClick = () => finish();
  const view = document.getElementById('view');
  const cleanup = () => { state.marker = null; window.removeEventListener('keydown', onKey, true); view.removeEventListener('pointerdown', onClick, true); };
  const self = {
    tick(dt) {
      t += dt;
      const s = stops[i], k = Math.min(1, t / GLIDE), e = k * k * (3 - 2 * k);
      const z1 = s.home ? home.z : ZOOM;
      r.cam.zoom = from.z + (z1 - from.z) * e;
      r.cam.x = from.x + (s.w.x - from.x) * e; r.cam.y = from.y + (s.w.y - from.y) * e; r.clampCam();
      state.marker = k >= 1 && !s.home ? { x: s.x, y: s.y, label: s.label, strong: true } : null;
      if (t >= GLIDE + (s.home ? 0 : HOLD)) { if (s.home) { finish(); return; } from = { x: r.cam.x, y: r.cam.y, z: r.cam.zoom }; i++; t = 0; }
    },
    stop: cleanup,
  };
  opening = self;
  window.addEventListener('keydown', onKey, true);
  view.addEventListener('pointerdown', onClick, true);
}
function playOpening(state, lines, done, scene = null) {
  stopOpening();
  // a level may play its own scene on the map under the dialogue: told which line is up, how long it has been
  // shown, and the frame time; it can steer the camera (look) and shake it
  const r = renderer;
  const look = (x, y, z) => { const w = iso(x, y); const tx = r.M * w.x, ty = w.y, k = 0.08; r.cam.x += (tx - r.cam.x) * k; r.cam.y += (ty - r.cam.y) * k; r.cam.zoom += (z - r.cam.zoom) * k; r.clampCam(); };
  const shake = (v) => { r.atmo.shake = Math.max(r.atmo.shake, v); };
  const play = (o) => { if (scene) scene(state, { look, shake, sound: (n) => sound.play(n, 1), ...o }); };
  const home = { x: r.cam.x, y: r.cam.y, z: r.cam.zoom }; // (where the camera goes back to when the scene is over)
  const box = document.getElementById('story');
  const who = box.querySelector('.who'), line = box.querySelector('.line'), hint = box.querySelector('.hint'), pic = box.querySelector('.pic');
  let i = -1, t = 0, until = 0;
  const show = (l) => {
    box.className = 'center opening';
    pic.classList.toggle('hidden', !l.img);
    pic.classList.toggle('wide', !!l.wide);
    pic.classList.remove('letter', 'scene');
    if (l.img && pic.getAttribute('src') !== l.img) pic.setAttribute('src', l.img);
    who.textContent = l.who || '';
    line.textContent = l.text || '';
    line.classList.remove('hidden');
    hint.textContent = i === 0 ? (matchMedia('(pointer: coarse)').matches ? 'Tap to continue' : 'Click or press Space to continue · Esc to skip') : '';
    hint.classList.toggle('hidden', i !== 0);
  };
  const next = () => {
    i++;
    if (i >= lines.length) { finish(); return; }
    const l = lines[i];
    show(l);
    t = 0; until = (l.hold || 2.2) + l.text.split(' ').length * 0.3;
    if (l.sound) sound.play(l.sound, 1);
    play({ i, t: 0, dt: 0, start: true });
  };
  const onKey = (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); next(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); }
  };
  const cleanup = () => { window.removeEventListener('keydown', onKey, true); box.onclick = null; box.className = 'hidden'; pic.classList.remove('wide'); };
  const finish = () => { if (opening !== self) return; cleanup(); opening = null; play({ done: true }); if (scene) { r.cam.x = home.x; r.cam.y = home.y; r.cam.zoom = home.z; r.clampCam(); } done(); };
  const self = { tick(dt) { t += dt; play({ i, t, dt }); if (t >= until) next(); }, stop: cleanup };
  opening = self;
  window.addEventListener('keydown', onKey, true);
  box.onclick = next;
  next();
}
function showDebrief(s) {
  const L = levelById(s.campaign.id), won = s.campaign.result === 'won' || s.winner === PLAYER;
  if (!s.campaign.result) s.campaign.result = won ? 'won' : 'lost';
  const medals = recordResult(s);
  const P = document.getElementById('debrief-panel');
  P.querySelector('.brief-num').textContent = `Battle ${L.n}: ${L.title}`;
  P.querySelector('.debrief-title').textContent = won ? 'Victory' : 'Defeat';
  P.querySelector('.debrief-reason').textContent = s.campaign.reason || '';
  P.querySelector('.debrief-history').textContent = won ? L.debrief.won : L.debrief.lost;
  P.querySelector('.debrief-stats').textContent = `${dayTime(clockHours(s))}. Our losses: ${s.stats.lost[PLAYER]} men. Enemy losses: ${s.stats.lost[1 - PLAYER]} men.`;
  P.querySelector('.debrief-medals').innerHTML = medalHtml(L.medals, medals);
  const next = LEVELS.find((x) => x.n === L.n + 1);
  document.getElementById('btn-level-next').classList.toggle('hidden', !won || !next || !!next.soon);
  briefed = L.id;
  showPanel('debrief-panel');
  const side = NATIONS[s.nations[PLAYER]] ? NATIONS[s.nations[PLAYER]].alliance : 'entente';
  document.getElementById('overlay').style.backgroundImage = `linear-gradient(rgba(10, 8, 6, 0.6), rgba(10, 8, 6, 0.85)), url('assets/art/${won ? `victory-${side}` : 'defeat-poppies'}.webp')`;
  sound.playEnding(won ? 'victory' : 'defeat');
}
// first time: the Campaign entry is the tutorial; afterwards the campaign, with the tutorial as its prologue
byId('btn-epitaph-campaign').addEventListener('click', () => showCampaign());
byId('m-campaign').addEventListener('click', () => (loadProgress().tutorial ? showCampaign() : showBriefing('prologue')));
function labelCampaign() { document.getElementById('m-campaign').textContent = loadProgress().tutorial ? 'Campaign' : 'Tutorial'; }
labelCampaign();
byId('btn-level-start').addEventListener('click', () => (briefed === 'prologue' ? startTutorial() : startLevel(briefed)));
byId('btn-brief-back').addEventListener('click', showCampaign);
byId('btn-debrief-campaign').addEventListener('click', showCampaign);
byId('btn-level-retry').addEventListener('click', () => showBriefing(briefed));
byId('btn-level-next').addEventListener('click', () => { const L = levelById(briefed), n = LEVELS.find((x) => x.n === L.n + 1); if (n) showBriefing(n.id); });

// ------------------------------------------------------------ no leaving the game by accident
// The browser's Back and Forward (toolbar buttons, the mouse's side buttons, Alt+Left/Right, the
// Back/Forward keys) are caught: a history entry is kept in front of the game, and going back to it just
// puts it back. The mouse side buttons are swallowed outright. During a battle, closing or reloading the
// tab asks first.
(function guardNavigation() {
  try {
    history.replaceState({ worldwar: 'base' }, '');
    history.pushState({ worldwar: 'guard' }, '');
    window.addEventListener('popstate', () => { history.pushState({ worldwar: 'guard' }, ''); });
  } catch { /* (no history: nothing to guard) */ }
  const swallow = (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); } };
  for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick']) window.addEventListener(ev, swallow, true);
  window.addEventListener('keydown', (e) => {
    if ((e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || e.key === 'BrowserBack' || e.key === 'BrowserForward') { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('beforeunload', (e) => {
    if (app.started && app.state && app.state.winner < 0) { e.preventDefault(); e.returnValue = ''; }
  });
})();
