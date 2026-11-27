// Speech-to-text, in priority order (user configurable via settings):
//   1. gemini       - record mic -> 16 kHz WAV -> platform.stt.transcribe (desktop main process /
//                     Android native HTTP; the API key never touches the renderer on desktop)
//   2. web-speech   - Web Speech API (browser, no key). Does NOT work in Electron.
//   3. android-native - Android on-device recognizer (Capacitor SpeechRecognition plugin)
//   4. local        - Whisper.cpp via Tauri sidecar (coming soon)
//
// listen({onLevel}) resolves with the transcript, or rejects with Error.code:
//   'nokey' | 'nogemini' | 'badkey' | 'badmodel' | 'quota' | 'network' | 'denied' | 'no-mic' |
//   'no-speech' | 'cancelled' | 'unsupported' | 'error'

import { platform } from './platform.js';
import { record } from './recorder.js';

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

let current = null; // { stop(), cancel() }

export function cancelListening() { if (current) current.cancel(); }
export function stopListening() { if (current) current.stop(); }

const capPlugin = () => window.Capacitor?.Plugins?.SpeechRecognition;
const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());
const webSpeech = () => (navigator.userAgent.includes('Electron') ? null : window.SpeechRecognition || window.webkitSpeechRecognition);
const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia);

/** True when at least one speech path exists (Gemini pipeline counts: it asks for a key if missing). */
export function speechSupported() {
  const engine = platform.getSttEngine?.() || 'gemini';
  if (engine === 'gemini') return Boolean(platform.stt && canRecord());
  if (engine === 'web-speech') return Boolean(webSpeech());
  if (engine === 'android-native') return Boolean(isNative() && capPlugin());
  if (engine === 'local') return false; // not implemented yet
  return Boolean((platform.stt && canRecord()) || (isNative() && capPlugin()) || webSpeech());
}

export async function listen({ onLevel = () => {}, lang = 'en-US', passive = false } = {}) {
  const engine = platform.getSttEngine?.() || 'gemini';

  // Try the selected engine first
  if (engine === 'gemini') {
    if (platform.stt && canRecord()) {
      try {
        return await listenGemini(onLevel, passive);
      } catch (e) {
        // Gemini unusable on a phone -> fall back to the on-device recognizer instead of failing.
        const gemini = ['nokey', 'nogemini', 'badkey', 'badmodel', 'network'].includes(e.code);
        if (!(gemini && isNative() && capPlugin())) throw e;
      }
    }
    // Fall through to native if Gemini failed on Android
    if (isNative() && capPlugin()) return listenNative(capPlugin(), lang);
    const Ctor = webSpeech();
    if (Ctor) return listenWeb(Ctor, lang);
    throw err('unsupported', 'Speech recognition is not available here.');
  }

  if (engine === 'web-speech') {
    const Ctor = webSpeech();
    if (Ctor) return listenWeb(Ctor, lang);
    // Fallback to Gemini if web speech not available
    if (platform.stt && canRecord()) {
      try {
        return await listenGemini(onLevel, passive);
      } catch (e) {
        const gemini = ['nokey', 'nogemini', 'badkey', 'badmodel', 'network'].includes(e.code);
        if (!(gemini && isNative() && capPlugin())) throw e;
      }
    }
    if (isNative() && capPlugin()) return listenNative(capPlugin(), lang);
    throw err('unsupported', 'Web Speech API is not available in this browser.');
  }

  if (engine === 'android-native') {
    if (isNative() && capPlugin()) return listenNative(capPlugin(), lang);
    // Fallback to Gemini
    if (platform.stt && canRecord()) {
      try {
        return await listenGemini(onLevel, passive);
      } catch (e) {
        const gemini = ['nokey', 'nogemini', 'badkey', 'badmodel', 'network'].includes(e.code);
        if (!(gemini && isNative() && capPlugin())) throw e;
      }
    }
    const Ctor = webSpeech();
    if (Ctor) return listenWeb(Ctor, lang);
    throw err('unsupported', 'Android native speech recognition is not available.');
  }

  if (engine === 'local') {
    // Local STT stub - not implemented yet
    throw err('unsupported', 'Local STT (Whisper.cpp) is not implemented yet');
  }

  // Default fallback (should not reach here)
  if (platform.stt && canRecord()) {
    try {
      return await listenGemini(onLevel, passive);
    } catch (e) {
      const gemini = ['nokey', 'nogemini', 'badkey', 'badmodel', 'network'].includes(e.code);
      if (!(gemini && isNative() && capPlugin())) throw e;
    }
  }
  if (isNative() && capPlugin()) return listenNative(capPlugin(), lang);
  const Ctor = webSpeech();
  if (Ctor) return listenWeb(Ctor, lang);
  throw err('unsupported', 'Speech recognition is not available here.');
}

async function listenGemini(onLevel, passive = false) {
  // Passive (wake-word) listening waits longer for speech so re-arming gaps are rare.
  const rec = record(passive ? { onLevel, noSpeechMs: 30000, maxMs: 15000 } : { onLevel });
  let cancelled = false;
  const mine = { stop: rec.stop, cancel: () => { cancelled = true; rec.cancel(); } };
  current = mine;
  try {
    const clip = await rec.result;
    if (cancelled) throw err('cancelled');
    const out = await platform.stt.transcribe(clip.base64, clip.mime);
    if (cancelled) throw err('cancelled');
    if (!out || !out.ok) throw err((out && out.code) || 'error', out && out.message);
    return out.text;
  } finally {
    if (current === mine) current = null; // a newer listen() may already own `current`
  }
}

async function listenNative(cap, lang) {
  const perm = await cap.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw err('denied');
  let cancelled = false;
  current = { stop: () => cap.stop().catch(() => {}), cancel: () => { cancelled = true; cap.stop().catch(() => {}); } };
  try {
    const res = await cap.start({ language: lang, maxResults: 1, partialResults: false, popup: false });
    if (cancelled) throw err('cancelled');
    const text = res?.matches?.[0];
    if (!text) throw err('no-speech');
    return text;
  } finally {
    current = null;
  }
}

function listenWeb(Ctor, lang) {
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; current = null; fn(v); } };
    current = { stop: () => rec.stop(), cancel: () => { try { rec.abort(); } catch { /* ignore */ } finish(reject, err('cancelled')); } };
    rec.onresult = (e) => finish(resolve, e.results[0][0].transcript);
    rec.onerror = (e) => {
      const map = { 'no-speech': 'no-speech', 'not-allowed': 'denied', 'service-not-allowed': 'denied', network: 'network', aborted: 'cancelled' };
      finish(reject, err(map[e.error] || 'error', e.error));
    };
    rec.onend = () => finish(reject, err('no-speech'));
    try { rec.start(); } catch (e) { finish(reject, err('error', String(e))); }
  });
}