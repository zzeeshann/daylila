import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Per-user-per-piece reading record. Called from <lesson-shell> on
 * three events: view (mount), beat (per-beat IntersectionObserver),
 * complete (footer reached). Writes to user_piece_reads.
 *
 * Anonymous + signed-in both write here — middleware always populates
 * locals.userId.
 *
 * All three events upsert defensively (events can arrive out of order
 * or with view missing if the page was hydrated late). started_at is
 * preserved across upserts so the "Started" date in /account/ Resume
 * stays anchored to the first observation.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  let body: { piece_id?: unknown; event?: unknown; beat?: unknown };
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const piece_id = typeof body.piece_id === 'string' && body.piece_id.length > 0 ? body.piece_id : null;
  const event = typeof body.event === 'string' ? body.event : null;
  const beat = typeof body.beat === 'string' && body.beat.length > 0 ? body.beat : null;

  if (!piece_id || !event) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const now = Date.now();

  try {
    if (event === 'view') {
      await db
        .prepare(
          `INSERT INTO user_piece_reads (user_id, piece_id, started_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, piece_id)
           DO UPDATE SET last_seen_at = ?`,
        )
        .bind(userId, piece_id, now, now, now)
        .run();
    } else if (event === 'beat' && beat) {
      await db
        .prepare(
          `INSERT INTO user_piece_reads (user_id, piece_id, started_at, last_seen_at, current_beat)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, piece_id)
           DO UPDATE SET current_beat = ?, last_seen_at = ?`,
        )
        .bind(userId, piece_id, now, now, beat, beat, now)
        .run();
    } else if (event === 'complete') {
      await db
        .prepare(
          `INSERT INTO user_piece_reads (user_id, piece_id, started_at, last_seen_at, completed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, piece_id)
           DO UPDATE SET completed_at = ?, last_seen_at = ?, current_beat = NULL`,
        )
        .bind(userId, piece_id, now, now, now, now, now)
        .run();
    } else {
      return new Response(JSON.stringify({ error: 'Unknown event' }), { status: 400 });
    }
  } catch {
    // Per-piece tracking is advisory; never block the reader.
  }

  return new Response(JSON.stringify({ status: 'tracked' }), { status: 200 });
};
