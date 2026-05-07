-- 0036_dead_columns_backfill.sql
-- Backfills `daily_pieces.reading_minutes`, the only dead-instrumentation
-- column on daily_pieces with a wired reader and no writer. Discovered
-- 2026-05-07 during the post-Phase-2 audit.
--
-- The column existed on the schema since pre-launch but no writer wrote
-- it. All 48 production rows were NULL. Frontend at
-- src/components/RunBlock.astro reads it via
-- `piece.readingMinutes ?? <fallback>` and fell through to a regex parse
-- of estimatedTime on every render. Director's INSERT at
-- agents/src/director.ts now writes the derived value
-- (Math.max(1, Math.round(wordCount/200))).
--
-- Note: `has_interactive` (also INTEGER, also always 0 in production)
-- was DELIBERATELY deprecated in migration 0022 — `interactive_id` is
-- the single source of truth for "does this piece have an interactive."
-- See docs/SCHEMA.md line 239. NOT backfilled here.
--
-- Non-destructive: derives values from existing data, no DROP, no rename.
-- Idempotent: WHERE clause guards re-run as a no-op.
-- Safe to run live (zeemish-v2 launched 2026-04-18; daily_pieces is
-- write-mostly during piece publish, never UPDATEd by reader paths).

-- Backfill reading_minutes from word_count at 200 wpm. MAX(1, ...)
-- mirrors the runtime derivation so a very short piece reads as "1 min"
-- not "0 min". word_count is NOT NULL on every existing row (verified
-- 2026-05-07).
UPDATE daily_pieces
   SET reading_minutes = MAX(1, CAST(ROUND(word_count / 200.0) AS INTEGER))
 WHERE reading_minutes IS NULL;
