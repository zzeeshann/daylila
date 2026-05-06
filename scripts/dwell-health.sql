-- scripts/dwell-health.sql
-- Read-only operator queries for the audio dwell-time signal
-- (Foundation Fix Task 07, closes data leak L17). Run after the task
-- has been live for ≥7 days for meaningful counts.
--
-- Invocation:
--   wrangler d1 execute zeemish --remote --file=scripts/dwell-health.sql
--
-- All four queries are SELECT-only — safe against prod with no risk of
-- writes. Each query is annotated with what its result means.

-- ─── 1. Recent dwell — last 30 pieces, total reader-seconds + reader count
-- Answers "is dwell flowing for recent pieces". Healthy mid-band:
-- every recent piece has ≥1 reader and total_seconds in the dozens at
-- minimum. Empty result = the pipe broke (frontend not POSTing or
-- endpoint not writing). avg_ratio ≈ 0.5 is normal (mid-clip flushes
-- average that way); persistent ≥1.0 means the heartbeat is over-firing.
SELECT
  piece_id,
  COUNT(DISTINCT user_id)             AS readers,
  COUNT(*)                            AS flushes,
  ROUND(SUM(dwell_seconds), 0)        AS total_seconds,
  ROUND(AVG(ratio), 2)                AS avg_ratio,
  datetime(MAX(occurred_at) / 1000, 'unixepoch') AS last_flush_utc
FROM audio_dwell_events
WHERE occurred_at > (strftime('%s', 'now', '-30 days') * 1000)
GROUP BY piece_id
ORDER BY MAX(occurred_at) DESC
LIMIT 30;

-- ─── 2. Per-beat dwell distribution — last 30 days
-- Surfaces which beats hold attention. Drop-off heatmap precursor
-- (the FOLLOWUPS [deferred] 2026-05-07 entry tracks the heatmap UI;
-- this query is the backbone). Beats with very low avg_ratio + high
-- flushes = readers tap in but don't stay. Beats with very high
-- avg_ratio + low flushes = readers who reach them mostly finish.
SELECT
  beat_name,
  COUNT(*)                            AS flushes,
  COUNT(DISTINCT user_id)             AS readers,
  ROUND(AVG(dwell_seconds), 1)        AS avg_dwell,
  ROUND(AVG(ratio), 2)                AS avg_ratio
FROM audio_dwell_events
WHERE occurred_at > (strftime('%s', 'now', '-30 days') * 1000)
GROUP BY beat_name
ORDER BY flushes DESC
LIMIT 50;

-- ─── 3. Ended-reason breakdown — sanity check on the closed enum
-- Healthy distribution post-launch (rough guidance, not a hard rule):
--   heartbeat   : majority — every continuous play accrues ~2/min
--   beat_change : steady minority — auto-advance is the common path
--   ended       : steady minority — last beat per session
--   pause       : small — most readers don't pause mid-clip
--   pagehide    : small — sendBeacon is best-effort, iOS often drops
-- If pagehide dominates, the heartbeat path is broken. If `pause` is
-- zero across 30 days, the pause hook isn't wired. Anything outside
-- the five values means writer drift (the API rejects 400 today, but
-- a future contract change could land an unknown value).
SELECT
  ended_reason,
  COUNT(*)                            AS rows,
  ROUND(AVG(dwell_seconds), 1)        AS avg_dwell
FROM audio_dwell_events
WHERE occurred_at > (strftime('%s', 'now', '-30 days') * 1000)
GROUP BY ended_reason
ORDER BY rows DESC;

-- ─── 4. Anti-double-counting drift detector
-- Flags any (piece_id, beat_name) where a single user's total dwell
-- exceeds 5× the clip duration over a 7-day window. A genuine
-- replay-3-times reader is rare; replay-20-times is the bug. The 5×
-- threshold leaves room for legitimate replays without dirtying the
-- result. This is the runtime cousin to the brief's 7000s/240s
-- pathology (which the per-tick clamp + flush-then-reset pattern in
-- audio-player.ts is designed to make impossible).
--
-- Empty result = healthy. Any rows = investigate the user_id's
-- session — likely a stuck heartbeat or a replay-loop bug.
SELECT
  ade.user_id,
  ade.piece_id,
  ade.beat_name,
  ROUND(SUM(ade.dwell_seconds), 1)            AS total_dwell,
  MAX(dpa.duration_seconds)                   AS clip_seconds,
  ROUND(
    SUM(ade.dwell_seconds)
      / NULLIF(MAX(dpa.duration_seconds), 0),
    1
  )                                           AS multiple
FROM audio_dwell_events ade
LEFT JOIN daily_piece_audio dpa
  ON dpa.piece_id = ade.piece_id AND dpa.beat_name = ade.beat_name
WHERE ade.occurred_at > (strftime('%s', 'now', '-7 days') * 1000)
GROUP BY ade.user_id, ade.piece_id, ade.beat_name
HAVING multiple > 5
ORDER BY multiple DESC
LIMIT 50;
