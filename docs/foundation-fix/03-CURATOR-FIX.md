# Task 03 — Curator: Rejection Reasoning, Pick Reasoning, Selected-Flag Fix

**Phase:** 2 (High-severity data fixes)  
**Type:** Prompt change + schema migration + bug fix.  
**Estimated session length:** 90–120 minutes.  
**Prerequisite:** Phase 1 complete. The Curator's rules now live in a contract file (likely `content/curator-contract.md`).

## Context

The data audit found three Curator-related issues, two leaks and one data-integrity bug. Fixing them together is more efficient because they all touch the same code paths.

| ID  | What |
|-----|------|
| L25 | `daily_candidates.selected=1` UPDATE never landed for ~250 historical rows. Possibly still broken for new runs. |
| L2  | The Curator never produces per-rejection reasoning — the prompt only asks for a global skip-everything reason. |
| L1  | When the Curator picks one candidate from 80, the reasoning for the pick is computed by Claude but discarded. |

After this task, every run leaves a complete record of *what was considered, what was picked, and why each rejection happened*. That record is what makes the Learner, the future search subdomain, and any drift analysis possible.

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/AGENTS.md` — Curator section
3. `docs/SCHEMA.md` — daily_candidates and daily_pieces tables
4. `content/curator-contract.md` (assuming Task 02 extracted it; if not, fall back to the curator prompt source)
5. The data audit at `plans/just-answer-no-code-synthetic-sifakis.md`, sections on L1, L2, L25
6. The Curator code: `agents/src/curator.ts`, `agents/src/curator-prompt.ts`, and the Director's handling at `agents/src/director.ts`

## Sub-task 1 — Investigate L25 first

Before changing anything, run live D1 queries to confirm the current state:

```sql
SELECT COUNT(*) FROM daily_candidates;
SELECT COUNT(*) FROM daily_candidates WHERE selected = 1;
SELECT COUNT(*) FROM daily_candidates WHERE selected = 1 AND piece_id IS NOT NULL;
SELECT date, COUNT(*) AS total, SUM(selected) AS picked
FROM daily_candidates
GROUP BY date
ORDER BY date DESC
LIMIT 30;
```

Three possible findings:

- **Still broken across the board:** `SUM(selected)` is 0 for every recent date. Means the UPDATE has never landed. Fix is high priority.
- **Recently fixed:** `SUM(selected)` is 1+ for the last few dates but 0 for older ones. Means the bug was patched silently; we just document and move on.
- **Working correctly:** `SUM(selected)` is 1+ for every date with a published piece. Means the audit comment was stale; document and move on.

Whatever the finding, write it into `docs/FOLLOWUPS.md` under a heading "L25 status as of YYYY-MM-DD" with the query results.

If still broken: the Director should set `selected=1` on the picked candidate when committing the piece. Trace `daily_pieces` insertion in `director.ts` and ensure the corresponding `daily_candidates` UPDATE is in the same transaction. Add a backfill SQL script to set `selected=1` retroactively for historical pieces by joining `daily_pieces.id` to `daily_candidates.piece_id`. Save the script as `scripts/backfill-selected-flag.sql` and document it in `docs/RUNBOOK.md`.

## Sub-task 2 — Add per-candidate reasoning columns

Add a migration to `daily_candidates`:

```sql
ALTER TABLE daily_candidates ADD COLUMN rejection_category TEXT;
ALTER TABLE daily_candidates ADD COLUMN rejection_reason TEXT;
ALTER TABLE daily_candidates ADD COLUMN pick_reasoning TEXT;
```

Three columns:

- `rejection_category` — short label from a fixed enum (see Sub-task 3). Queryable. NULL on the picked candidate.
- `rejection_reason` — free-form one-line reason from the Curator. NULL on the picked candidate. Optional even on rejected ones (see Sub-task 3 for which rejections need full reasoning).
- `pick_reasoning` — the Curator's reasoning for the picked candidate. NULL on rejected candidates.

Migration filename follows the existing pattern: `migrations/00XX_curator_reasoning.sql` where XX is the next number.

## Sub-task 3 — Update the Curator prompt

The Curator prompt needs to change so it produces:

1. For the picked candidate: a 1–3 sentence pick reasoning explaining *why this candidate is the most teachable today*.
2. For the top 5 runner-up candidates: a one-sentence `rejection_reason` plus a `rejection_category` from the fixed enum.
3. For the remaining ~74 candidates: only the `rejection_category` from the fixed enum (no free-form reason — keeps token cost down).

The fixed enum for `rejection_category` should live in `content/curator-contract.md` (extracted in Phase 1). Suggested values:

- `off_topic` — not aligned with Zeemish's editorial scope
- `duplicate` — substantively the same story as another candidate this run or recent days
- `too_local` — narrow geographic relevance, doesn't generalise
- `not_teachable` — newsworthy but no underlying system to teach
- `wrong_shape` — story is real but wouldn't fit a 3-6 beat piece
- `low_signal` — thin source, gossip, speculation, PR
- `partisan_minefield` — contested politics where teaching gets buried by tribe
- `already_covered` — Zeemish has published a piece teaching the same underlying concept recently

The Curator prompt instructs Claude to assign exactly one category per rejection from this list. Free-form `rejection_reason` is required only on the top 5 runner-ups (so we have enough qualitative data to learn from without paying for 79 paragraphs per run).

**Update `content/curator-contract.md`** (or the prompt file if Phase 1 hasn't covered Curator yet) to specify this output shape clearly.

## Sub-task 4 — Update the Curator code

In `agents/src/curator.ts`:

- Update the return type to include the new fields.
- Parse the new prompt output into the structured shape.

In `agents/src/director.ts`:

- When the Curator returns, persist all three fields to `daily_candidates` for every candidate considered in this run.
- The picked candidate gets `pick_reasoning` populated; rejected candidates get `rejection_category` and (if top 5) `rejection_reason` populated.

In any test or seed scripts: update fixtures.

## Sub-task 5 — Update docs

- `docs/SCHEMA.md` — document the three new columns.
- `docs/AGENTS.md` — Curator section: note the new output shape and what's now persisted.
- `docs/DECISIONS.md` — append: "L1, L2, L25 closed YYYY-MM-DD. Per-candidate reasoning persisted. Selected flag write [confirmed working / fixed / backfilled]."
- `docs/FOLLOWUPS.md` — remove L1, L2, L25 from the open leaks list.
- `CLAUDE.md` — update the agent description if Curator's role section is referenced.

## What success looks like

- Three new columns exist in `daily_candidates` with data populating from the next Curator run onwards.
- `pick_reasoning` is populated for every published piece's source candidate.
- `rejection_category` is populated for every rejected candidate.
- `rejection_reason` is populated for at least the top 5 runner-ups per run.
- The selected-flag bug is either confirmed fixed or fixed in this commit, with a backfill script for historical data.
- Docs match.
- One commit per logical change (migration, prompt update, code update, docs). Probably 3-4 commits in this session.

## What NOT to do

- Do not ask Claude for free-form reasoning on every rejection. Token cost would multiply by ~16x per run for marginal value. Top 5 runner-ups is enough.
- Do not invent new rejection categories beyond the eight above without discussing first.
- Do not change the Curator's selection logic. We are recording what it already does, not changing what it does.
- Do not retroactively populate `pick_reasoning` for historical pieces. Old data is gone. Going forward only.
- Do not bundle this with other agent fixes.

## How to verify it worked

After deployment, wait for the next Curator run. Then:

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN pick_reasoning IS NOT NULL THEN 1 ELSE 0 END) AS picked_with_reason,
  SUM(CASE WHEN rejection_category IS NOT NULL THEN 1 ELSE 0 END) AS rejected_with_category,
  SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END) AS rejected_with_reason
FROM daily_candidates
WHERE date = (SELECT MAX(date) FROM daily_candidates);
```

Expected:
- `picked_with_reason` = 1 (the picked candidate)
- `rejected_with_category` = ~79 (every rejection)
- `rejected_with_reason` = ~5 (the top runner-ups)
- `total` = ~80

If any of those don't match, the prompt or persistence step is wrong.

## Optional follow-up (defer)

Once data is flowing, the `daily_candidates` table becomes a goldmine for the future Curator-improvement work. Don't act on this now — but make a note in `docs/FOLLOWUPS.md`:

> Once 30 days of `pick_reasoning` and `rejection_reason` data accumulate, consider embedding them and using nearest-neighbour search to give the Curator examples of "past similar choices" at runtime. Defer until after the platform plan begins.
