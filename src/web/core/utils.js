// Small pure helpers: duration parsing/formatting and a safe arithmetic evaluator.
// No eval / Function: expressions are tokenised and evaluated with shunting-yard.

const UNIT_MS = { second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, hr: 3600000 };
const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  a: 1, an: 1,
};

function toNumber(tok) {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  return tok in NUM_WORDS ? NUM_WORDS[tok] : NaN;
}

/** "1 hour 30 minutes", "half an hour", "90 seconds", "five min" -> milliseconds (or null). */
export function parseDuration(text) {
  const s = text.toLowerCase().replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^half an? hour$/.test(s)) return 30 * 60000;
  if (/^quarter of an hour$/.test(s)) return 15 * 60000;
  const re = /(\d+(?:\.\d+)?|[a-z]+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/g;
  let total = 0, m, any = false;
  while ((m = re.exec(s))) {
    const n = toNumber(m[1]);
    if (Number.isNaN(n)) continue;
    total += n * UNIT_MS[m[2].replace(/s$/, '')];
    any = true;
  }
  if (!any || total <= 0) return null;
  return Math.round(total);
}

export function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}

const WORD_OPS = [
  [/\bmultiplied by\b|\btimes\b|\bx\b/g, '*'],
  [/\bdivided by\b|\bover\b/g, '/'],
  [/\bplus\b/g, '+'],
  [/\bminus\b/g, '-'],
  [/\bto the power of\b/g, '^'],
];

/** Evaluate "12 times 7", "(3+4)*2", "2 to the power of 10". Returns number or null. */
export function evalMath(text) {
  let s = text.toLowerCase().replace(/,/g, '');
  for (const [re, op] of WORD_OPS) s = s.replace(re, ` ${op} `);
  s = s.replace(/[^0-9+\-*/^().\s]/g, '').trim();
  if (!s) return null;
  const tokens = s.match(/\d+(?:\.\d+)?|[+\-*/^()]/g);
  if (!tokens || tokens.join('').length < s.replace(/\s+/g, '').length) return null;

  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const out = [], ops = [];
  let prev = null;
  for (let tok of tokens) {
    if (/^\d/.test(tok)) { out.push(parseFloat(tok)); prev = 'n'; continue; }
    if (tok === '-' && (prev === null || prev === 'o' || prev === '(')) { out.push(0); } // unary minus
    if (tok === '(') { ops.push(tok); prev = '('; continue; }
    if (tok === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      if (!ops.length) return null;
      ops.pop(); prev = 'n'; continue;
    }
    while (ops.length && ops[ops.length - 1] !== '(' &&
      (prec[ops[ops.length - 1]] > prec[tok] || (prec[ops[ops.length - 1]] === prec[tok] && tok !== '^'))) out.push(ops.pop());
    ops.push(tok); prev = 'o';
  }
  while (ops.length) { const o = ops.pop(); if (o === '(') return null; out.push(o); }

  const st = [];
  for (const t of out) {
    if (typeof t === 'number') { st.push(t); continue; }
    const b = st.pop(), a = st.pop();
    if (a === undefined || b === undefined) return null;
    st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : a ** b);
  }
  if (st.length !== 1 || !Number.isFinite(st[0])) return null;
  return Math.round(st[0] * 1e10) / 1e10;
}
