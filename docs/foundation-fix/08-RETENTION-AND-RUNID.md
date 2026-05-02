# Task 08 — Retention Policy + Run ID

**Phase:** 3 (Hygiene)  
**Type:** Schema migration + scheduled cleanup worker + small code change.  
**Estimated session length:** 60–90 minutes.  
**Prerequisite:** Task 07 complete.

## Context

Three medium-severity issues that are tightly related and best fixed together:

| ID | What |
|----|------|
| L16 | `observer_events` has no retention policy. Grows forever. |
| L23 | No `run_id` exists. Multi-piece-per-day runs cannot be retraced as a unit. |
| L24 | Failure reasons live as JSON-in-TEXT (`audit_results.notes`) — not SQL-queryable. |

L16 and L23 are about scale: as Zeemish runs more and produces more data, the system needs both housekeeping (retention) and traceability (run_id). L24 is a small structural cleanup that makes existing data more useful.

This task ships before any subdomain or platform work begins. After it, the data layer is clean enough to build on.

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/SCHEMA.md`
3. `agents/src/observer.ts`
4. `agents/src/director.ts` — particularly the run-orchestration entry point
5. The data audit, sections L16, L23, L24

## Sub-task 1 — Add `run_id` end-to-end

A run is one full pipeline execution that takes one news scan and produces (or fails to produce) one piece. With multi-piece cadence, multiple runs happen per day, so date-only identifiers are insufficient.

### Generate run_id at the start of every run

In `agents/src/director.ts`, at the entry point of a pipeline run, generate a UUID:

```typescript
const runId = crypto.randomUUID();
```

Pass `run_id` into every agent call within that run.

### Add run_id columns

Migration filename: `migrations/00XX_run_id.sql`.

```sql
ALTER TABLE daily_candidates    ADD COLUMN run_id TEXT;
ALTER TABLE daily_pieces        ADD COLUMN run_id TEXT;
ALTER TABLE audit_results       ADD COLUMN run_id TEXT;
ALTER TABLE daily_audit_claims  ADD COLUMN run_id TEXT;
ALTER TABLE pipeline_log        ADD COLUMN run_id TEXT;
ALTER TABLE observer_events     ADD COLUMN run_id TEXT;
ALTER TABLE draft_revisions     ADD COLUMN run_id TEXT;       -- if Task 06 done
ALTER TABLE integrator_decisions ADD COLUMN run_id TEXT;      -- if Task 06 done
ALTER TABLE audio_audit_results ADD COLUMN run_id TEXT;       -- if Task 05 done

CREATE INDEX idx_daily_pieces_run ON daily_pieces(run_id);
CREATE INDEX idx_observer_events_run ON observer_events(run_id);
```

Existing `pipeline_log.run_id` is date-shaped from a rolled-back migration. Either rename to `pipeline_log.run_date` and keep, or drop and replace. Preserve historical data either way.

### Update writes

Every INSERT across the pipeline should now include the run_id. Update the agents to accept and use it. Update Director to pass it through.

### Backfill (optional)

Historical rows have NULL run_id. That's fine. We don't have the data to reconstruct old runs as units. Going forward, every row gets a run_id.

If desired, run a one-time backfill that groups historical rows by (date, hour) and assigns synthetic run_ids per cluster. This is best-effort, not perfect. Save the script as `scripts/backfill-run-id.sql` and document in `docs/RUNBOOK.md`. Skip if not worth the effort.

## Sub-task 2 — Retention policy

### Decide the policy

Two principles:

1. **Selected and meaningful data is permanent.** Published pieces, learnings that ever validated, audit results for published pieces — these stay forever.
2. **Unselected and process data has a retention window.** Rejected candidates older than 90 days, observer events older than 90 days, draft revisions of pieces never published — pruned.

Recommended retention by table (open to discussion):

| Table | Retention |
|-------|-----------|
| `daily_pieces` | Forever |
| `daily_candidates` (selected=1) | Forever |
| `daily_candidates` (selected=0) | 90 days |
| `observer_events` (severity high) | 1 year |
| `observer_events` (severity low/medium) | 90 days |
| `pipeline_log` | 180 days |
| `audit_results` (linked to published piece) | Forever |
| `audit_results` (linked to draft never published) | 90 days |
| `draft_revisions` (published pieces) | Forever |
| `draft_revisions` (drafts never published) | 90 days |
| `integrator_decisions` (linked to published piece) | Forever |
| `engagement` | 1 year |
| `learnings` | Forever |
| `magic_tokens` | Already managed; check |

Discuss with the user before finalising if numbers above feel wrong.

### Build a retention worker

Create `workers/retention-worker.ts` (or similar) — a Cloudflare Worker on a daily cron that runs DELETE statements per the policy.

The worker:
- Runs at 04:00 UTC (after the 02:00 publish run).
- For each table with retention, runs `DELETE WHERE created_at < CURRENT_TIMESTAMP - INTERVAL X DAYS AND <retention condition>`.
- Logs total rows deleted to `observer_events` (with low severity).
- Fails loudly if a delete attempts to remove a piece that's published — that's a bug, not retention.

### Document the policy

Create `docs/RETENTION.md`:

- The full policy table.
- Why each table has its retention window.
- How to change a window (edit the worker, redeploy).
- Manual override commands for restoring data from a recent backup if accidentally pruned.

Cross-link from `docs/SCHEMA.md` and `docs/RUNBOOK.md`.

## Sub-task 3 — Normalise audit failure reasons (L24)

Currently, audit failure reasons live as JSON inside `audit_results.notes`. Querying them requires `json_extract` which is slow and brittle.

Add a normalised column for the most-queried fields:

```sql
ALTER TABLE audit_results ADD COLUMN failure_reasons TEXT;     -- comma-separated enum values, queryable
ALTER TABLE audit_results ADD COLUMN suggestions_count INTEGER; -- how many suggestions were made
```

Populate `failure_reasons` from a small set of common failure types per auditor:

- Voice Auditor: `tribe_word`, `long_sentence`, `vague_subject`, `no_specific_example`, `flattery`, etc.
- Structure Editor: `weak_hook`, `missing_close`, `beat_too_long`, `pacing_uneven`, etc.
- Fact Checker: `unverified_claim`, `contradicted_claim`, `missing_source`, etc.

The Voice Auditor and Structure Editor prompts may need small updates to include a `failure_reasons` array in their structured output. This is similar in shape to the Curator change in Task 03.

Document the enums in the relevant contract files (`content/voice-contract.md`, `content/structure-contract.md`, `content/fact-check-contract.md`).

Keep `notes` for the full JSON. The new column is for fast queries; the JSON is for full detail.

## Update docs

- `docs/SCHEMA.md` — document `run_id` everywhere; document new audit columns.
- `docs/RETENTION.md` — new file as above.
- `docs/AGENTS.md` — note `run_id` propagation in the Director section.
- `docs/DECISIONS.md` — append: "L16, L23, L24 closed YYYY-MM-DD. Retention policy live; run_id end-to-end; audit failure reasons normalised."
- `docs/FOLLOWUPS.md` — remove L16, L23, L24.
- `docs/RUNBOOK.md` — document the retention worker, manual override, the run_id usage, the backfill script if present.
- `CLAUDE.md` — update if affected.

## What success looks like

- Every new row across the pipeline carries a `run_id` linking it to the run that produced it.
- The retention worker runs daily and prunes correctly. Counts logged to `observer_events`.
- `audit_results.failure_reasons` populates on new rows; existing JSON-only rows are untouched.
- Docs match.
- Three or four commits: migration, retention worker, audit columns + prompt updates, docs.

## What NOT to do

- Do not delete historical rows just because they predate retention. Pruning starts from this point forward only.
- Do not tighten retention windows beyond the recommendations without thinking about the consequences. Once data is gone, it's gone.
- Do not bundle this with any other migration.

## How to verify it worked

After the next run:

```sql
SELECT run_id, COUNT(*) FROM daily_candidates
WHERE created_at > datetime('now', '-1 day')
GROUP BY run_id;
```

Expected: run_id populated, all candidates from one run share the same run_id.

After 24 hours of the retention worker running:

```sql
SELECT
  (SELECT COUNT(*) FROM observer_events WHERE created_at < datetime('now', '-90 days') AND severity != 'high') AS should_be_zero;
```

Expected: 0. If non-zero, the retention worker isn't pruning.

For audit normalisation:

```sql
SELECT auditor_type, failure_reasons FROM audit_results
WHERE created_at > datetime('now', '-1 day') AND passed = 0
LIMIT 10;
```

Expected: `failure_reasons` populated with enum values.

## What this completes

After this task, all 9 high-severity leaks plus the most relevant medium-severity ones (L10, L11, L16, L23, L24) are closed. The data foundation is solid. The next session is the start of the platform plan we sketched earlier — search subdomain first, then related-pieces widget, then the rest.
