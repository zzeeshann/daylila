import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, DrafterState, DrafterResult, DailyPieceBrief } from './types';
import {
  DRAFTER_PROMPT,
  DRAFTER_REFLECTION_PROMPT,
  buildDrafterPrompt,
  buildDrafterReflectionPrompt,
} from './drafter-prompt';
import { VOICE_CONTRACT } from './shared/generated/contracts';
import { getRecentLearnings, writeLearning, type Learning } from './shared/learnings';
import { extractJson } from './shared/parse-json';

/** Cap on self-reflection learnings written per run. Same as the
 *  producer-side cap in Learner for consistency — if the reflection
 *  call produces more than this, the prompt is restating the same
 *  pattern and tightening is warranted. Overflow logged to
 *  observer_events by Director, not silently dropped. */
const REFLECTION_WRITE_CAP = 10;

interface ReflectionLearning {
  category: string;
  observation: string;
}

function normalizeReflectionCategory(
  c: string,
): 'voice' | 'structure' | 'engagement' | 'fact' {
  const k = (c ?? '').toLowerCase().trim();
  if (k === 'voice') return 'voice';
  if (k === 'structure') return 'structure';
  if (k === 'engagement') return 'engagement';
  if (k === 'fact') return 'fact';
  return 'structure';
}

/** Result of a post-publish self-reflection call — surfaced back to
 *  Director so it can meter cost + latency into observer_events. This
 *  is the one Sonnet call in the pipeline that doesn't gate anything,
 *  so we want visibility on what it costs over time. */
export interface ReflectionResult {
  date: string;
  written: number;
  overflowCount: number;
  considered: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

/**
 * DrafterAgent — writes the MDX for a daily piece from a brief.
 *
 * Responsibility (one job):
 *   Given a DailyPieceBrief, produce MDX using the
 *   <lesson-shell> / <lesson-beat> format.
 *
 * Does NOT pick the story — that is Curator's job.
 * Does NOT orchestrate — that is Director's job.
 * Does NOT audit its own output — that is the auditors' job.
 *
 * Forces brief.date into the MDX frontmatter so Claude's own
 * generated date can never drift from the orchestrator's run date.
 */
export class DrafterAgent extends Agent<Env, DrafterState> {
  initialState: DrafterState = {
    status: 'idle',
    lastDraft: null,
    error: null,
  };

  async draft(brief: DailyPieceBrief, pieceId: string, runId: string | null = null): Promise<DrafterResult> {
    this.setState({ ...this.state, status: 'drafting', error: null });

    try {
      const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

      // Pull recent learnings so the Drafter writes in light of what prior
      // pieces taught us. Fail-open: a DB hiccup must not block a draft.
      // The call ALSO writes a load event back to each row's
      // `loaded_at` + `load_count` (intentional side-effect; see
      // getRecentLearnings doc-comment). The IDs surface in
      // DrafterResult.loadedLearningIds so Director's success-path
      // UPDATE can attribute this piece's id to applied_to_prompts.
      let learnings: Learning[] = [];
      try {
        learnings = await getRecentLearnings(this.env.DB, 10);
      } catch {
        learnings = [];
      }
      const loadedLearningIds = learnings.map((l) => l.id);

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        system: DRAFTER_PROMPT,
        messages: [{ role: 'user', content: buildDrafterPrompt(brief, VOICE_CONTRACT, learnings) }],
      });

      let mdx = response.content[0].type === 'text' ? response.content[0].text : '';
      // Force correct date in frontmatter (Claude may generate a different date)
      mdx = mdx.replace(/^(date:\s*)"?\d{4}-\d{2}-\d{2}"?/m, `$1"${brief.date}"`);
      const wordCount = mdx.split(/\s+/).length;

      this.setState({
        ...this.state,
        status: 'idle',
        lastDraft: { headline: brief.headline, date: brief.date, wordCount },
      });

      // Round-0 persistence (Foundation Fix Task 06, L4). The MDX above
      // is the source of truth Director hands to the audit-revise loop;
      // this row preserves it so the revision history can be reconstructed
      // independent of git's final-only record. Fail-open via persistError
      // sentinel — a D1 hiccup must not block a publish (the audit-revise
      // loop runs PRE-publish but uses `mdx` from the return value
      // directly, not from D1). Director reads persistError after the
      // call and fires observer.logError once if populated.
      const persistError = await this.persistInitialDraft(pieceId, runId, mdx, wordCount);

      return { mdx, wordCount, loadedLearningIds, persistError };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Drafter failed';
      this.setState({ ...this.state, status: 'error', error: message });
      throw err;
    }
  }

  /**
   * Persist the initial-draft MDX to draft_revisions as round 0.
   *
   * Always one row per call. UNIQUE(piece_id, revision_round) guards
   * against duplicate writes if the alarm path ever re-invokes draft()
   * for the same piece — a constraint violation surfaces as a write
   * error rather than a silent double-record, and the persistError
   * sentinel carries it back to Director for one observer event.
   *
   * Foundation Fix Task 06 (L4). Mirrors AudioAuditorAgent.persistAuditRows
   * — same DO, same this.env.DB pattern, same fail-open posture.
   */
  private async persistInitialDraft(
    pieceId: string,
    runId: string | null,
    mdx: string,
    wordCount: number,
  ): Promise<string | null> {
    try {
      await this.env.DB
        .prepare(
          `INSERT INTO draft_revisions
            (piece_id, revision_round, mdx_content, word_count, authored_by, created_at, run_id)
           VALUES (?, 0, ?, ?, 'drafter', ?, ?)`,
        )
        .bind(pieceId, mdx, wordCount, Date.now(), runId)
        .run();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'draft_revisions round-0 persist failed';
    }
  }

  getStatus(): DrafterState {
    return this.state;
  }

  /**
   * Post-publish self-reflection (P1.4).
   *
   * Fires off-pipeline via Director's `reflectOnPieceScheduled` alarm
   * right after `publishing done`. The model evaluates the final MDX
   * as a peer-editor role would — the prompt explicitly names the
   * stateless reality so the call doesn't LARP remembered struggle.
   *
   * Writes up to REFLECTION_WRITE_CAP learnings with
   * `source='self-reflection'`. Returns the counts plus cost/latency
   * so Director can meter the call. Caller's responsibility to catch
   * errors and log to observer_events; this method throws on failure
   * rather than swallowing, so upstream can honour the "fail = log
   * and move on" posture without hiding root cause.
   */
  async reflect(
    brief: DailyPieceBrief,
    mdx: string,
    date: string,
    pieceId: string,
  ): Promise<ReflectionResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const start = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: DRAFTER_REFLECTION_PROMPT,
      messages: [{ role: 'user', content: buildDrafterReflectionPrompt(brief, mdx) }],
    });
    const durationMs = Date.now() - start;

    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings?: ReflectionLearning[] };
    try {
      parsed = extractJson<typeof parsed>(text);
    } catch {
      parsed = { learnings: [] };
    }
    const all: ReflectionLearning[] = Array.isArray(parsed.learnings) ? parsed.learnings : [];

    const toWrite = all.slice(0, REFLECTION_WRITE_CAP);
    const overflowCount = Math.max(0, all.length - REFLECTION_WRITE_CAP);

    let written = 0;
    for (const l of toWrite) {
      if (!l?.observation) continue;
      const category = normalizeReflectionCategory(l.category);
      try {
        await writeLearning(
          this.env.DB,
          category,
          l.observation,
          { date, phase: 'self-reflection' },
          60,
          'self-reflection',
          date,
          pieceId,
        );
        written += 1;
      } catch {
        // per-row write failure isn't fatal — others still land
      }
    }

    return { date, written, overflowCount, considered: all.length, tokensIn, tokensOut, durationMs };
  }
}
