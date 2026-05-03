import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { VOICE_PASS_THRESHOLD } from './shared/audit-thresholds';
import { buildVoiceAuditorSystem } from './voice-auditor-prompt';

export interface VoiceAuditResult {
  passed: boolean;
  score: number; // 0-100
  violations: string[];
  suggestions: string[];
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

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: buildVoiceAuditorSystem(),
      messages: [{ role: 'user', content: `Audit this draft:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = extractJson<VoiceAuditResult>(text);
    result.passed = result.score >= VOICE_PASS_THRESHOLD;
    this.setState({ lastResult: result });
    return result;
  }
}
