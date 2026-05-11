import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { auditTier } from '../../../../lib/audit-tier';
import { FALLBACK_SLUG } from '../../../../lib/categoriser-thresholds';
import { computePieceStats } from '../../../../lib/piece-stats';
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
  MadeAudioAudit,
  MadeAudioAuditIssue,
  MadeLearning,
  MadeLearningLoad,
  MadeCategory,
  MadeInteractive,
  MadeIntegratorDecision,
  MadeRejectionBreakdown,
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
    candidates: { total: 0, picked: null, alsoConsidered: [], rejectionBreakdown: [] },
    audio: {
      beats: [],
      totalCharacters: 0,
      totalSizeBytes: null,
      totalDurationSeconds: null,
      model: null,
      voiceId: null,
      generatedAt: null,
      audit: null,
    },
    categories: [],
    interactive: null,
    htmlInteractive: null,
    learnings: [],
    learningsLoaded: [],
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
      // Derive word + beat count from the published MDX body, not from
      // daily_pieces.word_count / beat_count. Those columns held Curator's
      // brief plan and drifted from what Drafter actually shipped (PR #0,
      // 2026-05-09). Single source of truth = MDX file.
      let wordCount: number | null = null;
      let beatCount: number | null = null;
      try {
        const collection = await getCollection('dailyPieces');
        const entry = collection.find((e) => e.data.pieceId === row.id);
        if (entry) {
          const stats = computePieceStats(entry.body ?? '');
          wordCount = stats.wordCount;
          beatCount = stats.beatCount;
        }
      } catch { /* MDX missing — null both */ }

      const piece: MadePiece = {
        headline: row.headline,
        subject: row.underlying_subject ?? null,
        wordCount,
        beatCount,
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
          .prepare('SELECT step, status, data, created_at FROM pipeline_log WHERE run_date = ? ORDER BY created_at ASC')
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

    // Pull integrator_decisions for this piece up front (one query,
    // no join — Task 06 wrote `revision_round` keyed by the round
    // that PRODUCED the decision, which matches the audit's round_id).
    // Empty on pre-Task-06 pieces (table didn't exist) or single-round
    // pieces (no integrator call fired). Failure is fail-open — drawer
    // still renders rounds without decisions.
    const decisionsByRound = new Map<number, MadeIntegratorDecision[]>();
    if (pieceIdFilter) {
      try {
        const decisionRows = await db
          .prepare(
            `SELECT revision_round, feedback_source, feedback_summary, decision, reasoning, resulting_change
               FROM integrator_decisions
              WHERE piece_id = ?
              ORDER BY revision_round ASC, created_at ASC`,
          )
          .bind(pieceIdFilter)
          .all<{
            revision_round: number;
            feedback_source: string;
            feedback_summary: string | null;
            decision: string;
            reasoning: string | null;
            resulting_change: string | null;
          }>();
        for (const r of decisionRows.results) {
          const key = r.revision_round ?? 0;
          if (!decisionsByRound.has(key)) decisionsByRound.set(key, []);
          decisionsByRound.get(key)!.push({
            feedbackSource: r.feedback_source,
            feedbackSummary: r.feedback_summary,
            decision: r.decision,
            reasoning: r.reasoning,
            resultingChange: r.resulting_change,
          });
        }
      } catch { /* leave decisionsByRound empty */ }
    }

    envelope.rounds = drafts.map<MadeRound>(([draftId, group]) => {
      const round = roundFromDraftId(draftId);
      const voice = group.find((g) => g.auditor === 'voice');
      const structure = group.find((g) => g.auditor === 'structure');
      const fact = group.find((g) => g.auditor === 'fact');
      const factShape = parseFact(fact?.notes);

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
          claims: factShape.claims,
          ...(factShape.sources && factShape.sources.length > 0
            ? { sources: factShape.sources }
            : {}),
        },
        // Integrator's response was written at the END of this round
        // (it produced round N+1's draft). We key the decision row by
        // `revision_round = N+1` in Task 06 — but for the drawer the
        // editorially natural pairing is "audit round N → integrator
        // response shown UNDER round N." So we look up decisions
        // whose revision_round equals THIS round's number for the
        // pairing — Task 06 numbers decisions by the round that
        // CONSUMES them. Empty array on the final passing round
        // (no integrator ran).
        integratorDecisions: decisionsByRound.get(round) ?? [],
      };
    });
  } catch { /* leave empty */ }

  // --- Candidates Scanner surfaced -------------------------------------
  // pick_reasoning / rejection_category / rejection_reason all added by
  // Foundation Fix Task 03 (2026-05-06). Pre-Task-03 candidates carry
  // null on all three; renderer omits the empty lines naturally.
  try {
    const cands = pieceIdFilter
      ? await db
          .prepare('SELECT headline, source, category, summary, url, teachability_score, selected, pick_reasoning, rejection_category, rejection_reason FROM daily_candidates WHERE piece_id = ? ORDER BY teachability_score DESC')
          .bind(pieceIdFilter)
          .all<{
            headline: string;
            source: string;
            category: string | null;
            summary: string | null;
            url: string | null;
            teachability_score: number | null;
            selected: number | null;
            pick_reasoning: string | null;
            rejection_category: string | null;
            rejection_reason: string | null;
          }>()
      : await db
          .prepare('SELECT headline, source, category, summary, url, teachability_score, selected, pick_reasoning, rejection_category, rejection_reason FROM daily_candidates WHERE date = ? ORDER BY teachability_score DESC')
          .bind(date)
          .all<{
            headline: string;
            source: string;
            category: string | null;
            summary: string | null;
            url: string | null;
            teachability_score: number | null;
            selected: number | null;
            pick_reasoning: string | null;
            rejection_category: string | null;
            rejection_reason: string | null;
          }>();

    const list = cands.results.map<MadeCandidate>((c) => ({
      headline: c.headline,
      source: c.source,
      category: c.category ?? null,
      summary: c.summary ?? null,
      url: c.url ?? null,
      teachabilityScore: c.teachability_score ?? null,
      pickReasoning: c.pick_reasoning ?? null,
      rejectionCategory: c.rejection_category ?? null,
      rejectionReason: c.rejection_reason ?? null,
    }));

    // Rejection breakdown by closed-enum category, descending by count.
    // Aggregates in-memory rather than a second D1 query — the cands
    // result already has every row, and the result set caps at ~24
    // rows under PER_FEED_CAP=2 + GLOBAL_CAP=24.
    const rejectionCounts = new Map<string, number>();
    for (const c of cands.results) {
      if (c.selected === 1) continue;
      const cat = c.rejection_category ?? null;
      if (!cat) continue;
      rejectionCounts.set(cat, (rejectionCounts.get(cat) ?? 0) + 1);
    }
    const rejectionBreakdown: MadeRejectionBreakdown[] = Array.from(rejectionCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const pickedIdx = cands.results.findIndex((c) => c.selected === 1);
    const envelopeCandidates: MadeCandidates = {
      total: list.length,
      picked: pickedIdx >= 0 ? list[pickedIdx] : null,
      alsoConsidered: list
        .filter((_, i) => i !== pickedIdx)
        .slice(0, 6),
      rejectionBreakdown,
    };
    envelope.candidates = envelopeCandidates;
  } catch { /* leave empty */ }

  // --- Audio rows (may be empty if audio hasn't landed yet) -----------
  // file_size_bytes + duration_seconds added by Foundation Fix Task 05
  // (migration 0033). Null on pre-Task-05 audio; totals fall back to
  // null when every row is missing the column.
  try {
    const audioRes = pieceIdFilter
      ? await db
          .prepare(
            `SELECT beat_name, public_url, character_count, file_size_bytes, duration_seconds, model, voice_id, generated_at
             FROM daily_piece_audio WHERE piece_id = ? ORDER BY generated_at ASC`,
          )
          .bind(pieceIdFilter)
          .all<{
            beat_name: string;
            public_url: string;
            character_count: number;
            file_size_bytes: number | null;
            duration_seconds: number | null;
            model: string;
            voice_id: string;
            generated_at: number;
          }>()
      : await db
          .prepare(
            `SELECT beat_name, public_url, character_count, file_size_bytes, duration_seconds, model, voice_id, generated_at
             FROM daily_piece_audio WHERE date = ? ORDER BY generated_at ASC`,
          )
          .bind(date)
          .all<{
            beat_name: string;
            public_url: string;
            character_count: number;
            file_size_bytes: number | null;
            duration_seconds: number | null;
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
        durationSeconds: r.duration_seconds ?? null,
        fileSizeBytes: r.file_size_bytes ?? null,
      }));
      const sizes = rows.map((r) => r.file_size_bytes ?? 0);
      const durs = rows.map((r) => r.duration_seconds ?? 0);
      const someSize = rows.some((r) => r.file_size_bytes != null);
      const someDur = rows.some((r) => r.duration_seconds != null);
      const audio: MadeAudio = {
        beats,
        totalCharacters: rows.reduce((sum, r) => sum + r.character_count, 0),
        totalSizeBytes: someSize ? sizes.reduce((s, n) => s + n, 0) : null,
        totalDurationSeconds: someDur ? durs.reduce((s, n) => s + n, 0) : null,
        model: rows[0].model,
        voiceId: rows[0].voice_id,
        generatedAt: rows[0].generated_at,
        audit: null,
      };

      // Audio Auditor verdict from `audio_audit_results` (Task 05,
      // migration 0033). Always-summary row has `beat_name IS NULL`
      // and `issue_type IS NULL`; per-issue rows carry both. Take the
      // most recent summary row (audit may have re-run; the latest is
      // authoritative).
      if (pieceIdFilter) {
        try {
          const auditRows = await db
            .prepare(
              `SELECT beat_name, passed, issue_type, issue_severity, notes, created_at
                 FROM audio_audit_results
                WHERE piece_id = ?
                ORDER BY created_at DESC`,
            )
            .bind(pieceIdFilter)
            .all<{
              beat_name: string | null;
              passed: number;
              issue_type: string | null;
              issue_severity: string | null;
              notes: string | null;
              created_at: number;
            }>();
          if (auditRows.results.length > 0) {
            // Latest summary row (beat_name=null AND issue_type=null).
            const summary = auditRows.results.find(
              (r) => r.beat_name == null && r.issue_type == null,
            );
            // Group issues from the same audit pass: created_at within
            // 2 minutes of the latest summary row counts as the same run.
            const summaryT = summary?.created_at ?? auditRows.results[0].created_at;
            const issueRows = auditRows.results.filter(
              (r) =>
                r !== summary &&
                r.issue_type != null &&
                Math.abs(r.created_at - summaryT) < 120_000,
            );
            const issues: MadeAudioAuditIssue[] = issueRows.map((r) => ({
              beatName: r.beat_name,
              issueType: r.issue_type,
              issueSeverity: r.issue_severity,
              notes: r.notes,
            }));
            audio.audit = {
              passed: summary ? !!summary.passed : issues.length === 0,
              summaryNote: summary?.notes ?? null,
              issues,
              auditedAt: summaryT,
            };
          }
        } catch { /* leave audio.audit null */ }
      }

      envelope.audio = audio;
    }
  } catch { /* leave audio empty */ }

  // --- Categories Categoriser assigned -------------------------------
  // Both tables (categories + piece_categories) post-date the piece_id
  // backfill era, so no date-keyed fallback is needed. Empty array when
  // the piece pre-dates Categoriser (pre-2026-04-23) or the agent
  // failed/hasn't run yet — the drawer omits the section in all cases.
  //
  // The reserved fallback slug (migration 0027) is excluded here too —
  // when both Categoriser attempts return empty/all-sub-floor the piece
  // is parked in the fallback, but surfacing "Filed under: Patterns Yet
  // to Cluster" to readers reads as a confusing self-report. Operator
  // visibility lives in observer_events. Slug imported from
  // src/lib/categoriser-thresholds.ts (canonical site-side); agents-side
  // canonical at agents/src/shared/categoriser-thresholds.ts.
  if (pieceIdFilter) {
    try {
      const cats = await db
        .prepare(
          `SELECT c.slug, c.name, pc.confidence
             FROM piece_categories pc
             JOIN categories c ON c.id = pc.category_id
            WHERE pc.piece_id = ?
              AND c.slug != ?
            ORDER BY pc.confidence DESC, c.name ASC`,
        )
        .bind(pieceIdFilter, FALLBACK_SLUG)
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

  // --- Read-side of the learning loop --------------------------------
  // Learnings written by EARLIER pieces whose `applied_to_prompts` JSON
  // array now contains THIS piece's id — meaning the Drafter loaded
  // them via `getRecentLearnings(10)` at draft time and Director's
  // success-path batch then linked them to this piece on publish.
  // Foundation Fix Task 04 (2026-05-11) added the linkage column.
  // Pre-Task-04 pieces have no inbound links and the array stays empty.
  if (pieceIdFilter) {
    try {
      // LIKE on a JSON-encoded array of UUIDs — the search needle
      // includes the quotes to avoid prefix-collision with another
      // UUID that happens to share the leading hex bytes.
      const needle = `%"${pieceIdFilter}"%`;
      const loaded = await db
        .prepare(
          `SELECT observation, source, piece_id, piece_date, created_at
             FROM learnings
            WHERE applied_to_prompts LIKE ?
              AND piece_id != ?
            ORDER BY created_at ASC`,
        )
        .bind(needle, pieceIdFilter)
        .all<{
          observation: string;
          source: string | null;
          piece_id: string | null;
          piece_date: string | null;
          created_at: number;
        }>();
      envelope.learningsLoaded = loaded.results.map<MadeLearningLoad>((r) => ({
        observation: r.observation,
        source: r.source,
        fromPieceId: r.piece_id,
        fromPieceDate: r.piece_date,
        createdAt: r.created_at,
      }));
    } catch { /* leave learningsLoaded empty */ }
  }

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

/**
 * Parse the `audit_results.notes` JSON for the fact-checker round into
 * the drawer-shaped {claims, sources}.
 *
 * Two persisted shapes accepted:
 *   - Pre-Path-A (≤ 2026-04-30): bare claims array (no top-level sources).
 *     `JSON.stringify(facts.claims)` was persisted directly; sources lived
 *     per-claim under Phase F.
 *   - Path A (≥ 2026-05-01): full FactCheckResult object — `{passed, claims,
 *     searchUsed, searchAvailable, sources}`. The flat `sources` URL list
 *     drives the drawer's "Sources consulted" line.
 */
function parseFact(
  notes: string | null | undefined,
): { claims: MadeFactClaim[]; sources?: string[] } {
  if (!notes) return { claims: [] };
  try {
    const parsed = JSON.parse(notes);
    const rawClaims = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.claims) ? parsed.claims : []);
    const claims = rawClaims
      .filter((c: any) => c && typeof c === 'object' && typeof c.claim === 'string')
      .map((c: any) => ({
        claim: c.claim,
        status: typeof c.status === 'string' ? c.status : undefined,
        note: typeof c.note === 'string' ? c.note : undefined,
      } as MadeFactClaim));
    const sources = !Array.isArray(parsed) && Array.isArray(parsed?.sources)
      ? parsed.sources.filter((s: any): s is string => typeof s === 'string' && s.length > 0)
      : undefined;
    return sources ? { claims, sources } : { claims };
  } catch {
    return { claims: [] };
  }
}
