// Personality: idle quips, greetings and canned replies for "Sir Pixel", the
// voxel king who lives on your desktop. Edit freely - this is pure data.

export const NAME = 'Sir Pixel';

export const IDLE_QUIPS = [
  'This throne is very comfy.',
  'All quiet in the kingdom.',
  'Need anything? Tap the mic.',
  'I could rule a few more tabs.',
  'Hydration check, my liege!',
  'Remember to stretch your royal back.',
  'Ready when you are.',
];

export const GREETINGS = ['Hail, traveller! How may I serve?', 'Your majesty! Ready for orders.', 'Hello! What shall we do?'];
export const THANKS = ['Always at your service.', 'Anytime!', 'The kingdom thanks you.'];
export const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'There are 10 kinds of people: those who understand binary and those who do not.',
  'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
  'It works on my machine - the royal decree of every developer.',
];

export function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

export const HELP_TEXT =
  'Try: "open YouTube", "play Graffitia by Green Day on Spotify", "search for pasta recipes", ' +
  '"open calculator", "what time is it", or "tell me a joke".';
