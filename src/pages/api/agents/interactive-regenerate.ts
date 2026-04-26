import type { APIRoute } from 'astro';
import { getUser } from '../../../lib/db';

export const prerender = false;

/**
 * Proxy endpoint — admin "Regenerate" button on the per-row UI of the
 * `/dashboard/admin/interactives/` list view (Phase 3 sub-task 3.3 of
 * Interactives v3). ADMIN_EMAIL gated. Forwards to the agents worker's
 * `/interactive-regenerate-trigger` which wipes the existing
 * `interactives` row + audit rows + git file for the (piece, type)
 * pair, fires the operator-attributed observer event, then schedules
 * a fresh produce → audit → revise loop.
 *
 * Destructive — distinct from the existing `/api/agents/interactive-retry`
 * (which is idempotent and only runs when no interactive exists yet).
 *
 * Query params:
 *   - piece_id=<uuid>      required
 *   - type=quiz | html     required
 *
 * `changed_by` on the agents-worker side is sourced from the admin's
 * verified email (server-known), not from a query param the operator
 * can spoof.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const ADMIN_EMAIL = (locals.runtime.env as Record<string, string>).ADMIN_EMAIL;

  const user = userId ? await getUser(db, userId) : null;
  if (!user?.email || user.email !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(request.url);
  const pieceId = url.searchParams.get('piece_id') ?? '';
  const type = url.searchParams.get('type') ?? '';

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid piece_id (UUID)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (type !== 'quiz' && type !== 'html') {
    return new Response(JSON.stringify({ error: "type must be 'quiz' or 'html'" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ADMIN_SECRET = (locals.runtime.env as Record<string, string>).AGENTS_ADMIN_SECRET ?? '';
  const AGENTS = (locals.runtime.env as unknown as { AGENTS: { fetch: typeof fetch } }).AGENTS;

  const qs = new URLSearchParams({
    piece_id: pieceId,
    type,
    changed_by: user.email,
  });
  const res = await AGENTS.fetch(`https://agents/interactive-regenerate-trigger?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}` },
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
