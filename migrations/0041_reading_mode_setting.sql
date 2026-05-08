-- 0041_reading_mode_setting.sql
--
-- Beat-by-beat reading mode (C4, 2026-05-08) — admin_settings flag.
--
-- Seeds `reading_mode = 'scroll'` so the existing single-scroll layout
-- stays the default after the migration applies. The operator flips
-- to `'paginated'` from /dashboard/admin/settings/ once they're ready
-- to test in the wild. After ~7 days of stable paginated traffic,
-- C7 (queued in FOLLOWUPS) will drop the flag entirely and pagination
-- becomes the only mode.
--
-- LessonLayout reads this row at SSR time. Fail-open to 'scroll' on
-- any D1 error so a wedged DB never blocks reading; the page stays
-- functional in scroll mode.
--
-- Forward-only. Idempotent (`INSERT OR IGNORE` matches the existing
-- pattern from 0016_admin_settings.sql + 0024 / 0025 follow-ups).

INSERT OR IGNORE INTO admin_settings (key, value, updated_at)
VALUES ('reading_mode', 'scroll', 1778889600000);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- SELECT * FROM admin_settings WHERE key = 'reading_mode';
-- -- expect exactly one row: reading_mode = 'scroll'.
--
-- Rollback (only if a regression forces it):
--   DELETE FROM admin_settings WHERE key = 'reading_mode';
-- LessonLayout's fail-open path returns 'scroll' on a missing row,
-- so deleting is functionally identical to setting back to 'scroll'.
