'use strict';
// Main-process side of the AI fallback. The API key lives ONLY here: it is stored
// encrypted (Electron safeStorage) and is never sent to the renderer.

const fs = require('fs');
const path = require('path');

let corePromise;
const core = () => (corePromise ||= import('../src/web/core/llm.js'));

const sanitizeKey = (k) => String(k || '').replace(/[^\x21-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '');
const normUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
/** Google/OpenAI error text from a failed response ('' if the body isn't JSON). */
async function readDetail(res) {
  try { const { errorDetail } = await core(); return typeof res.json === 'function' ? errorDetail(await res.json()) : ''; } catch { return ''; }
}

const DEFAULTS = { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest' };

function createStore({ file, safeStorage }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const encrypt = (key) => (safeStorage && safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(key).toString('base64')}`
    : `plain:${Buffer.from(key).toString('base64')}`);
  const decrypt = async (v) => {
    if (!v) return '';
    try {
      if (v.startsWith('enc:')) {
        if (safeStorage && safeStorage.decryptStringAsync) {
          return await safeStorage.decryptStringAsync(Buffer.from(v.slice(4), 'base64'));
        }
        // Fallback for older Electron versions
        return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
      }
      if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf8');
    } catch { /* unreadable */ }
    return '';
  };

  return {
    /** Safe for the renderer: never includes the key. */
    async get() {
      const d = { ...DEFAULTS, ...read() };
      const key = await decrypt(d.key);
      return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, hasKey: Boolean(key) };
    },
    /** Main process only. */
    async getRaw() {
      const d = { ...DEFAULTS, ...read() };
      const key = await decrypt(d.key);
      return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, apiKey: key, hasKey: Boolean(key) };
    },
    save(input) {
      const cur = { ...DEFAULTS, ...read() };
      const next = {
        provider: String(input.provider || cur.provider),
        baseUrl: String(input.baseUrl ?? cur.baseUrl).trim(),
        model: String(input.model ?? cur.model).trim(),
        key: cur.key,
      };
      // Pointing the saved key at a different server must not leak it: drop it unless a new key comes with the change.
      if (normUrl(next.baseUrl) !== normUrl(cur.baseUrl) && !input.apiKey) next.key = undefined;
      if (typeof input.apiKey === 'string' && sanitizeKey(input.apiKey)) next.key = encrypt(sanitizeKey(input.apiKey));
      if (input.clearKey) next.key = undefined;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
      return this.get();
    },
  };
}

async function chat({ settings, history, text, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  const { validateSettings, buildRequest, extractReply, friendlyHttpError } = await core();
  const v = validateSettings(settings);
  if (!v.ok) return { ok: false, message: v.error };
  if (typeof text !== 'string' || !text.trim()) return { ok: false, message: 'Nothing to ask.' };

  const req = buildRequest(settings, history, text.slice(0, 2000));
  const host = new URL(req.url).host;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal });
    if (!res.ok) return { ok: false, message: friendlyHttpError(res.status, host, await readDetail(res)), status: res.status };
    const reply = extractReply(await res.json());
    return reply ? { ok: true, reply } : { ok: false, message: 'The AI sent an empty answer.' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, message: `${host} took too long to answer.` };
    return { ok: false, message: `Couldn't reach ${host}. Is it running / are you online?` };
  } finally {
    clearTimeout(timer);
  }
}

/** Speech-to-text via Gemini. Runs in the main process so the key never reaches the renderer. */
async function transcribe({ settings, base64, mime = 'audio/wav', fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  const { buildTranscribeRequest, extractTranscript, sttErrorFromStatus, checkSttReady } = await core();
  const bad = checkSttReady(settings, base64);
  if (bad) return bad;
  const req = buildTranscribeRequest(settings, base64, mime === 'audio/wav' ? mime : 'audio/wav');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ctrl.signal });
    if (!res.ok) return { ok: false, ...sttErrorFromStatus(res.status, await readDetail(res)) };
    const text = extractTranscript(await res.json());
    if (text === null) return { ok: false, code: 'error', message: 'Gemini sent an unreadable answer.' };
    return text ? { ok: true, text } : { ok: false, code: 'no-speech', message: "I didn't catch that." };
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return { ok: false, code: 'network', message: timedOut ? 'Gemini took too long to answer.' : "Couldn't reach Gemini. Are you online?" };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask Google which models this key can use and pick the best Flash one (null if none/failed). */
async function pickGeminiModel({ apiKey, fetchImpl = globalThis.fetch }) {
  const { chooseGeminiModel } = await core();
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) return null;
    return chooseGeminiModel((await res.json()).models);
  } catch { return null; }
}

/**
 * Run a Gemini call; if the model name is rejected (404), discover a valid one, save it and retry once.
 * `run(rawSettings)` must return the chat()/transcribe() result shape.
 */
async function withModelRecovery(run, store, fetchImpl = globalThis.fetch) {
  const out = await run(store.getRaw());
  if (out.ok || !(out.status === 404 || out.code === 'badmodel')) return out;
  const raw = store.getRaw();
  const { isGemini } = await core();
  if (!raw.apiKey || !isGemini(raw)) return out;
  const model = await pickGeminiModel({ apiKey: raw.apiKey, fetchImpl });
  if (!model || model === raw.model) return out;
  store.save({ model });
  const again = await run(store.getRaw());
  return again.ok ? { ...again, model } : out;
}

module.exports = { createStore, chat, transcribe, pickGeminiModel, withModelRecovery, DEFAULTS };
