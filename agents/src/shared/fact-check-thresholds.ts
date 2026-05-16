/**
 * Fact-check thresholds — canonical agents-side constants for the
 * fact-check contract (`content/fact-check-contract.md`).
 *
 * The contract is the single source of truth for the rule body in
 * plain English; this file is the agents-bundle TypeScript surface
 * those rules compile to.
 *
 * Cross-worker mirror: `src/lib/fact-check-thresholds.ts` carries
 * the site-side cutoff-confession phrase array (with the canonical
 * replacement string the drawer's filter writes when it fires).
 * Same pattern as `agents/src/shared/audit-thresholds.ts` ↔
 * `src/lib/audit-thresholds.ts` and
 * `agents/src/shared/admin-settings.ts` ↔ `src/lib/cadence.ts`. If
 * any value changes here, the site-side mirror must change in the
 * same commit.
 */

/** Per-call budget for the Anthropic web_search server tool. Claude
 *  may invoke `web_search` up to this many times across all claims
 *  in one fact-check call. Tunable per FOLLOWUPS escalation note —
 *  drop from 8 to 4 if cost runs above $30/month. Site side does
 *  not consume this — only the agents side calls Anthropic's API.
 *
 *  As of 2026-05-16 (Tavily re-architecture) this is read ONLY by
 *  fact-checker-anthropic.ts, kept dormant for 30 days as the
 *  git-revert reference. The live path (fact-checker-tavily.ts) uses
 *  the TAVILY_* constants below instead. */
export const WEB_SEARCH_MAX_USES = 8;

/** Tavily Search API config — read by agents/src/fact-checker-tavily.ts
 *  and agents/src/shared/tavily-client.ts. 2026-05-16 re-architecture.
 *
 *  TAVILY_SEARCH_DEPTH: 'basic' (1 credit, $0.008) vs 'advanced'
 *    (2 credits, $0.016). Basic is sufficient for the per-claim
 *    grounding shape we use — Tavily returns ranked snippets either
 *    way; advanced just searches more sources. Bump to 'advanced' if
 *    verification accuracy is weak in the post-deploy spot-check.
 *
 *  TAVILY_MAX_RESULTS: snippets per claim returned to the Verify step.
 *    3 keeps the Verify prompt compact (~12k tokens total for ~10 claims)
 *    while giving Claude enough corroboration to spot contradictions.
 *
 *  TAVILY_CACHE_TTL_DAYS: rows in `claim_verifications` older than this
 *    are treated as cache-miss on lookup. 30 days = evergreen facts
 *    (boiling point of water) stay reusable across pieces, news-cycle
 *    claims (today's headline) naturally age out. */
export const TAVILY_SEARCH_DEPTH: 'basic' | 'advanced' = 'basic';
export const TAVILY_MAX_RESULTS = 3;
export const TAVILY_CACHE_TTL_DAYS = 30;

/** Cutoff-confession trigger substrings. Mirrored to
 *  `src/lib/fact-check-thresholds.ts` for the drawer's render-time
 *  defense filter. Carried here for surface completeness — same
 *  posture as `TIER_SOLID_FLOOR` being exported on the agents side
 *  though only the site uses it. The fact-checker prompt embeds
 *  longer illustrative phrasings via the contract injection (writer
 *  context); these are the short canonical substrings the drawer
 *  matches against (matcher context). The `'training data'` trigger
 *  was deliberately dropped per DECISIONS 2026-04-30 / DECISIONS:497
 *  (false-positive risk). */
export const CUTOFF_CONFESSION_PHRASES = [
  'speculative fiction',
  'knowledge cutoff',
  'as of my',
  'is hypothetical',
  'beyond my training',
] as const;
