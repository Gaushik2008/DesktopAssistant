import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, normalize } from '../src/web/core/intents.js';
import { isSafeUrl, findApp, findSite } from '../src/web/core/catalog.js';

test('normalize strips wake word, politeness and punctuation', () => {
  assert.equal(normalize('Hey Sir Pixel, please open YouTube.'), 'open YouTube');
  assert.equal(normalize('Could you open youtube for me?'), 'open youtube');
});

test('"Open YouTube" opens the site (matches screencast)', () => {
  const r = parse('Open YouTube.');
  assert.equal(r.intent, 'open-site');
  assert.equal(r.reply, 'Opened YouTube in your browser.');
  assert.deepEqual(r.action, { kind: 'open-url', url: 'https://www.youtube.com' });
});

test('"Play Graffitia by Green Day on Spotify" -> Spotify search (matches screencast)', () => {
  const r = parse('Play Graffitia by Green Day on Spotify.');
  assert.equal(r.intent, 'play-spotify');
  assert.deepEqual(r.action, { kind: 'open-app', appId: 'spotify', query: 'graffitia by green day' });
});

test('play ... on youtube builds a YouTube search URL', () => {
  const r = parse('play lofi beats on youtube');
  assert.equal(r.action.url, 'https://www.youtube.com/results?search_query=lofi%20beats');
});

test('play without platform defaults to Spotify', () => {
  assert.equal(parse('play thunderstruck').action.appId, 'spotify');
});

test('open known app and unknown app', () => {
  assert.deepEqual(parse('open calculator').action, { kind: 'open-app', appId: 'calculator' });
  const u = parse('open flibbertigibbet');
  assert.equal(u.intent, 'unknown-app');
  assert.equal(u.action, null);
});

test('open a spoken domain', () => {
  assert.equal(parse('open example dot com').action.url, 'https://example.com');
});

test('search routes', () => {
  assert.equal(parse('search for pasta recipes').action.url, 'https://www.google.com/search?q=pasta%20recipes');
  assert.match(parse('search cats on youtube').action.url, /youtube\.com\/results/);
});

test('time uses injected clock', () => {
  const r = parse('what time is it', { now: new Date('2026-11-25T15:04:00') });
  assert.equal(r.intent, 'time');
  assert.match(r.reply, /^It is /);
});

test('small talk and fallbacks', () => {
  assert.equal(parse('hello').intent, 'greeting');
  assert.equal(parse('tell me a joke').intent, 'joke');
  assert.equal(parse('').intent, 'empty');
  assert.equal(parse('xyzzy plugh').intent, 'unknown');
  assert.equal(parse('cancel').intent, 'cancel');
});

test('URL safety rejects dangerous schemes', () => {
  assert.ok(isSafeUrl('https://example.com'));
  assert.ok(isSafeUrl('spotify:search:abc'));
  assert.ok(!isSafeUrl('javascript:alert(1)'));
  assert.ok(!isSafeUrl('file:///etc/passwd'));
  assert.ok(!isSafeUrl('not a url'));
});

test('catalog lookups', () => {
  assert.equal(findApp('calc').id, 'calculator');
  assert.equal(findSite('yt').id, 'youtube');
  assert.equal(findSite('nope'), null);
});

import { parseDuration, formatDuration, evalMath } from '../src/web/core/utils.js';

test('parseDuration handles digits, words and combos', () => {
  assert.equal(parseDuration('5 minutes'), 300000);
  assert.equal(parseDuration('1 hour 30 minutes'), 5400000);
  assert.equal(parseDuration('ten seconds'), 10000);
  assert.equal(parseDuration('half an hour'), 1800000);
  assert.equal(parseDuration('banana'), null);
  assert.equal(formatDuration(5400000), '1 hour 30 minutes');
});

test('evalMath is correct and safe', () => {
  assert.equal(evalMath('12 times 7'), 84);
  assert.equal(evalMath('(3 + 4) * 2'), 14);
  assert.equal(evalMath('2 to the power of 10'), 1024);
  assert.equal(evalMath('10 minus 3 minus 2'), 5);
  assert.equal(evalMath('-5 + 8'), 3);
  assert.equal(evalMath('1 divided by 0'), null);
  assert.equal(evalMath('process.exit()'), null);
  assert.equal(evalMath('2 +'), null);
});

test('timer / reminder intents produce timer actions', () => {
  let r = parse('Set a timer for 5 minutes.');
  assert.deepEqual(r.action, { kind: 'timer', ms: 300000, label: 'Timer: 5 minutes' });
  r = parse('set a 10 minute timer');
  assert.equal(r.action.ms, 600000);
  r = parse('remind me to stretch in 20 minutes');
  assert.equal(r.intent, 'reminder');
  assert.equal(r.action.ms, 1200000);
  assert.equal(r.action.label, 'Reminder: stretch');
  assert.equal(parse('set a timer').intent === 'timer-bad' || parse('set a timer').intent === 'unknown', true);
});

test('notes, math, coin and dice intents', () => {
  assert.deepEqual(parse('take a note buy milk').action, { kind: 'note', text: 'buy milk' });
  assert.equal(parse('read my notes').action.kind, 'list-notes');
  assert.equal(parse("what's 12 times 7").reply, '12 times 7 is 84.');
  assert.equal(parse('flip a coin', { rng: () => 0.1 }).reply, 'Heads.');
  assert.equal(parse('roll a dice', { rng: () => 0 }).reply, 'You rolled a 1 (d6).');
  assert.equal(parse('roll a d20', { rng: () => 0.99 }).reply, 'You rolled a 20 (d20).');
});

test('unknown app offers a search follow-up; "yes" is a confirm intent', () => {
  const r = parse('open frobnicator');
  assert.equal(r.intent, 'unknown-app');
  assert.equal(r.followUp.url, 'https://www.google.com/search?q=frobnicator');
  assert.equal(parse('yes').intent, 'confirm');
});
