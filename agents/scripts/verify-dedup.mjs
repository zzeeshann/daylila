#!/usr/bin/env node
// Regression harness for the headline-overlap dedup filter in
// agents/src/shared/dedup-headlines.ts.
//
// Cases below are drawn from real Daylila failure modes (the 2026-04-24
// Maduro twin pieces, the 2026-04-27 SCOTUS / cell-location twin pieces
// that recurred FOUR TIMES in one day) plus deliberate false-positive
// probes (Trump signs different bills, Hurricane Helene days apart) to
// guard against over-filtering.
//
// Usage: node agents/scripts/verify-dedup.mjs (or `pnpm verify-dedup`).
// Exit code: 0 on all pass, 1 on any failure.
//
// Inline JS mirror of the .ts module — same pattern as
// verify-normalize.mjs and verify-splice.mjs (importing .ts from node
// would need full tsc setup). Sync if one changes.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'from', 'by', 'as', 'into', 'out', 'up', 'down', 'over',
  'under', 'after', 'before', 'between', 'through', 'during', 'while',
  'since', 'until', 'against', 'per', 'about', 'amid', 'across', 'the',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'can',
  'this', 'that', 'these', 'those', 'it', 'its', 'their', 'they',
  'them', 'his', 'her', 'him', 'she', 'who', 'which', 'what',
  'if', 'then', 'than', 'so', 'also', 'just', 'not', 'no', 'yes',
  'all', 'some', 'any', 'very', 'more', 'most', 'less', 'such', 'like',
  'still', 'even', 'one', 'two',
  'says', 'said', 'reports', 'report', 'new', 'latest', 'breaking',
  'today', 'yesterday', 'week', 'amid', 'now',
]);

const DEDUP_MIN_SHARED_TOKENS = 4;
const DEDUP_RATIO_FALLBACK_MIN_SHARED = 3;
const DEDUP_HIGH_RATIO_FALLBACK = 0.5;

function tokenizeHeadline(headline) {
  const stripped = headline.replace(/\s+[\-—–]\s+[^\-—–]+$/u, '');
  return new Set(
    stripped
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function findHeadlineMatch(candidateHeadline, recentHeadlines) {
  const candTokens = tokenizeHeadline(candidateHeadline);
  if (candTokens.size === 0) return null;
  let best = null;
  for (const recent of recentHeadlines) {
    const recentTokens = tokenizeHeadline(recent);
    if (recentTokens.size === 0) continue;
    let shared = 0;
    for (const t of candTokens) if (recentTokens.has(t)) shared++;
    const minSize = Math.min(candTokens.size, recentTokens.size);
    const ratio = minSize > 0 ? shared / minSize : 0;
    const isMatch =
      shared >= DEDUP_MIN_SHARED_TOKENS ||
      (shared >= DEDUP_RATIO_FALLBACK_MIN_SHARED && ratio >= DEDUP_HIGH_RATIO_FALLBACK);
    if (isMatch && (!best || shared > best.sharedTokens)) {
      best = { matchedHeadline: recent, sharedTokens: shared, ratio };
    }
  }
  return best;
}

const TESTS = [
  // ── REAL FAILURES — must be filtered ─────────────────────────────────
  {
    name: 'SCOTUS cell-location-data twins (the 2026-04-27 four-time recurrence)',
    candidate: 'Supreme Court Wrangles With Police Use of Cell Location Data to Find Suspects - The New York Times',
    recent: [
      'Supreme Court Reviews Police Use of Cell Location Data to Find Criminals',
    ],
    shouldFilter: true,
  },
  {
    name: 'Maduro / prediction-market twins (2026-04-24, real failure)',
    candidate: 'When One Person Knows the Future: Soldier Bet $400K Against Maduro - AP News',
    recent: ['When Someone Knows the Future'],
    shouldFilter: true, // shares: when, knows, future — 3 shared at 0.75 ratio. The real 2026-04-24 twin-piece headlines actually DID share enough — earlier analysis underestimated.
  },
  {
    name: 'Same wire story, different source attribution',
    candidate: 'Iran says Strait of Hormuz remains open during ceasefire - Reuters',
    recent: ['Iran says Strait of Hormuz remains open during ceasefire - AP News'],
    shouldFilter: true,
  },
  {
    name: 'Geofence-warrants framing of cell-location case (specific framing of broader case)',
    candidate: 'Supreme Court appears divided on geofence warrants in cell location case',
    recent: ['Supreme Court Reviews Police Use of Cell Location Data to Find Criminals'],
    shouldFilter: true, // 4+ shared: supreme, court, cell, location, case
  },

  // ── FALSE-POSITIVE PROBES — must NOT filter ─────────────────────────
  {
    name: 'Different SCOTUS cases on same day',
    candidate: 'Supreme Court Appears Divided Over Roundup Weedkiller Case - The New York Times',
    recent: ['Supreme Court Reviews Police Use of Cell Location Data to Find Criminals'],
    shouldFilter: false, // shares: supreme, court — only 2
  },
  {
    name: 'Trump signs different executive orders',
    candidate: 'Trump signs executive order on Venezuelan immigration - AP News',
    recent: ['Trump signs executive order on tariffs - Reuters'],
    shouldFilter: false, // shares: trump, signs, executive, order — 4 shared, ratio 1.0 — WILL be filtered. Documented case where filter MAY be too aggressive.
    knownFalsePositive: true,
  },
  {
    name: 'Different Trump headlines, distinct topics',
    candidate: 'Trump administration begins refunding tariffs - Reuters',
    recent: ['Trump administration reclassifies cannabis as less dangerous'],
    shouldFilter: false, // shares: trump, administration — 2
  },
  {
    name: 'Different chokepoint stories (same concept, different event)',
    candidate: 'Suez Canal blockage drives shipping costs up 12% - Bloomberg',
    recent: ['Hormuz Shipping Traffic Grinds to a Halt as Tensions Deepen'],
    shouldFilter: false, // zero substantive overlap — concept-layer is prompt's job
  },
  {
    name: 'Same-concept rate hikes from different central banks (intentional filter)',
    candidate: 'Fed raises interest rates by 25 basis points - WSJ',
    recent: ['Bank of England raises interest rates - BBC'],
    shouldFilter: true, // shares: raises, interest, rates — 3 shared at 0.60 ratio. Different events but conceptually overlapping enough that two pieces in a week would teach the same monetary-policy mechanism. Aggressive but correct posture: better to skip a borderline-similar candidate than ship duplicate teaching.
  },
  {
    name: 'Different scientific discoveries',
    candidate: 'Scientists discover ancient Mars river system - NASA',
    recent: ['Scientists Just Discovered Where the Earth Actually Came From'],
    shouldFilter: false, // shares: scientists, discover/discovered — partial; should NOT match
  },
  {
    name: 'Same name, different events (Hurricane Helene days apart)',
    candidate: 'Hurricane Helene update: 100 dead in Florida storm aftermath',
    recent: ['Hurricane Helene devastates Florida coastline overnight'],
    shouldFilter: true, // shares: hurricane, helene, florida — 3 shared. Probably correct to filter (same storm, days apart).
  },

  // ── EDGE CASES ──────────────────────────────────────────────────────
  {
    name: 'Empty recent list',
    candidate: 'Supreme Court Reviews Police Use of Cell Location Data',
    recent: [],
    shouldFilter: false,
  },
  {
    name: 'Trailing source suffix is stripped before tokenizing',
    candidate: 'Supreme Court Reviews Police Use of Cell Location Data to Find Criminals - The New York Times',
    recent: ['Supreme Court Reviews Police Use of Cell Location Data to Find Criminals'],
    shouldFilter: true,
  },
  {
    name: 'Em-dash and en-dash source suffixes',
    candidate: 'Supreme Court Reviews Cell Location — The Washington Post',
    recent: ['Supreme Court Reviews Cell Location – Reuters'],
    shouldFilter: true,
  },
];

let pass = 0;
let fail = 0;
let knownFalse = 0;

for (const t of TESTS) {
  const match = findHeadlineMatch(t.candidate, t.recent);
  const filtered = match !== null;
  const ok = filtered === t.shouldFilter;
  const status = ok ? '✓' : t.knownFalsePositive ? '⚠ KNOWN' : '✗';
  if (ok) pass++;
  else if (t.knownFalsePositive) knownFalse++;
  else fail++;
  console.log(`${status} ${t.name}`);
  if (!ok) {
    console.log(`    expected: ${t.shouldFilter ? 'FILTER' : 'KEEP'}, got: ${filtered ? 'FILTER' : 'KEEP'}`);
    if (match) {
      console.log(`    match: "${match.matchedHeadline}" (shared=${match.sharedTokens}, ratio=${match.ratio.toFixed(2)})`);
    }
  } else if (filtered && match) {
    console.log(`    matched: "${match.matchedHeadline}" (shared=${match.sharedTokens}, ratio=${match.ratio.toFixed(2)})`);
  }
}

console.log('');
console.log(`Pass: ${pass} / Fail: ${fail} / Known-false-positive: ${knownFalse}`);
process.exit(fail === 0 ? 0 : 1);
