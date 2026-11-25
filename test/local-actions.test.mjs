import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
globalThis.window = globalThis;

const { runLocalAction } = await import('../src/web/local-actions.js');

test('notes are saved, listed and cleared', () => {
  const ctx = { onAlarm() {} };
  assert.equal(runLocalAction({ kind: 'list-notes' }, ctx).reply, 'You have no notes yet.');
  runLocalAction({ kind: 'note', text: 'buy milk' }, ctx);
  runLocalAction({ kind: 'note', text: 'call mum' }, ctx);
  assert.equal(runLocalAction({ kind: 'list-notes' }, ctx).reply, 'You have 2 notes: buy milk; call mum.');
  runLocalAction({ kind: 'clear-notes' }, ctx);
  assert.equal(runLocalAction({ kind: 'list-notes' }, ctx).reply, 'You have no notes yet.');
});

test('timer fires the alarm callback', async () => {
  const msg = await new Promise((resolve) => {
    runLocalAction({ kind: 'timer', ms: 20, label: 'Timer: test' }, { onAlarm: resolve });
  });
  assert.match(msg, /Timer: test - time's up!/);
});

test('platform actions are not handled locally', () => {
  assert.equal(runLocalAction({ kind: 'open-url', url: 'https://x.y' }, { onAlarm() {} }).handled, false);
});
