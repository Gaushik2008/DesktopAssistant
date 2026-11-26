import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { createRecognizer, parseOutput, psArgs, SCRIPT } = createRequire(import.meta.url)('../electron/stt.js');

function fakeSpawn(lines, { delay = 5, exit = true } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.killed = false;
    p.kill = () => { p.killed = true; setTimeout(() => p.emit('close', 1), 0); };
    calls.push({ cmd, args, opts, p });
    if (exit) setTimeout(() => { p.stdout.emit('data', Buffer.from(lines)); p.emit('close', 0); }, delay);
    return p;
  };
  fn.calls = calls;
  return fn;
}

test('parseOutput understands all script outputs', () => {
  assert.deepEqual(parseOutput('TEXT:open youtube\r\n'), { ok: true, text: 'open youtube' });
  assert.deepEqual(parseOutput('warning noise\nTEXT:hello'), { ok: true, text: 'hello' });
  assert.deepEqual(parseOutput('NOSPEECH'), { ok: false, code: 'no-speech' });
  assert.equal(parseOutput('ERROR:No audio input device is available').code, 'no-mic');
  assert.equal(parseOutput('ERROR:No recognizer installed for culture').code, 'error');
  assert.equal(parseOutput('').code, 'error');
});

test('Windows: spawns powershell with a fixed encoded script (no shell, no user input)', async () => {
  const spawnFn = fakeSpawn('TEXT:set a timer for five minutes');
  const r = createRecognizer({ platform: 'win32', spawnFn });
  assert.equal(r.supported, true);
  const out = await r.listen();
  assert.deepEqual(out, { ok: true, text: 'set a timer for five minutes' });
  const { cmd, args, opts } = spawnFn.calls[0];
  assert.equal(cmd, 'powershell.exe');
  assert.equal(opts.shell, false);
  assert.equal(args.at(-2), '-EncodedCommand');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), SCRIPT);
  assert.deepEqual(psArgs(), args);
});

test('non-Windows is unsupported and never spawns', async () => {
  const spawnFn = fakeSpawn('TEXT:x');
  const r = createRecognizer({ platform: 'linux', spawnFn });
  assert.equal(r.supported, false);
  assert.deepEqual(await r.listen(), { ok: false, code: 'unsupported' });
  assert.equal(spawnFn.calls.length, 0);
});

test('cancel() kills the child and reports cancelled', async () => {
  const spawnFn = fakeSpawn('', { exit: false });
  const r = createRecognizer({ platform: 'win32', spawnFn });
  const p = r.listen();
  r.cancel();
  assert.deepEqual(await p, { ok: false, code: 'cancelled' });
  assert.equal(spawnFn.calls[0].p.killed, true);
});

test('spawn failure (no powershell) and hard timeout are handled', async () => {
  const bad = () => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => {}; setTimeout(() => p.emit('error', new Error('ENOENT')), 0); return p; };
  assert.deepEqual(await createRecognizer({ platform: 'win32', spawnFn: bad }).listen(), { ok: false, code: 'unsupported' });
  const hang = fakeSpawn('', { exit: false });
  assert.deepEqual(await createRecognizer({ platform: 'win32', spawnFn: hang, hardTimeoutMs: 30 }).listen(), { ok: false, code: 'no-speech' });
});
