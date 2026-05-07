-- 0037_run_id_and_pipeline_log_rebuild.sql
--
-- Foundation Fix Task 08 — sub-task 1 (run_id end-to-end). Closes L23.
--
-- A "run" is one full pipeline execution that starts a news scan and
-- produces (or fails to produce) one piece. Multi-piece-per-day cadence
-- means date-only identifiers cannot answer "what came out of one run".
-- This migration adds `run_id TEXT` to every table that records a
-- per-run write, and rebuilds `pipeline_log` so its ambiguously-named
-- date-shaped column moves to `run_date` while a fresh `run_id TEXT`
-- column receives the real UUID going forward.
--
-- Decision history this migration is built on:
--   - 2026-04-21 "Roll back pipeline_log.run_id backfill" — the original
--     attempt to repurpose pipeline_log.run_id as a UUID broke four
--     site-worker consumers. Walk-back kept run_id = YYYY-MM-DD.
--   - 2026-04-22 "piece_id columns on day-keyed tables" — added piece_id
--     as a parallel axis without disturbing the date-shaped run_id.
--   - 2026-05-07 (this task) Fork 1 — instead of preserving the dual-life
--     two-column-overlapping-purpose state (FOLLOWUPS line 1705), rename
--     the existing date-shaped column to `run_date` and add a fresh
--     `run_id` UUID column. Site queries that previously matched
--     `WHERE run_id = '<date>'` now match `WHERE run_date = '<date>'`;
--     the new `run_id` column carries the per-run UUID.
--
-- Tables touched (additive nullable run_id, forward-only):
--   daily_candidates, daily_pieces, audit_results, daily_audit_claims,
--   observer_events, draft_revisions, integrator_decisions,
--   audio_audit_results.
--
-- Tables NOT touched (off-pipeline writes use piece_id for attribution):
--   daily_piece_audio, piece_categories, categories, interactives,
--   interactive_audit_results, learnings, zita_messages, engagement,
--   audio_dwell_events.
--
-- pipeline_log rebuild — same pattern as migrations 0015 and 0017
-- (snapshot → new table → INSERT...SELECT → DROP → RENAME). Backup
-- table `pipeline_log_backup_20260507` retained ≥7 days; FOLLOWUPS
-- entry queues the drop.
--
-- Site query updates (4 files, hand-edited in same PR):
--   src/pages/api/daily/[date]/made.ts
--   src/pages/api/dashboard/pipeline.ts
--   src/pages/dashboard/admin.astro
--   src/pages/dashboard/admin/piece/[date]/[slug].astro
-- Each rewrites `WHERE run_id = ?` → `WHERE run_date = ?` (or the
-- equivalent self-join expression in admin.astro).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED — runs on `wrangler d1 migrations apply`
-- ══════════════════════════════════════════════════════════════════

-- ─── Part A: ALTER TABLE ADD COLUMN run_id (8 tables) ─────────────
-- All nullable, forward-only. Historical rows stay NULL — we do not
-- have the data to reconstruct old runs as units. Per the brief.

ALTER TABLE daily_candidates     ADD COLUMN run_id TEXT;
ALTER TABLE daily_pieces         ADD COLUMN run_id TEXT;
ALTER TABLE audit_results        ADD COLUMN run_id TEXT;
ALTER TABLE daily_audit_claims   ADD COLUMN run_id TEXT;
ALTER TABLE observer_events      ADD COLUMN run_id TEXT;
ALTER TABLE draft_revisions      ADD COLUMN run_id TEXT;
ALTER TABLE integrator_decisions ADD COLUMN run_id TEXT;
ALTER TABLE audio_audit_results  ADD COLUMN run_id TEXT;

-- Indexes per the brief — only on the two tables likely to be
-- queried by run_id directly (operator forensics on a specific run).
-- Other tables already have a piece_id index that gets you to the
-- run via a one-row JOIN to daily_pieces.run_id.
CREATE INDEX IF NOT EXISTS idx_daily_pieces_run    ON daily_pieces(run_id);
CREATE INDEX IF NOT EXISTS idx_observer_events_run ON observer_events(run_id);

-- ─── Part B: pipeline_log rebuild ─────────────────────────────────
-- Step 1: snapshot the existing 7-column shape (id, run_id, step,
-- status, data, created_at, piece_id). 153+ rows in prod as of
-- migration 0019; new rows since then push the count up. SELECT *
-- preserves the data; SQLite CREATE TABLE AS does NOT carry indexes
-- or PK — the rollback procedure below recreates them.
CREATE TABLE IF NOT EXISTS pipeline_log_backup_20260507 AS
  SELECT * FROM pipeline_log;

-- Step 2: new table — `run_date` is the renamed old `run_id` (still
-- TEXT NOT NULL, still YYYY-MM-DD-shaped). New `run_id TEXT` is
-- nullable; pipeline_log writers fill it going forward.
CREATE TABLE IF NOT EXISTS pipeline_log_new (
  id         TEXT PRIMARY KEY,
  run_date   TEXT NOT NULL,
  step       TEXT NOT NULL,
  status     TEXT NOT NULL,
  data       TEXT,
  created_at INTEGER NOT NULL,
  piece_id   TEXT,
  run_id     TEXT
);

-- Step 3: copy. Old `run_id` flows into new `run_date`; new `run_id`
-- starts NULL on every historical row. piece_id passes through
-- unchanged (added in 0018).
INSERT INTO pipeline_log_new (
  id, run_date, step, status, data, created_at, piece_id, run_id
)
SELECT
  id,
  run_id      AS run_date,
  step,
  status,
  data,
  created_at,
  piece_id,
  NULL        AS run_id
FROM pipeline_log;

-- Step 4: drop old table.
DROP TABLE pipeline_log;

-- Step 5: rename new to canonical name.
ALTER TABLE pipeline_log_new RENAME TO pipeline_log;

-- Step 6: recreate indexes.
-- Old table had idx_pipeline_run on run_id (per migration 0007) and
-- idx_pipeline_log_piece on piece_id (per 0018). Keep both names but
-- the run_id index now points at the renamed column run_date (since
-- day-aggregation queries are the existing readers' shape) plus add
-- idx_pipeline_log_run on the new UUID run_id for run-forensic queries.
CREATE INDEX IF NOT EXISTS idx_pipeline_run       ON pipeline_log(run_date);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_piece ON pipeline_log(piece_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_run   ON pipeline_log(run_id);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- Column shape on every touched table:
-- PRAGMA table_info(daily_candidates);     -- expect run_id column
-- PRAGMA table_info(daily_pieces);         -- expect run_id column
-- PRAGMA table_info(audit_results);        -- expect run_id column
-- PRAGMA table_info(daily_audit_claims);   -- expect run_id column
-- PRAGMA table_info(observer_events);      -- expect run_id column
-- PRAGMA table_info(draft_revisions);      -- expect run_id column
-- PRAGMA table_info(integrator_decisions); -- expect run_id column
-- PRAGMA table_info(audio_audit_results);  -- expect run_id column
-- PRAGMA table_info(pipeline_log);
--   -- expect 8 columns: id, run_date, step, status, data, created_at,
--   -- piece_id, run_id
--
-- Row count parity (rebuild integrity):
-- SELECT (SELECT COUNT(*) FROM pipeline_log) AS live,
--        (SELECT COUNT(*) FROM pipeline_log_backup_20260507) AS snap;
-- -- expect identical numbers
--
-- Day-grouping still works post-rename:
-- SELECT run_date, COUNT(*) AS steps FROM pipeline_log
-- GROUP BY run_date ORDER BY run_date DESC LIMIT 7;
-- -- expect one row per recent date with step counts.
--
-- New run_id starts populating only after the agents code lands
-- (this migration ships the column; Director writes it on subsequent
-- runs):
-- SELECT COUNT(*) FROM pipeline_log WHERE run_id IS NOT NULL;
-- -- expect 0 immediately post-apply; non-zero after the next pipeline run.
--
-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK (only if shape or row count looks wrong post-apply)
-- ══════════════════════════════════════════════════════════════════
--
-- pipeline_log:
--   DROP TABLE pipeline_log;
--   CREATE TABLE pipeline_log (
--     id TEXT PRIMARY KEY,
--     run_id TEXT NOT NULL,
--     step TEXT NOT NULL,
--     status TEXT NOT NULL,
--     data TEXT,
--     created_at INTEGER NOT NULL,
--     piece_id TEXT
--   );
--   INSERT INTO pipeline_log (id, run_id, step, status, data, created_at, piece_id)
--     SELECT id, run_id, step, status, data, created_at, piece_id
--     FROM pipeline_log_backup_20260507;
--   CREATE INDEX IF NOT EXISTS idx_pipeline_run ON pipeline_log(run_id);
--   CREATE INDEX IF NOT EXISTS idx_pipeline_log_piece ON pipeline_log(piece_id);
--
-- run_id column on the other 8 tables is non-destructive to drop:
--   ALTER TABLE daily_candidates     DROP COLUMN run_id;
--   ALTER TABLE daily_pieces         DROP COLUMN run_id;
--   ALTER TABLE audit_results        DROP COLUMN run_id;
--   ALTER TABLE daily_audit_claims   DROP COLUMN run_id;
--   ALTER TABLE observer_events      DROP COLUMN run_id;
--   ALTER TABLE draft_revisions      DROP COLUMN run_id;
--   ALTER TABLE integrator_decisions DROP COLUMN run_id;
--   ALTER TABLE audio_audit_results  DROP COLUMN run_id;
--
-- Retention: pipeline_log_backup_20260507 dropped on or after 2026-05-14
-- once writer-side run_id population has been verified live for a week.
-- FOLLOWUPS entry queued.
