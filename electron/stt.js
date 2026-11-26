'use strict';
// Offline speech-to-text for the desktop app.
//
// Why: Electron's built-in Web Speech API needs Google API keys the app doesn't have, so it fails
// with "network". Windows ships an offline recogniser (System.Speech), driven here through a fixed
// PowerShell script. No audio or text from the user is ever interpolated into that script.
//
// Linux / macOS: not supported yet -> { ok:false, code:'unsupported' } and the UI falls back to the typed box.

const { spawn } = require('child_process');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(900)
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(700)
  $result = $engine.Recognize([TimeSpan]::FromSeconds(12))
  if ($result -and $result.Text) { [Console]::Out.WriteLine('TEXT:' + $result.Text) } else { [Console]::Out.WriteLine('NOSPEECH') }
} catch {
  [Console]::Out.WriteLine('ERROR:' + $_.Exception.Message)
}
`;

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

function psArgs() {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(SCRIPT)];
}

/** Turn the script's last output line into a result object. */
function parseOutput(stdout) {
  const line = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || '';
  if (line.startsWith('TEXT:')) {
    const text = line.slice(5).trim();
    return text ? { ok: true, text } : { ok: false, code: 'no-speech' };
  }
  if (line === 'NOSPEECH') return { ok: false, code: 'no-speech' };
  if (line.startsWith('ERROR:')) {
    const message = line.slice(6).trim();
    if (/no audio input|audio device|microphone|input device/i.test(message)) {
      return { ok: false, code: 'no-mic', message: 'No microphone found. Plug one in and check Windows Settings > Privacy > Microphone.' };
    }
    if (/recogni[sz]er|culture|language|installed/i.test(message)) {
      return { ok: false, code: 'error', message: `Windows speech recognition isn't set up: ${message}` };
    }
    return { ok: false, code: 'error', message };
  }
  return { ok: false, code: 'error', message: 'The recogniser gave no answer.' };
}

function createRecognizer({ platform = process.platform, spawnFn = spawn, hardTimeoutMs = 20000 } = {}) {
  let child = null;
  let cancelled = false;

  function cancel() {
    cancelled = true;
    if (child) { try { child.kill(); } catch { /* already gone */ } }
  }

  function listen() {
    if (platform !== 'win32') return Promise.resolve({ ok: false, code: 'unsupported' });
    if (child) cancel();
    cancelled = false;
    return new Promise((resolve) => {
      let out = '';
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); child = null; resolve(r); } };
      let proc;
      try {
        proc = spawnFn('powershell.exe', psArgs(), { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return done({ ok: false, code: 'unsupported' });
      }
      child = proc;
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } done({ ok: false, code: 'no-speech' }); }, hardTimeoutMs);
      proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
      proc.on('error', () => done({ ok: false, code: 'unsupported' }));
      proc.on('close', () => done(cancelled ? { ok: false, code: 'cancelled' } : parseOutput(out)));
    });
  }

  return { supported: platform === 'win32', listen, cancel };
}

module.exports = { createRecognizer, parseOutput, psArgs, SCRIPT };
