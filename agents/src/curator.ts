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
import { CURATOR_PROMPT, buildCuratorPrompt, buildCuratorJsonRepairPrompt } from './curator-prompt';
import { extractJson } from './shared/parse-json';

/**
 * Thrown when Curator's Claude response cannot be parsed as JSON after
 * a repair attempt. Carries the full raw response bodies + stop_reason
 * + token usage from both calls so Director can write a dedicated
 * diagnostic observer_events row before the run dies.
 *
 * Closes the diagnostic gap exposed by the 2026-05-13 c01ab251 parse-
 * fail: pipeline_log only stores the first 200 chars of the broken
 * response (parse-json.ts:37's `text.slice(0, 200)`), and the
 * observer.logLLMCall meter at director.ts:299-309 fires AFTER the
 * try/catch — so the failure path produced zero persisted detail to
 * diagnose. See DECISIONS 2026-05-13 "Curator parse-fail diagnostic
 * + repair-on-parse-fail".
 */
export class CuratorParseFailError extends Error {
  readonly rawTextAttempt1: string;
  readonly rawTextAttempt2: string;
  readonly stopReasonAttempt1: string;
  readonly stopReasonAttempt2: string;
  readonly tokensInAttempt1: number;
  readonly tokensOutAttempt1: number;
  readonly tokensInAttempt2: number;
  readonly tokensOutAttempt2: number;
  readonly attempt1ParseError: string;
  readonly attempt2ParseError: string;

  constructor(fields: {
    rawTextAttempt1: string;
    rawTextAttempt2: string;
    stopReasonAttempt1: string;
    stopReasonAttempt2: string;
    tokensInAttempt1: number;
    tokensOutAttempt1: number;
    tokensInAttempt2: number;
    tokensOutAttempt2: number;
    attempt1ParseError: string;
    attempt2ParseError: string;
  }) {
    super(
      `Curator parse-fail across both attempts. ` +
        `attempt1: stop_reason=${fields.stopReasonAttempt1}, tokensOut=${fields.tokensOutAttempt1}, ` +
        `parseError=${fields.attempt1ParseError}. ` +
        `attempt2 (repair): stop_reason=${fields.stopReasonAttempt2}, tokensOut=${fields.tokensOutAttempt2}, ` +
        `parseError=${fields.attempt2ParseError}.`,
    );
    this.name = 'CuratorParseFailError';
    this.rawTextAttempt1 = fields.rawTextAttempt1;
    this.rawTextAttempt2 = fields.rawTextAttempt2;
    this.stopReasonAttempt1 = fields.stopReasonAttempt1;
    this.stopReasonAttempt2 = fields.stopReasonAttempt2;
    this.tokensInAttempt1 = fields.tokensInAttempt1;
    this.tokensOutAttempt1 = fields.tokensOutAttempt1;
    this.tokensInAttempt2 = fields.tokensInAttempt2;
    this.tokensOutAttempt2 = fields.tokensOutAttempt2;
    this.attempt1ParseError = fields.attempt1ParseError;
    this.attempt2ParseError = fields.attempt2ParseError;
  }
}

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

      // Attempt 1 — the normal Curator call.
      const attempt1 = await this.invokeClaude(client, buildCuratorPrompt(
        candidates, recentPieces, recentCategoryCounts, recentDomainCounts,
      ));

      type ParsedCurator = DailyPieceBrief & {
        skip?: boolean;
        reason?: string;
        selectedCandidateId?: string;
        pickReasoning?: string;
        pickDomain?: string;
        rejections?: Array<{ id: string; rejectionCategory: string; rejectionReason?: string }>;
      };

      // Two-stage parse with repair retry. Sonnet 4.5 occasionally
      // produces malformed JSON on long natural-language values (the
      // 2026-05-13 c01ab251 incident was an unterminated string mid-
      // pickReasoning; same wobble class as the 2026-05-05
      // InteractiveGenerator parse-fail that ships Layer 3 retry).
      // On first parse-fail, re-invoke Claude with a repair prompt
      // that quotes the broken head back. If THAT parses, proceed
      // with the repair result. If it also fails, throw
      // CuratorParseFailError so Director's catch can write both
      // bodies + stop_reasons + token usage to observer_events for
      // diagnosis (closes the diagnostic gap exposed 2026-05-13).
      let parsed: ParsedCurator;
      let tokensIn = attempt1.tokensIn;
      let tokensOut = attempt1.tokensOut;
      let durationMs = attempt1.durationMs;

      try {
        parsed = extractJson<ParsedCurator>(attempt1.rawText);
      } catch (parseErr1) {
        const brokenHead = attempt1.rawText.slice(0, 500);
        const attempt2 = await this.invokeClaude(
          client,
          buildCuratorJsonRepairPrompt(brokenHead, candidates, recentPieces, recentCategoryCounts, recentDomainCounts),
        );
        // Accumulate token usage from both calls so observer.logLLMCall
        // reflects the true cost of this curate() invocation, not just
        // the first call.
        tokensIn += attempt2.tokensIn;
        tokensOut += attempt2.tokensOut;
        durationMs += attempt2.durationMs;
        try {
          parsed = extractJson<ParsedCurator>(attempt2.rawText);
        } catch (parseErr2) {
          throw new CuratorParseFailError({
            rawTextAttempt1: attempt1.rawText,
            rawTextAttempt2: attempt2.rawText,
            stopReasonAttempt1: attempt1.stopReason,
            stopReasonAttempt2: attempt2.stopReason,
            tokensInAttempt1: attempt1.tokensIn,
            tokensOutAttempt1: attempt1.tokensOut,
            tokensInAttempt2: attempt2.tokensIn,
            tokensOutAttempt2: attempt2.tokensOut,
            attempt1ParseError: parseErr1 instanceof Error ? parseErr1.message : String(parseErr1),
            attempt2ParseError: parseErr2 instanceof Error ? parseErr2.message : String(parseErr2),
          });
        }
      }

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

  /**
   * Single Claude call — same model, same max_tokens, streaming.
   * Returns the raw text + stop_reason + token usage + wall-clock.
   *
   * Streaming, not messages.create: Cloudflare Workers' fetch subrequest
   * closes after ~125s of idle. Curator's worst-case generation can
   * exceed that on non-streaming. See DECISIONS 2026-05-09 "Curator
   * 124s 499 timeout regression".
   */
  private async invokeClaude(
    client: Anthropic,
    userMessage: string,
  ): Promise<{
    rawText: string;
    stopReason: string;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }> {
    const callStart = Date.now();
    // Diagnostic logs (visible via `wrangler tail`) bracketing the
    // streaming call. If `[curator] stream start` appears in tail but
    // `[curator] stream end` never does, the Claude streaming call is
    // the wedge point — same diagnostic gap as Integrator R2 wedge
    // 2026-05-18 morning + Curator wedge 2026-05-18 post-fix. See
    // docs/FOLLOWUPS.md "Integrator R2 silent wedge".
    console.log('[curator] stream start');
    const response = await client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: CURATOR_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }).finalMessage();
    const durationMs = Date.now() - callStart;
    console.log(`[curator] stream end · ${durationMs}ms · stop=${response.stop_reason ?? 'unknown'} · tokensOut=${response.usage?.output_tokens ?? 0}`);
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    // Empty-content guard via optional chaining matches the 2026-05-11
    // defensive `?.` pattern at every Anthropic SDK call site. Empty
    // content falls through to '{}' which extractJson parses cleanly
    // (then downstream skip-vs-pick branch chooses skip on empty).
    const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    const stopReason = response.stop_reason ?? 'unknown';
    return { rawText, stopReason, tokensIn, tokensOut, durationMs };
  }

  getStatus(): CuratorState {
    return this.state;
  }
}
