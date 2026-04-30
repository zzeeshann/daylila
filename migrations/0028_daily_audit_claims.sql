-- 0028_daily_audit_claims.sql
--
-- Per-claim audit output for daily pieces. Phase I of the 2026-04-30
-- fact-check transparency rewrite.
--
-- Today, daily-piece audit output sits as JSON in `audit_results.notes`
-- (a TEXT column). Every reader path that wants per-claim data has to
-- JSON-parse to query individual claims. Future admin work, future
-- analytics, future "show me all claims about X across all pieces"
-- queries — all blocked by JSON-in-column. Matches the operator's
-- `feedback_schema_over_bandaid` preference: if a bug can be stated as
-- "table X needs column Y", surface the schema option up front.
--
-- This table mirrors the `interactive_audit_results` precedent
-- (migration 0023, 2026-04-25) for daily-piece claims. One row per
-- claim per audit round. Phase F's Anthropic web_search citation
-- enrichment data (URL + title + cited_text + searchQuery per source)
-- lands in `sources_json`; the most representative search query is
-- denormalized to `search_query` for fast filtering ("show me every
-- claim Claude searched 'Venter death' for").
--
-- SHAPE DECISIONS:
--
-- 1. Keyed by `audit_result_id` (not by `(piece_id, round, claim_index)`)
--    because audit_results is the durable parent — the JSON-in-column
--    notes field is still the source-of-truth-for-back-compat with the
--    23 historical rows. This table is additive structured data; rows
--    here mirror what's in the parent's JSON.
--
-- 2. Denormalized `piece_id` for query convenience without join. Same
--    pattern as `interactive_audit_results.interactive_id`.
--
-- 3. `claim_index` integer matches the original JSON array index — lets
--    a future admin view show "this claim was unverified in r1, then
--    verified in r2 after Drafter rewrote the prose" by selecting all
--    rows with the same claim_index across rounds.
--
-- 4. `sources_json` TEXT (JSON). Per-claim sources from Phase F's
--    cross-reference enrichment: `[{url, title, citedText, searchQuery}]`.
--    NULL if Claude verified the claim from training data alone (no
--    search) — back-compat with the FactClaim shape.
--
-- 5. `search_query` TEXT — denormalized first searchQuery from
--    `sources_json` for fast filtering. NULL when sources_json is empty
--    or NULL.
--
-- 6. `status TEXT` not enum. Consistent with `audit_results`,
--    `interactive_audit_results.dimension`. First values are the three
--    current statuses ('verified' | 'unverified' | 'incorrect'); if
--    FactChecker ever splits or folds statuses, no migration churn.
--
-- 7. No FK REFERENCES. Consistent with every other join column in
--    this codebase. Application-layer integrity. Orphan rows from a
--    Director that pre-allocates pieceId then fails are acceptable —
--    same pattern audit_results already has.
--
-- 8. Empty at migration time. No backfill. The 23 historical
--    audit_results.notes JSON rows aren't parsed into per-claim rows
--    — the JSON in `notes` stays the authoritative source for those
--    pieces. This table fills going forward only.
--
-- 9. Two indexes:
--    - `idx_daily_audit_claims_piece` — primary access path (drawer +
--      future admin views: "show me every claim for piece X").
--    - `idx_daily_audit_claims_status` — supports future queries like
--      "every incorrect claim across all pieces" or "every claim
--      Claude couldn't verify last week".
--
-- 10. NO admin UI consumes this table yet. Plumbing-only commit. The
--     dashboard rewrite (operator-confirmed in-progress) will be a
--     primary consumer; for now this is forward investment in
--     queryable structure.
--
-- Rollback: DROP TABLE daily_audit_claims; (table is empty at migration
-- time, no consumer reads from it yet — nothing breaks if dropped).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_audit_claims (
  id              TEXT PRIMARY KEY,
  audit_result_id TEXT NOT NULL,    -- FK (app-level) to audit_results.id
  piece_id        TEXT NOT NULL,    -- denormalized for query convenience
  round           INTEGER NOT NULL,
  claim_index     INTEGER NOT NULL, -- position in original JSON claims array
  claim_text      TEXT NOT NULL,
  status          TEXT NOT NULL,    -- 'verified' | 'unverified' | 'incorrect'
  note            TEXT,             -- Claude's per-claim explanation
  sources_json    TEXT,             -- JSON: Array<{url, title?, citedText?, searchQuery?}>
  search_query    TEXT,             -- denormalized first sources[].searchQuery for filtering
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_audit_claims_piece
  ON daily_audit_claims(piece_id, round);

CREATE INDEX IF NOT EXISTS idx_daily_audit_claims_status
  ON daily_audit_claims(status);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(daily_audit_claims);
-- -- expect 11 columns:
-- --   id (TEXT PK), audit_result_id (TEXT NOT NULL),
-- --   piece_id (TEXT NOT NULL), round (INTEGER NOT NULL),
-- --   claim_index (INTEGER NOT NULL), claim_text (TEXT NOT NULL),
-- --   status (TEXT NOT NULL), note (TEXT),
-- --   sources_json (TEXT), search_query (TEXT),
-- --   created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(daily_audit_claims);
-- -- expect idx_daily_audit_claims_piece, idx_daily_audit_claims_status
--
-- SELECT COUNT(*) FROM daily_audit_claims;     -- expect 0
