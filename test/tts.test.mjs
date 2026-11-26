import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
const spoken = []; let cancels = 0;
globalThis.window = globalThis;
globalThis.speechSynthesis = { speak: (u) => spoken.push(u), cancel: () => { cancels++; } };
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

const { tts } = await import('../src/web/tts.js');

test('off by default; speak() does nothing until enabled', () => {
  assert.equal(tts.supported(), true);
  assert.equal(tts.isEnabled(), false);
  assert.equal(tts.speak('hello'), false);
  assert.equal(spoken.length, 0);
});

test('enabled: speaks cleaned, truncated text and interrupts the previous utterance', () => {
  tts.setEnabled(true);
  assert.equal(tts.speak('  see   https://example.com/page now '), true);
  assert.equal(spoken.at(-1).text, 'see a link now');
  assert.equal(cancels >= 1, true);
  tts.speak('x'.repeat(1000));
  assert.equal(spoken.at(-1).text.length, 400);
  assert.equal(tts.speak('   '), false);
  assert.equal(tts.speak(42), false);
});

test('disabling cancels speech and is persisted', () => {
  const before = cancels;
  tts.setEnabled(false);
  assert.ok(cancels > before);
  assert.equal(JSON.parse(store.get('sirpixel.tts')).enabled, false);
});
