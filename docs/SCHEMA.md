# Zeemish v2 — Database Schema (D1)

Database: `zeemish` (Cloudflare D1, SQLite)
Database ID: `f3cdccbf-7cea-4af1-b524-20f6a6fe1dd4`
**22 tables across 30 migrations.**

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

PK: **(piece_id, course_id, date)** since migration 0017. Indexes: `idx_engagement_course` on `course_id`, `idx_engagement_date` on `date`, `idx_engagement_piece` on `piece_id`. Migrations: `0003_engagement_learnings.sql` (initial), `0017_engagement_piece_id.sql` (PK rebuild + backfill).

### learnings
Cross-agent learnings database — patterns that work or don't. Drafter reads the 10 most recent rows (across all sources / categories) at runtime and includes them in its prompt — the loop the system uses to improve on itself.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| category | TEXT | `voice` \| `structure` \| `engagement` \| `fact`. What kind of learning it is — shapes which prompt it should inform. |
| observation | TEXT | The insight |
| evidence | TEXT | JSON: what supports this |
| confidence | INTEGER | 0-100 |
| applied_to_prompts | INTEGER | 0 or 1 |
| source | TEXT | `reader` \| `producer` \| `self-reflection` \| `zita`. Where the signal came from. Loose TEXT, nullable — no CHECK constraint because a future fifth origin is cheap to add at the write site. NULL means "unspecified (pre-P1.3)". Indexed via `idx_learnings_source`. **Application layer is stricter than the schema:** `writeLearning` refuses to insert a row whose `source` is null, empty, or non-string — logs a warn to `observer_events` and skips. Column nullability remains so historical pre-P1.3 rows stay readable; new rows must always carry a source. |
| piece_date | TEXT | YYYY-MM-DD of the `daily_pieces` row this learning is about. Nullable at schema level so migration 0012 could apply non-destructively to pre-existing rows, which were then filled via a one-time manual UPDATE matching `learnings.created_at` to `daily_pieces.published_at`. **Application layer enforces non-null going forward:** `writeLearning` refuses rows missing `piece_date`, same defensive pattern as `source` (both checks route through the shared `logMissingField` helper). Indexed via `idx_learnings_piece_date`. Primary read path: the per-piece "What the system learned" section of the How-this-was-made drawer. |
| piece_id | TEXT | `daily_pieces.id` (UUID) this learning is about. Added migration 0014 (cadence Phase 1). Nullable at schema level; backfilled for all 27 prod rows via `piece_date → daily_pieces.date → daily_pieces.id` lookup. Indexed via `idx_learnings_piece_id`. `piece_date` stays alongside — Phase 3+ callers pass both; a later phase may drop `piece_date` once the dual-key write posture is proven. |
| created_at | INTEGER | |
| last_validated_at | INTEGER | |

`category` and `source` are orthogonal: `category` is *what* kind of learning (voice/structure/…); `source` is *who* produced the signal (reader/producer/…).

Migrations: `0003_engagement_learnings.sql` (initial), `0011_learnings_source.sql` (added `source`), `0012_learnings_piece_date.sql` (added `piece_date`), `0014_piece_id_fks.sql` (added `piece_id`).

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

Indexes: `idx_audit_task` on `task_id`, `idx_audit_created` on `created_at`, `idx_audit_results_piece` on `piece_id`.

Migrations: `0004_audit_results.sql` (original), `0008_drop_agent_tasks.sql` (dropped the FK to the deleted `agent_tasks` table; original `audit_results` was empty across all runs because every INSERT failed the orphaned FK check), `0014_piece_id_fks.sql` (added `piece_id`).

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
| selected | INTEGER | 1 if Director picked this story. **Historical data-flow quirk:** all 250 prod rows have `selected=0` despite 5 pieces having been published — see FOLLOWUPS "`daily_candidates.selected` never flipped on historical runs". |
| piece_id | TEXT | `daily_pieces.id` (UUID) for the run that produced this candidate batch. Added migration 0014 (cadence Phase 1), semantic extended by migrations 0018+0019 (2026-04-22 piece_id schema fix). Scanner now writes piece_id on **every** candidate row at INSERT time (not just the picked one) — Director pre-allocates pieceId at the top of `triggerDailyPiece` and passes it into `scanner.scan(pieceId)`. All 350 historical rows backfilled via 0019 (pre-2026-04-22 via date-join, 2026-04-22 via midpoint split between the two same-date pieces). Indexed via `idx_candidates_piece_id`. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables". |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0014_piece_id_fks.sql` (added `piece_id`).

### daily_pieces
Published daily teaching pieces.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| date | TEXT | YYYY-MM-DD |
| headline | TEXT | The teaching piece title |
| underlying_subject | TEXT | What it teaches about |
| source_story | TEXT | Original news source |
| word_count | INTEGER | |
| beat_count | INTEGER | |
| voice_score | INTEGER | |
| fact_check_passed | INTEGER | |
| has_interactive | INTEGER | **Deprecated as of migration 0022.** Scaffolded in 0006, never read or written by any code path, always 0 in production. `interactive_id` (below) is the single source of truth for "does this piece have an interactive". Column stays physical because SQLite DROP COLUMN would require a `daily_pieces` table rebuild (blast radius too big for hygiene). No writer touches it going forward. |
| reading_minutes | INTEGER | |
| quality_flag | TEXT | NULL = normal, 'low' = audit failed after max revisions |
| has_audio | INTEGER | 0 or 1. Flipped to 1 by `Publisher.publishAudio` when the audio second-commit succeeds. Never set by Producer or Auditor. |
| interactive_id | TEXT | `interactives.id` (UUID) for the 1:1 interactive generated for this piece. NULL = no interactive. Set by InteractiveGeneratorAgent's final publish step (sub-task 4.4). Nullable, non-enforced FK, consistent with codebase convention. Indexed via `idx_daily_pieces_interactive`. Added migration 0022. |
| published_at | INTEGER | |
| created_at | INTEGER | |

Migrations: `0006_daily_pieces.sql`, `0009_quality_flag.sql`, `0010_audio_pipeline.sql` (added `has_audio`), `0022_interactives.sql` (added `interactive_id`; deprecated `has_interactive`)

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
| duration_seconds | INTEGER | Nullable — not currently measured. |
| request_id | TEXT | ElevenLabs `request-id` response header. Used for prosodic stitching on the next beat (`previous_request_ids`). |
| model | TEXT | e.g. `eleven_multilingual_v2`. Stored per row so future model swaps are visible in audit history. |
| voice_id | TEXT | e.g. `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey). Same reason as model. |
| generated_at | INTEGER | Unix timestamp ms. |

PK: **(piece_id, beat_name)** (since migration 0015). Indexes: `idx_piece_audio_piece` on `piece_id`, `idx_piece_audio_date` on `date`.

Migrations: `0010_audio_pipeline.sql` (original, PK was (date, beat_name)), `0015_daily_piece_audio_piece_id_pk.sql` (PK rebuild to (piece_id, beat_name), snapshot → create-new → copy → drop-old → rename, with `daily_piece_audio_backup_20260421` held for rollback through 2026-04-28).

### pipeline_log
Step-by-step record of each daily piece run. The admin dashboard polls this for the live pipeline monitor.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| run_id | TEXT | `YYYY-MM-DD` — the calendar day of this step's run. **Semantic walk-back 2026-04-21:** Phase 1's briefing had proposed shifting run_id to piece_id UUIDs, and the backfill ran, but four site-worker queries (`made.ts`, admin piece deep-dive, dashboard pipeline API + index) had embedded `run_id = YYYY-MM-DD` assumptions. Backfill rolled back from `pipeline_log_backup_20260421` the same day. Revised architecture: run_id stays date-shape permanently; `piece_id` is added as an additive column (below). See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill". |
| piece_id | TEXT | `daily_pieces.id` (UUID) — the piece this step belongs to. Added migration 0018, backfilled via 0019 (date-join for pre-2026-04-22; midpoint-split for 2026-04-22 multi-per-day rows). Director pre-allocates `pieceId` at the top of `triggerDailyPiece` and threads through every `logStep()` call so every row carries it going forward. Nullable at schema level (defensive for orphan pre-0018 rows); populated on every new row. Indexed via `idx_pipeline_log_piece`. Admin per-piece deep-dive scopes by this; admin home pipeline history continues to group by `run_id` for day-view semantics. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables". |
| step | TEXT | scanning, curating, drafting, auditing_r1, publishing, done, error |
| status | TEXT | running, done, failed |
| data | TEXT | JSON with step-specific data (scores, counts, headlines) |
| created_at | INTEGER | |

Migrations: `0007_pipeline_log.sql` (initial). Migration 0014's proposed run_id semantic shift was reverted same-day — no net schema or data change. `0018_pipeline_log_piece_id.sql` added the `piece_id TEXT` column + `idx_pipeline_log_piece` (additive, no PK rebuild). `0019_piece_id_backfill.sql` populated all 153 historical rows.

### admin_settings
Key/value table for admin-configurable system state. One row per setting. First consumer is `interval_hours` read by Director (Phase 2 of the cadence plan); future settings (rate limits, feature flags, voice overrides, scanner feed overrides) live here too.

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | e.g. `interval_hours` |
| value | TEXT NOT NULL | Stringly-typed. Caller parses to expected shape via helper (`agents/src/shared/admin-settings.ts` → `getAdminSetting<T>(db, key, parse, fallback)`). Non-null even when logically empty — use a sentinel value rather than allowing null. |
| updated_at | INTEGER NOT NULL | Unix timestamp ms. Last write time. |

Read path: [`getAdminSetting`](../agents/src/shared/admin-settings.ts) — swallows every failure mode (missing row, non-string value, DB throw) and returns the caller's `fallback`. Fresh read per call, no caching.

Write path: currently seeded via migration only (`INSERT OR IGNORE interval_hours='24'`). Phase 5 of the cadence plan adds the admin UI + `/api/dashboard/admin/settings` endpoint, with an `admin_settings_changed` observer_event fired alongside every UPDATE for audit-trail.

Seeded values: `interval_hours = '24'` (preserves current 1-piece/day production cadence until Phase 3 wires the hourly gate).

Migration: `0016_admin_settings.sql`

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

## Migrations summary (30 migrations, 22 tables)
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
- `0016_admin_settings.sql` — multi-piece cadence Phase 2. Created `admin_settings(key, value, updated_at)` — first admin-configurable surface in Zeemish v2. Seeded `interval_hours='24'` via `INSERT OR IGNORE` (preserves current 1-piece/day cadence). Read by Director at start of `triggerDailyPiece`; gate logic lands in Phase 3. Future settings (rate limits, feature flags, voice overrides) will use the same table.
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
