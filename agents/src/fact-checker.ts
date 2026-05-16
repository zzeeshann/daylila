import { Agent } from 'agents';
import type { Env, FactFailureReason } from './types';
import { checkViaTavily } from './fact-checker-tavily';

/**
 * Result of fact-checking a draft.
 *
 * Gate semantics: `passed` is true iff no claim is marked `incorrect`.
 * Unverified claims are allowed (asymmetric with voice/structure gates —
 * intentional, since LLMs can flag anything they can't fully confirm).
 *
 * The two boolean flags encode the search leg's state:
 * - `searchUsed: true,  searchAvailable: true`  — Tavily was queried
 *   for at least one claim (most runs). For the pre-2026-05-16
 *   Anthropic path, this meant the SDK invoked web_search at least
 *   once and got results back.
 * - `searchUsed: false, searchAvailable: true`  — every claim resolved
 *   from the per-claim cache (claim_verifications) without a fresh
 *   Tavily roundtrip. Common on R2/R3 audits of multi-round pieces
 *   once the cache warmed during R1.
 * - `searchUsed: false, searchAvailable: false` — Tavily failed for
 *   every claim attempted (all 4xx/5xx) AND every claim's verdict
 *   defaulted to unverified-with-search-failed. Real infrastructure
 *   problem. Director's existing observer.logError fires.
 *
 * 2026-05-16 re-architecture: replaced the single-pass Anthropic
 * web_search call with a decoupled extract → search → verify pipeline
 * using Tavily as the search backend. See fact-checker-tavily.ts.
 * The old code lives at fact-checker-anthropic.ts (dormant, ~30 days
 * as git-revert reference).
 *
 * The shape below is UNCHANGED from the pre-2026-05-16 version so
 * Director / Integrator / Director.saveAuditResults / made-drawer all
 * consume identical fields. The audit-contract failure_reasons enum
 * and per-claim status enum are unchanged.
 */
export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
  searchUsed: boolean;
  searchAvailable: boolean;
  /** Flat dedup-by-URL list of evidence URLs from Tavily snippets for
   *  this run (pre-2026-05-16: Anthropic web_search citation URLs).
   *  Drawer renders a "Sources consulted" line from this list. */
  sources: string[];
  /** Foundation Fix Task 08 PR 08c (2026-05-07). Closed-enum tokens
   *  for the fact-check failure kinds. Empty array on pass. Validated
   *  against FACT_FAILURE_REASONS at parse time — unknown tokens drop,
   *  the count surfaces via parseError. */
  failureReasons: FactFailureReason[];
  parseError?: string | null;
  /** Per-call usage. Director forwards to observer.logLLMCall.
   *  Post-2026-05-16: this is the SUM of the Extract step's tokens
   *  and the Verify step's tokens. Tavily HTTP roundtrips don't
   *  consume Anthropic tokens; only wall-clock is captured in
   *  durationMs. The total is still much lower than the pre-2026-05-16
   *  Anthropic-web_search bouncing case (where 105k input tokens on a
   *  single round was normal). */
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface FactClaim {
  claim: string;
  status: 'verified' | 'unverified' | 'incorrect';
  note: string;
}

interface FactCheckerState {
  lastResult: FactCheckResult | null;
}

/**
 * FactCheckerAgent — verifies factual claims in lesson drafts.
 *
 * 2026-05-16: replaced single-pass Anthropic web_search with a
 * decoupled Tavily pre-fetch pipeline. The DO class stays the same;
 * the body now delegates to checkViaTavily() in fact-checker-tavily.ts.
 *
 * Director's call site (`fact-checker.check(currentMdx)`) is unchanged.
 * sourcePieceId is the optional second parameter: when supplied,
 * claim_verifications cache rows populate source_piece_id so the
 * made-drawer can join back to the originating piece for the
 * "Sources consulted" line. Director threads pieceId in as the next
 * parameter in the same commit that ships this change.
 */
export class FactCheckerAgent extends Agent<Env, FactCheckerState> {
  initialState: FactCheckerState = { lastResult: null };

  async check(mdx: string, sourcePieceId: string | null = null): Promise<FactCheckResult> {
    const result = await checkViaTavily(this.env, mdx, sourcePieceId);
    this.setState({ lastResult: result });
    return result;
  }
}
