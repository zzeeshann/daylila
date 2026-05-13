#!/usr/bin/env node
// Regression test for the Curator parse-retry path.
//
// 2026-05-13 hardening: Curator's curate() now wraps extractJson in a
// two-stage parse with repair retry. On first parse-fail, re-invokes
// Claude with buildCuratorJsonRepairPrompt (quotes the broken head
// back). If repair also parse-fails, throws CuratorParseFailError
// carrying both raw bodies + stop_reasons + token usage so Director's
// catch can write a dedicated diagnostic observer_events row.
//
// Mirrors verify-parse-retry.mjs (InteractiveGenerator Layer 3) — the
// loop logic is simpler though because Curator allows exactly 2
// attempts (initial + one repair retry), not the 3-round audit-and-
// revise loop InteractiveGenerator runs.
//
// This verifier doesn't run Claude — it stubs the invoke function and
// walks the parse-retry logic, asserting:
//   - attempt 1 parses → no repair call, single attempt, brief returned
//   - attempt 1 parse-fails → repair attempt 2 fires with broken head;
//     attempt 2 parses → brief returned, tokens accumulated from both
//   - attempt 1 + attempt 2 both parse-fail → CuratorParseFailError
//     thrown with both raw bodies + stop_reasons + token usage carried
//   - empty content guard: attempt returns '{}' (empty-content fallback)
//     → parses cleanly, returns skip-shape per existing logic
//
// Sync convention: keep this file's loop mirroring curator.ts curate()
// by hand. Same convention as verify-parse-retry / verify-splice /
// verify-dedup / verify-categoriser-floor / verify-interactive-voice.
//
// Usage: node agents/scripts/verify-curator-parse-retry.mjs
// Exit code: 0 on all pass, 1 on any failure.

/** Synthetic CuratorParseFailError matching agents/src/curator.ts. */
class CuratorParseFailError extends Error {
  constructor(fields) {
    super(
      `Curator parse-fail across both attempts. ` +
        `attempt1: stop_reason=${fields.stopReasonAttempt1}, tokensOut=${fields.tokensOutAttempt1}, ` +
        `parseError=${fields.attempt1ParseError}. ` +
        `attempt2 (repair): stop_reason=${fields.stopReasonAttempt2}, tokensOut=${fields.tokensOutAttempt2}, ` +
        `parseError=${fields.attempt2ParseError}.`,
    );
    this.name = 'CuratorParseFailError';
    Object.assign(this, fields);
  }
}

/** Mirror of the relevant slice of extractJson — throws on parse-fail. */
function extractJson(text) {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  throw new Error(`Could not extract JSON from response: ${text.slice(0, 200)}`);
}

/** Synthetic curate loop that mirrors curator.ts's two-stage parse with
 *  repair retry. invokeFn is a stub returning {rawText, stopReason,
 *  tokensIn, tokensOut, durationMs} and tracks whether it was called
 *  with a repair-prompt context (we infer by sequence: 1st call is
 *  initial, 2nd is repair). */
async function curateLoop(invokeFn) {
  const calls = []; // {attempt, kind}

  calls.push({ attempt: 1, kind: 'initial' });
  const attempt1 = await invokeFn({ attempt: 1, repairHead: null });

  let parsed;
  let tokensIn = attempt1.tokensIn;
  let tokensOut = attempt1.tokensOut;
  let durationMs = attempt1.durationMs;

  try {
    parsed = extractJson(attempt1.rawText);
  } catch (parseErr1) {
    const brokenHead = attempt1.rawText.slice(0, 500);
    calls.push({ attempt: 2, kind: 'repair', brokenHead });
    const attempt2 = await invokeFn({ attempt: 2, repairHead: brokenHead });
    tokensIn += attempt2.tokensIn;
    tokensOut += attempt2.tokensOut;
    durationMs += attempt2.durationMs;
    try {
      parsed = extractJson(attempt2.rawText);
    } catch (parseErr2) {
      throw new CuratorParseFailError({
        rawTextAttempt1: attempt1.rawText,
        rawTextAttempt2: attempt2.rawText,
        stopReasonAttempt1: attempt1.stopReason,
        stopReasonAttempt2: attempt2.stopReason,
        tokensInAttempt1: attempt1.tokensIn,
        tokensOutAttempt1: attempt1.tokensOut,
        tokensInAttempt2: attempt2.tokensIn,
        tokensOutAttempt2: attempt2.tokensOut,
        attempt1ParseError: parseErr1 instanceof Error ? parseErr1.message : String(parseErr1),
        attempt2ParseError: parseErr2 instanceof Error ? parseErr2.message : String(parseErr2),
      });
    }
  }

  return { parsed, tokensIn, tokensOut, durationMs, calls };
}

const tests = [];

function assert(cond, label) {
  if (!cond) throw new Error(`assertion failed: ${label}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

// --- Test cases -------------------------------------------------------

test('attempt 1 parses → no repair call, single attempt', async () => {
  const validJson = JSON.stringify({
    selectedCandidateId: 'uuid-1',
    headline: 'h',
    date: '2026-05-13',
  });
  const result = await curateLoop(async () => ({
    rawText: validJson,
    stopReason: 'end_turn',
    tokensIn: 7000,
    tokensOut: 2500,
    durationMs: 60_000,
  }));
  assert(result.calls.length === 1, 'exactly 1 call made');
  assert(result.calls[0].kind === 'initial', 'first call is initial');
  assert(result.parsed.selectedCandidateId === 'uuid-1', 'parsed correctly');
  assert(result.tokensIn === 7000, 'tokensIn from attempt 1 only');
  assert(result.tokensOut === 2500, 'tokensOut from attempt 1 only');
});

test('attempt 1 parse-fail → repair attempt 2 parses → brief returned, tokens accumulated', async () => {
  const brokenJson = '```json\n{ "selectedCandidateId": "uuid-1", "pickReasoning": "this string never closes';
  const validJson = JSON.stringify({
    selectedCandidateId: 'uuid-2',
    headline: 'h2',
    date: '2026-05-13',
  });
  let callCount = 0;
  const result = await curateLoop(async ({ attempt, repairHead }) => {
    callCount += 1;
    if (attempt === 1) {
      assert(repairHead === null, 'attempt 1 has no repairHead');
      return { rawText: brokenJson, stopReason: 'end_turn', tokensIn: 7000, tokensOut: 4000, durationMs: 80_000 };
    }
    assert(repairHead !== null, 'attempt 2 has repairHead');
    assert(repairHead.startsWith('```json'), 'repairHead starts with the broken response start');
    return { rawText: validJson, stopReason: 'end_turn', tokensIn: 7500, tokensOut: 2500, durationMs: 60_000 };
  });
  assert(callCount === 2, 'exactly 2 calls made');
  assert(result.calls[0].kind === 'initial', 'first call is initial');
  assert(result.calls[1].kind === 'repair', 'second call is repair');
  assert(typeof result.calls[1].brokenHead === 'string' && result.calls[1].brokenHead.length > 0, 'brokenHead populated');
  assert(result.parsed.selectedCandidateId === 'uuid-2', 'parsed result from attempt 2');
  assert(result.tokensIn === 14500, 'tokensIn accumulated across both calls');
  assert(result.tokensOut === 6500, 'tokensOut accumulated across both calls');
  assert(result.durationMs === 140_000, 'durationMs accumulated across both calls');
});

test('attempt 1 + attempt 2 both parse-fail → CuratorParseFailError carries both bodies', async () => {
  const broken1 = '```json\n{ "selectedCandidateId": "uuid-1", "pickReasoning": "broken 1';
  const broken2 = '```json\n{ "selectedCandidateId": "uuid-2", "pickReasoning": "broken 2';
  let thrown = null;
  try {
    await curateLoop(async ({ attempt }) => {
      if (attempt === 1) {
        return { rawText: broken1, stopReason: 'end_turn', tokensIn: 7000, tokensOut: 4000, durationMs: 80_000 };
      }
      return { rawText: broken2, stopReason: 'max_tokens', tokensIn: 7500, tokensOut: 8000, durationMs: 100_000 };
    });
  } catch (err) {
    thrown = err;
  }
  assert(thrown !== null, 'error thrown');
  assert(thrown instanceof CuratorParseFailError, 'thrown is CuratorParseFailError');
  assert(thrown.rawTextAttempt1 === broken1, 'attempt 1 body preserved');
  assert(thrown.rawTextAttempt2 === broken2, 'attempt 2 body preserved');
  assert(thrown.stopReasonAttempt1 === 'end_turn', 'attempt 1 stop_reason preserved');
  assert(thrown.stopReasonAttempt2 === 'max_tokens', 'attempt 2 stop_reason preserved');
  assert(thrown.tokensOutAttempt1 === 4000, 'attempt 1 tokensOut preserved');
  assert(thrown.tokensOutAttempt2 === 8000, 'attempt 2 tokensOut preserved');
  assert(thrown.attempt1ParseError.includes('Could not extract JSON'), 'attempt 1 parse error preserved');
  assert(thrown.attempt2ParseError.includes('Could not extract JSON'), 'attempt 2 parse error preserved');
});

test('empty-content fallback → parses cleanly, no repair fires', async () => {
  // Mirrors the defensive `?.` pattern in invokeClaude: empty content
  // returns rawText='{}' which parses cleanly into an empty object.
  // Downstream curate() logic then treats this as a non-skip non-pick
  // (no selectedCandidateId) — the skip-vs-pick branch handles it.
  const result = await curateLoop(async () => ({
    rawText: '{}',
    stopReason: 'refusal',
    tokensIn: 7000,
    tokensOut: 0,
    durationMs: 1000,
  }));
  assert(result.calls.length === 1, 'no repair call — empty {} parses cleanly');
  assert(typeof result.parsed === 'object' && result.parsed !== null, 'parsed is an object');
  assert(Object.keys(result.parsed).length === 0, 'parsed is empty');
});

// --- Run --------------------------------------------------------------

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
