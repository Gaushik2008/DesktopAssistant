// Actions that live entirely in the renderer (no OS access): timers, reminders, notes.
// State is kept in memory and mirrored to localStorage when available.

import { tts } from './tts.js';

const NOTES_KEY = 'sirpixel.notes';
const timers = new Set();

function load() {
  try { const v = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(list.slice(-50))); } catch { /* storage unavailable */ }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 880; gain.gain.value = 0.08;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch { /* audio unavailable */ }
}

function notify(text) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification('DO.IT', { body: text });
  } catch { /* ignore */ }
}

/**
 * Run a renderer-local action.
 * @returns {{handled: boolean, reply?: string}} handled=false when the action belongs to the platform bridge.
 */
export function runLocalAction(action, { onAlarm }) {
  switch (action.kind) {
    case 'timer': {
      try {
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      } catch { /* ignore */ }
      const id = setTimeout(() => {
        timers.delete(id);
        beep(); notify(action.label);
        onAlarm(`${action.label} - time's up!`);
      }, Math.min(action.ms, 2 ** 31 - 1));
      timers.add(id);
      return { handled: true };
    }
    case 'note': {
      const list = load(); list.push({ text: action.text, at: Date.now() }); save(list);
      return { handled: true };
    }
    case 'list-notes': {
      const list = load();
      return { handled: true, reply: list.length ? `You have ${list.length} note${list.length === 1 ? '' : 's'}: ${list.map((n) => n.text).join('; ')}.` : 'You have no notes yet.' };
    }
    case 'clear-notes':
      save([]);
      return { handled: true };
    case 'tts': {
      if (action.enabled && !tts.supported()) return { handled: true, reply: "Speech isn't supported on this device." };
      tts.setEnabled(action.enabled);
      return { handled: true };
    }
    case 'tts-stop':
      tts.stop();
      return { handled: true };
    default:
      return { handled: false };
  }
}

export function activeTimerCount() { return timers.size; }
