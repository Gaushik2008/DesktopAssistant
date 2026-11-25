import { mountPet } from './pet.js';
import { platform } from './platform.js';
import { parse } from './core/intents.js';
import { IDLE_QUIPS, pick } from './core/personality.js';
import { runLocalAction } from './local-actions.js';
import { listen, cancelListening, speechSupported } from './speech.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), bubble = $('bubble'), bubbleText = $('bubble-text');
const pet = $('pet'), mic = $('mic'), typebox = $('typebox'), typeinput = $('typeinput');

mountPet(pet);

// ---------------------------------------------------------------- state ----
let state = 'idle';
let bubbleTimer = null;
let idleTimer = null;

function setState(s) {
  state = s;
  stage.className = `state-${s}`;
}

function say(text, { ms = 6000, speaking = true } = {}) {
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  if (speaking) setState('speaking');
  clearTimeout(bubbleTimer);
  // roughly: talking animation while the bubble is fresh, then calm down
  setTimeout(() => { if (state === 'speaking') setState('idle'); }, Math.min(ms, 1800 + text.length * 25));
  bubbleTimer = setTimeout(hideBubble, ms + text.length * 30);
}

function hideBubble() {
  bubble.classList.add('hidden');
  if (state === 'speaking') setState('idle');
}

$('bubble-close').addEventListener('click', hideBubble);

// ----------------------------------------------------------- idle quips ----
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state === 'idle' && typebox.classList.contains('hidden')) say(pick(IDLE_QUIPS), { ms: 4500 });
    scheduleIdle();
  }, 25000 + Math.random() * 35000);
}

// ------------------------------------------------------------- commands ----
let pendingFollowUp = null;

async function handleTranscript(text) {
  setState('thinking');
  let res = parse(text);

  // "yes" after "Want me to search for it?" runs the stored follow-up.
  if (res.intent === 'confirm') {
    if (pendingFollowUp) {
      res = { intent: 'follow-up', reply: 'On it.', action: pendingFollowUp };
      pendingFollowUp = null;
    } else {
      res = { intent: 'confirm', reply: "Yes to what? I'm not waiting on anything.", action: null };
    }
  } else {
    pendingFollowUp = res.followUp || null;
  }

  let reply = res.reply;
  if (res.action) {
    const local = runLocalAction(res.action, { onAlarm: (msg) => say(msg, { ms: 12000 }) });
    if (local.handled) {
      if (local.reply) reply = local.reply;
      res = { ...res, action: null };
    }
  }

  const heard = res.intent === 'empty' ? '' : `"${text.replace(/[.!?]+$/, '')}." `;
  say(heard + reply, { ms: 5500 });
  if (res.action) {
    const out = await platform.execute(res.action);
    if (!out.ok) say(out.message || "I couldn't do that.", { ms: 5000 });
  }
}

async function startListening() {
  if (state === 'listening') return stopListening();
  if (!speechSupported()) return openTypebox('Voice is not available here - type a command.');
  setState('listening');
  say('Listening... (Esc to cancel)', { ms: 15000, speaking: false });
  try {
    const text = await listen();
    await handleTranscript(text);
  } catch (e) {
    setState('idle');
    if (e.code === 'cancelled') return say('Cancelled.', { ms: 1500, speaking: false });
    if (e.code === 'no-speech') return say("I didn't catch that. Try again?", { ms: 3500 });
    if (['network', 'unsupported', 'denied', 'error'].includes(e.code)) {
      const why = e.code === 'denied' ? 'Microphone permission was denied.' : 'Voice recognition is unavailable here.';
      return openTypebox(`${why} Type a command instead.`);
    }
  }
}

function stopListening() {
  cancelListening();
  setState('idle');
}

// --------------------------------------------------------- typed fallback ---
function openTypebox(message) {
  if (message) say(message, { ms: 4000 });
  typebox.classList.remove('hidden');
  platform.setInteractive(true);
  typeinput.focus();
}
function closeTypebox() {
  typebox.classList.add('hidden');
  typeinput.value = '';
}
typebox.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = typeinput.value.trim();
  closeTypebox();
  if (v) handleTranscript(v);
});

// ------------------------------------------------------------- UI events ----
mic.addEventListener('click', startListening);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state === 'listening') stopListening();
    closeTypebox();
  }
});
pet.addEventListener('dblclick', () => say(pick(IDLE_QUIPS), { ms: 4000 }));

// Dragging the pet (desktop moves the whole window; elsewhere it's a no-op).
let drag = null;
pet.addEventListener('pointerdown', (e) => {
  drag = { x: e.screenX, y: e.screenY };
  pet.setPointerCapture(e.pointerId);
});
pet.addEventListener('pointermove', (e) => {
  if (!drag) return;
  platform.moveBy(e.screenX - drag.x, e.screenY - drag.y);
  drag = { x: e.screenX, y: e.screenY };
});
pet.addEventListener('pointerup', () => { drag = null; });

// Click-through on desktop: only the pet, mic, bubble and typebox catch the mouse.
for (const el of [pet, mic, bubble, typebox]) {
  el.addEventListener('mouseenter', () => platform.setInteractive(true));
  el.addEventListener('mouseleave', () => {
    if (typebox.classList.contains('hidden') && document.activeElement !== typeinput) platform.setInteractive(false);
  });
}

// Global hotkeys / tray (desktop)
platform.onToggleListen(startListening);
platform.onTypeCommand(() => openTypebox());

// ----------------------------------------------------------------- boot ----
setTimeout(() => say('Ready when you are.', { ms: 3500 }), 600);
scheduleIdle();
