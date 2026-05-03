/**
 * Fact Checker prompt — single-pass, search-grounded.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * FactCheckerAgent is the only caller.
 *
 * Replaced the two-pass DDG IA prompt on 2026-04-30. The new prompt
 * relies on Anthropic's web_search server tool to verify current-event
 * claims rather than collapsing back to training-data inference.
 *
 * Path A (2026-05-01 evening): dropped the per-claim `sources` field
 * from Claude's JSON shape entirely. Anthropic's web_search response
 * already carries the URLs as auto-attached citation metadata on text
 * blocks; the agent harvests them server-side into a flat
 * FactCheckResult.sources list. Asking Claude to retype URLs into a
 * structured field was redundant — Claude consistently skipped the
 * retype while still using the citation content to write attributive
 * prose. No more retype loop.
 *
 * Foundation Fix Task 02 (2026-05-07): rule body extracted to
 * `content/fact-check-contract.md` and injected via
 * `${FACT_CHECK_CONTRACT}`. The opener sentence + today's-date
 * pointer + OUTPUT JSON spec stay inline (response-shape spec is
 * not rule body — same posture as beats Q5 / audit Q5).
 */

import { FACT_CHECK_CONTRACT } from './shared/generated/contracts';

export const FACT_CHECKER_PROMPT = `You are a fact-checker for Zeemish. Identify every factual claim in a lesson and verify each one against current sources.

${FACT_CHECK_CONTRACT}

CONTEXT
- Today's date is given in the user message.

OUTPUT
After your searches, return JSON ONLY as your final text — no preamble, no commentary, no markdown fences:
{
  "passed": boolean (true if zero "incorrect" — "unverified" is acceptable),
  "claims": [
    {
      "claim": "text",
      "status": "verified|unverified|incorrect",
      "note": "what you searched and found"
    }
  ]
}`;
