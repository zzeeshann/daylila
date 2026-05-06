-- scripts/audio-audit-health.sql
-- Read-only operator queries for the Audio Auditor persistence loop.
-- Run after Foundation Fix Task 05 has been live for ≥7 days for
-- meaningful counts.
--
-- Invocation:
--   wrangler d1 execute zeemish --remote --file=scripts/audio-audit-health.sql
--
-- All four queries are SELECT-only — safe against prod with no risk
-- of writes. Each query is annotated with what its result means.

-- ─── 1. Recent audits — last 30 piece audits, latest summary row ──
-- "Latest summary per piece" via window function: ROW_NUMBER over
-- created_at DESC, scoped to summary rows (beat_name IS NULL),
-- filtered to the most recent N pieces. Hides the retry-noise from
-- the default health view (a piece audited 3 times shows as one row,
-- the most recent verdict).
--
-- Healthy mid-band: pass_rate over the last 30 should be ≥90%; lower
-- means producer is generating audio the auditor can't verify.
SELECT
  piece_id,
  passed,
  notes AS rollup,
  datetime(created_at / 1000, 'unixepoch') AS audited_at_utc
FROM (
  SELECT
    piece_id,
    passed,
    notes,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY piece_id ORDER BY created_at DESC) AS rn
  FROM audio_audit_results
  WHERE beat_name IS NULL
)
WHERE rn = 1
ORDER BY created_at DESC
LIMIT 30;

-- ─── 2. Issue type breakdown — last 30 days ───────────────────────
-- Count by issue_type, ORDER BY count DESC. Drives investigation
-- priority — if `size_too_small` dominates, the producer's output
-- bitrate or beat-length distribution may have shifted; if
-- `missing_file` dominates, R2 puts are failing silently;
-- `text_too_short` dominating means Drafter is producing thin beats.
--
-- Excludes summary rows (issue_type IS NOT NULL filter) and the
-- forward-compat `unknown` value (which would indicate enum drift —
-- surface separately below if the count grows).
SELECT
  issue_type,
  COUNT(*) AS issue_count,
  COUNT(DISTINCT piece_id) AS pieces_affected
FROM audio_audit_results
WHERE issue_type IS NOT NULL
  AND created_at > (strftime('%s', 'now', '-30 days') * 1000)
GROUP BY issue_type
ORDER BY issue_count DESC;

-- ─── 3. Unfilled metadata — pieces with NULL columns post-Task-05 ─
-- Pre-Task-05 historical rows are expected to carry NULL for both
-- file_size_bytes and duration_seconds (forward-only, no backfill).
-- A non-zero count of NULL columns on rows generated POST migration
-- 0033 means the producer broke its populate path.
--
-- The cutoff is the migration apply timestamp; conservatively use
-- generated_at > (a date well after migration apply).
SELECT
  COUNT(*) AS rows_post_task_05,
  SUM(CASE WHEN file_size_bytes IS NULL THEN 1 ELSE 0 END) AS missing_size,
  SUM(CASE WHEN duration_seconds IS NULL THEN 1 ELSE 0 END) AS missing_duration
FROM daily_piece_audio
WHERE generated_at > (strftime('%s', '2026-05-12') * 1000);

-- ─── 4. Size anomalies — beats outside auditor's expected band ────
-- Cross-check on the auditor itself. Auditor flags beats where
-- actual_size_bytes / (character_count × 960) falls outside
-- [MIN_SIZE_RATIO=0.3, MAX_SIZE_RATIO=3.0]. This query independently
-- recomputes the ratio against persisted file_size_bytes (L11) and
-- character_count, surfacing any beat the auditor "missed" (which
-- could be a bug in the auditor branch logic OR a beat that already
-- failed audit and the issue was persisted under a different
-- issue_type).
--
-- Expected behaviour: every row this returns should have a matching
-- audio_audit_results row of issue_type='size_too_small' or
-- 'size_too_large' for the same (piece_id, beat_name). Anomalies
-- with no matching audit row are real auditor escapes worth
-- investigating.
SELECT
  dpa.piece_id,
  dpa.beat_name,
  dpa.character_count,
  dpa.file_size_bytes,
  ROUND(CAST(dpa.file_size_bytes AS REAL) / (dpa.character_count * 960), 2) AS size_ratio
FROM daily_piece_audio dpa
WHERE dpa.file_size_bytes IS NOT NULL
  AND dpa.character_count > 0
  AND (
    CAST(dpa.file_size_bytes AS REAL) / (dpa.character_count * 960) < 0.3
    OR CAST(dpa.file_size_bytes AS REAL) / (dpa.character_count * 960) > 3.0
  )
ORDER BY dpa.generated_at DESC
LIMIT 50;
