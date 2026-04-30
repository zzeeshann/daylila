#!/usr/bin/env node
// Regression test for the 2026-04-30 PM symmetric slug-pairing fix.
//
// Background: a piece's quiz + html share one slug so they render at
// one URL. Pre-fix, only the html→quiz inheritance direction was
// wired (`runHtmlLoop` queried for an existing quiz row and inherited
// its slug). The reverse direction (quiz inheriting from html) had no
// equivalent code; quiz always called `resolveFreeSlug` on Claude's
// proposed slug.
//
// That asymmetry was invisible while quiz always shipped first — every
// dual-artefact piece committed quiz, then html, so html always saw a
// quiz row to inherit from. The c687601 decoupling fix made it
// possible for html to ship FIRST (when quiz parse-failed but html
// succeeded). Once order can flip, asymmetric inheritance bites:
// the 2026-04-30 sperm-cell piece landed at two URLs
// (detection-floor-as-resource-choice for html,
// detection-floors-and-invisible-presence for the quiz manually
// retried later).
//
// Fix: extract `resolvePairSlug(pieceId, type, claudeProposed)`. Both
// loops call it. Whichever artefact ships SECOND inherits from the
// FIRST regardless of order.
//
// This verifier exercises the resolver-shape decisions without
// standing up D1. It stubs the sibling-lookup function and checks:
//   1. quiz-first then html: html inherits quiz slug
//   2. html-first then quiz: quiz inherits html slug (NEW direction)
//   3. quiz-only (no sibling): quiz uses resolveFreeSlug fallback
//   4. html-only (no sibling): html uses resolveFreeSlug fallback
//   5. sibling exists, Claude proposes a totally different slug:
//      Claude's proposal is silently discarded, sibling slug used
//
// Usage: node agents/scripts/verify-pair-slug.mjs
// Exit code: 0 on all pass, 1 on any failure.
//
// Inlined copy stays in sync with
// agents/src/interactive-generator.ts:resolvePairSlug by hand. Same
// convention as verify-splice / verify-dedup / verify-categoriser-floor
// / verify-interactive-voice / verify-parse-retry.

/** Synthetic resolver mirroring resolvePairSlug. lookupSibling stubs
 *  the D1 SELECT; resolveFreeSlugFn stubs the type-scoped collision
 *  resolver. Returns the slug the artefact will commit at. */
async function resolvePairSlug({
  pieceId,
  type,
  claudeProposed,
  lookupSibling,
  resolveFreeSlugFn,
}) {
  const siblingType = type === 'quiz' ? 'html' : 'quiz';
  const sibling = await lookupSibling(pieceId, siblingType);
  if (sibling?.slug) return sibling.slug;
  return resolveFreeSlugFn(claudeProposed, type);
}

/** A lookupSibling stub that returns `slug` when type matches the
 *  configured siblingType, else returns null. */
function makeLookup(presentType, presentSlug) {
  return async (_pieceId, type) => {
    if (presentType && type === presentType) return { slug: presentSlug };
    return null;
  };
}

/** A resolveFreeSlug stub that just returns the proposed slug
 *  unchanged. The verifier doesn't exercise the collision-suffix
 *  branch — that's already covered structurally and only fires
 *  within-type. The verifier's job is the cross-type pairing. */
async function resolveFreeSlugFn(proposed, _type) {
  return proposed;
}

let pass = 0;
let fail = 0;
function check(name, expected, actual) {
  if (expected === actual) {
    console.log(`  PASS  ${name}`);
    pass += 1;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        got:      ${JSON.stringify(actual)}`);
    fail += 1;
  }
}

console.log('verify-pair-slug — resolvePairSlug shape');

// 1. Quiz-first then HTML — html inherits quiz slug
{
  const got = await resolvePairSlug({
    pieceId: 'piece-A',
    type: 'html',
    claudeProposed: 'whatever-html-proposed',
    lookupSibling: makeLookup('quiz', 'shared-slug'),
    resolveFreeSlugFn,
  });
  check('1. html inherits quiz slug when quiz exists', 'shared-slug', got);
}

// 2. HTML-first then quiz — quiz inherits html slug (the NEW direction)
{
  const got = await resolvePairSlug({
    pieceId: 'piece-B',
    type: 'quiz',
    claudeProposed: 'whatever-quiz-proposed',
    lookupSibling: makeLookup('html', 'shared-slug'),
    resolveFreeSlugFn,
  });
  check('2. quiz inherits html slug when html exists (was the bug)', 'shared-slug', got);
}

// 3. Quiz-only (no sibling) — quiz uses resolveFreeSlug fallback
{
  const got = await resolvePairSlug({
    pieceId: 'piece-C',
    type: 'quiz',
    claudeProposed: 'first-of-its-kind',
    lookupSibling: makeLookup(null, null),
    resolveFreeSlugFn,
  });
  check('3. quiz uses Claude proposal when no html sibling exists', 'first-of-its-kind', got);
}

// 4. HTML-only (no sibling) — html uses resolveFreeSlug fallback
{
  const got = await resolvePairSlug({
    pieceId: 'piece-D',
    type: 'html',
    claudeProposed: 'standalone-html',
    lookupSibling: makeLookup(null, null),
    resolveFreeSlugFn,
  });
  check('4. html uses Claude proposal when no quiz sibling exists', 'standalone-html', got);
}

// 5. Sibling exists, Claude proposes a totally different slug — Claude is discarded
{
  const got = await resolvePairSlug({
    pieceId: 'piece-E',
    type: 'quiz',
    claudeProposed: 'detection-floors-and-invisible-presence',
    lookupSibling: makeLookup('html', 'detection-floor-as-resource-choice'),
    resolveFreeSlugFn,
  });
  check(
    "5. Claude's divergent slug discarded when sibling already shipped",
    'detection-floor-as-resource-choice',
    got,
  );
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
