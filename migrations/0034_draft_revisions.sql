-- 0034_draft_revisions.sql
--
-- Foundation Fix Task 06 — closes three audit-revise-loop data leaks
-- in one bundled migration:
--
--   L4   Initial Drafter MDX + per-round Integrator MDX only ever
--        existed in memory. Only the FINAL revision (the one
--        Director hands to Publisher) survived as the .mdx file in
--        git. Round 0 (the first cut) and any intermediate round
--        before the final were lost.
--
--   L8   Per-round MDX diffs were stored nowhere. Even with the
--        round-by-round audit_results from migration 0001 (Director's
--        saveAuditResults), there was no way to reconstruct what the
--        Integrator actually changed between round N and round N+1.
--
--   L9   Per-feedback-item accept/overrule reasoning was stored
--        nowhere. The Integrator's old return shape carried a
--        `changesSummary` that was just the input feedback echoed
--        back, not the disposition of each item.
--
-- Bundled because all three share the same code path (Drafter +
-- Integrator + Director's audit-revise loop) and the per-decision
-- table only makes sense alongside the per-round MDX table —
-- splitting would create an in-between state where decisions
-- reference rounds that aren't persisted yet.
--
-- See DECISIONS.md 2026-05-07 "L4, L8, L9 closed" for the full
-- rationale.
--
-- ─── draft_revisions SHAPE DECISIONS ────────────────────────────
--
-- 1. INTEGER PRIMARY KEY AUTOINCREMENT — chosen over the
--    TEXT-PK-with-randomUUID() pattern (audit_results,
--    daily_audit_claims, audio_audit_results) because draft_revisions
--    has a natural unique key (piece_id, revision_round) and the only
--    consumers are SELECT-by-piece queries that don't need a UUID
--    handle. Same shape as integrator_decisions below for symmetry.
--
-- 2. revision_round INTEGER NOT NULL — 0 = Drafter's initial output,
--    1+ = Integrator output after round N's auditor feedback. Same
--    numbering scheme Director uses in its `r${round}` taskId
--    suffix and `auditing_r${round}` step labels.
--
-- 3. mdx_content TEXT NOT NULL — full MDX at this revision. Stores
--    the same string Drafter / Integrator returned, INCLUDING the
--    frontmatter the agent generated. The published copy gets
--    additional Director-injected frontmatter splices (voiceScore,
--    pieceId, publishedAt, audioBeats, claimReviews) AFTER the
--    final round; those splices live only in git, not in the
--    revision history. So mdx_content here is "what the agent
--    wrote", not "what got published". Diffs between rounds are
--    pure agent-authored prose changes — no Director noise.
--
-- 4. word_count INTEGER — denormalised so admin queries can render
--    the revision trail without TEXT scans. NULL allowed for
--    forward-compat (e.g. if a future authored_by value carries
--    non-prose content where word_count doesn't apply); current
--    writers always populate.
--
-- 5. authored_by TEXT NOT NULL — 'drafter' | 'integrator'. Loose
--    TEXT (no CHECK constraint) so adding a value never requires a
--    migration; defensive validation lives at the writer. Same
--    posture as audio_audit_results.issue_type and
--    daily_candidates.rejection_category — closed enum lives in
--    agents/src/types.ts as a typed union.
--
-- 6. created_at INTEGER NOT NULL — Unix ms, codebase convention
--    (audit_results, pipeline_log, audio_audit_results all use ms).
--    The brief showed DATETIME / CURRENT_TIMESTAMP but every other
--    table uses INTEGER ms; staying consistent.
--
-- 7. UNIQUE(piece_id, revision_round) — one row per (piece, round)
--    pair. Idempotency: if Director's audit-revise loop ever
--    accidentally wrote the same round twice for one piece (a
--    re-run of the alarm without state cleanup), the UNIQUE
--    constraint surfaces it as a write failure rather than
--    silently double-recording. The agent writers wrap the INSERT
--    in try/catch and surface the error via persistError sentinel
--    so a constraint violation logs once via observer.logError
--    without sinking the publish path.
--
-- 8. No FOREIGN KEY REFERENCES daily_pieces. Same reasoning as
--    audio_audit_results / interactive_audit_results /
--    daily_audit_claims: orphan rows from runs that error before
--    publish are acceptable; readers JOIN daily_pieces.id where
--    needed.
--
-- 9. Single index on piece_id (the common SELECT axis). Composite
--    on (piece_id, revision_round) is implicit via the UNIQUE
--    constraint, so an explicit one would duplicate.
--
-- ─── integrator_decisions SHAPE DECISIONS ────────────────────────
--
-- 1. revision_round INTEGER NOT NULL — joins to draft_revisions
--    via (piece_id, revision_round). Always 1+ (round 0 is the
--    initial Drafter output, before any Integrator decisions).
--
-- 2. feedback_source TEXT NOT NULL — closed enum
--    'voice_auditor' | 'fact_checker' | 'structure_editor'. Loose
--    TEXT, defensive validation at the writer (FEEDBACK_SOURCES
--    runtime mirror). Maps directly to the three auditor agents
--    Integrator synthesises feedback from.
--
-- 3. feedback_summary TEXT NOT NULL — the specific issue Claude is
--    addressing this round, its own paraphrase of the auditor's
--    flag. Not a quote of the auditor's wording — the Integrator's
--    own articulation of what it understood the issue to be. This
--    is the diagnostic value: when feedback_summary doesn't match
--    what the auditor actually said, that's signal about prompt
--    drift.
--
-- 4. decision TEXT NOT NULL — closed enum
--    'accepted' | 'overruled' | 'partial'. accepted = revised the
--    text per the feedback. overruled = chose not to act on it
--    (rare; Integrator's prompt instructs it to fix every flagged
--    issue, but legitimate overrules happen — e.g. a fact-checker
--    flag the Integrator believes is spurious). partial = some
--    aspect addressed, others left.
--
-- 5. reasoning TEXT — Integrator's free-form explanation. Optional
--    for forward-compat (a brief one-word disposition might not
--    need prose), but writers should populate. NULL is honest
--    when the model didn't supply one.
--
-- 6. resulting_change TEXT — one-line summary of what literally
--    changed in the MDX. Optional like reasoning. The diff between
--    draft_revisions[round-1] and draft_revisions[round] is the
--    source of truth for the literal change; this column is the
--    Integrator's own one-line characterisation of it.
--
-- 7. created_at INTEGER NOT NULL — Unix ms, codebase convention.
--
-- 8. No UNIQUE constraint. A single round can produce many
--    decisions (one per feedback item Integrator addressed); no
--    natural composite key beyond (piece_id, revision_round,
--    feedback_summary) and feedback_summary is freeform prose, not
--    a stable join key.
--
-- 9. Two indexes: by piece_id (per-piece read path), by
--    feedback_source (cross-piece operator queries — e.g. "show
--    all overruled voice_auditor flags last 30 days"). The
--    feedback_source index is speculative but the cardinality is
--    bounded (3 values) and index size negligible, so worth the
--    write-amp for the operator-query ergonomics.
--
-- 10. No FOREIGN KEY. Same reasoning as draft_revisions above.
--
-- 11. Empty at migration time. No backfill — historical revision
--     histories cannot be reconstructed (they only ever lived in
--     memory). Forward-only, same posture as Task 05's pre-fix
--     NULL precedent on daily_piece_audio metadata columns and
--     Task 04's pre-fix NULL precedent on learnings.loaded_at.
--
-- Rollback: DROP TABLE integrator_decisions; DROP TABLE draft_revisions;
-- (both are empty at migration time).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS draft_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id        TEXT NOT NULL,
  revision_round  INTEGER NOT NULL,        -- 0 = drafter, 1+ = integrator
  mdx_content     TEXT NOT NULL,
  word_count      INTEGER,
  authored_by     TEXT NOT NULL,           -- closed enum: 'drafter' | 'integrator'
  created_at      INTEGER NOT NULL,        -- Unix ms
  UNIQUE(piece_id, revision_round)
);

CREATE INDEX IF NOT EXISTS idx_draft_revisions_piece
  ON draft_revisions(piece_id);

CREATE TABLE IF NOT EXISTS integrator_decisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id          TEXT NOT NULL,
  revision_round    INTEGER NOT NULL,
  feedback_source   TEXT NOT NULL,         -- closed enum (FeedbackSource)
  feedback_summary  TEXT NOT NULL,
  decision          TEXT NOT NULL,         -- closed enum (IntegratorDecision)
  reasoning         TEXT,
  resulting_change  TEXT,
  created_at        INTEGER NOT NULL       -- Unix ms
);

CREATE INDEX IF NOT EXISTS idx_integrator_decisions_piece
  ON integrator_decisions(piece_id);

CREATE INDEX IF NOT EXISTS idx_integrator_decisions_source
  ON integrator_decisions(feedback_source);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(draft_revisions);
-- -- expect 7 columns:
-- --   id (INTEGER PK AUTOINCREMENT), piece_id (TEXT NOT NULL),
-- --   revision_round (INTEGER NOT NULL), mdx_content (TEXT NOT NULL),
-- --   word_count (INTEGER), authored_by (TEXT NOT NULL),
-- --   created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(draft_revisions);
-- -- expect idx_draft_revisions_piece + the auto-index for UNIQUE
--
-- SELECT COUNT(*) FROM draft_revisions;       -- expect 0
--
-- PRAGMA table_info(integrator_decisions);
-- -- expect 9 columns:
-- --   id (INTEGER PK AUTOINCREMENT), piece_id (TEXT NOT NULL),
-- --   revision_round (INTEGER NOT NULL), feedback_source (TEXT NOT NULL),
-- --   feedback_summary (TEXT NOT NULL), decision (TEXT NOT NULL),
-- --   reasoning (TEXT), resulting_change (TEXT),
-- --   created_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(integrator_decisions);
-- -- expect idx_integrator_decisions_piece + idx_integrator_decisions_source
--
-- SELECT COUNT(*) FROM integrator_decisions;  -- expect 0
