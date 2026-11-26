import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const calls = { listen: 0, cancel: 0 };
let result = { ok: true, text: 'open github' };
window.assistant = { stt: { supported: true, listen: async () => { calls.listen++; return result; }, cancel: () => { calls.cancel++; } } };
const { listen, speechSupported, cancelListening } = await import('../src/web/speech.js');

test('desktop recogniser makes speech supported and returns its transcript', async () => {
  assert.equal(speechSupported(), true);
  assert.equal(await listen(), 'open github');
  assert.equal(calls.listen, 1);
});

test('errors keep their code and message so the UI can explain them', async () => {
  result = { ok: false, code: 'no-mic', message: 'No microphone found.' };
  await assert.rejects(listen(), (e) => e.code === 'no-mic' && e.message === 'No microphone found.');
  result = { ok: false, code: 'no-speech' };
  await assert.rejects(listen(), (e) => e.code === 'no-speech');
});

test('cancelListening() cancels the desktop recogniser', async () => {
  let release; result = null;
  window.assistant.stt.listen = () => new Promise((r) => { release = r; });
  const p = listen();
  cancelListening();
  assert.equal(calls.cancel, 1);
  release({ ok: false, code: 'cancelled' });
  await assert.rejects(p, (e) => e.code === 'cancelled');
});

test('without the desktop bridge or Web Speech, speech is unsupported', async () => {
  window.assistant = { stt: { supported: false } };
  assert.equal(speechSupported(), false);
  await assert.rejects(listen(), (e) => e.code === 'unsupported');
});
