// Spoken replies via the built-in Web Speech synthesis (no network, no keys).
// Off by default; the choice is remembered in localStorage when available.

const KEY = 'sirpixel.tts';
const MAX_CHARS = 400;
let enabled = false;
try { enabled = JSON.parse(localStorage.getItem(KEY) || '{}').enabled === true; } catch { /* storage unavailable */ }

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;

export const tts = {
  supported() { return Boolean(synth()) && typeof window.SpeechSynthesisUtterance === 'function'; },
  isEnabled() { return enabled && this.supported(); },
  setEnabled(v) {
    enabled = Boolean(v) && this.supported();
    try { localStorage.setItem(KEY, JSON.stringify({ enabled })); } catch { /* ignore */ }
    if (!enabled) this.stop();
    return enabled;
  },
  /** Speak `text` if voice is on. Interrupts anything already being spoken. */
  speak(text) {
    if (!this.isEnabled() || typeof text !== 'string') return false;
    const clean = text.replace(/https?:\/\/\S+/g, 'a link').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
    if (!clean) return false;
    const s = synth();
    s.cancel();
    const u = new window.SpeechSynthesisUtterance(clean);
    u.lang = (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
    u.rate = 1; u.pitch = 1;
    s.speak(u);
    return true;
  },
  isSpeaking() { const s = synth(); return Boolean(s && (s.speaking || s.pending)); },
  stop() { const s = synth(); if (s) s.cancel(); },
};
