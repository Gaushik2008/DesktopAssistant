// Pure helpers for the AI-chat fallback. Works with any OpenAI-compatible
// /chat/completions endpoint: NVIDIA API (build.nvidia.com), Ollama, LM Studio, custom.
// No network or storage here - the platform bridges do the I/O.

export const PRESETS = {
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest', needsKey: true },
  nvidia: { label: 'NVIDIA API', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', needsKey: true },
  ollama: { label: 'Local - Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', needsKey: false },
  lmstudio: { label: 'Local - LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'qwen3-4b', needsKey: false },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', needsKey: false },
};

export const SYSTEM_PROMPT =
  'You are DO.IT, a friendly voxel king who lives on the user\'s desktop. ' +
  'Answer in plain text, at most 3 short sentences, no markdown, no lists. ' +
  'You cannot run commands or open apps yourself; if asked to, tell the user to say the command directly, e.g. "open YouTube".';

const MAX_TURNS_MESSAGES = 12;
const MAX_REPLY_CHARS = 600;

/** http is only allowed for this machine / private networks; everything else must be https. */
export function isLocalHost(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h.endsWith('.local') ||
    /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

export function validateSettings(s) {
  if (!s || typeof s !== 'object') return { ok: false, error: 'No settings.' };
  let u;
  try { u = new URL(s.baseUrl); } catch { return { ok: false, error: 'Base URL is not a valid URL.' }; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u.hostname))) {
    return { ok: false, error: 'Use https:// (plain http:// is only allowed for localhost or your local network).' };
  }
  if (!s.model || !String(s.model).trim()) return { ok: false, error: 'Enter a model name.' };
  const preset = PRESETS[s.provider];
  if (preset && preset.needsKey && !s.apiKey && !s.hasKey) return { ok: false, error: 'This provider needs an API key.' };
  return { ok: true };
}

/** Strip whitespace, zero-width/smart-quote junk and wrapping quotes from a pasted API key.
 *  A single non-ASCII character in a header makes fetch() throw, which looked like "can't reach Gemini". */
export function cleanKey(k) {
  if (typeof k !== 'string') return '';
  return k.replace(/[^\x21-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '');
}

/** Human-readable message from a Google/OpenAI-style error body ('' if none). */
export function errorDetail(json) {
  const e = json && (Array.isArray(json) ? json[0] : json).error;
  const m = e && typeof e.message === 'string' ? e.message : '';
  return m.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function trimHistory(history, max = MAX_TURNS_MESSAGES) {
  const clean = (history || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  return clean.slice(-max);
}

/** @returns {{url: string, headers: Record<string,string>, body: object}} */
export function buildRequest(settings, history, userText) {
  const model = String(settings.model).trim();
  // Qwen3 "thinking" models: the /no_think soft switch keeps replies fast and short.
  const content = /qwen3/i.test(model) ? `${userText} /no_think` : userText;
  const headers = { 'Content-Type': 'application/json' };
  const key = cleanKey(settings.apiKey);
  if (key) headers.Authorization = `Bearer ${key}`;
  return {
    url: `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers,
    body: {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...trimHistory(history), { role: 'user', content }],
      max_tokens: isGemini(settings) ? 1024 : 300,
      temperature: 0.7,
      stream: false,
    },
  };
}

/** Pull the assistant text out of a chat-completions response; strips

blocks. */
export function extractReply(json) {
  const raw = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof raw !== 'string') return null;
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/\/no_think/g, '').trim();
  if (!text) return null;
  if (text.length > MAX_REPLY_CHARS) text = `${text.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…`;
  return text;
}

export function friendlyHttpError(status, host, detail = '') {
  if (status === 401 || status === 403 || (status === 400 && /api[_ ]?key/i.test(detail))) return 'The API key was rejected. Check it in settings.';
  if (status === 400 && detail) return `The AI service rejected the request: ${detail}`;
  if (status === 404) return 'Endpoint or model not found. Check the base URL and model name.';
  if (status === 429) return 'Rate limited. Try again in a moment.';
  if (status >= 500) return `${host} had a server error. Try again later.`;
  return `The AI service returned an error (${status}).`;
}

// ---------------------------------------------------------------- speech-to-text ----
// Electron has no built-in speech service (Web Speech needs Google's private keys), so voice is
// recorded in the renderer and transcribed by Gemini's native audio endpoint.

const GEMINI_HOST = 'generativelanguage.googleapis.com';

/** True when these settings point at Google's Gemini API (the only STT provider). */
export function isGemini(settings) {
  try { return new URL(settings.baseUrl).hostname === GEMINI_HOST; } catch { return false; }
}

/** @returns {{url: string, headers: Record<string,string>, body: object}} */
export function buildTranscribeRequest(settings, base64, mime = 'audio/wav') {
  const model = String(settings.model || PRESETS.gemini.model).trim().replace(/^models\//, '');
  return {
    url: `https://${GEMINI_HOST}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cleanKey(settings.apiKey) }, // key in a header, never the URL
    body: {
      contents: [{ parts: [
        { text: 'Transcribe this short spoken voice command exactly as spoken. Reply with ONLY the transcript text, no quotes or commentary. If there is no intelligible speech, reply with exactly: [silence]' },
        { inline_data: { mime_type: mime, data: base64 } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    },
  };
}

/** Transcript text from a generateContent response ('' = silence, null = malformed). */
export function extractTranscript(json) {
  const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
  if (/^\[?silence\]?\.?$/i.test(text)) return '';
  return text.replace(/^["'\s]+|["'\s]+$/g, '');
}

/** STT-specific error codes the UI reacts to: nokey -> open settings, badkey, quota, network. */
export function sttErrorFromStatus(status, detail = '') {
  if (status === 400 && detail && !/api[_ ]?key/i.test(detail)) return { code: 'error', message: `Gemini rejected the request: ${detail}` };
  if (status === 400 || status === 401 || status === 403) return { code: 'badkey', message: 'Gemini rejected the API key. Check it in settings.' };
  if (status === 404) return { code: 'badmodel', message: 'Gemini model not found. Check the model name in settings.' };
  if (status === 429) return { code: 'quota', message: 'Gemini is rate-limiting me. Try again in a moment.' };
  return { code: 'error', message: `Gemini returned an error (${status}).` };
}

/** Shared validation for transcribe(): returns an {ok:false,...} result or null when fine. */
export function checkSttReady(settings, base64) {
  if (!isGemini(settings)) return { ok: false, code: 'nogemini', message: 'Voice needs Google Gemini. Choose "Google Gemini" in settings and add your API key.' };
  if (!cleanKey(settings.apiKey)) return { ok: false, code: 'nokey', message: 'Add your Gemini API key to enable voice.' };
  if (typeof base64 !== 'string' || !base64 || base64.length > 14 * 1024 * 1024) return { ok: false, code: 'error', message: 'Bad audio clip.' };
  return null;
}

// ------------------------------------------------------------ model discovery ----
// Gemini model names change often and a wrong one gives HTTP 404. When that happens we ask
// Google (ListModels) which models this key can use and pick the newest plain "Flash".

/** @param {Array<{name:string, supportedGenerationMethods?:string[]}>} models raw ListModels entries */
export function chooseGeminiModel(models) {
  const usable = (models || [])
    .filter((m) => m && typeof m.name === 'string' && (m.supportedGenerationMethods || ['generateContent']).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const score = (id, re) => { const m = id.match(re); return m ? parseFloat(m[1]) : null; };
  const tiers = [/^gemini-(\d+(?:\.\d+)?)-flash$/, /^gemini-(\d+(?:\.\d+)?)-flash-lite$/, /^gemini-(\d+(?:\.\d+)?)-flash-(?:preview|latest)/];
  for (const re of tiers) {
    const best = usable.map((id) => ({ id, v: score(id, re) })).filter((x) => x.v !== null).sort((a, b) => b.v - a.v)[0];
    if (best) return best.id;
  }
  return null;
}