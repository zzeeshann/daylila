-- 0030_saved_pieces.sql
--
-- Per-user "save this piece" record. Phase 2 of the /account/ rebuild
-- (2026-05-02). Powers the meta-line `· Save` / `· Saved ✓` toggle on
-- every piece page and the Saved section on /account/.
--
-- SHAPE DECISIONS:
--
-- 1. PK (user_id, piece_id) — one row per user per piece. Toggle
--    semantics: if the row exists, DELETE; else INSERT. Idempotent.
--
-- 2. `created_at INTEGER NOT NULL` — Unix ms. Powers Account's "Saved"
--    section sort (newest first) and the per-row "Date saved" display.
--
-- 3. No FK REFERENCES — consistent with every other join column in
--    this codebase. Application-layer integrity.
--
-- 4. One index: `idx_saved_pieces_user (user_id, created_at DESC)` —
--    primary access path for the Account "Saved" query.
--
-- 5. Empty at migration time. No backfill.
--
-- 6. Anonymous + signed-in both write here. Saves carry through
--    magic-link / password sign-in via `mergeProgress`, which the
--    same Phase 2 commit extends to merge this table alongside
--    `progress` and `user_piece_reads`.
--
-- Rollback: DROP TABLE saved_pieces; (table is empty + additive).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS saved_pieces (
  user_id    TEXT NOT NULL,
  piece_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, piece_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_pieces_user
  ON saved_pieces (user_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(saved_pieces);
-- -- expect 3 columns: user_id (TEXT NOT NULL, PK 1), piece_id (TEXT
-- --                   NOT NULL, PK 2), created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(saved_pieces);
-- -- expect idx_saved_pieces_user, sqlite_autoindex_saved_pieces_1 (PK)
--
-- SELECT COUNT(*) FROM saved_pieces;  -- expect 0
