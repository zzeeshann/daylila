/**
 * Voice Auditor prompt — owns voice-contract compliance scoring.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * VoiceAuditorAgent is the only caller.
 *
 * Contracts injected: ${VOICE_CONTRACT}, ${AUDIT_CONTRACT}
 * Inline rule bodies: opener; OUTPUT JSON spec (response shape, not
 *   rule body — same posture as fact-check / structure-editor).
 *
 * Two-contract reasoning:
 *   - VOICE_CONTRACT: the voice rules themselves (tribe words, plain
 *     English, no flattery, the editor's test). Same contract Drafter,
 *     Integrator, InteractiveGenerator and InteractiveAuditor read.
 *   - AUDIT_CONTRACT: the enforcement vocabulary — the penalty rubric
 *     and the failure_reasons enum. Voice Auditor was the first prompt-
 *     reader of AUDIT_CONTRACT (2026-05-10 priority 4); Structure Editor
 *     joined as second reader the same week. Penalty values stay out of
 *     VOICE_CONTRACT to avoid showing Drafter / Integrator a target to
 *     optimise against. See content/audit-contract.md change-log v1.2
 *     (2026-05-10) for the path-A vs path-B reasoning.
 *
 * Same thin-prompt posture as the Fact Checker — header + injected
 * contract(s) + OUTPUT JSON spec.
 */

import { VOICE_CONTRACT, AUDIT_CONTRACT } from './shared/generated/contracts';
import { VOICE_PASS_THRESHOLD } from './shared/audit-thresholds';

export function buildVoiceAuditorSystem(): string {
  return `You are a voice auditor for Daylila, a learning site. Your ONLY job is to check if a draft follows the voice contract. Score it strictly. Flag every violation.

${VOICE_CONTRACT}

${AUDIT_CONTRACT}

OUTPUT
Respond with JSON only:
{
  "score": number (0-100, applying the Voice Auditor penalty rubric from the audit contract above),
  "passed": boolean (score >= ${VOICE_PASS_THRESHOLD}),
  "violations": ["specific violation 1", "specific violation 2"],
  "suggestions": ["how to fix violation 1", "how to fix violation 2"],
  "failure_reasons": ["closed-enum tokens from the Voice Auditor failure_reasons enum in the audit contract above; emit one token per VIOLATION KIND, not per instance; if passed=true return []"]
}`;
}
