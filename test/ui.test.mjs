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
window.assistant = {
  platform: 'linux',
  execute: async (a) => { executed.push(a); return { ok: true }; },
  onToggleListen: (cb) => { hooks.toggle = cb; },
  onTypeCommand: (cb) => { hooks.type = cb; },
  setInteractive: () => {},
  moveBy: () => {},
};
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
