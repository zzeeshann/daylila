# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/archive/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Project complete. All 5 phases (0 / 1 / 2 / 3 / 4) tagged on origin; project milestone tag `interactives-v3-complete` placed on the Phase 4 closeout commit.**

- Phase 0 — `interactives-v3.0-complete` (spec, rubric, validator rules, sandbox, decisions, book ch.9).
- Phase 1 — `interactives-v3.1-complete` (`interactives_html_enabled` flag, `interactives.quality_tier` column).
- Phase 2 — `interactives-v3.2-complete` on `347f10e` (machine-side 2.1–2.6 + reference HTML 2.7 + Zishan's prod review + flag flipped to `'true'`). The morning 02:00 UTC cron on 2026-04-26 produced the **first auto-generated HTML interactive ever** for the U.S. Mint piece (committed `d1e2e31` "Mixing and Traceability", clean pass; quiz `683cee9` "Identity Loss Through Transformation" shipped flagged-low). Live at `/interactives/identity-loss-through-transformation/`.
- Phase 3 — `interactives-v3.3-complete` on `332f932` (admin toggle, list view, destructive regenerate, MTD cost telemetry with cache-token capture, doc sync).
- Phase 4 — `interactives-v3.4-complete` (engagement signals into Learner). `<interactive-frame>` fires `interactive_viewed` via parent-level IntersectionObserver (once per session, threshold 0.5). `Learner.analysePiecePostPublish` reads an aggregated `interactive_engagement` rollup over the last 14 days (capped 20 rows, joined to `interactives`) into the post-publish prompt context. Producer learnings land with `source='producer'`, `category='engagement'`. Same SHA carries `interactives-v3-complete` as the project milestone tag.

**Next:** verification window for the four `[observing]` FOLLOWUPS entries that gate confidence in the v3 surface — 3.3 destructive regenerate end-to-end, 3.4 cost telemetry post-cache, Mint drawer dual-render, Phase 4 Learner output mentioning engagement. None block further work; they're observation tasks over the next 2–5 days as cron firings accumulate signal. After that, the next project starts from a fresh plan in `~/.claude/plans/`.

## Last completed sub-task

**Phase 4, sub-task 4.3 — Doc sync + tags.** Shipped 2026-04-26. AGENTS.md Learner section gains the engagement-aggregation extension paragraph (14-day window, `category='engagement'` mapping). INTERACTIVES.md gains a "Phase 4 — Engagement signals into Learner" section before "Reference: hand-built example" covering the IntersectionObserver firing rule, the new endpoint event type, the inline aggregation in Learner with the analytic-frame ratios (starts/views, completions/starts, avgScore), and what's NOT in this phase (no iframe-content changes, no quiz-card extension, no new alarm, no admin engagement view). SCHEMA.md `interactive_engagement.event_type` description gains `'viewed'` in the values list. CLAUDE.md "Currently working on" lead flipped to v3 complete + the four `[observing]` verification windows. Tags `interactives-v3.4-complete` + `interactives-v3-complete` placed on the same SHA (project milestone is the same point in history as the final phase tag).

**Phase 4, sub-task 4.2 — Learner reads `interactive_engagement` aggregates.** Shipped 2026-04-26 (commit `b05f57c`). `Learner.analysePiecePostPublish` gains a 4th D1 query reading aggregated engagement over the last 14 days (capped 20 rows, joined to `interactives` for slug/type/title/quality_flag/voice_score). Compact per-interactive rollup block inserted into prompt context between "Audit results" and "Pipeline timeline". `LEARNER_POST_PUBLISH_PROMPT` extended: new "You see:" bullet for engagement; new analytic-frame paragraph naming the meaningful ratios; new example learning under "Good producer-side learnings:" demonstrating the engagement→category mapping. Empty-engagement case renders `(no engagement data in window)`. agents typecheck unchanged at 27 (server.ts SDK-typing baseline). SQL preview against remote D1 confirms the rollup shape.

**Phase 4, sub-task 4.1 — `<interactive-frame>` IntersectionObserver + `viewed` event.** Shipped 2026-04-26 (commit `9b17b2c`). `<interactive-frame>` adds an `IntersectionObserver` (threshold 0.5, `rootMargin: '0px'`) in `connectedCallback` that fires `interactive_viewed` once per session per interactive, with a `sessionStorage` de-dup key (`zeemish-interactive-viewed:<id>`) matching the existing `<lesson-shell>` `interactive_offered` pattern. Observer disconnects after first fire and on `disconnectedCallback`. `/api/interactive/track` `VALID_EVENT_TYPES` set extended to accept `'viewed'`; doc-comment + 400 error message updated to list it. No migration (loose TEXT, no CHECK constraint per migration 0022 decision #2). Quiz-card untouched. Verified end-to-end in dev preview: fresh load fires 2 `started` + 1 `viewed`; re-mount with sessionStorage flag set fires zero events; build clean.

**Phase 3, sub-task 3.5 — Doc sync.** Shipped 2026-04-26. `docs/INTERACTIVES.md` gains an "Admin surfaces" section before "Reference: hand-built example" covering all four Phase 3 surfaces (toggle, list view, regenerate, cost telemetry) with cross-refs to RUNBOOK fallback recipes and AGENTS.md behaviour. `docs/AGENTS.md` Generator + Auditor entries extended with HTML-path support (Phase 2), cache-token capture via `extractUsage` (Phase 3.4), and the destructive regenerate endpoint (Phase 3.3). `docs/RUNBOOK.md` gains an "Interactives v3 — month-to-date cost" section pointing operators at `/dashboard/admin/interactives/` and naming where the rate constant lives if Anthropic changes pricing.

Phase 3 complete. Tag `interactives-v3.3-complete` ready to push on the 3.5 commit's SHA.

**Phase 3, sub-task 3.4 — Cost telemetry on the admin interactives page.** Shipped 2026-04-26 (commit `03c3d88`). Captured `cache_creation_input_tokens` + `cache_read_input_tokens` fields from the Anthropic API response at every Claude call site in InteractiveGenerator + InteractiveAuditor via a new shared `extractUsage()` helper at `agents/src/shared/usage.ts`. Threaded the four counters (input / output / cacheCreate / cacheRead) through both `runQuizLoop` + `runHtmlLoop` accumulators, both artefact result shapes, and the `logInteractiveGeneratorMetered` observer event's metrics + body. New "Cost (month-to-date · MMM YYYY)" section on `/dashboard/admin/interactives/`.

**Phase 3, sub-task 3.3 — Per-piece destructive interactive regenerate.** Shipped 2026-04-26 (commit `ddb5cdd`). New endpoint `POST /interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz|html>` on the agents worker; site-side proxy at `/api/agents/interactive-regenerate.ts` ADMIN_EMAIL-gated. Endpoint: resolves piece + target row, refuses HTML regen when `interactives_html_enabled=false` (400), deletes the file from GitHub via new `Publisher.deleteInteractiveFile()` (path-prefix-guarded to `content/interactives/`), wipes `interactive_audit_results` rows + the `interactives` row, clears `daily_pieces.interactive_id` on quiz regen, fires `interactive_regenerated` info-severity observer event with operator email + deleted slug, then schedules `generateInteractiveScheduled` on a 1s alarm for the fresh produce → audit → revise loop. Destructive steps run synchronously inside the trigger handler (operator sees the real error if wipe fails); fresh generation runs async in the alarm.

List view's per-row Regenerate button replaces the 3.2 placeholder cell. Confirm-dialog spells out exactly what gets wiped (file + D1 row + audit rows + interactive_id clear + scheduled alarm). On success, button stays disabled until reload to avoid a re-click race against the still-running alarm.

Slug-drift caveat documented: quiz-only regen MAY produce a different slug if Claude returns a different proposal from the same source. HTML-only regen never drifts (existingQuiz lookup pins slug). v2 enhancement is a `slugLock` parameter on `Generator.generate()`.

`pnpm build` clean. Agents typecheck +2 errors for new endpoint (same SDK-typing pattern as every other trigger). Local preview: 401 unauth on all four input shapes. End-to-end regen flow verifies post-deploy. See DECISIONS 2026-04-26 "Interactives v3 Phase 3.3 — destructive per-piece interactive regenerate".

**Phase 3, sub-task 3.2 — Admin list view at `/dashboard/admin/interactives/`.** Shipped 2026-04-26 (commit `3a30ec9`). New SSR Astro page (folder route). Stats row, type filter chips, per-row card with audit pills, sort by `quality_flag='low'` first.

**Phase 3, sub-task 3.1 — `interactives_html_enabled` toggle on admin settings page.** Shipped 2026-04-26 (commit `78f3431`). Extended `/dashboard/admin/settings/` with a second `<section>` under the cadence dropdown — checkbox bound to the flag, "current value / last updated" stat row, save button, status line. API at `/api/dashboard/admin/settings` GET extended to return the flag, POST extended to dispatch on body shape (`{interval_hours}` vs `{interactives_html_enabled}`) with a shared `writeSetting()` helper that fires the same `admin_settings_changed` observer event for both keys. Storage stays canonical `'true' | 'false'` string; wire format is `boolean`. Default-closed posture preserved across all three readers (GET endpoint, page frontmatter, agents-side reader): any non-`'true'` value means disabled. RUNBOOK now leads with the admin UI flip path; `wrangler d1 execute` recipes kept as fallback.

**Phase 2, sub-task 2.7 — Reference HTML hand-written + few-shot wired + content fixture deployed. SHIPPED + flag flipped + tagged.**

- **`docs/examples/interactive-reference.html`** — hand-written canonical reference. 6.6 KB; passes the validator on all 8 rules. Teaches **chokepoints**.
- **`agents/src/shared/generated/contracts.ts`** — codegenned from the canonical above (and from `content/voice-contract.md`); exports `INTERACTIVE_HTML_REFERENCE`. Was a hand-maintained mirror until 2026-05-03; replaced by `agents/scripts/codegen-contracts.mjs` in Foundation Fix Task 02 Phase A.
- **`agents/src/interactive-generator-prompt.ts`** — `# Reference example` section embedded inside `INTERACTIVE_HTML_GENERATOR_PROMPT`'s cached block. System prompt size: 12.4 KB → 20.4 KB (~5,100 tokens cached).
- **`content/interactives/chokepoints-and-cascades-html.json`** — committed fixture; rendered the Hormuz quiz + chokepoints HTML stacked on prod for Zishan's review.
- Zishan's prod review accepted the reference. Flag flipped to `'true'` via `wrangler d1 execute`. Tag `interactives-v3.2-complete` placed on `347f10e`. The morning 02:00 UTC cron on 2026-04-26 produced the first auto-generated HTML interactive (Mint piece's "Mixing and Traceability", clean pass).

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
- `docs/archive/INTERACTIVES_PLAN_NOTES.md` got one Phase 1 entry recording the row-count drift (status said 2; prod had 3 because the firing-squads piece's interactive shipped flagged-low between v3 commissioning and Phase 1).

Tag `interactives-v3.1-complete` (set at commit time).

## Next sub-task

**None — project complete.** The next session starts from a fresh plan in `~/.claude/plans/`. Four `[observing]` FOLLOWUPS entries (3.3 destructive regen, 3.4 cost telemetry post-cache, Mint drawer dual-render, Phase 4 Learner output) carry the verification window over the next 2–5 days; each has its own unblock condition.

Phase 4 was the architectural decision Phase 4.1 actually made (parent IntersectionObserver, not iframe-content postMessage). The deferred postMessage protocol is recorded as v2 work in `INTERACTIVES.md`'s Phase 4 section if the manipulation signal ever becomes worth designing.

**Definition of done for Phase 4** (✅ all met as of 2026-04-26): `<interactive-frame>` fires `interactive_viewed`; Learner reads aggregated engagement and is positioned to mention it in the next post-publish run; AGENTS.md + INTERACTIVES.md + SCHEMA.md + CLAUDE.md all reflect the closed loop; tag `interactives-v3.4-complete` + project milestone `interactives-v3-complete` placed.

**Definition of done for Phase 2** (✅ all met as of 2026-04-26): flag = true, next published piece produces both quiz and HTML interactive, drawer shows both, tag `interactives-v3.2-complete` pushed.

## Blockers

None.

## Plan vs repo notes

Two entries in `docs/archive/INTERACTIVES_PLAN_NOTES.md`:
- 2026-04-26 Phase 0 — book chapter filename was already renamed to `09-the-sixteen-roles.md` on 2026-04-24 (commit `41edf46`); FOLLOWUPS book-rename entry skipped because the rename is already done.
- 2026-04-26 Phase 1 — `quality_flag='low'` row count was 3 not 2 (third row was the firing-squads piece's interactive, shipped same-day as v3 was commissioned). Backfill was set-shaped (`WHERE quality_flag='low'`) so it covered all 3 without code change.

## Live state

- `interactives_html_enabled = 'true'`: HTML path live since Phase 2.7 (2026-04-26). Both `<quiz-card>` and `<interactive-frame>` ship per piece when the auto-cron fires.
- `interactives` table: exists (migration 0022 + 0025 + 0026). Quiz + HTML paths both live.
- `interactive_engagement` table: exists (migration 0022). Populated for quizzes since Area 4; HTML interactives gain `interactive_viewed` events via the parent-level IntersectionObserver shipped in Phase 4.1.
- `interactive_audit_results` table: exists (migration 0023). Per-round per-dimension audit notes for both quiz and HTML.
- `InteractiveGenerator` (#15) + `InteractiveAuditor` (#16): producing quizzes + HTML interactives in parallel loops with prompt caching on the system prompt.
- `LearnerAgent` (#12): `analysePiecePostPublish` reads aggregated `interactive_engagement` over the last 14 days (Phase 4.2) and writes `category='engagement'` learnings on the next daily piece's post-publish run.
- Site: 8+ quizzes published, 2 HTML interactives shipped (Mint "Mixing and Traceability" + Chernobyl "Generational Cycling Under Damage"). `/interactives/<slug>/` route serves both stacked when present.

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
| 2026-04-26 | 4 | 4.1 — `<interactive-frame>` IntersectionObserver + `viewed` event; 4.2 — Learner reads `interactive_engagement` aggregates; 4.3 — Doc sync + tags | Three commits. 4.1 (`9b17b2c`) wires parent-level IntersectionObserver firing `interactive_viewed` once per session per interactive (sessionStorage de-dup, threshold 0.5); endpoint `VALID_EVENT_TYPES` extended; verified end-to-end in dev preview (3 POSTs on fresh load — 2 started + 1 viewed; zero on re-mount with flag set). 4.2 (`b05f57c`) extends `Learner.analysePiecePostPublish` with a 4th D1 query (14-day window, 20-row cap) and a per-interactive rollup block in the prompt context; `LEARNER_POST_PUBLISH_PROMPT` extended with engagement bullet, analytic-frame ratios, and a new example learning. 4.3 doc sync + tag push. agents typecheck unchanged at 27. Phase 4 + project complete. Tags `interactives-v3.4-complete` + `interactives-v3-complete` placed on the 4.3 SHA. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | `cbfb8bf` |
| `interactives-v3.1-complete` | 2026-04-26 | `f01dac1` |
| `interactives-v3.2-complete` | 2026-04-26 | `347f10e` |
| `interactives-v3.3-complete` | 2026-04-26 | `332f932` |
| `interactives-v3.4-complete` | 2026-04-26 | (4.3 commit SHA — set on push) |
| `interactives-v3-complete` | 2026-04-26 | (4.3 commit SHA — project milestone, same point in history) |
