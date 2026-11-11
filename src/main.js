import { createGame, update, pushMessage } from './game.js';
import { Renderer, iso } from './render.js';
import { UI } from './ui.js';
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
  side: 'allied', // 'allied' | 'central' | 'random'
  start: 'west', // 'west' | 'east' | 'random'
  overlayOpen() { return !document.getElementById('overlay').classList.contains('hidden'); },
  togglePause() {
    this.paused = !this.paused;
    document.getElementById('btn-pause').textContent = this.paused ? '▶' : '❚❚';
  },
  toggleHelp() {
    const ov = document.getElementById('overlay');
    const open = !this.overlayOpen();
    ov.classList.toggle('hidden', !open);
    document.getElementById('help-panel').classList.remove('hidden');
    document.getElementById('end-panel').classList.add('hidden');
    this.paused = open;
    document.getElementById('btn-pause').textContent = this.paused ? '▶' : '❚❚';
  },
};

const canvas = document.getElementById('view');
const renderer = new Renderer(canvas);
const sound = new Sound();
const ui = new UI(app, renderer, sound);
renderer.loadTextures();
let artKeys = {};
const portraitOf = (n) => (artKeys[`soldier-${n}`] ? `assets/art/soldier-${n}.png` : `assets/soldiers/${n}/portrait.png`);
renderer.portraitOf = portraitOf;
function useArmies(state) {
  renderer.loadImpact();
  renderer.loadProps(state.season);
  renderer.nations = state.nations;
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
  const side = Math.random() < 0.5 ? 'allied' : 'central';
  return [pick(ofSide(side)), pick(ofSide(side === 'allied' ? 'central' : 'allied'))];
}
/** Tell the player which army they lead (once per battle, when it starts). */
function announce(state) {
  if (!state.messages.some((m) => m.kind === 'side')) pushMessage(state, `You command the army of ${NATIONS[state.nations[0]].name}, holding the ${state.start === 'east' ? 'east' : 'west'} line, against ${NATIONS[state.nations[1]].name}.`, 'side');
}
function nationButtons() {
  const mine = document.getElementById('nation-btns'), foe = document.getElementById('enemy-btns');
  const random = app.side === 'random';
  document.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('active', x.dataset.side === app.side));
  document.getElementById('nation-lists').classList.toggle('hidden', random);
  document.getElementById('random-note').classList.toggle('hidden', !random);
  if (random) return;
  if (NATIONS[app.nations[0]].alliance !== app.side) app.nations[0] = ofSide(app.side)[0];
  const myAlliance = app.side;
  if (NATIONS[app.nations[1]].alliance === myAlliance) app.nations[1] = Object.keys(NATIONS).find((k) => NATIONS[k].alliance !== myAlliance);
  const btn = (k, active, onClick) => { const b = document.createElement('button'); b.className = active ? 'active' : ''; b.innerHTML = `<img src="${portraitOf(k)}" alt=""><span>${NATIONS[k].name}</span>`; b.onclick = onClick; return b; };
  mine.replaceChildren(...ofSide(myAlliance).map((k) => btn(k, k === app.nations[0], () => { app.nations[0] = k; nationButtons(); })));
  foe.replaceChildren(...Object.keys(NATIONS).filter((k) => NATIONS[k].alliance !== myAlliance).map((k) => btn(k, k === app.nations[1], () => { app.nations[1] = k; nationButtons(); })));
}
const chosenStart = () => (app.start === 'random' ? (Math.random() < 0.5 ? 'west' : 'east') : app.start);
document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
  app.start = b.dataset.start;
  document.querySelectorAll('[data-start]').forEach((x) => x.classList.toggle('active', x === b));
}));
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { app.side = b.dataset.side; nationButtons(); }));
nationButtons();
fetch('assets/art/manifest.json').then((r) => r.json()).then((m) => { artKeys = m; nationButtons(); }).catch(() => {});
ui.centerOnFront();
window.addEventListener('resize', () => renderer.resize());
window.worldwar = { app, renderer, ui }; // handy for debugging in the console

document.querySelectorAll('[data-season]').forEach((b) => b.addEventListener('click', () => {
  app.season = b.dataset.season;
  document.querySelectorAll('[data-season]').forEach((x) => x.classList.toggle('active', x === b));
}));
document.getElementById('btn-start').addEventListener('click', () => {
  sound.init();
  const sameNations = app.side !== 'random' && app.state.nations.join() === app.nations.join();
  const sameStart = app.start !== 'random' && app.state.start === app.start;
  if ((app.state.season !== app.season || !sameNations || !sameStart) && app.state.time < 1) {
    app.state = createGame({ season: app.season, nations: chosenNations(), start: chosenStart() });
    useArmies(app.state);
    renderer.groundDrawn = false;
    ui.selected.clear();
    ui.centerOnFront();
  }
  document.getElementById('overlay').classList.add('hidden');
  announce(app.state);
  app.paused = false;
  document.getElementById('btn-pause').textContent = '❚❚';
});
document.getElementById('btn-restart').addEventListener('click', () => {
  app.state = createGame({ seed: Math.floor(Math.random() * 1e6), season: app.season, nations: chosenNations(), start: chosenStart() });
  useArmies(app.state);
  ui.selected.clear();
  ui.setMode(null);
  renderer.groundDrawn = false;
  ui.centerOnFront();
  document.getElementById('overlay').classList.add('hidden');
  announce(app.state);
  app.paused = false;
  endShown = false;
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
document.getElementById('btn-sound').addEventListener('click', (e) => {
  sound.init();
  sound.setEnabled(!sound.enabled);
  e.target.textContent = sound.enabled ? '🔊' : '🔇';
});

let endShown = false;
function showEnd(state) {
  endShown = true;
  const won = state.winner === PLAYER;
  document.getElementById('end-title').textContent = won ? 'Victory' : 'Defeat';
  const mins = Math.floor(state.time / 60), secs = Math.floor(state.time % 60);
  document.getElementById('end-text').textContent =
    (won ? 'The enemy line has broken. ' : 'Our line has broken. ') +
    `Time in the line: ${mins}m ${secs}s. Our casualties: ${state.stats.lost[0]} men. Enemy casualties: ${state.stats.lost[1]} men.`;
  document.getElementById('help-panel').classList.add('hidden');
  document.getElementById('end-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}

let last = performance.now();
let acc = 0;
let miniTimer = 0;
let clockTimer = 0;
const clockEl = document.getElementById('clock');
const clockIcon = document.getElementById('clock-icon');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = app.state;
  if (!app.paused) {
    acc += dt * app.speed;
    let n = 0;
    while (acc >= STEP && n < 12) { update(s, STEP); acc -= STEP; n++; }
    if (n >= 12) acc = 0;
  }
  ui.update(dt);
  renderer.update(dt, app.paused ? 0 : dt * app.speed, s);

  // sounds, attenuated by distance from the camera centre
  const center = renderer.screenToMap(renderer.vw / 2, renderer.vh / 2);
  for (const ev of s.events) {
    const d = ev.x === undefined ? 0 : Math.hypot(ev.x - center.x, ev.y - center.y);
    sound.play(ev.type, Math.max(0, 1 - d / (28 / renderer.cam.zoom)));
    renderer.onEvent(ev);
  }
  s.events.length = 0;

  renderer.draw(s, ui);
  miniTimer -= dt;
  if (miniTimer <= 0) { miniTimer = 0.25; renderer.drawMinimap(mctx, s, mini.width, mini.height); }

  clockTimer -= dt;
  if (clockTimer <= 0) {
    clockTimer = 0.5;
    const h = hourOf(s.time);
    const hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const night = renderer.atmo.darkness(s) > 0.3, rain = renderer.atmo.rain(s) > 0.3;
    clockEl.textContent = `${hh}:${mm}`;
    clockIcon.textContent = rain ? (s.season === 'mud' ? '🌧' : '🌨') : night ? '🌙' : (s.season === 'winter' ? '❄' : '☁');
  }
  if (s.winner >= 0 && !endShown) showEnd(s);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { iso };
