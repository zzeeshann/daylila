# Daylila v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Database ID: `f3cdccbf-7cea-4af1-b524-20f6a6fe1dd4`
**27 tables across 45 migrations.**

## Reader-side tables

### users
Every visitor — anonymous and authenticated. Created on first API call.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID, generated on first visit |
| email | TEXT UNIQUE | Null for anonymous users, added on upgrade |
| password_hash | TEXT | PBKDF2 hash, null for anonymous |
| created_at | INTEGER | Unix timestamp ms |
| updated_at | INTEGER | Unix timestamp ms |

Migration: `0001_init.sql`

### progress
Tracks which beat a reader is on and which lessons they've completed.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT FK→users | |
| course_slug | TEXT | e.g. "body" |
| lesson_number | INTEGER | e.g. 1 |
| current_beat | TEXT | e.g. "teaching-1", null if not started or completed |
| completed_at | INTEGER | Unix timestamp ms, null if not finished |
| created_at | INTEGER | |
| updated_at | INTEGER | |

PK: (user_id, course_slug, lesson_number). Migration: `0001_init.sql`

### submissions
Optional practice data (breathing timer results, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK→users | |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| practice_type | TEXT | e.g. "breathing" |
| data | TEXT | JSON blob |
| created_at | INTEGER | |

Migration: `0001_init.sql`

### zita_messages
Conversation history for the Zita learning guide.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK→users | |
| course_slug | TEXT | |
| lesson_number | INTEGER | |
| role | TEXT | "user" or "assistant" |
| content | TEXT | Message text |
| created_at | INTEGER | |
| piece_date | TEXT | YYYY-MM-DD of the `daily_pieces` row this conversation is about. Nullable at schema level so migration 0013 applied non-destructively to 92 pre-existing rows (backfilled via commented one-time UPDATEs in the migration file). Application layer (Commit B of Phase 1) enforces non-null for `course_slug='daily'` requests; lessons-course path still works with piece_date=null. Indexed via `idx_zita_piece(user_id, piece_date)`. Primary read paths: scoped history load in `/api/zita/chat`, per-piece admin view, P1.5 synthesis by piece. |
| piece_id | TEXT | `daily_pieces.id` (UUID) this conversation is about. Added migration 0014 (cadence Phase 1) so Phase 6's Zita re-scoping can target a specific piece when multiple share a date. Nullable at schema level; backfilled from `piece_date → daily_pieces.date → daily_pieces.id` for the 92 migration-0013 rows. Indexed via `idx_zita_piece_id`. `piece_date` stays alongside for now — Phase 6 will deprecate the date-scoped SELECT in favour of piece_id. |

Migrations: `0001_init.sql` (initial), `0013_zita_messages_piece_date.sql` (added `piece_date`), `0014_piece_id_fks.sql` (added `piece_id`).

### user_piece_reads
Per-user-per-piece reading record. Foundation for the /account/ rebuild's Resume → Recently read → Subjects sections (2026-05-02). Closes the gap left by `progress` (PK `(user_id, course_slug, lesson_number)` with `lesson_number=0` hardcoded for daily, so all daily reads collapse to one row per user) and `engagement` (per-piece-per-day aggregate, not per-user).

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT NOT NULL | `users.id`. Anonymous + signed-in both write here — middleware always populates `Astro.locals.userId`. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK, consistent with the rest of this codebase's join columns. |
| started_at | INTEGER NOT NULL | Unix ms. First time the user was tracked on the piece. Preserved across upserts so /account/ Resume's "Started {date}" stays anchored. |
| last_seen_at | INTEGER NOT NULL | Unix ms. Most recent event of any kind (view / beat / complete). Streak math reads `DISTINCT(date(last_seen_at))` over a 14-day window; Resume sorts in-progress rows by this DESC. |
| current_beat | TEXT | Name of the most recent `<lesson-beat>` crossed (set by lesson-shell's per-beat IntersectionObserver firing `event='beat'`). NULL when never advanced past the first beat or when cleared on `complete`. Lets Resume deep-link to `/daily/{date}/{slug}/#{current_beat}` — `<lesson-beat>` carries `id={name}` since the same session, so the anchor resolves. |
| completed_at | INTEGER | Unix ms. Footer reached. NULL while in-progress. |

PK: **(user_id, piece_id)**. Indexes: `idx_upr_user_seen` on `(user_id, last_seen_at DESC)` (Resume + streak), `idx_upr_user_completed` on `(user_id, completed_at DESC)` (Recently-read).

Writers: `src/pages/api/reads/track.ts` upserts on three event types — `'view'` (started_at + last_seen_at, defensive ON CONFLICT preserving started_at), `'beat'` (current_beat + last_seen_at), `'complete'` (completed_at + last_seen_at, current_beat cleared). Lesson-shell fires all three: view on `connectedCallback`, beat per per-beat ≥0.5 IntersectionObserver, complete on the existing finish-state sentinel observer.

Reader: `src/pages/account.astro` for Resume + Recently read + Subjects + streak.

Anonymous → signed-in continuity: `mergeProgress` (`src/lib/db.ts:109`) was extended in the same commit to merge `user_piece_reads` alongside `progress`. Both auth paths (password login + magic-link verify) now use the helper — magic-link verify was refactored from inline duplicated SQL.

Migration: `0029_user_piece_reads.sql`

### saved_pieces
Per-user "save this piece" record. Phase 2 of the /account/ rebuild (2026-05-02). Powers the meta-line `· Save` / `· Saved ✓` toggle on every piece page (`src/layouts/LessonLayout.astro`) and the Saved section on `/account/`.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT NOT NULL | `users.id`. Anonymous + signed-in both write here. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK. |
| created_at | INTEGER NOT NULL | Unix ms. Powers the Account "Saved" sort (newest first) and the per-row "Date saved" display. |

PK: **(user_id, piece_id)** — composite, idempotent toggle. Index: `idx_saved_pieces_user (user_id, created_at DESC)`.

Writers: `src/pages/api/saved/toggle.ts` — POST toggles (existence check then DELETE / INSERT, returns `{ saved: boolean }` with the new state); GET returns the current state without mutation (used by the prerendered piece page on hydration to set the initial Save/Saved label).

Reader: `src/pages/account.astro` (Saved section, cap-at-20) and the same toggle endpoint (current-state query + Unsave inline button).

Anonymous → signed-in continuity: `mergeProgress` (`src/lib/db.ts:109`) extended in the same Phase 2 commit to merge this table alongside `progress` + `user_piece_reads`.

Migration: `0030_saved_pieces.sql`

## Agent-side tables

### observer_events
What Zishan should know about — published lessons, escalations, errors.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| severity | TEXT | info, warn, escalation |
| title | TEXT | Short summary |
| body | TEXT | Markdown detail |
| context | TEXT | JSON with task IDs, scores, etc. |
| piece_id | TEXT | `daily_pieces.id` for piece-scoped events (Published, Audio*, Reflection, Learner, etc.). NULL for system events (admin_settings_changed, zita_rate_limited, global errors) and legacy pre-0020 rows. Per-piece admin query prefers piece_id match; falls back to 36h day-of-publish window for legacy NULL rows. Added in migration 0020 (2026-04-22). |
| acknowledged_at | INTEGER | Null until Zishan acknowledges |
| created_at | INTEGER | |

Migrations: `0002_observer_events.sql`, `0020_observer_events_piece_id.sql`

### engagement
Reader engagement metrics, aggregated per piece per day.

| Column | Type | Notes |
|--------|------|-------|
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Primary attribution axis since migration 0017. For non-daily content, lesson-shell falls back to the old lesson_id semantics; for daily pieces, sourced from `<lesson-shell data-piece-id>` (injected by rehype-beats from MDX frontmatter). |
| lesson_id | TEXT | Retained as a plain column for display-compat with pre-0017 admin widgets. On daily pieces this holds the piece_date; on legacy/lesson content, the lesson identifier. No longer part of the PK. |
| course_id | TEXT | e.g. "daily", "body" |
| date | TEXT | YYYY-MM-DD — activity date (when the reader hit the page), not publish date |
| views | INTEGER | Default 0 |
| completions | INTEGER | Default 0 |
| avg_time_seconds | INTEGER | |
| drop_off_beat | TEXT | Most common drop-off point |
| audio_plays | INTEGER | Default 0 |
| widget_reveal_opens | INTEGER | Default 0. Counter for `<lesson-reveal>` widget first-opens per-piece-per-day. Added migration 0043 (PR #3, 2026-05-09). Phase 1 (this PR) lands the writes; Phase 2 (FOLLOWUPS [deferred] 2026-05-09) extends LearnerAgent to read. |
| widget_compare_views | INTEGER | Default 0. Counter for `<lesson-compare>` first-viewport-entries per-piece-per-day. Added migration 0043. |
| widget_callouts_seen | INTEGER | Default 0. Counter for `<lesson-callout>` first-viewport-entries per-piece-per-day. Added migration 0043. |

PK: **(piece_id, course_id, date)** since migration 0017. Indexes: `idx_engagement_course` on `course_id`, `idx_engagement_date` on `date`, `idx_engagement_piece` on `piece_id`. Migrations: `0003_engagement_learnings.sql` (initial), `0017_engagement_piece_id.sql` (PK rebuild + backfill), `0043_engagement_widget_counters.sql` (3 widget counters).

### learnings
Cross-agent learnings database — patterns that work or don't. Drafter reads the 10 most recent rows (across all sources / categories) at runtime and includes them in its prompt — the loop the system uses to improve on itself.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| category | TEXT | `voice` \| `structure` \| `engagement` \| `fact`. What kind of learning it is — shapes which prompt it should inform. |
| observation | TEXT | The insight |
| evidence | TEXT | JSON: what supports this |
| confidence | INTEGER | 0-100 |
| applied_to_prompts | TEXT (declared INTEGER) | JSON array of `daily_pieces.id` strings — the pieces this learning was loaded into AND that subsequently published. Repurposed in migration 0032 from the prior INTEGER `0`/`1` shape (Foundation Fix Task 04). Column declaration unchanged — SQLite's loose column affinity tolerates the in-place type change without an ALTER. **Read path treats legacy `0`/`1` numeric values as null** via `LIKE '[%'` guards; ad-hoc operator queries that do `WHERE applied_to_prompts = 0` will silently miss new JSON rows, and `json_array_length(applied_to_prompts)` on legacy `0` rows will throw — `scripts/learner-health.sql` handles both shapes; new ad-hoc queries should follow that pattern. **Write path** uses `json_insert(CASE WHEN applied_to_prompts LIKE '[%' THEN applied_to_prompts ELSE '[]' END, '$[#]', ?)` so a row's first JSON write resets a legacy 0/1. Director appends the new `pieceId` after `publishing done` for every learning the Drafter loaded that run. |
| source | TEXT | `reader` \| `producer` \| `self-reflection` \| `zita`. Where the signal came from. Loose TEXT, nullable — no CHECK constraint because a future fifth origin is cheap to add at the write site. NULL means "unspecified (pre-P1.3)". Indexed via `idx_learnings_source`. **Application layer is stricter than the schema:** `writeLearning` refuses to insert a row whose `source` is null, empty, or non-string — logs a warn to `observer_events` and skips. Column nullability remains so historical pre-P1.3 rows stay readable; new rows must always carry a source. |
| piece_date | TEXT | YYYY-MM-DD of the `daily_pieces` row this learning is about. Nullable at schema level so migration 0012 could apply non-destructively to pre-existing rows, which were then filled via a one-time manual UPDATE matching `learnings.created_at` to `daily_pieces.published_at`. **Application layer enforces non-null going forward:** `writeLearning` refuses rows missing `piece_date`, same defensive pattern as `source` (both checks route through the shared `logMissingField` helper). Indexed via `idx_learnings_piece_date`. Primary read path: the per-piece "What the system learned" section of the How-this-was-made drawer. |
| piece_id | TEXT | `daily_pieces.id` (UUID) this learning is about. Added migration 0014 (cadence Phase 1). Nullable at schema level; backfilled for all 27 prod rows via `piece_date → daily_pieces.date → daily_pieces.id` lookup. Indexed via `idx_learnings_piece_id`. `piece_date` stays alongside — Phase 3+ callers pass both; a later phase may drop `piece_date` once the dual-key write posture is proven. |
| created_at | INTEGER | epoch ms. |
| last_validated_at | INTEGER | epoch ms. Populated only when the loaded learning's piece passed the **Polished-strict bar** (voiceScore ≥ `LEARNER_VALIDATION_VOICE_FLOOR = 90` AND revision rounds ≤ `LEARNER_VALIDATION_MAX_ROUNDS = 1`, both in `agents/src/shared/audit-thresholds.ts`). Stricter than the reader-facing Polished tier (voice ≥ 85) — validation is a learner-signal-quality bar, not a tier change. Director writes after `publishing done`. Forward-only since migration 0032; pre-Task-04 NULLs are honest historical record. |
| loaded_at | INTEGER | epoch ms. **Most recent** load timestamp — overwritten on each subsequent load by `getRecentLearnings`. Pairs with `load_count` for "have we seen this row recently AND how often" without keeping a per-load history table. NULL = never loaded. Added migration 0032 (Foundation Fix Task 04). |
| load_count | INTEGER | Monotonic count of loads via `getRecentLearnings`. Durable across `loaded_at` overwrites. DEFAULT 0 so legacy rows query as "never loaded" (matching their NULL `loaded_at`). Added migration 0032 (Foundation Fix Task 04). |

`category` and `source` are orthogonal: `category` is *what* kind of learning (voice/structure/…); `source` is *who* produced the signal (reader/producer/…).

Migrations: `0003_engagement_learnings.sql` (initial), `0011_learnings_source.sql` (added `source`), `0012_learnings_piece_date.sql` (added `piece_date`), `0014_piece_id_fks.sql` (added `piece_id`), `0032_learner_feedback_loop.sql` (added `loaded_at` + `load_count`, repurposed `applied_to_prompts` to JSON, started writing `last_validated_at`).

### audit_results
One row per audit pass per draft — durable audit trail. Written by DirectorAgent after each audit round.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| task_id | TEXT | e.g. `daily/2026-04-17` — pipeline run ID |
| draft_id | TEXT | e.g. `daily/2026-04-17-r1` (task + round) |
| auditor | TEXT | voice, structure, or fact |
| passed | INTEGER | 0 or 1 |
| score | INTEGER | 0-100 for voice auditor, null for others |
| notes | TEXT | JSON: violations, issues, or claims |
| piece_id | TEXT | `daily_pieces.id` (UUID) this audit is about. Added migration 0014 (cadence Phase 1), writer-side threading + full backfill via migrations 0018+0019 (2026-04-22 piece_id schema fix). Director pre-allocates pieceId at run-start and `saveAuditResults(taskId, pieceId, round, …)` writes it on every audit row. Initial backfill (0014) covered 3 prod rows via date-join; 0019 completed the remaining 9 rows (2026-04-22 multi-per-day split by midpoint). Indexed via `idx_audit_results_piece`. Existing `task_id` / `draft_id` stay alongside — they're per-round identifiers that don't cleanly map to a single piece without the FK. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables". |
| created_at | INTEGER | |
| run_id | TEXT | UUID — per-pipeline-execution identity, threaded by Director through `saveAuditResults`. Multi-piece-per-day runs share the same calendar day but each has a unique `run_id`. Added migration 0037 (Foundation Fix Task 08 PR 08a/b, 2026-05-07). Forward-only — historical rows are NULL. |
| failure_reasons | TEXT | Comma-separated closed-enum tokens for the failure-reason kinds the auditor flagged. Empty/NULL on passes. Closed enums per auditor live in `agents/src/types.ts` (`VoiceFailureReason` / `StructureFailureReason` / `FactFailureReason`); canonical narrative + token tables in `content/audit-contract.md` v1.1. Queryable via `LIKE '%token%'` — no JSON parsing required. Added migration 0038 (Foundation Fix Task 08 PR 08c, 2026-05-07). Forward-only. |
| suggestions_count | INTEGER | Number of suggestion strings the auditor produced this round (`suggestions.length` for voice + structure; `claims.length` for fact). Cheap drift-detector for "auditor went silent" — fail rounds with `suggestions_count = 0` warrant investigation. Added migration 0038. |

Indexes: `idx_audit_task` on `task_id`, `idx_audit_created` on `created_at`, `idx_audit_results_piece` on `piece_id`.

Migrations: `0004_audit_results.sql` (original), `0008_drop_agent_tasks.sql` (dropped the FK to the deleted `agent_tasks` table; original `audit_results` was empty across all runs because every INSERT failed the orphaned FK check), `0014_piece_id_fks.sql` (added `piece_id`), `0037_run_id_and_pipeline_log_rebuild.sql` (added `run_id`), `0038_audit_failure_reasons.sql` (added `failure_reasons` + `suggestions_count`).

### magic_tokens
Time-limited tokens for magic link passwordless login.

| Column | Type | Notes |
|--------|------|-------|
| token | TEXT PK | 64-char hex, cryptographically random |
| email | TEXT | The email the link was sent to |
| user_id | TEXT | FK→users if user exists, null for new signups |
| expires_at | INTEGER | Unix timestamp ms, 30 minutes from creation |
| used_at | INTEGER | Null until clicked, prevents reuse |
| created_at | INTEGER | |

Migration: `0005_magic_tokens.sql`

## Daily Pieces tables

### daily_candidates
News candidates from the Scanner, evaluated by the Director.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| date | TEXT | YYYY-MM-DD |
| headline | TEXT | News headline |
| source | TEXT | e.g. "Reuters", "BBC" |
| category | TEXT | TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD |
| summary | TEXT | Short description from RSS |
| url | TEXT | Link to original story |
| teachability_score | INTEGER | 0-100, set by Director |
| selected | INTEGER | 1 if Director picked this story. **Historical resolution (2026-05-XX, Foundation Fix Task 03):** the 2026-04-22 prompt fix at `agents/src/curator-prompt.ts` started exposing candidate UUIDs to Claude so every run since 2026-04-23 flips `selected=1` correctly. Seven pre-fix pieces (2026-04-17 through 2026-04-22, with 2026-04-22 carrying two pieces) were repaired via `scripts/backfill-selected-flag.sql` — a normalized-headline join scoped by `(date, source)` (the brief's suggested `daily_pieces.id → daily_candidates.piece_id` join did not work because piece_id is stamped on every candidate at INSERT time, not just the picked one). Earlier rows on `daily_candidates` from before any of those seven pieces stay `selected=0` deliberately; only the 7 pieces' specific picks were repaired. See DECISIONS 2026-05-XX "L1, L2, L25 closed" and the resolved FOLLOWUPS entry from 2026-04-21. |
| piece_id | TEXT | `daily_pieces.id` (UUID) for the run that produced this candidate batch. Added migration 0014 (cadence Phase 1), semantic extended by migrations 0018+0019 (2026-04-22 piece_id schema fix). Scanner now writes piece_id on **every** candidate row at INSERT time (not just the picked one) — Director pre-allocates pieceId at the top of `triggerDailyPiece` and passes it into `scanner.scan(pieceId)`. All 350 historical rows backfilled via 0019 (pre-2026-04-22 via date-join, 2026-04-22 via midpoint split between the two same-date pieces). Indexed via `idx_candidates_piece_id`. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables". |
| pick_reasoning | TEXT | Curator's 1-3 sentence "why this candidate is the most teachable today" reasoning. Populated only on the picked candidate (NULL on rejected rows). Added migration 0031 (Foundation Fix Task 03, 2026-05-XX). Closes data leak L1 — Curator was producing this reasoning at runtime but Director discarded it. |
| rejection_category | TEXT | Closed-enum label on every rejected candidate. NULL on the picked row. Eight values: `off_topic`, `duplicate`, `too_local`, `no_teaching_angle`, `wrong_shape`, `low_signal`, `tribal_framing`, `already_covered`. Enum body lives in `content/curator-contract.md` ("What to record" section). Director defensively warns via `observer.logError` on any unknown value (single-call, no per-row spam). Added migration 0031 (2026-05-XX). Closes data leak L2's coarse-grained signal. |
| rejection_reason | TEXT | One-sentence free-form rejection reason. Populated only on the top 5 runner-up candidates Curator weighed most seriously (NULL on the picked row and on the remaining ~74 rejected rows). Token cost capped by the top-5 limit. Added migration 0031 (2026-05-XX). Closes data leak L2's qualitative signal. |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0014_piece_id_fks.sql` (added `piece_id`), `0031_curator_reasoning.sql` (added `pick_reasoning`, `rejection_category`, `rejection_reason`).

### daily_pieces
Published daily teaching pieces.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| date | TEXT | YYYY-MM-DD |
| headline | TEXT | The teaching piece title |
| underlying_subject | TEXT | What it teaches about |
| source_story | TEXT | Original news source |
| word_count | INTEGER | **Inert since PR #0 (2026-05-09).** Held Drafter's pre-revision word count, drifted from the final published MDX. Site-worker readers now derive from MDX via `src/lib/piece-stats.ts`. Director no longer writes the column at INSERT. Queued for removal in a future migration (FOLLOWUPS [deferred] 2026-05-09 "Drop daily_pieces.word_count + beat_count columns"). |
| beat_count | INTEGER | **Inert since PR #0 (2026-05-09).** Held `brief.beats?.length` (Curator's plan), which often differed from the actual `## ` heading count in the published MDX (drawer would say "4 beats" while the dot row showed 6). Same fix shape as `word_count` above. |
| voice_score | INTEGER | |
| fact_check_passed | INTEGER | |
| has_interactive | INTEGER | **Deprecated as of migration 0022.** Scaffolded in 0006, never read or written by any code path, always 0 in production. `interactive_id` (below) is the single source of truth for "does this piece have an interactive". Column stays physical because SQLite DROP COLUMN would require a `daily_pieces` table rebuild (blast radius too big for hygiene). No writer touches it going forward. |
| reading_minutes | INTEGER | Derived `MAX(1, ROUND(word_count / 200))` at INSERT time by Director (200 wpm conservative web-reading rate). Frontend `RunBlock` reads `piece.readingMinutes ?? <estimatedTime regex fallback>`. Wired up 2026-05-07 (migration 0036 backfill); column existed since 0006 with no writer, all pre-fix rows NULL. |
| quality_flag | TEXT | NULL = normal, 'low' = audit failed after max revisions |
| has_audio | INTEGER | 0 or 1. Flipped to 1 by `Publisher.publishAudio` when the audio second-commit succeeds. Never set by Producer or Auditor. |
| interactive_id | TEXT | `interactives.id` (UUID) for the 1:1 interactive generated for this piece. NULL = no interactive. Set by InteractiveGeneratorAgent's final publish step (sub-task 4.4). Nullable, non-enforced FK, consistent with codebase convention. Indexed via `idx_daily_pieces_interactive`. Added migration 0022. |
| pick_domain | TEXT | Curator's self-classification of the picked story into the 10-domain teachability taxonomy at `content/curator-contract.md` lines 19-28. Closed enum mirrored in `agents/src/types.ts` as `PickDomain` + `PICK_DOMAINS`; codegen step asserts the two stay in sync (drift fails build). Director reads trailing-30-day domain counts via `getRecentDomainCounts` and surfaces them to the next Curator run alongside the existing recent-category-concentration block. NULL on rows pre-PR #1 (2026-05-09) until backfill via `scripts/backfill-pick-domain.mjs` runs. Added migration 0042. |
| published_at | INTEGER | |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0009_quality_flag.sql`, `0010_audio_pipeline.sql` (added `has_audio`), `0022_interactives.sql` (added `interactive_id`; deprecated `has_interactive`), `0036_dead_columns_backfill.sql` (backfilled `reading_minutes` from word_count; the only dead-instrumentation column with a wired reader and no writer), `0042_daily_pieces_pick_domain.sql` (added `pick_domain`)

### daily_piece_audio
Per-beat audio rows — one row per `<lesson-beat>` per piece. Producer writes; Auditor reads; Publisher reads for the second-commit frontmatter splice; transparency drawer + admin deep-dive page render from this.

| Column | Type | Notes |
|--------|------|-------|
| piece_id | TEXT | `daily_pieces.id` (UUID). Part of composite PK. Added via migration 0015 (cadence Phase 1) — previously `date` held this role. |
| beat_name | TEXT | e.g. "hook", "teach-1", "close". Matches `<lesson-beat name="…">`. Part of composite PK. |
| date | TEXT | YYYY-MM-DD. Kept as a non-PK column for display/filter after the 0015 PK rebuild — no longer part of the key. |
| r2_key | TEXT | e.g. `audio/daily/2026-04-18/hook.mp3` |
| public_url | TEXT | URL the reader fetches. Currently `/{r2_key}` — needs site-worker R2 binding to resolve in prod. |
| character_count | INTEGER | Characters sent to ElevenLabs (post-`prepareForTTS`) — the billed count. |
| duration_seconds | INTEGER | Approximate playback length in seconds. Computed by Audio Producer as `Math.round(byteLength / 12000)` — assumes 96 kbps per `AUDIO_OUTPUT_FORMAT='mp3_44100_96'` in `agents/src/shared/audio-thresholds.ts` (12,000 bytes/sec at 96 kbps). Use case is admin display + crude operator queries, not playback timing (the audio element gets exact duration from the MP3 file at render time). Populated since Foundation Fix Task 05 / migration 0033 (2026-05-12); pre-Task-05 historical rows stay NULL as honest record (forward-only, no backfill). If `AUDIO_OUTPUT_FORMAT` changes, the divisor must change in lockstep — see the doc-comment on `persistBeatRow` in `agents/src/audio-producer.ts`. |
| file_size_bytes | INTEGER | Size of the MP3 payload returned by ElevenLabs. Captured by Audio Producer as `audioBuffer.byteLength` immediately after `arrayBuffer()`. Closes data leak L11 (the column did not exist pre-migration 0033). Populated since Foundation Fix Task 05 (2026-05-12); pre-Task-05 historical rows stay NULL. The made-drawer envelope's `totalSizeBytes` field reads `SUM(file_size_bytes)` since 2026-05-11 (commit `99daa9a`) — partial-sum policy when some rows have NULL is honest (post-Task-05 pieces show real totals; pre-Task-05 pieces show null). |
| request_id | TEXT | ElevenLabs `request-id` response header. Used for prosodic stitching on the next beat (`previous_request_ids`). |
| model | TEXT | e.g. `eleven_multilingual_v2`. Stored per row so future model swaps are visible in audit history. |
| voice_id | TEXT | e.g. `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey). Same reason as model. |
| generated_at | INTEGER | Unix timestamp ms. |

PK: **(piece_id, beat_name)** (since migration 0015). Indexes: `idx_piece_audio_piece` on `piece_id`, `idx_piece_audio_date` on `date`.

Migrations: `0010_audio_pipeline.sql` (original, PK was (date, beat_name)), `0015_daily_piece_audio_piece_id_pk.sql` (PK rebuild to (piece_id, beat_name), snapshot → create-new → copy → drop-old → rename, with `daily_piece_audio_backup_20260421` held for rollback through 2026-04-28), `0033_audio_audit_persistence.sql` (added `file_size_bytes` + repurposed `duration_seconds` from always-NULL to byte-derived).

### pipeline_log
Step-by-step record of each daily piece run. The admin dashboard polls this for the live pipeline monitor.

**Migration 0037 (2026-05-07, Foundation Fix Task 08):** the legacy `run_id` column (date-shaped `YYYY-MM-DD`) was renamed to `run_date` and a fresh `run_id TEXT` UUID column was added alongside, resolving the 2026-04-21 walk-back's dual-life state. Site-side queries that previously matched `WHERE run_id = '<date>'` now match `WHERE run_date = '<date>'` (4 site files updated atomically in the same PR). The new `run_id` is the per-pipeline-execution UUID minted by Director at the top of `triggerDailyPiece` — multi-piece-per-day runs share the same `run_date` but each has a unique `run_id`. Pre-migration rows have NULL run_id (forward-only).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| run_date | TEXT NOT NULL | `YYYY-MM-DD` — the calendar day of this step's run. Renamed from `run_id` in migration 0037 (2026-05-07). Semantics unchanged from the 2026-04-21 walk-back; the rename clarifies intent now that a UUID `run_id` exists alongside. Indexed via `idx_pipeline_run`. Day-grouping queries (admin pipeline history, lifetime runs) continue to scope by this. |
| run_id | TEXT | UUID — the per-pipeline-execution identity. Director generates `crypto.randomUUID()` at the top of `triggerDailyPiece` and threads through every `logStep()` call. Off-pipeline alarms (audio scheduled, retry paths) thread runId via the schedule payload; legacy in-flight alarms without runId default to null. Nullable at schema level (historical rows pre-0037 are NULL forever). Indexed via `idx_pipeline_log_run`. Per-run forensic queries scope by this; per-piece queries continue to scope by piece_id. Added migration 0037 (2026-05-07). |
| piece_id | TEXT | `daily_pieces.id` (UUID) — the piece this step belongs to. Added migration 0018, backfilled via 0019 (date-join for pre-2026-04-22; midpoint-split for 2026-04-22 multi-per-day rows). Director pre-allocates `pieceId` at the top of `triggerDailyPiece` and threads through every `logStep()` call so every row carries it going forward. Nullable at schema level (defensive for orphan pre-0018 rows); populated on every new row. Indexed via `idx_pipeline_log_piece`. Admin per-piece deep-dive scopes by this; admin home pipeline history continues to group by `run_date` for day-view semantics. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables". |
| step | TEXT | scanning, curating, drafting, auditing_r1, publishing, done, error |
| status | TEXT | running, done, failed |
| data | TEXT | JSON with step-specific data (scores, counts, headlines) |
| created_at | INTEGER | |

Migrations: `0007_pipeline_log.sql` (initial). Migration 0014's proposed run_id semantic shift was reverted same-day — no net schema or data change. `0018_pipeline_log_piece_id.sql` added the `piece_id TEXT` column + `idx_pipeline_log_piece` (additive, no PK rebuild). `0019_piece_id_backfill.sql` populated all 153 historical rows. `0037_run_id_and_pipeline_log_rebuild.sql` (2026-05-07) renamed `run_id` to `run_date` and added a fresh `run_id` UUID column via the snapshot/CREATE-NEW/INSERT-SELECT/DROP/RENAME pattern (mirrors 0015 and 0017). Backup table `pipeline_log_backup_20260507` retained ≥7 days. **The dual-life FOLLOWUPS line 1705 is resolved by 0037** — there's no longer a column serving two purposes.

### admin_settings
Key/value table for admin-configurable system state. One row per setting. First consumer is `interval_hours` read by Director (Phase 2 of the cadence plan); future settings (rate limits, feature flags, voice overrides, scanner feed overrides) live here too.

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | e.g. `interval_hours` |
| value | TEXT NOT NULL | Stringly-typed. Caller parses to expected shape via helper (`agents/src/shared/admin-settings.ts` → `getAdminSetting<T>(db, key, parse, fallback)`). Non-null even when logically empty — use a sentinel value rather than allowing null. |
| updated_at | INTEGER NOT NULL | Unix timestamp ms. Last write time. |

Read path: [`getAdminSetting`](../agents/src/shared/admin-settings.ts) — swallows every failure mode (missing row, non-string value, DB throw) and returns the caller's `fallback`. Fresh read per call, no caching.

Write path: currently seeded via migration only (`INSERT OR IGNORE interval_hours='24'`). Phase 5 of the cadence plan adds the admin UI + `/api/dashboard/admin/settings` endpoint, with an `admin_settings_changed` observer_event fired alongside every UPDATE for audit-trail.

Seeded values: `interval_hours = '24'` (preserves current 1-piece/day production cadence until Phase 3 wires the hourly gate); `interactives_html_enabled = 'false'` (migration 0024); `reading_mode = 'scroll'` (migration 0041; **inert since C7 2026-05-08** — paginated became the only mode, no consumer reads this row anymore; row preserved in D1 as audit trail per the non-destructive default).

Migrations: `0016_admin_settings.sql` (table + interval_hours seed), `0024_interactives_html_flag.sql` (interactives_html_enabled seed), `0041_reading_mode_setting.sql` (reading_mode seed; row inert since C7).

### categories
Taxonomy for browsing the library by subject and for the Categoriser agent's reuse-bias assignments. One row per category. Operator-curated (rename / merge / delete / lock) from `/dashboard/admin/categories/`; populated from day one by the Categoriser agent and the one-time seed script over pre-Categoriser published pieces.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| slug | TEXT NOT NULL UNIQUE | kebab-case. Powers the `/library/` category filter URL. Stored on the row (not derived from `name`) so a rename never silently breaks external bookmarks; slug only changes on explicit operator edit or on merge (target wins). |
| name | TEXT NOT NULL | Human display form, e.g. "Chokepoints & Supply" |
| description | TEXT | One-liner of what belongs here. Shown to Categoriser in its system prompt so the reuse-bias has real signal; also shown on the admin page. Nullable. |
| locked | INTEGER NOT NULL DEFAULT 0 | 1 = Categoriser MUST NOT reassign away from this category (can still assign TO it). Enforced in agent logic, not schema. |
| piece_count | INTEGER NOT NULL DEFAULT 0 | Denormalised counter — library renders chips sorted by count on every request. Maintained by the writer (Categoriser insert + admin merge/delete). Admin page has a "Recount" escape hatch for drift. |
| created_at | INTEGER NOT NULL | Unix ms |
| updated_at | INTEGER NOT NULL | Unix ms, bumped on any mutation |

Indexes: `idx_categories_slug` on `slug` (explicit, alongside the UNIQUE auto-index), `idx_categories_piece_count` on `piece_count DESC`. Migrations: `0021_categories.sql` (table), `0027_categoriser_fallback_category.sql` (seed reserved fallback row `slug='patterns-yet-to-cluster'`, `locked=1`, used only when both Categoriser attempts return empty/all-sub-floor; hidden from reader-facing surfaces and from Claude's context list).

### piece_categories
Join table — one row per (piece, category) assignment. Categoriser writes 1–3 rows per piece; admin merge/delete rewrites in bulk inside a transaction.

| Column | Type | Notes |
|--------|------|-------|
| piece_id | TEXT NOT NULL | `daily_pieces.id`. Non-enforced FK, consistent with the rest of this codebase's join columns. |
| category_id | TEXT NOT NULL | `categories.id`. Same non-enforced FK convention. |
| confidence | INTEGER NOT NULL | 0–100. Categoriser's confidence in this specific assignment. No CHECK; application layer clamps. |
| created_at | INTEGER NOT NULL | Unix ms |

PK: **composite `(piece_id, category_id)`** — idempotent; Categoriser can safely re-run. Indexes: `idx_piece_categories_piece` on `piece_id` (per-piece lookup), `idx_piece_categories_category` on `category_id` (per-category filter + piece_count recount). Migration: `0021_categories.sql`.

## Interactives tables

### interactives
Standalone teaching artefacts — first-class concept, not a piece sub-feature. First type is `quiz`; extensible to `breathing`, `game`, `chart`, etc. Each has its own URL at `/interactives/<slug>/` and is useful without reading the source piece ("essence not reference"). Generated post-publish by InteractiveGeneratorAgent (15th agent, sub-task 4.4); audited by InteractiveAuditorAgent (16th agent, sub-task 4.5) with up to 3 revision rounds.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| slug | TEXT NOT NULL | kebab-case. Powers `/interactives/<slug>/`. Stored, not derived — renames don't break URLs. **Composite UNIQUE(slug, type)** as of migration 0026 (Phase 2 sub-task 2.5) — quiz + html for the same piece SHARE the slug (one URL per piece). The composite constraint keeps slugs unique within a type while letting siblings coexist. |
| type | TEXT NOT NULL | `'quiz'` \| `'html'`. Quiz path live since Area 4; HTML path added Phase 2 sub-task 2.3. Loose TEXT, no CHECK — consistent with `learnings.source` / `observer_events.severity`. Future shapes (breathing / game / chart) widen the discriminated union in `src/content.config.ts` + add to this column without a migration. |
| title | TEXT NOT NULL | Display title. |
| concept | TEXT | The essence — what this teaches. D1 column nullable; the **content-collection schema requires it** (`z.string().min(1)` in `src/content.config.ts`) since 2026-04-25 — every JSON file in `content/interactives/` must have a non-empty concept, which feeds the page subtitle AND meta description. Generator's structural validator throws on empty before file write; auditor flags topic-labels and off-voice phrasing. |
| source_piece_id | TEXT | `daily_pieces.id` the Generator was triggered from. Nullable (standalone-authored interactives in future). Non-enforced FK. |
| content_json | TEXT | Type-specific payload. **Nullable convenience mirror in v1** — sub-task 4.2 chose content-collection (git-versioned `content/interactives/<slug>.json`) as the authoritative source of truth. Writers leave `content_json` NULL; readers always read from the file via `getCollection('interactives')`. Column stays on the row for future admin queries that want to filter/search by content shape without joining to the file system. |
| voice_score | INTEGER | 0–100 from InteractiveAuditor. |
| quality_flag | TEXT | NULL = passed; `'low'` = audit max-failed (3 rounds) but the last attempt was shipped anyway (2026-04-24 reversal of 4.5's abandon-on-max-fail). Mirrors `daily_pieces.quality_flag`. Readers reach the interactive at its URL AND via the last-beat prompt on the source piece — flagged-low interactives surface alongside clean ones (the prior `qualityFlag !== 'low'` filter in sub-task 4.6's lookup map was dropped 2026-04-24; it had been kept as vestigial future-proofing for exactly this reversal). Admin UI marks FLAGGED LOW + shows retry button. See DECISIONS 2026-04-24 "Loosen InteractiveAuditor essence rule + ship-as-low on max-fail". |
| revision_count | INTEGER NOT NULL DEFAULT 0 | Auditor rounds used (0–3). |
| published_at | INTEGER | Unix ms. Null while Generator/Auditor loop runs; set on final accept. |
| created_at | INTEGER NOT NULL | Unix ms |
| quality_tier | TEXT | `'polished'` \| `'solid'` \| `'rough'` \| NULL. v3 reader-vocabulary tier mirroring `src/lib/audit-tier.ts`'s `AuditTier` shape. Added migration 0025 alongside the v3 audit rubric (voice ≥85, structure / essence / factual ≥75 each). Coexists with `quality_flag` rather than replacing it: `quality_flag` stays as the historical max-fail bit; `quality_tier` is the per-surface display word. Reusing the daily-piece "Rough" wording at read time was rejected because the 2026-04-25-pm drawer commit (`4a2f3c2`) deliberately dropped that label *because* of the tier-vocabulary collision when voice was high but another dimension max-failed. Owning a separate column at the schema level keeps the interactive vocabulary distinct. NULL on rows that predate v3 and were never flagged; backfilled to `'rough'` on the 3 historical `quality_flag='low'` rows. Phase 2 Generator extension populates on every new interactive. |

Indexes: `idx_interactives_slug` (explicit), `idx_interactives_source_piece` on `source_piece_id`, `idx_interactives_published_at` on `published_at DESC`, plus `sqlite_autoindex_interactives_1` from the composite `UNIQUE(slug, type)`. Migration: `0022_interactives.sql` (table) + `0025_interactives_quality_tier.sql` (`quality_tier` column) + `0026_interactives_unique_slug_type.sql` (relaxed UNIQUE).

### interactive_engagement
Append-only event log of reader interactions with interactives. Not aggregated per day like `engagement` — per-question correctness arrays don't aggregate cleanly, and the natural shape is events (offered / started / viewed / completed / skipped). Aggregation happens at query time. Read by `LearnerAgent.analysePiecePostPublish` from Interactives v3 Phase 4.2 onward to inform `category='engagement'` producer learnings.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL | `users.id`. Anonymous-first — middleware always guarantees a user. Non-enforced FK. |
| interactive_id | TEXT NOT NULL | `interactives.id`. Non-enforced FK. |
| event_type | TEXT NOT NULL | `'offered'` \| `'started'` \| `'viewed'` \| `'completed'` \| `'skipped'`. Loose TEXT. `'viewed'` added in Interactives v3 Phase 4.1 (HTML interactive scrolled ≥50% into view, fired once per session via `<interactive-frame>` IntersectionObserver). No CHECK constraint, so the addition is description-only. |
| score | INTEGER | Correct-count for `completed` rows; null otherwise. |
| per_question_correctness | TEXT | JSON array e.g. `[1,0,1,1,0]` for `completed` rows; null otherwise. |
| created_at | INTEGER NOT NULL | Unix ms |

Indexes: `idx_int_engagement_user` on `user_id`, `idx_int_engagement_interactive` on `interactive_id`, `idx_int_engagement_int_type` on `(interactive_id, event_type)`. Migration: `0022_interactives.sql`.

### interactive_audit_results
Per-round per-dimension audit output for interactives. Closes the deferred FOLLOWUPS 2026-04-24 sub-task 4.1 entry. Mirrors `audit_results` for daily pieces — one row per round × dimension. Up to 12 rows per `generate()` invocation (3 rounds × 4 dimensions). Empty for all pre-2026-04-25 interactives — no backfill (final-round data available via observer_events for forensic context).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| interactive_id | TEXT NOT NULL | `interactives.id`. Non-enforced FK. Orphan rows (declined-path generations that never INSERTed an `interactives` row) are tolerated, same as `audit_results` orphan piece_ids from the day-keyed era. |
| round | INTEGER NOT NULL | 1, 2, or 3. Matches `INTERACTIVE_MAX_ROUNDS` in [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts). |
| dimension | TEXT NOT NULL | `'voice'` / `'structure'` / `'essence'` / `'factual'`. Loose TEXT — adding/folding dimensions is a zero-migration change. |
| passed | INTEGER NOT NULL | 0 / 1. SQLite has no real boolean type. |
| score | INTEGER | Voice only (0–100); NULL for the three binary dimensions. |
| notes | TEXT | JSON-stringified array of the auditor's per-dimension violations + suggestions, in that order. Matches `audit_results.notes` shape. |
| created_at | INTEGER NOT NULL | Unix ms |

Indexes: `idx_int_audit_interactive_round` on `(interactive_id, round)` — composite, leftmost-prefix friendly so a single `interactive_id` lookup also benefits. Migration: `0023_interactive_audit_results.sql`.

### audio_audit_results
Per-issue + per-piece-summary audit output for the audio pipeline. Closes data leak L12 — Audio Auditor's structured `AudioIssue[]` verdicts previously survived only as JSON inside `observer_events.context`, not queryable without expensive `json_extract`. Mirrors the `interactive_audit_results` shape (migration 0023) for the daily-piece audio rail. Writer is `AudioAuditorAgent.audit()` itself (mirrors `InteractiveGeneratorAgent.persistAuditRows()` precedent — same Durable Object, same `this.env.DB.batch()`).

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK, consistent with the rest of this codebase's join columns and with `interactive_audit_results`'s migration 0023 reasoning ("Application-layer integrity. Orphan rows… are acceptable"). |
| beat_name | TEXT | Kebab string matching `daily_piece_audio.beat_name` (e.g. `hook`, `teach-1`, `close`). NULL = piece-level issue (matches `AudioIssue.beatName: null` convention) OR summary row. Replaces the brief's `beat_index INTEGER`; storing `beat_index` would mean recomputing an ordinal that doesn't exist in source data and breaking the natural join `audio_audit_results JOIN daily_piece_audio USING (piece_id, beat_name)`. |
| passed | INTEGER NOT NULL | 0 or 1. Per-row meaning: `passed=1` on the summary row when no major issues; `passed=0` on every issue row and on the summary row when any major issue exists. |
| issue_type | TEXT | Closed enum value from `AudioIssueType` in `agents/src/types.ts` — eight values: `no_audio_rows`, `missing_file`, `empty_file`, `size_too_small`, `size_too_large`, `text_too_short`, `character_cap_exceeded`, plus `unknown` reserved for forward-compat. NULL on summary rows. Loose TEXT (no CHECK) so adding a value never requires a migration; defensive validation lives at the writer (Director's `observer.logError`-once-per-run if persistence sees an unknown). Same posture as Task 03's `RejectionCategory`. |
| issue_severity | TEXT | `'minor'` or `'major'` — matches the existing `AudioIssue.severity` union exactly so we don't reinvent vocabulary. NULL on summary rows. |
| notes | TEXT | The auditor's free-form `AudioIssue.issue` string verbatim (e.g. `"Audio suspiciously small: 12KB for 800 chars (expected ~78KB). Possibly truncated."`). On the summary row, a short rollup string `"Audited N beats, K issues (M major)"`. |
| r2_key | TEXT | Populated on missing-file / size-anomaly issues so the operator can `wrangler r2 object head` without re-deriving the path. NULL for piece-level issues (`no_audio_rows`, `character_cap_exceeded`) and summary rows. |
| actual_size_bytes | INTEGER | Populated when the issue is size-related (the `obj.size` value the auditor already has in scope). NULL for `text_too_short` / `no_audio_rows` / `character_cap_exceeded` / summary rows — intentionally not fabricated for issue types where the size wasn't load-bearing. |
| created_at | INTEGER NOT NULL | Unix ms. |

Indexes: `idx_audio_audit_piece_created` on `(piece_id, created_at)` — composite, leftmost-prefix friendly so a single `piece_id` lookup also benefits, and the `created_at` tail orders the latest verdict cheaply for "did this last audit pass" queries. Migration: `0033_audio_audit_persistence.sql`.

**Retry semantic.** No `audit_round` column — Audio Auditor doesn't have produce→audit→revise rounds. `Director.retryAudio` and `Director.retryAudioBeat` re-run the auditor; each `audit()` call writes a fresh batch with a new `created_at`. Operator queries that want "the latest verdict" use `ORDER BY created_at DESC LIMIT 1` over the summary rows. "Audit history" = `ORDER BY created_at ASC`. If a future reader needs "attempt N" labels, it derives at query time from `ROW_NUMBER() OVER (PARTITION BY piece_id ORDER BY created_at)` (SQLite supports window functions since 3.25).

**Always-write-summary semantic.** Every `audit()` call writes at least one row (the summary). Zero issues → 1 row (summary, `passed=1`). N issues → N+1 rows (one per issue + summary). Disambiguates "audited and clean" (one summary row, `passed=1`) from "never audited" (zero rows). The Interactive precedent's lack of summary row works for `interactive_audit_results` because every dimension row is binary and there are exactly four per round (fixed cardinality, cheap `MIN(passed)`); audio's issue count varies (0 to N), so the explicit summary row is more honest.

**Failure posture.** Persistence wraps in try/catch inside the auditor; on throw, `AudioAuditResult.persistError` populates and Director fires `observer.logError('audio-auditor', 0, msg, pieceId)` exactly once per audit. The audit verdict itself (`passed`, `issues`) is computed in-memory before the persistence batch; Director's branch logic at `runAudioPipeline` (line ~1487) fires on the in-memory verdict regardless of whether the persistence batch succeeded. Audio is ship-and-retry — text already shipped before audio runs — so a feedback-write hiccup must not block the surrounding flow. Same posture as Task 04's "fail-open on both UPDATEs".

Empty at migration time. No backfill — historical `audio_audit_results` can't be reconstructed without re-running the auditor against historical R2 objects, and forensic context for past failures lives in `observer_events.context` (preserved as backup until Task 08 retention).

Operator queries: `scripts/audio-audit-health.sql` ships four read-only queries — `recent_audits` (latest summary per piece, last 30), `issue_type_breakdown` (last 30 days, count by issue type), `unfilled_metadata` (rows with NULL `file_size_bytes` or `duration_seconds` post-Task-05; non-zero means producer broke), `size_anomalies` (cross-check on auditor's MIN/MAX_SIZE_RATIO band).

### draft_revisions
Per-round MDX preserved across the audit-revise loop. Closes data leaks L4 (initial + per-round drafts only in memory) and L8 (per-round MDX diffs nowhere — diffs are now derivable as a `LEFT JOIN draft_revisions dr1 ... draft_revisions dr2 ON dr2.revision_round = dr1.revision_round + 1` against this table). One row per (piece, round) pair. The published copy in git remains source of truth for what readers see; this table holds the trail.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | Surrogate key. Chosen over the TEXT-PK-with-randomUUID() pattern of `audit_results` / `audio_audit_results` because draft_revisions has a natural unique key `(piece_id, revision_round)` and its only consumers are SELECT-by-piece queries. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK, consistent with the rest of this codebase's join columns. |
| revision_round | INTEGER NOT NULL | 0 = Drafter's initial output (round number Director assigns). 1+ = Integrator output after round N's auditor feedback. Same numbering scheme Director uses in its `r${round}` taskId suffix and `auditing_r${round}` step labels in `pipeline_log`. |
| mdx_content | TEXT NOT NULL | Full MDX as written by the agent — Drafter's raw output for round 0, Integrator's parsed `revisedMdx` field for round 1+. INCLUDES the agent-generated frontmatter; EXCLUDES Director's later splices (voiceScore, pieceId, publishedAt, audioBeats, claimReviews). Diff between rows is therefore pure agent prose, not Director noise. |
| word_count | INTEGER | Denormalised so admin queries can render the trail without TEXT scans. NULL allowed for forward-compat; current writers always populate. |
| authored_by | TEXT NOT NULL | Closed enum: `'drafter'` (round 0) or `'integrator'` (round 1+). Loose TEXT (no CHECK) so adding a value never requires a migration; defensive validation lives at the writer. |
| created_at | INTEGER NOT NULL | Unix ms. Codebase convention. |

UNIQUE constraint `(piece_id, revision_round)` — one row per pair. Idempotency: a re-invocation of `draft()` or `revise()` for the same `(piece, round)` surfaces as a write failure rather than silently double-recording. The agent writers wrap the INSERT in try/catch and surface the error via `persistError` sentinel so a constraint violation logs once via `observer.logError` without sinking the publish path.

Index: `idx_draft_revisions_piece` on `piece_id` (composite-on-`(piece_id, revision_round)` is implicit via the UNIQUE constraint, so an explicit one would duplicate). Migration: `0034_draft_revisions.sql`.

**Failure posture.** Persistence wraps in try/catch inside the agent (Drafter's `persistInitialDraft`, Integrator's `persistRevision`); on throw, `DrafterResult.persistError` or `IntegrationResult.persistError` populates and Director fires `observer.logError` exactly once per call. The MDX itself is computed in-memory before the persistence batch — Director's branch logic is unaffected by a feedback-write hiccup.

Empty at migration time. No backfill — historical revision histories cannot be reconstructed (they only ever lived in memory). Forward-only, same posture as Task 05's pre-fix NULL precedent on `daily_piece_audio` metadata columns and Task 04's pre-fix NULL precedent on `learnings.loaded_at`.

### integrator_decisions
Per-feedback-item disposition record from the Integrator. Closes data leak L9 (per-feedback-item accept/overrule reasoning stored nowhere). One row per feedback item the Integrator addressed in a single revision round. Joins to `draft_revisions` via `(piece_id, revision_round)`.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | Surrogate key. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK. |
| revision_round | INTEGER NOT NULL | 1+ — round 0 is the initial Drafter output, before any Integrator decisions. |
| feedback_source | TEXT NOT NULL | Closed enum from `FeedbackSource` in `agents/src/types.ts` — three values: `voice_auditor`, `fact_checker`, `structure_editor`. One value per auditor agent in the daily-piece pipeline. Loose TEXT (no CHECK), defensive validation at the writer (`FEEDBACK_SOURCES` runtime mirror). |
| feedback_summary | TEXT NOT NULL | The Integrator's own paraphrase of the issue — *not* a quote of the auditor's wording. Diagnostic value: when `feedback_summary` doesn't match what the auditor actually said, that's signal about prompt drift. |
| decision | TEXT NOT NULL | Closed enum from `IntegratorDecision` — three values: `accepted` (revised the prose per feedback), `overruled` (chose not to act), `partial` (some aspect addressed, others left). Loose TEXT, defensive validation at the writer (`INTEGRATOR_DECISIONS` runtime mirror). Same posture as Task 03's `RejectionCategory`. |
| reasoning | TEXT | Integrator's free-form explanation. Optional but strongly preferred. NULL is honest when the model didn't supply one. |
| resulting_change | TEXT | One-line summary of what literally changed in the MDX. Optional. The diff between `draft_revisions` rounds is the source of truth for the literal change; this column is the Integrator's own one-line characterisation. |
| created_at | INTEGER NOT NULL | Unix ms. |

No UNIQUE constraint — a single round can produce many decisions; no natural composite key beyond `(piece_id, revision_round, feedback_summary)` and `feedback_summary` is freeform prose, not a stable join key.

Indexes:
- `idx_integrator_decisions_piece` on `piece_id` — per-piece read path.
- `idx_integrator_decisions_source` on `feedback_source` — cross-piece operator queries (e.g. "show all overruled voice_auditor flags last 30 days"). Speculative, but cardinality is bounded (3 values) and index size is negligible, so worth the write-amp for operator-query ergonomics.

Migration: `0034_draft_revisions.sql` (single bundled migration with `draft_revisions`).

**Defensive validation at the writer.** The Integrator's parse path validates each decision's `feedback_source` against `FEEDBACK_SOURCES` and `decision` against `INTEGRATOR_DECISIONS` before binding. Unknown values cause the row to be dropped from the batch, and the count of drops surfaces via `IntegrationResult.parseError` — Director logs once via `observer.logError`. Same drop-with-visibility posture as `AudioIssueType`'s validation in Task 05.

**Failure posture.** Same as `draft_revisions` — try/catch inside the agent, `persistError` sentinel back to Director, single observer event per failure.

Empty at migration time. No backfill.

Operator queries: `scripts/draft-revisions-health.sql` ships four read-only queries — `recent_revisions` (last 20 pieces' rounds + decision counts; the verification SQL named in `docs/foundation-fix/06-DRAFT-REVISIONS.md`), `decision_breakdown` (feedback_source × decision, last 30 days), `multi_round_pieces` (every round of every multi-round piece, with decisions joined), `unfilled_metadata` (drift detector for missing reasoning / resulting_change).

### audio_dwell_events
Append-only event log of reader audio listening time. Closes data leak L17 (Foundation Fix Task 07, the last Phase 2 task). One row per flush boundary in `<audio-player>` — pause, ended, beat-change, 30-second heartbeat, or pagehide. NOT aggregated; aggregation is at query time. Sits beside `engagement` (which stays per-piece-per-day aggregate) — schema fork was surfaced to the user up front; extending engagement would have forced a PK rebuild + four `INSERT ... ON CONFLICT` rewrites + Learner SQL + admin dashboard SQL updates for an additive signal.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | Surrogate key. Same shape as `draft_revisions` and `integrator_decisions` (migration 0034) — consumers SELECT-by-piece or SELECT-by-user with ORDER BY `occurred_at`, never by id. |
| user_id | TEXT NOT NULL | `users.id`. Middleware always populates `locals.userId` (anonymous users get a generated id + cookie on first request, see `src/middleware.ts:101`). Anonymity is at the auth layer, not the row layer; per-user attribution is always present. NULL would only ever indicate a writer bug. Non-enforced FK. |
| piece_id | TEXT NOT NULL | `daily_pieces.id` (UUID). Non-enforced FK. |
| beat_name | TEXT NOT NULL | The kebab beat slug. Locked over the brief's proposed `beat_index INTEGER` — matches `daily_piece_audio` PK `(piece_id, beat_name)` since migration 0015 and the `audio_audit_results` precedent (migration 0033). The audio player has no native ordinal — `beatOrder` is computed from DOM at runtime, not persisted — so storing `beat_index` would mean inventing a renumbering-fragile ordinal. Natural join: `audio_dwell_events ⋈ daily_piece_audio USING (piece_id, beat_name)` gives clip duration for ratio sanity checks. |
| dwell_seconds | REAL NOT NULL | Wall-clock seconds the listener actually played since the previous flush (NOT since clip-start; NOT cumulative). REAL because heartbeats fire fractional intervals after iOS Safari throttles `timeupdate`. Range 0–3600 enforced at the writer; tab-throttling jumps are clamped to ≤2 s per `timeupdate` tick inside `audio-player.ts` (`MAX_TICK_DELTA_S`). |
| ratio | REAL | `dwell_seconds ÷ clip_duration_seconds`, 0–1.5 convenience for aggregation. Nullable because `audio.duration` may be NaN before `loadedmetadata` fires. Upper bound 1.5 not 1.0 — a brief overshoot during the heartbeat-after-ended boundary is plausible and shouldn't reject the row. |
| ended_reason | TEXT NOT NULL | Closed enum (`DwellEndedReason` in `src/interactive/audio-player.ts`) — five values: `pause` (reader hit pause), `ended` (clip naturally ended), `beat_change` (auto-advance, prev/next button, MediaSession previoustrack/nexttrack), `heartbeat` (30-second tick during continuous play), `pagehide` (sendBeacon path on tab close / hide). Loose TEXT (no CHECK), defensive validation at the writer (`/api/engagement/audio.ts` as a `Set` literal). Drift surfaces as 400 not silent drop. |
| occurred_at | INTEGER NOT NULL | Unix ms, server-side `Date.now()` (NOT a client field — clock-drift risk). |

Indexes:
- `idx_dwell_piece_occurred` on `(piece_id, occurred_at)` — covers the dominant operator query "show me dwell on this piece, latest first" and the leftmost-prefix lookup for per-piece scans that filter on `beat_name` in the WHERE.
- `idx_dwell_user_occurred` on `(user_id, occurred_at)` — covers per-user retrospectives. The reader-facing surface is deferred (FOLLOWUPS `[deferred] 2026-05-07` entry) but the index is cheap to land alongside the table; adding it later would require an index build over a growing table.

No third `(piece_id, beat_name)` index — speculative; per-piece scans are bounded (~10 beats × N events × M readers/day) and the leftmost prefix on `idx_dwell_piece_occurred` handles them.

**Privacy posture.** The `/api/engagement/audio` writer NEVER reads `request.headers` (no `cf-connecting-ip`, no `user-agent`, no referrer). The row carries the engagement signal and nothing else. First Foundation Fix task that touches reader-side identity at per-event granularity; the privacy line is held here so the precedent is set going forward.

**Failure posture.** Site-worker writer wraps the INSERT in try/catch. On D1 throw, calls `logObserverEvent` with `severity: 'warn'`, `title: 'audio dwell persist error'`, and a context payload of `{piece_id, beat_name, ended_reason}` — equivalent of the agents-side `persistError` sentinel + `observer.logError` pattern, adapted for site-worker context. The endpoint returns 204 in success AND caught-failure paths — the frontend has fired-and-forgotten by the time the response comes back; it cannot distinguish.

**Frontend posture.** All five flush paths route through a central `flushDwell(reason)` choke point in `src/interactive/audio-player.ts`. Per-tick clamp at `[0, 2]` s on `performance.now()` deltas (anti-double-counting guard — kills tab-throttling jumps before they accumulate). Sub-half-second flushes are skipped except on `pagehide` (one-shot, can't be re-fired). `pagehide` uses `navigator.sendBeacon` with a `Blob` of `type: 'application/json'`; all other paths use `fetch` with `keepalive: true`. iOS Safari's pagehide-unreliability gap is covered by the 30-second heartbeat path.

Migration: `0035_audio_dwell_events.sql`. Empty at migration time. No backfill — historical dwell cannot be reconstructed (it was never written). Forward-only.

Operator queries: `scripts/dwell-health.sql` ships four read-only queries — recent dwell (last 30 pieces' reader-seconds + reader count), per-beat dwell distribution, ended-reason breakdown, and the anti-double-counting drift detector (flags any `(user_id, piece_id, beat_name)` whose total dwell exceeds 5× the clip duration over a 7-day window — runtime cousin to the brief's 7000s/240s pathology).

### claim_verifications
Global per-claim cache for the Tavily-backed fact-checker (2026-05-16 re-architecture). Companion to `daily_audit_claims` — `daily_audit_claims` records the per-piece audit transcript ("what did this piece's fact-checker decide for each claim per round?"), `claim_verifications` is the cache ("last time we asked Tavily about a claim like this, what came back?"). Rows are SHARED across pieces — the same evergreen claim ("Hydrogen absorbs at 121.6 nanometers") cached by one piece's fact-check satisfies the next piece's fact-check without a fresh Tavily call.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PRIMARY KEY | UUID (`crypto.randomUUID()`); surrogate key. PK on id rather than fingerprint so PK collisions never happen on parallel pipelines — race resolved by the `INSERT OR IGNORE` against the unique `claim_fingerprint` index. |
| claim_fingerprint | TEXT NOT NULL | `sha256(normalised_claim_text + '|' + search_query)` hex. Normalisation in `agents/src/fact-checker-tavily.ts:normaliseForFingerprint` — lowercase, collapse whitespace, strip trailing punctuation. Both fields included so a paraphrased claim with a different search query still fingerprints distinctly. Unique-via-index, not unique-via-constraint — `INSERT OR IGNORE` is the race resolver. |
| claim_text | TEXT NOT NULL | The verbatim claim from Step 1 (Extract) output. Kept un-normalised here for human readability; normalisation only feeds the fingerprint. |
| search_query | TEXT NOT NULL | Claude-generated focused query for Tavily. Decontextualised on purpose — "apple boiling point" not "according to the article, how hot does apple need to get?" — so identical evergreen claims across pieces produce identical queries and hit the cache. |
| tavily_snippets | TEXT NOT NULL | JSON: `Array<{title, url, content, score}>` of Tavily search results (top 3 by default per `TAVILY_MAX_RESULTS` in `agents/src/shared/fact-check-thresholds.ts`). Source of truth for Step 3 (Verify) on cache hit. |
| verdict | TEXT NOT NULL | Closed enum `TavilyClaimVerdict` (`agents/src/types.ts`): `verified` / `unverified` / `contradicted` / `cutoff_confession_attempted` / `unknown`. Validated against `TAVILY_CLAIM_VERDICTS` ReadonlySet at the writer; drift surfaces as `unknown` (same drift-detector posture as `failure_reasons LIKE '%unknown%'`). `cutoff_confession_attempted` is the contract-violation case for auditability; `unknown` is forward-compat. |
| evidence_urls | TEXT NOT NULL | JSON: `string[]` derived from `tavily_snippets[*].url`. Convenience field for the made-drawer's future "Sources consulted" sub-section (the existing round-level line in `audit_results.notes.sources` is still the primary reader). |
| source_piece_id | TEXT | Piece that FIRST surfaced this claim (the cache row that created it). NULL for cache rows written before pieceId was threaded through (none on this table — pieceId has been threaded since the 2026-05-16 migration). Non-enforced FK. |
| hit_count | INTEGER NOT NULL DEFAULT 0 | Monotonic counter, bumped on every cache lookup (both INSERT and UPDATE-only paths). hit_count of 1 = used once (the original write); hit_count of 5 = used 4 more times after initial write. Operator query for "hot claims" worth pinning. |
| created_at | INTEGER NOT NULL | Unix ms, server-side `Date.now()` at first INSERT. Never updated. |
| last_used_at | INTEGER NOT NULL | Unix ms, refreshed on every lookup. Drives the 30-day TTL check (`TAVILY_CACHE_TTL_DAYS`): rows with `last_used_at < now - 30*86400000` are SKIPPED on lookup (treated as cache miss → fresh Tavily call → row UPDATEd with new snippets + verdict + last_used_at refreshed). Rolling-from-last-use TTL — evergreen claims with active use never expire. |

Indexes:
- `idx_claim_fp` on `claim_fingerprint` — primary lookup path; `WHERE claim_fingerprint IN (?, ?, ...)` for batch cache lookup across all claims in one Extract pass.
- `idx_claim_last_used` on `last_used_at` — supports any future retention worker that deletes rows past TTL (none today; the orchestrator just SKIPS on read).

**No background eviction.** TTL is read-time only; rows are NEVER deleted by the cache logic itself. Operator decision (2026-05-16): "facts stay forever, get checked any time, refresh themselves when reused." Table growth: ~10 rows/piece × 30 pieces/month = ~300 rows/month; ~36 MB after 10 years; well inside D1's 5 GB limit. If retention is ever wanted, `agents/src/retention.ts` can be extended with a `claim_verifications WHERE last_used_at < ?` rule (same shape as the existing tables).

**Failure posture.** Cache write failures are non-fatal — the verdict is already in the `FactCheckResult` returned to Director by the time `persistOutcomes` runs. Future runs will re-search the missed claim (slightly more cost, no correctness loss). Cache READ failures fall through to full Tavily search for every claim (also non-fatal, just more expensive).

Migration: `0044_claim_verifications.sql`. Empty at migration time. No backfill — no historical Tavily data to import; the cache fills organically from the next pipeline run forward. Forward-only.

### director_health
Cross-DO-restart tracker of active long-running Director operations. Created 2026-05-17 after the cap incident (8-hour silent plateau where in-memory `_keepAliveRefs` couldn't catch a stuck DO because two mid-pipeline code pushes reset it). The companion watchdog cron at `30 * * * *` reads this table on every fire and auto-trips the kill switch when any row in `status='running'` is older than `admin_settings.director_max_operation_minutes`.

| Column | Type | Notes |
|--------|------|-------|
| operation_id | TEXT PK | UUID minted at `keepAlive()` acquire (`recordOperationStart`) |
| operation_type | TEXT | Closed set populated by Director: `triggerDailyPiece` / `retryAudioFresh` / `retryAudioBeat`. Future operations should add their own type string here. |
| piece_id | TEXT | UUID if the operation is piece-scoped (most are), null for system-level operations. Foreign-keyed loosely to `daily_pieces.id` (no FK constraint — D1 best practice for cross-table soft refs). |
| started_at | INTEGER | Unix ms at `keepAlive()` acquire. The watchdog's staleness signal. |
| last_heartbeat_at | INTEGER | Unix ms updated on each 30s SDK heartbeat (optional/future — the current Director doesn't wire heartbeat updates because the SDK's `_cf_keepAliveHeartbeat` schedule was removed in newer SDKs; staleness is judged on `started_at` for now). Defaults to `started_at` at insert. |
| completed_at | INTEGER | Unix ms at dispose (`recordOperationComplete`), null while running. |
| status | TEXT | Closed enum: `running` / `completed` / `aborted` / `orphaned`. The watchdog flips `running → orphaned` for stale rows. `aborted` is reserved for future use (operator-initiated manual halts via admin UI). |

Indexes:
- `idx_director_health_status(status, started_at)` — primary watchdog scan path (`WHERE status='running' AND started_at < cutoff`).
- `idx_director_health_heartbeat(last_heartbeat_at) WHERE status='running'` — partial index for future heartbeat-based staleness detection.

Write surface: `agents/src/director-guardrails.ts` exports `recordOperationStart(env, type, pieceId)` returning the new operation_id, `recordOperationComplete(env, operationId, status='completed')`, and `recordOperationHeartbeat(env, operationId)` (best-effort, currently unused — wired for future per-heartbeat updates). All writes try/catch with `console.error` on failure — D1 errors never block the wrapped operation. Director's three keepAlive-acquiring methods (`triggerDailyPiece`, `retryAudioFresh`, `retryAudioBeat`) each call start at acquire + complete in finally.

Read surface: the watchdog at `agents/src/server.ts` `scheduled()` handler's `30 * * * *` branch calls `auditStaleOperations(env, logEscalation)` which queries `WHERE status='running' AND last_heartbeat_at < (now - max_ms)`. The admin dashboard's "System guardrails" section also reads `WHERE status='running' ORDER BY started_at` for the live operations table.

Migration: `0045_director_health.sql`. Empty at migration time. Rows accumulate one per pipeline run + per audio-retry click; healthy operations live ~30s to ~10 minutes then transition to `completed`. The table is unbounded — no retention rule applied (the design assumption is that the watchdog keeps `running` rows fresh and `completed` rows stay forever as an audit trail of operation history). If the table grows past concern (~thousands of rows), the existing `retention.ts` worker can be extended with a rule like `WHERE status IN ('completed','aborted','orphaned') AND completed_at < ?`. Initial sizing math: 2 pipelines/day + ~5 audio retries/month = ~62 rows/month, ~750/year, ~7.5k/decade. Inside D1 limits indefinitely.

## Migrations summary (45 migrations, 27 tables)
- `0001_init.sql` — users, progress, submissions, zita_messages
- `0002_observer_events.sql` — agent_tasks (later dropped), observer_events
- `0003_engagement_learnings.sql` — engagement, learnings
- `0004_audit_results.sql` — audit_results (later recreated in 0008) + idx_tasks_parent index
- `0005_magic_tokens.sql` — magic_tokens for passwordless login
- `0006_daily_pieces.sql` — daily_candidates, daily_pieces
- `0007_pipeline_log.sql` — pipeline_log for admin monitor
- `0008_drop_agent_tasks.sql` — dropped unused `agent_tasks` (course-era); recreated `audit_results` without its FK so Director can write the audit trail
- `0009_quality_flag.sql` — added `daily_pieces.quality_flag` so Director can publish-anyway on max-revision audit failure and mark the piece for archive-view filtering
- `0010_audio_pipeline.sql` — created `daily_piece_audio` (per-beat audio rows) + added `daily_pieces.has_audio` boolean. Un-paused the audio pipeline.
- `0011_learnings_source.sql` — added `learnings.source` (reader/producer/self-reflection/zita, nullable TEXT, no CHECK) + `idx_learnings_source`. Plumbing for P1.3 — widens the Learner from reader-only to all-signal.
- `0012_learnings_piece_date.sql` — added `learnings.piece_date` (YYYY-MM-DD TEXT, nullable at schema level for backfillability, enforced non-null at the application layer) + `idx_learnings_piece_date`. Enables the per-piece "What the system learned" section of the How-this-was-made drawer. Backfill for pre-migration rows is included as a commented one-time UPDATE inside the migration file (not auto-applied); mapping works via nearest-timestamp join of `learnings.created_at` to `daily_pieces.published_at`, restricted to producer/self-reflection sources.
- `0013_zita_messages_piece_date.sql` — added `zita_messages.piece_date` (YYYY-MM-DD TEXT, nullable at schema level for backfillability, enforced non-null at the application layer for `course_slug='daily'`) + composite `idx_zita_piece(user_id, piece_date)`. Fixes the data-model bug where every daily piece mounted `<zita-chat course="daily" lesson="0">` and pooled all pieces' conversations under one key. Backfill for the 92 pre-migration rows is a commented one-time block inside the migration file, mapped by hand from conversation content + created_at windows against the five pieces 2026-04-17 through 2026-04-21. Includes a snapshot step (`zita_messages_backup_20260421`) run before any UPDATE — rollback is `DELETE + INSERT SELECT` from the backup. Backup table queued for drop on or after 2026-04-28 via FOLLOWUPS.
- `0014_piece_id_fks.sql` — multi-piece cadence Phase 1. Added nullable `piece_id TEXT` FK columns + indexes to `audit_results`, `learnings`, `zita_messages`, `daily_candidates`. Auto-applied ALTERs; backfill UPDATEs commented for manual `wrangler d1 execute` runs (all 4 tables + `pipeline_log.run_id` semantic shift from `YYYY-MM-DD` strings to `daily_pieces.id` UUIDs). Applied 2026-04-21. `daily_candidates` has no historical backfill — 250 rows, 0 with `selected=1` (separate FOLLOWUPS investigation).
- `0015_daily_piece_audio_piece_id_pk.sql` — multi-piece cadence Phase 1, PK rebuild. `daily_piece_audio` PK switched from `(date, beat_name)` to `(piece_id, beat_name)` via snapshot → create-new → copy → drop-old → rename, all auto-applied. 32 rows backfilled via correlated subquery on `daily_pieces.date`. `daily_piece_audio_backup_20260421` snapshot held for rollback through 2026-04-28 via FOLLOWUPS.
- `0016_admin_settings.sql` — multi-piece cadence Phase 2. Created `admin_settings(key, value, updated_at)` — first admin-configurable surface in Daylila v2. Seeded `interval_hours='24'` via `INSERT OR IGNORE` (preserves current 1-piece/day cadence). Read by Director at start of `triggerDailyPiece`; gate logic lands in Phase 3. Future settings (rate limits, feature flags, voice overrides) will use the same table.
- `0017_engagement_piece_id.sql` — multi-piece cadence Phase 7 (FOLLOWUPS wrap). Rebuilt `engagement` with PK `(piece_id, course_id, date)` via snapshot → create-new → backfill-join → drop-old → rename, all auto-applied. 13 historical rows backfilled from `daily_pieces` via `e.lesson_id = dp.date` join (unambiguous at 1/day — 5 piece_ids, 0 NULLs). `lesson_id` kept as a plain column for display-compat. `engagement_backup_20260422` snapshot held for rollback through 2026-04-29 via FOLLOWUPS. Unblocks reader-path attribution at multi-per-day — `Learner.analyseAndLearn` now reads piece_id directly off the engagement row instead of the pre-Phase-7 partial-fix date-lookup.
- `0018_pipeline_log_piece_id.sql` — multi-per-day piece_id schema fix Phase 1. Added nullable `piece_id TEXT` to `pipeline_log` + `idx_pipeline_log_piece`. Completes the piece_id column coverage across all three day-keyed tables (0014 had `audit_results` + `daily_candidates`; this finishes the set). Additive ALTER, no snapshot needed. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".
- `0019_piece_id_backfill.sql` — multi-per-day piece_id schema fix Phase 2. Manual (not auto-applied) — commented UPDATEs run via `wrangler d1 execute`, same pattern as 0012 and 0014 Step 2. Two strategies: pre-2026-04-22 rows via `daily_pieces.date` join (unambiguous at 1/day), 2026-04-22 rows via midpoint split at timestamp `1776850364493` between the two pieces' `published_at`. 512 null rows populated across the three tables (9 `audit_results` + 153 `pipeline_log` + 350 `daily_candidates`). 0 NULL remaining across all three. Verified row-by-row against production D1.
- `0020_observer_events_piece_id.sql` — multi-per-day audit. Added nullable `piece_id TEXT` to `observer_events` + `idx_observer_events_piece`. Additive ALTER, no backfill — historical rows stay NULL and surface on per-piece admin via the existing 36h day-of-publish window fallback. New writes from `agents/src/observer.ts` (13 helpers, piece-scoped signature extended) and `src/lib/observer-events.ts` (optional `pieceId` field) populate piece_id going forward. System-event writers (admin settings changes, Zita rate limits) keep piece_id NULL permanently.
- `0021_categories.sql` — Area 2 sub-task 2.1. Created `categories(id, slug UNIQUE, name, description, locked, piece_count, created_at, updated_at)` + `piece_categories(piece_id, category_id, confidence, created_at)` with composite PK. Data surface for the 14th agent (Categoriser, sub-task 2.2) plus the library category filter (sub-task 2.4) and admin management page (sub-task 2.5). Both tables empty at migration time — populated organically by Categoriser on new pieces and by a one-time seed script (sub-task 2.3) over pre-Categoriser pieces. Additive, rollback = DROP both tables.
- `0022_interactives.sql` — Area 4 sub-task 4.1. Created `interactives(id, slug UNIQUE, type, title, concept, source_piece_id, content_json, voice_score, quality_flag, revision_count, published_at, created_at)` + `interactive_engagement(id, user_id, interactive_id, event_type, score, per_question_correctness, created_at)` append-only event log. Added `daily_pieces.interactive_id TEXT` as the single source of truth for "piece has an interactive" — deprecated the unused `has_interactive` INTEGER column scaffolded in 0006 (left physical since SQLite DROP COLUMN would require a `daily_pieces` rebuild with too-wide blast radius). Data surface for the 15th + 16th agents (InteractiveGenerator + InteractiveAuditor, sub-tasks 4.4 + 4.5). All new tables empty at migration time. Additive, rollback = DROP both new tables (the `daily_pieces.interactive_id` column stays inert when null if code is rolled back).
- `0023_interactive_audit_results.sql` — Closes the deferred FOLLOWUPS 2026-04-24 sub-task 4.1 entry. Created `interactive_audit_results(id, interactive_id, round, dimension, passed, score, notes, created_at)` + composite index on `(interactive_id, round)`. Per-round per-dimension audit output, mirroring `audit_results` shape. Writer site is InteractiveGeneratorAgent's produce→audit→revise loop (writes 4 rows per round after each `auditor.audit()` call); reader site is the made.ts API for the drawer's `failedDimensions` field. Pre-allocates `interactive_id` before the loop so audit rows have a stable FK regardless of the eventual commit/decline outcome. Triggered by the 2026-04-25 Maine drawer's voice-vs-Rough contradiction — once we name the dimension that flagged, "Shipped as Rough" stops conflating tier vocabularies. Empty at migration time (the 2 existing `quality_flag='low'` rows can't be reconstructed). Additive, rollback = DROP TABLE.
- `0024_interactives_html_flag.sql` — Interactives v3 Phase 1 sub-task 1.1. Seeded `admin_settings('interactives_html_enabled', 'false', …)` via `INSERT OR IGNORE`. Gates the HTML-interactive generation path that lands in Phase 2 (Generator + Auditor extension). Quizzes are NOT gated by this flag — the longer name vs. `interactives_enabled` was deliberate to avoid implying quizzes were also gated. Default `'false'` so the migration is behaviourally a no-op on prod. Phase 3 ships the admin UI write site; until then `wrangler d1 execute` is the only way to flip. Rollback = DELETE FROM admin_settings WHERE key = 'interactives_html_enabled'; the Phase 2 read site falls back to `false` when the row is missing.
- `0025_interactives_quality_tier.sql` — Interactives v3 Phase 1 sub-task 1.2. Added `interactives.quality_tier TEXT` (`'polished' | 'solid' | 'rough' | NULL`) mirroring `src/lib/audit-tier.ts`'s `AuditTier` shape. Auto-applied UPDATE backfills every existing `quality_flag='low'` row to `quality_tier='rough'` (3 rows on prod 2026-04-26: iterative-consensus-building, proportional-displacement-visibility, procedural-legitimacy-under-constraint). Coexists with `quality_flag` rather than replacing it — `quality_flag` keeps its semantic ("did the auditor max-fail"); `quality_tier` carries the v3 reader-facing word. Reusing daily-piece "Rough" at read time was rejected because the 2026-04-25-pm drawer commit (`4a2f3c2`) deliberately dropped that label *because* of the tier-vocabulary collision when voice was high but another dimension max-failed. Owning a separate column at the schema level keeps the interactive vocabulary distinct. Phase 2 Generator extension populates on every new interactive. SQLite has no DROP COLUMN so a true rollback would require a table rebuild; the column sits inert if v3 is reversed (NULL on new rows; 'rough' on the 3 backfilled historical rows; no code reads it until Phase 2 ships).
- `0026_interactives_unique_slug_type.sql` — Interactives v3 Phase 2 sub-task 2.5. Relaxed `interactives.slug UNIQUE` → composite `UNIQUE(slug, type)`. A piece's quiz + html share the slug (one URL per piece — `/interactives/<slug>/` renders both teaching modalities); the original `UNIQUE(slug)` from 0022 forced HTML to suffix to `<slug>-2`, splitting siblings across URLs. SQLite has no DROP CONSTRAINT, so this is a table rebuild (same pattern 0015 used for `daily_piece_audio`'s PK change). Snapshot `interactives_backup_20260426` held for 7-day rollback (drop queued for 2026-05-04 in FOLLOWUPS). All 8 prod rows preserved via explicit INSERT...SELECT; 3 named indexes recreated; the auto-created `sqlite_autoindex_interactives_1` from the original UNIQUE-on-slug is replaced by a same-named auto-index from the new composite UNIQUE. The Generator's `resolveFreeSlug` becomes type-aware in the same commit (only checks collisions within the artefact type); the HTML path looks up the existing quiz row's slug for the piece and uses it verbatim, falling back to Claude's own slug only when the quiz path declined or hasn't run yet.
- `0027_categoriser_fallback_category.sql` — Categoriser zero-assignment fix (2026-04-29). Seeds the reserved `Patterns Yet to Cluster` category row with `slug='patterns-yet-to-cluster'`, `locked=1`, `piece_count=0`, deterministic id `'fallback-patterns-yet-to-cluster'`, idempotent under re-apply via `INSERT OR IGNORE` on the unique slug. Used as the last-resort fallback when Categoriser's two attempts (initial + retry) both return empty/all-sub-floor on a piece. Hidden from reader-facing surfaces via slug filter (library `getCategories`, per-category route, drawer "Filed under" section, Categoriser context list passed to Claude). Single literal duplicated across `agents/src/categoriser-prompt.ts:CATEGORISER_FALLBACK_SLUG`, `src/lib/categories.ts:FALLBACK_SLUG`, and `src/pages/api/daily/[date]/made.ts` — see DECISIONS 2026-04-29 "Categoriser zero-assignment fix" for the full layered defense.
- `0028_daily_audit_claims.sql` — Phase I of the 2026-04-30 fact-check transparency rewrite. Created `daily_audit_claims(id, audit_result_id, piece_id, round, claim_index, claim_text, status, note, sources_json, search_query, created_at)` + indexes on `(piece_id, round)` and `status`. Per-claim breakout of `audit_results.notes` JSON for daily-piece fact-check rows, mirroring the `interactive_audit_results` precedent (migration 0023). Writer site is Director's `saveAuditResults` (best-effort try/catch separate from the parent INSERT — transient D1 failure on per-claim breakout can't poison parent audit). Additive, rollback = DROP TABLE. **Path A.1 (2026-05-01 evening) deprecated `sources_json` + `search_query`** — the per-claim Claude-self-reported sources design was removed; both columns now write NULL on every new row, and pre-Path-A.1 rows similarly carry NULL. Columns stay in the schema (additive nullable; dropping would require a table rebuild not worth the blast radius). The round-level URL list is now sourced from `audit_results.notes` JSON's top-level `sources` array (the agent's flat citation harvest from `web_search_tool_result.content[]`). The drawer's API endpoint reads from there and renders a single round-level "Sources consulted" line under the Facts section — Phase F+G's per-claim drawer sub-section was removed in Path A. No admin UI consumes the per-claim table yet; future "claims explorer" admin can still query by piece + round + status without per-claim source attribution.
- `0029_user_piece_reads.sql` — Account rebuild foundation (2026-05-02). Created `user_piece_reads(user_id, piece_id, started_at, last_seen_at, current_beat, completed_at)` with PK `(user_id, piece_id)` + indexes on `(user_id, last_seen_at DESC)` and `(user_id, completed_at DESC)`. New per-user-per-piece reading record — closes the gap left by `progress` (collapses all daily reads to one row per user via hardcoded `lesson_number=0` in lesson-shell) and `engagement` (per-piece-per-day aggregate, not per-user). Forward-only; no backfill. Writer is `src/pages/api/reads/track.ts` invoked by lesson-shell on view / per-beat / complete. `mergeProgress` extended in the same commit to merge this table alongside `progress` so anonymous reads carry through magic-link sign-in. Additive, rollback = DROP TABLE. See DECISIONS 2026-05-02 "Account rebuilt as private practice record".
- `0030_saved_pieces.sql` — Account rebuild Phase 2 (2026-05-02). Created `saved_pieces(user_id, piece_id, created_at)` with composite PK `(user_id, piece_id)` for idempotent toggles + `idx_saved_pieces_user(user_id, created_at DESC)` for the Account "newest first" list query. Writer is `src/pages/api/saved/toggle.ts` (GET returns current state for piece-page hydration; POST toggles). `mergeProgress` extended again to merge this table alongside `progress` and `user_piece_reads`. Empty at migration time. Additive, rollback = DROP TABLE.
- `0031_curator_reasoning.sql` — Foundation Fix Task 03 (2026-05-XX). Added three nullable TEXT columns to `daily_candidates` — `pick_reasoning` (1-3 sentences on the picked candidate), `rejection_category` (closed-enum label on every rejected row), `rejection_reason` (one-sentence reason on the top 5 runner-ups only). Closes data leaks L1 (pick reasoning was discarded) and L2 (per-rejection reasoning was never produced). Enum body lives in `content/curator-contract.md`. No index — admin + made-drawer SELECTs scope by `piece_id` (already indexed); ad-hoc queries on rejection_category run against ~30k rows in year one, scanned in milliseconds. Director persists via `this.env.DB.batch()` after Curator returns; existing 2026-04-22 observer-log pattern wraps the new UPDATEs (throw, zero-changes, unknown-enum). Companion script `scripts/backfill-selected-flag.sql` repaired the 7 pre-2026-04-22 historical pieces' selected-flag in the same session (L25 residual). See DECISIONS 2026-05-XX "L1, L2, L25 closed".
- `0032_learner_feedback_loop.sql` — Foundation Fix Task 04 (2026-05-11). Added two nullable additive columns to `learnings`: `loaded_at INTEGER` (most recent load timestamp, overwritten on each load) and `load_count INTEGER DEFAULT 0` (monotonic count). Repurposed the existing `applied_to_prompts` column from INTEGER `0`/`1` to TEXT JSON array of `daily_pieces.id`s — SQLite's loose column affinity tolerates the in-place type change without ALTER; legacy values read as null via `LIKE '[%'` guards. The existing `last_validated_at` column starts receiving its first writes here, populated only when the loaded learning's piece passed the **Polished-strict bar** (voiceScore ≥ 90 AND revision rounds ≤ 1; new constants `LEARNER_VALIDATION_VOICE_FLOOR` + `LEARNER_VALIDATION_MAX_ROUNDS` in `agents/src/shared/audit-thresholds.ts`). Closes data leak L15 — the Learner feedback loop's consumption side. Forward-only; no backfill. `getRecentLearnings` writes `loaded_at` + bumps `load_count` as a deliberate side-effect; Director batches the `applied_to_prompts` JSON-append + the optional `last_validated_at` UPDATE via `this.env.DB.batch()` after `publishing done` (Task 03 pattern). Companion script `scripts/learner-health.sql` surfaces the four operator queries — noise / signal / workhorses / retirement candidates. No index — load-side UPDATEs scope by `id IN (...)` (PK-indexed); operator queries scan ~1k rows in year one, scanned in milliseconds. See DECISIONS 2026-05-11 "L15 closed".
- `0034_draft_revisions.sql` — Foundation Fix Task 06 (2026-05-07). Two new tables in one bundled migration. **L4:** `draft_revisions(id, piece_id, revision_round, mdx_content, word_count, authored_by, created_at)` with UNIQUE`(piece_id, revision_round)` and `idx_draft_revisions_piece`. Round 0 = Drafter (`DrafterAgent.persistInitialDraft`); round 1+ = Integrator (`IntegratorAgent.persistRevision`). The published copy in git is unchanged source of truth; D1 holds the trail. **L8:** per-round MDX diffs are derivable from row-pairs in this table — no diff column stored (per the brief, "diffs can be computed at read time"). **L9:** `integrator_decisions(id, piece_id, revision_round, feedback_source, feedback_summary, decision, reasoning, resulting_change, created_at)` with `idx_integrator_decisions_piece` and `idx_integrator_decisions_source`. One row per addressed feedback item; closed-enum `decision` (`accepted` | `overruled` | `partial`) and `feedback_source` (`voice_auditor` | `fact_checker` | `structure_editor`). Closed enums (`IntegratorDecision`, `FeedbackSource`) live in `agents/src/types.ts` as typed unions + `ReadonlySet` runtime mirrors. **Response shape change:** Integrator's `revise()` now accepts `(pieceId, revisionRound, mdx, voiceResult, structureResult, factResult)` and returns `{ revisedMdx, decisions[], parseError, persistError }` (was `{ revisedMdx, changesSummary }`); Drafter's `draft()` now accepts `(brief, pieceId)` and returns `{ ..., persistError }`. Director threads `pieceId` and `round` through both call sites and fires `observer.logError` once per call on either sentinel. Forward-only — no backfill. Companion script `scripts/draft-revisions-health.sql` ships four read-only operator queries (`recent_revisions` / `decision_breakdown` / `multi_round_pieces` / `unfilled_metadata`). Additive, rollback = DROP TABLE both. See DECISIONS 2026-05-07 "L4, L8, L9 closed".
- `0035_audio_dwell_events.sql` — Foundation Fix Task 07 (2026-05-07). Last Phase 2 migration. **L17:** created `audio_dwell_events(id, user_id, piece_id, beat_name, dwell_seconds, ratio, ended_reason, occurred_at)` + two indexes on `(piece_id, occurred_at)` and `(user_id, occurred_at)`. Append-only event log of reader audio listening time — schema fork resolved as Option B (new table, NOT extending engagement). Closed enum `DwellEndedReason` (5 values: `pause` | `ended` | `beat_change` | `heartbeat` | `pagehide`); validated at the writer (`src/pages/api/engagement/audio.ts` as a `Set` literal — drift surfaces as 400 not silent drop). `beat_name TEXT` locked over `beat_index INTEGER` (matches `daily_piece_audio` PK + `audio_audit_results` precedent). Privacy posture: writer never reads request headers (no IP, no UA, no referrer); first task touching per-event reader identity, precedent set. Failure posture: try/catch + `logObserverEvent('audio dwell persist error')` + 204 in both success and caught-failure paths. Frontend: per-tick `[0, 2]` s clamp on `performance.now()` deltas (anti-double-counting guard); central `flushDwell(reason)` choke point in `audio-player.ts`; `navigator.sendBeacon` for `pagehide`, `fetch` + `keepalive` otherwise; 30-second heartbeat covers iOS Safari pagehide gap. Forward-only — no backfill. Companion script `scripts/dwell-health.sql` ships four read-only operator queries (recent dwell / per-beat distribution / ended-reason breakdown / drift detector). Additive, rollback = DROP TABLE. See DECISIONS 2026-05-07 "L17 closed".
- `0036_dead_columns_backfill.sql` — Post-Phase-2 audit cleanup (2026-05-07). Backfills `daily_pieces.reading_minutes` from `MAX(1, CAST(ROUND(word_count / 200.0) AS INTEGER))` for the 48 historical NULL rows. Column had a wired reader (`src/components/RunBlock.astro:79`) that fell through to a regex parse of `estimatedTime` because the writer never existed. Director's INSERT at `agents/src/director.ts` now writes the same derived value at piece-publish time (single source of truth for the formula). Idempotent under re-apply via `WHERE reading_minutes IS NULL` guard. Non-destructive — only touches rows where the column is NULL. **`has_interactive` (the other always-zero column) was NOT backfilled** — it was deliberately deprecated in migration 0022 with `interactive_id` as the single source of truth. See DECISIONS 2026-05-07 "Dead-column backfill (reading_minutes wire-up)".
- `0038_audit_failure_reasons.sql` — Foundation Fix Task 08 PR 08c (2026-05-07). Closes L24 (audit failure reasons live as JSON-in-TEXT inside `audit_results.notes`, not SQL-queryable). Two additive nullable columns on `audit_results`: `failure_reasons TEXT` (comma-separated closed-enum tokens, queryable via `LIKE '%token%'` operator queries) + `suggestions_count INTEGER` (cheap drift-detector for "auditor went silent" cases). `notes` column is preserved unchanged — it remains the source of truth for full audit detail. Three closed-enum vocabularies (`VoiceFailureReason` / `StructureFailureReason` / `FactFailureReason`) live in `agents/src/types.ts` as typed unions + `ReadonlySet` runtime mirrors; canonical narrative + token tables in `content/audit-contract.md` v1.1. Each auditor prompt asks Claude for `failure_reasons: string[]` in the response envelope ("ONE token per VIOLATION KIND, not per instance"); auditor agents parse + validate per-token against their closed Set, drop unknowns with count surfaced via new `parseError` sentinel on each result type. Director persists via `saveAuditResults` (extended bind list); reads each parseError after the audit and fires `observer.logError(<auditor>, round, msg, pieceId, runId)` exactly once per audit when populated (no per-row spam). Forward-only — historical rows stay NULL on both columns; pre-migration audits have JSON in `notes` but no closed-enum mapping. Companion script `scripts/audit-failure-reasons-health.sql` ships four read-only operator queries (recent breakdowns / top-N tokens via recursive CTE / suggestions-count distribution / unknown-token drift detector). Additive, rollback = `ALTER TABLE audit_results DROP COLUMN ...` (D1 supports DROP COLUMN as of 2024). See DECISIONS 2026-05-07 "L24 closed".
- `0037_run_id_and_pipeline_log_rebuild.sql` — Foundation Fix Task 08 PR 08a/b (2026-05-07). Closes L23 (run_id end-to-end) and resolves the dual-life FOLLOWUPS line 1705. **Two parts.** Part A: 8 ALTER TABLE ADD COLUMN `run_id TEXT` on `daily_candidates`, `daily_pieces`, `audit_results`, `daily_audit_claims`, `observer_events`, `draft_revisions`, `integrator_decisions`, `audio_audit_results` — all nullable, forward-only. Two indexes on `daily_pieces(run_id)` and `observer_events(run_id)` for run-forensic queries; other tables already have piece_id indexes that get to the run via JOIN. Part B: `pipeline_log` rebuild — snapshot/CREATE-NEW/INSERT-SELECT/DROP/RENAME pattern from migrations 0015 + 0017. Old `run_id` (date-shaped) renames to `run_date`; new `run_id` UUID column added. Backup table `pipeline_log_backup_20260507` retained ≥7 days; FOLLOWUPS entry queues drop. Site-side queries (`made.ts`, admin pipeline, dashboard pages) updated atomically in the same PR — `WHERE run_id = ?` becomes `WHERE run_date = ?`. Director generates `runId = crypto.randomUUID()` at the top of `triggerDailyPiece` alongside `pieceId` and threads through every writer (Scanner.scan, Drafter.draft + persistInitialDraft, Integrator.revise + persistRevision, Audio Auditor.audit + persistAuditRows, observer.* methods, logStep, saveAuditResults, daily_pieces INSERT, daily_candidates UPDATEs, daily_audit_claims INSERTs). Off-pipeline alarms thread runId via the schedule payload (`payload.runId ?? null`); legacy in-flight alarms default to null. retryAudio paths generate fresh UUIDs. Forward-only — historical rows stay NULL. Tables NOT in this migration (off-pipeline writes use piece_id for attribution): `daily_piece_audio`, `piece_categories`, `categories`, `interactives`, `interactive_audit_results`, `learnings`, `engagement`, `audio_dwell_events`, `user_piece_reads`, `saved_pieces`, plus reader-auth state. See DECISIONS 2026-05-07 "L16 + L23 closed".
- `0033_audio_audit_persistence.sql` — Foundation Fix Task 05 (2026-05-12). One bundled migration, three closures. **L12:** created `audio_audit_results(id, piece_id, beat_name, passed, issue_type, issue_severity, notes, r2_key, actual_size_bytes, created_at)` + composite index on `(piece_id, created_at)`. Per-issue + per-piece-summary audit output for the audio pipeline; mirrors `interactive_audit_results` (migration 0023) shape. Writer site is `AudioAuditorAgent.audit()` itself (mirrors `InteractiveGeneratorAgent.persistAuditRows()` precedent — same DO, same `this.env.DB.batch()`); each call writes one summary row + N issue rows. **L11:** added nullable `file_size_bytes INTEGER` to `daily_piece_audio` — captured by Audio Producer as `audioBuffer.byteLength` immediately after `arrayBuffer()`. **L10:** the always-NULL `duration_seconds` column starts receiving its first writes here, computed as `Math.round(byteLength / 12000)` (96 kbps assumption per `AUDIO_OUTPUT_FORMAT` in `agents/src/shared/audio-thresholds.ts`). Closed enum `AudioIssueType` lives in `agents/src/types.ts` — eight values with `unknown` reserved for forward-compat. Director's `runAudioPipeline` reads `auditResult.persistError` after the audit call and fires `observer.logError('audio-auditor', 0, msg, pieceId)` exactly once per audit on persistence-write failure (no per-row spam, parallel to Task 03's pattern). Forward-only — no backfill of historical pieces; pre-Task-05 `daily_piece_audio` rows stay NULL on both new columns. Companion script `scripts/audio-audit-health.sql` ships four read-only operator queries (`recent_audits` / `issue_type_breakdown` / `unfilled_metadata` / `size_anomalies`). Additive, rollback = DROP TABLE `audio_audit_results` (the `file_size_bytes` ALTER stays inert if rolled back; SQLite has no DROP COLUMN without table rebuild). See DECISIONS 2026-05-12 "L10, L11, L12 closed".
- `0041_reading_mode_setting.sql` — Beat-by-beat reading mode C4 (2026-05-08). Single `INSERT OR IGNORE` row into `admin_settings` seeding `reading_mode = 'scroll'` so the existing single-scroll layout stayed the default after migration apply. Idempotent (matches the 0016 / 0024 / 0025 pattern). C7 (same day) collapsed to single paginated mode and removed the SSR read + admin form + API key. **The row is now inert** — no consumer reads it. Preserved in D1 as audit trail per the non-destructive default. Migration stays in history as forward-only record. See DECISIONS 2026-05-08 "C4" for the original rollout and "C7" for the cleanup.
- `0044_claim_verifications.sql` — Fact Checker Tavily re-architecture (2026-05-16). Creates `claim_verifications(id, claim_fingerprint, claim_text, search_query, tavily_snippets, verdict, evidence_urls, source_piece_id, hit_count, created_at, last_used_at)` + two indexes on `claim_fingerprint` and `last_used_at`. Per-claim cache for the new extract→search→verify pipeline (`agents/src/fact-checker-tavily.ts`); GLOBAL across all pieces, not per-piece. Closed enum `TavilyClaimVerdict` (5 values: `verified` / `unverified` / `contradicted` / `cutoff_confession_attempted` / `unknown`) validated at writer via `TAVILY_CLAIM_VERDICTS` ReadonlySet. **TTL is 30 days rolling-from-last-use, READ-TIME ONLY** — rows are never deleted by the cache logic; dormant rows past `TAVILY_CACHE_TTL_DAYS` are SKIPPED on lookup and refetched fresh from Tavily on next sighting (UPDATE in place). Empty at migration time; fills organically from the first Tavily-pipeline run. No background eviction worker — table grows ~10 rows/piece, ~36 MB after 10 years, well inside D1's 5 GB limit. Companion to `daily_audit_claims` (per-piece audit transcript) — the cache is the FACTS, the audit-claims table is the per-PIECE record of which facts each piece's draft hit. Additive, rollback = DROP TABLE. See DECISIONS 2026-05-16 evening "Fact Checker re-architecture".
- `0045_director_health.sql` — Cap-incident prevention (2026-05-17). Three additive structures: (1) seeds `admin_settings.director_disabled = '0'` — the kill-switch flag read on every Director alarm + public method via `isDirectorDisabled(env)` in `agents/src/director-guardrails.ts`. (2) seeds `admin_settings.director_max_operation_minutes = '15'` — the threshold the watchdog cron at HH:30 uses to detect runaway operations. Settable from `/dashboard/admin/` System guardrails section, range 5-240. (3) creates `director_health(operation_id, operation_type, piece_id, started_at, last_heartbeat_at, completed_at, status)` + two indexes (`(status, started_at)` for the watchdog scan; partial index on `last_heartbeat_at WHERE status='running'` for future heartbeat-staleness checks). Director writes a row at every `keepAlive()` acquire via `recordOperationStart(env, type, pieceId)`; marks `completed` at dispose via `recordOperationComplete(env, operationId)`. **Survives DO code-resets** (the gap that defeated in-memory `_keepAliveRefs` during the 2026-05-17 cap incident — see DECISIONS 2026-05-17 "Cap incident + Director kill-switch / watchdog / admin guardrails" and docs/CAP-INCIDENT-2026-05-17.md). Empty at migration time. Rows accumulate one per pipeline + audio-retry; the watchdog cron at `30 * * * *` cleans up any row left as `running` past the threshold by flipping it to `orphaned` and tripping the kill switch. Best-effort writes throughout — D1 errors logged but never block the operation. Additive, rollback = DROP TABLE director_health + UPDATE admin_settings to remove the two seeded rows.
