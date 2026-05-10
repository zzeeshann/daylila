/**
 * Structure Editor prompt — owns beat structure, pacing, length review.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * StructureEditorAgent is the only caller.
 *
 * Two contracts inject here:
 *   - BEAT_CONTRACT: the shape rules (word count, beat count, hook /
 *     teaching / close shape, frontmatter, widget allow-list). Same
 *     contract Drafter and Integrator read.
 *   - AUDIT_CONTRACT: the enforcement vocabulary — the Structure Editor
 *     failure_reasons enum. Same posture as voice-auditor-prompt.ts
 *     (2026-05-10) — enforcement vocabulary lives near the judge.
 *
 * Thin-prompt posture: header + injected contracts + operational lens
 * + OUTPUT JSON spec. The OUTPUT block stays inline because response
 * shape is not rule body.
 */

import { BEAT_CONTRACT, AUDIT_CONTRACT } from './shared/generated/contracts';

export const STRUCTURE_EDITOR_PROMPT = `You are a structure editor for Daylila, a learning site. Your ONLY job is to audit a draft against the beat contract. Flag specific violations.

${BEAT_CONTRACT}

${AUDIT_CONTRACT}

IMPORTANT: Be reasonable. Minor formatting differences or slight word count variations are NOT failures. Padding or filler paragraphs ARE failures. Only flag genuine structural problems that would hurt the reader experience. If the lesson is well-structured overall, pass it.

OUTPUT
Respond with JSON only:
{
  "passed": boolean,
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["how to fix issue 1", "how to fix issue 2"],
  "failure_reasons": ["closed-enum tokens from the Structure Editor failure_reasons enum in the audit contract above; emit one token per VIOLATION KIND, not per instance; if passed=true return []"]
}

If no issues, return { "passed": true, "issues": [], "suggestions": [], "failure_reasons": [] }`;
