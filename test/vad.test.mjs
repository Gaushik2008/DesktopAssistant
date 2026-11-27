import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVad } from '../src/web/recorder.js';

const CHUNK = 85; // ms per 4096-sample chunk at 48 kHz

/** Run a list of [rms, ms] segments through the VAD; returns { verdict, at } of the first non-continue. */
function run(segments, opts) {
  const vad = createVad(opts);
  let t = 0;
  for (const [rms, ms] of segments) {
    for (let i = 0; i < Math.ceil(ms / CHUNK); i++, t += CHUNK) {
      // small deterministic jitter so signals aren't perfectly flat
      const v = vad.push(rms * (1 + 0.15 * Math.sin(t / 37)), t);
      if (v !== 'continue') return { verdict: v, at: t };
    }
  }
  return { verdict: 'continue', at: t };
}

const SILENCE = 0.003, LOUD = 0.12, QUIET_WORD = 0.03; // quiet word ~ 12 dB below the first word

test('REGRESSION: a full sentence with gaps and quieter words is NOT cut after the first word', () => {
  // "Play" (loud, starts immediately) .. 350 ms gap .. "Graffitia" (quieter) .. gap .. "on Spotify" (quiet), then silence
  const r = run([
    [LOUD, 400], [SILENCE, 350], [QUIET_WORD, 700], [SILENCE, 300], [QUIET_WORD, 600], [SILENCE, 400],
    [QUIET_WORD, 500], [SILENCE, 3000],
  ]);
  assert.equal(r.verdict, 'end');
  // must keep listening through the whole sentence (~3 s of speech+gaps) before ending on trailing silence
  assert.ok(r.at > 400 + 350 + 700 + 300 + 600 + 400 + 500 + 1300, `ended too early at ${r.at} ms`);
});

test('speech starting immediately (no leading silence to calibrate on) still works', () => {
  const r = run([[QUIET_WORD, 1200], [SILENCE, 3000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at >= 1200 + 1400, `ended too early at ${r.at} ms`);
});

test('a normal-length utterance ends 1.4-2.4 s after the user stops talking', () => {
  const r = run([[SILENCE, 500], [LOUD, 2500], [SILENCE, 5000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at >= 500 + 2500 + 1400 && r.at <= 500 + 2500 + 1400 + 1000, `ended at ${r.at}`);
});

test('a lone short word ("DO.IT") waits longer for the rest of the sentence', () => {
  const r = run([[SILENCE, 500], [LOUD, 600], [SILENCE, 5000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at >= 500 + 600 + 1400 + 700, `gave up too soon at ${r.at}`);
});

test('REGRESSION: first word, then a 1.5 s thinking pause, then the rest of the command', () => {
  // "Play" ...(1.5 s)... "Graffitia by Green Day" ...
  const r = run([[LOUD, 400], [SILENCE, 1500], [QUIET_WORD, 1400], [SILENCE, 4000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at > 400 + 1500 + 1400 + 1300, `cut off mid-sentence at ${r.at}`);
});

test('a 1.3 s pause in the middle of a longer sentence does not end it', () => {
  const r = run([[LOUD, 1000], [SILENCE, 300], [LOUD, 1000], [SILENCE, 1300], [QUIET_WORD, 800], [SILENCE, 4000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at > 1000 + 300 + 1000 + 1300 + 800 + 1300, `cut off at ${r.at}`);
});

test('a 700 ms thinking pause mid-sentence does not end the recording', () => {
  const r = run([[LOUD, 500], [SILENCE, 700], [LOUD, 500], [SILENCE, 3000]]);
  assert.equal(r.verdict, 'end');
  assert.ok(r.at > 500 + 700 + 500 + 1100);
});

test('only background noise -> gives up with no-speech', () => {
  assert.equal(run([[SILENCE, 20000]]).verdict, 'no-speech');
});

test('steady loud background noise (fan/AC) is not mistaken for speech, speech on top is detected', () => {
  const noise = 0.02;
  assert.equal(run([[noise, 20000]]).verdict, 'no-speech');
  const r = run([[noise, 800], [noise * 6, 900], [noise, 4000]]);
  assert.equal(r.verdict, 'end');
});

test('long monologue is capped at maxMs', () => {
  assert.equal(run([[LOUD, 30000]], { maxMs: 15000 }).verdict, 'max');
});
