# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 2 — Generator + Auditor extension + reader surface** (in progress).

Phase 0 + Phase 1 complete and tagged.

## Last completed sub-task

**Phase 2, sub-task 2.1 — HTML generation prompt extension.**

- Added `INTERACTIVE_HTML_GENERATOR_PROMPT` system prompt (~12.4 KB, ~3K tokens) to [`agents/src/interactive-generator-prompt.ts`](../agents/src/interactive-generator-prompt.ts). Voice contract embedded inline (same self-contained pattern as the quiz auditor); structural rules + sandbox compatibility + validator rules reproduced as positive instructions; engagement-event hint for Phase 4. Reference few-shot example slot left unfilled — sub-task 2.7 plugs in `docs/examples/interactive-reference.html` once it ships.
- Added types: `PieceContextForInteractive` (alias of `PieceContextForQuiz` — quiz/HTML share input shape today), `RevisionPreviousHtml`, `RevisionValidatorViolation`.
- Added builders: `buildHtmlInteractivePrompt(piece, recent)` for round-1 produce; `buildHtmlRevisionPrompt(previous, audit, validatorViolations, piece, recent, round)` for rounds 2+. Revision builder accepts validator-only OR auditor-only OR both feedback shapes — Generator (sub-task 2.3) decides which to populate based on which gate failed.
- Added constants: `HTML_FILE_BYTES_MAX = 50 * 1024` (mirrors validator rule 1) and `HTML_SCRIPT_ALLOWLIST_DESCRIPTION` (the cdnjs D3 v7 allowlist surface, used in the prompt + future validator).
- No call site changes — the Generator doesn't yet route to the HTML path. That wiring lands in 2.3. Quiz path exports unchanged (`INTERACTIVE_GENERATOR_PROMPT`, `buildInteractivePrompt`, `buildRevisionPrompt` etc.) and quiz path callers compile clean.
- Typecheck: 25 pre-existing `server.ts` SDK-typing errors, zero new errors from this commit.

**Earlier completed sub-tasks (Phase 1) — `[phase-1.1]` + `[phase-1.2]` commit cluster.**

- **1.1 — feature flag.** Migration `0024_interactives_html_flag.sql` — `INSERT OR IGNORE INTO admin_settings('interactives_html_enabled', 'false', …)`. Default `'false'` so the migration is behaviourally a no-op on prod. Quizzes NOT gated by this flag (the longer name vs. `interactives_enabled` was the deliberate choice to make that explicit). Phase 2 ships the read site; Phase 3 ships the admin UI write site.
- **1.2 — schema column.** Migration `0025_interactives_quality_tier.sql` — added `interactives.quality_tier TEXT` (`'polished' | 'solid' | 'rough' | NULL`) mirroring `src/lib/audit-tier.ts`'s `AuditTier` shape. Auto-applied UPDATE backfilled the 3 existing `quality_flag='low'` rows to `quality_tier='rough'`. Chose the new-column path over read-time rendering because the 2026-04-25-pm drawer commit (`4a2f3c2`) deliberately dropped the "Rough" label *because* of the daily-piece tier collision when voice was high but another dimension max-failed. Owning a separate column at the schema level keeps the interactive vocabulary distinct.
- Both migrations applied to remote D1, verified via `PRAGMA table_info` + `SELECT` queries (admin_settings now has 2 rows: `interval_hours='12'` + `interactives_html_enabled='false'`; `interactives` now has 13 columns; all 3 historical low rows carry `quality_tier='rough'`).
- `docs/SCHEMA.md` updated (count `19 tables × 25 migrations`; new column row; new migration entries for 0024 + 0025).
- `docs/RUNBOOK.md` updated with new "Interactives v3 — HTML interactive flag" section (read/flip/rollback commands).
- `docs/INTERACTIVES_PLAN_NOTES.md` got one Phase 1 entry recording the row-count drift (status said 2; prod had 3 because the firing-squads piece's interactive shipped flagged-low between v3 commissioning and Phase 1).

Tag `interactives-v3.1-complete` (set at commit time).

## Next sub-task

**Phase 2 sub-task 2.2 — Validator.** New shared module `agents/src/interactive-validator.ts`. Pure function `validate(html: string): ValidatorResult` implementing the eight rules from [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Validator rules" (size-cap, storage-api, dynamic-code, external-script-allowlist, network-call, nested-iframe, form-element, unsafe-url-scheme). Output shape exported as `ValidatorResult`/`Violation`/`RuleId` per the spec. No HTML parser dependency — text scanning with comment-stripping pre-pass. Used by Generator inline before commit (sub-task 2.3) and by Auditor for the structural dimension as input (the Auditor doesn't re-run the validator; it's told the file passed).

Phase 2 has 7 sub-tasks total. Remaining: 2.2 validator → 2.3 Generator extension → 2.4 Auditor extension → 2.5 file commit + row schema → 2.6 reader Web Component → 2.7 manual-proof reference HTML + flag flip + tag. Each is one commit. Per the plan, the manual-proof step (sub-task 2.7) is where Zishan reviews the hand-written reference HTML on prod before flipping `interactives_html_enabled = true`.

Definition of done for Phase 2: flag = true, next published piece produces both quiz and HTML interactive, drawer shows both, tag `interactives-v3.2-complete` pushed.

## Blockers

None.

## Plan vs repo notes

Two entries in `docs/INTERACTIVES_PLAN_NOTES.md`:
- 2026-04-26 Phase 0 — book chapter filename was already renamed to `09-the-sixteen-roles.md` on 2026-04-24 (commit `41edf46`); FOLLOWUPS book-rename entry skipped because the rename is already done.
- 2026-04-26 Phase 1 — `quality_flag='low'` row count was 3 not 2 (third row was the firing-squads piece's interactive, shipped same-day as v3 was commissioned). Backfill was set-shaped (`WHERE quality_flag='low'`) so it covered all 3 without code change.

## Live state

- `interactives_html_enabled = 'false'`: row exists in `admin_settings` (migration 0024). No reader yet — Phase 2 ships the read site.
- `interactives` table: exists (migration 0022 + 0025). Quiz path live, HTML path not yet. New column `quality_tier` populated for the 3 historical low rows; NULL on the 5 clean ones.
- `interactive_engagement` table: exists (migration 0022). Populated for quizzes; will extend to HTML in Phase 4.
- `interactive_audit_results` table: exists (migration 0023). Per-round per-dimension audit notes.
- `InteractiveGenerator` (#15): producing quizzes only.
- `InteractiveAuditor` (#16): auditing quizzes only.
- Site: 8 quizzes published. No HTML interactives yet. `/interactives/<slug>/` route serves quiz content via `<quiz-card>`.

## Sessions log

(Append a one-line summary at the end of every session. This is human-readable history.)

| Date | Phase | Sub-tasks completed | Notes |
|---|---|---|---|
| 2026-04-26 | n/a | v3 plan + status + session protocol installed; empty PLAN_NOTES created | Replaces v2 seed plan (in `~/Downloads/files/`) which pre-dated Area 4 and described building things that already exist. Commit `[interactives-plan-v3]`. |
| 2026-04-26 | 0 | 0.1 — spec + rubric + validator rules + sandbox shape + decisions + book ch9 update | All Phase 0 deliverables in one `[phase-0.1]` commit. Plan-vs-repo: book chapter filename already renamed (recorded in PLAN_NOTES). Tag `interactives-v3.0-complete`. |
| 2026-04-26 | 1 | 1.1 — `interactives_html_enabled` flag (migration 0024); 1.2 — `interactives.quality_tier` column + backfill (migration 0025); SCHEMA + RUNBOOK synced | Two migrations applied to remote D1. Plan-vs-repo: prod had 3 `quality_flag='low'` rows not 2 (recorded in PLAN_NOTES); set-shaped backfill covered all 3. Tag `interactives-v3.1-complete`. |
| 2026-04-26 | 2 | 2.1 — HTML generation prompt extension (system prompt + types + builders) | Prompt module additions only; no call sites yet. Voice contract embedded inline, validator rules + sandbox spec reproduced as positive instructions. Few-shot reference slot left unfilled — 2.7 will plug in `docs/examples/interactive-reference.html`. Zero new typecheck errors. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
