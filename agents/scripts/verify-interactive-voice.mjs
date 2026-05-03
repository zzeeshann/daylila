#!/usr/bin/env node
// Regression test for the Plain-English-for-interactives rule shipped
// in the interactive generator + auditor prompts.
//
// Background: quizzes were passing voice 88/100 with stems like
//   "Why does asymmetry in outside options destabilize coordination
//    agreements even when mutual restraint would benefit all
//    participants?"
// Contract-compliant on the letter ("plain English. No jargon without
// immediate translation"), but a curious 14-year-old has to re-read
// twice. The fix splits register: precise concept name lives in
// `title` and `concept` line only; question stems / options /
// explanations use everyday words.
//
// This verifier doesn't run Claude — it tests a JS-side heuristic that
// MIRRORS the prompt's flag-list. The Claude auditor remains the
// runtime gate; this script regression-checks the rule shape so that
// if the flag-list drifts (here vs. the prompt), the test fails until
// they're realigned.
//
// Usage: node agents/scripts/verify-interactive-voice.mjs
// Exit code: 0 on all pass, 1 on any failure.
//
// Sync convention: keep JARGON_FLAG_LIST + HEDGE_PATTERNS below
// aligned by hand with the canonical Plain English split rule in
// content/interactive-contract.md (the Plain English split rule
// section + jargon translation list). Same convention as
// verify-categoriser-floor.mjs / verify-splice / verify-dedup —
// the verifier mirrors the contract; the contract is the source.
// Pre-2026-05-05 the canonical sources were the two prompt files;
// the rule moved into the contract during the third extraction
// session and the prompts now read from the contract.

// ── Inlined heuristic (sync by hand if prompts change) ──────────────
//
// Flag-list of concept-jargon to translate inside stems / options /
// explanations. The same words are CORRECT in the `title` and
// `concept` line — they're the precise concept name doing its job —
// so the checker never inspects those fields.
const JARGON_FLAG_LIST = [
  'asymmetry',
  'coordination',
  'mitigation',
  'throughput',
  'allocation',
  'displacement',
  'propagation',
  'restraint',
  'structural',
  'mechanism',
  'aggregate',
  'threshold',
  'trade-off',
];

// Hedge phrases banned in explanations. Quizzes make claims, not
// hedges. Scope-bound to whole-phrase regex so single-word matches
// don't false-trigger ("could" alone is fine).
const HEDGE_PATTERNS = [
  /could be argued/i,
  /might potentially/i,
  /\barguably\b/i,
  /it is suggested that/i,
  /it could be that/i,
  /one might consider/i,
];

/** Word-boundary check so "mechanically" does NOT match "mechanism".
 *  Hyphenated jargon like "trade-off" is escaped explicitly. */
function jargonRegex(word) {
  const escaped = word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

/** Pure rule-checker. Returns array of violation objects, empty when
 *  the quiz passes. Mirrors what the prompt asks Claude to flag, but
 *  scoped to deterministic word-list + regex catches. The Claude
 *  auditor still runs in production for the wider judgmental cases
 *  (vocabulary not on this list, register-by-feel, etc.). */
function checkSimpleEnglish(quiz) {
  const violations = [];
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] ?? {};
    const stem = typeof q.question === 'string' ? q.question : '';
    const options = Array.isArray(q.options) ? q.options : [];
    const explanation = typeof q.explanation === 'string' ? q.explanation : '';

    for (const word of JARGON_FLAG_LIST) {
      const re = jargonRegex(word);
      if (re.test(stem)) {
        violations.push({ field: 'question', index: i, word, text: stem });
      }
      for (let j = 0; j < options.length; j++) {
        const opt = typeof options[j] === 'string' ? options[j] : '';
        if (re.test(opt)) {
          violations.push({ field: 'option', index: i, optionIndex: j, word, text: opt });
        }
      }
      if (re.test(explanation)) {
        violations.push({ field: 'explanation', index: i, word, text: explanation });
      }
    }

    for (const re of HEDGE_PATTERNS) {
      if (re.test(explanation)) {
        violations.push({ field: 'explanation-hedge', index: i, pattern: String(re), text: explanation });
      }
    }
  }

  // Title and concept line are EXEMPT by design — the precise concept
  // term is correct there. No checks against quiz.title / quiz.concept.

  return violations;
}

// ── Test fixtures ───────────────────────────────────────────────────

const cases = [
  {
    name: 'Bad: stem contains "asymmetry"',
    quiz: {
      title: 'Information Asymmetry',
      concept: 'When one side knows more, prices and trust can collapse.',
      questions: [
        {
          question: 'Why does asymmetry in outside options destabilize deals?',
          options: ['A', 'B', 'C', 'D'],
          correctIndex: 0,
          explanation: 'Because one side has more leverage.',
        },
      ],
    },
    expectViolation: true,
    expectField: 'question',
    expectWord: 'asymmetry',
  },
  {
    name: 'Bad: option contains "coordination"',
    quiz: {
      title: 'Holding the Line',
      concept: 'Why deals fall apart when one side has more options.',
      questions: [
        {
          question: 'Why do deals fall apart when one side can walk away?',
          options: [
            'Because the weaker side absorbs more loss',
            'Because coordination breaks',
            'Because both sides win',
            'Because nothing changes',
          ],
          correctIndex: 0,
          explanation: 'The side with options pivots; the other absorbs the loss.',
        },
      ],
    },
    expectViolation: true,
    expectField: 'option',
    expectWord: 'coordination',
  },
  {
    name: 'Bad: explanation contains hedge phrase "could be argued"',
    quiz: {
      title: 'Tipping Points',
      concept: 'A small push can flip a system that looked stable.',
      questions: [
        {
          question: 'What flips a stable system into a different state?',
          options: ['A small push at the right place', 'Nothing', 'Time', 'Money'],
          correctIndex: 0,
          explanation: 'It could be argued that small pushes near a tipping point have outsized effects.',
        },
      ],
    },
    expectViolation: true,
    expectField: 'explanation-hedge',
  },
  {
    name: 'Good: stem with everyday words, options plain, explanation declarative',
    quiz: {
      title: 'Walk-Away Power',
      concept: 'When one side has more options, deals get fragile.',
      questions: [
        {
          question: 'Why do deals fall apart when one side has more options to walk away?',
          options: [
            'The side with options can leave; the other absorbs the loss',
            'Both sides always benefit equally',
            'The deal becomes more stable',
            'Nothing changes',
          ],
          correctIndex: 0,
          explanation: 'The side with somewhere to go pivots when things get hard. The side without alternatives stays and pays.',
        },
      ],
    },
    expectViolation: false,
  },
  {
    name: 'Good: title contains "Information Asymmetry" — title is EXEMPT',
    quiz: {
      title: 'Information Asymmetry',
      concept: 'A precise term in the title is correct register.',
      questions: [
        {
          question: 'Why does the side that knows more usually win in a trade?',
          options: ['They can spot bad deals', 'Luck', 'The other side helps', 'Nothing'],
          correctIndex: 0,
          explanation: 'The side that sees clearly avoids the trades that hurt them.',
        },
      ],
    },
    expectViolation: false,
  },
  {
    name: 'Good: concept line uses "asymmetry" — concept line is EXEMPT',
    quiz: {
      title: 'Walk-Away Power',
      concept: 'Asymmetry in outside options destabilizes agreements between two parties.',
      questions: [
        {
          question: 'Why do deals fall apart when one side has more options?',
          options: ['The other side absorbs the loss', 'Time', 'Luck', 'Nothing'],
          correctIndex: 0,
          explanation: 'The side with options can leave. The side without options stays and pays.',
        },
      ],
    },
    expectViolation: false,
  },
  {
    name: 'Edge: "mechanically" must NOT match "mechanism" (word boundary)',
    quiz: {
      title: 'How Things Work',
      concept: 'Some processes run mechanically without anyone watching.',
      questions: [
        {
          question: 'A factory line runs mechanically. What does that mean here?',
          options: ['Without human input', 'With magic', 'It is broken', 'Slowly'],
          correctIndex: 0,
          explanation: 'The line keeps running on its own once started.',
        },
      ],
    },
    expectViolation: false,
  },
  {
    name: 'Edge: hyphenated jargon "trade-off" caught in stem',
    quiz: {
      title: 'Trade-offs',
      concept: 'Giving up one thing to get another is a basic shape of choice.',
      questions: [
        {
          question: 'What is the trade-off when you choose speed over accuracy?',
          options: ['You get errors faster', 'Nothing', 'Both improve', 'Time stops'],
          correctIndex: 0,
          explanation: 'Speed and accuracy pull against each other. More of one means less of the other.',
        },
      ],
    },
    expectViolation: true,
    expectField: 'question',
    expectWord: 'trade-off',
  },
  {
    name: 'Edge: empty questions array — no violations, no crash',
    quiz: {
      title: 'Empty Quiz',
      concept: 'A defensive case for the verifier.',
      questions: [],
    },
    expectViolation: false,
  },
  {
    name: 'Edge: missing fields — no crash, treated as no text to flag',
    quiz: {
      title: 'Malformed Quiz',
      concept: 'Defensive case.',
      questions: [
        // question / options / explanation all missing
        {},
      ],
    },
    expectViolation: false,
  },
];

// ── Runner ──────────────────────────────────────────────────────────

let failed = 0;
let passed = 0;

for (const c of cases) {
  const violations = checkSimpleEnglish(c.quiz);
  const hadViolation = violations.length > 0;

  let ok = hadViolation === c.expectViolation;

  if (ok && c.expectViolation && c.expectField) {
    ok = violations.some((v) => v.field === c.expectField);
  }
  if (ok && c.expectViolation && c.expectWord) {
    ok = violations.some((v) => v.word === c.expectWord);
  }

  if (ok) {
    passed++;
    console.log(`✓ ${c.name}`);
  } else {
    failed++;
    console.log(`✗ ${c.name}`);
    console.log(`  expected violation: ${c.expectViolation}${c.expectField ? ` (field=${c.expectField})` : ''}${c.expectWord ? ` (word=${c.expectWord})` : ''}`);
    console.log(`  got violations:     ${JSON.stringify(violations, null, 2)}`);
  }
}

console.log('');
console.log(`${passed} passed · ${failed} failed · ${cases.length} total`);

process.exit(failed > 0 ? 1 : 0);
