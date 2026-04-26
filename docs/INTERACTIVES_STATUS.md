# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 2 — Generator + Auditor extension + reader surface** (in progress).

Phase 0 + Phase 1 complete and tagged.

## Last completed sub-task

**Phase 2, sub-task 2.6 — Reader surface: `<interactive-frame>` Web Component + dual-artefact route + drawer.**

- New [`src/interactive/interactive-frame.ts`](../src/interactive/interactive-frame.ts) — lightweight Web Component for HTML interactives. Server-rendered iframe is a child element (set via `srcdoc=`); the component only fires engagement events (`interactive_started` on connect; Phase 4's `postMessage` listener stubbed in a comment). SSR-of-iframe avoids JSON-payload escaping problems with `</script>` sequences inside the html string and gives progressive-enhancement (the rendered interactive shows even if JS fails to upgrade).
- New [`src/styles/interactive-frame.css`](../src/styles/interactive-frame.css) — standalone CSS (not Tailwind-processed, same convention as `quiz.css`). 600px default iframe height, 480px on mobile.
- [`src/pages/interactives/[slug].astro`](../src/pages/interactives/[slug].astro) rewired:
  - `getStaticPaths` groups entries by `data.slug` so each slug renders ONE page that can include both artefact types.
  - Page header uses the quiz's title/concept when present (canonical pre-Phase-2; falls back to html when quiz declined).
  - Renders HTML interactive FIRST (manipulation), then quiz SECOND (recall) — pedagogical layering. Section headers "Try the model" / "Then check the pattern" appear only when both exist.
  - Iframe attributes match the spec exactly: `sandbox="allow-scripts"`, `loading="lazy"`, `referrerpolicy="no-referrer"`, `title={concept}`, `srcdoc={html}`.
  - Decision: `srcdoc=` for v1. `src=` route deferred (see DECISIONS).
- **Astro 5 content-collection bug surfaced + fixed.** Astro 5's `glob` loader auto-uses a top-level `slug` field as the entry id when present in data. Quiz + html files for the same piece share the slug (one URL per piece — Phase 2.5), so the second-loaded entry was silently overwriting the first. Fix in [`src/content.config.ts`](../src/content.config.ts): explicit `generateId` on the loader uses the FILENAME (`<slug>.json` → `<slug>`; `<slug>-html.json` → `<slug>-html`), so each file's entry id is unique regardless of the `slug` field. Diagnosed via temp fixture + dev-server logs (`getCollection` returned 8 not 9).
- Drawer extension:
  - [`src/lib/made-by.ts`](../src/lib/made-by.ts) `MadeEnvelope` gains `htmlInteractive: MadeInteractive | null` field. `interactive` field stays as the quiz pointer for back-compat with shipped reader bundles.
  - [`src/pages/api/daily/[date]/made.ts`](../src/pages/api/daily/[date]/made.ts) endpoint runs two queries (`type='quiz'` and `type='html'`); each populates a separate envelope field with independent failure handling.
  - [`src/interactive/made-drawer.ts`](../src/interactive/made-drawer.ts) `renderInteractiveSection` now takes a `kind: 'quiz' | 'html'` parameter; per-type section header ("The quiz built…" vs "The interactive model built…") and CTA verb ("Try the quiz →" vs "Try the model →"). Drawer renders both sections when both artefacts exist for a piece.
- Verified end-to-end via temp fixture in dev preview: page rendered HTML interactive (sandboxed iframe with the slider) + quiz card stacked correctly; quiz-only pages still render unchanged. Fixture removed before commit.
- Typecheck: 25 pre-existing `server.ts` SDK-typing errors, zero new from this commit. `pnpm build` clean across all 8 existing quiz pages.
- Flag still `'false'` on prod; HTML path bypassed; no live behaviour change.

**Earlier completed sub-tasks (Phase 2):**

- `[phase-2.5]` File commit path + interactives row schema (migration 0026; one URL per piece via shared slug; `<slug>-html.json` JSON envelope).
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

**Phase 2 sub-task 2.7 — Hand-written reference HTML + manual proof on prod + flag flip + tag.** The full produce → validate → audit → revise → commit → render path is now end-to-end functional behind the flag. 2.7 is the human-in-the-loop step:

1. **Hand-write a reference HTML interactive** at `docs/examples/interactive-reference.html` for one of the recently-published daily pieces. The file is the **canonical "good looks like this"** per Phase 0 decision (b) — permanent, never deleted, updated in place if voice evolves. Pick a piece whose concept has a clean tactile mechanism (chokepoints / coalition-math / asymmetry — concept-rich, slider-friendly).
2. **Add the reference as a few-shot example** in `INTERACTIVE_HTML_GENERATOR_PROMPT` at the slot left for it in 2.1 (`interactive-generator-prompt.ts`). The example sits inside the cached system prompt block, so the prefix invalidation is a one-time cost.
3. **Commit the reference file as a temporary content-collection fixture** (`content/interactives/<that-slug>-html.json`) so it surfaces on the existing route page for review. Zishan reviews it visually on prod.
4. **If accepted:** flip `interactives_html_enabled = 'true'` via `wrangler d1 execute zeemish --remote --command "UPDATE admin_settings SET value = 'true' WHERE key = 'interactives_html_enabled'"`. The next post-publish alarm produces both quiz + html for that piece. Tag `interactives-v3.2-complete`.
5. **If rejected:** iterate the reference until accepted; flag stays `'false'`.

Definition of done for Phase 2: flag = true, the next published piece produces both quiz and HTML interactive, drawer shows both, tag `interactives-v3.2-complete` pushed. Then Phase 3 (admin surface) starts.

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
| 2026-04-26 | 2 | 2.6 — Reader surface: `<interactive-frame>` Web Component + dual-artefact route + drawer | New `<interactive-frame>` component (lightweight; iframe is server-rendered child via `srcdoc=`). Route page groups entries by slug → renders HTML interactive + quiz stacked when both exist. Astro 5 `glob` loader bug surfaced (slug-as-id collision); fixed with explicit `generateId` from filename. Drawer extended: `MadeEnvelope.htmlInteractive` field; per-type section header + CTA wording. Verified end-to-end via temp fixture in dev preview (HTML iframe slider rendered + quiz card stacked). Zero new typecheck errors. Flag still `'false'`. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
