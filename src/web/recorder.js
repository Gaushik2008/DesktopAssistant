// Microphone recorder -> 16 kHz mono 16-bit WAV (base64).
// WAV is universally accepted by Gemini and avoids codec differences between
// Electron (webm/opus) and Android WebView (mp4/aac).
// Auto-stops after a pause in speech; can be stopped early or cancelled.

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** Linear-interpolation resample of Float32 PCM. */
export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

/** Encode Float32 PCM [-1,1] as a 16-bit mono WAV ArrayBuffer. */
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Voice-activity detector (pure, unit-tested). Feed it one RMS value per audio chunk.
 *  - Noise floor = "minimum statistics": drops instantly to quieter chunks, creeps up slowly, so it
 *    never learns your own voice as background noise (the old fixed 400 ms calibration did, which
 *    made everything after the first word look like silence).
 *  - Levels are smoothed (EMA) so brief dips between words / syllables don't count as silence.
 *  - Speech starts above `onFactor`x floor; it only ends after `silenceMs` below `offFactor`x floor.
 *  - A very short utterance (just "Play" / "DO.IT") is probably the START of a sentence, so it gets
 *    `shortExtraMs` more patience before we call it finished. Longer speech ends after `silenceMs`.
 * push() returns 'continue' | 'end' (speech finished) | 'no-speech' (gave up) | 'max'.
 */
export function createVad({ silenceMs = 1400, shortUtteranceMs = 1500, shortExtraMs = 700, noSpeechMs = 7000, maxMs = 15000, minThreshold = 0.006, onFactor = 3, offFactor = 1.8 } = {}) {
  let floor = null, ema = 0, t0 = null, heard = false, lastVoice = 0, firstVoice = 0;
  return {
    get heardSpeech() { return heard; },
    push(rms, now) {
      if (t0 === null) { t0 = now; lastVoice = now; }
      ema = ema ? ema * 0.6 + rms * 0.4 : rms;
      floor = floor === null ? rms : Math.min(rms, Math.min(floor * 1.015 + 1e-5, 0.03));
      const on = Math.max(minThreshold * 1.5, floor * onFactor);
      const off = Math.max(minThreshold, floor * offFactor);
      if (ema > on) { if (!heard) firstVoice = now; heard = true; lastVoice = now; }
      else if (heard && ema > off) lastVoice = now; // still faintly talking - keep going
      if (now - t0 > maxMs) return heard ? 'max' : 'no-speech';
      const need = lastVoice - firstVoice < shortUtteranceMs ? silenceMs + shortExtraMs : silenceMs;
      if (heard && now - lastVoice > need) return 'end';
      if (!heard && now - t0 > noSpeechMs) return 'no-speech';
      return 'continue';
    },
  };
}

/**
 * Start recording. Returns { result: Promise<{base64, mime, ms}>, stop(), cancel() }.
 * result rejects with code: 'denied' | 'no-mic' | 'no-speech' | 'cancelled' | 'error'
 */
export function record({ maxMs = 15000, silenceMs = 1400, noSpeechMs = 7000, onLevel = () => {} } = {}) {
  let stopFn = () => {};
  let cancelFn = () => {};

  const result = (async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw err('no-mic', 'No microphone API.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw err(e && e.name === 'NotFoundError' ? 'no-mic' : 'denied', String(e));
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0; // keep the graph alive without echoing the mic

    const chunks = [];
    const t0 = performance.now();
    const vad = createVad({ silenceMs, noSpeechMs, maxMs });

    return await new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch { /* ignore */ }
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        onLevel(0);
      };
      const finish = (ok, v) => {
        if (finished) return;
        finished = true;
        cleanup();
        ok ? resolve(v) : reject(v);
      };
      const done = () => {
        if (!vad.heardSpeech) return finish(false, err('no-speech'));
        let n = 0; chunks.forEach((c) => (n += c.length));
        const all = new Float32Array(n);
        let o = 0; chunks.forEach((c) => { all.set(c, o); o += c.length; });
        const pcm = resample(all, ctx.sampleRate, 16000);
        finish(true, { base64: toBase64(encodeWav(pcm, 16000)), mime: 'audio/wav', ms: Math.round(performance.now() - t0) });
      };
      stopFn = done;
      cancelFn = () => finish(false, err('cancelled'));

      proc.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        onLevel(Math.min(1, rms / 0.15));
        const verdict = vad.push(rms, now);
        if (verdict === 'end' || verdict === 'max') done();
        else if (verdict === 'no-speech') finish(false, err('no-speech'));
      };
      src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    });
  })();

  return { result, stop: () => stopFn(), cancel: () => cancelFn() };
}
