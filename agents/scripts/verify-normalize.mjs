#!/usr/bin/env node
// Regression harness for normalizeForTTS in agents/src/shared/tts-normalize.ts.
//
// Covers the 2026-04-23 Roman-numeral fix ("Schedule I/IV/V" was being
// read as the English letter/pronoun by ElevenLabs) plus the
// Daylila prosody alias (regression check).
//
// Usage: node agents/scripts/verify-normalize.mjs (or `pnpm verify-normalize`).
// Exit code: 0 on all pass, 1 on any failure.
//
// Inline copy of the module — importing .ts from node would need full
// tsc setup; keeping a plain-JS mirror (same pattern as
// verify-splice.mjs) is the established way. Sync if one changes.

const ALIASES = [
  { pattern: /\bDaylila\b/g, replace: 'Day-lila' },
  { pattern: /\bdaylila\b/g, replace: 'day-lila' },
];

const CONTEXT_WORDS = [
  'Schedule', 'Class', 'Tier', 'Phase', 'Part', 'Chapter', 'Volume',
  'Book', 'Article', 'Section', 'Title', 'Type', 'Grade', 'Level',
  'Stage', 'Round', 'Form', 'Figure', 'Table', 'Exhibit', 'Appendix',
  'Amendment', 'Pope', 'King', 'Queen', 'Louis', 'Henry', 'Elizabeth',
  'Edward', 'George', 'Charles', 'Richard', 'World War',
].join('|');

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToNumber(s) {
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const curr = ROMAN_VALUES[s[i]];
    if (curr === undefined) return null;
    if (curr < prev) total -= curr;
    else total += curr;
    prev = curr;
  }
  return numberToRoman(total) === s ? total : null;
}

function numberToRoman(n) {
  if (n <= 0 || n >= 4000) return '';
  const table = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
    ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
    ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
  ];
  let out = '';
  let remaining = n;
  for (const [sym, val] of table) {
    while (remaining >= val) { out += sym; remaining -= val; }
  }
  return out;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n <= 0) return String(n);
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
  }
  return String(n);
}

const NUMBER_WORDS_PATTERN = (() => {
  const words = new Set();
  for (let n = 1; n < 100; n++) {
    const w = numberToWords(n);
    words.add(w);
    w.split('-').forEach((part) => words.add(part));
  }
  return Array.from(words).sort((a, b) => b.length - a.length).join('|');
})();

function convertMultiCharRoman(text) {
  return text.replace(/\b[IVXLCDM]{2,}\b/g, (match) => {
    const n = romanToNumber(match);
    return n !== null ? numberToWords(n) : match;
  });
}

function convertContextSingleRoman(text) {
  const re = new RegExp(`\\b(${CONTEXT_WORDS})\\s+([IVXLCDM])\\b`, 'g');
  return text.replace(re, (_match, ctx, letter) => {
    const n = romanToNumber(letter);
    return n !== null ? `${ctx} ${numberToWords(n)}` : _match;
  });
}

function convertListContinuation(text) {
  const re = new RegExp(
    `\\b(${NUMBER_WORDS_PATTERN})(\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s*[-–]\\s*)([IVXLCDM])\\b`,
    'g',
  );
  let prev;
  do {
    prev = text;
    text = text.replace(re, (_m, num, sep, letter) => {
      const n = romanToNumber(letter);
      return n !== null ? `${num}${sep}${numberToWords(n)}` : _m;
    });
  } while (text !== prev);
  return text;
}

function normalizeForTTS(text) {
  let out = text;
  for (const { pattern, replace } of ALIASES) {
    out = out.replace(pattern, replace);
  }
  out = convertMultiCharRoman(out);
  out = convertContextSingleRoman(out);
  out = convertListContinuation(out);
  return out;
}

let passed = 0;
let failed = 0;

function assertEq(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── 2026-04-23 trigger cases ─────────────────────────────────────
assertEq(
  'Schedule III (multi-char)',
  normalizeForTTS('Schedule III is the lighter tier.'),
  'Schedule three is the lighter tier.',
);
assertEq(
  'Schedule IV and V (list continuation — THE user-reported case)',
  normalizeForTTS('Cannabis moves from Schedule I to Schedule IV and V.'),
  'Cannabis moves from Schedule one to Schedule four and five.',
);
assertEq(
  'Schedule I (single with context)',
  normalizeForTTS('Schedule I drugs face the strictest penalties.'),
  'Schedule one drugs face the strictest penalties.',
);

// ─── Pronoun / letter protection ──────────────────────────────────
assertEq(
  'Bare pronoun I is preserved',
  normalizeForTTS('I went to the store with my friends.'),
  'I went to the store with my friends.',
);
assertEq(
  'Capital I mid-sentence stays a pronoun',
  normalizeForTTS('When I ran, I saw Maria.'),
  'When I ran, I saw Maria.',
);
assertEq(
  'iPhone unaffected (lowercase i not in char class)',
  normalizeForTTS('The iPhone ships tomorrow.'),
  'The iPhone ships tomorrow.',
);

// ─── Context-word variants ────────────────────────────────────────
assertEq(
  'Phase I → Phase one',
  normalizeForTTS('Phase I of the rollout begins Monday.'),
  'Phase one of the rollout begins Monday.',
);
assertEq(
  'Title IX → Title nine (multi-char)',
  normalizeForTTS('Title IX protections apply here.'),
  'Title nine protections apply here.',
);
assertEq(
  'Chapter XII → Chapter twelve',
  normalizeForTTS('Read Chapter XII first.'),
  'Read Chapter twelve first.',
);
assertEq(
  'Henry V → Henry five (monarch)',
  normalizeForTTS('Henry V reigned from 1413.'),
  'Henry five reigned from 1413.',
);
assertEq(
  'Louis XIV → Louis fourteen',
  normalizeForTTS('Louis XIV built Versailles.'),
  'Louis fourteen built Versailles.',
);

// ─── Regression: Daylila alias still works ───────────────────────
assertEq(
  'Daylila → Day-lila (alias, case-sensitive uppercase)',
  normalizeForTTS('Daylila Protocol starts here.'),
  'Day-lila Protocol starts here.',
);
assertEq(
  'daylila → day-lila (alias, lowercase)',
  normalizeForTTS('the daylila way is different.'),
  'the day-lila way is different.',
);

// ─── Edge cases ──────────────────────────────────────────────────
assertEq(
  'WWII unaffected (no word boundary inside)',
  normalizeForTTS('After WWII the world rebuilt.'),
  'After WWII the world rebuilt.',
);
assertEq(
  'V-neck unaffected (no number-word seed for pass 3)',
  normalizeForTTS('He wore a V-neck sweater.'),
  'He wore a V-neck sweater.',
);
assertEq(
  'Malformed Roman IIII is not a valid numeral — preserved',
  normalizeForTTS('The string IIII is invalid Roman.'),
  'The string IIII is invalid Roman.',
);
assertEq(
  'Range Schedule I–V',
  normalizeForTTS('Schedule I–V all count as controlled.'),
  'Schedule one–five all count as controlled.',
);
assertEq(
  'Long chain: I, II, and III with context',
  normalizeForTTS('Amendment I, II, and III protect speech, arms, and quartering.'),
  'Amendment one, two, and three protect speech, arms, and quartering.',
);
assertEq(
  'XXI → twenty-one (compound spelled form)',
  normalizeForTTS('Chapter XXI ends the volume.'),
  'Chapter twenty-one ends the volume.',
);
assertEq(
  'Mid-sentence bare roman with no context stays (conservative)',
  normalizeForTTS('The roman numeral V is often confused with the letter V.'),
  'The roman numeral V is often confused with the letter V.',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
