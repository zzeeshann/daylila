# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 2 — Generator + Auditor extension + reader surface** (in progress).

Phase 0 + Phase 1 complete and tagged.

## Last completed sub-task

**Phase 2, sub-task 2.3 — InteractiveGenerator extended with parallel HTML loop.**

- [`agents/src/interactive-generator.ts`](../agents/src/interactive-generator.ts) refactored. Top-level `generate()` is now a dispatcher that runs both quiz AND html paths independently, gated by per-type idempotence + the `interactives_html_enabled` flag.
- **Per-type idempotence.** Replaced the single `daily_pieces.interactive_id` gate with two queries: `interactives WHERE source_piece_id = ? AND type = 'quiz'` and `... AND type = 'html'`. Each artefact runs only if its row is absent. This unblocks "retry just-the-missing-one" semantics without touching the back-compat `daily_pieces.interactive_id` pointer (still set by quiz commits for the 4.6 last-beat surface).
- **Recent excludes this piece's siblings.** Diversity query now `WHERE source_piece_id != ?` so retrying the HTML path on a piece that already has a quiz doesn't see its own quiz on the recent-list (which would push the HTML to decline as "redundant" — but the HTML SHOULD teach the same concept).
- **HTML loop is validator-gated only in 2.3.** Each round: produce → `validateHtml()` → pass→commit, fail→revise with `RevisionValidatorViolation[]`. The auditor call is NOT yet wired (sub-task 2.4 lands it with a `TODO 2.4` marker in place). 3 rounds of validator failures → no commit (`validatorMaxFailed: true`); shipping a validator-failed file would SecurityError at runtime, so unlike auditor-max-fail (ship-as-low) it's a hard decline.
- **Anthropic prompt caching wired.** HTML system prompt passed as `[{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }]`. Round 1 seeds; revision rounds + the next piece's HTML run within ~5 minutes hit cache for the ~12 KB stable prefix.
- **Result shape changed:** `InteractiveGeneratorResult` is now `{ pieceId, date, htmlEnabled, quiz: QuizArtefactResult, html: HtmlArtefactResult | null, durationMs }`. The `html` field is null when the flag is false. Both per-artefact result shapes carry their own `ran/skipped/declined/committed/auditorMaxFailed` terminal flags; HTML adds `validatorMaxFailed`.
- **Observer logging extended.** [`logInteractiveGeneratorMetered`](../agents/src/observer.ts) now takes `{ htmlEnabled, quiz, html, totalDurationMs }`. One event per Generator run summarises both artefacts. Severity rolls up: escalation if all-that-ran failed; warn if any shipped flagged-low; info on clean pass or all-skipped.
- **DO state counters extended.** `htmlInteractivesGenerated`, `htmlInteractivesDeclined`, `htmlInteractivesValidatorMaxFailed` track HTML path metering separately from quiz.
- **No live behaviour change on prod.** Flag is `'false'`; HTML loop is silently bypassed; existing quiz behaviour preserved bit-for-bit. Typecheck: 25 pre-existing `server.ts` SDK-typing errors, zero new from this commit.
- Validator regression harness still 28/28 pass via `pnpm verify-validator`.

**Earlier completed sub-tasks (Phase 2):**

- `[phase-2.2]` HTML interactive validator + `pnpm verify-validator` 28-case harness.
- `[phase-2.1]` HTML generation prompt extension (`INTERACTIVE_HTML_GENERATOR_PROMPT`, builders, types).

**Earlier completed sub-tasks (Phase 1) — `[phase-1.1]` + `[phase-1.2]` commit cluster.**

- **1.1 — feature flag.** Migration `0024_interactives_html_flag.sql` — `INSERT OR IGNORE INTO admin_settings('interactives_html_enabled', 'false', …)`. Default `'false'` so the migration is behaviourally a no-op on prod. Quizzes NOT gated by this flag (the longer name vs. `interactives_enabled` was the deliberate choice to make that explicit). Phase 2 ships the read site; Phase 3 ships the admin UI write site.
- **1.2 — schema column.** Migration `0025_interactives_quality_tier.sql` — added `interactives.quality_tier TEXT` (`'polished' | 'solid' | 'rough' | NULL`) mirroring `src/lib/audit-tier.ts`'s `AuditTier` shape. Auto-applied UPDATE backfilled the 3 existing `quality_flag='low'` rows to `quality_tier='rough'`. Chose the new-column path over read-time rendering because the 2026-04-25-pm drawer commit (`4a2f3c2`) deliberately dropped the "Rough" label *because* of the daily-piece tier collision when voice was high but another dimension max-failed. Owning a separate column at the schema level keeps the interactive vocabulary distinct.
- Both migrations applied to remote D1, verified via `PRAGMA table_info` + `SELECT` queries (admin_settings now has 2 rows: `interval_hours='12'` + `interactives_html_enabled='false'`; `interactives` now has 13 columns; all 3 historical low rows carry `quality_tier='rough'`).
- `docs/SCHEMA.md` updated (count `19 tables × 25 migrations`; new column row; new migration entries for 0024 + 0025).
- `docs/RUNBOOK.md` updated with new "Interactives v3 — HTML interactive flag" section (read/flip/rollback commands).
- `docs/INTERACTIVES_PLAN_NOTES.md` got one Phase 1 entry recording the row-count drift (status said 2; prod had 3 because the firing-squads piece's interactive shipped flagged-low between v3 commissioning and Phase 1).

Tag `interactives-v3.1-complete` (set at commit time).

## Next sub-task

**Phase 2 sub-task 2.4 — InteractiveAuditor extended with HTML rubric.** Extend [`agents/src/interactive-auditor.ts`](../agents/src/interactive-auditor.ts) to accept an artefact-type argument (`quiz | html`) and route to the right rubric. Quiz path stays unchanged. HTML path gets the four-dimension rubric from [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Audit rubric" — voice ≥85, structure ≥75, essence ≥75, factual ≥75, all four scored not binary. Single Claude call (same trade-off as quiz). Wire the call from `runHtmlLoop` at the `TODO 2.4` marker — after validator passes, audit; on audit fail revise with auditor feedback; on audit max-fail (round 3) ship-as-low (`quality_flag='low'`) mirroring quiz. Persist 4 rows per round to `interactive_audit_results` (same table the quiz path uses). Auditor system prompt for HTML also goes through Anthropic prompt caching — voice contract + rubric are stable.

Phase 2 has 7 sub-tasks total. Remaining: 2.4 Auditor extension → 2.5 file commit + row schema (resolves the still-open `daily_pieces.interactive_id` second-pointer question + the slug collision-vs-shared question) → 2.6 reader Web Component → 2.7 manual-proof reference HTML + flag flip + tag. Each is one commit. Per the plan, the manual-proof step (sub-task 2.7) is where Zishan reviews the hand-written reference HTML on prod before flipping `interactives_html_enabled = true`.

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
| 2026-04-26 | 2 | 2.2 — HTML interactive validator + verify-validator harness | New `agents/src/interactive-validator.ts` (8 rules, pure function, comment-stripping pre-pass). Constants moved from prompt module to validator (single source of truth). 28-case regression harness via `pnpm verify-validator` — 28/28 pass. TS module + JS mirror cross-checked. Zero new typecheck errors. |
| 2026-04-26 | 2 | 2.3 — InteractiveGenerator extended with parallel HTML loop | `generate()` refactored as a quiz+html dispatcher; per-type idempotence; HTML loop validator-gated only (auditor wires in 2.4); Anthropic prompt caching active on HTML system prompt; result shape changed; observer logging extended to dual-artefact summary. Flag stays `'false'` so prod behaviour unchanged. Zero new typecheck errors. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
