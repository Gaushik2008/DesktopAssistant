// Speech-to-text provider with graceful fallback.
//
// listen() resolves with a transcript string, or rejects with Error whose
// `code` is one of: 'unsupported' | 'cancelled' | 'no-speech' | 'denied' | 'network' | 'error'.
// The UI turns 'unsupported' / 'network' / 'denied' into the typed-command box.
//
// Providers, in priority order:
//   1. Capacitor native recognizer (Android)      @capacitor-community/speech-recognition
//   2. Web Speech API (Chromium browsers)         webkitSpeechRecognition
//      NOTE: stock Electron ships Web Speech without Google keys, so it usually
//      fails with 'network' -> typed fallback. A local engine (Vosk/whisper.cpp)
//      is on the roadmap.

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

let activeCancel = null;

export function cancelListening() {
  if (activeCancel) activeCancel();
}

export function speechSupported() {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  return Boolean(cap || window.SpeechRecognition || window.webkitSpeechRecognition);
}

export async function listen({ lang = 'en-US' } = {}) {
  const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SpeechRecognition;
  if (cap && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return listenNative(cap, lang);
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) throw err('unsupported', 'Speech recognition is not available here.');
  return listenWeb(Ctor, lang);
}

function listenWeb(Ctor, lang) {
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; activeCancel = null; fn(v); } };
    activeCancel = () => { try { rec.abort(); } catch { /* ignore */ } finish(reject, err('cancelled')); };
    rec.onresult = (e) => finish(resolve, e.results[0][0].transcript);
    rec.onerror = (e) => {
      const map = { 'no-speech': 'no-speech', 'not-allowed': 'denied', 'service-not-allowed': 'denied', network: 'network', aborted: 'cancelled' };
      finish(reject, err(map[e.error] || 'error', e.error));
    };
    rec.onend = () => finish(reject, err('no-speech'));
    try { rec.start(); } catch (e) { finish(reject, err('error', String(e))); }
  });
}

async function listenNative(cap, lang) {
  const perm = await cap.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw err('denied');
  let cancelled = false;
  activeCancel = () => { cancelled = true; cap.stop().catch(() => {}); };
  try {
    const res = await cap.start({ language: lang, maxResults: 1, partialResults: false, popup: false });
    if (cancelled) throw err('cancelled');
    const text = res && res.matches && res.matches[0];
    if (!text) throw err('no-speech');
    return text;
  } finally {
    activeCancel = null;
  }
}
