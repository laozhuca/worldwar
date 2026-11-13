// Sound effects via WebAudio: recorded artillery samples (assets/sfx) plus procedural fallbacks.
const MUSIC_LEVEL = 0.32; // relative to the effects (which sit at 0.5-0.9)

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = {};
    this.master = null;
    this.samples = {}; // type -> [AudioBuffer]
    this.voices = {}; // type -> currently playing count
    this.active = {}; // type -> [{ src, g }] oldest first
    this.guns = new Map(); // MG unit id -> { src, g, last } sustained burst
    this.musicOn = (() => { try { return localStorage.getItem('ww-music') !== 'off'; } catch { return true; } })();
  }

  /** Recorded sound effects (assets/sfx), decoded once audio is unlocked. */
  loadSamples() {
    if (this.sampleLoad || !this.ctx) return;
    const SETS = { artyfire: ['fire'], boom: ['shell-2', 'shell-3', 'shell-4'], rifle: ['rifle-1', 'rifle-2', 'rifle-3', 'rifle-4', 'rifle-5'], mg: ['mg-1', 'mg-2', 'mg-3', 'mg-4'], whistle: ['whistle'], cry: ['battle-cry'], death: ['death-1', 'death-2', 'death-3', 'death-4'], boots: ['boots'], bootsSnow: ['boots-snow'], trumpet: ['trumpet'], incoming: ['whistle-in-1', 'whistle-in-2'], duck: ['duck-1', 'duck-2', 'bird-1', 'bird-2'] }; // a lull: a duck or a bird
    this.sampleLoad = Promise.all(Object.entries(SETS).map(([type, names]) => Promise.all(names.map((n) =>
      fetch(`assets/sfx/${n}.mp3`).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)).catch(() => null)))
      .then((bufs) => { const ok = bufs.filter(Boolean); if (ok.length) this.samples[type] = ok; })));
  }

  /** Going over the top: the officer's whistle and the men's battle cry (under the charge voice line). */
  charge() {
    this.play('whistle', 1);
    this.play('cry', 1, undefined, 1.5); // the men roar 1.5 s after the whistle blows
  }

  playSample(type, vol, delay = 0) {
    const bufs = this.samples[type];
    if (!bufs) return false;
    const MAX = { boom: 8, artyfire: 4, rifle: 6, death: 3, incoming: 3 }[type] || 4; // cap overlapping long tails in a heavy barrage
    const c = this.ctx, act = (this.active[type] ||= []);
    // a new impact always plays; at the cap the oldest tail fades out over 0.4 s to make room
    if (act.length >= MAX) {
      const old = act.shift();
      old.g.gain.setTargetAtTime(0, c.currentTime, 0.12);
      old.src.stop(c.currentTime + 0.5);
    }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    src.playbackRate.value = 0.92 + Math.random() * 0.14; // slight pitch variety
    // shell bursts are heard from far off: louder, and they fade less with distance
    if (type === 'boom') vol = Math.sqrt(vol);
    g.gain.value = vol * ({ boom: 1.9, artyfire: 0.75, rifle: 0.5, whistle: 0.8, cry: 0.9, death: 0.75, boots: 0.6, bootsSnow: 0.6, trumpet: 0.8, incoming: 0.6, duck: 0.55 }[type] || 0.7);
    src.connect(g); g.connect(this.master);
    const voice = { src, g };
    act.push(voice);
    this.voices[type] = act.length;
    src.onended = () => { const i = act.indexOf(voice); if (i >= 0) act.splice(i, 1); this.voices[type] = act.length; };
    src.start(c.currentTime + delay);
    return true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      // a gentle limiter, so a heavy barrage stacking several loud bursts doesn't clip
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loadSamples();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  burst({ dur, freq, type = 'lowpass', vol, q = 0.7, delay = 0 }) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 0.5, dur + 0.05);
  }

  /**
   * Machine guns: one continuous recording per firing gun. It keeps playing while the gun keeps firing,
   * a new one starts if it runs out, and it is cut with a short fade once the gun falls silent.
   */
  playGun(id, vol) {
    const bufs = this.samples.mg, c = this.ctx;
    const now = c.currentTime, cur = this.guns.get(id);
    if (cur && !cur.ended) { cur.last = now; cur.g.gain.setTargetAtTime(vol * 0.6, now, 0.1); return; }
    if (this.guns.size >= 4 && !cur) return; // at most four guns heard at once
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    g.gain.value = vol * 0.6;
    src.connect(g); g.connect(this.master);
    const voice = { src, g, last: now, ended: false };
    src.onended = () => { voice.ended = true; if (this.guns.get(id) === voice) this.guns.delete(id); };
    this.guns.set(id, voice);
    src.start();
  }

  // ------------------------------------------------------------ background music
  /** Streamed through an <audio> element (no up-front decode), mixed under the effects. */
  startMusic() {
    if (!this.ctx || this.music) return;
    const el = new Audio('assets/music/ombra-di-guerra.mp3');
    el.preload = 'auto';
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(g);
    g.connect(this.master);
    this.music = { el, g, fading: false };
    if (this.musicOn) this.playMusic();
  }
  playMusic() {
    const m = this.music;
    if (!m || this.sting) return; // the victory / defeat music has the stage
    m.el.play().catch(() => {});
    m.g.gain.cancelScheduledValues(this.ctx.currentTime);
    m.g.gain.setTargetAtTime(MUSIC_LEVEL, this.ctx.currentTime, 1.2); // gentle fade in
  }
  setMusic(on) {
    this.musicOn = on;
    try { localStorage.setItem('ww-music', on ? 'on' : 'off'); } catch {}
    const m = this.music;
    if (!m) return;
    if (this.sting) { if (on) this.sting.el.play().catch(() => {}); else this.sting.el.pause(); return; }
    if (on) this.playMusic();
    else { m.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); setTimeout(() => { if (!this.musicOn) m.el.pause(); }, 1500); }
  }

  /**
   * The end of a battle: the battle music fades away and the victory or defeat music (28 s, faded out at
   * the end) plays once. stopEnding() fades it and brings the battle music back.
   */
  playEnding(kind) {
    if (!this.ctx) return;
    this.stopEnding(true);
    const m = this.music;
    if (m) { m.g.gain.cancelScheduledValues(this.ctx.currentTime); m.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => { if (this.sting) m.el.pause(); }, 2000); }
    const el = new Audio(`assets/music/${kind}.mp3`);
    const g = this.ctx.createGain();
    g.gain.value = 0.55;
    this.ctx.createMediaElementSource(el).connect(g);
    g.connect(this.master);
    this.sting = { el, g };
    if (this.musicOn) setTimeout(() => { if (this.sting && this.sting.el === el) el.play().catch(() => {}); }, 600);
  }
  stopEnding(quiet = false) {
    const s = this.sting;
    if (!s) return;
    this.sting = null;
    s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    setTimeout(() => { s.el.pause(); s.g.disconnect(); }, 1200);
    if (!quiet && this.musicOn) this.playMusic();
  }
  /** The track ends mid-phrase, so fade the last 3 s out and fade back in from the top. */
  tickMusic() {
    const m = this.music;
    if (!m || this.sting || !this.musicOn || m.el.paused || !m.el.duration) return;
    const left = m.el.duration - m.el.currentTime;
    if (left < 3 && !m.fading) { m.fading = true; m.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8); }
    if (m.fading && (left < 0.15 || m.el.ended)) {
      m.fading = false;
      m.el.currentTime = 0;
      this.playMusic();
    }
  }

  /** Per-frame: silence guns that have stopped firing (or everything while paused). */
  tick(paused) {
    if (!this.ctx) return;
    this.tickMusic();
    const now = this.ctx.currentTime;
    for (const [id, v] of this.guns) {
      if (paused || now - v.last > 0.8) {
        v.g.gain.setTargetAtTime(0, now, 0.05);
        v.src.stop(now + 0.15);
        this.guns.delete(id);
      }
    }
  }

  play(type, vol = 1, id, delay = 0) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    if (type === 'mg' && this.samples.mg && id !== undefined) { this.playGun(id, vol); return; }
    const now = performance.now();
    const gap = { boom: 60, artyfire: 90, mg: 110, rifle: 70, supply: 500, whistle: 2500, cry: 2500, death: 250, boots: 3000, bootsSnow: 3000, incoming: 300 }[type] || 80;
    if (now - (this.last[type] || 0) < gap) return;
    this.last[type] = now;
    if (this.playSample(type, vol, delay)) return;
    switch (type) {
      case 'boom':
        this.burst({ dur: 1.1, freq: 260, vol: 1.6 * vol });
        this.burst({ dur: 0.25, freq: 1400, vol: 0.35 * vol });
        break;
      case 'artyfire':
        this.burst({ dur: 0.5, freq: 500, vol: 0.5 * vol });
        break;
      case 'mg':
        for (let i = 0; i < 4; i++) this.burst({ dur: 0.05, freq: 1800, type: 'bandpass', q: 1.2, vol: 0.35 * vol, delay: i * 0.07 });
        break;
      case 'rifle':
        this.burst({ dur: 0.12, freq: 2200, type: 'bandpass', q: 0.9, vol: 0.3 * vol });
        break;
      case 'supply': {
        const c = this.ctx, t0 = c.currentTime;
        for (const [i, fr] of [[0, 523], [1, 659], [2, 784]]) {
          const o = c.createOscillator(); const g = c.createGain();
          o.type = 'square'; o.frequency.value = fr;
          g.gain.setValueAtTime(0.0001, t0 + i * 0.12);
          g.gain.exponentialRampToValueAtTime(0.05, t0 + i * 0.12 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.2);
          o.connect(g); g.connect(this.master); o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.25);
        }
        break;
      }
    }
  }
}
