import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * GET /api/saved/toggle?piece_id=… returns { saved: boolean } for the
 * current user without mutating. Used by piece pages on hydration to
 * set the initial Save/Saved label since the HTML is prerendered and
 * can't bake per-user state.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;
  const piece_id = url.searchParams.get('piece_id');
  if (!piece_id) {
    return new Response(JSON.stringify({ error: 'Missing piece_id' }), { status: 400 });
  }
  const row = await db
    .prepare('SELECT 1 FROM saved_pieces WHERE user_id = ? AND piece_id = ?')
    .bind(userId, piece_id)
    .first();
  return new Response(JSON.stringify({ saved: !!row }), { status: 200 });
};

/**
 * Toggle a saved-piece row for the current user. POST { piece_id }.
 * Returns { saved: boolean } reflecting the new state.
 *
 * Anonymous + signed-in both write here — middleware always populates
 * locals.userId.
 *
 * Idempotent under the composite PK: existence check + DELETE / INSERT.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  let body: { piece_id?: unknown };
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const piece_id = typeof body.piece_id === 'string' && body.piece_id.length > 0 ? body.piece_id : null;
  if (!piece_id) {
    return new Response(JSON.stringify({ error: 'Missing piece_id' }), { status: 400 });
  }

  const existing = await db
    .prepare('SELECT 1 FROM saved_pieces WHERE user_id = ? AND piece_id = ?')
    .bind(userId, piece_id)
    .first();

  if (existing) {
    await db
      .prepare('DELETE FROM saved_pieces WHERE user_id = ? AND piece_id = ?')
      .bind(userId, piece_id)
      .run();
    return new Response(JSON.stringify({ saved: false }), { status: 200 });
  }

  await db
    .prepare('INSERT INTO saved_pieces (user_id, piece_id, created_at) VALUES (?, ?, ?)')
    .bind(userId, piece_id, Date.now())
    .run();
  return new Response(JSON.stringify({ saved: true }), { status: 200 });
};
