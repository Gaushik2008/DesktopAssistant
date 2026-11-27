// Real-Chromium check that the recorder captures a WHOLE sentence (words separated by pauses),
// not just the first word. A fake microphone plays three "words" (tone bursts) with a 1.4 s
// thinking pause and a quieter middle word; the transcription call is stubbed to count the
// bursts that actually reached it.   Requires Playwright:  node scripts/e2e-sentence.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function makeWav(file) {
  const rate = 16000, secs = 14, n = rate * secs, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  // [start, end, amplitude]  seconds
  const words = [[0.6, 0.95, 9000], [2.35, 2.9, 3500], [3.7, 4.3, 9000]];
  for (let i = 0; i < n; i++) {
    const t = i / rate; const w = words.find(([a, b]) => t >= a && t < b);
    buf.writeInt16LE(w ? Math.round(w[2] * Math.sin(2 * Math.PI * (180 + 40 * words.indexOf(w)) * t)) : 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sent-')); const wav = path.join(dir, 'mic.wav'); makeWav(wav);
  const srv = spawn('python3', ['-m', 'http.server', '8767', '--bind', '127.0.0.1', '-d', path.join(__dirname, '..', 'src', 'web')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__bursts = [];
    window.assistant = {
      platform: 'linux', execute: async () => ({ ok: true }),
      llm: { getSettings: async () => ({ provider: 'gemini', baseUrl: '', model: 'm', hasKey: true }), saveSettings: async (s) => s, chat: async () => ({ ok: true, reply: 'ai' }) },
      stt: { transcribe: async (b64) => {
        const bin = atob(b64), n = (bin.length - 44) >> 1, win = 800; let bursts = 0, inB = false, dur = n / 16000;
        for (let w = 0; w + win <= n; w += win) {
          let mx = 0; for (let i = 0; i < win; i++) { const o = 44 + (w + i) * 2; let v = bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8); if (v > 32767) v -= 65536; mx = Math.max(mx, Math.abs(v) / 32768); }
          if (mx > 0.05 && !inB) { bursts++; inB = true; } else if (mx <= 0.05 && inB) { /* gap must be 2 windows to split */ }
          if (mx <= 0.05) inB = false;
        }
        window.__bursts.push({ bursts, dur: +dur.toFixed(2) }); return { ok: true, text: 'x' };
      } },
      onToggleListen() {}, onTypeCommand() {}, onOpenSettings() {}, setInteractive() {}, moveBy() {},
    };
    localStorage.setItem('sirpixel.handsfree', '0'); // manual mic only for a deterministic run
  });
  await page.goto('http://127.0.0.1:8767/index.html');
  await page.waitForTimeout(600); await page.click('#mic');
  await page.waitForFunction(() => window.__bursts.length >= 1, null, { timeout: 30000 }).catch(() => {});
  const got = await page.evaluate(() => window.__bursts);
  console.log('clip sent for transcription:', JSON.stringify(got));
  const ok = got.length >= 1 && got[0].bursts >= 3;
  console.log(ok ? 'PASS full sentence (3 words incl. a 1.4 s pause) captured' : 'FAIL sentence was cut off');
  await browser.close(); srv.kill(); process.exit(ok ? 0 : 1);
})();
