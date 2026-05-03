/**
 * Audit thresholds — site-worker mirror of
 * `agents/src/shared/audit-thresholds.ts`.
 *
 * Canonical rule body in `content/audit-contract.md`; canonical
 * TypeScript constants in the agents-side file named above. The
 * site worker and agents worker are separate packages with no
 * shared imports, so both sides carry their own copy. Same pattern
 * as `src/lib/cadence.ts` ↔ `agents/src/shared/admin-settings.ts`.
 * If any value changes in the agents-side file, this file must
 * change in the same commit.
 *
 * Drift defence: `src/lib/audit-tier.ts`'s `voiceScore == null`
 * fallback preserves correctness on the legacy historical-piece
 * path even if a future score arrives outside the expected band.
 */

/** Voice Auditor pass bar. voiceScore at or above this renders as
 *  Polished; below this triggers Solid / Rough by the floor. */
export const VOICE_PASS_THRESHOLD = 85;

/** Solid / Rough floor. voiceScore in [TIER_SOLID_FLOOR,
 *  VOICE_PASS_THRESHOLD) renders as Solid; below renders as Rough. */
export const TIER_SOLID_FLOOR = 70;

/** Maximum audit-then-revise rounds (1 initial + 2 revisions).
 *  Mirrored from the agents-side file for surface completeness; no
 *  site-side consumer reads this today. */
export const MAX_AUDIT_ROUNDS = 3;
