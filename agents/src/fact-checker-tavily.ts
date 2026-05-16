/**
 * Tavily-backed fact checker — the orchestrator for the 2026-05-16
 * re-architecture.
 *
 * Replaces the 2026-04-30 Anthropic web_search single-pass approach.
 * The old code is preserved at fact-checker-anthropic.ts for 30 days
 * as a git-revert reference. The Director-facing interface
 * (FactCheckerAgent.check(mdx) → FactCheckResult) is unchanged.
 *
 * Pipeline (per FactCheckerAgent.check() invocation):
 *
 *   Step 1: EXTRACT — Claude reads the draft, returns [{claim_id,
 *           claim_text, search_query}]. ~5k in / 1k out / $0.02.
 *   Step 2: SEARCH — for each claim, cache lookup against
 *           claim_verifications (migration 0044); on miss, hit Tavily
 *           ($0.008/claim). Parallel via Promise.all.
 *   Step 3: VERIFY — Claude reads claims + their snippets, returns
 *           per-claim verdict + failure_reasons. ~12k in / 1k out /
 *           $0.05.
 *
 * Result shape preserved zero-change: same FactCheckResult fields
 * Director/Integrator already consume. Per-call usage telemetry
 * (tokensIn/tokensOut/durationMs) accumulates across both Claude calls
 * AND is also reported as a single combined LLMCallMetrics row so the
 * observer feed shows ONE fact-check call per round (not two). Tavily
 * HTTP roundtrips don't consume Anthropic tokens — only the wall-clock
 * is captured.
 *
 * Failure posture:
 *   - Extract returns empty array → returns clean-pass FactCheckResult
 *     with claims=[] (legitimate for pure-opinion / personal-essay
 *     pieces). No observer event.
 *   - Extract parse-fail → returns soft-fail FactCheckResult with
 *     parseError populated (same posture as the 2026-05-11 Voice/
 *     Structure soft-fail). Director's existing
 *     `observer.logError('fact-checker', round, parseError, ...)` fires
 *     once.
 *   - Tavily error (4xx/5xx/timeout) for any claim → that claim falls
 *     through to verdict='unverified' with note='search failed'.
 *     Multiple Tavily errors aggregate into failure_reasons.missing_source.
 *     Pipeline does NOT abort — partial data is better than no data.
 *   - Verify parse-fail → soft-fail FactCheckResult with parseError;
 *     claims array is empty so Director's downstream logic treats it
 *     as "fact-check returned nothing actionable" rather than the
 *     pre-fix crash mode.
 *   - TAVILY_API_KEY unset → throws on first call. Director's existing
 *     try/catch on saveAuditResults logs once.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  ExtractedClaim,
  TavilySnippet,
  TavilyClaimVerdict,
  FactFailureReason,
} from './types';
import {
  TAVILY_CLAIM_VERDICTS,
  FACT_FAILURE_REASONS,
} from './types';
import { FACT_CHECKER_EXTRACT_PROMPT } from './fact-checker-extract-prompt';
import { FACT_CHECKER_VERIFY_PROMPT } from './fact-checker-verify-prompt';
import { extractJson } from './shared/parse-json';
import { tavilySearch, TavilySearchError } from './shared/tavily-client';
import { TAVILY_CACHE_TTL_DAYS } from './shared/fact-check-thresholds';
import type { FactCheckResult, FactClaim } from './fact-checker';

/** Per-claim outcome after the search + verify legs are done. The
 *  orchestrator collects one of these per claim then folds them into
 *  the FactCheckResult shape Director expects. */
interface ClaimOutcome {
  claim_id: string;
  claim_text: string;
  search_query: string;
  snippets: TavilySnippet[];
  verdict: TavilyClaimVerdict;
  note: string;
  /** True if the snippets came from the cache (no Tavily call this run).
   *  Surfaced in the combined observer event so cache hit-rate is
   *  visible without grepping D1. */
  fromCache: boolean;
}

interface ExtractStepResult {
  claims: ExtractedClaim[];
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  parseError: string | null;
}

interface VerifyStepResult {
  perClaim: Map<string, { verdict: TavilyClaimVerdict; note: string }>;
  failureReasons: FactFailureReason[];
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  parseError: string | null;
}

/**
 * The entrypoint FactCheckerAgent.check() calls. Self-contained — no
 * Durable Object state used directly (the agent keeps its own
 * lastResult for compat); this function is pure(ish) given env + mdx.
 *
 * sourcePieceId is optional; when supplied (Director always supplies),
 * cache rows populate the source_piece_id column so the made-drawer
 * can join back to the originating piece for the "Sources consulted"
 * line.
 */
export async function checkViaTavily(
  env: Env,
  mdx: string,
  sourcePieceId: string | null,
): Promise<FactCheckResult> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    // Hard fail surfaced via parseError so Director's existing
    // observer.logError fires once and the audit_results row records
    // the misconfiguration. The pipeline continues to publish (fact
    // check is non-blocking when search is unavailable).
    return emptySoftFail(
      'TAVILY_API_KEY not set — fact-check skipped. Set via `wrangler secret put TAVILY_API_KEY` against zeemish-agents.',
    );
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const totalStart = Date.now();

  // ── Step 1: EXTRACT ──────────────────────────────────────────────
  const extracted = await extractClaims(client, mdx);
  if (extracted.parseError) {
    return {
      passed: true,
      claims: [],
      searchUsed: false,
      searchAvailable: true,
      sources: [],
      failureReasons: [],
      parseError: extracted.parseError,
      tokensIn: extracted.tokensIn,
      tokensOut: extracted.tokensOut,
      durationMs: Date.now() - totalStart,
    };
  }
  if (extracted.claims.length === 0) {
    // Legitimate empty-claim case (pure opinion piece). Clean pass.
    return {
      passed: true,
      claims: [],
      searchUsed: false,
      searchAvailable: true,
      sources: [],
      failureReasons: [],
      parseError: null,
      tokensIn: extracted.tokensIn,
      tokensOut: extracted.tokensOut,
      durationMs: Date.now() - totalStart,
    };
  }

  // ── Step 2: SEARCH (cache lookup, then Tavily per miss) ──────────
  const outcomes = await searchAllClaims(env, apiKey, extracted.claims, sourcePieceId);

  // ── Step 3: VERIFY ────────────────────────────────────────────────
  const verified = await verifyClaims(client, outcomes);

  // Fold per-claim verdicts onto each outcome.
  for (const outcome of outcomes) {
    const v = verified.perClaim.get(outcome.claim_id);
    if (v) {
      outcome.verdict = v.verdict;
      outcome.note = v.note;
    }
    // If the verifier missed a claim (no entry in perClaim), the
    // search-stage default verdict + note flow through as-is.
  }

  // Persist verdicts into claim_verifications cache for cache misses.
  // Cache hits already had verdicts; we still bump hit_count + last_used_at.
  await persistOutcomes(env, outcomes, sourcePieceId);

  // ── Fold to FactCheckResult shape ─────────────────────────────────
  const claims: FactClaim[] = outcomes.map((o) => ({
    claim: o.claim_text,
    status: tavilyVerdictToFactStatus(o.verdict),
    note: o.note,
  }));

  const hasContradicted = outcomes.some((o) => o.verdict === 'contradicted');
  const flatSources: string[] = Array.from(
    new Set(outcomes.flatMap((o) => o.snippets.map((s) => s.url)).filter((u) => u.length > 0)),
  );

  // Cache hit-rate surfaces in parseError (info only — parseError is
  // surfaced via observer.logError which already exists). Actually we
  // prefer to keep parseError ONLY for real failures; cache rate goes
  // nowhere right now (future enhancement: dedicated observer event).

  return {
    passed: !hasContradicted,
    claims,
    // searchUsed reflects whether Tavily was queried at all this round.
    // Cache-only runs (every claim a hit) have searchUsed=false; the
    // semantic matches the Anthropic-path version's flag.
    searchUsed: outcomes.some((o) => !o.fromCache),
    // searchAvailable=false only when Tavily threw on every claim
    // attempted. Partial failure (some claims OK, some not) still
    // marks search as available — the per-claim notes carry the
    // detail.
    searchAvailable: !outcomes.every((o) => o.verdict === 'unverified' && o.note === 'search failed'),
    sources: flatSources,
    failureReasons: verified.failureReasons,
    parseError: verified.parseError,
    tokensIn: extracted.tokensIn + verified.tokensIn,
    tokensOut: extracted.tokensOut + verified.tokensOut,
    durationMs: Date.now() - totalStart,
  };
}

// ── Step 1 helper ───────────────────────────────────────────────────

async function extractClaims(client: Anthropic, mdx: string): Promise<ExtractStepResult> {
  const callStart = Date.now();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    system: FACT_CHECKER_EXTRACT_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Extract verifiable claims from this draft:\n\n${mdx}`,
      },
    ],
  });
  const durationMs = Date.now() - callStart;
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;

  const firstBlock = response.content[0];
  const text = firstBlock?.type === 'text' ? firstBlock.text : '';

  let parsed: { claims?: unknown };
  try {
    parsed = extractJson<{ claims?: unknown }>(text);
  } catch (err) {
    return {
      claims: [],
      tokensIn,
      tokensOut,
      durationMs,
      parseError: `extract step parse-fail: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const raw = Array.isArray(parsed.claims) ? parsed.claims : [];
  const claims: ExtractedClaim[] = raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      claim_id: typeof c.claim_id === 'string' ? c.claim_id : '',
      claim_text: typeof c.claim_text === 'string' ? c.claim_text : '',
      search_query: typeof c.search_query === 'string' ? c.search_query : '',
    }))
    .filter((c) => c.claim_id.length > 0 && c.claim_text.length > 0 && c.search_query.length > 0)
    .slice(0, 15);

  return { claims, tokensIn, tokensOut, durationMs, parseError: null };
}

// ── Step 2 helpers ──────────────────────────────────────────────────

function normaliseForFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/u, '')
    .trim();
}

/** SHA-256 hex digest. Cloudflare Workers exposes the WebCrypto API
 *  natively — no library import needed. */
async function fingerprint(claim_text: string, search_query: string): Promise<string> {
  const data = new TextEncoder().encode(
    `${normaliseForFingerprint(claim_text)}|${normaliseForFingerprint(search_query)}`,
  );
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function searchAllClaims(
  env: Env,
  apiKey: string,
  claims: ExtractedClaim[],
  sourcePieceId: string | null,
): Promise<ClaimOutcome[]> {
  // Compute fingerprints in parallel (SHA-256 is fast but async).
  const withFps = await Promise.all(
    claims.map(async (c) => ({
      claim: c,
      fp: await fingerprint(c.claim_text, c.search_query),
    })),
  );

  // Batch cache lookup. One SELECT for all fingerprints.
  const fps = withFps.map((w) => w.fp);
  const ttlCutoff = Date.now() - TAVILY_CACHE_TTL_DAYS * 86_400_000;
  const cacheMap = new Map<string, { snippets: TavilySnippet[]; verdict: TavilyClaimVerdict }>();
  try {
    const placeholders = fps.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT claim_fingerprint, tavily_snippets, verdict FROM claim_verifications WHERE claim_fingerprint IN (${placeholders}) AND last_used_at >= ?`,
    )
      .bind(...fps, ttlCutoff)
      .all<{ claim_fingerprint: string; tavily_snippets: string; verdict: string }>();
    for (const row of results ?? []) {
      let snippets: TavilySnippet[] = [];
      try {
        const raw = JSON.parse(row.tavily_snippets) as unknown;
        if (Array.isArray(raw)) {
          snippets = raw.filter((s): s is TavilySnippet => {
            return typeof s === 'object' && s !== null
              && typeof (s as TavilySnippet).url === 'string';
          });
        }
      } catch {
        // Corrupted JSON in cache — treat as miss.
        continue;
      }
      const verdict = TAVILY_CLAIM_VERDICTS.has(row.verdict as TavilyClaimVerdict)
        ? (row.verdict as TavilyClaimVerdict)
        : 'unknown';
      cacheMap.set(row.claim_fingerprint, { snippets, verdict });
    }
  } catch {
    // Cache read failed — fall through to fresh search for all claims.
    // No fingerprint goes into cacheMap so the per-claim loop below
    // treats every claim as a miss.
  }

  // Per-claim resolution: hit → reuse; miss → hit Tavily.
  return Promise.all(
    withFps.map(async ({ claim, fp }) => {
      const cached = cacheMap.get(fp);
      if (cached) {
        return {
          claim_id: claim.claim_id,
          claim_text: claim.claim_text,
          search_query: claim.search_query,
          snippets: cached.snippets,
          // verdict from cache is preserved as the default if the
          // Verify step misses this claim; otherwise it gets overwritten.
          verdict: cached.verdict,
          note: 'from cache',
          fromCache: true,
        } satisfies ClaimOutcome;
      }
      try {
        const resp = await tavilySearch(apiKey, claim.search_query);
        return {
          claim_id: claim.claim_id,
          claim_text: claim.claim_text,
          search_query: claim.search_query,
          snippets: resp.results,
          // verdict default if Verify step misses this claim — `unknown`
          // surfaces via the closed-enum drift query.
          verdict: 'unknown' as TavilyClaimVerdict,
          note: '',
          fromCache: false,
        } satisfies ClaimOutcome;
      } catch (err) {
        const msg = err instanceof TavilySearchError
          ? `tavily ${err.status}`
          : err instanceof Error
            ? err.message
            : String(err);
        return {
          claim_id: claim.claim_id,
          claim_text: claim.claim_text,
          search_query: claim.search_query,
          snippets: [],
          verdict: 'unverified' as TavilyClaimVerdict,
          note: `search failed: ${msg}`,
          fromCache: false,
        } satisfies ClaimOutcome;
      }
    }),
  );
}

// ── Step 3 helper ───────────────────────────────────────────────────

function buildVerifyUserMessage(outcomes: ClaimOutcome[]): string {
  const sections: string[] = [];
  for (const o of outcomes) {
    const block: string[] = [];
    block.push(`CLAIM ${o.claim_id}: "${o.claim_text}"`);
    block.push(`  search_query: ${o.search_query}`);
    if (o.snippets.length === 0) {
      block.push('  (no search results — likely missing_source)');
    } else {
      o.snippets.slice(0, 3).forEach((s, i) => {
        const excerpt = (s.content || '').slice(0, 280).replace(/\s+/g, ' ').trim();
        block.push(`  SNIPPET ${i + 1} (score ${s.score.toFixed(2)}): ${s.title || '(no title)'} — ${excerpt} (${s.url})`);
      });
    }
    sections.push(block.join('\n'));
  }
  return `Verify the following claims using ONLY the snippets shown. Do not fall back to training data.\n\n${sections.join('\n\n')}`;
}

async function verifyClaims(client: Anthropic, outcomes: ClaimOutcome[]): Promise<VerifyStepResult> {
  const callStart = Date.now();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 3000,
    system: FACT_CHECKER_VERIFY_PROMPT,
    messages: [
      { role: 'user', content: buildVerifyUserMessage(outcomes) },
    ],
  });
  const durationMs = Date.now() - callStart;
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;

  const firstBlock = response.content[0];
  const text = firstBlock?.type === 'text' ? firstBlock.text : '';

  let parsed: { verdicts?: unknown; failure_reasons?: unknown };
  try {
    parsed = extractJson<{ verdicts?: unknown; failure_reasons?: unknown }>(text);
  } catch (err) {
    return {
      perClaim: new Map(),
      failureReasons: [],
      tokensIn,
      tokensOut,
      durationMs,
      parseError: `verify step parse-fail: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const perClaim = new Map<string, { verdict: TavilyClaimVerdict; note: string }>();
  const rawVerdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  for (const raw of rawVerdicts) {
    if (typeof raw !== 'object' || raw === null) continue;
    const v = raw as { claim_id?: unknown; verdict?: unknown; note?: unknown };
    const claim_id = typeof v.claim_id === 'string' ? v.claim_id : '';
    const verdictStr = typeof v.verdict === 'string' ? v.verdict : 'unknown';
    const verdict: TavilyClaimVerdict = TAVILY_CLAIM_VERDICTS.has(verdictStr as TavilyClaimVerdict)
      ? (verdictStr as TavilyClaimVerdict)
      : 'unknown';
    const note = typeof v.note === 'string' ? v.note : '';
    if (claim_id.length > 0) {
      perClaim.set(claim_id, { verdict, note });
    }
  }

  const rawFR = Array.isArray(parsed.failure_reasons) ? parsed.failure_reasons : [];
  const failureReasons: FactFailureReason[] = [];
  for (const token of rawFR) {
    if (typeof token === 'string' && FACT_FAILURE_REASONS.has(token as FactFailureReason)) {
      failureReasons.push(token as FactFailureReason);
    }
  }

  return { perClaim, failureReasons, tokensIn, tokensOut, durationMs, parseError: null };
}

// ── Persistence ─────────────────────────────────────────────────────

async function persistOutcomes(
  env: Env,
  outcomes: ClaimOutcome[],
  sourcePieceId: string | null,
): Promise<void> {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  for (const o of outcomes) {
    const fp = await fingerprint(o.claim_text, o.search_query);
    const evidenceUrls = JSON.stringify(o.snippets.map((s) => s.url).filter((u) => u.length > 0));
    const snippetsJson = JSON.stringify(o.snippets);

    if (o.fromCache) {
      // Bump hit_count + last_used_at on existing row. Don't overwrite
      // tavily_snippets or verdict — the cached values are the source
      // of truth (preserves the original verdict text Claude generated).
      statements.push(
        env.DB.prepare(
          `UPDATE claim_verifications SET hit_count = hit_count + 1, last_used_at = ? WHERE claim_fingerprint = ?`,
        ).bind(now, fp),
      );
    } else {
      // New row — UPSERT on fingerprint (in case two parallel pipelines
      // raced on the same claim). PK is id (UUID); conflict target is
      // the unique-via-index claim_fingerprint. SQLite supports
      // ON CONFLICT only when there's a UNIQUE constraint, which the
      // index alone doesn't guarantee — so we use INSERT OR IGNORE,
      // then a fall-back UPDATE that bumps hit_count. (INSERT OR
      // REPLACE would destroy hit_count.)
      const id = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO claim_verifications (id, claim_fingerprint, claim_text, search_query, tavily_snippets, verdict, evidence_urls, source_piece_id, hit_count, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).bind(id, fp, o.claim_text, o.search_query, snippetsJson, o.verdict, evidenceUrls, sourcePieceId, now, now),
      );
      // Bump in case the INSERT was ignored (race). Cheap when ignored
      // didn't fire (UPDATE matches the just-inserted row).
      statements.push(
        env.DB.prepare(
          `UPDATE claim_verifications SET hit_count = hit_count + 1, last_used_at = ? WHERE claim_fingerprint = ?`,
        ).bind(now, fp),
      );
    }
  }

  if (statements.length > 0) {
    try {
      await env.DB.batch(statements);
    } catch {
      // Cache write failures are non-fatal — the verdict is already in
      // the FactCheckResult returned to Director. Future runs will
      // re-search this claim (slightly more cost, no correctness loss).
    }
  }
}

// ── Verdict translation ─────────────────────────────────────────────

function tavilyVerdictToFactStatus(v: TavilyClaimVerdict): FactClaim['status'] {
  switch (v) {
    case 'verified':
      return 'verified';
    case 'contradicted':
      return 'incorrect';
    case 'cutoff_confession_attempted':
    case 'unverified':
    case 'unknown':
    default:
      return 'unverified';
  }
}

// ── Soft-fail helper ────────────────────────────────────────────────

function emptySoftFail(parseError: string): FactCheckResult {
  return {
    passed: true,
    claims: [],
    searchUsed: false,
    searchAvailable: false,
    sources: [],
    failureReasons: [],
    parseError,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
  };
}

// ── Exports for the verifier ────────────────────────────────────────

export const __internals = {
  normaliseForFingerprint,
  fingerprint,
  buildVerifyUserMessage,
  tavilyVerdictToFactStatus,
};
