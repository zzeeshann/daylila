import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  CuratorState,
  CuratorResult,
  CuratorRejection,
  DailyCandidate,
  DailyPieceBrief,
} from './types';
import { CURATOR_PROMPT, buildCuratorPrompt } from './curator-prompt';
import { extractJson } from './shared/parse-json';

/**
 * CuratorAgent — picks the most teachable story from today's candidates
 * and plans its structure (beats, hook, teaching angle).
 *
 * Responsibility (one job):
 *   Given candidates + recent piece history, return a DailyPieceBrief
 *   (or skip, with a reason).
 *
 * Does NOT draft MDX — that is Drafter's job.
 * Does NOT orchestrate — that is Director's job.
 */
export class CuratorAgent extends Agent<Env, CuratorState> {
  initialState: CuratorState = {
    status: 'idle',
    lastBrief: null,
    error: null,
  };

  async curate(
    candidates: DailyCandidate[],
    recentPieces: Array<{ headline: string; underlyingSubject: string }>,
    recentCategoryCounts: Array<{ name: string; count: number }> = [],
  ): Promise<CuratorResult> {
    this.setState({ ...this.state, status: 'curating', error: null });

    try {
      const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        // Bumped 3000 -> 8000 in Foundation Fix Task 03 (2026-05-06) when
        // the response shape grew to include a per-candidate rejections
        // array. ~80 candidates × ~35 tokens (UUID + category) ≈ 2.8k +
        // 5 × one-sentence reason ≈ 150 + pickReasoning ≈ 120 + existing
        // brief shape ≈ 600 ≈ 3.7k. 3000 truncates; 8000 matches the
        // Drafter + Integrator precedent and gives 2× headroom. Curator
        // runs once per pipeline trigger so the output-token cost is
        // negligible.
        max_tokens: 8000,
        system: CURATOR_PROMPT,
        messages: [{ role: 'user', content: buildCuratorPrompt(candidates, recentPieces, recentCategoryCounts) }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = extractJson<DailyPieceBrief & {
        skip?: boolean;
        reason?: string;
        selectedCandidateId?: string;
        pickReasoning?: string;
        rejections?: Array<{ id: string; rejectionCategory: string; rejectionReason?: string }>;
      }>(text);

      if (parsed.skip) {
        this.setState({ ...this.state, status: 'idle' });
        return { skip: true, reason: parsed.reason ?? 'No teachable stories today' };
      }

      const {
        skip: _skip,
        reason: _reason,
        selectedCandidateId,
        pickReasoning,
        rejections: rawRejections,
        ...brief
      } = parsed;

      // Pass rejections through verbatim — Director validates the
      // category against the closed enum and logs the unknown-category
      // count via observer.logError. Curator just shapes the array.
      const rejections: CuratorRejection[] = Array.isArray(rawRejections)
        ? rawRejections
            .filter((r): r is { id: string; rejectionCategory: string; rejectionReason?: string } =>
              typeof r?.id === 'string' && typeof r?.rejectionCategory === 'string',
            )
            .map((r) => ({
              id: r.id,
              // Cast — Director validates against REJECTION_CATEGORIES and
              // skips persistence for any row whose category isn't in the
              // closed enum, so a wrong cast here is fenced downstream.
              rejectionCategory: r.rejectionCategory as CuratorRejection['rejectionCategory'],
              rejectionReason:
                typeof r.rejectionReason === 'string' && r.rejectionReason.trim() !== ''
                  ? r.rejectionReason
                  : undefined,
            }))
        : [];

      this.setState({
        ...this.state,
        status: 'idle',
        lastBrief: { headline: brief.headline, date: brief.date },
      });

      return {
        skip: false,
        brief: brief as DailyPieceBrief,
        selectedCandidateId,
        pickReasoning: typeof pickReasoning === 'string' && pickReasoning.trim() !== '' ? pickReasoning : undefined,
        rejections,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Curator failed';
      this.setState({ ...this.state, status: 'error', error: message });
      throw err;
    }
  }

  getStatus(): CuratorState {
    return this.state;
  }
}
