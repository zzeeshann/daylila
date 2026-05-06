-- 0035_audio_dwell_events.sql
--
-- Foundation Fix Task 07 — closes the last high-severity Phase 2 leak:
--
--   L17  Reader audio dwell time was computed for the browser's
--        mediaSession lock-screen scrubber but never POSTed back. Every
--        listener-second of attention was lost. Of the 25 audit leaks,
--        L17 is the only one on the reader-signal side; closing it
--        gives the Learner its fourth signal source (chapter 15) at
--        beat-level granularity.
--
-- See DECISIONS.md 2026-05-07 "L17 closed" for the full rationale and
-- 07-DWELL-TIME.md for the original brief.
--
-- ─── audio_dwell_events SHAPE DECISIONS ──────────────────────────────
--
-- 1. Append-only event log, NOT an extension of the engagement table.
--    Schema fork was surfaced to the user up front: engagement is
--    per-piece-per-day aggregate (PK piece_id+course_id+date since
--    migration 0017, no user_id), so adding dwell columns would have
--    forced a PK rebuild + user_id column + four ON CONFLICT rewrites
--    in /api/engagement/track.ts + Learner SQL + admin dashboard SQL.
--    High blast radius for an additive signal. The append-only shape
--    matches the interactive_engagement (migration 0022) and
--    audio_audit_results (migration 0033) precedent — per-listener
--    granularity, aggregation at query time. engagement stays
--    untouched; this table sits beside it.
--
-- 2. INTEGER PRIMARY KEY AUTOINCREMENT — chosen over the
--    TEXT-PK-with-randomUUID() pattern (audit_results,
--    audio_audit_results) because audio_dwell_events has no
--    cross-row reference need; consumers SELECT-by-piece or
--    SELECT-by-user with ORDER BY occurred_at, never by id. Same
--    shape as draft_revisions and integrator_decisions (migration
--    0034).
--
-- 3. user_id TEXT NOT NULL — middleware always populates
--    locals.userId (anonymous users get a generated id + cookie on
--    first request, see src/middleware.ts:101). Anonymity is at the
--    auth layer, not the row layer; per-user attribution is always
--    present even when the user has never typed an email. NULL
--    would only ever indicate a writer bug.
--
-- 4. piece_id TEXT NOT NULL — daily_pieces.id (UUID). No FOREIGN
--    KEY, matching codebase posture (orphan rows from races against
--    publish are tolerated; consumers JOIN where needed).
--
-- 5. beat_name TEXT NOT NULL — locked over the brief's
--    beat_index INTEGER. Matches daily_piece_audio's PK
--    (piece_id, beat_name) since migration 0015 and the
--    audio_audit_results precedent (migration 0033). The audio
--    player has no native ordinal — beatOrder is computed from DOM
--    at runtime, not persisted — so storing beat_index would mean
--    inventing a renumbering-fragile ordinal. Natural join:
--    audio_dwell_events ⋈ daily_piece_audio USING (piece_id, beat_name)
--    gives clip duration for ratio sanity checks.
--
-- 6. dwell_seconds REAL NOT NULL — REAL not INTEGER because
--    heartbeats fire every 30s but the player's per-tick
--    accumulation runs on `timeupdate` events at fractional
--    intervals (and iOS Safari throttles them under load).
--    Storing the integer rounding would discard ~0.5s per flush
--    on average. Range 0–3600 enforced at the writer; anything
--    larger is a tab-throttle accumulation bug, see decision 8.
--
-- 7. ratio REAL — dwell_seconds ÷ clip_duration_seconds, a 0–1.5
--    convenience for aggregation (so admin queries don't need to
--    join daily_piece_audio for the common "completion ratio"
--    question). Nullable because clip duration may not be known at
--    write time (audio.duration is NaN until 'loadedmetadata' fires
--    — first heartbeat on a fast-network play could fire before
--    that). Upper bound 1.5 not 1.0 — a brief overshoot during the
--    heartbeat-after-ended boundary is plausible and shouldn't
--    reject the row.
--
-- 8. ended_reason TEXT NOT NULL — closed enum in five values:
--      'pause'        — reader hit pause; clip still loaded
--      'ended'        — clip naturally ended (audio.ended event)
--      'beat_change'  — auto-advance, prev/next button, or
--                       MediaSession previoustrack/nexttrack
--      'heartbeat'    — 30-second tick during continuous play; the
--                       cover for iOS Safari's unreliable pagehide
--      'pagehide'     — sendBeacon fired on tab close / hide
--    Loose TEXT (no CHECK constraint) so adding a value is a zero-
--    migration change; defensive validation lives at the writer
--    (/api/engagement/audio.ts as a Set literal). Closed enum lives
--    only in TS types since this task has no agents/src changes —
--    the writer is a site-worker route, not a Director loop.
--    Unknown values reject 400 (drift surfaces as bad-request, not
--    silent drop).
--
-- 9. occurred_at INTEGER NOT NULL — Unix ms, codebase convention
--    (audit_results, pipeline_log, audio_audit_results, draft_revisions
--    all use ms). Server-side Date.now(), NOT a client field —
--    avoids clock-drift attacks and skewed timelines.
--
-- 10. NO started_at column. The row IS the event. dwell_seconds
--     accumulates since the previous flush (or clip-start on first
--     flush). Reconstructing per-session timelines is the consumer's
--     job (window functions over occurred_at + ended_reason).
--     Storing started_at would invite implicit overlap reasoning
--     that the heartbeat path doesn't actually guarantee — heartbeats
--     fire DURING play, not on session boundaries.
--
-- 11. Two indexes:
--       idx_dwell_piece_occurred (piece_id, occurred_at)
--         Covers the dominant operator query "show me dwell on this
--         piece, latest first" and the leftmost-prefix lookup for
--         per-piece scans that filter on beat_name in the WHERE.
--       idx_dwell_user_occurred (user_id, occurred_at)
--         Covers per-user retrospectives. The reader-facing surface
--         is deferred (FOLLOWUPS [deferred] 2026-05-07 entry, drop-off
--         heatmaps after 30 days of accrual) but the index is cheap
--         to land alongside the table — adding it later would
--         require an index build over a growing table.
--     No third (piece_id, beat_name) index — speculative; per-piece
--     scans are bounded (~10 beats × N events × M readers/day) and
--     the leftmost prefix on idx_dwell_piece_occurred handles them.
--
-- 12. NO FOREIGN KEY REFERENCES daily_pieces or users. Same posture
--     as audio_audit_results, interactive_audit_results,
--     daily_audit_claims. Application-layer integrity.
--
-- 13. Empty at migration time. No backfill — historical dwell
--     cannot be reconstructed (it was never written). Forward-only,
--     same posture as Task 04's pre-fix NULL precedent on
--     learnings.loaded_at and Task 05's pre-fix NULL precedent on
--     daily_piece_audio.duration_seconds.
--
-- ─── PRIVACY POSTURE ─────────────────────────────────────────────────
--
-- The /api/engagement/audio writer NEVER reads request.headers
-- (no cf-connecting-ip, no user-agent, no referrer). The row carries
-- the engagement signal and nothing else: who (anonymous user_id),
-- what (piece_id + beat_name + ended_reason), how much
-- (dwell_seconds + ratio), when (occurred_at). No identifying
-- request metadata is logged anywhere in the path. This is the first
-- Foundation Fix task that touches reader-side identity at a
-- per-event granularity; the privacy line is held here so the
-- precedent is set going forward.
--
-- Rollback: DROP TABLE audio_dwell_events; (table is empty at
-- migration time; rollback also drops both indexes implicitly).

-- ══════════════════════════════════════════════════════════════════
-- AUTO-APPLIED (runs on `wrangler d1 migrations apply`)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audio_dwell_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  piece_id        TEXT NOT NULL,
  beat_name       TEXT NOT NULL,
  dwell_seconds   REAL NOT NULL,
  ratio           REAL,
  ended_reason    TEXT NOT NULL,           -- closed enum (DwellEndedReason)
  occurred_at     INTEGER NOT NULL         -- Unix ms, server-side Date.now()
);

CREATE INDEX IF NOT EXISTS idx_dwell_piece_occurred
  ON audio_dwell_events(piece_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_dwell_user_occurred
  ON audio_dwell_events(user_id, occurred_at);

-- ══════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFY (run via `wrangler d1 execute --remote`)
-- ══════════════════════════════════════════════════════════════════
--
-- PRAGMA table_info(audio_dwell_events);
-- -- expect 8 columns:
-- --   id (INTEGER PK AUTOINCREMENT), user_id (TEXT NOT NULL),
-- --   piece_id (TEXT NOT NULL), beat_name (TEXT NOT NULL),
-- --   dwell_seconds (REAL NOT NULL), ratio (REAL),
-- --   ended_reason (TEXT NOT NULL), occurred_at (INTEGER NOT NULL)
--
-- PRAGMA index_list(audio_dwell_events);
-- -- expect idx_dwell_piece_occurred + idx_dwell_user_occurred
-- -- (plus the SQLite auto-index for the autoincrement PK).
--
-- SELECT COUNT(*) FROM audio_dwell_events;     -- expect 0
