/**
 * Audit thresholds — canonical agents-side constants for the audit
 * contract (`content/audit-contract.md`).
 *
 * The contract is the single source of truth for the rule body in
 * plain English; this file is the agents-bundle TypeScript surface
 * those rules compile to. Both daily-piece (Director) and
 * post-publish-interactive (InteractiveGenerator) consumers import
 * from here.
 *
 * Cross-worker mirror: `src/lib/audit-thresholds.ts` carries the same
 * three constants for the site worker (audit-tier render-time read).
 * The site worker and agents worker are separate packages with no
 * shared imports — same pattern as
 * `agents/src/shared/admin-settings.ts` ↔ `src/lib/cadence.ts`. If
 * any value changes here, the site-side mirror must change in the
 * same commit.
 */

/** Voice Auditor pass bar. Drafts at or above this score pass the
 *  voice gate; below triggers a revision round. Same value used by
 *  the Interactive Auditor's voice dimension. */
export const VOICE_PASS_THRESHOLD = 85;

/** Reader-facing tier floor. voiceScore in [TIER_SOLID_FLOOR,
 *  VOICE_PASS_THRESHOLD) renders as Solid; below renders as Rough.
 *  Used only by the site worker today, exported here so the
 *  canonical agents-side surface is complete. */
export const TIER_SOLID_FLOOR = 70;

/** Maximum audit-then-revise rounds before the artefact ships with
 *  qualityFlag='low'. 3 rounds = 1 initial + 2 revisions. Same value
 *  on the daily-piece path (Director) and the interactive path
 *  (InteractiveGenerator quiz + HTML loops) — one rule, two
 *  artefact types. */
export const MAX_AUDIT_ROUNDS = 3;
