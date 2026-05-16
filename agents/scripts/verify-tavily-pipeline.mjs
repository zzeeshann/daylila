#!/usr/bin/env node
// Regression test for the 2026-05-16 Tavily-backed fact-checker
// pipeline (agents/src/fact-checker-tavily.ts).
//
// The orchestrator runs three independent legs — Extract (Claude call),
// Search (Tavily HTTP + D1 cache lookup), Verify (Claude call). This
// verifier doesn't run Claude or hit Tavily; it stubs both and walks
// the orchestrator-shaped logic, asserting:
//
//   1. Clean pipeline (all 3 claims found, snippets returned, verdicts
//      come back). Aggregated FactCheckResult shape correct, sources
//      flat-deduped from snippet URLs.
//   2. Cache hit on round 2 — fingerprints match identical claim/query
//      pairs across calls; the second invocation reuses snippets +
//      verdict without a Tavily roundtrip. searchUsed=false on the
//      cache-only run.
//   3. Tavily 429 fallthrough — when search throws for every claim,
//      each claim falls through to verdict='unverified' with
//      note='search failed' and searchAvailable=false.
//
// Sync convention: keep this file mirroring the orchestrator by hand.
// Same convention as verify-curator-parse-retry.mjs / verify-splice.mjs.
//
// Usage: node agents/scripts/verify-tavily-pipeline.mjs
// Exit code: 0 on all pass, 1 on any failure.

import { createHash } from 'node:crypto';

// ── JS mirrors of the orchestrator's helpers ───────────────────────

function normaliseForFingerprint(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/u, '').trim();
}

function fingerprint(claim_text, search_query) {
  return createHash('sha256')
    .update(`${normaliseForFingerprint(claim_text)}|${normaliseForFingerprint(search_query)}`)
    .digest('hex');
}

const TAVILY_CACHE_TTL_DAYS = 30;
const TAVILY_CACHE_TTL_MS = TAVILY_CACHE_TTL_DAYS * 86_400_000;

const TAVILY_CLAIM_VERDICTS = new Set([
  'verified',
  'unverified',
  'contradicted',
  'cutoff_confession_attempted',
  'unknown',
]);

function tavilyVerdictToFactStatus(v) {
  switch (v) {
    case 'verified': return 'verified';
    case 'contradicted': return 'incorrect';
    case 'cutoff_confession_attempted':
    case 'unverified':
    case 'unknown':
    default: return 'unverified';
  }
}

// ── Mini-orchestrator that mirrors checkViaTavily() shape ──────────
//
// Stubs replace the three external dependencies:
//   - extractStub: replaces Claude Extract call
//   - searchStub:  replaces tavilySearch + D1 cache lookup
//   - verifyStub:  replaces Claude Verify call
//
// Each stub is async and returns the same shape the real call does so
// the orchestrator's branching logic can be exercised end-to-end.

async function orchestrate({ extractStub, searchStub, verifyStub, sourcePieceId }) {
  const totalStart = Date.now();

  // Step 1: extract
  const extracted = await extractStub();
  if (extracted.parseError) {
    return {
      passed: true,
      claims: [],
      searchUsed: false,
      searchAvailable: true,
      sources: [],
      failureReasons: [],
      parseError: extracted.parseError,
      tokensIn: extracted.tokensIn,
      tokensOut: extracted.tokensOut,
      durationMs: Date.now() - totalStart,
    };
  }
  if (extracted.claims.length === 0) {
    return {
      passed: true,
      claims: [],
      searchUsed: false,
      searchAvailable: true,
      sources: [],
      failureReasons: [],
      parseError: null,
      tokensIn: extracted.tokensIn,
      tokensOut: extracted.tokensOut,
      durationMs: Date.now() - totalStart,
    };
  }

  // Step 2: search (per claim)
  const outcomes = await Promise.all(
    extracted.claims.map(async (c) => {
      const fp = fingerprint(c.claim_text, c.search_query);
      const res = await searchStub({ claim: c, fp });
      return {
        claim_id: c.claim_id,
        claim_text: c.claim_text,
        search_query: c.search_query,
        snippets: res.snippets,
        verdict: res.verdict, // default if Verify misses; updated below
        note: res.note,
        fromCache: res.fromCache,
      };
    }),
  );

  // Step 3: verify
  const verified = await verifyStub(outcomes);
  for (const outcome of outcomes) {
    const v = verified.perClaim.get(outcome.claim_id);
    if (v) {
      outcome.verdict = v.verdict;
      outcome.note = v.note;
    }
  }

  const claims = outcomes.map((o) => ({
    claim: o.claim_text,
    status: tavilyVerdictToFactStatus(o.verdict),
    note: o.note,
  }));
  const hasContradicted = outcomes.some((o) => o.verdict === 'contradicted');
  const flatSources = Array.from(
    new Set(outcomes.flatMap((o) => o.snippets.map((s) => s.url)).filter((u) => u && u.length > 0)),
  );

  return {
    passed: !hasContradicted,
    claims,
    searchUsed: outcomes.some((o) => !o.fromCache),
    searchAvailable: !outcomes.every((o) => o.verdict === 'unverified' && o.note === 'search failed'),
    sources: flatSources,
    failureReasons: verified.failureReasons,
    parseError: verified.parseError,
    tokensIn: extracted.tokensIn + verified.tokensIn,
    tokensOut: extracted.tokensOut + verified.tokensOut,
    durationMs: Date.now() - totalStart,
  };
}

// ── Test harness ───────────────────────────────────────────────────

const tests = [];

function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

// ── Tests ──────────────────────────────────────────────────────────

test('clean pipeline: 3 claims extracted → snippets returned → verdicts pass', async () => {
  const claims = [
    { claim_id: 'c1', claim_text: 'water boils at 100°C at sea level', search_query: 'water boiling point sea level' },
    { claim_id: 'c2', claim_text: 'the Eiffel Tower is in Paris', search_query: 'Eiffel Tower location' },
    { claim_id: 'c3', claim_text: 'a year on Mars is 687 Earth days', search_query: 'Mars orbital period Earth days' },
  ];
  const verdicts = new Map([
    ['c1', { verdict: 'verified', note: 'snippet 1 confirms — physics textbook' }],
    ['c2', { verdict: 'verified', note: 'snippet 1 confirms — Wikipedia geography' }],
    ['c3', { verdict: 'verified', note: 'snippet 2 confirms — NASA Mars fact sheet' }],
  ]);
  const result = await orchestrate({
    extractStub: async () => ({ claims, tokensIn: 5000, tokensOut: 800, durationMs: 4000, parseError: null }),
    searchStub: async ({ claim }) => ({
      snippets: [
        { title: `Result for ${claim.search_query}`, url: `https://example.com/${claim.claim_id}-1`, content: 'snippet text', score: 0.9 },
        { title: 'Secondary', url: `https://example.com/${claim.claim_id}-2`, content: 'second snippet', score: 0.7 },
      ],
      verdict: 'unknown',
      note: '',
      fromCache: false,
    }),
    verifyStub: async () => ({
      perClaim: verdicts,
      failureReasons: [],
      tokensIn: 12000,
      tokensOut: 800,
      durationMs: 5000,
      parseError: null,
    }),
  });

  assert(result.passed === true, 'passed=true on all-verified');
  assert(result.claims.length === 3, '3 claims in result');
  assert(result.claims[0].status === 'verified', 'first claim verified');
  assert(result.searchUsed === true, 'search was used (no cache)');
  assert(result.searchAvailable === true, 'search available');
  assert(result.sources.length === 6, '6 unique URLs flat-deduped (3 claims × 2 snippets)');
  assert(result.tokensIn === 17000, 'tokensIn = extract + verify');
  assert(result.tokensOut === 1600, 'tokensOut = extract + verify');
  assert(result.failureReasons.length === 0, 'no failure_reasons on clean pass');
});

test('cache hit on round 2: same claims, second run skips Tavily entirely', async () => {
  const claims = [
    { claim_id: 'c1', claim_text: 'water boils at 100°C', search_query: 'water boiling point' },
  ];
  // First run: fresh search (fromCache=false)
  const cache = new Map();
  const result1 = await orchestrate({
    extractStub: async () => ({ claims, tokensIn: 4000, tokensOut: 500, durationMs: 3000, parseError: null }),
    searchStub: async ({ claim, fp }) => {
      const cached = cache.get(fp);
      if (cached) {
        return { snippets: cached.snippets, verdict: cached.verdict, note: 'from cache', fromCache: true };
      }
      const snippets = [{ title: 'Boiling Point', url: 'https://chem.example.com/water', content: 'water at 1 atm', score: 0.95 }];
      cache.set(fp, { snippets, verdict: 'verified' });
      return { snippets, verdict: 'unknown', note: '', fromCache: false };
    },
    verifyStub: async () => ({
      perClaim: new Map([['c1', { verdict: 'verified', note: 'snippet 1 — physics' }]]),
      failureReasons: [],
      tokensIn: 6000,
      tokensOut: 400,
      durationMs: 3500,
      parseError: null,
    }),
  });
  assert(result1.searchUsed === true, 'first run hits Tavily');

  // Second run: cache should fire
  let tavilyCallCount = 0;
  const result2 = await orchestrate({
    extractStub: async () => ({ claims, tokensIn: 4000, tokensOut: 500, durationMs: 3000, parseError: null }),
    searchStub: async ({ claim, fp }) => {
      const cached = cache.get(fp);
      if (cached) {
        return { snippets: cached.snippets, verdict: cached.verdict, note: 'from cache', fromCache: true };
      }
      tavilyCallCount += 1;
      return { snippets: [], verdict: 'unverified', note: 'search failed', fromCache: false };
    },
    verifyStub: async () => ({
      perClaim: new Map([['c1', { verdict: 'verified', note: 'snippet 1 — physics' }]]),
      failureReasons: [],
      tokensIn: 6000,
      tokensOut: 400,
      durationMs: 3500,
      parseError: null,
    }),
  });

  assert(tavilyCallCount === 0, 'second run hit zero Tavily calls (cache satisfied)');
  assert(result2.searchUsed === false, 'searchUsed=false when every claim came from cache');
  assert(result2.searchAvailable === true, 'searchAvailable=true even when not used');
  assert(result2.claims[0].status === 'verified', 'cached verdict carried through to FactClaim.status');
  assert(result2.sources.length === 1, 'cached snippet URL flows through to sources');
});

test('Tavily down: all claims fall through to unverified+search-failed', async () => {
  const claims = [
    { claim_id: 'c1', claim_text: 'claim one', search_query: 'q1' },
    { claim_id: 'c2', claim_text: 'claim two', search_query: 'q2' },
  ];
  const result = await orchestrate({
    extractStub: async () => ({ claims, tokensIn: 4000, tokensOut: 500, durationMs: 3000, parseError: null }),
    searchStub: async () => ({ snippets: [], verdict: 'unverified', note: 'search failed', fromCache: false }),
    verifyStub: async (outcomes) => {
      // Verify step sees missing snippets → marks every claim unverified
      // and emits missing_source token.
      const perClaim = new Map();
      for (const o of outcomes) {
        perClaim.set(o.claim_id, { verdict: 'unverified', note: 'search failed' });
      }
      return { perClaim, failureReasons: ['missing_source'], tokensIn: 4000, tokensOut: 300, durationMs: 2000, parseError: null };
    },
  });

  assert(result.passed === true, 'passed=true (no contradicted — gate is asymmetric)');
  assert(result.searchUsed === true, 'searchUsed=true (Tavily attempted, even if all failed)');
  assert(result.searchAvailable === false, 'searchAvailable=false when every claim resolved as unverified+search-failed');
  assert(result.sources.length === 0, 'no sources when search returned nothing');
  assert(result.failureReasons.includes('missing_source'), 'missing_source emitted');
  assert(result.claims.every((c) => c.status === 'unverified'), 'every claim unverified');
});

// ── Run ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`✓ ${t.name}`);
    passed += 1;
  } catch (err) {
    console.log(`✗ ${t.name} — ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}
console.log(`\n${passed} passed · ${failed} failed · ${tests.length} total`);
process.exit(failed === 0 ? 0 : 1);
