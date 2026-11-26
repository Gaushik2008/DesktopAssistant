// Wake word detection on a transcript. Pure functions (runs on Windows, Linux, Android and in tests).
//
// The assistant's name is DO.IT. Speech-to-text writes it many ways ("Do it", "doit", "do-it",
// "Dew it", "Due it"), so all of those match. "Sir Pixel" is kept as an alias for the old name.
//
// Hands-free mode uses the STRICT matcher (name only) so ordinary speech containing "king" or
// "assistant" never wakes it. Typed / tapped commands also accept the loose aliases.

const SEP = '[\\s,.!?:;\\-]';
const GREET = '(?:(?:hey|hi|hello|ok|okay|yo)' + SEP + '+)?';
const NAME = '(?:do[\\s.\\-_]*it|doit|dew[\\s.\\-]*it|due[\\s.\\-]*it|sir pixel)';
const LOOSE = '(?:assistant|king|pixel)';
const END = '(?=$|' + SEP + ')';

/** Name only - used for always-listening mode. */
export const STRICT_WAKE_RE = new RegExp('^' + GREET + NAME + END + SEP + '*', 'i');
/** Name or generic aliases - used when the user is already addressing the app. */
export const LOOSE_WAKE_RE = new RegExp('^' + GREET + '(?:' + NAME + '|' + LOOSE + ')' + END + SEP + '*', 'i');

/**
 * @param {string} text   raw transcript
 * @param {{strict?: boolean}} [opts]  strict (default true): only the name wakes it
 * @returns {{matched: boolean, rest: string}}  `rest` = what was said after the wake word
 */
export function matchWake(text, { strict = true } = {}) {
  const t = String(text || '').trim();
  const m = t.match(strict ? STRICT_WAKE_RE : LOOSE_WAKE_RE);
  return m ? { matched: true, rest: t.slice(m[0].length).trim() } : { matched: false, rest: t };
}
