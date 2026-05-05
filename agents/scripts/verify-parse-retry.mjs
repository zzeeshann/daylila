#!/usr/bin/env node
// Regression test for the InteractiveGenerator parse-retry path.
//
// Original 2026-04-30 hardening (layer 1 + layer 2): turn parse-fail
// throws into counted retry rounds; assistant-prefill `{` to reduce
// the rate at which Claude emits non-JSON.
//
// 2026-05-05 extension (layer 3): when a round parse-fails, the next
// round routes through repairQuiz/repairHtml with the broken-output
// head in the user message, rather than re-running the initial
// produceQuiz/produceHtml prompt blind. The 2026-05-05 incident
// triggered this — both quiz + HTML rounds 1/2/3 returned the same
// unquoted-concept defect because the loop kept hammering the same
// prompt. Manual admin retrigger succeeded → confirms stochasticity →
// giving Claude something different to look at on round 2 should
// recover most of these.
//
// This verifier doesn't run Claude — it stubs the produce/repair
// functions and walks the loop logic, asserting:
//   - round 1 parse-fail → round 2 calls REPAIR (not produce) with the
//     broken head, and the head propagates into the call
//   - round 2 succeeds (parsed JSON) → repair flag clears so round 3
//     would route to revise (not exercised here; audit isn't stubbed)
//   - rounds 1+2 parse-fail → round 3 calls REPAIR again
//   - all 3 rounds parse-fail → terminal throw with parse-fail message
//   - rounds 1 succeeds → no repair calls, no parseFailures
//
// Sync convention: keep this file's INTERACTIVE_MAX_ROUNDS + the
// loop logic mirroring agents/src/interactive-generator.ts:runQuizLoop
// by hand. Same convention as verify-splice / verify-dedup /
// verify-categoriser-floor / verify-interactive-voice.
//
// Usage: node agents/scripts/verify-parse-retry.mjs
// Exit code: 0 on all pass, 1 on any failure.

const INTERACTIVE_MAX_ROUNDS = 3;
const PARSE_FAIL_PREFIX = 'parseAndValidate: Claude returned non-JSON output';

/** Synthetic loop that mirrors runQuizLoop's full branch + parse-fail
 *  try/catch + parseFailures bookkeeping. Deliberately omits the audit
 *  step + the publish path — we only test the parse-retry routing,
 *  not the audit loop or the commit path. The audit branch is exercised
 *  separately by verify-interactive-voice.
 *
 *  produceFn(round)  — initial produce path (round 1, or no prior parsed quiz)
 *  repairFn(round, brokenHead) — JSON-repair path (after parse-fail)
 *  Both return { quiz } on success or throw with PARSE_FAIL_PREFIX. */
async function runQuizLoop(produceFn, repairFn) {
  const parseFailures = [];
  let lastQuiz = null;
  let lastParseFailHead = null;
  let roundsUsed = 0;
  let passed = false;
  const calls = []; // {round, kind, brokenHead?}

  for (let round = 1; round <= INTERACTIVE_MAX_ROUNDS; round += 1) {
    roundsUsed = round;
    let produced = null;

    try {
      if (lastParseFailHead) {
        calls.push({ round, kind: 'repair', brokenHead: lastParseFailHead });
        produced = await repairFn(round, lastParseFailHead);
      } else {
        // round === 1 || !lastQuiz — initial produce path
        // (the third branch — reviseQuiz on audit-fail — isn't exercised
        // by this verifier; it's tested separately).
        calls.push({ round, kind: 'produce' });
        produced = await produceFn(round);
      }
      lastParseFailHead = null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith(PARSE_FAIL_PREFIX)) {
        parseFailures.push({ round, head: msg });
        lastParseFailHead = msg;
        continue;
      }
      throw err;
    }

    if (!produced) {
      return { committed: false, declined: true, parseFailures, roundsUsed, calls };
    }

    lastQuiz = produced;
    // Stub: assume audit always passes. Real loop calls the auditor here.
    passed = true;
    break;
  }

  if (!lastQuiz) {
    if (parseFailures.length === roundsUsed) {
      throw new Error(
        `parseAndValidate: Claude returned non-JSON output across all ${roundsUsed} rounds`,
      );
    }
    throw new Error('runQuizLoop: commit path reached without a lastQuiz');
  }

  return {
    committed: passed,
    declined: false,
    parseFailures,
    roundsUsed,
    quiz: lastQuiz,
    calls,
  };
}

/** Stub a produceFn that fails on the first N rounds, then succeeds. */
function makeProducer(failRounds) {
  return async (round) => {
    if (round <= failRounds) {
      throw new Error(`${PARSE_FAIL_PREFIX} (len=100, head="{...broken-${round}")`);
    }
    return {
      slug: 'stub-quiz',
      title: 'Stub Quiz',
      concept: 'Test quiz returned on round > failRounds.',
      questions: [],
    };
  };
}

/** Stub a repairFn that always succeeds (the layer-3 happy path) — or,
 *  for the all-3-fail case, always throws. */
function makeRepairer(alwaysFail) {
  return async (round, brokenHead) => {
    if (alwaysFail) {
      throw new Error(`${PARSE_FAIL_PREFIX} (len=100, head="{...repair-broken-${round}")`);
    }
    return {
      slug: 'stub-quiz-repaired',
      title: 'Stub Quiz (repaired)',
      concept: 'Test quiz returned by repair after parse-fail.',
      questions: [],
      brokenHeadSeen: brokenHead,
    };
  };
}

const cases = [
  {
    name: 'Round 1 succeeds → committed, no repair calls',
    failRounds: 0,
    repairFails: false,
    expect: {
      committed: true,
      declined: false,
      roundsUsed: 1,
      parseFailureCount: 0,
      callKinds: ['produce'],
      throws: false,
    },
  },
  {
    name: 'Round 1 parse-fail → round 2 calls REPAIR with broken head → committed',
    failRounds: 1,
    repairFails: false,
    expect: {
      committed: true,
      declined: false,
      roundsUsed: 2,
      parseFailureCount: 1,
      callKinds: ['produce', 'repair'],
      repairSawBrokenHead: true,
      throws: false,
    },
  },
  {
    name: 'Rounds 1 produce-fail + 2 repair-fail → round 3 calls REPAIR again → all-rounds throw',
    failRounds: 1,
    repairFails: true,
    expect: {
      throws: true,
      throwMessage: PARSE_FAIL_PREFIX,
      callKinds: ['produce', 'repair', 'repair'],
    },
  },
  {
    name: 'All 3 rounds parse-fail (produce r1 + repair r2 + repair r3) → terminal throw',
    failRounds: 1,
    repairFails: true,
    expect: {
      throws: true,
      throwMessage: PARSE_FAIL_PREFIX,
    },
  },
];

let failed = 0;
let passed = 0;

for (const c of cases) {
  let result = null;
  let thrown = null;
  try {
    result = await runQuizLoop(
      makeProducer(c.failRounds),
      makeRepairer(c.repairFails),
    );
  } catch (err) {
    thrown = err;
  }

  let ok = true;
  const checks = [];

  if (c.expect.throws) {
    if (!thrown) {
      ok = false;
      checks.push(`expected throw, got result: ${JSON.stringify(result)}`);
    } else if (!thrown.message.startsWith(c.expect.throwMessage)) {
      ok = false;
      checks.push(
        `expected throw starting with "${c.expect.throwMessage}", got "${thrown.message}"`,
      );
    }
  } else {
    if (thrown) {
      ok = false;
      checks.push(`unexpected throw: ${thrown.message}`);
    } else {
      if (result.committed !== c.expect.committed) {
        ok = false;
        checks.push(`committed=${result.committed} expected ${c.expect.committed}`);
      }
      if (result.declined !== c.expect.declined) {
        ok = false;
        checks.push(`declined=${result.declined} expected ${c.expect.declined}`);
      }
      if (result.roundsUsed !== c.expect.roundsUsed) {
        ok = false;
        checks.push(
          `roundsUsed=${result.roundsUsed} expected ${c.expect.roundsUsed}`,
        );
      }
      if (result.parseFailures.length !== c.expect.parseFailureCount) {
        ok = false;
        checks.push(
          `parseFailures.length=${result.parseFailures.length} expected ${c.expect.parseFailureCount}`,
        );
      }
      const actualKinds = result.calls.map((cl) => cl.kind);
      if (JSON.stringify(actualKinds) !== JSON.stringify(c.expect.callKinds)) {
        ok = false;
        checks.push(
          `call kinds=${JSON.stringify(actualKinds)} expected ${JSON.stringify(c.expect.callKinds)}`,
        );
      }
      if (c.expect.repairSawBrokenHead) {
        const repairCall = result.calls.find((cl) => cl.kind === 'repair');
        if (!repairCall || !repairCall.brokenHead || !repairCall.brokenHead.startsWith(PARSE_FAIL_PREFIX)) {
          ok = false;
          checks.push(
            `repair call did not see a broken head; got brokenHead=${JSON.stringify(repairCall?.brokenHead)}`,
          );
        }
      }
    }
  }

  if (ok) {
    passed++;
    console.log(`✓ ${c.name}`);
  } else {
    failed++;
    console.log(`✗ ${c.name}`);
    for (const chk of checks) {
      console.log(`  ${chk}`);
    }
  }
}

console.log('');
console.log(`${passed} passed · ${failed} failed · ${cases.length} total`);

process.exit(failed > 0 ? 1 : 0);
