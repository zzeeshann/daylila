-- Audit failure_reasons health (Foundation Fix Task 08 PR 08c, 2026-05-07)
-- Closes L24 — audit failure reasons normalised into queryable columns.
--
-- Run any query against remote D1 via:
--   wrangler d1 execute zeemish --remote --command="..."
--
-- All four queries are SELECT-only.

-- ─── 1. Recent breakdowns (last 30 days, fail rounds only) ──────────
-- Quick "what's been failing lately, by auditor and reason" — a
-- categoriser-style operator skim. Empty rows mean either nothing
-- failed or the auditor wasn't emitting failure_reasons (drift).
SELECT
  auditor,
  failure_reasons,
  COUNT(*) AS rounds
FROM audit_results
WHERE created_at > unixepoch() * 1000 - 30 * 86400000
  AND passed = 0
  AND failure_reasons IS NOT NULL
GROUP BY auditor, failure_reasons
ORDER BY auditor, rounds DESC;

-- ─── 2. Top-N tokens per auditor (last 30 days) ─────────────────────
-- Splits the comma-separated failure_reasons into individual tokens
-- and counts each — the closed-enum dashboard. SQLite has no
-- string_split, so this uses a recursive CTE per auditor.
--
-- For a quick look without the CTE, run:
--   SELECT auditor, failure_reasons FROM audit_results
--   WHERE created_at > unixepoch() * 1000 - 30 * 86400000
--     AND passed = 0 AND failure_reasons IS NOT NULL
--   ORDER BY created_at DESC LIMIT 50;
WITH RECURSIVE tokens(auditor, token, rest, created_at) AS (
  SELECT
    auditor,
    CASE WHEN instr(failure_reasons, ',') = 0
         THEN failure_reasons
         ELSE substr(failure_reasons, 1, instr(failure_reasons, ',') - 1) END,
    CASE WHEN instr(failure_reasons, ',') = 0
         THEN ''
         ELSE substr(failure_reasons, instr(failure_reasons, ',') + 1) END,
    created_at
  FROM audit_results
  WHERE created_at > unixepoch() * 1000 - 30 * 86400000
    AND passed = 0
    AND failure_reasons IS NOT NULL AND failure_reasons != ''
  UNION ALL
  SELECT
    auditor,
    CASE WHEN instr(rest, ',') = 0 THEN rest
         ELSE substr(rest, 1, instr(rest, ',') - 1) END,
    CASE WHEN instr(rest, ',') = 0 THEN ''
         ELSE substr(rest, instr(rest, ',') + 1) END,
    created_at
  FROM tokens
  WHERE rest != ''
)
SELECT auditor, token, COUNT(*) AS hits
FROM tokens
WHERE token != ''
GROUP BY auditor, token
ORDER BY auditor, hits DESC;

-- ─── 3. Suggestions count distribution (last 30 days) ───────────────
-- "Auditor went silent" detector. A failing round with zero
-- suggestions is suspicious — the auditor flagged a problem but
-- offered no fix. Sustained zero-suggestion rates suggest a prompt
-- regression (Claude is filling in passed=0 without writing
-- suggestions, or returning an empty array).
SELECT
  auditor,
  passed,
  COUNT(*) AS rounds,
  AVG(suggestions_count) AS avg_suggestions,
  MIN(suggestions_count) AS min_suggestions,
  MAX(suggestions_count) AS max_suggestions
FROM audit_results
WHERE created_at > unixepoch() * 1000 - 30 * 86400000
  AND suggestions_count IS NOT NULL
GROUP BY auditor, passed
ORDER BY auditor, passed;

-- ─── 4. Drift detector for unknown-token surfacing (all-time) ──────
-- The closed-enum parser persists `unknown` when Claude emits a token
-- outside the closed Set. Any non-zero count here means at least one
-- of the auditor prompts has drifted from the contract — either
-- Claude is hallucinating new tokens or the prompt is asking for
-- something we don't validate. All-time count, per-auditor.
SELECT
  auditor,
  COUNT(*) AS rounds_with_unknown
FROM audit_results
WHERE failure_reasons LIKE '%unknown%'
GROUP BY auditor
ORDER BY rounds_with_unknown DESC;

-- ─── 5. Rolling drift rate (last 30 audits) ────────────────────────
-- The metric the admin dashboard's "Audit drift" card runs each load.
-- Returns one row with the total audits in the window (≤30) and the
-- count of those carrying an `unknown` token. Threshold colour rule
-- on the dashboard: 0 → normal, 1 → warning, >1 → red. Window is
-- audit-count, not calendar — keeps the signal stable when pipeline
-- cadence shifts.
WITH recent_audits AS (
  SELECT failure_reasons
  FROM audit_results
  ORDER BY created_at DESC
  LIMIT 30
)
SELECT
  COUNT(*) AS audits_in_window,
  SUM(CASE WHEN failure_reasons LIKE '%unknown%' THEN 1 ELSE 0 END) AS unknown_count
FROM recent_audits;
