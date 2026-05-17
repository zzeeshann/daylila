# Cap Incident — 2026-05-17 — Cloudflare DO daily free-tier duration exceeded

**Status: investigation incomplete. Prevention work specified but not yet shipped.**

## What happened

At ~11:02 UTC the operator received an email from Cloudflare stating the daily Durable Objects free-tier duration limit (13,000 GB-seconds) was exceeded for the `zeemish-agents` worker. Service is degraded — every new `DirectorAgent` request returns `Exceeded allowed duration in Durable Objects free tier` until the daily counter resets at 2026-05-18 00:00 UTC.

Final billed duration for the day: **19,170 GB-sec** (147% of the 13k cap).

## Timeline (UTC)

| Time | What happened | Source |
| --- | --- | --- |
| 01:25 | ArXiv-paper-mills pipeline runs cleanly (~2 min LLM time) | pipeline_log + LLM meter |
| 02:00 | Cron fires for daily slot. Curator returns empty content. Pipeline wedges. | pipeline_log |
| 03:08 | Operator triggers admin retrigger (recovery). Bulgarian-banger piece publishes after 3 audit rounds with `auditing_r3:failed` escalation. | pipeline_log + observer escalation row |
| 03:43 | Second admin retrigger. Swatch piece publishes cleanly (1 audit round). | pipeline_log |
| 03:51 | Swatch HTML lab retrigger #1 fails — `InteractiveAuditor` audit-throw crash, full 241s round 1 budget burned. | observer escalation row |
| **04:00** | **Retention worker fires (first live-mode run ever)** — 7 rules pruned, 0 rows deleted. | observer info rows |
| 04:03 | Swatch HTML lab retrigger #2 fails — same audit-throw crash. | observer escalation row |
| **04:11** | **Operator pushes code mid-pipeline (Director zombie wedge fix #61).** Durable Object reset. | Cloudflare logs panel — `Durable Object reset because its code was updated` |
| **04:25** | Swatch HTML lab retrigger #3 succeeds with new `InteractiveAuditor` soft-fail fix. "Queue Versus Capacity Collapse" shipped. | observer info row |
| **04:45** | **Operator pushes code AGAIN mid-pipeline (InteractiveAuditor soft-fail fix #62).** Durable Object reset #2. | Cloudflare logs panel |
| **04:25–12:00** | **Sustained 470 GB-sec/sample plateau. ZERO observer_events. ZERO pipeline_log rows. Only hourly cron fires visible in Workers Logs (each ~600ms).** | Cloudflare metrics chart + D1 queries |
| 12:00 | Cap hit. Hourly cron alarm fires AND fails with `Exceeded allowed duration in Durable Objects free tier`. | Workers Logs |
| 12:00–12:02 | SDK retries the failed alarm with exponential backoff (0s, 2s, 6s, 16s, 34s, 1m13s, 2m20s), all fail. | Workers Logs |
| 12:02+ | Service degraded for `DirectorAgent`. | Cloudflare email |

## What's known with certainty

1. **The four pipeline runs (01:25, 02:00, 03:08, 03:43) account for ~10% of duration.** The bulk (~17k GB-sec) is the 8-hour silent plateau from 04:25 to 12:30 UTC.
2. **No external attacker.** Cloudflare metrics show `HTTP=0` direct traffic to `DirectorAgent`. All 858 requests over 24h are RPC (785) or Alarm (73) from this codebase's own scheduled work + admin endpoints.
3. **The plateau is silent.** D1 confirmed zero `pipeline_log` writes and zero `observer_events` rows between 04:25 UTC and 12:00 UTC. The Cloudflare Logs panel shows only hourly cron fires (`dailyRun` taking ~600ms each).
4. **Two code pushes during active pipelines.** At 04:11 UTC and 04:45 UTC the operator deployed via CI while pipelines were running, forcing Durable Object resets mid-execution. Both resets correlate with the plateau onset.
5. **The retention worker first-ever live-mode run was 04:00:50 UTC, ~10 minutes before the plateau cliff up.** Possible coincidence; possible contributor — retention does no DO work directly, but its scheduled() handler shares the same Worker isolate.

## What is NOT known

**Root cause of the 8-hour plateau.** Despite ~6 hours of investigation (D1 queries, Cloudflare logs, Agents SDK source code review, `wrangler tail`), I could not identify the specific code path billing duration during the plateau. Candidates I could not rule out from outside:

- **A keepAlive heartbeat schedule entry orphaned across DO resets.** The SDK stores `_keepAliveRefs` in-memory only, but if the alarm-time math is sticky in `ctx.storage.setAlarm()`, a stale 30s-ahead alarm could repeatedly fire forever. Plausible but unverified.
- **An open RPC subscription via `routeAgentRequest` /agents/* path.** Unlikely (no site-side WS clients found), but cannot rule out external pingers.
- **A bug in the SDK's restart restoration logic.** After the two code resets, `onStart()` runs `restoreConnectionsFromStorage`, `restoreRpcMcpServers`, `_checkOrphanedWorkflows`, `_checkRunFibers`. If any one entered a recovery loop, it would run silently.
- **Cloudflare's DO billing model itself.** It's possible the metric is showing instance-residency time, not active-CPU time. Unverified — would need Cloudflare support contact.

**The investigation hit a hard wall**: there's no logging surface in this codebase that captures what the SDK is doing between observer-event writes. Without that, root-cause is guess-work.

## Why a DO can run 7+ hours unbounded — the architectural truth

Cloudflare Durable Objects have:
- **A 15-minute wall-clock budget per single alarm invocation.** Individual fires cannot run forever.
- **No cumulative duration cap.** A DO that wakes up, runs 5 seconds, goes idle, wakes up again — repeated — can accumulate hours of billable duration with no Cloudflare-side kill switch.
- **No built-in operation timeout in the Agents SDK.** The SDK provides `keepAlive()` (refcount-based heartbeat) but no "abort after N minutes" mechanism.
- **No D1-level kill switch in this codebase.** Nothing can say "Director, stop everything immediately."

That last gap is the prevention story. Without explicit guardrails, today's incident was inevitable on any day with enough stochastic LLM/SDK weirdness.

## Pay-as-you-go safety implication

If the account were on Workers Paid (PAYG) when today's plateau happened, there would be no cap to stop it. The plateau would have continued. With no daily reset, a runaway could in principle run for days. The economic impact:

- Today's 19k GB-sec on PAYG → 19k beyond the included 400k/month quota = $0 overage (within included budget)
- A theoretical runaway lasting 7 days at today's rate → 133k GB-sec → still inside the 400k monthly included quota
- A worse runaway (e.g., active 24h/day at higher rate) could push past 400k = $12.50 per million GB-sec overage, but real-world cost ceiling is still small (~$5-50/month even in pathological cases)

**Cost isn't the PAYG concern. Reliability is.** Without daily cap, a runaway never self-resolves. The system becomes unmaintainable until you kill it manually.

So: **PAYG without guardrails is worse than Free-tier with cap-trips.** PAYG with guardrails is the right answer.

## Prevention plan — the four guardrails

These are the patches to apply when the cap resets at 00:00 UTC. They give the codebase what it currently lacks: an emergency stop, a runaway detector, and visibility for next time.

### Guardrail 1 — Kill switch flag (admin_settings.director_disabled)

A boolean flag in `admin_settings` read on every Director alarm + public method. Operator can flip via `wrangler d1 execute` to halt all Director activity immediately. **Works even during a cap because D1 writes don't go through DO duration.**

Patch: `agents/src/director.ts` — add at top of `dailyRun()`, `triggerDailyPiece()`, every `*Scheduled` callback:

```ts
const disabled = await getAdminSetting(this.env.DB, 'director_disabled', (v) => v === '1', false);
if (disabled) {
  console.warn('[director] disabled via admin_settings.director_disabled — exiting');
  return;
}
```

Migration: `INSERT OR IGNORE INTO admin_settings(key, value) VALUES('director_disabled', '0')`.

Operator commands:
- Kill: `wrangler d1 execute zeemish --remote --command "UPDATE admin_settings SET value='1' WHERE key='director_disabled';"`
- Resume: `wrangler d1 execute zeemish --remote --command "UPDATE admin_settings SET value='0' WHERE key='director_disabled';"`

### Guardrail 2 — Operation-duration watchdog (director_health table)

A new D1 table tracking active operations across DO restarts (in-memory state is lost on code-push, D1 isn't).

Migration `0045_director_health.sql`:
```sql
CREATE TABLE director_health (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  piece_id TEXT,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE INDEX idx_director_health_status ON director_health(status, started_at);
```

Director writes a row at every `keepAlive()` acquire, updates `last_heartbeat_at` at each heartbeat, marks `completed` at dispose. **A separate cron at HH:30 (offset from hourly main cron) reads stale 'running' rows; if any are > 30 minutes old, fires escalation observer event + sets the kill switch flag.**

This is the missing self-healing layer: even if the bug recurs, the system auto-kills itself instead of running for 8 hours.

### Guardrail 3 — Schedule-table audit on Director.onStart

When the DO restarts (e.g., after a code push), audit the internal SDK schedule tables and log their sizes:

```ts
async onStart() {
  await this.schedule('0 * * * *', 'dailyRun', { type: 'daily-piece' });

  // Foundation Fix 2026-05-17 — visibility into SDK internal state.
  try {
    const schedRows = this.sql`SELECT COUNT(*) as n FROM cf_agents_schedules`;
    const fiberRows = this.sql`SELECT COUNT(*) as n FROM cf_agents_runs`;
    const wfRows = this.sql`SELECT COUNT(*) as n FROM cf_agents_workflows WHERE status NOT IN ('complete','errored','terminated')`;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    await observer.logInfo(
      'director-onstart-state',
      'Director DO onStart',
      `schedules: ${schedRows[0]?.n ?? 0}, active fibers: ${fiberRows[0]?.n ?? 0}, active workflows: ${wfRows[0]?.n ?? 0}`,
    );
  } catch (err) {
    console.error('[director.onStart] audit failed:', err);
  }
}
```

Cost: 3 SQLite COUNT queries + 1 observer write per DO restart. Tiny. Gives us the data needed to spot accumulation on the NEXT cap-trip.

### Guardrail 4 — Per-alarm observability

Wrap the alarm handler with timing + table-size snapshots written to observer_events. This is the diagnostic data that didn't exist today.

```ts
async alarm() {
  const started = Date.now();
  const schedCount = (this.sql`SELECT COUNT(*) as n FROM cf_agents_schedules`)[0]?.n ?? 0;

  try {
    await super.alarm();
  } finally {
    const elapsed = Date.now() - started;
    // Only log if alarm took significant time OR schedule table is anomalously large
    if (elapsed > 5000 || schedCount > 50) {
      try {
        const observer = await this.subAgent(ObserverAgent, 'observer');
        await observer.logInfo(
          'director-alarm-tick',
          `Director alarm (${elapsed}ms)`,
          `schedule rows: ${schedCount}, elapsed: ${elapsed}ms`,
        );
      } catch { /* fail-open */ }
    }
  }
}
```

Cost: ~1 SQLite COUNT per alarm fire, 0 D1 writes on the happy path. Logs only on suspicious activity.

## When the cap resets (tomorrow 00:00 UTC)

Order of operations:
1. Apply migration 0045 (`wrangler d1 migrations apply zeemish --remote`)
2. Apply patches to `agents/src/director.ts`
3. Deploy via `git push` (CI auto-deploy)
4. Watch the next 02:00 UTC cron run via `wrangler tail`. Confirm the new onStart audit fires + the new alarm tick logs.
5. If the plateau bug recurs, the new logs will show what's happening. The watchdog will auto-trip the kill switch after 30 minutes.

## What to NOT do

- **Don't push code during an active pipeline run.** Check the admin dashboard before any deploy. Today's two mid-pipeline resets at 04:11 and 04:45 UTC are correlated (but not yet proven causal) with the plateau onset.
- **Don't upgrade to Workers Paid without these guardrails first.** PAYG without a kill switch and watchdog is strictly worse than Free-tier — a runaway has no upper bound.
- **Don't blame the InteractiveAuditor soft-fail fix.** That fix worked correctly — the 04:25 UTC Swatch HTML retry succeeded clean. The plateau started during the same window but the success event suggests the new code path is healthy.

## Open questions for future investigation

1. **Are the 04:11 and 04:45 UTC code pushes causally linked to the plateau?** Could be coincidence. Could be that mid-pipeline DO reset leaves the SDK in a partially-restored state. Test: reproduce in a controlled local dev environment by pushing code mid-pipeline.
2. **What was actually consuming duration during the plateau?** Guardrail 4 will surface this on the next incident. If the next plateau shows `cf_agents_schedules` growing without bound, that's the smoking gun.
3. **Should the Agents SDK ship operation-timeout primitives?** This is upstream work. Worth opening an issue against `cloudflare/agents` on GitHub.

## Related files / future reference

- Investigation plan + raw findings: `~/.claude/plans/now-research-received-this-whimsical-puppy.md` (Claude session artifact)
- Cloudflare Agents SDK source consulted: `agents/node_modules/agents/dist/index.js`
  - alarm handler: line 1883
  - `_scheduleNextAlarm`: line 1833
  - `_checkRunFibers`: line 1800
  - `keepAlive`: line 1690
- Code paths reviewed (no smoking gun found): `agents/src/director.ts` (keepAlive/triggerDailyPiece/runAudioPipelineScheduled/checkAudioStalled/generateInteractiveScheduled/retryAudio), `agents/src/retention.ts`, `agents/src/fact-checker-tavily.ts`, `agents/src/shared/tavily-client.ts`
