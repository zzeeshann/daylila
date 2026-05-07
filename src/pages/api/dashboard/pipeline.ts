import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Pipeline monitor — returns step-by-step log for today's run(s).
 * No auth required (same as public dashboard data).
 * Admin page polls this every 5 seconds.
 *
 * Returns rows grouped per piece_id so the admin can render one
 * collapsible block per run at multi-per-day cadence. At 1/day the
 * result has one group.
 *
 * Optional ?pieceId= query narrows to a single piece. ?date=YYYY-MM-DD
 * overrides "today" (used by per-piece deep-dive pollers, unchanged).
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const db = locals.runtime.env.DB;
  const runId = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const pieceIdParam = url.searchParams.get('pieceId');
  const pieceIdFilter = pieceIdParam && /^[0-9a-f-]{32,40}$/i.test(pieceIdParam)
    ? pieceIdParam
    : null;

  try {
    const result = pieceIdFilter
      ? await db
          .prepare('SELECT step, status, data, created_at, piece_id FROM pipeline_log WHERE piece_id = ? ORDER BY created_at ASC')
          .bind(pieceIdFilter)
          .all<{ step: string; status: string; data: string; created_at: number; piece_id: string | null }>()
      : await db
          .prepare('SELECT step, status, data, created_at, piece_id FROM pipeline_log WHERE run_date = ? ORDER BY created_at ASC')
          .bind(runId)
          .all<{ step: string; status: string; data: string; created_at: number; piece_id: string | null }>();

    const steps = result.results.map((row) => ({
      step: row.step,
      status: row.status,
      data: row.data ? JSON.parse(row.data) : {},
      time: row.created_at,
      pieceId: row.piece_id,
    }));

    // Group by piece_id — preserves insertion order across groups via the
    // first-seen timestamp. Rows with null piece_id (legacy pre-0018)
    // cluster under a synthetic 'legacy' bucket so they still surface.
    type Group = { pieceId: string | null; steps: typeof steps };
    const groupMap = new Map<string, Group>();
    const groupOrder: string[] = [];
    for (const s of steps) {
      const key = s.pieceId ?? 'legacy';
      if (!groupMap.has(key)) {
        groupMap.set(key, { pieceId: s.pieceId, steps: [] });
        groupOrder.push(key);
      }
      groupMap.get(key)!.steps.push(s);
    }
    const groups = groupOrder.map((k) => groupMap.get(k)!);

    // Headline lookup for each non-null piece_id — one extra query, small
    // result set. Lets the admin show "piece X" labels on each collapsible
    // run block without waiting for a second fetch round-trip.
    const realPieceIds = groupOrder.filter((k) => k !== 'legacy');
    const headlines: Record<string, { headline: string; published_at: number | null }> = {};
    if (realPieceIds.length > 0) {
      const placeholders = realPieceIds.map(() => '?').join(',');
      const headRes = await db
        .prepare(`SELECT id, headline, published_at FROM daily_pieces WHERE id IN (${placeholders})`)
        .bind(...realPieceIds)
        .all<{ id: string; headline: string; published_at: number | null }>();
      for (const r of headRes.results) {
        headlines[r.id] = { headline: r.headline, published_at: r.published_at };
      }
    }

    // Is the pipeline still running? Checks the LAST step across ALL groups
    // — covers both 1/day and multi-per-day (poller only cares whether
    // SOMETHING is mid-flight).
    const lastStep = steps[steps.length - 1];
    const isRunning = !!lastStep && !['done', 'error', 'skipped'].includes(lastStep.step);

    return new Response(JSON.stringify({ runId, steps, groups, headlines, isRunning }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ runId, steps: [], groups: [], headlines: {}, isRunning: false }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
