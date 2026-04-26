/**
 * Token-usage extractor — pulls all four billable counters off a
 * Claude API response in one place.
 *
 * The Anthropic SDK's `Usage` shape carries:
 *   - `input_tokens` — UNCACHED input portion. When prompt caching is
 *     in use this is the new-prompt portion only; the cached system
 *     prompt's contribution lives under `cache_creation_input_tokens`
 *     (cold call) or `cache_read_input_tokens` (warm call). For cold
 *     calls without caching, this is the total input.
 *   - `output_tokens` — total output, never cached.
 *   - `cache_creation_input_tokens` — system-prompt block on the COLD
 *     call. Billed at 1.25× input rate. 0 on subsequent warm calls.
 *   - `cache_read_input_tokens` — system-prompt block on every WARM
 *     call. Billed at 0.1× input rate. 0 on the first cold call.
 *
 * The two cache fields are missing on responses that didn't use
 * caching at all — the SDK's TypeScript shape may type them as
 * optional or omit them depending on the SDK version. Defensive
 * coalesce to 0.
 *
 * Used by the InteractiveGenerator and InteractiveAuditor metering
 * paths to power Phase 3.4 cost telemetry. Other agents (Drafter,
 * Voice/Structure/Fact auditors, Curator, Categoriser, Learner)
 * still report `tokensIn`/`tokensOut` only — extending them lands
 * with future cost-telemetry work, not 3.4.
 */
export interface Usage {
  tokensIn: number;
  tokensOut: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function extractUsage(usage: RawUsage | null | undefined): Usage {
  return {
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
    cacheCreateTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  };
}
