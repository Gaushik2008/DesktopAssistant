'use strict';
// Main-process side of the AI fallback. The API key lives ONLY here: it is stored
// encrypted (Electron safeStorage) and is never sent to the renderer.

const fs = require('fs');
const path = require('path');

let corePromise;
const core = () => (corePromise ||= import('../src/web/core/llm.js'));

const DEFAULTS = { provider: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' };

function createStore({ file, safeStorage }) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const encrypt = (key) => (safeStorage && safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(key).toString('base64')}`
    : `plain:${Buffer.from(key).toString('base64')}`);
  const decrypt = (v) => {
    if (!v) return '';
    try {
      if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
      if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString('utf8');
    } catch { /* unreadable */ }
    return '';
  };

  return {
    /** Safe for the renderer: never includes the key. */
    get() {
      const d = { ...DEFAULTS, ...read() };
      return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, hasKey: Boolean(d.key) };
    },
    /** Main process only. */
    getRaw() {
      const d = { ...DEFAULTS, ...read() };
      return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, apiKey: decrypt(d.key), hasKey: Boolean(d.key) };
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
      if (next.baseUrl !== cur.baseUrl && !input.apiKey) next.key = undefined;
      if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.key = encrypt(input.apiKey.trim());
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
    if (!res.ok) return { ok: false, message: friendlyHttpError(res.status, host) };
    const reply = extractReply(await res.json());
    return reply ? { ok: true, reply } : { ok: false, message: 'The AI sent an empty answer.' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, message: `${host} took too long to answer.` };
    return { ok: false, message: `Couldn't reach ${host}. Is it running / are you online?` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { createStore, chat, DEFAULTS };
