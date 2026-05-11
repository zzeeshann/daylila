import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  CuratorState,
  CuratorResult,
  CuratorRejection,
  DailyCandidate,
  DailyPieceBrief,
  PickDomain,
} from './types';
import { PICK_DOMAINS } from './types';
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
    recentDomainCounts: Array<{ domain: string; count: number }> = [],
  ): Promise<CuratorResult> {
    this.setState({ ...this.state, status: 'curating', error: null });

    try {
      const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

      // Streaming, not messages.create. Cloudflare Workers' fetch
      // subrequest closes after ~125s of idle (no body bytes received).
      // Curator's ~4.8k output tokens take ~120s of Sonnet 4.5
      // generation; non-streaming holds the whole response until done,
      // CF sees nothing during that window, sends 499 Client
      // disconnected, SDK retries 3× × $0.18 = $0.54 burned per click.
      // Streaming receives tokens incrementally so the connection
      // never goes idle. See DECISIONS 2026-05-09 "Curator 124s 499
      // timeout regression".
      const callStart = Date.now();
      const response = await client.messages.stream({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        system: CURATOR_PROMPT,
        messages: [{ role: 'user', content: buildCuratorPrompt(candidates, recentPieces, recentCategoryCounts, recentDomainCounts) }],
      }).finalMessage();
      const durationMs = Date.now() - callStart;
      const tokensIn = response.usage?.input_tokens ?? 0;
      const tokensOut = response.usage?.output_tokens ?? 0;

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      const parsed = extractJson<DailyPieceBrief & {
        skip?: boolean;
        reason?: string;
        selectedCandidateId?: string;
        pickReasoning?: string;
        pickDomain?: string;
        rejections?: Array<{ id: string; rejectionCategory: string; rejectionReason?: string }>;
      }>(text);

      if (parsed.skip) {
        this.setState({ ...this.state, status: 'idle' });
        return {
          skip: true,
          reason: parsed.reason ?? 'No teachable stories today',
          tokensIn,
          tokensOut,
          durationMs,
        };
      }

      const {
        skip: _skip,
        reason: _reason,
        selectedCandidateId,
        pickReasoning,
        pickDomain: rawDomain,
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

      // Validate pickDomain against the closed enum. Drift (Claude
      // returning a domain not in the bullet list at curator-contract.md
      // lines 19-28) falls to 'unknown' so it's queryable post-deploy
      // rather than dropping the row. Director persists the result;
      // missing values stay null. Same fence-at-the-writer posture as
      // RejectionCategory.
      const pickDomain: PickDomain | undefined =
        typeof rawDomain === 'string' && PICK_DOMAINS.has(rawDomain as PickDomain)
          ? (rawDomain as PickDomain)
          : typeof rawDomain === 'string' && rawDomain.trim() !== ''
            ? 'unknown'
            : undefined;

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
        pickDomain,
        rejections,
        tokensIn,
        tokensOut,
        durationMs,
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
