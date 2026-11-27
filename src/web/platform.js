// Platform bridge: one tiny interface, three implementations.
//
//   platform.name                     'windows' | 'linux' | 'macos' | 'android' | 'web'
//   platform.execute(action)          -> Promise<{ok, message?}>
//   platform.onToggleListen(cb)       global hotkey / tray -> start/stop listening
//   platform.onTypeCommand(cb)        hotkey -> show typed box
//   platform.setInteractive(bool)     desktop click-through control
//   platform.moveBy(dx, dy)           desktop: drag the overlay window
//
// Desktop (Electron) exposes window.assistant via electron/preload.js.
// Android (Capacitor) uses Capacitor.Plugins.* globals - no bundler needed.

import { isSafeUrl, APPS } from './core/catalog.js';
import {
  PRESETS, validateSettings, buildRequest, extractReply, friendlyHttpError,
  buildTranscribeRequest, extractTranscript, sttErrorFromStatus, checkSttReady,
} from './core/llm.js';

const noop = () => {};

function detect() {
  if (window.assistant) return 'desktop';
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'android';
  return 'web';
}

const desktop = () => ({
  name: window.assistant.platform,
  execute: (action) => window.assistant.execute(action),
  onToggleListen: window.assistant.onToggleListen,
  onTypeCommand: window.assistant.onTypeCommand,
  setInteractive: window.assistant.setInteractive,
  moveBy: window.assistant.moveBy,
  nativeSpeech: false,
  llm: window.assistant.llm,
  stt: window.assistant.stt || null,
  onOpenSettings: window.assistant.onOpenSettings || noop,
});

// Android: settings live in the app's private WebView storage; HTTP goes through the native
// CapacitorHttp plugin (no CORS, and it can reach a PC on your LAN running Ollama/LM Studio).
const LLM_KEY = 'sirpixel.llm';
const llmDefaults = { provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: PRESETS.gemini.model };
const GEMINI_HOST = 'generativelanguage.googleapis.com';
const readLlm = () => { try { return { ...llmDefaults, ...JSON.parse(localStorage.getItem(LLM_KEY) || '{}') }; } catch { return { ...llmDefaults }; } };
const isGemini = (s) => { try { return new URL(s.baseUrl).hostname === GEMINI_HOST; } catch { return false; } };
const cleanKey = (k) => String(k || '').replace(/[^\x21-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '');

// Extract error detail from CapacitorHttp response (similar to electron's readDetail)
async function readDetail(res) {
  try {
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const e = data && (Array.isArray(data) ? data[0] : data).error;
    const m = e && typeof e.message === 'string' ? e.message : '';
    return m.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch { return ''; }
}

// Model recovery for Android (mirrors electron/llm.js withModelRecovery)
async function withModelRecovery(run, fetchImpl) {
  const out = await run();
  const isBadKey = out.code === 'badkey' || /api key was rejected/i.test(out.message || '');
  const isModelError = (out.status === 400 || out.status === 404 || out.status >= 500 || out.code === 'badmodel') && !isBadKey;
  if (out.ok || !isModelError) return out;
  const raw = readLlm();
  if (!raw.apiKey || !isGemini(raw)) return out;
  const listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
  try {
    const res = await fetchImpl(listUrl, { method: 'GET', headers: { 'x-goog-api-key': cleanKey(raw.apiKey) } });
    if (res.status !== 200) return out;
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const { chooseGeminiModel } = await import('./core/llm.js');
    const model = chooseGeminiModel(data.models);
    if (!model || model === raw.model) return out;
    raw.model = model;
    try { localStorage.setItem(LLM_KEY, JSON.stringify(raw)); } catch { /* ignore */ }
    const again = await run();
    return again.ok ? { ...again, model } : out;
  } catch { return out; }
}

const androidLlm = () => ({
  async getSettings() { const d = readLlm(); return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, hasKey: Boolean(d.apiKey) }; },
  async saveSettings(input) {
    const cur = readLlm();
    const next = { provider: input.provider || cur.provider, baseUrl: String(input.baseUrl ?? cur.baseUrl).trim(), model: String(input.model ?? cur.model).trim(), apiKey: cur.apiKey };
    if (next.baseUrl !== cur.baseUrl && !input.apiKey) next.apiKey = undefined;
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) next.apiKey = input.apiKey.trim();
    if (input.clearKey) next.apiKey = undefined;
    try { localStorage.setItem(LLM_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return this.getSettings();
  },
  async chat(history, text) {
    const settings = readLlm();
    const v = validateSettings(settings);
    if (!v.ok) return { ok: false, message: v.error };
    const req = buildRequest(settings, history, String(text).slice(0, 2000));
    const host = new URL(req.url).host;
    return withModelRecovery(async () => {
      try {
        const res = await window.Capacitor.Plugins.CapacitorHttp.request({ url: req.url, method: 'POST', headers: req.headers, data: req.body, connectTimeout: 15000, readTimeout: 30000 });
        const detail = await readDetail(res);
        if (res.status < 200 || res.status >= 300) return { ok: false, message: friendlyHttpError(res.status, host, detail), status: res.status };
        const reply = extractReply(typeof res.data === 'string' ? JSON.parse(res.data) : res.data);
        return reply ? { ok: true, reply } : { ok: false, message: 'The AI sent an empty answer.' };
      } catch { return { ok: false, message: `Couldn't reach ${host}. Is it running / are you online?` }; }
    }, window.Capacitor.Plugins.CapacitorHttp.request.bind(window.Capacitor.Plugins.CapacitorHttp));
  },
});

const androidStt = () => ({
  async transcribe(base64) {
    const settings = readLlm();
    const bad = checkSttReady(settings, base64);
    if (bad) return bad;
    const req = buildTranscribeRequest(settings, base64);
    return withModelRecovery(async () => {
      try {
        const res = await window.Capacitor.Plugins.CapacitorHttp.request({ url: req.url, method: 'POST', headers: req.headers, data: req.body, connectTimeout: 15000, readTimeout: 30000 });
        const detail = await readDetail(res);
        if (res.status < 200 || res.status >= 300) return { ok: false, ...sttErrorFromStatus(res.status, detail) };
        const text = extractTranscript(typeof res.data === 'string' ? JSON.parse(res.data) : res.data);
        if (text === null) return { ok: false, code: 'error', message: 'Gemini sent an unreadable answer.' };
        return text ? { ok: true, text } : { ok: false, code: 'no-speech', message: "I didn't catch that." };
      } catch { return { ok: false, code: 'network', message: "Couldn't reach Gemini. Are you online?" }; }
    }, window.Capacitor.Plugins.CapacitorHttp.request.bind(window.Capacitor.Plugins.CapacitorHttp));
  },
});

const android = () => {
  const P = () => window.Capacitor.Plugins;
  return {
    name: 'android',
    nativeSpeech: true,
    llm: androidLlm(),
    stt: androidStt(),
    async execute(action) {
      if (!action) return { ok: true };
      try {
        if (action.kind === 'open-url') {
          if (!isSafeUrl(action.url)) return { ok: false, message: 'Blocked unsafe link.' };
          await P().AppLauncher.openUrl({ url: action.url });
          return { ok: true };
        }
        if (action.kind === 'open-app') {
          const app = APPS[action.appId];
          if (!app) return { ok: false, message: 'Unknown app.' };
          if (app.uri) {
            const url = action.query && app.search ? app.search(action.query) : app.uri;
            await P().AppLauncher.openUrl({ url });
            return { ok: true };
          }
          if (app.android && app.android.package) {
            await P().AppLauncher.openUrl({ url: app.android.package });
            return { ok: true };
          }
          return { ok: false, message: `${app.label} is not available on Android.` };
        }
      } catch (e) {
        return { ok: false, message: String((e && e.message) || e) };
      }
      return { ok: false, message: 'Unsupported action.' };
    },
    onToggleListen: noop,
    onTypeCommand: noop,
    onOpenSettings: noop,
    setInteractive: noop,
    moveBy: noop,
  };
};

const web = () => ({
  name: 'web',
  nativeSpeech: false,
  stt: null,
  llm: null, // AI chat needs the desktop or Android app (browser CORS/CSP)
  async execute(action) {
    if (!action) return { ok: true };
    let url = null;
    if (action.kind === 'open-url') url = action.url;
    else if (action.kind === 'open-app') {
      const app = APPS[action.appId];
      if (app && app.uri) url = action.query && app.search ? app.search(action.query) : app.uri;
    }
    if (!url || !isSafeUrl(url)) return { ok: false, message: 'Not available in the browser preview.' };
    window.open(url, '_blank', 'noopener');
    return { ok: true };
  },
  onToggleListen: noop,
  onOpenSettings: noop,
  onTypeCommand: noop,
  setInteractive: noop,
  moveBy: noop,
});

const kind = detect();
export const platform = kind === 'desktop' ? desktop() : kind === 'android' ? android() : web();
if (kind === 'web') document.body.classList.add('web-preview');
