import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Track interactive engagement events (Area 4 sub-task 4.7).
 *
 * Writes append-only rows to the `interactive_engagement` table
 * (migration 0022). Not aggregated per day like the daily-piece
 * `engagement` table — per-question correctness arrays don't
 * aggregate cleanly and the natural shape is events (offered →
 * started → completed, or skipped). Aggregation happens at query
 * time via GROUP BY / DISTINCT.
 *
 * Callers:
 *   - `<quiz-card>` (src/interactive/quiz-card.ts) — fires
 *     `interactive_started` on mount, `interactive_completed` with
 *     score + per_question_correctness on results.
 *   - `<interactive-frame>` (src/interactive/interactive-frame.ts) —
 *     fires `interactive_started` on mount + `interactive_viewed` once
 *     per session when the iframe scrolls ≥50% into view (Phase 4.1).
 *   - `<lesson-shell>` (src/interactive/lesson-shell.ts) — fires
 *     `interactive_offered` once per session when the last beat of
 *     a piece with a passing interactive becomes active.
 *   - `interactive_skipped` is accepted as a valid event type but no
 *     current client sends it; the "skipped" semantic is typically
 *     inferred at query time (`offered AND NOT started`). Leaving the
 *     endpoint accept it lets a future explicit-dismiss UI ship
 *     without an endpoint change.
 *
 * Request body shape (matches all three callers):
 *   {
 *     "interactive_id": "<uuid>" | null,
 *     "interactive_slug": "<kebab-slug>" | undefined,
 *     "event_type": "interactive_offered" | "interactive_started"
 *                 | "interactive_viewed"  | "interactive_completed"
 *                 | "interactive_skipped",
 *     "score": number | undefined,                 // completed only
 *     "per_question_correctness": number[] | undefined  // completed only
 *   }
 *
 * Either `interactive_id` (UUID) or `interactive_slug` must be
 * provided. The prefix `interactive_` on event_type is stripped
 * before write — stored values are the short forms 'offered' |
 * 'started' | 'viewed' | 'completed' | 'skipped'.
 *
 * user_id comes from middleware (locals.userId), which is always
 * populated — anonymous readers get a generated UUID and a session
 * cookie on first visit.
 *
 * Engagement tracking never breaks the reader: all DB errors are
 * silently swallowed and the endpoint returns 200 regardless.
 */

const VALID_EVENT_TYPES = new Set(['offered', 'started', 'viewed', 'completed', 'skipped']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

/** Strip the redundant `interactive_` prefix the client sends. Both
 *  forms are accepted; stored form is the short one. */
function normaliseEventType(raw: string): string | null {
  const short = raw.startsWith('interactive_') ? raw.slice('interactive_'.length) : raw;
  return VALID_EVENT_TYPES.has(short) ? short : null;
}

/** Validate per-question correctness: array of integers 0 or 1, length
 *  within the quiz question bounds [2, 6] per the 4.1 schema / 4.3
 *  Web Component shape. Rejects malformed payloads but doesn't error
 *  — the parent handler silently skips the correctness field if
 *  invalid and still writes the row. */
function validateCorrectness(x: unknown): number[] | null {
  if (!Array.isArray(x)) return null;
  if (x.length < 1 || x.length > 10) return null; // generous bounds
  const out: number[] = [];
  for (const v of x) {
    if (v === 0 || v === 1) out.push(v);
    else return null;
  }
  return out;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  // Middleware guarantees userId is populated. If it's somehow not,
  // drop the event — engagement rows need a user_id (NOT NULL column).
  if (!userId) {
    return new Response(JSON.stringify({ status: 'skipped-no-user' }), { status: 200 });
  }

  let body: {
    interactive_id?: unknown;
    interactive_slug?: unknown;
    event_type?: unknown;
    score?: unknown;
    per_question_correctness?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const rawEventType = typeof body.event_type === 'string' ? body.event_type : '';
  const eventType = normaliseEventType(rawEventType);
  if (!eventType) {
    return new Response(
      JSON.stringify({ error: 'event_type must be one of offered, started, viewed, completed, skipped' }),
      { status: 400 },
    );
  }

  const providedId =
    typeof body.interactive_id === 'string' && UUID_RE.test(body.interactive_id)
      ? body.interactive_id
      : null;
  const providedSlug =
    typeof body.interactive_slug === 'string' && SLUG_RE.test(body.interactive_slug)
      ? body.interactive_slug
      : null;

  if (!providedId && !providedSlug) {
    return new Response(
      JSON.stringify({ error: 'Either interactive_id (UUID) or interactive_slug (kebab-case) required' }),
      { status: 400 },
    );
  }

  // Resolve to a concrete interactive_id — must exist in the table.
  // If lookup misses, silent-skip (don't 400 the client; an orphan
  // event is a tracking gap, not a user-facing error).
  let interactiveId: string | null = providedId;
  try {
    if (!interactiveId && providedSlug) {
      const row = await db
        .prepare('SELECT id FROM interactives WHERE slug = ? LIMIT 1')
        .bind(providedSlug)
        .first<{ id: string }>();
      interactiveId = row?.id ?? null;
    } else if (interactiveId) {
      // Sanity-check the provided UUID exists. Guards against
      // stale HTML bundles carrying a removed interactive's id.
      const hit = await db
        .prepare('SELECT 1 FROM interactives WHERE id = ? LIMIT 1')
        .bind(interactiveId)
        .first<{ 1: number }>();
      if (!hit) interactiveId = null;
    }
  } catch {
    interactiveId = null;
  }

  if (!interactiveId) {
    return new Response(JSON.stringify({ status: 'skipped-no-interactive' }), { status: 200 });
  }

  // Optional completed-only fields
  const score =
    eventType === 'completed' && typeof body.score === 'number' && Number.isInteger(body.score) && body.score >= 0
      ? body.score
      : null;
  const correctness =
    eventType === 'completed' ? validateCorrectness(body.per_question_correctness) : null;

  try {
    await db
      .prepare(
        `INSERT INTO interactive_engagement
         (id, user_id, interactive_id, event_type, score, per_question_correctness, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        interactiveId,
        eventType,
        score,
        correctness ? JSON.stringify(correctness) : null,
        Date.now(),
      )
      .run();
  } catch {
    // Engagement tracking never blocks the reader experience.
    return new Response(JSON.stringify({ status: 'db-error' }), { status: 200 });
  }

  return new Response(JSON.stringify({ status: 'tracked', event_type: eventType }), {
    status: 200,
  });
};
