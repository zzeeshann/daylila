// Provider-agnostic text transformations applied before any TTS call.
// Lives here (not inside audio-producer.ts) because a future alternative
// TTS provider can reuse the same substitution rules without pulling
// the ElevenLabs-specific producer module.
//
// Current rules:
//   1. Brand alias: "Daylila" → "Day-lila" (prosody hint).
//   2. Roman numerals: "Schedule III" → "Schedule three",
//      "Schedule IV and V" → "Schedule four and five",
//      "Title IX" → "Title nine".
//      The English pronoun "I" is protected by requiring either a
//      multi-character Roman token, or a curated context word before a
//      single-letter Roman, or a list-continuation pattern after an
//      already-converted number word.
//
// Regression harness: agents/scripts/verify-normalize.mjs — keep the
// two files in sync by eye (same pattern as verify-splice.mjs).

const ALIASES: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /\bDaylila\b/g, replace: 'Day-lila' },
  { pattern: /\bdaylila\b/g, replace: 'day-lila' },
];

// Words that, when followed by a Roman numeral, unambiguously mean
// "what follows is a number, not a pronoun or a stray letter".
const CONTEXT_WORDS = [
  'Schedule', 'Class', 'Tier', 'Phase', 'Part', 'Chapter', 'Volume',
  'Book', 'Article', 'Section', 'Title', 'Type', 'Grade', 'Level',
  'Stage', 'Round', 'Form', 'Figure', 'Table', 'Exhibit', 'Appendix',
  'Amendment', 'Pope', 'King', 'Queen', 'Louis', 'Henry', 'Elizabeth',
  'Edward', 'George', 'Charles', 'Richard', 'World War',
].join('|');

const ROMAN_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

function romanToNumber(s: string): number | null {
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

function numberToRoman(n: number): string {
  if (n <= 0 || n >= 4000) return '';
  const table: Array<[string, number]> = [
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

function numberToWords(n: number): string {
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

// Built from numberToWords so it tracks any future change. Includes
// both compound forms ("twenty-one") and atomic parts ("twenty", "one")
// so pass 3 can match the trailing component of a hyphenated word.
const NUMBER_WORDS_PATTERN = (() => {
  const words = new Set<string>();
  for (let n = 1; n < 100; n++) {
    const w = numberToWords(n);
    words.add(w);
    w.split('-').forEach((part) => words.add(part));
  }
  return Array.from(words).sort((a, b) => b.length - a.length).join('|');
})();

// Pass 1: standalone multi-char Roman numerals. Word-boundary anchored
// so embedded sequences like WWII or iPhone don't match. Round-trip
// parse validates — rejects malformed tokens like IIII or VX.
function convertMultiCharRoman(text: string): string {
  return text.replace(/\b[IVXLCDM]{2,}\b/g, (match) => {
    const n = romanToNumber(match);
    return n !== null ? numberToWords(n) : match;
  });
}

// Pass 2: single-char Roman numeral preceded by an unambiguous context
// word (see CONTEXT_WORDS). Protects the English pronoun "I".
function convertContextSingleRoman(text: string): string {
  const re = new RegExp(`\\b(${CONTEXT_WORDS})\\s+([IVXLCDM])\\b`, 'g');
  return text.replace(re, (_match, ctx: string, letter: string) => {
    const n = romanToNumber(letter);
    return n !== null ? `${ctx} ${numberToWords(n)}` : _match;
  });
}

// Pass 3: list continuation after passes 1+2 seeded a spelled-out
// number. Catches "Schedule IV and V" → "Schedule four and five"
// (where "V" has no context word of its own but follows "four and").
// Iterates so chains like "I, II, and III" propagate fully.
function convertListContinuation(text: string): string {
  const re = new RegExp(
    `\\b(${NUMBER_WORDS_PATTERN})(\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s*[-–]\\s*)([IVXLCDM])\\b`,
    'g',
  );
  let prev: string;
  do {
    prev = text;
    text = text.replace(re, (_m, num: string, sep: string, letter: string) => {
      const n = romanToNumber(letter);
      return n !== null ? `${num}${sep}${numberToWords(n)}` : _m;
    });
  } while (text !== prev);
  return text;
}

export function normalizeForTTS(text: string): string {
  let out = text;
  for (const { pattern, replace } of ALIASES) {
    out = out.replace(pattern, replace);
  }
  out = convertMultiCharRoman(out);
  out = convertContextSingleRoman(out);
  out = convertListContinuation(out);
  return out;
}
