// Soldier voice lines ("barks") when the player selects or commands units, spoken with the browser's
// speech synthesis in each army's own language, plus a speech bubble over the unit.
// Only male voices are used; without a male voice for the language a male English voice speaks the English line.

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

  /** A male voice for a language ('de-AT' falls back to any German male voice), or null. */
  voiceFor(lang) {
    const v = this.voices.filter(isMale);
    const norm = (x) => (x.lang || '').replace('_', '-').toLowerCase();
    return v.find((x) => norm(x) === lang.toLowerCase())
      || v.find((x) => norm(x).startsWith(lang.slice(0, 2).toLowerCase() + '-') || norm(x) === lang.slice(0, 2).toLowerCase()) || null;
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
    // a male voice in the army's language; failing that a male English voice speaking the English line;
    // failing that, silence (never a female voice): the bubble still shows the words
    let voice = this.synth ? this.voiceFor(N.lang) : null;
    const native = !this.synth || !!voice;
    if (!voice && this.synth) voice = this.voiceFor('en-GB') || this.voiceFor('en-US');
    const pool = (native ? N[kind] : ENGLISH[kind]) || ENGLISH.select;
    const text = pool[Math.floor(Math.random() * pool.length)];
    // the bubble always shows the army's own words
    const shown = native ? text : (N[kind] || pool)[0];
    this.barks = this.barks.filter((b) => b.id !== unit.id);
    this.barks.push({ id: unit.id, text: shown, t: time });
    if (this.synth && voice && this.on && this.enabled) {
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      // each unit has its own voice: pitch and pace from its seed; commands are shouted a bit faster
      const s = unit.seed || 0.5;
      u.pitch = 0.7 + s * 0.3; // kept low: men's voices
      u.rate = (kind === 'charge' ? 1.15 : kind === 'select' ? 1.0 : 1.08) + (s - 0.5) * 0.12;
      u.volume = 0.9;
      this.synth.speak(u);
    }
    return text;
  }
}
