/**
 * Curator-specific runtime thresholds.
 *
 * Canonical rule body: content/curator-contract.md.
 * This module is agents-only — the site worker does not read curator
 * rules at render time, so no parallel src/lib/curator-thresholds.ts
 * mirror is needed (asymmetric posture, different from audit-thresholds /
 * fact-check-thresholds which both have site-side consumers).
 *
 * Foundation Fix Task 02 sixth extraction session, 2026-05-08.
 */

/**
 * Window (in days) over which Curator sees prior-piece history and
 * category concentration. Director queries getRecentDailyPieces() and
 * getRecentCategoryCounts() with this value at director.ts:207 and :245.
 * The contract names the same window in plain English under the
 * "Recent-category concentration" and "SAME-EVENT and SAME-CONCEPT"
 * sections.
 */
export const CURATOR_RECENT_WINDOW_DAYS = 30;
