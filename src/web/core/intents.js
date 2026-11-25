// Intent parser: turns a transcript into { intent, reply, action }.
// Pure functions, no DOM / Node APIs -> runs on Windows, Linux, Android and in tests.
//
// action shapes (executed by a platform bridge, see platform.js):
//   { kind: 'open-url', url }
//   { kind: 'open-app', appId, query? }   // app resolved from catalog.js
//   null                                   // reply only

import { findApp, findSite, SITES, APPS } from './catalog.js';
import { GREETINGS, THANKS, JOKES, HELP_TEXT, pick } from './personality.js';

const WAKE = /^(?:hey|hi|hello|ok|okay)?\s*(?:sir pixel|assistant|king|pixel)[,\s]+/i;

/** Lowercase, strip wake word / politeness / trailing punctuation. */
export function normalize(text) {
  return text
    .trim()
    .replace(/[.!?,]+$/g, '')
    .replace(WAKE, '')
    .replace(/^(?:please|can you|could you|would you)\s+/i, '')
    .replace(/\s+(?:please|for me)$/i, '')
    .trim();
}

const q = (s) => encodeURIComponent(s.trim());

function openSite(site) {
  return {
    intent: 'open-site',
    reply: `Opened ${site.label} in your browser.`,
    action: { kind: 'open-url', url: site.url },
  };
}

function openApp(app) {
  return { intent: 'open-app', reply: `Opened ${app.label}.`, action: { kind: 'open-app', appId: app.id } };
}

function playMusic(query, platform) {
  const query_ = query.trim();
  if (platform === 'youtube') {
    return {
      intent: 'play-youtube',
      reply: `Searching YouTube for ${query_}.`,
      action: { kind: 'open-url', url: `${SITES.youtube.search}${q(query_)}` },
    };
  }
  return {
    intent: 'play-spotify',
    reply: `Opened Spotify. Searching for ${query_}.`,
    action: { kind: 'open-app', appId: 'spotify', query: query_ },
  };
}

function webSearch(query, where) {
  const site = SITES[where] && SITES[where].search ? SITES[where] : SITES.google;
  return {
    intent: 'search',
    reply: `Searching ${site.label} for ${query.trim()}.`,
    action: { kind: 'open-url', url: `${site.search}${q(query)}` },
  };
}

/**
 * @param {string} text   raw transcript
 * @param {{now?: Date, rng?: () => number}} [ctx]
 */
export function parse(text, ctx = {}) {
  const now = ctx.now || new Date();
  const rng = ctx.rng || Math.random;
  const t = normalize(text || '');
  const lower = t.toLowerCase();
  if (!lower) return { intent: 'empty', reply: "I didn't hear anything.", action: null };

  let m;

  // --- cancel / stop -------------------------------------------------------
  if (/^(?:cancel|stop|never ?mind|be quiet|quiet)$/.test(lower)) {
    return { intent: 'cancel', reply: 'As you wish.', action: null };
  }

  // --- music: "play X [by Y] [on spotify|youtube]" -------------------------
  if ((m = lower.match(/^play\s+(.+?)\s+(?:on|in|using|with)\s+(spotify|youtube|you tube)$/))) {
    return playMusic(m[1], m[2].startsWith('you') ? 'youtube' : 'spotify');
  }
  if ((m = lower.match(/^play\s+(.+)$/))) return playMusic(m[1], 'spotify');

  // --- open / launch -------------------------------------------------------
  if ((m = lower.match(/^(?:open|launch|start|go to|take me to|show me)\s+(?:the\s+)?(.+?)(?:\s+(?:app|website|site))?$/))) {
    const name = m[1];
    const site = findSite(name);
    const app = findApp(name);
    if (app && !site) return openApp(app);
    if (site) return openSite(site);
    if (app) return openApp(app);
    const domain = name.replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      return { intent: 'open-site', reply: `Opening ${domain}.`, action: { kind: 'open-url', url: `https://${domain}` } };
    }
    return {
      intent: 'unknown-app',
      reply: `I don't know an app called "${name}" yet. Want me to search for it?`,
      action: null,
    };
  }

  // --- search --------------------------------------------------------------
  if ((m = lower.match(/^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+(youtube|you tube|google|github|wikipedia|reddit)$/))) {
    return webSearch(m[1], m[2].replace(' ', ''));
  }
  if ((m = lower.match(/^(?:search|look up|google|find)\s+(?:for\s+)?(.+)$/))) return webSearch(m[1], 'google');

  // --- small talk / utilities ---------------------------------------------
  if (/^what(?:'s| is)? the time|^what time is it|^time$/.test(lower)) {
    return { intent: 'time', reply: `It is ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, action: null };
  }
  if (/^what(?:'s| is)? (?:the )?(?:date|day)|^what day is it|^date$/.test(lower)) {
    return {
      intent: 'date',
      reply: `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`,
      action: null,
    };
  }
  if (/^(?:hi|hello|hey|yo|good (?:morning|afternoon|evening))\b/.test(lower)) {
    return { intent: 'greeting', reply: pick(GREETINGS, rng), action: null };
  }
  if (/^(?:thanks|thank you|thx)/.test(lower)) return { intent: 'thanks', reply: pick(THANKS, rng), action: null };
  if (/joke|make me laugh/.test(lower)) return { intent: 'joke', reply: pick(JOKES, rng), action: null };
  if (/^(?:help|what can you do|how do i use)/.test(lower)) return { intent: 'help', reply: HELP_TEXT, action: null };
  if (/^who are you|^what(?:'s| is) your name/.test(lower)) {
    return { intent: 'about', reply: "I'm Sir Pixel, the voxel king of your desktop.", action: null };
  }

  return { intent: 'unknown', reply: `I'm not sure how to "${t}" yet. Say "help" for ideas.`, action: null };
}

export { APPS, SITES };
