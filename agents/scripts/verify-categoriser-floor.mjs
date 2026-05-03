#!/usr/bin/env node
// Regression test for CategoriserAgent's empty-assignment floor +
// sub-floor confidence filter. Exercises the resolver-shape decisions
// without standing up the full agents worker.
//
// Background: the 2026-04-28 "Mystery of golden orb" piece was
// assigned 0 categories because (a) the prompt left latitude for
// Claude to return an empty assignments array, and (b) the resolver
// had no minimum-1 floor — it happily wrote zero rows. Separately the
// 2026-04-25 Cartels-and-Coordination piece wrote a 50-confidence row
// despite the prompt's stated ≥75 reuse floor — sub-floor confidence
// was never filtered code-side, only stated prompt-side.
//
// This verifier checks the three response shapes the fix has to
// handle:
//   1. {"assignments":[]} → triggers retry path (resolved=[])
//   2. {"assignments":[{categoryId, confidence: 50}]} → filtered
//      sub-floor, then resolver returns empty → triggers retry path
//   3. {"assignments":[{categoryId, confidence: 65}]} → stretch reuse
//      kept (confidence ≥ 60)
//
// Usage: node agents/scripts/verify-categoriser-floor.mjs
// Exit code: 0 on all pass, 1 on any failure.
//
// Canonical rule body lives at content/categoriser-contract.md
// (extracted 2026-05-10, Foundation Fix Task 02 eighth and final
// extraction session). Canonical TypeScript values live at
// agents/src/shared/categoriser-thresholds.ts. The inlined copies
// below stay in sync with both by hand — same convention as
// verify-splice / verify-fact-checker / verify-interactive-voice.
// This verifier tests resolver shape (parser + floor filter), not
// rule body.

// ── Inlined copies (sync by hand if categoriser.ts changes) ─────
const CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60;
const CATEGORISER_MAX_ASSIGNMENTS = 3;

function parseRawAssignments(text) {
  let parsed;
  try {
    // Loose extract — categoriser uses extractJson which handles
    // markdown fences. Real Claude output is always a clean JSON
    // object, so JSON.parse covers the test surface.
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed?.assignments) ? parsed.assignments : [];
}

function clampConfidence(n) {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/** Pure resolver — mirrors the existing-cat path in
 *  CategoriserAgent.resolveAssignments. The newCategory branch is
 *  intentionally omitted from this verifier (it requires D1 access);
 *  the floor logic this verifier proves out applies only to
 *  existing-cat assignments. Returns the kept slice. */
function resolveExistingCatAssignments(rawArr, existingIds) {
  const resolved = [];
  for (const a of rawArr.slice(0, CATEGORISER_MAX_ASSIGNMENTS)) {
    const confidence = clampConfidence(a.confidence);
    if (typeof a.categoryId !== 'string' || !existingIds.has(a.categoryId)) {
      continue; // skip novel-cat for this verifier
    }
    if (confidence < CATEGORISER_REUSE_CONFIDENCE_STRETCH) {
      continue; // sub-floor — drop
    }
    if (resolved.some((r) => r.categoryId === a.categoryId)) continue;
    resolved.push({ categoryId: a.categoryId, confidence });
  }
  return resolved;
}

// ── Test harness ────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
    if (detail !== undefined) console.error(`  ${detail}`);
  }
}

const knownIds = new Set(['cat-pattern-recognition', 'cat-information-asymmetry']);

// ── Test 1: empty assignments array ─────────────────────────────
{
  const text = '{"assignments":[]}';
  const raw = parseRawAssignments(text);
  const resolved = resolveExistingCatAssignments(raw, knownIds);
  assert(
    'empty array → raw.length === 0',
    raw.length === 0,
    `got raw.length=${raw.length}`,
  );
  assert(
    'empty array → resolved.length === 0 (retry would fire)',
    resolved.length === 0,
    `got resolved.length=${resolved.length}`,
  );
}

// ── Test 2: sub-floor confidence (Cartels @ 50 bug shape) ───────
{
  const text =
    '{"assignments":[{"categoryId":"cat-pattern-recognition","confidence":50,"reasoning":"thin"}]}';
  const raw = parseRawAssignments(text);
  const resolved = resolveExistingCatAssignments(raw, knownIds);
  assert(
    'sub-floor 50 → raw.length === 1 (Claude returned it)',
    raw.length === 1,
    `got raw.length=${raw.length}`,
  );
  assert(
    'sub-floor 50 → resolved.length === 0 (filtered, retry would fire)',
    resolved.length === 0,
    `got resolved.length=${resolved.length}`,
  );
}

// ── Test 3: stretch-reuse confidence kept ───────────────────────
{
  const text =
    '{"assignments":[{"categoryId":"cat-pattern-recognition","confidence":65,"reasoning":"adjacent mechanism, not core"}]}';
  const raw = parseRawAssignments(text);
  const resolved = resolveExistingCatAssignments(raw, knownIds);
  assert(
    'stretch-reuse 65 → resolved.length === 1 (kept)',
    resolved.length === 1,
    `got resolved.length=${resolved.length}`,
  );
  assert(
    'stretch-reuse 65 → confidence preserved',
    resolved[0]?.confidence === 65,
    `got confidence=${resolved[0]?.confidence}`,
  );
}

// ── Test 4: boundary — exactly STRETCH (60) is kept ─────────────
{
  const text =
    '{"assignments":[{"categoryId":"cat-pattern-recognition","confidence":60}]}';
  const raw = parseRawAssignments(text);
  const resolved = resolveExistingCatAssignments(raw, knownIds);
  assert(
    'boundary 60 (STRETCH floor) → kept',
    resolved.length === 1,
    `got resolved.length=${resolved.length}`,
  );
}

// ── Test 5: boundary — 59 is dropped ────────────────────────────
{
  const text =
    '{"assignments":[{"categoryId":"cat-pattern-recognition","confidence":59}]}';
  const raw = parseRawAssignments(text);
  const resolved = resolveExistingCatAssignments(raw, knownIds);
  assert(
    'boundary 59 (just below STRETCH) → dropped',
    resolved.length === 0,
    `got resolved.length=${resolved.length}`,
  );
}

// ── Test 6: malformed body falls through cleanly ────────────────
{
  const raw1 = parseRawAssignments('not json');
  const raw2 = parseRawAssignments('{"assignments":"oops"}');
  assert(
    'malformed JSON → raw === []',
    Array.isArray(raw1) && raw1.length === 0,
    `got ${JSON.stringify(raw1)}`,
  );
  assert(
    'non-array assignments → raw === []',
    Array.isArray(raw2) && raw2.length === 0,
    `got ${JSON.stringify(raw2)}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
