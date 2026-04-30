import { routeAgentRequest } from 'agents';
import { getAgentByName } from 'agents';
import type { Env } from './types';
import { DirectorAgent } from './director';
import { ObserverAgent } from './observer';
import { LearnerAgent } from './learner';

// Re-export for Durable Object bindings
export { DirectorAgent };
export { VoiceAuditorAgent } from './voice-auditor';
export { StructureEditorAgent } from './structure-editor';
export { FactCheckerAgent } from './fact-checker';
export { IntegratorAgent } from './integrator';
export { PublisherAgent } from './publisher';
export { ObserverAgent } from './observer';
// EngagementAnalyst merged into LearnerAgent
export { LearnerAgent } from './learner';
export { AudioProducerAgent } from './audio-producer';
export { AudioAuditorAgent } from './audio-auditor';
export { ScannerAgent } from './scanner';
export { CuratorAgent } from './curator';
export { DrafterAgent } from './drafter';
export { CategoriserAgent } from './categoriser';
export { InteractiveGeneratorAgent } from './interactive-generator';
export { InteractiveAuditorAgent } from './interactive-auditor';
// Course workflow removed — daily pieces only

/** Check admin auth — bearer token only (no query params — they leak in logs) */
function checkAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === env.ADMIN_SECRET;
  }
  return false;
}

/** Allowed origins for CORS */
const ALLOWED_ORIGINS = [
  'https://zeemish-v2.zzeeshann.workers.dev',
  'https://zeemish.io',
  'https://www.zeemish.io',
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Content-Type': 'application/json',
  };
}

/**
 * Entry point for the zeemish-agents Worker.
 *
 * Routes:
 * - POST /daily-trigger — produce today's daily piece
 * - GET /status — get Director status
 * - /agents/* — Agent SDK routing (WebSocket, RPC)
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Admin endpoints require auth
    const adminPaths = ['/daily-trigger', '/audio-retry', '/zita-synthesis-trigger', '/categorise-trigger', '/interactive-generate-trigger', '/interactive-regenerate-trigger', '/status', '/digest', '/events', '/engagement'];
    if (adminPaths.some((p) => url.pathname === p) && !checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status: GET /status
    if (url.pathname === '/status' && request.method === 'GET') {
      try {
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const state = await director.getStatus();
        return new Response(JSON.stringify(state), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // Dashboard digest: GET /digest
    if (url.pathname === '/digest' && request.method === 'GET') {
      try {
        const observer = await getAgentByName<ObserverAgent>(env.OBSERVER, 'observer');
        const digest = await observer.getDailyDigest();
        return new Response(JSON.stringify(digest), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Recent events: GET /events?limit=20
    if (url.pathname === '/events' && request.method === 'GET') {
      try {
        const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
        const observer = await getAgentByName<ObserverAgent>(env.OBSERVER, 'observer');
        const events = await observer.getRecentEvents(limit);
        return new Response(JSON.stringify({ events }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Engagement report: GET /engagement?course=body
    if (url.pathname === '/engagement' && request.method === 'GET') {
      const courseId = url.searchParams.get('course') ?? 'daily';
      try {
        const analyst = await getAgentByName<LearnerAgent>(env.LEARNER, 'learner');
        const report = await analyst.analyse(courseId);
        return new Response(JSON.stringify(report), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Daily piece trigger: POST /daily-trigger (requires auth)
    //
    // Acknowledge-and-run: the full pipeline takes minutes (Scanner → Curator
    // → Drafter → 1-3 audit rounds → Publisher), far longer than a reasonable
    // HTTP request. We return 202 Accepted immediately with the run id and
    // hand the work off via ctx.waitUntil so the isolate stays alive until
    // it completes. Caller (admin dashboard, curl, reset-today script) polls
    // /api/dashboard/pipeline or /status for progress.
    if (url.pathname === '/daily-trigger' && request.method === 'POST') {
      try {
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const runId = new Date().toISOString().slice(0, 10);
        // Manual admin trigger bypasses the "already published today" guard.
        // ADMIN_SECRET auth above is the control — if you got here, you meant it.
        ctx.waitUntil(
          director.triggerDailyPiece(true).catch((err) => {
            // Swallowing here is intentional: Director logs errors via
            // Observer + pipeline_log already. waitUntil unhandled rejections
            // would just surface as Cloudflare runtime noise.
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[daily-trigger] background run failed for ${runId}:`, message);
          }),
        );
        return new Response(JSON.stringify({ status: 'started', runId }), {
          status: 202,
          headers: corsHeaders(request),
        });
      } catch (err) {
        // Only synchronous failures (e.g. DO stub creation) reach here.
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // Audio retry: POST /audio-retry?(piece_id=<uuid>|date=YYYY-MM-DD)&mode=continue|fresh|beat&beat=<beat-name>
    // Re-runs the audio pipeline for an already-published piece after
    // an earlier audio failure OR for a post-publish refresh (e.g.
    // after a normaliser change). Text is already permanent — this
    // call cannot un-publish or revise the piece's prose.
    //
    // Piece identification: prefer `piece_id` (unambiguous at multi-per-day).
    // `date` fallback picks the latest published piece for that date.
    //
    // Modes:
    //   - continue (default): R2 head-check skips already-generated beats,
    //     fills in missing ones. Safe, cheap, resumes where prior attempt
    //     left off. Guarded: no-op when has_audio=1.
    //   - fresh: deletes existing R2 clips + D1 rows + has_audio flag
    //     first, then regenerates every beat from scratch. Used when
    //     existing audio is bad.
    //   - beat: deletes one R2 clip + one D1 row (piece_id + beat_name),
    //     leaves has_audio=1, then runs the pipeline with force=true so
    //     the producer's head-check regenerates only the removed beat.
    //     Used for surgical fixes (e.g. Roman-numeral pronunciation).
    if (url.pathname === '/audio-retry' && request.method === 'POST') {
      try {
        const mode = (() => {
          const raw = url.searchParams.get('mode');
          return raw === 'fresh' || raw === 'beat' ? raw : 'continue';
        })();

        // Resolve pieceId — accept either explicit piece_id or date lookup.
        let pieceId = url.searchParams.get('piece_id') ?? '';
        let date = url.searchParams.get('date') ?? '';
        if (pieceId) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
            return new Response(JSON.stringify({ error: 'Invalid piece_id (expected UUID)' }), {
              status: 400, headers: corsHeaders(request),
            });
          }
          // Backfill date from D1 for the response payload.
          const row = await env.DB
            .prepare('SELECT date FROM daily_pieces WHERE id = ? LIMIT 1')
            .bind(pieceId)
            .first<{ date: string }>();
          if (!row) {
            return new Response(JSON.stringify({ error: `No piece with id ${pieceId}` }), {
              status: 404, headers: corsHeaders(request),
            });
          }
          date = row.date;
        } else {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return new Response(JSON.stringify({ error: 'Missing or invalid piece_id or date' }), {
              status: 400, headers: corsHeaders(request),
            });
          }
          // At interval_hours=24 there's exactly one piece per date;
          // at multi-per-day we pick the latest via ORDER BY published_at
          // DESC to match the "retry the most recent" intent.
          const pieceRow = await env.DB
            .prepare('SELECT id FROM daily_pieces WHERE date = ? ORDER BY published_at DESC LIMIT 1')
            .bind(date)
            .first<{ id: string }>();
          if (!pieceRow?.id) {
            return new Response(JSON.stringify({ error: `No piece published on ${date}` }), {
              status: 404, headers: corsHeaders(request),
            });
          }
          pieceId = pieceRow.id;
        }

        // mode=beat requires a beat name. Validate shape here so the
        // director method only sees trusted input.
        let beatName: string | null = null;
        if (mode === 'beat') {
          beatName = url.searchParams.get('beat') ?? '';
          if (!/^[a-z0-9-]+$/.test(beatName)) {
            return new Response(JSON.stringify({ error: 'mode=beat requires &beat=<kebab-case-name>' }), {
              status: 400, headers: corsHeaders(request),
            });
          }
        }

        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const run = mode === 'fresh'
          ? director.retryAudioFresh(pieceId)
          : mode === 'beat'
            ? director.retryAudioBeat(pieceId, beatName!)
            : director.retryAudio(pieceId);
        ctx.waitUntil(
          run.catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[audio-retry:${mode}] failed for piece ${pieceId} (${date}):`, message);
          }),
        );
        return new Response(JSON.stringify({ status: 'started', date, pieceId, mode, beat: beatName }), {
          status: 202, headers: corsHeaders(request),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // Zita synthesis manual trigger: POST /zita-synthesis-trigger?date=YYYY-MM-DD
    // Fires Director.analyseZitaPatternsScheduled against an already-
    // published piece, without waiting for the natural 01:45 UTC day+1
    // alarm. Used for (a) testing the P1.5 synthesis path before the
    // first natural run, (b) re-running synthesis for a day whose
    // scheduled run failed. The Learner's ≥5-user-message guard still
    // applies — a skip still produces an info observer event but no
    // Claude call + no learnings rows. See DECISIONS 2026-04-21 "P1.5
    // Learner skeleton" + RUNBOOK "Zita operations".
    if (url.pathname === '/zita-synthesis-trigger' && request.method === 'POST') {
      try {
        const date = url.searchParams.get('date') ?? '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return new Response(JSON.stringify({ error: 'Missing or invalid date (YYYY-MM-DD)' }), {
            status: 400, headers: corsHeaders(request),
          });
        }
        // Cadence Phase 6: analyseZitaPatternsScheduled takes piece_id
        // primary (per-piece scoping) + date for payload compatibility.
        // Admin still hits this endpoint with ?date=... — resolve
        // piece_id via daily_pieces (ORDER BY published_at DESC picks
        // the latest at multi-per-day, matching the "retry the latest"
        // shape used by /audio-retry).
        const pieceRow = await env.DB
          .prepare('SELECT id, headline FROM daily_pieces WHERE date = ? ORDER BY published_at DESC LIMIT 1')
          .bind(date)
          .first<{ id: string; headline: string }>();
        if (!pieceRow?.id) {
          return new Response(JSON.stringify({ error: `No piece published on ${date}` }), {
            status: 404, headers: corsHeaders(request),
          });
        }
        const pieceId = pieceRow.id;
        const title = pieceRow.headline;
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        ctx.waitUntil(
          director.analyseZitaPatternsScheduled({ pieceId, date, title }).catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[zita-synthesis-trigger] failed for piece ${pieceId} (${date}):`, message);
          }),
        );
        return new Response(JSON.stringify({ status: 'started', date, pieceId, title }), {
          status: 202, headers: corsHeaders(request),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // Categoriser manual trigger: POST /categorise-trigger?piece_id=<uuid>
    // Fires Director.categoriseScheduled against an already-published
    // piece, without waiting for the natural post-publish alarm. Used
    // for (a) testing the Categoriser path after a prompt or logic
    // change, (b) retagging a piece after admin merge/delete
    // operations (sub-task 2.5), (c) verifying Area 2 sub-task 2.2
    // ships green before the seed script in 2.3 processes the
    // backfill. Idempotent — Categoriser short-circuits with
    // skipped=true if the piece already has piece_categories rows.
    if (url.pathname === '/categorise-trigger' && request.method === 'POST') {
      try {
        const pieceId = url.searchParams.get('piece_id') ?? '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
          return new Response(JSON.stringify({ error: 'Missing or invalid piece_id (UUID)' }), {
            status: 400, headers: corsHeaders(request),
          });
        }
        const pieceRow = await env.DB
          .prepare('SELECT date, headline FROM daily_pieces WHERE id = ? LIMIT 1')
          .bind(pieceId)
          .first<{ date: string; headline: string }>();
        if (!pieceRow) {
          return new Response(JSON.stringify({ error: `No piece with id ${pieceId}` }), {
            status: 404, headers: corsHeaders(request),
          });
        }
        // Resolve filePath the same way Director does at publish time.
        const slug = pieceRow.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const filePath = `content/daily-pieces/${pieceRow.date}-${slug}.mdx`;
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        ctx.waitUntil(
          director.categoriseScheduled({
            pieceId,
            date: pieceRow.date,
            title: pieceRow.headline,
            filePath,
          }).catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[categorise-trigger] failed for piece ${pieceId}:`, message);
          }),
        );
        return new Response(JSON.stringify({
          status: 'started',
          pieceId,
          date: pieceRow.date,
          title: pieceRow.headline,
        }), { status: 202, headers: corsHeaders(request) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // InteractiveGenerator manual trigger: POST /interactive-generate-trigger?piece_id=<uuid>
    // Fires Director.generateInteractiveScheduled against an already-
    // published piece, without waiting for the natural post-publish
    // alarm. Used for (a) testing the Generator path after a prompt
    // change, (b) re-running the Generator after a prior failure,
    // (c) producing interactives for pre-Area-4 pieces. Idempotent —
    // Generator short-circuits with skipped=true if the piece already
    // has daily_pieces.interactive_id set.
    if (url.pathname === '/interactive-generate-trigger' && request.method === 'POST') {
      try {
        const pieceId = url.searchParams.get('piece_id') ?? '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
          return new Response(JSON.stringify({ error: 'Missing or invalid piece_id (UUID)' }), {
            status: 400, headers: corsHeaders(request),
          });
        }
        const pieceRow = await env.DB
          .prepare('SELECT date, headline FROM daily_pieces WHERE id = ? LIMIT 1')
          .bind(pieceId)
          .first<{ date: string; headline: string }>();
        if (!pieceRow) {
          return new Response(JSON.stringify({ error: `No piece with id ${pieceId}` }), {
            status: 404, headers: corsHeaders(request),
          });
        }
        const slug = pieceRow.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const filePath = `content/daily-pieces/${pieceRow.date}-${slug}.mdx`;
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        // 2026-04-30 — schedule the alarm instead of running the full
        // produce → audit → revise chain inline via ctx.waitUntil. The
        // inline path runs inside the HTTP request worker context,
        // which is bounded by Cloudflare Workers' subrequest wall-
        // clock budget; 3-round produce + audit + revise + commit can
        // take 2-3 minutes and gets cut mid-flight, looking like
        // parse-fails or losing HTML after quiz commit. Auto-cron and
        // destructive regenerate already use the alarm path.
        await director.requestInteractiveGenerate({
          pieceId,
          date: pieceRow.date,
          title: pieceRow.headline,
          filePath,
        });
        return new Response(JSON.stringify({
          status: 'scheduled',
          pieceId,
          date: pieceRow.date,
          title: pieceRow.headline,
        }), { status: 202, headers: corsHeaders(request) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: corsHeaders(request),
        });
      }
    }

    // InteractiveGenerator destructive regeneration:
    //   POST /interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz|html>&changed_by=<email>
    //
    // Wipes the existing `interactives` row + audit rows + git file
    // for the (piece, type) pair, then fires a fresh
    // `generateInteractiveScheduled` alarm. Synchronous in the sense
    // that the wipe + observer event happen before the response;
    // the fresh-generation alarm runs in a separate DO invocation
    // 1s later. The endpoint blocks on the destructive steps so the
    // operator sees a real error if the wipe fails (auth, rate limit,
    // missing target row), instead of a 202 "started" with a silent
    // server-side throw. Phase 3 sub-task 3.3 of Interactives v3.
    if (url.pathname === '/interactive-regenerate-trigger' && request.method === 'POST') {
      try {
        const pieceId = url.searchParams.get('piece_id') ?? '';
        const type = url.searchParams.get('type') ?? '';
        const changedBy = url.searchParams.get('changed_by') ?? 'unknown';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
          return new Response(JSON.stringify({ error: 'Missing or invalid piece_id (UUID)' }), {
            status: 400, headers: corsHeaders(request),
          });
        }
        if (type !== 'quiz' && type !== 'html') {
          return new Response(JSON.stringify({ error: "type must be 'quiz' or 'html'" }), {
            status: 400, headers: corsHeaders(request),
          });
        }
        const director = await getAgentByName<DirectorAgent>(env.DIRECTOR, 'default');
        const result = await director.regenerateInteractive({
          pieceId,
          type,
          changedBy,
        });
        return new Response(JSON.stringify(result), {
          status: 202, headers: corsHeaders(request),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const status = /not found|interactives_html_enabled is false/.test(message) ? 400 : 500;
        return new Response(JSON.stringify({ error: message }), {
          status, headers: corsHeaders(request),
        });
      }
    }

    // Agent SDK routing
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response(
      JSON.stringify({
        service: 'zeemish-agents',
        endpoints: {
          'daily-trigger': 'POST /daily-trigger (requires auth)',
          status: 'GET /status',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  },
} satisfies ExportedHandler<Env>;
