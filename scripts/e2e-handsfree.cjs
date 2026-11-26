// End-to-end check of the always-listening "DO.IT" wake word in REAL Chromium.
// A fake microphone plays a looping tone (so the real recorder + voice-activity detection run),
// and the transcription call is stubbed with a scripted list of "what the user said".
//   Requires Playwright (not a project dependency):  node scripts/e2e-handsfree.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeWav(file) {
  const rate = 16000, secs = 5, n = rate * secs, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate; const on = t > 1 && t < 2; buf.writeInt16LE(on ? Math.round(9000 * Math.sin(2 * Math.PI * 220 * t)) : 0, 44 + i * 2); }
  fs.writeFileSync(file, buf);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-'));
  const wav = path.join(dir, 'mic.wav'); makeWav(wav);
  const srv = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', path.join(__dirname, '..', 'src', 'web')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__executed = []; window.__heard = [];
    const script = ['we should go shopping tomorrow', 'Do it open YouTube', 'what is the time', 'DO.IT', 'play lofi beats on youtube', 'DO.IT stop listening'];
    window.assistant = {
      platform: 'linux',
      execute: async (a) => { window.__executed.push(a); return { ok: true }; },
      llm: { getSettings: async () => ({ provider: 'gemini', baseUrl: '', model: 'm', hasKey: true }), saveSettings: async (s) => s, chat: async () => ({ ok: true, reply: 'ai' }) },
      stt: { transcribe: async () => { const text = script.shift() || ''; window.__heard.push(text); return { ok: true, text }; } },
      onToggleListen: () => {}, onTypeCommand: () => {}, onOpenSettings: () => {}, setInteractive: () => {}, moveBy: () => {},
    };
  });
  await page.goto('http://127.0.0.1:8765/index.html');
  const out = { ok: true };
  const check = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, extra); if (!cond) out.ok = false; };

  check('ear button visible + on', await page.evaluate(() => { const e = document.getElementById('ear'); return !e.classList.contains('hidden') && e.getAttribute('aria-pressed') === 'true'; }));
  await page.waitForFunction(() => window.__executed.length >= 1, null, { timeout: 40000 }).catch(() => {});
  let ex = await page.evaluate(() => window.__executed);
  check('ambient speech ignored; "Do it open YouTube" opens YouTube', ex.length >= 1 && ex[0].url === 'https://www.youtube.com', JSON.stringify(ex[0]));
  check('first transcript (no wake word) did not execute anything', (await page.evaluate(() => window.__heard))[0] === 'we should go shopping tomorrow' && ex.length === 1 + 0);
  // "what is the time" has no wake word -> ignored. "DO.IT" alone -> Yes? then next utterance is the command.
  await page.waitForFunction(() => window.__executed.length >= 2, null, { timeout: 60000 }).catch(() => {});
  ex = await page.evaluate(() => window.__executed);
  check('bare "DO.IT" then follow-up command runs', ex.length >= 2 && /youtube\.com\/results\?search_query=lofi/.test(ex[1].url || ''), JSON.stringify(ex[1]));
  await page.waitForFunction(() => document.getElementById('ear').getAttribute('aria-pressed') === 'false', null, { timeout: 30000 }).catch(() => {});
  check('"stop listening" turns hands-free off', await page.evaluate(() => document.getElementById('ear').getAttribute('aria-pressed')) === 'false');
  console.log('heard:', JSON.stringify(await page.evaluate(() => window.__heard)));
  check('no page errors', errors.length === 0, errors.join('; '));
  await browser.close(); srv.kill();
  process.exit(out.ok ? 0 : 1);
})();
