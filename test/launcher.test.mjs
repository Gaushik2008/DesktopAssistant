import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { APPS, ALLOWED_SCHEMES } from '../src/web/core/catalog.js';

const require = createRequire(import.meta.url);
const { launchApp, safeOpenUrl, isSafeUrl, DESKTOP_APPS, trySpawn } = require('../electron/launcher.js');

test('desktop launcher covers every desktop-capable app in the shared catalog', () => {
  for (const [id, app] of Object.entries(APPS)) {
    const desktopCapable = app.uri || app.win32 || app.linux;
    if (desktopCapable) assert.ok(DESKTOP_APPS[id], `launcher.js is missing app "${id}"`);
  }
});

test('allowed schemes stay in sync between renderer and launcher', () => {
  for (const s of ALLOWED_SCHEMES) assert.ok(isSafeUrl(`${s}x`) || s.startsWith('http'), s);
  assert.ok(!isSafeUrl('javascript:alert(1)'));
  assert.ok(!isSafeUrl('file:///etc/passwd'));
});

test('safeOpenUrl blocks bad schemes and never calls the shell', async () => {
  let called = false;
  const shell = { openExternal: async () => { called = true; } };
  assert.equal((await safeOpenUrl(shell, 'file:///etc/passwd')).ok, false);
  assert.equal(called, false);
  assert.equal((await safeOpenUrl(shell, 'https://example.com')).ok, true);
  assert.equal(called, true);
});

test('launchApp: unknown app rejected; spotify uses URI search', async () => {
  const opened = [];
  const shell = { openExternal: async (u) => opened.push(u) };
  assert.equal((await launchApp({ spawn: null, shell, platform: 'linux' }, { appId: 'rm -rf /' })).ok, false);
  const r = await launchApp({ spawn: null, shell, platform: 'linux' }, { appId: 'spotify', query: 'green day' });
  assert.equal(r.ok, true);
  assert.deepEqual(opened, ['spotify:search:green%20day']);
});

test('trySpawn falls through missing commands without using a shell', async () => {
  const tried = [];
  const { EventEmitter } = await import('node:events');
  const spawn = (cmd, args, opts) => {
    assert.equal(opts.shell, false);
    tried.push(cmd);
    const c = new EventEmitter();
    c.unref = () => {};
    setImmediate(() => (cmd === 'good' ? c.emit('spawn') : c.emit('error', new Error('ENOENT'))));
    return c;
  };
  assert.equal(await trySpawn(spawn, ['bad1', 'bad2', 'good'], []), true);
  assert.deepEqual(tried, ['bad1', 'bad2', 'good']);
  assert.equal(await trySpawn(spawn, ['bad1'], []), false);
});
