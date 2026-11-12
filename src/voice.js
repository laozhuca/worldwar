// Soldier voice lines ("barks") when the player selects or commands units, spoken with the browser's
// speech synthesis in each army's own language, plus a speech bubble over the unit.
// Recorded voices (assets/voice, built by scripts/process-voices.mjs) are used when available.
// Otherwise only male synthesized voices are used; without a male voice for the language a male English voice speaks the English line.

export const LINES = {
  uk: { lang: 'en-GB',
    select: ['Sir?', 'Ready, sir.', 'Awaiting orders.', 'Yes, sir?'],
    move: ['Moving up.', 'Right away, sir.', 'On our way.', 'Very good, sir.'],
    charge: ['Over the top, lads!', 'Fix bayonets! Charge!', 'Come on, lads!'],
    bombard: ['Fire!', 'Range set. Fire!', 'Battery, fire!'],
    select_rifle: ['Rifles ready, sir.', 'Section present.', 'Bayonets fixed, sir.'],
    select_mg: ['Vickers team ready.', 'Gun\'s loaded, sir.', 'Belt in, sir.'],
    select_artillery: ['Battery standing by.', 'Guns laid, sir.', 'Awaiting a target.'],
    recruit: ['Reporting for duty!', 'Fresh from the depot, sir.'],
    pinned: ['We\'re pinned!', 'Get down!', 'Keep your heads down!'],
    halt: ['Halt!', 'Hold here!'] },
  usa: { lang: 'en-US',
    select: ['Yes, sir?', 'Ready.', 'Sir?', 'Standing by.'],
    move: ['Moving out.', 'You got it.', 'On the way, sir.'],
    charge: ['Let\'s go, boys!', 'Fix bayonets! Forward!', 'Charge!'],
    bombard: ['Fire!', 'Fire for effect!'],
    select_rifle: ['Riflemen ready.', 'Squad\'s here, sir.'],
    select_mg: ['Machine gun ready.', 'Gun\'s loaded, sir.'],
    select_artillery: ['Battery standing by.', 'Give us a target.'],
    recruit: ['Reporting for duty, sir!', 'Ready to go, sir!'],
    pinned: ['We\'re pinned down!', 'Hit the dirt!'],
    halt: ['Halt!', 'Hold up!'] },
  france: { lang: 'fr-FR',
    select: ['Oui, mon lieutenant ?', 'À vos ordres.', 'Prêts.'],
    move: ['On y va !', 'En avant.', 'Compris.'],
    charge: ['En avant ! À la baïonnette !', 'Chargez !'],
    bombard: ['Feu !', 'Batterie, feu !'],
    select_rifle: ['Section prête.', 'Les poilus sont là.'],
    select_mg: ['Mitrailleuse prête.', 'Hotchkiss en batterie.'],
    select_artillery: ['Batterie prête.', 'Les 75 sont pointés.'],
    recruit: ['Présents !', 'Renforts arrivés !'],
    pinned: ['On est cloués !', 'À terre !'],
    halt: ['Halte !'] },
  italy: { lang: 'it-IT',
    select: ['Signorsì?', 'Pronti.', 'Agli ordini.'],
    move: ['Avanti!', 'Agli ordini!', 'Andiamo.'],
    charge: ['Savoia! All\'attacco!', 'Avanti, alla baionetta!'],
    bombard: ['Fuoco!', 'Batteria, fuoco!'],
    select_rifle: ['Fanti pronti.', 'Squadra pronta.'],
    select_mg: ['Mitragliatrice pronta.', 'Arma carica.'],
    select_artillery: ['Batteria pronta.', 'Pezzi puntati.'],
    recruit: ['Presente!', 'Rinforzi arrivati!'],
    pinned: ['Siamo inchiodati!', 'A terra!'],
    halt: ['Alt!'] },
  russia: { lang: 'ru-RU',
    select: ['Слушаю!', 'Готовы.', 'Так точно?'],
    move: ['Вперёд!', 'Есть!', 'Выполняем.'],
    charge: ['Ура! В атаку!', 'В штыки! Ура!'],
    bombard: ['Огонь!', 'Батарея, огонь!'],
    select_rifle: ['Стрелки готовы.', 'Отделение на месте.'],
    select_mg: ['Пулемёт готов.', 'Максим заряжен.'],
    select_artillery: ['Батарея готова.', 'Орудия наведены.'],
    recruit: ['Прибыли!', 'Пополнение прибыло!'],
    pinned: ['Прижали!', 'Ложись!'],
    halt: ['Стой!'] },
  germany: { lang: 'de-DE',
    select: ['Jawohl?', 'Bereit.', 'Zu Befehl?'],
    move: ['Vorwärts!', 'Wird gemacht.', 'Jawohl!'],
    charge: ['Sturm! Hurra!', 'Seitengewehr pflanzt auf! Angriff!'],
    bombard: ['Feuer!', 'Batterie, Feuer!'],
    select_rifle: ['Gruppe bereit.', 'Schützen zur Stelle.'],
    select_mg: ['MG bereit.', 'MG geladen.'],
    select_artillery: ['Batterie bereit.', 'Geschütze gerichtet.'],
    recruit: ['Zur Stelle!', 'Ersatz eingetroffen!'],
    pinned: ['Wir sind festgenagelt!', 'Volle Deckung!'],
    halt: ['Halt!'] },
  austria: { lang: 'de-AT',
    select: ['Jawohl, Herr Leutnant?', 'Bereit.', 'Zu Befehl?'],
    move: ['Vorwärts!', 'Wird gemacht.', 'Jawohl!'],
    charge: ['Hurra! Vorwärts!', 'Zum Angriff, hurra!'],
    bombard: ['Feuer!', 'Batterie, Feuer!'],
    select_rifle: ['Schwarm bereit.', 'Schützen zur Stelle.'],
    select_mg: ['Maschinengewehr bereit.', 'Schwarzlose geladen.'],
    select_artillery: ['Batterie bereit.', 'Geschütze gerichtet.'],
    recruit: ['Melde gehorsamst: zur Stelle!', 'Ersatz eingetroffen!'],
    pinned: ['Wir kommen nicht weiter!', 'Deckung!'],
    halt: ['Halt!'] },
  ottoman: { lang: 'tr-TR',
    select: ['Emredersiniz!', 'Hazırız.', 'Buyurun komutanım?'],
    move: ['İleri!', 'Baş üstüne!', 'Emredersiniz.'],
    charge: ['Allah Allah! Hücum!', 'Süngü tak! Hücum!'],
    bombard: ['Ateş!', 'Batarya, ateş!'],
    select_rifle: ['Piyadeler hazır.', 'Manga hazır.'],
    select_mg: ['Makineli hazır.', 'Makineli dolu.'],
    select_artillery: ['Batarya hazır.', 'Toplar nişanda.'],
    recruit: ['Emrinizdeyiz!', 'Takviye geldi!'],
    pinned: ['Kıpırdayamıyoruz!', 'Yere yat!'],
    halt: ['Dur!'] },
};
// English versions, used when the device has no voice for the army's language
const ENGLISH = {
  select: ['Yes, sir?', 'Ready.', 'Awaiting orders.'],
  move: ['Moving up.', 'Right away.', 'On our way.'],
  charge: ['Charge!', 'Fix bayonets! Forward!'],
  bombard: ['Fire!', 'Battery, fire!'],
  halt: ['Halt!'],
  select_rifle: ['Rifles ready.', 'Squad ready.'],
  select_mg: ['Machine gun ready.', 'Gun loaded.'],
  select_artillery: ['Battery standing by.', 'Guns laid.'],
  recruit: ['Reporting for duty!'],
  pinned: ['We\'re pinned!', 'Get down!'],
};
/** Lines for a kind of bark; a selected unit mixes the general replies with its own type's. */
const pick = (L, kind, unit) => {
  const base = L[kind] || [];
  return kind === 'select' ? base.concat(L['select_' + unit.type] || []) : base;
};

// Speech synthesis does not report a voice's sex, so male voices are recognised by name: "Male" in the
// name, or a known male voice of Windows / Edge (Microsoft ...), macOS / iOS or Chrome. Voices that are not
// known to be male are never used: soldiers then only show their speech bubble.
const MALE_NAMES = new Set([
  // Windows desktop and Edge "Online (Natural)" voices
  'david', 'mark', 'george', 'james', 'richard', 'sean', 'guy', 'ryan', 'thomas', 'christopher', 'eric', 'roger',
  'steffan', 'brandon', 'andrew', 'brian', 'davis', 'jason', 'tony', 'alfie', 'elliot', 'ethan', 'noah', 'william',
  'liam', 'connor', 'mitchell', 'prabhat', 'paul', 'claude', 'henri', 'alain', 'jerome', 'yves', 'remy', 'antoine',
  'jean', 'fabrice', 'gerard', 'florian', 'stefan', 'michael', 'conrad', 'killian', 'jonas', 'ralf', 'bernd', 'christoph',
  'kasper', 'klaus', 'cosimo', 'diego', 'giuseppe', 'benigno', 'gianni', 'lisandro', 'rinaldo', 'calimero', 'pavel',
  'dmitry', 'tolga', 'ahmet',
  // macOS / iOS
  'daniel', 'alex', 'fred', 'arthur', 'oliver', 'aaron', 'gordon', 'rishi', 'nicolas', 'jacques', 'markus', 'yannick',
  'luca', 'yuri', 'reed', 'rocko', 'eddy', 'grandpa', 'ralph', 'albert', 'bruce', 'junior', 'evan', 'nathan', 'tom',
  'malcolm', 'lee', 'oskar', 'martin',
]);
export const isMale = (v) => {
  const n = (v.name || '').toLowerCase();
  if (/\bfemale\b|\bwoman\b|\bfrau\b/.test(n)) return false;
  if (/\bmale\b|\bman\b|männlich|masculin/.test(n)) return true;
  const words = n.replace(/^(microsoft|apple|google)\s+/, '').split(/[^a-zäöüéèçğış]+/).filter(Boolean);
  return words.length > 0 && MALE_NAMES.has(words[0]);
};

export class Voices {
  constructor() {
    this.on = (() => { try { return localStorage.getItem('ww-voice') !== 'off'; } catch { return true; } })();
    this.enabled = true; // the master sound switch
    this.synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    this.voices = [];
    this.last = 0;
    this.lastPinned = -1e9;
    this.barks = []; // { id, text, t } speech bubbles for the renderer
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices(); };
      load();
      if (this.synth.addEventListener) this.synth.addEventListener('voiceschanged', load);
      // iOS / Safari only allow speech after speech started inside a user gesture: unlock it on the first touch or key
      const unlock = () => {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; this.synth.speak(u); } catch {}
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
    }
  }

  setOn(on) {
    this.on = on;
    try { localStorage.setItem('ww-voice', on ? 'on' : 'off'); } catch {}
    if (!on && this.synth) this.synth.cancel();
    if (!on) this.stopClip();
  }

  /** A male voice for a language ('de-AT' falls back to any German male voice), or null. */
  voiceFor(lang) {
    const v = this.voices.filter(isMale);
    const norm = (x) => (x.lang || '').replace('_', '-').toLowerCase();
    return v.find((x) => norm(x) === lang.toLowerCase())
      || v.find((x) => norm(x).startsWith(lang.slice(0, 2).toLowerCase() + '-') || norm(x) === lang.slice(0, 2).toLowerCase()) || null;
  }

  /**
   * A unit answers. kind: select | move | charge | bombard | halt | recruit | pinned. The newest line interrupts the previous
   * one (a commander only listens to the latest reply), with a short gap so rapid clicks don't stutter.
   */
  bark(unit, nation, kind) {
    const N = LINES[nation] || LINES.uk;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (kind === 'select' && now - this.last < 700) return null; // orders always get an answer
    // unprompted lines (pinned) never talk over a reply, and are rare
    if (kind === 'pinned' && (this.talking(now) || now - this.lastPinned < 8000 || now - this.last < 1500)) return null;
    const time = now / 1000;
    if (kind === 'pinned') this.lastPinned = now; else this.last = now;
    // recorded voices first (assets/voice)
    const clips = this.clipsFor(nation, kind, unit);
    if (clips.length) {
      const c = clips[Math.floor(Math.random() * clips.length)];
      this.show(unit, c.text, time);
      if (this.on && this.enabled) this.playClip(c.buf, unit);
      return c.text;
    }
    // speech synthesis: a male voice in the army's language; failing that a male English voice speaking the
    // English line; failing that, silence (never a female voice): the bubble still shows the words
    let voice = this.synth ? this.voiceFor(N.lang) : null;
    const native = !this.synth || !!voice;
    if (!voice && this.synth) voice = this.voiceFor('en-GB') || this.voiceFor('en-US');
    const own = pick(N, kind, unit), eng = pick(ENGLISH, kind, unit);
    const pool = native ? own : eng;
    if (!pool.length) return null;
    const i = Math.floor(Math.random() * pool.length);
    const text = pool[i];
    // the bubble always shows the army's own words
    this.show(unit, native ? text : own[Math.min(i, own.length - 1)] || text, time);
    if (this.synth && voice && this.on && this.enabled) {
      this.stopClip();
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      // each unit has its own voice: pitch and pace from its seed; commands are shouted a bit faster
      const s = unit.seed || 0.5;
      u.pitch = 0.7 + s * 0.3; // kept low: men's voices
      u.rate = (kind === 'charge' || kind === 'pinned' ? 1.15 : kind === 'select' ? 1.0 : 1.08) + (s - 0.5) * 0.12;
      u.volume = 0.9;
      this.synth.speak(u);
    }
    return text;
  }

  show(unit, text, time) {
    this.barks = this.barks.filter((b) => b.id !== unit.id);
    this.barks.push({ id: unit.id, text, t: time });
  }

  talking(now) {
    return (this.synth && this.synth.speaking) || (this.clip && now < this.clip.end);
  }

  // ------------------------------------------------------------ recorded voices

  /** Load the recording list; the clips of an army are decoded when it is first played (see prepare). */
  loadRecordings(url = 'assets/voice/manifest.json') {
    this.recordings = null;
    this.decoded = {}; // file -> AudioBuffer | Promise
    return fetch(url).then((r) => r.json()).then((m) => { this.recordings = m; this.prepare(); }).catch(() => {});
  }

  /** Decode the recordings of the player's army (needs the audio context, which a first click creates). */
  prepare(nation = this.nation) {
    this.nation = nation;
    const ctx = this.sound && this.sound.ctx;
    if (!ctx || !this.recordings || !nation || !this.recordings[nation]) return;
    for (const list of Object.values(this.recordings[nation])) {
      for (const c of list) {
        if (this.decoded[c.file]) continue;
        this.decoded[c.file] = fetch('assets/voice/' + c.file).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a))
          .then((b) => { this.decoded[c.file] = b; }).catch(() => { delete this.decoded[c.file]; });
      }
    }
  }

  /** Decoded recordings for this kind of line; a selected unit mixes general and unit-type replies. */
  clipsFor(nation, kind, unit) {
    const R = this.recordings && this.recordings[nation];
    if (!R) return [];
    if (nation !== this.nation || !this.sound || !this.sound.ctx) this.prepare(nation);
    const list = kind === 'select' ? (R.select || []).concat(R['select_' + unit.type] || []) : (R[kind] || []);
    return list.map((c) => ({ text: c.text, buf: this.decoded[c.file] })).filter((c) => c.buf instanceof AudioBuffer);
  }

  /**
   * A soldier of this army answers (the nation picker on the New game screen): one of its recorded
   * select lines, decoded on demand. Needs the audio context (call after a click).
   */
  async speakFor(nation) {
    const R = this.recordings && this.recordings[nation], ctx = this.sound && this.sound.ctx;
    if (!R || !ctx || !this.on || !this.enabled) return;
    const list = (R.select || []).concat(R.select_rifle || []);
    if (!list.length) return;
    const c = list[Math.floor(Math.random() * list.length)];
    let buf = this.decoded[c.file];
    if (!buf) {
      buf = this.decoded[c.file] = fetch('assets/voice/' + c.file).then((r) => r.arrayBuffer()).then((a) => ctx.decodeAudioData(a))
        .then((b) => { this.decoded[c.file] = b; return b; }).catch(() => { delete this.decoded[c.file]; return null; });
    }
    buf = await buf;
    if (buf instanceof AudioBuffer) this.playClip(buf, { seed: Math.random() });
  }

  playClip(buf, unit) {
    const S = this.sound, c = S && S.ctx;
    if (!c) return;
    this.stopClip();
    if (this.synth) this.synth.cancel();
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    // the same recording sounds a little different from squad to squad
    src.playbackRate.value = 0.96 + (unit.seed || 0.5) * 0.08;
    g.gain.value = 1.1;
    src.connect(g); g.connect(S.master);
    src.start();
    this.clip = { src, g, end: performance.now() + (buf.duration / src.playbackRate.value) * 1000 };
  }

  stopClip() {
    if (!this.clip) return;
    const c = this.sound.ctx, { src, g } = this.clip;
    g.gain.setTargetAtTime(0, c.currentTime, 0.03);
    try { src.stop(c.currentTime + 0.12); } catch {}
    this.clip = null;
  }
}
