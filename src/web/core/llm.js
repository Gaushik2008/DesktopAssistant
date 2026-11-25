// Pure helpers for the AI-chat fallback. Works with any OpenAI-compatible
// /chat/completions endpoint: NVIDIA API (build.nvidia.com), Ollama, LM Studio, custom.
// No network or storage here - the platform bridges do the I/O.

export const PRESETS = {
  nvidia: { label: 'NVIDIA API', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', needsKey: true },
  ollama: { label: 'Local - Ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', needsKey: false },
  lmstudio: { label: 'Local - LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'qwen3-4b', needsKey: false },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', needsKey: false },
};

export const SYSTEM_PROMPT =
  'You are Sir Pixel, a friendly voxel king who lives on the user\'s desktop. ' +
  'Answer in plain text, at most 3 short sentences, no markdown, no lists. ' +
  'You cannot run commands or open apps yourself; if asked to, tell the user to say the command directly, e.g. "open YouTube".';

const MAX_TURNS_MESSAGES = 12;
const MAX_REPLY_CHARS = 600;

/** http is only allowed for this machine / private networks; everything else must be https. */
export function isLocalHost(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local') ||
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
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  return {
    url: `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    headers,
    body: {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...trimHistory(history), { role: 'user', content }],
      max_tokens: 300,
      temperature: 0.7,
      stream: false,
    },
  };
}

/** Pull the assistant text out of a chat-completions response; strips <think> blocks. */
export function extractReply(json) {
  const raw = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof raw !== 'string') return null;
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').replace(/\/no_think/g, '').trim();
  if (!text) return null;
  if (text.length > MAX_REPLY_CHARS) text = `${text.slice(0, MAX_REPLY_CHARS - 1).trimEnd()}…`;
  return text;
}

export function friendlyHttpError(status, host) {
  if (status === 401 || status === 403) return 'The API key was rejected. Check it in settings.';
  if (status === 404) return 'Endpoint or model not found. Check the base URL and model name.';
  if (status === 429) return 'Rate limited. Try again in a moment.';
  if (status >= 500) return `${host} had a server error. Try again later.`;
  return `The AI service returned an error (${status}).`;
}
