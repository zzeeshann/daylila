# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 3 — Admin surface** (complete after 3.5; tag `interactives-v3.3-complete` pending push).

Phase 0 + Phase 1 complete and tagged. Phase 2 machine-side complete (2.1–2.7 commits on origin/main); flag flip + `interactives-v3.2-complete` tag still pending Zishan's prod review of the reference HTML at `https://zeemish.io/interactives/chokepoints-and-cascades/`.

Phase 3 is parallel-safe with the pending 2.7 review — admin tooling reads/writes the data shapes Phase 2 already shipped and doesn't depend on the reference quality. The 3.1 toggle UI now ships before 2.7's flip, so when Zishan approves the reference, the flip is a one-click admin action instead of `wrangler d1 execute`.

## Last completed sub-task

**Phase 3, sub-task 3.5 — Doc sync.** Shipped 2026-04-26. `docs/INTERACTIVES.md` gains an "Admin surfaces" section before "Reference: hand-built example" covering all four Phase 3 surfaces (toggle, list view, regenerate, cost telemetry) with cross-refs to RUNBOOK fallback recipes and AGENTS.md behaviour. `docs/AGENTS.md` Generator + Auditor entries extended with HTML-path support (Phase 2), cache-token capture via `extractUsage` (Phase 3.4), and the destructive regenerate endpoint (Phase 3.3). `docs/RUNBOOK.md` gains an "Interactives v3 — month-to-date cost" section pointing operators at `/dashboard/admin/interactives/` and naming where the rate constant lives if Anthropic changes pricing.

Phase 3 complete. Tag `interactives-v3.3-complete` ready to push on the 3.5 commit's SHA.

**Phase 3, sub-task 3.4 — Cost telemetry on the admin interactives page.** Shipped 2026-04-26 (commit `03c3d88`). Captured `cache_creation_input_tokens` + `cache_read_input_tokens` fields from the Anthropic API response at every Claude call site in InteractiveGenerator + InteractiveAuditor via a new shared `extractUsage()` helper at `agents/src/shared/usage.ts`. Threaded the four counters (input / output / cacheCreate / cacheRead) through both `runQuizLoop` + `runHtmlLoop` accumulators, both artefact result shapes, and the `logInteractiveGeneratorMetered` observer event's metrics + body. New "Cost (month-to-date · MMM YYYY)" section on `/dashboard/admin/interactives/`.

**Phase 3, sub-task 3.3 — Per-piece destructive interactive regenerate.** Shipped 2026-04-26 (commit `ddb5cdd`). New endpoint `POST /interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz|html>` on the agents worker; site-side proxy at `/api/agents/interactive-regenerate.ts` ADMIN_EMAIL-gated. Endpoint: resolves piece + target row, refuses HTML regen when `interactives_html_enabled=false` (400), deletes the file from GitHub via new `Publisher.deleteInteractiveFile()` (path-prefix-guarded to `content/interactives/`), wipes `interactive_audit_results` rows + the `interactives` row, clears `daily_pieces.interactive_id` on quiz regen, fires `interactive_regenerated` info-severity observer event with operator email + deleted slug, then schedules `generateInteractiveScheduled` on a 1s alarm for the fresh produce → audit → revise loop. Destructive steps run synchronously inside the trigger handler (operator sees the real error if wipe fails); fresh generation runs async in the alarm.

List view's per-row Regenerate button replaces the 3.2 placeholder cell. Confirm-dialog spells out exactly what gets wiped (file + D1 row + audit rows + interactive_id clear + scheduled alarm). On success, button stays disabled until reload to avoid a re-click race against the still-running alarm.

Slug-drift caveat documented: quiz-only regen MAY produce a different slug if Claude returns a different proposal from the same source. HTML-only regen never drifts (existingQuiz lookup pins slug). v2 enhancement is a `slugLock` parameter on `Generator.generate()`.

`pnpm build` clean. Agents typecheck +2 errors for new endpoint (same SDK-typing pattern as every other trigger). Local preview: 401 unauth on all four input shapes. End-to-end regen flow verifies post-deploy. See DECISIONS 2026-04-26 "Interactives v3 Phase 3.3 — destructive per-piece interactive regenerate".

**Phase 3, sub-task 3.2 — Admin list view at `/dashboard/admin/interactives/`.** Shipped 2026-04-26 (commit `3a30ec9`). New SSR Astro page (folder route). Stats row, type filter chips, per-row card with audit pills, sort by `quality_flag='low'` first.

**Phase 3, sub-task 3.1 — `interactives_html_enabled` toggle on admin settings page.** Shipped 2026-04-26 (commit `78f3431`). Toggle on `/dashboard/admin/settings/`; shared `writeSetting()` helper for any admin_settings key.

**Phase 3, sub-task 3.1 — `interactives_html_enabled` toggle on admin settings page.** Shipped 2026-04-26 (commit `78f3431`). Extended `/dashboard/admin/settings/` with a second `<section>` under the cadence dropdown — checkbox bound to the flag, "current value / last updated" stat row, save button, status line. API at `/api/dashboard/admin/settings` GET extended to return the flag, POST extended to dispatch on body shape (`{interval_hours}` vs `{interactives_html_enabled}`) with a shared `writeSetting()` helper that fires the same `admin_settings_changed` observer event for both keys. Storage stays canonical `'true' | 'false'` string; wire format is `boolean`. Default-closed posture preserved across all three readers (GET endpoint, page frontmatter, agents-side reader): any non-`'true'` value means disabled. RUNBOOK now leads with the admin UI flip path; `wrangler d1 execute` recipes kept as fallback.

**Phase 2, sub-task 2.7 (still pending) — Reference HTML hand-written + few-shot wired + content fixture deployed.**

Awaiting Zishan's review on prod + flag flip + tag.

- **`docs/examples/interactive-reference.html`** — hand-written canonical reference. 6.6 KB; passes the validator on all 8 rules. Teaches **chokepoints**: one slider compresses a chokepoint between three input lanes (always full) and three output lanes (track the chokepoint). Live caption changes with capacity range — "upstream supply" → "the chokepoint, just barely" → "the chokepoint" → "the chokepoint, severely". Mobile-respectable via single `@media` query that flips horizontal pipeline → vertical at 480px. Self-contained: inline CSS, inline JS, no external scripts. Picked chokepoints for the universally-teachable mechanism + clean tactile control + concrete pedagogy hook.
- **`agents/src/shared/interactive-html-reference.ts`** — Worker-readable mirror of the .html file. Cloudflare Workers can't readFileSync at runtime; the .ts string is what the prompt embeds. Sync rule: edit both files together.
- **`agents/src/interactive-generator-prompt.ts`** — added a **# Reference example** section to `INTERACTIVE_HTML_GENERATOR_PROMPT` between the Diversity-with-past-interactives section and the Response-format section. Embeds the reference inside a fenced code block, with explicit guidance on what to copy (shape, voice, pedagogy hooks, mobile, self-contained) vs. what NOT to copy (specific concept, specific colours, specific copy strings). Reference is part of the cached system prompt block.
- **System prompt size**: 12.4 KB → 20.4 KB (~5,100 tokens cached). One-time invalidation when Anthropic's prompt cache notices the prefix change; subsequent calls hit the new cache entry.
- **`content/interactives/chokepoints-and-cascades-html.json`** — committed fixture for prod review. Slug = `chokepoints-and-cascades` (shares with the existing Hormuz piece's quiz). `sourcePieceId` = the Hormuz piece's actual id (`9ded9bec-…`). After deploy, `/interactives/chokepoints-and-cascades/` on prod renders both quiz (existing) + html (new) — Zishan reviews the rendered pair. No D1 row written; the made.ts drawer endpoint queries D1 directly so the Hormuz piece's drawer still shows quiz-only (honest reflection of what's in D1; the route page rendering both is content-collection-driven).
- **What's still pending in 2.7**: (1) Zishan reviews on prod after CI deploys; (2) if accepted, flip `interactives_html_enabled = 'true'` via `wrangler d1 execute`; (3) tag `interactives-v3.2-complete` after the next published piece's Generator output validates the wiring end-to-end.

**Earlier completed sub-tasks (Phase 2):**

- `[phase-2.6]` Reader surface — `<interactive-frame>` Web Component + dual-artefact route + drawer.
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

**Phase 4 — Engagement signals into Learner.** The `interactive_engagement` table from migration 0022 is populated for quiz events but unread by any agent. Phase 4 extends the surface area: `<interactive-frame>` fires engagement events to the existing `/api/interactive/track` endpoint via postMessage from the sandboxed iframe (the sandbox allows postMessage to parent by default); per-interactive aggregates feed Learner's input as `source='producer'` learnings about which interactive shapes get used vs. skipped. AGENTS.md Learner section + INTERACTIVES.md updated alongside.

Phase 4 unblocks once today's HTML interactives have collected at least a few days of engagement data — the Learner aggregation needs real signal to write meaningful patterns. Tag at end: `interactives-v3.4-complete` + project milestone tag `interactives-v3-complete`.

**Pending in 2.7 — Zishan's review + flag flip + tag.** Parallel-safe with Phase 3 work. Three remaining steps after the `[phase-2.7]` commit lands:

1. **CI deploys.** `[phase-2.7]` push triggers GitHub Actions; both workers redeploy. The fixture at `/interactives/chokepoints-and-cascades/` will render on prod with quiz (existing) + html (new fixture) stacked.
2. **Zishan reviews on prod.** Open `https://zeemish.io/interactives/chokepoints-and-cascades/`. Verify: the slider works, the lanes/chokepoint shrink in lockstep, the caption changes across capacity ranges, mobile layout flips at 480px. If the reference teaches well and respects voice → continue. If it falls short → iterate the reference (edit `docs/examples/interactive-reference.html` + the `agents/src/shared/interactive-html-reference.ts` mirror in lockstep), commit, re-deploy, re-review.
3. **Flag flip + tag.** When the reference is approved:
   ```sh
   wrangler d1 execute zeemish --remote --command \
     "UPDATE admin_settings SET value = 'true' WHERE key = 'interactives_html_enabled'"
   ```
   The next post-publish alarm (next 12h cron firing at the configured cadence) produces both quiz + html for the new piece. After verifying that Generator output renders correctly on prod, tag `interactives-v3.2-complete`:
   ```sh
   git tag interactives-v3.2-complete <SHA-of-the-flag-flip-DECISIONS-commit>
   git push origin interactives-v3.2-complete
   ```

Phase 3 started 2026-04-26 in parallel with 2.7's review wait — sub-task 3.1 (admin toggle UI) is in. The eventual 2.7 flag flip is now a one-click action via the toggle instead of `wrangler d1 execute`.

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
| 2026-04-26 | 2 | 2.7 — Reference HTML hand-written + few-shot wired + content fixture deployed | `docs/examples/interactive-reference.html` (6.6 KB, validates clean on all 8 rules). `agents/src/shared/interactive-html-reference.ts` (Worker-readable mirror). Reference embedded as few-shot in cached HTML system prompt (12.4KB → 20.4KB ~ 5,100 tokens). Fixture `content/interactives/chokepoints-and-cascades-html.json` committed pointing at the Hormuz piece — `/interactives/chokepoints-and-cascades/` on prod will render both quiz + html stacked. **Awaiting Zishan's review on prod + flag flip + tag.** Flag still `'false'` until then. |
| 2026-04-26 | 3 | 3.1 — `interactives_html_enabled` toggle on admin settings page | New section under cadence dropdown at `/dashboard/admin/settings/`. API GET extended to return flag; POST extended to dispatch on body shape (`{interval_hours}` vs `{interactives_html_enabled}`) via shared `writeSetting()` helper. `admin_settings_changed` audit-trail event fires for both keys. Storage stays canonical `'true' \| 'false'` string; wire format is boolean. RUNBOOK leads with admin UI; wrangler recipes kept as fallback. Auth gating verified locally (page redirect + API 401); authenticated UI verifies post-deploy. Phase 2.7 flip is now a one-click admin action instead of `wrangler d1 execute`. |
| 2026-04-26 | 3 | 3.2 — Admin list view at `/dashboard/admin/interactives/` | New SSR folder-route page (~280 LOC). Stats row + soft "missing pieces" line; type filter chip bar mirroring the observer-feed severity-chip pattern. Per-row card: type pill, status badge, tier label, title link to public `/interactives/<slug>/`, source-piece headline link to admin per-piece deep-dive, voice score, 4 audit pills (latest round), revision count, published date. Sort: rough first then `published_at DESC`. Two D1 queries stitched in app code (interactives + headline join, then latest-round audits). Regen cell is a placeholder ("Regenerate: shipping in 3.3"). New nav-link "Interactives →" in admin home top-right block. Build clean; auth gating verified locally; authenticated UI verifies post-deploy. |
| 2026-04-26 | 3 | 3.3 — Per-piece destructive interactive regenerate | New endpoint `/interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz\|html>` + site proxy + Publisher.deleteInteractiveFile (path-prefix-guarded to content/interactives/) + Director.regenerateInteractive + observer.logInteractiveRegenerated. List view's placeholder cell replaced with working Regenerate button + confirm dialog enumerating the wipe steps. Synchronous wipe (operator sees real failure), async fresh generation via existing alarm path. HTML regen refused when flag is false (400). Slug-drift on quiz-only regen accepted as v1 known limitation; v2 fix is a `slugLock` parameter on Generator.generate. Build clean; agents typecheck +2 (SDK-typing); local preview 401 on all 4 input shapes. End-to-end regen verifies post-deploy. |
| 2026-04-26 | 3 | 3.4 — Cost telemetry on admin interactives page | New `agents/src/shared/usage.ts` `extractUsage()` helper. InteractiveGenerator + InteractiveAuditor both threaded with `cacheCreateTokens` + `cacheReadTokens` at every Claude call site; cumulative accumulators in `runQuizLoop` + `runHtmlLoop`; new fields on `QuizArtefactResult` + `HtmlArtefactResult`; observer event `logInteractiveGeneratorMetered` metrics shape + body summary extended with the 4-up token breakdown. Admin/interactives page gains "Cost (MTD · MMM YYYY)" section: 5-stat row (spend / runs / uncached input / cache write·read / output) with per-line costs computed at Sonnet 4.5 rates ($3/M input, $15/M output, cache write 1.25×, cache read 0.1×). Auto-footnotes when any event in the window pre-dates cache capture. Build clean; agents typecheck unchanged at 27 (server.ts SDK-typing only). Surface verifies post-deploy as today's runs populate cache fields in real events. |
| 2026-04-26 | 3 | 3.5 — Doc sync | INTERACTIVES.md gains an "Admin surfaces" section covering toggle/list-view/regenerate/cost-telemetry. AGENTS.md Generator + Auditor entries extended with HTML support, cache-token capture via `extractUsage`, and the destructive regenerate endpoint. RUNBOOK.md gains an "Interactives v3 — month-to-date cost" section pointing operators at the admin page and naming the rate-constant location for future Anthropic price changes. INTERACTIVES_STATUS.md marks Phase 3 complete; Phase 4 (engagement signals into Learner) named as next. Tag `interactives-v3.3-complete` ready to push. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
