import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchWake } from '../src/web/core/wake.js';
import { parse, normalize } from '../src/web/core/intents.js';

test('DO.IT spellings from speech-to-text all wake it', () => {
  for (const t of ['Do it open YouTube', 'DO.IT open YouTube', 'do-it open YouTube', 'doit open YouTube', 'Dew it open YouTube', 'Due it, open YouTube', 'Hey DO.IT, open YouTube', 'ok do it open YouTube']) {
    const w = matchWake(t);
    assert.equal(w.matched, true, t);
    assert.equal(w.rest, 'open YouTube', t);
  }
});

test('legacy name still wakes; bare name leaves nothing after it', () => {
  assert.deepEqual(matchWake('Sir Pixel open calculator'), { matched: true, rest: 'open calculator' });
  assert.deepEqual(matchWake('DO.IT'), { matched: true, rest: '' });
  assert.deepEqual(matchWake('Hey, do it!'), { matched: true, rest: '' });
});

test('strict mode ignores ambient speech and loose aliases', () => {
  for (const t of ['we should go shopping tomorrow', 'I will do it later', 'king of the hill', 'assistant open x', 'doing it now', 'redo it']) {
    assert.equal(matchWake(t).matched, false, t);
  }
  assert.equal(matchWake('assistant open x', { strict: false }).matched, true);
});

test('normalize strips the DO.IT wake word', () => {
  assert.equal(normalize('Hey DO.IT, please open YouTube.'), 'open YouTube');
  assert.equal(normalize('do it what time is it'), 'what time is it');
});

test('parse: bare name = wake intent (not a "yes"); polite yes still confirms', () => {
  assert.equal(parse('DO.IT').intent, 'wake');
  assert.equal(parse('Do it').intent, 'wake');
  assert.equal(parse('yes').intent, 'confirm');
  assert.equal(parse('go ahead').intent, 'confirm');
});

test('parse: command after the wake word works', () => {
  const r = parse('DO.IT open YouTube');
  assert.equal(r.intent, 'open-site');
  assert.deepEqual(r.action, { kind: 'open-url', url: 'https://www.youtube.com' });
});

test('parse: hands-free voice commands', () => {
  assert.deepEqual(parse('DO.IT stop listening').action, { kind: 'handsfree', enabled: false });
  assert.deepEqual(parse('turn off always listening').action, { kind: 'handsfree', enabled: false });
  assert.deepEqual(parse('start listening').action, { kind: 'handsfree', enabled: true });
  assert.deepEqual(parse('hands free on').action, { kind: 'handsfree', enabled: true });
  assert.equal(parse("I'm DO.IT").intent, 'unknown'); // not a command
  assert.match(parse('who are you').reply, /DO\.IT/);
});
