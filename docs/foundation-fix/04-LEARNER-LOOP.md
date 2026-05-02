# Task 04 — Learner: Close the Feedback Loop

**Phase:** 2 (High-severity data fixes)  
**Type:** Design decision + small code change.  
**Estimated session length:** 60–90 minutes (more if design discussion needed).  
**Prerequisite:** Task 03 complete.

## Context

The `learnings` table has two columns that are never written:

- `applied_to_prompts` — TEXT or similar, intended to mark when a learning was used by the Drafter.
- `last_validated_at` — DATETIME, intended to mark when a learning was confirmed as helpful.

Neither is updated by any code path. The columns exist; the writes don't.

This is the most consequential gap in the system. The brief and `CLAUDE.md` claim:

> The four signal sources feed tomorrow's Drafter prompt via the learnings database, so the system's writing improves over time.

Right now, learnings accumulate. The Drafter loads them. We have **zero evidence** that loading them changes anything, because we never check.

This task closes the loop. After it lands, we can answer the question: *"Is the Learner actually improving the system, or just generating noise?"*

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/AGENTS.md` — Learner and Drafter sections
3. `docs/SCHEMA.md` — `learnings` table
4. `agents/src/learner.ts`
5. `agents/src/drafter.ts` — particularly the section that loads learnings (`getRecentLearnings`)
6. `agents/src/shared/learnings.ts` (if it exists)
7. The data audit, section L15

## The two questions this task must answer

Before writing any code, decide explicitly:

### Q1: When does a learning get marked `applied_to_prompts`?

Three plausible answers:

- **(a) When the Drafter loads it into context.** Easy to implement. But "loaded" doesn't mean "used" — Claude might ignore the learning entirely.
- **(b) When the Drafter explicitly cites it.** The Drafter's output declares which learnings it considered. Stronger signal but requires a prompt change.
- **(c) When a piece using the learnings passes all auditor gates.** Strongest signal — the learning is associated with successful output.

**Recommended: (c) with (a) as the load timestamp.** Two columns, not one:

- `loaded_at` (renamed from or in addition to `applied_to_prompts`) — set every time `getRecentLearnings()` returns this row.
- `applied_to_prompts` — JSON array of piece_ids where this learning was loaded *and* the resulting piece passed all gates.

Discuss with the user before implementing if they prefer a different approach.

### Q2: When does a learning get marked `last_validated_at`?

Two plausible definitions:

- **(d) When a piece using the learning achieves a Polished tier.** Pieces that need fewer revision rounds (1 round, ≥90 voice score) suggest the learnings helped.
- **(e) When subsequent pieces in the same category show measurable improvement** in voice score, revision rounds, or audit pass rate. Stronger signal but requires aggregation.

**Recommended: (d) for now.** Simpler to implement, gives directional signal. Upgrade to (e) later if needed.

## What this task does

Three small changes:

### Change 1 — Mark when learnings are loaded

In `agents/src/shared/learnings.ts` (or wherever `getRecentLearnings` lives), after the SELECT, run:

```sql
UPDATE learnings
SET loaded_at = CURRENT_TIMESTAMP, load_count = COALESCE(load_count, 0) + 1
WHERE id IN (?, ?, ...)
```

This requires two new columns:

```sql
ALTER TABLE learnings ADD COLUMN loaded_at DATETIME;
ALTER TABLE learnings ADD COLUMN load_count INTEGER DEFAULT 0;
```

### Change 2 — Mark `applied_to_prompts` after a piece passes

In `agents/src/director.ts`, find the point where a piece is committed to GitHub (the success path after all audits pass). At that point:

```sql
UPDATE learnings
SET applied_to_prompts = json_insert(
  COALESCE(applied_to_prompts, '[]'),
  '$[#]',
  ?  -- piece_id
)
WHERE id IN (?, ?, ...)  -- the learnings that were loaded for this piece's draft
```

This requires the Drafter or Director to remember *which* learnings were loaded for *this* draft. Store that list in memory through the run, then write it out at success time.

### Change 3 — Mark `last_validated_at` for high-quality pieces

At the same success point, additionally:

```sql
UPDATE learnings
SET last_validated_at = CURRENT_TIMESTAMP
WHERE id IN (?, ?, ...)  -- the learnings loaded for this piece
  AND ? >= 90  -- the piece's voice score
  AND ? = 1    -- revision rounds (Polished tier)
```

If the piece is Polished tier, the learnings get a validated timestamp. If Solid or Rough, only `applied_to_prompts` gets updated, not `last_validated_at`.

## Sub-task — Add a simple Learner health view

After the schema changes, add a new admin view (or just a SQL helper script) that surfaces:

- Number of learnings loaded but never associated with a passing piece — these are *noise*.
- Number of learnings validated by Polished pieces — these are *signal*.
- Top 10 most-loaded learnings, with their validation count — the *workhorses*.
- Bottom 10 oldest never-loaded learnings — *candidates for retirement*.

Save the SQL as `scripts/learner-health.sql` and document in `docs/RUNBOOK.md`. Optional: surface it in the existing dashboard if the admin section is straightforward to extend. If extending the dashboard adds significant work, defer to a separate small task.

## Update docs

- `docs/SCHEMA.md` — document `loaded_at`, `load_count`, and that `applied_to_prompts` is now JSON.
- `docs/AGENTS.md` — Learner section: explain the validation logic. Drafter section: note that loaded learnings are tracked.
- `docs/DECISIONS.md` — append: "L15 closed YYYY-MM-DD. Learner feedback loop now records load events and marks validations on Polished pieces."
- `docs/FOLLOWUPS.md` — remove L15. Add a new entry: "Reach a 30-day window of validation data, then evaluate whether the Learner is meaningfully selecting useful patterns. If most learnings never validate, redesign extraction logic."
- `CLAUDE.md` — update the Learner description.

## What success looks like

- After deployment, the next published piece's run results in:
  - Some rows in `learnings` getting `loaded_at` updated and `load_count` incremented.
  - The same rows getting their `applied_to_prompts` JSON array appended with the new piece_id.
  - If the piece is Polished tier, those rows also get `last_validated_at` updated.
- `scripts/learner-health.sql` runs cleanly and produces meaningful output.
- Docs match.
- Three or four small commits, each focused.

## What NOT to do

- Do not redesign how learnings are *generated*. The Learner's pattern-extraction logic stays. We are only adding feedback signal on what happens *after* learnings are written.
- Do not retroactively populate `applied_to_prompts` or `last_validated_at` for historical learnings. Old data unknown. Going forward only.
- Do not delete learnings even if they look unused. We need 30 days of data before drawing conclusions about which patterns are noise.
- Do not bundle this with the Drafter changes from Task 06 or other agents.

## How to verify it worked

Ten days after deploy:

```sql
SELECT
  COUNT(*) AS total_learnings,
  SUM(CASE WHEN loaded_at IS NOT NULL THEN 1 ELSE 0 END) AS ever_loaded,
  SUM(CASE WHEN applied_to_prompts IS NOT NULL THEN 1 ELSE 0 END) AS ever_applied,
  SUM(CASE WHEN last_validated_at IS NOT NULL THEN 1 ELSE 0 END) AS ever_validated,
  AVG(load_count) AS avg_loads_per_learning
FROM learnings;
```

Expected after ten days of running:
- `ever_loaded` should be a meaningful fraction of total learnings (most recent ones get loaded).
- `ever_applied` should be similar to `ever_loaded` minus rare cases where a piece never passed.
- `ever_validated` should be a smaller subset (only Polished pieces).
- `avg_loads_per_learning` should be ≥ 1 for recent learnings.

If `ever_loaded` is 0, the load update didn't land. If `ever_applied` is 0 but `ever_loaded` is high, the Director's success-path update didn't land. Diagnose and fix.

## What this enables later (deferred)

After ~30 days of validation data, we can answer for the first time:

- Which learnings actually correlate with high-quality output?
- Are pattern-extraction rules producing signal or noise?
- Should the Learner narrow what it extracts?

That analysis is **not** part of this task. We are just laying the rails. Add to `docs/FOLLOWUPS.md`:

> Learner feedback loop closed YYYY-MM-DD. After 30 days, run `scripts/learner-health.sql` and decide whether learnings are meaningfully selecting useful patterns. Possible outcomes: keep, narrow extraction logic, or replace with a different signal source.
