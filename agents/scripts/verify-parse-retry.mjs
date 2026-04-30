#!/usr/bin/env node
// Regression test for the 2026-04-30 InteractiveGenerator parse-retry
// hardening. Two real flakes inside 3 days — 2026-04-27 (HTML) and
// 2026-04-30 (quiz, Voting Rights Act piece) — both shaped:
//
//   parseAndValidate: Claude returned non-JSON output
//
// Pre-fix behaviour: throw exits the produce → audit → revise loop on
// round 1, abandons the entire generation, forces operator manual
// retry. Layer 1 hardening turns the throw into a counted failed
// round so the loop retries within the existing 3-round budget.
// Layer 2 (assistant-prefill `{`) reduces the rate at which Claude
// emits non-JSON in the first place.
//
// This verifier doesn't run Claude — it stubs the produce function
// and walks the loop logic, asserting:
//   - round 1 parse-fail → round 2 success → committed, roundsUsed=2
//   - rounds 1+2 parse-fail → round 3 success → committed, roundsUsed=3
//   - all 3 rounds parse-fail → terminal throw with parse-fail message
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

/** Synthetic loop that mirrors runQuizLoop's parse-fail try/catch +
 *  parseFailures bookkeeping. Deliberately omits the audit step + the
 *  publish path — we only test the parse-retry shape, not the audit
 *  loop or the commit path. A passing produce returns a stub quiz; a
 *  failing produce throws the exact PARSE_FAIL_PREFIX message. */
async function runQuizLoop(produceFn) {
  const parseFailures = [];
  let lastQuiz = null;
  let roundsUsed = 0;
  let passed = false;

  for (let round = 1; round <= INTERACTIVE_MAX_ROUNDS; round += 1) {
    roundsUsed = round;
    let produced = null;

    try {
      produced = await produceFn(round);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith(PARSE_FAIL_PREFIX)) {
        parseFailures.push({ round });
        continue;
      }
      throw err;
    }

    if (!produced) {
      // Decline path (empty shape) — not exercised by these tests.
      return { committed: false, declined: true, parseFailures, roundsUsed };
    }

    lastQuiz = produced;
    // Stub: assume audit always passes. Real loop calls the auditor
    // here; a passing audit + non-null quiz means commit.
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
  };
}

/** Stub a produceFn that fails on the first N rounds, then succeeds. */
function makeProducer(failRounds) {
  return async (round) => {
    if (round <= failRounds) {
      throw new Error(PARSE_FAIL_PREFIX);
    }
    return {
      slug: 'stub-quiz',
      title: 'Stub Quiz',
      concept: 'Test quiz returned on round > failRounds.',
      questions: [],
    };
  };
}

const cases = [
  {
    name: 'Round 1 parse-fail → round 2 success → committed',
    failRounds: 1,
    expect: {
      committed: true,
      declined: false,
      roundsUsed: 2,
      parseFailureCount: 1,
      parseFailureRounds: [1],
      throws: false,
    },
  },
  {
    name: 'Rounds 1+2 parse-fail → round 3 success → committed',
    failRounds: 2,
    expect: {
      committed: true,
      declined: false,
      roundsUsed: 3,
      parseFailureCount: 2,
      parseFailureRounds: [1, 2],
      throws: false,
    },
  },
  {
    name: 'All 3 rounds parse-fail → terminal throw with parse-fail message',
    failRounds: 3,
    expect: {
      throws: true,
      throwMessage: PARSE_FAIL_PREFIX,
    },
  },
  {
    name: 'Round 1 succeeds → committed, no parseFailures',
    failRounds: 0,
    expect: {
      committed: true,
      declined: false,
      roundsUsed: 1,
      parseFailureCount: 0,
      parseFailureRounds: [],
      throws: false,
    },
  },
];

let failed = 0;
let passed = 0;

for (const c of cases) {
  let result = null;
  let thrown = null;
  try {
    result = await runQuizLoop(makeProducer(c.failRounds));
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
      const actualRounds = result.parseFailures.map((p) => p.round);
      if (
        JSON.stringify(actualRounds) !==
        JSON.stringify(c.expect.parseFailureRounds)
      ) {
        ok = false;
        checks.push(
          `parseFailures rounds=${JSON.stringify(actualRounds)} expected ${JSON.stringify(c.expect.parseFailureRounds)}`,
        );
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
