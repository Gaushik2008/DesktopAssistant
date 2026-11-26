import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PRESETS, isGemini, buildTranscribeRequest, extractTranscript, sttErrorFromStatus, checkSttReady, validateSettings,
} from '../src/web/core/llm.js';
import { encodeWav, resample, toBase64 } from '../src/web/recorder.js';

const require = createRequire(import.meta.url);
const { transcribe, DEFAULTS } = require('../electron/llm.js');

const gem = { provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: 'gemini-flash-latest', apiKey: 'AIza-secret' };
const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const fakeFetch = (status, body, cap) => async (url, init) => {
  if (cap) Object.assign(cap, { url, init });
  return { ok: status < 300, status, json: async () => body };
};

test('Gemini is the default provider and a valid chat preset', () => {
  assert.equal(DEFAULTS.provider, 'gemini');
  assert.equal(validateSettings(gem).ok, true);
  assert.equal(validateSettings({ ...gem, apiKey: '' }).ok, false); // needs a key
  assert.equal(isGemini(gem), true);
  assert.equal(isGemini({ baseUrl: PRESETS.nvidia.baseUrl }), false);
  assert.equal(isGemini({ baseUrl: 'nonsense' }), false);
});

test('buildTranscribeRequest: audio inline, key in header only, model sanitised', () => {
  const r = buildTranscribeRequest({ ...gem, model: 'models/gemini-flash-latest' }, 'QUJD');
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.ok(!r.url.includes('AIza'), 'key must never be in the URL');
  assert.equal(r.headers['x-goog-api-key'], 'AIza-secret');
  assert.deepEqual(r.body.contents[0].parts[1].inline_data, { mime_type: 'audio/wav', data: 'QUJD' });
});

test('extractTranscript handles text, silence marker and junk', () => {
  assert.equal(extractTranscript(reply('"Open YouTube."')), 'Open YouTube.');
  assert.equal(extractTranscript(reply('[silence]')), '');
  assert.equal(extractTranscript({}), null);
});

test('error mapping and readiness checks', () => {
  assert.equal(sttErrorFromStatus(400).code, 'badkey');
  assert.equal(sttErrorFromStatus(404).code, 'badmodel');
  assert.equal(sttErrorFromStatus(429).code, 'quota');
  assert.equal(checkSttReady({ ...gem, apiKey: '' }, 'QQ==').code, 'nokey');
  assert.equal(checkSttReady({ ...gem, baseUrl: PRESETS.nvidia.baseUrl }, 'QQ==').code, 'nogemini');
  assert.equal(checkSttReady(gem, '').code, 'error');
  assert.equal(checkSttReady(gem, 'QQ=='), null);
});

test('main-process transcribe: success, silence, http errors, network', async () => {
  const cap = {};
  const ok = await transcribe({ settings: gem, base64: 'QQ==', fetchImpl: fakeFetch(200, reply('play thunderstruck'), cap) });
  assert.deepEqual(ok, { ok: true, text: 'play thunderstruck' });
  assert.equal(JSON.parse(cap.init.body).contents[0].parts[1].inline_data.data, 'QQ==');

  assert.equal((await transcribe({ settings: gem, base64: 'QQ==', fetchImpl: fakeFetch(200, reply('[silence]')) })).code, 'no-speech');
  assert.equal((await transcribe({ settings: gem, base64: 'QQ==', fetchImpl: fakeFetch(403, {}) })).code, 'badkey');
  assert.equal((await transcribe({ settings: gem, base64: 'QQ==', fetchImpl: fakeFetch(429, {}) })).code, 'quota');
  assert.equal((await transcribe({ settings: gem, base64: 'QQ==', fetchImpl: async () => { throw new TypeError('fetch failed'); } })).code, 'network');
  assert.equal((await transcribe({ settings: { ...gem, apiKey: '' }, base64: 'QQ==', fetchImpl: fakeFetch(200, {}) })).code, 'nokey');
});

test('transcribe never forwards non-WAV mime types to Gemini', async () => {
  const cap = {};
  await transcribe({ settings: gem, base64: 'QQ==', mime: 'text/html', fetchImpl: fakeFetch(200, reply('x'), cap) });
  assert.equal(JSON.parse(cap.init.body).contents[0].parts[1].inline_data.mime_type, 'audio/wav');
});

test('encodeWav writes a valid 16 kHz mono PCM header; resample + base64 are correct', () => {
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const v = new DataView(wav);
  const tag = (o) => String.fromCharCode(...new Uint8Array(wav, o, 4));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE');
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(50, true), 32767);
  assert.equal(resample(new Float32Array(4800).fill(0.25), 48000, 16000).length, 1600);
  assert.deepEqual([...Buffer.from(toBase64(new Uint8Array([1, 2, 3, 250]).buffer), 'base64')], [1, 2, 3, 250]);
});
