// DOM HUD + mouse/keyboard input.
import { PLAYER, UNIT_TYPES, BUILD, MAP_W, MAP_H } from './config.js';
import { orderMove, orderBarrage, orderHalt, buyUnit, hqThreatened, placeBuild, cancelBuild, territory, pushMessage } from './game.js';
import { frontLine, teamDir } from './map.js';

const $ = (id) => document.getElementById(id);
/** Is (x, y) between the artillery's minimum and maximum range of this battery? */
const inRange = (u, x, y) => { const d = Math.hypot(u.x - x, u.y - y), A = UNIT_TYPES.artillery; return d <= A.artyRange && d >= A.artyMinRange; };
const fmt = (n) => Math.floor(n).toString();

export class UI {
  constructor(app, renderer, sound, voices = null) {
    this.app = app;
    this.voices = voices;
    this.prevSel = new Set();
    this.r = renderer;
    this.sound = sound;
    this.selected = new Set();
    this.mode = null;
    this.hover = null;
    this.dragBox = null;
    this.painting = false;
    this.panDrag = null;
    this.mouse = { x: -1, y: -1, inside: false };
    this.keys = new Set();
    this.hudTimer = 0;
    this.lastPainted = null;
    this.bindInput();
    this.bindTouch();
    this.bindButtons();
  }

  get state() { return this.app.state; }

  playerUnits() { return this.state.units.filter((u) => u.team === PLAYER && !u.dead); }
  selectedUnits() { return this.playerUnits().filter((u) => this.selected.has(u.id)); }

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('[data-cmd],[data-build]').forEach((b) => {
      const m = b.dataset.build ? 'build:' + b.dataset.build : b.dataset.cmd;
      b.classList.toggle('active', m === mode);
    });
    const hint = $('modehint');
    const text = {
      charge: 'CHARGE: click or tap a target. Troops run, ignore pinning, and fight hand-to-hand on arrival. Right-click or press Charge again to cancel.',
      bombard: 'BOMBARD: click or tap a target area for a barrage. Shift-click to keep the mode on. Right-click or press Bombard again to cancel.',
      'build:trench': `DIG TRENCH (${BUILD.trench.supplies} supplies/tile): click or drag. On a shell-damaged trench it digs it out again. Rifle squads nearby do the digging.`,
      'build:upgrade': `REINFORCE TRENCH (${BUILD.upgrade.supplies} supplies/tile): click our trench tiles. Max level 3.`,
      'build:wire': `BARBED WIRE (${BUILD.wire.supplies} supplies/tile): click or drag. Leave gaps for your own attacks!`,
    }[mode];
    hint.textContent = text || '';
    hint.classList.toggle('hidden', !text);
  }

  batteriesInRange(x, y) {
    return this.bombardCandidates().filter((u) => u.cooldown <= 0 && !u.barrage && inRange(u, x, y)).length;
  }
  bombardCandidates() {
    const sel = this.selectedUnits().filter((u) => u.type === 'artillery');
    return sel.length ? sel : this.playerUnits().filter((u) => u.type === 'artillery');
  }

  // ------------------------------------------------------------ actions

  doBombard(x, y) {
    const cands = this.bombardCandidates();
    // Without an explicit selection, commit one battery per click so the player can stagger barrages.
    const explicit = this.selectedUnits().some((u) => u.type === 'artillery');
    const ready = cands.filter((u) => u.cooldown <= 0 && !u.barrage && inRange(u, x, y));
    const use = explicit ? ready : ready.slice(0, 1);
    const n = orderBarrage(this.state, use, x, y);
    if (n) this.speak('bombard', use);
    if (n) pushMessage(this.state, `${n} batter${n > 1 ? 'ies' : 'y'} opening fire`, 'info');
    else if (!cands.length) pushMessage(this.state, 'We have no artillery', 'warn');
    else if (cands.every((u) => Math.hypot(u.x - x, u.y - y) < UNIT_TYPES.artillery.artyMinRange)) pushMessage(this.state, `Too close for the guns (minimum ${UNIT_TYPES.artillery.artyMinRange} tiles)`, 'warn');
    else pushMessage(this.state, 'No battery ready and in range', 'warn');
  }

  doCharge(x, y) {
    const units = this.selectedUnits().filter((u) => u.type === 'rifle');
    if (!units.length) { pushMessage(this.state, 'Only rifle squads can charge', 'warn'); return; }
    orderMove(this.state, units, x, y, 'charge');
    this.speak('charge', units);
  }

  /** One of the units answers the order (voice + speech bubble). */
  speak(kind, units) {
    if (!units || !units.length) return;
    if (kind === 'charge') this.sound.charge();
    if (!this.voices) return;
    // the unit nearest the middle of the screen answers, so its speech bubble is in view
    const cx = this.r.vw / 2, cy = this.r.vh / 2;
    let u = units[0], bd = Infinity;
    for (const x of units) {
      const p = this.r.mapToScreen(x.x, x.y, 8);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; u = x; }
    }
    this.voices.bark(u, this.state.nations[PLAYER], kind);
  }

  halt() {
    const units = this.selectedUnits();
    orderHalt(this.state, units);
    this.speak('halt', units);
  }

  doRecruit(type) {
    const r = buyUnit(this.state, PLAYER, type);
    if (typeof r === 'string') pushMessage(this.state, `${UNIT_TYPES[type].name}: ${r}`, 'warn');
    else { pushMessage(this.state, `${UNIT_TYPES[type].name} raised at HQ`, 'info'); this.speak('recruit', [r]); }
  }

  paint(x, y) {
    const type = this.mode.slice(6);
    const key = Math.floor(x) + ',' + Math.floor(y);
    if (this.lastPainted === key) return;
    this.lastPainted = key;
    const r = placeBuild(this.state, PLAYER, type, x, y);
    if (!r.ok && !this.painting) pushMessage(this.state, r.reason, 'warn');
  }

  selectAt(sx, sy, additive) {
    let best = null, bd = 22;
    for (const u of this.playerUnits()) {
      const p = this.r.mapToScreen(u.x, u.y, 8);
      const d = Math.hypot(p.x - sx, p.y - sy) / this.r.cam.zoom;
      if (d < bd) { bd = d; best = u; }
    }
    if (!additive) this.selected.clear();
    if (best) {
      if (additive && this.selected.has(best.id)) this.selected.delete(best.id);
      else this.selected.add(best.id);
    }
  }

  selectBox(b, additive) {
    if (!additive) this.selected.clear();
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    for (const u of this.playerUnits()) {
      const p = this.r.mapToScreen(u.x, u.y, 6);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) this.selected.add(u.id);
    }
  }

  centerOnFront() {
    const f = frontLine(this.state.map, PLAYER);
    const xs = f.filter((x) => x >= 0);
    const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : (teamDir(PLAYER) > 0 ? 18 : 45);
    this.r.centerOn(x + 6 * teamDir(PLAYER), MAP_H / 2);
  }

  /** Player unit under a screen point (touch uses a larger radius), or null. */
  unitAt(sx, sy, radius = 22) {
    let best = null, bd = radius;
    for (const u of this.playerUnits()) {
      const p = this.r.mapToScreen(u.x, u.y, 8);
      const d = Math.hypot(p.x - sx, p.y - sy) / this.r.cam.zoom;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Every player unit of the same type as u that is on screen (double-click / double-tap). */
  selectSameType(u) {
    this.selected.clear();
    for (const x of this.playerUnits()) {
      if (x.type !== u.type) continue;
      const p = this.r.mapToScreen(x.x, x.y, 8);
      if (x === u || (p.x >= 0 && p.y >= 0 && p.x <= this.r.vw && p.y <= this.r.vh)) this.selected.add(x.id);
    }
  }

  /** Order selected units to (x, y) with a ground marker, as a right-click does. */
  moveSelected(x, y, kind = 'move') {
    const units = this.selectedUnits();
    if (!units.length) return false;
    const mv = kind === 'charge' ? units.filter((u) => u.type === 'rifle') : units;
    if (!mv.length) { pushMessage(this.state, 'Only rifle squads can charge', 'warn'); return true; }
    orderMove(this.state, mv, x, y, kind);
    // a third of infantry move orders are answered by marching boots (crunching snow in winter) instead
    // of a voice; charges always get their shout, whistle and battle cry
    if (kind !== 'charge' && mv.some((u) => u.type !== 'artillery') && Math.random() < 0.33) this.sound.play(this.state.season === 'winter' ? 'bootsSnow' : 'boots', 1);
    else this.speak(kind === 'charge' ? 'charge' : 'move', mv);
    this.state.effects.push({ type: 'boom', x, y, age: 0.55, life: 0.7 });
    return true;
  }

  /**
   * Touch: tap = select a unit, or move the selection to the tapped ground; one-finger drag = scroll;
   * pinch / two fingers = zoom and scroll; press and hold then drag = box-select; in Charge / Bombard /
   * build modes a tap (or drag, for building) acts on the map as a left click does.
   */
  bindTouch() {
    const cv = this.r.canvas;
    const HOLD = 420, SLOP = 10;
    let t = null; // gesture state
    const pt = (touch) => { const r = cv.getBoundingClientRect(); return { x: touch.clientX - r.left, y: touch.clientY - r.top }; };
    const pinchInfo = (e) => {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    const startPinch = (e) => {
      clearTimeout(t && t.timer);
      const p = pinchInfo(e);
      this.dragBox = null; this.painting = false;
      t = { pinch: true, d0: p.dist, z0: this.r.cam.zoom, anchor: this.r.screenToWorld(p.mid.x, p.mid.y) };
    };
    cv.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchMode = true;
      this.sound.init();
      if (e.touches.length >= 2) { startPinch(e); return; }
      const p = pt(e.touches[0]);
      const m = this.r.screenToMap(p.x, p.y);
      this.hover = m;
      t = { x0: p.x, y0: p.y, x: p.x, y: p.y, cx: this.r.cam.x, cy: this.r.cam.y, moved: false, box: false, held: false };
      if (this.mode && this.mode.startsWith('build:')) {
        this.lastPainted = null; this.paint(m.x, m.y); this.painting = true; t.build = true;
        return;
      }
      // press and hold (without moving) starts a selection box
      t.timer = setTimeout(() => {
        if (!t || t.moved || t.pinch) return;
        t.held = true; t.box = true;
        this.dragBox = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, shift: false };
        if (navigator.vibrate) navigator.vibrate(15);
      }, HOLD);
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!t) return;
      if (e.touches.length >= 2) {
        if (!t.pinch) startPinch(e);
        const p = pinchInfo(e);
        this.r.cam.zoom = t.z0 * (p.dist / t.d0);
        this.r.clampCam();
        // keep the world point that was under the fingers under their midpoint (zoom + pan together)
        const now = this.r.screenToWorld(p.mid.x, p.mid.y);
        this.r.cam.x += t.anchor.x - now.x; this.r.cam.y += t.anchor.y - now.y;
        this.r.clampCam();
        return;
      }
      if (t.pinch) return; // lifting one finger of a pinch should not start a pan
      const p = pt(e.touches[0]);
      t.x = p.x; t.y = p.y;
      if (Math.hypot(p.x - t.x0, p.y - t.y0) > SLOP) t.moved = true;
      this.hover = this.r.screenToMap(p.x, p.y);
      if (t.build) { this.paint(this.hover.x, this.hover.y); return; }
      if (t.box) { this.dragBox.x1 = p.x; this.dragBox.y1 = p.y; return; }
      if (t.moved) {
        clearTimeout(t.timer);
        this.r.cam.x = t.cx - (p.x - t.x0) / this.r.cam.zoom;
        this.r.cam.y = t.cy - (p.y - t.y0) / this.r.cam.zoom;
        this.r.clampCam();
      }
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      if (!t || e.touches.length > 0) return; // wait until every finger is up
      clearTimeout(t.timer);
      const g = t; t = null;
      this.painting = false;
      this.hover = null;
      if (g.pinch || g.build) return;
      if (g.box) {
        const b = this.dragBox; this.dragBox = null;
        if (Math.abs(b.x1 - b.x0) > 8 || Math.abs(b.y1 - b.y0) > 8) this.selectBox(b, false);
        else { const u = this.unitAt(g.x0, g.y0, 34); if (u) this.selected.add(u.id); } // hold on a unit: add it
        return;
      }
      if (g.moved) return; // it was a scroll
      // a tap
      const m = this.r.screenToMap(g.x0, g.y0);
      if (this.mode === 'bombard') { this.doBombard(m.x, m.y); this.setMode(null); return; }
      if (this.mode === 'charge') { this.doCharge(m.x, m.y); this.setMode(null); return; }
      const u = this.unitAt(g.x0, g.y0, 34);
      if (u) {
        const now = performance.now();
        if (this.lastTap && this.lastTap.id === u.id && now - this.lastTap.t < 400) { this.selectSameType(u); this.lastTap = null; return; }
        this.lastTap = { id: u.id, t: now };
        this.selected.clear(); this.selected.add(u.id); return;
      }
      this.moveSelected(m.x, m.y);
    };
    cv.addEventListener('touchend', end, { passive: false });
    cv.addEventListener('touchcancel', (e) => { if (t) clearTimeout(t.timer); t = null; this.dragBox = null; this.painting = false; e.preventDefault(); }, { passive: false });

    // minimap: tap or drag to move the camera
    const mm = $('minimap');
    const mmTouch = (e) => {
      e.preventDefault();
      const r = mm.getBoundingClientRect(), p = e.touches[0];
      const w = this.r.minimapToWorld((p.clientX - r.left) * (mm.width / mm.clientWidth), (p.clientY - r.top) * (mm.height / mm.clientHeight));
      if (w) { this.r.cam.x = w.x; this.r.cam.y = w.y; this.r.clampCam(); }
    };
    mm.addEventListener('touchstart', mmTouch, { passive: false });
    mm.addEventListener('touchmove', mmTouch, { passive: false });
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const cv = this.r.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    cv.addEventListener('mousemove', () => { this.touchMode = false; }, { once: false, passive: true });
    cv.addEventListener('mouseleave', () => { this.mouse.inside = false; this.hover = null; });

    cv.addEventListener('mousedown', (e) => {
      this.sound.init();
      const m = this.r.screenToMap(e.offsetX, e.offsetY);
      if (e.button === 1) { this.panDrag = { x: e.offsetX, y: e.offsetY, cx: this.r.cam.x, cy: this.r.cam.y }; e.preventDefault(); return; }
      if (e.button === 2) {
        if (this.mode) { this.setMode(null); return; }
        this.moveSelected(m.x, m.y, e.ctrlKey || e.metaKey ? 'charge' : 'move');
        return;
      }
      if (e.button !== 0) return;
      if (this.mode && this.mode.startsWith('build:')) {
        this.lastPainted = null;
        if (e.altKey) { cancelBuild(this.state, PLAYER, m.x, m.y); return; }
        this.paint(m.x, m.y);
        this.painting = true;
        return;
      }
      if (this.mode === 'bombard') { this.doBombard(m.x, m.y); if (!e.shiftKey) this.setMode(null); return; }
      if (this.mode === 'charge') { this.doCharge(m.x, m.y); this.setMode(null); return; }
      this.dragBox = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, shift: e.shiftKey };
    });

    window.addEventListener('mousemove', (e) => {
      const rect = cv.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      this.mouse.x = sx; this.mouse.y = sy;
      this.hover = this.r.screenToMap(sx, sy);
      if (this.panDrag) {
        this.r.cam.x = this.panDrag.cx - (sx - this.panDrag.x) / this.r.cam.zoom;
        this.r.cam.y = this.panDrag.cy - (sy - this.panDrag.y) / this.r.cam.zoom;
        this.r.clampCam();
      }
      if (this.dragBox) { this.dragBox.x1 = sx; this.dragBox.y1 = sy; }
      if (this.painting && this.mode && this.mode.startsWith('build:')) this.paint(this.hover.x, this.hover.y);
    });

    cv.addEventListener('dblclick', (e) => {
      if (this.mode) return;
      const r = cv.getBoundingClientRect();
      const u = this.unitAt(e.clientX - r.left, e.clientY - r.top);
      if (u) this.selectSameType(u);
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.panDrag = null;
      if (e.button !== 0) return;
      this.painting = false;
      if (this.dragBox) {
        const b = this.dragBox;
        if (Math.abs(b.x1 - b.x0) < 5 && Math.abs(b.y1 - b.y0) < 5) this.selectAt(b.x0, b.y0, b.shift);
        else this.selectBox(b, b.shift);
        this.dragBox = null;
      }
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.r.screenToWorld(e.offsetX, e.offsetY);
      this.r.cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.r.clampCam();
      const after = this.r.screenToWorld(e.offsetX, e.offsetY);
      this.r.cam.x += before.x - after.x;
      this.r.cam.y += before.y - after.y;
      this.r.clampCam();
    }, { passive: false });

    const mm = $('minimap');
    const mmJump = (e) => {
      const w = this.r.minimapToWorld(e.offsetX * (mm.width / mm.clientWidth), e.offsetY * (mm.height / mm.clientHeight));
      if (w) { this.r.cam.x = w.x; this.r.cam.y = w.y; this.r.clampCam(); }
    };
    let mmDown = false;
    mm.addEventListener('mousedown', (e) => { mmDown = true; mmJump(e); });
    mm.addEventListener('mousemove', (e) => { if (mmDown) mmJump(e); });
    window.addEventListener('mouseup', () => { mmDown = false; });

    window.addEventListener('keydown', (e) => {
      if (e.repeat && !['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) return;
      this.sound.init();
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'f1' || k === '?') { e.preventDefault(); this.app.toggleHelp(); return; }
      if (!this.app.overlayOpen() || k === 'p') {
        switch (k) {
          case 'p': this.app.togglePause(); break;
          case 'escape': if (this.mode) this.setMode(null); else this.selected.clear(); break;
          case 'c': if (this.selectedUnits().some((u) => u.type === 'rifle')) this.setMode('charge'); else pushMessage(this.state, 'Select rifle squads to charge', 'warn'); break;
          case 'b': this.setMode('bombard'); break;
          case 't': this.setMode('build:trench'); break;
          case 'u': this.setMode('build:upgrade'); break;
          case 'x': this.setMode('build:wire'); break;
          case 'h': this.halt(); break;
          case 'q': this.selected = new Set(this.playerUnits().filter((u) => u.type === 'rifle').map((u) => u.id)); break;
          case '1': this.doRecruit('rifle'); break;
          case '2': this.doRecruit('mg'); break;
          case '3': this.doRecruit('artillery'); break;
          case ' ': e.preventDefault(); this.centerOnFront(); break;
        }
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindButtons() {
    document.querySelectorAll('[data-recruit]').forEach((b) => b.addEventListener('click', () => this.doRecruit(b.dataset.recruit)));
    document.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => {
      const m = 'build:' + b.dataset.build;
      this.setMode(this.mode === m ? null : m);
    }));
    document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
      const c = b.dataset.cmd;
      if (c === 'halt') this.halt();
      else if (c === 'deselect') { this.setMode(null); this.selected.clear(); }
      else if (c === 'allinf') this.selected = new Set(this.playerUnits().filter((u) => u.type === 'rifle').map((u) => u.id));
      else this.setMode(this.mode === c ? null : c);
    }));
    for (const [type, t] of Object.entries(UNIT_TYPES)) {
      const b = document.querySelector(`[data-recruit="${type}"]`);
      b.title = t.desc;
      b.querySelector('small').textContent = costText(t.cost);
    }
    for (const [type, t] of Object.entries(BUILD)) {
      const b = document.querySelector(`[data-build="${type}"]`);
      b.title = t.desc;
      b.querySelector('small').textContent = `${t.supplies} supplies / tile`;
    }
  }

  // ------------------------------------------------------------ per frame

  update(dt) {
    // camera scrolling
    const sp = 700 * dt / this.r.cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= sp;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += sp;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= sp;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += sp;
    if (this.mouse.inside && !this.touchMode && !this.dragBox && !this.panDrag && !this.app.overlayOpen()) {
      // edge-scroll band: wider on big screens (24 px up to 64 px)
      const m = Math.max(24, Math.min(64, Math.max(this.r.vw, this.r.vh) * 0.035));
      if (this.mouse.x < m) dx -= sp;
      if (this.mouse.x > this.r.vw - m) dx += sp;
      if (this.mouse.y < m) dy -= sp;
      if (this.mouse.y > this.r.vh - m) dy += sp;
    }
    if (dx || dy) { this.r.cam.x += dx; this.r.cam.y += dy; this.r.clampCam(); }
    if (this.mouse.inside && (dx || dy)) this.hover = this.r.screenToMap(this.mouse.x, this.mouse.y);

    // prune dead selections
    for (const id of this.selected) if (!this.state.units.some((u) => u.id === id)) this.selected.delete(id);
    // newly selected units answer (whichever way they were selected: click, tap, box, keys, buttons)
    const added = [...this.selected].filter((id) => !this.prevSel.has(id));
    if (added.length) this.speak('select', added.map((id) => this.state.units.find((u) => u.id === id)).filter(Boolean));
    this.prevSel = new Set(this.selected);
    // a squad coming under fire in the open calls out (only when it is on screen)
    if (this.voices) {
      this.prevPinned = this.prevPinned || new Set();
      for (const u of this.playerUnits()) {
        if (u.pinned && !this.prevPinned.has(u.id)) {
          const p = this.r.mapToScreen(u.x, u.y, 8);
          if (p.x > 0 && p.y > 0 && p.x < this.r.vw && p.y < this.r.vh) this.voices.bark(u, this.state.nations[PLAYER], 'pinned');
        }
      }
      this.prevPinned = new Set(this.playerUnits().filter((u) => u.pinned).map((u) => u.id));
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.15; this.updateHud(); }
  }

  updateHud() {
    const s = this.state;
    const res = s.resources[PLAYER];
    $('res-men').textContent = fmt(res.men);
    $('res-ammo').textContent = fmt(res.ammo);
    $('res-supplies').textContent = fmt(res.supplies);
    $('supply-timer').textContent = Math.ceil(s.supplyTimer) + 's';
    const terr = territory(s, PLAYER);
    $('territory').textContent = terr.captured;
    $('casualties').textContent = `${s.stats.lost[0]} : ${s.stats.lost[1]}`;

    const threatened = hqThreatened(s, PLAYER);
    for (const [type, t] of Object.entries(UNIT_TYPES)) {
      const b = document.querySelector(`[data-recruit="${type}"]`);
      b.disabled = threatened || !(res.men >= t.cost.men && res.ammo >= t.cost.ammo && res.supplies >= t.cost.supplies);
      b.title = threatened ? 'Enemy troops are at our HQ: no new units can be raised until they are driven off' : t.desc;
    }
    for (const [type, t] of Object.entries(BUILD)) {
      document.querySelector(`[data-build="${type}"]`).disabled = res.supplies < t.supplies;
    }
    const rifleImg = document.querySelector('[data-recruit="rifle"] img');
    const por = this.r.portraitOf && s.nations ? this.r.portraitOf(s.nations[PLAYER]) : '';
    if (por && rifleImg.getAttribute('src') !== por) rifleImg.setAttribute('src', por);

    // orders: only those the selected units can carry out
    const chosen = this.selectedUnits();
    const has = (type) => chosen.some((u) => u.type === type);
    const show = {
      charge: has('rifle'),
      bombard: has('artillery') || (!chosen.length && this.playerUnits().some((u) => u.type === 'artillery')),
      halt: chosen.length > 0,
      allinf: true,
      deselect: chosen.length > 0 || !!this.mode,
    };
    for (const [cmd, on] of Object.entries(show)) document.querySelector(`[data-cmd="${cmd}"]`).classList.toggle('hidden', !on);
    if (this.mode === 'charge' && !show.charge) this.setMode(null);

    // messages
    const box = $('messages');
    const recent = s.messages.filter((m) => s.time - m.time < 9).slice(-6);
    box.innerHTML = '';
    for (const m of recent) {
      const d = document.createElement('div');
      d.className = m.kind;
      d.textContent = m.text;
      d.style.opacity = Math.min(1, (9 - (s.time - m.time)) / 2);
      box.appendChild(d);
    }

    // selection panel
    const sel = this.selectedUnits();
    const info = $('selection-info');
    if (!sel.length) {
      info.innerHTML = this.touchMode || matchMedia('(pointer: coarse)').matches
        ? '<div class="muted">Tap a unit to select it, then tap the ground to move. Hold and drag to select a group. ? for help.</div>'
        : '<div class="muted">No units selected. Left-drag to select, right-click to move. Press <kbd>?</kbd> for help.</div>';
    } else {
      const men = sel.reduce((a, u) => a + u.men, 0);
      const parts = [`<div class="sel-summary">${sel.length} unit${sel.length > 1 ? 's' : ''}, ${men} men</div>`];
      for (const u of sel.slice(0, 12)) {
        const t = UNIT_TYPES[u.type];
        let status = u.pinned ? 'PINNED' : u.order ? (u.order.kind === 'charge' ? 'charging' : 'moving') : u.barrage ? 'firing barrage' : u.digging ? 'digging' : u.inTrench ? 'in trench' : 'in the open';
        if (u.type === 'artillery' && u.cooldown > 0 && !u.barrage) status = `reloading ${Math.ceil(u.cooldown)}s`;
        if (u.type === 'mg' && u.setup > 0 && !u.order) status = 'setting up';
        // MG teams and batteries show their weapon, rifle squads a soldier of the army
        const por = u.type === 'mg' || u.type === 'artillery' ? `<img class="portrait equip" src="assets/art/card-${u.type}.webp" alt="">`
          : this.r.portraitOf && s.nations ? `<img class="portrait" src="${this.r.portraitOf(s.nations[PLAYER])}" alt="">` : '';
        parts.push(`<div class="ucard">${por}<div class="ubody"><div class="n">${t.name}</div><div>${u.men}/${t.men} men</div><div class="st">${status}</div>
          <div class="bar" title="Strength"><i style="width:${(100 * u.hp) / (t.men * t.hpPerMan)}%"></i></div>
          <div class="bar sup" title="Suppression"><i style="width:${u.suppression}%"></i></div></div></div>`);
      }
      if (sel.length > 12) parts.push(`<div class="muted">+${sel.length - 12} more</div>`);
      info.innerHTML = parts.join('');
    }
  }
}

function costText(c) {
  const p = [];
  if (c.men) p.push(`${c.men} men`);
  if (c.ammo) p.push(`${c.ammo} ammo`);
  if (c.supplies) p.push(`${c.supplies} sup`);
  return p.join(' · ');
}

export { MAP_W };
