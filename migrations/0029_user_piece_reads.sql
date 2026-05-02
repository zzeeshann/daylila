-- 0029_user_piece_reads.sql
--
-- Per-user-per-piece reading record. Foundation for the /account/
-- rebuild (Resume → Recently read → Subjects).
--
-- Why this table exists: as of 2026-05-02 there is no per-user-per-piece
-- reading-history record in production. `progress` (migration 0001)
-- has PK (user_id, course_slug, lesson_number) and lesson-shell.ts
-- hardcodes lesson_number=0 for every daily piece — so all daily reads
-- collapse to one row per user, with `completed_at` overwriting on
-- every new completion. `engagement` (migrations 0003 + 0017) is
-- per-piece-per-day aggregate, not per-user. The Account rebuild
-- needs to answer "which pieces has THIS user read, when, and how
-- far?" — neither existing table can.
--
-- The brief explicitly anticipated this gap and left adding a write
-- surface in scope for Phase 1: "If Resume needs a new write path,
-- surface that finding and we'll decide whether to fold it into
-- Phase 1 or defer." See ~/Downloads/ACCOUNT-REBUILD.md.
--
-- SHAPE DECISIONS:
--
-- 1. PK (user_id, piece_id) — one row per user per piece. Upsert on
--    every view / beat / complete event from lesson-shell. Idempotent
--    under retry.
--
-- 2. Three timestamps: `started_at` (first time the user was tracked
--    on the piece), `last_seen_at` (most recent event of any kind),
--    `completed_at` (footer reached). Streak math reads
--    DISTINCT(date(last_seen_at)) over a 14-day window. Recently-read
--    sorts by `completed_at DESC`. Resume sorts in-progress by
--    `last_seen_at DESC`.
--
-- 3. `current_beat TEXT` — name of the most recent <lesson-beat>
--    crossed (set by per-beat IntersectionObserver in lesson-shell).
--    Lets Resume deep-link to the right anchor. NULL on completed
--    rows (cleared on `complete` event) and on rows that never
--    advanced past the first beat.
--
-- 4. No FK REFERENCES — consistent with every other join column in
--    this codebase (engagement.piece_id, audit_results.piece_id,
--    piece_categories.piece_id, etc.). Application-layer integrity.
--    Orphan rows tolerated.
--
-- 5. Two indexes:
--    - `idx_upr_user_seen` (user_id, last_seen_at DESC) — primary
--      access path for Resume + streak.
--    - `idx_upr_user_completed` (user_id, completed_at DESC) —
--      Recently-read query.
--
-- 6. Empty at migration time. No backfill. The historical signal we
--    have for "did this user read this piece" is sparse (Zita rows +
--    interactive_engagement rows) and reconstructing rows from it
--    would conflate engagement with completion. Forward-only is
--    honest: launch state is empty for everyone, sections fill in
--    over 1–2 weeks of normal reading.
--
-- 7. Anonymous + signed-in both write here. Middleware always
--    populates Astro.locals.userId via cookie-bound user_id. On
--    sign-in (magic link or password), `mergeProgress` is extended
--    in this same session to merge user_piece_reads alongside the
--    existing progress merge — so an anonymous reader's history
--    follows them into their authenticated account.
--
-- Rollback: DROP TABLE user_piece_reads; (table is empty at migration
-- time and additive — no consumer reads from it pre-rebuild).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_piece_reads (
  user_id      TEXT NOT NULL,
  piece_id     TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  current_beat TEXT,
  completed_at INTEGER,
  PRIMARY KEY (user_id, piece_id)
);

CREATE INDEX IF NOT EXISTS idx_upr_user_seen
  ON user_piece_reads (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_upr_user_completed
  ON user_piece_reads (user_id, completed_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(user_piece_reads);
-- -- expect 6 columns:
-- --   user_id (TEXT NOT NULL, PK part 1),
-- --   piece_id (TEXT NOT NULL, PK part 2),
-- --   started_at (INTEGER NOT NULL),
-- --   last_seen_at (INTEGER NOT NULL),
-- --   current_beat (TEXT, nullable),
-- --   completed_at (INTEGER, nullable)
--
-- PRAGMA index_list(user_piece_reads);
-- -- expect idx_upr_user_seen, idx_upr_user_completed,
-- --        sqlite_autoindex_user_piece_reads_1 (from PK)
--
-- SELECT COUNT(*) FROM user_piece_reads;  -- expect 0
