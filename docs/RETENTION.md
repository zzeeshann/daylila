# Daylila Retention Policy

**Status:** Live as of 2026-05-07 (Foundation Fix Task 08, migration 0037 + retention worker). First 7 days post-deploy run in DRY_RUN mode — see "Flipping to live mode" below.

**One principle:** selected and meaningful data is permanent (published pieces, learnings, audits linked to published pieces); unselected and process data has a retention window. Once data is gone, it's gone — err on the longer side.

---

## Policy table

| Table | Retention | Why |
|-------|-----------|-----|
| `daily_pieces` | Forever | Published pieces are permanent under the hard rule. |
| `daily_candidates` (selected=1) | Forever | The picked candidate is part of the piece's record. |
| `daily_candidates` (selected=0) | 90 days | Process noise — Curator's day-of judgment, not load-bearing once 90 days pass. |
| `observer_events` (severity = `escalation`) | 1 year | High-severity records carry incident history; want them around for trend analysis. |
| `observer_events` (severity = `info` / `warn`) | 90 days | Routine breadcrumbs — a 90-day window catches most "what happened on date X" forensics; older events are noise. |
| `pipeline_log` | 180 days | Per-step pipeline trace. Day-grouping queries (admin pipeline history) operate on a recent window, not lifetime. |
| `audit_results` (linked to published piece) | Forever | Part of the piece's quality record. |
| `audit_results` (drafts never published) | 90 days | Process noise from runs that errored out before publish. |
| `draft_revisions` (linked to published piece) | Forever | Per-round MDX trail of every published piece. |
| `draft_revisions` (drafts never published) | 90 days | Same shape as audit_results. |
| `integrator_decisions` (linked to published piece) | Forever | Per-feedback-item disposition record. |
| `engagement` | 1 year | Reader-engagement aggregates. Long enough for year-over-year analysis without forever-keep weight. |
| `learnings` | Forever | The Drafter loads from this every run. The Learner-feedback loop's value compounds with retention. |
| `magic_tokens` | 30 minutes (TTL) | Already managed by the auth flow's expiry; not under this worker. |

Tables not listed (e.g. `daily_piece_audio`, `interactives`, `interactive_audit_results`, `piece_categories`, `categories`, `audio_audit_results`, `audio_dwell_events`, `user_piece_reads`, `saved_pieces`, `users`, `progress`, `submissions`, `zita_messages`, `daily_audit_claims`) are NOT pruned by this worker. Add a rule when retention becomes load-bearing for one of them.

---

## How the worker runs

- **Where it lives:** `agents/src/retention.ts`, called from the `scheduled()` handler in `agents/src/server.ts`.
- **When it runs:** daily at 04:00 UTC. Configured via `[triggers] crons = ["0 4 * * *"]` in `agents/wrangler.toml`. Two hours after the 02:00 UTC daily-publish slot, so cleanup never fights with publishing.
- **What it logs:** every rule that runs writes one `observer_events` row (severity `info` for routine pruning, `warn` on SQL failures, `escalation` if the published-piece guard trips). Operators read these from the admin observer feed.

---

## DRY_RUN safety rail (first 7 days)

The worker ships in DRY_RUN mode (`RETENTION_DRY_RUN = "true"` in `agents/wrangler.toml` `[vars]`). In dry-run mode each rule:

1. Computes `cutoff = now - windowDays`.
2. Runs the published-piece **guard** SELECT (must return 0).
3. Runs `SELECT COUNT(*)` against the rule's WHERE clause.
4. Logs an `info` `Retention dry-run: <table>` event with the count of rows that WOULD be deleted.
5. Deletes nothing.

Operator reviews 7 days of dry-run events on the admin dashboard. If the counts look correct (no surprises, no published-piece counts in the candidates), flip to live mode.

---

## Flipping to live mode

> **Destructive.** Confirm with the user before running. Auto-mode does not cover this transition.

```sh
cd /Users/zee/zeemish-v2/agents
npx wrangler secret put RETENTION_DRY_RUN
# Enter: false
# (Or remove the [vars] entry from agents/wrangler.toml and redeploy.)
```

After the next 04:00 UTC fire, observer events will read `Retention pruned: <table>` instead of `Retention dry-run: <table>`. Counts should match the dry-run values from the previous day.

If something looks wrong in the first live day, immediately flip back:

```sh
npx wrangler secret put RETENTION_DRY_RUN
# Enter: true
```

The next day's run will be dry-run again. No data was lost — only that day's pruning happened, and the deletes are bounded by the policy (cannot remove published-piece-linked rows; the guard is hard-throw).

---

## Manual override

To skip a single day's run (e.g. during maintenance):

```sh
npx wrangler tail zeemish-agents --format pretty
# Wait for 04:00 UTC; if the cron fires, the tail shows the runRetention call.
# To pre-empt: temporarily comment out the `[triggers]` block in agents/wrangler.toml
# and redeploy. Re-enable after the maintenance window.
```

To force a one-off run (for testing the worker pre-04:00):

```sh
# Cloudflare CLI doesn't have a direct "trigger this cron now" command.
# Easiest path: write a temporary HTTP endpoint in server.ts that calls
# runRetention(env), deploy, hit it with curl + ADMIN_SECRET, then revert
# the endpoint.
```

To restore data accidentally pruned (if the operator flipped to live mode early):

- D1's `wrangler d1 time-travel` supports point-in-time restore up to 30 days back.
- Confirm the timestamp BEFORE the bad pruning, then restore. This rolls back the entire database — discuss with the user before running.

---

## Operator queries

Inspect what the worker has been doing:

```sql
-- Last 7 days of retention activity:
SELECT created_at, title, severity,
       json_extract(context, '$.candidateCount') AS candidates,
       json_extract(context, '$.deletedCount') AS deleted,
       json_extract(context, '$.dryRun') AS dry_run
FROM observer_events
WHERE title LIKE 'Retention %'
ORDER BY created_at DESC LIMIT 50;

-- Tables that haven't been pruned recently (rule mis-configured? schema drift?):
SELECT json_extract(context, '$.table') AS tbl, MAX(created_at) AS last_seen
FROM observer_events
WHERE title LIKE 'Retention %'
GROUP BY tbl ORDER BY last_seen ASC;
```

---

## How to change a window

Edit `RETENTION_RULES` in `agents/src/retention.ts`. Redeploy the agents worker. The next 04:00 UTC run uses the new value. No migration needed.

If a window shrinks (e.g. 90 → 30), the next live run will delete a larger backlog in one go. Consider re-flipping DRY_RUN back to true for one day to preview the impact.

---

## Why these windows

The brief (`docs/foundation-fix/08-RETENTION-AND-RUNID.md`) recommended these defaults; this task adopted them verbatim. Memory `feedback_non_destructive.md`: once data is gone it's gone, so err on the longer side.

The numbers reflect different load-bearing roles:
- 90 days for low-cost process noise (rejected candidates, info/warn events) — long enough for "what happened last quarter" forensics.
- 180 days for `pipeline_log` — covers the one-week-per-piece typical investigation window plus six months of headroom.
- 1 year for engagement and high-severity events — year-over-year cycles + rare incidents need long horizons.
- Forever for everything that's part of the published record (pieces, audits-of-pieces, learnings, integrator decisions).

If after a year of running the windows feel wrong, revisit. They are tunable.
