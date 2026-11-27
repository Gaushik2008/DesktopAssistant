import { mountPet } from './pet.js';
import { platform } from './platform.js';
import { parse } from './core/intents.js';
import { IDLE_QUIPS, pick } from './core/personality.js';
import { PRESETS, validateSettings, trimHistory } from './core/llm.js';
import { tts } from './tts.js';
import { runLocalAction } from './local-actions.js';
import { listen, cancelListening, stopListening as finishListening, speechSupported } from './speech.js';
import { matchWake } from './core/wake.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), bubble = $('bubble'), bubbleText = $('bubble-text');
const ear = $('ear');
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

// `voice`: text to speak aloud (default: the bubble text); pass false for silent bubbles.
function say(text, { ms = 6000, speaking = true, voice = text } = {}) {
  bubbleText.textContent = text;
  if (voice) tts.speak(voice);
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
    if (state === 'idle' && typebox.classList.contains('hidden')) say(pick(IDLE_QUIPS), { ms: 4500, voice: false });
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

  // Just the name ("DO.IT"): answer a pending "yes", otherwise say hello and listen for the command.
  if (res.intent === 'wake') {
    if (pendingFollowUp) {
      res = { intent: 'follow-up', reply: 'On it.', action: pendingFollowUp };
      pendingFollowUp = null;
    } else {
      setState('idle');
      say('Yes?', { ms: 2500 });
      return startListening();
    }
  }

  // Anything the command parser doesn't understand goes to the AI (if this platform has one).
  if (res.intent === 'unknown' && platform.llm) return askAI(text);

  let reply = res.reply;
  if (res.action && res.action.kind === 'handsfree') {
    if (res.action.enabled && !speechSupported()) reply = "I can't listen on this device. Type a command instead.";
    else setHandsFree(res.action.enabled);
    res = { ...res, action: null };
  }
  if (res.action) {
    const local = runLocalAction(res.action, { onAlarm: (msg) => say(msg, { ms: 12000 }) });
    if (local.handled) {
      if (local.reply) reply = local.reply;
      if (res.action.kind === 'tts') syncSpeaker();
      res = { ...res, action: null };
    }
  }

  const heard = res.intent === 'empty' ? '' : `"${text.replace(/[.!?]+$/, '')}." `;
  say(heard + reply, { ms: 5500, voice: reply });
  if (res.action) {
    const out = await platform.execute(res.action);
    if (!out.ok) say(out.message || "I couldn't do that.", { ms: 5000 });
  }
}

async function startListening() {
  if (state === 'listening') return finishListening(); // tap again = "I'm done talking"
  if (!speechSupported()) return openTypebox('Voice is not available here - type a command.');
  if (passiveActive) cancelListening(); // hand the mic over from wake-word listening
  setState('listening');
  tts.stop(); // don't let the mic hear DO.IT
  say('Listening... (Esc to cancel)', { ms: 15000, speaking: false, voice: false });
  try {
    const text = await listen({ onLevel: (l) => mic.style.setProperty('--lvl', l.toFixed(2)) });
    await handleTranscript(text);
  } catch (e) {
    mic.style.setProperty('--lvl', 0);
    setState('idle');
    return reportListenError(e);
  }
}

async function reportListenError(e) {
  switch (e.code) {
    case 'cancelled': return say('Cancelled.', { ms: 1500, speaking: false, voice: false });
    case 'no-speech': return say("I didn't catch that. Try again?", { ms: 3500 });
    case 'nokey':
    case 'nogemini':
    case 'badkey':
    case 'badmodel':
      await openSettings();
      return say(e.message || 'Check your Gemini settings.', { ms: 7000 });
    case 'quota': return say(e.message, { ms: 5000 });
    case 'network': return openTypebox(`${e.message || "Couldn't reach Gemini."} You can type instead.`);
    case 'denied': return openTypebox('Microphone access was denied. Allow it in your system privacy settings, or type instead.');
    case 'no-mic': return openTypebox('No microphone found. Type a command instead.');
    default: return openTypebox(`Voice failed (${e.message || e.code}). Type a command instead.`);
  }
}

// ----------------------------------------- hands-free (wake word "DO.IT") ----
// Always-listening loop: record one utterance (voice-activity detection), transcribe it, and act
// ONLY if it starts with the name. Everything else is dropped on the spot - never stored or
// executed. NOTE: with the Gemini engine each detected utterance is sent for transcription, so
// ambient speech near the mic leaves the device. Turn it off with the ear button or "stop listening".
const HF_KEY = 'sirpixel.handsfree';
const HF_KEY_ERRORS = new Set(['nokey', 'nogemini', 'badkey', 'badmodel']);
let hfPaused = false; // paused only because the Gemini key/model is unusable; resumes after a good save
const HF_FATAL = new Set(['nokey', 'nogemini', 'badkey', 'badmodel', 'quota', 'denied', 'no-mic', 'unsupported']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let handsFree = (() => { try { const v = localStorage.getItem(HF_KEY); return v === null ? true : v === '1'; } catch { return true; } })();
let hfLoop = false;
let passiveActive = false;

function syncEar() {
  ear.classList.toggle('hidden', !speechSupported());
  ear.setAttribute('aria-pressed', String(handsFree));
  ear.title = handsFree ? 'Always listening for "DO.IT" (click to turn off)' : 'Always listening: off (click to turn on)';
}

function setHandsFree(on) {
  handsFree = Boolean(on) && speechSupported();
  try { localStorage.setItem(HF_KEY, handsFree ? '1' : '0'); } catch { /* storage unavailable */ }
  syncEar();
  if (handsFree) startHandsFree();
  else if (passiveActive) cancelListening();
}

async function startHandsFree() {
  if (hfLoop || !handsFree || !speechSupported()) return;
  // No key yet: don't record ambient speech just to fail; wait until settings are saved.
  if (platform.stt && platform.llm) {
    const cfg = await platform.llm.getSettings().catch(() => null);
    if (cfg && !cfg.hasKey) { hfPaused = true; handsFree = false; syncEar(); return; }
    if (hfLoop || !handsFree) return;
  }
  hfLoop = true;
  let errors = 0;
  try {
    while (handsFree) {
      const busy = state !== 'idle' || tts.isSpeaking() ||
        !settingsForm.classList.contains('hidden') || !typebox.classList.contains('hidden');
      if (busy) { await sleep(400); continue; }

      let text;
      passiveActive = true;
      try {
        text = await listen({ passive: true });
        errors = 0;
      } catch (e) {
        if (e.code === 'cancelled' || e.code === 'no-speech') { await sleep(150); continue; }
        if (HF_FATAL.has(e.code)) {
          handsFree = false;
          hfPaused = HF_KEY_ERRORS.has(e.code);
          if (!hfPaused) { try { localStorage.setItem(HF_KEY, '0'); } catch { /* ignore */ } }
          syncEar();
          await reportListenError(e);
          break;
        }
        if (++errors >= 5) { setHandsFree(false); say('Always-listening stopped after repeated errors. Tap the ear to retry.', { ms: 6000 }); break; }
        await sleep(Math.min(30000, 1500 * 2 ** errors));
        continue;
      } finally {
        passiveActive = false;
      }

      const wake = matchWake(text);
      if (!wake.matched) continue; // ambient speech: ignore
      await handleTranscript(text);
    }
  } finally {
    hfLoop = false;
  }
}

ear.addEventListener('click', () => {
  const on = !handsFree;
  setHandsFree(on);
  say(on ? 'Listening. Say "DO.IT" before a command.' : 'Always-listening off. Tap the mic to talk.', { ms: 3500 });
});

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


// ------------------------------------------------------------- AI chat -----
// Replies are only ever DISPLAYED - never parsed into commands or executed.
let aiHistory = [];

async function askAI(text) {
  const settings = await platform.llm.getSettings();
  const v = validateSettings(settings);
  if (!v.ok) {
    openSettings();
    say(`Let's set up the AI first: ${v.error}`, { ms: 6000 });
    return;
  }
  setState('thinking');
  say('Thinking...', { ms: 30000, voice: false });
  const out = await platform.llm.chat(trimHistory(aiHistory), text);
  if (out.ok) {
    aiHistory = trimHistory([...aiHistory, { role: 'user', content: text }, { role: 'assistant', content: out.reply }]);
    say(out.reply, { ms: Math.min(4000 + out.reply.length * 60, 20000) });
  } else {
    say(out.message || "I couldn't reach the AI.", { ms: 7000 });
  }
  setState('idle');
}

// ---------------------------------------------------------- AI settings -----
const settingsForm = $('settings'), gear = $('gear');
const fProvider = $('llm-provider'), fUrl = $('llm-url'), fModel = $('llm-model'), fKey = $('llm-key'), fStatus = $('llm-status');
const fSttEngine = document.querySelectorAll('input[name="stt-engine"]');
const fSttStatus = $('stt-status');

function setStatus(msg, kind = '') { fStatus.textContent = msg; fStatus.className = `status ${kind}`.trim(); }
function setSttStatus(msg, kind = '') { fSttStatus.textContent = msg; fSttStatus.className = `status ${kind}`.trim(); }

async function openSettings() {
  if (!platform.llm) { say('AI chat works in the desktop and Android apps.', { ms: 4000 }); return; }
  const cur = await platform.llm.getSettings();
  fProvider.value = cur.provider; fUrl.value = cur.baseUrl || ''; fModel.value = cur.model || ''; fKey.value = '';
  setStatus(cur.hasKey ? 'A key is saved. Leave blank to keep it.' : '');
  // STT engine
  const sttEngine = await platform.getSttEngine?.();
  for (const radio of fSttEngine) radio.checked = radio.value === sttEngine;
  setSttStatus('');
  settingsForm.classList.remove('hidden');
  platform.setInteractive(true);
  fModel.focus();
}
function closeSettings() { settingsForm.classList.add('hidden'); fKey.value = ''; }

gear.addEventListener('click', () => (settingsForm.classList.contains('hidden') ? openSettings() : closeSettings()));
$('llm-close').addEventListener('click', closeSettings);
fProvider.addEventListener('change', () => {
  const p = PRESETS[fProvider.value];
  if (p && fProvider.value !== 'custom') { fUrl.value = p.baseUrl; fModel.value = p.model; }
});
for (const radio of fSttEngine) {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    setSttStatus('Saving...');
    await platform.setSttEngine(radio.value);
    setSttStatus(`STT engine set to ${radio.value}`, 'ok');
  });
}
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('Saving...');
  const saved = await platform.llm.saveSettings({
    provider: fProvider.value, baseUrl: fUrl.value.trim(), model: fModel.value.trim(), apiKey: fKey.value.trim(),
  });
  fKey.value = '';
  const v = validateSettings(saved);
  if (!v.ok) { setStatus(v.error, 'err'); return; }
  setStatus('Testing...');
  const out = await platform.llm.chat([], 'Say hello in five words.');
  if (out.ok) {
    aiHistory = [];
    if (out.model) fModel.value = out.model; // model was auto-corrected by the main process
    setStatus(`Connected${out.model ? ` (using ${out.model})` : ''}: ${out.reply.slice(0, 50)}`, 'ok');
    if (hfPaused) { hfPaused = false; setHandsFree(true); }
  } else setStatus(out.message, 'err');
});

// ------------------------------------------------------- voice toggle -----
const speaker = $('speaker');
function syncSpeaker() {
  speaker.classList.toggle('hidden', !tts.supported());
  const on = tts.isEnabled();
  speaker.textContent = on ? '\u{1F50A}' : '\u{1F507}';
  speaker.setAttribute('aria-pressed', String(on));
  speaker.title = on ? 'Spoken replies: on (click to turn off)' : 'Spoken replies: off (click to turn on)';
}
speaker.addEventListener('click', () => {
  const on = tts.setEnabled(!tts.isEnabled());
  syncSpeaker();
  say(on ? 'Voice on. I will read my replies aloud.' : 'Voice off.', { ms: 2500 });
});
syncSpeaker();

// ------------------------------------------------------------- UI events ----
mic.addEventListener('click', startListening);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state === 'listening') stopListening();
    tts.stop();
    closeTypebox();
    closeSettings();
  }
});
pet.addEventListener('dblclick', () => say(pick(IDLE_QUIPS), { ms: 4000, voice: false }));

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
for (const el of [pet, mic, bubble, typebox, settingsForm, gear, speaker, ear]) {
  el.addEventListener('mouseenter', () => platform.setInteractive(true));
  el.addEventListener('mouseleave', () => {
    if (typebox.classList.contains('hidden') && settingsForm.classList.contains('hidden') && document.activeElement !== typeinput) platform.setInteractive(false);
  });
}

// Global hotkeys / tray (desktop)
platform.onToggleListen(startListening);
platform.onTypeCommand(() => openTypebox());
platform.onOpenSettings(() => openSettings());

// ----------------------------------------------------------------- boot ----
(async () => {
  // First run: Gemini powers both voice and chat, so ask for the key right away.
  const cfg = platform.llm ? await platform.llm.getSettings().catch(() => null) : null;
  if (cfg && !cfg.hasKey && PRESETS[cfg.provider]?.needsKey) {
    await openSettings();
    say('Welcome! Paste your Gemini API key so I can hear you.', { ms: 8000, voice: false });
  } else {
    say('Ready when you are.', { ms: 3500, voice: false });
  }
})();
scheduleIdle();
syncEar();
startHandsFree();
