-- 0031_curator_reasoning.sql
-- Adds three Curator-output columns to daily_candidates so the system records
-- WHY each pick was made and WHY each rejection happened. Closes data leaks
-- L1 (pick reasoning was computed and discarded) and L2 (rejection reasoning
-- was never produced per-candidate). Foundation Fix Task 03.
--
-- All three columns are nullable, additive — no rebuild needed. SQLite
-- ALTER TABLE ADD COLUMN is non-blocking and safe.
--
-- Population shape (post-Task-03):
--   pick_reasoning      — 1-3 sentence "why this is the most teachable today"
--                         on the picked candidate. NULL on rejected rows.
--   rejection_category  — closed-enum label on every rejected candidate
--                         (off_topic, duplicate, too_local, no_teaching_angle,
--                          wrong_shape, low_signal, tribal_framing,
--                          already_covered). NULL on the picked row. Enum
--                         body lives in content/curator-contract.md.
--   rejection_reason    — one-sentence free-form reason on the top 5
--                         runner-ups only. NULL on the picked row and on
--                         the remaining ~74 rejected rows.
--
-- No index — no hot-path query touches these columns. Admin per-piece +
-- made-drawer SELECT by piece_id (already indexed via idx_candidates_piece_id).
-- Ad-hoc operator queries on rejection_category run against ~30k rows in
-- year one, scanned in milliseconds; index would be speculative.
ALTER TABLE daily_candidates ADD COLUMN rejection_category TEXT;
ALTER TABLE daily_candidates ADD COLUMN rejection_reason TEXT;
ALTER TABLE daily_candidates ADD COLUMN pick_reasoning TEXT;
