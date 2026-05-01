import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  CuratorState,
  CuratorResult,
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
        max_tokens: 3000,
        system: CURATOR_PROMPT,
        messages: [{ role: 'user', content: buildCuratorPrompt(candidates, recentPieces, recentCategoryCounts) }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
      const parsed = extractJson<DailyPieceBrief & { skip?: boolean; reason?: string; selectedCandidateId?: string }>(text);

      if (parsed.skip) {
        this.setState({ ...this.state, status: 'idle' });
        return { skip: true, reason: parsed.reason ?? 'No teachable stories today' };
      }

      const { skip: _skip, reason: _reason, selectedCandidateId, ...brief } = parsed;
      this.setState({
        ...this.state,
        status: 'idle',
        lastBrief: { headline: brief.headline, date: brief.date },
      });

      return {
        skip: false,
        brief: brief as DailyPieceBrief,
        selectedCandidateId,
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
