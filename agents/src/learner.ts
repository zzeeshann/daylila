import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { writeLearning } from './shared/learnings';
import { extractJson } from './shared/parse-json';
import { LEARNER_ANALYSE_PROMPT, LEARNER_POST_PUBLISH_PROMPT, LEARNER_ZITA_PROMPT } from './learner-prompt';

/** Cap on producer-side learnings written per post-publish run. If
 *  the analysis produces more than this from one piece, something is
 *  wrong (same pattern restated N ways). We write the first N and log
 *  the overflow to observer_events — it's easier to notice the
 *  over-generation than to let it flood the table. */
const PRODUCER_LEARNINGS_WRITE_CAP = 10;

/** Minimum user-messages in a piece's Zita conversations before we
 *  bother running a synthesis pass. Below this threshold, Claude's
 *  output would be noise, not patterns. Director schedules the call
 *  regardless; this guard turns the no-signal case into a cheap skip.
 *  See DECISIONS 2026-04-21 "P1.5 Learner skeleton". */
const ZITA_SYNTHESIS_MIN_USER_MESSAGES = 5;

/** Cap on Zita-origin learnings written per synthesis run. Same shape
 *  and reasoning as PRODUCER_LEARNINGS_WRITE_CAP. */
const ZITA_LEARNINGS_WRITE_CAP = 10;

/** Producer-side analysis output from Claude. Category/observation
 *  shape mirrors the prompt's JSON contract. */
interface ProducerLearning {
  category: string;
  observation: string;
}

function normalizeProducerCategory(
  c: string,
): 'voice' | 'structure' | 'engagement' | 'fact' {
  const k = (c ?? '').toLowerCase().trim();
  if (k === 'voice') return 'voice';
  if (k === 'structure') return 'structure';
  if (k === 'engagement') return 'engagement';
  if (k === 'fact') return 'fact';
  return 'structure'; // safe default — all four prompts see structure findings
}

// --- Types (merged from EngagementAnalyst + Learner) ---

export interface EngagementReport {
  courseId: string;
  underperformingLessons: UnderperformingLesson[];
  topLessons: LessonMetric[];
  totalViews: number;
  totalCompletions: number;
  overallCompletionRate: number;
}

export interface UnderperformingLesson {
  lessonId: string;
  pieceId: string;
  views: number;
  completions: number;
  completionRate: number;
  dropOffBeat: string | null;
  reason: string;
}

export interface LessonMetric {
  lessonId: string;
  pieceId: string;
  views: number;
  completions: number;
  completionRate: number;
}

export interface EngagementLearning {
  lessonId: string;
  problem: string;
  learnings: string[];
}

interface LearnerState {
  learningsWritten: number;
  lastReport: EngagementReport | null;
}

/** Result of a post-publish producer analysis — surfaced back to
 *  Director so it can log overflow to observer_events. Not persisted
 *  in LearnerState because Director is the one that acts on it. */
export interface PostPublishResult {
  date: string;
  written: number;      // how many rows actually landed in learnings
  overflowCount: number; // how many were produced beyond PRODUCER_LEARNINGS_WRITE_CAP
  considered: number;   // total learnings Claude produced (written + overflowCount on success)
  /** Per-call usage. Director forwards to observer.logLLMCall. */
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/** Result of a Zita-question synthesis — surfaced back to Director
 *  so it can log metered info / overflow / skipped events. Mirrors
 *  PostPublishResult with token metering (this is a Sonnet call that
 *  doesn't gate anything, so cost visibility is the whole point)
 *  plus a skipped flag for the insufficient-traffic case. */
export interface ZitaSynthesisResult {
  date: string;
  skipped: boolean;      // true when userMsgCount < ZITA_SYNTHESIS_MIN_USER_MESSAGES
  userMsgCount: number;  // how many user messages were in the synthesis window
  written: number;
  overflowCount: number;
  considered: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/**
 * LearnerAgent — watches reader engagement data and writes patterns
 * into the learnings database for future pieces.
 *
 * Two jobs, one agent:
 * 1. Analyse engagement (completions, drop-offs, audio vs text, return rate)
 * 2. Extract actionable learnings from underperforming pieces
 *
 * Does NOT touch published pieces. Published content is permanent.
 * All improvements feed forward into future pieces only.
 */
export class LearnerAgent extends Agent<Env, LearnerState> {
  initialState: LearnerState = { learningsWritten: 0, lastReport: null };

  // --- Engagement analysis ---

  /** Analyse engagement for a content stream over the last N days.
   *  Aggregates by piece_id (migration 0017) — at multi-per-day cadence
   *  two pieces sharing a date are kept separate. `lesson_id` is held
   *  alongside piece_id via MAX() for display. */
  async analyse(courseId: string, days = 7): Promise<EngagementReport> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const result = await this.env.DB
      .prepare(
        `SELECT piece_id,
                MAX(lesson_id) as lesson_id,
                SUM(views) as total_views,
                SUM(completions) as total_completions,
                GROUP_CONCAT(drop_off_beat) as drop_off_beats
         FROM engagement
         WHERE course_id = ? AND date >= ?
         GROUP BY piece_id
         ORDER BY piece_id`,
      )
      .bind(courseId, sinceStr)
      .all<{
        piece_id: string;
        lesson_id: string;
        total_views: number;
        total_completions: number;
        drop_off_beats: string | null;
      }>();

    const metrics: LessonMetric[] = result.results.map((r) => ({
      lessonId: r.lesson_id,
      pieceId: r.piece_id,
      views: r.total_views,
      completions: r.total_completions,
      completionRate: r.total_views > 0 ? Math.round((r.total_completions / r.total_views) * 100) : 0,
    }));

    const totalViews = metrics.reduce((sum, m) => sum + m.views, 0);
    const totalCompletions = metrics.reduce((sum, m) => sum + m.completions, 0);
    const overallCompletionRate = totalViews > 0 ? Math.round((totalCompletions / totalViews) * 100) : 0;

    const underperforming: UnderperformingLesson[] = result.results
      .filter((r) => r.total_views >= 10 && (r.total_completions / r.total_views) < 0.5)
      .map((r) => {
        const rate = Math.round((r.total_completions / r.total_views) * 100);
        const mostCommonDropOff = r.drop_off_beats
          ?.split(',')
          .filter(Boolean)
          .reduce((acc: Record<string, number>, beat: string) => {
            acc[beat] = (acc[beat] || 0) + 1;
            return acc;
          }, {});
        const topDropOff = mostCommonDropOff
          ? Object.entries(mostCommonDropOff).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
          : null;

        return {
          lessonId: r.lesson_id,
          pieceId: r.piece_id,
          views: r.total_views,
          completions: r.total_completions,
          completionRate: rate,
          dropOffBeat: topDropOff,
          reason: rate < 30
            ? 'Very low completion rate'
            : topDropOff
              ? `Sharp drop-off at beat: ${topDropOff}`
              : 'Below average completion',
        };
      });

    const topLessons = [...metrics]
      .filter((m) => m.views >= 5)
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    const report: EngagementReport = {
      courseId, underperformingLessons: underperforming, topLessons,
      totalViews, totalCompletions, overallCompletionRate,
    };

    this.setState({ ...this.state, lastReport: report });
    return report;
  }

  // --- Learning extraction ---

  // Currently unreachable — intended for a future engagement-trigger path; revisit once analysePiecePostPublish shows whether engagement-driven analysis is needed at all. See LLM-SURFACE audit priority 7 (2026-05-10).
  /** Analyse an underperforming piece and extract learnings for future pieces */
  async analyseAndLearn(lessonData: UnderperformingLesson): Promise<EngagementLearning> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: LEARNER_ANALYSE_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Underperforming piece
- Piece: ${lessonData.lessonId}
- Completion rate: ${lessonData.completionRate}%
- Views: ${lessonData.views}
- Drop-off beat: ${lessonData.dropOffBeat ?? 'unknown'}
- Problem: ${lessonData.reason}

Extract learnings for future pieces. What should the Drafter do differently next time?`,
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings: string[] };
    try {
      parsed = extractJson<{ learnings: string[] }>(text);
    } catch {
      parsed = { learnings: [] };
    }

    // Piece attribution at multi-per-day: `lessonData.pieceId` comes
    // directly from the engagement row (migration 0017 made piece_id
    // part of engagement's PK), so no date-based lookup is needed.
    // piece_date derives from the matching daily_pieces row for the
    // pieceDate column on learnings. Same defensive skip on missing
    // piece as before — silent drop, Drafter never sees garbage.
    const pieceRow = await this.env.DB
      .prepare('SELECT date FROM daily_pieces WHERE id = ? LIMIT 1')
      .bind(lessonData.pieceId)
      .first<{ date: string }>();
    const pieceDate = pieceRow?.date ?? null;

    if (pieceDate && lessonData.pieceId) {
      for (const learning of parsed.learnings) {
        try {
          await writeLearning(
            this.env.DB,
            'engagement',
            learning,
            {
              lessonId: lessonData.lessonId,
              completionRate: lessonData.completionRate,
              dropOffBeat: lessonData.dropOffBeat,
            },
            70,
            'reader',
            pieceDate,
            lessonData.pieceId,
          );
        } catch { /* learning write shouldn't break */ }
      }
    }

    this.setState({ ...this.state, learningsWritten: this.state.learningsWritten + parsed.learnings.length });

    return {
      lessonId: lessonData.lessonId,
      problem: lessonData.reason,
      learnings: parsed.learnings,
    };
  }

  // --- Producer-side post-publish analysis (P1.3) ---

  /**
   * Read the full pipeline record for a just-published piece and write
   * producer-origin learnings. Called off-pipeline after Publisher's
   * `publishing done` so it never blocks a ship.
   *
   * Non-retriable by design: if any step throws (DB read, Claude call,
   * JSON parse), Director catches and logs to observer_events. The
   * piece is already live; a missed batch of learnings isn't
   * catastrophic and retry logic is exactly the kind of defensive
   * code that turns into mystery failures later.
   */
  async analysePiecePostPublish(pieceId: string, date: string): Promise<PostPublishResult> {
    // ── 1. Read the piece's full quality record ──────────────────
    // Keyed by piece_id (cadence Phase 5) so at multi-per-day we pull
    // THIS piece's metadata, not an arbitrary same-date row.
    const piece = await this.env.DB
      .prepare(
        `SELECT headline, underlying_subject, source_story,
                voice_score, fact_check_passed, quality_flag,
                published_at
         FROM daily_pieces WHERE id = ? LIMIT 1`,
      )
      .bind(pieceId)
      .first<{
        headline: string;
        underlying_subject: string;
        source_story: string;
        voice_score: number | null;
        fact_check_passed: number | null;
        quality_flag: string | null;
        published_at: number | null;
      }>();

    if (!piece) {
      throw new Error(`analysePiecePostPublish: no daily_pieces row for id ${pieceId}`);
    }

    // All three day-keyed tables now carry `piece_id` (migration 0018
    // + 0014). Scope by piece_id directly — no more time-window
    // heuristic. Multi-per-day isolation is exact. See DECISIONS
    // 2026-04-22 "piece_id columns on day-keyed tables".
    const auditsRes = await this.env.DB
      .prepare(
        `SELECT auditor, passed, score, notes, created_at
         FROM audit_results
         WHERE piece_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(pieceId)
      .all<{ auditor: string; passed: number; score: number | null; notes: string | null; created_at: number }>();

    const candsRes = await this.env.DB
      .prepare(
        `SELECT headline, source, teachability_score, selected
         FROM daily_candidates
         WHERE piece_id = ?
         ORDER BY selected DESC, teachability_score DESC
         LIMIT 8`,
      )
      .bind(pieceId)
      .all<{ headline: string; source: string; teachability_score: number | null; selected: number }>();

    const logRes = await this.env.DB
      .prepare(
        `SELECT step, status, data, created_at
         FROM pipeline_log
         WHERE piece_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(pieceId)
      .all<{ step: string; status: string; data: string | null; created_at: number }>();

    // Recent interactives' engagement — Phase 4.2. THIS piece's
    // own interactives haven't published yet (Generator runs on a
    // separate post-publish alarm) and have zero engagement; the
    // rollup is necessarily across PRIOR pieces. Learnings derived
    // from it inform FUTURE pieces (same shape as Drafter's
    // getRecentLearnings loop). started/viewed ratio measures
    // "did the reader scroll deep enough to see the HTML
    // interactive?"; started/completed measures "did the quiz hold
    // attention?".
    const engagementWindowMs = 14 * 24 * 60 * 60 * 1000;
    const engagementSinceMs = Date.now() - engagementWindowMs;
    const engagementRes = await this.env.DB
      .prepare(
        `SELECT i.slug, i.type, i.title, i.quality_flag, i.voice_score,
                SUM(CASE WHEN ie.event_type = 'viewed'    THEN 1 ELSE 0 END) AS views,
                SUM(CASE WHEN ie.event_type = 'started'   THEN 1 ELSE 0 END) AS starts,
                SUM(CASE WHEN ie.event_type = 'completed' THEN 1 ELSE 0 END) AS completions,
                COUNT(DISTINCT ie.user_id) AS unique_users,
                AVG(CASE WHEN ie.event_type = 'completed' THEN ie.score END) AS avg_score
         FROM interactives i
         LEFT JOIN interactive_engagement ie ON ie.interactive_id = i.id
         WHERE i.published_at >= ?
         GROUP BY i.id
         ORDER BY i.published_at DESC
         LIMIT 20`,
      )
      .bind(engagementSinceMs)
      .all<{
        slug: string;
        type: string;
        title: string;
        quality_flag: string | null;
        voice_score: number | null;
        views: number;
        starts: number;
        completions: number;
        unique_users: number;
        avg_score: number | null;
      }>();

    // ── 2. Build a compact, readable context for Claude ──────────
    const roundsCount = logRes.results.filter((r) => r.step.startsWith('auditing_') && r.status === 'done').length;
    const pickedCandidate = candsRes.results.find((c) => c.selected === 1);
    const skipped = candsRes.results.filter((c) => c.selected === 0).slice(0, 5);

    const engagementBlock = engagementRes.results.length === 0
      ? '(no engagement data in window)'
      : engagementRes.results.map((e) => {
          const flag = e.quality_flag === 'low' ? ' (flagged low)' : '';
          const avg = e.avg_score == null ? '—' : e.avg_score.toFixed(1);
          return `- [${e.type}] "${e.title}"${flag} — views=${e.views} starts=${e.starts} completions=${e.completions} users=${e.unique_users} avgScore=${avg}`;
        }).join('\n');

    const context = `## Piece
- Date: ${date}
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlying_subject}
- Source story: ${piece.source_story}
- Final voice score: ${piece.voice_score ?? 'unknown'}/100
- Fact-check passed: ${piece.fact_check_passed ? 'yes' : 'no'}
- Quality flag: ${piece.quality_flag ?? 'none'}
- Revision rounds: ${Math.max(0, roundsCount - 1)}

## Candidate Curator picked
${pickedCandidate ? `"${pickedCandidate.headline}" (${pickedCandidate.source}, teachability ${pickedCandidate.teachability_score ?? '—'})` : '(picked candidate not found in daily_candidates)'}

## Top skipped candidates (what Curator passed on)
${skipped.length === 0 ? '(none)' : skipped.map((c) => `- "${c.headline}" (${c.source}, teachability ${c.teachability_score ?? '—'})`).join('\n')}

## Audit results (in order)
${auditsRes.results.length === 0 ? '(no audit_results rows)' : auditsRes.results.map((a) => {
  const verdict = a.passed ? 'passed' : 'failed';
  const scoreStr = a.score == null ? '' : ` score=${a.score}`;
  const notes = (a.notes ?? '').slice(0, 1500);
  return `- ${a.auditor} ${verdict}${scoreStr}\n  notes: ${notes}`;
}).join('\n')}

## Recent interactive engagement (last 14 days, prior pieces)
${engagementBlock}

## Pipeline timeline (step — status)
${logRes.results.map((r) => `- ${r.step} — ${r.status}`).join('\n')}`;

    // ── 3. Ask Claude for producer-side learnings ────────────────
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const callStart = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 800,
      system: LEARNER_POST_PUBLISH_PROMPT,
      messages: [{ role: 'user', content: context }],
    });
    const durationMs = Date.now() - callStart;
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings?: ProducerLearning[] };
    try {
      parsed = extractJson<typeof parsed>(text);
    } catch {
      parsed = { learnings: [] };
    }
    const all: ProducerLearning[] = Array.isArray(parsed.learnings) ? parsed.learnings : [];

    // ── 4. Cap writes + log overflow signal back to caller ───────
    const toWrite = all.slice(0, PRODUCER_LEARNINGS_WRITE_CAP);
    const overflowCount = Math.max(0, all.length - PRODUCER_LEARNINGS_WRITE_CAP);

    let written = 0;
    for (const l of toWrite) {
      if (!l?.observation) continue;
      const category = normalizeProducerCategory(l.category);
      try {
        await writeLearning(
          this.env.DB,
          category,
          l.observation,
          { date, phase: 'post-publish', voiceScore: piece.voice_score, rounds: Math.max(0, roundsCount - 1) },
          60,
          'producer',
          date,
          pieceId,
        );
        written += 1;
      } catch {
        // per-row write failure isn't fatal — the others still land
      }
    }

    this.setState({
      ...this.state,
      learningsWritten: this.state.learningsWritten + written,
    });

    return { date, written, overflowCount, considered: all.length, tokensIn, tokensOut, durationMs };
  }

  /**
   * Read a day's Zita conversations and extract reader-question
   * learnings — "what readers struggled with, misread, or asked
   * beyond the piece" patterns. Scheduled by Director at 01:45 UTC on
   * day+1 (so the full day of reader traffic has accumulated against
   * the prior day's piece) rather than at publish+1h like Learner's
   * producer-side analysis: Zita synthesis needs reader traffic,
   * which takes a day. See DECISIONS 2026-04-21 "P1.5 Learner
   * skeleton".
   *
   * Guarded no-op below ZITA_SYNTHESIS_MIN_USER_MESSAGES — returns
   * skipped=true so Director can log a metered skip without firing
   * a Claude call. This matters because the publication cadence
   * outruns reader-traffic accumulation at current scale (3 users
   * across 5 pieces as of 2026-04-21); firing Claude on thin signal
   * would produce noise, not patterns.
   *
   * Non-retriable on failure (same posture as analysePiecePostPublish
   * and reflect): Director catches, logs via observer, moves on.
   */
  async analyseZitaPatternsDaily(pieceId: string, date: string): Promise<ZitaSynthesisResult> {
    const started = Date.now();

    // ── 1. Pull the conversations for this piece ─────────────────
    // Scoped by piece_id (cadence Phase 6). `date` is retained on the
    // signature for logging/return-value shape compatibility only —
    // all D1 filters use piece_id to avoid cross-piece pooling at
    // multi-per-day cadence. zita_messages.piece_id was backfilled
    // 100% during cadence Phase 1 so every pre-Phase-1 row has it.
    const msgsRes = await this.env.DB
      .prepare(
        `SELECT user_id, role, content, created_at
         FROM zita_messages WHERE piece_id = ? ORDER BY created_at ASC`,
      )
      .bind(pieceId)
      .all<{ user_id: string; role: 'user' | 'assistant'; content: string; created_at: number }>();

    const messages = msgsRes.results;
    const userMsgCount = messages.filter((m) => m.role === 'user').length;

    // ── 2. Insufficient-traffic guard ───────────────────────────
    if (userMsgCount < ZITA_SYNTHESIS_MIN_USER_MESSAGES) {
      return {
        date,
        skipped: true,
        userMsgCount,
        written: 0,
        overflowCount: 0,
        considered: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
      };
    }

    // ── 3. Pull piece metadata for the prompt's context block ────
    // Piece-id keyed (cadence Phase 6) so at multi-per-day we pull THIS
    // piece's metadata, not an arbitrary same-date row.
    const piece = await this.env.DB
      .prepare(
        `SELECT headline, underlying_subject
         FROM daily_pieces WHERE id = ? LIMIT 1`,
      )
      .bind(pieceId)
      .first<{ headline: string; underlying_subject: string | null }>();

    // ── 4. Build a compact, conversation-grouped context ─────────
    const byUser = new Map<string, typeof messages>();
    for (const m of messages) {
      if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
      byUser.get(m.user_id)!.push(m);
    }
    const convoBlocks: string[] = [];
    let convoIdx = 0;
    for (const [, convo] of byUser) {
      convoIdx += 1;
      const lines = convo.map((m) => `${m.role === 'user' ? 'Reader' : 'Zita'}: ${m.content}`).join('\n');
      convoBlocks.push(`### Conversation ${convoIdx} (${convo.length} turns)\n${lines}`);
    }

    const context = `## Piece
- Date: ${date}
- Headline: "${piece?.headline ?? '(no daily_pieces row — piece may have been deleted)'}"
- Underlying subject: ${piece?.underlying_subject ?? 'unknown'}

## Zita conversations
Total: ${byUser.size} reader${byUser.size === 1 ? '' : 's'}, ${messages.length} messages (${userMsgCount} from readers).

${convoBlocks.join('\n\n')}`;

    // ── 5. Ask Claude for Zita-side learnings ───────────────────
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: LEARNER_ZITA_PROMPT,
      messages: [{ role: 'user', content: context }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings?: ProducerLearning[] };
    try {
      parsed = extractJson<typeof parsed>(text);
    } catch {
      parsed = { learnings: [] };
    }
    const all: ProducerLearning[] = Array.isArray(parsed.learnings) ? parsed.learnings : [];

    // ── 6. Cap writes + return overflow to Director ─────────────
    const toWrite = all.slice(0, ZITA_LEARNINGS_WRITE_CAP);
    const overflowCount = Math.max(0, all.length - ZITA_LEARNINGS_WRITE_CAP);

    let written = 0;
    for (const l of toWrite) {
      if (!l?.observation) continue;
      const category = normalizeProducerCategory(l.category);
      try {
        await writeLearning(
          this.env.DB,
          category,
          l.observation,
          {
            date,
            phase: 'zita-synthesis',
            readerCount: byUser.size,
            userMsgCount,
            totalMsgCount: messages.length,
          },
          60,
          'zita',
          date,
          pieceId,
        );
        written += 1;
      } catch {
        // per-row write failure isn't fatal
      }
    }

    this.setState({
      ...this.state,
      learningsWritten: this.state.learningsWritten + written,
    });

    return {
      date,
      skipped: false,
      userMsgCount,
      written,
      overflowCount,
      considered: all.length,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      durationMs: Date.now() - started,
    };
  }
}
