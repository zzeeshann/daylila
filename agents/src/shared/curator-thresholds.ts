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
 * Window split into two constants 2026-05-10 (Curator input trim).
 */

/**
 * Window (in days) over which Curator sees the recent-pieces headline
 * list for the SAME-EVENT / SAME-CONCEPT hard-skip rules. Director
 * queries getRecentDailyPieces() with this value at director.ts:228.
 * Cut from 30 to 14 on 2026-05-10 — the rules fire on news that's
 * still in cycle, two weeks catches the overwhelming majority of dupes,
 * and the trailing 30 was overlap with the category-counts block
 * (which already encodes "what's filling fast").
 * See DECISIONS 2026-05-10 "Curator input trim".
 */
export const CURATOR_RECENT_PIECES_WINDOW_DAYS = 14;

/**
 * Window (in days) over which Curator sees recent category + domain
 * concentration counts for the soft preferences. Director queries
 * getRecentCategoryCounts() and getRecentDomainCounts() with this
 * value at director.ts:268 and :269. Stays at 30 — this is the "what's
 * filling fast" signal, and 30 days is what produces a stable
 * distribution across 11 categories + 10 domains.
 */
export const CURATOR_RECENT_CONCENTRATION_WINDOW_DAYS = 30;
