/**
 * Director DO guardrails — kill switch, operation watchdog, and onStart
 * audit. Added 2026-05-17 after the cap-incident. See
 * docs/CAP-INCIDENT-2026-05-17.md for the full story.
 *
 * Why this exists: Cloudflare DOs have no built-in cumulative duration
 * cap. The Agents SDK has no operation-timeout primitive. A DO that
 * wakes up briefly + frequently can rack up hours of billable duration
 * with no Cloudflare-side kill switch. Today's incident: 8-hour silent
 * plateau, no observability surface caught it.
 *
 * Four guardrails:
 *
 *   1. checkKillSwitch(env) — reads admin_settings.director_disabled.
 *      Director calls this at the top of every alarm callback + every
 *      public method. Operator flips the flag via D1 to halt all
 *      activity immediately. Works during a cap because D1 writes are
 *      independent of DO duration.
 *
 *   2. recordOperationStart / recordOperationHeartbeat / recordOperationComplete —
 *      D1-backed tracking of long-running operations across DO restarts.
 *      Survives code pushes (unlike in-memory state).
 *
 *   3. auditStaleOperations(env) — called by a separate cron at HH:30.
 *      Reads director_health for 'running' rows with last_heartbeat_at
 *      older than 30 minutes. If any are found, sets the kill switch
 *      and fires an escalation observer event. Self-healing layer.
 *
 *   4. snapshotSdkState(sql, observer) — called at Director.onStart and
 *      from alarm() override. Records cf_agents_schedules / _runs /
 *      _workflows table sizes to observer_events so we can spot
 *      accumulation on the next incident.
 *
 * Cost: ~1 D1 read per alarm fire (kill switch), ~1 D1 write per long
 * operation start + dispose, ~1 D1 read per 30s heartbeat. Negligible.
 *
 * Operator commands:
 *
 *   # Emergency stop — halt all Director activity
 *   wrangler d1 execute zeemish --remote --command \
 *     "UPDATE admin_settings SET value='1' WHERE key='director_disabled';"
 *
 *   # Resume — clear the kill switch
 *   wrangler d1 execute zeemish --remote --command \
 *     "UPDATE admin_settings SET value='0' WHERE key='director_disabled';"
 *
 *   # Inspect current operations
 *   wrangler d1 execute zeemish --remote --command \
 *     "SELECT * FROM director_health WHERE status='running' ORDER BY started_at;"
 *
 *   # Inspect SDK schedule accumulation (run from inside the DO via
 *   # `await director.getSdkSnapshot()` — exposed as an admin endpoint)
 */

import type { Env } from './types';

/**
 * Default max age (minutes) of a 'running' operation before the
 * watchdog cron trips the kill switch. The actual threshold is read
 * from admin_settings.director_max_operation_minutes (settable from
 * the admin dashboard) — this constant is only the fallback when the
 * setting is missing or unparseable.
 *
 * Set conservatively — the longest legitimate Director operation
 * (audio pipeline at full retry budget across 12 beats) is ~10-15 min.
 * 15 min default is at the edge; operator can raise to 20-30 if false
 * positives appear, or lower to 10 if confident operations always
 * complete faster.
 */
export const DEFAULT_MAX_OPERATION_MINUTES = 15;

/**
 * Read the admin-configurable max-operation-minutes setting, returning
 * milliseconds. Falls back to DEFAULT_MAX_OPERATION_MINUTES on any
 * parse failure.
 */
export async function getMaxOperationMs(env: Env): Promise<number> {
  try {
    const row = await env.DB
      .prepare("SELECT value FROM admin_settings WHERE key = 'director_max_operation_minutes' LIMIT 1")
      .first<{ value: string }>();
    const parsed = row?.value ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 240) {
      return parsed * 60 * 1000;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_MAX_OPERATION_MINUTES * 60 * 1000;
}

/**
 * Threshold for logging an alarm tick to observer_events. Most alarms
 * are sub-second; anything longer is suspicious enough to record.
 */
export const ALARM_LOG_THRESHOLD_MS = 5_000;

/**
 * Threshold for logging cf_agents_schedules row count. Normal state is
 * 1-3 rows (the hourly cron + a few pending one-shots). Anything past
 * 20 suggests accumulation.
 */
export const SCHEDULE_ROW_LOG_THRESHOLD = 20;

/**
 * Read the kill switch flag. Returns true if Director should halt.
 * Called at the top of every Director alarm callback and public method.
 *
 * Fail-open: if the D1 read errors (rare, but possible during a D1
 * incident), returns false rather than blocking the system. The
 * watchdog cron is the backup catch-all.
 */
export async function isDirectorDisabled(env: Env): Promise<boolean> {
  try {
    const row = await env.DB
      .prepare("SELECT value FROM admin_settings WHERE key = 'director_disabled' LIMIT 1")
      .first<{ value: string }>();
    return row?.value === '1';
  } catch {
    return false;
  }
}

/**
 * Set the kill switch ON. Called by the watchdog cron when stale
 * operations are detected. Operator can also call this manually via
 * wrangler.
 */
export async function setDirectorDisabled(env: Env, disabled: boolean): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO admin_settings(key, value, updated_at)
       VALUES('director_disabled', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    )
    .bind(disabled ? '1' : '0', Date.now())
    .run();
}

/**
 * Record the start of a long-running operation. Returns an operation
 * ID that must be passed to recordOperationHeartbeat + recordOperationComplete.
 *
 * Called inside Director.keepAlive() — the disposer also records
 * completion. Fail-open: if D1 errors, the in-memory keepAlive still
 * works; we just lose the cross-restart watchdog signal for this one
 * operation.
 */
export async function recordOperationStart(
  env: Env,
  operationType: string,
  pieceId: string | null = null,
): Promise<string> {
  const operationId = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB
      .prepare(
        `INSERT INTO director_health
         (operation_id, operation_type, piece_id, started_at, last_heartbeat_at, status)
         VALUES (?, ?, ?, ?, ?, 'running')`,
      )
      .bind(operationId, operationType, pieceId, now, now)
      .run();
  } catch (err) {
    console.error('[director-guardrails] recordOperationStart failed:', err);
  }
  return operationId;
}

/**
 * Update last_heartbeat_at. Called from the 30s keepAlive heartbeat.
 * If this row hasn't received a heartbeat in MAX_OPERATION_AGE_MS, the
 * watchdog cron will flag it as orphaned.
 */
export async function recordOperationHeartbeat(env: Env, operationId: string): Promise<void> {
  try {
    await env.DB
      .prepare("UPDATE director_health SET last_heartbeat_at = ? WHERE operation_id = ? AND status = 'running'")
      .bind(Date.now(), operationId)
      .run();
  } catch (err) {
    console.error('[director-guardrails] recordOperationHeartbeat failed:', err);
  }
}

/**
 * Mark an operation completed. Called from the keepAlive disposer.
 * Always fires regardless of operation success/failure — the
 * 'completed' status just means "the operation reached its dispose
 * point," not "it succeeded."
 */
export async function recordOperationComplete(
  env: Env,
  operationId: string,
  status: 'completed' | 'aborted' = 'completed',
): Promise<void> {
  try {
    await env.DB
      .prepare(
        `UPDATE director_health
         SET status = ?, completed_at = ?
         WHERE operation_id = ?`,
      )
      .bind(status, Date.now(), operationId)
      .run();
  } catch (err) {
    console.error('[director-guardrails] recordOperationComplete failed:', err);
  }
}

/**
 * Watchdog — finds operations stuck in 'running' for too long, marks
 * them 'orphaned', and trips the kill switch. Called by a separate
 * Cloudflare cron at HH:30 (offset from the hourly main cron at HH:00).
 *
 * Trip threshold: any 'running' row with last_heartbeat_at older than
 * MAX_OPERATION_AGE_MS. This is conservative — the longest legitimate
 * Director operation is ~15 min; 30 min is well past anything healthy.
 *
 * Returns the number of stale operations found. If > 0, the kill
 * switch was tripped and an escalation observer_event was written.
 *
 * Note: This watchdog catches the bug class where the DO ran for >30
 * minutes on a single operation. It does NOT catch the bug class where
 * the DO is making many short alarm fires that accumulate billing —
 * that's what guardrail 4 (alarm-tick logging) is for.
 */
export async function auditStaleOperations(
  env: Env,
  logEscalation: (title: string, body: string) => Promise<void>,
): Promise<number> {
  const maxAgeMs = await getMaxOperationMs(env);
  const cutoff = Date.now() - maxAgeMs;
  const stale = await env.DB
    .prepare(
      `SELECT operation_id, operation_type, piece_id, started_at, last_heartbeat_at
       FROM director_health
       WHERE status = 'running' AND last_heartbeat_at < ?
       ORDER BY started_at`,
    )
    .bind(cutoff)
    .all<{ operation_id: string; operation_type: string; piece_id: string | null; started_at: number; last_heartbeat_at: number }>();

  if (!stale.results || stale.results.length === 0) return 0;

  // Mark stale rows as orphaned so we don't re-fire on next watchdog run.
  await env.DB
    .prepare(
      `UPDATE director_health SET status = 'orphaned'
       WHERE status = 'running' AND last_heartbeat_at < ?`,
    )
    .bind(cutoff)
    .run();

  // Trip the kill switch.
  await setDirectorDisabled(env, true);

  // Escalate so the operator sees this in admin observer feed.
  const summary = stale.results
    .map((r: { operation_id: string; operation_type: string; piece_id: string | null; started_at: number; last_heartbeat_at: number }) =>
      `${r.operation_type}/${r.piece_id ?? 'no-piece'} (started ${new Date(r.started_at).toISOString()}, last heartbeat ${new Date(r.last_heartbeat_at).toISOString()})`,
    )
    .join('; ');

  const minutes = Math.round(maxAgeMs / 60000);
  await logEscalation(
    `Director watchdog tripped — ${stale.results.length} stale operation(s)`,
    `Director DO had ${stale.results.length} operation(s) running >${minutes} minutes without completion. Kill switch tripped — director_disabled=1. Resume by setting director_disabled=0 after investigating. Stale: ${summary}`,
  );

  return stale.results.length;
}

/**
 * Read SDK internal table sizes. Called from Director.onStart (after
 * DO restart) and selectively from Director.alarm() override.
 *
 * Note: must be called from INSIDE the Director DO — these tables live
 * in the DO's private SQLite storage, not the shared D1.
 *
 * @param sqlExec - the Agent's `this.sql` tagged template function
 */
export interface SdkStateSnapshot {
  scheduleRows: number;
  fiberRows: number;
  activeWorkflowRows: number;
}

export function snapshotSdkState(
  sqlExec: (strings: TemplateStringsArray, ...values: unknown[]) => Array<Record<string, unknown>>,
): SdkStateSnapshot {
  let scheduleRows = 0;
  let fiberRows = 0;
  let activeWorkflowRows = 0;

  try {
    const r1 = sqlExec`SELECT COUNT(*) as n FROM cf_agents_schedules`;
    scheduleRows = Number((r1[0] as { n?: number })?.n ?? 0);
  } catch { /* table may not exist yet on first start */ }

  try {
    const r2 = sqlExec`SELECT COUNT(*) as n FROM cf_agents_runs`;
    fiberRows = Number((r2[0] as { n?: number })?.n ?? 0);
  } catch { /* table may not exist */ }

  try {
    const r3 = sqlExec`SELECT COUNT(*) as n FROM cf_agents_workflows WHERE status NOT IN ('complete','errored','terminated')`;
    activeWorkflowRows = Number((r3[0] as { n?: number })?.n ?? 0);
  } catch { /* table may not exist */ }

  return { scheduleRows, fiberRows, activeWorkflowRows };
}
