/**
 * Legacy Anthropic-web_search fact-checker — kept DORMANT as the
 * git-revert reference for the 2026-05-16 Tavily re-architecture.
 *
 * Plan target: delete this file ~30 days after the Tavily path stops
 * showing regressions in admin-retrigger checks. Until then it's
 * unused but still imports cleanly — agents `tsc --noEmit` validates
 * the surface stays compatible if we ever need to revert.
 *
 * Per the approved plan: rollback is `git revert <merge-commit>` + redeploy,
 * NOT a flag flip; the file's purpose is to make it OBVIOUS what the
 * pre-Tavily code was so future-Claude can read it without spelunking
 * git history.
 *
 * The exported function `checkViaAnthropic` has the same signature as
 * `checkViaTavily` from `fact-checker-tavily.ts`. If you do revert, the
 * one-line swap in `fact-checker.ts` is:
 *   - return checkViaTavily(this.env, mdx, sourcePieceId);
 *   + return checkViaAnthropic(this.env, mdx);
 *
 * Removed: `parseResponse` method on the agent class (used by the old
 * verify-fact-checker.mjs verifier). The verifier file still exists for
 * historical reference but the npm script entry is being removed in
 * package.json this same commit.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Env, FactFailureReason } from './types';
import { FACT_FAILURE_REASONS } from './types';
import { extractJson } from './shared/parse-json';
import { FACT_CHECKER_PROMPT } from './fact-checker-prompt';
import { WEB_SEARCH_MAX_USES } from './shared/fact-check-thresholds';
import type { FactCheckResult, FactClaim } from './fact-checker';

/**
 * Pre-2026-05-16 fact-check path. Single Claude call invoking
 * Anthropic's `web_search_20250305` server tool. Search results bounce
 * back into the conversation as `web_search_tool_result` content blocks
 * — inflating input tokens up to 105k on round 3 of multi-round audits.
 * This is exactly what the 2026-05-16 re-architecture is solving.
 */
export async function checkViaAnthropic(env: Env, mdx: string): Promise<FactCheckResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const today = new Date().toISOString().slice(0, 10);

  const callStart = Date.now();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4000,
    system: FACT_CHECKER_PROMPT,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: WEB_SEARCH_MAX_USES,
      } as unknown as Anthropic.Messages.Tool,
    ],
    messages: [
      {
        role: 'user',
        content: `Today is ${today}. Fact-check this lesson:\n\n${mdx}`,
      },
    ],
  });
  const durationMs = Date.now() - callStart;

  return parseAnthropicResponse(response, durationMs);
}

/**
 * Walks the assistant message's content blocks once, collecting:
 *   - concatenated text (for JSON extraction)
 *   - searchUsed flag (any `server_tool_use` invocation)
 *   - searchAvailable flag (`unavailable` error from web_search tool)
 *   - citation URLs from any `web_search_result_location` block
 *     attached to a text block
 *
 * The flat `result.sources` is the deduplicated list of citation URLs.
 * Per-claim cross-reference / hallucination defense was removed in
 * Path A (2026-05-01) — Anthropic's citation metadata is the only
 * input now, no Claude self-report layer to defend against.
 *
 * Pure function — exported separately so the old verify-fact-checker.mjs
 * verifier could mirror it in JS. Kept exported here for git-revert
 * symmetry though the verifier is no longer in the npm scripts.
 */
export function parseAnthropicResponse(
  response: Anthropic.Messages.Message,
  durationMs = 0,
): FactCheckResult {
  let textCombined = '';
  let searchUsed = false;
  let searchAvailable = true;
  const sources = new Set<string>();
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;

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
      if (Array.isArray(inner)) {
        for (const result of inner) {
          const r = result as { type?: string; url?: string };
          if (r.type === 'web_search_result' && typeof r.url === 'string' && r.url.length > 0) {
            sources.add(r.url);
          }
        }
      } else if (inner && !Array.isArray(inner)) {
        const errBlock = inner as { type?: string; error_code?: string };
        if (errBlock.type === 'web_search_tool_result_error' && errBlock.error_code === 'unavailable') {
          searchAvailable = false;
        }
      }
    }
  }

  const flatSources = Array.from(sources);

  let parsed: {
    passed?: boolean;
    claims?: Array<{ claim?: string; status?: string; note?: string }>;
    failure_reasons?: unknown;
  };
  try {
    parsed = extractJson(textCombined);
  } catch (err) {
    return {
      passed: true,
      claims: [],
      searchUsed,
      searchAvailable,
      sources: flatSources,
      failureReasons: [],
      parseError: `Fact checker response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      tokensIn,
      tokensOut,
      durationMs,
    };
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

  const rawReasons = Array.isArray(parsed.failure_reasons) ? parsed.failure_reasons : [];
  const failureReasons: FactFailureReason[] = [];
  let droppedCount = 0;
  for (const token of rawReasons) {
    if (typeof token === 'string' && FACT_FAILURE_REASONS.has(token as FactFailureReason)) {
      failureReasons.push(token as FactFailureReason);
    } else {
      droppedCount += 1;
    }
  }

  return {
    passed: !hasIncorrect,
    claims,
    searchUsed,
    searchAvailable,
    sources: flatSources,
    failureReasons,
    parseError: droppedCount > 0
      ? `Fact checker dropped ${droppedCount} unknown failure_reason token(s) from the response`
      : null,
    tokensIn,
    tokensOut,
    durationMs,
  };
}
