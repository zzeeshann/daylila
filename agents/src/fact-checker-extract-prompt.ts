/**
 * Fact Checker EXTRACT prompt — Step 1 of the Tavily pre-fetch pipeline.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2). Read only by
 * fact-checker-tavily.ts.
 *
 * Contracts injected: ${FACT_CHECK_CONTRACT}
 * Inline rule bodies: opener sentence; OUTPUT JSON spec; one-line
 *   guidance on what makes a focused search_query (Claude generates
 *   the query, not us — the same evergreen claim across two pieces
 *   should fingerprint identically, so the query MUST be decontextualised).
 *
 * Why a separate Extract step exists: the Tavily re-architecture
 * (2026-05-16) decouples search from Claude's reasoning. Step 1
 * (this prompt) asks Claude to LIST what needs verification + write a
 * focused search query for each. Step 2 hits Tavily per claim. Step 3
 * gives Claude back the snippets and asks for a verdict. This avoids
 * the 105k-token bouncing that Anthropic's web_search server tool
 * caused inside a single Claude call.
 *
 * Output shape:
 *   { claims: [{claim_id, claim_text, search_query}, ...] }
 *
 * claim_id is a stable per-extraction string the agent generates
 * (e.g. "c1", "c2"); the Verify step echoes it back so the agent can
 * thread per-claim verdicts in original order without relying on
 * exact-string match (Claude often paraphrases).
 */

import { FACT_CHECK_CONTRACT } from './shared/generated/contracts';

export const FACT_CHECKER_EXTRACT_PROMPT = `You are the Extract step of Daylila's fact-checker. Your job is to LIST the claims in a lesson and write a focused web-search query for each one. You do NOT verify — that's a later step.

${FACT_CHECK_CONTRACT}

EXTRACT INSTRUCTIONS
- Identify every factual claim that needs external verification. Quantitative claims (numbers, dates, %), named entities (people, places, organisations), and current-event claims (what happened this week) are always in. Definitions of well-established scientific concepts (e.g. "DNA is a double helix") are out — those are textbook knowledge, not verifiable news.
- For each claim, write a DECONTEXTUALISED search_query. The query should be the kind of words a librarian would type into a search box — strip "the article says", "according to scientists", and any narrative prose. Just the topic + the load-bearing specifics.
- Two pieces that share an evergreen claim ("water boils at 100°C at sea level") should produce IDENTICAL search_query strings. This lets the cache hit across pieces. Do NOT include the piece's headline or topic prefix in the query unless it's load-bearing.
- Generate a stable claim_id for each claim: "c1", "c2", "c3" in document order.
- Cap output at 15 claims per draft. If a piece has more, pick the 15 most load-bearing (the ones a reader would call out as "is that true?").
- Empty case: if the draft has NO verifiable factual claims (a pure opinion / personal-essay shape), return { "claims": [] }.

OUTPUT
Return JSON ONLY as your final text — no preamble, no commentary, no markdown fences:
{
  "claims": [
    {
      "claim_id": "c1",
      "claim_text": "verbatim or near-verbatim quote of the claim from the draft",
      "search_query": "focused decontextualised query for Tavily"
    }
  ]
}`;
