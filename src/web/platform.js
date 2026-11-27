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
  getSttEngine: () => window.assistant.stt?.getSttEngine?.() || 'gemini',
  setSttEngine: (engine) => window.assistant.stt?.setSttEngine?.(engine) || writeStt(engine),
});

// Android: settings live in the app's private WebView storage; HTTP goes through the native
// CapacitorHttp plugin (no CORS, and it can reach a PC on your LAN running Ollama/LM Studio).
const LLM_KEY = 'sirpixel.llm';
const STT_KEY = 'sirpixel.stt';
const llmDefaults = { provider: 'gemini', baseUrl: PRESETS.gemini.baseUrl, model: PRESETS.gemini.model };
const sttDefaults = { engine: 'gemini' };
const readLlm = () => { try { return { ...llmDefaults, ...JSON.parse(localStorage.getItem(LLM_KEY) || '{}') }; } catch { return { ...llmDefaults }; } };
const readStt = () => { try { return { ...sttDefaults, ...JSON.parse(localStorage.getItem(STT_KEY) || '{}') }; } catch { return { ...sttDefaults }; } };
const writeStt = (engine) => { try { localStorage.setItem(STT_KEY, JSON.stringify({ engine })); } catch { /* ignore */ } };

const androidLlm = () => ({
  async getSettings() { const d = readLlm(); return { provider: d.provider, baseUrl: d.baseUrl, model: d.model, hasKey: Boolean(d.apiKey) }; },
  async saveSettings(input) {
    const cur = readLlm();
    const next = { provider: input.provider || cur.provider, baseUrl: String(input.baseUrl ?? cur.baseUrl).trim(), model: String(input.model ?? cur.model).trim(), apiKey: cur.apiKey };
    if (next.baseUrl !== cur.baseUrl && !input.apiKey) next.apiKey = undefined; // never re-send a key to a different server
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
    try {
      const res = await window.Capacitor.Plugins.CapacitorHttp.request({ url: req.url, method: 'POST', headers: req.headers, data: req.body, connectTimeout: 15000, readTimeout: 30000 });
      if (res.status < 200 || res.status >= 300) return { ok: false, message: friendlyHttpError(res.status, host) };
      const reply = extractReply(typeof res.data === 'string' ? JSON.parse(res.data) : res.data);
      return reply ? { ok: true, reply } : { ok: false, message: 'The AI sent an empty answer.' };
    } catch { return { ok: false, message: `Couldn't reach ${host}. Is it running / are you online?` }; }
  },
});

const androidStt = () => ({
  async transcribe(base64) {
    const settings = readLlm();
    const bad = checkSttReady(settings, base64);
    if (bad) return bad;
    const req = buildTranscribeRequest(settings, base64);
    try {
      const res = await window.Capacitor.Plugins.CapacitorHttp.request({ url: req.url, method: 'POST', headers: req.headers, data: req.body, connectTimeout: 15000, readTimeout: 30000 });
      if (res.status < 200 || res.status >= 300) return { ok: false, ...sttErrorFromStatus(res.status) };
      const text = extractTranscript(typeof res.data === 'string' ? JSON.parse(res.data) : res.data);
      if (text === null) return { ok: false, code: 'error', message: 'Gemini sent an unreadable answer.' };
      return text ? { ok: true, text } : { ok: false, code: 'no-speech', message: "I didn't catch that." };
    } catch { return { ok: false, code: 'network', message: "Couldn't reach Gemini. Are you online?" }; }
  },
});

// Web Speech API STT (browser-only, no API key needed)
const webSpeechStt = () => ({
  async transcribe() {
    return { ok: false, code: 'unsupported', message: 'Web Speech API is used directly in speech.js, not via platform.stt' };
  },
});

// Android native STT (Capacitor SpeechRecognition plugin)
const androidNativeStt = () => ({
  async transcribe() {
    return { ok: false, code: 'unsupported', message: 'Android native STT is used directly in speech.js, not via platform.stt' };
  },
});

// Local STT stub (Whisper.cpp via Tauri sidecar - coming soon)
const localStt = () => ({
  async transcribe() {
    return { ok: false, code: 'unsupported', message: 'Local STT (Whisper.cpp) is not implemented yet' };
  },
});

// Build the STT implementation based on user's engine choice
function buildStt() {
  const { engine } = readStt();
  switch (engine) {
    case 'web-speech': return webSpeechStt();
    case 'android-native': return androidNativeStt();
    case 'local': return localStt();
    case 'gemini':
    default: return androidStt(); // On Android, Gemini uses CapacitorHttp; on desktop it's in window.assistant.stt
  }
}

const android = () => {
  const P = () => window.Capacitor.Plugins;
  return {
    name: 'android',
    nativeSpeech: true,
    llm: androidLlm(),
    stt: buildStt(),
    getSttEngine: () => readStt().engine,
    setSttEngine: (engine) => { writeStt(engine); return readStt(); },
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
  stt: buildStt(),
  llm: null, // AI chat needs the desktop or Android app (browser CORS/CSP)
  getSttEngine: () => readStt().engine,
  setSttEngine: (engine) => { writeStt(engine); return readStt(); },
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
