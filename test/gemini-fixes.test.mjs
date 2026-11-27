import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PRESETS, cleanKey, errorDetail, buildRequest, buildTranscribeRequest, friendlyHttpError, sttErrorFromStatus } from '../src/web/core/llm.js';

const require = createRequire(import.meta.url);
const { createStore } = require('../electron/llm.js');
const gem = { provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: 'gemini-flash-latest', apiKey: 'AIza-secret' };

test('cleanKey removes whitespace, zero-width chars and wrapping quotes', () => {
  assert.equal(cleanKey('  "AIza-abc\u200B def"\n'), 'AIza-abcdef');
  assert.equal(cleanKey(undefined), '');
});

test('Gemini requests leave room for thinking tokens and send a clean key', () => {
  const r = buildRequest({ ...gem, apiKey: ' AIza-secret\u200B ' }, [], 'hi');
  assert.equal(r.headers.Authorization, 'Bearer AIza-secret');
  assert.ok(r.body.max_tokens >= 1024);
  assert.ok(buildTranscribeRequest(gem, 'QQ==').body.generationConfig.maxOutputTokens >= 1024);
  assert.equal(buildRequest({ baseUrl: PRESETS.nvidia.baseUrl, model: 'm', apiKey: 'k' }, [], 'hi').body.max_tokens, 300);
});

test('error details: bad-key 400s stay "key rejected", other 400s show Google\'s reason', () => {
  assert.equal(errorDetail({ error: { message: 'API key not valid.' } }), 'API key not valid.');
  assert.equal(errorDetail([{ error: { message: 'x' } }]), 'x');
  assert.equal(errorDetail(null), '');
  assert.match(friendlyHttpError(400, 'h', 'API key not valid. Please pass a valid API key.'), /key was rejected/);
  assert.match(friendlyHttpError(400, 'h', 'Unsupported model'), /Unsupported model/);
  assert.equal(sttErrorFromStatus(400).code, 'badkey');
  assert.equal(sttErrorFromStatus(400, 'Audio too long').code, 'error');
  assert.equal(sttErrorFromStatus(400, 'API key not valid').code, 'badkey');
});

test('store: unreadable key is not reported as saved; trailing slash keeps the key; pasted key is cleaned', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sp-')), 'llm.json');
  let broken = false;
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`ENC(${s})`),
    decryptString: (b) => { if (broken) throw new Error('keyring changed'); return b.toString().slice(4, -1); } };
  const store = createStore({ file, safeStorage });
  await store.save({ provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: 'm', apiKey: ' "AIza-key\u200B"\n' });
  assert.equal((await store.getRaw()).apiKey, 'AIza-key');
  await store.save({ baseUrl: `${PRESETS.gemini.baseUrl}/` }); // cosmetic URL change must not drop the key
  assert.equal((await store.getRaw()).apiKey, 'AIza-key');
  broken = true;
  assert.equal((await store.get()).hasKey, false);
});
