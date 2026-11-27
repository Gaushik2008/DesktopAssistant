import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chooseGeminiModel, PRESETS } from '../src/web/core/llm.js';

const require = createRequire(import.meta.url);
const { withModelRecovery, pickGeminiModel } = require('../electron/llm.js');

const gen = ['generateContent'];
const LIST = [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: gen },
  { name: 'models/gemini-3.5-flash', supportedGenerationMethods: gen },
  { name: 'models/gemini-3.6-flash', supportedGenerationMethods: gen },
  { name: 'models/gemini-3.6-flash-lite', supportedGenerationMethods: gen },
  { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
];

test('chooseGeminiModel picks the newest plain Flash, ignoring lite/live/tts/embeddings', () => {
  assert.equal(chooseGeminiModel(LIST), 'gemini-3.6-flash');
  assert.equal(chooseGeminiModel([{ name: 'models/gemini-3.6-flash-lite', supportedGenerationMethods: gen }, { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: gen }]), 'gemini-3.6-flash-lite');
  assert.equal(chooseGeminiModel([{ name: 'models/text-embedding-004' }]), null);
  assert.equal(chooseGeminiModel(undefined), null);
});

function fakeStore(initial) {
  let cur = { ...initial };
  return { getRaw: () => ({ ...cur }), save: (i) => { cur = { ...cur, ...i }; }, current: () => cur };
}
const gem = { provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: 'gemini-flash-latest', apiKey: 'K', hasKey: true };
const listFetch = (models, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => ({ models }) });

test('404 on chat -> discovers model, saves it, retries and reports the new model', async () => {
  const store = fakeStore(gem);
  const seen = [];
  const run = async (s) => { seen.push(s.model); return s.model === 'gemini-3.6-flash' ? { ok: true, reply: 'hi' } : { ok: false, message: 'nf', status: 404 }; };
  const out = await withModelRecovery(run, store, listFetch(LIST));
  assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-3.6-flash']);
  assert.equal(out.ok, true);
  assert.equal(out.model, 'gemini-3.6-flash');
  assert.equal(store.current().model, 'gemini-3.6-flash');
});

test('STT badmodel code also triggers recovery', async () => {
  const store = fakeStore(gem);
  const run = async (s) => (s.model === 'gemini-3.6-flash' ? { ok: true, text: 'x' } : { ok: false, code: 'badmodel' });
  assert.equal((await withModelRecovery(run, store, listFetch(LIST))).ok, true);
});

test('no recovery for other errors, non-Gemini hosts, missing key, or failed discovery', async () => {
  const bad401 = async () => ({ ok: false, message: 'k', status: 401 });
  const nf = async () => ({ ok: false, message: 'nf', status: 404 });
  assert.equal((await withModelRecovery(bad401, fakeStore(gem), listFetch(LIST))).status, 401);
  assert.equal((await withModelRecovery(nf, fakeStore({ ...gem, baseUrl: PRESETS.nvidia.baseUrl }), listFetch(LIST))).status, 404);
  assert.equal((await withModelRecovery(nf, fakeStore({ ...gem, apiKey: '' }), listFetch(LIST))).status, 404);
  const store = fakeStore(gem);
  assert.equal((await withModelRecovery(nf, store, listFetch([], false))).status, 404);
  assert.equal(store.current().model, 'gemini-flash-latest', 'model must not change when discovery fails');
});

test('400 with bad API key message does NOT trigger model recovery (chat)', async () => {
  const store = fakeStore(gem);
  const seen = [];
  const run = async (s) => { seen.push(s.model); return { ok: false, message: 'The API key was rejected. Check it in settings.', status: 400 }; };
  const out = await withModelRecovery(run, store, listFetch(LIST));
  assert.deepEqual(seen, ['gemini-flash-latest'], 'should not retry on bad key');
  assert.equal(out.status, 400);
  assert.equal(store.current().model, 'gemini-flash-latest');
});

test('400 with bad API key code does NOT trigger model recovery (STT)', async () => {
  const store = fakeStore(gem);
  const seen = [];
  const run = async (s) => { seen.push(s.model); return { ok: false, code: 'badkey', message: 'Gemini rejected the API key. Check it in settings.' }; };
  const out = await withModelRecovery(run, store, listFetch(LIST));
  assert.deepEqual(seen, ['gemini-flash-latest'], 'should not retry on bad key');
  assert.equal(out.code, 'badkey');
  assert.equal(store.current().model, 'gemini-flash-latest');
});

test('400 unsupported model DOES trigger model recovery', async () => {
  const store = fakeStore(gem);
  const seen = [];
  const run = async (s) => { seen.push(s.model); return s.model === 'gemini-3.6-flash' ? { ok: true, reply: 'hi' } : { ok: false, message: 'The AI service rejected the request: model not supported', status: 400 }; };
  const out = await withModelRecovery(run, store, listFetch(LIST));
  assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-3.6-flash'], 'should retry on unsupported model');
  assert.equal(out.ok, true);
  assert.equal(out.model, 'gemini-3.6-flash');
  assert.equal(store.current().model, 'gemini-3.6-flash');
});

test('500 server error DOES trigger model recovery', async () => {
  const store = fakeStore(gem);
  const seen = [];
  const run = async (s) => { seen.push(s.model); return s.model === 'gemini-3.6-flash' ? { ok: true, reply: 'hi' } : { ok: false, message: 'server error', status: 500 }; };
  const out = await withModelRecovery(run, store, listFetch(LIST));
  assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-3.6-flash'], 'should retry on 500');
  assert.equal(out.ok, true);
  assert.equal(out.model, 'gemini-3.6-flash');
});

test('pickGeminiModel sends the key in a header, not the URL', async () => {
  let url, init;
  await pickGeminiModel({ apiKey: 'SECRET', fetchImpl: async (u, i) => { url = u; init = i; return { ok: true, json: async () => ({ models: LIST }) }; } });
  assert.ok(!url.includes('SECRET'));
  assert.equal(init.headers['x-goog-api-key'], 'SECRET');
});
