// Sound effects via WebAudio: recorded artillery samples (assets/sfx) plus procedural fallbacks.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = {};
    this.master = null;
    this.samples = {}; // type -> [AudioBuffer]
    this.voices = {}; // type -> currently playing count
    this.active = {}; // type -> [{ src, g }] oldest first
  }

  /** Recorded sound effects (assets/sfx), decoded once audio is unlocked. */
  loadSamples() {
    if (this.sampleLoad || !this.ctx) return;
    const SETS = { artyfire: ['fire'], boom: ['shell-1', 'shell-2', 'shell-3', 'shell-4'], rifle: ['rifle-1', 'rifle-2', 'rifle-3', 'rifle-4', 'rifle-5'] };
    this.sampleLoad = Promise.all(Object.entries(SETS).map(([type, names]) => Promise.all(names.map((n) =>
      fetch(`assets/sfx/${n}.mp3`).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)).catch(() => null)))
      .then((bufs) => { const ok = bufs.filter(Boolean); if (ok.length) this.samples[type] = ok; })));
  }

  playSample(type, vol) {
    const bufs = this.samples[type];
    if (!bufs) return false;
    const MAX = { boom: 8, artyfire: 4, rifle: 6 }[type] || 4; // cap overlapping long tails in a heavy barrage
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
    g.gain.value = vol * ({ boom: 0.9, artyfire: 0.75, rifle: 0.5 }[type] || 0.7);
    src.connect(g); g.connect(this.master);
    const voice = { src, g };
    act.push(voice);
    this.voices[type] = act.length;
    src.onended = () => { const i = act.indexOf(voice); if (i >= 0) act.splice(i, 1); this.voices[type] = act.length; };
    src.start();
    return true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
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

  play(type, vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.02) return;
    const now = performance.now();
    const gap = { boom: 60, artyfire: 90, mg: 110, rifle: 70, supply: 500 }[type] || 80;
    if (now - (this.last[type] || 0) < gap) return;
    this.last[type] = now;
    if (this.playSample(type, vol)) return;
    switch (type) {
      case 'boom':
        this.burst({ dur: 1.1, freq: 260, vol: 0.9 * vol });
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
