// UI integration tests: load the real index.html + app.js in jsdom (desktop bridge stubbed)
// and drive it through the typed-command box like a user would.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const realSetTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));
// Let app timers (idle quips, bubble hide) not keep the test process alive.
globalThis.setTimeout = (...a) => { const t = realSetTimeout(...a); t.unref?.(); return t; };

const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;

const executed = [];
const hooks = {};
const llmState = { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', hasKey: false };
const llmCalls = { chat: [], saved: [] };
let llmChatResult = { ok: true, reply: 'Because air scatters blue light.' };
window.assistant = {
  platform: 'linux',
  llm: {
    getSettings: async () => ({ ...llmState }),
    saveSettings: async (input) => { llmCalls.saved.push(input); Object.assign(llmState, { provider: input.provider, baseUrl: input.baseUrl, model: input.model }); if (input.apiKey) llmState.hasKey = true; return { ...llmState }; },
    chat: async (history, text) => { llmCalls.chat.push({ history: [...history], text }); return llmChatResult; },
  },
  execute: async (a) => { executed.push(a); return { ok: true }; },
  onToggleListen: (cb) => { hooks.toggle = cb; },
  onTypeCommand: (cb) => { hooks.type = cb; },
  setInteractive: () => {},
  moveBy: () => {},
};
const spoken = []; let cancels = 0;
window.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel: () => { cancels++; } };
window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage });

const $ = (id) => window.document.getElementById(id);
const bubbleText = () => $('bubble-text').textContent;

async function typeCommand(text) {
  hooks.type();
  $('typeinput').value = text;
  $('typebox').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(30);
}

before(async () => { await import('../src/web/app.js'); });

test('boots, mounts the pet and shows the greeting bubble', async () => {
  assert.ok($('pet').querySelector('svg'), 'pet SVG mounted');
  await sleep(700);
  assert.equal(bubbleText(), 'Ready when you are.');
  assert.equal($('bubble').classList.contains('hidden'), false);
});

test('typed "Open YouTube" echoes the command, replies and executes open-url', async () => {
  executed.length = 0;
  await typeCommand('Open YouTube.');
  assert.match(bubbleText(), /"Open YouTube\." Opened YouTube in your browser\./);
  assert.deepEqual(executed, [{ kind: 'open-url', url: 'https://www.youtube.com' }]);
  assert.equal($('typebox').classList.contains('hidden'), true, 'typebox closes after submit');
});

test('Spotify play command is sent to the platform bridge', async () => {
  executed.length = 0;
  await typeCommand('Play Graffitia by Green Day on Spotify');
  assert.deepEqual(executed, [{ kind: 'open-app', appId: 'spotify', query: 'graffitia by green day' }]);
});

test('local actions never reach the platform bridge (math, notes)', async () => {
  executed.length = 0;
  await typeCommand("what's 12 times 7");
  assert.match(bubbleText(), /12 times 7 is 84\./);
  await typeCommand('take a note buy milk');
  await typeCommand('read my notes');
  assert.match(bubbleText(), /You have 1 note: buy milk\./);
  assert.deepEqual(executed, []);
});

test('unknown app -> "yes" runs the Google search follow-up', async () => {
  executed.length = 0;
  await typeCommand('open frobnicator');
  assert.match(bubbleText(), /Want me to search for it\?/);
  assert.deepEqual(executed, []);
  await typeCommand('yes');
  assert.deepEqual(executed, [{ kind: 'open-url', url: 'https://www.google.com/search?q=frobnicator' }]);
  await typeCommand('yes');
  assert.match(bubbleText(), /Yes to what\?/);
});

test('a timer fires and the bubble announces it', async () => {
  await typeCommand('set a timer for 1 second');
  assert.match(bubbleText(), /Timer set for 1 second\./);
  await sleep(1200);
  assert.match(bubbleText(), /Timer: 1 second - time's up!/);
});

test('mic click without speech support opens the typed fallback; Esc closes it', async () => {
  $('mic').click();
  await sleep(30);
  assert.equal($('typebox').classList.contains('hidden'), false);
  assert.match(bubbleText(), /type a command/i);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('typebox').classList.contains('hidden'), true);
});

test('bubble close button hides the bubble', () => {
  $('bubble-close').click();
  assert.equal($('bubble').classList.contains('hidden'), true);
});

// ------------------------------------------------------------ AI chat ------
test('unmatched sentence goes to the AI and the reply is shown (no command echo)', async () => {
  executed.length = 0; llmCalls.chat.length = 0;
  await typeCommand('why is the sky blue');
  assert.equal(llmCalls.chat.length, 1);
  assert.equal(llmCalls.chat[0].text, 'why is the sky blue');
  assert.equal(bubbleText(), 'Because air scatters blue light.');
  assert.deepEqual(executed, [], 'AI replies are never executed');
});

test('conversation history is sent on the next turn', async () => {
  await typeCommand('and why is sunset red');
  const last = llmCalls.chat.at(-1);
  assert.deepEqual(last.history.map((m) => m.role), ['user', 'assistant']);
  assert.equal(last.history[0].content, 'why is the sky blue');
});

test('known commands never hit the AI', async () => {
  const n = llmCalls.chat.length;
  await typeCommand('open github');
  await typeCommand('what time is it');
  assert.equal(llmCalls.chat.length, n);
});

test('AI errors are shown as friendly text', async () => {
  llmChatResult = { ok: false, message: 'The API key was rejected. Check it in settings.' };
  await typeCommand('tell me about volcanoes');
  assert.equal(bubbleText(), 'The API key was rejected. Check it in settings.');
  llmChatResult = { ok: true, reply: 'Because air scatters blue light.' };
});

test('NVIDIA without a key opens settings instead of calling the AI', async () => {
  Object.assign(llmState, { provider: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'm', hasKey: false });
  const n = llmCalls.chat.length;
  await typeCommand('tell me a story about dragons');
  assert.equal(llmCalls.chat.length, n);
  await sleep(30);
  assert.equal($('settings').classList.contains('hidden'), false);
  assert.match(bubbleText(), /set up/i);
});

test('settings: picking a preset fills fields; Save & test saves the key and tests the connection', async () => {
  const sel = $('llm-provider');
  sel.value = 'ollama';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal($('llm-url').value, 'http://localhost:11434/v1');
  assert.equal($('llm-model').value, 'qwen3:4b');
  $('llm-model').value = 'qwen3:4b-instruct';
  $('llm-key').value = 'secret-key';
  llmCalls.saved.length = 0; llmCalls.chat.length = 0;
  $('settings').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(50);
  assert.equal(llmCalls.saved.length, 1);
  assert.equal(llmCalls.saved[0].model, 'qwen3:4b-instruct');
  assert.equal(llmCalls.saved[0].apiKey, 'secret-key');
  assert.equal($('llm-key').value, '', 'key field is cleared after saving');
  assert.deepEqual(llmCalls.chat[0].history, [], 'test call starts a fresh conversation');
  assert.match($('llm-status').textContent, /^Connected:/);
  assert.equal($('llm-status').className.includes('ok'), true);
});

test('settings: a failed test shows the error; Esc closes the panel', async () => {
  llmChatResult = { ok: false, message: "Couldn't reach localhost:11434. Is it running / are you online?" };
  $('settings').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(50);
  assert.match($('llm-status').textContent, /Couldn't reach/);
  assert.equal($('llm-status').className.includes('err'), true);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('settings').classList.contains('hidden'), true);
});

// ------------------------------------------------------- spoken replies ------
test('voice is off by default: replies are silent and the speaker button shows muted', async () => {
  spoken.length = 0;
  assert.equal($('speaker').classList.contains('hidden'), false, 'button visible when TTS is supported');
  assert.equal($('speaker').getAttribute('aria-pressed'), 'false');
  await typeCommand('what time is it');
  assert.deepEqual(spoken, []);
});

test('speaker button turns voice on; replies are spoken without the command echo', async () => {
  $('speaker').click();
  assert.equal($('speaker').getAttribute('aria-pressed'), 'true');
  spoken.length = 0;
  await typeCommand("what's 12 times 7");
  assert.deepEqual(spoken, ['12 times 7 is 84.']);
  assert.match(bubbleText(), /^"what's 12 times 7\." 12 times 7 is 84\./, 'bubble still shows the echo');
});

test('AI replies are spoken, "Thinking..." is not', async () => {
  Object.assign(llmState, { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', hasKey: false });
  llmChatResult = { ok: true, reply: 'Because air scatters blue light.' };
  spoken.length = 0;
  await typeCommand('why is the sky blue');
  assert.deepEqual(spoken, ['Because air scatters blue light.']);
});

test('"stop" cancels speech; "voice off" disables it and persists', async () => {
  const before = cancels;
  await typeCommand('stop');
  assert.ok(cancels > before, 'speechSynthesis.cancel called');
  await typeCommand('voice off');
  assert.equal($('speaker').getAttribute('aria-pressed'), 'false');
  assert.match(window.localStorage.getItem('sirpixel.tts'), /"enabled":false/);
  spoken.length = 0;
  await typeCommand('what is 2 plus 2');
  assert.deepEqual(spoken, []);
});

test('"turn on the voice" works by voice command and starting the mic stops speech', async () => {
  await typeCommand('turn on the voice');
  assert.equal($('speaker').getAttribute('aria-pressed'), 'true');
  assert.equal(window.localStorage.getItem('sirpixel.tts').includes('true'), true);
  const before = cancels;
  $('mic').click();
  await sleep(30);
  assert.ok(cancels > before, 'speech cancelled when the mic opens');
});

// ---------------------------------------------------------- hands-free (ear) ------
test('ear button toggles hands-free mode and persists', async () => {
  const ear = $('ear');
  assert.equal(ear.classList.contains('hidden'), false, 'ear button visible when speech supported');
  // Initially on (default from localStorage)
  assert.equal(ear.getAttribute('aria-pressed'), 'true');
  const beforeHf = window.localStorage.getItem('sirpixel.handsfree');
  assert.equal(beforeHf, '1');

  // Click to turn off
  ear.click();
  await sleep(30);
  assert.equal(ear.getAttribute('aria-pressed'), 'false');
  assert.equal(window.localStorage.getItem('sirpixel.handsfree'), '0');

  // Click to turn on
  ear.click();
  await sleep(30);
  assert.equal(ear.getAttribute('aria-pressed'), 'true');
  assert.equal(window.localStorage.getItem('sirpixel.handsfree'), '1');
});

test('hands-free off: mic click still works for one-shot listening', async () => {
  // Turn off hands-free first
  $('ear').click();
  await sleep(30);
  assert.equal($('ear').getAttribute('aria-pressed'), 'false');

  // Mic click should open typebox fallback (no speech support in jsdom)
  $('mic').click();
  await sleep(30);
  assert.equal($('typebox').classList.contains('hidden'), false);
  assert.match(bubbleText(), /type a command/i);
});

// ---------------------------------------------------------- STT engine settings ------
test('STT engine radio buttons appear in settings and persist choice', async () => {
  // Open settings
  $('gear').click();
  await sleep(30);
  assert.equal($('settings').classList.contains('hidden'), false);

  // Check STT engine fieldset exists
  const fieldset = $('stt-engine-fieldset');
  assert.ok(fieldset, 'STT engine fieldset exists');
  const radios = fieldset.querySelectorAll('input[name="stt-engine"]');
  assert.equal(radios.length, 4, 'four STT engine options');

  // Check values
  assert.equal(radios[0].value, 'gemini');
  assert.equal(radios[1].value, 'web-speech');
  assert.equal(radios[2].value, 'android-native');
  assert.equal(radios[3].value, 'local');

  // Default should be gemini
  assert.equal(radios[0].checked, true, 'gemini selected by default');

  // Change to web-speech
  radios[1].checked = true;
  radios[1].dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(50);
  assert.equal($('stt-status').textContent.includes('web-speech'), true);
  assert.equal(window.localStorage.getItem('sirpixel.stt').includes('web-speech'), true);

  // Change back to gemini
  radios[0].checked = true;
  radios[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(50);
  assert.equal($('stt-status').textContent.includes('gemini'), true);
  assert.equal(window.localStorage.getItem('sirpixel.stt').includes('gemini'), true);
});

// ---------------------------------------------------------- voice commands (mic) ------
test('mic click without speech support opens typed fallback', async () => {
  $('mic').click();
  await sleep(30);
  assert.equal($('typebox').classList.contains('hidden'), false);
  assert.match(bubbleText(), /type a command/i);
});

test('Escape key cancels listening and closes typebox', async () => {
  $('mic').click();
  await sleep(30);
  assert.equal($('typebox').classList.contains('hidden'), false);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('typebox').classList.contains('hidden'), true);
});
