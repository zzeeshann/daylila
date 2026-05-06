-- scripts/draft-revisions-health.sql
-- Read-only operator queries for the Drafter + Integrator persistence
-- loop. Run after Foundation Fix Task 06 has been live for ≥7 days
-- for meaningful counts.
--
-- Invocation:
--   wrangler d1 execute zeemish --remote --file=scripts/draft-revisions-health.sql
--
-- All four queries are SELECT-only — safe against prod with no risk of
-- writes. Each query is annotated with what its result means.

-- ─── 1. Recent revisions — last 20 pieces, rounds + decision counts
-- Mirrors the verification SQL named in
-- docs/foundation-fix/06-DRAFT-REVISIONS.md. For a Polished piece
-- (1 round) expect rounds=1, decisions=0. For a Solid piece (2-3
-- rounds) expect rounds=2 or 3, decisions ≥ 1. If rounds=0 the
-- Drafter's persistence didn't land; if decisions=0 across multi-
-- round pieces, the Integrator's persistence didn't land.
SELECT
  p.id AS piece_id,
  p.date,
  p.headline,
  p.tier,
  COUNT(DISTINCT dr.revision_round) AS rounds,
  COUNT(idd.id) AS integrator_decisions
FROM daily_pieces p
LEFT JOIN draft_revisions dr ON dr.piece_id = p.id
LEFT JOIN integrator_decisions idd ON idd.piece_id = p.id
GROUP BY p.id
ORDER BY p.created_at DESC
LIMIT 20;

-- ─── 2. Decision breakdown — feedback_source × decision rollup ─────
-- Last 30 days. Shows which auditor flags tend to be accepted vs
-- overruled vs partial. Sustained high overrule rates from a single
-- auditor (≥30% of that auditor's flags) is signal that the auditor's
-- precision has drifted — Integrator is consistently disagreeing.
-- Sustained high partial rates suggest auditor prompts are bundling
-- multi-part issues that don't naturally factor.
--
-- Healthy mid-band: ≥80% accepted, ≤15% overruled, ≤10% partial across
-- all three auditors. Wide variance between auditors is the signal.
SELECT
  feedback_source,
  decision,
  COUNT(*) AS count
FROM integrator_decisions
WHERE created_at >= (strftime('%s', 'now') - 30 * 86400) * 1000
GROUP BY feedback_source, decision
ORDER BY feedback_source, decision;

-- ─── 3. Multi-round pieces — every revision round, with decisions ──
-- Shows how a multi-round piece evolved. One row per round per piece;
-- zero-decision rounds (round 0 / round N where Integrator had nothing
-- to address) appear with decisions=0. Use to spot-check the data
-- shape end-to-end after the first multi-round piece publishes.
--
-- Bounded to last 30 days to keep the scan small; remove the WHERE
-- clause for full history.
SELECT
  dr.piece_id,
  p.date,
  p.headline,
  dr.revision_round,
  dr.authored_by,
  dr.word_count,
  COUNT(idd.id) AS decisions,
  datetime(dr.created_at / 1000, 'unixepoch') AS round_at_utc
FROM draft_revisions dr
JOIN daily_pieces p ON p.id = dr.piece_id
LEFT JOIN integrator_decisions idd
  ON idd.piece_id = dr.piece_id
 AND idd.revision_round = dr.revision_round
WHERE dr.piece_id IN (
  SELECT piece_id FROM draft_revisions
  GROUP BY piece_id
  HAVING COUNT(DISTINCT revision_round) > 1
)
  AND dr.created_at >= (strftime('%s', 'now') - 30 * 86400) * 1000
GROUP BY dr.piece_id, dr.revision_round
ORDER BY dr.piece_id, dr.revision_round;

-- ─── 4. Unfilled metadata — drift detector ─────────────────────────
-- integrator_decisions rows missing reasoning OR resulting_change.
-- Both fields are optional in the schema (nullable) but the Integrator
-- prompt strongly prefers populating them. Sustained NULL rates ≥20%
-- are signal that Claude is dropping fields under length pressure
-- (8000-token cap on revisions can clip the JSON tail), or that the
-- prompt's structured-output instructions need tightening.
--
-- Last 30 days. Per-source breakdown so a single auditor's
-- feedback_summary shape isn't masked by averages across all three.
SELECT
  feedback_source,
  COUNT(*) AS total_rows,
  SUM(CASE WHEN reasoning IS NULL OR reasoning = '' THEN 1 ELSE 0 END) AS missing_reasoning,
  SUM(CASE WHEN resulting_change IS NULL OR resulting_change = '' THEN 1 ELSE 0 END) AS missing_resulting_change
FROM integrator_decisions
WHERE created_at >= (strftime('%s', 'now') - 30 * 86400) * 1000
GROUP BY feedback_source
ORDER BY feedback_source;
