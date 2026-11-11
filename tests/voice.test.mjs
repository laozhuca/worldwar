import test from 'node:test';
import assert from 'node:assert/strict';
import { Voices, isMale } from '../src/voice.js';

const V = (name, lang) => ({ name, lang });
const ALL = [
  V('Google US English', 'en-US'), V('Google UK English Female', 'en-GB'), V('Google UK English Male', 'en-GB'),
  V('Google Deutsch', 'de-DE'), V('Google français', 'fr-FR'), V('Microsoft Hedda - German (Germany)', 'de-DE'),
  V('Microsoft Stefan - German (Germany)', 'de-DE'), V('Microsoft Conrad Online (Natural) - German (Germany)', 'de-DE'),
  V('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'), V('Microsoft Henri Online (Natural) - French (France)', 'fr-FR'),
  V('Microsoft Zira - English (United States)', 'en-US'), V('Samantha', 'en-US'), V('Daniel', 'en-GB'), V('Milena', 'ru-RU'),
  V('Yelda', 'tr-TR'), V('Amélie', 'fr-CA'), V('Thomas (Enhanced)', 'fr-FR'), V('Alice', 'it-IT'),
];

test('only male voices are recognised as male', () => {
  const male = ALL.filter(isMale).map((v) => v.name);
  assert.deepEqual(male, ['Google UK English Male', 'Microsoft Stefan - German (Germany)',
    'Microsoft Conrad Online (Natural) - German (Germany)', 'Microsoft Henri Online (Natural) - French (France)',
    'Daniel', 'Thomas (Enhanced)']);
});

test('voice choice: male native voice, else none (caller falls back to male English)', () => {
  const v = new Voices();
  v.voices = ALL;
  assert.ok(isMale(v.voiceFor('de-AT')), 'Austrians get a German man');
  assert.ok(isMale(v.voiceFor('fr-FR')));
  assert.equal(v.voiceFor('ru-RU'), null, 'Milena is not used');
  assert.equal(v.voiceFor('tr-TR'), null);
  assert.equal(v.voiceFor('it-IT'), null);
  assert.ok(isMale(v.voiceFor('en-GB')));
  assert.equal(v.voiceFor('en-US').name, 'Google UK English Male', 'never the female US voices');
});

test('every army has every kind of line; selection mixes in the unit type\'s lines', () => {
  const v = new Voices();
  for (const nation of ['uk', 'usa', 'france', 'italy', 'russia', 'germany', 'austria', 'ottoman']) {
    for (const kind of ['select', 'move', 'charge', 'bombard', 'halt', 'recruit', 'pinned']) {
      v.last = -1e9; v.lastPinned = -1e9;
      assert.ok(v.bark({ id: 1, type: 'rifle', seed: 0.5 }, nation, kind), `${nation} ${kind}`);
    }
    const heard = new Set();
    for (let i = 0; i < 300; i++) { v.last = -1e9; heard.add(v.bark({ id: 2, type: 'mg', seed: 0.5 }, nation, 'select')); }
    assert.ok(heard.size >= 5, `${nation}: general and MG select lines mixed (${[...heard]})`);
  }
});
