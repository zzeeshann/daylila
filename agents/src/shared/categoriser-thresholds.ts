/**
 * Categoriser thresholds — canonical agents-side constants for the
 * categoriser contract (`content/categoriser-contract.md`).
 *
 * The contract is the single source of truth for the rule body in
 * plain English; this file is the agents-bundle TypeScript surface
 * those rules compile to.
 *
 * Cross-worker mirror: `src/lib/categoriser-thresholds.ts` carries
 * `CATEGORISER_FALLBACK_SLUG` (only — the site enforces only the
 * fallback-slug filter at render time; floors and assignment caps
 * are agent-side rules). Asymmetric mirror, same shape as
 * `agents/src/shared/fact-check-thresholds.ts` ↔
 * `src/lib/fact-check-thresholds.ts`. The site worker and agents
 * worker are separate packages with no shared imports — if any value
 * here changes, the site-side mirror must change in the same commit.
 *
 * Migration `migrations/0027_categoriser_fallback_category.sql`
 * carries the slug as data — frozen at deploy time, treated as a
 * deliberate non-change. SQL migrations cannot import TS constants;
 * the canonical slug lives here.
 *
 * Foundation Fix Task 02 eighth (and final) extraction session,
 * 2026-05-10. With this extraction Phase 1 of Foundation Fix is
 * complete — all eight rule clusters extracted.
 */

/** Hard cap on assignments per piece. The prompt enforces 1–3; this
 *  constant is re-used by the agent when it clamps the LLM's output
 *  so a misbehaving response can't over-tag a piece. */
export const CATEGORISER_MAX_ASSIGNMENTS = 3;

/** Ideal reuse floor — confidence at which an existing category is a
 *  clean fit for the piece's *primary* underlying subject. At or above
 *  this, reuse is the obvious answer. Raised 60 → 75 on 2026-04-25
 *  after the firing-squads piece picked up "Commodity Shocks" at 70
 *  confidence (a cross-domain stretch from "supply running out" to
 *  "commodity shock"). See DECISIONS 2026-04-25. */
export const CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75;

/** Stretch reuse floor — when no existing category fits at ≥75 AND
 *  the piece isn't novel enough to justify a new category, the prompt
 *  instructs Claude to reuse the closest existing at ≥60 with explicit
 *  reasoning that names what's stretchy. Below this, an existing-cat
 *  assignment is too thin to write — code filters and triggers the
 *  retry-then-fallback path. Added 2026-04-29 as part of the
 *  zero-assignment fix. */
export const CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60;

/** Reserved slug for the system fallback category seeded in migration
 *  0027. Used ONLY when both Claude attempts return zero assignments.
 *  Hidden from the public library chip bar AND filtered from the
 *  Categoriser context list (Claude must never see it as a "reuse
 *  target" — would defeat the retry layer's purpose). */
export const CATEGORISER_FALLBACK_SLUG = 'patterns-yet-to-cluster';
