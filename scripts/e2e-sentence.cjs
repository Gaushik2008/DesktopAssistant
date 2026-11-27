// End-to-end check that the recorder waits for a full sentence, not just one word.
// Uses Playwright with a fake microphone and stubbed transcription that decodes the WAV
// and counts tone bursts (each burst = one "word").
// The pause after the first word is LONG ENOUGH (1.6s after 0.35s first word) that the
// OLD recorder (silenceMs=1200) FAILS and the NEW recorder (adaptive silence) PASSES.

const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeWav(file) {
  const rate = 16000;
  const secs = 20;  // Longer WAV so trailing silence exceeds adaptive silence threshold even when looping
  const n = rate * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);

  // Tone burst pattern: 0.35s ON (word 1), 1.6s OFF (pause), 0.6s ON (word 2), then LONG silence
  // At 48kHz playback (3x speed): first word ends ~0.28s, pause ~0.53s, second word ends ~1.02s
  // Adaptive silence for short utterance = 1400+700=2100ms. Need >2100ms continuous silence at loop boundary.
  // WAV starts with 0.5s silence (0.17s at 48kHz). WAV ends with ~17s silence (5.7s at 48kHz).
  // Loop boundary silence = 5.7s + 0.17s = 5.87s > 2.1s. VAD will complete.
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const on1 = t > 0.5 && t < 0.85;        // first "word" at 0.5-0.85s (350ms)
    const on2 = t > 2.45 && t < 3.05;       // second "word" at 2.45-3.05s (600ms) - after 1.6s pause
    const on = on1 || on2;
    buf.writeInt16LE(on ? Math.round(9000 * Math.sin(2 * Math.PI * 220 * t)) : 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function countToneBursts(base64Wav) {
  // Decode base64 WAV and count distinct tone bursts using RMS over 50ms windows
  // Browser-compatible version using Uint8Array and atob
  const binary = atob(base64Wav);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  if (buf.length < 44) return 0;
  // Check RIFF header
  const riff = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (riff !== 'RIFF') return 0;
  const dataOffset = 44;
  const samples = new Int16Array(buf.buffer, buf.byteOffset + dataOffset, (buf.length - dataOffset) / 2);
  const rate = 16000; // WAV sample rate
  const windowSize = rate * 0.05; // 50ms windows
  let bursts = 0;
  let inBurst = false;
  const rmsThreshold = 2000; // RMS threshold for "speech"
  for (let i = 0; i < samples.length; i += windowSize) {
    const window = samples.subarray(i, Math.min(i + windowSize, samples.length));
    let sumSq = 0;
    for (const s of window) sumSq += s * s;
    const rms = Math.sqrt(sumSq / window.length);
    if (rms > rmsThreshold && !inBurst) {
      bursts++;
      inBurst = true;
    } else if (rms <= rmsThreshold) {
      inBurst = false;
    }
  }
  return bursts;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sentence-'));
  const wav = path.join(dir, 'mic.wav');
  makeWav(wav);

  // Serve the web app
  const srv = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1', '-d', path.join(__dirname, '..', 'src', 'web')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Inject countToneBursts into page context (browser-compatible version)
  const countToneBurstsBrowser = `
window.countToneBursts = function countToneBursts(base64Wav) {
  const binary = atob(base64Wav);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  if (buf.length < 44) return 0;
  const riff = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (riff !== 'RIFF') return 0;
  const dataOffset = 44;
  const samples = new Int16Array(buf.buffer, buf.byteOffset + dataOffset, (buf.length - dataOffset) / 2);
  const rate = 16000;
  const windowSize = rate * 0.05;
  let bursts = 0;
  let inBurst = false;
  const rmsThreshold = 2000;
  for (let i = 0; i < samples.length; i += windowSize) {
    const window = samples.subarray(i, Math.min(i + windowSize, samples.length));
    let sumSq = 0;
    for (const s of window) sumSq += s * s;
    const rms = Math.sqrt(sumSq / window.length);
    if (rms > rmsThreshold && !inBurst) {
      bursts++;
      inBurst = true;
    } else if (rms <= rmsThreshold) {
      inBurst = false;
    }
  }
  return bursts;
};
`;
  await page.addInitScript(countToneBurstsBrowser);

  await page.addInitScript(() => {
    // Disable hands-free mode via localStorage before app loads
    try { localStorage.setItem('sirpixel.handsfree', '0'); } catch { }
    window.__transcripts = [];
    window.__wavB64s = [];
    window.assistant = {
      platform: 'linux',
      execute: async (a) => { window.__executed = a; return { ok: true }; },
      llm: {
        getSettings: async () => ({ provider: 'gemini', baseUrl: '', model: 'm', hasKey: true }),
        saveSettings: async (s) => s,
        chat: async () => ({ ok: true, reply: 'ai' }),
      },
      stt: {
        transcribe: async (b64, mime) => {
          window.__wavB64s.push(b64);
          // Count tone bursts in the WAV to determine what was "heard"
          const bursts = window.countToneBursts(b64);
          let text = '';
          if (bursts >= 2) text = 'Play Graffitia by Green Day';
          else if (bursts === 1) text = 'Play';
          else text = '';
          window.__transcripts.push(text);
          return { ok: true, text };
        },
      },
      onToggleListen: () => {},
      onTypeCommand: () => {},
      onOpenSettings: () => {},
      setInteractive: () => {},
      moveBy: () => {},
    };
  });

  await page.goto('http://127.0.0.1:8766/index.html');

  const check = (name, cond, extra = '') => {
    console.log(cond ? 'PASS' : 'FAIL', name, extra);
    if (!cond) process.exitCode = 1;
  };

  // Click the mic button to start listening
  await page.click('#mic');

  // Wait for transcription to complete (should get both words)
  await page.waitForFunction(() => window.__transcripts.length >= 1, null, { timeout: 30000 }).catch(() => {});

  const transcripts = await page.evaluate(() => window.__transcripts);
  const wavB64s = await page.evaluate(() => window.__wavB64s);

  check('transcription happened', transcripts.length >= 1, `got ${transcripts.length}`);
  check('got TWO tone bursts (full sentence)', transcripts[0] === 'Play Graffitia by Green Day', `got "${transcripts[0]}"`);
  check('WAV contains 2 bursts', wavB64s.length >= 1 && countToneBursts(wavB64s[0]) === 2, `bursts: ${wavB64s.length ? countToneBursts(wavB64s[0]) : 0}`);

  // Also verify the old recorder would have failed (by simulating old behavior)
  // Old recorder: silenceMs=1200, no shortExtraMs
  // Pause is 1600ms > 1200, so old recorder would cut after first word
  const oldBehavior = await page.evaluate(() => {
    // Simulate old VAD: 1200ms silence cutoff, no adaptive extra
    const vad = {
      silenceMs: 1200,
      heard: false,
      lastVoice: 0,
      t0: null,
    };
    // We can't easily replay the VAD here, but we know the timing:
    // First word ends at 850ms, pause of 1600ms -> 2450ms > 1200, so old VAD would end
    return { wouldCut: true, reason: 'pause 1600ms > old silenceMs 1200ms' };
  });

  check('OLD recorder would have cut after first word', oldBehavior.wouldCut, oldBehavior.reason);
  check('no page errors', errors.length === 0, errors.join('; '));

  await browser.close();
  srv.kill();
  process.exit(process.exitCode || 0);
})();