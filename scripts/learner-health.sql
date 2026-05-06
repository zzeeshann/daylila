-- scripts/learner-health.sql
-- Read-only operator queries for the Learner feedback loop.
-- Run after Foundation Fix Task 04 has been live for ≥10 days for
-- meaningful counts; formal review at 30 days per the FOLLOWUPS
-- [observing] entry.
--
-- Invocation:
--   wrangler d1 execute zeemish --remote --file=scripts/learner-health.sql
--
-- All four queries are SELECT-only — safe against prod with no risk
-- of writes. Each query is annotated with what its result means.
--
-- Note on legacy values: applied_to_prompts is repurposed in migration
-- 0032 from INTEGER 0/1 to TEXT JSON. Pre-0032 rows store the literal
-- 0 or 1; post-0032 writes start with `[`. The queries below use
-- `LIKE '[%'` to filter for the JSON-array shape only and treat
-- legacy values as null — same shape the application read path uses.

-- ─── 1. Noise — loaded but never landed in any successful piece ───
-- High count = the Drafter is loading patterns that don't survive
-- to publish. Could mean: stale learnings, irrelevant learnings, or
-- pieces using them happen to fail more often.
SELECT
  COUNT(*) AS noise_count,
  ROUND(AVG(load_count), 2) AS avg_loads
FROM learnings
WHERE loaded_at IS NOT NULL
  AND (applied_to_prompts IS NULL OR applied_to_prompts NOT LIKE '[%');

-- ─── 2. Signal — validated by a Polished-strict piece ─────────────
-- Validation = the loaded learning's piece passed every gate in one
-- round at voiceScore >= 90 (LEARNER_VALIDATION_VOICE_FLOOR /
-- LEARNER_VALIDATION_MAX_ROUNDS in agents/src/shared/audit-thresholds.ts).
-- High count = the Learner is selecting patterns that compound into
-- the cleanest pieces.
SELECT
  COUNT(*) AS signal_count,
  MIN(last_validated_at) AS first_validation_ms,
  MAX(last_validated_at) AS most_recent_validation_ms
FROM learnings
WHERE last_validated_at IS NOT NULL;

-- ─── 3. Workhorses — top 10 most-loaded learnings ─────────────────
-- These are the patterns the Drafter has reached for most often.
-- Validation count = how many of those landings were Polished-strict.
-- High loads + low validations = a noisy pattern; high both = a
-- foundational pattern; low loads = recency-only artifact.
SELECT
  id,
  source,
  category,
  load_count,
  CASE WHEN applied_to_prompts LIKE '[%'
       THEN json_array_length(applied_to_prompts)
       ELSE 0 END AS applied_count,
  CASE WHEN last_validated_at IS NOT NULL THEN 1 ELSE 0 END AS validated,
  SUBSTR(observation, 1, 120) AS observation_head
FROM learnings
ORDER BY load_count DESC
LIMIT 10;

-- ─── 4. Retirement candidates — bottom 10 oldest never-loaded ─────
-- These are the patterns that have aged out of getRecentLearnings(10)'s
-- reach and never made it back. Low signal — would not affect the
-- Drafter if removed. Don't delete during the 30-day observation
-- window (per FOLLOWUPS) — keep until the loop has settled.
SELECT
  id,
  source,
  category,
  created_at,
  SUBSTR(observation, 1, 120) AS observation_head
FROM learnings
WHERE loaded_at IS NULL
ORDER BY created_at ASC
LIMIT 10;
