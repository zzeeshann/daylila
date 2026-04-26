-- 0024_interactives_html_flag.sql
--
-- Interactives v3 — Phase 1, sub-task 1.1.
--
-- Adds the `interactives_html_enabled` admin_settings key, default
-- `'false'`. Gates the HTML-interactive generation path that lands in
-- Phase 2 (extends InteractiveGenerator + InteractiveAuditor to a
-- second artefact type alongside the quiz that shipped in Area 4).
--
-- Quizzes are NOT gated by this flag — InteractiveGenerator's existing
-- quiz path runs unchanged regardless of value. The longer name
-- (vs. `interactives_enabled`) is deliberate: the shorter form would
-- have implied quizzes were also gated. See INTERACTIVES_PLAN.md
-- Phase 1 task 1 for the naming rationale.
--
-- Default `'false'` so this migration is behaviourally a no-op on prod
-- — Generator/Auditor see the flag, find it false, continue producing
-- quizzes only. Phase 2 ships the read site for the flag; Phase 3
-- ships the admin UI write site (alongside the existing cadence
-- dropdown). Until then the only way to flip is `wrangler d1 execute`.
--
-- INSERT OR IGNORE matches the 0016 pattern so a re-apply is safe and
-- a manually-set value (testing on local D1, etc.) isn't clobbered.
--
-- Rollback: `DELETE FROM admin_settings WHERE key = 'interactives_html_enabled';`
-- Generator/Auditor's Phase 2 read site falls back to `false` when the
-- row is missing (same pattern as `getAdminSetting<T>` in
-- agents/src/shared/admin-settings.ts), so deletion is safe.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('interactives_html_enabled', 'false', 1777017600000);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- SELECT * FROM admin_settings WHERE key = 'interactives_html_enabled';
-- -- expect one row: ('interactives_html_enabled', 'false', 1777017600000).
--
-- SELECT COUNT(*) FROM admin_settings;
-- -- expect 2 rows post-apply: interval_hours + interactives_html_enabled.
