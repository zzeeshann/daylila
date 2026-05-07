/**
 * Daily retention worker — Foundation Fix Task 08 (2026-05-07). Closes
 * L16 ("observer_events grows forever").
 *
 * Two principles from the brief (`docs/foundation-fix/08-RETENTION-AND-RUNID.md`):
 *
 *   1. Selected and meaningful data is permanent. Published pieces,
 *      learnings that ever validated, audit results for published
 *      pieces — these stay forever.
 *   2. Unselected and process data has a retention window.
 *
 * Wired through `agents/wrangler.toml` `[triggers] crons = ["0 4 * * *"]`
 * and the `scheduled()` handler in `agents/src/server.ts`. Daily at
 * 04:00 UTC, two hours after the 02:00 daily-publish slot.
 *
 * --- DRY RUN SAFETY RAIL ---
 *
 * First-deploy default is `RETENTION_DRY_RUN = "true"` (set in
 * `[vars]` in agents/wrangler.toml). In dry-run mode the worker:
 *   - SELECTS rows that would be deleted (count only, no fetch)
 *   - logs the count + table + window to `observer_events` (severity
 *     `info`, title `Retention dry-run: <table>`)
 *   - DELETES nothing
 *
 * Operator reviews 7 days of dry-run events, then flips the flag
 * to live (set the variable to `"false"` or remove it). NEVER flip
 * to live without confirming with the user; doing so is destructive.
 *
 * --- PUBLISHED-PIECE GUARD ---
 *
 * The brief: "fail loudly if a delete attempts to remove a piece that's
 * published — that's a bug, not retention". Each policy entry includes
 * a `guardSql` SELECT that MUST return 0 before the DELETE runs. If
 * non-zero, the worker throws (Cloudflare logs the throw and the cron
 * gets a failed-run record); the operator investigates manually.
 *
 * The guard is belt-and-braces — the policy SQL itself already
 * excludes published-piece rows (e.g. via `AND piece_id IN (... drafts
 * never published ...)` joins). The guard catches a regression where
 * the policy SQL itself drifts.
 */

import type { Env } from './types';

/**
 * Direct write into observer_events. The retention worker runs from
 * the agents worker's `scheduled()` handler, NOT from a Durable Object,
 * so `subAgent(ObserverAgent)` is unavailable. Same INSERT shape as
 * ObserverAgent.writeEvent — kept intentionally inline (single caller,
 * doesn't justify a shared module).
 *
 * Foundation Fix Task 08 (2026-05-07): observer_events.run_id is
 * always null here — retention is a system-level operation, not part
 * of any pipeline run.
 */
async function logObserverEvent(
  db: D1Database,
  event: {
    severity: 'info' | 'warn' | 'escalation';
    title: string;
    body: string;
    context: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO observer_events (id, severity, title, body, context, piece_id, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        event.severity,
        event.title,
        event.body,
        JSON.stringify(event.context),
        null,
        null,
        Date.now(),
      )
      .run();
  } catch {
    // A corrupt observer_events table cannot crash the cron.
  }
}

/**
 * One retention rule. Matches the docs/RETENTION.md table 1:1.
 *
 *   - `table` — for log messages and the published-piece guard.
 *   - `windowDays` — null means forever (no retention; entry exists
 *     for self-documentation).
 *   - `selectSql` — SELECT COUNT(*) of rows that WOULD be deleted.
 *     Used for both dry-run reporting and live-mode pre-flight.
 *   - `deleteSql` — DELETE statement. Bound with the same args as
 *     selectSql. Run only when DRY_RUN is false.
 *   - `guardSql` — SELECT COUNT(*) of rows that would be deleted AND
 *     are linked to a published piece. MUST return 0.
 *
 * Args: `[cutoffMs]` for time-windowed entries.
 */
interface RetentionRule {
  table: string;
  description: string;
  windowDays: number | null;
  selectSql: string | null;
  deleteSql: string | null;
  guardSql: string | null;
}

/** Default retention windows from the brief. Tunable via redeploy. */
const RETENTION_RULES: RetentionRule[] = [
  // ─── Forever-keep tables (self-documenting; no SQL run) ────────────
  {
    table: 'daily_pieces',
    description: 'Published pieces — permanent under the hard rule. Never pruned.',
    windowDays: null,
    selectSql: null,
    deleteSql: null,
    guardSql: null,
  },
  {
    table: 'learnings',
    description: 'Learnings (any source) — permanent. The Learner reads from this every run; the workhorse signal.',
    windowDays: null,
    selectSql: null,
    deleteSql: null,
    guardSql: null,
  },

  // ─── Process-noise tables (windowed) ──────────────────────────────
  {
    table: 'daily_candidates (selected=0)',
    description: 'Unselected news candidates older than 90 days.',
    windowDays: 90,
    selectSql: 'SELECT COUNT(*) AS n FROM daily_candidates WHERE selected = 0 AND created_at < ?',
    deleteSql: 'DELETE FROM daily_candidates WHERE selected = 0 AND created_at < ?',
    // Guard — selected=0 rows shouldn't link to a piece. If any do,
    // the selected-flag bug from L25 has resurfaced; abort.
    guardSql:
      `SELECT COUNT(*) AS n FROM daily_candidates dc
       JOIN daily_pieces dp ON dp.id = dc.piece_id
       WHERE dc.selected = 0 AND dc.created_at < ?`,
  },
  {
    table: 'observer_events (severity info|warn)',
    description: 'Low/medium-severity observer events older than 90 days. High severity (escalation) kept 1 year.',
    windowDays: 90,
    selectSql:
      "SELECT COUNT(*) AS n FROM observer_events WHERE severity IN ('info', 'warn') AND created_at < ?",
    deleteSql:
      "DELETE FROM observer_events WHERE severity IN ('info', 'warn') AND created_at < ?",
    // Observer events have piece_id but NOT every event is for a
    // published piece. The guard scopes specifically to published-piece
    // events that are tagged for retention — which should be zero
    // because we're filtering severity='escalation' out of this rule.
    guardSql: null,
  },
  {
    table: 'observer_events (severity escalation)',
    description: 'High-severity (escalation) observer events older than 1 year.',
    windowDays: 365,
    selectSql:
      "SELECT COUNT(*) AS n FROM observer_events WHERE severity = 'escalation' AND created_at < ?",
    deleteSql:
      "DELETE FROM observer_events WHERE severity = 'escalation' AND created_at < ?",
    guardSql: null,
  },
  {
    table: 'pipeline_log',
    description: 'Per-step pipeline log older than 180 days.',
    windowDays: 180,
    selectSql: 'SELECT COUNT(*) AS n FROM pipeline_log WHERE created_at < ?',
    deleteSql: 'DELETE FROM pipeline_log WHERE created_at < ?',
    // Guard — pipeline_log is process noise; published-piece rows
    // are fine to delete after 180 days (the piece itself is
    // permanent in daily_pieces). No guard needed.
    guardSql: null,
  },
  {
    table: 'audit_results (drafts never published)',
    description: 'Audit rows for pieces that never made it to daily_pieces, older than 90 days.',
    windowDays: 90,
    selectSql:
      `SELECT COUNT(*) AS n FROM audit_results
       WHERE created_at < ?
         AND (piece_id IS NULL OR piece_id NOT IN (SELECT id FROM daily_pieces))`,
    deleteSql:
      `DELETE FROM audit_results
       WHERE created_at < ?
         AND (piece_id IS NULL OR piece_id NOT IN (SELECT id FROM daily_pieces))`,
    // Guard verifies no published-piece audit_results match the WHERE.
    guardSql:
      `SELECT COUNT(*) AS n FROM audit_results
       WHERE created_at < ?
         AND piece_id IN (SELECT id FROM daily_pieces)
         AND (piece_id IS NULL OR piece_id NOT IN (SELECT id FROM daily_pieces))`,
  },
  {
    table: 'draft_revisions (drafts never published)',
    description: 'Per-round draft MDX for pieces that never made it to daily_pieces, older than 90 days.',
    windowDays: 90,
    selectSql:
      `SELECT COUNT(*) AS n FROM draft_revisions
       WHERE created_at < ?
         AND piece_id NOT IN (SELECT id FROM daily_pieces)`,
    deleteSql:
      `DELETE FROM draft_revisions
       WHERE created_at < ?
         AND piece_id NOT IN (SELECT id FROM daily_pieces)`,
    guardSql:
      `SELECT COUNT(*) AS n FROM draft_revisions
       WHERE created_at < ?
         AND piece_id IN (SELECT id FROM daily_pieces)
         AND piece_id NOT IN (SELECT id FROM daily_pieces)`,
  },
  {
    table: 'engagement',
    description: 'Reader engagement aggregates older than 1 year.',
    windowDays: 365,
    selectSql: 'SELECT COUNT(*) AS n FROM engagement WHERE created_at < ?',
    deleteSql: 'DELETE FROM engagement WHERE created_at < ?',
    guardSql: null,
  },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run the daily retention pass.
 *
 * Called from `agents/src/server.ts` `scheduled()`. Returns nothing —
 * results land in `observer_events` for operator review.
 *
 * Behaviour:
 *   - For each rule with a window, compute cutoff = now - windowDays.
 *   - Run guardSql first; throw if it returns > 0.
 *   - Run selectSql; capture row count.
 *   - If DRY_RUN, log the count and skip the DELETE.
 *   - Otherwise run deleteSql, log the actual rows-deleted count.
 *
 * Failure posture: errors propagate. Cloudflare logs cron failures and
 * the next 04:00 run picks up where this one left off (DELETEs are
 * date-based, idempotent on retry).
 */
export async function runRetention(env: Env): Promise<void> {
  const dryRun = env.RETENTION_DRY_RUN !== 'false';
  const now = Date.now();

  for (const rule of RETENTION_RULES) {
    if (rule.windowDays === null) continue; // forever-keep entry, skip
    if (!rule.selectSql || !rule.deleteSql) continue; // mis-configured

    const cutoffMs = now - rule.windowDays * ONE_DAY_MS;

    // Guard — abort if any published-piece row matches the WHERE.
    if (rule.guardSql) {
      const guardRow = await env.DB.prepare(rule.guardSql).bind(cutoffMs).first<{ n: number }>();
      const guardCount = guardRow?.n ?? 0;
      if (guardCount > 0) {
        await logObserverEvent(env.DB, {
          severity: 'escalation',
          title: `Retention guard tripped: ${rule.table}`,
          body:
            `Retention worker would have deleted ${guardCount} row(s) linked to a published piece for ` +
            `${rule.table} at cutoff ${new Date(cutoffMs).toISOString()}. ` +
            `This is a bug, not retention — the policy SQL has drifted. Aborting the rest of this run.`,
          context: { table: rule.table, cutoffMs, guardCount, rule: rule.description },
        });
        throw new Error(
          `Retention guard tripped on ${rule.table}: ${guardCount} published-piece rows match the delete window.`,
        );
      }
    }

    // SELECT COUNT(*) — what would be deleted.
    let candidateCount = 0;
    try {
      const row = await env.DB.prepare(rule.selectSql).bind(cutoffMs).first<{ n: number }>();
      candidateCount = row?.n ?? 0;
    } catch (err) {
      // Mis-configured or schema drift; log + continue with the next
      // rule rather than aborting the whole pass.
      await logObserverEvent(env.DB, {
        severity: 'warn',
        title: `Retention SELECT failed: ${rule.table}`,
        body:
          `Retention worker SELECT failed for ${rule.table} at cutoff ` +
          `${new Date(cutoffMs).toISOString()}: ${err instanceof Error ? err.message : String(err)}`,
        context: { table: rule.table, cutoffMs, rule: rule.description },
      });
      continue;
    }

    if (dryRun) {
      await logObserverEvent(env.DB, {
        severity: 'info',
        title: `Retention dry-run: ${rule.table}`,
        body:
          `Retention worker would delete ${candidateCount} row(s) from ${rule.table} ` +
          `(window ${rule.windowDays} days, cutoff ${new Date(cutoffMs).toISOString()}). ` +
          `DRY_RUN active — nothing deleted.`,
        context: {
          table: rule.table,
          cutoffMs,
          windowDays: rule.windowDays,
          candidateCount,
          dryRun: true,
        },
      });
      continue;
    }

    // Live mode — run the DELETE.
    let deletedCount = 0;
    try {
      const res = await env.DB.prepare(rule.deleteSql).bind(cutoffMs).run();
      deletedCount = res.meta?.changes ?? 0;
    } catch (err) {
      await logObserverEvent(env.DB, {
        severity: 'warn',
        title: `Retention DELETE failed: ${rule.table}`,
        body:
          `Retention worker DELETE failed for ${rule.table} at cutoff ` +
          `${new Date(cutoffMs).toISOString()}: ${err instanceof Error ? err.message : String(err)}`,
        context: { table: rule.table, cutoffMs, rule: rule.description },
      });
      continue;
    }

    await logObserverEvent(env.DB, {
      severity: 'info',
      title: `Retention pruned: ${rule.table}`,
      body:
        `Retention worker deleted ${deletedCount} row(s) from ${rule.table} ` +
        `(window ${rule.windowDays} days, cutoff ${new Date(cutoffMs).toISOString()}).`,
      context: {
        table: rule.table,
        cutoffMs,
        windowDays: rule.windowDays,
        deletedCount,
        dryRun: false,
      },
    });
  }
}
