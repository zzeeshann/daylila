import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { FACT_CHECKER_PROMPT } from './fact-checker-prompt';

/**
 * Result of fact-checking a draft.
 *
 * Gate semantics: `passed` is true iff no claim is marked `incorrect`.
 * Unverified claims are allowed (asymmetric with voice/structure gates —
 * intentional, since LLMs can flag anything they can't fully confirm).
 *
 * The two boolean flags encode the web-search leg's state:
 * - `searchUsed: true,  searchAvailable: true`  — Claude invoked
 *   web_search at least once and got results back. The norm for
 *   news-anchored daily pieces.
 * - `searchUsed: false, searchAvailable: true`  — Claude judged every
 *   claim verifiable from training data alone (general science, well-
 *   known facts) and didn't search. Acceptable on the rare
 *   pure-evergreen piece.
 * - `searchUsed: false, searchAvailable: false` — at least one
 *   web_search invocation returned `unavailable` from Anthropic. Real
 *   infrastructure problem. Director logs an Observer warn.
 *
 * Replaced the 2026-04-19 DDG Instant Answer integration on 2026-04-30
 * after the Venter piece exposed cutoff-confessing notes ("this appears
 * to be speculative fiction set in 2026") on real news. DDG IA only
 * resolved ~5% of news claims; Anthropic's native web_search tool is
 * search-grounded and citation-backed.
 *
 * Path A (2026-05-01 evening) replaced Phase F's per-claim
 * Claude-self-reported `sources` field. Anthropic's web_search response
 * already carries the URLs as auto-attached `web_search_result_location`
 * citation metadata on text blocks; the agent harvests them server-side
 * into a flat `sources: string[]` (deduped by URL) on this result. Per-
 * claim sources field deleted from `FactClaim` (Phase F's drawer
 * sub-section was 0% populated in production — empty transparency
 * theatre). The drawer's "Sources consulted" line reads from the flat
 * `sources` field via the audit_results.notes JSON.
 */
export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
  searchUsed: boolean;
  searchAvailable: boolean;
  /** Flat dedup-by-URL list of every citation Anthropic web_search
   *  returned across this audit. Drawer renders a "Sources consulted"
   *  line from this list. */
  sources: string[];
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
 * FactCheckerAgent — verifies factual claims in lesson drafts using
 * Anthropic's server-side web_search tool.
 *
 * Single-pass: Claude extracts claims, decides per-claim whether to
 * search, runs searches inside the same Messages turn, and returns one
 * JSON verdict. The pre-2026-04-30 two-pass DDG architecture is gone.
 */
export class FactCheckerAgent extends Agent<Env, FactCheckerState> {
  initialState: FactCheckerState = { lastResult: null };

  async check(mdx: string): Promise<FactCheckResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const today = new Date().toISOString().slice(0, 10);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: FACT_CHECKER_PROMPT,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 8,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [
        {
          role: 'user',
          content: `Today is ${today}. Fact-check this lesson:\n\n${mdx}`,
        },
      ],
    });

    return this.parseResponse(response);
  }

  /**
   * Walks the assistant message's content blocks once, collecting:
   *   - concatenated text (for JSON extraction)
   *   - searchUsed flag (any `server_tool_use` invocation)
   *   - searchAvailable flag (`unavailable` error from web_search tool)
   *   - citation URLs from any `web_search_result_location` block
   *     attached to a text block
   *
   * The flat `result.sources` is the deduplicated list of citation
   * URLs. Per-claim cross-reference / hallucination defense was removed
   * in Path A (2026-05-01) — Anthropic's citation metadata is the only
   * input now, no Claude self-report layer to defend against.
   *
   * Public for the verifier harness — `agents/scripts/verify-fact-checker.mjs`
   * calls a JS mirror of this logic.
   */
  parseResponse(response: Anthropic.Messages.Message): FactCheckResult {
    let textCombined = '';
    let searchUsed = false;
    let searchAvailable = true;
    const sources = new Set<string>();

    for (const block of response.content) {
      if (block.type === 'text') {
        textCombined += block.text;
        const citations = (block as { citations?: unknown[] }).citations;
        if (Array.isArray(citations)) {
          for (const raw of citations) {
            const c = raw as { type?: string; url?: string };
            if (c.type === 'web_search_result_location' && typeof c.url === 'string' && c.url.length > 0) {
              sources.add(c.url);
            }
          }
        }
      } else if (block.type === 'server_tool_use') {
        searchUsed = true;
      } else if (block.type === 'web_search_tool_result') {
        const inner = (block as { content?: unknown }).content as
          | { type?: string; error_code?: string }
          | unknown[]
          | undefined;
        if (inner && !Array.isArray(inner)) {
          const errBlock = inner as { type?: string; error_code?: string };
          if (errBlock.type === 'web_search_tool_result_error' && errBlock.error_code === 'unavailable') {
            searchAvailable = false;
          }
        }
      }
    }

    const flatSources = Array.from(sources);

    let parsed: { passed?: boolean; claims?: Array<{ claim?: string; status?: string; note?: string }> };
    try {
      parsed = extractJson(textCombined);
    } catch (err) {
      console.warn(`[fact-checker] could not extract JSON from response: ${err instanceof Error ? err.message : String(err)}`);
      const result: FactCheckResult = {
        passed: true,
        claims: [],
        searchUsed,
        searchAvailable,
        sources: flatSources,
      };
      this.setState({ lastResult: result });
      return result;
    }

    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
    const claims: FactClaim[] = rawClaims.map((rc) => {
      const claimText = typeof rc.claim === 'string' ? rc.claim : '';
      const status = (rc.status === 'verified' || rc.status === 'unverified' || rc.status === 'incorrect')
        ? rc.status
        : 'unverified';
      const note = typeof rc.note === 'string' ? rc.note : '';
      return { claim: claimText, status, note };
    });

    const hasIncorrect = claims.some((c) => c.status === 'incorrect');

    const result: FactCheckResult = {
      passed: !hasIncorrect,
      claims,
      searchUsed,
      searchAvailable,
      sources: flatSources,
    };

    this.setState({ lastResult: result });
    return result;
  }
}
