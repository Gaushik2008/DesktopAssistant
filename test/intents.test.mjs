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
