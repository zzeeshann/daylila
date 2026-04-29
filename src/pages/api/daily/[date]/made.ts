import type { APIRoute } from 'astro';
import { auditTier } from '../../../../lib/audit-tier';
import type {
  MadeEnvelope,
  MadePiece,
  MadeTimelineStep,
  MadeRound,
  MadeCandidate,
  MadeCandidates,
  MadeFactClaim,
  MadeAudio,
  MadeAudioBeat,
  MadeLearning,
  MadeCategory,
  MadeInteractive,
} from '../../../../lib/made-by';

export const prerender = false;

/**
 * Public, no-auth endpoint. Returns the full "How this was made" envelope
 * for a single piece: metadata + timeline + audit rounds + candidate set.
 *
 * All data aggregates existing tables — no new columns, no new events:
 *   daily_pieces       → piece metadata
 *   pipeline_log       → timeline + commit URL
 *   audit_results      → rounds (grouped by draft_id)
 *   daily_candidates   → picked + alsoConsidered
 *
 * Graceful degradation: if any one table is empty, its section in the
 * response is empty and the drawer hides that section client-side.
 */
export const GET: APIRoute = async ({ params, locals, url }) => {
  const db = locals.runtime.env.DB;
  const date = String(params.date ?? '').trim();
  // Optional: pieceId query param. When present, all piece-scoped
  // sections (piece metadata, timeline, rounds, candidates, audio,
  // learnings) bind by piece_id for unambiguous multi-per-day
  // isolation. When absent, fall back to date-keyed lookups — correct
  // at 1/day, picks "a piece" at multi-per-day (pre-Phase-7 behaviour).
  // Drawer component always sends pieceId for new bundles; absence
  // means a stale cached bundle.
  const pieceIdParam = url.searchParams.get('pieceId');
  const pieceIdFilter = pieceIdParam && /^[0-9a-f-]{32,40}$/i.test(pieceIdParam)
    ? pieceIdParam
    : null;

  // Basic validation — date route param is YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const envelope: MadeEnvelope = {
    date,
    piece: null,
    timeline: [],
    rounds: [],
    candidates: { total: 0, picked: null, alsoConsidered: [] },
    audio: {
      beats: [],
      totalCharacters: 0,
      totalSizeBytes: null,
      model: null,
      voiceId: null,
      generatedAt: null,
    },
    categories: [],
    interactive: null,
    htmlInteractive: null,
    learnings: [],
  };

  // --- Piece metadata --------------------------------------------------
  try {
    const row = pieceIdFilter
      ? await db
          .prepare('SELECT * FROM daily_pieces WHERE id = ? LIMIT 1')
          .bind(pieceIdFilter)
          .first<any>()
      : await db
          .prepare('SELECT * FROM daily_pieces WHERE date = ? ORDER BY published_at DESC LIMIT 1')
          .bind(date)
          .first<any>();
    if (row) {
      const piece: MadePiece = {
        headline: row.headline,
        subject: row.underlying_subject ?? null,
        wordCount: row.word_count ?? null,
        beatCount: row.beat_count ?? null,
        voiceScore: row.voice_score ?? null,
        tier: auditTier(row.voice_score, row.quality_flag),
        qualityFlag: row.quality_flag ?? null,
        publishedAt: row.published_at ?? null,
        commitUrl: null, // backfilled below from pipeline_log
        filePath: null,  // backfilled below from pipeline_log
      };
      envelope.piece = piece;
    }
  } catch { /* no row yet */ }

  // --- Timeline from pipeline_log --------------------------------------
  try {
    const steps = pieceIdFilter
      ? await db
          .prepare('SELECT step, status, data, created_at FROM pipeline_log WHERE piece_id = ? ORDER BY created_at ASC')
          .bind(pieceIdFilter)
          .all<{ step: string; status: string; data: string | null; created_at: number }>()
      : await db
          .prepare('SELECT step, status, data, created_at FROM pipeline_log WHERE run_id = ? ORDER BY created_at ASC')
          .bind(date)
          .all<{ step: string; status: string; data: string | null; created_at: number }>();

    envelope.timeline = steps.results.map<MadeTimelineStep>((r) => ({
      step: r.step,
      status: r.status,
      t: r.created_at,
      data: r.data ? safeJson(r.data) : {},
    }));

    // Pull commit URL + file path from the publishing.done step if present.
    if (envelope.piece) {
      const pub = envelope.timeline.find(
        (s) => s.step === 'publishing' && s.status === 'done',
      );
      if (pub?.data) {
        envelope.piece.commitUrl = pub.data.commitUrl ?? null;
        envelope.piece.filePath = pub.data.filePath ?? null;
      }
    }
  } catch { /* leave empty */ }

  // --- Audit rounds from audit_results ---------------------------------
  try {
    const rows = pieceIdFilter
      ? await db
          .prepare('SELECT auditor, passed, score, notes, draft_id, created_at FROM audit_results WHERE piece_id = ? ORDER BY created_at ASC')
          .bind(pieceIdFilter)
          .all<{
            auditor: string;
            passed: number;
            score: number | null;
            notes: string | null;
            draft_id: string;
            created_at: number;
          }>()
      : await db
          .prepare('SELECT auditor, passed, score, notes, draft_id, created_at FROM audit_results WHERE task_id = ? ORDER BY created_at ASC')
          .bind(`daily/${date}`)
          .all<{
            auditor: string;
            passed: number;
            score: number | null;
            notes: string | null;
            draft_id: string;
            created_at: number;
          }>();

    // Group by draft_id — each draft_id is one round (…-r1, …-r2, …).
    const byDraft = new Map<string, typeof rows.results>();
    for (const r of rows.results) {
      if (!byDraft.has(r.draft_id)) byDraft.set(r.draft_id, [] as any);
      byDraft.get(r.draft_id)!.push(r);
    }

    // Keep insertion order (audits are inserted per round, oldest first).
    const drafts = Array.from(byDraft.entries());
    drafts.sort((a, b) => {
      const ra = roundFromDraftId(a[0]);
      const rb = roundFromDraftId(b[0]);
      return ra - rb;
    });

    envelope.rounds = drafts.map<MadeRound>(([draftId, group]) => {
      const round = roundFromDraftId(draftId);
      const voice = group.find((g) => g.auditor === 'voice');
      const structure = group.find((g) => g.auditor === 'structure');
      const fact = group.find((g) => g.auditor === 'fact');

      return {
        round,
        voice: {
          score: voice?.score ?? null,
          passed: !!voice?.passed,
          violations: parseStringArray(voice?.notes),
        },
        structure: {
          passed: !!structure?.passed,
          issues: parseStringArray(structure?.notes),
        },
        fact: {
          passed: !!fact?.passed,
          claims: parseClaims(fact?.notes),
        },
      };
    });
  } catch { /* leave empty */ }

  // --- Candidates Scanner surfaced -------------------------------------
  try {
    const cands = pieceIdFilter
      ? await db
          .prepare('SELECT headline, source, category, summary, url, teachability_score, selected FROM daily_candidates WHERE piece_id = ? ORDER BY teachability_score DESC')
          .bind(pieceIdFilter)
          .all<{
            headline: string;
            source: string;
            category: string | null;
            summary: string | null;
            url: string | null;
            teachability_score: number | null;
            selected: number | null;
          }>()
      : await db
          .prepare('SELECT headline, source, category, summary, url, teachability_score, selected FROM daily_candidates WHERE date = ? ORDER BY teachability_score DESC')
          .bind(date)
          .all<{
            headline: string;
            source: string;
            category: string | null;
            summary: string | null;
            url: string | null;
            teachability_score: number | null;
            selected: number | null;
          }>();

    const list = cands.results.map<MadeCandidate>((c) => ({
      headline: c.headline,
      source: c.source,
      category: c.category ?? null,
      summary: c.summary ?? null,
      url: c.url ?? null,
      teachabilityScore: c.teachability_score ?? null,
    }));

    const pickedIdx = cands.results.findIndex((c) => c.selected === 1);
    const envelopeCandidates: MadeCandidates = {
      total: list.length,
      picked: pickedIdx >= 0 ? list[pickedIdx] : null,
      alsoConsidered: list
        .filter((_, i) => i !== pickedIdx)
        .slice(0, 6),
    };
    envelope.candidates = envelopeCandidates;
  } catch { /* leave empty */ }

  // --- Audio rows (may be empty if audio hasn't landed yet) -----------
  try {
    const audioRes = pieceIdFilter
      ? await db
          .prepare(
            `SELECT beat_name, public_url, character_count, model, voice_id, generated_at
             FROM daily_piece_audio WHERE piece_id = ? ORDER BY generated_at ASC`,
          )
          .bind(pieceIdFilter)
          .all<{
            beat_name: string;
            public_url: string;
            character_count: number;
            model: string;
            voice_id: string;
            generated_at: number;
          }>()
      : await db
          .prepare(
            `SELECT beat_name, public_url, character_count, model, voice_id, generated_at
             FROM daily_piece_audio WHERE date = ? ORDER BY generated_at ASC`,
          )
          .bind(date)
          .all<{
            beat_name: string;
            public_url: string;
            character_count: number;
            model: string;
            voice_id: string;
            generated_at: number;
          }>();
    const rows = audioRes.results;
    if (rows.length > 0) {
      const beats: MadeAudioBeat[] = rows.map((r) => ({
        beatName: r.beat_name,
        publicUrl: r.public_url,
        characterCount: r.character_count,
      }));
      const audio: MadeAudio = {
        beats,
        totalCharacters: rows.reduce((sum, r) => sum + r.character_count, 0),
        totalSizeBytes: null, // not stored in D1 — R2 HEAD is agents-worker-only
        model: rows[0].model,
        voiceId: rows[0].voice_id,
        generatedAt: rows[0].generated_at,
      };
      envelope.audio = audio;
    }
  } catch { /* leave audio empty */ }

  // --- Categories Categoriser assigned -------------------------------
  // Both tables (categories + piece_categories) post-date the piece_id
  // backfill era, so no date-keyed fallback is needed. Empty array when
  // the piece pre-dates Categoriser (pre-2026-04-23) or the agent
  // failed/hasn't run yet — the drawer omits the section in all cases.
  //
  // The reserved fallback slug `patterns-yet-to-cluster` (migration
  // 0027) is excluded here too — when both Categoriser attempts return
  // empty/all-sub-floor the piece is parked in the fallback, but
  // surfacing "Filed under: Patterns Yet to Cluster" to readers reads
  // as a confusing self-report. Operator visibility lives in
  // observer_events. Slug literal stays in sync with src/lib/categories.ts
  // FALLBACK_SLUG and agents/src/categoriser-prompt.ts CATEGORISER_FALLBACK_SLUG.
  if (pieceIdFilter) {
    try {
      const cats = await db
        .prepare(
          `SELECT c.slug, c.name, pc.confidence
             FROM piece_categories pc
             JOIN categories c ON c.id = pc.category_id
            WHERE pc.piece_id = ?
              AND c.slug != 'patterns-yet-to-cluster'
            ORDER BY pc.confidence DESC, c.name ASC`,
        )
        .bind(pieceIdFilter)
        .all<{ slug: string; name: string; confidence: number }>();
      envelope.categories = cats.results.map<MadeCategory>((r) => ({
        slug: r.slug,
        name: r.name,
        confidence: r.confidence,
      }));
    } catch { /* leave categories empty */ }
  }

  // --- Interactives (quiz + html, both per piece since Phase 2) -------
  // Two queries — one per artefact type. Each populates a separate
  // envelope field (`interactive` for quiz, `htmlInteractive` for html)
  // so a stale cached drawer bundle that only knows about `interactive`
  // doesn't break. Independent failure: a transient D1 error on one
  // query leaves the other intact.
  //
  // The latest-round failed-dimensions sub-query is shared logic;
  // factored into a helper to avoid duplicating the dimension-order
  // CASE WHEN block.
  if (pieceIdFilter) {
    type InteractiveRow = {
      id: string;
      slug: string;
      type: string;
      title: string;
      voice_score: number | null;
      quality_flag: string | null;
      revision_count: number | null;
      published_at: number | null;
    };
    const fetchFailedDimensions = async (interactiveId: string): Promise<string[]> => {
      try {
        const auditRes = await db
          .prepare(
            `SELECT dimension
               FROM interactive_audit_results
              WHERE interactive_id = ?
                AND round = (
                  SELECT MAX(round)
                    FROM interactive_audit_results
                   WHERE interactive_id = ?
                )
                AND passed = 0
              ORDER BY CASE dimension
                WHEN 'voice'     THEN 1
                WHEN 'structure' THEN 2
                WHEN 'essence'   THEN 3
                WHEN 'factual'   THEN 4
                ELSE 5
              END`,
          )
          .bind(interactiveId, interactiveId)
          .all<{ dimension: string }>();
        return auditRes.results.map((r) => r.dimension);
      } catch {
        return [];
      }
    };
    const rowToShape = async (row: InteractiveRow): Promise<MadeInteractive> => ({
      slug: row.slug,
      type: row.type,
      title: row.title,
      voiceScore: row.voice_score ?? null,
      qualityFlag: row.quality_flag === 'low' ? 'low' : null,
      revisionCount: row.revision_count ?? 0,
      publishedAt: row.published_at ?? null,
      failedDimensions: await fetchFailedDimensions(row.id),
    });

    // Quiz path — same query as before, narrowed by type.
    try {
      const row = await db
        .prepare(
          `SELECT id, slug, type, title, voice_score, quality_flag, revision_count, published_at
             FROM interactives
            WHERE source_piece_id = ? AND type = 'quiz'
            LIMIT 1`,
        )
        .bind(pieceIdFilter)
        .first<InteractiveRow>();
      if (row) {
        envelope.interactive = await rowToShape(row);
      }
    } catch { /* leave interactive null */ }

    // HTML interactive path — new in Phase 2 sub-task 2.6.
    try {
      const row = await db
        .prepare(
          `SELECT id, slug, type, title, voice_score, quality_flag, revision_count, published_at
             FROM interactives
            WHERE source_piece_id = ? AND type = 'html'
            LIMIT 1`,
        )
        .bind(pieceIdFilter)
        .first<InteractiveRow>();
      if (row) {
        envelope.htmlInteractive = await rowToShape(row);
      }
    } catch { /* leave htmlInteractive null */ }
  }

  // --- Learnings pinned to this piece ---------------------------------
  // Written post-publish by Learner.analysePiecePostPublish (P1.3) and
  // Drafter.reflect (P1.4), plus any StructureEditor writes from that
  // day's audit rounds. Empty until 0012's piece_date column + backfill
  // landed (2026-04-20). Ordered by write time within each source.
  try {
    // When pieceId query param is valid, scope by piece_id (correct at
    // multi-per-day). Otherwise fall back to piece_date (legacy, correct
    // at 1/day). All 5 existing pieces have pieceId in frontmatter after
    // the same-commit backfill, so the fallback path is defensive rather
    // than load-bearing.
    const rows = pieceIdFilter
      ? await db
          .prepare('SELECT observation, source, created_at FROM learnings WHERE piece_id = ? ORDER BY created_at ASC')
          .bind(pieceIdFilter)
          .all<{ observation: string; source: string | null; created_at: number }>()
      : await db
          .prepare('SELECT observation, source, created_at FROM learnings WHERE piece_date = ? ORDER BY created_at ASC')
          .bind(date)
          .all<{ observation: string; source: string | null; created_at: number }>();
    envelope.learnings = rows.results.map<MadeLearning>((r) => ({
      observation: r.observation,
      source: r.source,
      createdAt: r.created_at,
    }));
  } catch { /* leave learnings empty */ }

  return new Response(JSON.stringify(envelope), {
    headers: {
      'Content-Type': 'application/json',
      // Safe to cache briefly — pipeline writes land once per day, and
      // readers hitting the drawer minutes apart don't need stale-while-
      // revalidate gymnastics. 5 min should be a fine floor.
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
};

/** `daily/2026-04-17-r2` → 2. Falls back to 1 if the pattern is missing. */
function roundFromDraftId(draftId: string): number {
  const m = draftId.match(/-r(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

function safeJson(input: string): any {
  try { return JSON.parse(input); } catch { return {}; }
}

function parseStringArray(notes: string | null | undefined): string[] {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    return [];
  } catch {
    return [];
  }
}

function parseClaims(notes: string | null | undefined): MadeFactClaim[] {
  if (!notes) return [];
  try {
    const parsed = JSON.parse(notes);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c === 'object' && typeof c.claim === 'string')
      .map((c: any) => ({
        claim: c.claim,
        status: typeof c.status === 'string' ? c.status : undefined,
        note: typeof c.note === 'string' ? c.note : undefined,
      }));
  } catch {
    return [];
  }
}
