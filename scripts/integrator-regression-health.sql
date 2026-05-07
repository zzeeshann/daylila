-- Integrator regression health — operator queries.
-- Foundation Fix Phase 4 Task 09 (2026-05-07). Read-only. Runs on the
-- integrator_decisions table populated by Foundation Fix Task 06.
--
-- Usage:
--   wrangler d1 execute zeemish --remote --file=scripts/integrator-regression-health.sql
--
-- Each query is independent and self-titled in its leading SELECT
-- comment so the tabular output is readable when the four blocks fire
-- back-to-back. Same shape as scripts/audit-failure-reasons-health.sql,
-- scripts/dwell-health.sql, scripts/audio-audit-health.sql,
-- scripts/draft-revisions-health.sql, scripts/learner-health.sql.

-- Query 1 — recent_regressions:
--   The brief's pre/post comparison query. Counts pass→fail flips by
--   feedback_source over the last 30 days. Pre-Task-09 baseline: the
--   2026-05-06 magic-mushroom voice 95→92→95 anecdote is the
--   qualitative anchor (integrator_decisions was not yet populated
--   when Task 09 shipped). Post-Task-09 expectation: per-source
--   regression count drops noticeably as the prompt's PRESERVE/FIX
--   framing + round-to-round state suppress whack-a-mole flips.
WITH round_pairs AS (
  SELECT
    a.piece_id,
    a.feedback_source,
    a.revision_round AS round_n,
    a.decision AS decision_n,
    b.revision_round AS round_n_plus_1,
    b.decision AS decision_n_plus_1
  FROM integrator_decisions a
  JOIN integrator_decisions b
    ON a.piece_id = b.piece_id
   AND a.feedback_source = b.feedback_source
   AND b.revision_round = a.revision_round + 1
  WHERE a.created_at >= unixepoch('now', '-30 days') * 1000
)
SELECT
  feedback_source,
  COUNT(*) AS regressions_30d
FROM round_pairs
WHERE decision_n = 'overruled'         -- was passing (Integrator chose not to act on it)
  AND decision_n_plus_1 = 'accepted'   -- now needs fixing
GROUP BY feedback_source
ORDER BY regressions_30d DESC;

-- Query 2 — multi_round_pieces_count:
--   How many distinct pieces have actually been through the audit-
--   revise loop more than once in the last 30 days. Gauges sample
--   size for query 1 — the regression-rate denominator. Daylila ships
--   ~1 piece/day; multi-round pieces are roughly half (~50% based on
--   pre-Task-09 audit_results history). Below 5 means the empirical
--   signal is too thin to read query 1 confidently.
SELECT
  COUNT(DISTINCT piece_id) AS multi_round_pieces_30d,
  COUNT(*) AS total_decision_rows_30d
FROM integrator_decisions
WHERE revision_round >= 1
  AND created_at >= unixepoch('now', '-30 days') * 1000;

-- Query 3 — per_piece_regressions:
--   Per-piece detail view. Lists every piece in the last 30 days that
--   experienced any pass→fail flip across rounds, with the
--   feedback_source and round numbers. When a regression shows up in
--   query 1, this query tells the operator which specific piece
--   triggered it — useful for spot-checking the actual prompt sent to
--   Claude that round (via the admin pipeline-log view) when
--   diagnosing why the prompt's PRESERVE framing didn't take effect.
WITH round_pairs AS (
  SELECT
    a.piece_id,
    a.feedback_source,
    a.revision_round AS round_n,
    a.decision AS decision_n,
    b.revision_round AS round_n_plus_1,
    b.decision AS decision_n_plus_1,
    b.created_at AS regression_at
  FROM integrator_decisions a
  JOIN integrator_decisions b
    ON a.piece_id = b.piece_id
   AND a.feedback_source = b.feedback_source
   AND b.revision_round = a.revision_round + 1
  WHERE a.created_at >= unixepoch('now', '-30 days') * 1000
)
SELECT
  piece_id,
  feedback_source,
  round_n,
  round_n_plus_1,
  datetime(regression_at / 1000, 'unixepoch') AS regression_at_iso
FROM round_pairs
WHERE decision_n = 'overruled'
  AND decision_n_plus_1 = 'accepted'
ORDER BY regression_at DESC;

-- Query 4 — round_distribution:
--   Sanity-check on the round distribution itself. How many pieces
--   reached round 1 / 2 / 3? Catches regressions in Director's audit-
--   revise loop separately from Integrator's behaviour — if the
--   round-2 count drops to zero overnight, that's a Director bug, not
--   an Integrator improvement.
SELECT
  revision_round,
  COUNT(DISTINCT piece_id) AS pieces_30d
FROM integrator_decisions
WHERE created_at >= unixepoch('now', '-30 days') * 1000
GROUP BY revision_round
ORDER BY revision_round;
