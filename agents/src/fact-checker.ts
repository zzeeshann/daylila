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
 * Phase F (2026-04-30, after Phase A): per-claim citations + cited_text
 * + searchQuery. The agent now harvests `web_search_result_location`
 * citation blocks attached to text blocks (Claude's reasoning prose),
 * cross-references against the URLs Claude names in each claim's
 * `sources` array, drops hallucinated URLs (Claude named a URL we don't
 * see in the response), and enriches kept URLs with `title` + verbatim
 * `cited_text` snippet + the search query that surfaced them. Anthropic
 * docs require citations when displaying API output to end users.
 */
export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
  searchUsed: boolean;
  searchAvailable: boolean;
}

export interface FactClaim {
  claim: string;
  status: 'verified' | 'unverified' | 'incorrect';
  note: string;
  sources?: FactClaimSource[];
}

/**
 * Per-claim source. `url` is the only required field — `title` /
 * `citedText` / `searchQuery` are populated when the URL appears in a
 * `web_search_result_location` citation block. Claude-named URLs that
 * don't appear in any citation block (potential hallucinations) are
 * dropped before reaching the persisted shape.
 */
export interface FactClaimSource {
  url: string;
  title?: string;
  /** Verbatim 150-char snippet from the source page, returned by
   *  Anthropic. Free of token cost. Renders as a `<blockquote>` under
   *  the source link in the drawer. */
  citedText?: string;
  /** The exact text Claude searched for (`server_tool_use.input.query`)
   *  before this URL surfaced. Renders as a muted "Searched: '…'"
   *  eyebrow above the source link. */
  searchQuery?: string;
}

interface FactCheckerState {
  lastResult: FactCheckResult | null;
}

interface CitationMeta {
  title?: string;
  citedText?: string;
  searchQuery?: string;
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
   *   - search-query order (from `server_tool_use.input.query`)
   *   - citation map (URL → {title, citedText, searchQuery}) from any
   *     `web_search_result_location` block attached to a text block;
   *     each citation gets the most-recent search query as its
   *     `searchQuery` (positional attribution).
   *
   * Then for each claim Claude returned, it cross-references the
   * `sources` URLs Claude named against the citation map:
   *   - URL in both Claude's sources AND citation map → keep, enrich
   *     with title/citedText/searchQuery
   *   - URL Claude named but not in citation map → drop (potential
   *     hallucination — Claude invented a URL not actually returned
   *     by web_search)
   *   - URL in citation map but not in any claim's sources → silently
   *     ignored (not surfaced as "additional sources" — would confuse
   *     readers ["why is this URL here if no claim cites it?"]; if
   *     Claude consulted but didn't cite, that's not useful
   *     transparency, just noise)
   *
   * Public for the verifier harness — `agents/scripts/verify-fact-checker.mjs`
   * calls a JS mirror of this logic.
   */
  parseResponse(response: Anthropic.Messages.Message): FactCheckResult {
    let textCombined = '';
    let searchUsed = false;
    let searchAvailable = true;
    const searchQueries: string[] = [];
    const citationsByUrl = new Map<string, CitationMeta>();

    for (const block of response.content) {
      if (block.type === 'text') {
        textCombined += block.text;
        const citations = (block as { citations?: unknown[] }).citations;
        if (Array.isArray(citations)) {
          for (const raw of citations) {
            const c = raw as {
              type?: string;
              url?: string;
              title?: string;
              cited_text?: string;
            };
            if (c.type === 'web_search_result_location' && typeof c.url === 'string' && c.url.length > 0) {
              if (!citationsByUrl.has(c.url)) {
                citationsByUrl.set(c.url, {
                  title: typeof c.title === 'string' ? c.title : undefined,
                  citedText: typeof c.cited_text === 'string' ? c.cited_text : undefined,
                  searchQuery: searchQueries.length > 0 ? searchQueries[searchQueries.length - 1] : undefined,
                });
              }
            }
          }
        }
      } else if (block.type === 'server_tool_use') {
        searchUsed = true;
        const input = (block as { input?: { query?: unknown } }).input;
        if (input && typeof input.query === 'string' && input.query.length > 0) {
          searchQueries.push(input.query);
        }
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

    let parsed: { passed?: boolean; claims?: Array<{ claim?: string; status?: string; note?: string; sources?: unknown }> };
    try {
      parsed = extractJson(textCombined);
    } catch (err) {
      console.warn(`[fact-checker] could not extract JSON from response: ${err instanceof Error ? err.message : String(err)}`);
      const result: FactCheckResult = {
        passed: true,
        claims: [],
        searchUsed,
        searchAvailable,
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

      const claudeSources = Array.isArray(rc.sources) ? (rc.sources as unknown[]) : [];
      const enrichedSources: FactClaimSource[] = [];
      const seenUrls = new Set<string>();
      for (const raw of claudeSources) {
        if (typeof raw !== 'string' || raw.length === 0) continue;
        if (seenUrls.has(raw)) continue;
        const meta = citationsByUrl.get(raw);
        if (!meta) {
          // Cross-reference fail: Claude named a URL not in the
          // citation blocks. Almost certainly hallucinated. Drop.
          console.warn(`[fact-checker] dropping unattested URL from claim sources: ${raw}`);
          continue;
        }
        seenUrls.add(raw);
        enrichedSources.push({
          url: raw,
          title: meta.title,
          citedText: meta.citedText,
          searchQuery: meta.searchQuery,
        });
      }

      const out: FactClaim = { claim: claimText, status, note };
      if (enrichedSources.length > 0) out.sources = enrichedSources;
      return out;
    });

    const hasIncorrect = claims.some((c) => c.status === 'incorrect');

    const result: FactCheckResult = {
      passed: !hasIncorrect,
      claims,
      searchUsed,
      searchAvailable,
    };

    this.setState({ lastResult: result });
    return result;
  }
}
