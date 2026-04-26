import type { APIRoute } from 'astro';
import { getUser } from '../../../../lib/db';
import { logObserverEvent } from '../../../../lib/observer-events';
import { ALLOWED_INTERVAL_HOURS } from '../../../../lib/cadence';

export const prerender = false;

/**
 * admin_settings read/write API.
 *
 * Primary consumer: the admin settings page at
 * `src/pages/dashboard/admin/settings.astro`. Currently handles two
 * keys; new keys plug in via the dispatch in POST.
 *
 *   - `interval_hours` — multi-piece cadence. Allowed set is the
 *     site-side mirror of the agents-worker helper at
 *     `agents/src/shared/admin-settings.ts`. The two workers don't
 *     share imports (separate packages). Both must be updated together
 *     if the allowed-set ever changes. Defensive layers preserve this:
 *     POST here rejects out-of-set values (400); Director's
 *     parseIntervalHours on the agents side falls back to 24 for
 *     out-of-set values, so a drift still fails safe.
 *
 *   - `interactives_html_enabled` — Interactives v3 Phase 2 HTML
 *     interactive flag. String `'true' | 'false'` in storage; boolean
 *     on the wire. The agents-worker reader at
 *     `agents/src/interactive-generator.ts` parses with `=== 'true'`
 *     so any non-'true' value (missing row, malformed, `'false'`)
 *     fails closed to disabled. POST here writes the canonical
 *     `'true'` / `'false'` string; rejects anything that isn't a
 *     boolean (400).
 */

type AdminSettingsRow = { key: string; value: string; updated_at: number };

/**
 * GET — returns current values + allowed set. Admin-gated.
 *
 * Reads both `interval_hours` and `interactives_html_enabled` in one
 * SELECT. Either row missing → falls back to default (24 / false).
 */
export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const rows = await db
      .prepare('SELECT key, value, updated_at FROM admin_settings WHERE key IN (?, ?)')
      .bind('interval_hours', 'interactives_html_enabled')
      .all<AdminSettingsRow>();

    const byKey = new Map<string, AdminSettingsRow>();
    for (const r of rows.results ?? []) byKey.set(r.key, r);

    const intervalRow = byKey.get('interval_hours');
    const intervalHoursParsed = intervalRow ? parseInt(intervalRow.value, 10) : 24;
    const intervalHours = Number.isFinite(intervalHoursParsed) ? intervalHoursParsed : 24;

    const htmlRow = byKey.get('interactives_html_enabled');
    const htmlEnabled = htmlRow?.value === 'true';

    return new Response(JSON.stringify({
      interval_hours: intervalHours,
      updated_at: intervalRow?.updated_at ?? null,
      allowed_intervals: ALLOWED_INTERVAL_HOURS,
      interactives_html_enabled: htmlEnabled,
      interactives_html_enabled_updated_at: htmlRow?.updated_at ?? null,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

/**
 * POST — updates one admin_settings key per request. Admin-gated.
 *
 * Dispatches on body shape:
 *   - `{ interval_hours: number }` → cadence path
 *   - `{ interactives_html_enabled: boolean }` → flag path
 *
 * Either path validates input, writes the row, fires an
 * `admin_settings_changed` observer event with before/after values.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { interval_hours?: unknown; interactives_html_enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if ('interval_hours' in body) {
    const raw = body.interval_hours;
    const candidate = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    if (!(ALLOWED_INTERVAL_HOURS as readonly number[]).includes(candidate)) {
      return new Response(JSON.stringify({
        error: `interval_hours must be one of ${ALLOWED_INTERVAL_HOURS.join(', ')}`,
      }), { status: 400 });
    }
    return writeSetting(db, 'interval_hours', String(candidate), user.email, {
      noteSuffix: 'Effective: next hourly cron alarm (up to 1h from now).',
      responseExtra: { interval_hours: candidate },
    });
  }

  if ('interactives_html_enabled' in body) {
    const raw = body.interactives_html_enabled;
    if (typeof raw !== 'boolean') {
      return new Response(JSON.stringify({
        error: 'interactives_html_enabled must be a boolean',
      }), { status: 400 });
    }
    return writeSetting(db, 'interactives_html_enabled', raw ? 'true' : 'false', user.email, {
      noteSuffix: 'Effective: next post-publish InteractiveGenerator alarm (next published piece).',
      responseExtra: { interactives_html_enabled: raw },
    });
  }

  return new Response(JSON.stringify({
    error: 'Body must include exactly one of: interval_hours, interactives_html_enabled',
  }), { status: 400 });
};

/**
 * Shared write path — UPSERT the row, fire observer event, return JSON.
 * Both POST branches use this so audit-trail shape stays uniform.
 */
async function writeSetting(
  db: D1Database,
  key: string,
  value: string,
  changedBy: string,
  opts: { noteSuffix: string; responseExtra: Record<string, unknown> },
): Promise<Response> {
  const prior = await db
    .prepare('SELECT value FROM admin_settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  const priorValue = prior?.value ?? null;

  const now = Date.now();
  try {
    await db
      .prepare(`
        INSERT INTO admin_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .bind(key, value, now)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DB write failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }

  // Audit trail. Fire-and-forget per observer-events helper contract.
  await logObserverEvent(db, {
    severity: 'info',
    title: `Admin settings: ${key} ${priorValue ?? 'null'} → ${value}`,
    body:
      `${key} changed by ${changedBy}.\n` +
      `Previous value: ${priorValue ?? 'null'}\n` +
      `New value: ${value}\n` +
      opts.noteSuffix,
    context: {
      type: 'admin_settings_changed',
      key,
      prior: priorValue,
      next: value,
      changedBy,
      changedAt: now,
    },
  });

  return new Response(JSON.stringify({
    ok: true,
    ...opts.responseExtra,
    updated_at: now,
  }), { headers: { 'Content-Type': 'application/json' } });
}
