import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, VoiceFailureReason } from './types';
import { VOICE_FAILURE_REASONS } from './types';
import { extractJson } from './shared/parse-json';
import { VOICE_PASS_THRESHOLD } from './shared/audit-thresholds';
import { buildVoiceAuditorSystem } from './voice-auditor-prompt';

export interface VoiceAuditResult {
  passed: boolean;
  score: number; // 0-100
  violations: string[];
  suggestions: string[];
  /** Foundation Fix Task 08 PR 08c (2026-05-07). Closed-enum tokens
   *  for the failure-reason kinds the auditor flagged. Empty array on
   *  pass. Validated against VOICE_FAILURE_REASONS at parse time —
   *  unknown tokens drop, the count surfaces via parseError. */
  failureReasons: VoiceFailureReason[];
  /** Populated when Claude's response was missing or contained
   *  invalid failure-reason tokens. Director logs once per audit if
   *  set. Same drop-with-visibility posture as Task 06's
   *  IntegratorDecision parse path. */
  parseError?: string | null;
  /** Per-call usage. Director forwards to observer.logLLMCall. */
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface VoiceAuditorState {
  lastResult: VoiceAuditResult | null;
}

/**
 * VoiceAuditorAgent — reviews drafts against the voice contract.
 * Scores 0-100. Must be ≥85 to pass.
 * Flags specific violations (tribe words, flattery, jargon, etc.)
 */
export class VoiceAuditorAgent extends Agent<Env, VoiceAuditorState> {
  initialState: VoiceAuditorState = { lastResult: null };

  async audit(mdx: string): Promise<VoiceAuditResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const callStart = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: buildVoiceAuditorSystem(),
      messages: [{ role: 'user', content: `Audit this draft:\n\n${mdx}` }],
    });
    const durationMs = Date.now() - callStart;
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const raw = extractJson<VoiceAuditResult & { failure_reasons?: unknown }>(text);

    // Validate failure_reasons against the closed enum. Unknown tokens
    // drop with the count surfaced via parseError; the verdict
    // (score / violations / suggestions) is preserved unchanged.
    // Same posture as Task 06's IntegratorDecision parse path.
    const rawReasons = Array.isArray(raw.failure_reasons) ? raw.failure_reasons : [];
    const failureReasons: VoiceFailureReason[] = [];
    let droppedCount = 0;
    for (const token of rawReasons) {
      if (typeof token === 'string' && VOICE_FAILURE_REASONS.has(token as VoiceFailureReason)) {
        failureReasons.push(token as VoiceFailureReason);
      } else {
        droppedCount += 1;
      }
    }

    const result: VoiceAuditResult = {
      passed: (raw.score ?? 0) >= VOICE_PASS_THRESHOLD,
      score: raw.score ?? 0,
      violations: Array.isArray(raw.violations) ? raw.violations : [],
      suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
      failureReasons,
      parseError: droppedCount > 0
        ? `Voice auditor dropped ${droppedCount} unknown failure_reason token(s) from the response`
        : null,
      tokensIn,
      tokensOut,
      durationMs,
    };
    this.setState({ lastResult: result });
    return result;
  }
}
