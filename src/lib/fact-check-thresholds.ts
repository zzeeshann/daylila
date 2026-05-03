/**
 * Fact-check thresholds — site-worker mirror of
 * `agents/src/shared/fact-check-thresholds.ts`.
 *
 * Canonical rule body in `content/fact-check-contract.md`; canonical
 * TypeScript constants in the agents-side file named above. The
 * site worker and agents worker are separate packages with no
 * shared imports, so both sides carry their own copy. Same pattern
 * as `src/lib/audit-thresholds.ts` ↔
 * `agents/src/shared/audit-thresholds.ts`. If the array changes in
 * the agents-side file, this file must change in the same commit.
 *
 * The `'training data'` trigger was deliberately dropped per
 * DECISIONS 2026-04-30 / DECISIONS:497 (false-positive risk now
 * that fact-check notes legitimately reference current AI/ML
 * research mentioning training data).
 */

/** Cutoff-confession trigger substrings the drawer's render-time
 *  filter matches against. Substring match is case-insensitive on
 *  the call site. */
export const CUTOFF_CONFESSION_PHRASES = [
  'speculative fiction',
  'knowledge cutoff',
  'as of my',
  'is hypothetical',
  'beyond my training',
] as const;

/** Canonical replacement string when a fact note triggers the
 *  filter. Matches the prompt's instruction for what Claude should
 *  write when search returned nothing. Site-side only — the agents
 *  side gets the same string via the contract injection in
 *  writer-context prose, not as a programmatic constant. */
export const CUTOFF_CONFESSION_REPLACEMENT = 'Could not verify against current sources.';
