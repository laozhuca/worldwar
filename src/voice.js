// Soldier voice lines ("barks") when the player selects or commands units, spoken with the browser's
// speech synthesis in each army's own language, plus a speech bubble over the unit.
// Falls back to the English line when the device has no voice for that language.

const LINES = {
  uk: { lang: 'en-GB',
    select: ['Sir?', 'Ready, sir.', 'Awaiting orders.', 'Yes, sir?'],
    move: ['Moving up.', 'Right away, sir.', 'On our way.', 'Very good, sir.'],
    charge: ['Over the top, lads!', 'Fix bayonets! Charge!', 'Come on, lads!'],
    bombard: ['Fire!', 'Range set. Fire!', 'Battery, fire!'],
    halt: ['Halt!', 'Hold here!'] },
  usa: { lang: 'en-US',
    select: ['Yes, sir?', 'Ready.', 'Sir?', 'Standing by.'],
    move: ['Moving out.', 'You got it.', 'On the way, sir.'],
    charge: ['Let\'s go, boys!', 'Fix bayonets! Forward!', 'Charge!'],
    bombard: ['Fire!', 'Fire for effect!'],
    halt: ['Halt!', 'Hold up!'] },
  france: { lang: 'fr-FR',
    select: ['Oui, mon lieutenant ?', 'À vos ordres.', 'Prêts.'],
    move: ['On y va !', 'En avant.', 'Compris.'],
    charge: ['En avant ! À la baïonnette !', 'Chargez !'],
    bombard: ['Feu !', 'Batterie, feu !'],
    halt: ['Halte !'] },
  italy: { lang: 'it-IT',
    select: ['Signorsì?', 'Pronti.', 'Agli ordini.'],
    move: ['Avanti!', 'Agli ordini!', 'Andiamo.'],
    charge: ['Savoia! All\'attacco!', 'Avanti, alla baionetta!'],
    bombard: ['Fuoco!', 'Batteria, fuoco!'],
    halt: ['Alt!'] },
  russia: { lang: 'ru-RU',
    select: ['Слушаю!', 'Готовы.', 'Так точно?'],
    move: ['Вперёд!', 'Есть!', 'Выполняем.'],
    charge: ['Ура! В атаку!', 'В штыки! Ура!'],
    bombard: ['Огонь!', 'Батарея, огонь!'],
    halt: ['Стой!'] },
  germany: { lang: 'de-DE',
    select: ['Jawohl?', 'Bereit.', 'Zu Befehl?'],
    move: ['Vorwärts!', 'Wird gemacht.', 'Jawohl!'],
    charge: ['Sturm! Hurra!', 'Seitengewehr pflanzt auf! Angriff!'],
    bombard: ['Feuer!', 'Batterie, Feuer!'],
    halt: ['Halt!'] },
  austria: { lang: 'de-AT',
    select: ['Jawohl, Herr Leutnant?', 'Bereit.', 'Zu Befehl?'],
    move: ['Vorwärts!', 'Wird gemacht.', 'Jawohl!'],
    charge: ['Hurra! Vorwärts!', 'Zum Angriff, hurra!'],
    bombard: ['Feuer!', 'Batterie, Feuer!'],
    halt: ['Halt!'] },
  ottoman: { lang: 'tr-TR',
    select: ['Emredersiniz!', 'Hazırız.', 'Buyurun komutanım?'],
    move: ['İleri!', 'Baş üstüne!', 'Emredersiniz.'],
    charge: ['Allah Allah! Hücum!', 'Süngü tak! Hücum!'],
    bombard: ['Ateş!', 'Batarya, ateş!'],
    halt: ['Dur!'] },
};
// English versions, used when the device has no voice for the army's language
const ENGLISH = {
  select: ['Yes, sir?', 'Ready.', 'Awaiting orders.'],
  move: ['Moving up.', 'Right away.', 'On our way.'],
  charge: ['Charge!', 'Fix bayonets! Forward!'],
  bombard: ['Fire!', 'Battery, fire!'],
  halt: ['Halt!'],
};

export class Voices {
  constructor() {
    this.on = (() => { try { return localStorage.getItem('ww-voice') !== 'off'; } catch { return true; } })();
    this.enabled = true; // the master sound switch
    this.synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    this.voices = [];
    this.last = 0;
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
  }

  /** The best installed voice for a language ('de-AT' falls back to any 'de' voice), or null. */
  voiceFor(lang) {
    const v = this.voices;
    return v.find((x) => x.lang === lang) || v.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase() === lang.toLowerCase())
      || v.find((x) => x.lang && x.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) || null;
  }

  /**
   * A unit answers. kind: select | move | charge | bombard | halt. The newest line interrupts the previous
   * one (a commander only listens to the latest reply), with a short gap so rapid clicks don't stutter.
   */
  bark(unit, nation, kind) {
    const N = LINES[nation] || LINES.uk;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (kind === 'select' && now - this.last < 700) return null; // orders always get an answer
    const time = now / 1000;
    this.last = now;
    const voice = this.synth ? this.voiceFor(N.lang) : null;
    const native = !this.synth || voice; // without a voice for the language, speak English instead
    const pool = (native ? N[kind] : ENGLISH[kind]) || ENGLISH.select;
    const text = pool[Math.floor(Math.random() * pool.length)];
    // the bubble always shows the army's own words
    const shown = native ? text : (N[kind] || pool)[0];
    this.barks = this.barks.filter((b) => b.id !== unit.id);
    this.barks.push({ id: unit.id, text: shown, t: time });
    if (this.synth && this.on && this.enabled) {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = native ? N.lang : 'en-GB';
      if (voice && native) u.voice = voice;
      // each unit has its own voice: pitch and pace from its seed; commands are shouted a bit faster
      const s = unit.seed || 0.5;
      u.pitch = 0.75 + s * 0.4;
      u.rate = (kind === 'charge' ? 1.15 : kind === 'select' ? 1.0 : 1.08) + (s - 0.5) * 0.12;
      u.volume = 0.9;
      this.synth.speak(u);
    }
    return text;
  }
}
