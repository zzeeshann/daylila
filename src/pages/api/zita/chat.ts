import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rate-limit';
import { logObserverEvent } from '../../../lib/observer-events';
import { ZITA_SYSTEM_PROMPT } from '../../../lib/zita-prompt';

// Soft cap on how many prior messages we load into each Claude call.
// 40 rows = 20 turns (user + assistant pairs) — enough for a coherent
// multi-turn session without unbounded cost growth. Data before the
// cap stays in D1 (permanence-of-record); we just don't send it to
// Claude. See DECISIONS 2026-04-21 "Cap Zita history load at 40".
const ZITA_HISTORY_LIMIT = 40;

// Max_tokens on the Claude call is 300, but a misconfigured model or
// cache weirdness could theoretically return longer output. Cap what
// we persist so a single row can't ever dominate the context budget
// or balloon D1 storage. 4000 is generous relative to the 300-token
// enforcement at the API level (≈1200 chars typical English).
// See DECISIONS 2026-04-21 "Zita safety smallest-viable pass".
const ZITA_STORED_CONTENT_CAP = 4000;
const ZITA_TRUNCATE_SUFFIX = '\n\n[…truncated]';

function capStoredContent(content: string): string {
  if (content.length <= ZITA_STORED_CONTENT_CAP) return content;
  return content.slice(0, ZITA_STORED_CONTENT_CAP - ZITA_TRUNCATE_SUFFIX.length) + ZITA_TRUNCATE_SUFFIX;
}

export const prerender = false;

// ZITA_SYSTEM_PROMPT moved to src/lib/zita-prompt.ts on 2026-05-10
// (LLM-surface-cleanup priority 6). The new module also injects the
// canonical voice contract so Zita stops drifting from the rules
// Drafter / Integrator / Voice Auditor enforce on the daily pieces.

/**
 * Zita chat endpoint — Socratic learning guide.
 * Maintains conversation history per user per lesson in D1.
 * Uses Claude API for responses.
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const db = locals.runtime.env.DB;
  const userId = locals.userId;

  // Rate limit: 20 messages per 15 min per user (Claude API costs money)
  const limit = await checkRateLimit(locals.runtime.env.RATE_LIMIT_KV, `zita:${userId}`, 20, 900);
  if (!limit.allowed) {
    await logObserverEvent(db, {
      severity: 'warn',
      title: 'Zita rate limit hit',
      body: `User ${userId} exceeded 20 messages / 15 minutes. This surfaces in the admin feed so abuse patterns or runaway clients become visible instead of silent.`,
      context: { type: 'zita_rate_limited', userId, limit: 20, windowSeconds: 900 },
    });
    return new Response(JSON.stringify({ error: 'Slow down — try again in a few minutes.' }), { status: 429 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }); }

  const { message, course_slug, lesson_number, piece_date, piece_id, lesson_title, lesson_context } = body;

  if (!message || !course_slug || lesson_number == null) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  }

  // piece_date required for daily pieces — see DECISIONS 2026-04-21.
  // Lessons-course path is still allowed with piece_date=null.
  if (course_slug === 'daily' && (typeof piece_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(piece_date))) {
    return new Response(JSON.stringify({ error: 'Missing or invalid piece_date' }), { status: 400 });
  }

  // piece_id is optional on the wire (legacy cached client bundles may
  // predate sub-task 3.2 threading). Validate UUID shape when present;
  // anything malformed is treated as absent so observer events fall
  // back to null-piece_id rather than bleeding a malformed value into
  // the column. Strict UUID regex — same shape agents-side emits via
  // crypto.randomUUID().
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const scopedPieceId: string | null = (typeof piece_id === 'string' && UUID_RE.test(piece_id)) ? piece_id : null;

  // Input validation: limit message length to prevent API cost abuse
  if (typeof message !== 'string' || message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Message too long (max 2000 characters)' }), { status: 400 });
  }

  // Scoped conversation history: for daily pieces, scope by piece_date so
  // one reader's history on piece X doesn't bleed into piece Y. For
  // legacy non-daily courses, piece_date is null and we match NULL.
  //
  // Soft cap: load most recent ZITA_HISTORY_LIMIT rows, reverse to
  // chronological order when building the messages array. Also fetch
  // the total so we can log a truncation observer_event when the cap
  // clips. Batched so it's one D1 round trip.
  const [countRes, history] = await db.batch<{ role?: string; content?: string; n?: number }>([
    db.prepare(
      'SELECT COUNT(*) as n FROM zita_messages WHERE user_id = ? AND course_slug = ? AND lesson_number = ? AND piece_date IS ?',
    ).bind(userId, course_slug, lesson_number, piece_date ?? null),
    db.prepare(
      'SELECT role, content FROM zita_messages WHERE user_id = ? AND course_slug = ? AND lesson_number = ? AND piece_date IS ? ORDER BY created_at DESC LIMIT ?',
    ).bind(userId, course_slug, lesson_number, piece_date ?? null, ZITA_HISTORY_LIMIT),
  ]);
  const totalCount = (countRes.results[0]?.n as number) ?? 0;
  const historyRows = (history.results as Array<{ role: string; content: string }>).slice().reverse();

  if (totalCount > ZITA_HISTORY_LIMIT) {
    // Fire-and-forget — make the soft cap visible in the admin Observer
    // feed instead of silent. Severity 'info' because this is expected
    // long-session behaviour, not a failure. Loaded count is capped at
    // the limit; clipped = total - limit.
    await logObserverEvent(db, {
      severity: 'info',
      title: `Zita history truncated at ${ZITA_HISTORY_LIMIT} for ${piece_date ?? 'non-daily'}`,
      body: `Clipped ${totalCount - ZITA_HISTORY_LIMIT} older messages from the Claude context for a ${totalCount}-message session. Full history remains in D1.`,
      context: {
        type: 'zita_history_truncated',
        userId,
        pieceDate: piece_date ?? null,
        courseSlug: course_slug,
        lessonNumber: lesson_number,
        totalCount,
        loadedCount: ZITA_HISTORY_LIMIT,
        clippedCount: totalCount - ZITA_HISTORY_LIMIT,
      },
      pieceId: scopedPieceId,
    });
  }

  // Build messages array for Claude
  const messages = [
    ...historyRows.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message },
  ];

  // Build system prompt with lesson context. Name the piece so Zita
  // knows which one the reader is on — half the reason Phase 1 exists.
  const pieceBanner = course_slug === 'daily' && piece_date
    ? `You are discussing the piece titled "${lesson_title ?? 'Untitled'}", published ${piece_date}.\n\n`
    : '';
  const systemPrompt = `${pieceBanner}${ZITA_SYSTEM_PROMPT}

## Current lesson context
Course: ${course_slug}
Lesson ${lesson_number}: ${lesson_title ?? 'Unknown'}
${lesson_context ? `\nWhat the reader has been learning:\n${lesson_context}` : ''}`;

  // Call Claude API
  const ANTHROPIC_API_KEY = (locals.runtime.env as Record<string, string>).ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'Zita is not configured yet' }), { status: 503 });
  }

  try {
    const callStart = Date.now();
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 300, // Short responses enforced at API level
        system: systemPrompt,
        messages,
      }),
    });
    const durationMs = Date.now() - callStart;

    if (!claudeResponse.ok) {
      // Read the error body for the observer context, but don't leak
      // it to the reader. Cap at 500 chars to avoid logging long
      // upstream payloads.
      let upstreamBody = '';
      try { upstreamBody = (await claudeResponse.text()).slice(0, 500); } catch { /* ignore */ }
      await logObserverEvent(db, {
        severity: 'warn',
        title: `Zita Claude call failed (HTTP ${claudeResponse.status})`,
        body: `Claude API returned a non-OK status for a Zita chat request. Reader saw a generic 503; this event captures the upstream status + body snippet for debugging.`,
        context: {
          type: 'zita_claude_error',
          httpStatus: claudeResponse.status,
          userId,
          pieceDate: piece_date ?? null,
          upstreamBody,
        },
        pieceId: scopedPieceId,
      });
      return new Response(JSON.stringify({ error: 'Zita is temporarily unavailable. Try again later.' }), { status: 503 });
    }

    const data = await claudeResponse.json() as {
      content: Array<{ type: string; text: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const reply = data.content[0]?.type === 'text' ? data.content[0].text : '';

    // Per-call usage telemetry (LLM-surface audit follow-up, 2026-05-10).
    // Mirrors agents-side observer.logLLMCall — same row shape so the
    // admin feed reads site-origin Zita calls alongside agent-origin
    // mainline calls. Fire-and-forget; never blocks the reply.
    const tokensIn = data.usage?.input_tokens ?? 0;
    const tokensOut = data.usage?.output_tokens ?? 0;
    await logObserverEvent(db, {
      severity: 'info',
      title: `LLM zita: ${lesson_title ?? 'Untitled'}`,
      body: `zita for "${lesson_title ?? 'Untitled'}" — tokens in=${tokensIn} out=${tokensOut}. Latency: ${durationMs}ms.`,
      context: {
        step: 'zita',
        tokensIn,
        tokensOut,
        durationMs,
        userId,
        pieceDate: piece_date ?? null,
        courseSlug: course_slug,
        lessonNumber: lesson_number,
      },
      pieceId: scopedPieceId,
    });

    // Cap what we persist so a single row can't dominate future context
    // or bloat D1. Input was already capped at 2000 above; assistant
    // side is normally ≈1200 chars but cap defensively at 4000.
    const storedUserMessage = capStoredContent(message);
    const storedReply = capStoredContent(reply);

    // Save both messages to history
    const now = Date.now();
    await db.batch([
      db.prepare(
        'INSERT INTO zita_messages (id, user_id, course_slug, lesson_number, piece_date, piece_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, course_slug, lesson_number, piece_date ?? null, scopedPieceId, 'user', storedUserMessage, now),
      db.prepare(
        'INSERT INTO zita_messages (id, user_id, course_slug, lesson_number, piece_date, piece_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), userId, course_slug, lesson_number, piece_date ?? null, scopedPieceId, 'assistant', storedReply, now + 1),
    ]);

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logObserverEvent(db, {
      severity: 'warn',
      title: 'Zita handler threw unexpectedly',
      body: `Unhandled exception in the /api/zita/chat handler. Reader saw a generic 500; this event captures the error message for debugging.`,
      context: {
        type: 'zita_handler_error',
        userId,
        pieceDate: piece_date ?? null,
        errorMessage: msg,
      },
      pieceId: scopedPieceId,
    });
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
