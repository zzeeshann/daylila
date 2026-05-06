import type { APIRoute } from 'astro';
import { logObserverEvent } from '../../../lib/observer-events';

export const prerender = false;

/**
 * Audio dwell-time signal (Foundation Fix Task 07, closes data leak L17).
 *
 * Called from <audio-player>'s flushDwell() choke point on five
 * end-of-flush boundaries: pause, ended, beat_change, heartbeat
 * (every 30s during continuous play), pagehide (sendBeacon path).
 *
 * Append-only — every call writes one row to audio_dwell_events.
 * NOT an UPSERT and NOT shared with the per-piece-per-day engagement
 * aggregate (see migration 0035 header for the schema fork rationale).
 *
 * Privacy posture: this handler MUST NOT read request.headers
 * (no cf-connecting-ip, no user-agent, no referrer). The row carries
 * the engagement signal and nothing else.
 *
 * Failure posture: fail-open. On D1 throw, write a single
 * observer_events row and still return 204. The frontend has
 * fired-and-forgotten by the time the response comes back; it cannot
 * distinguish success from caught-failure, by design.
 */

const ALLOWED_REASONS = new Set([
  'pause',
  'ended',
  'beat_change',
  'heartbeat',
  'pagehide',
]);

const MAX_DWELL_SECONDS = 3600;
const MAX_RATIO = 1.5;
const MAX_ID_LENGTH = 64;

export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  let body: {
    piece_id?: unknown;
    beat_name?: unknown;
    dwell_seconds?: unknown;
    ratio?: unknown;
    ended_reason?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }

  const piece_id =
    typeof body.piece_id === 'string' &&
    body.piece_id.length > 0 &&
    body.piece_id.length <= MAX_ID_LENGTH
      ? body.piece_id
      : null;
  if (!piece_id) {
    return new Response(JSON.stringify({ error: 'invalid_piece_id' }), { status: 400 });
  }

  const beat_name =
    typeof body.beat_name === 'string' &&
    body.beat_name.length > 0 &&
    body.beat_name.length <= MAX_ID_LENGTH
      ? body.beat_name
      : null;
  if (!beat_name) {
    return new Response(JSON.stringify({ error: 'invalid_beat_name' }), { status: 400 });
  }

  const dwell_seconds =
    typeof body.dwell_seconds === 'number' &&
    Number.isFinite(body.dwell_seconds) &&
    body.dwell_seconds >= 0 &&
    body.dwell_seconds <= MAX_DWELL_SECONDS
      ? body.dwell_seconds
      : null;
  if (dwell_seconds === null) {
    return new Response(JSON.stringify({ error: 'invalid_dwell_seconds' }), { status: 400 });
  }

  let ratio: number | null;
  if (body.ratio === null || body.ratio === undefined) {
    ratio = null;
  } else if (
    typeof body.ratio === 'number' &&
    Number.isFinite(body.ratio) &&
    body.ratio >= 0 &&
    body.ratio <= MAX_RATIO
  ) {
    ratio = body.ratio;
  } else {
    return new Response(JSON.stringify({ error: 'invalid_ratio' }), { status: 400 });
  }

  const ended_reason =
    typeof body.ended_reason === 'string' && ALLOWED_REASONS.has(body.ended_reason)
      ? body.ended_reason
      : null;
  if (!ended_reason) {
    return new Response(JSON.stringify({ error: 'invalid_ended_reason' }), { status: 400 });
  }

  try {
    await db
      .prepare(
        `INSERT INTO audio_dwell_events
           (user_id, piece_id, beat_name, dwell_seconds, ratio, ended_reason, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(userId, piece_id, beat_name, dwell_seconds, ratio, ended_reason, Date.now())
      .run();
  } catch (err) {
    await logObserverEvent(db, {
      severity: 'warn',
      title: 'audio dwell persist error',
      body: err instanceof Error ? err.message : String(err),
      context: { piece_id, beat_name, ended_reason },
      pieceId: piece_id,
    });
  }

  return new Response(null, { status: 204 });
};
