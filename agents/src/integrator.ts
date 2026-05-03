import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { buildIntegratorSystem } from './integrator-prompt';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

export interface IntegrationResult {
  revisedMdx: string;
  changesSummary: string[];
}

/**
 * IntegratorAgent — takes audit feedback from all three gates,
 * synthesises it, and revises the draft. Submits back for re-audit.
 * Max 3 revision passes before escalation.
 *
 * Stateless — Director spawns a fresh instance per day
 * (integrator-daily-${today}) so each day's pipeline runs against a
 * clean DO.
 */
export class IntegratorAgent extends Agent<Env> {
  async revise(
    mdx: string,
    voiceResult: VoiceAuditResult,
    structureResult: StructureAuditResult,
    factResult: FactCheckResult,
  ): Promise<IntegrationResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    // Collect all feedback
    const feedback: string[] = [];

    if (!voiceResult.passed) {
      feedback.push('## Voice issues (score: ' + voiceResult.score + '/100)');
      voiceResult.violations.forEach((v) => feedback.push(`- VIOLATION: ${v}`));
      voiceResult.suggestions.forEach((s) => feedback.push(`- FIX: ${s}`));
    }

    if (!structureResult.passed) {
      feedback.push('## Structure issues');
      structureResult.issues.forEach((i) => feedback.push(`- ISSUE: ${i}`));
      structureResult.suggestions.forEach((s) => feedback.push(`- FIX: ${s}`));
    }

    if (!factResult.passed) {
      feedback.push('## Fact issues');
      factResult.claims
        .filter((c) => c.status !== 'verified')
        .forEach((c) => feedback.push(`- ${c.status.toUpperCase()}: "${c.claim}" — ${c.note}`));
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: buildIntegratorSystem(),
      messages: [
        {
          role: 'user',
          content: `## Original draft:\n\n${mdx}\n\n## Feedback from auditors:\n\n${feedback.join('\n')}`,
        },
      ],
    });

    const revisedMdx = response.content[0].type === 'text' ? response.content[0].text : mdx;

    return {
      revisedMdx,
      changesSummary: feedback,
    };
  }
}
