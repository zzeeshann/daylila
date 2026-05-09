import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Track engagement events (view, beat completion, drop-off).
 * Called from the lesson-shell Web Component as readers navigate.
 * Aggregates per-piece per-day (PK: piece_id, course_id, date — see
 * migration 0017).
 *
 * `piece_id` came in Phase 7 engagement wiring (2026-04-22). The
 * migration + rehype-beats change guarantee every daily-piece HTML
 * bundle now carries `data-piece-id` on `<lesson-shell>`. The endpoint
 * still accepts requests missing piece_id as a defensive fallback —
 * if a stale HTML page were cached somewhere, or a future content type
 * is added without piece_id, the fallback derives piece_id from the
 * lesson_id by looking up the latest piece on that date (unambiguous
 * at interval_hours=24; arbitrary at multi-per-day).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;

  let body: {
    course_id?: unknown;
    lesson_id?: unknown;
    piece_id?: unknown;
    event_type?: unknown;
    beat?: unknown;
  };
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const course_id = typeof body.course_id === 'string' ? body.course_id : null;
  const lesson_id = typeof body.lesson_id === 'string' ? body.lesson_id : null;
  const event_type = typeof body.event_type === 'string' ? body.event_type : null;
  const beat = typeof body.beat === 'string' ? body.beat : null;
  let piece_id = typeof body.piece_id === 'string' && body.piece_id.length > 0 ? body.piece_id : null;

  if (!course_id || !lesson_id || !event_type) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // Fallback: resolve piece_id from lesson_id (= piece_date) when the
    // client didn't provide it. At multi-per-day this picks an arbitrary
    // same-date piece — the engagement row lands under that piece's id,
    // not necessarily the one the reader was actually on. Acceptable
    // degradation for the stale-bundle edge case only; new bundles
    // always send piece_id.
    if (!piece_id && course_id === 'daily') {
      const row = await db
        .prepare('SELECT id FROM daily_pieces WHERE date = ? ORDER BY published_at DESC LIMIT 1')
        .bind(lesson_id)
        .first<{ id: string }>();
      piece_id = row?.id ?? null;
    }

    // Without a piece_id, the row can't satisfy the NOT NULL PK. Silent
    // skip — engagement tracking is advisory, never blocks the reader.
    if (!piece_id) {
      return new Response(JSON.stringify({ status: 'skipped-no-piece-id' }), { status: 200 });
    }

    if (event_type === 'view') {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, views)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET views = views + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    } else if (event_type === 'complete') {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, completions)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET completions = completions + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    } else if (event_type === 'drop_off' && beat) {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, drop_off_beat)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET drop_off_beat = ?`,
        )
        .bind(piece_id, lesson_id, course_id, today, beat, beat)
        .run();
    } else if (event_type === 'audio_play') {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, audio_plays)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET audio_plays = audio_plays + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    } else if (event_type === 'widget_reveal_opened') {
      // PR #3 (2026-05-09) — in-beat widget engagement signals. Counter
      // columns added migration 0043. Same per-piece-per-day shape as
      // views / completions / audio_plays. Phase 2 (FOLLOWUPS [deferred]
      // 2026-05-09) reads these into Learner.
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, widget_reveal_opens)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET widget_reveal_opens = widget_reveal_opens + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    } else if (event_type === 'widget_compare_viewed') {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, widget_compare_views)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET widget_compare_views = widget_compare_views + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    } else if (event_type === 'widget_callout_seen') {
      await db
        .prepare(
          `INSERT INTO engagement (piece_id, lesson_id, course_id, date, widget_callouts_seen)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT (piece_id, course_id, date)
           DO UPDATE SET widget_callouts_seen = widget_callouts_seen + 1`,
        )
        .bind(piece_id, lesson_id, course_id, today)
        .run();
    }
  } catch {
    // Engagement tracking should never break the reader experience
  }

  return new Response(JSON.stringify({ status: 'tracked' }), { status: 200 });
};
