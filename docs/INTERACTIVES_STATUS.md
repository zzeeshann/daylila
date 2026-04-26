# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 2 — Generator + Auditor extension + reader surface** (in progress).

Phase 0 + Phase 1 complete and tagged.

## Last completed sub-task

**Phase 2, sub-task 2.4 — InteractiveAuditor extended with HTML rubric, wired into the Generator's HTML loop.**

- [`agents/src/interactive-auditor-prompt.ts`](../agents/src/interactive-auditor-prompt.ts): added `INTERACTIVE_HTML_AUDITOR_PROMPT` system prompt covering the four-dimension HTML rubric from [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Audit rubric". ALL FOUR dimensions are scored 0–100 (not binary like the quiz path) — voice ≥85, structure ≥75, essence ≥75, factual ≥75. Voice contract embedded inline; per-dimension thresholds exported as constants (`INTERACTIVE_HTML_STRUCTURE_MIN_SCORE`, `INTERACTIVE_HTML_ESSENCE_MIN_SCORE`, `INTERACTIVE_HTML_FACTUAL_MIN_SCORE`). New `AuditableHtml` type + `buildHtmlAuditorPrompt(html, piece)` builder.
- [`agents/src/interactive-auditor.ts`](../agents/src/interactive-auditor.ts): `audit()` now dispatches by discriminated input — `{ type: 'quiz', quiz }` or `{ type: 'html', html }`. Two private methods `auditQuiz` / `auditHtml` carry the per-type logic. Quiz path unchanged (binary structure/essence/factual + voice scored). HTML path scores all four; defensive pass-gates clamp Claude's `passed` against per-dimension thresholds. HTML system prompt sent as a single Anthropic prompt-cache block (`cache_control: ephemeral`).
- [`agents/src/interactive-generator.ts`](../agents/src/interactive-generator.ts) `runHtmlLoop` rewired: removed the `TODO 2.4` marker; each round now runs produce → validate → audit → revise. Validator failure routes through validator-feedback revision; audit failure routes through audit-feedback revision (mutually exclusive — audit only runs when validator passes that round). Audit rows persist to `interactive_audit_results` (4 rows per round, all 4 dimensions carry scores for HTML — `persistAuditRows` reads `score ?? null` so the same function serves both quiz-NULL and HTML-populated paths). On round-3 audit-max-fail: ship-as-low (`quality_flag='low'`, `auditorMaxFailed=true`, file commits with `[html, flagged low]` commit message). Validator-max-fail still terminates without commit (runtime-broken file would SecurityError in the sandbox).
- `runQuizLoop` audit call site updated to use the new discriminated input shape (`{ type: 'quiz', quiz: { ... } }`).
- `reviseHtml` signature gains an `auditFeedback: RevisionFeedback | null` parameter. Revision prompt builder (already from 2.1) now sees both the validator violations AND the audit feedback when relevant.
- New helper `buildAuditFeedback(audit)` converts an `InteractiveAuditResult` into the `RevisionFeedback` shape; quiz `reviseQuiz` also refactored to use it (was inlined). Single source of truth for the conversion.
- New state counter `htmlInteractivesAuditorMaxFailed` tracks ship-as-low ratio for HTML separately from validator-max-failed.
- HTML commit-path return now carries `voiceScore` + `finalAudit` (no longer null). Observer's HTML summary line reflects audit state correctly.
- Typecheck: 25 pre-existing `server.ts` SDK-typing errors, zero new from this commit. Validator harness still 28/28 pass.
- Flag still `'false'` on prod; HTML path bypassed; no live behaviour change.

**Earlier completed sub-tasks (Phase 2):**

- `[phase-2.3]` InteractiveGenerator extended with parallel HTML loop (validator-gated; per-type idempotence; observer logging extended).
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

**Phase 2 sub-task 2.5 — File commit path + interactives row schema.** With the Generator + Auditor + Validator stack now end-to-end functional, sub-task 2.5 closes the reader-side data shape. Resolve the deferred decisions:

1. **Slug collisions across artefact types** — current code uses `resolveFreeSlug()` which appends `-2` if the slug exists. If quiz and HTML for the same piece both produce slug `chokepoints-and-cascades`, HTML lands at `chokepoints-and-cascades-2`, splitting them across URLs. Spec implies one URL per piece (both at `/interactives/<slug>/`). Decision: relax the UNIQUE constraint to `(slug, type)` — same migration adds index — OR allow shared slug with content-type-aware URL routing. Likely the schema change (clean separation, simpler reader logic).
2. **`daily_pieces.interactive_id` second-pointer** — currently quiz-only. HTML rows are findable via `interactives WHERE source_piece_id = ?` but the legacy column doesn't carry HTML. Decision: leave the column quiz-only (back-compat with the 4.6 last-beat prompt surface); reader code that wants both queries by `source_piece_id`. No schema change needed.
3. **Content collection schema for HTML** — current `src/content.config.ts` has `interactives` discriminatedUnion with a `quiz` branch only. Add an `html` branch carrying `{ slug, type: 'html', title, concept, sourcePieceId, voiceScore?, qualityFlag?, content: { type: 'html', html: string } }` — but Astro content collections don't natively load `.html` files alongside `.json` files. Either: (a) make the `.html` file the actual artefact + a sibling `.json` index file referencing it, or (b) inline the html string into the JSON envelope, OR (c) custom loader. Decision needed during 2.5.

After 2.5: → 2.6 reader Web Component → 2.7 manual-proof reference HTML + flag flip + tag. Each is one commit. Per the plan, the manual-proof step (sub-task 2.7) is where Zishan reviews the hand-written reference HTML on prod before flipping `interactives_html_enabled = true`.

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
| 2026-04-26 | 2 | 2.4 — InteractiveAuditor extended with HTML rubric + wired into runHtmlLoop | New `INTERACTIVE_HTML_AUDITOR_PROMPT` (4 dims all scored, voice ≥85, others ≥75); `audit()` now dispatches by `{type:'quiz'|'html'}`; HTML system prompt prompt-cached. Generator's `runHtmlLoop` runs full produce→validate→audit→revise; ship-as-low on audit max-fail (`quality_flag='low'`); validator-max-fail still no-commit. Per-round audit rows persist for HTML across all 4 dims. Zero new typecheck errors. Flag still `'false'`. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
