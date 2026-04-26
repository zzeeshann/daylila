-- 0026_interactives_unique_slug_type.sql
--
-- Interactives v3 — Phase 2, sub-task 2.5.
--
-- Relaxes `interactives.slug UNIQUE` → composite `UNIQUE(slug, type)`.
--
-- WHY:
--
-- A piece's quiz + html interactives share the slug — one URL per
-- piece (`/interactives/<slug>/` renders both teaching modalities).
-- The original `UNIQUE(slug)` from migration 0022 forced HTML to suffix
-- to '<slug>-2', splitting siblings across URLs.
--
-- Composite `UNIQUE(slug, type)` keeps slug unique within a type (no
-- two quizzes can collide across pieces, no two HTML interactives
-- either) while letting quiz + html for the same piece share. The
-- Generator's `resolveFreeSlug` becomes type-aware in the same commit:
-- only checks collisions within the artefact type.
--
-- SQLite has no DROP CONSTRAINT or DROP INDEX-on-UNIQUE, so this is a
-- table rebuild — same pattern migration 0015 used for the
-- `daily_piece_audio` PK change. Snapshot held for 7-day rollback
-- window (FOLLOWUPS queues the drop for 2026-05-04).
--
-- WHAT STAYS:
--   - Three named indexes (idx_interactives_slug,
--     idx_interactives_source_piece, idx_interactives_published_at)
--     get recreated explicitly after the rebuild — implicit indexes
--     vanish with the old table.
--   - All 13 columns + their nullability semantics (carried over via
--     the explicit column list in the INSERT...SELECT).
--   - Every existing row's id, slug, type, etc. — full data preserved.
--
-- WHAT CHANGES:
--   - The auto-created sqlite_autoindex_interactives_1 (from `slug
--     UNIQUE`) is replaced by sqlite_autoindex_interactives_1 from
--     `UNIQUE(slug, type)`. Same name; different shape.
--
-- ROLLBACK (within 7 days):
--
-- DROP TABLE interactives;
-- ALTER TABLE interactives_backup_20260426 RENAME TO interactives;
-- -- Then recreate the three named indexes from 0022.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS interactives_backup_20260426 AS
SELECT * FROM interactives;

CREATE TABLE interactives_new (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  concept          TEXT,
  source_piece_id  TEXT,
  content_json     TEXT,
  voice_score      INTEGER,
  quality_flag     TEXT,
  revision_count   INTEGER NOT NULL DEFAULT 0,
  published_at     INTEGER,
  created_at       INTEGER NOT NULL,
  quality_tier     TEXT,
  UNIQUE(slug, type)
);

INSERT INTO interactives_new
  (id, slug, type, title, concept, source_piece_id, content_json,
   voice_score, quality_flag, revision_count, published_at,
   created_at, quality_tier)
SELECT id, slug, type, title, concept, source_piece_id, content_json,
       voice_score, quality_flag, revision_count, published_at,
       created_at, quality_tier
  FROM interactives;

DROP TABLE interactives;
ALTER TABLE interactives_new RENAME TO interactives;

CREATE INDEX IF NOT EXISTS idx_interactives_slug
  ON interactives(slug);
CREATE INDEX IF NOT EXISTS idx_interactives_source_piece
  ON interactives(source_piece_id);
CREATE INDEX IF NOT EXISTS idx_interactives_published_at
  ON interactives(published_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(interactives);
-- -- expect 13 columns, same as 0025.
--
-- PRAGMA index_list(interactives);
-- -- expect 3 named indexes + 1 auto-index from UNIQUE(slug, type).
-- -- The auto-index name is sqlite_autoindex_interactives_1.
--
-- SELECT COUNT(*) FROM interactives;
-- -- expect 8 (every existing quiz row preserved).
--
-- SELECT COUNT(*) FROM interactives_backup_20260426;
-- -- expect 8 (snapshot taken BEFORE rebuild).
--
-- -- Verify composite uniqueness allows quiz+html on the same slug:
-- INSERT INTO interactives (id, slug, type, title, source_piece_id,
--                           revision_count, created_at)
-- VALUES ('test-1', 'shared-slug', 'quiz', 't', 'p1', 0, 0),
--        ('test-2', 'shared-slug', 'html', 't', 'p1', 0, 0);
-- -- expect both rows insert. Then:
-- DELETE FROM interactives WHERE id IN ('test-1', 'test-2');
--
-- -- Verify type-internal uniqueness still rejects duplicate slugs:
-- INSERT INTO interactives (id, slug, type, title, source_piece_id,
--                           revision_count, created_at)
-- VALUES ('test-3', 'chokepoints-and-cascades', 'quiz', 't', 'p2', 0, 0);
-- -- expect UNIQUE constraint failure.
