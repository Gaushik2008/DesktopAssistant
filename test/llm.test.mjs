import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PRESETS, validateSettings, buildRequest, extractReply, trimHistory, friendlyHttpError, isLocalHost } from '../src/web/core/llm.js';

const require = createRequire(import.meta.url);
const { createStore, chat } = require('../electron/llm.js');

const nvidia = { provider: 'nvidia', baseUrl: PRESETS.nvidia.baseUrl, model: 'm', apiKey: 'nvapi-secret' };

test('validateSettings: https ok, http only for local, key required for NVIDIA', () => {
  assert.equal(validateSettings(nvidia).ok, true);
  assert.equal(validateSettings({ ...nvidia, apiKey: '' }).ok, false);
  assert.equal(validateSettings({ ...nvidia, apiKey: '', hasKey: true }).ok, true);
  assert.equal(validateSettings({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' }).ok, true);
  assert.equal(validateSettings({ provider: 'ollama', baseUrl: 'http://192.168.1.20:11434/v1', model: 'q' }).ok, true);
  assert.equal(validateSettings({ provider: 'custom', baseUrl: 'http://evil.example.com/v1', model: 'q' }).ok, false);
  assert.equal(validateSettings({ provider: 'custom', baseUrl: 'file:///etc/passwd', model: 'q' }).ok, false);
  assert.equal(validateSettings({ ...nvidia, model: ' ' }).ok, false);
  assert.equal(isLocalHost('172.20.0.1'), true);
  assert.equal(isLocalHost('172.32.0.1'), false);
});

test('buildRequest: url, auth header, history trimming, qwen3 soft switch', () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const r = buildRequest(nvidia, hist, 'hello');
  assert.equal(r.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(r.headers.Authorization, 'Bearer nvapi-secret');
  assert.equal(r.body.messages[0].role, 'system');
  assert.equal(r.body.messages.length, 1 + 12 + 1);
  assert.equal(r.body.messages.at(-1).content, 'hello');
  const q = buildRequest({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen3:4b' }, [], 'hi');
  assert.equal(q.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(q.headers.Authorization, undefined);
  assert.equal(q.body.messages.at(-1).content, 'hi /no_think');
  assert.equal(trimHistory([{ role: 'system', content: 'x' }, { role: 'user', content: 'ok' }, null]).length, 1);
});

test('extractReply strips think blocks and caps length', () => {
  assert.equal(extractReply({ choices: [{ message: { content: '<think>hmm</think>\n\nBlue light scatters.' } }] }), 'Blue light scatters.');
  assert.equal(extractReply({ choices: [{ message: { content: '<think>never closed' } }] }), null);
  assert.equal(extractReply({}), null);
  assert.ok(extractReply({ choices: [{ message: { content: 'a'.repeat(5000) } }] }).length <= 600);
  assert.match(friendlyHttpError(401, 'x'), /key was rejected/);
});

const ok = (json) => async () => ({ ok: true, status: 200, json: async () => json });

test('chat() sends the request and returns the reply', async () => {
  let seen;
  const res = await chat({ settings: nvidia, history: [], text: 'why is the sky blue',
    fetchImpl: async (url, init) => { seen = { url, init }; return ok({ choices: [{ message: { content: 'Rayleigh scattering.' } }] })(); } });
  assert.deepEqual(res, { ok: true, reply: 'Rayleigh scattering.' });
  assert.equal(seen.init.headers.Authorization, 'Bearer nvapi-secret');
  assert.equal(JSON.parse(seen.init.body).model, 'm');
});

test('chat() maps failures to friendly messages', async () => {
  const bad = (status) => async () => ({ ok: false, status });
  assert.match((await chat({ settings: nvidia, text: 'x', fetchImpl: bad(401) })).message, /rejected/);
  assert.match((await chat({ settings: nvidia, text: 'x', fetchImpl: async () => { throw new TypeError('fetch failed'); } })).message, /Couldn't reach/);
  assert.match((await chat({ settings: { ...nvidia, baseUrl: 'http://evil.com' }, text: 'x', fetchImpl: ok({}) })).message, /https/);
  const slow = (_u, { signal }) => new Promise((_r, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
  assert.match((await chat({ settings: nvidia, text: 'x', fetchImpl: slow, timeoutMs: 20 })).message, /too long/);
  assert.match((await chat({ settings: nvidia, text: '  ', fetchImpl: ok({}) })).message, /Nothing to ask/);
});

test('store: key is encrypted on disk, never returned, dropped when the server changes', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sp-')), 'llm.json');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`ENC(${s})`), decryptString: (b) => b.toString().slice(4, -1) };
  const store = createStore({ file, safeStorage });
  assert.equal((await store.get()).hasKey, false);
  const saved = await store.save({ provider: 'nvidia', baseUrl: PRESETS.nvidia.baseUrl, model: 'm', apiKey: 'nvapi-secret' });
  assert.deepEqual(saved, { provider: 'nvidia', baseUrl: PRESETS.nvidia.baseUrl, model: 'm', hasKey: true });
  assert.ok(!readFileSync(file, 'utf8').includes('nvapi-secret'), 'plaintext key must not be on disk');
  assert.equal((await store.getRaw()).apiKey, 'nvapi-secret');
  assert.equal(JSON.stringify(await store.get()).includes('nvapi'), false);
  await store.save({ model: 'other' }); // same server: key kept
  assert.equal((await store.getRaw()).apiKey, 'nvapi-secret');
  await store.save({ baseUrl: 'https://other.example.com/v1' }); // different server, no new key: key dropped
  assert.equal((await store.getRaw()).hasKey, false);
});
