/**
 * Tavily Search API HTTP wrapper.
 *
 * Why this exists: 2026-05-16 fact-checker re-architecture replaces
 * Anthropic's `web_search_20250305` server tool with a decoupled
 * extract → search → verify pipeline. This module is the SEARCH leg:
 * a thin POST wrapper around Tavily's /search endpoint with one
 * retry on 429 (rate limit) before giving up. The agent-orchestrator
 * (fact-checker-tavily.ts) catches the throw and routes through the
 * existing `parseError` soft-fail path so Director's audit-revise
 * loop sees a clean fail-soft instead of a hard crash.
 *
 * Tavily API reference (from https://docs.tavily.com/documentation/api-reference/endpoint/search):
 *   POST https://api.tavily.com/search
 *   Header: Authorization: Bearer tvly-...
 *   Body: { query, search_depth, max_results, topic, include_answer, time_range }
 *   Response: { results: [{title, url, content, score}], answer?, usage: {credits} }
 *
 * One Tavily call per claim — Promise.all from the orchestrator. The
 * free tier (1,000 credits/month) covers ~80 pieces of cold-cache R1
 * cost; PAYG at $0.008/credit beyond. Per-call credits are 1 for
 * `search_depth=basic` (the default this codebase uses) or 2 for
 * `advanced` (tunable via TAVILY_SEARCH_DEPTH in fact-check-thresholds.ts).
 *
 * Cloudflare Workers `fetch` is native — no library dependency added.
 */

import { TAVILY_MAX_RESULTS, TAVILY_SEARCH_DEPTH } from './fact-check-thresholds';
import type { TavilySnippet } from '../types';

/** Subset of Tavily's response that we actually use. The full response
 *  carries `images`, `auto_parameters`, `request_id`, etc. — we ignore
 *  those at the wire layer rather than pretending they don't exist. */
export interface TavilySearchResponse {
  query: string;
  answer?: string | null;
  results: TavilySnippet[];
  response_time?: number;
  usage?: { credits?: number };
}

export interface TavilySearchOptions {
  /** Date-bounded search. 'week' for current-event claims is the default
   *  used by fact-checker-tavily.ts when Claude marks a claim as
   *  news-anchored during the Extract step; evergreen claims send no
   *  time_range so Tavily searches the full index. */
  time_range?: 'day' | 'week' | 'month' | 'year';
  /** Overrides the default TAVILY_MAX_RESULTS for callers that want
   *  more or fewer snippets. Verifier sets this to 1 for cheaper tests. */
  max_results?: number;
}

/** Error thrown by tavilySearch on a 4xx/5xx that retry didn't fix.
 *  fact-checker-tavily.ts catches this and surfaces it via
 *  FactCheckResult.parseError so Director's audit-revise loop sees a
 *  soft-fail row (same posture as the 2026-05-11 Voice/Structure
 *  parseError sentinel). The status code + body excerpt are carried in
 *  the message so the observer event captures enough to diagnose. */
export class TavilySearchError extends Error {
  readonly status: number;
  readonly bodyExcerpt: string;
  constructor(status: number, bodyExcerpt: string) {
    super(`Tavily search failed: status=${status} body=${bodyExcerpt.slice(0, 200)}`);
    this.name = 'TavilySearchError';
    this.status = status;
    this.bodyExcerpt = bodyExcerpt;
  }
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const RATE_LIMIT_RETRY_DELAY_MS = 2_000;

/** Sleep helper — used for the one rate-limit retry. Cloudflare
 *  Workers' setTimeout works inside Durable Object request handlers
 *  (the DO's `ctx.waitUntil` keeps the iso alive across the wait). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST one search to Tavily. Returns the parsed response on 2xx.
 * Retries once after 2s on 429 (rate limit) — on second 429, throws.
 * All other 4xx/5xx throw immediately without retry.
 *
 * @param apiKey  — Tavily bearer key (from Env.TAVILY_API_KEY)
 * @param query   — the search string (Claude-generated focused query
 *                  from the Extract step, NOT the raw claim text)
 * @param opts    — time_range and max_results overrides
 */
export async function tavilySearch(
  apiKey: string,
  query: string,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  const body = {
    query,
    search_depth: TAVILY_SEARCH_DEPTH,
    max_results: opts.max_results ?? TAVILY_MAX_RESULTS,
    topic: 'general' as const,
    include_answer: false as const,
    ...(opts.time_range ? { time_range: opts.time_range } : {}),
  };

  // Attempt 1.
  const first = await postOnce(apiKey, body);
  if (first.ok) return first.payload;
  if (first.status !== 429) throw new TavilySearchError(first.status, first.bodyText);

  // Attempt 2 after 2s — only fires on 429.
  await sleep(RATE_LIMIT_RETRY_DELAY_MS);
  const second = await postOnce(apiKey, body);
  if (second.ok) return second.payload;
  throw new TavilySearchError(second.status, second.bodyText);
}

interface PostResult {
  ok: boolean;
  status: number;
  bodyText: string;
  payload: TavilySearchResponse;
}

async function postOnce(apiKey: string, body: unknown): Promise<PostResult> {
  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, bodyText, payload: {} as TavilySearchResponse };
  }

  let payload: TavilySearchResponse;
  try {
    const raw = JSON.parse(bodyText) as unknown;
    if (!raw || typeof raw !== 'object') {
      throw new Error('response body is not an object');
    }
    const obj = raw as { query?: unknown; results?: unknown; answer?: unknown; usage?: unknown };
    if (!Array.isArray(obj.results)) {
      throw new Error('response.results is not an array');
    }
    const results: TavilySnippet[] = obj.results
      .filter((r): r is { title: unknown; url: unknown; content: unknown; score: unknown } => {
        return typeof r === 'object' && r !== null;
      })
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.url === 'string' ? r.url : '',
        content: typeof r.content === 'string' ? r.content : '',
        score: typeof r.score === 'number' ? r.score : 0,
      }))
      .filter((s) => s.url.length > 0);
    payload = {
      query: typeof obj.query === 'string' ? obj.query : '',
      answer: typeof obj.answer === 'string' ? obj.answer : null,
      results,
      usage:
        obj.usage && typeof obj.usage === 'object' && 'credits' in obj.usage
          ? { credits: typeof (obj.usage as { credits?: unknown }).credits === 'number'
              ? (obj.usage as { credits: number }).credits
              : undefined }
          : undefined,
    };
  } catch (err) {
    // Tavily returned 200 but the body wasn't parseable JSON. Surface as
    // a 200-with-junk error so the caller's catch can branch on it.
    return {
      ok: false,
      status: 200,
      bodyText: `parse error: ${err instanceof Error ? err.message : String(err)}; body: ${bodyText.slice(0, 200)}`,
      payload: {} as TavilySearchResponse,
    };
  }

  return { ok: true, status: 200, bodyText, payload };
}
