import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Director kill switch + threshold control — ADMIN ONLY.
 *
 * Two actions, both via POST body:
 *
 *   { action: 'set-disabled', value: true|false }
 *     Toggles admin_settings.director_disabled. The Director DO reads
 *     this on every alarm callback + every public method and exits
 *     early when set. Operator can flip via this endpoint (admin UI
 *     button) or directly via `wrangler d1 execute "UPDATE
 *     admin_settings SET value='1' WHERE key='director_disabled';"`.
 *
 *   { action: 'set-max-minutes', value: <integer 5..240> }
 *     Updates admin_settings.director_max_operation_minutes. The
 *     watchdog cron at HH:30 reads this and trips the kill switch on
 *     any operation older than the threshold. Default 15 minutes.
 *
 * See docs/CAP-INCIDENT-2026-05-17.md for the full prevention story.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body: { action?: string; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const now = Date.now();

  if (body.action === 'set-disabled') {
    if (typeof body.value !== 'boolean') {
      return new Response(JSON.stringify({ error: 'value must be boolean' }), { status: 400 });
    }
    try {
      await db
        .prepare(
          `INSERT INTO admin_settings(key, value, updated_at)
           VALUES('director_disabled', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .bind(body.value ? '1' : '0', now)
        .run();
      return new Response(JSON.stringify({ ok: true, director_disabled: body.value }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'D1 write failed' }),
        { status: 500 },
      );
    }
  }

  if (body.action === 'set-max-minutes') {
    const value = typeof body.value === 'number' ? Math.floor(body.value) : NaN;
    if (!Number.isFinite(value) || value < 5 || value > 240) {
      return new Response(
        JSON.stringify({ error: 'value must be integer between 5 and 240' }),
        { status: 400 },
      );
    }
    try {
      await db
        .prepare(
          `INSERT INTO admin_settings(key, value, updated_at)
           VALUES('director_max_operation_minutes', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .bind(String(value), now)
        .run();
      return new Response(JSON.stringify({ ok: true, director_max_operation_minutes: value }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : 'D1 write failed' }),
        { status: 500 },
      );
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};
