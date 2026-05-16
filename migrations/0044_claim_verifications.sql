-- 0044_claim_verifications — per-claim cache for the Tavily-backed
-- fact-checker pipeline (2026-05-16).
--
-- Replaces FactCheckerAgent's internal use of Anthropic's
-- web_search_20250305 server tool with a decoupled extract → search →
-- verify pipeline. Tavily is the search backend; this table is the
-- per-claim cache that makes the second + third audit rounds cheap.
--
-- Cache shape:
--   key   = claim_fingerprint = sha256(normalised_claim_text + search_query)
--   value = tavily snippets + Claude's verdict the first time we saw
--           the claim, plus an evidence_urls list extracted from
--           snippets for the made-drawer "Sources consulted" line.
--
-- TTL handled at READ time inside fact-checker-tavily.ts — rows older
-- than TAVILY_CACHE_TTL_DAYS (default 30) are ignored on lookup; a
-- separate retention pass can DELETE them later (added to
-- agents/src/retention.ts in a follow-up if needed). For now stale
-- rows just take space.
--
-- Append-only mirror of the existing dedup-headlines.ts cache shape:
-- global across all pieces (not per-piece), fingerprint-keyed, hit_count
-- surfaces reuse so operator can spot a hot claim if needed. Same
-- closed-enum verdict posture as audit_results.failure_reasons
-- (validated against a ReadonlySet at the writer in
-- fact-checker-tavily.ts; unknown verdicts persist as 'unknown' so
-- drift becomes visible via operator query rather than silently
-- dropping rows).
--
-- Forward-only, additive. Idempotent: CREATE TABLE IF NOT EXISTS
-- guards against double-apply on local dev.
CREATE TABLE IF NOT EXISTS claim_verifications (
  id TEXT PRIMARY KEY,
  claim_fingerprint TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  search_query TEXT NOT NULL,
  tavily_snippets TEXT NOT NULL,
  verdict TEXT NOT NULL,
  evidence_urls TEXT NOT NULL,
  source_piece_id TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_fp ON claim_verifications(claim_fingerprint);
CREATE INDEX IF NOT EXISTS idx_claim_last_used ON claim_verifications(last_used_at);
