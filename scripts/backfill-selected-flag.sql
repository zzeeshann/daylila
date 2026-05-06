-- scripts/backfill-selected-flag.sql
-- One-time historical backfill for the 7 daily_pieces published before the
-- 2026-04-22 Curator-prompt fix exposed candidate UUIDs to Claude.
-- Affected dates: 2026-04-17 through 2026-04-22, with 2026-04-22 carrying
-- two pieces. Closes the L25 leak's residual historical surface.
--
-- The 2026-04-22 fix at agents/src/curator-prompt.ts ensures every NEW run
-- correctly flips selected=1 on the picked candidate. This script repairs
-- the historical rows so the per-piece admin teal-dot and the public
-- "How this was made" drawer's picked-candidate envelope render correctly
-- for every published piece, not just post-2026-04-22 ones.
--
-- Why the audit's "join daily_pieces.id to daily_candidates.piece_id"
-- approach was wrong: Scanner stamps piece_id on EVERY candidate row at
-- INSERT time (per migration 0019 + scanner.scan(pieceId)), not just the
-- picked one. Joining naively would mark all 50-100 candidates per date
-- as selected. We need a different identity signal.
--
-- Identity match: Scanner's RSS pull stamps a trailing " - <Source>" suffix
-- on every candidate headline; daily_pieces.headline does not carry it.
-- Curator/Drafter normalize curly apostrophes (U+2018 left, U+2019 right)
-- to straight (U+0027) by the time the piece headline is stored. We match
-- by stripping the suffix and normalizing both curly variants. Scope by
-- (date, source) prevents cross-piece bleed on the 2026-04-22 two-piece
-- day.
--
-- One source-string irregularity to tolerate: Drafter sometimes shortens
-- the candidate's source for the piece's source_story field (e.g. the
-- 2026-04-20 Hormuz piece has source_story='Bloomberg' but the candidate
-- carries source='Bloomberg.com'). We match by either equality or by the
-- piece source_story being a prefix of the candidate source — narrow
-- enough to not drag in unrelated rows under the (date <= 2026-04-22)
-- bound, since the single-feed 50-candidate-per-day era had effectively
-- one row per (date, source-prefix, normalized-headline) tuple.
--
-- Why we explicitly bound to date <= '2026-04-22': post-2026-04-23 the
-- Scanner pulls 6+ Google News topic feeds (TOP, WORLD, BUSINESS,
-- TECHNOLOGY, etc.). The same wire-service story can appear in multiple
-- feeds with the same source label, producing rows with identical
-- (date, source, normalized-headline) tuples. Without this date bound the
-- backfill would mark ALL of those siblings as selected=1 — false
-- positives on rows where Director's actual pick had already been
-- correctly flagged. The 2026-04-22-and-earlier era used a single feed
-- per category (50 candidates/day), where (date, source, headline) is
-- effectively unique among candidates. The bound is what keeps the script
-- safe.
--
-- Idempotent: only touches rows where selected = 0. Safe to re-run.
-- Run via:
--   wrangler d1 execute zeemish --remote --file scripts/backfill-selected-flag.sql
-- See docs/RUNBOOK.md "Backfill: historical selected-flag" for context.
UPDATE daily_candidates
SET selected = 1,
    teachability_score = COALESCE(teachability_score, 100)
WHERE selected = 0
  AND id IN (
    SELECT c.id
    FROM daily_candidates c
    JOIN daily_pieces p
      ON p.date = c.date
     AND (p.source_story = c.source OR c.source LIKE p.source_story || '%')
     AND p.headline = replace(
           replace(
             CASE
               WHEN instr(c.headline, ' - ' || c.source) > 0
                 THEN substr(c.headline, 1, instr(c.headline, ' - ' || c.source) - 1)
               ELSE c.headline
             END,
             CHAR(8217), CHAR(39)
           ),
           CHAR(8216), CHAR(39)
         )
    WHERE c.selected = 0 AND p.date <= '2026-04-22'
  );

-- Verification: every published piece now has exactly one selected=1
-- candidate scoped to its (date, source_story). Pieces from
-- 2026-04-23 onward had selected=1 set by Director's UPDATE at
-- the time of publish, so they should already report picked_count=1
-- and this script does not touch them.
SELECT p.date, p.headline AS piece_headline, COUNT(c.id) AS picked_count
FROM daily_pieces p
LEFT JOIN daily_candidates c ON c.piece_id = p.id AND c.selected = 1
GROUP BY p.id
ORDER BY p.date;
