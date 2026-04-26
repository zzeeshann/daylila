# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 2 — Generator + Auditor extension + reader surface** (in progress).

Phase 0 + Phase 1 complete and tagged.

## Last completed sub-task

**Phase 2, sub-task 2.5 — File commit path + interactives row schema for two artefacts per piece.**

- **Migration 0026** — relaxed `interactives.slug UNIQUE` → composite `UNIQUE(slug, type)`. Same table-rebuild pattern as 0015 (snapshot at `interactives_backup_20260426`, queued for drop 2026-05-04). Applied cleanly to remote D1 — all 8 existing rows preserved, composite UNIQUE verified to (a) accept quiz+html with same slug, (b) reject duplicate (slug, type).
- **Three architectural decisions resolved in-commit:**
  1. **Slug:** quiz + html for the same piece SHARE the slug (one URL per piece — `/interactives/<slug>/` renders both teaching modalities). Migration 0026 relaxes the UNIQUE constraint; Generator `resolveFreeSlug` becomes type-aware; HTML loop pre-looks-up the existing quiz row's slug and uses it verbatim when present.
  2. **`daily_pieces.interactive_id`:** stays quiz-only for back-compat with the 4.6 last-beat prompt surface. HTML rows are findable via `interactives WHERE source_piece_id = ?`. No second pointer column added.
  3. **File location:** diverged from plan's `<slug>.html` raw HTML to `<slug>-html.json` JSON envelope. Astro content collections need a single-loader/single-extension contract; mixing `.json` and `.html` would either collide on entry IDs or require a custom loader. The JSON-envelope mirror of the existing quiz pattern is simpler and works with the same `discriminatedUnion` schema. Recorded as PLAN_NOTES entry.
- **Generator commit path** — `runHtmlLoop` now writes `content/interactives/<slug>-html.json` with the same JSON shape as quiz files but with `type='html'` and `content: { type: 'html', html: '<!DOCTYPE...' }`. Looks up existing quiz row's slug at commit time; uses its slug or falls back to `resolveFreeSlug(claudesSlug, 'html')`.
- **Content collection schema** — [`src/content.config.ts`](../src/content.config.ts) widens `type: z.enum(['quiz'])` → `z.enum(['quiz', 'html'])`; adds an `html` branch to the `content` discriminatedUnion carrying `html: z.string().min(1)`. Existing 8 quiz files validate unchanged. `pnpm build` runs clean.
- **SCHEMA.md** updated to count `19 tables × 26 migrations`; `interactives.slug` row notes the composite UNIQUE; new migration 0026 entry in the migrations log.
- **PLAN_NOTES** documents the file-location divergence with the rationale path.
- **FOLLOWUPS** carries the snapshot-drop entry for 2026-05-04.
- Typecheck: 25 pre-existing `server.ts` SDK-typing errors, zero new from this commit.
- Flag still `'false'` on prod; HTML path bypassed; no live behaviour change.

**Earlier completed sub-tasks (Phase 2):**

- `[phase-2.4]` InteractiveAuditor extended with HTML rubric + wired to Generator (4-dim rubric, all scored; ship-as-low on round-3 audit-max-fail).
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

**Phase 2 sub-task 2.6 — Reader surface: `<interactive-frame>` Web Component.** Build the sandboxed-iframe renderer that the existing `/interactives/[slug]/` route page dispatches to when an entry has `data.type === 'html'`. New file `src/interactive/interactive-frame.ts` mirroring the `<quiz-card>` pattern (custom element, parses a JSON payload from a child `<script type="application/json">`, renders into a constrained shadow DOM or scoped CSS). Renders a single `<iframe>` with the exact attribute set from the spec: `sandbox="allow-scripts"` (no other token), `loading="lazy"`, `referrerpolicy="no-referrer"`, `title={concept}`. Loads HTML via `srcdoc` (manual-proof acceptable per spec; production CDN lookups deferred). Wires the existing `[slug].astro` route page to dispatch on `type` — when both quiz + html entries exist for a slug, render BOTH stacked (quiz card first, then interactive frame; both above the "Back to library" link).

Decisions to resolve in 2.6:
- **`srcdoc` vs `src`:** spec leans `src=` for prod (CDN-cacheable, smaller parent page) but `srcdoc=` is acceptable for the manual proof. Going with `srcdoc=` for v1 — keeps the route logic simple, no `/embed` route to maintain. Mark in DECISIONS as a future-tunable.
- **Drawer surfacing:** the existing "How this was made" drawer's MadeInteractive section currently surfaces just the quiz. Extend to list both artefact types when both exist per piece.

After 2.6: → 2.7 manual-proof reference HTML + flag flip + tag `interactives-v3.2-complete`. Each is one commit. Per the plan, 2.7 is where Zishan reviews the hand-written reference on prod before flipping `interactives_html_enabled = true`.

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
| 2026-04-26 | 2 | 2.5 — File commit path + interactives row schema | Migration 0026 relaxed `UNIQUE(slug)` → `UNIQUE(slug, type)` (table rebuild, snapshot held). Generator `runHtmlLoop` writes `<slug>-html.json` (JSON envelope, html-string inlined) — slug pulled from existing quiz row when present (one URL per piece). Content collection schema widens `type` enum + adds `html` branch. PLAN_NOTES + FOLLOWUPS + SCHEMA.md synced. Plan-vs-repo divergence: `<slug>-html.json` not `<slug>.html` (loader simplicity). Zero new typecheck errors. `pnpm build` clean. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
