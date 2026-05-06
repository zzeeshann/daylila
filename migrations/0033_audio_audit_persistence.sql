-- 0033_audio_audit_persistence.sql
--
-- Foundation Fix Task 05 — closes three audio-pipeline data leaks in
-- one bundled migration:
--
--   L10  daily_piece_audio.duration_seconds was always NULL — the
--        column existed since migration 0010 but no writer populated
--        it. This migration changes nothing on the column itself
--        (already nullable INTEGER); the producer commit that follows
--        starts populating it from byteLength / 12000 (96 kbps assumed
--        per AUDIO_OUTPUT_FORMAT in agents/src/shared/audio-thresholds.ts).
--
--   L11  no file_size_bytes column on daily_piece_audio at all. Added
--        below as additive nullable INTEGER. Producer captures
--        audioBuffer.byteLength right after the ElevenLabs response
--        and binds it on every new beat.
--
--   L12  Audio Auditor's structured AudioIssue[] verdicts only ever
--        survived as JSON inside observer_events.context — not
--        queryable without expensive json_extract. New
--        audio_audit_results table below mirrors interactive_audit_results
--        (migration 0023) shape: per-issue rows + a summary row per
--        audit invocation.
--
-- Bundled because (a) the brief explicitly bundles them ("tiny and
-- adjacent enough to land in this same task"), (b) both leaks
-- populate from the same agent commit (audio-producer for L10/L11,
-- audio-auditor for L12), and (c) splitting would create an
-- in-between state where agent code can't write file_size_bytes
-- because the column doesn't exist yet.
--
-- See DECISIONS.md 2026-05-12 "L10, L11, L12 closed" for the full
-- rationale.
--
-- ─── audio_audit_results SHAPE DECISIONS ────────────────────────────
--
-- 1. 10 columns, dropping two from the brief's 12. `audit_round`
--    omitted — Audio Auditor doesn't have produce→audit→revise rounds
--    (runs once per pipeline invocation). Operator-triggered
--    Director.retryAudio re-invocations append fresh rows with new
--    created_at; "latest verdict" = ORDER BY created_at DESC LIMIT 1
--    over the summary rows. `expected_size_bytes` omitted — it's a
--    deterministic function of character_count × EXPECTED_BYTES_PER_CHAR
--    (a constant in audio-auditor.ts); storing duplicates the constant.
--
-- 2. `beat_name TEXT` (not the brief's `beat_index INTEGER`).
--    daily_piece_audio's PK is (piece_id, beat_name) — beat_name is
--    the kebab string the auditor already produces (AudioIssue.beatName:
--    string | null). Storing beat_index would mean recomputing an
--    ordinal that doesn't exist in source data and breaking the natural
--    join. NULL = piece-level issue (matching AudioIssue.beatName: null
--    convention) OR summary row.
--
-- 3. `issue_type TEXT` carries a closed-enum value. The auditor maps
--    each of its seven issue branches to one of the eight
--    AudioIssueType values (`no_audio_rows`, `missing_file`,
--    `empty_file`, `size_too_small`, `size_too_large`, `text_too_short`,
--    `character_cap_exceeded`, plus `unknown` reserved for forward-
--    compat). Closed enum lives in agents/src/types.ts as a typed
--    union + ReadonlySet, mirroring Task 03's RejectionCategory pattern.
--    Loose TEXT here (no CHECK) so adding a value never requires a
--    migration; defensive validation lives at the writer.
--
-- 4. `issue_severity TEXT` — `'minor' | 'major'`, matching the
--    existing AudioIssue.severity union exactly so we don't reinvent
--    vocabulary. NULL on summary rows.
--
-- 5. `passed INTEGER NOT NULL` 0/1, codebase convention for booleans.
--    Per-row meaning: 1 on the summary row when no major issues; 0 on
--    every issue row and on the summary row when any major issue
--    exists.
--
-- 6. `notes TEXT` — the auditor's free-form issue prose verbatim
--    ("Audio suspiciously small: 12KB for 800 chars (expected ~78KB).
--    Possibly truncated."), so admin queries surface human-readable
--    detail without re-formatting. On the summary row, a short rollup
--    string ("Audited N beats, K issues (M major)").
--
-- 7. `r2_key TEXT` populated on missing-file / size-anomaly issues so
--    operator can `wrangler r2 object head` without re-deriving the
--    path. NULL for piece-level issues and summary rows.
--
-- 8. `actual_size_bytes INTEGER` populated when the issue is size-
--    related (the obj.size value the auditor already has in scope).
--    NULL for text_too_short / no_audio_rows / character_cap_exceeded
--    / summary rows — intentionally not fabricated for issue types
--    where the size wasn't load-bearing.
--
-- 9. No FOREIGN KEY REFERENCES daily_pieces. Consistent with every
--    other join column in this codebase (and explicitly with
--    interactive_audit_results' migration 0023 reasoning:
--    "Application-layer integrity. Orphan rows… are acceptable").
--
-- 10. Composite index on (piece_id, created_at) covers both the common
--     reader query (latest verdict for one piece) and audit history
--     timelines. SQLite uses leftmost-prefix matching, so a single
--     piece_id lookup also benefits. The brief's second
--     `(passed) WHERE passed = 0` partial index is speculative —
--     Year-1 row count is small (~3k rows worst case at 1 piece/day ×
--     ~6 beats × 365 + summaries), SQLite full-scans those in
--     milliseconds. Same calculus as Task 03's no-speculative-index
--     call.
--
-- 11. Empty at migration time. No backfill — historical
--     audio_audit_results can't be reconstructed without re-running
--     the auditor against historical R2 objects, and forensic context
--     for past failures lives in observer_events.context (preserved as
--     backup until Task 08 retention).
--
-- ─── daily_piece_audio.file_size_bytes (L11) SHAPE ─────────────────
--
-- Additive nullable INTEGER. Forward-only — historical rows stay NULL
-- as honest record (per Task 04's pre-Task-04 NULL precedent on
-- learnings.loaded_at / load_count). Producer's persistBeatRow
-- INSERT OR REPLACE in agents/src/audio-producer.ts gains the column
-- in its column list and binds audioBuffer.byteLength.
--
-- Rollback: DROP TABLE audio_audit_results; (table is empty at
-- migration time). For the file_size_bytes ALTER, SQLite has no DROP
-- COLUMN without table rebuild — additive nullable column stays
-- harmless if rollback is needed.

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audio_audit_results (
  id                  TEXT PRIMARY KEY,
  piece_id            TEXT NOT NULL,
  beat_name           TEXT,             -- NULL = piece-level issue OR summary row
  passed              INTEGER NOT NULL, -- 0 | 1
  issue_type          TEXT,             -- closed enum (AudioIssueType); NULL on summary row
  issue_severity      TEXT,             -- 'minor' | 'major'; NULL on summary row
  notes               TEXT,             -- free-form issue prose; rollup on summary row
  r2_key              TEXT,             -- populated on missing-file / size-anomaly issues
  actual_size_bytes   INTEGER,          -- populated on size-related issues
  created_at          INTEGER NOT NULL  -- Unix ms
);

CREATE INDEX IF NOT EXISTS idx_audio_audit_piece_created
  ON audio_audit_results(piece_id, created_at);

ALTER TABLE daily_piece_audio
  ADD COLUMN file_size_bytes INTEGER;

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(audio_audit_results);
-- -- expect 10 columns:
-- --   id (TEXT PK), piece_id (TEXT NOT NULL),
-- --   beat_name (TEXT), passed (INTEGER NOT NULL),
-- --   issue_type (TEXT), issue_severity (TEXT),
-- --   notes (TEXT), r2_key (TEXT),
-- --   actual_size_bytes (INTEGER), created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(audio_audit_results);
-- -- expect idx_audio_audit_piece_created (composite on piece_id, created_at)
--
-- SELECT COUNT(*) FROM audio_audit_results;     -- expect 0
--
-- PRAGMA table_info(daily_piece_audio);
-- -- expect file_size_bytes (INTEGER) as the trailing column
--
-- SELECT COUNT(*) FROM daily_piece_audio WHERE file_size_bytes IS NOT NULL;
-- -- expect 0 immediately post-migration; populates going forward via producer
