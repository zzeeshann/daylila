import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, StructureFailureReason } from './types';
import { STRUCTURE_FAILURE_REASONS } from './types';
import { extractJson } from './shared/parse-json';
import { STRUCTURE_EDITOR_PROMPT } from './structure-editor-prompt';

export interface StructureAuditResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
  /** Foundation Fix Task 08 PR 08c (2026-05-07). Closed-enum tokens
   *  for the structure failure kinds the auditor flagged. Empty array
   *  on pass. Validated against STRUCTURE_FAILURE_REASONS at parse
   *  time — unknown tokens drop, the count surfaces via parseError. */
  failureReasons: StructureFailureReason[];
  parseError?: string | null;
  /** Per-call usage. Director forwards to observer.logLLMCall. */
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface StructureEditorState {
  lastResult: StructureAuditResult | null;
}

/**
 * StructureEditorAgent — reviews beat structure, pacing, length, hook, close.
 * Returns "approve" or specific revision notes.
 */
export class StructureEditorAgent extends Agent<Env, StructureEditorState> {
  initialState: StructureEditorState = { lastResult: null };

  async review(mdx: string): Promise<StructureAuditResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const callStart = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      system: STRUCTURE_EDITOR_PROMPT,
      messages: [{ role: 'user', content: `Review this lesson structure:\n\n${mdx}` }],
    });
    const durationMs = Date.now() - callStart;
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';

    // Resilient parse. See voice-auditor.ts for the full rationale —
    // before 2026-05-11 a truncated / malformed JSON response would
    // throw out of extractJson, propagate to Director, and kill the
    // whole pipeline run. Now: parse-fail returns a soft-fail
    // (passed=false, empty arrays, parseError populated) so Director
    // treats the round as a fail and Integrator revises in the next
    // round. The pipeline survives the auditor's own format wobble.
    let raw: StructureAuditResult & { failure_reasons?: unknown };
    try {
      raw = extractJson<StructureAuditResult & { failure_reasons?: unknown }>(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: StructureAuditResult = {
        passed: false,
        issues: [],
        suggestions: [],
        failureReasons: [],
        parseError: `Structure editor response did not parse as JSON (likely truncation): ${message}`,
        tokensIn,
        tokensOut,
        durationMs,
      };
      this.setState({ lastResult: result });
      return result;
    }

    // Validate failure_reasons against the closed enum. Same posture
    // as VoiceAuditor (Task 08 PR 08c) and Task 06's IntegratorDecision.
    const rawReasons = Array.isArray(raw.failure_reasons) ? raw.failure_reasons : [];
    const failureReasons: StructureFailureReason[] = [];
    let droppedCount = 0;
    for (const token of rawReasons) {
      if (typeof token === 'string' && STRUCTURE_FAILURE_REASONS.has(token as StructureFailureReason)) {
        failureReasons.push(token as StructureFailureReason);
      } else {
        droppedCount += 1;
      }
    }

    const result: StructureAuditResult = {
      passed: !!raw.passed,
      issues: Array.isArray(raw.issues) ? raw.issues : [],
      suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
      failureReasons,
      parseError: droppedCount > 0
        ? `Structure editor dropped ${droppedCount} unknown failure_reason token(s) from the response`
        : null,
      tokensIn,
      tokensOut,
      durationMs,
    };

    // Learnings are NOT written here. Learner.analysePiecePostPublish reads
    // audit_results post-publish and synthesises producer-origin learnings
    // from the full quality record in lesson-shaped prose — that subsumes
    // the signal this audit produces. See DECISIONS 2026-04-20 "Drop
    // StructureEditor's writeLearning calls".
    this.setState({ lastResult: result });
    return result;
  }
}
