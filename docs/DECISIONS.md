# Zeemish v2 — Decision Log

Append-only. Never edit old entries.

## 2026-04-30 (PM, late): Symmetric slug-pairing for quiz + html

**Context.** The 2026-04-30 sperm-cell piece (`sourcePieceId 5d0918d4-9800-45b1-9e96-17b181a1c3fb`) shipped quiz + html on **two** different URLs:

- `/interactives/detection-floor-as-resource-choice/` — html only (committed first by auto-cron at 14:07 UTC)
- `/interactives/detection-floors-and-invisible-presence/` — quiz only (committed by manual retry 49 min later at 14:56 UTC)

Every prior dual-artefact piece (`control-creates-duty`, `adding-requirements-through-practice`, `embedded-continuation`, etc.) shares one slug between the two artefacts and renders both inline at one URL via `bundleFromEntries`. The sperm piece broke that contract — readers landing on either URL saw only half the bundle, and the daily-piece embed link points to only one of them.

**Root cause.** Slug-inheritance was **asymmetric**:
- [interactive-generator.ts:1083-1092](../agents/src/interactive-generator.ts:1083) — `runHtmlLoop` queried `interactives WHERE source_piece_id = ? AND type = 'quiz'` and inherited the quiz's slug if found.
- [interactive-generator.ts:706](../agents/src/interactive-generator.ts:706) — `runQuizLoop` had **no symmetric lookup**. It just called `resolveFreeSlug` on Claude's proposed slug.

The asymmetry was invisible while quiz always shipped first — pre-`c687601`, a quiz parse-failure aborted the html loop, so html always saw a committed quiz row. The morning's `c687601` decoupling fix wrapped quiz/html in independent try/catch (a correct fix on its own terms), which surfaced the latent asymmetry: html could now ship while quiz kept parse-failing. When the operator manually retried quiz later, `runQuizLoop` accepted Claude's freshly-proposed slug verbatim. Migration 0026 had already relaxed the schema to `UNIQUE(slug, type)` so siblings CAN share a slug — only the writer-side inheritance was missing.

**Decision.** Two-part fix:

1. **Forward fix — symmetric `resolvePairSlug` helper.** Extract a private method that queries for the sibling artefact (whichever type isn't the one we're committing) and returns its slug if found, falling back to `resolveFreeSlug(claudeProposed, type)` otherwise. Both `runQuizLoop` (line 706) and `runHtmlLoop` (the inlined block at 1083-1092) now call it. Whichever artefact ships SECOND inherits the FIRST's slug regardless of order.
2. **Backfill.** Renamed `content/interactives/detection-floor-as-resource-choice-html.json` → `detection-floors-and-invisible-presence-html.json` (matching the `<slug>-html.json` convention used by every other paired file), edited the JSON's `slug` field to match the quiz, and queued D1 surgery (`UPDATE interactives SET slug = 'detection-floors-and-invisible-presence' WHERE id = '9f53032c-1d1a-46dd-973b-658cd3acfa67' AND type = 'html';`). Schema-safe under migration 0026's composite unique. Title + concept + content unchanged — slug is identity/routing metadata under the carve-out, same precedent as the orphan-category D1 cleanup (2026-04-29).

**Trade-offs considered.**
- **Why not also tell Claude to inherit the sibling's slug in the produce-html / produce-quiz prompts?** Would save tokens (Claude doesn't waste effort proposing a slug that gets discarded), but it's a prompt change with broader blast radius and the resolver-side fix is sufficient. Forward-only.
- **Why not bundle by `source_piece_id` in the route's `getStaticPaths` and let divergent slugs unify under the quiz's URL?** Treats the symptom; doesn't prevent file-system bifurcation (two `*.json` files at different slugs still build two pages); doesn't address SEO duplication. The slug-pairing fix is more correct and not significantly more complex.
- **Why rename the html file (not the quiz)?** Quiz is the dominant artefact in `bundleFromEntries`'s `primary` resolution. Quiz's slug `detection-floors-and-invisible-presence` is also more abstract/durable as a URL. The HTML's `<slug>-html.json` filename convention then composes correctly.
- **Permanence-rule check.** Slug is identity, not body content. Title, concept, HTML body, and quiz questions are all preserved unchanged. Same carve-out as `voiceScore` / `audioBeats` / `qualityFlag` frontmatter splices. Reader-visible URL changes (one URL retired, one URL gains the missing artefact); this is a healing edit, not content revision.

**Files.**
- [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts) — added `resolvePairSlug` (~line 1487), swapped two call sites (lines 706 + 1083), updated `runHtmlLoop` doc comment around line 822 to name the symmetric pairing.
- [content/interactives/detection-floors-and-invisible-presence-html.json](../content/interactives/detection-floors-and-invisible-presence-html.json) — renamed from `…-floor-as-resource-choice-html.json`; `slug` field updated.
- [agents/scripts/verify-pair-slug.mjs](../agents/scripts/verify-pair-slug.mjs) — new verifier, 5 cases (quiz-first, html-first, quiz-only, html-only, divergent-Claude-proposal-discarded). Runs as `pnpm verify-pair-slug`. Same convention as `verify-parse-retry` / `verify-categoriser-floor` / `verify-interactive-voice` — JS heuristic kept in sync with `interactive-generator.ts:resolvePairSlug` by hand.
- [agents/package.json](../agents/package.json) — script entry.
- D1 remote: `UPDATE interactives` (executed manually by operator; wrangler not authenticated in the implementation shell).

**Verification.**
- `pnpm verify-pair-slug` 5/5 pass.
- `pnpm verify-parse-retry` 4/4, `pnpm verify-categoriser-floor` 10/10, `pnpm verify-interactive-voice` 10/10 still pass.
- `pnpm build` site-side clean across all 23 daily pieces; interactive page count drops from 19 to 18 (sperm piece now paired).
- Dev preview `/interactives/detection-floors-and-invisible-presence/` renders quiz card + HTML iframe inline; `/interactives/detection-floor-as-resource-choice/` 404s; daily-piece embed unchanged.
- Agents typecheck baseline unchanged (26 pre-existing `server.ts` SubAgent errors; touched file compiles clean).

**Forward.** New FOLLOWUPS `[observing]` entry tracks future quiz-first / html-first ordering. Surfaced via the existing `Interactive(s) shipped` observer event title — `(quiz)` and `(html)` suffixes already land per artefact (`c687601` work). No new instrumentation.

## 2026-04-30 (evening): SEO snippet fix + structured-data expansion

**Context.** Operator's Google search for "zeemish" surfaced the homepage with the SERP snippet *"Educate yourself for humble decisions. Made by 16 agents. © 2026 Zeemish."* — the footer text, not a meaningful description. Diagnosis: [src/pages/index.astro:35](../src/pages/index.astro:35) passed the literal tagline as the homepage description, AND [src/layouts/BaseLayout.astro:162](../src/layouts/BaseLayout.astro:162) renders the same string verbatim in the footer. Google deduplicates the meta description against on-page text and falls back to the most prominent stable content — the footer wins. The "Made by 16 agents" line in Google's cached snippet is from before commit `6779115` (2026-04-29 late-late evening drop of the "Made by N agents" footer line) — Google hadn't re-crawled yet, but the same problem persists either way.

The 2026-04-25 SEO foundations pass (`v1.3.0`) shipped sitemap + RSS + robots + 1200×630 PNG og:image + JSON-LD Article on daily pieces + always-render meta description + canonical URL + GSC submission with 31 pages discovered. Audit confirmed those are solid. Plan `~/.claude/plans/zeemish-seo-we-did-moonlit-floyd.md`.

**Decision.** Six small additive changes, single commit. No schema, no agent prompts, no migrations. Display-layer + meta-tag work only.

1. **Homepage description differentiated** — `src/pages/index.astro:35` now passes ~142 chars naming the news anchor + system-thinking framing. Distinct from the footer.
2. **Footer marked `data-nosnippet`** — Google-supported HTML attribute on the `<footer>` element; reader sees the footer, search engines skip it for snippet extraction.
3. **og:image:width / og:image:height / og:image:alt** — declared so Twitter + LinkedIn render previews without a HEAD round-trip on the PNG.
4. **BreadcrumbList JSON-LD on daily pieces** — second `<script type="application/ld+json">` alongside the existing Article schema. Self-gates on the same `article` prop. Helper `escapeForScript` extracted for the shared `<` injection defense.
5. **LearningResource JSON-LD on interactives** — new `learningResource` prop on BaseLayout (parallel to `article`'s self-gating). `interactives/[slug].astro` passes `resourceType: quizEntry ? 'Quiz' : 'Interactive simulation'`. Quiz-specific `acceptedAnswer` markup deferred — LearningResource is the right granularity for v1 across both artefact types.
6. **Library index description dynamic** — names the top 4 categories by piece_count (already sorted by `getCategories()`), keeps the description keyword-relevant as the taxonomy grows. Falls back to a generic line on empty-library.

**Trade-offs considered.**

- **Why not just longer copy in the homepage description?** Necessary but not sufficient. Even with a longer description, Google's snippet algorithm can still pick footer text if it's the most consistent on-page signal. `data-nosnippet` plus a distinctive description is the durable fix — the description gives Google something better; nosnippet tells it not to fall back to the footer.
- **Why `LearningResource` not `Quiz` schema?** `Quiz` requires per-question `acceptedAnswer` markup that materially expands the prompt's output schema and the page render; the lift in actual Google rich-results for educational quiz content is unclear. `LearningResource` covers both quiz + html widgets at the same granularity with a fraction of the code. Quiz schema can layer on later if a real signal emerges.
- **Why not concept-based slugs in this commit?** Already explicit `[wontfix]` per FOLLOWUPS — Drafter prompt change with backwards-compat implications, deferred to 50+ pieces (currently 22 over 13 days). Right call to keep the SEO surgical fix separate.
- **Why not 301 redirects for old date-only URLs?** Already explicit `[wontfix]` per FOLLOWUPS; the legacy `[date]/index.astro` handler mitigates the case. Reopen if Search Console shows incoming hits on the old shape.
- **Why dynamic library description and not hardcoded category names?** Hardcoded copy goes stale every time the taxonomy changes. Sourcing from `categories.slice(0, 4).map(c => c.name)` (already in scope, already sorted by piece_count DESC) keeps the description accurate as the taxonomy grows.
- **Why `escapeForScript` helper extracted now?** Three JSON-LD blocks instead of one — the existing inline `.replace(/</g, '\\u003c')` in the Article block was already fine, but copying it twice would risk drift if the escape rule ever needs to change. Extracted to a single function called by all three.

**What stayed unchanged.** Sitemap, RSS, robots.txt, PNG og:image, the existing Article JSON-LD shape, canonical URL emission, the 2026-04-25 GSC submission. Daily-piece description fields in MDX frontmatter (audited via Drafter + Voice Auditor) untouched — they're already well-shaped.

**Files.**
- [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro) — `learningResource` prop, three JSON-LD blocks, `escapeForScript` helper, og:image dimensions + alt, footer `data-nosnippet`.
- [src/pages/index.astro](../src/pages/index.astro) — homepage description.
- [src/pages/interactives/[slug].astro](../src/pages/interactives/[slug].astro) — pass `learningResource` to BaseLayout.
- [src/pages/library/index.astro](../src/pages/library/index.astro) — dynamic `libraryDescription`.

**Verification.**
- `pnpm build` clean.
- Dev preview against the homepage + a daily piece + an interactive: `<meta name="description">` carries new homepage copy; footer has `data-nosnippet`; daily-piece head emits two ld+json blocks (Article + BreadcrumbList); interactive head emits one ld+json block (LearningResource); every page emits og:image:width/height/alt.
- Post-deploy: Google Rich Results Test (https://search.google.com/test/rich-results) on a live daily-piece URL — expect Article + BreadcrumbList valid; on a live interactive URL — expect LearningResource valid. Schema.org validator (https://validator.schema.org/) — expect 0 errors on both.
- Forward observation in Google Search Console (1–2 weeks): homepage SERP snippet should switch from footer text to the new meta description after next crawl.

**Forward.** New FOLLOWUPS `[observing]` entry tracks the SERP snippet flip. Larger projects (concept slugs, per-piece dynamic OG, related-pieces section, trailingSlash enforcement) remain in their existing FOLLOWUPS state — none promoted by this work.

## 2026-04-30 (PM): Manual interactive-retry routes through alarm path; quiz/html decoupled in generate()

**Context.** The morning's loop-counted parse-retry + assistant-prefill `{` work (entry below) shipped, but the operator's regenerate of the Voting Rights Act piece exposed two bugs the morning fix didn't address:

1. **Click 1 (10:50:38 UTC) hit "3 parse-fails in a row"** — exactly the case Layer 1 was supposed to handle, but the message said "across all 3 rounds" (terminal exhaustion), not "retried successfully".
2. **Click 2 (~10:51 UTC) committed the quiz at 10:52:12 UTC, but the HTML never landed** — and there was no observer event for the HTML path at all. No metered, no failure, nothing.

Three diagnostics narrowed the root cause:

- **Empirical SDK test against the real Anthropic API** ([scripts/prefill-test.mjs](../agents/scripts/prefill-test.mjs), since removed): the SDK does NOT echo the prefilled `{` in `response.content[0].text`. So `'{' + continuation` produces correct JSON. Layer 2 prefill is implementation-correct.
- **Production-shape reproduction against the actual Voting Rights piece** ([scripts/repro-quiz-call.mjs](../agents/scripts/repro-quiz-call.mjs), since removed): 3 successive Claude calls all returned valid JSON; latency 25-29s each. So the model ISN'T flaking the way the production failure suggested.
- **Cross-piece D1 audit:** every other piece since 2026-04-26 (the day HTML interactives launched) has both `quiz` and `html` rows. Voting Rights is the only exception — and the only one whose interactive went through the manual retry path instead of the auto-cron path.

The structural difference between paths:

| Path | Trigger shape | Wall-clock budget |
|---|---|---|
| Auto-cron post-publish | `this.schedule(1, 'generateInteractiveScheduled', ...)` from `triggerDailyPiece` | Full **15-minute alarm budget** |
| Destructive regenerate | `this.schedule(1, 'generateInteractiveScheduled', ...)` from `regenerateInteractive` | Full **15-minute alarm budget** |
| **Manual retry (Generate button)** | `ctx.waitUntil(director.generateInteractiveScheduled(...))` from HTTP handler | **HTTP request lifetime** (CF Workers subrequest budget) |

The manual retry path ran the entire produce → audit → revise → publish chain inside the HTTP handler's worker context. A 3-round quiz auditor max-fail loop alone takes ~120 seconds (3 × ~30s/round + audit + commit). HTML adds another ~90+ seconds. Together that exceeds the subrequest budget; the worker terminates mid-flight, leaving partial Claude responses (which Layer 1 honestly counts as parse-fails — the SDK gives back truncated content) and skipping the HTML path entirely.

**Decision.** Two structural fixes, both in this commit.

- **Fix A — Manual retry routes through alarm path.** New thin Director method [`requestInteractiveGenerate(payload)`](../agents/src/director.ts) that calls `this.schedule(1, 'generateInteractiveScheduled', payload)` and returns immediately. Server endpoint [`/interactive-generate-trigger`](../agents/src/server.ts) now `await director.requestInteractiveGenerate(payload)` and returns a 202. The work fires inside a fresh alarm with full 15-minute budget, matching the auto-cron and destructive-regenerate paths. Returns `status: 'scheduled'` instead of `'started'`.

- **Fix B — Quiz/html decoupled in `generate()`.** Each loop is now wrapped in try/catch. On catch, a stub result is built with the failure reason captured in a new `errorMessage: string | null` field on both [`QuizArtefactResult`](../agents/src/interactive-generator.ts) and [`HtmlArtefactResult`](../agents/src/interactive-generator.ts). HTML path runs whether or not quiz threw. Director's `generateInteractiveScheduled` checks `result.{quiz,html}.errorMessage` and emits per-artefact `logInteractiveGeneratorFailure` events with `(quiz)` / `(html)` suffixes on the title — operators see exactly which artefact failed instead of one ambiguous warn that hides the path that ran. The outer Director catch is preserved for catastrophic infra throws (DB read failure, missing piece, etc.).

**What stayed unchanged.** Layer 1 loop-counted parse-retry, Layer 2 prefill, the 3-round budget, the `extractJson` fallback chain, all observer-event helpers, the destructive regenerate path, the auto-cron post-publish path. The morning's hardening was correct in design — these PM fixes address structural coupling between the manual retry path and the budget model that the morning's diagnosis missed.

**Trade-offs.**

- **Manual retry now returns 202 immediately instead of waiting on the full chain.** The operator sees "scheduled" and the work runs in the background. The admin UI's auto-reload after 120s (existing behaviour) still picks up the result. Observability is unchanged — same observer events fire, just from the alarm context.
- **`generate()` no longer throws for loop-level failures.** Previously a 3-round parse-exhaustion in quiz aborted everything. Now it captures and continues. The behaviour change is observable as: pieces with transient quiz issues will now still get HTML (and vice versa). The trade-off is that a piece can be in a "quiz failed but html shipped" state, which the admin UI handles correctly (per-row state with retry button per type).
- **Full 15-min budget on the manual retry path means an operator click could in principle run for up to 15 minutes if all 3 quiz rounds × 30s + 3 HTML rounds × 60s + audits stack up.** That's the worst case; typical is 60-180 seconds total. No CPU charge difference (alarm budget is wall-clock not CPU).

**Files.**
- [agents/src/director.ts](../agents/src/director.ts) — new `requestInteractiveGenerate` method; per-artefact failure event emission in `generateInteractiveScheduled`.
- [agents/src/server.ts](../agents/src/server.ts) — `/interactive-generate-trigger` calls the new scheduler.
- [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts) — `errorMessage` field on both result interfaces (8 sites threaded); `generate()` wraps quiz + html loops in try/catch with stub-on-failure.

**Verification.**
- All 7 verifiers pass clean (`verify-parse-retry` 4/4, `verify-categoriser-floor` 10/10, `verify-interactive-voice` 10/10, `verify-splice` 4/4, `verify-normalize` 20/20, `verify-validator` 28/28, `verify-dedup` 13/13).
- Agents-side `npx tsc --noEmit` — 26 pre-existing `server.ts` SubAgent errors (down 1 from baseline because the morning's `ctx.waitUntil(...).catch(...)` was removed). Touched files compile clean.
- Site-side `pnpm build` clean.
- Cross-piece D1 audit pre-fix confirmed every auto-cron piece has both quiz + html; only the manually-retried piece was missing html. The fix routes manual retry through the same path that's been working for auto-cron all along.

**Forward.** Operator clicks **Generate HTML** on the Voting Rights piece (`/dashboard/admin/piece/2026-04-30/supreme-court-limits-key-provision-of-the-landmark-voting-/`). The trigger schedules an alarm; the alarm fires within ~1 second; HTML loop runs with full budget. Expected: HTML interactive ships, observer feed shows metered event, admin UI updates from "not generated" to "published ✓".

## 2026-04-30: Loop-counted parse-retry + assistant-prefill `{` for InteractiveGenerator

**Context.** 2026-04-30 02:04 UTC, Voting Rights Act piece's quiz interactive failed with `parseAndValidate: Claude returned non-JSON output` — the second occurrence in 3 days of the same bug class (2026-04-27 Ben Sasse piece hit the HTML-path equivalent). Pre-fix: `parseAndValidate`/`parseAndValidateHtml` threw on the first non-JSON response; throw exited the produce → audit → revise loop on round 1, abandoning the entire generation, forcing operator manual retry. The 2026-04-27 FOLLOWUPS observing entry had named the fix in advance: *"if it recurs, escalate to `[open]` and harden `runHtmlLoop` to convert the throw into a counted failed-round"*. Recurrence inside the 7-cron window triggered the unblock.

**Decision.** Two-layer hardening, single commit, scoped to three files.

- **Layer 1 — Loop-counted retry.** [`runQuizLoop`](../agents/src/interactive-generator.ts) and [`runHtmlLoop`](../agents/src/interactive-generator.ts) wrap their produce/revise calls in `try/catch`. On a `'Claude returned non-JSON output'` message-prefix match, the catch pushes `{round}` to a new `parseFailures` array and `continue`s to the next iteration within the existing 3-round budget. The 3-round semantic is preserved: if all 3 parse-fail, the loop throws a terminal parse-fail message that Director routes to `logInteractiveGeneratorFailure` (same operator-retry posture as before, just earned across the full budget). Other parse errors (empty slug, missing fields, html-must-start-with-DOCTYPE) stay fatal — they're validator-shape rejections, not transient model flakes. The revise path's null-`lastQuiz`/`lastHtml` guard now falls back to the initial produce path on parse-fail recovery rather than throwing — there's nothing to revise after a parse-fail, so the next round is functionally a fresh attempt.

- **Layer 2 — Assistant-prefill `{`.** All 4 Claude calls (`produceQuiz`, `reviseQuiz`, `produceHtml`, `reviseHtml`) now append `{ role: 'assistant', content: '{' }` as the final message. The Anthropic API treats this as a forced response prefix — Claude must continue from `{`, strongly biasing against preamble + markdown fences. The continuation in `response.content[0].text` excludes the prefilled `{`, so `'{' + continuation` is reassembled before parsing. Documented Anthropic technique; closest equivalent to OpenAI-style `response_format: json_object`.

- **New observer helper.** [`logInteractiveGeneratorParseFail`](../agents/src/observer.ts) (severity `info`) emitted by Director's `generateInteractiveScheduled` per `parseFailures` entry on the result. Operators see `Interactive generation parse retry: <title>` info events alongside the existing `logInteractiveGeneratorMetered` terminal write — recovery is visible without firing as `warn`.

- **Both result types gain `parseFailures: Array<{round: number}>`.** Empty array on the happy path; populated when Layer 1 fires.

**Why not other options.** (1) Tighten `extractJson` further — the parser already has 3 fallback passes (strip fences, whole parse, first-`{`-to-last-`}`); the bug is at the model output layer, not the parser. (2) More prompt repetition — the prompt already says "No prose outside the object. No markdown fences." twice; Layer 2 enforces the same goal at the API contract. (3) Anthropic JSON mode — not available; prefill is the documented equivalent. (4) Per-round prompt feedback ("your previous response was non-JSON; here it was: …") — marginal gain on top of Layer 2 at the cost of leaking malformed model output back into context. Skipped.

**Trade-offs.** (1) **Token accounting on parse-fail rounds is lost.** When a parse throws, `produceQuiz`/`produceHtml` exits before returning usage to the caller; the loop's catch can't read it. ~3K tokens per parse-fail round; at the observed flake rate (2 incidents in ~50 cron runs) this is ~10K tokens/year of unaccounted spend. Acceptable. Refactoring the produce functions to return `{rawText, usage}` and parse in the loop would fix this but is a bigger change for marginal benefit. (2) **Prefill assumes Anthropic returns only the continuation in `content[0].text`, not the prefilled `{`.** Documented behaviour. If a future SDK update echoes the prefill, `'{' + continuation` would produce `{{...}}` and parse-fail — but Layer 1 would then catch it and retry, making this self-healing. (3) **3-round parse-fail exhaustion still requires operator manual retry.** Same as today's single-strike fatal, just rarer. The 2026-04-27 + 2026-04-30 evidence is that one retry cures these flakes 100% of the time, so 3-round exhaustion would be lottery-ticket-bad — the existing budget shape encodes this correctly.

**Files.**
- [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts) — `parseFailures` field added to both result interfaces (8 return sites threaded); both loops gain try/catch + parseFailures bookkeeping; null-lastQuiz/lastHtml guards on revise path now fall back to produce; 3-round parse-fail exhaustion guards added before the lastQuiz-null and validator-max-failed branches; all 4 Claude calls gain the prefill + reassembly.
- [agents/src/observer.ts](../agents/src/observer.ts) — new `logInteractiveGeneratorParseFail(date, title, type, round, pieceId)` helper.
- [agents/src/director.ts](../agents/src/director.ts) — `generateInteractiveScheduled` emits one breadcrumb per `parseFailures` entry on the quiz + html results after the metered write.
- [agents/scripts/verify-parse-retry.mjs](../agents/scripts/verify-parse-retry.mjs) — new synthetic verifier (4 cases: round 1 parse-fail → round 2 success, rounds 1+2 parse-fail → round 3 success, all 3 parse-fail → terminal throw, no parse-fails → committed). All pass.
- [agents/package.json](../agents/package.json) — `verify-parse-retry` script.

**Verification.** `pnpm verify-parse-retry` 4/4 pass. Agents-side `npx tsc --noEmit` — 27 pre-existing `server.ts` SubAgent errors unchanged, touched files compile clean. Site-side `pnpm build` clean. Other verifiers (`verify-splice` 4/4, `verify-normalize` 20/20, `verify-validator` 28/28, `verify-dedup` 13/13, `verify-categoriser-floor` 10/10, `verify-interactive-voice` 10/10) all pass — no regression.

**Forward.** Operator can regenerate the 2026-04-30 Voting Rights Act piece's missing quiz from admin (`/dashboard/admin/piece/2026-04-30/supreme-court-limits-key-provision-of-the-landmark-voting-/` → click **Generate** on the quiz row). FOLLOWUPS observation window: monitor next 5 cron firings (≈2026-05-03 02:00 UTC) for any `Interactive generation parse retry` info events AND any `Interactive generation failed: ... parseAnd*` warn events. Expected: zero terminal failures; ≤1 parse-retry breadcrumb across 5 runs.

## 2026-04-29: Three small UI changes — footer line dropped, source link added, drawer trigger moved to top

**Trigger:** Three reader-facing tweaks on the daily piece page, requested in one operator message. (1) Footer's `Made by 16 agents.` line clutters every page site-wide. (2) Every piece is built off a real news story but readers had no way to reach the original article. (3) The `ⓘ How this was made` trigger sat at the bottom of the piece — a reader curious about provenance had to scroll past the entire piece + interactive + finish state.

**Decision:** Display-layer only. No agents-side runtime change to the produce/audit/publish loop. One additive optional field on the content collection (`sourceUrl`), one new metadata splice in Director (mirrors `publishedAt` / `pieceId` / `qualityFlag` shape), three layout edits.

**Where source URL lives — splice at publish, not query at render.** [agents/src/scanner.ts:132](../agents/src/scanner.ts:132) captures `url` from RSS feeds into `daily_candidates.url`; from there it dead-ended pre-this-change — `daily_pieces` has no URL column, `DailyPieceBrief` has no `url` field, MDX frontmatter never carried it. The candidate row is reliably resolvable post-2026-04-22 (Curator `selectedCandidateId` fix in [`6999c5e`](https://github.com/zzeeshann/zeemish-v2/commit/6999c5e)); pre-2026-04-22 pieces have `selected=0` across the board and no `piece_id` linkage on `daily_candidates` rows, making URL recovery for those pieces unreliable. Two paths considered:

- **Render-time D1 query in `getStaticPaths`** — flips daily piece pages to a build-time D1 dependency. Each build would need to query `daily_candidates` for every piece, ~22 reads today. Adds a build-time D1 dependency for a value that doesn't change after publish.
- **Splice into MDX frontmatter at publish time (chosen).** Mirrors the existing `publishedAt` / `pieceId` / `qualityFlag` splice block at [agents/src/director.ts:402-418](../agents/src/director.ts:402). One D1 read on the publish path, value persists with the piece, zero build-time cost. Permanence rule remains clean — the metadata carve-out (DECISIONS 2026-04-19 "beatTitles frontmatter map for display-layer fixes") explicitly allows frontmatter additions without touching the body.

The splice block is wrapped in `try/catch` and skips silently when the candidate row has no URL or when the SELECT throws. Same fail-quiet shape as the existing `publishedAt` / `pieceId` splices — a metadata read isn't allowed to block a publish.

**Schema is `z.string().url().optional()`** — `url()` rejects malformed values at content-collection load time (defensive guard against splice corruption); `optional()` keeps existing 22 MDX files (none have `sourceUrl`) building cleanly. Reader path renders the link only when `sourceUrl && newsSource` are both present, so old pieces gracefully omit per the operator's stated preference.

**No backfill of historical MDX.** Pre-2026-04-22 pieces' URLs are unrecoverable; post-2026-04-22 pieces (~14 of them) have reliably resolvable candidate rows but the operator did not request backfill. Going forward only — if it later turns out the gap is annoying, a one-shot script reading `daily_candidates.url` per piece + frontmatter edit is a small ad-hoc job, covered by the metadata carve-out.

**Drawer trigger placement — same DOM, restyled.** [src/components/MadeBy.astro](../src/components/MadeBy.astro) renders `<made-drawer>` wrapping a `.made-open` button + the slide-in `.made-panel`. The panel is `position: fixed` so the wrapper's DOM position is irrelevant to where the panel renders — the entire `<MadeBy>` element can move freely. Moved from [src/layouts/LessonLayout.astro](../src/layouts/LessonLayout.astro) line 216 (between finish state and Zita chat) to right after the meta line, before the audio player. [src/styles/made.css](../src/styles/made.css) `.made-open` rewritten to read as a quiet inline link at the same visual weight as the meta line (color `#6B6B6B`, font `0.8125rem`, no pill background, label underlines on hover) — operator's stated brief: *"Roughly the same visual weight as the '6 min · How invisible defaults shape behavior…' line. A quiet link or small button, not a prominent CTA."*

**Footer line removal — drop from BaseLayout, keep `AGENT_COUNT` constant.** [src/layouts/BaseLayout.astro:165-167](../src/layouts/BaseLayout.astro:165) deleted three lines. `AGENT_COUNT` constant (currently 16) stays in [src/lib/constants.ts](../src/lib/constants.ts) — still used in the `<MadeBy>` drawer subtitle and the BaseLayout OG meta description. Constant is canonical; the footer line was a redundant surface.

**Trade-offs considered:**

- **Source URL on a separate line below the meta vs. appended to the meta line (chosen the latter).** The meta line already uses `flex-wrap` with dot separators, so adding "Source: NYT ↗" as a third item composes naturally. Mobile (375px) verified — meta wraps cleanly to multiple rows; the source link wraps with the rest. Separate line would have added another vertical block above the audio player; appending keeps the metadata together.
- **`Source: {newsSource} ↗` vs. just `{newsSource} ↗` as link label (chosen the former).** Without the "Source:" prefix the publication name reads ambiguously next to the underlying-subject text. Three-character prefix is cheap; clarifies the affordance.
- **Move the entire MadeBy element vs. extract a separate inline trigger (chosen the former).** A second trigger near the title + a hidden trigger near the bottom would have left two click targets for one drawer. Single trigger near the title is cleaner; the panel's fixed positioning means the wrapper can sit anywhere in the DOM without affecting where the drawer slides in from.
- **Backfill recent (~14) post-2026-04-22 pieces (deferred).** Schema is optional; no urgency. Going-forward-only matches the operator's stated edge-case handling ("the link should just not render"). If wanted later, ~10 lines of bash + jq + sed.

**Verified end-to-end** in dev preview against the 2026-04-29 smell-maps piece. Footer rendered as tagline + copyright only — no "Made by N agents" line. `<made-drawer>` placed after the meta line, before the audio player; clicking the trigger opened the drawer (panel slides in from the right, identical pre-this-change behaviour); old position between finish state and Zita chat now empty (single drawer in `main`). Manually adding `sourceUrl: "https://www.nature.com/..."` to the test piece's frontmatter rendered "Source: Nature ↗" as the third item in the meta line with `target="_blank" rel="noopener noreferrer"`. Mobile (375px) — meta line wraps to four rows naturally, no overflow. Reverted the test edit before commit. `pnpm build` clean across all 22 daily pieces. `pnpm verify-categoriser-floor` 10/10 + `pnpm verify-interactive-voice` 10/10 pass. Agents-side typecheck unchanged from pre-session baseline (27 pre-existing `server.ts` SubAgent typing errors; touched files compile clean).

**Files touched:** [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro), [agents/src/director.ts](../agents/src/director.ts), [src/content.config.ts](../src/content.config.ts), [src/layouts/LessonLayout.astro](../src/layouts/LessonLayout.astro), [src/pages/daily/[date]/[slug].astro](../src/pages/daily/[date]/[slug].astro), [src/styles/made.css](../src/styles/made.css), CLAUDE.md, this entry.

**Forward verification on next cron firing (≈2026-04-30 02:00 UTC):** new piece's MDX should carry a `sourceUrl: "https://..."` frontmatter line; reader page renders "Source: {newsSource} ↗" in the meta line; pipeline_log shows no new errors around the splice block. If the candidate's `url` is empty (some RSS feeds drop the link field), the line is silently absent — that's the designed degraded path.

## 2026-04-29: Plain English layer for interactive prompts

**Trigger:** the 2026-04-25 [defection-incentives-under-asymmetry quiz](content/interactives/defection-incentives-under-asymmetry.json) shipped voice 88/100 with the stem *"Why does asymmetry in outside options destabilize coordination agreements even when mutual restraint would benefit all participants?"* Contract-compliant on the letter (every concept word is the right term, no tribe words, no hedging, no flattery), but the voice contract's own test — *"sounds like something a human would actually say to a friend"* — fails on first read. A curious 14-year-old has to re-read the stem twice. Three real gaps surfaced: (1) the quiz generator did not embed `VOICE_CONTRACT` at all (only the auditor and HTML generator did), (2) the auditor's plain-English line was generic enough that "asymmetry / coordination / mitigation / throughput / restraint" all passed, (3) no worked before/after pair anywhere in the prompts to anchor the rewrite intuition.

**Decision:** ship a Plain-English layer in the interactive generator and auditor prompts (both quiz and HTML paths), with a JS verifier mirroring the rule shape. Voice contract itself stays untouched.

The split rule: precise concept name lives in `title` and `concept` line; questions / options / explanations (quiz) and caption text / status messages / tooltips (HTML) use everyday words. Concept-jargon translation list anchors the rewrite intuition (asymmetry → imbalance / one side has more; coordination agreement → deal; mutual restraint → holding back; etc.). 14-year-old test as scoring anchor: voice 100 if a curious 14-year-old reads cleanly first time, 85 if minor polish, <85 if vocabulary forces re-reads. One worked before/after pair using the actual production stem ("Why does asymmetry in outside options destabilize coordination agreements?" → "Why do deals fall apart when one side has more options to walk away?").

**Trade-offs considered:**

- **Voice contract tightening (rejected).** Could have added a "Plain English split rule" to the canonical [content/voice-contract.md](content/voice-contract.md). Rejected: the contract is embedded by Drafter / Voice Auditor / Integrator on daily pieces. Daily-piece register is genuinely different — pieces teach sophisticated concepts at length, with room to introduce a precise term and define it in the next sentence. Quizzes and HTML-interactive captions don't have that scaffolding budget — a 4-option question on a single screen has to land in everyday words on first read. Tightening the contract would over-correct daily pieces. The contract's "Plain English. No jargon without immediate translation" line is correct as written; we're applying it harder for interactives via the embedding agents, not changing it.

- **Reading-level metric (rejected).** Could have specified Flesch-Kincaid or lexile target. Rejected as not actionable in a prompt — Claude can't reliably score Flesch-Kincaid on its own output. The 14-year-old test is a heuristic Claude can apply on each stem.

- **Title and concept exempt (decided).** Concept-jargon (asymmetry, chokepoint, threshold, trade-off) is the correct term and belongs in `title` and `concept`. The auditor and verifier explicitly skip those fields. Stems / options / explanations are where the simplification bites.

- **JS verifier instead of runtime shim (decided).** The verifier is a documentation + regression artefact (mirrors the prompt's flag-list as deterministic regex), not a pre-Claude runtime gate. Same convention as `verify-categoriser-floor` / `verify-splice` / `verify-dedup` / `verify-normalize` / `verify-validator`. If the prompt change doesn't bite over the next 5 cron-generated quizzes, FOLLOWUPS entry escalates to either tightening the flag-list with more concept words observed in production OR adding a runtime pre-Claude shim using the verifier's JS heuristic.

- **No backfill of existing 16 interactive JSON files.** Permanence rule. New register applies to future cron runs only. Operator can manually retag any individual file via `/interactive-regenerate-trigger?piece_id=<id>&type=quiz` if a specific historical quiz reads off-register, but this is not part of the change.

**Files touched (5 + 1 new):**
- [agents/src/interactive-generator-prompt.ts](agents/src/interactive-generator-prompt.ts) — quiz path: embed `VOICE_CONTRACT` + new "Plain English for quizzes" subsection. HTML path: append Plain-English bullet to existing extra rules.
- [agents/src/interactive-auditor-prompt.ts](agents/src/interactive-auditor-prompt.ts) — quiz auditor: replace soft line 51 with explicit checklist + 14-year-old test + worked before/after. HTML auditor: append mirror Plain-English bullet.
- [agents/scripts/verify-interactive-voice.mjs](agents/scripts/verify-interactive-voice.mjs) — new file, 10 fixture cases.
- [agents/package.json](agents/package.json) — `verify-interactive-voice` script.
- [CLAUDE.md](CLAUDE.md) — narrative section "Plain English for interactives (2026-04-29)".
- [docs/AGENTS.md](docs/AGENTS.md) — touched Interactive Generator + Interactive Auditor character paragraphs.
- [docs/FOLLOWUPS.md](docs/FOLLOWUPS.md) — new `[observing]` entry.

**Verification (this session):** `pnpm verify-interactive-voice` — 10/10 pass. `npx tsc --noEmit` from `agents/` — 27 pre-existing `server.ts` SubAgent typing errors (unchanged from pre-session); touched prompt files compile clean. `pnpm build` site-side clean.

**Rollback:** single `git revert` of the change set. No schema, no migration, no D1 surgery, no R2 surgery, no historical backfill to undo.

**Forward observation:** next 5 cron-generated quizzes (≈2026-05-01 14:00 UTC). Unblock the FOLLOWUPS entry at ≥4/5 cleanly readable by a non-specialist on first read. Escalate if the prompt change isn't biting.

---

## 2026-04-29: Categoriser zero-floor + tiered reuse + fallback category (golden-orb fix)

**Trigger:** the 2026-04-28 02:00 UTC cron's "Mystery of golden orb found in depths of ocean off Alaska finally solved" piece was assigned 0 categories — the first and only piece in the 22-piece catalogue without one. Piece subject ("how knowledge accumulates through incremental observation") was genuinely orthogonal to the trade/policy/commodity/violence-skewed taxonomy; Claude's available reuse targets were Pattern Recognition & Sensing (stretchy at ~65–70 confidence) or Information Asymmetry & Markets (stretchier still). The prompt left an explicit empty-array escape hatch in the bootstrap branch ("you may return zero assignments and the next piece's run will revisit with more context") — Claude generalised the latitude to the populated case and chose `{"assignments":[]}`. Code-level had no minimum-1 floor; observer event fired "0 categories", piece quietly stayed untagged.

**Decision:** ship a layered defense — strengthen the prompt to forbid zero with a tiered decision (≥75 ideal reuse → 60–74 stretch reuse → propose-novel), add a code-level filter that drops sub-60 existing-cat assignments (separately catches the 2026-04-25 Cartels @ 50 bug class), wire a single retry on empty/all-sub-floor with a multi-turn message that names the violation, and fall back as a last resort to a reserved "Patterns Yet to Cluster" category seeded by migration 0027. The fallback is hidden from every reader-facing surface and from Claude's context list (so Claude can never pick it directly — defeats retry purpose).

**Rejected alternatives:**
- *Prompt-only fix.* Strengthen wording, trust Claude. Light touch, no code change. Rejected — the same instruction-violation latitude that caused the orb miss can recur on edge cases the prompt didn't anticipate. Multi-layer enforcement is cheaper (2 Claude calls in worst case + one DB write) than another 3-week recurrence cycle.
- *Force reuse-only, no novel category creation.* Would have forced the orb into Pattern Recognition & Sensing at ~65 stretch confidence. Rejected — the user audit suggests the taxonomy is genuinely missing a "Science & Discovery" cluster (two pieces in three days sit in it). Letting Claude propose a durable new category when warranted preserves taxonomy convergence.
- *Make "Miscellaneous" a Categoriser-visible target.* User said this would be acceptable as a literal fallback. Rejected — exposing it as a visible reuse target risks Claude over-using it ("when in doubt, dump it in Miscellaneous"). Keeping it hidden + warn-on-use forces the retry layer to do the work and gives operator a clear escalation signal.
- *Lower the ideal reuse floor to 60 globally.* Rejected — Cartels @ 50 already showed sub-floor stretches; lowering further would compound. The tiered approach (75 ideal, 60 fallback for stretch, with a reasoning sentence naming what's stretchy) preserves the discipline at the high end while opening a controlled stretch path.
- *Proactively seed a "Science & Discovery" category via migration.* Considered for the orb backfill. Rejected — the framing (name + description) is better discovered organically through Categoriser when it actually sees the piece, rather than guessed by a human in advance.

**Trade-offs:**
- Worst-case Claude calls per piece doubles (2 instead of 1) on retry path. Expected hit rate is rare under the new prompt — Claude has explicit instruction to use stretch-reuse rather than empty-array. Cost ceiling of one extra ~2.5k-token call per affected piece is acceptable.
- The fallback category becomes a graveyard for genuinely confusing pieces. A piece landing there is an operator review signal (warn-severity observer event) — not a quiet failure.
- Three files now duplicate the literal `'patterns-yet-to-cluster'` slug (categoriser-prompt.ts, categories.ts, made.ts). Single source-of-truth via cross-worker import was rejected — site and agents workers don't share code; the literal duplication is small enough that comment cross-references are sufficient.
- Fallback row carries `id='fallback-patterns-yet-to-cluster'` (deterministic, not UUID) so the migration is idempotent under re-apply via `INSERT OR IGNORE` on the unique slug.
- Migration count: 19 tables across 24 migrations.

**Same-session orphan cleanup:** Deleted "Surveillance & Data Power" category from remote D1. Created 2026-04-21 by a Manto-doctrine-era piece subsequently deleted in the rollback; piece_count=0 since creation. Pre-delete verified zero `piece_categories` references. Single DELETE on `slug='surveillance-data-power' AND piece_count=0`.

**Verification:** unit-style verifier `pnpm verify-categoriser-floor` (10 cases — empty / sub-floor / stretch-reuse / boundary 60 / boundary 59 / malformed JSON / non-array). All pass. Post-deploy backfill via `/categorise-trigger?piece_id=<orb>`. Forward observation (FOLLOWUPS): 5 cron firings, must hit `assignments_written ≥ 1`, zero fallback events, zero sub-60 rows.

**See:** plan `~/.claude/plans/majestic-mixing-meerkat.md`.

## 2026-04-28 (rollback follow-up): Restore SAME-EVENT/SAME-CONCEPT prompt rule (collateral damage of the Manto rollback)

**Trigger.** After the Manto rollback at `79a914d`, operator review surfaced that the rollback's `git checkout 9afcd85^ -- agents/src/curator-prompt.ts` had inadvertently swept up the SAME-EVENT/SAME-CONCEPT MUST-skip prompt rule from `11c2450`. Reasoning: `11c2450` shipped chronologically AFTER `9afcd85`, so checking out `9afcd85^` (the doctrine commit's parent) restored a curator-prompt.ts that predated both the doctrine AND the dedup prompt rule. The hard pre-Curator dedup filter at `e7ce2a4` (architectural, deterministic) survived because it lives in different files (`shared/dedup-headlines.ts` + `director.ts` wiring); only the prompt-level layer was lost.

**Demonstration that the rule was needed.** The 02:00 UTC cron after the rollback re-picked the Tampa-brother news event we'd just deleted (different framing — "Observation Without Authority" instead of "Predictive Restriction" — same news event). The hard filter couldn't catch it because `getRecentDailyPieces` no longer saw the deleted original; the prompt rule that would have said "wait, you covered this event already" was gone. Without two layers, deletion of the original = open door for re-pick.

**Decision.** Re-apply `11c2450` to `agents/src/curator-prompt.ts`. The patch was scoped exclusively to the dedup section of `buildCuratorPrompt` — three new paragraphs (SAME NEWS EVENT MUST-skip, SAME UNDERLYING CONCEPT MUST-skip, three worked examples including the literal Cell-Location-Data twin failure) replacing the previous soft "PREFER a different candidate" language. Zero Manto-doctrine artifacts in the patch; verified post-apply that grep for `Manto` / `VOICE_DOCTRINE` / `voice-doctrine` in the file returns zero matches.

**What's now live (two-layer dedup architecture restored):**
- **Layer 1 — Hard filter** (`e7ce2a4`, never rolled back): tokenizes headlines, removes candidates sharing ≥4 substantive tokens with any recent piece. Curator literally cannot see the duplicates. Catches headline-token overlap (the dominant failure mode — twin SCOTUS headlines, twin earnings stories).
- **Layer 2 — Prompt rule** (`11c2450`, restored in commit `072da00`): MUST-skip instructions for SAME NEWS EVENT and SAME UNDERLYING CONCEPT, with worked examples. Catches concept overlap when headlines share zero substantive tokens (Hormuz + Suez both teaching chokepoints, FDA approval + Pfizer earnings both teaching pharma market-structure, etc).

**What stays rolled back:** the Manto doctrine architecture itself. `VOICE_DOCTRINE` / Manto-posture / hospitality-principle-as-layer all stay gone. The voice contract is the only voice rule. The 2026-04-28 (rollback) entry below captures that lesson.

**Files touched:** `agents/src/curator-prompt.ts` (one file; 13 insertions, 2 deletions per `git diff --stat`). No D1 changes, no R2 changes, no piece deletions.

**Verification post-restore.** `grep "SAME NEWS EVENT" agents/src/curator-prompt.ts` → 1 match. `grep "SAME UNDERLYING CONCEPT" agents/src/curator-prompt.ts` → 1 match. `grep "MUST pick a different" agents/src/curator-prompt.ts` → 1 match. Typecheck clean. Site builds clean. The next 5–7 cron firings will exercise the rule against new candidates; failure signal is a same-news-event re-pick the way the Tampa piece re-published before the restore.

**Forward.** Tag `alpha-stable` stays at `79a914d` as the pure rollback marker. Current `main` HEAD (after `072da00`) is the rollback + dedup-rule restored — the actual desired stable state. If a future change goes wrong, `alpha-stable` is still a safe rollback target; just be aware that resetting to it loses the dedup prompt rule restoration and the rule would need re-applying.

## 2026-04-28 (rollback): Voice doctrine rolled back. Three doctrine-era pieces deleted.

**Trigger.** Operator review of the 2026-04-28 14:00 UTC piece (`/daily/2026-04-28/the-supreme-court-seems-a-bit-nervous-about-letting-the-poli/`, voice score 92, *"Cell Tower Logs and the Fourth Amendment"*) surfaced a hospitality-principle violation. The piece's hook included the line *"Which gas stations. Which girlfriend's house. Which mosque on Friday afternoons."* — a specifics-list framing religious practice as inherently suspicious surveillance signal. A teaching beat in the same piece extended the pattern: *"who do you meet, where do you sleep, which neighborhoods do you avoid, how often do you visit the mosque or the union hall or the medical clinic at the edge of town."* The operator's read: *"Manto-style 'find the specific person/place' has bent into 'find the politically-charged specific'. Reverse Manto completely."*

**Diagnosis.** The doctrine instruction *"find Bishan Singh — the person for whom the system was not designed"* worked for partition-violence stories (its source material) where naming the specific anchored the human cost. Applied to systems-of-government stories — surveillance, policing, regulation — the same instruction produced specifics that read as tribal markers (mosque, union hall, the clinic at the edge of town). The Voice Auditor's posture-question check passed the piece because it sounded like *"a person telling another person what they found"* — but what the person was telling was tribally charged. The contract's hospitality principle (*"a Hindu grandmother in Delhi, a Muslim teenager in Bradford…"*) was supposed to gate this, but the doctrine's "find the specific" instruction outweighed the contract's universality test in the auditor's scoring — *"if doctrine and contract conflict, the doctrine wins"* turned into *"the doctrine produces specifics that the contract can't override"*.

The deeper problem: Manto's specificity worked in his domain because he was writing fiction about real human beings during a specific historical violence. He was naming Bishan Singh — one man, named, placed, embodied. The Drafter, instructed to find "Bishan Singh in every system", landed on category-shaped specifics (which mosque, which union hall) because it had no actual person to name. Category-shaped specificity is exactly the failure mode that produces tribal framing. The instruction to find the specific person, applied without an actual specific person available, produces typed specifics — and typed specifics ARE tribal framing.

**Decision.** Roll the doctrine back wholesale. Single-layer voice contract restored as the only voice rule. The contract was working for the months before the doctrine landed; the cartel-gold piece's *"95-on-robotic-prose"* failure that triggered the doctrine work is reframed as a different problem (writing that's mechanically clean but tonally robotic) that needs a different solution than a posture doctrine. Future attempts to address it should not introduce instructions that override the hospitality principle.

**What rolled back:**
- **Prompts** (via `git checkout 9afcd85^`): `agents/src/drafter-prompt.ts`, `agents/src/voice-auditor-prompt.ts`, `agents/src/integrator-prompt.ts`, `agents/src/curator-prompt.ts`, `content/voice-contract.md`, `agents/src/shared/voice-contract.ts`. All six restored to pre-doctrine state.
- **Files removed** (`git rm`): `content/ZEEMISH_MANTO_VOICE.md`, `agents/src/shared/voice-doctrine.ts`, `agents/scripts/verify-doctrine.mjs`, `book/08.5-the-voice-doctrine.md`, `docs/VOICE.md`.
- **Pieces deleted** (`git rm` + D1 wipe + R2 cleanup): `2026-04-27-supreme-court-reviews-police-use-of-cell-location-data-to-fi.mdx` (Iteration 1 piece, the *"Tower Pinged"* title), `2026-04-28-brother-of-suspect-in-deaths-of-2-tampa-doctoral-students-we.mdx`, `2026-04-28-the-supreme-court-seems-a-bit-nervous-about-letting-the-poli.mdx` (the *"Which mosque"* piece). Six associated interactive JSON files removed (`proximity-as-inference{,-html}.json`, `predictive-restriction-and-temporal-thresholds{,-html}.json`, `passive-logging-and-retrospective-assembly{,-html}.json`).
- **Doc reverts** (via `git checkout 9afcd85^`): `docs/AGENTS.md`, `docs/RUNBOOK.md`, `book/CONTENTS.md`, `book/00.5-the-four-words.md`, `book/WRITING-MORE.md`, `book/11-quality-gates.md`, `book/09-the-sixteen-roles.md`, `book/99-glossary.md`, `CLAUDE.md`. CLAUDE.md gets a new "Currently working on: Voice doctrine fully rolled back" preface explaining what happened.
- **D1 wipe** for the three pieces across 13 tables: `daily_pieces`, `audit_results`, `daily_candidates`, `daily_piece_audio`, `zita_messages`, `learnings`, `engagement`, `pipeline_log` (time-window scoped per published_at ±10min), `observer_events` (time-window scoped), `interactives`, `interactive_audit_results`, `interactive_engagement`, `piece_categories`. `categories.piece_count` recounted from remaining `piece_categories` rows.
- **R2 audio** for the three pieces deleted via `wrangler r2 object delete` across all beat clips.
- **Memory** (`~/.claude/projects/-Users-zee-zeemish-v2/memory/feedback_voice_doctrine.md`) updated to record the rollback + the lesson, so future sessions don't try the same architecture without the prior failure context.

**What stays as historical record:**
- DECISIONS 2026-04-27 (later) "Voice doctrine layered onto the operational contract" — the original architecture commit's trade-off log.
- DECISIONS 2026-04-27 (Iteration 1) "Doctrine tightenings from the geofence piece + voice system documentation" — the Iteration 1 commit's trade-off log.
- This entry — the rollback and post-mortem.

The append-only rule on DECISIONS.md is honoured: nothing edited or deleted; the rollback is a new entry that supersedes the prior architecture in the present-tense system but doesn't erase the record of what was tried and why it failed.

**The lesson.**
1. *Posture instructions that ask for "specifics" need to specify what KIND of specifics.* Bishan Singh worked because Manto had a specific person. Asking the Drafter to "find Bishan Singh" without an actual person to name reduces to "find a specific" — and the model fills that gap with category-shaped specifics, which are tribal markers.
2. *The hospitality principle has to be a hard floor, not a layer in a hierarchy.* The doctrine-over-contract precedence let "find the specific" outweigh "feel-written-for-everyone" in the scoring. A future architecture that re-introduces a posture layer must ensure the hospitality principle gates above it, not below.
3. *Pre-deploy verification on a single brief is insufficient.* The cartel-gold-brief subagent verification (DECISIONS 2026-04-27 "Voice doctrine layered…") produced doctrine-aligned output for a supply-chain story. It missed the failure mode entirely because the failure mode is domain-conditional — it surfaces in stories about systems-of-government, not stories about supply chains. A meaningful pre-deploy verification needs at minimum 5 briefs sampled across the Curator's TEACHABILITY domains (crime, policy, surveillance, infrastructure, business, etc.), not a single representative.
4. *Voice scores can lie about hospitality.* The piece scored 92 on voice. Voice score doesn't measure whether a piece welcomes every reader — that's a separate axis. The auditor would need a hospitality dimension that's separately scored and gates the score before posture-quality is assessed.

**What's NOT changed by this rollback:**
- The voice contract itself (1000–1500 words, 5–6 beats, tribe-word list, plain English, hospitality principle, etc.) is unchanged from its pre-doctrine 2026-04-26 state.
- All other agent improvements from prior sessions (Curator reuse-bias, Categoriser confidence floor, audio retry trio fix, Area 4 interactives, etc.) stay live. The rollback is scoped to the voice-doctrine architecture only.
- The `2026-04-27-former-sen-ben-sasse-dying-of-cancer-reflects-on-family-fait` piece (the morning 2026-04-27 piece, *"What We Owe the Dying"*) was published before the doctrine commit and stays live. Pre-doctrine architecture; not in scope for the rollback.

**Forward.** Operator may re-trigger fresh pipeline runs from admin. Pieces will produce under the pre-doctrine voice contract. The "robotic writing" diagnosis that triggered the doctrine work remains an open question; future approaches should not assume a posture-doctrine layer is the answer.

## 2026-04-27 (evening, architectural fix): Curator duplicate-pick — hard pre-Curator headline-overlap filter

**The prompt fix shipped at `11c2450` failed at the first test.** Deployed at 21:03:03 UTC. Operator manually triggered another run at 21:06:49 UTC — Curator picked the SAME SCOTUS / cell-location story for the **fourth time in one day**. Verified by checking pipeline_log + candidate set + observer events:

- Curator started 21:06:49 UTC, finished 21:07:16 UTC. The new prompt was live (deploy completed 3min46s earlier).
- Of 50 candidates Scanner pulled, only ONE was about the SCOTUS cell-location case (NYT wrangles story). The other 49 were diverse — Voyager 1, Roundup case, AI chip stocks, Mali, OpenAI vs. Musk, Ubuntu AI. Curator was not cornered.
- Curator's underlying_subject was nearly identical to the prior piece's: "what surveillance actually is: how proximity data becomes evidence and why the boundary between finding and tracking matters" → "how proximity becomes evidence and why the boundary between finding and tracking matters". One word changed. Curator SAW the prior piece in `getRecentDailyPieces`, picked the same event, used virtually the same framing.
- The new prompt's first worked example was literally `"Supreme Court Reviews Police Use of Cell Location Data"` + `"Supreme Court Wrangles With Geofence Warrants"` → SAME EVENT, SKIP. Claude looked at this exact scenario, marked SKIP, and then picked a candidate matching it anyway.

**Diagnosis.** The prompt approach is structurally wrong, not under-tightened:
1. The model is rewarded for picking, not skipping. Skip requires more cognitive effort than pick.
2. Worked examples can be read as "this specific case", not "this pattern". Claude rationalizes "but mine is different from the example".
3. Teachability ranking instinct overrides dedup judgment when a high-newsworthy story sits in the candidate set ("Supreme Court..." reads as newsworthy).
4. Three rounds of prompt tightening have now failed (2026-04-24 underlying_subject, 2026-04-27 morning observation, 2026-04-27 evening worked-example fix). At some point "the prompt isn't strong enough" stops being a useful framing.

**Decision: hard pre-Curator dedup filter, server-side, deterministic.** Make duplicates **invisible** to Curator, not "ask Curator nicely to skip them". A candidate that doesn't appear in the input list cannot be picked.

**Implementation** at [agents/src/shared/dedup-headlines.ts](../agents/src/shared/dedup-headlines.ts):
- `tokenizeHeadline(headline)` — strips trailing " - Source" suffix, lowercases, drops stopwords + tokens with length <3.
- `findHeadlineMatch(candidate, recentHeadlines)` — returns the strongest overlap (or null) by iterating recent pieces and counting shared tokens.
- `filterDuplicateCandidates(candidates, recentHeadlines)` — returns `{kept, filtered}` where `kept` is what Curator sees.
- Thresholds: ≥4 substantive tokens shared OR (≥3 shared AND ≥0.5 ratio). The ratio fallback catches short-headline matches that fall under the absolute count.

**Wired into** [agents/src/director.ts](../agents/src/director.ts) `triggerDailyPiece` between `getRecentDailyPieces` and `curator.curate`. Defensive fallback: if the filter would eat every candidate (50 → 0), pass the original list through and log a warn — better a possible duplicate than no piece at all. With 50 candidates and a 30-day recent-pieces window this fallback should never trip.

**Observer event** `Candidates filtered: N of 50 (headline overlap with recent pieces)` fires when the filter removes anything, with sample lines showing each filtered candidate + the recent piece it matched + shared-token count. Visibility matters: the filter shapes Curator's input set invisibly, and high filter rate = news cycle dominated by stories Zeemish has already covered (itself useful signal).

**Regression harness** at [agents/scripts/verify-dedup.mjs](../agents/scripts/verify-dedup.mjs) — `pnpm verify-dedup`. 14 cases drawn from real failure modes (the 2026-04-24 Maduro twin pieces, the 2026-04-27 SCOTUS twins) plus deliberate false-positive probes (Trump signs different bills, Hurricane Helene days apart, distinct SCOTUS cases on the same day). 13 pass + 1 documented borderline (Trump-signs-different-orders is intentionally filtered as an aggressive posture — two pieces about Trump executive orders in a week would teach the same concept).

**The prompt fix from `11c2450` stays as defense-in-depth.** The hard filter catches headline-overlap (same-event detection); the prompt's SAME-UNDERLYING-CONCEPT rule still catches different-event same-concept duplicates that share zero substantive headline tokens (Hormuz + Suez chokepoints). Two layers, deterministic + judgmental.

**Admin engagement query fix shipped same commit.** "Mon 27 Apr · unknown · 1 view · 0 (0%) · 1" was an orphan engagement row — someone hit the still-CDN-cached wrangles page in the brief window after operator reset, fresh INSERT landed against the now-deleted piece_id. [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro) engagement query switched from `LEFT JOIN daily_pieces` → `INNER JOIN` so orphans drop out of the display silently. Same posture: don't surface broken state when the underlying piece is gone.

**Considered alternatives:**
1. **More data to Curator** (e.g., JOIN `daily_candidates` for picked-candidate news source/summary). Rejected: today's failure shows that adding more data doesn't change which inputs Claude attends to under rationalization pressure. The 2026-04-24 fix already added underlying_subject; that data was working today (visible in the prompt) and Claude still picked the duplicate.
2. **Semantic embeddings on underlying_subject**. Rejected: introduces a vector-store dependency, threshold tuning becomes recurring chore, and "same news event" is a different axis from "same concept" — a cosine threshold catches the second but not the first.
3. **Pre-Scanner clustering** (LLM-based topic clustering of the 50 candidates first, surface representatives). Rejected for now: adds another LLM call, adds complexity. Headline-overlap is deterministic and fast; if it proves insufficient we'll escalate to clustering.
4. **Two-step Curator** (Curator returns top-N ranked, second pass picks non-duplicate). Rejected: two Claude calls per pipeline run, more latency, and the second pass would need the same dedup judgment we already failed to enforce.
5. **Hard server-side filter** (chosen). Smallest viable architectural fix. No new dependencies. No new LLM calls. Deterministic. Cannot be rationalized through.

**Trade-offs.**
- False-positive risk: a candidate about a legitimately new development on a previously-covered story might be filtered. Acceptable: the cost of a false positive (skip a teachable candidate, pick a different one) is much smaller than the cost of a false negative (publish a duplicate, embarrass the brand, burn $ on audio + interactives + categoriser + reflection).
- Trump-signs-different-orders is intentionally filtered. Two pieces about presidential executive orders in a week would teach the same "executive-action-as-policy" concept. Better to skip it than ship a near-duplicate.
- Same-CONCEPT, different-event duplicates (Hormuz + Suez chokepoints) are NOT caught by this filter — they share zero substantive headline tokens. The Curator prompt's SAME-UNDERLYING-CONCEPT rule remains the layer for that case. If the prompt continues to fail on same-concept cases too, the next escalation is pre-Scanner clustering.
- The filter ran against a 30-day window of recent pieces. Possible over-filter on legitimate follow-ups (a story that returns 3 weeks later with a substantively new angle). Tunable via `DEDUP_MIN_SHARED_TOKENS` constant.

**Forward verification** in FOLLOWUPS `[observing] 2026-04-27 (architectural fix): Curator dedup filter — recurrence watch`. Unblock conditions: 7 cron runs + manual triggers pass with no twin pieces (sample observer events for filter rate); failure signal is a fifth twin-pieces incident.

**Reset-script gap surfaced** during the orphan cleanup of today's two wrangles pieces. `scripts/reset-today.sh --piece-id` doesn't touch `interactives`, `interactive_engagement`, `interactive_audit_results`, or `content/interactives/<slug>.json` files. Manual cleanup (2 JSON files, 2 interactives rows, 5 interactive_engagement rows, 24 interactive_audit_results rows, 1 orphan engagement row) ran in this session. FOLLOWUPS entry queued to extend the script.

## 2026-04-27 (evening, later): Curator duplicate-pick — SAME-EVENT / SAME-CONCEPT rule with worked examples

**Trigger.** Recurrence of the 2026-04-24 twin-pieces failure pattern. During same-day voice-doctrine iteration the operator manually fired the daily-piece pipeline twice in addition to the autonomous 02:01 UTC cron. Both manual runs (15:01 UTC + 20:40 UTC) landed on the same SCOTUS / cell-location-data news event:

- **Piece 2** (`cfd3f570…`, "Supreme Court Reviews…"): subject = *"how proximity data becomes evidence and why the boundary between finding and tracking matters"*
- **Piece 3** (`9ee14d8e…`, "Supreme Court Wrangles With…"): subject = *"what geofence warrants actually are and how proximity data becomes criminal evidence"*

Same SCOTUS case, same news event, same underlying concept. Operator caught it, deleted the wrangles piece via `scripts/reset-today.sh --piece-id 9ee14d8e-…` (commit `72f312d`), and asked for the proper fix.

**Why the 2026-04-24 fix didn't catch this.** That fix added `underlying_subject` to the recent-pieces context Curator sees, paired with prompt language ("avoid repetition of UNDERLYING SUBJECT, not just headline wording"). The data path was working today — both subjects shared "proximity data becomes evidence" — but Claude rationalized through the soft "PREFER a different candidate — unless the news is genuinely developing in a way that warrants follow-up teaching" wording when the concrete framing diverged ("proximity data" generally vs. "geofence warrants" specifically). The escape hatch ("genuinely developing") was load-bearing on the failure mode: once Claude convinced itself the second piece was a "different angle of a developing story", the rule was satisfied by its internal reasoning even though the news event was the same.

**Decision: rule-strength, not more data.**

Considered three fix shapes:
1. **More data** — JOIN `daily_candidates` to add the picked candidate's news source + summary to recent-pieces context. Rejected: the same-event signal was already legible from the underlying_subject overlap; Claude chose to discount it. Adding more inputs doesn't change which inputs the model attends to under rationalization pressure.
2. **Semantic embeddings** — store an embedding of each `underlying_subject` and refuse picks above a cosine threshold. Rejected: introduces a vector-store dependency, threshold tuning becomes a recurring chore, and "same news event" (today's miss) is not the same axis as "same underlying concept" — a cosine threshold catches the second but not the first.
3. **Stronger rule + worked examples** — split the de-dup rule into two named MUST-skip failure modes (SAME EVENT, SAME CONCEPT), drop the soft "PREFER" language, add three worked examples including a literal worked example of today's exact failure. **Chosen.** Smallest viable change, addresses the actual failure mechanism (Claude rationalizing through soft language), zero new dependencies.

**What shipped** ([agents/src/curator-prompt.ts](../agents/src/curator-prompt.ts) `buildCuratorPrompt`):
- Section heading rewritten: "Already published recently — Curator must skip duplicates of either kind below"
- New section header "Two duplicate failure modes — both are MUST-skip, not soft preference"
- **SAME NEWS EVENT** rule named explicitly with concrete examples of what counts as the same event (same SCOTUS case, same lawsuit, same investigation, same legislative bill, same scandal, same person's death, same disaster) and what counts as the same event at a different angle (oral argument vs. ruling, indictment vs. verdict, House vote vs. Senate vote, hearing vs. decision, leak vs. confirmation). Narrow exception tightened from "the news is genuinely developing in a way that warrants follow-up teaching" to "the news has produced a substantively new underlying concept to teach — not when the angle merely differs". The phrase "the angle merely differs" names the exact failure mode of today.
- **SAME UNDERLYING CONCEPT** rule preserves the 2026-04-24 protection but reframes as MUST-skip not PREFER.
- **Three worked examples** — first example is a literal walkthrough of today's failure ("Supreme Court Reviews…" + "Supreme Court Wrangles With Geofence Warrants…" → SAME EVENT, SKIP), second covers same-concept-different-event (Hormuz + Suez chokepoints), third covers different-event-different-concept that should PICK (FDA + Pfizer). Worked examples are concrete enough that Claude can pattern-match against them rather than rely on abstract conceptual judgement.
- "PREFER a different candidate" replaced with "MUST pick a different candidate" throughout.

**What didn't ship.** No schema change. No new JOIN. No agent-side rate-limit. No semantic embedding. The `getRecentDailyPieces` query in [agents/src/director.ts](../agents/src/director.ts) is unchanged; only its in-code comment is updated to reference today's recurrence + name the prompt as the leverage point.

**Forward verification.** Watch the next 7 cron firings + manual triggers (~2026-05-04 if at `interval_hours=24`; sooner if operator tests). Expected signal: when a candidate echoes a prior piece's news event or concept, Curator skips it via the existing decline path, observable in the admin observer feed. Failure signal: a third twin-pieces incident — would mean the worked examples need to be more numerous or the language needs an even harder must-skip framing (e.g., procedural framing — "before picking, ask: 'is this the same news event as any of the recent pieces? If yes, skip regardless of angle.'"). FOLLOWUPS `[observing] 2026-04-27: Curator SAME-EVENT/SAME-CONCEPT rule recurrence watch` carries the unblock conditions and tuning levers.

**Trade-offs.**
- The new prompt is longer (~30 lines added). Acceptable: Curator is a single Claude call per pipeline run; the prompt cost is amortized over an entire piece.
- The worked examples lean on Zeemish's actual published-piece subjects (Hormuz chokepoints, FDA approvals). If the Curator's reuse-bias for these specific examples becomes too strong, the examples would need rotation. Watch for this in the FOLLOWUPS observation window.
- The narrow exception for "substantively new underlying concept" is still a soft judgement — if a SCOTUS case produces a *genuinely new* teaching concept (e.g., the Court invents a new doctrine), Curator can still pick it. The failure mode this fix targets is rationalization-without-new-concept, not blocking legitimate follow-ups.

## 2026-04-27 (Iteration 1): Doctrine tightenings from the geofence piece + voice system documentation

**Context.** First piece under the doctrine architecture (shipped 9afcd85, deployed via GitHub Actions, triggered from admin) — `2026-04-27-supreme-court-reviews-police-use-of-cell-location-data-to-fi`. Voice score 92. The piece passed the gate but operator review surfaced two real failures the auditor missed:

1. **Performative title.** *"The Tower Pinged. You're on the List."* — thriller-headline shape, two sentences, dramatic punch. Manto's titles named things plainly: *Toba Tek Singh* (a place), *Cold Meat* (a thing), *Black Trousers* (a thing). The published title editorialised. Neither the Drafter prompt's frontmatter spec nor the auditor's named moves constrained title style — the rule existed in the doctrine's spirit (*never tell the reader what to feel*) but wasn't operationally named anywhere.

2. **Multi-sentence close.** Four sentences: *"Your phone is still pinging. The towers are still logging. The database is still growing. The Court will decide whether being findable is the same as being tracked."* Three rhetorical-anaphora sentences (the "still" pattern) accumulating, then a fourth sentence pivoting to the Court. The auditor's close rule from the doctrine-architecture commit was *"anything that follows it to restate it, land a moral, or explain what it just meant is a second close"* — the four sentences accumulate, they don't restate, so the literal reading of the prompt let them through.

3. **Deeper diagnosis.** The piece confused **Manto's rhythm** (short sentences carrying precise observation — *"The bar leaves the Mint as American gold."*) with **dramatic rhythm** (short sentences carrying rhetorical punch — *"The phones were there. The phones know."*). The doctrine talks about rhythm but didn't draw that line explicitly. Anaphora and tricolons are the most common form of dramatic rhythm in AI-generated prose, and the operator's read was that Zeemish was lapsing into this mode whenever the writer wanted to "land" something.

**Three same-evening tightenings:**

1. **Drafter prompt** ([`agents/src/drafter-prompt.ts`](../agents/src/drafter-prompt.ts)) — three new paragraphs in the *"What the doctrine doesn't say but you need to know"* section:
   - **Title — literal, not performative.** Worked examples (good: *Geofence Warrants*, *How Cartel Gold Becomes American*, *Chokepoints*. Bad: *The Tower Pinged. You're on the List.*, *The Quiet Crisis Inside Big Tech.*, *Watch What Happens When the Court Decides.*). Constraint: 2–7 words, one sentence, names the subject not the punch.
   - **Manto's rhythm is observation, not performance.** Names the difference and the test: *"do the second and third short sentences add new observation, or amplify the first? If amplify, performance — cut them."* Specific call-out for anaphora, tricolons, stacked one-sentence paragraphs that crescendo.
   - **The close is ONE sentence.** Repeated explicitly, with the recovery instruction *"if you cannot make the close one sentence, the piece has not arrived yet — go back to the last teaching beat and finish there."*

2. **Voice Auditor** ([`agents/src/voice-auditor-prompt.ts`](../agents/src/voice-auditor-prompt.ts)) — three new named moves in the *"named moves to check"* list:
   - **Title literal vs. performative** — multi-sentence title is automatic fail.
   - **Close is ONE sentence** — count the sentences. >1 = fail full stop, regardless of how the sentences relate.
   - **Observation rhythm vs. dramatic rhythm** — the same test from the Drafter prompt, expressed as a violation criterion: *"do the second and third short sentences add new observation, or amplify the first?"*

3. **Voice system documentation** — operator-facing.
   - **NEW** [`docs/VOICE.md`](VOICE.md) — comprehensive system doc. Sections: What it is (two layers), Files and where they live, How a piece is judged, How to change the voice (three kinds of change with step-by-step procedures), How to verify a change before going live, **The future: admin voice selection** (planned schema, registry, runtime resolution, admin UI — not yet built; YAGNI until there's a second doctrine to choose between), History (one-paragraph timeline through Iteration 1).
   - **NEW** [`book/08.5-the-voice-doctrine.md`](../book/08.5-the-voice-doctrine.md) — book chapter for the human reader. Why two layers, why the contract alone wasn't enough (the cartel-gold piece's 95-on-robotic-prose failure), why Manto, why the principle is bigger than Manto, where the doctrine lives, what it isn't (style guide, optional, finished). Slotted between *08 — The idea* and *09 — The sixteen roles* — sits between motive and mechanism.
   - **UPDATED** [`docs/RUNBOOK.md`](RUNBOOK.md) gains a *Change the voice* section with the three procedures (tighten a rule, replace doctrine wholesale, adjust contract) and the three verification options (free eyeball, $0.05 API call, $2 cron run).
   - **UPDATED** [`docs/AGENTS.md`](AGENTS.md) gains a *Voice — doctrine over contract* section near the top.
   - **UPDATED** [`book/CONTENTS.md`](../book/CONTENTS.md) — chapter 08.5 added to the index. *If you have thirty minutes* now reads "preface, 00.5, 8, 8.5, 9, 10, 14".
   - **UPDATED** [`book/00.5-the-four-words.md`](../book/00.5-the-four-words.md) — calmness section gets a single-sentence pointer to 08.5.
   - **UPDATED** [`book/WRITING-MORE.md`](../book/WRITING-MORE.md) — *The voice* section rewritten to name both layers and pointer to 08.5 + VOICE.md.
   - **UPDATED** [`book/11-quality-gates.md`](../book/11-quality-gates.md) — outline updated to reflect the two-layer voice and the auditor's posture-first scoring.
   - **UPDATED** [`book/09-the-sixteen-roles.md`](../book/09-the-sixteen-roles.md) — Drafter, Voice Auditor, and Integrator paragraphs rewritten with doctrine + contract references and the Integrator's "do not tame Manto-style writing" trap.
   - **UPDATED** [`book/99-glossary.md`](../book/99-glossary.md) — *Voice contract* entry rewritten as the operational layer; new *Voice doctrine* entry.
   - **UPDATED** [`CLAUDE.md`](../CLAUDE.md) — Iteration 1 narrative appended to the voice-doctrine section; *Documentation index* gains VOICE.md + book/08.5 entries.

**Naming convention reaffirmed.** The constant is `VOICE_DOCTRINE`. The file is `content/ZEEMISH_MANTO_VOICE.md`. The prompts say *"the Zeemish voice doctrine"* — never *"like Manto"*. This separation is what makes future doctrine swaps cheap. The book's chapter 08.5 makes the same separation explicit for the human reader: *"the principle the doctrine encodes is not 'write like Manto'. It is clear teaching, not robotic prose."*

**What this does NOT do:**
- Touch the published 2026-04-27 geofence piece (permanence rule).
- Build the admin voice-selector. Designed at `docs/VOICE.md` for when a second doctrine arrives.
- Add a Manto eval harness (still future).

**Trade-offs.**
- *Constraint specificity vs. doctrine prose.* The doctrine's rhythm section was written as observation about Manto's craft — *"short sentences carry weight"* — not as a constraint the model could act on. The Drafter prompt now translates that observation into an actionable test (*"do the second and third sentences add new observation, or amplify?"*). Risk: over-translating reduces the doctrine's literary register, which is part of how it instructs posture. Mitigation: the translation lives in the *"what the doctrine doesn't say"* section of the Drafter prompt, not in the doctrine itself. The doctrine stays prose; the prompt names the operationalisation.
- *Auditor strictness vs. false-positive cost.* Hard-failing close >1 sentence will catch the geofence-piece failure mode but may also catch close shapes that work — a one-sentence-and-a-fragment close, for instance. Trade-off accepted: the doctrine is unambiguous (one sentence), and false positives feed back into Integrator round 1 anyway. If false-positive rate is high across 5 cron firings, relax to "if the close is more than 30 words, fail" instead of sentence-count.
- *Documentation surface size.* The voice system now has VOICE.md + the book chapter + the AGENTS section + the RUNBOOK section + the glossary entries + CLAUDE.md narrative. Risk of drift if any one is updated alone. Mitigation: each pointer says *"see [other doc] for [its angle]"*, so a future operator updating one doc has a clear list of others to check. The doctrine .md ↔ .ts mirror is the same discipline; it has held since the architecture shipped.

**Forward verification.** Watch the next 5–7 cron firings. Expected signal:
- Titles single-sentence and literal (no thriller punctuation, no two-sentence titles).
- Closes one sentence, no anaphora pyramids.
- Voice scores stay above 85.

Failure signal: voice scores drop because the auditor catches the new named moves the Drafter still doesn't land — that's a Drafter tightening (more worked examples in the prompt), not an auditor relaxation. Or scores stay high but pieces still feel performative — that's a deeper diagnosis problem; the doctrine itself needs a new rule.

The 2026-04-27 piece is left in place. The fix is forward-only.

## 2026-04-27 (later): Voice doctrine layered onto the operational contract

**Context.** Operator review of recent pieces flagged the writing as robotic. Voice score on the 2026-04-26 cartel-gold piece was 95 — the operational contract was technically being followed (no tribe words, plain English, short sentences, structurally clean) but the prose still sounded like a report being read into a microphone. The hook previewed the lesson before asking the question. The close summarised. Contradictions got resolved into tidy morals. *"This matters because…"* connective tissue did the reader's thinking for them.

The operator handed over `~/Downloads/ZEEMISH_MANTO_VOICE.md` — a long-form posture document grounded in Saadat Hasan Manto's writing discipline (start in the middle of something already happening, find a specific person, let contradictions stand, end on an image not a moral, never write *"this matters because"*) — with the instruction *"this is the standard for every piece Zeemish produces."*

**Decision.** Layer the doctrine onto the existing voice contract rather than replacing it. Two layers:
- **Doctrine** (`content/ZEEMISH_MANTO_VOICE.md` + `agents/src/shared/voice-doctrine.ts` mirror, exported as `VOICE_DOCTRINE`) — names the writing posture. The Drafter reads it before every piece. The Voice Auditor judges every piece against it. The Integrator obeys it when revising.
- **Contract** (`content/voice-contract.md` + `agents/src/shared/voice-contract.ts`, exported as `VOICE_CONTRACT`) — operational polish layer. Tribe-word list, length targets, the editor's read-aloud test. Mechanical and easy to check.

If they conflict, the doctrine wins. The contract is polish; the doctrine is the bar.

**The leverage move was the Drafter.** The previous Drafter prompt was a numbered list of rules ending in *"Return complete MDX with frontmatter."* — a textbook telling the writer not to write like a textbook. Adding more deductions to the auditor without resetting the Drafter would have just produced frustrated revise-loops where the Integrator sanded the same robotic prose. The new prompt opens with the doctrine inline, frames it as posture not checklist, and tucks the rendering-pipeline mechanics (`##` headings, MDX frontmatter, no JSX tags) at the end behind explicit *"these are not writing rules — they are format rules"* framing. The reflection prompt embeds the doctrine too so post-hoc self-evaluation judges against the standard, not the rules.

**The Voice Auditor was rewritten around posture, not arithmetic.** The previous auditor scored mechanical deductions (tribe word -10, flattery -15, "in this lesson" -20). It passed the cartel-gold piece at 95 because none of those triggered, even though the prose was robotic. The new prompt asks one hardest question first — *"Does this read like a person who has understood something telling another person what they found, or like a report being read into a microphone?"* — then itemises which named doctrine moves are off (hook arrives or summarises, close just sits or explains itself, contradiction held or resolved, Bishan-Singh-present or abstraction-only, no "this matters because", no agency-hiding passive, no "complex" hand-wave, Watch beat instructs or predicts), then layers the contract violations on top. Score reflects posture first, named moves second, contract third.

**Surgical edits to the surrounding agents** (none of these did the heavy lifting — the Drafter and Auditor are where the leverage lives):
- **Curator** — added a *"How the brief shapes the writing"* section to the prompt that constrains beat descriptions: hook description must specify the entry point not the framing, teaching descriptions must include a concrete anchor, close description must be one true thing not a takeaway, toneNote must reinforce posture not theme. Updated the JSON template from 4 beats to 5 to match the doctrine's 5–6 default.
- **Integrator** — added a *"trap to avoid"* paragraph naming the most likely failure mode of doctrine-aware revision: taming Manto-style writing in the name of polish. Short sentences correct, unresolved contradictions correct, sitting closes correct.
- **Voice contract** (`md` + `ts`) — added a *"Two layers"* preamble pointing at the doctrine as the deeper standard. The contract no longer claims to be the single source of truth.

**Naming.** The runtime constant is `VOICE_DOCTRINE`, not `MANTO_VOICE`. The doctrine's contents currently express the standard through Manto's posture, but the principle that must persist is *clear teaching, not robotic prose*. If the operator later swaps the .md file's contents (or renames it) for a different writer or framing, the prompts reference *"the Zeemish voice doctrine"* / *"the standing voice instruction"* — not Manto specifically — so the import path and prompt language stay stable. Only the file contents change.

**Verification before going live.** Wrote `agents/scripts/verify-doctrine.mjs` — a one-shot Node script that reads the prompts as text from source, reconstructs a brief from a published piece's frontmatter, and calls Claude Sonnet 4.5 directly. Ran an equivalent eyeball verification via subagent against the 2026-04-26 cartel-gold brief. The output was visibly better than the shipped 95-voice-score piece on the doctrine's named moves: hook arrived at the press instead of previewing the lesson, close was one sentence that just sat (*"The Mint stamps 'American' onto the bar because by the time the bar reaches the press, no other word is available."*), the contradiction got named and held (*"The system is not failing to do verification. The system is doing exactly the verification it was built to do."*), specific anchors throughout (the man paid in cash to dig the pit, the bank in Zurich that doesn't run an isotope test). Three small frontmatter format flags in the verification output (newSource typo, unquoted date, numeric estimatedTime) were attributable to the subagent's system-prompt overlay, not the prompt itself — the Drafter has been hitting frontmatter shape consistently since launch and the existing date-correction post-process at `drafter.ts:96` covers the residual.

**What this does NOT do:**
- Touch any published piece (permanence rule).
- Change anything reader-facing on the site (no UI, no copy, no styling).
- Add a runnable Manto eval harness — that's a future project. The first prod verification fires on the next 02:00 / 14:00 UTC cron.
- Change Structure Editor, Interactive Generator, or Interactive Auditor prompts. The Structure Editor's existing checks already cover the structural Manto rules (close = 1 sentence, hook = arrival). Interactive prompts inherit the contract via `${VOICE_CONTRACT}` import — the two-layer pointer propagates without direct edits.

**Trade-offs.**
- *Concentrated vs. distributed fix.* Considered spreading the doctrine across 8 prompts and 3 docs. Chose concentration: the Drafter is where writing happens, the Auditor is the gate, everything else is leverage that compounds. Distributed encoding multiplies dilution risk — every edit to one prompt without the others is a quiet drift point. Trade-off: the concentrated approach bets more on the Drafter prompt being right; if it's not, the next pass comes back to the same file. Acceptable: the prompt is at the leverage point and verification before deploy de-risked the bet.
- *Replace contract vs. layer.* Considered replacing the operational contract with the doctrine. Lost the operational rules (tribe-word list, length targets, the editor's read-aloud test). Layering keeps both — doctrine for posture, contract for polish.
- *Posture-question Auditor vs. extended deductions.* Considered adding 6 new -15 deductions to the existing arithmetic auditor. The 95-score-on-robotic-prose failure mode showed arithmetic doesn't catch posture. Posture question first; arithmetic second. Risk: a posture-question auditor is more subjective and may produce noisier scores across runs. Mitigation: the named-moves list is enumerable; the contract layer underneath is still mechanical.

**Files touched:**
- New: `content/ZEEMISH_MANTO_VOICE.md`, `agents/src/shared/voice-doctrine.ts`, `agents/scripts/verify-doctrine.mjs`
- Updated: `agents/src/drafter-prompt.ts` (system prompt + reflection), `agents/src/voice-auditor-prompt.ts` (full rewrite), `agents/src/curator-prompt.ts` (brief-shape section), `agents/src/integrator-prompt.ts` (doctrine + restraint paragraph), `content/voice-contract.md` (Two layers preamble), `agents/src/shared/voice-contract.ts` (mirror)
- Docs: `CLAUDE.md`, `docs/DECISIONS.md` (this entry), `docs/AGENTS.md` (Drafter / Voice Auditor / Integrator paragraphs)

**Forward verification:** Watch the next 5–7 cron firings. Expected signal: hooks arrive at moments rather than previewing lessons; closes drop in length; specific anchors (people, numbers, places) appear in teaching beats; voice scores stay above 85 on real pieces because the auditor's posture question and the Drafter's posture line up. Failure signal: voice scores drop because the auditor catches doctrine moves the Drafter still doesn't land, or pieces ship at qualityFlag='low' because the auditor and Drafter disagree on what counts as arrival. If the second failure mode appears, the fix is a second-pass tightening of either the Drafter examples or the auditor's named-move criteria — not loosening the gate.

## 2026-04-27 (followup): Media Session API for background mobile audio

**Context / trigger:** Operator listening on mobile with headphones — locked the screen / pocketed the phone, audio kept playing for a few minutes, then stopped. Reproduced on the 2026-04-27 Ben Sasse piece. Mobile browsers (iOS Safari, Android Chrome) throttle and eventually suspend `<audio>` playback on tabs that haven't registered themselves as a "media session". Without that registration the OS can't tell the difference between a teaching piece's audio and an ambient page sound, so it deprioritises the tab once the screen locks. Auto-advance between per-beat clips compounds the failure — even if the first clip somehow keeps playing, the `audio.src = nextUrl + audio.play()` transition needs an active media session to autoplay in the background.

**The decision:** wire the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API) into [`<audio-player>`](../src/interactive/audio-player.ts). On `connectedCallback`:

1. **Set `navigator.mediaSession.metadata`** with the piece headline (passed in via new `data-piece-title` attribute, threaded from [`AudioPlayer.astro`](../src/components/AudioPlayer.astro) ← [`LessonLayout.astro`](../src/layouts/LessonLayout.astro)), `artist: 'Zeemish'`, `album: 'Beat N of M · {Title}'`, and one artwork entry pointing at the existing `/og-image.png`. Refreshed inside `loadBeat` so each beat advance updates the lock-screen subtitle.
2. **Register action handlers** for `play` / `pause` / `previoustrack` / `nexttrack` / `seekto` so the OS lock-screen controls + headphone buttons + Bluetooth remotes drive the player.
3. **Update `playbackState`** in `updatePlayIcon` to reflect real audio state (`'playing'` / `'paused'`), and **clear metadata + state to `'none'`** in `disconnectedCallback`.
4. **Throttled `setPositionState`** writes (≤1 Hz) on `timeupdate` so the lock-screen scrubber and elapsed-time stay accurate.

The combined effect: the OS treats the page as a real media session, prevents background suspension on screen lock, and gives the reader proper lock-screen / AirPods controls.

**Trade-offs considered:**

- **Media Session API vs. concatenating all beats into a single MP3.** Chose Media Session. The single-MP3 alternative would eliminate the cross-beat boundary entirely (no autoplay-after-`ended` to fail) but loses per-beat captions, prev/next stepping, smooth-scroll-to-beat on auto-advance, and bloats R2 cost (no per-beat caching). Media Session is the standard pattern every podcast / music PWA uses for exactly this scenario.

- **Should we ask the user for a permission prompt?** The user offered. Rejected — there is no browser-level "background audio" permission to request. Media Session is permissionless; the OS infers legitimacy from the metadata + handler registration. Adding any kind of pre-flight prompt would be theatre.

- **Artwork: dynamic per-piece OG vs. one static `/og-image.png`.** Static. The site doesn't yet ship per-piece OG images (still in "remaining minor items"). When that work lands, the artwork array gets one extra line and inherits automatically.

- **iOS Safari residual hiccup.** Even with Media Session set correctly, iOS Safari occasionally hiccups crossing audio `src` boundaries while the screen is fully locked — readers may need to tap lock-screen play once to resume. Documented openly to the user; it's a platform limit (not buyable down with more code).

- **Throttle position-state at 1 Hz.** `timeupdate` fires ~4× per second; writing `setPositionState` on every fire would be wasteful. 1 Hz is more than enough for the lock-screen scrubber, which doesn't render sub-second granularity.

- **Clear metadata on `disconnectedCallback`.** Otherwise stale "Beat 3 of 6 · The Pattern" lingers on the OS surface after the reader navigates away. Defensive cleanup.

**Files changed:**
- [`src/interactive/audio-player.ts`](../src/interactive/audio-player.ts) — `connectedCallback` reads `data-piece-title`; `installMediaSessionHandlers` registers the 5 action handlers; `refreshMediaSessionMetadata` sets per-beat metadata; `maybeWritePositionState` writes throttled scrubber position; `updatePlayIcon` mirrors `playbackState`; `clearMediaSession` runs on disconnect.
- [`src/components/AudioPlayer.astro`](../src/components/AudioPlayer.astro) — accepts new `pieceTitle` prop, passes through as `data-piece-title`.
- [`src/layouts/LessonLayout.astro`](../src/layouts/LessonLayout.astro) — threads `title` into `<AudioPlayer pieceTitle={title}>`.
- [`docs/DECISIONS.md`](DECISIONS.md) — this entry.

**Verification:** `pnpm build` clean. Dev preview against the 2026-04-27 Ben Sasse piece — confirmed `data-piece-title="What We Owe the Dying"` flows through; `navigator.mediaSession.metadata` set on mount with `{title: 'What We Owe the Dying', artist: 'Zeemish', album: 'Beat 1 of 5 · Hook'}` + artwork pointing at `/og-image.png`; clicking the next-beat button refreshes album to `'Beat 2 of 5 · Dignity Systems'`; `setPositionState` fires once per timeupdate (1 Hz throttle confirmed); zero console errors. Real lock-screen verification needs an iOS or Android device — out of scope for headless preview, but the wiring matches the spec.

**Rollback:** plain `git revert` — three files, no schema, no migration.

## 2026-04-27 (followup): Gap-list redesign — single flat row per piece, slug-inclusive URLs

**Context / trigger:** First iteration of the "Pieces missing interactives" subsection (commit `6b6ed8a`) shipped a two-column layout (No quiz · No HTML) with each piece appearing in BOTH columns when it lacked both interactives. Operator review caught two real flaws:

1. **Same piece listed twice with two separate "Open admin →" links** — both go to the same per-piece admin page, so the duplication adds nothing and crowds the list.
2. **Date-only URLs are ambiguous at multi-per-day** — `adminPieceHref` returned `/dashboard/admin/piece/<date>/` and the redirect handler at the legacy date-only route shows a disambiguation list when two pieces share a date (e.g. the 2026-04-22 air-traffic + tobacco pair from the `interval_hours=12` era). Operator clicking "Open admin" from the gap list on either of those landed on the disambiguation page, not the piece. Reasonable but surprising.

**The fix:**

- **One unified gap query** returning per-piece `(has_quiz, has_html)` flags via `EXISTS (...) AS has_quiz_int, EXISTS (...) AS has_html_int`. Filters to pieces missing at least one type. Newest-first, capped at 30 unique rows.
- **Single flat list** — one `<li>` per piece. Status pills inline (`quiz ✓ · html ✗` etc.) using emerald for has, amber for missing. One Open link per row.
- **Slug-inclusive URL** via new `adminPieceHrefSlug(date, pieceId, slug)` helper. Slug sourced authoritatively from the dailyPieces content collection (`deriveSlug(entry.id)` strips the date prefix from the MDX filename). Falls back to date-only URL when the content collection entry is missing (legacy pre-Phase-7 piece without `pieceId` frontmatter — should never happen on prod today, but the fallback keeps the link clickable).

**Trade-offs considered:**
- **Single list vs. two columns.** Single. The two-column layout treated "no quiz" and "no html" as separate concerns, but they're properties of the same piece. The Catalogue card's count line ("X pieces have no quiz · Y pieces have no HTML interactive") still surfaces the per-type breakdown for an at-a-glance read; the table doesn't need to repeat it.
- **Show status pills for ALL pieces or only the missing types.** Both. `quiz ✓ · html ✗` is more honest than `missing: html` because it shows the operator the FULL state of the piece's interactives in one glance — useful when the catalog grows and "what's there" matters as much as "what's missing".
- **Cap at 30 vs. show all gaps.** 30. Operator scrolls a list of 30 rows comfortably; 50+ would need pagination. The exact total is in the count line above; if the cap fires for a real backlog, future work adds pagination.
- **Re-derive slug from headline vs. read content collection.** Read content collection. Director's `headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)` is deterministic but the 60-char truncation can be mid-word (Ben Sasse → `…reflects-on-family-fait`); the actual MDX filename is what shipped at publish time. Content collection is authoritative; the cost is one `getCollection('dailyPieces')` call which is already cached by Astro.

**Files changed:** [`src/pages/dashboard/admin/interactives/index.astro`](../src/pages/dashboard/admin/interactives/index.astro) — frontmatter (content collection import + slug map + unified GapPiece type + single SQL query) + UI (single flat list replacing two columns) + new `adminPieceHrefSlug` helper. [`docs/DECISIONS.md`](DECISIONS.md) — this entry.

**Verification:** `pnpm build` clean. Local D1 fixture (4 pieces — 1 with quiz only, 3 with neither): rendered as 4 unique rows in single list; Hormuz row reads "quiz ✓ · html ✗" with slug-inclusive link `/dashboard/admin/piece/2026-04-18/oil-prices-plunge-as-iran-says-strait-of-hormuz-open-during-/`; legacy fixture rows without content-collection entries fall back to date-only URLs as designed. No console errors.

## 2026-04-27: Two-row interactive admin section + honest list-page footnote

**Context / trigger:** The 2026-04-27 Ben Sasse piece's HTML interactive failed to generate (`parseAndValidateHtml: Claude returned non-JSON output` — model-side flake). The system's own observer event told the operator to "retry from admin or via /interactive-generate-trigger once the cause is fixed", but the admin had no button for this state:

- Per-piece admin page (`/dashboard/admin/piece/<date>/<slug>/`) hides its retry button whenever `daily_pieces.interactive_id IS NOT NULL`. Since a quiz row exists for the piece, the column is set, button is hidden, even though the HTML companion is missing.
- Interactives list page (`/dashboard/admin/interactives/`) shows a count of pieces missing each type, but its per-row "Regenerate" button calls `regenerateInteractive()` which requires an existing row of the target type to delete first — so it can't bootstrap a missing-from-day-one HTML.

The only retry path was `curl POST /interactive-generate-trigger?piece_id=X` with `ADMIN_SECRET`. That violates the operator's stated preference (`feedback_admin_ui_over_shell_secret`) and contradicts the observer event's own copy.

**The decision:**

1. **Per-piece admin page becomes two-row.** Drop the legacy single-row Interactive section (which read off `daily_pieces.interactive_id`, the pre-Phase-2 quiz pointer). Replace with two stacked rows scoped by `(source_piece_id, type)` — Quiz · {state} and HTML · {state}. Each row owns its own state machine:
   - Row exists → "published ✓" + voice/revisions/low-quality badge + **Regenerate** button (destructive, with confirm dialog).
   - Row missing → "not generated" + last failure reason inline (read from observer events) + **Generate** button (idempotent — fires `/api/agents/interactive-retry` which dispatches to `/interactive-generate-trigger`; the generator's per-type idempotency at [`interactive-generator.ts:306`](agents/src/interactive-generator.ts) skips the existing sibling type and only runs the missing one).
   - Row missing AND `type='html'` AND `interactives_html_enabled=false` → disabled button with "Flip the toggle on /dashboard/admin/settings/" hover hint. Renders separate "Open settings →" link as a discoverability bonus.

2. **Interactives list page footnote replaced.** Old copy ("Generate via the per-piece admin page when needed") was a lie — the per-piece page didn't actually expose generate-HTML. New copy ("See the gap list below to open any piece's admin page where Generate buttons live") points at a new "Pieces missing interactives" subsection between the catalog and cost cards. Two-column layout (No quiz · No HTML), 20 most-recent gap-pieces per type, each row deep-links to per-piece admin via the existing `adminPieceHref(date, pieceId)` helper.

3. **No agent-side changes, no schema change, no new endpoints.** Both endpoints (`/api/agents/interactive-retry` for bootstrap-missing, `/api/agents/interactive-regenerate?type=Y` for destructive-regen) already exist. The frontend just needed to call the right one based on row state. The agents-side generator's per-type idempotency was already correct from Phase 2 of Interactives v3.

**Trade-offs considered:**

- **Per-piece deep-dive vs. interactives list page as the primary surface.** Chose per-piece. Rationale: when an HTML interactive is missing, the operator usually arrived from the observer feed or from clicking through a daily piece — they're investigating ONE piece. The interactives list page is the catalog/quality view; bootstrapping is a per-piece operator action. The list page got a discoverability surface (gap-piece subsection with deep-links) but doesn't host the buttons themselves. This avoids two near-identical button surfaces in two places.
- **UI button vs. asking operators to curl.** UI button. The system itself emits "retry from admin" in observer events; making admin not have a button violates that contract. Operator memory `feedback_admin_ui_over_shell_secret` reinforces it. The cost is a ~150-line .astro change; the win is the workflow no longer requires shell + secret for a recurring state.
- **Generate-HTML disabled-when-flag-off vs. hidden-when-flag-off.** Disabled, with hover tooltip + "Open settings →" link. Hiding it would make the "no html" state silent — which is exactly the original problem this entry exists to fix.
- **Confirm dialog on regenerate, not on generate.** Generate is idempotent and non-destructive; regenerate wipes the existing D1 row + git file + audit history. The cost asymmetry justifies asymmetric confirms.
- **Surface inline failure reason on the missing-row state.** Yes. The observer events section already shows it, but it's collapsed under a `<details>` and the operator has to scroll. Surfacing inline ("Last failure: `parseAndValidateHtml: Claude returned non-JSON output`") immediately tells the operator whether to retry-and-hope (model flake) or investigate-the-prompt (validator-max-fail) without leaving the section. Read from `observer_events WHERE title LIKE 'Interactive generation failed:%' ORDER BY created_at DESC LIMIT 1`.
- **Use existing `adminPieceHref(date, pieceId)` (date-only URL with redirect handler) vs. derive slug-inclusive URL on this page.** Use the existing helper for consistency with the rest of the list page. The redirect handler at the legacy date-only route resolves to slug-inclusive in the unambiguous case and to a disambiguation list at multi-per-day — both correct.

**Specifically NOT in this decision:**
- Does not extend `regenerateInteractive` to handle missing rows. Its destructive contract is the right shape for "regenerate something that already exists"; bootstrapping is `generate()` via `/interactive-generate-trigger`, which already works correctly.
- Does not change `interactives_html_enabled` default — the flag is intentionally opt-in per migration 0024.
- Does not auto-retry failed interactives. The post-publish alarm fires once; retry is operator-initiated. Auto-retry would mask quality signals (a deterministic prompt-or-validator bug would silently consume Claude credits on every cron).

**Files changed:** [`src/pages/dashboard/admin/piece/[date]/[slug].astro`](../src/pages/dashboard/admin/piece/[date]/[slug].astro) — frontmatter queries (quiz row, html row, html flag, last failure event) + two-row Interactive section UI + delegated client JS for state-aware Generate/Regenerate dispatch. [`src/pages/dashboard/admin/interactives/index.astro`](../src/pages/dashboard/admin/interactives/index.astro) — gap-piece queries + new "Pieces missing interactives" subsection + footnote text. [`CLAUDE.md`](../CLAUDE.md) — new section under Interactives v3 narrative. [`docs/DECISIONS.md`](DECISIONS.md) — this entry.

**Verification:** `pnpm build` clean (all routes prerender, no type errors). Local D1 seeded with the Ben-Sasse-shaped state (Hormuz piece + only-quiz interactive + observer warn event with parse-failure reason + admin user + `interactives_html_enabled=true`). Per-piece admin page rendered with summary "quiz ✓ · no html", Quiz row showing "published ✓" + Regenerate button (`data-type="quiz"`, `data-action="regenerate"`), HTML row showing "not generated" + inline failure reason `parseAndValidateHtml: Claude returned non-JSON output` + Generate HTML button (`data-type="html"`, `data-action="generate"`). Interactives list page rendered the gap subsection with correct counts (3 missing quiz, 4 missing html in the local fixture) and deep-links to per-piece admin. Zero console errors. Production verification deferred to first operator click on the new buttons (next handoff step is the Ben Sasse retry).

## 2026-04-26: Holistic simplification audit — what's well-designed, what's unnecessarily complex, what's missing or fragile (refinement Action 5)

**Context / trigger:** Refinement brief Section 1.5 asked: *"What is the simplest version of this system that does the same job?"* Not a refactor proposal — a clear-eyed audit producing three lists Zishan can act on (or not). The system is mature (16 agents, 19 tables, 23 migrations, two workers, audio + interactives + library + dashboard all live). "Everything's fine" is not a useful answer; "here's what to leave alone, here's what to clean up later, here's where the brittleness lives" is. This entry is that audit.

**No code change in this entry.** Schema work is out of scope per the brief; `DROP COLUMN` / `DROP TABLE` / refactor proposals are not on the table here. This is record only.

### Well-designed — leave alone

- **`daily_piece_audio` per-beat row keying** — `(piece_id, beat_name)` PK after the migration 0015 rebuild. Producer writes, Auditor reads, Publisher reads for frontmatter splice, transparency drawer reads. Clean separation; supports per-beat retry without table-level locks; PK rebuild was well-documented at the time.
- **`learnings` source/category orthogonal axes** — source (reader / producer / self-reflection / zita) and category (voice / structure / fact / engagement) are independent. Supports future axis additions without schema change. Defensive enforcement at the application layer even with nullable columns. Evidence of thoughtful design.
- **`admin_settings` as a key-value table** — extensible foundation for operator control without redeploys. `interval_hours` lives there today; future rate limits, feature flags, scanner overrides land in the same shape. Seeded cleanly with fallback-on-missing pattern at every read site.
- **Observer multi-dimensional logging** — severity + context + piece_id (after migration 0020). Piece_id scoping lands consistently across all three day-keyed tables. Defensive 36h fallback for legacy NULL rows. Matches the "no silent failure" principle without coupling agents to admin UI.
- **Audio Auditor as a separate agent (not collapsed into Producer)** — brief explicitly asked whether Auditor could be inlined as "R2 object exists + size sensible" inside Producer. Verdict: KEEP. Producer is already complex (TTS normalisation, request-stitching, retry logic, 20k-char budget). Collapsing Auditor would create a monolithic generate-and-validate agent with mixed failure modes (a Producer success with Auditor failure currently surfaces as a clean retriable state via admin dashboard; collapsed, it would surface as a Producer failure that's actually a validation problem). The current shape isolates failure modes; the cost is one extra DO and one extra method call per piece — minimal.
- **Dashboard surface choices** — operator-focused on `/dashboard/`, reader/per-piece data deliberately separated to per-piece admin pages. Surfaces operator decisions (tier mix, escalations, fact-check offline state, rounds, candidates) at glance-able density. Brief asked whether the dashboard reflects operator needs or "what was easy to build" — verdict: matches stated purpose. Two surfaces hold up the operator/reader split.

### Unnecessarily complex — candidates for future cleanup (no DROPs proposed here)

- **`submissions` table** — scaffolded in `0001_init.sql` for course-era "practice data (breathing timer results, etc.)". Courses were deleted in Stage 5 (per ARCHITECTURE.md). Zero writers and zero readers in the daily-pieces era. Ghost table. The `practice` beat type referenced in `structure-editor-prompt.ts` would in theory generate submission data, but no interactive harness wires the writer. Table consumes schema space and cognitive load for zero current value. **Cleanup move when ready:** drop `submissions`; if a future practice harness needs reader-state persistence, design it from the requirements then. Path-of-least-resistance migration.
- **`progress` table** — 13 lifetime writes, all course-shaped (`course_slug`, `lesson_number`). Anonymous-user progress that's never queried at runtime for any feature. Designed for the lessons era; daily pieces don't use lesson-numbered progress (they use the engagement table for view/complete/audio_play events instead). **Cleanup move when ready:** drop `progress` in the same session that deprecates the lessons-course read path from `/api/zita/chat`.
- **`daily_pieces.has_interactive` INTEGER column** — explicitly deprecated in `0022_interactives.sql` ("always 0 in production" per CLAUDE.md notes). The actual signal lives in `daily_pieces.interactive_id` (nullable, populated by the Generator). Column was kept physical because SQLite `DROP COLUMN` requires a `daily_pieces` table rebuild with 6+ FK-referencing tables, which the team judged not worth the blast radius. **Verdict:** acceptable trade-off — the column is harmless dead weight, the rebuild cost is real. Documented in SCHEMA.md. Leave physical; revisit only if a future migration is touching `daily_pieces` for an unrelated reason and can absorb the rebuild for free.

### Missing or fragile — gaps that create real risk

- **No test coverage for multi-per-day piece-id split logic.** Migrations 0018 + 0019 backfilled `piece_id` via date-join (pre-2026-04-22) and timestamp midpoint split (2026-04-22 same-day pieces). The split logic is deterministic but the backfill was one-time manual work. Zero automated regression test. If a future multi-per-day run has clock skew (server time drifts mid-pipeline) or timezone issues (the gate uses UTC; a publisher commit could in theory land in the next UTC day), the split breaks silently. **What would close this:** a small fixture-based test in `agents/scripts/` that asserts `splitPieceIdByMidpoint([{published_at: t1}, {published_at: t2}]) === expectedSplit` across edge cases (identical timestamps, single-piece days, three-piece days at 8h interval). Out of scope for this session.
- **Audio CDN cache invalidation on per-beat regen.** R2 audio objects use `Cache-Control: public, max-age=31536000, immutable` (1-year edge cache). Per-beat regen (added 2026-04-23) writes new content to the same R2 key → same URL → returning readers may keep hearing the stale MP3 until browser/CDN cache expires. Hard-refresh bypasses; admin UI surfaces "hard-refresh to confirm" copy on the per-beat Regenerate button. Already documented in CLAUDE.md "Remaining minor items" and FOLLOWUPS. **Not new; not closed; named here for completeness.**
- **`pipeline_log.run_id` semantic dual-life.** Still date-shaped (`YYYY-MM-DD`) per the 2026-04-21 walk-back, with `piece_id` column added alongside in migration 0018. Two columns serving overlapping purposes — `run_id` answers "what day did this run", `piece_id` answers "what piece did this row belong to". Day-grouping views still need `run_id`; per-piece admin uses `piece_id`. The dual-life is functional but creates mental friction: a future session needs to commit one way (drop `run_id` and rebuild day-grouping queries on `piece_id JOIN daily_pieces.date`, or formally name `run_id` as a denormalised day-key and document that contract). **Already documented in DECISIONS 2026-04-21 walk-back; named here so future-cleanup planning can find it from this entry too.**
- **Voice contract duplicated across three surfaces** *(new finding from this refinement session — Actions 1 + 2)*. The contract lives in `content/voice-contract.md` (canonical), `agents/src/shared/voice-contract.ts` (TS string mirror), and (until Action 2) the StructureEditor prompt at `agents/src/structure-editor-prompt.ts` carried a paraphrased version of the same rules. The .md/.ts duplication is documented in AGENTS.md "Known limitations" as "manual sync required"; the StructureEditor instance was a third copy that read like a paraphrase. Action 2 fixed StructureEditor's specific stale rule (1500–2500 word ceiling that didn't match production); the underlying duplication risk remains. **What would close this:** either generate the .ts mirror from the .md at build time, or wire a CI check that fails the build if `agents/src/shared/voice-contract.ts` content diverges from `content/voice-contract.md`. Out of scope for this session.
- **Agent prompts can silently drift from system reality** *(new finding from Action 2's StructureEditor CHECK #6 fix)*. CHECK #6 required `<lesson-shell>` / `<lesson-beat>` JSX tags that the Drafter prompt explicitly forbids and the rehype-beats build step generates from `## kebab-case` headings. The rule was literally unsatisfiable; the auditor's "Be reasonable" instruction at line 20 meant it was tolerated, not flagged. This is a class of bug — agent prompts that name system surfaces (filenames, tag names, frontmatter fields) can rot when the surfaces change. **What would close this:** a small CI check that greps agent prompt strings for forbidden tag names (`<lesson-shell>`, `<lesson-beat>`, `<beat>`) given that the system uses heading-based syntax. More broadly, any "the prompt names a surface" pattern wants either a single-source-of-truth constant or a CI assertion.

### Specific brief questions, answered

- **Are there D1 tables that exist but are never queried, or queried in only one non-critical place?** Three: `submissions` (zero writers/readers), `progress` (13 writes, no reads at runtime), and the `daily_pieces.has_interactive` column. Listed above with verdicts.
- **Is Audio Auditor genuinely necessary, or is "R2 exists + size sensible" enough inline in Producer?** Genuinely necessary. Separation of concerns is real, not vanity. Detail above.
- **Is Observer logging everything it should? Anything it shouldn't?** Just-right. 13 piece-scoped helpers agent-side, 4 system-scoped site-side. The asymmetry (no piece_id on the 4 site-worker call sites) is documented and intentional — site-side threading would require `<zita-chat>` to receive and forward `piece_id`, a cross-cutting refactor deferred for now. One brittleness: backfill across migrations 0014/0018/0019/0020 relied on manual `wrangler d1 execute` with no CI gate. Acceptable given the Phase 3 schema-fix closure; future observer schema work should add an assertion or query test.
- **Does the dashboard surface what Zishan actually needs?** Yes. Public `/dashboard/` is intentionally operator-focused (tier mix, escalations, fact-check offline state, rounds-per-piece, candidates-per-day). Reader/per-piece metrics deliberately separated to `/dashboard/admin/piece/[date]/[slug]/` per the operator/reader split principle. Operator can drill from the dashboard's Recent Runs into the per-piece deep-dive in one click. Matches stated purpose.

**Trade-offs considered:**
- **Propose specific cleanup actions vs. just record findings.** Just record findings. Brief said: *"not a refactor, just a clear-eyed record of what's simple, what's complex, and what's fragile. Zishan reads this to decide what to act on."* Listing actions would invite drift between this audit and FOLLOWUPS; deferring to Zishan's judgment per item is the cleaner separation.
- **Add new FOLLOWUPS entries for the new findings (voice contract duplication, prompt-drift class).** Decided: add the duplication-CI-check and prompt-drift-CI-check as FOLLOWUPS observations in a follow-up session if Zishan wants them tracked actively. They're named in this DECISIONS entry; that's enough trail to find them. Adding both to FOLLOWUPS now would make this audit louder than its scope.
- **Frame as "complexity to remove" vs. "stability to preserve".** Frame as both. The well-designed list matters as much as the unnecessarily-complex list — the system runs the way it does because most surfaces ARE well-designed, and a refactor proposal that didn't acknowledge that would over-correct.

**Files changed:** [`docs/DECISIONS.md`](DECISIONS.md) — this entry only. [`CLAUDE.md`](../CLAUDE.md) — Currently working on covers Action 5. No code change, no schema change, no prompt change.

**Verification:** Documentation-only. Read the entry. Each "Unnecessarily complex" item has an honest "leave physical, revisit when" verdict; each "Missing/fragile" item has a "what would close this" note. If a Zishan reading this would say "this is wrong" or "this is missing X", the audit needs sharpening. The session's own findings (voice contract duplication, prompt-drift class) live alongside the original research findings — both are honest.

## 2026-04-26: Agent characters land in-place in docs/AGENTS.md, not a separate file (refinement Action 4)

**Context / trigger:** Refinement brief Section 1.2 named a real gap — every agent's documented behaviour was function description ("Curator picks the most teachable story", "Drafter writes the MDX") with no character description (what does this agent care about, what would it be ashamed of, how does it approach its work). Research found 1 of 16 agents (Curator) had implicit character today through the 2026-04-25 reframe; 4 had partial character (Drafter, Learner, Categoriser, InteractiveGenerator); the other 11 were function-only descriptions. The brief proposed a new `docs/AGENT_CHARACTERS.md` file referenced from system-prompt headers. Research recommended in-place expansion of each agent's section in `docs/AGENTS.md`.

**Decision:** In-place expansion in `docs/AGENTS.md`. Each agent's section now opens with **Role** (what it does) followed by **Character** (who it is). The brief's proposal of a separate file is overridden in favour of single source of truth per agent.

**Why in-place over separate file:**
- **Maintenance burden.** Two files describing the same 16 agents drift apart over time. The character of an agent shifts when its prompt is revised (e.g., the 2026-04-25 Curator reframe), and updating one file but not the other is a real risk. Co-location forces one update site.
- **Reading flow.** A reader landing on AGENTS.md to understand Curator naturally wants to know what Curator does AND who Curator is. Splitting them across files signals "character is supplementary documentation" — exactly the framing the brief wanted to avoid.
- **System-prompt injection question.** The brief proposed referencing AGENT_CHARACTERS.md from system-prompt headers, which would make character a runtime-injected context. That's a separate decision worth its own consideration (does Drafter actually need its character text in its prompt, or is the character expressed sufficiently through the rules and the voice contract?). In-place documentation now keeps the runtime-injection question open without forcing it.

**Why this overrides the brief:** The brief is explicit about the file location ("What to write: A `docs/AGENT_CHARACTERS.md` file"). Overriding the brief's letter while honouring its spirit is justified here — the brief's spirit is "character should be load-bearing, not optional metadata", and that's better served by in-place expansion than a separate file. Surfaced via AskUserQuestion at plan time; Zishan picked in-place.

**The 16 paragraphs.** Each is 3–5 sentences and covers (1) what the agent fundamentally cares about (orientation), (2) what character failure looks like (distinct from technical failure), (3) how it should approach its work. Examples of the orientation-not-function framing:
- Scanner cares about not missing things (orientation), failure = deciding what's "interesting" (character failure, not a code bug), approach = pull wide and let downstream decide.
- Drafter writes for the reader who gives it ten minutes (orientation), failure = hedging language that asks the reader to do less work than they're capable of (character failure, distinct from missing the voice score floor), approach = trust the reader.
- Publisher treats a published piece as a fact in the world (orientation), failure = a soft overwrite "to fix a typo" (character failure, distinct from `publishToPath` throwing on overwrite — that's the mechanism, character is the *why*), approach = write once, verify, never edit.

**Trade-offs considered:**
- **Hybrid: characters in AGENTS.md + a short standalone manifesto file.** Considered as the AskUserQuestion's third option. Zishan picked pure in-place. The shared cross-cutting principles are now captured in design principle #8 instead of needing a manifesto file.
- **System-prompt injection now vs. later.** Deferred. The 2026-04-25 Curator reframe and Action 1's voice rewrite both showed that character can be injected through tightening the rules in the prompt itself (the voice contract is character for VoiceAuditor; the TEACHABILITY examples are character for Curator). A separate "character text" injection might or might not add value — observe over the next few cron runs whether the documented characters help operators reason about the agents, then decide whether to inject.
- **Update each agent's prompt file with a character header.** Not now. Prompt files are runtime artefacts; AGENTS.md is documentation. Mixing them couples documentation to deployment. If runtime injection becomes the answer in a future session, that's the time to touch the prompt files.

**Files changed:** [`docs/AGENTS.md`](AGENTS.md) — 16 Character paragraphs inserted (one per agent, immediately after the Role line) + design principle #8 added at the top of the file. [`CLAUDE.md`](../CLAUDE.md) — Currently working on covers Action 4. No code change, no schema change, no agent refactor.

**Verification:** No runtime check — character work is documentation. Verify by reading docs/AGENTS.md cover-to-cover after the commit. Test: pick any agent at random, read its section, ask "could I tell what kind of bad output would embarrass this agent?" If yes, the Character paragraph is doing its job. If not (still reads as function description), the paragraph needs sharpening.

## 2026-04-26: Curator TEACHABILITY expanded from 8 to 14 worked examples (refinement Action 3)

**Context / trigger:** Refinement brief Section 1.3 named eight categories of story Zeemish should treat as visibly teachable: social conditioning, human rights & welfare, psychological/cognitive patterns, environmental systems, technology & daily life, money & ordinary life, health systems, culture & language. The 2026-04-25 reframe of the Curator prompt added eight worked examples to TEACHABILITY (crime, celebrity/culture, supply chain, science, policy, business, tech announcement, death/loss/dignity) — a strong baseline, but biased toward the categories news RSS feeds surface cleanly. Stories that *land* under BUSINESS but *teach* personal-finance mechanics (rent-setting, insurance pricing) had no example pattern to match against; same for HEALTH (diagnostic reasoning), TECHNOLOGY (the device-in-your-pocket angle), and so on. The risk wasn't Curator skipping these — it was Curator framing them through the wrong system (e.g., rent stories framed as market-structure when the teachable system is personal financial mechanics).

**Decision:** Expand TEACHABILITY from 8 to 14 worked examples. Don't replace the existing eight — add six more alongside, sharpen one (culture/celebrity to name the propagation mechanism), and clarify the existing tech-announcement example as "market angle" so the new mechanism-focused tech example reads as distinct.

**The six new categories and their underlying-system framings:**
- **Social conditioning** → how norms harden into defaults, how invisible pressure shapes behaviour, what makes a practice "the way things are done", who benefits when defaults stay invisible
- **Psychological / cognitive patterns** → cognitive biases, how attention works, why people change their minds (or don't), the mechanics of belief formation and revision — same lens as crime-psychology but standalone, not anchored to violent news
- **Environmental systems** → ecological mechanics (food chains, soil cycles, population dynamics, feedback loops), what happens when one node fails, the difference between robust and brittle systems in nature
- **Money / ordinary life** → how rent gets set, how insurance prices risk, how a wage negotiation actually moves, what mortgage underwriting looks like, the personal-finance systems that quietly shape daily decisions
- **Health systems** → how a diagnosis is reached, what a clinical trial actually tests, how triage decides who goes first, how evidence becomes practice
- **Technology / daily life** → how the device in your pocket actually works, what a recommendation algorithm is doing, how attention and friction get designed in, what data flows where (different from the existing market-angle example — this is the mechanism's effect on the daily user)

**One sharpened example:** celebrity/culture extended to name "how cultural practices spread and die, how words shift meaning" — the mechanism the brief specifically called out as missing. Parasocial relationships were already there; propagation wasn't.

**One reframe (no content change):** the original "Tech announcement" example renamed "Tech announcement (market angle)" so it reads as distinct from the new daily-life mechanism example. Both are valid; they teach different systems.

**One header-line tweak:** "Examples:" → "Examples (not a whitelist — a breadth-showing set)". Curator was already running through the existing 8 as visibility, not a gate, but the new list is long enough that being explicit is worth it.

**Trade-offs considered:**
- **6 new vs. all 8 from the brief.** Brief proposed 8; research found 2 of those (policy/institutional incentive design and another partial overlap) already covered well by existing examples. Adding 6 + sharpening 1 covers the brief's intent without doubling-up. Result is 14 total, not 16.
- **Add to existing list vs. restructure into named buckets.** Add to existing list. The flat list reads as "look at the spread of what teaches"; named buckets would invite Curator to treat them as classification tags ("which bucket does this candidate fit?"), exactly the gate-keeping posture the 2026-04-25 reframe killed.
- **Add to TEACHABILITY criterion vs. create a new category-awareness criterion.** Add to TEACHABILITY. The brief's 8 categories are *kinds of system*, not a separate selection axis. Creating a new criterion would risk Claude treating them as a checklist; embedding them as TEACHABILITY examples keeps them as visibility for the existing criterion.
- **Update Scanner feed sources too.** Not now. Research surfaced that Google News RSS's 6 categories (TOP/TECH/SCIENCE/BUSINESS/HEALTH/WORLD) don't map cleanly to teachability categories — a rent-setting story lands under BUSINESS, a diagnostic-reasoning story lands under HEALTH, but Curator has no awareness that BUSINESS often teaches personal finance OR market structure. The fix is at the Curator-prompt layer (this commit), not the Scanner feed-source layer. Source widening can come later if we observe genuine sourcing gaps; today's pipeline pulls 50 candidates from existing feeds and Curator's blindness was at interpretation, not supply.

**Files changed:** [`agents/src/curator-prompt.ts`](../agents/src/curator-prompt.ts) (TEACHABILITY block), [`docs/AGENTS.md`](AGENTS.md) (Curator section gains a 2026-04-26 expansion bullet), [`book/09-the-sixteen-roles.md`](../book/09-the-sixteen-roles.md) (Curator chapter extends "What 'teachable' means" with the 14-example reality), [`CLAUDE.md`](../CLAUDE.md) (Currently working on covers Action 3). No code change beyond the prompt constant; no schema change; no agent refactor.

**Verification:** Curator pick reasoning over the next 5–7 cron runs (≈2026-04-28 → 2026-05-03 at `interval_hours=12`). Look for novel category framings in `daily_pieces.underlying_subject` — *"diagnostic reasoning"*, *"how rent-setting works"*, *"ecological mechanics"*, *"the device-in-your-pocket angle"*. If pieces continue to cluster around the existing 8 categories with no new framings appearing, the prompt change didn't take and the bias is deeper than the example set (revisit with a stronger directive). If novel framings appear AND voice-tier average stays ≥85, the expansion worked. FOLLOWUPS observation entry queued for 2026-05-03 unblock.

## 2026-04-26: Area 5 post-tag polish pass (4 commits)

**Context / trigger:** First reader walkthrough of the area-5-done build surfaced four small misfires that Phase D's structural verification didn't catch — visible only when sitting with the surface as a reader rather than poking it as an engineer. Each is small enough to ship as its own commit on top of the `area-5-done` tag rather than retroactively edit the closed area.

**Decision:** Keep `area-5-done` where it is; ship the four fixes as `area-5.4` through `area-5.7` on main. The original close-out tag still marks "what we shipped at the close of Area 5"; these polish commits are honest evolution past it. Mid-area retroactive tag motion would have made the rollback story confusing — `area-5-snapshot → area-5-done` is the contract; if a future fifth-area session needs a clean reference point, it can tag at `b480080`.

**The four fixes:**
- **`dd9c602` — MadeBy → small info button + iframe auto-resize.** Block-level "How this was made" affordance was sitting between beats and the inline interactive section drawing CTA-level attention; shrunk to `ⓘ How this was made` info-icon pill anchored below the finish state. New render-time HTML wrapper at `src/lib/interactive-html.ts` injects a postMessage resize probe into srcdoc so HTML interactive iframes auto-size to content (no nested scrollbar inside the page's own scroll). Stored content untouched — render-time wrap only.
- **`a0f2aee` — Zita toggle is a question-mark circle.** Floating "? Ask Zita" pill was reading as a CTA competing with the finish state; dropped the text label, locked to a 44×44 circle, kept the question-mark glyph. `aria-label` stays for screen readers.
- **`b45d665` — finish state drops its tagline.** "Educate myself for humble decisions." sat directly above the site footer's "Educate yourself for humble decisions." — duplicate. Removed the `<p>` + its CSS rule.
- **`b480080` — audio prev/next + current-beat caption.** Auto-advance had no reverse — once beat N+1 loaded, beat N was unreachable. Added two chevron-bar buttons either side of play, plus a `Beat N of M · Title` caption beneath (`aria-live="polite"`). Buttons disable at boundaries; the caption uses each beat's first `<h2>` text so it inherits any `beatTitles` override.

**Trade-offs considered:**
- **Move `area-5-done` to the polish-pass HEAD vs. leave it.** Leave it. Tags should be immutable; if something downstream (rollback procedure, FOLLOWUPS reference, future session) depends on `area-5-done` pointing at `b43ef31`, moving it silently breaks them. The polish pass is on origin and visible in `git log area-5-done..main`.
- **Render-time wrap vs. modify InteractiveGenerator's HTML output.** Render-time wrap. Modifying the agent's stored HTML would violate the permanence rule — published interactive content stays put once committed. The wrapper is `wrapWithResizeProbe(html)` called inside the `srcdoc=` interpolation; idempotent (`__zeemishResizeProbe` guard prevents double-arming if upstream ever stores wrapped HTML). Both render sites (daily piece + standalone /interactives/) use it, so behaviour is identical on both surfaces.
- **Audio prev/next vs. scroll-driven beat-switch.** Prev/next buttons. Scroll-driven (audio jumps to whichever beat is in viewport) is the elegant model but introduces a real listen-vs-skim conflict: a reader listening to beat 3 while scrolling back to re-read beat 1 doesn't want the audio to jump. Ruled out without a "manual override" rule that's its own design problem. Explicit prev/next directly answers "how do I go back?" without the tension; `aria-live` caption tells the reader which beat is currently loaded — that's the second gap the screen-reader-blind player carried even pre-Area-5.
- **Magic-token postMessage filter vs. origin check.** Magic token (`zeemishFrame: 'resize'` / `'ping'`). srcdoc-iframe origin behaviour varies by browser (Chrome treats it as same-origin-as-parent; Safari + Firefox give it an opaque origin). Using `zeemishFrame` as the marker works across browsers. Sandbox is `allow-scripts` only (no `allow-same-origin`), so a malicious sender's blast radius is limited to making our iframe taller or shorter — minimal.
- **Replay schedule (`[50, 200, 500, 1200]`) vs. continuous polling.** Schedule. The race-safety problem is "iframe loaded before parent listener attached"; replaying a few times over the first ~1.5s covers every realistic timing. Continuous polling would burn cycles for no further benefit — once the parent ping path lights up (also wired), any subsequent height change goes through ResizeObserver naturally.

**Files changed:** [`src/components/AudioPlayer.astro`](../src/components/AudioPlayer.astro), [`src/components/MadeBy.astro`](../src/components/MadeBy.astro), [`src/interactive/audio-player.ts`](../src/interactive/audio-player.ts), [`src/interactive/interactive-frame.ts`](../src/interactive/interactive-frame.ts), [`src/interactive/zita-chat.ts`](../src/interactive/zita-chat.ts), [`src/layouts/LessonLayout.astro`](../src/layouts/LessonLayout.astro), [`src/lib/interactive-html.ts`](../src/lib/interactive-html.ts) (NEW), [`src/pages/daily/[date]/[slug].astro`](../src/pages/daily/[date]/[slug].astro), [`src/pages/interactives/[slug].astro`](../src/pages/interactives/[slug].astro), [`src/styles/interactive-frame.css`](../src/styles/interactive-frame.css), [`src/styles/lesson-finish.css`](../src/styles/lesson-finish.css), [`src/styles/made.css`](../src/styles/made.css), [`src/styles/zita.css`](../src/styles/zita.css), [`book/09-the-sixteen-roles.md`](../book/09-the-sixteen-roles.md). No agent change, no pipeline change, no schema change, no audio-pipeline change.

**Verification:** Each commit verified end-to-end in dev preview before push. iframe auto-resize observed jumping from 240px first-paint reservation to 887px (its natural content height) on cold load. Audio caption walked through "Beat 1 of 6 · Hook" → ... → "Beat 6 of 6 · Close" correctly, prev/next disable-at-boundary state correct. Share button + drawer + Zita toggle all click-tested. `pnpm build` clean across all four commits.

## 2026-04-26: Area 5 — Single scroll layout

**Context / trigger:** External brief at `~/Downloads/AREA5_SCROLL_LAYOUT.md` — flip the daily piece page from a paginated stepper (Previous / Next / Finish, one beat visible at a time, sessionStorage-restored beat index) to a single scrolling page. Reader opens today's piece and scrolls — title → audio → every beat → embedded interactive → embedded quiz → finish state — without clicking a navigation button. Scope strictly limited: no agent, pipeline, MDX-output, D1-schema, or audio-agent-pipeline change; the standalone `/interactives/<slug>/` URL must keep working.

**Decision:** Three-commit shipping arc on top of the `area-5-snapshot` rollback tag. `[area-5.1]` collapses `<lesson-shell>` from a state machine to a passive engagement reporter and removes pagination CSS. `[area-5.2]` moves auto-advance + smooth-scroll into `<audio-player>` (it now owns next-clip + page-scroll responsibility, sourcing beat order from DOM not from the audio-beats map's iteration order). `[area-5.3]` embeds the companion interactive + quiz inline at the bottom of the daily page via a shared helper `src/lib/interactives.ts` that both the standalone route and the daily route call, then renders a finish-state `<footer>` with a Web Share API + clipboard-fallback button.

**Trade-offs considered:**
- **Audio behavior in scroll mode.** Picked auto-advance + smooth-scroll on clip end (the brief's diagram preserves the audio player at top + a single seamless flow). Considered: no auto-advance (drop the narrate-the-piece UX entirely; rejected — narration was the strongest reason for the per-beat clip system shipped 2026-04-18 and the brief explicitly says audio system stays). Considered: auto-advance without page-scroll (audio narrates beat 2 while the reader is still looking at beat 1 — confusing). Auto-advance + smooth-scroll preserves the existing UX semantically while adapting it to the new layout.
- **Beat-order source: audio-beats map iteration vs. DOM order.** DOM order. The audio-beats map's iteration order is unreliable — content-collection writes don't preserve frontmatter key order across the pipeline (the test piece had `close, hook, how-it-happened, the-pattern, what-works, why-hard` alphabetised in the map vs. `hook, how-it-happened, the-pattern, why-hard, what-works, close` in DOM). DOM order matches what the reader sees; map order does not. Previously this worked because lesson-shell told audio-player which beat was active via `lesson-beat:change` — the map iteration order was never authoritative. Now that the player drives advance, it has to know the right next beat itself.
- **Embedding interactive content vs. linking to /interactives/<slug>/.** Embed inline AND keep the standalone URL. Two surfaces for the same artefact bothered me at first (duplicate canonical?) but the spec is explicit: standalone must keep working ("essence not reference" — Area 4's design principle that interactives stand alone). Embedding inline doesn't break that property; the standalone URL stays addressable, indexed, share-able. The trade-off is duplicate `interactive_started` events (see "interactive_started semantics" in FOLLOWUPS) — accepted because the components are unchanged from /interactives/'s contract.
- **Engagement event re-anchoring.** `complete` flips from "reached last beat" to "finish-state sentinel ≥60% in viewport". `interactive_offered` flips from "last beat reached + interactive payload present" to "embedded interactive section ≥50% in viewport". Both deduped per session via existing sessionStorage keys. The semantic is closer to truth — a reader actually reaching the bottom of the page IS the completion signal in scroll mode; the artificial "Finish" button click was always a proxy for "scrolled to / read through". The 60% threshold on the finish footer (vs 50% on the interactive section) matches the visual hierarchy: the finish state is intentionally smaller and lower-priority, so a higher threshold avoids firing on partial scroll-overs.
- **`drop_off` event retirement.** Stops firing client-side; admin dashboard + Learner aggregation queries kept (no schema change, no read-site break). Pre-Area-5 it tracked which beat the reader stopped on — meaningful only when a paginated stepper has discrete state. In scroll mode "stopped at beat X" is ambiguous (scroll-position threshold? back-button? scroll-restore?) and not worth a heuristic. Existing rows still display in admin; new pieces silently won't have it. If admin engagement queries start showing "drop_off NULL" universally and operators ask, that's the trigger to either build a scroll-stop heuristic or drop the column.
- **Web Share API vs. native social-link buttons.** Web Share API on mobile (native sheet) + clipboard fallback on desktop with a "Link copied" toast. Considered: per-platform buttons (Twitter / Facebook / LinkedIn / WhatsApp). Rejected — every platform-specific button is one more thing that goes stale (Twitter → X URL, LinkedIn share-URL changes, etc.); native share sheet covers all of them on the surface where reader-driven sharing actually happens (mobile). Desktop falls back to clipboard which works on any platform.
- **Shared helper `src/lib/interactives.ts` vs. inline grouping in both routes.** Helper. The standalone route's getStaticPaths grouping logic (quiz + html → primary + quizContentJson) was a 30-line block; lifting it lets the daily route reuse it without copy-paste. Single-source `LOW_QUALITY_NOTE` copy is a bonus.
- **Premature `interactive_started` firing on daily-page load.** Pre-Area-5, `interactive_started` only fired when a reader navigated to `/interactives/<slug>/`. Post-Area-5, the embedded `<quiz-card>` and `<interactive-frame>` mount on every daily-piece page load and fire `interactive_started` immediately — even for readers who never scroll to the section. This inflates the "started" engagement count. Considered fixing in this commit by deferring `interactive_started` to first viewport intersection inside both Web Components. Rejected — the brief's "audio system untouched" framing argues for conservative WC changes too; the standalone route's Started-on-mount semantic is already correct there. Logged as `[observing]` in FOLLOWUPS for a future fix once we see the inflated metric in admin engagement queries; the right defer-to-intersection change is small and applies cleanly to both surfaces.

**Files changed:**
- [`src/interactive/lesson-shell.ts`](../src/interactive/lesson-shell.ts) — collapsed from 335-line state machine to 153-line passive engagement reporter.
- [`src/interactive/audio-player.ts`](../src/interactive/audio-player.ts) — auto-advance + smooth-scroll on clip end; beat order from DOM; dropped `lesson-beat:change` listener.
- [`src/interactive/register.ts`](../src/interactive/register.ts) — adds `quiz-card` + `interactive-frame` to the daily-piece bundle.
- [`src/styles/beats.css`](../src/styles/beats.css) — pagination + nav-bar CSS removed; beat typography retained.
- [`src/layouts/BaseLayout.astro`](../src/layouts/BaseLayout.astro) — inline pagination CSS removed.
- [`src/layouts/LessonLayout.astro`](../src/layouts/LessonLayout.astro) — renders inline `<section data-lesson-interactive>` + `<footer data-lesson-finish>`; share button + clipboard fallback inline `<script>`.
- [`src/pages/daily/[date]/[slug].astro`](../src/pages/daily/[date]/[slug].astro) — threads full `InteractiveBundle` through to LessonLayout (replaces slim slug+title+questionCount payload).
- [`src/pages/interactives/[slug].astro`](../src/pages/interactives/[slug].astro) — refactored to use the shared helper.
- [`src/lib/interactives.ts`](../src/lib/interactives.ts) — NEW. `groupBySlug`, `bundleByPieceId`, `bundleFromEntries`, `isLowQuality`, `LOW_QUALITY_NOTE`.
- [`src/styles/lesson-finish.css`](../src/styles/lesson-finish.css) — NEW. Mobile-first, ≥44px tap targets, `prefers-reduced-motion`-respecting.

No agent change, no pipeline change, no MDX-output change, no D1-schema change, no audio-pipeline change.

**Verification:**
- `pnpm build` clean across all 3 commits.
- Preview server (`localhost:4321`) on the 2026-04-26 cartel-gold piece: 6 beats render in DOM order as continuous prose, embedded interactive section + quiz-card + interactive-frame all mount, finish footer with three actions visible, no legacy `.beat-nav` element, no legacy `script[data-page-interactive]`, console clean.
- IntersectionObservers verified: scrolling to the finish footer set `sessionStorage[zeemish-completed:<piece_id>]`; scrolling to the interactive section set `sessionStorage[zeemish-interactive-offered:<slug>]`; interactive-frame's own observer set `sessionStorage[zeemish-interactive-viewed:<id>]`. Three distinct dedup keys, three distinct events.
- Audio auto-advance verified by manually dispatching `ended` on the player's internal `<audio>`: `currentBeat` advanced from "hook" → "how-it-happened", `window.scrollY` moved from 0 → 762 (smooth-scroll into the next beat's heading).
- Share button verified: with `navigator.share` undefined (preview is headless), clipboard fallback fired with the canonical URL and the "Link copied" toast became visible.
- Mobile (375×812): finish actions stack vertically, all three at width 327, all three `min-height: 44px`. Screenshot captured.
- Standalone `/interactives/identity-loss-through-transformation/` regression-checked: title, concept, both quiz-card + interactive-frame, noscript fallback, "← Back to library" link all render unchanged.

**Tag:** `area-5-done` lands on the doc-sync commit's SHA after push.

## 2026-04-26: FOLLOWUPS cleanup pass — six-clean-day decisions

**Context / trigger:** Six clean days since the audio retry trio root-cause fix (2026-04-22 late evening). Operator asked for a cleanup pass: P1.2 Curator conceptual diversity hit its 2026-04-26 unblock date, audio retry trio framing needed correcting (already resolved 2026-04-22, not still [open]), and any [open] entry sitting unbitten in production was a [wontfix] candidate. Plan file `~/.claude/plans/coming-back-to-wrap-cozy-music.md` produced the report; user picked dispositions; this commit ships the marker flips + four backup-table drops.

**Decision:** 10 marker flips on `docs/FOLLOWUPS.md` and 4 `DROP TABLE` operations on remote D1. Three [open] entries kept open because they describe real bugs not yet exercised in production (`reset-today.sh` category piece_count drift, CDN cache invalidation on per-beat audio regen, `interactives_backup_20260426` snapshot drop scheduled for 2026-05-04).

- **P1.2 Curator conceptual diversity** `[observing]` → `[resolved]`. Six days post the 2026-04-24 prompt-enrichment fix (`underlying_subject` exposed in Curator's "Already published recently" block), zero recurrence across 6 cron firings. Last 6 pieces span 6 distinct conceptual domains. The smaller-scope fix covered the failure mode without the full P1.2 path (new `underlying_concept` column + concept-distance scoring). Reopen if a same-concept pair lands on a future cron firing.
- **Five [wontfix] flips:** URL canonicalisation (no traffic on old URL shape, legacy `[date]/index.astro` handler intercepts), Drafter slug strategy (cosmetic SEO until library crosses ~50 pieces), `agents/src/server.ts` SDK-typing baseline (DX-only, no CI gate), null-pieceId admin handling (admin UI hygiene only, no operator complaint), D1 correlated subqueries (platform limitation, workaround documented).
- **Four [open] → [resolved] backup drops:** `engagement_backup_20260422` (13 rows, 3 days inside retention window), `daily_piece_audio_backup_20260421` (32 rows, 5 days past), `pipeline_log_backup_20260421` (111 rows, snapshot already consumed for the 2026-04-21 evening run_id rollback), `zita_messages_backup_20260421` (92 rows, distribution stable). All four drops executed via `wrangler d1 execute zeemish --remote --command "DROP TABLE …; DROP TABLE …; …"` in one batched statement.

**Trade-offs considered:**
- **`[resolved]` vs `[wontfix]` for P1.2.** Both defensible. Picked `[resolved]` because real work shipped (the 2026-04-24 prompt enrichment) — the entry was addressed, just not via the originally-scoped option 1. `[wontfix]` would imply "we decided not to fix" which is dishonest about the smaller fix that did happen. The unblock-after line in the entry pre-allocated the `[resolved]` semantics for organic resolution.
- **Five [wontfix] flips at once vs. case-by-case.** Five entries with the shared "real bug? hasn't bitten" shape. Operator gave one disposition for all five; trusting their judgment. Each Won't fix line names a concrete reopen trigger so future-them can decide on signal.
- **Drop the `interactives_backup_20260426` snapshot early too?** No. That one is from today (the migration 0026 rebuild, sub-task 2.5 of the Interactives v3 Phase 2 work). The 7-day retention exists specifically for column-shape regression detection; dropping it on day 0 erases the safety net that justified creating it.
- **DROP TABLE in one batched wrangler statement vs. four separate calls.** One batched call. Each table is independent (no FK refs from live tables to backup tables), and a partial failure of one drop doesn't compromise the others. Wrangler's D1 client returned 4 success rows in 1.24ms total. Database size went 2117632 → 2048000 (~70KB freed; modest but the point is hygiene, not space).
- **DECISIONS entry granularity.** Considered one DECISIONS entry per FOLLOWUPS flip (10 entries) vs. one consolidated. Consolidated wins — these are all part of one cleanup pass with one set of contextual reasoning (the six-clean-day window). Per-entry would inflate the log without adding signal. The FOLLOWUPS entries themselves carry the per-item Resolved/Won't fix lines.

**Files changed:** [`docs/FOLLOWUPS.md`](FOLLOWUPS.md) (10 marker flips + 10 closing lines appended), [`docs/DECISIONS.md`](DECISIONS.md) (this entry). No code, no agent change, no schema change. Remote D1 lost 4 backup tables, retains the 5th (`interactives_backup_20260426`) per its 2026-05-04 retention window.

**Verification:**
- `wrangler d1 execute zeemish --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%backup%';"` returned 1 row (`interactives_backup_20260426` only) post-drop — confirms the 4 targets removed, the 1 retained.
- `grep -c "^## \[open\]" docs/FOLLOWUPS.md` returned 3 (down from 12).
- `grep -c "^## \[wontfix\]" docs/FOLLOWUPS.md` returned 6 (up from 1).
- `grep -c "^## \[resolved\]" docs/FOLLOWUPS.md` returned 31 (up from 26).
- `grep -c "^## \[observing\]" docs/FOLLOWUPS.md` returned 7 (down from 8).
- Math: 12 [open] − 5 [wontfix] − 4 drops = 3 [open] remaining ✓; 1 [observing] (P1.2) → [resolved] = 7 [observing] remaining ✓; 26 + 4 drops + 1 P1.2 = 31 [resolved] ✓.

## 2026-04-26: Interactives v3 Phase 3.5 — doc sync closes Phase 3

**Context / trigger:** Phase 3 sub-task 3.5 closes the four-shipping-sub-task arc (3.1 toggle / 3.2 list view / 3.3 regenerate / 3.4 cost telemetry) by syncing the three living docs that name the admin surface contract.

**Decision:** Three focused doc edits, no code change. `docs/INTERACTIVES.md` gains a new "Admin surfaces" section before "Reference: hand-built example" that documents the four Phase 3 surfaces and cross-refs the RUNBOOK fallback recipes. `docs/AGENTS.md` extends the InteractiveGenerator + InteractiveAuditor entries with HTML-path support (Phase 2), cache-token capture via the shared `extractUsage` helper (Phase 3.4), and the destructive regenerate endpoint (Phase 3.3) — all bullet-level additions to the existing entries, no rewrites. `docs/RUNBOOK.md` gains an "Interactives v3 — month-to-date cost" section that points operators at `/dashboard/admin/interactives/` and names where the Sonnet pricing constant lives (`SONNET_RATES` in the page) for future Anthropic rate changes.

**Trade-offs considered:**
- **One-section vs. four-section structure in INTERACTIVES.md.** Considered breaking the admin section into one heading per sub-task (3.1 / 3.2 / 3.3 / 3.4). Rejected — the spec doc reads forward as a contract, not as a phase log; future readers don't care which sub-task shipped which surface, they care about the contract. Single "Admin surfaces" parent with four `###` children matches the spec's existing tone.
- **Rewrite vs. extend the AGENTS.md Generator/Auditor entries.** The existing entries are 5-bullet recipes from Area 4 (April 24); they pre-date the v3 HTML extension and the Phase 3 admin tooling. Considered a full rewrite. Rejected — appending bullets keeps the doc-history readable (an Area 4 reader can still find the original quiz behaviour); a rewrite would erase the layered history of how the agent grew. Same posture the existing CategoriserAgent entry takes (Area 2 sub-tasks layered as bullets).
- **Where the cost-telemetry pointer lives in RUNBOOK.** Considered putting it inside the existing "Interactives v3 — HTML interactive flag" section. Rejected — the flag section is operational (flip / read / rollback), the cost section is observational (where to look). Different operator intents, different searches; separate sections so each is findable on its own.
- **Phase 4 in STATUS.** Named explicitly as the next sub-task with the unblock condition ("once today's HTML interactives have collected a few days of engagement data") instead of a hard date. Phase 4 is observability-driven; a calendar trigger would invent urgency.

**Files changed:** [`docs/INTERACTIVES.md`](INTERACTIVES.md) (new section), [`docs/AGENTS.md`](AGENTS.md) (3 bullet-level extensions), [`docs/RUNBOOK.md`](RUNBOOK.md) (new section), [`docs/INTERACTIVES_STATUS.md`](INTERACTIVES_STATUS.md) (3.5 marked complete; Phase 3 closed; Phase 4 named as next; sessions log row + tag pending line).

**Verification:** Doc-only commit — no code, no build, no preview to verify. The next CI deploy (after the commit pushes) updates the docs surface on the repo browse view; nothing reader-facing changes.

**Tag:** `interactives-v3.3-complete` lands on the 3.5 commit's SHA after push, completing Phase 3.

## 2026-04-26: Interactives v3 Phase 3.4 — cost telemetry on the admin interactives page

**Context / trigger:** Phase 3 sub-task 3.4 of the Interactives v3 plan calls for "Month-to-date token count for interactive generation, broken out by cached vs uncached. Sourced from a new `agent_cost_telemetry` table OR by extending `observer_events` with token counts (decide during Phase 3 based on what's already there)."

**What was already there (audit before deciding):** every InteractiveGenerator run already writes a metered observer event with `quiz.tokensIn` / `quiz.tokensOut` and (when html ran) `html.tokensIn` / `html.tokensOut` in the `context` JSON column. Those fields capture `response.usage.input_tokens` + `output_tokens` from the Anthropic SDK — which, when prompt caching is in use (and it IS, on the HTML system prompt + auditor system prompt), is the **uncached input portion only**. The system-prompt portion is split into two separate Anthropic counters: `cache_creation_input_tokens` (cold call) and `cache_read_input_tokens` (warm call). Neither was being read.

**Decision:** Extend the read at the call sites (Generator + Auditor) to capture all four billable counters via a new `agents/src/shared/usage.ts` `extractUsage()` helper, then surface MTD aggregates on the existing `/dashboard/admin/interactives/` page as a "Cost (month-to-date · MMM YYYY)" stats row above the catalogue. No new D1 table — extend `observer_events.context` JSON via the existing `logInteractiveGeneratorMetered` shape so the read path is a single SELECT against an already-written column. Pricing math (Sonnet 4.5: $3/M input, $15/M output, cache write at 1.25× input, cache read at 0.1× input) lives inline in the page; if Anthropic changes rates, one constant changes.

**Trade-offs considered:**
- **Extend `observer_events` vs. new `agent_cost_telemetry` table.** Spec left the choice open. Picked the extension because (a) the data is already in `observer_events.context` for tokensIn/tokensOut — adding two more numeric fields keeps everything in one place; (b) no new migration; (c) JSON_EXTRACT-style querying isn't needed yet at current row counts (~30 rows in 30 days), so fetch + parse-in-app works fine. A dedicated table becomes worth it when (a) other agents need cost capture and the JSON-context schema starts feeling crowded, or (b) row counts cross ~10K and JSON parsing becomes the bottleneck. Both well off in the future.
- **Capture cache fields in 3.4 vs. defer with "tokens-only" v1.** Considered shipping just total tokens + estimated input cost without the cache breakdown — would be honest about what we can compute today, dishonest about real spend (the cached portion of every prompt-cached call is real billable tokens). The Anthropic SDK already returns the cache numbers in `response.usage`; reading them is one new helper + 6 call-site updates. Capturing them properly is the right level. The cost surface is honest from the moment 3.4 ships.
- **Approximate the cost upper-bound on pre-3.4 events vs. footnote them.** Pre-3.4 events have no `cacheCreateTokens` / `cacheReadTokens` fields. Considered estimating the system-prompt portion from a known constant (the HTML system prompt is ~5,100 tokens, the auditor system prompts are ~2,500 each) and back-filling. Rejected — every estimate is wrong in a different way (how many cold calls vs warm calls in the run?), and 30 days from now there will be zero pre-3.4 rows anyway. Footnote: surface flags `mtdCacheBreakdownAvailable=false` whenever any event in the MTD window lacks cache fields, and renders a small italic note. Self-correcting as old events age out.
- **`mtdRunCount` filter shape.** Considered `WHERE title LIKE 'Interactive(s)%'` against observer_events. Picked it because the metered event title prefix is stable (`Interactive(s) generated`, `Interactive(s) skipped`, `Interactive(s) shipped (flagged low)`, `Interactive(s) failed`) and avoids a JSON parse in the SELECT. Edge case: the new `interactive_regenerated` event from sub-task 3.3 also has "Interactive" in its title pattern (`Interactive regenerated: ...`) and would slip through the LIKE — except its context JSON has `type: 'interactive_regenerated'` and no `quiz` / `html` keys, so the parse-side filter `if (!ctx.quiz && !ctx.html) continue;` skips it. Belt + braces.
- **Surface placement.** Considered putting cost on a new `/dashboard/admin/cost/` route. Rejected — Phase 3 is about Interactives admin tooling, and the cost data is currently scoped to InteractiveGenerator. A general cost surface that covers Drafter / Curator / Categoriser / Learner / Voice/Structure/Fact would justify its own page; until those agents capture cache fields, a section on the existing interactives page is the right scope.
- **Currency formatting.** USD only, two decimals, `<$0.01` for sub-cent values (so an idle month doesn't show $0.00 misleadingly). Locale-aware token formatting via `toLocaleString()`. No multi-currency support — all Anthropic billing is USD.

**What's NOT in this commit (deferred):**
- Cache capture for Drafter, Curator, Categoriser, Learner, Reflector, Voice/Structure/Fact auditors. Each needs its own `extractUsage` call at the call site; the helper is already shared. Phase 4+ work.
- A separate `/dashboard/admin/cost/` cross-agent cost surface. Lands when more than one agent's cost matters operationally.
- Per-piece cost on the per-piece admin page. Could read the same observer_events data scoped by `piece_id`. Operator demand will tell.
- Historical-month archive view. Today only shows current month; "last month" + drill-down is a v2 enhancement.

**Files changed:** new helper at `agents/src/shared/usage.ts`; `agents/src/interactive-auditor.ts` (import + use `extractUsage` at both Claude call sites; add `cacheCreateTokens` + `cacheReadTokens` to `InteractiveAuditResult` type); `agents/src/interactive-generator.ts` (same import; `extractUsage` at all 4 produce/revise call sites; cumulative cache accumulators in both `runQuizLoop` and `runHtmlLoop`; new fields on `QuizArtefactResult` + `HtmlArtefactResult`; both early-exit synthesised results carry `cacheCreateTokens: 0, cacheReadTokens: 0`); `agents/src/observer.ts` (extend `logInteractiveGeneratorMetered` metrics shape + body summary line shows the 4-up token breakdown). `src/pages/dashboard/admin/interactives/index.astro` gains the MTD cost section.

**Verification:** `pnpm build` clean. Agents typecheck unchanged at 27 errors all in `server.ts` (pre-existing SDK-typing pattern). Local preview: `/dashboard/admin/interactives/` redirects to `/login/?redirect=...` for unauthenticated visitors; zero server errors. The cost section's runtime correctness verifies post-deploy on prod (today's MTD runs include real Anthropic responses with cache fields populated).

## 2026-04-26: Interactives v3 Phase 3.3 — destructive per-piece interactive regenerate

**Context / trigger:** Phase 3 sub-task 3.3 of the Interactives v3 plan (`docs/INTERACTIVES_PLAN.md`) calls for a per-piece regenerate button — "Wipes the existing HTML + audit rows for the piece and triggers a fresh produce → audit → revise loop." The 3.2 list view shipped per-row placeholder cells; this commit fills them with working buttons. The `/api/agents/interactive-retry` endpoint that's been live since 4.5 is idempotent — it short-circuits when `daily_pieces.interactive_id IS NOT NULL` — so it can't act on Rough rows that already shipped low. 3.3 introduces a separate, explicitly destructive path scoped to a single (piece, type) pair.

**Decision:** New endpoint `POST /interactive-regenerate-trigger?piece_id=<uuid>&type=quiz|html` on the agents worker, and a site-side proxy at `/api/agents/interactive-regenerate.ts` that ADMIN_EMAIL-gates it and forwards the verified `changed_by` email. The endpoint chains:
1. Resolve piece + target interactive row.
2. (HTML only) Refuse if `interactives_html_enabled = false` to avoid a silent no-op when Generator's HTML path skips. Caught at the trigger layer with a 400 + clear message pointing the operator at the settings flip.
3. Delete the file from GitHub via a new `Publisher.deleteInteractiveFile(filePath, commitMessage)` method whose path-prefix guard refuses anything outside `content/interactives/` (defence-in-depth against a future caller passing a daily-piece path; the permanence rule still holds at the Publisher API surface).
4. Delete `interactive_audit_results` rows for the interactive_id, then the `interactives` row.
5. (Quiz only) Clear `daily_pieces.interactive_id` so the Generator's quiz-path idempotence guard treats this as a fresh run.
6. Fire an `interactive_regenerated` info-severity observer event with operator email + deleted slug + interactive_id + file path.
7. Schedule `generateInteractiveScheduled` on a 1s alarm — fresh DO invocation runs the full produce → audit → revise loop and fires its own `logInteractiveGeneratorMetered` event when complete.

The destructive steps run synchronously inside the trigger handler, before the 202 response. Operator sees the real error if the wipe fails (auth, rate limit, missing target row), instead of a 202 + silent server-side throw. The fresh-generation alarm fires asynchronously per the existing post-publish pattern.

The list view's per-row Regenerate button confirms via `window.confirm()` with a dialog that names exactly what will be wiped (file + D1 row + audit rows + interactive_id clear), then disables itself on success until the operator reloads the page (avoiding a race where a re-click hits a still-being-generated row that doesn't exist yet).

**Trade-offs considered:**
- **Generic deleteFile vs. interactives-scoped deleteInteractiveFile.** Considered a generic Publisher.deleteFile method open to any path. Rejected — the daily-piece permanence rule lives in this codebase as both a coding norm AND an API-level refuse (see `publishToPath` line 38). Mirroring that defence at the delete surface keeps the rule local to the method and makes future misuse impossible: pass `content/daily-pieces/...` to deleteInteractiveFile and it throws before touching the GitHub API. Cost: one path-prefix check.
- **`type=quiz|html|both` vs. one-type-per-call.** v1 supports `quiz` or `html` only; `both` would either need to wrap two regen calls (subject to partial-failure mid-flight) or duplicate the Director method's body to handle both inside one transaction. Operator can call twice if both regens are wanted. Spec's `Wipes the existing HTML + audit rows for the piece` language suggests one-at-a-time was the intent.
- **Slug-lock vs. accept-drift.** Quiz-only regen MAY produce a different slug if Claude returns a different proposal from the same source piece — this would break the quiz/html shared-slug invariant from Phase 2.5 (migration 0026). HTML-only regen never drifts because the html path's `existingQuiz` lookup pins the slug to the still-present quiz row. Considered passing a `slugLock: target.slug` hint into `Generator.generate()` so the regenerated quiz always reuses the existing slug. Rejected for v1 — adds a new parameter to `generate()` + branches inside `resolveFreeSlug`, and the drift case is rare in practice (Claude is mostly deterministic from the same source). If drift becomes operational pain, the v2 fix is ~10 lines. Documented in the Director method's docstring + this entry as a known limitation.
- **Synchronous wipe + 202 vs. fully-async trigger.** Considered shaping the endpoint like `/interactive-generate-trigger` does — return 202 immediately and run the wipe inside `ctx.waitUntil()`. Rejected — the wipe steps can fail in operator-actionable ways (auth, rate limit, missing target) and a 202 with an opaque background error gives the operator nothing to act on. The fresh-generation alarm IS still async (via `this.schedule(1, ...)`), because that's a long-running Claude loop the operator doesn't need to block on.
- **400 vs. 500 on flag-off / not-found errors.** The endpoint discriminates: `not found` and `interactives_html_enabled is false` map to 400 (operator input issue, recoverable); everything else maps to 500. Pattern-match on the error message is a small smell, but the alternative — a typed-error class hierarchy in Director — is over-engineering for two known cases.
- **Confirm dialog wording.** Considered minimal "Regenerate $type?" prompt. Rejected — the action commits to git (one DELETE commit + one fresh PUT commit) and writes observer events; the operator deserves to see exactly what's about to happen. The dialog enumerates the file path, the D1 wipes, the interactive_id clear (when applicable), and the background-alarm note.
- **Button stays disabled on success vs. re-enables.** Disabled until reload. The fresh-generation alarm is async; clicking again would race a still-being-created row. The success status text tells the operator to reload after a minute or two, which is the natural completion signal anyway.

**What's NOT in this commit:**
- A `slugLock` parameter on Generator. Slug drift on quiz-only regen is a v2 enhancement.
- A "Regenerate both" button. Spec is one-at-a-time; operator can call twice.
- A polling indicator for the background alarm completion. The page-reload signal is enough at current cadence (12h cron).
- Per-piece admin page's existing Retry button switching to the new endpoint. The Retry button on the per-piece page is the idempotent first-time generation path (operator clicks it when no interactive exists yet); the destructive regen lives on the new list view where every row is a real artefact. Two surfaces, two intents, deliberate.

**Files changed:** new method on `agents/src/publisher.ts` (`deleteInteractiveFile` with path-prefix guard); new method on `agents/src/director.ts` (`regenerateInteractive`); new helper on `agents/src/observer.ts` (`logInteractiveRegenerated`); new endpoint in `agents/src/server.ts` (`/interactive-regenerate-trigger` + path added to `adminPaths` for auth gating); new site proxy at `src/pages/api/agents/interactive-regenerate.ts`; per-row regenerate button + confirm-dialog JS handler on `src/pages/dashboard/admin/interactives/index.astro`.

**Verification:** `pnpm build` clean; agents typecheck adds 2 errors for the new endpoint (same SDK-typing pattern every existing trigger has — was 25, now 27). Local preview: `/api/agents/interactive-regenerate` returns 401 unauthenticated for all four input shapes (no params / bad UUID / missing type / bad type — auth check fires first as expected). Zero server errors. End-to-end regen flow (real wipe + fresh generation) verifies post-deploy on prod against a Rough-tier interactive (FISA or Maine, both shipped low — once flag flips for the HTML side, the Maine `essence`-failed quiz is a clean test target).

## 2026-04-26: Interactives v3 Phase 3.2 — admin list view at `/dashboard/admin/interactives/`

**Context / trigger:** Phase 3 sub-task 3.2 of the Interactives v3 plan (`docs/INTERACTIVES_PLAN.md`) calls for an admin list view of every interactive with status / per-dimension audit scores / quality_tier / quality_flag / revision count, sortable so rough rows bubble. Operator-facing surface that mirrors the audio admin shape — Zishan knows what that looks like, no spec needed from scratch. The regen button referenced in the spec is intentionally deferred to 3.3 (it needs the destructive `/interactive-regenerate-trigger` endpoint that doesn't exist yet); this commit ships the list and renders a placeholder cell where 3.3's button will land.

**Decision:** New SSR Astro page at `src/pages/dashboard/admin/interactives/index.astro` (folder route, not file route — leaves room for `/dashboard/admin/interactives/<slug>/` per-interactive deep-dive pages later). ADMIN_EMAIL gated with the same redirect-to-login pattern as the cadence settings page. Two D1 queries — interactives + headline join, then per-interactive latest-round audit fetch — stitched in app code. Two soft signals: a stats row (total / clean / rough / quiz / html) and a "N pieces have no quiz · M pieces have no HTML interactive" line above the catalogue. Type filter chip (All / Quiz / HTML) mirrors the observer-feed severity-chip pattern verbatim — same classes, same JS shape, same empty-state copy convention. Sort order locked to: `quality_flag='low'` first, then by `published_at DESC`, NULL `published_at` last. Audit pills use the four-dimension fixed order from `made-by.ts`: voice → structure → essence → factual.

**Trade-offs considered:**
- **Mixed table with "pending" placeholder rows vs. soft "missing pieces" stat line.** Spec mentions "status (clean / rough / pending)" as the three states. Considered enumerating `daily_pieces` rows that have no matching `interactives` row of a given type as virtual "pending" rows in the table. Rejected for two reasons: (1) `interactives_html_enabled` is currently `'false'`, so EVERY one of the 12 published pieces is a "pending HTML" — would render 12 dead-row placeholders the operator can't act on until the flag flips. (2) "Pending" placeholders would mix two semantically different things — a real interactive row that's mid-state and a piece that has no interactive — under the same visual treatment. Cleaner: the `interactives` table is the catalogue (rows = real artefacts), and the "missing" count is a soft stat that points the operator at the per-piece admin page when they need to trigger generation. If a piece has tried-but-failed (no `interactives` row), it surfaces as a missing piece + the per-piece page's existing Retry button is the action, not this list view.
- **One query with a window function vs. two queries stitched.** SQLite supports window functions (D1 is on a recent build), so one query with `ROW_NUMBER() OVER (PARTITION BY interactive_id ORDER BY round DESC)` could fold the latest-round dimension rows alongside the interactives. Rejected — two queries is more readable, the second query's `WHERE interactive_id IN (?...)` is fast on the composite `(interactive_id, round)` index from migration 0023, and the app-side stitch cleanly produces the per-row `latestAudit` shape the template needs. Cost is one extra round trip; on D1 SQLite that's microseconds. Same trade-off the per-piece admin page made when reading audit_results.
- **Placeholder regen cell vs. omit the cell entirely until 3.3.** Considered leaving no cell at all and letting 3.3 add the cell + button together. Rejected — having the placeholder visible ("Regenerate: shipping in 3.3") tells any operator who lands on the page mid-arc what's coming, instead of leaving them to wonder why a Retry button is missing. It also forces the row layout to allocate space now so 3.3's button doesn't need a re-layout.
- **Source piece headline as link to admin per-piece vs. just plain text.** Source piece headline is a click target — operator who sees a Rough interactive will commonly want to land on the per-piece admin page to see the full audit context. Linked. The interactive's own slug links to the public `/interactives/<slug>/` page so the operator can see what readers see in one click.
- **Default sort vs. sortable column headers.** Spec says "Sortable so rough ones bubble to the top." V1 ships locked-default sort that achieves the spec's intent (rough first). Adding actual click-to-sort headers is a v2 enhancement — useful when the catalogue grows past ~50 rows. With 8 today and ~30 expected at end of Phase 3, locked sort is enough.
- **`pieceWithoutQuizCount` query shape.** Used `WHERE NOT EXISTS (...)` correlated subquery instead of `LEFT JOIN ... WHERE interactives.id IS NULL` because the latter requires a separate JOIN per type and an OR-NULL filter that scans more rows. The correlated subquery hits the existing `idx_interactives_source_piece` (or whatever migration 0022 named it) once per `daily_pieces` row, ~12 rows today, fast enough.

**What's NOT in this commit (deferred to 3.3+):**
- Functional regenerate button. Cell placeholder shows "Regenerate: shipping in 3.3."
- Click-to-sort column headers. Default sort is hard-coded; v2 if needed.
- Per-interactive deep-dive page at `/dashboard/admin/interactives/<slug>/`. Not in Phase 3 scope; separate sub-task if operator demand emerges.
- "Pending" status mixed into the table. Surfaced as a stat-line link to the per-piece admin page instead.

**Files changed:** new `src/pages/dashboard/admin/interactives/index.astro` (~280 LOC); `src/pages/dashboard/admin.astro` (one new nav-link line in the top-right block).

**Verification:** `pnpm build` clean. Local preview: `/dashboard/admin/interactives/` redirects to `/login/?redirect=/dashboard/admin/interactives/` for unauthenticated visitors. Zero server errors. Authenticated UI flow verifies post-deploy. Two D1 queries shape-checked against migrations 0022 (interactives), 0023 (interactive_audit_results), 0025 (quality_tier).

## 2026-04-26: Interactives v3 Phase 3.1 — `interactives_html_enabled` toggle on admin settings page

**Context / trigger:** Phase 3 of the Interactives v3 plan (`docs/INTERACTIVES_PLAN.md`) calls for an admin surface with: (1) a list view of every interactive, (2) per-piece regenerate, (3) a global pause toggle wired to `interactives_html_enabled`, (4) cost telemetry, (5) docs sync. Sub-task 3.1 ships the toggle first — smallest visible win, replaces `wrangler d1 execute` for the eventual flag flip after Zishan's prod review of the Phase 2.7 reference HTML, lands cleanly with the flag still `'false'`.

**Decision:** Extend the existing `/dashboard/admin/settings/` page with a second `<section>` under the cadence section, instead of giving the flag its own page. The cadence dropdown shipped 2026-04-21 (Phase 5 of the multi-piece cadence plan) is the pattern Zishan already knows; mirroring it here keeps the operator's mental model consistent and avoids fragmenting admin tooling across multiple URLs as the v3 admin surface grows. Reused `admin_settings` storage shape, the same `admin_settings_changed` observer audit-trail event, and the same admin-only access pattern (`Astro.locals.userId` + `ADMIN_EMAIL` check + redirect to `/login/`). Storage value remains the canonical `'true' | 'false'` string the agents-side `getAdminSetting` helper already parses; the wire format on the API is `boolean`.

**Trade-offs considered:**
- **One settings page vs. one page per setting.** Considered putting `interactives_html_enabled` on its own `/dashboard/admin/interactives/` page (where sub-task 3.2's list view will live). Rejected — operator doesn't need to context-switch when toggling system-level state, and the list view is for per-row work (status, regen). Toggle is system state and belongs on the settings page; list is interactives state and belongs on the interactives page. Two surfaces, two intents.
- **Extend the existing API endpoint vs. add a new one.** Settings.ts already owns the `admin_settings` table writes for `interval_hours` with `admin_settings_changed` audit trail. Adding `/api/dashboard/admin/interactives-flag` would duplicate the audit helper, the auth check, and the UPSERT shape. Extended POST to dispatch on body shape (`'interval_hours' in body` vs. `'interactives_html_enabled' in body`), shared write path through a new `writeSetting()` helper. Single endpoint scales better as more flags land in Phase 3+.
- **Boolean wire format vs. string-mirror of storage.** Storage is canonical `'true' | 'false'` (the agents-side reader uses `=== 'true'`). API could mirror that as a string. Rejected — booleans are the natural JS shape for a checkbox; the dispatch in POST already validates `typeof raw !== 'boolean'` and rejects everything else with 400. UI-side toggle binds to `htmlToggle.checked` directly. Translation happens in `writeSetting()` — `raw ? 'true' : 'false'` — at the boundary, not on every consumer.
- **Defaults on missing row.** The flag was seeded by migration 0024 with `INSERT OR IGNORE` so the row always exists in deployed environments. But local D1 dev and any future operator-cleared row needs a fail-closed default. Both readers (GET endpoint, page frontmatter) treat any non-`'true'` value as `false` (`htmlRow?.value === 'true'`). The agents-side reader does the same. Match between three readers is not a coincidence — it is the contract: any value other than the literal string `'true'` means disabled.
- **Audit-trail granularity.** Considered logging only the post-state. Rejected — the existing cadence path logs both prior and next values, and the audit-trail body explicitly shows `Previous value: X / New value: Y`. Mirroring that shape lets the observer feed render the same way for both keys, and lets a future operator see "the flag was ON for 6 hours, then turned OFF, then back ON" in raw event sequence.

**Files changed:** [`src/pages/api/dashboard/admin/settings.ts`](../src/pages/api/dashboard/admin/settings.ts) (GET extension + POST dispatch + shared `writeSetting` helper), [`src/pages/dashboard/admin/settings.astro`](../src/pages/dashboard/admin/settings.astro) (new section + IIFE-scoped second form-handler in the existing inline `<script>`), [`docs/RUNBOOK.md`](RUNBOOK.md) ("Interactives v3 — HTML interactive flag" section now leads with the admin UI path; `wrangler d1 execute` recipes kept as the fallback path with a "no observer audit trail" note).

**Verification:** `pnpm build` clean. Local preview verified: `/dashboard/admin/settings/` redirects to `/login/?redirect=/dashboard/admin/settings/` for unauthenticated visitors; GET / POST / POST-with-bad-type to `/api/dashboard/admin/settings` all return 401 without an admin session; zero server errors in dev logs. Authenticated UI flow verifies post-deploy (same convention as the 2026-04-21 cadence settings page; CI deploy will publish the surface to `https://zeemish.io/dashboard/admin/settings/`).

**What this enables next:**
- After Phase 2.7's reference-HTML review on prod, flipping the flag becomes a one-click admin action — the `wrangler d1 execute` recipe is now the fallback path, not the primary.
- Sub-task 3.2 (list view at `/dashboard/admin/interactives/`) reuses the same admin-auth + observer patterns established here.

## 2026-04-26: Curator candidate rendering — drop list-number prefix to stop Claude returning the index as `selectedCandidateId`

**Context / trigger:** 2026-04-26 11:01 UTC auto-cron fired a `curator` warn event: `Pipeline error: selectedCandidateId 10 matched 0 rows in daily_candidates — id shape drift from Curator`. Same bug class as 2026-04-22's `6999c5e` Curator selectedCandidateId fix, but a new failure mode — Claude returned the literal string `"10"` (the list index) instead of a UUID. Manual retrigger from admin recovered the slot. FOLLOWUPS 2026-04-26 has the full hypothesis and the two candidate fixes flagged at write time.

**Decision:** Take fix #1 — drop the `${i + 1}.` numbered prefix from the candidate rendering in [`buildCuratorPrompt`](../agents/src/curator-prompt.ts). Each candidate now renders as `id: <uuid>\n   [<category>] "<headline>" (<source>)\n   <summary>`, with the UUID as the first visible token on the first line. Two additional touch-ups in the same edit: response-format example at line 59 uses a concrete UUID-shaped placeholder ("<uuid copied verbatim from the chosen candidate's id: field — e.g. 0f3a8b6c-2d1e-4f9a-b7c8-1e2d3f4a5b6c>") instead of the prior bare "the id of the chosen story" hint, so Claude pattern-matches on shape rather than potentially copying the literal hint string; and the trailing instruction at line 99 now explicitly forbids substituting "a list position number" alongside the existing "do not invent, truncate, guess" guard.

**Trade-offs considered:**
- **Fix #1 (drop the numbered prefix) vs Fix #2 (move UUID into a `[<uuid>]` bracket-wrapper at the very front of the line).** Both move the UUID to the first visible token. Fix #2 lets the entire candidate render as a single structural line — readable for short summaries — but stacks two bracketed groups (`[<uuid>] [<category>] ...`) that visually conflict and lose the multi-line shape of the existing rendering. Fix #1 is the minimal, lowest-risk edit: one character per candidate removed (`${i + 1}. `), no other shape change. Picked Fix #1.
- **Drop the index entirely vs keep an explicit "candidate N of 50" line.** Considered keeping the index as a separate visible signal (e.g., a leading line `# Candidate 10 of 50`). Rejected — Claude doesn't need the count for selection (it can see the list end), and any leading numeric token in the candidate block re-creates the bug class. The fix's correctness depends on no numbers being structurally adjacent to the `id:` field.
- **Tighten the JSON example placeholder vs leave it as the existing prose hint.** The `"selectedCandidateId": "the id of the chosen story"` placeholder gave Claude no shape pressure — any string would satisfy "the id of the chosen story" at the surface. Replacing with a UUID-shaped example pushes Claude toward shape-matching during JSON construction. Negligible token cost; clear win on prompt-engineering hygiene.
- **Add a second guard layer in `Curator` agent code (e.g., regex-validate UUID shape before returning).** Considered. Rejected for now — the existing `director.ts:243` exception path already converts any 0-rows match into a forensic observer event (which is exactly what fired and let the user catch this), so a regex pre-check at the agent layer would only change the failure mode from "warn event with the bad id" to "warn event with a different message". The prompt is the right level to fix; defence-in-depth at the consumer is already there.

**Verification:** Next auto-cron at 14:00 UTC 2026-04-26 should pick a UUID matching a `daily_candidates.id` row. If the warn event re-fires with a different non-UUID shape, the prompt has a deeper issue; if it fires with the same `selectedCandidateId N matched 0 rows` pattern, the index-collision wasn't the only failure mode and we escalate to fix #2 (UUID at front-of-line) or add the regex guard.

**Files changed:** [`agents/src/curator-prompt.ts`](../agents/src/curator-prompt.ts) (3 lines: line 59 example, line 92 candidate render, line 99 final instruction).

## 2026-04-26: Interactives v3 — six architectural decisions for the HTML interactives extension

**Context / trigger:** Commissioning the v3 plan to extend the shipped Area 4 quiz pipeline with a second artefact type — HTML interactives (sliders, scrubbable timelines, simulations — whatever shape Claude judges fits the concept). The original v2 seed plan in `~/Downloads/files/` predated Area 4 (which shipped 2026-04-23 → 2026-04-25) and described building things that already exist (the `InteractiveGenerator` and `InteractiveAuditor` agents, the `interactives` table, the `interactive_engagement` table, the `<quiz-card>` Web Component, the `/interactives/<slug>/` route). Rewriting the plan against the shipped repo surfaced six architectural questions that needed to be settled before any code change. Settled here, recorded so Phase 1+ implementation doesn't re-litigate them.

The full plan lives in [`docs/INTERACTIVES_PLAN.md`](INTERACTIVES_PLAN.md); the spec implementing these decisions lives in [`docs/INTERACTIVES.md`](INTERACTIVES.md). Phase 0 (this commit) writes the decisions; Phase 1 adds the feature flag + schema; Phase 2 ships the Generator extension; Phases 3 + 4 follow.

**Decisions (six):**

1. **No new agents.** `InteractiveGenerator` (#15) and `InteractiveAuditor` (#16) extend their responsibilities to cover the HTML shape. Same files, same Director hooks, same observer-event surface (extended). Rejected: introducing a "Curator" / "Composer" / "Selector" agent for HTML. Rationale: (a) "Curator" already collides with the established Curator-the-news-picker; (b) the existing Generator + Auditor already own the produce → audit → revise loop, and HTML is just a second artefact type going through the same loop; (c) agent count is a load-bearing number on the brand surface (footer, MadeBy drawer, OG description, book chapter) — bumping from 16 to 18 would cascade through ~30 living surfaces for no architectural gain.

2. **No type registry. Free-form HTML, generated per piece against one prompt.** Rejected: a registry of "interactive types" (slider / chart / timeline / simulation), each with its own template and parameters. The v2 seed plan was a registry; for a system being built from scratch that would have been the right shape. For the system that already shipped, it would have been parallel architecture without justification — the existing pipeline produces one quiz per piece via one prompt, and the natural extension is one HTML interactive per piece via one (additional) prompt. Adding a "type" later means tuning the prompt and giving Claude another worked example, not creating folders. The validator + audit rubric are the architecture; the prompt is the interface.

3. **Iframe sandbox shape: `sandbox="allow-scripts"` only. Non-negotiable.** No `allow-same-origin`. No `allow-top-navigation`. No `allow-forms`. No `allow-popups`. No `allow-modals`. No anything else. Rationale: with only `allow-scripts` the iframe is treated as an opaque origin — storage isolation, DOM isolation, navigation isolation, no credentialed requests, CSS/JS isolation. Adding `allow-same-origin` collapses every isolation boundary at once (the iframe could read `document.cookie`, manipulate `localStorage` for `zeemish.io`, and break out of all the other constraints). Future shapes that genuinely need a non-`allow-scripts` token are a fresh DECISIONS entry, not a quiet attribute change. Full token-by-token rationale at [`docs/INTERACTIVES.md`](INTERACTIVES.md) "The iframe sandbox shape".

4. **Every piece gets BOTH quiz AND HTML interactive. Always.** Like audio. Like categorisation. Rejected: a per-piece "is this concept teachable as an HTML interactive" gate, or a manipulability score, or a curator-style decline path. Rationale: (a) the system is already built around the post-publish-alarm pattern producing artefacts unconditionally; quizzes don't have a "should we make one" gate either; (b) per-piece gating would require a new scoring agent (rejected by decision #1); (c) the validator + Auditor + 3-round revise loop are the gate — if a piece's concept truly cannot become a manipulable interactive, the Auditor's essence dimension will catch it and the artefact will ship flagged (decision #5). This is acceptable cost for keeping the pipeline shape symmetric across artefact types.

5. **Always ship — newspaper never skips a day. Max-fail ships flagged, not abandoned.** If the HTML interactive max-fails round 3 of the audit, the file commits with the rough flag set (column name resolved in Phase 1 — `quality_tier='rough'` is the leading option, mirroring `src/lib/audit-tier.ts`). Mirrors the 2026-04-24 reversal of Area 4 sub-task 4.5 that did the same thing for quizzes (originally abandon-on-max-fail; reversed when the FISA piece ran and the failure mode was Auditor-over-strict, not Generator-produces-garbage). The drawer's "How this was made" section is the only reader-facing surface for the flag — text quoted at [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Rough-marker UX rule". Rationale: (a) better one flagged interactive than half a piece's post-publish artefacts missing; (b) a 3-rounds-refined artefact is better than a 404, even when round 3 still has a flagged dimension; (c) the dimension-named drawer copy from the 2026-04-25 commit gives readers (and admins) the specifics so the flag is honest, not vague.

6. **Prompt caching, not cost gating.** The HTML generation prompt + voice contract + structural rules + sandbox spec + few-shot examples are stable across every call. They go in cached prompt blocks; the per-piece brief is the uncached portion. Cache reads cost 0.1× standard rate. Estimated ~$2–3/month additional spend at 2 pieces/day on Sonnet 4.5. Rejected: a cost-driven "only generate HTML for some pieces" mechanism, a token budget per call, a confidence-gated decline path. Rationale: (a) caching closes the cost gap; (b) cost-gating an artefact type would re-introduce the per-piece score that decision #4 explicitly rejected; (c) the admin pause toggle (Phase 3) exists as a quality circuit-breaker for bad output, not a cost defence — those are different operations that want different controls.

**Trade-offs:**

- **Decision #1 cost:** Generator + Auditor become more complex per-file. Two artefact code paths inside one agent class. Mitigated by the existing structure: both agents already have a shape that takes "audit dimension" or "produce → audit → revise" as core methods; HTML is an artefact-type parameter, not an architecture branch. If the per-file complexity ever stops paying its way, the option to split is preserved (the agent definitions are local to one file each).

- **Decision #2 cost:** the validator + Auditor have to handle every shape Claude generates rather than enforcing a known parameter space. Mitigated by: the validator's 8 rejection rules cover the entire safety surface; the Auditor's 4 dimensions cover the entire quality surface; the iframe sandbox covers the entire runtime surface. The combinatorial space inside those bounds is exactly the freedom we want — a slider, a scrubbable timeline, two side-by-side configurations, or a small simulation are all reachable from the same prompt without any new code.

- **Decision #3 cost:** some interactive shapes are unreachable. Anything that genuinely needs `allow-forms` (form-driven submission), `allow-modals` (alert/confirm/prompt), or `allow-popups` (new tabs) is out. Acceptable — none of those are teaching primitives we want; they're UI patterns from a different document genre. If a future shape genuinely requires loosening the sandbox, that's a fresh DECISIONS entry and a fresh look at whether the shape is one we actually want to ship.

- **Decision #4 cost:** flagged-low ratio may be higher for HTML than for quizzes. A quiz can hit all 4 dimensions on virtually any concept (3–5 multiple-choice questions is a low bar). An HTML interactive's essence dimension — "manipulating this teaches the concept" — is harder to clear on concepts that don't have an obvious mechanism. Mitigated by: the audit rubric's scored-not-binary shape on essence (≥75 instead of pass/fail) gives some headroom; the dimension-named drawer copy keeps the flag honest when it does fire.

- **Decision #5 cost:** flagged-low artefacts are visible to readers. Same cost the quiz path already accepts since the 2026-04-24 reversal. The drawer's transparency framing turns it into a feature ("we shipped what we had rather than leave the day blank") rather than an embarrassment. The cost the system is NOT willing to pay is "no interactive on a piece" (which would be inconsistent with the always-ship rule).

- **Decision #6 cost:** dependency on Anthropic prompt cache TTL behaviour (5 minutes). At 2 pieces/day cadence this is irrelevant — back-to-back calls within one publish event share cache; calls across publish events don't, and that's fine because we're not optimising the cross-publish path. If the cache TTL ever changes, the cost re-estimates; the architecture doesn't need to.

**Won't fix this session (Phase 0):**

- **The validator implementation.** The rule list is specified at [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Validator rules" with regex/check shapes per rule, but the actual `agents/src/interactive-validator.ts` lands in Phase 2.
- **The HTML generation prompt.** Spec'd in the prompt-caching section; written in Phase 2.
- **The `<interactive-frame>` Web Component.** Spec'd in the sandbox section; written in Phase 2.
- **The hand-built reference HTML.** Phase 2 sub-task 2.7 (manual proof step). Lives at `docs/examples/interactive-reference.html` permanently per Phase 0 decision (b) in the plan.
- **The schema column for the rough flag.** `quality_tier TEXT` (leading option) vs reusing `quality_flag='low'` is a Phase 1 decision; the spec is written agnostic of the choice.
- **Admin surface.** Phase 3 (list view, regenerate button, pause toggle wiring, cost telemetry).
- **Engagement signals into Learner.** Phase 4 (postMessage from sandboxed iframe to parent, then to `/api/interactive/track`, then aggregated by Learner).
- **Book chapter filename rename** (`09-the-fourteen-roles.md` → `09-the-sixteen-roles.md`). Tracked as `[open]` in `docs/FOLLOWUPS.md` per the Phase 0 task list — touches every cross-chapter reference, separate sweep.

**Verification:**

- This DECISIONS entry exists.
- [`docs/INTERACTIVES.md`](INTERACTIVES.md) exists and contains: (a) the spec intro, (b) the audit rubric for HTML, (c) the validator rule list, (d) the iframe sandbox shape, (e) the rough-marker UX rule with the exact reader text, (f) the pause toggle behaviour, (g) the prompt caching strategy.
- [`book/09-the-fourteen-roles.md`](../book/09-the-fourteen-roles.md) has updated Generator + Auditor sections noting the two-artefact-type extension.
- [`docs/FOLLOWUPS.md`](FOLLOWUPS.md) has the `[open]` book filename rename entry.
- Tag `interactives-v3.0-complete` pushed at end of session.

**Out of scope (intentional):**

- Re-architecting the existing quiz pipeline. Quizzes ship as they do today.
- New external dependencies. The validator is regex + light pre-processing; no `htmlparser2`, no Babel AST.
- Cross-piece interactive composition. Each interactive is 1:1 with its piece; no "see how this concept relates to last week's piece" cross-references at the artefact layer.
- Per-piece off-switch for interactives. Global pause only (decision #4 rules out per-piece gating; the Phase 3 regenerate button handles single-interactive recovery).
- Accessibility audit of generated HTML beyond the iframe `title` attribute. Tracked as a future hardening item in [`docs/INTERACTIVES.md`](INTERACTIVES.md) "Future hardening" section; not Phase 2.

## 2026-04-25: Tighten Categoriser reuse floor + surface existing assignments on skipped log + delete bad firing-squads → Commodity Shocks assignment

**Context / trigger:** Post-mortem on the firing-squads piece (`piece_id=7eb5f8a3-…`, the 2026-04-25 14:00 UTC slot piece that the new Curator picked) surfaced two real Categoriser issues alongside one harmless deploy-timing artefact:

1. **Misclassification.** Categoriser correctly created the novel category "State Violence & Justice Systems" at 75% confidence (the right primary). But it ALSO assigned "Commodity Shocks" at 70% confidence — a cross-domain stretch from the piece's secondary thread about pharmaceutical companies exiting the execution-drug supply ("supply running out" pattern-matched to "commodity shock"). Reader-visible: the piece would surface in [/library/commodity-shocks/](https://zeemish.io/library/commodity-shocks/) alongside oil-prices and jet-fuel pieces, off-brand for that filter.

2. **Misleading observer feed.** The piece's Categoriser observer event read `"Categorisation skipped"` (with `assignmentsWritten:0, considered:0, durationMs:11ms`) — but `piece_categories` actually had 2 rows for the piece. Comparing against 12 prior pieces, every one had a `"Categorised:"` success event; this is the only one that doesn't. Deploy-during-pipeline race confirmed via timeline: today's agents-worker deploy at 14:19 UTC raced with the post-publish Categoriser alarm at 14:23:51. First invocation INSERTed both rows at 14:24:20 (~29s after fire, mostly Claude call), but the DO got evicted before `observer.logCategoriserMetered` could persist the success log — the catch-and-swallow pattern at [`director.ts:715-717`](agents/src/director.ts:715) means observer-write failures are silently lost. Cloudflare's at-least-once alarm semantics re-queued the alarm; the retry at 14:24:23 hit the idempotency guard, fired the misleading "skipped" event. Same root cause as today's two `"Durable Object reset because its code was updated"` audio failures (already documented in CLAUDE.md 2026-04-19 audio narrative).

The deploy race itself isn't a bug to fix — at-least-once semantics + idempotency guards are the Cloudflare-native way to handle it, and CLAUDE.md already names the pattern. But the **observability is bad**: an admin reading the feed sees "skipped" with no detail and can't tell whether the piece is actually categorised or whether a buggy prior run attached the wrong category.

**Decisions (three changes, one commit):**

1. **Raise `CATEGORISER_REUSE_CONFIDENCE_FLOOR` from 60 → 75** in [`agents/src/categoriser-prompt.ts:20`](agents/src/categoriser-prompt.ts:20). The 60 floor was set in sub-task 2.2 (2026-04-23) when the taxonomy was empty and Categoriser needed permission to populate it. After 7 categories formed and 12 pieces categorised, the floor's job shifted from "let Categoriser build" to "stop Categoriser from stretching." 75 is high enough to require the piece's *primary* underlying subject to fit the reused category — secondary thematic echoes (this piece's pharma-supply-chain thread) won't clear it. Quantitative read: 11 of the prior 12 piece-category assignments are at 80+ confidence based on observer event logs; the 70-75 band has been the cross-domain stretch zone. Floor change cuts that band off cleanly.

2. **Surface existing assignments on the skipped-path observer log.** New `ExistingAssignmentSummary` interface in [`agents/src/categoriser.ts`](agents/src/categoriser.ts). The idempotency guard query at line 147 changes from `SELECT COUNT(*)` to a `SELECT … JOIN categories` that returns the actual rows. `CategoriserResult` gains a required `existingAssignments: ExistingAssignmentSummary[]` field (empty on the success path, populated on the skipped path). [`logCategoriserMetered`](agents/src/observer.ts) extends the skipped-path body to read: *"Already assigned to: State Violence & Justice Systems (75%), Commodity Shocks (70%). No Claude call fired. Latency: 11ms (DB only)."* Fallback note when the array is empty: *"No existing assignments visible (race or stale state)"* — covers the edge case where the guard fires on a piece with no rows (theoretically impossible since the guard's whole reason for firing is `existingAssignments.length > 0`, but defensive).

3. **D1 surgery: delete the firing-squads → Commodity Shocks row + decrement piece_count** for the `commodity-shocks` category. One-shot operational fix, runs after the floor change deploys (so a future re-trigger can't re-add it). Leaves "State Violence & Justice Systems" as the sole category for the piece — the right primary, the right shape.

**Trade-offs:**

- **Floor change cost: more novel categories created.** The reuse-bias was the primary mechanism keeping the taxonomy small (sub-task 2.5 admin curation page was deferred specifically because the bias was holding). At 75 the bias still holds but excludes cross-domain stretches; pieces that would have been borderline reused at 60-74 confidence now either go novel (taxonomy grows) or skip (no second category). Watch this for taxonomy proliferation — if the catalogue hits ~30 categories before ~30 pieces, sub-task 2.5 becomes urgent. Current state: 7 categories, 12 pieces. New observing entry in FOLLOWUPS tracks the next 10 cron firings for novel-category creation rate.
- **Skipped-log change cost: one extra JOIN on a guarded path.** Path runs rarely (manual re-trigger, deploy race, alarm at-least-once retry). Cost is negligible; observability win is large.
- **Surgery cost: none.** Categoriser's idempotency guard (now even more honest with the surfaced assignments) prevents future re-runs from re-attaching Commodity Shocks. Until someone manually deletes the State Violence & Justice Systems row first, the slot is taken.

**Won't fix this session:**

- **The deploy-during-pipeline race itself.** At-least-once semantics + idempotency guards are the platform-correct answer. Every off-pipeline alarm in the system (Categoriser, Reflection, Zita synthesis, Interactive Generator, audio) handles this via the same pattern. Adding deploy-pause coordination would require infrastructure changes outside this session's scope.
- **Reflection / Drafter self-reflection / Zita synthesis don't (yet) have the same surface-on-skip pattern.** Categoriser's idempotency guard is the only one whose output benefits from naming what was already there. Reflection writes new learnings each run (no idempotency conflict); Zita synthesis is rate-limited differently. If the same observability issue surfaces on those agents, port the pattern then.

**Verification:**

- Typecheck clean on touched files (`agents/src/categoriser.ts`, `agents/src/categoriser-prompt.ts`, `agents/src/observer.ts`); 25 pre-existing server.ts SDK-typing errors per CLAUDE.md baseline unchanged.
- D1 surgery verified post-execution: `SELECT count(*) FROM piece_categories WHERE piece_id='7eb5f8a3-…'` returns 1 (down from 2); `SELECT piece_count FROM categories WHERE slug='commodity-shocks'` returns 2 (down from 3).
- Forward verification: next cron firing's Categoriser run with the new floor. If the piece picks 1 category cleanly at 80+ confidence, the floor change is working; if it forces an unwanted novel category, tune back down to 70.

## 2026-04-25: Curator reframed around the Zeemish protocol; "60+ teachability threshold" dropped

**Context / trigger:** The 14:00 UTC slot on 2026-04-25 (`piece_id=fd5b4687…`) declined every one of 50 candidates. Curator's reason: "No teachable stories today. Most candidates are either low-teachability breaking news (Iran diplomacy, murder case, military strikes), culturally-specific political stories (DOJ internal procedures, SPLC donors, firing squads policy), or gaming/tech product announcements lacking universal underlying systems… No candidate reaches the 60+ teachability threshold." The day shipped one piece instead of two.

The decline was the wrong outcome. Murder cases teach human psychology and the systems of grief and justice. Firing-squads policy teaches the philosophy of state violence and the design of execution methods. The Planned Parenthood Botox story (Curator's "mild potential, too shallow") teaches funding interdependencies and how organisations adapt under constraint. **Every story connects to a system.** Curator was gate-keeping against pieces that didn't pattern-match an institutional/supply-chain template — the opposite of "the cure is learning to see and work with the whole."

Investigation showed four root causes in `agents/src/curator-prompt.ts`:

1. **The "60+ threshold" is a ghost number.** The prompt told Claude to skip "if all score below 60" but never defined how to score. Claude invented a conservative floor and applied it.
2. **TEACHABILITY's only worked examples were biased:** "Celebrity scandals: low. Supply chain disruptions: high." Three lines of prompt taught Claude to dismiss human-drama stories.
3. **NO CULTURE WAR was being read as "skip politically charged subjects."** It was meant to be about voice (no tribal language) — but the way it was written, Curator was bouncing DOJ procedures, firing squads, and abortion-adjacent funding stories that Zeemish CAN teach about (without taking sides).
4. **Curator had zero visibility into the Zeemish protocol.** It received 5 selection criteria and never saw "Most human suffering comes from treating connected things as separate." The Drafter, Voice Auditor, and Interactive Auditor all see the protocol via the voice contract; the gatekeeper agent that decides whether ANY piece runs at all did not.

**Decisions:**

1. **Embed the Zeemish protocol at the top of `CURATOR_PROMPT`.** Three-sentence version (with the new "Everything that follows is an attempt to show you what that means — and how to do it." third line that lands in the voice contract this same session). Same surface every editorial-decision agent should have. Curator is not a routing agent — it makes a judgement call every cron firing, and that judgement needs the protocol as the lens.

2. **Replace TEACHABILITY's worked examples with breadth-showing pairs.** Eight categories now (crime/violence → human psychology; celebrity/culture → influence dynamics; supply chain → chokepoints; science discovery → pattern recognition; policy → institutional incentive design; business → market structure; tech announcement → adoption curves WITH a guard for pure-spec announcements; death/loss/dignity → philosophy). The framing line is explicit: "The question is never 'is this teachable?' — it is 'what does this teach?'" Examples are illustrative, not exhaustive — Claude is encouraged to find the connection in any candidate.

3. **Drop "60+ threshold" entirely.** Replace with a "Default: PICK" section that names the narrow conditions under which a skip is justified: (a) the entire candidate set is one breaking event being re-reported with no new angle yet, (b) every candidate is a pure product/spec announcement with no underlying system to teach. "When in doubt, find the connection" is now the load-bearing instruction.

4. **Reframe "NO CULTURE WAR" as "NO TRIBAL FRAMING (not 'no political subjects')".** The rule is about voice, not subject. Zeemish CAN teach about firing squads, abortion-adjacent funding, DOJ procedures, immigration, religion — by surfacing the system without taking a tribal side. "Skip the framing, not the subject" is the explicit instruction.

5. **Soften DEPTH POTENTIAL.** Old: "Can the underlying concept fill 1000-1500 words of real teaching without padding?" — read as a gating question. New: "Almost every story has a concept rich enough for 1000-1500 words. Your job is to find it. Padding gets caught downstream by Voice and Structure auditors; missing pieces don't." Quality enforcement moves to where it already lives (the auditors); Curator stops doing pre-emptive editorial gate-keeping.

6. **Tighten the decline reason.** Curator must NAME the specific condition (e.g., "all 50 candidates are reprints of the same wire-service breaking-news report with no analytical angle yet") rather than dismiss by category ("low-teachability", "shallow"). The prompt explicitly states: "If you cannot name the specific condition, you have not earned the skip — find the connection."

**Trade-offs:**

- **Cost: occasional Rough-tier pieces may ship that wouldn't have shipped before.** Voice Auditor's ≥85 gate, Structure Editor's beat-count check, and the Integrator's 3-revision loop still gate quality downstream. Tier surfacing on the live site (`audit-tier.ts`) labels pieces honestly: Polished (≥85), Solid (70–84), Rough (<70). The cost of one Rough-tier piece is lower than the cost of a no-piece day. The Maine piece for 2026-04-25 already published cleanly at 02:01 UTC — there was no quality argument for skipping the 14:00 slot.
- **Cost: prompt grew from 30 lines to ~80.** Token spend per Curator invocation rises by ~500 input tokens. One Curator call per cron firing — at `interval_hours=12` that's 2/day = ~$0.0001/day on Sonnet 4.5. Negligible.
- **Cost: Claude may now find a teaching angle on stories that genuinely don't have one.** Mitigated by (a) the explicit "narrow skip conditions" list, (b) downstream auditors catching thin pieces, (c) the FOLLOWUPS observing entry tracking pick rate over the next 7 cron firings.
- **Win: the protocol is now load-bearing on the gatekeeper agent, not just the auditors.** This closes a long-standing asymmetry — Curator was the only editorial-decision agent without the protocol in its lens.
- **Win: skip-reason quality goes up.** When the rare legitimate skip happens, the reason will name the specific condition, not pattern-match on category. Operators get a useful signal instead of "no teachable stories today" boilerplate.

**Doc surfaces touched (same commit):** `content/voice-contract.md`, `agents/src/shared/voice-contract.ts`, `CLAUDE.md` all gain the third sentence ("Everything that follows is an attempt to show you what that means — and how to do it.") of the Zeemish protocol. Voice Auditor and Interactive Auditor pick up the extended protocol automatically on next run because they embed `${VOICE_CONTRACT}` directly.

**Out of scope (intentional):** Scanner candidate selection (Scanner is doing its job — surfacing breadth; Curator was the chokepoint). Threshold value tuning (dropped entirely, no replacement number). Categoriser changes (separate taxonomy, separate concerns). README / homepage hero promotion of the protocol (user said "somewhere in the docs"; the three canonical surfaces — voice-contract.md + voice-contract.ts + CLAUDE.md + Curator prompt — are the right scope for this session).

**Verification plan:**

- Local typecheck on touched file clean (zero new errors; 25 pre-existing `server.ts` SDK-typing errors unchanged per CLAUDE.md baseline).
- Forward verification at next 7 cron firings (FOLLOWUPS observing entry below). Pick rate should rise to ~95%+. If skip rate stays high, the prompt rewrite missed something and we tune. If the system over-corrects to consistent Rough-tier pieces, we tune Voice Auditor or revisit DEPTH POTENTIAL guidance.
- Retroactive trigger of today's 14:00 UTC slot deferred to operator decision (one-shot production action; surfaces via dashboard "Trigger daily piece" button).

## 2026-04-25: Ship `interactive_audit_results` table — closes deferred 4.1, unblocks dimension-naming in drawer

**Context / trigger:** The same-day "Drawer drops Rough tier label" fix landed honest copy ("The auditor flagged a concern beyond voice…") but couldn't say WHICH rubric the auditor flagged because the data wasn't persisted. The `logInteractiveGeneratorMetered` observer event already carried per-dimension pass/fail in its `context.finalAudit` JSON, but reading event-shape from the reader path would couple the drawer to event-context shape — fragile. Sub-task 4.1's deferred FOLLOWUP (`interactive_audit_results` table) had been logged on 2026-04-24 with two unblock conditions: "when 4.5 ships OR first debugging session needs the context." Both became true on 2026-04-25 — Phase-1 diagnosis of the 2026-04-25 Maine + 2026-04-24 FISA shipped-low artefacts showed the auditor over-firing on essence on cases the loosened prompt explicitly listed as "Do NOT fail for" (concept-match, structural analogies, worked numeric examples, thematic echo). Tuning the prompt is downstream — but tuning blind without round-by-round data would risk over-correcting. Schema-fits-the-need over query-layer bandaid.

**Decisions:**

1. **Schema mirrors `audit_results` for daily pieces.** `interactive_audit_results(id TEXT PK, interactive_id TEXT NOT NULL, round INTEGER NOT NULL, dimension TEXT NOT NULL, passed INTEGER NOT NULL, score INTEGER, notes TEXT, created_at INTEGER NOT NULL)` + composite index on `(interactive_id, round)`. The deferred FOLLOWUP entry's hint had `auditor TEXT NOT NULL` to mirror the daily-piece column name; renamed to `dimension` because that's the term used everywhere else in the interactive code path (`InteractiveAuditDimension`, `audit.essence.passed`, etc.). Operator clarity beats column-name parity.

2. **Loose TEXT for `dimension` not enum / CHECK.** Consistent with `observer_events.severity`, `learnings.source`, `learnings.category`, `audit_results.auditor`. Adding/folding dimensions stays a zero-migration change. Risk: a typo in the writer drops a row into a never-queried bucket — caught at the next code review since the dimension list is enumerated in [persistAuditRows](agents/src/interactive-generator.ts) directly.

3. **No FK REFERENCES.** Consistent with every other join column in this codebase's 22 prior migrations. Application-layer integrity. Orphan rows from declined-path generations (Generator pre-allocates `interactiveId` before the loop, then bails on Claude's empty-shape decline) are tolerated — same pattern `audit_results` has carried with orphan piece_ids since the day-keyed era.

4. **`score INTEGER` nullable, voice only.** Voice scores 0–100; the three binary dimensions (structure/essence/factual) leave NULL. Matches the auditor's actual return shape (`voice.score`, `structure.passed` only, etc.).

5. **`notes TEXT` as JSON-stringified array.** Same shape `audit_results.notes` carries today. Combines `violations` + `suggestions` into one array per row to keep the reader-side parsing simple — splitting them would require another column or a discriminator field on each item. The auditor's `violations`/`issues` come first in the array, suggestions second; if a future reader wants to render them distinctly, the order is preserved.

6. **Pre-allocate `interactiveId` before the produce→audit→revise loop.** Matches Director's pre-allocate-piece_id pattern from the 2026-04-22 piece_id schema fix. Was previously allocated inside the commit branch at line 394 of [interactive-generator.ts](agents/src/interactive-generator.ts); moving it up means audit rows have a stable FK regardless of commit/decline outcome. Cost: a wasted UUID + up to 12 orphan rows on the declined path. Wins: one writer site, no two-phase commit, no in-memory buffering of audit summaries through the loop. Audit_results already tolerates orphans from the day-keyed era; this matches the convention.

7. **Best-effort persistence inside the loop.** `persistAuditRows` is wrapped in its own try/catch; a write failure logs to `console.error` but does NOT abort the round. The auditor's verdict drives the produce/revise/commit decision regardless of forensic persistence — the drawer's `failedDimensions` field tolerates an empty array. Safer than letting a transient D1 hiccup max-fail an otherwise-passing generation.

8. **D1 batch INSERT for the 4-row write.** `this.env.DB.batch([stmt1, stmt2, stmt3, stmt4])` rather than 4 sequential `.run()` calls. Single round-trip per round; matches existing patterns in `agents/src/director.ts` and `agents/src/learner.ts`. UUID pre-generation per row inside the map is cheap and explicit.

9. **Reader path: latest-round only on the drawer.** Drawer is reader-facing. A future admin interactive-detail page can render full per-round history; the drawer renders just `failedDimensions: string[]` for the latest round's failed dimensions, ordered voice→structure→essence→factual. Single query with a correlated subquery for `MAX(round)`. Order matters — the auditor evaluates dimensions in this sequence, so the drawer copy reads naturally ("the voice and essence-not-reference rubrics" rather than "the essence-not-reference and voice rubrics").

10. **Dimension labels long-form for readers.** `DIMENSION_LABEL` map in [made-drawer.ts](src/interactive/made-drawer.ts) renders `essence` → "essence-not-reference" (the rubric's full name) and `structure` → "structure & pedagogy" (matches the prompt's section header). Internal shorthand stays in code; readers see the human form.

11. **Defense-in-depth: `escapeHtml` on `buildLowNote` output.** Even though `failedDimensions` comes from a fixed enum populated by application code, the dimension TEXT column is loose; future widening would be one less audit-trail concern.

12. **No backfill.** The two existing `quality_flag='low'` rows (FISA 2026-04-24 + Maine 2026-04-25) can't be reconstructed without re-running the auditor — too expensive for forensic value. Final-round dimension-pass data IS observable for both via observer_events JSON. Both legacy artefacts will continue rendering the 2026-04-25-am generic copy ("a concern beyond voice"); fresh interactives generated post-migration will name the rubric.

**Trade-offs:**
- Adds one query per drawer render for pieces that have an interactive (~half of recent pieces). Indexed via `(interactive_id, round)` composite + correlated subquery — single round-trip. Zero cost for pieces without an interactive (the outer query early-exits).
- Doesn't yet extend `loadMadeTeaser` — the open-affordance button still shows the same teaser counts as before. Intentional: teaser is for "what's behind the drawer" enticement, dimension-name belongs in the drawer body.
- `notes` field stays unread by the drawer in v1 — it's persisted for the future admin per-interactive page. Could be omitted from the schema if storage cost becomes a concern; kept because (a) zero rows today and (b) the column is the bridge to the operator-facing surface this table also enables.
- Doesn't solve the auditor over-firing problem — that's the deferred (C) follow-up. But (B) is the prerequisite for any credible (C) tuning: round-by-round data shows whether the auditor flags the same false positives across all 3 rounds (auditor stuck) or whether each round trips a new pattern (Generator + Auditor in unproductive dialog).

**Files:**
- [migrations/0023_interactive_audit_results.sql](../migrations/0023_interactive_audit_results.sql) — table + composite index, additive only.
- [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts) — pre-allocate `interactiveId` before loop, persist 4 rows per round via new `persistAuditRows` helper, drop the now-redundant inline `crypto.randomUUID()` from the commit path.
- [src/lib/made-by.ts](../src/lib/made-by.ts) — extend `MadeInteractive` with `failedDimensions: string[]`.
- [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts) — added `id` to interactives SELECT, latest-round failed-dimension query.
- [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts) — new `buildLowNote(failedDimensions)` helper + `DIMENSION_LABEL` map, `renderInteractiveSection` routes through it via `escapeHtml`.
- Docs: SCHEMA.md (19 tables, 23 migrations + new section), AGENTS.md (Auditor "Persistence" sub-line), FOLLOWUPS.md (closes 2026-04-24 entry), CLAUDE.md (current-state + new top-level section).

**Verification:**
- `pnpm build` clean.
- agents typecheck shape unchanged from prior session (the `persistAuditRows` helper is fully typed; pre-existing SDK-typing errors in `server.ts` are unrelated).
- Local migration applies clean: `wrangler d1 migrations apply zeemish` adds 0023.
- Remote migration apply: `wrangler d1 migrations apply zeemish --remote` clean.
- Drawer renders correctly via stubbed envelope for 4 cases: clean-pass (no lowNote), shipped-low single-dimension fail, shipped-low multi-dimension fail, legacy interactive (no audit rows → generic copy).
- After deploy, next interactive generation (cron 02:00 UTC or manual `/interactive-generate-trigger`) will produce 4–12 rows in `interactive_audit_results` keyed to the new `interactive_id`. Failure mode (generation infrastructure error) leaves orphan audit rows; declined path same.

---

## 2026-04-25: Drawer drops Rough tier label for interactive `quality_flag='low'`

**Context / trigger:** The transparency drawer at `/daily/<date>/<slug>/#made` shipped a self-contradicting message on the 2026-04-25 Maine piece. The "interactive built from this piece" section read **"A quiz titled 'Proportional Displacement and Attribution' · Voice 88/100 · 2 revisions"** with a muted note immediately below: **"Shipped as Rough — auditor max-failed at 3 rounds. The reader can still try it."** Voice 88/100 is **Polished** tier in the daily-piece tier system at [src/lib/audit-tier.ts:27](../src/lib/audit-tier.ts:27) (≥85). The drawer borrowed the word "Rough" from a vocabulary that has nothing to do with this state. Reader sees a contradiction; brand pays the cost.

The two vocabularies mean different things:
- **Daily-piece tiers** (`polished` / `solid` / `rough`) are pure functions of `voice_score`. "Rough" = voice <70.
- **Interactive `quality_flag='low'`** fires whenever ANY of the four InteractiveAuditor dimensions (voice / structure / essence / factual) max-fails all 3 rounds, per the 2026-04-24 ship-as-low reversal of sub-task 4.5. Voice is one of four dimensions, not the gate.

The Maine quiz passed voice (88), structure, and factual at the final round — it failed essence, the same way the FISA quiz failed essence on 2026-04-24. Both were the only `quality_flag='low'` rows in `interactives` (2 of 6 total artefacts as of writing). Both showed Voice 88 + "Rough" in the drawer. The label was wrong on every shipped-low artefact since the drawer's "How this was made" extension landed.

**Decision:** drop the daily-piece tier vocabulary from `renderInteractiveSection`'s `qualityFlag === 'low'` branch entirely. New copy names what actually happened:

> "The auditor flagged a concern beyond voice across all 3 rounds. The quiz still shipped — readers can try it and judge for themselves."

The `made-tier-rough` CSS class drops from the `<p>` (it was importing daily-piece tier styling — colour `#6B6B6B` — into a non-tier context). `.made-interactive-low` gains `color: #6B6B6B` standalone so the visual hierarchy (subtle informational note vs. brand-green CTA) survives the class drop.

**What's deliberately NOT in this commit:**
- **Naming the failed dimension** ("essence-not-reference flagged"). Tempting because the `logInteractiveGeneratorMetered` observer event already carries `context.finalAudit.essencePassed` — but reading observer-event JSON from the drawer's API would couple the reader path to event-shape, fragile. Dimension naming lands cleanly on top of a future `interactive_audit_results` table (the deferred 2026-04-24 sub-task 4.1 FOLLOWUP, now triggered for separate ship).
- **Reverting ship-as-low.** Phase-1 inspection of both shipped-low artefacts confirmed they're useful: the Maine quiz is genuinely good (5 abstract questions on proportional displacement, no proper-noun leaks); the FISA quiz is mostly good with one near-paraphrase issue. 4-of-5 acceptable questions reaching readers beats a 404. The 2026-04-24 reversal stands.
- **Tuning the auditor's essence strictness.** The auditor IS over-firing on cases the 2026-04-24 prompt loosening explicitly listed in "Do NOT fail for" (concept-match, structural analogies, worked numeric examples, thematic echo). But that's a separate concern from the drawer copy. Diagnosis recorded against prod observer events; tuning waits for round-level data from the deferred audit-results table.

**Trade-offs:**
- New copy is longer than the original ("readers can try it and judge for themselves" vs. "The reader can still try it"). The shipped-low note is rare (2 of 6 artefacts so far, ratio expected to drop with auditor tuning), so the extra line takes minimal screen real estate at the population level.
- Doesn't blame the auditor by name — readers don't need to know which agent flagged what. The honest framing ("auditor flagged a concern beyond voice") is enough.
- Existing two shipped-low artefacts retroactively get the new copy on next page render. No backfill, no schema change. Drawer is rendered client-side from API JSON.

**Files:** [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts) `renderInteractiveSection` lowNote, [src/styles/made.css](../src/styles/made.css) `.made-interactive-low`. CLAUDE.md "How this was made drawer surfaces post-publish agents (2026-04-25)" section's quoted copy synced + a forward note added linking to this entry.

**Verification:** `pnpm build` clean. After deploy, the Maine drawer + the 2026-04-24 FISA drawer (`/daily/2026-04-24/after-2-failed-votes-mike-johnson-unveils-new-plan-to-extend-key-u-s-spy-powers/#made`) both render the new copy without the "Rough" label. Voice 88/100 line and the lowNote no longer contradict each other.

---

## 2026-04-25: Surface Categoriser + Interactive in "How this was made" drawer

**Context / trigger:** The transparency drawer at `/daily/<date>/<slug>/#made` advertises itself as **"the full creation story of this piece — timeline, auditors, rules."** Today it isn't. Three of the 16 agents leave no trace in the drawer: **Categoriser** (#13, since 2026-04-23 — writes to `categories` + `piece_categories`), **InteractiveGenerator** (#15, since 2026-04-24 — writes to `interactives` + sets `daily_pieces.interactive_id`), and **InteractiveAuditor** (#16, since 2026-04-24 — final state on the `interactives` row). All three run as Director alarms 1s after `publishing done` and log only to `observer_events`, not `pipeline_log`, so the drawer's existing TIMELINE block can't see them. The drawer's API queried 6 tables and skipped the 4 that hold this story. User caught it on the 2026-04-25 Maine piece; the "See if it landed →" link on the last beat (sub-task 4.6) proved a `categories` row + `interactives` row both existed for that pieceId — both invisible to the drawer.

**Decisions:**

1. **Two dedicated sections, not one combined "post-publish work" block.** Categories answers "where does this piece live in the library?" (taxonomic claim). Interactive answers "what's the quiz built from this piece?" (sibling artefact with its own URL). Bundling muddles both. The drawer already gives Audio its own section even though it's a single producer-agent's output — same one-section-per-concern rhythm. Two sections also let each gracefully omit independently — they have different rollout dates (2026-04-23 vs 2026-04-24), and at deploy time some pieces will have one and not the other.

2. **Order: PIECE → TIMELINE → ROUNDS → RULES → CANDIDATES → AUDIO → CATEGORIES → INTERACTIVE → COMMIT → LEARNINGS.** Mirrors agent timing as the implicit story arc — Categoriser fires 1s post-publish, Generator a beat later, learnings synthesise across the day. Categories before Interactive because Categoriser's alarm fires first and because the taxonomic claim ("filed under …") is lighter context than the sibling-artefact claim that sends the reader to a new URL.

3. **InteractiveAuditor visibility = final state only on the row, not per-round.** Surface `voice_score`, `revision_count`, `quality_flag` from the `interactives` row. Do NOT create the deferred `interactive_audit_results` table (FOLLOWUPS 2026-04-24 sub-task 4.1) to surface per-round audits. Drawer is reader-facing; per-round violation strings are operator-forensic for a 5-question quiz (much smaller surface area than a 600-word lesson). If admin ever needs per-round visibility, ship `interactive_audit_results` then, scoped to that consumer — schema-fits-the-need cuts both ways. Building a table whose only consumer would be a section we'd then want to collapse is the wrong direction.

4. **No `interactive_engagement` aggregates in the drawer.** Per-user completion counts ("87% finished, average score 4/5") are operator-forensic and belong on the admin page. The drawer is a creation-story narrative, not a stats dashboard. Adding aggregates would conflate "how this was made" with "how this performed" — two different lenses, two different surfaces.

5. **Failure / decline = silent omission.** A reader doesn't need to see "we considered an interactive but declined as redundant" — that's an internal QA judgement. Same as how Audio just disappears for pre-audio pieces. Failure visibility for operators lives in observer_events → admin (out of scope here). Three failure modes, one rule: empty array → no Categories section; null interactive → no Interactive section; `quality_flag='low'` → Interactive section renders WITH a muted "Shipped as Rough — auditor max-failed at 3 rounds" note (mirrors sub-task 4.5's reversal — a flagged-low artefact is a real artefact the reader can still try).

6. **Type-agnostic copy on the Interactive section.** Renders as `A {type} titled "{title}"` — works for `quiz` today and any future type (`breathing`, `chart`, `game`) without code changes. The `type` string already lands on the `interactives` row per migration 0022's discriminator. CTA links to `/interactives/<slug>/` (sub-task 4.2's prerendered route).

7. **piece_id-keyed queries, no date-keyed fallback.** Both new tables (`piece_categories` + `interactives.source_piece_id`) post-date the piece_id_backfill era — every row was written with piece_id. The `pieceIdFilter ? ... : ...` ternary pattern used elsewhere in the API is unnecessary here. If `pieceIdFilter` is null (stale cached drawer bundle), both sections silently omit — a small UX degradation for an edge case that goes away after the next page load. Worth the cleaner code over a fallback path that would need its own correctness reasoning.

8. **Forward-flow link + transparency CTA = complementary, not duplicative.** Sub-task 4.6's "See if it landed →" link at end-of-piece is the *forward-flow* exit — the reader who finished reading takes one step sideways to the quiz. The drawer's Interactive CTA is the *transparency* surface — the reader explores how the piece was made and discovers the quiz as a sibling artefact with its own voice score and revision history. Both routes land at `/interactives/<slug>/`. The CTA is intentionally redundant with the end-of-piece prompt; the drawer reader may have skipped the last beat or arrived via #made deep-link.

**Trade-offs accepted:**
- Confidence shown as a soft trailing label (`87% confident`) rather than a bar — we don't want it reading as an audit score (Categoriser's confidence is a different signal from Voice Auditor's voice score).
- Drawer teaser counts (`loadMadeTeaser`) NOT extended to surface "1 quiz / 2 categories" on the unopened-button affordance. Two more queries on every page render for marginal value; can revisit when we know readers want to see it pre-open.
- No backfill for pre-2026-04-23 / pre-2026-04-24 pieces. Graceful omission is the intended behaviour — pre-Area-2 pieces drawer renders identically to today.
- `daily_pieces.has_interactive` (deprecated per migration 0022) untouched.
- Drawer subtitle copy ("the full creation story of this piece — timeline, auditors, rules") not rephrased even though the tagline now technically should mention categories + interactive too. Optional polish; the tagline is generally honest now and the drawer body proves it via the new sections.

**Verified end-to-end in dev preview** (local D1 has no Categoriser/InteractiveGenerator data — those agents only run in prod, so renderer paths verified via stubbed fetch with prod-shape envelopes; API query syntax verified directly):
- API returns 200 with `categories` + `interactive` fields present and correctly defaulted (`[]` / `null`).
- With stubbed prod-shape data: 2 chips render with `/library/<slug>/` hrefs in confidence-DESC order (87% → 64%), Interactive CTA → `/interactives/chokepoints-and-cascades/`, copy reads "A quiz titled \"Chokepoints and Cascades\" · Voice 92/100 · 1 revision".
- `qualityFlag='low'` test: muted "Shipped as Rough — auditor max-failed at 3 rounds. The reader can still try it." note renders above the CTA.
- Plural variants: `0 revisions`, `1 revision`, `2 revisions` all render correctly.
- Mobile 375px: 3 chips wrap to 3 separate rows, zero horizontal overflow.
- Empty-case omission: when `categories=[]` and/or `interactive=null`, sections disappear entirely (no placeholder copy).
- Section order on render: Categories before Interactive when both present, both between AUDIO and COMMIT.
- Zero console errors, zero server errors, `pnpm build` clean.

**Files:** [src/lib/made-by.ts](../src/lib/made-by.ts) (added `MadeCategory` + `MadeInteractive` types, extended `MadeEnvelope`), [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts) (two new piece_id-scoped queries — confidence-DESC join through `piece_categories` to `categories`, single-row select on `interactives WHERE source_piece_id = ?` using `idx_interactives_source_piece`), [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts) (two new render blocks between AUDIO and COMMIT, `renderCategory()` + `renderInteractiveSection()` helpers near existing `renderCandidate()`), [src/styles/made.css](../src/styles/made.css) (`.made-categories` flex-wrap chip bar with 44px min-height, `.made-category-chip` rounded-pill with confidence label, `.made-interactive-cta` brand-green CTA button).

## 2026-04-25: Favicon set + web manifest

**Context / trigger:** The site shipped on 2026-04-18 with no favicon at all — `/favicon.ico` and `/favicon.svg` both 404. Browsers showed the generic globe icon in tabs, bookmarks, and history. Zishan handed over a 5-file design package (favicon.svg master, apple-touch-icon.png at 180×180, icon-192.png, icon-512.png, favicon-source-1024.png raster master) with brand colours #1A6B62 deep teal background + #FAF8F4 cream lowercase z. Already proofed by hand at 16, 32, and 512 px.

**Decisions:**

1. **Four runtime files in `public/`, one design master in `design/`.** The runtime set is `favicon.svg` + `apple-touch-icon.png` + `icon-192.png` + `icon-512.png` + `site.webmanifest`. The 1024 raster master is a designer source, not a runtime asset — readers don't need it served. Stashed at `design/favicon-source-1024.png` as a hand-authored master file kept in repo for future regeneration of additional sizes (multi-size .ico, larger PWA icons) without round-tripping back to the designer. New top-level `design/` directory because the existing `scripts/generate-og-image.mjs` pattern is "the script IS the source"; favicon doesn't have a script (vector + pre-rendered rasters are hand-authored), so a parallel folder of static design masters is the right shape.

2. **Skip .ico.** Modern browsers (Chrome / Firefox / Safari / Edge desktop + iOS Safari + Android Chrome / Samsung Internet) all support PNG and SVG favicons. .ico is needed for IE11 and very old Safari — neither is in scope for a 2026 greenfield Cloudflare-Workers/Astro site. The SVG handles every modern tab-favicon surface (it scales without quality loss); the apple-touch covers iOS home-screen pinning; the manifest's PNG entries cover Android home-screen + PWA install. The 1024 master is parked in `design/` for the day this changes.

3. **`<link rel="icon">` for the SVG only; PNGs reference via the manifest.** Modern pattern — browsers prefer the SVG when available, fall back to whatever the manifest declares for install/home-screen contexts. Adding bare `<link rel="icon" type="image/png" sizes="...">` tags for the 192/512 PNGs would be redundant noise the SVG already covers. Apple's `<link rel="apple-touch-icon">` stays explicit because iOS Safari doesn't read the manifest reliably for that purpose.

4. **`display: "browser"` in the manifest.** The site is not a PWA — no offline mode, no app-shell, no sticky install affordance. `"browser"` is the honest declaration: "yes there's a manifest, no I'm not pretending to be an app." The alternative `"minimal-ui"` and `"standalone"` would change the rendered chrome on install (no URL bar, app-like frame) — misleading for a site whose value is reading and listening. Theme + icon are the manifest's reasons to exist; install-as-app is not.

5. **`name === short_name === "Zeemish"`.** Both fields are required; the spec uses `short_name` when space is constrained (home-screen labels, narrow OS UI). "Zeemish" is already short — no abbreviation needed, no risk of truncation. Keeping them identical avoids a divergence that has to be maintained as the brand evolves.

6. **`theme_color: "#1A6B62"` in both the manifest and a `<meta name="theme-color">` tag.** Duplicated because they apply in different contexts: the meta tag colours mobile browser chrome (Chrome's address bar tint on Android, Safari's status bar on iOS); the manifest field colours the splash screen on PWA install + the OS task switcher card. Both should match the brand. Two places, same value — drift is unlikely.

7. **`background_color: "#FAF8F4"` (cream) in the manifest.** Used for the splash screen flash before the page renders. Matches the site's `zee-bg`. Picking white or anything else would create a visible flash-of-wrong-colour on slow first paint.

8. **All five new asset paths added to `_routes.json` exclude list.** Static images + a JSON manifest don't need worker-applied security headers (no scripts, no auth touchable), and routing them through the worker would add ~10ms per request for zero benefit. Same pattern as the existing `og-image.png` and `robots.txt` exclusions. Keeps the worker's invocation count + bill lower.

**Trade-offs accepted:** No `<link rel="mask-icon">` for legacy Safari pinned tabs — that surface is gone in Safari 18+ and the hassle of maintaining a monochrome SVG variant for it isn't worth the tail. No 32×32 or 16×16 PNG explicit overrides — the SVG renders at every size, and modern Chrome/Firefox/Safari rasterise it correctly for the small tab-icon contexts. If a 16-px sub-pixel rendering bug surfaces later on a specific browser, can revisit then. The design master sits in `design/` (24KB) — adds nothing to deployed bundle size since `public/` doesn't include `design/`.

**Files touched:** [public/favicon.svg](../public/favicon.svg) (new), [public/apple-touch-icon.png](../public/apple-touch-icon.png) (new), [public/icon-192.png](../public/icon-192.png) (new), [public/icon-512.png](../public/icon-512.png) (new), [public/site.webmanifest](../public/site.webmanifest) (new), [design/favicon-source-1024.png](../design/favicon-source-1024.png) (new), [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro), [scripts/post-build.sh](../scripts/post-build.sh).

## 2026-04-25: Require `concept` on interactives schema, audit presence

**Context / trigger:** Final SEO commit in the 2026-04-25 sweep. Initial framing was "every interactive page falls back to the generic Zeemish meta description; add a description field." Verification step (per the plan: "Don't proceed without doing this check") found the meta description was already per-quiz: [src/pages/interactives/[slug].astro:25](../src/pages/interactives/[slug].astro:25) passes `description={data.concept}` to BaseLayout, every existing JSON file has `concept` populated, and the previous SEO commit (`e9fe2d9`) made `<meta name="description">` always render. The premise of the original commit didn't hold — the work collapsed to "structure what's already there."

**Decisions:**

1. **Make `concept` required at the content-collection schema level (`z.string().min(1)`).** The Zod schema previously had `concept: z.string().optional()` even though the Generator emits it on every successful round and the structural validator already throws on empty before the file write ([interactive-generator.ts:650](../agents/src/interactive-generator.ts:650)). Belt-and-braces: schema-level required is defense in depth, and it formalises the SEO contract — every interactive page MUST have a meaningful description. All 7 existing JSON files already comply; backfill not needed.

2. **Keep the field name `concept`, not rename to `description`.** "Concept" is the more precise word for what the field is — one sentence naming the underlying principle the quiz teaches. The Generator prompt's worked examples ("Information asymmetry in markets…", "Single-point-of-failure cascades…") frame it as a concept, not a description. Renaming would force churn across the schema, generator prompt, auditor prompt, page, 7 JSON files, D1 column, AGENTS.md, SCHEMA.md, and the CategoriserAgent's interactive-fetch query — all for a semantic downgrade. The page already passes `concept` AS `description` to BaseLayout; the SEO outcome is identical.

3. **Field stays on the content collection (the JSON file), not promoted to D1.** D1's `interactives.concept` column is the convenience mirror — kept nullable for future minimally-authored interactives that might lack a concept. The content collection is the source of truth (per sub-task 4.2's content-home decision); the meta description reads from `getCollection('interactives')`, not D1. Migrating D1 to NOT NULL would be schema churn for zero reader benefit.

4. **Add a small voice-and-presence check to the auditor prompt, not a new dimension.** One sentence appended to the existing voice extra-rules block: the `concept` line is itself audited — must be a non-empty, voice-compliant sentence (a topic label, a question, or blank fails). Doesn't bloat the prompt; doesn't add a fifth dimension; uses the voice scorer Claude is already running. Catches the failure mode the schema can't catch (a one-word "Chokepoints" passes `min(1)` but isn't a useful page subtitle).

5. **Decline path verified safe before the schema flip.** Before tightening Zod, traced the Generator's decline path: when Claude returns the empty shape `{slug: "", title: "", concept: "", questions: []}`, [parseAndValidate](../agents/src/interactive-generator.ts:617) returns `null`, the loop short-circuits at line 315 (`if (!produced) { declinedInLoop = true; break; }`), and the function returns at the decline branch (line 350) BEFORE any file write. A declined output never produces a JSON file, so a tighter Zod schema can't break a build by reading one. `validateQuiz` itself also throws on empty `concept` at line 650 — that's the second layer. Schema-required is the third.

**Trade-offs accepted:** D1 column stays nullable while the content collection is strict — readers go via the file (always non-empty); admin queries go via D1 (could in principle hit NULL, in practice never does because the Generator INSERT mirrors the JSON). If a future flow ever inserts a D1 row without going through the Generator, this asymmetry could surface — guarded by the same Generator-as-only-writer convention every other interactives column already trusts. The auditor's voice check on `concept` is one line of prompt overhead per audit; acceptable.

**Files touched:** [src/content.config.ts](../src/content.config.ts), [agents/src/interactive-auditor-prompt.ts](../agents/src/interactive-auditor-prompt.ts), [docs/AGENTS.md](AGENTS.md), [docs/SCHEMA.md](SCHEMA.md). No new D1 migration. No backfill (all 7 existing JSON files already pass `min(1)`).

## 2026-04-25: JSON-LD Article schema + consistent meta description on every page

**Context / trigger:** Two related fixes, one file. (1) `<meta name="description">` was conditionally rendered: `{description && <meta>...}` — pages that didn't pass an explicit description (login, auth/verify, dashboard/admin) had no description at all, while their `og:description` always rendered with a fallback. Search engines were getting empty meta descriptions on those pages. (2) Daily pieces had no structured data — no Article schema, no AudioObject. Google's rich-result eligibility (article cards, audio play-button surfacing in search) was missing entirely. Both are well-documented standards that cost zero dependencies.

**Decisions:**

1. **Single `metaDescription` constant feeds `<meta name="description">`, `og:description`, and `twitter:description`.** Replaces three separate references that could drift. The constant uses the prop when set, falls back to a brand-default ("Educate yourself for humble decisions. Daily teaching, made by N agents."). Pages that previously had no description (login, auth/verify, dashboard/admin) now get the brand-default — consistent presence is more valuable than per-page bespoke copy on those low-content surfaces. Pages that already passed an explicit description are unchanged.

2. **`<meta name="description">` always renders.** The conditional emit was the bug. Fix is one line — drop the `{description && ...}` wrapper, always emit using `metaDescription`. Verified: every page on the site now has a description tag matching its og:description.

3. **Article schema, not NewsArticle.** Per Google's structured-data guide, both are valid for article-shaped content. Zeemish *teaches*; it doesn't *report*. NewsArticle implies primary reporting (datelines, beat coverage, breaking-news editorial discipline) — Zeemish takes today's news as a teaching anchor and explains the underlying concept. Calling our work NewsArticle would misrepresent the editorial intent to Google's classifier and risk being judged against news-quality signals (E-E-A-T for journalism, source authority, fact-check prominence). Article is the right fit; BlogPosting was also considered and rejected as too informal.

4. **Single AudioObject per Article in v1.** Pieces have per-beat audio (3–6 clips each) but the JSON-LD emits one AudioObject pointing at a representative beat. Per-beat array (one AudioObject per clip) is the v2 ceiling but not necessary for SEO eligibility — Google needs to see "this article has audio narration", not enumerate every clip. Picker logic at [LessonLayout.astro](../src/layouts/LessonLayout.astro): prefer legacy `audioSrc` if set, else the `"hook"` beat (the standard opening across every piece in this codebase per Drafter's prompt structure), else first iteration order. Alphabetical fallback would have picked `"close.mp3"` on the 2026-04-25 piece — wrong semantically; the hook is the right choice.

5. **`dateModified === datePublished`.** Pieces are permanent (the hard rule). The metadata-vs-content carve-out (DECISIONS 2026-04-18) does allow frontmatter edits — `voiceScore`, `audioBeats`, `qualityFlag`, `beatTitles` — but those are operational metadata, not editorial revisions. From a reader-facing perspective every piece is frozen at publish time. If we ever start editing pieces in a way that changes the teaching content, `dateModified` becomes a separate field. Until then, equating them is honest.

6. **Self-gating via the `article` prop, not `ogType === 'article'`.** Interactives also use `ogType="article"` (they're standalone teaching artefacts) but they don't have a publish date or audio in the JSON-LD-able shape. Gating on `article` being non-null means daily pieces opt in by passing the prop; interactives opt out by not passing it. Cleaner than a boolean enable flag — the data presence IS the signal.

7. **`</script>` injection defense via `\u003c` escape.** `JSON.stringify(schema)` doesn't escape `<` by default. If a future title or description ever contained the literal string `</script>` (defensive — currently impossible because Drafter writes plain English), the JSON-LD block would prematurely close and an attacker-controlled string could inject arbitrary script. One-line replace, no perf cost.

8. **`headline` strips trailing `— Zeemish`.** BaseLayout receives `title` as `"The Cloud Has Weight — Zeemish"` (LessonLayout appends the brand for the `<title>` tag). The JSON-LD `headline` is the editorial title — Google indexes it as the article's name. Stripping the brand suffix gives Google "The Cloud Has Weight", which matches the `<h1>` and the printed-page brain-model of the headline. Same string would be wrong on `<title>` (browser tab needs brand context).

9. **Image array with one entry rather than a bare URL.** Google's docs recommend multiple aspect ratios (16:9, 4:3, 1:1) — we only have one (the OG card at 1.9:1). An array with one entry is forward-compatible with adding more later; a bare URL would need a refactor when we add per-piece dynamic OG. One-item array now, drop more entries in when they exist.

**Trade-offs accepted:** AudioObject points at one beat — not the full reading experience. A future v2 (when there's reader demand for podcast-style aggregation, or if Google starts surfacing per-beat audio play buttons) can split this into an array. Description on daily pieces is ~480 chars, longer than Google's ~155-char display limit — Google will truncate, the full text only matters for share-card previews where it's appropriate. Not refactored in this commit.

**Verified end-to-end in dev preview:** every URL in the test grid (homepage, /library/, /login/, /auth/verify/, daily piece, interactive) returns 200 with `<meta name="description">` present and matching `og:description`. JSON-LD only emits on the daily piece page (not on /interactives despite shared `ogType="article"`). Parsed JSON-LD has all 9 expected fields including `associatedMedia` AudioObject pointing at `hook.mp3` (correct, not alphabetical `close.mp3`). Title strip works (`"The Cloud Has Weight"` not `"The Cloud Has Weight — Zeemish"`). All asset URLs absolutized via `Astro.site`. `pnpm build` clean.

**Files:** [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro) (single metaDescription, JSON-LD block, defensive `</script>` escape), [src/layouts/LessonLayout.astro](../src/layouts/LessonLayout.astro) (publishedAt prop, audio URL picker, passes through `article` prop), [src/pages/daily/[date]/[slug].astro](../src/pages/daily/[date]/[slug].astro) (passes `publishedAt` + `audioSrc`).

## 2026-04-25: Replace SVG og:image with PNG for social platform compatibility

**Context / trigger:** [BaseLayout.astro](../src/layouts/BaseLayout.astro) was advertising `/og-image.svg` as the Open Graph image. None of the major sharing platforms render SVG OG images: Twitter/X, LinkedIn, Facebook, WhatsApp, iMessage, Slack — they all silently drop the preview or show a broken thumbnail. Every Zeemish link shared since launch (2026-04-18) has been previewing as bare text or worse. Real user-visible bug, not polish.

**Decisions:**

1. **PNG over SVG for the format.** Platform support is the entire reason — the spec'd `og:image` MIME types in practice are `image/png` and `image/jpeg`. SVG is technically allowed by the OG spec but no production scraper renders it. PNG also embeds the rendered design (fonts, geometry, colours) into the served bytes, so what gets shared on Twitter is exactly what we authored — no font-fallback drift between platforms.

2. **Static single PNG over per-piece dynamic OG.** Per-piece dynamic OG (headline + tier rendered to PNG at the edge via a Cloudflare Worker route + satori or similar) is the right ceiling but a separate project — needs an edge renderer, font shipping, cache strategy, and per-piece URL injection. v1 ships one PNG that brand-stamps every link the same way. Marked in CLAUDE.md "Remaining minor items" as a future Worker route project.

3. **Hand-rolled SVG → PNG generation script over a build-time pipeline.** OG card design changes maybe twice a year. A build-step that re-renders the PNG on every `pnpm build` would be wasted compute. [scripts/generate-og-image.mjs](../scripts/generate-og-image.mjs) is a one-off: contains the SVG inline, renders to `public/og-image.png` via sharp, run manually when the design changes. Committed alongside the PNG so the design is reproducible — not a black-box artefact.

4. **`sharp` declared as devDependency rather than imported via deep `.pnpm` path.** Sharp was already in the lockfile (transitive dep of Astro's image optimization). Adding `sharp` to `devDependencies` is a declaration not a new install — `pnpm add -D sharp` reused the existing version with zero new bytes downloaded. The "no new dependencies without justification" rule is honored: the dep was already present; we just made it explicitly addressable from project-root scripts. Alternative (importing from `node_modules/.pnpm/sharp@0.34.5/...`) would version-lock the import path and break on any pnpm update.

5. **Drop the "Made by N agents" bottom strip from the design.** Existing SVG read "Daily teaching · made by 13 agents" — already stale (the count is 16 as of Area 4) and would go stale again every time the team grows. New design: cream background, "zeemish" wordmark top-left in deep teal, centered "Educate yourself for humble decisions." in dark ink with subtle gold underline accent, single gold dot top-right. No agent count. Cleaner; zero maintenance burden.

6. **Fonts: system sans-serif fallback (Helvetica Neue on macOS) over embedded DM Sans.** Embedding the DM Sans font file in the SVG would require shipping the font alongside the generator script. The OG card is generated once per design change on the developer's Mac, where Helvetica Neue is the system default. Helvetica Neue and DM Sans are similar enough in geometric grotesque feel that the OG card stays on-brand. If the OG card ever moved to dynamic generation at the edge, font shipping would matter — for static one-off generation it's noise.

7. **Delete `public/og-image.svg`.** Old shared links that cached the SVG URL won't render previews on social platforms anyway (point 1) — there's nothing to break. Keeping both files would just create future "which one's canonical" confusion. `scripts/post-build.sh` `_routes.json` exclude list updated `og-image.svg` → `og-image.png` so the PNG continues to bypass the worker for security headers (no cookies, no auth — pure static asset).

**Trade-offs accepted:** When the team grows or the brand evolves, the PNG needs manual regeneration via `node scripts/generate-og-image.mjs`. That's a 5-second action documented in the script header and in CLAUDE.md. Acceptable cost for a v1 that brand-stamps every shared link consistently across every platform.

**Verified:** Generated 1200×630 RGBA PNG at 19,550 bytes. Visual inspection: cream + teal + black + gold accents render exactly as designed; tagline centred; gold underline + dot accent dots in place; wordmark left-aligned. `pnpm build` clean (verification-step run after the rest of the wire-up).

**Files:** [scripts/generate-og-image.mjs](../scripts/generate-og-image.mjs) (new), [public/og-image.png](../public/og-image.png) (new), [public/og-image.svg](../public/og-image.svg) (deleted), [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro) (extension change), [scripts/post-build.sh](../scripts/post-build.sh) (exclude list), [package.json](../package.json) (sharp declared as devDep), [CLAUDE.md](../CLAUDE.md) (Remaining minor items entry refreshed).

## 2026-04-25: Sitemap + RSS feed + robots.txt sitemap directive

**Context / trigger:** A daily publication without machine-readable discoverability is the single biggest miss a content site can make. No sitemap meant Google Search Console had nothing to crawl on a schedule — new pieces were invisible to organic search until they were stumbled across. No RSS meant Zeemish couldn't reach feed readers (Feedly, Inoreader, NetNewsWire) or the various AI ingestion pipelines that consume RSS. Cost is small; distribution is real.

**Decisions:**

1. **Hand-rolled `/sitemap.xml.ts` rather than `@astrojs/sitemap`.** The integration only auto-includes prerendered routes. The site is hybrid: daily-piece pages and interactive pages are prerendered (Phase 4 + Area 4 sub-task 4.2), but `/library/` and `/library/<slug>/` are SSR (Area 2 sub-task 2.4 — they need D1 access for the categories query). Category slugs themselves live in D1 and aren't visible at build time without seeding `customPages` from a build-time DB query (not feasible on Cloudflare). So the integration would have given us prerendered pages for free but required a second hand-rolled sitemap for the SSR + DB-derived URLs. One SSR endpoint is simpler than two.

   The endpoint enumerates: homepage, /daily/, /library/, every published daily piece (slug-inclusive URL via `pieceUrl(date, deriveSlug(id))`), every interactive (`/interactives/<slug>/`), every category page (`/library/<slug>/`, joined from D1 `categories` via the existing `getCategories` helper). Fail-open on D1 error — static entries always render so the sitemap is never blank.

   Single URL `/sitemap.xml` rather than `/sitemap-index.xml` because the integration's index file is only useful past the 50k-URL limit. We're at 25 URLs today and would need ~3000× growth to hit the cap. `Cache-Control: public, max-age=3600` so the CDN serves it fast between rebuilds.

2. **Hand-rolled `/rss.xml.ts` rather than `@astrojs/rss`.** Briefly added the package, then removed it: `@astrojs/rss`'s default guid is the link with `isPermaLink="true"` (verified at [node_modules/@astrojs/rss/dist/index.js:145](../node_modules/@astrojs/rss/dist/index.js)), and there's no first-class option to override it — putting `<guid>` in `customData` would emit two `<guid>` elements per item, which is invalid RSS. Spec called for `pieceId` as a stable non-URL guid (the right call: `pieceId` is the durable identity of a piece across any future URL changes, so feed readers de-duplicate cleanly). Hand-rolling gave exact control. Also honors the CLAUDE.md "no new dependencies without justification" rule. The hand-rolled XML is ~30 lines including escape helper and RFC 1123 date formatting via `Date.prototype.toUTCString()`.

3. **RSS 2.0 over Atom.** RSS 2.0 has the broadest reader support (Feedly, Inoreader, NetNewsWire, the AI ingestion pipelines that consume feeds). Atom is technically cleaner but every reader speaks RSS 2.0 and Atom is overkill for a single-channel news-style feed. Included `xmlns:atom` + `<atom:link rel="self">` per the validator's recommended best-practice for RSS 2.0 self-discovery.

4. **Description-only items, no full content.** For v1 the RSS item carries the same `description` that's in MDX frontmatter (typically 300–500 chars summary written by Drafter). No `<content:encoded>` with the full beat text. Reasoning: (a) the daily-piece reading experience is built around `<lesson-shell>` beat-by-beat navigation, audio, and the made-by drawer — none of which translates to RSS; (b) full content in RSS encourages reader-app consumption, which would steal the reading experience the site is designed for; (c) AI ingestion pipelines that want full content can fetch the canonical URL from the `<link>`. If reader demand for full content surfaces, adding `<content:encoded>` is a one-line change.

5. **`pieceId` as guid with `isPermaLink="false"`.** The `pieceId` UUID is the stable durable identity in D1; `link` is a derived URL. If we ever change the URL scheme (added `/daily/` already once for slug-inclusion at multi-per-day cadence in Phase 4), feed readers indexed by `pieceId` won't double-publish the same piece. `isPermaLink="false"` tells readers explicitly: this is an opaque identifier, don't try to fetch it.

6. **`robots.txt` advertises the sitemap via the standard `Sitemap:` directive.** This is what Google + Bing crawlers look for to discover the sitemap without manual submission. The Search Console one-time submission is still recommended but the directive means even discovery without submission works.

7. **`<link rel="alternate" type="application/rss+xml">` in BaseLayout `<head>`.** Site-wide auto-discovery — every page advertises the feed, so Feedly's "subscribe to this site" detection works from anywhere on zeemish.io, not just the homepage.

**Why now:** Site is 8 days old, publishing 1+ pieces/day, growing library that's not yet indexed anywhere. SEO and feed-reader distribution are pure-upside additions: a sitemap submission is a one-time action, an RSS feed opens a permanent distribution channel, neither competes with the canonical reading experience on zeemish.io.

**Trade-offs accepted:** Hand-rolled XML means we own the escape function and the RFC 1123 date format (both trivial: 5-line `xmlEscape`, native `toUTCString()`). If the URL list grows past 50k entries we'll need to add sitemap-index splitting (not a near-term concern). Description-only RSS may slightly under-index in AI training pipelines that prefer full text — acceptable cost for the v1.

**Verified end-to-end in dev preview:** `/sitemap.xml` returns 200 with `application/xml`, lists 25 URLs (1 home + 1 daily index + 1 library index + 12 daily pieces + 7 interactives + 3 categories — local D1 has fewer categories than prod). `/rss.xml` returns 200 with `application/rss+xml`, lists all 12 daily pieces newest first with correct `pubDate`, `guid`, and description. `robots.txt` ends with `Sitemap: https://zeemish.io/sitemap.xml`. Homepage source contains the RSS auto-discovery `<link>`. `pnpm build` clean.

**Files:** [src/pages/sitemap.xml.ts](../src/pages/sitemap.xml.ts) (new), [src/pages/rss.xml.ts](../src/pages/rss.xml.ts) (new), [public/robots.txt](../public/robots.txt) (Sitemap directive), [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro) (auto-discovery link), [docs/ARCHITECTURE.md](ARCHITECTURE.md) (new "Public discoverability surfaces" section).

## 2026-04-25: Fix `(correct)` answer-leak in interactive revision/audit prompts + validator guard

**Context / trigger:** Operator screenshot of [/interactives/proportional-displacement-visibility/](https://zeemish.io/interactives/proportional-displacement-visibility/) showed the correct option in every question with a literal " (correct)" suffix appended to the visible option text — readers could see the answers. Live for the time between publish (2026-04-25 01:25 UTC, commit `4de1804`) and this fix. Only this one piece affected; the other six interactives in `content/interactives/` had no `(correct)` strings.

**Root cause:** [agents/src/interactive-generator-prompt.ts:245](../agents/src/interactive-generator-prompt.ts) `buildRevisionPrompt` rendered the prior attempt's options for Claude with the correct answer flagged inline:

```ts
.map((opt, j) => `  ${String.fromCharCode(65 + j)}. ${opt}${j === q.correctIndex ? ' (correct)' : ''}`)
```

The instruction below said "produce a fresh quiz... same JSON shape" — Claude faithfully echoed the annotation into the new option text. This piece max-failed all 3 audit rounds and shipped `quality_flag='low'` under the 4.5 reversal mechanism; rounds 2 + 3 used the revision prompt; round 3's output is what landed. Other interactives that passed audit clean (5 of 7 on the shipped roster) never went through the revision path so were not affected.

The `validateQuiz` structural validator at [agents/src/interactive-generator.ts:642](../agents/src/interactive-generator.ts) checked counts + non-empty + bounds — option text content was not inspected, so the leak passed every gate.

The auditor prompt at [agents/src/interactive-auditor-prompt.ts:166](../agents/src/interactive-auditor-prompt.ts) had the identical inline-annotation pattern. Auditor Claude doesn't generate quizzes (it returns audit verdicts), so this never produced a leak in practice — but the same fragile pattern was present and worth fixing for consistency + future-proofing.

**Decisions:**

1. **Repair the live JSON in place.** Stripped the 5 ` (correct)` suffixes from `content/interactives/proportional-displacement-visibility.json`. `correctIndex: N` per question already encodes the right answer; the suffix was pure leak. Falls under the metadata-vs-content carve-out (no body teaching content changed; the JSON's `correctIndex` was always the source of truth — the option text was incorrectly authored). Verified end-to-end in dev preview: zero `(correct)` substrings in any of 5 questions or the results screen.

2. **Move the correct-answer marker to its own line in both the revision and auditor prompts.** New format:

   ```
     A. Option text 1
     B. Option text 2
     C. Option text 3

   Correct answer: B
   Explanation: ...
   ```

   The annotation can no longer be mistaken for option content because it's structurally separated. Same information for Claude; less ambiguous parse for any echo-the-shape downstream task.

3. **Add a leak-marker guard to `validateQuiz`.** New check rejects any option whose text matches `/\((?:correct|incorrect)\)/i`:

   ```ts
   const leakPattern = /\((?:correct|incorrect)\)/i;
   const leakIdx = options.findIndex((o) => leakPattern.test(o));
   if (leakIdx !== -1) throw new Error(`validateQuiz: question ${i + 1} option ${leakIdx + 1} contains an answer-leak marker (e.g. "(correct)")`);
   ```

   Defense-in-depth — catches the pattern from any future prompt path, not just the revision one. A throw at validation forces the Generator's outer try/catch to either retry the round or terminate the run; no leaky quiz reaches `publishToPath`. The pattern matches both `(correct)` and `(incorrect)` because either annotation in option text is a leak (knowing the wrong ones eliminates them).

4. **Auditor prompt fixed even though it doesn't currently generate output.** The auditor is a single Claude call returning audit JSON, not quiz JSON — so the `(correct)` marker in its prompt has never produced a reader-visible leak. Fixed anyway for two reasons: (a) consistency between the two prompts (one mental model for "how do we tell Claude which option is right"); (b) future-proofing — if the auditor ever gains a "rewrite this question" capability, the leak path opens. Cheap to fix preemptively.

5. **Did not deploy a hotfix to production.** The live `proportional-displacement-visibility.json` repair is committed but only takes effect on next site-worker deploy. Not paging an emergency redeploy because (a) the affected piece is `quality_flag='low'` and shows the "didn't pass all auditor gates" warning chip — readers already see a quality-doubt signal; (b) one piece, low traffic in the first day; (c) clean fix lands with the next routine deploy + Cloudflare cache purge.

**Trade-offs / explicit non-goals:**
- Did not retry-regenerate the affected interactive. Repairing the JSON in place is the metadata-vs-content carve-out — same `correctIndex`, same explanation text, same options minus the leak suffix. A re-generation would produce a different quiz under a different `revisionCount`, losing the audit history. The repair preserves the as-shipped artefact minus the bug.
- Did not change the 3-round retry loop or the 4.5 ship-as-low semantics. The bug was prompt construction, not the retry posture.
- Did not add a structural reject for `(correct)` in the *auditor's* output validator. Auditor returns JSON with audit verdicts; option text doesn't appear in its output shape. If a future change widens the auditor's response shape to include rewritten content, the validator-side guard belongs there too.
- Rollback is `git revert` of this commit + the JSON-repair commit. No schema, no migration, no data unwind.

**Verification trigger:** next interactive that hits the revision path (i.e. fails audit at least once). The prompt now sends `Correct answer: B` on its own line; if Claude produces option text containing `(correct)` regardless, the validator guard catches it and forces a re-roll. Either path keeps the leak out of `publishToPath`.

## 2026-04-24: Loosen InteractiveAuditor essence rule + ship-as-low on max-fail (reverses 4.5's abandon)

**Context / trigger:** Interactive Generator's first real-world run on 2026-04-24 (FISA piece "Why Bills Fail Twice Before They Pass", pieceId `71e2f879…`) max-failed all 3 audit rounds on `essence`. Operator inspection of the top-3 failure citations revealed the auditor catching concept-echoes and structural analogies — not concrete detail-leaks. Specifically:

1. Q2 option A "expansion of authority and others want restriction" flagged for echoing the FISA expansion-vs-restriction debate (borderline fair).
2. Q4 explanation "configuration A satisfies constraints {1,2,3}, configuration B satisfies {1,4,5}" flagged because three numbered sets mirror the piece's three coalitions (structural analogy, not detail-leak).
3. Q5 option D "External observers assess the process as legitimate" flagged for echoing the piece's legitimacy-via-visibility concept (concept echo — which IS the point of the quiz).

The auditor prompt's [six enumerated fail rules](../agents/src/interactive-auditor-prompt.ts) (proper nouns, dates, quoted phrases, recognisable industry framing, reference words, specific numbers) are correctly strict. The prose opener — "must not pattern-match to details" — was being interpreted by Claude more broadly than the enumerated list, catching concept-match and shape-match that aren't actually fail conditions.

Operator judgement (2026-04-24 session): "make it less strikt... it cant be that bad after 3 tries". Two paired fixes shipped together.

**Decisions:**

1. **Loosen the essence rule's interpretation, not the rule itself.** Kept the 6 concrete "Fail if" detail-leak conditions verbatim. Added an explicit "Do NOT fail for" list naming concept-match, generic concept terminology, structural analogies, worked numeric examples, and thematic echo as EXPECTED, not violations. Rewrote the prose opener to frame same-concept testing as "the GOAL of the quiz" (capitalised) so Claude doesn't interpret concept-overlap as a reference leak. Added a self-test at the end ("Would a stranger with no knowledge of the piece still be able to answer this from general understanding?") so the auditor has one operational check instead of two philosophical anchors that conflict.

2. **Ship-as-low on round-3 max-fail instead of abandon. Reverses 4.5's decision.** When all 3 rounds fail audit, the Generator now commits the last attempt with `quality_flag='low'` + `qualityFlag: 'low'` in the content-collection JSON, same mechanism daily_pieces already use for sub-85 voice score. Readers see a "Rough" tier tag; admin shows "FLAGGED LOW"; operator retry button still works. Reasons for reversing 4.5:
   - 4.5's "no mostly-fine salvage from a max-failed round" was theoretical; the real-world failure mode turned out to be auditor-over-strict, not generator-produces-garbage. A 3-rounds-refined quiz is still a useful reader artefact.
   - The paired essence-rule loosening makes genuine max-fails rare. Ship-as-low acts as a safety net for the remaining edge cases.
   - Permanence rule still clean — `quality_flag='low'` is an EXPLICIT marker, not an implicit lowering of the bar. Sub-task 4.1's `quality_flag` column and sub-task 4.6's mention of future-proofing ("vestigial after 4.5's abandon-on-max-fail... future-proofs any future ship-as-low mode") were both deliberate hedges for exactly this reversal.

3. **Drop the `qualityFlag !== 'low'` filter in [src/pages/daily/[date]/[slug].astro](../src/pages/daily/[date]/[slug].astro) last-beat prompt lookup.** Without this change, flagged-low interactives would exist at `/interactives/<slug>/` but never surface to readers in the normal flow — publishing in name only. Dropping the filter treats them like daily_pieces with `quality_flag='low'`: readers see them, the tier tag warns of quality, but the artefact is available. Matches the operator's request that they "publish" (be reader-accessible, not just URL-resolvable).

4. **Terminal-state semantics on `InteractiveGeneratorResult`.** `committed: true` now covers both clean passes and shipped-low. `auditorMaxFailed: true` alongside `committed: true` distinguishes shipped-low from clean-pass. New field `qualityFlag: 'low' | null` on the result matches what's written to D1 + the file. DO state counters: `interactivesGenerated` bumps either way (a shipped-low quiz is still generated content); `interactivesAuditorMaxFailed` only bumps on the low path so clean-vs-low ratio stays legible.

5. **Observer event shape and severity.** The prior `warn` "Interactive auditor max-fail: ... No commit, no D1 row" event is replaced with a `warn` "Interactive shipped (flagged low): ..." event that names the file path, slug, failed gates, top issues, and explicit language that readers see it with a "Rough" tier tag. Severity stays `warn` even though it's a publish — operator introspection on the admin feed should still bubble up low-quality ships for possible retry. Clean passes stay `info`.

6. **Admin UI unchanged in this commit.** Admin already renders `interactiveRow.quality_flag === 'low'` as "⚠ low quality" on the piece deep-dive (lines 816 of [piece/[date]/[slug].astro](../src/pages/dashboard/admin/piece/[date]/[slug].astro)) and the "Retry interactive" button stays available regardless of whether the existing interactive is clean or flagged. Both surfaces handle the new shipped-low state without edit.

**Trade-offs / explicit non-goals:**
- No prompt loosening for the other three dimensions (voice, structure, factual). They haven't shown over-strictness; don't touch.
- No change to the 3-round retry count. Three rounds is right — the fix is in the audit interpretation + the terminal posture, not the loop size.
- Rollback is two `git revert`s (auditor prompt + generator+observer+route+docs). No schema, no migration, no data unwind.

**Verification trigger:** operator hits "Retry interactive" from the admin piece page for `71e2f879-0578-4618-8766-33c6f3ce19a8`. Expected outcome: either a clean pass (auditor loosening was sufficient) or a shipped-low commit (auditor still flags but reader gets the quiz). Either outcome is a functional improvement over the pre-2026-04-24 abandon terminal. If the retry produces yet another max-fail on concept-echoes (not concrete detail leaks), iterate on the auditor prompt further.

## 2026-04-24: Curator prompt enriched with recent-piece semantic context (duplicate-pick fix)

**Context / trigger:** At `interval_hours=12` the 2026-04-24 02:00 UTC and 14:00 UTC cron slots both produced pieces about the same news event — a US soldier charged with using classified intelligence to bet $400K on Maduro's ouster via a prediction market. Both pieces taught the same underlying subject (information asymmetry / prediction markets). Drafter, reading the learnings feed, produced twin titles ("When Someone Knows the Future" / "When One Person Knows the Future") — smoking gun that Curator handed it the same subject twice. The 14:01 UTC piece was deleted under operator-led cleanup; this entry covers the prevention commit.

**Root cause:** Curator's "Already published recently" prompt block at [agents/src/curator-prompt.ts](../agents/src/curator-prompt.ts) passed only `headline` strings. `getRecentDailyPieces(30)` at [agents/src/director.ts](../agents/src/director.ts) SELECTed `headline` only. At 14:00 UTC, Claude DID see "When Someone Knows the Future" in the recent list — but the 14:00 candidate from AP News was "US soldier charged with using classified intel to win $400K…", lexically different enough to pick. Headlines alone don't convey "same underlying concept"; two wire services covering the same event produce different headline shapes. Scanner doesn't cross-run de-dup on concept (by design — the `seenHeadlines` Set only applies within a single scan).

**Decisions:**

1. **Use existing `underlying_subject` column, not a new `underlying_concept` one.** FOLLOWUPS `[observing] 2026-04-19: Curator conceptual diversity (P1.2)` proposed a new column with Claude-derived concept tags + concept-distance scoring. That's the full path. This commit takes the smaller one: `daily_pieces.underlying_subject` is already populated on every row (Drafter writes it on publish; Drafter just wrote it as `"Information asymmetry, prediction markets, and market integrity"` on the 02:01 piece and `"Information asymmetry and prediction markets"` on the 14:01 piece — those strings alone would have been enough semantic context for Claude to spot the overlap). Zero migration, zero backfill, zero new Claude call. If the smaller fix doesn't hold after a week, escalate to the full P1.2 path.

2. **Subject rendered as a 2-line mini-card per recent piece, not a separate block.** Format: `- "{headline}"\n  Underlying subject: {underlying_subject}`. Co-locating the headline + subject makes the semantic overlap legible at a glance; separating them into two lists would invite Claude to scan one and not the other. 30-day lookback unchanged — the same window was already working for genuinely-different stories; only the signal quality needed widening.

3. **Prompt instruction strengthened to name the failure.** Added: "Two pieces teaching the same concept on the same day is a failure state" + "even if the headline is worded differently, even from a different news source, even about a different country or company." Explicit about the fact-pattern the 2026-04-24 incident exhibited — same concept, different wire service, different lexical framing. Also reframed the section header from "avoid repetition" to "avoid repetition of UNDERLYING SUBJECT, not just headline wording" so the signal is named at the top of the block, not buried in the instruction.

4. **Kept `description` field out of the mini-card.** `daily_pieces` has no `description` column — the Drafter-written description lives in MDX frontmatter only. Could have joined against the content collection from the site side, but Curator runs in the agents worker without filesystem access to `content/daily-pieces/`. Adding a `description` column to `daily_pieces` would be a migration + backfill + writer thread for a marginal signal on top of `underlying_subject`. Skipped.

5. **No Scanner change.** Scanner's `seenHeadlines` de-dup is within-scan only, which is correct — cross-run de-dup by headline prefix would miss different-source same-event pairs (the exact 2026-04-24 case). Cross-run de-dup by concept requires the P1.2 column work. In the meantime, Curator is the right layer to catch this: Scanner surfaces candidates honestly, Curator picks with semantic context. Keeping the concerns separate.

6. **Fail-open on DB read error preserved.** The wider SELECT (`headline, underlying_subject`) stays inside the same try/catch that returns `[]` on failure. An empty recent list is better than a blocked pipeline — the pre-publish audit gates will still catch a bad pick, and cross-day repetition is lower blast-radius than a missed day.

**Verification trigger:** 2026-04-25 02:00 UTC cron run. If that run picks a story whose subject is distinct from the 2026-04-24 02:01 piece (which stays live as the 2026-04-24 canonical), the enrichment is working. P1.2 FOLLOWUPS entry stays `[observing]` — one run is not a trend; keep watching for the next week before deciding whether to layer the full `underlying_concept` + distance-scoring path on top.

## 2026-04-24: Area 4 sub-task 4.7 — Interactive engagement tracking endpoint

**Context:** Final sub-task of Area 4. Prior sub-tasks left three client call sites POSTing to `/api/interactive/track` and 404-ing silently: `<quiz-card>` on mount (`interactive_started`) and on results render (`interactive_completed` with score + per-question correctness), and `<lesson-shell>` when the last beat with a passing interactive becomes active (`interactive_offered`). 4.7 builds the endpoint and flips those calls from 404-silent to 200-landed.

**Decisions:**

1. **Append-only event log shape, not aggregated per day.** The `interactive_engagement` table (migration 0022) is event-log-shaped — one row per event. Aggregation happens at query time (`SELECT COUNT(*) FROM interactive_engagement WHERE event_type = 'completed' AND interactive_id = ?`). Contrasts with the daily-piece `engagement` table which aggregates views/completions/audio_plays as counters per (piece_id, course_id, date). Reason: per-question correctness is a JSON array that doesn't aggregate cleanly — we care about individual-response distributions, not a running sum. The natural shape is events.

2. **Short-form event types stored, long-form accepted.** Clients send `interactive_offered`, `interactive_started`, `interactive_completed`. Endpoint strips the `interactive_` prefix before write; stored values are `'offered' | 'started' | 'completed' | 'skipped'`. Matches SCHEMA.md 4.1 docs + makes aggregation query-friendly (no redundant prefix, since the table name already says "interactive_"). Clients don't need to change; the normalisation is an endpoint concern.

3. **`skipped` accepted but no current client sends it.** The spec said "interactive_skipped — inferred (offered but no started before Finish) OR explicit." Inference path is query-time SQL — no write happens for a "naturally skipped" reader. Explicit path leaves the endpoint accept the event type, which lets a future explicit-dismiss UI ("Close" button on the last-beat prompt that fires `interactive_skipped`) ship without an endpoint change. Zero code for the inferred case in 4.7 — it's a SELECT pattern, not a write path.

4. **Either `interactive_id` (UUID) or `interactive_slug` (kebab-case) accepted; one is required.** Necessary because 4.3's `<quiz-card>` knows the UUID (passed from the content-collection via `data-interactive-id`) but 4.6's last-beat prompt knows only the slug (passed via the embedded `<script type="application/json" data-page-interactive>`). Could have forced 4.6 to look up the UUID at build time and pass it too, but the slug is the natural public identifier and the extra flexibility costs one server-side D1 lookup per request (`SELECT id FROM interactives WHERE slug = ?`). Acceptable.

5. **Defensive lookup on provided UUID.** When the client sends an `interactive_id`, the endpoint sanity-checks that the row exists before writing (`SELECT 1 FROM interactives WHERE id = ? LIMIT 1`). Guards against stale HTML bundles carrying a removed interactive's id — without the check, FKs-as-convention would silently write orphan engagement rows. A miss returns 200 `skipped-no-interactive` (same as an unknown slug). 400 would be wrong — the client isn't malformed, the content just changed under it.

6. **400 vs 200-skipped distinction.** 400 for genuinely malformed requests (missing event_type, missing both id+slug, invalid event_type value, bad JSON). 200 with a skipped status for "request was valid shape, but the target doesn't exist right now" (unknown slug, removed UUID, DB error). Reason: 4xx tells the client "your code has a bug, fix it"; 2xx-with-status tells the client "fire-and-forget worked its end of the contract, the data layer just doesn't need this row." The client already `.catch`es both; the distinction is for ops introspection (4xxs in logs are actionable; 200-skipped is not).

7. **`score` and `per_question_correctness` silently dropped if invalid on a `completed` event.** The row still writes with those fields null. Reason: losing a minor attribute shouldn't prevent recording the event (the reader *did* complete). Ops can see "completed event but no score" and diagnose from there. Validation rules: score is a non-negative integer; correctness is an array of 0/1 integers length 1–10 (generous upper bound — the content schema caps at 5 questions but an off-by-one client could send more and shouldn't lose the completion).

8. **Never block the reader.** All DB errors wrapped in try/catch and return 200 with `db-error` status. Matches the posture of `/api/engagement/track` exactly. Engagement tracking is advisory — the UI doesn't depend on it, and a transient D1 failure shouldn't surface an error state to the reader.

9. **user_id from `locals.userId`, not from the request body.** Middleware always populates `locals.userId` (anonymous-first — generates a UUID and sets a session cookie on first visit). Clients don't send user_id; the server reads it. Guarantees no client can write engagement rows under another user's id. Defensive: if `locals.userId` is somehow null (shouldn't happen — middleware runs first), endpoint drops the event with 200 `skipped-no-user`.

10. **Slug regex is strict.** `/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/` — lowercase alphanumerics + hyphens, must start and end with alphanumeric, 2–60 chars. Matches the slug validation used elsewhere in the codebase (library category filter `/library/[slug]/`). Anything else → 400 on the "missing id+slug" branch (the validator treats non-matching slugs as absent).

**Trade-offs:**
- Slug → UUID resolution adds one D1 read per POST. At low volume, negligible. At scale, could cache; for now, trust D1's per-row-id lookup performance.
- No rate limiting on the endpoint. Engagement tracking is tied to reader actions (clicks, page loads), so the natural ceiling is low. If scripted abuse becomes visible in ops, add KV-based throttling like `/api/zita/chat` has.
- `per_question_correctness` stored as JSON string. SQLite has no JSON type; stringification is the idiomatic approach, and the aggregation queries we'll want later (percentage correct per question) are cheap with `json_extract`.
- A reader who reaches the last beat of the same piece twice (hard refresh) generates two `offered` events. `<lesson-shell>` uses `sessionStorage` to dedup within a session, but refresh clears the key. Acceptable — DISTINCT on user_id at aggregation time handles it.
- Infrastructure observability for the endpoint is weak — errors go to 200-with-status rather than logs. A future observability pass could emit to `observer_events` from the site worker (using the existing `src/lib/observer-events.ts` helper) on 400s or DB errors. Not now.

**Verified in preview (localhost:4321) against local D1 with migration 0022 applied + fixture row seeded:**
- 7-case test matrix all correct:
    - Missing event_type → 400 with error message
    - Missing both id+slug → 400 with error message
    - Unknown slug → 200 `skipped-no-interactive`
    - Valid `offered` via slug → 200 `tracked`
    - Valid `started` via UUID → 200 `tracked`
    - Valid `completed` with score + correctness → 200 `tracked`
    - Invalid event_type → 400 with error message
- D1 inspection post-test: 3 rows landed with correct shape — short-form event_type ('offered'/'started'/'completed'), score=3 and `per_question_correctness` = '[1,0,1,1]' (JSON-stringified) only on the completed row, all three rows share the same session user_id.
- `pnpm build` passes clean.

**Rollback:** `git revert <commit>`. Endpoint file removal is clean — the client call sites from 4.3 and 4.6 already handle 404 silently (pre-4.7 state), so reverting just the endpoint restores that behaviour without a client change. D1 rows written while the endpoint was live stay; they're harmless append-only events.

## 2026-04-24: Area 4 sub-task 4.6 — Last-beat prompt

**Context:** With Generator + Auditor in place (4.4 + 4.5), daily pieces can have an associated interactive at a standalone URL. 4.6 adds a small, subtle exit option on the last beat of the piece pointing at that URL — "here's a quick self-check if you want it." The hard constraints: no modal, no routing hijack, Finish button unchanged, prompt only when the piece actually has a passing interactive.

**Decisions:**

1. **Build-time content-collection self-join, not runtime D1 / client fetch / 3rd commit.** Four paths considered:
    - *Runtime D1 query in the daily-piece route*: would flip `prerender = false` on daily pages. Every daily page becomes SSR. Every request hits D1. Performance + caching regression for an ambient feature.
    - *Client-side fetch from lesson-shell*: extra round-trip per page load (or lazy per last-beat reach). Fine, but avoidable.
    - *Generator 3rd commit splicing `interactiveSlug` into MDX frontmatter*: matches `audioBeats` pattern, works permanently. But adds a third Publisher commit per piece (1: text, 2: audio, 3: interactive) — more Publisher surface, more commits to reason about.
    - *Build-time content-collection self-join*: both `dailyPieces` and `interactives` are loaded during `getStaticPaths()`. Building a `Map<pieceId, interactive>` is O(n) at build time, zero runtime cost, zero new commits. Chose this. Clean dependency direction — the interactive points at its source piece via `sourcePieceId` (committed by Generator in 4.4); the daily page reverses the lookup at build.

2. **Data passes via an embedded `<script type="application/json" data-page-interactive>` in LessonLayout.** Considered: passing as `data-interactive-slug` on `<lesson-shell>` via rehype-beats (which already injects `data-piece-id` from frontmatter). Rejected because rehype-beats runs as an MDX transform; it can't easily access Astro's content-collection API during the transform. The embedded JSON script is the cleanest alternative — one element in LessonLayout's output, parsed on mount. Precedent: same pattern 4.3's `<quiz-card>` uses for its quiz payload.

3. **Copy: "See if it landed →"** over spec's starting suggestion "There's a quiz on this →". "See if it landed" frames the quiz as a reader's own self-check — "did the teaching land?" — rather than positioning it as an authored test the reader has to pass. Matches Zeemish's voice (conversational, understated, reader-centric) better than "There's a quiz…" which mentions the thing itself rather than why you'd click. The label is intentionally slightly cryptic out of context; the aria-label carries the full context for screen readers ("Open the interactive quiz: {title} ({N} questions)").

4. **Positioned above `.beat-nav-inner`, separated by a dashed hairline.** Dashed border-bottom signals "related to what's below but distinct." Sits in the same `<nav class="beat-nav">` block so it doesn't compete with the piece body, but doesn't share the Prev/Finish row so the Finish button stays the primary action. Visually: small teal link, no button styling, minimal weight. Hover slightly extends the gap between label + arrow (micro-animation, ~2px).

5. **`interactive_offered` fires exactly once per session per interactive.** Keyed by `sessionStorage[zeemish-interactive-offered:<slug>]`. Firing per-beat-render would double-count if a reader navigates backward then forward. Firing per-session-per-slug matches the analytics semantic "did the reader see the prompt this session?" and preserves a retry's offer signal if the reader visits again tomorrow. Not gated on viewport intersection — the offered event fires when the last beat becomes the active beat (via `render()`), which happens when the reader navigates there via Next button or keyboard ArrowRight. That's the same moment they could click the prompt, so it's the right timestamp for "offered."

6. **POST body includes `interactive_slug`, not just `interactive_id`.** The page-embedded payload has the slug (cheap to build at build time) but not the UUID (would require the interactives row to be loaded; at build time we have the content-collection file which does carry `interactiveId`, but for the POST we pass slug for stable resolution — the UUID can be looked up server-side in 4.7's endpoint by joining `interactives.slug`). Slug is the user-facing identity; the UUID is an internal implementation detail.

7. **`qualityFlag !== 'low'` defensive filter in the lookup Map.** Currently vestigial — after 4.5's abandon-on-max-fail, no committed interactive has `quality_flag='low'`. But the filter costs nothing, and if a future "ship-as-low" mode or manual quality-flag override ever lands, the prompt will naturally hide on those interactives. Belt on top of braces.

8. **No prompt for pieces without an interactive.** Negative case is pure absence of DOM — the script payload isn't rendered, `<lesson-shell>` doesn't find it, no interactive block is ever added to the nav. Zero code paths touched when there's no match. This is why the absence case is robust without special handling.

9. **Test fixture updated to tie `chokepoints-and-cascades.json` to the Hormuz piece's pieceId.** Hand-authored file was `sourcePieceId: null` before (since the fixture is a manual one, not Generator output). For 4.6 to demonstrate anything visibly, it needs to match SOME piece. The Hormuz piece is about a chokepoint — naturally fits the fixture's concept. Updated the JSON file to point at `9ded9bec-1616-4552-b8a5-e69f1e446466`. This change is display-only + test-fixture-only; doesn't affect any real publishing flow.

10. **HTML escaping on slug + title in the injected innerHTML.** Defensive — both come from the content collection (Zod-validated) so the risk of XSS via slug is effectively zero, but the innerHTML injection path (we regenerate the nav's innerHTML on every beat change) warrants escaping regardless. New helper `escapeHtml` added at the bottom of lesson-shell.ts.

**Trade-offs:**
- Build-time join means adding/removing an interactive requires a rebuild. Fine — daily pieces require a rebuild anyway (CI triggers on any MDX/json change in `content/`).
- If a reader navigates to a non-last beat after reaching the last beat, the prompt disappears. Intended — it's beat-local, not persistent.
- `sessionStorage` session-level dedup means a hard refresh re-fires `interactive_offered`. Acceptable — the 4.7 aggregator dedups by DISTINCT user_id anyway.
- No visible indicator on non-last beats that "there's a quiz at the end" — the prompt exists only at the moment you could act on it. Deliberate: surfacing it earlier would compete with the teaching. If reader engagement data shows high finish + low offer → take rates, revisit.
- The `interactive_offered` POST currently 404s (4.7 builds the endpoint). Caught silently. When 4.7 lands, events start landing without a client change.

**Verified in preview (localhost:4321):**
- **Positive case** — Hormuz piece (`/daily/2026-04-18/oil-prices-plunge-as-iran-says-strait-of-hormuz-open-during-/`). Payload `{slug: "chokepoints-and-cascades", title: "Chokepoints and Cascades", questionCount: 4}` present in DOM. On last beat (6 of 6): prompt rendered with label "See if it landed", href `/interactives/chokepoints-and-cascades/`, aria-label "Open the interactive quiz: Chokepoints and Cascades (4 questions)". Single `interactive_offered` POST captured via fetch spy with correct shape `{event_type: "interactive_offered", interactive_slug: "chokepoints-and-cascades", interactive_id: null}`.
- **Negative case** — QVC piece (no matching interactive fixture). Payload absent (`hasPayload: false`). On last beat (8 of 8): prompt not rendered. Zero `interactive_offered` POSTs.
- Screenshot confirmed visual: teal link, dashed separator, doesn't compete with Finish.
- `pnpm build` passes clean; zero console errors on either page.

**Rollback:** `git revert <commit>`. Safe — the changes are additive (content.config.ts already had the `interactives` collection from 4.2; the route + layout + web component gain new behaviour when payload present; pure absence of payload = pre-4.6 behaviour). The test fixture `sourcePieceId` edit is data-only and independently reversible.

## 2026-04-24: Area 4 sub-task 4.5 — InteractiveAuditorAgent + abandon-on-max-fail

**Context:** 4.4 shipped the Generator with structural validation only. 4.5 adds the real audit gate — four dimensions (voice, structure, essence, factual), up to 3 revision rounds, ship-or-abandon on max-fail. Generator is refactored to own the produce → audit → revise loop; Auditor becomes an internal sub-agent. The key design decision: what happens when 3 rounds exhaust without passing.

**Decisions:**

1. **Single-call Auditor, not four specialised auditors.** Daily pieces have three separate agents (VoiceAuditor, StructureEditor, FactChecker) because each has specialised tooling and a ~7000-word scope-of-audit. For interactives (3–5 questions, ~500 words of text max), one comprehensive Claude call that evaluates all four dimensions against the same input is both cheaper (~4× fewer API calls per round) and more coherent (cross-dimension conflicts — e.g. "this option is factually wrong AND references the piece" — surface as a single response rather than across independent reports). The prompt (`INTERACTIVE_AUDITOR_PROMPT`) embeds `VOICE_CONTRACT` directly for the voice dimension and defines per-dimension pass criteria explicitly. Response is structured JSON with per-dimension passed/violations/suggestions + an aggregate `passed`.

2. **Abandon on auditor max-fail (NOT ship-as-quality_flag='low').** This is the load-bearing decision for the sub-task. When all 3 rounds fail, Generator returns `auditorMaxFailed: true`, makes no commit, writes no D1 row, and `daily_pieces.interactive_id` stays NULL. Alternatives considered:
    - *Ship-as-low*: matches daily-piece pattern (quality_flag='low' + banner), but interactives are structural — there's no "mostly-fine salvage" from a max-failed quiz the way there is from a low-voice piece that still teaches useful prose. A quiz that references the piece wholesale, or has wrong correctIndex on multiple questions, or has all-identical options, isn't partially fine.
    - *Abandon*: no commit, no D1 row. Retry is `interactive_id IS NULL` → Generator runs fresh → produces a new attempt with a new slug. No quality_flag='low' state to filter from readers or the 4.6 last-beat prompt.
    - Chose abandon. Rationale: (a) structural content demands binary shipping; (b) permanence rule stays clean (no low-quality content lands permanently in git); (c) retry ergonomics are trivial (fresh generation, not replacement of existing content); (d) no downstream filter logic needed in 4.6 — the last-beat prompt just shows up when `interactive_id IS NOT NULL`.

3. **Generator owns the loop; Auditor is an internal sub-agent.** Considered: Director orchestrates the produce/audit/revise loop directly (matches daily-piece pattern where Director owns the auditor-revision dance). Chose: loop lives in `Generator.generate()`, calls `this.subAgent(InteractiveAuditorAgent, ...)` internally. Rationale: (a) audit rounds are entirely tied to interactive generation — no reuse scenario where Auditor runs outside a Generator round; (b) Director's alarm stays a single call, terminal-state-aware via the extended `InteractiveGeneratorResult` shape; (c) the `revisionCount` + `roundsUsed` state is internally coherent inside the agent that produced it. Director pattern is preserved elsewhere (Categoriser, Drafter.reflect, audio pipeline) where it fits better; interactives just happen to naturally encapsulate the loop.

4. **Revise via a new prompt message, not a prompt-swap.** Both rounds 1 and 2+ use the same system prompt (`INTERACTIVE_GENERATOR_PROMPT` — the essence-not-reference rule doesn't relax on retry, it tightens). Round 1's user message is `buildInteractivePrompt`; rounds 2+ use a new `buildRevisionPrompt` that carries the prior attempt + dimension-by-dimension audit feedback + the original piece context. Asks Claude to rewrite, not incrementally edit ("write new questions that teach the same underlying concept but resolve the issues"). If the feedback makes the concept untenable, Claude can decline mid-revision by returning the empty shape — treated as a terminal decline (same as a round-1 decline).

5. **Defensive pass-gate on Claude's own `passed` booleans.** The Auditor parses Claude's response, trusts the per-dimension `passed` fields, but clamps to threshold logic:
    - `voicePassed = claimedPass && score >= 85`
    - `structurePassed = claimedPass && issues.length === 0`
    - `essencePassed = claimedPass && violations.length === 0`
    - `factualPassed = claimedPass && issues.length === 0`
   A self-contradictory response ("passed: true, score: 60") becomes a fail. Cheap insurance — Claude is usually consistent, but model drift or prompt misalignment can produce internally-inconsistent responses, and the cost of an incorrect pass (low-quality quiz in git) is much higher than the cost of an incorrect fail (extra revision round).

6. **Voice-dimension threshold: 85/100.** Mirrors VoiceAuditor's gate on daily pieces. Exposed as `INTERACTIVE_VOICE_MIN_SCORE` constant in the prompt module so a future tuning pass has a single knob. Score written to `interactives.voice_score` on commit — populates the display-layer `voice_score` column that was provisioned in the 4.1 schema but NULL through 4.4.

7. **`revision_count` is the number of revisions, not the number of rounds.** Committed with `revision_count = roundsUsed - 1`: 0 for first-round pass, 1 for second-round pass, 2 for third-round pass. Matches the user-facing framing ("how many revisions did this take?"). Not populated on max-fail (no row written).

8. **Admin retry is one button regardless of prior state.** The piece-detail page shows "Retry interactive" when `daily_pieces.interactive_id IS NULL` — whether that's because (a) the piece predates Area 4, (b) the natural post-publish alarm hasn't fired yet, or (c) a prior run hit `auditorMaxFailed`. All three states look identical at the DB level, and the recovery action is identical: run Generator fresh. No "retry from round 2" or "replace low-quality version" — the Generator always starts from scratch.

9. **Retry proxy endpoint is a separate file, not merged with audio-retry.** New `src/pages/api/agents/interactive-retry.ts` — ADMIN_EMAIL gated, forwards to `/interactive-generate-trigger`. Considered: extending `audio-retry.ts` with a `type=interactive` query param to unify. Rejected: different agents, different payloads, different retry semantics (audio has continue/fresh/beat modes; interactive has just one action). One-purpose-per-endpoint is the established codebase pattern.

10. **Not cascading "16 agents" user-facing yet.** Same policy as 4.4 — Area 5's explicit remit. AGENTS.md gets a `### 16.` entry for Auditor + updated `### 15.` entry for Generator's loop-owning behaviour. Top-line count stays 14; `AGENT_COUNT = 14`; book / README / homepage footer all untouched until Area 5.

**Trade-offs:**
- Single-call Auditor might mis-weight dimensions under pressure (e.g. a voice-heavy quiz could cause Claude to under-check essence). Mitigation: prompt explicitly flags essence as "THE PRIMARY BAR"; defensive pass-gate catches claimed-pass-with-violations inconsistency. If we observe real-world drift, splitting into voice + essence + structure-factual (3 calls) is the easiest next step.
- 3 rounds × 2 Claude calls per round (produce + audit) = up to 6 Claude calls for one interactive. At Sonnet 4.5 latency (~3–5s per call) that's 20–30s of wall time, well inside the alarm's 15-min budget but a non-trivial cost per interactive. Abandon-on-max-fail means that cost can be fully sunk (no output committed). Mitigation: Generator's decline path during a revision round short-circuits the remaining rounds.
- Admin "Retry" button doesn't distinguish first-time-run from post-max-fail retry. An operator who wants to know "did this piece's Generator run and fail?" reads the observer feed. Acceptable — the indistinguishability at the retry-action level is the whole point.
- Auditor's factual dimension uses Claude's general knowledge, no web search. A claim that's true-in-general but false-in-specific-2026-context (e.g. a stat that was true 10 years ago) could pass. Acceptable for general-concept quizzes (the essence rule already keeps specific-to-the-piece claims out).
- Test fixture `content/interactives/chokepoints-and-cascades.json` from 4.2 is hand-authored and was not audited — if it violates any dimension, it would pass the rendering path but not the (prospective) Generator+Auditor flow. Fixture is a test file, not a production interactive; operator judgement applies.

**Verified:**
- TypeScript compiles. Agents worker: 25 errors, same as after 4.4 — all in server.ts (pre-existing SDK-typing on trigger endpoints). Zero new errors outside server.ts from the refactor or new agent.
- Site `pnpm build` passes clean. New API route `src/pages/api/agents/interactive-retry.ts` + admin section + retry button JS all included.
- `wrangler deploy --dry-run` (agents worker) succeeds. Both `INTERACTIVE_GENERATOR` and `INTERACTIVE_AUDITOR` bindings registered; SQLite migration tag `v14` queued.
- Not auto-run against a real piece (would burn Claude tokens on the live pipeline). Live verification requires hitting the manual retry endpoint or waiting for tomorrow's 02:00 UTC cron.

**Rollback:** `git revert <commit>` reverses the site-side + agents-side code. Agents-worker rollback also needs a `wrangler rollback` for the new DO binding + migration tag `v14`. Generator from 4.4 (sans audit loop) would still work if only the agents side reverted — but the site-side AGENTS.md / CLAUDE.md / DECISIONS.md edits would contradict the deployed code until both sides roll back. Cleanest: revert both together.

## 2026-04-24: Area 4 sub-task 4.4 — InteractiveGeneratorAgent (15th agent)

**Context:** 4.1 set up the schema; 4.2 set up the content home + route; 4.3 built the Web Component for readers. 4.4 adds the producer side — a new agent that generates a quiz for each just-published daily piece, strongly biased toward teaching the UNDERLYING CONCEPT (never the piece's specifics). Mirrors Categoriser's post-publish alarm pattern.

**Decisions:**

1. **Post-publish alarm, not inline in the main pipeline.** Same posture as Categoriser, Drafter.reflect, Learner.analysePiecePostPublish, and Zita synthesis. The pipeline ships text + audio on an aggressive "newspaper never skips a day" timeline; interactives are bonus content and a generator failure should never block the text. Director schedules `this.schedule(1, 'generateInteractiveScheduled', …)` right after `publishing done`, in a fresh DO invocation with the 15-min alarm wall budget. Non-retriable on failure — logs to observer, moves on.

2. **Content collection as write target, Publisher's `publishToPath` as the mechanic.** Reuses the daily-pieces flow (commit MDX/JSON → CI rebuilds → Cloudflare deploys). Files live at `content/interactives/<slug>.json`; Publisher's existing refuse-to-overwrite guard doubles as an idempotence belt on top of the agent's pre-flight `daily_pieces.interactive_id IS NULL` check. No new code in Publisher — the Generator just picks a new path pattern.

3. **Prompt design is the quality bar.** Most of `INTERACTIVE_GENERATOR_PROMPT`'s words are on one rule: *essence, not reference*. A stranger reading the quiz URL must find it useful without having read the source piece. A reader of the source piece must not be able to pattern-match details they remember. The prompt names this as THE ONE RULE, then lists 7 explicit prohibitions (proper nouns, dates, quotes, "according to the piece", "which best describes what happened", specific numbers, industry-label tells) and provides 3 worked examples resolving piece subjects to underlying-pattern quiz subjects (SEC filing → information asymmetry; grid failure → cascades; Hormuz → chokepoints). This is where the agent earns its keep — a structurally-valid but off-concept quiz would ship; a good prompt is what keeps that rare.

4. **Explicit decline path.** Claude can return `{slug: "", title: "", concept: "", questions: []}` to opt out — "this concept is too redundant with recent interactives, don't generate." Better than forcing a bad quiz. Generator reads the 10 most recent interactives (by `published_at DESC`) and shows them to Claude in the prompt for the diversity nudge. Decline logs `interactive_declined` to the observer feed as an info event so operators see the pattern over time.

5. **Structural validation in 4.4, real audit in 4.5.** 4.4 ships with in-agent validation only: question count in [3, 5], options per question in [2, 6], integer `correctIndex` in bounds, non-empty `title` / `slug` / `concept` / `question` / `explanation`. Validation failure throws a specific error string that Director's alarm handler logs verbatim to `observer_events`. The prompt's essence-not-reference rule is trust-the-model in 4.4. 4.5 wraps this same alarm path with InteractiveAuditor — voice / structure / essence / fact gates, up to 3 revision rounds, then either ship or mark `quality_flag='low'`. The decision to ship the Generator with structural-only validation ahead of Auditor is explicit: it gets a real quality loop on a real alarm against real pieces before 4.5 lands, surfacing any prompt weaknesses as debuggable observer events rather than hypothetical prompt-design debates. Trade-off accepted: a structurally-valid but concept-drifted quiz from 4.4 lands permanently in git (permanence rule); 4.5 cannot retroactively fix it. Mitigation: the prompt is designed tightly up front, and a manual trigger endpoint exists for testing against a single piece before flipping the auto-schedule on a production cron.

6. **Slug resolution: kebab-case normalise + collision suffix up to 5 attempts.** Claude is asked to produce a kebab-case slug derived from the concept (not the piece headline). Generator normalises defensively (strip diacritics, collapse non-alphanumerics, trim length). On collision with an existing `interactives.slug`, appends `-2`, `-3`, … up to `-5`. If all taken, throws — that's the signal that the concept is over-represented and the Generator should have declined. Failing loudly surfaces the pattern to ops.

7. **Three terminal states in the result shape:** `skipped` (piece already has `daily_pieces.interactive_id` — idempotent re-run, no Claude call), `declined` (Claude's empty shape — no commit, no D1 write), `committed` (file + both D1 writes landed). The observer metered helper handles all three with distinct info-level event bodies so the admin feed has a visible answer to "did the Generator run?" regardless of the outcome. Mirrors Categoriser's skipped/success split, extended with the new `declined` branch.

8. **`content_json` on the D1 row stays NULL.** 4.2 chose content-collection as the source of truth for interactive content; the D1 row is metadata (id, slug, type, title, concept, source_piece_id, voice_score, quality_flag, revision_count, published_at, created_at). The Generator writes the JSON file via Publisher + a minimal metadata row in D1. No duplication. If a future admin query wants to filter/search by content shape, the column is there to populate lazily.

9. **Not cascading "15 agents" yet.** User's explicit instruction for this sub-task: "Don't update book/09 for the new agents yet — that's Area 5." Applied more broadly to every user-facing count: AGENTS.md's top-line "14 agents total" summary stays, `AGENT_COUNT = 14` in `src/lib/constants.ts` stays, README / homepage footer / ARCHITECTURE docs / book chapter references all stay. The agent gets a numbered entry at `### 15.` in AGENTS.md's per-agent listing — a small transient inconsistency that Area 5's cascade resolves. 4.5 will add InteractiveAuditor at `### 16.` the same way.

10. **Per-interactive Publisher stub scoping.** Uses `this.subAgent(PublisherAgent, 'interactive-publisher-<slug>')` rather than a single shared stub, matching Director's per-piece scoping (`publisher-daily-<date>`, `scheduled-reader-<date>`, `audio-publisher-<date>`). Each commit lives in its own isolated DO instance, preventing any SDK state leak between concurrent interactive generations (unlikely in practice but cheap insurance). Also makes observer traces reading-friendly — "which Publisher handled which commit" is grep-able by slug.

**Trade-offs:**
- A well-structured but concept-drifted quiz from 4.4 lands permanently (permanence rule); 4.5 cannot fix it retroactively — only mark low-quality via an override path that doesn't exist yet. Accepted as the cost of shipping sub-tasks in order.
- Idempotence is single-layer (`daily_pieces.interactive_id` check). If Director's alarm fires twice on the same piece within the same race window, the second invocation would read `NULL` and proceed. Publisher's `publishToPath` refuse-overwrite guard is the safety net (first commit's file would collide with the second). Acceptable.
- Generator reads the 10 most recent interactives for diversity context. At 100+ interactives, the prompt may want a more sophisticated retrieval (e.g. semantic similarity against the piece's concept). Premature now; revisit when the catalogue grows.
- The 10-interactive window means two pieces published within a tight timeframe might both draft the same concept if neither sees the other's output. Order-of-alarm non-determinism within the same 1s schedule. Accepted — the structural `slug` collision check catches the obvious case, and the decline path is available if Claude notices the redundancy.
- Trigger endpoint duplicates ~30 lines of the `/categorise-trigger` handler (piece_id validation, D1 lookup, slug-from-headline resolution, fire-and-forget via `ctx.waitUntil`). Kept inline rather than abstracted — extracting a helper across 4 similar endpoints would hide the per-endpoint variation (different Director method name, different payload shape). If a 5th similar endpoint lands, reconsider.

**Verified:**
- TypeScript compiles; 3 new errors on the new trigger endpoint match the existing SDK-typing pattern every other trigger endpoint has (pre-existing 22 → 25 total). No new errors in `interactive-generator.ts` itself.
- `pnpm build` (site worker) passes clean.
- `wrangler deploy --dry-run` (agents worker) succeeds; INTERACTIVE_GENERATOR binding appears alongside CATEGORISER in the binding list.
- Not auto-run against a real piece in this commit. Auto-generation will happen on the next 02:00 UTC cron; manual verification available via `POST /interactive-generate-trigger?piece_id=<uuid>` with ADMIN_SECRET bearer.

**Rollback:** `git revert <commit>` reverses the site-side AGENTS.md / CLAUDE.md / DECISIONS.md updates. Agents-worker rollback also needs a `wrangler rollback` (or re-deploy of the prior commit) because the new DO binding + migration tag `v13` are deployed separately. Data-layer rollback: DELETE the 0-or-1 rows from `interactives` that this agent committed; any `daily_pieces.interactive_id` it wrote; and `git rm content/interactives/<slug>.json` for any committed file. None of this is automated — an admin cleanup path would land in 4.5 or 4.7.

## 2026-04-24: Area 4 sub-task 4.3 — `<quiz-card>` Web Component

**Context:** Sub-task 4.2 set up the route to emit `<quiz-card data-interactive-id="…">` with a JSON payload child script + `<noscript>` Q&A fallback. 4.3 defines the custom element that upgrades the inert markup into an interactive quiz with a results screen.

**Decisions:**

1. **Progressive-enhancement contract: `<noscript>` fallback is the baseline, JS upgrade adds interactivity.** When JS is off (or the script fails to load), the element stays inert and the browser surfaces the `<noscript>` content — a readable `<ol>` with questions, options, and "Answer: …" explanations. When JS runs, `connectedCallback` appends a new `.quiz` container as a sibling of the `<script>` + `<noscript>` children; the browser naturally hides `<noscript>` content when JS is on, so no imperative hide. The server-rendered payload is the single source of truth that both states read.

2. **Custom element registration over Shadow DOM.** Matches the existing pattern (`<lesson-shell>`, `<audio-player>`, `<zita-chat>`, `<made-drawer>` all use light DOM + `customElements.define`). Shadow DOM would isolate styles but the site has no style leakage problem and the existing `quiz.css` selectors are scoped enough (`.quiz`, `.quiz-option`, `.quiz-review-item`). Light DOM also keeps the `<script>` JSON payload query trivially addressable.

3. **Direct import, not `register.ts`.** `register.ts` bundles the five components daily-piece pages need. Interactive pages don't need any of them — so `src/pages/interactives/[slug].astro` imports `quiz-card` directly via `<script>`. Keeps the interactive-page bundle minimal.

4. **JSON payload via `<script type="application/json">` child, not a `data-*` attribute.** Attributes work for small payloads but stringifying 3–5 questions × 4 options × ~200-char explanations overflows the attribute ergonomics (escaping, line breaks, readability on View Source). `<script type="application/json">` is the standard pattern for server-to-client JSON handoff — browsers don't execute it, the payload preserves formatting, and it reads cleanly in DevTools.

5. **Per-question local state; no server round-trips between questions.** User clicks an option → `selections[currentIndex] = optionIndex` → re-render the current question with the new selected state. Next button advances `currentIndex` + re-renders. The only network calls are the `started` POST on mount and the `completed` POST on results render. Zero latency between question interactions. A wrong answer doesn't penalise the user mid-quiz — correctness is revealed only on the results screen, so the flow feels low-stakes.

6. **Results screen is the only reveal of correctness.** Per-question borders colour-code (green left-border for correct, red-ish for wrong); each item shows the user's answer and — only when wrong — the correct answer plus the explanation. Correct answers get the explanation too (reinforces the reasoning, not just the mark). No "try again" button — if the user wants to retry, they reload. Spec called out "no auto-routing — reader chooses"; the "Back to library" link in the outer route layout is the only exit affordance.

7. **Mount POST fires once per mount (idempotent-adjacent).** Guarded by a `startedFired` boolean so a dev-HMR remount doesn't double-POST in the same connectedCallback pass. Not strictly idempotent across navigations (a user who leaves and comes back generates two `interactive_started` rows) — the 4.7 endpoint aggregates at query time, so this is fine.

8. **Completion POST fires on results render with `score` + `per_question_correctness` array.** Shape matches the 4.1 schema for `interactive_engagement`: `{interactive_id, event_type, score, per_question_correctness: [1,0,1,1]}`. Correctness is an array of 0/1 ints in question order — not option indices, not "correct"/"wrong" strings — so aggregation queries can SUM across runs to see which questions are hardest without re-parsing each row. `keepalive: true` on the fetch so it survives a page-unload race if the user navigates away immediately after results render.

9. **404 is the happy path for 4.3 only.** The endpoint lands in 4.7. Until then, the POSTs return 404 Not Found, which the component swallows via `.catch(() => {})`. The UI doesn't need to know whether tracking succeeded — the reader's experience is identical. Once 4.7 builds the endpoint, the calls start landing without a client change. No feature flag, no conditional — the simplest thing that works both before and after 4.7.

10. **Accessibility: radiogroup pattern on the option list.** Options are `<button>` elements (keyboard + screen-reader friendly by default) inside a container with `role="radiogroup"` and `aria-label` = question text. Each option is `role="radio"` + `aria-checked="true"|"false"` to match native radio semantics even though the elements are buttons — `<input type="radio">` would pass semantically but would fight the styling. Focus-visible outlines inherit the primary green. 44px min tap targets on buttons and options.

11. **Styling mirrors the existing palette.** `#1A6B62` primary, `#E8E4DE` border, `#F5F2ED` summary surface, `#B54747` for the wrong-answer accent (same family as existing error reds elsewhere). No new colour tokens. Rounded corners match `.beat-nav-btn`. Typography scale follows existing `.beats.css` h2 / p rules.

**Trade-offs:**
- Re-rendering the whole container on every state change is wasteful for a 4-question quiz but below any perceptible latency. At 12+ questions it would want a more granular update — not now.
- No retry button means a user who wants to try again must reload. Simpler code, slightly worse UX. Revisit if readers complain.
- `keepalive: true` on fetch has a 64KB payload limit — fine here (our payloads are ~200 bytes).
- `startedFired` is a per-element boolean, not per-session. A reader who reloads mid-quiz generates two `started` rows. Acceptable — aggregation via DISTINCT user_id handles it.
- Under JS-enabled but with the Web Component script failing to load (404 on quiz-card.ts chunk), the user sees the eyebrow + title + concept + back link and NOTHING else — `<noscript>` doesn't surface because JS is on. Mitigation would be a small "Interactive unavailable — refresh to try again" message that's hidden when the element upgrades. Not adding in v1 — script-load failures are rare on Astro-bundled assets, and the page still has a visible way forward via the back link.

**Verified in preview (localhost:4321):**
- Custom element registers: `customElements.get('quiz-card')` defined; container renders with `.quiz-counter`, `.quiz-question`, 4 `.quiz-option` buttons.
- Selection works: clicking option 2 sets `data-selected`, enables `.quiz-next` (was disabled with no selection).
- Navigation works: Q1 → Q2 → Q3 → Q4 → Results, counter increments correctly, "Next question" becomes "See results" on the last question.
- Results render: "3 of 4 correct" with the deliberate 3/4 pattern; per-question review cards show ✓ on correct rows, ✗ on the wrong row, "Correct answer" label only on the wrong row, explanations on all rows.
- POST shapes captured via fetch spy: `interactive_started` POSTs on mount with `{interactive_id, event_type}`; `interactive_completed` POSTs on results with `{interactive_id, event_type, score: 3, per_question_correctness: [1,0,1,1]}`. Both return 404 — expected, swallowed silently. Payload shape matches the 4.1 schema exactly.
- Screenshot verified: question state + results state render cleanly, colour coding on review cards (green/red left-border), primary green button, 44px tap targets.
- `pnpm build` passes.

**Rollback:** `git revert <commit>`. Removing `src/interactive/quiz-card.ts` + `src/styles/quiz.css` + the import line in the route file is a clean undo — the rest of the interactive page (title / concept / `<noscript>` fallback) keeps working.

## 2026-04-24: Area 4 sub-task 4.2 — content collection + route

**Context:** Area 4 interactives are 1:1 with pieces but meant to work standalone. Sub-task 4.1 set up the DB surface; 4.2 picks where the actual content lives and renders it at a URL. The choice: git-versioned content collection (Option A) vs D1 `interactives.content_json` (Option B). Both paths are viable. The question is which better fits "useful standalone, independent, fixable on their own" and the established publishing architecture.

**Decisions:**

1. **Content collection wins. Files live at `content/interactives/<slug>.json`.** The user's explicit intent "fixable on their own" is the deciding factor — git-versioned content means a broken quiz fixes via a PR (edit JSON, push, CI rebuilds, deploys). With D1 as source of truth, a broken quiz fixes via a `wrangler d1 execute` UPDATE or a not-yet-built admin UI; both are worse operator ergonomics. Additionally: the daily-pieces flow already works this way (Publisher commits MDX → CI rebuilds → Cloudflare deploys), so the Generator (sub-task 4.4) reuses an existing mechanic rather than introducing a new one. The admin surface gets transparency for free — every interactive is a reviewable file in the repo, not a hidden row.

2. **JSON over MDX.** Interactives are structured data (questions, options, correctIndex, explanation) — there's no teaching-prose body. MDX is the right format when the body IS the teaching; JSON is right when the structure IS the teaching. Later types (breathing params, chart data, game state) are also naturally JSON. Astro's `glob` loader handles `.json` natively via content collections.

3. **`interactives.content_json` in D1 becomes a nullable convenience mirror, NOT source of truth.** v1 writers leave it NULL. Readers always go to `getCollection('interactives')`. The column stays for two reasons: (a) the 4.1 decision is still right — future admin filters may want to query content shape without filesystem joins; (b) removing it would require a `daily_pieces` / `interactives` table rebuild now that the column exists. Cost of leaving it null is zero bytes of storage per row. SCHEMA.md updated to reflect this clarification.

4. **Schema uses a Zod `discriminatedUnion` on `type`.** First (and only) branch is `quiz` with constraints: 3–5 questions, 2–6 options per question, integer `correctIndex`, required `explanation` per question. Adding a new type (`breathing`, `chart`, `game`) is a two-step change: widen the `type` enum + add a branch to the union. No migration, no backfill. Build-time Zod validation means a malformed file fails CI, not production.

5. **Prerender the route (`getStaticPaths`), don't SSR.** Interactives are self-contained files — no D1 needed to render. Matches daily pieces' prerender pattern; gives fast static HTML. SSR would be needed only if the page pulled anything from D1, which it doesn't (engagement tracking in 4.7 is a POST side-channel, not a render-time read). Library is SSR because it needs D1 category queries; interactives don't have that dependency.

6. **`<quiz-card>` placeholder in 4.2, Web Component definition in 4.3.** Route emits `<quiz-card data-interactive-id="…">` with the full question set as a `<script type="application/json" data-quiz-content>` payload + a `<noscript>` fallback rendering the full Q&A list as a plain `<ol>`. Under JS-enabled with no custom element registered (the state during 4.2), the user sees the eyebrow + title + concept + back link but nothing where the quiz will be. Acceptable — 4.3 upgrades the element within a day. Under no-JS, the `<noscript>` list surfaces — verified via HTML fetch that the `<ol>` contains all questions, options, and "Answer: …" explanations.

7. **404 behaviour via `getStaticPaths`.** Unknown slugs hit Astro's default 404 page (the project's custom `src/pages/404.astro`) — no explicit handling needed. Verified: `/interactives/nonexistent-slug/` returns HTTP 404.

8. **Filename convention: `<slug>.json` (no date prefix).** Daily pieces use `YYYY-MM-DD-<slug>.mdx` because they're discovered and organised by date. Interactives are discovered and organised by slug — the URL is the slug. Adding a date prefix would force the URL/filename to diverge or embed a date nobody cares about. One slug = one file.

9. **Test fixture is abstract, zero references to published pieces.** [content/interactives/chokepoints-and-cascades.json](../content/interactives/chokepoints-and-cascades.json) teaches the concept of chokepoints + cascading failures in fully generic terms — no mention of Hormuz, QVC, airlines, Iran, or any specific piece. This is both a functional test fixture and a concrete anchor for the "essence not reference" quality bar the Generator prompt (4.4) must enforce. If you read it and can't tell which piece it came from, the bar is met.

**Trade-offs:**
- Every new interactive triggers a full site rebuild (already the case for daily pieces — not new cost).
- Generator's write path is more complex than a D1 INSERT (needs a GitHub Contents API call, same as Publisher's daily flow). Acceptable — the Publisher's existing infrastructure handles it with minimal new code in 4.4.
- A 2026-04-24 build that prerenders everything at once will bundle all interactives into every deploy — fine until we have thousands of them, at which point we can revisit lazy/SSR.
- Schema validation at build time means a malformed Generator output fails CI with a Zod error, not at render time — good (early failure) but means CI becomes the gate; a bad file blocks unrelated deploys. Mitigated because the Generator audits itself (4.5) before committing, so malformed files shouldn't reach git.

**Verified:** preview server at :4321.
- Route `/interactives/chokepoints-and-cascades/` returns 200, HTML is 78KB.
- Page title "Chokepoints and Cascades", eyebrow "INTERACTIVE · QUIZ", concept rendered, back link to library.
- `<quiz-card>` element present with `data-interactive-id` attribute matching the UUID in the fixture.
- `<script type="application/json" data-quiz-content>` carries the full question set — parsed in-page, confirmed 4 questions, `type: quiz`, first question text matches fixture.
- `<noscript>` fallback contains `<ol>` with all questions and "Answer: …" explanations (verified via fetched HTML inspection).
- Unknown slug `/interactives/nonexistent-slug/` returns HTTP 404.
- Zero console errors.

**Rollback:** `git revert <commit>`. No migration in this commit (4.1 already shipped the tables). Deleting the content collection entry from `content.config.ts` + the `content/interactives/` dir + the `src/pages/interactives/` dir is a clean removal.

## 2026-04-24: Area 4 sub-task 4.1 — `interactives` + `interactive_engagement` schema

**Context:** Area 4 introduces interactives as a first-class system — standalone-addressable teaching artefacts (first type `quiz`, later `breathing` / `game` / `chart`), 1:1 with pieces but useful without reading the source piece ("essence not reference"). Two new agents (InteractiveGenerator + InteractiveAuditor) need a data surface. Sub-task 4.1 is schema only, no writer, no reader — plumbing that unblocks 4.2 onward.

**Decisions:**

1. **`daily_pieces.interactive_id TEXT` is the single source of truth for "piece has an interactive".** Not the pre-existing `daily_pieces.has_interactive INTEGER` column. `has_interactive` was scaffolded in migration 0006 but no writer, no reader, and no SELECT ever referenced it — every prod row is 0. Grep confirmed one TypeScript type declaration at [src/pages/dashboard/admin/piece/[date]/[slug].astro](src/pages/dashboard/admin/piece/[date]/[slug].astro) as the single hit, with no conditional rendering on it. Keeping both columns and syncing at write time would re-introduce the drift pattern we avoided with `categories.piece_count` in Area 2 (where we accepted denormalisation only because the library's chip-sort read path justified it). Here there's no read pressure. Single column, single truth.

2. **`has_interactive` stays physical, deprecated.** SQLite `DROP COLUMN` requires a full `daily_pieces` table rebuild (snapshot → create-new → copy → drop-old → rename, the same dance as migration 0015 for `daily_piece_audio`). `daily_pieces` is the central piece table with 6+ other tables FK-referencing it — the blast radius of a rebuild for pure hygiene is too wide. Column stays, writers don't touch it, SCHEMA.md marks it deprecated with a forwarding note, the lone type declaration is removed in the same commit so there's zero consumers. The column sits inert (always 0) with zero runtime cost.

3. **`interactive_engagement` is an append-only event log, not aggregated per day.** The existing `engagement` table aggregates views / completions / avg_time_seconds per (piece_id, course_id, date). For interactives, the natural shape is events — `offered` / `started` / `completed` / `skipped` — and completed events carry per-question correctness as a JSON array that doesn't aggregate cleanly (we care about individual-response distributions, not a sum). Events are cheap; aggregation at query time via GROUP BY / DISTINCT is the right layer. Mirrors how `observer_events` and `audit_results` work.

4. **`content_json TEXT` on the row regardless of sub-task 4.2's content-home decision.** 4.2 will decide whether the authoritative content home is a git-versioned `content/interactives/` collection or D1's `content_json`. Either way the row exists for metadata (id, slug, type, title, quality_flag, voice_score, etc.) — and the column gives D1 a queryable copy for admin views, debugging, and any reader that prefers one source. If 4.2 picks content-collection, `content_json` is a convenience mirror the Generator writes on commit; if D1, it's the source. Shape is the same from the DB's perspective.

5. **`type` as loose TEXT, no CHECK.** Consistent with `learnings.source`, `learnings.category`, `observer_events.severity`. First value is `'quiz'`; adding `'breathing'` / `'game'` / `'chart'` later is a zero-migration change. Application layer validates.

6. **`revision_count INTEGER NOT NULL DEFAULT 0` on the row; no `interactive_audit_results` table yet.** Daily pieces persist per-round audit notes in `audit_results` so operators can see revision history on the admin page. For interactives, v1 only needs "did the Generator+Auditor loop pass on round 1 / 2 / 3?" — `revision_count` on the row captures that. Per-round notes become valuable when a debugging session needs to understand *why* an interactive was revised, or when 4.5 surfaces the auditor's flags on the (not-yet-built) admin interactive-detail page. FOLLOWUPS entry logged to revisit.

7. **No FK REFERENCES anywhere.** Consistent with every other join column in this codebase's 21 prior migrations. Application layer owns integrity.

8. **Quality-flag semantic mirrors `daily_pieces.quality_flag` exactly.** NULL = passed, `'low'` = auditor max-failed (3 revision rounds) but shipped anyway. Readers can still reach the interactive at its URL (`/interactives/<slug>/`), but the last-beat prompt on the source piece (sub-task 4.6) filters it out. Same ship-and-retry posture as the text pipeline's voice-fail-but-publish path.

9. **Indexes chosen for Generator/Auditor writes + admin/reader reads.** `idx_interactives_slug` (lookup by URL slug — explicit alongside UNIQUE auto-index for clarity), `idx_interactives_source_piece` (reverse lookup "does this piece have an interactive"), `idx_interactives_published_at DESC` (admin list newest-first). On engagement: `idx_int_engagement_user` (reader's own history), `idx_int_engagement_interactive` (per-interactive completion stats), `idx_int_engagement_int_type` (event-type filter — "how many skipped vs completed").

**Trade-offs:**
- `has_interactive` sits in the schema as dead weight. A year from now, someone might see "why is this always 0?" and grep. Mitigation: SCHEMA.md marks it deprecated with a forwarding note; this DECISIONS entry explains why it wasn't dropped.
- If we find `content_json` on the row is wasteful storage (large JSON × many interactives), we can null it out and fall back to content-collection reads. Reversible.
- `revision_count` alone doesn't tell us *why* something was revised. Fine for v1 — the debugging case isn't urgent until we have interactives in production being revised.
- Event-log table grows without bound. At scale (hundreds of interactives × thousands of readers), a periodic aggregation job into a summary table may be needed. Defer until we see the volume.

**Rollback:** `DROP TABLE interactive_engagement; DROP TABLE interactives;` — both empty at migration time. `daily_pieces.interactive_id` stays physical (can't drop in SQLite without a rebuild); it sits nullable and inert if the code is rolled back. Same reasoning as why we don't rebuild to drop `has_interactive`.

**Verified:** Migration 0022 applied cleanly to remote D1. PRAGMA confirmed:
- `interactives` — 12 columns, types + nullability match spec, `revision_count` DEFAULT 0 correct.
- `interactive_engagement` — 7 columns, correct NOT NULLs on user_id / interactive_id / event_type / created_at.
- Indexes all present (3 on interactives + 1 UNIQUE auto-index; 3 on interactive_engagement).
- `daily_pieces.interactive_id` appears at the end of the column list, nullable TEXT, `idx_daily_pieces_interactive` present.
- Both new tables empty (COUNT = 0 each).

Sets up 4.2 (content home + route) with everything it needs to either write a DB row or a content-collection file.

## 2026-04-24: Area 3 sub-task 3.4 — Admin "All pieces" month-grouped + collapsible

**Context:** Admin home's All Pieces list is a flat scroll. At 9 pieces today it's fine; at 50 it's long; at 365 it's unusable. Library already month-groups (flat, no collapse) — admin should too, but collapsed by default to keep the rest of the control-room scannable.

**Decisions:**

1. **Month-grouped `<details>`, current month open by default.** Each month becomes a `<details>` with `<summary>` = `{Month Year} · N pieces · ▸`. Pieces sort newest-first, so the first group is always the current (or most recent) month — that one gets `open`. Older months collapsed. Triangle indicator mirrors the 3.1 pattern in the same codebase (`▸` with `group-open:rotate-90`).

2. **Filter auto-expands groups with matches; doesn't force-close.** When the filter input has text, any month containing a matching piece opens automatically. Groups with zero matches hide entirely (not just collapse — same as library's `group.style.display = visible ? '' : 'none'` pattern). When the filter clears, user-expanded groups stay expanded — we don't reset to "first open, rest closed". Fighting the user's explicit expand is annoying, and the default-on-load state is already correct for a fresh visit.

3. **Not extracting a shared component with library.** Library and admin diverge on three axes: tag (`<section>` vs `<details>`), item content (library shows full piece cards with description + subject pill; admin shows compact stat rows with date · tier · voice · rounds · candidates · flagged), and collapse behaviour (library is always flat; admin collapses). A shared component would need slots + render props for near-zero reuse — the only truly-shared bit is the `MONTH_NAMES` array (4 lines). Keep parallel implementations. If a third consumer emerges, extract then.

4. **Month-label computation stays inline in admin.astro.** Already inline in `src/pages/library/index.astro`. Duplicating the 12-element month-names array is cheaper than the import + test + maintenance cost of a `src/lib/format-month.ts`. The format is culturally stable (months don't rename); if we ever localise, both call sites switch together in one grep.

5. **Tailwind `group-hover` rename: `group/row` in scoped rows.** Each piece row previously used `group-hover:text-zee-primary`. With the `<details class="group">` wrapper around the month container, Tailwind's default `group` selector would match the nearest ancestor — now the details, not the row. Renamed the row-level modifier to `group/row` (Tailwind's named-group syntax) so hover colour still applies to the anchor being hovered, not every anchor in an open month. Verified visually: opening a month doesn't light up every headline.

**Trade-offs:**
- A user who opens every month then types a filter won't see their old expand state restored when they clear the filter. Accepted — the alternative (remembering pre-filter open state) needs state tracking and isn't intuitive. Typing a filter is already explicit; clearing it restoring nothing is fine.
- Month groups don't show per-month stats in the summary (e.g., how many rough / how many flagged). Could be added; not in 3.4 scope. The per-row tier pill still surfaces that inside an open group.
- `data-month-count` attribute added on the count span but not yet consumed. Reserved for a future tweak (e.g., "N pieces · K flagged" in summary) — minor forward surface. Cheap to leave; trivially deletable if unused in 6 months.

**Files:** EDIT [`src/pages/dashboard/admin.astro`](../src/pages/dashboard/admin.astro) — frontmatter month-group computation block (19 lines), template swap from flat `<ul>` to grouped `<details>` blocks, filter JS extended to hide/open month groups. EDIT [CLAUDE.md](../CLAUDE.md) (sub-task 3.4 entry under Area 3).

**Verification:**
- `pnpm build` clean.
- Seeded 4 extra pieces across April / March / February locally. Curl'd admin page: 3 month-groups rendered — `April 2026 (5 pieces, open)`, `March 2026 (1 piece, closed)`, `February 2026 (1 piece, closed)`. Count strings singular/plural-aware.
- Filter logic simulated against the 7 seeded pieces: `"qvc"` → 1 piece in April, April auto-opens, others hide; `"march"` → 1 in March, March auto-opens; `"2026-02"` → 1 in Feb, Feb auto-opens; `"nothingmatches"` → zero visible, all groups hidden, empty-state shows; empty filter (clear) → everything visible, user-expand state preserved.

**Commit:** next.

---

## 2026-04-24: Area 3 sub-task 3.3 — Admin observer feed severity chips

**Context:** Admin home shows 100 latest observer events chronologically. When something breaks at 2am UTC, the operator wants "what broke" first — scrolling past info-level metering and skipped-run chatter to find the one warn or escalation is the wrong shape. Add a filter at the top.

**Decisions:**

1. **Three chips: All · Warn · Escalation.** Confirmed severity set by grepping `agents/src/observer.ts` — only three values are ever written (`info | warn | escalation`; type declaration at line 6 is the source of truth). Info isn't its own chip because (a) the spec said All·Warn·Escalation explicitly, (b) info is operational noise the operator rarely wants to isolate — when isolating, you're looking for signals, not baselines. Info stays visible under "All". Counts render inline on each chip (`All 100 · Warn 4 · Escalation 2`) so the operator sees volume before clicking.

2. **Client-side filter, no query param.** Admin is a real-time polling surface (pipeline status refreshes; the feed implicitly revalidates on reload). Persisting filter state in the URL would add friction without benefit — a triage session's filter choice is ephemerally session-local. Button-based chips with `aria-pressed` toggles, vanilla JS click handler mutates `card.style.display` + chip class state. Same pattern as the existing All-Pieces text filter on the same page, and visually matches the Area 2 library CategoryChips bar (rounded-full pills, `min-h-[44px]` mobile tap target, flex-wrap, primary background on active).

3. **Chip counts computed in-memory from the already-loaded slice.** No extra D1 query. Astro frontmatter already loads 100 rows; `observerWarnCount` + `observerEscalationCount` are `.filter(...).length` on that slice. Implication: counts reflect the 100-row window, not lifetime severity totals. At current volume that window spans weeks; when it saturates, "100 events · 4 warn · 2 escalation" is still the right framing for recent-triage intent. Lifetime counts would lie about urgency (a 6-month-old escalation isn't the operator's current problem).

4. **Empty-state copy when a filter zeros out.** "No events match this filter." appears when an active chip returns zero cards (e.g., clicking Warn on a week with no warns). Covers the edge case where chip counts update faster than the cards do — but in the current implementation counts are rendered from the same slice the cards come from, so this state should be rare. Defensive copy rather than dead code because future chip additions (e.g., filter by acknowledged state) might hit the path more often.

5. **Inline in `admin.astro`, not a shared component.** The Area 2 library chip bar became a shared `<CategoryChips>` component because both `/library/` and `/library/<slug>/` use it. Severity chips are specific to one feed on one page — extracting to a component would add indirection without reuse. If a second feed ever needs severity filtering (per-piece admin observer section, maybe), revisit then.

**Trade-offs:**
- Chip counts don't update when events are acknowledged mid-session. The counts are rendered at page load time and reflect all loaded events regardless of ack state. Accepted: ack status is orthogonal to severity; operator triaging by severity doesn't care whether something was already acknowledged. If this feels wrong later, a "hide acknowledged" toggle is the natural follow-on, not severity-chip recounting.
- Chip counts don't reflect events beyond the 100-row window. See decision (3) — this is intentional.
- No "Info" chip. If operators later want to isolate info-level noise (diagnostic deep-dive), adding a fourth chip is 4 lines of markup + updating the count tally. Not worth building preemptively.

**Files:** EDIT [`src/pages/dashboard/admin.astro`](../src/pages/dashboard/admin.astro) — 2 new count-derivation lines, chip bar markup block, ~20 lines of filter-handler JS appended to the existing `<script>`. EDIT [CLAUDE.md](../CLAUDE.md) (sub-task 3.3 entry under Area 3).

**Verification:**
- `pnpm build` clean.
- Seeded 6 local observer events (3 info, 2 warn, 1 escalation). Curl'd admin page: 3 chips render with `All 6 · Warn 2 · Escalation 1`; every card carries `data-severity`; empty-state `<p>` present (hidden until zero-match). "All" chip initial state has `aria-pressed="true"` and primary background; others are idle.
- Filter logic mirrored in a standalone simulation: click Warn → 2 cards visible; click Escalation → 1 card visible; click All → 6; zero-match case triggers empty state correctly.

**Commit:** next.

---

## 2026-04-24: Area 3 sub-task 3.2 — Piece page observer events strictly scoped by piece_id

**Context:** The admin piece-detail page's observer section was pooling both same-day pieces' events at 12h cadence, plus system events (admin_settings_changed, zita_rate_limited) that aren't about any piece. Migration 0020 added `observer_events.piece_id` on 2026-04-22, but the query on the piece page still OR'd with a 36h day-window fallback for legacy null-piece_id rows — and four site-worker Zita writers never had their piece_id threading completed (the "bigger cross-cutting refactor deferred" in CLAUDE.md from 2026-04-22). This sub-task closes that gap and drops the fallback.

**Decisions:**

1. **Drop the 36h day-window fallback on the piece page.** The query is now strict: `SELECT * FROM observer_events WHERE piece_id = ? ORDER BY created_at ASC`. Legacy null-piece_id rows (pre-migration-0020 historical + rate-limit events by design) become invisible on per-piece pages. They stay visible on the global admin feed — that surface keeps a time-window query because it's the right level for cross-piece operational triage. No data is lost; the visibility classification is corrected.

2. **Thread piece-id client → API for Zita.** The path: [content frontmatter `pieceId`] → [`daily/[date]/[slug].astro`](../src/pages/daily/[date]/[slug].astro) passes `pieceId` prop → [`LessonLayout.astro`](../src/layouts/LessonLayout.astro) emits `piece-id` attribute on `<zita-chat>` → [`zita-chat.ts`](../src/interactive/zita-chat.ts) reads attribute and includes `piece_id` in POST body → [`/api/zita/chat`](../src/pages/api/zita/chat.ts) validates UUID shape and threads into `logObserverEvent` `pieceId` parameter for three writes (truncated / claude_failed / handler_threw).

3. **Rate-limit observer event stays null-piece_id.** The rate-limit check at [chat.ts:60](../src/pages/api/zita/chat.ts:60) fires BEFORE `request.json()` so we don't yet have `piece_date` or `piece_id` when logging the event. Moving rate-limiting post-parse would let attackers trigger JSON-parse work at unlimited RPS. Rate-limit events stay system-level (null piece_id) — admin sees them on the global feed alongside `admin_settings_changed`, never on a piece page. Correct classification, not a gap.

4. **UUID validation on `piece_id` input.** Server-side regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Malformed input is treated as absent (falls back to null piece_id) rather than rejected with 400. Reason: legacy cached reader bundles that predate this sub-task will send `piece_id: null` or `undefined`; both normalise to null cleanly. A strict 400 would break every cached client until they reload. Defensive: a malformed UUID also can't be bound into the schema column (we've chosen not to add a CHECK constraint, consistent with every other join column in this codebase — a bad value there would be invisible clutter rather than a sev-0 corruption). Falling back to null keeps the bad value out of `piece_id` entirely.

5. **Keep `piece_date` required for `course_slug='daily'`; `piece_id` stays optional.** The existing `piece_date` required-validation at [chat.ts:83](../src/pages/api/zita/chat.ts:83) is the primary scope signal for `zita_messages` (piece_date column has been populated since migration 0012). `piece_id` layers on top for observer-event routing only. Making `piece_id` required now would 400 every legacy cached client; making it required later (after cache turns over ~7d) is cheaper if it turns out to matter. Observer events still route correctly when present and fall back cleanly when absent.

**Trade-offs:**
- Pre-migration-0020 observer events (written before 2026-04-22) remain null-piece_id and are now invisible on per-piece admin pages. Acceptable — they're historical clutter that was never really "about" a specific piece in a reliable way, and the day-window query that surfaced them was already wrong at multi-per-day.
- Observer events for Zita chats initiated by a legacy cached client (pre-this-commit bundle) land with null piece_id. Self-healing once browsers reload the new bundle. Window of exposure = browser cache turnover ≤ ~7d.
- No backfill of null-piece_id observer_events rows attempted. Reason: most existing null rows are legitimately non-piece (rate-limit, admin settings, server errors); guessing piece_id for the rest from (created_at, date-window) intersection would be noisy and the result low-value (historical forensics the ops team doesn't actually reach for). If we ever need to close this, a migration can backfill by matching `created_at` against `daily_pieces.published_at` windows — cheaper after the fact than preemptively.

**Files:** EDIT [`src/pages/daily/[date]/[slug].astro`](../src/pages/daily/[date]/[slug].astro), [`src/layouts/LessonLayout.astro`](../src/layouts/LessonLayout.astro), [`src/interactive/zita-chat.ts`](../src/interactive/zita-chat.ts), [`src/pages/api/zita/chat.ts`](../src/pages/api/zita/chat.ts), [`src/pages/dashboard/admin/piece/[date]/[slug].astro`](../src/pages/dashboard/admin/piece/[date]/[slug].astro). EDIT [CLAUDE.md](../CLAUDE.md) (sub-task 3.2 entry under Area 3).

**Verification:**
- `pnpm build` clean.
- Preview `localhost:4321/daily/2026-04-17/...`: `<zita-chat>` has `piece-id="59a7f53b-9a32-443e-bfa3-27af4471bbff"` attribute; submitting a message captures POST body with `piece_id` field populated.
- Seeded 3 observer_events locally (one with matching piece_id, one null piece_id, one other piece's piece_id). Curled admin piece page: only the matching piece_id event rendered; stats row shows "1 event"; null-piece_id system event and other-piece event correctly absent.

**Commit:** next.

---

## 2026-04-24: Area 3 sub-task 3.1 — Compress admin piece-detail page

**Context:** `/dashboard/admin/piece/<date>/<slug>/` is dense — timeline, every audit round expanded, up to 50 scanner candidates, all observer events, audio rows, the raw-JSON dumps, and (on traffic-heavy pieces) 40+ Zita messages. At ~9 pieces today the wall is tolerable; at 50 it's painful; at 365 it's unusable. First sub-task of the Area 3 arc.

**Decisions:**

1. **Compact summary card at top; forensic sections collapsed by default.** Single flex-wrap stat row now carries: Voice · words · beats · rounds · Facts · Audio status · event count · Zita message count · candidate count · Published · quality flag. Everything the operator previously had to scroll to pick up is now a glance at the top. The forensic sections (pipeline timeline, audit rounds, audio, scanner candidates, Zita, observer events) each wrap in a native `<details>` with the section heading as its `<summary>`, plus a status badge carrying per-section counts. Raw data dumps were already `<details>` — left untouched.

2. **Audio section smart-opens when `!audioComplete`.** Everywhere-fine is the scannable default; broken is where we save the click. An operator landing on a page because "something's wrong with audio" should not have to click into the Audio section to reach the Continue / Start over / per-beat Regenerate affordances. When `has_audio = 1`, the section collapses with a "published ✓" status badge. Every other state (partial rows, failed step, pending, zero rows) opens by default. Implementation: `<details open={!audioComplete}>`.

3. **Status badges in every `<summary>` — honest at a glance.** Each section header carries enough information to decide whether to expand:
   - Pipeline timeline — `N steps`
   - Audit rounds — `N rounds · final voice X/100`
   - Audio — `complete` / `partial (N/M beats)` / `failed` / `pending`
   - Scanner candidates — `N candidates · picked: "headline"`
   - Questions from readers — `N convos · M messages`
   - Observer events — `N events · K warn · L escalation` (severities coloured — escalation in gold, warn in text, info-only in muted)

4. **Native `<details>` over any JS accordion.** Zero runtime cost, keyboard-navigable for free, matches the existing "How this was made" drawer pattern on reader daily-piece pages. Session-local expand state is the native behaviour — no persistence needed per the sub-task spec. Triangle indicator (`▸` with `group-open:rotate-90`) mirrors the existing per-step timeline details pattern already in the same file.

5. **Zita action row (Run synthesis button, All Zita activity link) moves inside the details body.** Previously a right-justified action row lived in the section header. Putting interactive elements inside `<summary>` fights the click-to-toggle interaction. Moved into the first line of the collapsed body — one click to open the section already surfaces the row, and the expand itself is now the first-step of running synthesis.

6. **Retry button IDs and JS logic untouched.** `audio-retry-btn`, `audio-retry-fresh-btn`, `zita-synth-btn`, `.audio-regen-beat-btn` — all still present, all still in the DOM regardless of `<details>` open state, so the `addEventListener` wires at page load work unchanged. Clicking them still requires the section to be open, which is why Audio smart-opens when broken.

**Trade-offs:**
- The eyebrow (tier label above the headline) and the stat row both carry "Audio {status}" adjacent to each other — mild redundancy. Accepted: the eyebrow carries editorial tier (Polished / Solid / Rough / LOW), the stat chip carries operational audio state. Different axes, both scannable.
- Summary badge counts don't reflect filter state — at 50+ candidates or 40+ Zita messages, clicking in still requires reading the full expanded list. Text filter for these is out of scope for 3.1; it belongs in a later sub-task if it becomes painful.
- Previously-visible "Observer events this day" detail is one click away now. Justified: at multi-per-day cadence the events list is already scoped by piece_id (migration 0020, 2026-04-22) so scrolling through legacy day-window clutter was itself a partial UX regression; 3.2 tightens the scope further.
- Stat row wraps on mobile — verified via flex-wrap gap-y; slightly taller hero block, no horizontal overflow.

**Files:** EDIT [`src/pages/dashboard/admin/piece/[date]/[slug].astro`](../src/pages/dashboard/admin/piece/[date]/[slug].astro) (stat-row extension + 6 section wraps + summary derivations). EDIT [CLAUDE.md](../CLAUDE.md) (new Area 3 section).

**Verification:**
- `pnpm build` clean.
- Curl-based render check against seeded local D1 (admin session cookie, 2026-04-17 QVC piece with 5 pipeline steps / 3 audits / 3 candidates / 3 zita rows / 3 observer events spread across severities):
  - 6 top-level section `<details>` present + 3 raw-data `<details>` = 9 total.
  - Status badges render correctly on every section.
  - Audio OPEN when `has_audio=0`, CLOSED when `has_audio=1` — verified by flipping the column and re-curling.
  - Stats row reads: `Voice 88/100 · 1400 words · 6 beats · 1 round · Facts passed · Audio pending · 3 events · 3 Zita msgs · 3 candidates · Published …`.
- Retry button JS untouched; IDs still wire.

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.6 — "13 → 14 agents" cascade

**Context:** Categoriser shipped in 2.2, seeded in 2.3, surfaced in 2.4. Every living doc that named the roster count is now wrong. One atomic sweep to catch all of them.

**Decisions:**

1. **Cascade shape: find every "13" / "thirteen" in living docs + book; decide case-by-case; update live claims, leave historical narrative.** Grep-driven, not mechanical replace. Three classes of hit:
   - Live claims (README "14 agents scan the news", AGENTS.md "14 agents total", CLAUDE.md current-state summary, book chapter that enumerates the roles): **update**.
   - Historical narrative (DECISIONS entries, FOLLOWUPS archive entries, docs/handoff original specs, CLAUDE.md bullets describing specific past commits): **leave**. These describe a past state; rewriting them would falsify the record.
   - Code comments / source (tts-normalize.ts's word-number lookup table contains "thirteen" as an English number word): **leave** — unrelated to agent count.

2. **Book chapter 09 rename, not edit-in-place.** `09-the-thirteen-roles.md` → `09-the-fourteen-roles.md` via `git mv` so history follows. Title updated, intro count updated ("fourteen specific roles"), Categoriser section slotted between Learner (12) and Observer (renumbered to 14). The "Plus one more thing" aside originally said "not a fourteenth agent" about Drafter's reflect method — with Categoriser now being the 14th, rephrased to "not a fifteenth agent" so the argument (reflect is a second method on Drafter, not a new agent) still reads correctly. The "agent-ness" breakdown in chapter 06 updated too: 7 real agents + 6 workers → 8 real agents + 6 workers (Categoriser is a Claude-using agent, joins the real-agents list).

3. **Chapter 06's opening sentence updates from "13 AI agents on a website" to "14 AI agents on a website".** The rhetorical point is the same — "the word agent has had a rough year" — the number is just illustrative. Updating it keeps the chapter in sync with the rest of the book.

4. **Chapter 14's "README says thirteen AI agents" updated to "fourteen".** The quote was descriptive, not load-bearing: the chapter's argument about closing-the-loop doesn't depend on the count. Updating keeps book ↔ README consistent so a reader cross-referencing doesn't see a mismatch.

5. **Cross-chapter references all updated.** `05-ai-models.md` ("system has fourteen roles"), `10-a-day-in-the-life.md` ("Chapter 9 introduced the fourteen roles"), `17-zita-the-deep-agent.md` ("Zita — of all fourteen roles"), `99-glossary.md` (Agent definition + Durable Object definition). `CONTENTS.md` gets the new chapter title. Every link from another chapter to `09-the-thirteen-roles.md` would have been invalid after the file rename — grep confirmed none existed (chapter 9 is only referenced by narrative prose, not `./09-the-thirteen-roles.md` links).

6. **CLAUDE.md's old "Agent count in docs/book" paragraph rewritten.** It previously said "AGENT_COUNT is 14 in code, forward-looking; book + README still say thirteen until Task 10/22 actually add the new agents." That was the correct stance when it was written (only Categoriser didn't exist yet). With 2.2 having shipped Categoriser and 2.6 shipping the cascade, the stance is now "everything is synced." Rewrite reflects that and names the rename explicitly so future maintainers know where the "thirteen roles" file went.

7. **CLAUDE.md's `Database (D1 — 14 tables, 20 migrations)` section updated to `16 tables, 21 migrations`.** The 2.1 schema ship updated the top-level SCHEMA.md but not this CLAUDE.md summary. Caught in this pass; added a `Categoriser:` row listing `categories` + `piece_categories`.

8. **AGENT_COUNT constant unchanged at `14`.** Already the value since the 2026-04-23 evening sweep (commit 6592b6a). Homepage footer + MadeBy drawer + BaseLayout OG description already show 14 — verified in preview during this cascade. No code change needed; just the doc/book cascade.

**Trade-offs:**
- Rename loses file-path stability — any external link to `09-the-thirteen-roles.md` breaks. Git's rename detection keeps blame/history intact for internal tooling; external links (if any existed) 404. Acceptable because the book isn't deployed as a linked URL surface yet (it lives in the repo only).
- Keeping historical DECISIONS/FOLLOWUPS narrative at "13" means a new reader sees inconsistency between history and current. Documented in CLAUDE.md's "Agent count" paragraph so the intent is explicit: history is frozen, living docs are current.
- The book's `06-agents.md` "rated by agent-ness" list got Categoriser appended at the end of the "real agents" group rather than inserted in running order. Accepted — the order inside the list is narrative, not hierarchical, and alphabetical/chronological insertion would have disrupted the rhythm.

**Files:** RENAME `book/09-the-thirteen-roles.md` → `book/09-the-fourteen-roles.md` (title + intro + Categoriser section + numbering + closing). EDIT `book/00-preface.md`, `book/05-ai-models.md`, `book/06-agents.md` (rhetoric + rated-by-agent-ness list), `book/10-a-day-in-the-life.md`, `book/14-closing-the-loop.md`, `book/17-zita-the-deep-agent.md`, `book/99-glossary.md` (2 definitions), `book/CONTENTS.md` (chapter title + link). EDIT `README.md` (opening + "14 agents framing" + AGENTS.md link), `docs/ARCHITECTURE.md` (Stage 4 header), `docs/RUNBOOK.md` (directory listing). EDIT `CLAUDE.md` (intro, current-state, agent-team list with Categoriser at #13 + Observer at #14, database section counts + new Categoriser row, Agent-count-in-docs/book paragraph rewrite, sub-task 2.6 entry added to Area 2 block).

**Verification:**
- `grep -nE "thirteen|\\b13 agents|\\b13 roles|\\b13 AI"` across living docs returns only historical-narrative hits (verified each manually).
- Book chapter 09 renders the 14-section enumeration cleanly — Categoriser section in the same voice as neighbouring Learner/Observer sections.
- Preview at localhost:4321: homepage footer reads "Made by 14 agents."
- `pnpm build` clean.

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.5 — Admin categories page DEFERRED

**Context:** Sub-task 2.5 of the Area 2 plan was an admin UI at `/dashboard/admin/categories/` with rename / merge / delete / lock controls, each action firing an `admin_category_*` observer event. Scoped and ready to build. Zishan called the deferral at the handoff point, before any 2.5 code was written.

**Decision:** Defer. Do not drop.

**Why:** The autonomous ethos runs this project. Categoriser's reuse-bias prevention (strong prompt + slug-collision fallback + ≥60 confidence floor) is the primary strategy for taxonomy health. Admin curation is the fallback for when the primary strategy doesn't hold. Shipping the fallback before observing the primary on real pieces would be (a) premature optimisation of a problem we haven't seen, (b) a subtle contradiction of "autonomous publisher" — the first admin UI for a brand-new agent says we expect to distrust it, and (c) a distraction from watching the system live its first real week. The system's bias is correct: watch, then intervene.

**What's live and what's not:**
- Live: `categories` + `piece_categories` tables (migration 0021), CategoriserAgent end-to-end, `src/lib/categories.ts` helpers, library filter at `/library/` and `/library/<slug>/`, `/categorise-trigger` admin endpoint for manual retag.
- Not live: any UI for mutating category rows. In an emergency `wrangler d1 execute` is the lever (no audit trail, no reassign-across-piece-categories rewrite — operator hand-writes the SQL).

**Unblock criteria:** (a) drift observed in production — Categoriser creates a category an operator wants renamed, or produces a second category that should have reused an existing one. (b) Catalogue reaches ~30 pieces (point at which the v0 taxonomy will likely need a pruning pass regardless of drift). Either triggers 2.5; whichever comes first.

**Trade-offs accepted:**
- No audit trail on `wrangler d1 execute` interventions between now and 2.5 landing. Acceptable because those interventions should be rare; if they become frequent, that's the unblock signal.
- A bad category name set by Categoriser v1 persists forever in the URL (`/library/<slug>/`) until renamed. Acceptable for the same reason — if we need rename frequently, that's signal that the agent needs prompt tuning OR that 2.5 should land. We won't fix one-off ugliness with a deferred UI.
- Reader-facing library URLs bake in today's taxonomy. If we later rename a category via the admin UI (when it lands), old bookmarks may 404 unless the UI preserves slug history. Flag for 2.5's design when it resumes.

**Files:** EDIT [CLAUDE.md](../CLAUDE.md) (2.5 marked deferred with rationale), EDIT [docs/FOLLOWUPS.md](./FOLLOWUPS.md) (new `[observing]` entry with resumption hints).

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.4 — Library category filter

**Context:** Data is in place (2.1 schema, 2.2 agent, 2.3 backfill — 7 categories across 9 pieces). 2.4 surfaces it. Readers get a chip bar on `/library/` to browse by category.

**Decisions:**

1. **Sub-route `/library/<slug>/` over query param `/library/?cat=<slug>`.** Both are shareable, both were cheap. Sub-route wins on URL cleanliness + SEO signal (it's a distinct canonical page for each category). Cost was one extra .astro file; ~80% of the layout lives in a shared `<CategoryChips>` component so the duplication is contained.

2. **Both library routes switched to SSR (`prerender = false`).** Categories live in D1, not in the content collection — prerendering would need a build-time D1 proxy which is fragile. SSR cost is modest: each library render adds 2 D1 queries (~5ms each at the edge). `getCollection('dailyPieces')` still works in SSR mode since Astro content collections are bundled into the worker at build time. Same pattern `/dashboard/admin.astro` and `/dashboard/index.astro` already use.

3. **`getCategories()` filters `piece_count > 0`.** Empty categories can exist transiently after a sub-task 2.5 merge (source just went to 0, about to be deleted). A chip linking to a view with zero pieces is a dead end. The admin categories page will show them; the reader surface hides them.

4. **`CategoryChips.astro` as a shared component.** Same chip bar markup on both routes — pulling it into a single component means the render rule ("All pieces" pinned first + categories sorted by count) lives in one place. Active-chip detection via `aria-current="page"` (accessibility-correct + CSS-targetable).

5. **Chip styling: 44px min-height, flex-wrap, rounded-full pill shape.** 44px is the Apple HIG / WCAG 2.2 minimum touch target. `flex-wrap` lets the bar grow as the taxonomy does without horizontal scroll on mobile (verified at 375×812: chips stack across 3 rows at current 4-chip count, will scale cleanly to 20+ chips later). Rounded-full pill is the existing app idiom (matches Zita's UI, the admin settings page). Active state uses solid `zee-primary` bg; idle state uses transparent bg + `zee-border` outline. `title={description}` on each chip surfaces the description on desktop hover without cluttering the bar.

6. **Route-layer slug validation.** `/library/[slug].astro` validates `slug` against `^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$` before hitting D1 — same kebab rule Categoriser enforces via `normaliseSlug`. Malformed input (double dashes, leading/trailing dashes, unicode, >60 chars) 404s fast with zero DB load. `getCategoryBySlug()` returns null on a valid-shape but unknown slug → also 404 via `return new Response('Not found', { status: 404 })`.

7. **Filter view shows `getCollection` filtered by `pieceIds` Set, not a D1 piece-row fetch.** `piece_categories` gives the set of piece_ids for a slug; content collection gives per-piece frontmatter. Joining in-memory via `Set.has(pieceId)` avoids a SELECT-JOIN across D1 for metadata the worker already has. Cost: content collection is bundled into the worker, memory use is trivial at current n=9; at n=10000 a SELECT-JOIN would start winning but that's years away.

8. **Text filter preserved on the filtered view.** Operates within the subset — placeholder reads "Filter within this category…" so reader knows the scope. Same client-side JS logic. If the category has ≤2 pieces the filter input is hidden (same rule as the unfiltered view).

9. **Stat line on unfiltered view now shows "N categories" alongside "N pieces" and "N subjects".** Cheap signal that the taxonomy exists; grows as categories do.

**Trade-offs:**
- SSR on library pages gives up static-HTML edge caching for the reader path. Accepted — library is a low-traffic page vs daily piece reads, and the D1 query cost is well under human perception.
- Filtered view re-fetches all pieces via `getCollection` then filters in-memory. At very large catalogue sizes (10k+) this would become wasteful; at 9 pieces (today) or even 3 years × 2/day = ~2200 pieces, the bundled content collection is small and the join is fine. Revisit if the catalogue ever gets into the five-figure range.
- `piece_count=0` categories disappear from the reader-facing chip bar but stay in `categories`. The admin categories page (sub-task 2.5) surfaces them so operators can delete them after a merge.
- Two `.astro` files share ~60 lines of list-rendering markup. Chose duplication over a third shared component because list rendering tangles with month-grouping state that would bloat the component's prop surface. Mild code smell; acceptable at this file count.
- Local dev mode needed migration 0021 applied locally + test seed rows for the chip bar to render in preview. Not a prod issue (remote D1 has the real data). Noted so future contributors know why `library/` looks empty on a fresh local dev unless seeded.

**Files:** NEW [src/lib/categories.ts](../src/lib/categories.ts) (three query helpers). NEW [src/components/CategoryChips.astro](../src/components/CategoryChips.astro) (chip bar component). NEW [src/pages/library/[slug].astro](../src/pages/library/[slug].astro) (filtered view, SSR). EDIT [src/pages/library/index.astro](../src/pages/library/index.astro) (now SSR, renders chips, stat line gains category count). EDIT [CLAUDE.md](../CLAUDE.md) (Area 2 2.4 entry).

**Verification:**
- `pnpm build` clean with the new routes.
- Typecheck clean on every new/touched file.
- Preview at localhost:4321: `/library/` renders chip bar with 4 chips (All pieces + 3 seeded categories), stat line shows "9 pieces · 9 subjects · 3 categories", active chip on "All pieces".
- Click into `/library/chokepoints-and-supply/`: 3 pieces listed (Hormuz open, jet fuel, Hormuz halt), breadcrumb reads "Library · Chokepoints & Supply", category description renders, active chip moves to "Chokepoints & Supply".
- Mobile viewport (375×812): chips wrap cleanly across 3 rows, 44px touch targets honoured, filter input full-width.
- Desktop viewport: chips on one row at current 4-chip count, hover state works.
- 404 cases: `/library/does-not-exist/` → 404 via unknown-slug path; `/library/BAD..SLUG/` → 404 via slug-shape validation. Both before any DB round-trip.
- Zero server errors in dev log across ~10 page loads.

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.3 — Seed existing pieces

**Context:** With Categoriser wired (2.2), every *new* piece gets categorised at publish+1s. But the 9 pre-Categoriser pieces (2026-04-17 → 2026-04-23) have no rows in `piece_categories` — they'd appear nowhere under the library filter (2.4) until manually retagged. 2.3 is the one-time backfill that (a) catches up the historical pieces and (b) builds the initial taxonomy from real pieces rather than a guessed seed list.

**Decisions:**

1. **One-shot shell script at `scripts/seed-categories.sh`.** Matches existing convention (`reset-today.sh`, `post-build.sh`). Uses the same wrangler+curl+node-for-JSON-parsing pattern reset-today.sh established. No new TS toolchain overhead; no extension-case bikeshed.

2. **Sequential by `published_at ASC`, not parallel or reverse.** Categoriser's reuse-bias only works if it can see previously-created categories in the SELECT before running. Sequential means piece N completes its categorisation + commits to `categories` before piece N+1's categoriser reads the list. Oldest-first means the earliest pieces (when the taxonomy was empty) did most of the category creation work; every subsequent piece saw a growing list and reused where it fit. Reverse would have concentrated novelty at the end and left earlier pieces looking for non-existent subjects.

3. **Idempotent at three layers.** (a) Script pre-check per piece — `SELECT COUNT(*) FROM piece_categories WHERE piece_id = ?` skips already-done pieces, avoids the HTTP round-trip. (b) Agent pre-insert guard — same check inside `CategoriserAgent.categorise` returns `skipped: true` + no Claude call. (c) Composite PK `(piece_id, category_id)` on the table blocks duplicate rows even if layers (a) + (b) were bypassed. Re-running the script is a safe no-op on completed pieces and only acts on newly-added or admin-wiped ones. Verified: second run on all 9 pieces emitted 9 `already categorised, skipping` lines with zero HTTP calls.

4. **Poll-for-completion between pieces, not fixed sleep.** Categoriser's `/categorise-trigger` returns 202 immediately (fire-and-forget via `ctx.waitUntil`) — the actual Claude call + writes happen asynchronously. If piece N+1 fires before piece N completes, N+1's SELECT misses N's new categories, collapsing the reuse-bias. Script polls `piece_categories` every 3s with a 90s timeout per piece — each piece takes 3–10s wall-clock in practice. Fixed-sleep alternatives (20s or 30s) would either starve the polling (if Claude is slow) or waste 10s × 9 pieces on the happy path. Polling is load-bearing here.

5. **Per-piece assignment summary on completion.** Prints the slug + confidence for each assignment as the piece finishes (`resource-constraints-tradeoffs@75`, `policy-design-implementation@90`). Operator gets a real-time read of the taxonomy that's emerging instead of waiting for the tail summary. Makes obvious when the agent's reuse bias is working (early pieces create categories, later pieces reuse them).

6. **`DRY_RUN=1` preview mode.** Skips the HTTP call entirely; prints what *would* fire. Useful before first run to sanity-check the piece ordering and count. No secret required for the dry run — only fetches from D1, no writes.

7. **`ADMIN_SECRET` rotation this session.** Secret was write-only-by-design and unavailable at script-run time. Rotated via `openssl rand -hex 32` → `wrangler secret put ADMIN_SECRET` on agents worker + `wrangler secret put AGENTS_ADMIN_SECRET` on site worker (names differ by worker but carry the same value). Brief rotation window (~5s between the two `secret put` commands) is safe at 23:40 UTC — no pipeline running, no audio-retry UI in use, zero cross-worker API traffic.

**First-run result (all 9 pre-Categoriser pieces, 2026-04-23 late evening):**
- 11 total assignments (8 pieces with 1 category, 2 pieces with 2 categories — the two legitimately-spanning ones).
- 7 categories emerged:
  - `chokepoints-and-supply` (3 pieces) — Hormuz open, Hormuz halt, jet fuel
  - `commodity-shocks` (2) — jet fuel, Hormuz halt
  - `policy-design-implementation` (2) — tobacco ban, cannabis reclass
  - `business-model-disruption` (1) — QVC
  - `infrastructure-technical-debt` (1) — ATC modernisation
  - `resource-constraints-tradeoffs` (1) — NASA Voyager 1 shutdown
  - `trade-policy-mechanics` (1) — tariff refunds
- Every category name is a *subject* not a topic-of-the-week (no "Cannabis Reclassification" or "Iran Tensions" labels). Reuse-bias held: both Hormuz pieces reused the Chokepoints + Commodity categories from the oil + jet fuel pieces rather than proliferating Iran-specific categories. Tobacco + cannabis both went to Policy Design & Implementation, not drug-specific categories.
- 9 `Categorised: …` observer events (severity=info), zero failures. Zero `skipped` on first run.
- Idempotency confirmed: second run skipped all 9 with zero HTTP calls.

**Trade-offs:**
- 90s per-piece poll timeout means a slow Claude response (or a network hiccup) stalls the whole backfill at that piece. Acceptable — the script exits 1 on timeout and lists the failed piece, operator reruns. At n=9 this runs <1min total on the happy path; at n=100 it'd be ~5–10min which is still fine for a one-shot.
- Script requires `ADMIN_SECRET` in the shell. Per `feedback_admin_ui_over_shell_secret` this is the "automation belongs in wrangler/CI" exception — there's no admin-UI path for bulk backfill and creating one just for this use case would be overkill. The `/categorise-trigger` endpoint exists primarily for this script plus the future 2.5 admin retag flow.
- First-run category quality depends on whatever Sonnet decides is a "durable subject" for the first piece (QVC). If it had proposed "E-commerce Disruption" instead of "Business Model Disruption", the whole taxonomy would have had a more specific flavour. Mitigation: admin UI in 2.5 gives operator rename/merge controls. Worst case is renaming a few categories, not a re-run.
- Seed run permanently captures the initial taxonomy shape in the `categories` table. If the agent prompt changes later (2.6 or beyond), re-seeding requires either deleting `piece_categories` rows + `categories` rows first (destructive, loses history), or manually merging new categories via the admin UI. Accepted — the whole point of a one-shot seed is that it's not re-run.

**Files:** NEW [scripts/seed-categories.sh](../scripts/seed-categories.sh). EDIT [docs/RUNBOOK.md](./RUNBOOK.md) (new "Seed categories across historical pieces" section). CLAUDE.md (Area 2 2.3 entry).

**Verification:** Live backfill completed 2026-04-23 late evening — 9/9 pieces fired cleanly, 11 assignments written, 7 categories in the taxonomy. Second run confirmed idempotency (9 skip lines, zero HTTP calls). 9 `Categorised: …` observer events visible in admin feed, zero warns. `SELECT COUNT(*) FROM piece_categories` = 11; `SELECT COUNT(*) FROM categories` = 7. Per-piece assignments spot-checked — all 7 category names are subjects, none reference specific news events.

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.2 — CategoriserAgent (14th agent)

**Context:** With schema in place (sub-task 2.1), 2.2 adds the 14th agent that actually populates it. Single-purpose agent, same off-pipeline pattern as Learner's post-publish analysis and Drafter.reflect.

**Decisions:**

1. **One file, one prompt, one method.** `agents/src/categoriser.ts` + `agents/src/categoriser-prompt.ts`. Method `categorise(pieceId, date, mdx)` returns `CategoriserResult` with per-run metrics. Same shape as Drafter.reflect — takes MDX from caller rather than re-reading from GitHub itself, keeps the agent ignorant of file paths.

2. **Director hook — scheduled alarm, not inline.** New `categoriseScheduled` method at Director fires via `this.schedule(1, 'categoriseScheduled', {pieceId, date, title, filePath})` immediately after `publishing done`. Sits right before the audio schedule so alarm ordering is deterministic (producer + self-reflection + categoriser + audio, all fire in order). Scheduled method re-reads MDX via `PublisherAgent.readPublishedMdx` — same pattern as `reflectOnPieceScheduled`, keeps scheduled-row payloads small (filePath only, not body).

3. **Strongly reuse-biased prompt.** The prompt names the anti-pattern directly — "a taxonomy that grows a new category for every piece becomes a headline list, not a map." Numeric floor: reuse when any existing category fits at confidence ≥60 (`CATEGORISER_REUSE_CONFIDENCE_FLOOR`). At most one new category per call, and only for *subjects* (durable, could hold 10+ future pieces), never topic-of-the-week labels. Prompt also asks Claude to check *underlying subject* against existing descriptions, not just headline keywords — prevents "different word, same concept" splits.

4. **Novel category validation + collision guard at the agent layer.** Slug normalisation via `normaliseSlug` (lowercase, diacritic strip, non-alnum → `-`, bounded length). Pre-INSERT SELECT against `existingBySlug` → if Claude proposes a name that normalises to an existing slug, reuse that category instead of creating a duplicate. Post-INSERT try/catch — if the INSERT throws on a UNIQUE violation (race between two concurrent categoriser runs proposing the same slug), SELECT the winner and reuse its id. Name clamped to 100 chars, description to 500.

5. **`piece_count` maintained in the same transaction as `piece_categories` INSERT.** Each assignment does `INSERT INTO piece_categories` + `UPDATE categories SET piece_count = piece_count + 1, updated_at = ?`. Sub-task 2.5's merge/delete flows will decrement on the same path. Drift surface accepted; admin "Recount" is the escape hatch. D1 per-DB serial consistency makes the atomic increment safe under concurrent runs on different pieces.

6. **Idempotence at two layers.** (a) Pre-insert guard — `SELECT COUNT(*) FROM piece_categories WHERE piece_id = ?` short-circuits with `skipped: true` and no Claude call if the piece already has any rows. (b) Composite PK `(piece_id, category_id)` blocks duplicate rows underneath. The pre-check saves the cost of a Sonnet call on re-runs; the PK is the correctness floor.

7. **Locked semantic is inert for this agent.** `categories.locked = 1` means "Categoriser MUST NOT reassign AWAY from this category" (per sub-task 2.1 design). Since the agent only INSERTs — never DELETEs or re-tags — the flag has no effect on this code path. Enforced at admin-time (merge/delete in sub-task 2.5). Documented in agent header so future maintainers don't add spurious checks.

8. **Failure = logged, not retried.** Same posture as `analyseProducerSignalsScheduled` and `reflectOnPieceScheduled`: a DB / Claude / JSON parse failure surfaces via `observer.logCategoriserFailure` (warn severity) and the alarm returns. The piece is live; a missed categorisation means the library filter won't surface this piece under a category until a manual retag via the seed script or the admin UI. Piece is never blocked.

9. **Metered success logging.** `observer.logCategoriserMetered` fires on both `skipped` and written paths (info severity, same shape as `logReflectionMetered` and `logZitaSynthesisMetered`) — tokens-in/out + latency + assignments-written + novel-names. Cost drift visible over time without a separate metrics pipeline. The skipped path fires with zero tokens + DB-only latency so "did categoriser run?" has a visible answer.

10. **New admin endpoint `/categorise-trigger?piece_id=<uuid>`.** Mirrors `/zita-synthesis-trigger`. Three purposes: (a) verifying sub-task 2.2 ships green before 2.3's seed script; (b) operator retag after sub-task 2.5 admin merge/delete; (c) re-running after a Categoriser prompt change. ADMIN_SECRET bearer-gated, validates piece_id as UUID shape, resolves filePath the same way Director does at publish, fires via `ctx.waitUntil(director.categoriseScheduled(…))`. The idempotence guard in the agent makes "did it already categorise?" a safe retry.

**Trade-offs:**
- MDX excerpt capped at 2000 chars (`BODY_EXCERPT_MAX_CHARS`) — enough to show the hook + first teaching beat, keeps backfill cost predictable across 8 pieces × 3 years × 1 piece/day at scale. A 20k-char piece would bust the prompt budget without this cap. Potential cost: a piece whose categorical signal is buried past the first 2000 chars gets under-informed categorisation. Accepted; the headline + underlying_subject + first chunk carries the weight for categorisation.
- Pre-insert COUNT query adds one DB round-trip per call. At one call per piece per day, noise against the Sonnet call cost.
- `categories.piece_count` bumped on INSERT but not decremented on `piece_categories` row delete here (this agent never deletes). Decrement logic lives in sub-task 2.5's admin merge/delete paths. If a future code path deletes a piece_categories row without updating piece_count, drift happens — admin "Recount" escape hatch covers it.
- Slug collision fallback turns a proposed novel category into an existing-category reuse silently. Logged only in the returned `assignmentsWritten` count, not distinctly flagged. A misbehaving prompt returning slug-collisions every run would look like "no novel categories" in metrics; acceptable because this isn't a likely failure mode and the admin UI in 2.5 will surface the full categories list either way.
- Director schedules categoriser BEFORE audio, both at +1s and +2s. GitHub eventual consistency on freshly pushed content: a ~2s read-delay on categoriser's re-read of the just-committed MDX. Same issue the reflect schedule has — handled the same way (404 means "not yet propagated", logs failure, agent moves on; next cron run on that piece re-tries via `/categorise-trigger` or seed).
- `/categorise-trigger` endpoint bypasses the reuse bias's main intent (taxonomy stability) to the extent that operators can blindly re-categorise. Guarded in practice by ADMIN_SECRET + the agent's idempotence skip — the trigger is primarily for pieces that don't yet have categories.

**Files:** NEW [agents/src/categoriser.ts](../agents/src/categoriser.ts), NEW [agents/src/categoriser-prompt.ts](../agents/src/categoriser-prompt.ts). EDIT [agents/src/director.ts](../agents/src/director.ts) (import + schedule call + categoriseScheduled alarm), [agents/src/observer.ts](../agents/src/observer.ts) (logCategoriserMetered + logCategoriserFailure), [agents/src/server.ts](../agents/src/server.ts) (export + `/categorise-trigger` endpoint), [agents/src/types.ts](../agents/src/types.ts) (`CATEGORISER` binding), [agents/wrangler.toml](../agents/wrangler.toml) (DO binding + migration tag v12). Docs: [docs/AGENTS.md](./AGENTS.md) (Categoriser section + endpoint doc), [CLAUDE.md](../CLAUDE.md) (Area 2 2.2 entry).

**Verification:** Typecheck clean on every new/touched file; server.ts still has its 18 pre-existing SubAgent errors (unchanged). `pnpm build` on the site worker clean (no cross-worker drift). Agents worker deployed successfully — `env.CATEGORISER (CategoriserAgent)` binding listed in wrangler output. Live categorisation verified via sub-task 2.3's seed script over all 8 existing pieces (next commit) — the seed script exercises the exact same `Director.categoriseScheduled` → `CategoriserAgent.categorise` path.

**Commit:** next.

---

## 2026-04-23 (late evening): Area 2 sub-task 2.1 — `categories` + `piece_categories` schema

**Context:** Area 2 opens the 14th agent — Categoriser — plus a library category filter and an admin management page. Six sub-tasks, schema-first discipline: no code that writes to these tables can land until the tables exist in production. Sub-task 2.1 is the plumbing commit.

**Decisions:**

1. **Two new tables, both additive.** `categories` holds the taxonomy (id, slug, name, description, locked, piece_count, created_at, updated_at). `piece_categories` is the join (piece_id, category_id, confidence, created_at) with composite PK `(piece_id, category_id)`. Full shape in [migrations/0021_categories.sql](../migrations/0021_categories.sql) header. Rollback = `DROP TABLE` on both — empty at migration time, no backfill to reverse.

2. **`piece_count` denormalised on `categories`.** Library chips render sorted by count on every page load (sub-task 2.4). A correlated `COUNT(pc.piece_id) GROUP BY` on each render is fine at 5 categories but ugly as the taxonomy grows; the write path (Categoriser insert, admin merge/delete) is low-frequency. Maintained by the writer; admin page gets a "Recount" escape hatch (sub-task 2.5) for drift recovery. Same defensive shape as any future migration backfill.

3. **`slug` stored, not derived from `name`.** Rename updates `name`; `slug` only changes on explicit operator edit or on merge (target's slug wins). Keeps `/library/?cat=chokepoints` URLs stable across renames — important if a library URL ever leaks into anyone's bookmark.

4. **Composite PK on `piece_categories`** gives idempotency. Categoriser can safely re-run over a piece without producing duplicate rows; the pre-insert guard on sub-task 2.2 is a correctness layer on top of this safety net.

5. **No REFERENCES FK declarations.** Consistent with every other join column across 20 prior migrations (`daily_piece_audio.piece_id`, `pipeline_log.piece_id`, `audit_results.piece_id`, `learnings.piece_id`, …). D1 doesn't enforce FKs at the schema level in this codebase; application layer owns integrity. Admin delete is gated on `piece_count=0` (sub-task 2.5) so orphans can't arise.

6. **`locked` as INTEGER (0/1), no CHECK on `confidence`.** Consistent with `has_audio`, `has_interactive`, `passed`, `applied_to_prompts` (INTEGER booleans) and `learnings.confidence` / `audit_results.score` (INTEGER 0–100, no CHECK). Application layer clamps and validates.

7. **Two indexes on `categories`, two on `piece_categories`.** `idx_categories_slug` for library route lookups (alongside the UNIQUE auto-index, harmless redundancy and makes the EXPLAIN readable). `idx_categories_piece_count` DESC for the chip-sort read path. `idx_piece_categories_piece` for per-piece lookup (per-piece admin + drawer). `idx_piece_categories_category` for per-category filter (library chip) and piece_count recount.

**Trade-offs:**
- Denormalised `piece_count` creates a drift surface (Categoriser/admin must bump + decrement correctly). Accepted — the recount escape hatch is cheap to build and the read-path win is real as the taxonomy grows.
- Stored `slug` means a rename doesn't auto-update the URL; operators must edit slug manually when they want the URL to follow. Deliberate — bookmark stability beats auto-slugging.
- `(piece_id, category_id)` PK means a piece can't appear twice in the same category even if Categoriser is re-invoked with higher confidence. Upsert pattern (`INSERT OR REPLACE`) writes the newer row on re-run; acceptable since re-runs are manual operator actions.
- No seed rows. Initial taxonomy emerges from sub-task 2.3's backfill over existing published pieces, oldest first. Avoids a guessed taxonomy that later has to unwind.

**Files:** NEW [migrations/0021_categories.sql](../migrations/0021_categories.sql). EDIT [docs/SCHEMA.md](./SCHEMA.md) (two new table entries + migration-summary line + header counts 14→16 tables / 20→21 migrations).

**Verification:** Migration applied cleanly (`wrangler d1 migrations apply zeemish --remote` → 7 commands, 1.27ms, ✅). `PRAGMA table_info(categories)` returned 8 columns in the expected shape. `PRAGMA table_info(piece_categories)` returned 4 columns. All 4 custom indexes present (`idx_categories_slug`, `idx_categories_piece_count`, `idx_piece_categories_piece`, `idx_piece_categories_category`) alongside SQLite auto-indexes for PKs + UNIQUE slug. `SELECT COUNT(*)` on both tables returned 0 as expected.

**Commit:** next.

---

## 2026-04-23 (evening): Dashboard `isRunningNow` heuristic + gerund progress phrasing

**Context:** User reported `/dashboard/` was showing "Pipeline running — currently in publisher commits the audio." for today's 2026-04-23 cannabis piece, even though audio had long since completed (`has_audio=1`, commit `891c6f2` earlier in the day). Two bugs compounded.

**Decisions:**

1. **`isRunningNow` heuristic misread terminal state.** [src/pages/dashboard/index.astro:205-206](../src/pages/dashboard/index.astro) checked `lastStep.step` against a terminal-NAME list (`['done', 'error', 'skipped']`). Director writes the audio success terminal as `step='audio-publishing', status='done'` ([agents/src/director.ts:885](../agents/src/director.ts:885)) — step NAME never matches `'done'`, so `!terminal` stayed true forever after audio completed. **Same bug class as commit `fc23970` (admin Pipeline History verdict, earlier today).** Fix: `isRunningNow = lastStep.run_id === today && lastStep.status === 'running';`. `status` is the canonical terminal signal; step name is not.

2. **"currently in X" grammar broke at every state.** `pipelineStepLabel` values are full subject-verb-object sentences ("Drafter writes the MDX"). Composing them into "currently in X" produced "currently in drafter writes the MDX" / "currently in publisher commits the audio" — stilted at every state, not just audio. New [`pipelineStepProgress(step)`](../src/lib/pipeline-steps.ts) helper returns gerund phrases ("writing the draft", "generating audio", "committing audio"). Round-aware for `auditing_rN` / `revising_rN` via regex. Status line now reads "Pipeline running — generating audio." cleanly. Two render sites updated: hero subtitle at [index.astro:231](../src/pages/dashboard/index.astro:231) + Today status strip at [:324](../src/pages/dashboard/index.astro:324).

**Trade-offs:**
- Two progress helpers now co-exist in `pipeline-steps.ts`: `pipelineStepLabel` (timeline/stepper rows — noun-phrase OK because rendered standalone) and `pipelineStepProgress` (live status lines — gerund because rendered inside a running-state sentence). Slightly redundant but the grammar demands are genuinely different; merging would force one site to degrade.
- Unknown step falls through to raw (same fallback as `pipelineStepLabel`). At current agent set every step is mapped; new steps will read "Pipeline running — {step}" until added to the map — visible enough to notice but not broken.
- The heuristic fix is identical in shape to commit `fc23970`'s fix earlier in the day. Lesson logged: when one surface reads `pipeline_log.step` as a terminal marker, audit every other surface for the same pattern in the same session.

**Files:** EDIT [src/lib/pipeline-steps.ts](../src/lib/pipeline-steps.ts), EDIT [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro).

**Verification:** `pnpm build` clean. Helper unit-checked via `tsx` stub across all 10 step names + unknown fallback — every phrase reads naturally in the "Pipeline running — X." frame. Live check after deploy: today's dashboard should flip from false "running" to "Today's piece is live. 9 pieces in 7 days."

**Commit:** `dc870a1`.

---

## 2026-04-23 (evening): Cross-surface duplication sweep + `src/lib/learnings.ts` helper

**Context:** User-led audit of home / public dashboard / admin surfaces for content shown in more than one place. Found three confirmed dups on the public dashboard plus four stale "each morning" / "every morning" references from before `interval_hours=12` shipped. Single-session sweep.

**Decisions:**

1. **"Published —" hero vs first row of Recent Runs.** Hero says "Published — {headline} · {tier}"; Recent Runs' first row rendered the same headline with richer metadata (voice score, rounds, candidates). Both fed from `daily_pieces` where `date >= weekAgoIso`. Fix: filter `todaysPiece?.id` out of `runLog` at [index.astro:152](../src/pages/dashboard/index.astro:152). Filter by `id` not `date` so at multi-per-day the second-latest same-date piece stays in the feed.

2. **"What we've learned so far" section deleted from public, counters moved to admin.** The section showed 3 counters (Producer patterns / Self-reflections / Total observations) + a blockquote with the latest learning observation. The blockquote was a verbatim duplicate of a bullet in the matching piece's How-this-was-made drawer. The counters are operator-facing signals about the learning loop — readers visiting `/dashboard/` don't gain from them. Public dashboard should describe how Zeemish works, not how much memory has accumulated. Explainer paragraph ("After every piece, two passes run…") went with the section; its mechanism description can find a home later if a "How Zeemish works" expansion happens. Pull-quote option chosen: **(a) remove, keep counters** (moved to admin). Rotating (b) needed state; aggregate (c) needed an LLM pass or human curation. Reader-facing per-piece drawer keeps its learnings list — unchanged.

3. **New section on admin: "Learning loop"** — placed between **System state** and **Observer events** on [admin.astro](../src/pages/dashboard/admin.astro). Three counters only; no explainer (operator knows). Flows: system-health stats → learning-loop stats → observer feed.

4. **`src/lib/learnings.ts` helper** — extracted the learning-count query into `getLearningCounts(db)`. Previous inline form issued three separate `SELECT COUNT(*)` round trips; the helper consolidates into one `SUM(CASE WHEN source = 'X' THEN 1 ELSE 0 END)` query. Since public is DELETING the query and admin is GAINING it, no copy-paste-forward happens in this commit — but the helper prevents the pattern from spreading the next time a surface wants these numbers ("one home per piece of information").

5. **Cadence copy sweep.** Removed "each morning" / "every morning" from four surfaces instead of parameterising: the product rhythm doesn't need to be asserted in copy when the dashboard already shows "Next run in Xh Ym". Cadence-neutral sentences stay true at any `interval_hours`. Changes: dashboard Scanner job ("Reads the news every morning" → "Reads the news for each run"), dashboard explainer (drop "13 agents, each morning" sentence — dup with footer + agent-team list directly above), homepage empty state (drop "Every morning, "), `/daily/` subhead (drop "One piece, every morning."). OG description in BaseLayout switched to use `AGENT_COUNT` template literal rather than literal "13".

6. **`MadeBy.astro` drawer subtitle uses `AGENT_COUNT`.** Previously "The pipeline of 13 agents behind this piece" — now "The pipeline of {AGENT_COUNT} agents behind this piece". Closes the bleed-through from Task 3 where the footer already read "14" via constant.

**Trade-offs:**
- Public dashboard lost a section. Sparse is fine — the remaining sections (today status, week's output, Recent Runs, How it's holding up, Agent team, How this works) are enough.
- Explainer paragraph's mechanism description ("two passes run…") was the only place on public copy where the learning loop was named. Moving to admin means a casual reader no longer learns the loop exists. Acceptable: per-piece drawer still shows "What the system learned from this piece" with source attribution.
- Admin's new Learning loop section gated on `learningCounts.total > 0` — hidden when no learnings exist (dev / bootstrap). Same defensive pattern as the prior public section.
- At `interval_hours=24` the cadence copy change ("every morning" removed) is imperceptible — current users won't notice. At 12h/4h/etc the change is what keeps the claim true.
- Book + README retain "13 agents" / "thirteen" references. Those are forensic narrative at a moment in time; rewriting them ahead of actually adding agents would be editing history. They sync when Task 10/22 land.

**Files:** NEW [src/lib/learnings.ts](../src/lib/learnings.ts); EDIT [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro) (filter + delete section + cadence copy + dead-code cleanup); EDIT [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro) (new Learning loop section + query); EDIT [src/pages/index.astro](../src/pages/index.astro) (drop "Every morning, "); EDIT [src/pages/daily/index.astro](../src/pages/daily/index.astro) (drop trailing sentence); EDIT [src/components/MadeBy.astro](../src/components/MadeBy.astro) (AGENT_COUNT); EDIT [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro) (OG desc uses AGENT_COUNT).

**Verification:** `pnpm build` clean. Local fetch of `/`, `/daily/`, `/dashboard/` confirms zero "13 agents" / "every morning" / "What we've learned so far" strings on any surface. Piece-page drawer subtitle renders "14 agents" correctly. Admin Learning loop section's D1 path not locally verifiable (requires ADMIN_EMAIL + seeded learnings); build-clean is the right level for the template change. Hero + Recent Runs dedup is a 1-line filter change on a piece_id comparison — trivially correct.

**Commit:** `7312ee0`.

---

## 2026-04-23 (evening): Homepage "made by N agents" strip moves to site footer + `AGENT_COUNT` constant

**Context:** Homepage had a transparency strip between today's hero and the Recent list: "Made by 13 agents. Today's piece moved through Scanner → Curator → Drafter → Voice · Facts · Structure → Publisher before going live. See the pipeline →". Cramped; competing with the teaching hero. Home's job is surfacing today's teaching — the pipeline's home is the Dashboard.

**Decisions:**

1. **Strip removed from homepage body.** [src/pages/index.astro:70-79](../src/pages/index.astro) deleted.

2. **Tiny footer pointer added to `BaseLayout.astro`.** Three centered lines: tagline / "Made by {AGENT_COUNT} agents." / copyright. Site-wide (every page), not homepage-only — matches "the footer" phrasing and DRY. Minor redundancy on `/dashboard/` itself where the "See the pipeline →" link would self-reference; chose to drop the link entirely and keep just the "Made by N agents." statement. Footer stays tiny.

3. **New `src/lib/constants.ts` with `AGENT_COUNT`.** No shared constant existed previously; "13" was hardcoded in 4 places (homepage strip, MadeBy drawer subtitle, BaseLayout OG description, dashboard explainer). Constant set to **14** per user direction — more agents are planned in Task 10/22, docs + agent-team list update alongside when those land. The other three surfaces stay on literal "13" pending those tasks (the cluster-extend happens in Task 4's duplication sweep same-session).

4. **Scope:** only the footer pointer uses the constant in this commit. Task 4 (same session, later commit) extends to MadeBy + OG + dashboard explainer.

**Trade-offs:**
- `AGENT_COUNT = 14` vs actual 13-file roster creates a temporary mismatch: public dashboard's agent-team list still shows 13 cards while the footer claims "14 agents". User accepted this ("more agents will come, we will update the docs"). The footer is the forward-looking claim; the team list is the current literal truth. Honesty gap closes when Task 10 adds the 14th agent.
- Mobile footer is three stacked centered lines (verified via preview resize to 375px). No horizontal overflow; reads clean.

**Files:** NEW [src/lib/constants.ts](../src/lib/constants.ts); EDIT [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro); EDIT [src/pages/index.astro](../src/pages/index.astro).

**Verification:** `pnpm build` clean. `preview_start` + `preview_resize mobile` confirmed the footer renders three lines, strip gone from body, zero console errors.

**Commit:** `6592b6a`.

---

## 2026-04-23 (evening): Kebab-case step names no longer leak in timelines + steppers

**Context:** "How this was made" drawer timeline, admin Today's Run stepper, and per-piece admin timeline all route step names through `pipelineStepLabel()` — but the map had no entries for `audio-producing`, `audio-auditing`, `audio-publishing`. Those three rendered as raw kebab-case alongside the human-written labels ("Scanner reads the news", "Drafter writes the MDX"). Same list, two voices.

**Decisions:**

1. **Three entries added to `PIPELINE_STEP_LABELS`** in [src/lib/pipeline-steps.ts](../src/lib/pipeline-steps.ts):
   - `audio-producing` → "Audio Producer narrates the beats"
   - `audio-auditing` → "Audio Auditor checks the files"
   - `audio-publishing` → "Publisher commits the audio"
   Fall-through behaviour preserved (unknown steps still render raw — visible enough to notice, not broken).

2. **Admin Pipeline History verdict routes step name through `pipelineStepLabel`.** The verdict fix in commit `fc23970` (earlier same day) rendered "Errored at audio-publishing" / "Running · audio-publishing" / "Stalled at scanning" using the raw step name — a new kebab leak I introduced in that fix. [admin.astro:440](../src/pages/dashboard/admin.astro:440) now wraps `step` in `stepLabel = pipelineStepLabel(step)` before composing verdicts. "Errored at Publisher commits the audio" reads slightly long but is consistent with every other admin surface.

**Other leaks swept** (and found clean):
- Observer event titles ([observer.ts:130,149,296](../agents/src/observer.ts:130)) — already human ("Audio published: {title}", "Audio failure: {title}").
- Raw step strings in [admin/piece/[date]/[slug].astro:377-380](../src/pages/dashboard/admin/piece/[date]/[slug].astro:377) — internal comparisons only, not rendered.
- 5 consumers of `pipelineStepLabel` (made-drawer, admin home stepper, per-piece admin timeline, public dashboard's "currently in X" hero and status strip) all inherit the new entries automatically.

**Trade-offs:**
- "Errored at Publisher commits the audio" is 5 words; the raw kebab was 2. Length cost accepted because (a) consistency across admin > terseness, (b) the verdict line is rare (only for failed/running/stalled runs, not Done/Skipped), (c) the text wraps gracefully.

**Files:** EDIT [src/lib/pipeline-steps.ts](../src/lib/pipeline-steps.ts), EDIT [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro).

**Verification:** `pnpm build` clean.

**Commit:** `fafdc5c`.

---

## 2026-04-23 (evening): Admin Pipeline History verdict reads `finalStatus`, not step name

**Context:** Admin home's "Pipeline history (last 14 runs)" panel showed "Stalled at audio-publishing" for every healthy recent run — the indicator had lost its signal. Audio was actually landing (`has_audio=1`, piece audio played live), so the "Stalled" label was false.

**Root cause:** the query at [admin.astro:182-196](../src/pages/dashboard/admin.astro:182) picked `MAX(created_at)` pipeline_log row per piece. For a healthy run with audio, that row is `step='audio-publishing', status='done'` (Director's terminal write at [director.ts:885](../agents/src/director.ts:885)). The verdict logic at [:440](../src/pages/dashboard/admin.astro:440) only checked step *name*:
```js
const ok = r.finalStep === 'done';
const verdict = ok ? 'Done' : skipped ? 'Skipped' : (r.finalStep === 'error' ? 'Errored' : `Stalled at ${r.finalStep}`);
```
Step name was `audio-publishing`, not the literal `'done'` — so every healthy run fell through to "Stalled at audio-publishing". The `finalStep === 'error'` branch was also dead: no director.ts logStep writes a step literally named `'error'`.

**Decisions:**

1. **Verdict now reads `finalStatus`.** Status is Director's canonical terminal signal; `'done'` = success, `'failed'` = errored, `'running'` = in-flight. Step name describes WHAT step, not WHETHER terminal.
```js
const skipped = step === 'skipped';
const errored = status === 'failed';
const running = status === 'running';
const ok = status === 'done' && !skipped;
const verdict = ok ? 'Done'
  : skipped ? 'Skipped'
  : errored ? `Errored at ${step}`
  : running ? `Running · ${step}`
  : `Stalled at ${step}`;
```

2. **Pipeline History kept (not removed).** Audit confirmed it's not duplicating "All pieces" or "Recent runs": it's the only admin surface that shows runs with no successful publish (scanner-skipped, errored before publish). All pieces excludes those; Recent runs is a reader-facing summary.

3. **Added running-vs-stalled distinction.** Previously "Stalled" was the catch-all for any non-terminal step name. Now "Running · {step}" fires when `status='running'` (actually in flight); "Stalled" only for genuine unknowns (status not done/failed/running).

**Trade-offs:**
- Verdict reads raw step name ("Errored at audio-publishing"). A new kebab-case leak, fixed same-session in commit `fafdc5c`.
- `errored` branch uses `status='failed'`. Matches director.ts writes. No agent writes `status='error'` — that dead check was removed.

**Files:** EDIT [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro).

**Verification:** `pnpm build` clean. Live: after deploy, recent healthy runs show "Done" (not "Stalled at audio-publishing"); failed runs show "Errored at {step}" with the specific failure point visible.

**Commit:** `fc23970`.

---

## 2026-04-23 (cont.): Two cleanups surfaced by live verification of the audio-retry surface

**Context:** Live Start-over test on the 2026-04-23 cannabis piece passed but surfaced two small issues during mid-run inspection. Neither blocked the pipeline — the run completed healthy end-to-end — but both are visible quality-of-life bugs worth fixing while the context is fresh.

1. **Admin retry block displayed stale failure reason from a prior run.** Screenshot captured mid-Start-over showed "Audio pipeline failed at audio-producing — Durable Object reset because its code was updated." The `audio-producing failed` row it surfaced was from **6 hours earlier** (14:02:11 UTC, during the original publish run before today's deploy), not from the healthy Start-over run that was in flight (started 20:11:21 UTC). Root cause: `audioFailureStep = pipeline.find((p) => p.step.startsWith('audio-') && p.status === 'failed')` in [`src/pages/dashboard/admin/piece/[date]/[slug].astro`](../src/pages/dashboard/admin/piece/[date]/[slug].astro) had no time filter. Pre-existing bug since commit `3208c86` on 2026-04-22 — **not** a regression from today's always-visible-retry change (earlier framing was guessing; git log showed the unfiltered query was untouched by today's commit). Fix: compute `latestAudioRunStart` from the most recent `audio-producing running` row, then filter failures to `created_at >= latestAudioRunStart`. Historical failures from prior runs no longer surface as current.

2. **Publisher made pure-reorder commits on per-beat regen and Start over.** Director's `SELECT beat_name, public_url FROM daily_piece_audio WHERE piece_id = ? ORDER BY generated_at ASC` built the `audioBeats` frontmatter map in generation order. On per-beat regen, the regen'd beat's `generated_at` was newest, so it moved to the bottom of the map — same URLs, different order, triggering Publisher's byte-comparison to see a diff and make a noisy reorder-only commit. Two such commits landed today for the cannabis piece (`d6cfb55` per-beat, `d94754f` Start-over). Fix: change SELECT to `ORDER BY beat_name ASC` so the map serialises deterministically regardless of which beat was regenerated most recently. Readers unaffected — site consumes `audioBeats` by key lookup, not map order. First pipeline run after this fix produces one last reorder commit (one-time cost), then Publisher's idempotent check fires correctly for all subsequent per-beat regens where URLs are unchanged.

**Files:** EDIT [src/pages/dashboard/admin/piece/[date]/[slug].astro](../src/pages/dashboard/admin/piece/[date]/[slug].astro), EDIT [agents/src/director.ts](../agents/src/director.ts).

**Verification:** `pnpm build` clean, agents typecheck no new errors (same 18 pre-existing server.ts SubAgent errors plus the one `retryAudioBeat` instance from the morning commit). Live verification: on the next Start-over, the stale "Durable Object reset" should no longer display — mid-run shows "Audio incomplete — expected N beats, have M" instead. On the next per-beat regen where URLs are unchanged, Publisher should skip the commit entirely.

---

## 2026-04-23: Provider-agnostic TTS normaliser + admin per-beat audio regen

**Context:** The 2026-04-23 cannabis piece ("Trump Administration Reclassifies Cannabis…") contains dense Roman numerals — "Schedule I, II, III, IV and V". ElevenLabs reads single-letter Roman numerals as English letter names: `I` becomes the pronoun "I", `V` becomes the letter "V". The issue is at the TTS layer, not the writing, and will recur for any Roman-numeral-heavy piece (amendments, monarchs, chapters) regardless of which audio provider we use. Separately, the admin per-piece page hides the audio retry buttons the moment `has_audio = 1` — so there's no affordance to refresh an already-published piece after a pipeline-level fix like this one, and no per-beat surgical option.

**Decisions + shipping:**

1. **New module `agents/src/shared/tts-normalize.ts`.** Single `normalizeForTTS(text)` export. Three passes: multi-char standalone Roman numerals (`III` → `three`) always convert; single-char Roman numerals (`I`, `V`, `X`…) convert only when preceded by a curated context word (`Schedule`, `Class`, `Phase`, `Title`, `Pope`, `King`, `Louis`, …) to protect the English pronoun "I"; a list-continuation pass then catches trailing bare Romans in the same clause (the "Schedule IV and V" case — seeded by the first two passes). The existing `Zeemish → Zee-mish` aliasing moved into the same module. `audio-producer.ts`'s `prepareForTTS` now ends with `normalizeForTTS(stripped)`. Regression harness at `agents/scripts/verify-normalize.mjs` (20 cases, runs via `pnpm verify-normalize` — same pattern as `verify-splice.mjs`).

2. **Conversion target: spelled-out words** (`Schedule IV` → `Schedule four`, not `Schedule 4`). Rationale: every TTS reads "four" as the cardinal; Arabic numerals like "Schedule 4" are read as "Schedule fourth" by some providers in ordinal contexts. Spelling the number out makes the fix provider-agnostic, which is the whole point of the module living upstream of the ElevenLabs-specific code. Character-count drift from the conversion is a few chars per beat (well under the 20k budget).

3. **Per-beat regen: new `Director.retryAudioBeat(pieceId, beatName)` method.** Deletes exactly one R2 object + one `daily_piece_audio` row, keeps `has_audio=1` so the other beats keep playing for readers, then calls `retryAudio(pieceId, force=true)` — producer's R2 head-check means only the deleted beat regenerates. Publisher's splice is a no-op when the rebuilt `audioBeats` map serialises identically to frontmatter (same beat names, same deterministic R2 paths). `retryAudio` gained a `force?: boolean` parameter (defaults `false`) so the 2026-04-22 has_audio=1 double-fire guard stays in place for UI-triggered Continue but is bypassable by per-beat regen.

4. **Admin UI always-visible retry.** Previously the whole retry block was gated `{!audioComplete && (...)}` — on `has_audio=1` operators saw zero controls. Now: per-beat "Regenerate" button on every audio row (confirm dialog warns about CDN cache → hard-refresh to hear new); Start-over button always visible when rows exist (confirm dialog warns about reader-visible downtime on published pieces); Continue button only when `!audioComplete` (it's a no-op once every beat exists). Small "Audio published ✓" chip in the section header when complete.

5. **Endpoint extended.** `/api/agents/audio-retry` (site worker) + `/audio-retry` (agents worker) both accept a new `mode=beat&beat=<kebab-name>` alongside the existing `continue`/`fresh` modes. Both also now accept `piece_id=<uuid>` as an alternative to `date` for unambiguous resolution at multi-per-day. Beat-name validated against `/^[a-z0-9-]+$/` on both sides (defense in depth — Director re-validates too).

**Trade-offs:**
- CDN caching: regenerated clips live at the same deterministic R2 key → same `public_url`. Browsers/Cloudflare may serve the stale clip until cache expires. Admin UI explicitly surfaces the hard-refresh requirement. Cache-header tuning on `/audio/*` is a separate project.
- Publisher splice is a no-op during per-beat regen (the `audioBeats` frontmatter map serialises identically). This is fine — the actual fresh MP3 is on R2 at the same URL. `has_audio` stays `1` throughout so no second commit is needed. But it means there's no git-history breadcrumb for "beat X regenerated at time T" — observer_events + pipeline_log carry that signal instead.
- Roman-numeral false positives: the regex is deliberately conservative. `IIII` (invalid Roman) is preserved unchanged (round-trip parse rejects it). `WWII` is preserved (no word boundary inside the token). `V-neck` is preserved (no number-word seed for pass 3). Trade-off: a bare `V` in prose without a context word won't convert — but that's the cost of protecting "I" as a pronoun, and the context-word list covers the realistic cases.
- `retryAudio(pieceId, force=true)` from `retryAudioBeat` bypasses the has_audio guard that was added as defense-in-depth for the 2026-04-17 corruption. Safe because the corruption cause (spliceAudioBeats regex bug in commit `55fce9f`) is separately fixed; the guard remains for UI-triggered Continue.

**Files:** NEW [agents/src/shared/tts-normalize.ts](../agents/src/shared/tts-normalize.ts), NEW [agents/scripts/verify-normalize.mjs](../agents/scripts/verify-normalize.mjs), EDIT [agents/src/audio-producer.ts](../agents/src/audio-producer.ts), EDIT [agents/src/director.ts](../agents/src/director.ts), EDIT [agents/src/server.ts](../agents/src/server.ts), EDIT [agents/package.json](../agents/package.json), EDIT [src/pages/api/agents/audio-retry.ts](../src/pages/api/agents/audio-retry.ts), EDIT [src/pages/dashboard/admin/piece/[date]/[slug].astro](../src/pages/dashboard/admin/piece/[date]/[slug].astro).

**Verification:** 20-case regression harness passes (`pnpm verify-normalize`), `verify-splice` regression still passes, agents typecheck clean aside from pre-existing server.ts SubAgent errors (one new instance of the same pattern on the new `retryAudioBeat` stub call — consistent with prior `retryAudio`/`retryAudioFresh` calls). Live verification: regenerate a beat on the 2026-04-23 cannabis piece (the trigger piece) after deploy and confirm "Schedule three/four/five" pronunciation.

---

## 2026-04-22: Admin polish — observer feed cap + pipeline history per-piece + word_count canonical

**Context:** Final three points from the FOLLOWUPS audit entry. Not bugs — policy/design calls that had been deferred as "needs your input." Taken together, they close the audit entry fully.

**Decisions + shipping:**

1. **Observer events feed LIMIT 30 → 100.** The admin home already surfaces `openEscalations` + `errorsThisWeek` as top-level stats — the feed below is the chronological log, not the anomaly view. Raising to 100 gives headroom without adding filter complexity. At current volume ~28 events (4 escalation + 20 info + 4 warn), 100 rows is ~3-4 weeks. At hypothetical 1h cadence with full producer+reflection+Zita+audio traffic, still ~10 hours. No toggle — the job is "what happened recently" and chronology serves that.

2. **Pipeline history per-piece grouping.** At multi-per-day, "run" = pipeline attempt for a piece, not calendar day. Previously grouped by run_id=date, picking the latest terminal step and hiding that the first piece may have failed while the second succeeded. New query: `LEFT JOIN daily_pieces ON dp.id = pl.piece_id` + correlated subquery keyed on `piece_id` (with null-fallback to run_id for any legacy null-piece_id rows). Each row shows the piece's date + headline + verdict; orphan runs (scanner skipped / pre-publish error) render with "(unpublished run)" label. `lifetimeRuns = COUNT(DISTINCT run_id)` stays day-keyed — a legitimate distinct-days-active stat — and wasn't renamed.

3. **word_count — Drafter's value is canonical, Director stops re-computing.** Drafter returns `wordCount = mdx.split(/\s+/).length` at draft time. Director was re-computing on post-splice MDX (frontmatter gained `voiceScore`, `pieceId`, `publishedAt`, ~6 extra tokens). Result: `drafting done` pipeline_log showed 1080, `daily_pieces.word_count` stored 1086. Admin page had to pick one. Fix: INSERT binds `wordCount` (the Drafter value) directly. One source of truth. Historical rows stay as-is — ~6-word drift is cosmetic and a backfill UPDATE is more risk than the fix is worth.

**Trade-offs:**
- Pipeline history query gains a LEFT JOIN + correlated subquery branch. D1 handles this cleanly (verified via build, no new typecheck errors on admin.astro). A piece_id-free legacy row still renders via the `OR (p2.piece_id IS NULL AND p1.piece_id IS NULL AND p2.run_id = p1.run_id)` fallback clause — no historical rows get dropped.
- 100-row observer feed has ~3x the payload of the old 30-row feed. Negligible — each row is small JSON. No perf concern.
- word_count drift is permanent on existing rows. Future operator reports would show post-Drafter count. Acceptable; no reader-facing surface uses it.

**Files:** [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro), [agents/src/director.ts](../agents/src/director.ts).

**Closes:** FOLLOWUPS audit entry — all 5 numbered points resolved; promoted to `[resolved]`.

---

## 2026-04-22: Removed 4 dead `/api/dashboard/*` endpoints

**Context:** FOLLOWUPS `[open] 2026-04-20: Audit sibling dashboard API endpoints for the same dead-code pattern`. The 2026-04-20 `today.ts` removal raised the question of whether its siblings (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) were similarly orphaned. Added to the list after the 2026-04-20 Memory panel work: `memory.ts`, which was created for that panel but the Astro page ended up querying D1 directly in frontmatter — born orphaned.

**Decision:** grep-audit, delete the dead, keep the live.

**Audit results** (grep across `src/` + `scripts/`, excluding self-references):
- `analytics.ts` — 0 callers. **Deleted.**
- `recent.ts` — 0 callers. **Deleted.**
- `stats.ts` — 0 callers. **Deleted.**
- `memory.ts` — 0 callers. **Deleted.** Born orphaned (DECISIONS 2026-04-20 specified it as the Memory panel's feed, but the page fetches from D1 directly in Astro frontmatter).
- `observer.ts` — 1 caller (`admin.astro` fetches `/api/dashboard/observer` for the acknowledge POST). **Kept.**
- `pipeline.ts` — 2 callers (`admin.astro` poller + `scripts/reset-today.sh` monitor). **Kept.**

**Trade-offs:**
- Public dashboard + library page already query D1 directly in Astro frontmatter — removing the endpoints doesn't affect behavior. The dashboard page actually BECAME more correct after memory.ts was removed from the design: the original Build-1 plan used the endpoint, but the final implementation consolidated into frontmatter queries to keep all page-render data in one place.
- No external API consumers exist. No breaking change to worry about.
- Future public JSON surface decision deferred: `observer.ts` + `pipeline.ts` remain as the only public-ish dashboard endpoints and have clear consumers. If we ever need a public API, we'd add specific endpoints with clear SLA rather than repopulating the speculative surface.

**Doc updates:** `docs/RUNBOOK.md` "Dashboard API endpoints" collapsed to the two survivors + note that public dashboard queries D1 directly. `docs/AGENTS.md` Learner-reader-surfaces rewritten to reference direct queries. `docs/CLAUDE.md` Memory-panel description updated. `docs/FOLLOWUPS.md` closes the audit entry + the admin all-pieces slug spot-check (verified 7/7 production pieces resolve via `/daily/{date}/{slug}/` with 200).

**Files removed:** `src/pages/api/dashboard/analytics.ts`, `recent.ts`, `stats.ts`, `memory.ts`.

---

## 2026-04-22: 12-min watchdog alarm for silent audio stalls (Phase E3 of audio trio fix)

**Context:** FOLLOWUPS `[open] 2026-04-19: Audio pipeline silent stall between alarm chunks`. 2026-04-17 retry attempt stopped at 4/8 beats with no observer event and no log entry. Root cause analysis: ElevenLabs per-attempt timeout is 90s × up to 3 attempts + backoffs ≈ 273s worst case per beat. A piece with 6-8 long beats can exceed the 15-min alarm wall-clock budget mid-call. Cloudflare terminates the invocation; nothing throws in the `runAudioPipeline` try/catch paths; no observer event fires. Result: piece stays in partial state (has_audio=0, some beat rows in daily_piece_audio) with no signal to the admin.

**Decision:** watchdog alarm scheduled at the top of `runAudioPipelineScheduled`. 12-min delay gives the outer alarm 3-min headroom so the watchdog fires while or just after the outer alarm terminates — a true silent stall is visible within ~12-15 min of arming.

**What shipped:**
- `runAudioPipelineScheduled` → `this.schedule(12 * 60, 'checkAudioStalled', {pieceId, date, title, armedAt: Date.now()})` — scheduled BEFORE the pipeline runs so even early abort paths are covered.
- New method `checkAudioStalled(payload)`:
  1. `SELECT has_audio FROM daily_pieces WHERE id = ?` — if 1, no-op (happy path, pipeline completed normally).
  2. `SELECT id FROM observer_events WHERE piece_id = ? AND title LIKE 'Audio failure:%' AND created_at >= armedAt` — if present, no-op (Producer/Auditor/Publisher failure already surfaced).
  3. Otherwise: `observer.logAudioFailure(phase='producer', reason='Silent stall — audio pipeline exceeded 12min watchdog...')`. Escalation severity surfaces in admin feed.
- `observer_events.piece_id` scoping (migration 0020) gives the failure lookup clean isolation — same-date other pieces don't false-trigger this piece's watchdog.

**Trade-offs:**
- Happy path cost: one no-op alarm fire (SQLite reads only, no Claude/ElevenLabs/GitHub) per audio pipeline invocation. Cheap.
- The watchdog fires 12 min after `runAudioPipelineScheduled` schedules itself, not after it actually starts. In practice the 1-second delay before the scheduled run is fired is negligible — the 3-min headroom handles it.
- If a pipeline legitimately takes >12 min (unlikely with current beat counts), the watchdog will false-fire. At that point the escalation would read wrong, but the pipeline would still complete normally and land `has_audio=1`. Worst case is one mis-labeled warn event. Accepted — raising the threshold to 15 min would defeat the point.
- Reusing `logAudioFailure` rather than adding `logAudioStalled` keeps the Observer surface lean. The reason string is self-explanatory; operators can grep for "Silent stall" if they want to filter.
- No retry automation — watchdog surfaces the stall; operator decides whether to Continue or Start over from the admin dashboard. Matches the ship-and-retry posture already in place.

**Files:** [agents/src/director.ts](../agents/src/director.ts).

---

## 2026-04-22: retryAudio short-circuits when audio already complete (Phase E2 of audio trio fix)

**Context:** FOLLOWUPS `[open] 2026-04-19: Continue retry path may trigger full re-run`. `retryAudio` at [`agents/src/director.ts:830`](../agents/src/director.ts) validated the pieceId, read the piece's date + headline, and scheduled `runAudioPipelineScheduled` — **with no check for `has_audio=1`**. A completed piece retried via "Continue" ran the full pipeline: Producer no-op'd via R2 head-check, but Auditor and Publisher both ran. Stacked with the Phase E1 regex bug this produced the 2026-04-17 corruption.

**Decision:** short-circuit at the top of `retryAudio` when `has_audio === 1`. Log via `observer.logError` (warn severity) with the message `retryAudio no-op: piece X already has audio published. Use "Start over" to regenerate.` Return cleanly without scheduling an alarm. Operator sees the no-op in the admin observer feed.

**Trade-offs:**
- Short-circuit is in `retryAudio`, not `retryAudioFresh`. "Start over" is explicit regenerate-and-replace — it wipes `has_audio=0` first so its own inner `retryAudio` call passes the guard. The split matches the admin UI's "Continue" vs "Start over" buttons semantically.
- Defense-in-depth with Phase E1. Even a simultaneous race that dispatches two retries will see one of them land `has_audio=1` first and the other short-circuit. Without the guard, both would run; without E1, the second would corrupt; with E1 alone, the second produces a redundant no-op commit. E1 + E2 gives the cleanest behaviour.
- The observer event uses `logError` (severity: warn) rather than a new dedicated helper. Keeps the Observer surface lean — the message is self-explanatory.

**Files:** [agents/src/director.ts](../agents/src/director.ts).

---

## 2026-04-22: spliceAudioBeats regex consumed leading newline — root cause of 2026-04-17 frontmatter corruption

**Context:** FOLLOWUPS `[open] 2026-04-19: Publisher.publishAudio double-fires on Continue retry path` — 2026-04-17 retro audio produced two commits, the second collapsing `qualityFlag: "low"\n---\n` to `qualityFlag: "low"---` (no YAML terminator, broke content-collection parsing). Required a `git revert` to recover. FOLLOWUPS entry named two hypothetical bugs stacked: (1) Continue re-runs full pipeline, (2) publisher's idempotent guard should have caught the second commit but didn't. Entry said the corruption state "the regex logic on paper should not be able to generate."

**Root cause (2026-04-22 investigation):** the regex CAN generate the corruption state. [`spliceAudioBeats`](../agents/src/publisher.ts) at line 234:
```ts
const withoutExisting = mdx.replace(/\naudioBeats:\n(?:  .+\n)*/, '');
```
consumes the `\n` BEFORE `audioBeats:`. Input `qualityFlag: "low"\naudioBeats:\n  beat-1: "url"\n---\n` becomes `qualityFlag: "low"---\n` — newline lost. The splice regex `/^(---\n[\s\S]*?)(\n---\n)/` then can't find `\n---\n` (there's no newline before `---` anymore), becomes a no-op, and returns `withoutExisting` unchanged. `updatedMdx === withoutExisting ≠ current.mdx`, so `publishAudio`'s idempotent guard at `publisher.ts:103` (`updatedMdx === current.mdx`) fails to fire. Publisher commits the stripped-but-not-respliced file. Verified via node-level reproducer.

**Fix:** capture the leading newline in group 1 and restore it:
```ts
const withoutExisting = mdx.replace(/(\n)audioBeats:\n(?:  .+\n)*/, '$1');
```
Input `qualityFlag: "low"\naudioBeats:\n...\n---\n` now strips to `qualityFlag: "low"\n---\n` (newline preserved). Splice regex matches `\n---\n`, splice inserts the block, idempotent guard fires on identical audioBeats maps.

**Regression test:** [`agents/scripts/verify-splice.mjs`](../agents/scripts/verify-splice.mjs) — 4 cases covering (1) fresh MDX adds block, (2) idempotent re-splice with identical map, (3) re-splice with different map preserves frontmatter terminator (the 2026-04-17 corruption case), (4) audioBeats followed by another frontmatter key — strip removes only audioBeats, keeps sibling. Runs as `pnpm verify-splice` in the `agents/` workspace. Node-level pure string transformation — no worker setup needed.

**Trade-offs:**
- Case 4 surfaces an existing behavior: re-splice moves the audioBeats block to end-of-frontmatter (splice regex always inserts before closing `---`). The content schema doesn't care about frontmatter key order, so this is a non-regression. Documented in the test comment.
- The fix is in the pure regex transformation — no MDX parser dependency, no runtime semantics change beyond the bug. Existing good commits stay as-is (no re-publish required).
- Continue button double-fire is a separate concern — Phase E2 short-circuits `retryAudio` when `has_audio=1`. But even without E2, E1 alone means a double-click now produces two IDENTICAL commits (no-op second) instead of one correct + one corrupted.

**Files:** [agents/src/publisher.ts](../agents/src/publisher.ts), [agents/scripts/verify-splice.mjs](../agents/scripts/verify-splice.mjs), [agents/package.json](../agents/package.json).

---

## 2026-04-22: Admin Zita grouped by piece_id (Phase D of multi-per-day audit)

**Context:** FOLLOWUPS audit entry point #2. `zita_messages` has had a `piece_id` column since migration 0014 (Phase 1 of multi-per-day cadence work) but the admin Zita page (`/dashboard/admin/zita/`) never consumed it — conversations were grouped by `(user_id, piece_date)`, pooling at multi-per-day, and headlines were looked up via `daily_pieces WHERE date IN (...)` which overwrites in the title Map when multiple pieces share a date.

**Decision:** switch the admin Zita page to piece_id grouping + piece_id-keyed headline lookup.

**What shipped:**
- `Conversation` + `Message` types gain `piece_id: string | null`.
- `SELECT` changes from `GROUP BY user_id, piece_date` to `GROUP BY user_id, piece_id`. `MAX(piece_date)` included in SELECT for display compat (the banner label still shows piece_date when headline lookup fails).
- Headlines Map rekeyed: `pieceTitles: Map<piece_id, headline>`. Title SELECT switches from `daily_pieces WHERE date IN (...)` to `WHERE id IN (...)` — no more last-writer-wins at multi-per-day.
- Render loop `key = ${user_id}|${piece_id ?? piece_date}` with piece_date fallback for any legacy NULL-piece_id row. Headline resolution prefers piece_id; falls back to piece_date label (plain date) when piece_id is null or headline lookup misses.
- `messagesByKey` grouping Map rekeyed the same way.

**Trade-offs:**
- Legacy rows with NULL piece_id would render under the piece_date fallback key, sharing with other NULL-piece_id rows. 0014 backfill + 0013 Commit A's hand-map populated piece_id for all 92 historical rows, so null-piece_id doesn't exist in production zita_messages today. The fallback is defensive.
- Per-piece admin page's "Questions from readers" section at [src/pages/dashboard/admin/piece/[date]/[slug].astro:244](../src/pages/dashboard/admin/piece/%5Bdate%5D/%5Bslug%5D.astro) was already piece_id-scoped (shipped with the Phase 7 nested route in commit `3208c86`) — verified, no change needed.
- Non-daily (lessons-era) rows have piece_date=NULL and piece_id=NULL. They render as "Non-daily (lessons)" with no deep-link, same as before.

**Verify after deploy:** at multi-per-day a reader chatting with both same-date pieces should produce two distinct conversation cards (one per piece), each with its correct headline. At current traffic (3 readers across 7 pieces) the effect is near-zero today — visible regression tester would need to simulate a same-day multi-piece chat.

**Files:** [src/pages/dashboard/admin/zita.astro](../src/pages/dashboard/admin/zita.astro).

---

## 2026-04-22: Admin + dashboard run log scoped by piece_id (Phase C of multi-per-day audit)

**Context:** FOLLOWUPS audit entry point #3 + residual `WHERE date = ?` entry. After migration 0019 backfilled `piece_id` on `audit_results` + `daily_candidates`, two consumer sites were still keying off `task_id = 'daily/${date}'` and `WHERE date IN (...)`: admin home's "All Pieces" rounds/candidates widget and the public dashboard's week-pieces run log. At multi-per-day today's two pieces each showed the same pooled counts (e.g. both tobacco and air-traffic would display `2 rounds, 50 candidates` from their combined dataset). Separately, the public dashboard's today's-piece hero still did `WHERE date = ? LIMIT 1` — arbitrary same-date pick.

**Decision:** swap both consumer sites to `piece_id IN (...)` joins using `daily_pieces.id`; add `ORDER BY date DESC, published_at DESC` tiebreakers to the parent SELECTs so same-date pieces stay in publish order; fix the dashboard hero with `ORDER BY published_at DESC LIMIT 1` (matches the homepage + daily-index pattern already shipped in Phase 4 of the morning's schema fix).

**What shipped:**
- **`src/pages/dashboard/admin.astro`** — `Piece` type gains `id`. pieces SELECT adds `id` column + `ORDER BY date DESC, published_at DESC`. `roundsByDate`/`candsByDate` renamed to `roundsByPiece`/`candsByPiece`; both queries now `WHERE piece_id IN (...) GROUP BY piece_id`. `allPieces` map uses `p.id` for lookups.
- **`src/pages/dashboard/index.astro`** — `Piece` type gains `id`. Today's piece hero SELECT adds `id` + `ORDER BY published_at DESC LIMIT 1`. Week pieces SELECT adds `id` + `ORDER BY date DESC, published_at DESC`. Rounds/candidates maps + queries re-keyed on piece_id.

**Trade-offs:**
- Pre-Phase-C pre-0018 rows have NULL `piece_id` on audit_results (9 rows backfilled in 0019; all filled). So all production rows now have piece_id and the queries return the same totals as the pre-fix date-keyed versions at 1/day cadence — no behavioral regression there.
- Local D1 (dev) doesn't have the 0014–0019 backfills unless the developer applies them manually — the dashboard renders empty in local dev. Production (where backfills ran) is the authoritative test surface. Unit-level testing wasn't added because the queries are simple SQL and the schema guarantees are in the migration.
- Day-aggregation views unchanged: `lifetimeRuns = COUNT(DISTINCT run_id)` (distinct *days*), pipeline history grouped by run_id, weekCount by date — all intentionally day-level. `avgRoundsWeek` derives from the now-piece-scoped roundsByPiece map so its average is per-piece, not per-day (correct at multi-per-day).

**Verify in production after deploy:**
1. Admin home All Pieces list — today's two pieces (tobacco + air-traffic) should show distinct `rounds` + `candidates` counts.
2. Public dashboard today's piece hero — should display the most-recently-published same-date piece (currently air-traffic since it shipped later than tobacco today). Changes when next slot publishes.
3. Public dashboard run log — today's two pieces should show distinct counts.

**Files:** [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro), [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro).

---

## 2026-04-22: observer_events.piece_id column for per-piece admin scoping

**Context:** FOLLOWUPS `[open] 2026-04-22: Admin / dashboard / public pages — full multi-per-day audit` — user noticed on evening of 2026-04-22 that the per-piece admin deep-dive was still pooling observer events across both same-date pieces (tobacco piece page showed air-traffic's `Published`, `Reflection`, `Audio failure`, `Audio published` events mixed in — 9 events total when the piece only generated ~3 of them). The 2026-04-22 morning piece_id schema fix had fixed pipeline_log / audit_results / daily_candidates pooling but left observer_events untouched because it had no piece_id column and was known-intentional by the schema-fix design (kept as 36h day window).

**Decision:** Path 1 from the audit entry — add `piece_id` column to `observer_events` and thread through every agents-side call site. Follows the same schema-over-bandaid posture the user pushed for during the main piece_id schema fix session earlier today. The alternative (client-side substring match on title) would be brittle against title format drift and wouldn't capture all piece-scoped events.

**What shipped:**
1. **Migration 0020** — nullable `piece_id TEXT` + `idx_observer_events_piece`. Additive, no snapshot, no backfill. Historical rows stay NULL and surface via the 36h fallback on per-piece admin.
2. **`agents/src/observer.ts`** — 13 piece-scoped helpers gained a trailing optional `pieceId: string | null = null`. `writeEvent` INSERT extended to bind piece_id. `logDailyRunSkipped` binds the *existing* piece_id (the piece already in the slot), not a new one.
3. **`agents/src/director.ts`** — threaded pieceId through all 13 observer call sites in director.ts. pieceId is pre-allocated at the top of `triggerDailyPiece()` per Phase 3 of this morning's schema fix, so it's in scope everywhere.
4. **`src/lib/observer-events.ts`** — `ObserverEventInput` gained optional `pieceId`. INSERT binding extended. 4 call sites in site-worker (`/api/zita/chat`, `/api/dashboard/admin/settings`) unchanged for now — none currently receive piece_id in their request context. That's a separate future task (zita-chat component would need a `data-piece-id` attribute, chat endpoint would need to accept & scope by it, zita_messages writes would need piece_id populated — all cross-cutting). Deferred explicitly.
5. **`src/pages/dashboard/admin/piece/[date]/[slug].astro`** — observer_events query now:
   ```sql
   WHERE piece_id = ?
      OR (piece_id IS NULL AND created_at >= ? AND created_at < ?)
   ```
   Mixed mode: new piece-scoped events bind directly; legacy NULL rows keep the 36h day window fallback so admin sees them somewhere rather than losing them.

**Trade-offs:**
- Legacy rows (pre-0020) stay NULL permanently. Backfilling would mean parsing title/body text for headline matches — the same kind of brittle substring work the schema fix was meant to replace. Not worth it for a finite set of historical rows that age out.
- Site-worker `logObserverEvent` callers stay pieceId-null for now. At today's traffic (4 observer writes/day from site worker, all Zita-related) the admin feed won't show meaningful degradation. When zita-chat grows real traffic + multi-per-day cadence overlap, circle back.
- `logDailyRunSkipped` uses the *existing* (already-published) piece's id rather than a new one. Correct semantically — the skip event belongs to the piece that's blocking the slot.
- Mixed piece_id + 36h fallback in the admin query is intentional. Pure piece_id scope would lose system events (admin_settings_changed, zita_rate_limited) from per-piece view; pure 36h window was the problem we started with. Keep both.

**Verify after next publish:** new `Published`, `Reflection`, `Audio published` rows should have piece_id = the piece's UUID. Per-piece admin renders only that piece's new events + any legacy/system events caught in the 36h window — no more cross-piece pooling of same-date events.

**Files:** [migrations/0020_observer_events_piece_id.sql](../migrations/0020_observer_events_piece_id.sql), [agents/src/observer.ts](../agents/src/observer.ts), [agents/src/director.ts](../agents/src/director.ts), [src/lib/observer-events.ts](../src/lib/observer-events.ts), [src/pages/dashboard/admin/piece/[date]/[slug].astro](../src/pages/dashboard/admin/piece/%5Bdate%5D/%5Bslug%5D.astro), [docs/SCHEMA.md](SCHEMA.md).

---

## 2026-04-22: Curator prompt exposes candidate UUIDs so `selected` can flip

**Context:** FOLLOWUPS `[open] 2026-04-21: daily_candidates.selected never flipped on historical runs` — prod had 250 candidate rows across 5 dates, zero with `selected = 1`. Director's post-curation UPDATE at [director.ts:227](../agents/src/director.ts) was wrapped in `.run().catch(() => {})`, so whatever was going wrong was silent. Admin per-piece deep-dive's "picked candidate marked with teal dot" has therefore never rendered.

**Root cause:** [buildCuratorPrompt](../agents/src/curator-prompt.ts) rendered candidates as `${i+1}. [${category}] "${headline}" (${source})` — **no UUID in the prompt at all**. Claude's returned `selectedCandidateId` was whatever it guessed (empty, a number, a made-up string) — never a real row id. The UPDATE then matched 0 rows. `.catch(() => {})` hid the 0-rows outcome (0 rows isn't an exception — `.run()` succeeds; the silent-catch caught only throw-path errors). Two failure modes stacked, producing zero signal.

**Fix:**
1. **Prompt fix** — `buildCuratorPrompt` now emits `${i+1}. id: ${c.id}\n   [${category}] "${headline}" (${source})\n   ${summary}`. Added explicit instruction: "selectedCandidateId MUST be the exact id string shown next to the chosen candidate above — do not invent, truncate, or guess."
2. **Silent-catch removal** — the UPDATE is now wrapped in try/catch that inspects `upd.meta.changes`. Three branches fire `observer.logError` on regression: (a) throw during UPDATE, (b) UPDATE runs but 0 rows match (id-shape drift), (c) curator returned no `selectedCandidateId` at all. Next regression in this code path is visible in the admin observer feed instead of silent.

**Trade-offs:**
- Historical 250 rows of `selected=0` stay as-is — the winning id for those runs is not recoverable (Curator's reasoning wasn't persisted and the admin feed wasn't surfacing Curator's raw output). Backfilling would mean guessing, which is the class of bug we just fixed.
- The prompt is ~50 chars longer per candidate × 50 candidates = ~2500 extra input tokens per curate call. Negligible vs the ~1200 output tokens we already pay Claude.
- Observability adds up to 3 new observer_events per run (one per regression branch). At happy path, zero new events.
- Didn't change the response schema (still `selectedCandidateId` at the top level) — no downstream consumers to update.

**Verify on next 02:00 UTC run:** `SELECT id, selected FROM daily_candidates WHERE piece_id = '<new-piece-id>' AND selected = 1` should return exactly 1 row. Per-piece admin page's teal dot should render on the Curator section for the first time.

**Files:** [agents/src/curator-prompt.ts](../agents/src/curator-prompt.ts), [agents/src/director.ts](../agents/src/director.ts). No migration; code-only.

---

## 2026-04-22: piece_id columns on day-keyed tables (audit_results / pipeline_log / daily_candidates)

**Context:** Supersedes the earlier 2026-04-22 entry "Time-window scoping for admin per-piece deep-dive at multi-per-day" below. That entry shipped a midpoint-between-publishes bandaid on the astro-side admin page to isolate per-piece data without a schema change. User pushed back ("you are going round and round") — the bandaid was correct-for-now but the root cause was schema-level: three tables had no `piece_id` column. This entry is the proper fix, shipped across 5 phases with pauses between each.

**The bug (recap):** at `interval_hours < 24`, two pieces publishing on the same date shared the same `audit_results.task_id = 'daily/<date>'`, `pipeline_log.run_id = '<date>'`, and `daily_candidates.date = '<date>'`. The admin per-piece deep-dive page pooled both pieces' rows. Worse, [`director.ts:950`](../agents/src/director.ts:950) built identical `draft_id = 'daily/<date>-r<N>'` for both pieces' round 1, so group-by-draft_id collided the two pieces with D1's last-writer-wins, surfacing air-traffic's facts on the tobacco admin page (screenshot evidence).

**Decision:** add nullable `piece_id TEXT` to all three tables. Director pre-allocates `pieceId` at the top of `triggerDailyPiece()` (not publish-time, as before) so every logStep / saveAuditResults / scanner candidate INSERT carries it from the first write. Readers scope by `WHERE piece_id = ?` for unambiguous multi-per-day isolation. `run_id` stays `YYYY-MM-DD` permanently (Phase 3 walk-back from 2026-04-21 preserved) — `piece_id` is additive, not a replacement, so day-aggregation consumers keep working.

**Phase log (5 phases, 4 pauses, plan at `~/.claude/plans/glowing-snacking-shell.md`):**

| Phase | What shipped | Migration | Verify |
|---|---|---|---|
| 1 | `migrations/0018_pipeline_log_piece_id.sql` — ALTER + index. Scoped DOWN from the original plan after `PRAGMA` revealed 0014 had already added the column to `audit_results` + `daily_candidates` | 0018 | `PRAGMA table_info(pipeline_log)` shows column |
| 2 | `migrations/0019_piece_id_backfill.sql` — 9 UPDATEs covering 9 + 153 + 350 = 512 null rows. Two strategies: pre-2026-04-22 joined on date (unambiguous at 1/day); 2026-04-22 split by midpoint (1776850364493) between the two pieces' published_at | 0019 (manual) | `SELECT COUNT(*) WHERE piece_id IS NULL` returns 0 across all three tables |
| 3 | Agents worker writer threading. Moved `const pieceId = crypto.randomUUID()` from line 322 (mid-publish) to top of `triggerDailyPiece()`. `logStep()` + `saveAuditResults()` + `scanner.scan()` + `learner.analysePiecePostPublish()` all thread piece_id. retryAudio's publish-step lookup gains `AND piece_id = ?`. Removed `LEARNER_PIPELINE_LOOKBACK_MS` / `LOOKAHEAD_MS` — no longer needed | — | typecheck clean on touched files (18 pre-existing `server.ts` SubAgent errors unchanged) |
| 4 | Site worker reader repointing. Three queries on `[date]/[slug].astro` switch to `WHERE piece_id = ?`. Midpoint bandaid deleted. `/api/daily/[date]/made.ts` 5 queries prefer piece_id. `made-by.ts` `loadMadeTeaser` takes optional pieceId. `/api/dashboard/pipeline.ts` returns `groups[]` + `headlines{}` keyed by piece_id. `admin.astro` renders today's run as collapsible per-piece `<details>` blocks — closes Bug A (flat 26-step blob) | — | `pnpm build` clean, preview API returns new shape |
| 5 | This DECISIONS entry + FOLLOWUPS closes + CLAUDE.md section | — | docs committed alongside code per feedback rule |

**Writer-side topology after Phase 3:**

```ts
// director.ts
async triggerDailyPiece(force = false): Promise<...> {
  const pieceId = crypto.randomUUID();        // pre-allocated at run-start
  // ... slot guard, interval read ...
  await this.logStep(today, pieceId, 'scanning', 'running', { intervalHours });
  const candidates = await scanner.scan(pieceId);
  // ... curator, drafter, auditors (saveAuditResults takes pieceId) ...
  // daily_pieces INSERT uses the SAME pieceId (no fresh UUID)
}

private async logStep(runId, pieceId, step, status, data) {
  INSERT INTO pipeline_log (..., piece_id) VALUES (..., ?);
}

private async saveAuditResults(taskId, pieceId, round, voice, structure, facts) {
  INSERT INTO audit_results (..., piece_id) VALUES (..., ?);  // x3 batched
}
```

Orphan piece_ids (runs that skip or error before publish) have rows in pipeline_log / audit_results / daily_candidates with a piece_id that never becomes `daily_pieces.id`. Accepted — those rows don't render on any piece's admin page (no daily_pieces row to JOIN on) but stay visible on day-aggregation views via `run_id`.

**Trade-offs considered:**

1. **Why pre-allocate at run-start vs publish-time?** — so every earlier write carries piece_id. Alternative: two-pass — write with NULL, back-fill at publish. More complex, introduces a window where readers might see half-populated rows, and orphan rows (scanner-skipped runs) would have no piece_id to group by. Pre-allocation is cleaner.

2. **Why keep `run_id = YYYY-MM-DD`?** — the 2026-04-21 walk-back lesson. Four site-worker consumers embedded date assumptions; changing run_id broke them. Adding piece_id alongside preserves the day-grouping views (admin pipeline history, lifetime runs) while enabling per-piece isolation.

3. **Why fall back to date-keyed queries when pieceId is null?** — defensive. Post-Phase-7 every MDX has pieceId in frontmatter, but a stale cached reader bundle or a typo'd URL might still hit the page without one. Empty result would be more confusing than the day-view fallback.

4. **Why not delete the superseded DECISIONS entry?** — append-only rule. The bandaid is part of the session's history and the mid-session course-correction is valuable context for future operators.

**Verified end-to-end against production D1 (2026-04-22):**
- `audit_results`: air-traffic 6 rows (r1+r2 × 3 auditors), tobacco 3 rows (r1 × 3 auditors), 0 NULL.
- `pipeline_log`: air-traffic 23 rows including the 04:19 audio retry, tobacco 19 rows, 0 NULL.
- `daily_candidates`: 50 / 50 per piece, 0 NULL.
- All three new queries `WHERE piece_id = ?` return the expected row counts via `wrangler d1 execute --remote`.

**Rollback:**
- Full session: `git reset --hard 8902df9`.
- Phase 1 migration: `ALTER TABLE pipeline_log DROP COLUMN piece_id` (D1 supports DROP COLUMN as of 2024).
- Phase 2 backfill: `UPDATE <table> SET piece_id = NULL`; readers keep a date-keyed fallback so partial NULL coverage doesn't crash.
- Phase 3 + 4: `git revert <sha>` per phase.

**Post-ship verification (pending deploy):**
- Hit `https://zeemish.io/dashboard/admin/piece/2026-04-22/uk-bill-bans-.../` → AUDIT ROUNDS (1), voice 92/100, tobacco facts only, 50 candidates.
- Hit `https://zeemish.io/dashboard/admin/piece/2026-04-22/12-5-billion-.../` → AUDIT ROUNDS (2), voice 95/100, COBOL/NATS facts, 50 candidates.
- Hit `https://zeemish.io/dashboard/admin/` → Today's Run shows two collapsible per-piece blocks.

## 2026-04-22: Time-window scoping for admin per-piece deep-dive at multi-per-day

**Context:** User flipped `interval_hours=12` overnight; 2026-04-22 shipped two pieces (air-traffic at 02:00 UTC, tobacco at 14:00 UTC after the slot-aware-guard fix). Visiting `/dashboard/admin/piece/2026-04-22/uk-bill-bans-.../` showed the tobacco piece header but air-traffic's audit rounds: Round 2 (final) with voice note "Close adds extra sentence" and fact claims about $12.5 billion / NATS / COBOL. Scanner candidates count showed 100 (two runs pooled). Operator can't trust the page.

**Root cause:** three queries on [`src/pages/dashboard/admin/piece/[date]/[slug].astro`](../src/pages/dashboard/admin/piece/%5Bdate%5D/%5Bslug%5D.astro) scope by date, not piece_id — `audit_results.task_id = 'daily/<date>'`, `pipeline_log.run_id = '<date>'`, `daily_candidates.date = '<date>'`. None of those tables has a piece_id column. Worse, [`director.ts:950`](../agents/src/director.ts:950) builds `draft_id = 'daily/<date>-r<N>'` — both same-date pieces have identical draft_ids at round 1, so the page's group-by-draft_id collides the two pieces' rows with D1's last-writer-wins.

The file's own pre-fix comment (lines 117-120) called this "intentional — show the day's activity, matching the Phase 3 walk-back". That reasoning breaks at multi-per-day: the page header names one piece, the body shows another. Not a day view, a misattribution.

**Decision:** time-window scope the 3 day-keyed queries at query time. No schema change. No agent/migration work. Pure astro-site worker fix, reverts cleanly.

```ts
const sameDayPieces = /* SELECT id, published_at FROM daily_pieces WHERE date = ? ORDER BY published_at ASC */;
const thisIdx = pieceId ? sameDayPieces.findIndex((p) => p.id === pieceId) : -1;
const isMultiPerDay = sameDayPieces.length > 1 && thisIdx >= 0 && piece?.published_at != null;
// Midpoint between consecutive pieces' published_at values partitions
// the day into non-overlapping intervals. Self-scaling: tighter windows
// at short intervals, wider windows (absorbing audio retries) at long.
const prevMid = isMultiPerDay && thisIdx > 0
  ? Math.floor((sameDayPieces[thisIdx - 1].published_at + piece.published_at) / 2) : null;
const nextMid = isMultiPerDay && thisIdx < sameDayPieces.length - 1
  ? Math.floor((piece.published_at + sameDayPieces[thisIdx + 1].published_at) / 2) : null;
const windowStart = prevMid ?? 0;
const windowEnd = nextMid ?? Number.MAX_SAFE_INTEGER;
```

Then `audit_results / pipeline_log / daily_candidates` all gain `AND created_at >= ? AND created_at < ?` bound on `(windowStart, windowEnd)`. observer_events keeps its 36h window (legitimate day view of operator events). Audio + Zita sections already piece-scoped via `piece_id` — unchanged.

**False start corrected mid-session:** first pass used a fixed 30min post-publish buffer (`windowStart = prev.published_at + 30min`, `windowEnd = this.published_at + 30min`). User pushed back asking for deep verification against real data. Running the queries via `wrangler d1 execute --remote` against 2026-04-22 rows turned up an air-traffic audio retry at 04:19:14 UTC — **37min after its publish at 03:42:38**, outside the 30min buffer. Those retry rows would have leaked into tobacco's window. Switched to midpoint partitioning: midpoint between air-traffic (03:42:38) and tobacco (18:42:50) is 11:12 UTC, so air-traffic's window is [0, 11:12) and comfortably contains retries up to half the inter-publish gap.

**Verified against real D1 data for 2026-04-22 (both pieces):**
- `audit_results` — air-traffic window returns 6 rows (r1+r2 × 3 auditors); tobacco returns 3 rows (r1 × 3 auditors). Zero crossover.
- `pipeline_log` — air-traffic window returns 23 rows including the 04:19 audio retry; tobacco returns 18 rows. Zero crossover.
- `daily_candidates` — 50 per piece (two scanner runs). Zero crossover.

**Trade-offs considered:**

1. **Why not `audit_results.piece_id` column?** — correct long-term fix, but requires: migration + backfill, director allocates piece_id at run-start (not publish-time, which is Phase 1's pattern), threading it through every `saveAuditResults` + `logStep` + `daily_candidates` INSERT, and parallel code changes across the agents worker. Wants its own plan doc with pause points. Filed in FOLLOWUPS. Time-window scope unblocks the operator today.

2. **Why `published_at` midpoints instead of scanner-start timestamps?** — scanner-start partitioning would be perfect (actual run boundaries), but requires joining on pipeline_log to find each piece's first `scanning running` row and trusting the sort order matches publish order. Midpoint gives a clean formula on a single `daily_pieces` query and absorbs audio retries up to half the gap — at interval_hours=1 (minimum) that's 30min, which matches the fixed-buffer approach at its tightest. At interval_hours=12 it stretches to ~6h.

3. **Why midpoint and not fixed post-publish buffer?** — verified-against-data call. Real 2026-04-22 run had a 37min audio retry outside a 30min buffer. Bumping the buffer to 60min or 90min is arbitrary and still breaks on heavier retries. Midpoint self-scales to the gap between runs.

4. **At `interval_hours=24`, any change?** — no. `sameDayPieces.length === 1`, `isMultiPerDay === false`, both midpoints return null → `windowStart=0`, `windowEnd=MAX_SAFE_INTEGER`. Queries functionally identical to pre-fix. All historical pieces unaffected.

5. **What about `admin.astro` (the Today's Run panel on the admin home)?** — shows all same-day pipeline rows in one flat stream. Cosmetic, data is correct, operator can read it. Deferred to FOLLOWUPS for a collapsible two-run UI.

**Residual edge case:** at multi-per-day a manual audio retry fired *later than half the inter-publish gap* would attribute to the wrong piece on the timeline section. The Audio section on the page reads `daily_piece_audio` directly (piece-scoped via migration 0015) so audio state is always correct — only the pipeline timeline loses the retry row. Documented, accepted.

**Verified:** build clean. Query math validated against production D1 row-by-row via `wrangler d1 execute --remote` (row counts and content match expected partitions for both pieces). Browser verification of the rendered admin page requires session cookies that aren't available in dev preview — relying on the query verification as proof of correctness.

**Not scoped:** Bug A (Today's Run flat list), proper piece_id columns on audit_results/pipeline_log/daily_candidates, Director piece_id-at-run-start refactor, admin home pipeline-history per-piece grouping. All filed in FOLLOWUPS.

## 2026-04-22: Slot-aware guard for multi-per-day cadence

**Context:** User flipped `admin_settings.interval_hours=12` evening of 2026-04-21. The 02:00 UTC run on 2026-04-22 fired and published the ATC piece as expected. The 14:00 UTC slot should have produced a second piece — nothing appeared, no pipeline_log entry, no observer event. User asked "why didn't 2pm run, check the issue, don't guess".

**Investigation:**
- Live pipeline API confirmed `intervalHours:12` recorded in the 02:00 UTC scanning step — the admin setting was read correctly.
- Last pipeline_log entry: `audio-publishing done` at T=1776826830410 (~03:40 UTC). Nothing at or after 14:00 UTC.
- Phase 3 gate math for `interval_hours=12`: `(14 - 2 + 24) % 12 === 0` → PASSES. So `dailyRun` WAS invoked at 14:00 UTC; the hourly cron fired.
- Silent-null path traced: [agents/src/director.ts:140-146](../agents/src/director.ts:140) `if (existing) return null` after `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` — bailed *before* writing the first `scanning` logStep, hence the zero trace.
- Phase 1 through Phase 7's multi-per-day correctness audits never touched this guard. The CLAUDE.md claim "all multi-per-day correctness blockers resolved as of `cbf1f17`" was factually wrong.

**Decision:** replace the calendar-day guard with a slot-window guard, and make the skip-path loud.

**Slot-window guard (Change 1):**

```ts
if (!force) {
  const now = new Date();
  const slotStartMs = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    now.getUTCHours(), 0, 0, 0,
  );
  const existing = await this.env.DB
    .prepare('SELECT id FROM daily_pieces WHERE published_at >= ? LIMIT 1')
    .bind(slotStartMs)
    .first<{ id: string }>();
  if (existing) {
    const observer = await this.subAgent(ObserverAgent, 'observer');
    await observer.logDailyRunSkipped(today, intervalHours, slotStartMs, existing.id);
    return null;
  }
}
```

Slot-start = top of the current UTC hour. Correct for any `interval_hours` value in `ALLOWED_INTERVAL_HOURS` because Phase 3's gate `(hour - 2 + 24) % intervalHours === 0` already rejected every non-slot-boundary hour before we reach `triggerDailyPiece`. At `interval_hours=24` slotStart rounds to 02:00 UTC and the guard's semantic matches the prior calendar-day behaviour for all practical purposes — no regression at current prod default.

**Observer-on-skip (Change 2):** new `logDailyRunSkipped(date, intervalHours, slotStartMs, existingPieceId)` helper in observer.ts. Severity `info` — this is expected protective behaviour when a slot re-dispatches (SDK quirk, manual replay, clock drift). Visible in the admin observer feed. Replaces the prior silent `return null`. Going forward "where did that run go?" has an answer.

**Why not remove the guard entirely:** defence-in-depth against double-publish within a single slot. If the Agents SDK cron ever double-dispatches (dedupe bug, manual re-registration, clock drift), the slot-window check catches it. Keeping the guard is cheap; losing the protection would be asymmetric risk.

**Why not conditional guard `if (intervalHours >= 24) { /* old */ }`:** works but semantically wrong — it says "below 24h cadence, no same-slot protection at all." The slot-window guard is the right abstraction at every cadence.

**Why `published_at` as the filter column (not `created_at`):** `published_at` is set to the same `Date.now()` value that flows into the MDX frontmatter at publish time. It's the authoritative "this slot's piece landed" timestamp. `created_at` on `daily_pieces` happens to be set to the same value today, but semantically `published_at` matches intent.

**Why not add an index on `published_at`:** `daily_pieces` has 6 rows. Table scan is instant. Revisit if/when volume crosses ~10k.

**Rollback point:** `61ae3fc` (pre-session HEAD, clean tree, origin in sync).

**Retroactive fill:** user confirmed via AskUserQuestion that today's missed 14:00 UTC slot should be filled in. After deploy, POST `/daily-trigger` (force=true via admin secret) produces today's second piece. Natural 2026-04-23 02:00 UTC + 14:00 UTC slots continue uninterrupted.

**Verification:**
- Typecheck: 18 errors in `server.ts` (pre-existing SubAgent typing per CLAUDE.md convention), zero new errors in director.ts or observer.ts.
- Not previewable — change lives in the agents worker (Director DO), which doesn't render through the Astro preview server. Verification is live (after deploy) via admin observer feed + next cron slot.
- Post-deploy functional probes (in plan): guard-protects-within-slot, retroactive-fill-works, default-cadence-unaffected.

**Closes the follow-on claim:** CLAUDE.md "Multi-piece cadence plan — status" block updated to reflect the late-caught regression and its same-session fix. Next multi-per-day correctness audit should check `WHERE date = ?` guards explicitly, not just `WHERE run_id = ?` paths.

---

## 2026-04-22: Bump ElevenLabs per-attempt timeout 30s → 90s

**Context:** The 2026-04-22 run's audio pipeline failed with `"The operation was aborted due to timeout"` after 131 seconds wall time. Two beats reached R2 (`hook` at 798 chars, `the-core-problem` at 2375 chars), then the producer stalled on `why-the-debt-compounds` at 2960 chars. Three retries × 30s timeout + backoffs ≈ 93s burned before the whole producer threw. Observer logged an escalation; text was already live; admin retry button was the documented recovery path.

**Investigation:**
- Pipeline log for `run_id='2026-04-22'`: `audio-producing running` at T=400565, `failed` at T=532034 (131s).
- `daily_piece_audio` for piece `726b2abf`: 2 rows present (hook + the-core-problem), matching the "made it to R2 before stall" reading.
- Beat length audit on committed MDX: hook 798 / the-core-problem 2375 / why-the-debt-compounds **2960** / what-we-lose-by-waiting 3397 / close 120. Drafter originally emitted 8 beats (pipeline_log drafting step says `beatCount: 8`); final frontmatter is `beatCount: 5`, meaning the Integrator's round 1 revision compressed the structure. Individual beats ended up ~50% larger than the 2000-char target the original 30s timeout was sized against.
- Error text matches the standard `DOMException` from `AbortSignal.timeout` — confirms it's the per-attempt timeout firing, not an ElevenLabs 5xx or 4xx.

**Decision:** raise `callElevenLabs`'s per-attempt timeout from 30_000ms → 90_000ms at [agents/src/audio-producer.ts:313](../agents/src/audio-producer.ts:313) and update the associated comment with the new sizing rationale.

**Why 90s (not 60s, not streaming, not sub-chunking long beats):**
- The existing 30s comment assumed "~2000 chars typically returns in 5-15s; 30s is generous headroom". At 3000 chars + `speed: 0.95` (slower speech → longer audio → longer server-side work), ElevenLabs can legitimately take 30-60s on the *happy path*. Happy-path > 30s means the cap wasn't headroom at all, it was the limit.
- 60s would cover the observed 3000-char case but leaves no margin for ElevenLabs p99 spikes or the 3397-char `what-we-lose-by-waiting` beat queued right after.
- 90s gives ~6x typical happy-path latency; still well inside the alarm handler's 15-min wall-clock budget even in the absolute worst case (3 attempts × 90s + 1s + 2s ≈ 273s per beat, ~4.5min for the longest beat).
- Not sub-chunking long beats: would mean stitching audio at sentence boundaries, which corrupts prosody at the seam (prior-request-id stitching is ElevenLabs' answer to cross-call prosody, and that only works between complete responses). Out of proportion to the problem.
- Not switching to the streaming endpoint: streaming would start returning bytes sooner, but the producer currently buffers to R2 as one blob — converting means rewriting the write path + R2 object assembly. Not worth it for a 1-line fix that solves the observed failure mode.
- Kept `MAX_BEATS_PER_CHUNK = 2`: the DO-to-DO RPC wall-clock concern is blunted by `keepAlive()` + alarm-triggered invocation (per Phase F/G/H hardening in DECISIONS 2026-04-19). Two long beats in one chunk = 30-60s typical, 180s absolute worst case — the alarm handler tolerates that.

**Why not also add beat-name context to the error:** the observer event's reason text currently says `"The operation was aborted due to timeout"` with no beat identifier — *which* beat stalled has to be reconstructed from `daily_piece_audio` row presence. Useful, but orthogonal to this fix. Noted, not scoped in.

**Verification:** typecheck clean on the touched file. The 18 pre-existing SubAgent typing errors in `agents/src/server.ts` are unchanged (documented since Phase 2). No new errors introduced.

**Rollforward plan:** deploy agents worker; operator hits the **Continue** button on the admin per-piece page for 2026-04-22; producer's skip-if-exists-in-R2 logic will find hook + the-core-problem already in R2 and resume from beat 3. Expected total runtime ~45-60s for the three remaining beats at their happy-path latencies.

**Post-deploy verification (same day):** operator fired the Continue retry; `audio-producing running` at T=1776826754221, `audio-producing done` at T=1776826829247 — **75s across 2 chunks, zero per-attempt retries**. All three remaining beats completed inside the 90s cap on first attempt (2960 chars `why-the-debt-compounds`, 3384 chars `what-we-lose-by-waiting`, 118 chars `close`). Audio-auditor passed 5/5 beats = 9608 chars = 8.5MB. Publisher second-commit `9bc60b5` spliced `audioBeats:` into the MDX frontmatter. `daily_pieces.has_audio=1`. Close.

**Reference:** `c422bfc` raised `AbortSignal.timeout(30_000)` → `AbortSignal.timeout(90_000)` at `agents/src/audio-producer.ts`; followup commit closed AGENTS.md drift in the AudioProducer/AudioAuditor sections (method signatures + backoff schedule + timeout value), added this verification paragraph to DECISIONS + CLAUDE.md.

---

## 2026-04-22: Phase 7 FOLLOWUPS cleanup — five-commit wrap

**Context:** Five `[open]` FOLLOWUPS items remained after the cadence plan's main 14-commit run (ending at `c4caf39`). All Low priority. None blocked the cadence flip. Session brief: close them all in dependency order — cosmetics first, then the piece-id plumbing that later phases depend on, then the admin-route nesting + the reset-script work that benefit from that plumbing.

**Order (executed as five atomic commits):**

1. **`19910d7` — copy cleanup.** Ten files touched. Reader-visible marketing moved to neutral rhythm language ("every morning" / "each morning"); operational docs spell out the current default + configurable hook explicitly ("hourly cron gated by `admin_settings.interval_hours`, default 24 → only 02:00 UTC fires; admin-configurable"). Zita synthesis row in RUNBOOK updated from the old absolute 01:45 UTC day+1 to the Phase 6 relative `publish + 23h45m` reality. Dashboard footer, README intro, book chapters 8/9/99, src/pages/index.astro "no piece today" fallback, docs/{ARCHITECTURE, AGENTS, RUNBOOK}, CLAUDE.md project instructions all updated. Historical references deliberately left alone: append-only DECISIONS, handoff/ specs, book ch 10's forensic 2026-04-19 walkthrough. Dashboard hard-codes at lines 343 + 398 deferred to commit 2 (they'd be reabsorbed by the new `nextRunRelative`).

2. **`7ebae47` — cadence-aware `nextRunRelative`.** New [`src/lib/cadence.ts`](../src/lib/cadence.ts) holds five exports: `ALLOWED_INTERVAL_HOURS` (site-side mirror), `parseIntervalHours` (24 fallback), `getIntervalHours(db)` (admin_settings reader), `nextRunAtMs(nowMs, intervalHours)` (forward-scan from next top-of-hour for the first hour matching Director's gate), `nextRunRelative(nowMs, intervalHours)` ("Xh Ym" formatter). Dashboard reads `intervalHours` once at render time (defensive 24 fallback), passes through to the subtitle + pending-state hint + no-runs-in-7-days hint. 14 unit-test cases across `{1,2,3,4,6,12,24}` at two anchor times (`00:38 UTC` + `05:30 UTC`) all pass. Site-side `ALLOWED_INTERVAL_HOURS` duplication deduped: admin settings API imports from cadence.ts now. Agents-side copy at `agents/src/shared/admin-settings.ts` stays separate — cross-worker, no shared imports.

3. **`9d20b81` — `engagement.piece_id`.** Migration 0017 rebuilds the table with PK `(piece_id, course_id, date)` (was `(lesson_id, course_id, date)`). `lesson_id` kept as a plain column for display-compat with admin widgets; piece_id is the new attribution axis. 13 historical rows backfilled via date-join on daily_pieces — 5 unique piece_ids, 0 NULLs after backfill. Snapshot `engagement_backup_20260422` held for 7-day rollback. Writer: rehype-beats reads `pieceId` from MDX frontmatter, injects `data-piece-id` on the auto-generated `<lesson-shell>`; lesson-shell POSTs it to `/api/engagement/track`. Endpoint falls back to a date-based lookup for stale bundles (arbitrary at multi-per-day — acceptable for the edge case; new bundles always send it). Reader path: `LearnerAgent.analyseAndLearn` reads piece_id off the row directly (no more date regex + lookup); `analyse()` GROUP BY piece_id so same-date pieces stay separate. `LessonMetric` + `UnderperformingLesson` interfaces gain `pieceId`. Admin widget query joins daily_pieces on piece_id, sorts by `published_at DESC`. Resolves the "Partial fix at multi-per-day" note in DECISIONS 2026-04-22 "writeLearning persists piece_id" §2.4.

4. **`3208c86` — admin per-piece route → `[date]/[slug]`.** `git mv` of the 845-line `[date].astro` → `[date]/[slug].astro` (92% similarity, history preserved). Resolves piece_id from the content collection entry matched on `(date, slug)`, then scopes per-piece queries: `daily_pieces WHERE id = ?`, `daily_piece_audio WHERE piece_id = ?`, `zita_messages WHERE piece_id = ?`. Day-scoped queries unchanged per Phase 3 walk-back + Phase 6 reasoning (audit_results, pipeline_log, daily_candidates, observer_events all intentionally show "today's pipeline activity"). Breadcrumb adds slug segment; "View on site" link uses `pieceUrl(date, slug)` directly. New `[date]/index.astro` handles legacy URLs: 1 piece → 302 to the slug URL; 2+ pieces (multi-per-day) → disambiguation list sorted by `publishedAt DESC`; 0 pieces → "No piece" display. Admin home uses a new `adminPieceHref(date, pieceId?)` helper backed by a piece_id→slug map from `getCollection('dailyPieces')` with graceful fallback to `{date}/`. zita.astro's deep-link left as `{date}/` — hits the new index.astro which routes correctly. Retry-audio + zita-synthesis trigger buttons still pass `?date=` — existing server handlers already resolve piece_id via `ORDER BY published_at DESC LIMIT 1` which matches the "latest" semantic at multi-per-day. Leaving scope creep off this commit.

5. **`205ce1e` — `reset-today.sh --piece-id`.** Default mode unchanged (full-day reset). New `--piece-id <uuid>` flag scopes the wipe to that piece across 7 piece-id-capable tables (daily_pieces, daily_candidates, audit_results, daily_piece_audio, zita_messages, learnings, engagement). Two piece-id-less tables (pipeline_log — date-keyed per Phase 3 walk-back; observer_events — no piece_id column) use a ±20min `published_at`-centred window, mirroring Learner's `LEARNER_PIPELINE_LOOKBACK_MS/LOOKAHEAD_MS` math for same-reason same-answer (stressed-pipeline tolerance without bleeding into neighbouring same-date pieces). `--retrigger` opt-in flag fires `/daily-trigger` after the wipe (default is wipe-only; single-piece re-run has no natural cron slot at multi-per-day, operator makes the trigger decision explicitly). UUID validation prevents silent-zero-rows DELETE on typos. ADMIN_SECRET only required when a trigger actually fires — a dry wipe-only run works secret-free. RUNBOOK updated with both modes.

**Why in this order.** Dependency-first:
- #1 and #2 are prose + small helpers. No risk. Done first so later commits land in a clean linting/lint-free base.
- #3 (engagement rebuild) is the schema foundation. Later commits #4 + #5 depend on piece_id being on the engagement table (admin widget + reset script both touch it).
- #4 uses the piece_id→slug map (introduced by #3's rehype change) for its link helper.
- #5 uses every piece_id-capable table added across the cadence plan + #3.

**Verification per commit:**
- #1: preview-live dashboard confirmed `each morning` footer + no lingering `2am UTC` anywhere on served pages.
- #2: 14/14 unit-test cases pass in a Node scratch run; preview confirms subtitle + hint + no-runs-state all say "in Xh Ym".
- #3: remote migration applied clean (0017 ✅); 13/13 rows preserved, 5/5 piece_ids populated, 0 NULLs; preview confirms `data-piece-id` attr live on `<lesson-shell>`; engagement POST returns 200 both with and without piece_id in body.
- #4: `pnpm build` clean; `/dashboard/admin/piece/{date}/` + `/{slug}/` + bogus-slug URLs all return 302 to /login (admin gate fires before routing, as designed).
- #5: `bash -n` syntax check passes; `--help` output matches docstring; arg validation rejects missing UUID, malformed UUID, and unknown flags with distinct error messages.

**Non-goals:**
- No touch to `/audio-retry` or `/zita-synthesis-trigger` endpoint signatures — they still accept `?date=` and resolve piece_id via latest-by-date. Close to correct at multi-per-day; changing requires updating site-worker + agents-worker handlers together. Tracked implicitly under "existing latest-by-date heuristic is fine".
- No `daily_candidates.selected` investigation (separate `[open]` FOLLOWUPS since 2026-04-21).
- No change to legacy audit_results + daily_candidates + observer_events admin queries (still date-keyed — intentional day-view per Phase 3 walk-back).
- No `engagement_backup_20260422` drop — held for 7-day rollback window, queued as new FOLLOWUPS for 2026-04-29.

**Flip status:** unchanged. Production cadence stays `interval_hours=24`. The five-commit wrap takes the FOLLOWUPS list from 5 `[open]` → 0 `[open]` + 1 new snapshot-drop entry. No new open correctness blockers. Every cosmetic and attribution-at-multi-per-day gap from the cadence plan is now closed.

**References:** commits `19910d7`, `7ebae47`, `9d20b81`, `3208c86`, `205ce1e`. FOLLOWUPS entries 1–5 of 2026-04-22 all resolved; FOLLOWUPS "Drop `engagement_backup_20260422` snapshot" queued for 2026-04-29.

---

## 2026-04-22: `writeLearning` persists `piece_id` — last multi-per-day correctness blocker resolved

**Context:** The FOLLOWUPS entry surfaced during Phase 6 scoping — `writeLearning(…, pieceDate)` wrote `learnings.piece_date` but not `learnings.piece_id`, so the made-drawer's per-piece "What the system learned" section queried `WHERE piece_date = ?` and would pool learnings across same-date pieces at multi-per-day cadence. The only blocker listed in CLAUDE.md's cadence-plan top status between "Phases 1-6 shipped" and "admin can safely flip `interval_hours<24`."

**Decision:** extend `writeLearning` to take `pieceId` as an 8th required arg, thread it through all four callers + the Director schedule payloads, add `pieceId: z.string()` to the content collection schema, backfill the 5 existing MDX files, teach Director to splice `pieceId` into frontmatter at publish time (alongside the existing `voiceScore` + `publishedAt` splices), teach MadeBy / made-drawer / the `/api/daily/[date]/made` endpoint to pass and filter by `piece_id` when present. Fall back to `piece_date` in the API when `pieceId` query param is absent — defensive, since all 5 existing pieces now have `pieceId` in frontmatter.

**Six changes:**

**1. `writeLearning` signature** — 8th parameter `pieceId: string`. Defensive check refuses INSERT if pieceId is null/empty/non-string (same shape as existing checks for source + pieceDate). INSERT writes to `learnings.piece_id` column added in migration 0014 (previously nullable; still nullable at schema level, but every new row from this commit onwards has it populated by the writer). `logMissingField`'s union widened to include `'piece_id'`.

**2. Four callers updated:**
- `Learner.analysePiecePostPublish` (producer-synth) — already had `pieceId` in signature post-Phase-6-blocker-#3. Pass to writeLearning.
- `Learner.analyseZitaPatternsDaily` (Zita synth) — already had `pieceId` post-Phase-6. Pass through.
- `Drafter.reflect` — signature extended `reflect(brief, mdx, date)` → `reflect(brief, mdx, date, pieceId)`. Director's `reflectOnPieceScheduled` payload gains `pieceId`; the schedule call at publish time passes the captured UUID.
- `Learner.analyseAndLearn` (reader-engagement) — no piece_id in scope at call time. Resolves via `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1`. **Partial fix at multi-per-day** — picks an arbitrary same-date piece when multiple exist. Engagement attribution correctness at multi-per-day would need a separate `engagement.piece_id` column + lesson-shell writer update; out of scope here. Documented in FOLLOWUPS comment and code.

**3. Director splices `pieceId` into frontmatter at publish time.** Right after the existing `publishedAt` splice, same regex pattern. `pieceId = crypto.randomUUID()` moved to the top of the frontmatter-splice block (was declared just before the daily_pieces INSERT) so both the splice and the INSERT use the same value. `publishedAtMs` moved up alongside for the same symmetry.

**4. Content collection schema** — `pieceId: z.string()` required (not optional). All 5 existing MDX files backfilled with their prod D1 UUIDs in the same commit. Build validation proves all 5 pass the new schema before any runtime sees the change.

**5. 5 MDX frontmatter backfills** — one line each: `pieceId: "<uuid>"`. UUIDs pulled from session memory of prod D1 reads (2026-04-21). Metadata carve-out under the permanence rule (same precedent as `publishedAt`, `voiceScore`, `audioBeats`, `beatTitles`, `qualityFlag`).

**6. Made-drawer end-to-end:**
- `src/components/MadeBy.astro` — accepts `pieceId: string` prop; passes as `data-piece-id` HTML attribute.
- `src/pages/daily/[date]/[slug].astro` — passes `piece.data.pieceId` to MadeBy.
- `src/interactive/made-drawer.ts` — reads `data-piece-id` attr; appends `?pieceId=<uuid>` to the fetch URL when present.
- `src/pages/api/daily/[date]/made.ts` — accepts `?pieceId=` query param; learnings SELECT uses `WHERE piece_id = ?` when provided; falls back to `WHERE piece_date = ?` when absent (defensive — in practice every piece from this commit has pieceId).

**Why not piece-id-filter every section, only learnings?** The made-drawer also renders timeline (pipeline_log), audit rounds (audit_results), candidates (daily_candidates), and audio (daily_piece_audio). Per Phase 3 walk-back + Phase 6 reasoning, the pipeline_log + daily_candidates sections are legitimately day-view at multi-per-day ("today's pipeline activity" + "today's candidate pool before Curator picked"). daily_piece_audio is already piece-id scoped post-Phase-1 but filtered here by date for the same day-view shape. Audit_results is keyed by `task_id` which encodes date — same. Only learnings had the specific cross-piece-leakage bug this commit fixes; extending the filter to all four would be scope creep with no correctness payoff at 1/day and a mixed story at multi/day.

**Regex for pieceId query param validation** — `/^[0-9a-f-]{32,40}$/i`. Matches UUID v4 shape (36 chars with hyphens) with slack for alternative encodings. Defensive — a bad pieceId param falls back to the piece_date query instead of hitting D1 with garbage.

**Non-goals:**
- No `engagement.piece_id` column — reader-path attribution at multi-per-day is a separate FOLLOWUPS item (the one this entry references). Partial-fix semantics documented in Learner code comment.
- No change to the other made-drawer sections (pipeline, audits, candidates, audio). Day-view semantics preserved.
- No migration. `learnings.piece_id` column has been present since migration 0014; only the writer path and reader filter change here.

**Verified:**
- Agents TypeScript check clean (18 pre-existing SubAgent errors unchanged).
- `pnpm build` produces all 5 pages at the new URL shape with the new `pieceId` field required — all 5 MDX pass the schema.
- Preview verified: made-drawer `data-piece-id` attr populated, `/api/daily/[date]/made?pieceId=<uuid>` filters correctly (seeded a test row with matching piece_id, confirmed it returns only under the matching param and under the no-param fallback, not under a non-matching piece_id).

**Flip status:** with this commit, `interval_hours` can be flipped below 24 without any known correctness blockers. The made-drawer's per-piece learnings section will display scoped data at multi-per-day. The `engagement.piece_id` attribution gap remains open but doesn't surface in any current reader view (engagement writes are consumed by Learner's reader-path only).

**References:** [agents/src/shared/learnings.ts](../agents/src/shared/learnings.ts), [agents/src/learner.ts](../agents/src/learner.ts), [agents/src/drafter.ts](../agents/src/drafter.ts), [agents/src/director.ts](../agents/src/director.ts), [src/content.config.ts](../src/content.config.ts), [src/components/MadeBy.astro](../src/components/MadeBy.astro), [src/pages/daily/[date]/[slug].astro](../src/pages/daily/[date]/[slug].astro), [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts), [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts), FOLLOWUPS 2026-04-21 "writeLearning doesn't persist piece_id" (resolved by this commit).

---

## 2026-04-21: Multi-piece cadence — Phase 6 Zita synthesis timing + piece_id scoping

**Context:** Phase 6 "downstream adaptation" from the plan. Scoped tightly to the items that break at the multi-per-day interval flip:

- **Zita synthesis timing** — was an absolute clock target (01:45 UTC day+1) that would have stacked N pieces' synth jobs on one clock at multi-per-day AND given same-date afternoon pieces only a partial reader window. Fixed.
- **Zita synthesis scoping** — `analyseZitaPatternsDaily(date)` queried `zita_messages WHERE piece_date = ?` and `daily_pieces WHERE date = ?`. At multi-per-day both pooled across pieces sharing a date. Fixed.
- **Scanner / Curator** — audited and found **no change needed.** `getRecentDailyPieces(30)` already uses `WHERE date >= <30d-ago>` which includes today's pieces. Curator's prompt already says "avoid repetition" against that list. At multi-per-day, today's prior picks are already in the avoidance list — the concern from the original plan briefing turned out to already be handled. No code change.

**Decisions:**

**1. Zita synth fires at relative delay `publish + 23h45m` (= 85500s).** Was `Date.UTC(y, m, d+1, 1, 45)` absolute. Same ~24h window regardless of publish time. At multi-per-day, each piece's synth fires at its own publish+23h45m mark — N pieces → N independent alarm targets, no stacking. At the tightest cadence (1h), synths are separated by 1h each, well within the SDK's alarm queue behaviour.

**2. `analyseZitaPatternsDaily(date)` → `analyseZitaPatternsDaily(pieceId, date)`.** piece_id primary; date retained for result-shape compatibility (the return value still carries `date` for observer event logging). `zita_messages` filter switches to `WHERE piece_id = ?` (column was 100% backfilled during Phase 1). `daily_pieces` filter switches to `WHERE id = ? LIMIT 1`.

**3. Director's `analyseZitaPatternsScheduled` payload gains `pieceId`.** Threaded through from `triggerDailyPiece`'s captured piece_id (same variable that was added for the audio pipeline in Commit 2 of the multi-per-day blocker sequence).

**4. Server's `/zita-synthesis-trigger` endpoint resolves `piece_id` from `?date=...`.** Same pattern as `/audio-retry` — admin UI still hits with date, endpoint looks up piece_id via `daily_pieces ORDER BY published_at DESC LIMIT 1`. At multi-per-day this picks the latest piece for that date, matching the "trigger the most recent" shape.

**Why 85500s (23h45m) and not 86400s (24h).** Leaves a 15-minute margin before the next day's equivalent-slot pipeline would start. At interval_hours=24 (current prod), the 02:00 UTC cron fires the pipeline — synth at publish+23h45m lands at roughly 01:45-02:00 UTC day+1, before the next pipeline starts, mirroring the original absolute-clock intent. At multi-per-day (1h), synths are decoupled from the cron entirely — the 15-min margin doesn't matter, but the number stays the same so behaviour at 24h cadence is unchanged from the absolute-clock version.

**Scanner/Curator audit (no change):** `getRecentDailyPieces(30)` at [`agents/src/director.ts`](../agents/src/director.ts) currently returns headlines from `daily_pieces WHERE date >= <since>` where `since` is 30 days back from now. At multi-per-day with piece A published at 02:00 UTC and Curator running at 06:00 UTC, A's row has `date = today` and matches the `>= <30-days-ago>` bound. Curator's prompt at [`agents/src/curator-prompt.ts`](../agents/src/curator-prompt.ts) labels this list "Already published in last 30 days (avoid repetition)" — the label is slightly misleading at multi-per-day (today IS in the list), but the substantive guidance ("avoid repetition") still applies correctly. Label rewording is Phase 7 cosmetic, not a correctness issue.

**Touched files:**
- [`agents/src/director.ts`](../agents/src/director.ts) — `triggerDailyPiece` zita schedule (relative delay + pieceId in payload); `analyseZitaPatternsScheduled` accepts pieceId.
- [`agents/src/learner.ts`](../agents/src/learner.ts) — `analyseZitaPatternsDaily(pieceId, date)` signature + both SELECT updates.
- [`agents/src/server.ts`](../agents/src/server.ts) — `/zita-synthesis-trigger` resolves pieceId from date before invoking Director.

**Non-goals (deferred):**
- **writeLearning piece_id extension** — new follow-up surfaced while scoping this. `writeLearning(db, category, observation, evidence, confidence, source, pieceDate)` writes `learnings.piece_date` but not `learnings.piece_id`. At multi-per-day the made-drawer's `WHERE piece_date = ?` query pools learnings across same-date pieces. Cross-cutting fix (4 callers: producer-synth, reflect, reader-learn, zita-synth). New FOLLOWUPS entry. Not bundled into this commit.
- **"Days running" stat rename.** Cosmetic at multi-per-day. Phase 7.
- **Observer dashboard grouping by piece_id.** UX polish. Phase 7.
- **`scripts/reset-today.sh --piece-id` flag.** Operational tool. Phase 7.
- **Zita synth run frequency at multi-per-day.** One synth per piece means 24 Claude calls/day at the tightest cadence vs 1/day today. Acceptable — each guarded by the ≥5 user-msgs threshold which most pieces will fail until reader traffic grows. If spend becomes a concern, revisit.

**Verification:**
- Agents TypeScript check clean on touched files. 18 pre-existing SubAgent DurableObjectStub errors in server.ts unchanged.
- Next pipeline run schedules Zita synth at `publish + 85500s`. Observer event `Zita synthesis (metered)` fires at that offset, not at 01:45 UTC absolute.
- At multi-per-day flip: two pieces on the same date get two independent synth alarms; Learner queries zita_messages by piece_id so each synthesis sees only its own piece's conversations.

**References:** [agents/src/director.ts](../agents/src/director.ts), [agents/src/learner.ts](../agents/src/learner.ts), [agents/src/server.ts](../agents/src/server.ts), plan file `~/.claude/plans/could-please-do-a-harmonic-waffle.md` §6 Phase 6, DECISIONS 2026-04-21 "P1.5 Learner skeleton" (original absolute-clock rationale that this walks back for multi-per-day).

---

## 2026-04-21: Multi-piece cadence — Phase 5 admin settings UI

**Context:** Phase 5 of the cadence plan. With blockers #1 #2 #3 resolved (commits `ecedb87` + `900905d` + `30ddbdd`), flipping `interval_hours` below 24 is architecturally safe. Phase 5 ships the admin-facing knob.

**Decision:**

1. **New admin page** [`src/pages/dashboard/admin/settings.astro`](../src/pages/dashboard/admin/settings.astro) — ADMIN_EMAIL-gated (standard admin redirect pattern), dropdown populated from `ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24]` (divisors of 24; non-divisors rejected for the rhythm-drift reason documented in Phase 1 decision #4). Shows current value + `updated_at` timestamp read from `admin_settings` at render time. Select option labels describe each choice — e.g. `4h — 6 pieces per day · every 4 hours` — so the operational meaning is visible inline without a separate legend.

2. **New API endpoint** [`src/pages/api/dashboard/admin/settings.ts`](../src/pages/api/dashboard/admin/settings.ts) exposes GET + POST, both ADMIN_EMAIL-gated (401 otherwise, matching the `observer.ts` precedent).
   - GET returns `{interval_hours, updated_at, allowed_intervals}`.
   - POST validates `body.interval_hours` against the allowed set (400 otherwise), upserts `admin_settings` via `INSERT … ON CONFLICT(key) DO UPDATE`, and fires an `admin_settings_changed` observer_event with `{type, key, prior, next, changedBy, changedAt}` context. Prior value captured BEFORE the UPSERT so the event shows the full transition. Uses the existing [`src/lib/observer-events.ts`](../src/lib/observer-events.ts) helper (Phase 2 site-worker → observer_events writer).

3. **Navigation** — new "Settings →" link in top-right of [`src/pages/dashboard/admin.astro`](../src/pages/dashboard/admin.astro), alongside the existing "Zita activity →" link. Consistent pattern for admin subsections.

4. **No CSRF token.** Matches the existing `/api/dashboard/observer` POST handler (which also lacks CSRF). The same-site cookie gating via admin-session is the current boundary. If the admin API set a CSRF pattern later, this endpoint inherits it at that time.

**`ALLOWED_INTERVAL_HOURS` duplication (deliberate).** The agents worker ([`agents/src/shared/admin-settings.ts`](../agents/src/shared/admin-settings.ts)) and the site worker (this new endpoint) don't share imports — two separate packages. The constant is copied into both. Defensive layers handle drift:
- POST validates against the site-side set (rejects out-of-set values).
- Agents-side `parseIntervalHours` falls back to 24 for anything not in the agents-side set.
- So a drift fails safe — it either blocks the admin write, or silently reverts to 24 at Director read time. Neither silently runs at an unintended cadence.

A comment in the endpoint flags this coupling explicitly so a future audit doesn't miss one side.

**Why the 1-1-1 triangle (read on mount, write on submit, read back on save) instead of an optimistic-update flow.** The page re-displays the server-returned `interval_hours` + `updated_at` values after POST success. This confirms to the operator what actually got written — if the write partially fails or a bug returns a different value than what was submitted, the UI reflects reality rather than the optimistic hope. At one-per-day admin usage the server round-trip is imperceptible.

**Audit trail design.** The `admin_settings_changed` event severity is `info`, not `warn` — this is expected admin behaviour, not an anomaly. The event body spells out prior → next + the changed-by email + the "effective next hourly cron alarm (up to 1h from now)" expectation so operators reading the Observer feed later see what happened AND when it took effect without cross-referencing other tables.

**Verified (build + preview):**
- `pnpm build` clean; the new page + endpoint are in the server bundle.
- Unauth'd GET /api/dashboard/admin/settings → 401. Unauth'd POST → 401. Unauth'd page → 302 to `/login/?redirect=…` (via `Astro.redirect`).
- Build's prerender step still renders the existing 5 daily pieces at their new nested slug URLs (Phase 4 still intact).

**Non-goals:**
- No validation of "is the value safe to flip NOW." The 3 blockers that would have made this unsafe are all resolved pre-Phase-5. If a future change reintroduces a multi-per-day risk, re-add a block here.
- No UI warning banner when admin picks a value other than 24. Nothing currently breaks at other values — blockers are clear.
- No historic log of cadence changes on the Settings page itself. The Observer feed at `/dashboard/admin/` already shows them (with full prior→next detail in the event context), so a second view would be redundant.
- No change to the `/dashboard/admin/piece/[date]/` route's date-keyed URL. That's a separate Phase 5/6 concern for admin UX at multi-per-day; reader-facing URLs are already piece-scoped post-Phase-4.
- No new migration. `admin_settings` table already exists from Phase 2 (migration 0016).

**Post-deploy verification contract** (real-world, authenticated):
- Admin visits `/dashboard/admin/settings/` → page renders dropdown with current value selected.
- Admin picks 4h and clicks Save → status line reads "Saved. Effective next hourly cron alarm (up to 1h)."
- `SELECT * FROM admin_settings WHERE key = 'interval_hours'` on remote D1 shows value='4' with fresh `updated_at`.
- `SELECT * FROM observer_events WHERE json_extract(context, '$.type') = 'admin_settings_changed' ORDER BY created_at DESC LIMIT 1` shows the change event with prior='24', next='4', `changedBy` = admin email.
- Next hourly cron alarm at 02:00/06:00/10:00/14:00/18:00/22:00 UTC fires the pipeline (gate: `(hour-2+24)%4 === 0`), other hours silent-bail.

**References:** [src/pages/dashboard/admin/settings.astro](../src/pages/dashboard/admin/settings.astro), [src/pages/api/dashboard/admin/settings.ts](../src/pages/api/dashboard/admin/settings.ts), [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro) (top-right nav link), [agents/src/shared/admin-settings.ts](../agents/src/shared/admin-settings.ts) (mirror of ALLOWED_INTERVAL_HOURS), [src/lib/observer-events.ts](../src/lib/observer-events.ts) (observer writer), DECISIONS 2026-04-21 "Multi-piece cadence — Phase 1 identity foundations" §4 (interval-hours constraint rationale), plan file `~/.claude/plans/could-please-do-a-harmonic-waffle.md` §6 Phase 5.

---

## 2026-04-21: Scope Learner synthesis input by time window (multi-per-day unblock, #3 — final)

**Context:** Commit 3 of 3. Completes the multi-per-day unblock sequence from Phase 3's pipeline_log consumer audit. [`agents/src/learner.ts:338`](../agents/src/learner.ts) ran `SELECT … FROM pipeline_log WHERE run_id = ? .bind(date)` to feed Claude's producer-learning synthesis. At 1 piece/day, pipeline_log for a date = exactly one run. At multi-per-day it pooled all that day's pieces' steps → synthesis for piece A saw piece B/C/D's candidate picks, audit rounds, etc. Noise that corrupts the learning output.

**Boundary question:** how to filter "just this piece's pipeline rows" without breaking the run_id walk-back (which keeps `run_id = YYYY-MM-DD` and rejects a piece_id column on pipeline_log for one consumer).

**Options considered:**
1. Add `pipeline_log.piece_id` column. Cleanest filter. Conflicts with the run_id walk-back (one consumer ≠ schema axis).
2. Time-window filter via `daily_pieces.published_at`.
3. Read `pipeline_log.data` JSON for identity markers. Not all rows identify which piece they belong to.
4. Skip pipeline_log entirely, use piece's own MDX. Loses real signal (audit rounds, candidates skipped vs picked, revisions required).

**Decision (implemented):** Option 2. Time-window filter.

**Implementation:**

1. **Signature change** — `analysePiecePostPublish(date)` → `analysePiecePostPublish(pieceId, date)`. piece_id primary; date carried only for the pipeline_log `run_id` match. Caller at Director (`analyseProducerSignalsScheduled`) payload gains `pieceId` — flowed from the `crypto.randomUUID()` captured at daily_pieces INSERT time (Commit 2 already did this capture).
2. **daily_pieces SELECT** switches from `WHERE date = ? LIMIT 1` to `WHERE id = ? LIMIT 1`. At multi-per-day the date-keyed version would have picked an arbitrary piece; piece-id-keyed pulls the specific piece.
3. **pipeline_log SELECT** gains `AND created_at BETWEEN ? AND ?` with `[piece.published_at - 600_000, piece.published_at + 600_000]`. 10min pre-publish + 10min post-publish = 20min total. Fallback to unbounded window when `published_at IS NULL` (legacy pre-Phase-4 rows).
4. **Two constants** at top of [`agents/src/learner.ts`](../agents/src/learner.ts): `LEARNER_PIPELINE_LOOKBACK_MS = 600_000`, `LEARNER_PIPELINE_LOOKAHEAD_MS = 600_000`. Named so future adjustment is a single-edit change.

**Why 20min total window (not 6min as originally drafted).** Zishan's stress-case pushback: pipelines are ~2min nominal but can exceed 5min under Anthropic API latency spikes, ElevenLabs retry storms, or DO alarm re-dispatch. A 6min window works at happy-path latency and silently truncates under stress — the exact silent-data-loss shape we were trying to prevent with this change. 20min is ~4x the observed-under-stress worst case. Gap between two runs at `interval_hours=1` is 60min, so 20min still leaves 40min safety margin on both sides. Generous wins over tight here.

**Why not Option 1 (pipeline_log.piece_id column).** Same discipline as the run_id walk-back: adding a piece_id column for one consumer is exactly the pattern that caused the 2026-04-21 regression. If a second or third consumer emerges needing per-piece pipeline filtering, revisit.

**Why keep the date argument on the signature.** pipeline_log is keyed by `run_id = date`. Filtering by piece_id on pipeline_log isn't possible (no column, by deliberate choice). The time-window filter needs both the date (to match run_id) and the piece's publishedAt (to bound created_at). Two values, two parameters.

**Touched files:**
- [`agents/src/learner.ts`](../agents/src/learner.ts) — constants, signature change, two SELECT updates.
- [`agents/src/director.ts`](../agents/src/director.ts) — `analyseProducerSignalsScheduled` payload gains `pieceId`; the schedule call at publish time passes it; internal call to `learner.analysePiecePostPublish(pieceId, date)`.

**Non-goals:**
- No change to `analyseZitaPatternsDaily` (the Zita-source Learner path) or `reflect` (Drafter self-reflection). Those scope by piece_date (zita) or filePath (reflect) already. Revisit if they grow the same date-pooling bug at multi-per-day.
- No retrospective re-run of Learner on historical pieces. The 5 existing pieces' synthesis ran under pre-fix semantics when only one piece existed per date.
- No new schema.

**Verification:**
- Agents TypeScript check clean on both touched files. 18 pre-existing SubAgent DurableObjectStub errors in server.ts unchanged.
- At 1 piece/day (tonight's cron): time-window filter returns same rows as the old run_id filter because pipeline starts + publishes fit well inside the 20-min window.
- At multi-per-day (when admin flips): time-window filter returns only the target piece's rows, excluding neighbouring pieces on the same date.

**Sequence closure:** blockers #1 (pre-run DELETE removed in `ecedb87`), #2 (audio pipeline piece_id scoping in `900905d`), and #3 (this commit) all land. FOLLOWUPS entry "Unblock multi-per-day flip" marked resolved. Phase 5 (admin UI for interval flip) can ship next with no restrictions on the dropdown.

**References:** [agents/src/learner.ts](../agents/src/learner.ts), [agents/src/director.ts](../agents/src/director.ts) (`analyseProducerSignalsScheduled` + the schedule call in `triggerDailyPiece`), FOLLOWUPS 2026-04-21 "Unblock multi-per-day flip — pre-run DELETEs + Learner input scoping" (item #3 and the entry overall now resolved).

---

## 2026-04-21: Scope audio pipeline state per piece_id (multi-per-day unblock, #2 + R2 key fix)

**Context:** Commit 2 of the 3-blocker sequence. Phase 3's audit flagged [`director.ts:783`](../agents/src/director.ts) — `retryAudioFresh(date)` issued `DELETE FROM pipeline_log WHERE run_id = ? AND step LIKE 'audio%'` keyed by date. At 1 piece/day this correctly wipes "today's audio retry" state. At multi-per-day the same DELETE wipes across all pieces that share a date. Blocked the admin interval flip.

**Plus a fourth blocker found while scoping this one.** The audio producer at [`agents/src/audio-producer.ts`](../agents/src/audio-producer.ts) wrote to R2 at `audio/daily/{brief.date}/{beat.name}.mp3` — date-scoped, not piece-scoped. Two pieces sharing a date have overlapping beat names (every piece has a "hook" beat) that would silently overwrite each other in R2. Same multi-per-day blocker theme — fixed in the same commit.

**Plus a latent critical bug caught while reading the code.** `persistBeatRow` at [`agents/src/audio-producer.ts`](../agents/src/audio-producer.ts) INSERTed `(date, beat_name, r2_key, …)` — but Phase 1's migration 0015 rebuilt `daily_piece_audio` with PK `(piece_id, beat_name)` + `piece_id TEXT NOT NULL`. The INSERT without a `piece_id` binding would have hit a NOT NULL violation on EVERY new piece's audio generation. No piece has run through the pipeline since Phase 1 landed earlier today — existing 5 pieces hit R2 head-check before the INSERT, so the bug was latent. Tonight's 02:00 UTC cron would have been the first to trip it. Unblocking audio generation going forward was a bigger motivator for this commit than the multi-per-day story it was scoped for.

**Five decisions (now implemented):**

**1. `retryAudioFresh` takes a `piece_id`, not a `date`.** Signature changed `retryAudioFresh(date: string)` → `retryAudioFresh(pieceId: string)`. Same for `retryAudio(date)` → `retryAudio(pieceId)`. Both validate the incoming string matches the UUID v4 shape. `retryAudio` derives `date` internally from `daily_pieces WHERE id = ?`. The site worker's `/audio-retry` endpoint still accepts `?date=...` from the admin UI but now looks up piece_id from `daily_pieces` (`ORDER BY published_at DESC LIMIT 1` — at multi-per-day picks the most recent piece for the date, which matches the "retry the latest" intent).

**2. `daily_piece_audio` is the single source of truth for piece audio state.** Post-Phase-1 the table's PK is `(piece_id, beat_name)`. Retry-fresh iterates `daily_piece_audio WHERE piece_id = ?`, calls `AUDIO_BUCKET.delete(row.r2_key)` for each stored r2_key verbatim, then `DELETE FROM daily_piece_audio WHERE piece_id = ?`. `r2_key` holds the full path used at generation time — no path reconstruction. Works for both legacy and new-format keys.

**3. R2 key structure gains a piece_id component going forward.** New format: `audio/daily/{date}/{piece_id}/{beat_name}.mp3`. The 5 existing pieces' R2 objects stay at the old 1-level path (`audio/daily/{date}/{beat}.mp3`) — no rename, no re-upload (permanence rule). `daily_piece_audio.r2_key` records the full path per-row, so the audio delivery layer must tolerate both shapes permanently. See the "Dual-path read contract" below.

**Dual-path read contract — permanent.** The audio-serving path must tolerate BOTH key shapes forever: `audio/daily/{date}/{beat}.mp3` for the 5 legacy pieces, `audio/daily/{date}/{piece_id}/{beat}.mp3` for everything from this commit onwards. The `daily_piece_audio.r2_key` column is authoritative per-row; no code should reconstruct paths from `(date, beat_name)` tuples. Called out explicitly so a future audit of `/audio/*` routing or R2 binding logic doesn't assume a single-shape world and break the legacy pieces.

**4. Removed the `DELETE FROM pipeline_log` from retry-fresh entirely.** Audio-step pipeline_log rows stay as append-only audit history. Admin view dedups by newest-wins; a fresh retry fires new `audio-*` step rows that naturally supersede the old failed attempt's rows in any "current state" query. Resolves the multi-per-day blocker with zero data loss.

**5. No schema change.** Migrations 0014/0015 already established `daily_piece_audio.piece_id` NOT NULL. This commit is code-only on top of the existing schema. The latent `persistBeatRow` bug documented above is fixed by threading `pieceId` through the audio brief (`AudioBrief.pieceId`, `AudioAuditBrief.pieceId`) and the call chain (`triggerDailyPiece` captures the UUID before INSERT → schedules `runAudioPipelineScheduled({pieceId, date, …})` → `runAudioPipeline(pieceId, date, …)` → `generateAudioChunk({pieceId, date}, …)` / `auditor.audit({pieceId, date})` → `persistBeatRow(pieceId, date, beat)` INSERTs with piece_id in the `(piece_id, beat_name, date, …)` column order).

**Touched files:**
- [`agents/src/audio-producer.ts`](../agents/src/audio-producer.ts) — `AudioBrief` adds `pieceId`; r2Key gets piece_id subdirectory; prior-request-id SELECT + COUNT switch to `WHERE piece_id = ?`; `persistBeatRow(pieceId, date, beat)` INSERTs piece_id.
- [`agents/src/audio-auditor.ts`](../agents/src/audio-auditor.ts) — `AudioAuditBrief` adds `pieceId`; `loadRows(pieceId)` filters by piece_id.
- [`agents/src/director.ts`](../agents/src/director.ts) — piece_id captured into local var before `daily_pieces` INSERT; threaded through audio schedule payload, `runAudioPipelineScheduled`, `runAudioPipeline`, `retryAudio`, `retryAudioFresh`; audio-publisher SELECT + has_audio UPDATE switch to piece_id.
- [`agents/src/server.ts`](../agents/src/server.ts) — `/audio-retry` endpoint looks up piece_id from `daily_pieces WHERE date = ? ORDER BY published_at DESC LIMIT 1` before invoking the Director RPC.

**Non-goals (deferred):**
- No Learner-side piece_id threading (blocker #3, next commit).
- No frontend change to the admin retry button. It still POSTs `?date=...`; server-side lookup handles the conversion to piece_id. If admin UX gains a "retry a specific piece" control at multi-per-day, the endpoint can accept `?pieceId=...` as an alternative.
- No re-upload of the 5 legacy pieces' R2 objects to the new nested path. Their `daily_piece_audio.r2_key` values record the old path verbatim.

**Verification:**
- Agents TypeScript check clean on all four touched files. 18 pre-existing SubAgent DurableObjectStub errors in server.ts unchanged.
- Next 02:00 UTC cron fire is the runtime smoke test — piece gets a UUID, audio persists with piece_id populated, R2 key lands at the new nested path.
- Retry-fresh at 1/day: admin hits the button with date, endpoint resolves piece_id, RPC wipes that piece's audio and delegates to retryAudio. Legacy pieces' retry would delete old-format R2 keys via the stored r2_key column — exercising the dual-path contract.

**References:** [agents/src/audio-producer.ts](../agents/src/audio-producer.ts), [agents/src/audio-auditor.ts](../agents/src/audio-auditor.ts), [agents/src/director.ts](../agents/src/director.ts), [agents/src/server.ts](../agents/src/server.ts), [migrations/0015_daily_piece_audio_piece_id_pk.sql](../migrations/0015_daily_piece_audio_piece_id_pk.sql) (schema that made this necessary), FOLLOWUPS 2026-04-21 "Unblock multi-per-day flip" (items #2 and #4 resolved by this commit).

---

## 2026-04-21: Remove pre-run `pipeline_log` DELETE (multi-per-day unblock, #1)

**Context:** Commit 1 of the 3-blocker sequence flagged by Phase 3's pipeline_log consumer audit. [`director.ts:109`](../agents/src/director.ts) ran `DELETE FROM pipeline_log WHERE run_id = ? .bind(today)` at the top of `triggerDailyPiece`. At 1 piece/day the DELETE correctly clears stale rows from an earlier interrupted attempt on the same date. At multi-per-day (admin flipping `interval_hours` below 24) the same DELETE wipes all earlier completed runs' pipeline_log history from the same date when a new run starts — silent audit-trail loss.

**Decision:** Remove the DELETE entirely. `pipeline_log` accumulates append-only.

**Why:**
- Storage cost is negligible. At the tightest cadence (`interval_hours=1`), ~20-30 rows per piece × 24 pieces/day = ~480-720 rows/day, ~15-22k rows/month. Small TEXT + JSON rows in D1.
- The "stale interrupted attempt" concern at 1/day is already covered by the `WHERE date=? existing` guard a few lines up in `triggerDailyPiece`: a run won't fire if today's piece exists. If a prior attempt crashed without INSERTing into `daily_pieces`, its pipeline_log rows stay as honest forensic history of the crash rather than being silently erased on the next attempt.
- Manual wipe path stays at `scripts/reset-today.sh` for operators who want to reset a day.
- Admin view ([`dashboard/admin.astro:136-141`](../src/pages/dashboard/admin.astro)) already dedups via "last step per run_id via `WHERE created_at = MAX(...)`" pattern — accumulated rows don't pollute the live pipeline monitor.

**What changed:** One line removed + the comment above it. `triggerDailyPiece` now flows directly from the existence guard into the cadence-config read (Phase 2's `getAdminSetting` call).

**Verification contract:**
- Next 02:00 UTC cron run fires, produces a piece, pipeline_log gets ~19-31 new rows for that date. The 5 historical run_ids (2026-04-17 → 2026-04-21) stay intact.
- `SELECT COUNT(*) FROM pipeline_log` grows monotonically from this point forward. No DELETE path except the explicit `scripts/reset-today.sh`.

**Non-goals for this commit:**
- No changes to `retryAudioFresh`'s audio-step pipeline_log DELETE (that's blocker #2, own commit next).
- No changes to Learner's pipeline_log SELECT (that's blocker #3, own commit after).

**References:** [agents/src/director.ts](../agents/src/director.ts) (pre-run DELETE removed), FOLLOWUPS 2026-04-21 "Unblock multi-per-day flip — pre-run DELETEs + Learner input scoping" (item #1 of 3 resolved by this commit).

---

## 2026-04-21: Multi-piece cadence — Phase 4 URL routing + `publishedAt` tiebreaker

**Context:** Phase 4 of the cadence plan. Readers' daily-piece URLs shift from `/daily/YYYY-MM-DD/` to `/daily/YYYY-MM-DD/slug/` so multiple pieces can coexist on the same date. Phase 1 decision #1 (URL option B, nested) + refinement 1 (no 301 redirect layer — dev phase, 5 pieces, no bookmarks). The homepage hero and library lists pick up a `publishedAt DESC` tiebreaker so same-date pieces sort deterministically.

**Decision:** four concrete changes, no new migration.

1. **New nested route** [`src/pages/daily/[date]/[slug].astro`](../src/pages/daily/[date]/[slug].astro) replaces the old flat `[date].astro`. `getStaticPaths` emits `{date, slug}` tuples; slug derives from `entry.id` (Astro's filename-without-extension) via [`src/lib/slug.ts`](../src/lib/slug.ts) `deriveSlug(entryId)` which strips the 11-char `YYYY-MM-DD-` prefix. At 5 existing pieces this produces the same filename-encoded slug that Director has been generating at publish time since launch (`brief.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)`).

2. **`publishedAt: z.number()`** added to the content-collection schema. 5 existing MDX frontmatters backfilled with their `daily_pieces.published_at` values from D1 — single-line `publishedAt: <ms>` additions under the metadata carve-out (same precedent as `voiceScore`, `audioBeats`, `beatTitles`, `qualityFlag`). Going forward, Director splices `publishedAt: Date.now()` into frontmatter at publish time alongside the existing `voiceScore` splice. The same `publishedAtMs` local variable feeds both the frontmatter splice AND the `daily_pieces` INSERT binding — the two sources of truth agree to the millisecond.

3. **Homepage + library sort** switches from `b.data.date.localeCompare(a.data.date)` to a two-step comparator: date DESC, then `publishedAt` DESC tiebreaker. At 1 piece/day the tiebreaker never fires; at multi-per-day it gives deterministic newest-first ordering. Applied to [`src/pages/index.astro`](../src/pages/index.astro), [`src/pages/daily/index.astro`](../src/pages/daily/index.astro), [`src/pages/library/index.astro`](../src/pages/library/index.astro).

4. **Admin "View on site" link** ([`src/pages/dashboard/admin/piece/[date].astro`](../src/pages/dashboard/admin/piece/[date].astro:346)) updated to use `pieceUrl(date, deriveSlug(entry.id))`. The admin page is server-rendered (`prerender = false`) so a fresh `getCollection('dailyPieces')` call at request time finds the matching entry by date. At multi-per-day cadence the current code picks the first match — admin surface itself still keyed by date, pending Phase 5 rework when the interval flips.

**Why derive slug from `entry.id` instead of a frontmatter `slug` field.** The slug is already determined by the filename convention Director writes at publish time. Adding an explicit `slug` frontmatter field would be duplication with drift risk: if Drafter and the filename fall out of sync, which wins? Derivation from `entry.id` makes the filename authoritative. Future slug-refinement work (e.g., short-slug Phase 7 item) can add an override field without changing today's derivation.

**Why no 301 redirect for the 5 legacy URLs.** Per Zishan, dev phase, 5 pieces, no bookmarks. Adding a redirect worker-route would be real infrastructure for a concern we don't have. The 5 legacy URLs (`/daily/2026-04-17/` through `/daily/2026-04-21/`) return 404 after this deploy.

**Why add `publishedAt` to frontmatter instead of joining D1 at build time.** Astro static-site generation runs at build time, not request time. The site worker has a D1 binding but it's a request-time resource — build-time code can't reach it. Frontmatter is the only build-time source of truth for sort order. Cost: one line per MDX file, written automatically by Director going forward.

**Build verification:** `pnpm build` produces all 5 pages at the new URL shape: `/daily/2026-04-21/trump-administration-begins-refunding-more-than-166bn-in-tar/index.html` and the other four. Homepage + library + /library/ + 404 all build. Server-entry bundle unchanged.

**Preview verification (localhost:4321):**
- Homepage loads, hero title is "Who Really Pays Tariffs? The $166 Billion Answer" (newest piece by `publishedAt`).
- Recent list shows 4 other pieces, all linking to the new nested URL shape.
- `/daily/2026-04-21/trump-administration-…/` renders the piece with 6 beats + audio player + Zita chat.
- `/library/` returns 200.
- Old-shape URL `/daily/2026-04-21/` returns 404 (no redirect, as designed).
- Zero console errors.

**Non-goals for Phase 4:**
- No changes to `/api/daily/[date]/made` endpoint (still date-keyed — serves the made-drawer, which fetches by date and works fine at 1 piece/day). Phase 5 or 6 adds piece_id filtering if admin flips to multi-per-day.
- No changes to the admin `/dashboard/admin/piece/[date]/` route shape — admin URL stays date-keyed. Phase 5 rework for multi-per-day.
- No slug frontmatter field. Slug is derived from filename, authoritative source stays single.
- No short-slug / seo-slug refinement. The existing truncation-at-60 output from Director (filename-encoded) carries forward verbatim. Phase 7 cleanup if we ever want prettier URLs for legacy pieces.
- No Drafter prompt change to emit `publishedAt` — Director splices it at publish time, same pattern as `voiceScore`.
- No reader-visible "multi-piece today" UI. Until admin flips `interval_hours` below 24, the reader experience is visually identical to before.

**References:** [src/lib/slug.ts](../src/lib/slug.ts), [src/content.config.ts](../src/content.config.ts), [src/pages/daily/[date]/[slug].astro](../src/pages/daily/[date]/[slug].astro), [src/pages/index.astro](../src/pages/index.astro), [src/pages/daily/index.astro](../src/pages/daily/index.astro), [src/pages/library/index.astro](../src/pages/library/index.astro), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro), [agents/src/director.ts](../agents/src/director.ts), and the 5 MDX frontmatter edits in `content/daily-pieces/`.

---

## 2026-04-21: Multi-piece cadence — Phase 3 hourly cron + runtime gate (minimal)

**Context:** Phase 3 of the cadence plan. The behavioural phase — changes the cron from `'0 2 * * *'` to `'0 * * * *'` and teaches `dailyRun` to gate on `admin_settings.interval_hours` (Phase 2's plumbing) so only the right hour slots fire the pipeline. With `interval_hours=24` (the default seeded value) only the 02:00 UTC slot fires, reproducing today's 1-piece/day behaviour exactly. Flipping to `4` (testing) or `1` (production) becomes a `wrangler d1 execute --remote` one-liner that takes effect on the next hour boundary, no redeploy.

**Decision: minimal Phase 3.** No new migration. No new column on `pipeline_log`. No changes to per-piece filter semantics anywhere. Three focused edits:

1. **Cron switch.** `onStart` creates a cron at `'0 * * * *'` instead of `'0 2 * * *'`. The old row persists in SQLite until we cancel it — see point 3.

2. **Runtime gate inside `dailyRun`.** At the top of the handler, read `interval_hours` via [`getAdminSetting`](../agents/src/shared/admin-settings.ts) (Phase 2), compute `currentHour = new Date().getUTCHours()`, and bail out when `(currentHour - 2 + 24) % intervalHours !== 0`. The `-2` anchors the fire slot to hour 2 UTC so the current 02:00 ritual is preserved at every allowed interval (1/2/3/4/6/8/12/24 — all divisors of 24). The bail is silent — no observer log, no pipeline_log row, no work. The DO wakes, runs the gate in ~1ms, returns.

3. **One-time cancel of legacy `'0 2 * * *'` row.** Also at the top of `dailyRun`, after the gate (so it doesn't waste time on skipped hours): call `getSchedules({ callback: 'dailyRun' })`, iterate, and `cancelSchedule(id)` any row whose cron is `'0 2 * * *'`. Idempotent — once deleted, subsequent calls return `false` from cancelSchedule. Runs on every un-gated handler invocation; cleans up automatically on the first post-deploy hourly firing.

**Why cancel from `dailyRun`, not from `onStart`.** The documented hazard at [director.ts:46-55](../agents/src/director.ts#L46-L55) is that `super.alarm()` triggers `onStart` BEFORE the SDK scans the schedule table for due rows. If `onStart` cancels the currently-firing schedule row, the SDK loses track of the alarm and silently swallows the run. Cancelling from inside the callback itself (`dailyRun`) is safe: by then the alarm has already been dispatched and the cron row has already been re-scheduled by the SDK. Verified against the SDK source at `agents/node_modules/agents/dist/index.js:1658-1669` — `cancelSchedule(id)` is idempotent (returns `false` when the row is already gone) so the cleanup loop is safe to run on every invocation.

**Order of operations matters, and it's naturally correct:**
1. DO spins up after deploy. `onStart` runs → creates the new `'0 * * * *'` row (SDK is idempotent on `(callback, cron, payload)` so it's a single row, not a duplicate).
2. Old `'0 2 * * *'` row still exists. Both schedules are live.
3. Whichever fires first — hourly or daily — triggers `dailyRun`.
4. `dailyRun` top: gate check (skip if wrong hour), then cancel the legacy row.
5. After step 4 has run once, only the hourly cron exists. Future runs skip the cancel loop (idempotent no-op).

No window where the new cron is missing. No race against an in-flight alarm.

**`pipeline_log.run_id` stays as `YYYY-MM-DD` permanently.** This is the second time in this session a Phase tried to shift run_id to piece_id; both walked back. The reasoning for this final position — stable going forward — is:

(a) **Regression on 2026-04-21 showed the consequence of changing it.** Earlier today the backfill broke the "How this was made" drawer on every daily-piece page plus the admin per-piece deep-dive timeline + the admin live-pipeline poller + the dashboard's isRunningNow indicator. Four consumer sites had embedded `run_id = YYYY-MM-DD` assumption. The snapshot (`pipeline_log_backup_20260421`) restored the column. See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill" for the full post-mortem and the guardrail.

(b) **Day-grouping is a legitimate view at multi-per-day.** "Today's pipeline activity" is a real and likely-wanted admin surface — `WHERE run_id = today` returning ALL of today's runs' steps is a feature, not a bug. The admin dashboard already expects this shape (lifetime-runs counter, last-step-per-run-id grid). Forcing run_id to be piece-scoped would require a second column anyway for the day view, so having them separate is not a loss — it's a clean separation of "calendar day" from "piece identity."

(c) **No concrete consumer needs per-piece pipeline_log filtering yet.** Phase 4 will move URLs to `/daily/YYYY-MM-DD/slug/` — the URL carries piece context via slug, and per-piece surfaces (made drawer, admin deep-dive) can look up the piece's own id via `daily_pieces WHERE date=? AND slug=?` when they eventually need a finer filter. Adding a `pipeline_log.piece_id` column today would be speculative API for an unbuilt consumer. Phase 4 or Phase 6 can add it when a real need emerges, with site-worker query updates in the same atomic commit (the guardrail from the rollback).

**Audit of all `pipeline_log` consumers (confirmation that each tolerates `run_id = YYYY-MM-DD` through Phase 3 with `interval_hours=24`):**

| File | Query shape | 1/day (today) | Multi/day verdict |
|---|---|---|---|
| `src/pages/api/daily/[date]/made.ts:87` | `WHERE run_id = ? bind(date)` | ✓ | Pools all pieces' steps for date — acceptable "day view", revisit at flip |
| `src/pages/dashboard/admin/piece/[date].astro:120` | `WHERE run_id = ? bind(date)` | ✓ | Same — admin sees day-grouped timeline |
| `src/pages/api/dashboard/pipeline.ts:16` | `WHERE run_id = ? bind(today)` | ✓ | Correct — "today's pipeline activity" is the right semantic |
| `src/pages/dashboard/index.astro:165-171` | Last row globally, `isRunningNow = run_id === today` | ✓ | Still string-equal at today's date |
| `src/pages/dashboard/admin.astro:116-141` | `COUNT(DISTINCT run_id)`, last-step-per-run-id | ✓ | Counts days-run not runs-run at multi/day — cosmetic undercount, not broken |
| `agents/src/director.ts:109` | `DELETE WHERE run_id = ? bind(today)` | ✓ clears stale intra-day | ⚠ at multi/day wipes earlier runs' logs — follow-up for flip |
| `agents/src/director.ts:715-717` | `WHERE run_id = ? AND step='publishing' ORDER BY created_at DESC LIMIT 1 bind(date)` | ✓ | Picks latest piece's publishing row — acceptable "retry latest" |
| `agents/src/director.ts:783` | `DELETE WHERE run_id = ? AND step LIKE 'audio%' bind(date)` | ✓ | At multi/day wipes audio logs across day's pieces — retry-fresh semantic |
| `agents/src/director.ts:872` | `INSERT (…, run_id=today, …)` | ✓ writes date | ✓ correct per revised arch |
| `agents/src/learner.ts:338` | `WHERE run_id = ? bind(date)` | ✓ | Synthesis input pools day's pipeline steps — noisy at multi/day, Phase 6 problem |
| `scripts/reset-today.sh:68` | `DELETE WHERE run_id = '$DATE'` | ✓ | "Reset today" = wipe day. Correct at every cadence |

Phase 3 ships with `interval_hours=24` (default) so zero consumer is exercised at multi-per-day. Flipping the interval exposes two real issues flagged above (`director.ts:109` pre-run DELETE, `director.ts:783` audio DELETE, `learner.ts:338` synthesis input scope) — listed as a FOLLOWUP "Unblock multi-per-day: pre-run DELETEs + Learner input scoping" with the flip blocked until it's resolved.

**Non-goals for Phase 3:**
- No new migration.
- No new column on `pipeline_log`.
- No changes to any site-worker or agent query. Consumers stay as-is.
- No admin UI. Flipping the interval is a `wrangler` command.
- No fix for the `director.ts:109` pre-run DELETE at multi-per-day — logged as a FOLLOWUP that blocks the flip.
- No Zita-synthesis-timing shift (Phase 6). At `interval_hours=24` it's still scheduled at 01:45 UTC day+1 absolute-clock and works fine.
- No renaming of `dailyRun` → `hourlyRun`. The method-name-is-callback-string coupling means renaming requires a schedule-table migration; not worth the complexity for a semantic rename. Comment in code explains the current semantics.

**Verification contract for the next cron fire:**
- At 02:00 UTC (the current ritual slot), the hourly cron fires → `dailyRun` runs → gate passes (`(2-2+24)%24 === 0`) → pipeline runs → piece publishes as usual → legacy `'0 2 * * *'` row canceled.
- At 03:00 UTC → hourly cron fires → `dailyRun` runs → gate fails (`(3-2+24)%24 === 1`) → silent bail.
- Repeat at 04:00, 05:00 … 01:00 — all silent bails.
- `SELECT COUNT(*) FROM cf_agents_schedules WHERE callback = 'dailyRun'` returns 1 (not 2) after the first 02:00 fire.
- `SELECT data FROM pipeline_log WHERE step = 'scanning' ORDER BY created_at DESC LIMIT 1` returns JSON with `intervalHours: 24` (Phase 2's read path still working).

**References:** [agents/src/director.ts](../agents/src/director.ts) (onStart cron string + dailyRun top-of-handler gate + cancel loop), [agents/src/shared/admin-settings.ts](../agents/src/shared/admin-settings.ts) (existing helper), [agents/node_modules/agents/dist/index.js#L1658](../agents/node_modules/agents/dist/index.js) (cancelSchedule idempotency), plan file `~/.claude/plans/could-please-do-a-harmonic-waffle.md` §6 Phase 3.

---

## 2026-04-21: Roll back `pipeline_log.run_id` backfill — revert decision #3 from cadence Phase 1

**Context:** Phase 1's manual backfill (documented earlier in today's entry "Multi-piece cadence — Phase 1 identity foundations") rewrote all 111 historical `pipeline_log.run_id` values from `YYYY-MM-DD` date-strings to `daily_pieces.id` UUIDs, on the stated architectural principle that `run_id = piece_id` simplifies joins. The principle is correct in isolation; the mistake was not auditing site-worker consumers before landing the destructive UPDATE.

**What broke.** Two reader-visible surfaces + one admin surface had date-shape `run_id` assumed in their queries:

- [`src/pages/api/daily/[date]/made.ts:87`](../src/pages/api/daily/[date]/made.ts) — `SELECT ... FROM pipeline_log WHERE run_id = ?` `.bind(date)`. Powers the "How this was made" drawer on every public daily-piece page. Returned zero rows post-backfill — timeline section on /daily/2026-04-17 through /daily/2026-04-21 was empty for several hours 2026-04-21 afternoon.
- [`src/pages/dashboard/admin/piece/[date].astro:120`](../src/pages/dashboard/admin/piece/[date].astro) — same query shape. Admin per-piece deep-dive pipeline section empty.
- [`src/pages/dashboard/index.astro:165-171`](../src/pages/dashboard/index.astro) — `isRunningNow = lastStep.run_id === today && !terminal`. With UUID run_ids, the string-equality check against `today` (YYYY-MM-DD) was always false. Live-pipeline indicator on public dashboard would not activate during the next 2am run.
- [`src/pages/api/dashboard/pipeline.ts:16`](../src/pages/api/dashboard/pipeline.ts) — same pattern, powering admin live polling. Admin live-pipeline feed would have been empty on the next cron fire.

**Decision:** Roll back the destructive UPDATE via the `pipeline_log_backup_20260421` snapshot and walk back Phase 1 decision #3 (`run_id = piece_id`). `pipeline_log.run_id` stays `YYYY-MM-DD` permanently — the column is semantically "which calendar day does this step belong to," distinct from "which piece." Phase 3 will add a separate **`pipeline_log.piece_id` column** for per-piece filtering at multi-per-day cadence; both columns coexist.

Rollback ran 2026-04-21 via `wrangler d1 execute --remote`:
```sql
DELETE FROM pipeline_log;
INSERT INTO pipeline_log SELECT * FROM pipeline_log_backup_20260421;
```
All 111 rows restored to date-shape run_ids with step counts intact (31/23/19/19/19). Local D1 reverse-migrated via `UPDATE run_id = (SELECT date FROM daily_pieces WHERE id = run_id)` — local didn't have the snapshot because I only ran the backup on remote in Phase 1.

**Why decision #3 was wrong.** The "simpler joins" argument ignored that the existing 5 site-worker consumers had already embedded the `run_id=date` convention. At 1 piece/day, `WHERE run_id = ?` with either a date or piece_id works equivalently (one row per day either way). The semantic split — calendar day vs piece identity — only matters at multi-per-day. At that cadence, we need both: a column for "all steps from today's runs" (run_id stays date) and a column for "all steps from THIS piece's run" (piece_id). Forcing them into one column was YAGNI in reverse — collapsing two future concepts prematurely.

**Revised architecture (supersedes Phase 1 decision #3):**
- `pipeline_log.run_id` = `YYYY-MM-DD`, unchanged from launch. One date may have multiple runs at multi-per-day — acceptable; the column represents the day, not the run.
- `pipeline_log.piece_id` — new nullable TEXT column added in Phase 3. Links to `daily_pieces.id`. Per-piece queries (`made.ts`, admin deep-dive) switch from `WHERE run_id = <date>` to `WHERE piece_id = <uuid>` (via a small lookup). Cross-day queries keep using run_id.
- At Phase 3 deploy, the code+schema change is atomic: migration adds `piece_id` column + backfills historical 5-row data + site-worker queries are updated in the same commit. No interim broken state.

**Guardrail for future destructive data migrations.** Before any UPDATE that rewrites values in a shared column, `grep` the full repo for usages of that column with string-literal or parameter-bound comparisons against the OLD shape. The Phase 1 oversight was: running `grep run_id` would have surfaced the 4 consumer sites and caught the assumption. Pattern to add to the runbook's migration hygiene section.

**Backup table disposition.** `pipeline_log_backup_20260421` was already queued for drop on 2026-04-28 in FOLLOWUPS. The entry text updates to note the snapshot served its purpose — consumed for this rollback on 2026-04-21 — with the drop date unchanged. The snapshot can still be useful for a second-attempt audit before Phase 3 touches the column.

**Non-goals:**
- No revert of Phase 1's other backfills (`audit_results`, `learnings`, `zita_messages` piece_id columns — those are additive and don't break any reader). Those stay.
- No edits to the already-applied migration 0014 SQL (it ran, it's part of history). A prominent warning comment is added to the file's pipeline_log backfill block pointing to this DECISIONS entry so a future replay doesn't re-break the site.
- No production piece re-publish or reader-visible apology. The broken window was ~4 hours on a new launch week; reader traffic is low; the drawer's timeline section empty-state is inert (no error, just empty). Not worth narrating.

**References:** [migrations/0014_piece_id_fks.sql](../migrations/0014_piece_id_fks.sql) (rollback warning added), [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro), [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro), [src/pages/api/dashboard/pipeline.ts](../src/pages/api/dashboard/pipeline.ts).

---

## 2026-04-21: Multi-piece cadence — Phase 2 admin_settings plumbing

**Context:** Phase 1 of the cadence plan (earlier this session) laid the identity foundations — piece_id FKs across child tables, audio PK rebuild, pipeline_log.run_id semantic shift. Phase 2 is the second atomic deliverable: the `admin_settings` table that will eventually hold all admin-configurable system state, seeded with the cadence value Phase 3 will gate on. Plan §6 Phase 2 scope is explicit: no behavioural change, just the table + a Director read path that proves the plumbing works.

**Decision:** One migration + one helper + one four-line Director change.

1. **Migration 0016** creates `admin_settings(key TEXT PK, value TEXT NOT NULL, updated_at INTEGER NOT NULL)` and seeds `interval_hours='24'`. Stringly-typed values (application layer parses to whatever the caller wants) is deliberate — future settings like rate limits, feature flags, or voice overrides don't need schema migrations to land, just a new key. `INSERT OR IGNORE` on the seed so a replay doesn't stomp a later admin edit.

2. **New helper** [agents/src/shared/admin-settings.ts](../agents/src/shared/admin-settings.ts): `getAdminSetting<T>(db, key, parse, fallback)`. Catches every failure mode (missing row, null value, non-string value, DB throw) and returns `fallback`. This is deliberate — `admin_settings` is an operational config surface, never a source-of-truth for pipeline identity, so every consumer must have a safe default that preserves current behaviour. Not cached; each call hits D1. At Director's once-per-run cadence the SELECT is ~1ms and the fresh-read semantics mean an admin UI change propagates on the next run without a DO restart.

3. **Director read path** ([agents/src/director.ts](../agents/src/director.ts)) inside `triggerDailyPiece`, after the dedup clear and before the scanner phase. The read stores `intervalHours` in a local variable and passes it into the existing `scanning` step's `data` field — visibility in the admin pipeline feed confirms the read path works, without adding new observer events or noise. The value is otherwise unused in Phase 2; Phase 3 wires it into the hourly gate.

**Why `ALLOWED_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24]`.** Must be divisors of 24 so the hour-2-anchored modulo gate (Phase 3) produces a consistent daily rhythm. Non-divisors drift across days: a 5-hour interval would fire at 02/07/12/17/22 UTC on day 1, then 03/08/13/18/23 on day 2 — the daily rhythm rotates. Every divisor of 24 gives a stable repeating slot pattern. `parseIntervalHours()` enforces this defensively — a manual D1 edit setting `value='5'` falls back to 24, preserving production cadence instead of landing a broken rhythm. The admin UI (Phase 5) will constrain the dropdown to the allowed set; the parser is the second line of defence.

**Why read inside `triggerDailyPiece`, not `onStart`.** Plan §6 Phase 2 lists "Director reads interval_hours on onStart and on each alarm firing." The `onStart` half would be harmless in Phase 2 (reading is not writing, so the cancel-from-onStart hazard at [director.ts:46-55](../agents/src/director.ts) doesn't apply), but it'd read on every DO spin-up — not tied to a specific cron firing — and do nothing with the value. Reading inside `triggerDailyPiece` ties the read to the run it could affect. Cleaner. Phase 3's hourly gate will live here too.

**Fallback posture: 24 everywhere.** If the row is missing, the value is malformed, the DB throws, or `parseIntervalHours` rejects the value, the read returns 24. Defensive layers:
- Migration seeds `interval_hours='24'`.
- Helper returns `fallback` on any error.
- Parser falls back to 24 on non-divisor / non-numeric input.
- Director passes `24` as the `fallback` argument.

Production cadence stays 1/day through any of those failure paths.

**Verified locally:** migration 0016 applied to local D1 via `wrangler d1 execute --local --file`; `SELECT * FROM admin_settings` returns the single seeded row with `interval_hours='24'`. Agents TypeScript check clean on both touched files (18 pre-existing SubAgent typing errors in `server.ts` unchanged from Phase 1, zero errors in `director.ts` or `admin-settings.ts`).

**Verified remote:** migration 0016 applied via `wrangler d1 migrations apply --remote`; tracker at 0016; seed row present. Director code change lands on the next push + CI deploy, ready for tonight's 02:00 UTC cron to smoke-check the read path.

**Non-goals for Phase 2 (explicit):**
- No admin UI — that's Phase 5.
- No gating on the read value — that's Phase 3.
- No `admin_settings_changed` observer event yet — introduced with the write path in Phase 5.
- No caching in the helper — fresh read per call keeps the "admin change → next run" propagation story clean.
- No separate admin_settings reader for the site worker. When Phase 5 adds the write path, it'll either import this helper directly (if the site worker has a D1 binding) or hit the agents worker via the existing admin RPC. Decide then, not now.

**Post-apply verification contract for tonight's 2am UTC run:**
- `SELECT data FROM pipeline_log WHERE step = 'scanning' AND created_at > <now> ORDER BY created_at DESC LIMIT 1` returns JSON with `intervalHours: 24`.
- Piece lands as usual (no behavioural change).
- Observer feed shows no new error categories.

**References:** [migrations/0016_admin_settings.sql](../migrations/0016_admin_settings.sql), [agents/src/shared/admin-settings.ts](../agents/src/shared/admin-settings.ts), [agents/src/director.ts](../agents/src/director.ts) (`triggerDailyPiece` cadence-config read block), plan file `~/.claude/plans/could-please-do-a-harmonic-waffle.md` §6 Phase 2.

---

## 2026-04-21: Multi-piece cadence — Phase 1 identity foundations

**Context:** The site currently publishes 1 piece/day at 02:00 UTC — baked in as both schema and semantics at ~50 sites across the codebase. The goal is admin-configurable cadence: testing at 1 piece every 4 hours (6/day), production at 1 piece every 1 hour (24/day). Plan file: `~/.claude/plans/could-please-do-a-harmonic-waffle.md`. This entry records the 10 architectural decisions that unblock the rest of the cadence plan, plus the Phase 1 schema work that makes multi-per-day non-colliding without changing any runtime behaviour yet.

**The 10 decisions (plan §5):**

1. **URL structure: `/daily/YYYY-MM-DD/slug/`** (nested). The alternative flat `/daily/YYYY-MM-DD-HHmm-slug/` put a timestamp in the URL with no reader value; the UUID option was unshareable; the sequence-number option had no meaning for readers. Nested is clean, shareable, and groups naturally by day.
2. **Unique identifier: `piece_id` = `daily_pieces.id` (existing UUID).** Audit on 2026-04-21 confirmed all 5 prod rows are UUIDs generated via `crypto.randomUUID()` at [director.ts:286](../agents/src/director.ts#L286). Adding a separate `piece_id` column would have been duplication. The `date` column stays alongside `id` as the calendar/display key.
3. **`run_id` shape: `run_id = piece_id`.** Literally the same value — `pipeline_log.run_id` holds the piece's UUID, not a calendar date. Joins to `daily_pieces.id` directly without translation.
4. **Scheduling: hourly cron (`0 * * * *`) + runtime gate** on `admin_settings.interval_hours`. Anchor the fire slot to hour 2 UTC so the current 02:00 ritual is preserved at any interval: `if ((hour - 2 + 24) % intervalHours !== 0) skip;`. Interval choices constrained to divisors of 24 — {1, 2, 3, 4, 6, 8, 12, 24} — so the rhythm repeats each day cleanly. Non-divisors would create drift across days. Dynamic cron re-scheduling (Option C in the plan) rejected due to the cancel-from-onStart hazard documented at [director.ts:46-55](../agents/src/director.ts#L46-L55); static crons rejected because they require a redeploy per interval change.
5. **Homepage hero: most-recent by `published_at DESC`.** Tiebreaker required because multiple pieces can share a `date`. Preserves the factory-floor aesthetic (the page responds to the pipeline) over an admin-pinned hero.
6. **Library: flat newest-first (current shape).** Grouping by day with date headers becomes necessary around 6-8 pieces/day; not designing for 24/day yet. Same `published_at DESC` tiebreaker.
7. **Zita synthesis: `publish + 23h45m`** relative delay per piece, plus `zita_messages.piece_id` column added this phase (not deferred). Absolute 01:45 UTC day+1 breaks when N pieces publish per day (all N synth jobs stack on one clock). Piece-id scoping is the same fix as the Phase 1 Zita plan's piece_date addition, one level deeper — at multi-per-day the `piece_date` column pools conversations from different pieces sharing a date.
8. **Scanner/Curator: 6 feeds / 50 cap sufficient at 4/day, revisit at 24/day.** Sequential Curator (re-use existing code, one pick per run); a run that finds no teachable story is a valid no-op, not a failure. Add: pass **today's prior picks** into Curator's `recentPieces` input so it doesn't re-select. Today's traffic at 4/day lands ~60-80 candidates per day after URL dedup; 24/day pushes the selection rate to ~16% and may need more feeds.
9. **Copy: keep "daily".** Refers to reader rhythm, not publish rate. Readers can still have a daily read even when the system publishes 24×/day.
10. **Config home: D1 `admin_settings` table + `/api/dashboard/admin/settings` endpoint.** Env-var alternative would mean a redeploy per cadence change — friction this plan cannot afford while testing. Every admin mutation fires an `admin_settings_changed` observer_event (audit trail).

**Refinement 1 — no 301 redirect for old `/daily/YYYY-MM-DD/` URLs.** Per Zishan 2026-04-21: dev phase, 5 pieces, no bookmarks. Old URLs stop existing when Phase 4 ships; no redirect layer.

**Refinement 3 — `zita_messages` gets `piece_id` in Phase 1, not deferred.** Same argument as the decision text above for #7.

**Why piece_id and not a new column like `piece_uuid`.** Every INSERT path in the agents worker already calls `crypto.randomUUID()` for the daily_pieces.id. Six existing writer sites ([director.ts](../agents/src/director.ts), [observer.ts](../agents/src/observer.ts), [scanner.ts](../agents/src/scanner.ts), [shared/learnings.ts](../agents/src/shared/learnings.ts)) generate UUIDs today. The PK on daily_pieces is `id TEXT PRIMARY KEY`, already unique, already stable. Introducing a parallel `piece_id TEXT UNIQUE` would have forced every query and every writer to choose between two equivalent keys. Reuse is the simpler, less-error-prone choice — at the small cost that the semantic name "piece_id" now lives in application-code comments and child-table FK column names, not on the parent table.

**Phase 1 shipping artifacts (this commit):**
- [migrations/0014_piece_id_fks.sql](../migrations/0014_piece_id_fks.sql) — add nullable `piece_id TEXT` column + index to `audit_results`, `learnings`, `zita_messages`, `daily_candidates`. Auto-applied ALTERs; backfill UPDATEs commented for manual `wrangler d1 execute` runs. Includes `pipeline_log.run_id` backfill (no schema change, just `UPDATE run_id = daily_pieces.id WHERE run_id = daily_pieces.date`).
- [migrations/0015_daily_piece_audio_piece_id_pk.sql](../migrations/0015_daily_piece_audio_piece_id_pk.sql) — PK rebuild. Old table's composite PK `(date, beat_name)` cannot tolerate multi-per-day. Snapshot-first (`daily_piece_audio_backup_20260421`, same pattern as Zita Phase 1's `zita_messages_backup_20260421`), create new table with PK `(piece_id, beat_name)`, copy rows joining piece_id via `daily_pieces.date`, drop old, rename new. Auto-applied. 32 rows across 5 dates — snapshot is free insurance.
- This DECISIONS entry.
- No code changes in Phase 1. Director, auditors, Publisher all keep passing `date` as today. After the backfill lands, every historical row has piece_id, and Phase 2 / Phase 3 start writing piece_id on new rows without breaking existing callers.

**Hazards addressed:**
- **Cancel-from-onStart swallow** — Option A (hourly cron + gate) picked for decision #4 so onStart never re-schedules; the cron stays `0 * * * *` regardless of admin-settings value.
- **Zita synthesis absolute-clock collision** — decision #7 uses per-piece relative delay so N pieces generate N independent synthesis targets.
- **run_id collision at multi-per-day** — decision #3 + migration 0014's run_id backfill eliminates it before Phase 3 starts writing multi-per-day.
- **Audio PK collision at multi-per-day** — migration 0015 rebuilds the PK before Phase 3.

**Deferred to later phases:**
- **Phase 2:** `admin_settings` table + Director reads config (no UI yet).
- **Phase 3:** cron switches from `0 2 * * *` to `0 * * * *` + runtime gate + multi-per-day dedup. Adds a new slug column to `daily_pieces` at this point since the URL change needs it.
- **Phase 4:** URL routing `/daily/[date]/[slug]/`, homepage + library tiebreaker, per-piece admin route shift, content-collection filename + frontmatter convention.
- **Phase 5:** Admin settings UI.
- **Phase 6:** Zita synthesis re-scoping to piece_id (uses the column added in Phase 1), Scanner/Curator retune, "days running" rename, reset-today flag.
- **Phase 7:** Copy + docs.

**Non-goals for Phase 1 (explicit):**
- No schema change to `pipeline_log` (the `run_id` column stays TEXT; only the values migrate).
- No 301 redirect layer for old URLs (decision above).
- No `piece_id` backfill for `daily_candidates` — prod has 250 rows across 5 dates with **zero `selected=1`** (historical data-flow quirk where the post-curator UPDATE apparently didn't land; separate investigation). New runs write piece_id going forward.
- No frontmatter edits to the 5 existing MDX files in this phase. Phase 4's URL work may add slug/publishedAt fields — metadata carve-out applies then, not now.
- No new `admin_settings` table in this phase — Phase 2.

**Verified (pre-apply):**
- `daily_pieces.id` values for all 5 prod rows match the UUID v4 shape (verified via direct D1 query 2026-04-21).
- `daily_piece_audio` rows: 32 total (8+6+6+6+6) across 5 dates, 1:1 with daily_pieces.
- `learnings` rows: 22 across 3 piece_dates — every row's `piece_date` has a matching `daily_pieces.date`.
- `zita_messages` rows: 92 across 4 piece_dates — all from the 2026-04-21 Phase 1 backfill; every piece_date has a matching daily_pieces row.
- `pipeline_log` rows: 111 across 5 run_ids (`'2026-04-17'` … `'2026-04-21'`) — every run_id maps to exactly one daily_pieces row via date.
- `audit_results` rows: 3, all from 2026-04-21 — unambiguous backfill target.

**Post-apply verification (run before declaring Phase 1 done):**
- `PRAGMA table_info(audit_results)` / `learnings` / `zita_messages` / `daily_candidates` — all show `piece_id TEXT` column present.
- `SELECT COUNT(*) FROM daily_piece_audio WHERE piece_id IS NULL` — expect 0.
- `SELECT COUNT(*) FROM learnings WHERE piece_id IS NULL AND piece_date IS NOT NULL` — expect 0 after manual backfill.
- `SELECT COUNT(*) FROM zita_messages WHERE piece_id IS NULL AND piece_date IS NOT NULL` — expect 0 after manual backfill.
- `SELECT run_id, COUNT(*) FROM pipeline_log GROUP BY run_id` — expect 5 UUID run_ids, each matching `daily_pieces.id`.
- `SELECT COUNT(*) FROM daily_piece_audio_backup_20260421` — expect 32.

**References:** [migrations/0014_piece_id_fks.sql](../migrations/0014_piece_id_fks.sql), [migrations/0015_daily_piece_audio_piece_id_pk.sql](../migrations/0015_daily_piece_audio_piece_id_pk.sql), [agents/src/director.ts](../agents/src/director.ts) (id generation + run_id write), plan file `~/.claude/plans/could-please-do-a-harmonic-waffle.md`.

---

## 2026-04-21: Dashboard "latest observation" label uses piece_date, not created_at

**Context:** Surfaced the moment the first real `source='zita'` learning landed on prod. The public dashboard ([`/dashboard/`](../src/pages/dashboard/index.astro)) shows the most recent observation under "What we've learned so far" with an attribution line: *"— {source label}, after the {date} piece."* The date was derived from `learnings.created_at.toISOString().slice(0, 10)`. For producer and self-reflection sources this is correct because those writers fire seconds after publish — `created_at` and `piece_date` match. For Zita-source rows they diverge: synthesis runs at 01:45 UTC on day+1, so the row is written a calendar day after the piece it's about. Right after the first real Zita synthesis, the dashboard attributed a learning about 2026-04-20's Hormuz piece to "the 2026-04-21 piece" — the date the row was written, not the piece it was about.

**Decision:** Prefer `piece_date` (the piece the learning is ABOUT) over `created_at` (when the row was written), fall back to `created_at.slice(0, 10)` for pre-0012 rows where `piece_date` is NULL. One-line change in [`src/pages/dashboard/index.astro`](../src/pages/dashboard/index.astro): pull `piece_date` in the `latestLearning` SELECT; derive `latestLearningDate = latestLearning.piece_date ?? created_at-as-date`.

**Why it matters.** The whole point of the public dashboard's memory panel is *"what did the system learn from the thing you're about to read"*. Tying the attribution to the writing timestamp instead of the piece timestamp breaks that compact — especially as more zita-source rows land (they always attribute wrong because synthesis always runs day+1).

**Verified locally:** seeded a test learning with `piece_date='2026-04-20'` and `created_at=now()` (today = 2026-04-21). Before fix: dashboard showed "after the 2026-04-21 piece". After fix: "after the 2026-04-20 piece". Test row cleaned before commit.

**References:** [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro) (lines 51, 189-191, 294-302).

---

## 2026-04-21: P1.5 Learner skeleton — Zita-question synthesis scheduled 01:45 UTC day+1 (Phase 5)

**Context:** Phase 5 of the Zita improvement plan and P1.5 from the 2026-04-19 improvement plan. Schema plumbing for `source='zita'` has been in place since migration 0011 (2026-04-20), labels in the made-drawer and public dashboard have referenced it since 2026-04-20 commit [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22), but no code path wrote rows with that source. CLAUDE.md has flagged it as "blocked on reader + Zita traffic" — but waiting for real data to arrive before building the synthesis means we'd be writing the synthesis on the day the first real signal appeared, under time pressure. Better to build the skeleton now, guarded so it no-ops cleanly at current traffic levels, and let it start producing rows organically as reader traffic grows.

**Decision:** Mirror the three-source pattern exactly.

1. **New prompt** `LEARNER_ZITA_PROMPT` in [`agents/src/learner-prompt.ts`](../agents/src/learner-prompt.ts). Shape identical to `LEARNER_POST_PUBLISH_PROMPT`: 0–10 learnings, strict JSON, category is voice/structure/fact/engagement, no hedging. Prompt posture is different — it names the Socratic-chat context, asks for pattern-recurrence (not per-conversation summaries), and its example learnings are all recognition-of-misreading / beyond-the-piece-questions / engagement-pattern shaped (not audit-violation shaped).

2. **New Learner method** `analyseZitaPatternsDaily(date)` in [`agents/src/learner.ts`](../agents/src/learner.ts). Pulls `zita_messages WHERE piece_date = ? ORDER BY created_at ASC`, counts user messages, **returns `{ skipped: true, userMsgCount, durationMs }` without firing a Claude call when `userMsgCount < ZITA_SYNTHESIS_MIN_USER_MESSAGES` (5).** Above threshold: pulls the piece's headline + underlying_subject for context, groups messages by reader, builds a compact "### Conversation N (K turns)\\nReader: …\\nZita: …" block per reader, sends to Claude Sonnet 4.5 (max_tokens: 2000, same model as the other two synthesis calls), parses JSON with the existing `extractJson` helper, caps writes at `ZITA_LEARNINGS_WRITE_CAP` (10), writes via `writeLearning(db, category, observation, { date, phase: 'zita-synthesis', readerCount, userMsgCount, totalMsgCount }, 60, 'zita', date)`. Returns `ZitaSynthesisResult { date, skipped, userMsgCount, written, overflowCount, considered, tokensIn, tokensOut, durationMs }` — the last three are for cost metering.

3. **Director scheduling** in [`agents/src/director.ts`](../agents/src/director.ts) `triggerDailyPiece`, after `publishing done`. Unlike producer + self-reflection (which fire at publish+1s because they analyse signals complete at publish), Zita synthesis needs a full day of reader traffic. Schedule for **01:45 UTC on day+1** — just before the 02:00 UTC cron kicks the next run, so we analyse a complete window without interfering. Computed via `Date.UTC(y, m, d+1, 1, 45)` and `Math.max(60, Math.floor(...))`. For a publish at ~02:07 UTC, delay is ~23.63h / 85080s.

4. **New alarm handler** `analyseZitaPatternsScheduled({date, title})` mirrors `analyseProducerSignalsScheduled` shape exactly. Calls `learner.analyseZitaPatternsDaily(date)`, logs via `observer.logZitaSynthesisMetered(...)` (handles both skipped and success paths — the skip log is informational so "is the P1.5 schedule firing?" has a visible answer even when traffic is below threshold), logs via `observer.logZitaSynthesisFailure(...)` on throw. Non-retriable.

5. **Observer methods** in [`agents/src/observer.ts`](../agents/src/observer.ts):
   - `logZitaSynthesisMetered(date, title, metrics)` — branches on `metrics.skipped`. Skipped: `severity: 'info'`, "Zita synthesis skipped: title" / "only N reader messages, threshold 5, no Claude call fired". Success: "Zita synthesis: title" / tokens-in/out + latency + overflow. Both shapes match the existing `logReflectionMetered` posture.
   - `logZitaSynthesisFailure(date, title, reason)` — `severity: 'warn'`, same shape as `logLearnerFailure` and `logReflectionFailure`.

6. **No Drafter changes.** The runtime `getRecentLearnings(db, 10)` in [`agents/src/shared/learnings.ts`](../agents/src/shared/learnings.ts) is source-agnostic — `source='zita'` rows auto-flow into the next Drafter prompt the moment they're written. Zero work needed on the reader side of the loop.

**Why the guard at 5, not 0.** Below 5 user messages, Claude would produce learnings from 1–4 chat turns, which is noise rather than pattern. A pattern by definition requires repetition or a striking exchange; single chats don't qualify. At current traffic (3 users across 5 pieces as of 2026-04-21), most days will skip. That's the right behaviour — we'd rather have `source='zita'` rows appear organically when real signal exists than produce a stream of low-confidence rows that pollute the Drafter's feed. The skip is metered so we know the schedule is running; the count is a leading indicator for when the feature "activates" naturally.

**Why not schedule at publish+1h.** That's what producer + self-reflection do, because they analyse signals complete at publish. Zita synthesis needs reader traffic that takes a day. At publish+1h the ≥5 guard would skip every run (readers haven't arrived yet), and we'd never know if the schedule was firing vs the guard was the problem. Scheduling at 01:45 UTC day+1 means the guard becomes a real threshold instead of a false one.

**Non-retriable by design.** Same reasoning as `analysePiecePostPublish` and `reflect`: the piece is live, one missed synthesis isn't catastrophic, and retry logic turns into mystery failures later. If a run fails, `logZitaSynthesisFailure` warns in the admin feed and the loop moves on.

**Verified locally:** typecheck passes with zero new errors (33 pre-existing SubAgent typing errors before AND after the change). Schedule math verified via a simulated 02:07 UTC publish: target = 01:45 UTC next day, delay = 85080s = 23.63h. Full runtime test (triggering the alarm) would require waiting 24 hours or invoking the scheduled method directly via the agents worker; deferred to Zishan's call on whether to manually trigger against the 2026-04-20 piece's 26 messages (17 user messages, above threshold) to see a real Claude synthesis run.

**Non-goals:**
- No Drafter retuning to weight `source='zita'` differently. They flow into the same 10-row feed as the other sources, equal standing.
- No per-conversation analysis or drill-down UI — the admin Zita view (Phase 3) already provides the raw data; this synthesis is about patterns, not individual sessions.
- No real-time / per-message triggering. One synthesis per piece per day is enough; the schedule boundary is deliberate.
- No cost alerting / escalation on token spike. Metered info event is sufficient until we see actual drift.

**References:** [agents/src/learner-prompt.ts](../agents/src/learner-prompt.ts) (new `LEARNER_ZITA_PROMPT`), [agents/src/learner.ts](../agents/src/learner.ts) (new `analyseZitaPatternsDaily`), [agents/src/director.ts](../agents/src/director.ts) (schedule + alarm handler), [agents/src/observer.ts](../agents/src/observer.ts) (new `logZitaSynthesisMetered` + `logZitaSynthesisFailure`).

---

## 2026-04-21: Zita safety smallest-viable pass (Phase 4)

**Context:** Phase 4 of the Zita improvement plan. With piece-scoping (Phase 1), a history cap (Phase 2), and admin visibility (Phase 3) in place, three operational blind spots remained:
1. Claude API errors were silently swallowed — the reader saw a generic 503, ops never learned which piece / user / upstream status triggered it.
2. Rate-limit 429s were silently returned — no way to see abuse patterns or runaway clients in the admin feed.
3. The persisted assistant `content` had no ceiling. `max_tokens: 300` at the API level is the only bound, but a misconfigured model / cache weirdness could theoretically return longer output, and a single row could dominate future context loads.

**Decision:** smallest-viable safety pass. No prompt-injection hardening (that's gated on Phase 6's design doc); just the three observable gaps.

1. **`zita_claude_error` observer_event** fired when `!claudeResponse.ok`. Severity `warn` (not `escalation` — Claude is occasionally flaky). Context captures `{ type, httpStatus, userId, pieceDate, upstreamBody }` — the upstream body is capped at 500 chars via `claudeResponse.text().slice(0, 500)` to stop large error payloads from bloating `observer_events`. Reader still sees the generic "Zita is temporarily unavailable" — the event is for ops, not for disclosure.

2. **`zita_rate_limited` observer_event** fired on the 429 path. Severity `warn`. Context `{ type, userId, limit: 20, windowSeconds: 900 }`. Helpful for catching runaway clients or abuse patterns — the current rate limit (20 msg / 15 min) is aggressive, so one spam-loop would produce a clear trail.

3. **`zita_handler_error` observer_event** on the outer `catch` for unhandled exceptions. Same severity/shape posture.

4. **`capStoredContent()` helper** — if `content.length > ZITA_STORED_CONTENT_CAP` (4000), truncate and append `\n\n[…truncated]`. Applied to both user message and assistant reply INSERTs. 4000 is generous relative to the ≈1200-char typical output from `max_tokens: 300` — it's a ceiling, not a target. The truncation marker is recognisable if it shows up in a transcript.

**Why not a new writer helper.** `logObserverEvent` from Phase 2 already encapsulates the INSERT + swallow-errors shape. Four call sites now use it: truncation (Phase 2), rate limit, Claude error, handler error.

**Verified end-to-end** via preview: fired 22 rapid POSTs at `/api/zita/chat`. First 20 returned 503 (local Claude key is invalid → 401 → zita_claude_error row each). Next 2 returned 429 → zita_rate_limited rows. Every row had correctly-shaped title, body, and JSON context. Upstream body (authentication_error / invalid x-api-key / request_id) was captured verbatim up to the 500-char cap. Test rows cleaned before commit.

**Non-goals (all deferred to Phase 6 design doc):**
- Prompt-injection detection or guardrails on reader input.
- PII redaction on stored content.
- Per-event alerting (escalation escalation vs. silent warn). Current posture: log everything, let the admin feed show operators what's happening.
- Encryption at rest for `zita_messages` content.

**References:** [src/pages/api/zita/chat.ts](../src/pages/api/zita/chat.ts) (all four observer call sites + capStoredContent), [src/lib/observer-events.ts](../src/lib/observer-events.ts) (shared writer).

---

## 2026-04-21: Admin Zita view (Phase 3)

**Context:** Phase 3 of the Zita improvement plan. With Phase 1 scoping `zita_messages` by piece_date and Phase 2 logging truncation events, the next gap was operator visibility: no dashboard surface for reading what readers actually ask Zita. Without this, validating P1.5 (Phase 5's Learner synthesis) is impossible — you can't evaluate whether the synthesised patterns are accurate against reader questions you can't see.

**Decision:** Two surfaces, both admin-gated, matching the existing design system (eyebrow + title header, stat grid, rounded-xl cards with `border-zee-border`, `text-xs font-semibold uppercase tracking-widest text-zee-muted` section headers):

1. **`/dashboard/admin/zita/`** — standalone view. Stats grid (conversations / messages / unique readers / truncation count, all 30-day window). Conversation list grouped by `(user_id, piece_date)`, 100 most recent, each as a `<details>` with collapsed summary (message count, short user id, relative time, piece headline) + expanded transcript (reader/zita labelled messages). Deep-link to per-piece admin route when piece_date is set. Piece headlines joined from `daily_pieces` via a single `WHERE date IN (?, ?, …)` query.

2. **Per-piece deep-dive** (`/dashboard/admin/piece/[date]/`) — new "Questions from readers" section, inserted between Audio and Observer events. Shows distinct readers who chatted about this piece, sorted by most-recent message. Each reader's full transcript expandable via `<details>`. Header includes an "All Zita activity →" link to the standalone view for cross-piece context.

3. **Main admin page entry point** (`/dashboard/admin/`) — new "Zita activity →" link in the top-right corner alongside the existing "← Public dashboard" link.

**Defensive refactor caught during verification:** the per-piece page originally ran audio + zita queries inside the same try/catch. When local D1 was missing `daily_piece_audio` (migration 0010 tracker drift), the audio query threw, the shared catch swallowed it, and the Zita section silently disappeared. Split Zita into its own `try { ... } catch {}` so a failure in an unrelated section can't hide the Questions block. Same defensive shape as the site-worker `logObserverEvent` helper — observability writes never break the handler that's calling them.

**No new data flows.** All three surfaces read from existing tables (`zita_messages`, `daily_pieces`, `observer_events`) — no schema changes, no writer changes. The piece title join uses a fresh `daily_pieces` lookup rather than denormalising into `zita_messages`; 100 conversations × 5 distinct piece_dates in the 30-day window means the `IN (…)` lookup is cheap.

**Verified end-to-end** in local preview with a minimal seeded conversation (4 messages from `demo-reader-1` about the 2026-04-20 piece): stats rendered correctly (1 conv / 4 msgs / 1 reader / 0 truncations), conversation card showed message count + short user id + piece headline, transcript expanded cleanly with READER / ZITA labels and alternating styling. Per-piece deep-dive showed the matching "Questions from readers" block. Test data cleaned before commit.

**Non-goals:**
- No pagination beyond the 100-conversation cap. If the dataset grows, revisit then — not now.
- No filtering UI (search, date-range, reader-id lookup). The deep-links + piece deep-dive give piece-scoped views already; freeform search is Phase 6 territory.
- No PII redaction of content. Messages display verbatim for honest operator review. When the design doc in Phase 6 decides on PII posture, apply it here.
- No real-time refresh. A reload picks up new conversations; the admin surface isn't a live monitoring tool.

**References:** [src/pages/dashboard/admin/zita.astro](../src/pages/dashboard/admin/zita.astro), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro) ("Questions from readers" section + independent zita try/catch), [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro) (top-right link).

---

## 2026-04-21: Cap Zita history load at 40 + log truncation to observer_events

**Context:** Phase 2 of the Zita improvement plan. Even with Phase 1's piece-scoped history (DECISIONS 2026-04-21 "Scope zita_messages by piece_date"), a single reader's long session on one piece still grows unbounded. In the 92-row audit on 2026-04-21, one user had 44 messages scoped to the 2026-04-21 tariffs piece alone; at current rate, a committed reader could reach 100+ turns on a single day's piece inside a week. Every new message would reload the full history into the Claude system prompt, growing input tokens linearly per turn.

**Decision:** Cap the history load at **40 rows = 20 turns** (user + assistant pairs). Change:

- `SELECT role, content FROM zita_messages WHERE … ORDER BY created_at DESC LIMIT 40` — newest first for correct truncation semantics. Reverse in-memory when building the Claude `messages` array to preserve chronological order.
- Parallel `SELECT COUNT(*)` on the same scope, batched together via `db.batch` so it's one D1 round trip.
- When `totalCount > 40`, fire a `logObserverEvent(db, { severity: 'info', title: 'Zita history truncated at 40 for <pieceDate>', body: 'Clipped N older messages…', context: { type: 'zita_history_truncated', userId, pieceDate, courseSlug, lessonNumber, totalCount, loadedCount: 40, clippedCount: totalCount - 40 } })`. Severity is `info` because this is expected long-session behaviour, not a failure — it surfaces the cap in the admin Observer feed instead of leaving it silent.
- `ZITA_HISTORY_LIMIT` constant at the top of `chat.ts` so a future tweak is a single-line edit.

**Data stays in D1.** The cap is purely about what we send to Claude per turn; `zita_messages` still receives every new INSERT, and the admin Zita view (Phase 3) will read the full history independent of the cap.

**Why 40.** A Socratic exchange is typically short — Zita's prompt enforces 2-4 sentence replies, and reader messages trend short too. 40 rows covers ~20 back-and-forths, which is a long session. Beyond that, older context adds token cost without changing Zita's posture — she's already in-character from the system prompt, not from the conversation. The clippedCount in the observer_event gives us a real signal if 40 turns out to be too aggressive for any reader's flow.

**New helper: `src/lib/observer-events.ts`** — site-worker → `observer_events` writer that mirrors the shape used by `agents/src/observer.ts:writeEvent` (id, severity, title, body, JSON-stringified context, created_at). Fire-and-forget with `try/catch {}` so observer logging never breaks the handler. This is the first site-origin writer of observer_events; Phase 4 will add `zita_claude_error` and `zita_rate_limited` events through the same helper.

**Verified end-to-end locally:** seeded 45 dummy rows for `test-cap-user` on 2026-04-20. `COUNT(*)` returned 45, `LIMIT 40` returned exactly 40 rows. Synthetic `observer_events` INSERT with the same shape the handler produces queried back cleanly with all fields populated. Test data cleaned up before commit.

**Non-goals:**
- No summarisation of clipped messages — they're gone from Claude's view, not condensed into a "previously…" blurb. Add that in Phase 6's deep-Zita design doc if we decide cross-turn memory matters.
- No server-side cursor / pagination UI. The cap is invisible to readers; only visible to admins via observer_events.
- No reduction of the 40 for non-daily courses — lessons-course path keeps the same cap because 20 turns is a reasonable default regardless.

**References:** [src/pages/api/zita/chat.ts](../src/pages/api/zita/chat.ts), [src/lib/observer-events.ts](../src/lib/observer-events.ts), [migrations/0002_observer_events.sql](../migrations/0002_observer_events.sql) (table shape).

---

## 2026-04-21: Scope `zita_messages` by piece_date (migration 0013 Commit A)

**Context:** Direct query of `zita_messages` on 2026-04-21 returned 92 rows from 3 users across 5 different daily pieces, all keyed under the same `(course_slug='daily', lesson_number=0)` — because [`LessonLayout.astro:74-78`](../src/layouts/LessonLayout.astro) hardcodes those attributes on `<zita-chat>` for every piece. One reader (User fb906615) had 80 messages spanning QVC → Hormuz → tariffs, all of which loaded into every new Claude call as conversation history. Zita coped verbally ("we've been wandering through the whole lesson") but couldn't prevent cross-piece history contamination or cost creep, and had no way to tell the reader which piece they were on.

**Decision:** Add `zita_messages.piece_date TEXT` (nullable at schema level) + composite index `idx_zita_piece(user_id, piece_date)`. Matches the shape of the `learnings.piece_date` column added in migration 0012 — both are hand-backfilled with a one-time commented UPDATE block inside the migration file, both nullable at schema level so the ALTER applies non-destructively, both enforced non-null at the application layer going forward. This is Commit A of a two-commit Phase 1: schema-only now, code changes (LessonLayout pass-through, request-body field, scoped history SELECT, scoped INSERTs, system-prompt line naming the piece) in Commit B after the migration is applied and verified.

**Two-commit split because:** the 0012 rollout (resolved FOLLOWUPS "D1 migration tracker out of sync") burned an evening recovering from `d1_migrations` drift when code + schema landed together. Separating the commits means: (a) schema change lands, is applied, column existence is verified with a `PRAGMA table_info` query, *then* code starts reading/writing the new column. No "code deployed but column missing" or "column added but code still writing NULL" race window.

**Backfill by content, not by calendar date.** Migration 0012 used `date(created_at/1000, 'unixepoch') = 'YYYY-MM-DD'` to match learnings rows to pieces — works because Learner + Drafter-reflection run within seconds of publish, same calendar day. For Zita messages that pattern fails: readers arrive on their own cadence, and User 5bcf333c's entire conversation about airline jet fuel (2026-04-19 piece) happened on 2026-04-20. Every row was hand-mapped by reading content against the five pieces' headlines. User fb906615 split into three segments by created_at boundaries chosen to fall inside the 55-hour and 21-hour silent gaps between their QVC / Hormuz / tariffs reading sessions. Full mapping, including per-user evidence, lives in [`migrations/0013_zita_messages_piece_date.sql`](../migrations/0013_zita_messages_piece_date.sql) as commented UPDATEs.

**Snapshot before UPDATE.** `CREATE TABLE zita_messages_backup_20260421 AS SELECT * FROM zita_messages;` runs as Step 0 of the backfill — 92-row free rollback, one line, zero downside. Queued for drop on or after 2026-04-28 in FOLLOWUPS once Commit B has been live for a week. Rollback path (if Step 3 distribution is wrong): `DELETE FROM zita_messages; INSERT INTO zita_messages SELECT * FROM zita_messages_backup_20260421;` then revise the mapping.

**Non-goals:**
- No change to the Zita system prompt in this commit. Prompt change ("You are discussing the piece titled …, published …") lives in Commit B, because it reads `piece_date` at request time.
- No deletion of legacy lesson-course conversations. `course_slug='lessons'` rows (if any future path re-enables them) will continue to work with `piece_date=NULL`.
- No backfill of `zita_messages_backup_*` snapshots retroactively for past migrations — this is a one-off safety net for the hand-mapped backfill.

**References:** [migrations/0013_zita_messages_piece_date.sql](../migrations/0013_zita_messages_piece_date.sql), [docs/SCHEMA.md](SCHEMA.md) (zita_messages section + migrations summary), [docs/FOLLOWUPS.md](FOLLOWUPS.md) ("[open] 2026-04-21: Drop `zita_messages_backup_20260421` snapshot"). Plan file: `~/.claude/plans/could-please-do-a-harmonic-waffle.md`.

---

## 2026-04-20: Drop StructureEditor's writeLearning calls

**Context:** FOLLOWUPS 2026-04-20 "StructureEditor writes violation-shaped observations into learnings, not forward-going lessons" flagged that the 2026-04-17 per-piece drawer surfaces raw audit diagnostics ("Hook exceeds one screen - it's two full paragraphs with ~120 words") next to lesson-shaped prose from Learner and Drafter-reflection. The FOLLOWUPS framed two options — (1) retune SE's prompt to emit lesson-shaped prose, or (2) drop SE's writeLearning calls entirely since Learner.analysePiecePostPublish covers the ground from the same source data.

**Investigation (2026-04-20):** Pulled the 4 StructureEditor rows written for 2026-04-17 QVC and the 5 Learner producer rows written for 2026-04-20 Hormuz and compared qualitatively. Three findings:

1. **Learner reads `audit_results` in its post-publish synthesis.** SE's findings are *input* to Learner's generalisation pass — nothing SE sees is invisible to Learner.
2. **SE emits duplicates within a single audit.** 2 of 4 QVC rows said "hook exceeds one screen" — the auditor legitimately flags the same rule break multiple ways, but every flag becomes a separate learnings row. Learner post-publish compresses these into one generalised lesson.
3. **SE's rows teach Drafter rules Drafter already has.** "Lesson has 7 beats instead of the required 3-6 beats" is information the Structure Editor prompt already enforces as a gate. Surfacing it to Drafter via `getRecentLearnings(10)` adds zero signal over the existing voice contract + structure prompt.

Every piece published (including `qualityFlag='low'` ones under the "daily cadence > perfect catalogue" rule) reaches `analysePiecePostPublish`, so the hypothetical "SE catches things for pieces that don't publish" does not translate to any unique coverage in practice.

**Decision:** Option 2. Delete SE's writeLearning calls and the `result.issues`/`result.suggestions` loop. Keep `review()`'s return shape intact — Director and Integrator still use `{passed, issues, suggestions}` to gate publication and drive revision. The `pieceDate` parameter on `review()` (added for the writes on 2026-04-20 via the "Surfacing the learning loop" entry) is removed alongside, since it existed only for the writes we're removing. Director's single call site updated accordingly.

**Historical rows stay in D1.** The 4 QVC rows and any other SE writes on earlier pieces remain in the learnings table as honest historical record. Drafter's `getRecentLearnings(10)` reads newest-first, so they age out naturally as Learner + Drafter-reflection writes accumulate; no cleanup needed.

**Why not Option 1 (prompt retune):**
- Double-duty prompt (audit + lesson-writer) increases cognitive load per call and adds tokens.
- Models synthesise lessons better from the full quality record (post-publish) than from per-violation judgements (audit-time).
- Doesn't solve the within-audit duplicate problem.
- Still wouldn't add signal beyond what Learner already produces.

**What didn't change:**
- SE's audit behaviour — gate scores, issues, suggestions, return shape, Director's consumption. No behavioural change to the pipeline's publication decisions.
- The Structure Editor prompt (`structure-editor-prompt.ts`) — untouched.
- Learner, Drafter-reflect, or any other writer — untouched.
- `writeLearning` helper — still used by Learner.analysePiecePostPublish, Drafter.reflect, and the reader-side Learner path.

**FOLLOWUPS resolved:** 2026-04-20 "StructureEditor writes violation-shaped observations into learnings, not forward-going lessons".

**References:** [agents/src/structure-editor.ts](../agents/src/structure-editor.ts), [agents/src/director.ts](../agents/src/director.ts) (line 181 call site), [docs/AGENTS.md](AGENTS.md) (section 7).

---

## 2026-04-20: Remove /api/dashboard/today — unused since 2026-04-17

**Context:** FOLLOWUPS 2026-04-20 flagged `src/pages/api/dashboard/today.ts` as likely dead. Verification confirmed: zero runtime callers across `src/`, `scripts/`, `agents/`. The public dashboard (`src/pages/dashboard/index.astro`) queries D1 directly in Astro frontmatter; the admin dashboard uses its own client-side fetches against different endpoints; the built worker's `inlinedScripts` contain no reference. The endpoint's last commit (`b84de9e`, 2026-04-17) was itself a comment-only update whose message already named the consumer as gone: *"That path went away when the reader-facing tier moved to voiceScore + src/lib/audit-tier.ts."*

**Decision:** Delete the endpoint. Update RUNBOOK's verify step (line 154) to use a `wrangler d1 execute` query instead of `curl /api/dashboard/today`. Remove the line from RUNBOOK's public API list (line 217). Leave `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md:200` intact — handoff is frozen historical spec. Leave `docs/DECISIONS.md:556` intact — append-only convention; this new entry records the removal without editing the original 2026-04-17 "Soften quality surfacing" reference.

**Chose deletion over keeping for future external consumers.** The FOLLOWUPS investigation hints named the choice explicitly. Speculative API surface rots — three days of zero callers is already long enough that any hypothetical future consumer would be reading stale shape. Better to remove and rebuild against actual demand than maintain a ghost endpoint whose response contract drifts from whatever the dashboard now considers canonical.

**Scope held.** Sibling endpoints (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) were not audited in this commit — logged as its own FOLLOWUP instead so the sweep can happen deliberately rather than piggybacking on a single-endpoint removal.

**FOLLOWUPS resolved:** 2026-04-20 "/api/dashboard/today.ts appears to be uncalled dead code".
**FOLLOWUPS added:** 2026-04-20 "Audit sibling dashboard API endpoints for the same dead-code pattern".

**References:** [docs/FOLLOWUPS.md](FOLLOWUPS.md), [docs/RUNBOOK.md](RUNBOOK.md).

---

## 2026-04-20: Surfacing the learning loop (Builds 1 + 2)

**Context:** P1.3 + P1.4 closed the write side of the self-improvement loop on 2026-04-19 — Learner and Drafter now write post-publish learnings. Nothing in the reader-facing UI exposed what was being learned. FOLLOWUPS 2026-04-19 "Surface producer-side learnings + self-reflection in the UI" queued the work pending enough real data to design against. The first real cron run at 2am UTC 2026-04-20 wrote 9 rows on the Hormuz piece (5 producer + 4 self-reflection) — enough density to ship.

**Decision:** Two surfaces, one commit each, sequenced:
- **Build 1 ([b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)) — dashboard "What we've learned so far" panel** on `/dashboard/`. Three counts (producer / self-reflection / total) plus the most recent observation as a blockquote with source attribution. New endpoint `/api/dashboard/memory`. Inserted between "How it's holding up" and "The agent team". Quiet visual register matching the rest of the dashboard — no animations, no toggles, no charts.
- **Build 2 ([a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)) — per-piece "What the system learned from this piece" section** in the How-this-was-made drawer on `/daily/[date]/`. Grouped by source in fixed order (Drafter self-reflection → Learner producer-side pattern → reader → zita). Hide-when-empty — absent entirely when the piece has no learnings, not just visually hidden. Required migration 0012 adding `learnings.piece_date TEXT`, plus a one-time backfill of 13 pre-migration rows (4 → 2026-04-17 QVC, 9 → 2026-04-20 Hormuz).

Source labels are shared across both surfaces — "Learner, producer-side pattern", "Drafter self-reflection", "Reader signal", "Zita question pattern" — so the vocabulary is stable across dashboard cross-piece view and per-piece drawer view.

**Operational notes:**
- `writeLearning` widened to require `pieceDate` going forward; same defensive non-null pattern as `source` from migration 0011. Both checks route through a shared `logMissingField` helper (renamed from `logSourceRegression` to cover both field warnings).
- Four writer call sites updated: `Learner.analysePiecePostPublish`, `Drafter.reflect`, `StructureEditor.review` (date threaded via one-line Director update since `review()` is stateless over mdx), `Learner.analyseAndLearn` (reader path — pieceDate derived from the daily-piece slug's YYYY-MM-DD prefix with a regex guard; malformed slug skips the write rather than inventing a date).
- Migration 0012's originally-prescribed correlated-subquery backfill (`SET piece_date = (SELECT … ORDER BY ABS(dp.published_at - learnings.created_at) …)`) failed on D1 with "no such column". Rewrote as two date-equality UPDATEs, one per affected piece_date. Same outcome for this data (every learning's `created_at` landed on the same calendar day as its piece's `published_at`) but not the same SQL. Migration file's comment block preserves both shapes for the historical record. See FOLLOWUPS 2026-04-20 "D1 correlated-subquery limitation".
- Migration apply hit a second, unrelated snag: `d1_migrations` was empty (prior migrations applied ad-hoc, bypassing the tracker), so wrangler tried to replay all 12 migrations and failed on 0009's `duplicate column name`. Recovered by manually inserting tracker rows for 0009–0011 and re-running apply — it then applied only 0012. Tracker is now in sync (12 rows, 0001–0012). See FOLLOWUPS 2026-04-20 "D1 migration tracker out of sync".

**Styling register — drawer vs dashboard:**
The drawer runs its own CSS namespace (`src/styles/made.css`, `made-*` prefix, not Tailwind-processed) while the dashboard Memory panel uses Tailwind utility classes. Decision: match each surface's existing register rather than unify. Three new classes added to `made.css` (`.made-learning-group`, `.made-learning-group-title`, `.made-learning`) recreate the italic-quote + gold-left-border visual rhythm inside the drawer's standalone CSS, without pulling Tailwind into the drawer.

**Grouping order within the drawer section:**
Fixed (not data-driven): Drafter self-reflection first, Learner producer-side pattern second, reader third, zita fourth. Rationale: self-reflection reads as narrative first-person critique — more reader-interesting; producer/reader/zita are progressively terser and more system-y. Readers clicking "What the system learned" find the most human-voiced material first.

**Alternatives considered:**
- **Flat list with per-row source attribution** (instead of grouping). Rejected per the Build 2 handoff which explicitly called for grouping; also the 2026-04-20 piece has 9 rows across two sources and grouping makes the tonal shift between Drafter reflection and Learner pattern visually obvious.
- **Pull the drawer into Tailwind.** Rejected — bigger change than this commit warranted, and the drawer's `made.css` standalone convention matches `beats.css` / `zita.css` deliberately.
- **Inline explanatory copy under the drawer's section heading** (mentioning the dashboard Memory panel as a pointer). Drafted, then struck per Zishan's feedback: the section heading + group labels + observations do the work silently; adding "Zeemish explaining Zeemish to Zeemish" is the kind of self-reference the voice contract avoids. If a later session discovers confusion, can be added then.

**Data observation worth naming:**
The 2026-04-17 drawer shows 4 StructureEditor-origin producer learnings, all of which read as audit violations ("Hook exceeds one screen…") rather than forward-going lessons. That's faithful to what StructureEditor actually writes — logged as its own followup ("StructureEditor writes violation-shaped observations into learnings"). Honesty over prettiness; retune when next retuning StructureEditor.

**Loop status after the two builds:**
- Producer signal → Drafter: wired end-to-end (P1.3), now reader-visible.
- Self-reflection → Drafter: wired end-to-end (P1.4), now reader-visible.
- Reader signal → Drafter: scaffolded but dormant (no readers yet); surface ready to render when rows land.
- Zita signal → Drafter: not yet (P1.5); surface ready.

**FOLLOWUPS resolved:** 2026-04-19 "Surface producer-side learnings + self-reflection in the UI".

**References:** [src/pages/api/dashboard/memory.ts](../src/pages/api/dashboard/memory.ts), [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro), [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts), [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts), [src/styles/made.css](../src/styles/made.css), [migrations/0012_learnings_piece_date.sql](../migrations/0012_learnings_piece_date.sql), [agents/src/shared/learnings.ts](../agents/src/shared/learnings.ts), [docs/AGENTS.md](AGENTS.md), [docs/SCHEMA.md](SCHEMA.md).

---

## 2026-04-19: Drafter self-reflects post-publish (P1.4)
**Context:** Writers generate qualitative signal in their heads while they work — what felt thin, where the research was thinner than the writing made it sound, which beat took the most rewrites, what they'd do differently next time. Publication-time audits (voice/structure/fact) capture the *gated* signal; the honest post-hoc judgment is separate and valuable. Reader-side engagement data doesn't exist yet (no readers), and producer-side pipeline metrics (P1.3) don't capture this flavour of signal. A one-shot Sonnet call asking the Drafter role to review its own output gives the Learner a qualitative feed from day 1.

**Decision:** After every `publishing done`, Director fires `Drafter.reflect(brief, mdx, date)` off-pipeline via `this.schedule(1, 'reflectOnPieceScheduled', ...)`. The call re-reads the committed MDX from GitHub (same pattern as the audio alarm), carries the original brief in the alarm payload so the prompt has both "what was asked" and "what was produced", and writes up to 10 learnings with `source='self-reflection'`.

**Prompt shape — deliberate:**
- **Opens by naming the stateless reality.** "You didn't write this piece — a prior invocation with this same role did. You're being asked to review it as the same role would, with honest post-hoc judgment. Don't LARP memories; evaluate what's on the page." Without this framing the model tends to fabricate remembered struggle; with it, the model evaluates the piece as a peer editor would. Constraint from Zishan, carried verbatim in intent.
- **Specific in the ask.** "What felt thin? Which topic were you stretching on where the research was thinner than the writing made it sound? Which beat would have taken the most rewrites? If you wrote a follow-up tomorrow, what would you do differently?" Generic "reflect on this piece" prompts produce generic hedging output; specificity forces substance.
- **Explicit bans on review-speak.** "No hedging. No 'overall the piece was strong' throat-clearing. No summaries of what the piece did. Write like you're telling a trusted editor what actually happened." The bullets we want are the ones a writer wouldn't put in a revision note.
- **Output contract mirrors P1.3's `LEARNER_POST_PUBLISH_PROMPT`:** `{learnings: [{category, observation}]}`. Category normalisation + fallback same as Learner (unknown → `structure`). This is so the three origins (producer / reader / self-reflection) compound into one feed that Drafter's `getRecentLearnings(10)` reads without any slicing logic.
- **User message includes brief + final MDX only.** No scores, no round counts. Scores anchor the model's judgment to a number and invite review-speak; we want unprompted post-hoc reflection on the writing itself.

**Operational constraints — per Zishan:**
- **Non-retriable on failure.** `Drafter.reflect` throws on Claude/JSON errors; Director catches in `reflectOnPieceScheduled`, logs via `observer.logReflectionFailure(date, title, reason)`, and returns. No retry logic. The piece is live; a missed reflection isn't catastrophic.
- **Cap writes at 10 per run.** Same constant semantics as P1.3 (`REFLECTION_WRITE_CAP = 10` in drafter.ts, mirroring `PRODUCER_LEARNINGS_WRITE_CAP`). If the call produces more than 10, it's restating the same pattern — tightening the prompt is the fix, not raising the cap. Overflow is surfaced in the metered observer event.
- **Metered on every run.** Director calls `observer.logReflectionMetered(date, title, {written, overflowCount, considered, tokensIn, tokensOut, durationMs})`. This is the one Sonnet call in the pipeline that doesn't gate anything — so if it silently grows in cost over time (model produces longer reflections, MDX grows, whatever), we want visibility before it matters. Not a hard cap, just a breadcrumb. Info severity so it doesn't clutter the admin feed; the warn/escalation budget stays for actual failures.

**Alarm ordering:**
Both P1.3 (`analyseProducerSignalsScheduled`) and P1.4 (`reflectOnPieceScheduled`) fire at `this.schedule(1, …)`, then audio fires at `this.schedule(2, …)`. The Agents SDK alarm queue serialises them on the same DO; no races because the DO is single-threaded. Order within the same second isn't guaranteed but doesn't matter — neither depends on the other.

**Alternatives considered:**
- **Fire inline after Integrator's final pass (pre-publish).** Rejected. Consistency was the decisive argument: keeping the post-publish learning machinery behind a single boundary (alarm → scheduled method) for both Learner and reflection means disabling or debugging either is one code path, not two. Also: Claude is stateless between calls, so there's no memory-freshness benefit to firing pre-publish.
- **Single combined scheduled method that calls both Learner and Drafter.reflect.** Rejected. Two independent signals with independent failure modes; separate methods means one can go wrong without affecting the other. Alarm queue handles ordering for free.
- **Pass final MDX in the alarm payload instead of re-reading from GitHub.** Rejected. Payload size discipline — Phase F audio work established the "re-read from GitHub" pattern for exactly this reason.
- **Hard cap on reflection tokens or cost.** Rejected for v1 — user preference is visibility first, enforce later if drift actually happens.

**Loop status after P1.4:**
- Producer signal → Drafter: wired end-to-end (P1.3).
- Self-reflection → Drafter: **wired end-to-end.** `reflect()` → `learnings (source='self-reflection')` → `getRecentLearnings(10)` on the next run.
- Reader signal → Drafter: scaffolded but dormant (no readers yet).
- Zita signal → Drafter: not yet (P1.5).

**Verification:** Unit-tested the prompt builder — system prompt opens with the stateless-reality line, contains all the specific-ask language (be honest, what felt thin, stretching, three-to-six bullets, no hedging, no throat-clearing), carries the JSON contract; user message includes brief + full MDX but omits scores/round counts. Type-check on agents workspace: 33 pre-existing errors, 33 after. Behaviour will first exercise tonight's 2am UTC cron — expect one `Reflection: <title>` info event in observer_events per publish, with tokens-in/out + latency.

**References:** [agents/src/drafter.ts](../agents/src/drafter.ts) `reflect()`, [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts) `DRAFTER_REFLECTION_PROMPT` + `buildDrafterReflectionPrompt`, [agents/src/director.ts](../agents/src/director.ts) `reflectOnPieceScheduled`, [agents/src/observer.ts](../agents/src/observer.ts) `logReflectionMetered` + `logReflectionFailure`, [docs/AGENTS.md](AGENTS.md) DrafterAgent section.

## 2026-04-19: Learner writes producer-origin learnings post-publish (P1.3 — behaviour)
**Context:** Plumbing for the `source` column landed in the previous commit ([DECISIONS entry elided — see migration 0011 + writeLearning signature change]). This commit turns it on. The Learner has been reader-engagement-only since launch; since no readers exist on daily pieces yet, the learnings feed the Drafter reads has been narrow (mostly StructureEditor's auditor-time writes). Producer-side signal — which auditor findings recurred, which candidate Curator picked vs the 49 it skipped, how many revision rounds a piece needed, what the final voice score was — was visible to the Director in `audit_results` + `pipeline_log` + `daily_candidates` but never flowed into the learning loop.

**Decision:** After every `publishing done`, Director fires `Learner.analysePiecePostPublish(date)` off-pipeline via `this.schedule(1, 'analyseProducerSignalsScheduled', ...)`. The Learner reads the full quality record for the date, sends a compact context to Claude (Sonnet 4.5), parses a strict JSON response `{learnings: [{category, observation}]}`, and writes the first 10 rows with `source='producer'`. Drafter's `getRecentLearnings(10)` from P1.1 then picks these up on the next run.

**Design choices — explicit:**
- **Trigger at `publishing done`, not `audio-publishing done`.** Producer-side signal is complete the moment text is live — the revision rounds, voice score, candidates picked vs skipped are all settled. Audio lands in its own separate signal category (audio-producer failures, character budgets) that can flow through a future hook without waiting for audio to bind to text. Firing earlier means tomorrow's Drafter starts benefiting from today's lessons ~2 minutes sooner, which matters at zero cost.
- **Off-pipeline, non-blocking.** `this.schedule(1, ...)` not `await learner.analysePiecePostPublish(...)` directly. The piece is already live; the learning is nice-to-have, and must never delay publishing.
- **Non-retriable on failure.** If Claude errors, JSON is malformed, or D1 chokes, Director's `analyseProducerSignalsScheduled` logs to `observer_events` via `observer.logLearnerFailure(date, title, reason)` and returns. No retry loop. The piece is live; a missed batch of learnings isn't catastrophic and retry logic is exactly the kind of defensive code that turns into mystery failures later — deliberate constraint from Zishan.
- **Cap writes at 10 per run; log overflow.** Learner slices `.slice(0, 10)` and returns `overflowCount`. If >0, Director calls `observer.logLearnerOverflow(...)` as a warn event. Usually means the analysis restated the same pattern N ways — a cheap signal that the prompt needs tightening. Constant `PRODUCER_LEARNINGS_WRITE_CAP = 10` in [learner.ts](../agents/src/learner.ts) so the number is searchable.
- **Category normalisation, not constraint.** Claude's returned `category` is lowercased and matched against the four known values (voice / structure / fact / engagement). Anything else falls back to `structure` — a safe default because every prompt sees structure findings. No CHECK constraint, no throw; the `category` column's enum is a convention, not a contract.
- **Dedicated observer methods over reused `logError`.** `logLearnerFailure` (warn) and `logLearnerOverflow` (warn) surface with specific titles in the admin feed rather than generic "Error: learner-post-publish" noise. Small observability win; ~15 lines in `observer.ts`.

**Alternatives considered:**
- **Hand the Learner its own alarm loop with per-piece retry.** Rejected per Zishan's non-retriable constraint. Dead simple to add later if the failure rate turns out to warrant it — for now, silence on failure is fine.
- **Write from the Director directly, skip the LearnerAgent subagent hop.** Rejected — agents own their own prompts and state. The Learner is already the right place to think about learnings; routing producer signal through the same agent keeps the "watch everything, write to learnings" concept honest.
- **Trigger at `done done` (final step) instead of `publishing done`.** Rejected — `done done` fires one log-line after `publishing done` with no new information. Earlier is strictly better.
- **Deeper quality record (include full MDX body, entire pipeline_log payloads).** Rejected for v1. Context is already ~3-10KB for a typical piece; adding the MDX body would triple it for marginal extra signal. If a specific learning needs body context, add it selectively.

**Loop status after P1.3:**
- Producer signal → Drafter: **wired end-to-end.** Post-publish Learner → `learnings (source='producer')` → Drafter's `getRecentLearnings(10)` on the next run.
- Reader signal → Drafter: scaffolded but dormant (no readers yet).
- Self-reflection → Drafter: not yet (P1.4).
- Zita signal → Drafter: not yet (P1.5).

**Verification:** Type-check on agents workspace — 33 errors before, 33 after (all pre-existing Agents-SDK inference issues in server.ts; zero from the changes in this commit). Behaviour will first exercise tonight's 2am UTC cron: after `publishing done`, a `analyseProducerSignalsScheduled` alarm fires; on success, 0–10 rows land in `learnings` with `source='producer'`; on failure, a warn event titled "Post-publish learnings missed: …" appears in observer_events.

**References:** [agents/src/learner.ts](../agents/src/learner.ts) `analysePiecePostPublish`, [agents/src/learner-prompt.ts](../agents/src/learner-prompt.ts) `LEARNER_POST_PUBLISH_PROMPT`, [agents/src/director.ts](../agents/src/director.ts) `analyseProducerSignalsScheduled`, [agents/src/observer.ts](../agents/src/observer.ts) `logLearnerFailure` + `logLearnerOverflow`, [docs/AGENTS.md](AGENTS.md) LearnerAgent section.

## 2026-04-19: Drafter reads learnings at runtime (P1.1 — closing the self-improvement loop)
**Context:** Twelve of thirteen agents have been running identical prompts every day since launch. The `learnings` table was effectively write-only — StructureEditor and Learner wrote into it, but no agent's runtime prompt read from it. That meant every day started from scratch regardless of what prior pieces taught us. The self-improvement loop existed in principle only.

**Decision:** Drafter now reads the 10 most recent rows from `learnings` at runtime and includes them in its user-message prompt as a "Lessons from prior pieces" block, positioned between the Voice Contract and the Brief. This is the first closing of the loop — from here, every subsequent Drafter run sees what the system has learned.

**Design choices — explicit:**
- **Recency-only, no relevance scoring.** `getRecentLearnings(DB, 10)` orders by `created_at DESC` across all categories (structure, voice, engagement, fact — and forthcoming producer / self-reflection / zita). Recency is a cheap, defensible v1. Relevance scoring (tag match against the brief's underlying subject, confidence-weighted) is a later refinement if the recency-only feed proves noisy.
- **No source filter.** Deliberate. When P1.3 adds a `source` column (reader / producer / self-reflection / zita), the default Drafter query still pulls all origins — we want the producer-side signal to compound with reader signal, not be quarantined. Category-filtered reads remain available by adding a separate function; the bare `getRecentLearnings` intentionally widens.
- **Block is semantically named.** "Lessons from prior pieces" — not "Additional context" or "Notes". Block names shape how Claude weights the content; a vague name invites the model to treat the block as decorative.
- **Voice contract still wins on conflict.** Explicit line in the block: "These lessons guide. The voice contract binds. If they conflict, the contract wins." A learning that says "try hedging more" cannot override the voice contract's "no hedging" rule.
- **Empty-state omits the block entirely.** No "No learnings yet" placeholder. On day 1 of the closed loop, the Drafter prompt is identical to its pre-P1.1 shape. The block only appears once something has been written.
- **Fail-open on DB read.** A D1 hiccup must not block a draft. `getRecentLearnings` is wrapped in try/catch; on failure, learnings = [] and the block silently absents itself.

**Alternatives considered:**
- **System-prompt inclusion.** Rejected. System prompts are static cache-friendly artifacts; runtime learnings belong in the user message alongside the brief, where they're contextual to the specific task.
- **Per-category rotation.** Rejected. A reader of the prompt should see the full current-truth, not a curated slice.
- **Confidence filtering (only learnings with confidence ≥ N).** Rejected for v1. Low-confidence learnings are still information; Claude can weight them by the `[category]` prefix and the observation text itself.

**Loop status after P1.1:**
- Producer signal → Drafter: **wired** (pending P1.3 to start writing producer-side rows — until then the feed is mostly StructureEditor's existing writes).
- Self-reflection → Drafter: not yet (P1.4).
- Reader signal → Drafter: not yet (P1.5 + no readers yet).
- Zita signal → Drafter: not yet (P1.5 + no Zita traffic yet).

**Verification:** Unit-tested `buildDrafterPrompt` with (a) empty learnings — block absent, no "contract wins" sentinel, (b) 3 learnings across 3 categories — block present, all 3 observations included, ordering `Voice Contract` → `Lessons` → `Today's Brief`. Type-check on the agents workspace shows zero new errors (33 pre-existing, 33 post — all unrelated Agents SDK inference issues in server.ts).

**References:** [agents/src/drafter.ts](../agents/src/drafter.ts), [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts), [agents/src/shared/learnings.ts](../agents/src/shared/learnings.ts), [docs/AGENTS.md](AGENTS.md) Drafter section.

## 2026-04-19: Frontmatter edits permitted for display-layer fixes (`beatTitles` map)
**Context:** Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`). `rehype-beats.ts` humanises these for display at build time (`qvcs-original-advantage` → "Qvcs Original Advantage"). That round-trip is lossy: apostrophes, colons, and acronym casing the kebab form can't express are gone by the time the display string is generated, so pieces render headings like "Qvcs Original Advantage" instead of "QVC's Original Advantage" and "Teaching 1 The Fuel Equation" instead of "Teaching 1: The Fuel Equation". The display-layer plugin alone can't recover punctuation that was never in the MDX.

**Decision:** Add an optional `beatTitles` frontmatter map — `{ beatSlug: "Human Display Title" }` — that `rehype-beats` prefers over `humanize(slug)`. Retroactively apply to pieces where the default humanise produces wrong output. Leave the Drafter-authored body untouched.

**Permanence rule carve-out:** Per the existing precedent for `audioBeats`, `voiceScore`, and `qualityFlag` (see `metadata_vs_content` memory + publisher.ts:25-29 "Metadata carve-out" comment), frontmatter edits are metadata, not content. `beatTitles` joins that set. The MDX body — the piece's teaching — stays byte-for-byte identical. This explicitly permits editing published pieces' frontmatter when the change is a display-layer fix that can't be expressed any other way.

**Alternatives considered:**
- **Fix Drafter going forward to write human headings into MDX (`## QVC's Original Advantage`).** Rejected as the primary fix because it leaves the three already-published pieces mangled forever under the permanence rule. Still worth doing in parallel for future pieces, and rehype-beats already handles non-kebab headings correctly via the `isKebabOnly` branch. Tracked separately.
- **Teach humanize() to recognise known acronyms (QVC, USA, NATO).** Rejected as too narrow and too magic — a heading like `qvcs-original-advantage` needs both an acronym-detect and a punctuation-insert (`'s`), and generalising that is a larger problem than the fix deserves.
- **Add a separate per-beat YAML block with display fields (e.g. `beats: [{slug, title, audio}]`).** Rejected as scope creep — `audioBeats` already exists as a separate map and mirroring that shape for titles keeps the additions parallel and small.

**Scope of retroactive apply (2026-04-19):**
- 2026-04-17: `qvcs-original-advantage` → "QVC's Original Advantage". Also corrected `beatCount: 6` → `beatCount: 8` (Drafter-declared count drifted from actual `##` count — separate known issue in CLAUDE.md Remaining minor items, fixed on this piece as a metadata-only correction since we were touching frontmatter anyway).
- 2026-04-18: not needed — `humanize()` produces correct output for all its headings.
- 2026-04-19: four `teaching-N-*` headings → "Teaching N: ..." (restore colons + lowercase "and" in the second).

**References:** [src/lib/rehype-beats.ts](../src/lib/rehype-beats.ts), [src/content.config.ts](../src/content.config.ts), CLAUDE.md "Remaining minor items" → beatCount drift entry now updated.

## 2026-04-19: Revert 02882fd — audio double-publish corrupted frontmatter
**Context:** Retro audio generation for 2026-04-17 via admin Continue button produced two `audio-publishing done` events — 543651b (valid) and 02882fd (corrupted). The second commit deleted the audioBeats map and collapsed `qualityFlag: "low"\n---\n` onto a single line, leaving the MDX with no YAML terminator. Live site unaffected (still serving cached HTML built from 543651b), but next deploy would have built from the corrupted state.

**Decision:** `git revert 02882fd`. Smallest safe action — preserves history, doesn't hide the bug. Audio data in D1/R2 is intact; only the MDX frontmatter splice got mangled.

**Root cause NOT fixed here.** Two stacked bugs (Publisher.publishAudio non-idempotent on second call + Director Continue path firing full re-run instead of resuming) tracked in [docs/FOLLOWUPS.md](FOLLOWUPS.md). Out of today's improvement-plan scope. Tonight's 2am UTC cron is a fresh pipeline (not a retry), so it's unaffected by the Continue-path trigger; tomorrow's piece should land clean.

**References:** [docs/FOLLOWUPS.md](FOLLOWUPS.md) 2026-04-19 entries, [agents/src/publisher.ts:230-247](../agents/src/publisher.ts:230) (spliceAudioBeats), [agents/src/director.ts](../agents/src/director.ts) retryAudio.

## 2026-04-18: Ship as-is despite security-header gap on prerendered HTML (LAUNCH)
**Context:** zeemish.io custom-domain swap completed. All security-critical surfaces (`/dashboard/`, `/account`, `/login`, `/api/*`, `/auth/*`, `/audio/*`) are returning all 6 security headers — confirmed via curl. But the public read-only pages (`/`, `/daily/*`, `/library`) still return without security headers and with Cloudflare's default `cache-control: public, max-age=0, must-revalidate`. Three workarounds attempted in sequence (run_worker_first=true → middleware Cache-Control no-store on HTML → post-build.sh overriding _routes.json to include /*) all failed: Cloudflare Workers Static Assets serves `.html` files directly from the asset binding, bypassing the worker entirely, regardless of all three settings. Verified: `_routes.json` IS deployed correctly (`curl https://zeemish.io/_routes.json` shows the override), and the worker IS running for non-HTML routes (the new cache-control lands on `/dashboard/`).

**Decision:** Launch zeemish.io to the public with this gap. Document it explicitly. Move on. Don't keep iterating.

**Reason — risk analysis:**
- The pages missing headers are read-only HTML with no auth, no forms, no cross-origin fetches, no third-party scripts beyond a Google Fonts preconnect
- Headers we'd want on them are CSP (mostly to constrain what the page can fetch — moot, it doesn't fetch anything cross-origin), X-Frame-Options (clickjacking — there's no sensitive UI to overlay), X-Content-Type-Options (MIME sniffing — only matters for content the browser would mis-execute, irrelevant for static HTML)
- The realistic residual risk is clickjacking. For a public reading site with no actions, that's a low-impact vulnerability. An attacker iframing a Zeemish daily piece to overlay something else achieves nothing — there's nothing to phish, no buttons to mis-click into a transaction
- The auth surfaces (where headers DO land) are the actual attack surface. Those are hardened
- Fixing this would require either (a) a Cloudflare Transform Rule (UI work, splits config), or (b) making prerendered pages server-rendered (loses prerender perf benefit, every request re-renders MDX through worker). Neither change is worth blocking launch for
- The user explicitly weighed this and chose to ship: "I dont think its too much of a big risk as they are read only pages not like admin pages that already rendered on the server side"

**Reason — why this matters as a documented decision:** Future-me or future-them will discover the missing headers in a security scan or audit and want to know whether this was an oversight or a deliberate trade-off. It was deliberate. The path to close the gap is in `Remaining minor items` in CLAUDE.md.

**Lessons captured for next time:**
1. Cloudflare Workers Static Assets has surprising precedence over worker-side configuration. `run_worker_first` and `_routes.json` `include` patterns are not the safety net you'd expect for `.html` files. If you need headers on static HTML, plan for it from the start — either prerender to dist with build-time HTML transformation, or use Cloudflare Transform Rules from day one.
2. Don't trust `cf-cache-status: HIT` to mean "old cache, will fix on next purge." It can also mean "Cloudflare is serving the asset directly without any cache logic running." Distinguish via cache-bypass tests on routes you KNOW are server-rendered.
3. Custom-domain swaps need at least one Cloudflare cache purge after the bind. Future-proof: add a `gh workflow_dispatch` step that calls Cloudflare's purge API after each deploy. Or set Cache Rules in the dashboard to `bypass` for HTML.

**Launch state captured at git tag `v1.0.0`.**

**References:** [src/middleware.ts](../src/middleware.ts), [scripts/post-build.sh](../scripts/post-build.sh), [wrangler.toml](../wrangler.toml), CLAUDE.md "Critical lesson — Cloudflare Workers Static Assets" + "Launch (2026-04-18 — v1.0.0)".

## 2026-04-18: Override Astro Cloudflare adapter's _routes.json (post-launch hotfix)
**Context:** zeemish.io went live via custom domain swap. Smoke test on the live domain showed `cf-cache-status: HIT` and zero security headers on `/`, `/daily/*`, `/library` — but headers ARE present on `/dashboard/`, `/api/*`, `/audio/*`. Three Cloudflare cache purges didn't fix it. Diagnosis: the Astro Cloudflare adapter auto-generates `dist/_routes.json` with prerendered paths in the `exclude` list, which tells Cloudflare to serve those files directly from Static Assets WITHOUT invoking the worker. `run_worker_first = true` in wrangler.toml is overridden by this exclude list — Cloudflare honours `_routes.json` first.

**Decision:** Add `scripts/post-build.sh` that overwrites `dist/_routes.json` after `astro build` runs. New file routes ALL paths through the worker via `include: ["/*"]`, with only true static assets (`/_astro/*` bundled JS/CSS, `/og-image.svg`, `/robots.txt`) in `exclude`. This makes the middleware-applied security headers reach prerendered HTML.

**Alternatives considered:**
- **Adapter `routes.extend.include` config option.** Documented per the adapter type defs. Rejected because the docs explicitly say "exclude always takes priority over include" — and the adapter's auto-generated excludes already list every prerendered path. Adding to include doesn't unlist them.
- **Cloudflare Transform Rules in dashboard.** Would work and apply to ALL responses regardless of cache state. Rejected because (a) splits header config between code and Cloudflare UI, (b) requires manual setup, (c) would re-apply on every domain swap. Code-side fix is portable.
- **Make `/`, `/daily/[date]`, `/library` server-rendered (`prerender = false`).** Loses the prerender perf benefit (every request would re-render MDX through the worker). Rejected — overkill for a header problem.
- **Set `_headers` in `public/`.** Workers Static Assets does not honour `_headers` (that's a Pages-only feature). Already learned this in the morning's pass.

**Reason — why post-build script over adapter config:** The adapter has no exposed knob for the auto-exclude behaviour. A post-build script is a small, obvious, contained workaround that survives adapter upgrades. If the adapter ever adds a `routes.strategy` option, we can rip the script out without other changes.

**Cost:** All static-HTML requests now invoke the worker (~1-5 ms added per request). At our scale, negligible. The `Cache-Control: private, no-store` middleware sets on HTML means CDN won't cache HTML, so the worker runs on every request — but Workers are fast and the rendered HTML is tiny. Bundled JS/CSS (`/_astro/*`) still get edge-cached and served direct from assets, so performance for repeat visitors is preserved.

**References:** [scripts/post-build.sh](../scripts/post-build.sh), [src/middleware.ts](../src/middleware.ts) (the `applySecurityHeaders` content-type check), [package.json](../package.json) (build script), [wrangler.toml](../wrangler.toml) (`run_worker_first = true`). See CLAUDE.md "Critical lesson — Cloudflare Workers Static Assets" for the three-layer mental model that's needed to reason about this in future.

## 2026-04-18: Launch-readiness pass before zeemish.io domain swap
**Context:** About to retire the old `zeemish.io` (separate breathing-tools product) and bind `zeemish-v2` to the apex. Audited what was actually broken vs. what CLAUDE.md *claimed* was broken. CLAUDE.md "Remaining minor items" had drifted: site worker R2 binding and `/audio/*` route were already shipped, daily-piece engagement writes were already firing from `<lesson-shell>`, only the surface was missing. Real launch blockers turned out to be smaller and different.

**Decisions made in this pass:**

1. **Wire `audio_plays` engagement once-per-session.** `<audio-player>` knows when audio plays; `<lesson-shell>` owns the engagement HTTP. Bridge them with a `audio-player:firstplay` custom event (paused→playing transition, fires once per page load via `hasReportedFirstPlay` guard). Lesson-shell already had `trackEngagement('audio_play')` plumbing. Alternative considered: inline POST in audio-player. Rejected — duplicates URL-parsing logic for course_id/lesson_id that lesson-shell already does, and event-based keeps audio-player free of HTTP concerns.

2. **Surface engagement on admin via server-side query.** Admin is a `.astro` page with full D1 access — no need to call the JSON `/api/dashboard/analytics` endpoint client-side. One `GROUP BY lesson_id` query; rows render with the same Tailwind/eyebrow patterns as the All Pieces list. Each row deep-links to `/dashboard/admin/piece/{lesson_id}/`. The legacy `analytics.ts` endpoint is now unused but kept (could become useful for scripted admin tooling later).

3. **Move security headers from `public/_headers` into middleware + flip `run_worker_first = true`.** Cloudflare Workers Static Assets does not honour `_headers` (that's Cloudflare Pages, a different product). Live response had ZERO security headers despite a fully-populated `_headers` file. Middleware can apply headers — but only runs for requests that hit the worker, so prerendered pages (home, daily, library) were skipped. Two options: (a) copy headers into a build-time HTML transform, or (b) `run_worker_first = true` so the worker handles every request including static assets. Picked (b): one extra worker invocation per asset, negligible at our scale, single source of truth, no build-step gymnastics. Cost: paying ~1ms CPU per asset request that previously was free. Worth it for headers correctness across the full surface. `public/_headers` deleted to prevent future devs from trusting it.

4. **CSP simplified.** Old policy hard-coded `connect-src https://zeemish-agents.zzeeshann.workers.dev` because the live `_headers` was the model. New policy: `connect-src 'self'`. The site does NOT call the Agents worker from the browser — site→agents traffic uses the Cloudflare service binding (`[[services]]` in wrangler.toml) which is in-process, not a network fetch. Removing the workers.dev URL from CSP also avoids stale-domain rot once we move to zeemish.io.

5. **Documented Range-request bug as deferred minor item.** `/audio/*` route claims Range support but returns 200 with full body on `Range: bytes=0-1023`. Per-beat clips are small (~480KB) so browsers cope; deferring the fix until a real seek-bandwidth complaint arrives.

**Reason — why audit instead of just executing:** First instinct was "audio's broken, engagement's not tracked, fix both." Reading the code showed both were further along than CLAUDE.md indicated. The honest pre-launch list was much shorter (and different) than the claimed one. Lesson: trust code over docs when they disagree. Added to the launch process: walk CLAUDE.md against reality before any release.

**References:** [src/interactive/audio-player.ts](../src/interactive/audio-player.ts), [src/interactive/lesson-shell.ts](../src/interactive/lesson-shell.ts), [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro), [src/middleware.ts](../src/middleware.ts), [wrangler.toml](../wrangler.toml).

## 2026-04-18: Un-pause audio pipeline (ship-and-retry, metadata carve-out)
**Context:** Audio Producer + Audio Auditor had been paused since build (not wired into Director's pipeline, zero ElevenLabs spend possible by accident). Text pipeline was trusted; time to un-pause.

**Decision:** Wire audio in as a phase AFTER Publisher, not before. Ship text the moment Integrator approves. Run Audio Producer → Audio Auditor → `Publisher.publishAudio` (second commit splicing `audioBeats` into frontmatter) as a best-effort chase. Failures escalate to Observer; the admin piece-deep-dive page shows a "Retry audio" button that POSTs `/audio-retry` and re-runs the audio pipeline against the committed MDX.

**Reason — ship-and-retry over atomic:** The user framed it clearly: "have you seen a day where a newspaper didn't publish?" Strict atomic (block text publish on audio failure) would let ElevenLabs outages, Workers quirks, or a one-character typo in the transcript skip a day. A daily-cadence product can't afford that. Audio is a preferred-but-not-required enhancement. Text is the contract.

**Reason — metadata carve-out:** The `publishAudio` second commit modifies an already-published MDX file. A strict reading of CLAUDE.md's "Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece." forbids this. User's explicit clarification: the rule governs teaching **content** (beats, narrative, facts), not frontmatter **metadata** (voiceScore, qualityFlag, audioBeats). `publishToPath` still refuses to overwrite (content rule intact). `publishAudio` is the only metadata-update path.

**Decisions bundled in:**
- **Model:** stay on `eleven_multilingual_v2`. `eleven_v3` is alpha + audio tags, no prosodic stitching, wrong fit for calm teaching narration. Flash v2.5 is speed-not-quality.
- **Voice:** Frederick Surrey (`j9jfwdrw7BRfcR43Qohk`), added to "My Voices" to guard against shared-library removal.
- **Format:** `mp3_44100_96`. Indistinguishable from 128 for a single voice; ~25% smaller R2 + egress.
- **Pronunciation:** "Zeemish" → "Zee-mish" via `prepareForTTS` text substitution. SSML not supported; PLS dictionaries work on v2 only for alias rules, not IPA — text substitution is simpler and equivalent for one brand word.
- **Budget:** 20,000 chars/piece hard cap (`AudioBudgetExceededError`). Sized for a 12-beat newspaper-style piece (~$2/day at $0.10/1k chars). Checked pre-flight, before any API call.
- **Granularity:** per-beat MP3s. `<lesson-shell>` → `<audio-player>` sync lets readers jump to any beat; future 12-beat newspaper pieces work cleanly on this shape.
- **Retry:** Producer does 3-attempt exponential backoff internally on 5xx. 4xx fails fast (bad key, quota). Director escalates to Observer on any uncaught failure. Admin dashboard retry button re-runs the audio pipeline against the committed MDX.
- **Schema:** new `daily_piece_audio` table (per-beat rows) is the query source of truth. `daily_pieces.has_audio` boolean for fast dashboard filtering. Frontmatter `audioBeats` map is the render source of truth for the site. Both kept in sync by `Publisher.publishAudio`.

**References:** `migrations/0010_audio_pipeline.sql`, `agents/src/audio-producer.ts`, `agents/src/audio-auditor.ts`, `agents/src/director.ts` (`runAudioPipeline`, `retryAudio`), `agents/src/publisher.ts` (`publishAudio`), `src/interactive/audio-player.ts`, `src/components/AudioPlayer.astro`, `src/pages/audio/[...path].ts` (site worker's R2 audio route).

**Deploy-time gotcha learned 2026-04-18:** Cloudflare Static Assets intercepts unrecognised paths with the prerendered 404.html **before** the worker runs, so a middleware-only `/audio/*` handler never executed. Fix: register as a real Astro route (`src/pages/audio/[...path].ts`). Also: manual `wrangler deploy` from a local build can overwrite the auto-deploy from GitHub Actions if local state is out of sync (e.g., Publisher just pushed `audioBeats` to a piece's frontmatter on GitHub — `git pull` before rebuilding).

## 2026-04-16: Chose pnpm over npm
**Context:** Setting up the repo.
**Decision:** Use pnpm for package management.
**Reason:** Faster installs, strict dependency resolution, saves disk space. Recommended in the build guide.

## 2026-04-16: Astro output mode set to `static`
**Context:** Configuring Astro for Cloudflare deployment.
**Decision:** Use `output: 'static'` (not `server` or `hybrid`).
**Reason:** Stage 1 is a static site — no server-side rendering needed yet. Static is cheaper, faster, and simpler on Cloudflare. We'll switch to `hybrid` or `server` only when we need server-side routes (Stage 3).

## 2026-04-16: Zeemish brand colours as Tailwind theme
**Context:** Setting up Tailwind config.
**Decision:** Added `zee-bg`, `zee-text`, `zee-accent` as custom Tailwind colours.
**Reason:** Keeps the colour palette consistent across components. DM Sans set as default sans font to match brand.

## 2026-04-16: Handoff docs stored in docs/handoff/
**Context:** Planning documents from the architecture phase.
**Decision:** Copy all handoff docs into the repo at `docs/handoff/`.
**Reason:** Every future Claude Code session needs access to the architecture and build guide. Keeping them in the repo means no dependency on external file paths.

## 2026-04-16: Beats as Web Components, not Astro components
**Context:** Stage 2 — deciding how to build beat navigation.
**Decision:** Use native Web Components (`<lesson-shell>`, `<lesson-beat>`) for beat navigation.
**Reason:** Beat navigation requires client-side state (show/hide on click). Astro components are build-time only. Web Components give us progressive enhancement (all beats visible without JS) and zero framework dependency.

## 2026-04-16: Single Astro Worker instead of separate site + API workers
**Context:** Stage 3 — deciding whether to build a separate `worker/` API project.
**Decision:** Keep API routes inside Astro using `src/pages/api/` with the Cloudflare adapter.
**Reason:** Avoids CORS complexity, keeps one deploy target, simpler to develop. The architecture planned three workers but Astro handles both static and server routes natively. Can split later if scale demands it.

## 2026-04-16: PBKDF2 via Web Crypto API for password hashing
**Context:** Stage 3 — choosing a password hashing approach for Cloudflare Workers.
**Decision:** Use PBKDF2 (100k iterations, SHA-256) via the Web Crypto API.
**Reason:** Works natively in Workers runtime — no npm dependencies needed. bcrypt/argon2 would require WASM or npm packages. PBKDF2 with sufficient iterations is NIST-approved and adequate for our use case.

## 2026-04-16: Middleware only on server-rendered routes
**Context:** Stage 3 — Astro middleware was crashing on prerendered pages.
**Decision:** Auth middleware checks the URL path and only runs on `/api/`, `/account`, `/login` routes.
**Reason:** Prerendered pages don't have access to D1 at build time. The middleware creates anonymous users in D1, which can only run on server-rendered routes. Lesson pages call the API from the client side instead.

## 2026-04-16: Agents as a separate Worker
**Context:** Stage 4 — setting up the agent team.
**Decision:** The agents live in `agents/` as a separate Cloudflare Worker, not inside the Astro site.
**Reason:** The Astro adapter manages its own fetch handler. Agents need Durable Object bindings with their own wrangler.toml. Separate Workers with separate concerns. Zero cost when agents are hibernated.

## 2026-04-16: getAgentByName for RPC instead of stub.fetch()
**Context:** Stage 4 — routing HTTP requests to Durable Objects.
**Decision:** Use `getAgentByName()` from the agents SDK for typed RPC calls from the main fetch handler.
**Reason:** The Agent base class's `fetch()` method expects specific SDK headers (namespace/room). Direct RPC via `getAgentByName` gives typed method calls and avoids header confusion.

## 2026-04-16: Voice contract as TypeScript string, not .md import
**Context:** Stage 4 — agents need the voice contract text.
**Decision:** Duplicate the voice contract as a string constant in `agents/src/shared/voice-contract.ts`.
**Reason:** Wrangler's bundler has no loader for `.md` files. The canonical version stays at `content/voice-contract.md`; the TS copy is kept in sync manually.

## 2026-04-16: Agent-chosen lesson topics instead of following course spine
**Context:** Stage 5 — producing the first 12-lesson course.
**Decision:** Let the Curator agent choose lesson topics freely rather than following the original 12-lesson spine from the brief.
**Reason:** The Curator produces better, more engaging titles when given creative freedom. The original spine ("20,000 breaths", "The nose knows") was a planning guide, not a requirement. The agents produced titles like "Why you can't tickle yourself" which are more compelling and still cover the body course subject.

## 2026-04-16: Synchronous RPC instead of Cloudflare Workflows v2
**Context:** Stage 4 — implementing the publishing pipeline.
**Decision:** Use synchronous sub-agent RPC calls instead of Cloudflare Workflows v2.
**Reason:** Faster to ship. The pipeline works end-to-end as synchronous calls. Trade-off: no durable checkpoints, pipeline cannot survive Worker restarts mid-execution. Workflows v2 can be added later without changing the agent logic — just wrap the existing calls in `step.do()`.

## 2026-04-16: Zita API in Astro site worker, not agents worker
**Context:** Stage 7 — building the Zita chat guide.
**Decision:** Zita's API endpoint lives in the Astro site (`/api/zita/chat`) not in the agents worker.
**Reason:** Zita needs the user's session cookie (from the auth middleware) and their conversation history from D1. The Astro site already has both. Putting Zita in the agents worker would require cross-worker auth, adding complexity.

## 2026-04-16: Coerce estimatedTime schema to handle agent output
**Context:** Stage 5 — agent-authored lessons had `estimatedTime: 18` (number) instead of `"18 min"` (string).
**Decision:** Changed Zod schema to `z.coerce.string()` for `estimatedTime`.
**Reason:** Agent output varies. Coercing is more robust than trying to enforce exact format in agent prompts. Numbers become strings automatically.

## 2026-04-17: Frederick Surrey as the Zeemish voice
**Context:** Choosing an ElevenLabs voice for lesson audio.
**Decision:** Frederick Surrey — British, male, middle-aged, calm, narrative style.
**Reason:** Matches the Zeemish tone: calm, direct, warm but not performative. Zishan's choice.

## 2026-04-17: Audio failure doesn't block text publishing
**Context:** Wiring audio generation into the publishing pipeline.
**Decision:** If audio generation or audit fails, the text lesson still publishes. Audio failure is logged via Observer but doesn't block.
**Reason:** Audio is enhancement, not core. A published lesson without audio is better than a blocked lesson. Audio can be regenerated later.

## 2026-04-17: Audio generated once per lesson, served from R2
**Context:** Cost model for audio.
**Decision:** Generate MP3 once via ElevenLabs, store in R2 bucket. Readers stream from R2.
**Reason:** ~$5 per lesson to generate. $0 per play after that. R2 serving is essentially free at this scale.

## 2026-04-17: Cancel passphrase auth, keep magic link
**Context:** Architecture planned both passphrase (6 BIP39 words) and magic link as login options.
**Decision:** Cancel passphrase auth. Build magic link instead.
**Reason:** They solve the same problem — passwordless login. Magic link is simpler, universally understood, and pairs with the existing email upgrade flow. Passphrase is clever but adds complexity readers don't need.

## 2026-04-17: Resend.com for magic link emails
**Context:** Choosing an email provider for magic link delivery.
**Decision:** Use Resend.com (free tier: 100 emails/day).
**Reason:** Simple API (one fetch call), no npm deps, generous free tier. Using test domain for now (onboarding@resend.dev) — needs verified domain for production.

## 2026-04-17: Two-pass Fact-Checker with web search
**Context:** Fact-Checker was failing too often on claims it couldn't verify from training data alone.
**Decision:** Two-pass approach: (1) Claude identifies claims, (2) DuckDuckGo instant answers for unverified/incorrect claims, (3) Claude re-assesses with search results.
**Reason:** Adds real-world verification without external API dependencies. DuckDuckGo is free and doesn't require an API key. Not as deep as a full search engine, but catches obvious errors.

## 2026-04-17: Learnings written by StructureEditor, reviewed by Director
**Context:** Architecture Section 4.3 describes a cross-lesson consistency system.
**Decision:** StructureEditor writes observations to the learnings table when it finds patterns. Director reviews audit patterns after each autonomous run and logs recurring issues via Observer.
**Reason:** Starts the learning loop without over-engineering. Observations accumulate, the Director surfaces recurring problems, and Zishan can act on them.

## 2026-04-17: PublishLessonWorkflow for durable pipeline execution
**Context:** Pipeline was synchronous RPC — wouldn't survive Worker restarts.
**Decision:** Added PublishLessonWorkflow using Cloudflare Workflows v2 via agents SDK. Each pipeline step (curate, draft, audit, revise, audio, publish) is a durable checkpoint.
**Reason:** Durable execution is critical for a pipeline that takes 1-2 minutes. If the Worker cold-starts mid-pipeline, it resumes from the last completed step instead of starting over.

## 2026-04-17: Security hardening — 21 issues addressed
**Context:** Comprehensive security audit found 5 critical, 5 high, 7 medium, 4 low issues.
**Decision:** Fixed all critical and high issues in one pass.
**Changes:**
- Added `Secure` flag to session cookies
- Timing-safe password comparison (prevents timing attacks)
- Email uniqueness check on upgrade (prevents account hijacking)
- All agents endpoints now require ADMIN_SECRET auth (not just /trigger)
- CORS restricted to site domain (was `*`)
- Removed query parameter auth (secrets leak in logs)
- CSRF origin header check on all POST requests
- Rate limiting on Zita chat (20/15min), upgrade (5/15min)
- Input validation: message length limits, JSON try-catch on all endpoints
- Claude API errors no longer leaked to users
- Login response no longer includes user_id

## 2026-04-17: Daily Pieces system — news-driven teaching
**Context:** Zishan's vision: Zeemish should teach from today's news, every morning.
**Decision:** Added ScannerAgent (#14) + Director daily mode. Scanner fetches Google News RSS (free, no API key), Director picks the most teachable story, existing pipeline produces the piece.
**Reason:** Nobody does "today's news → today's 10-minute lesson on the underlying system." CNN gives you the news. Coursera gives you the education 6 months later. Zeemish gives you both, same morning.

## 2026-04-17: Google News RSS as first news source
**Context:** Choosing a news data source for the Scanner.
**Decision:** Google News RSS feeds (6 categories: TOP, TECH, SCIENCE, BUSINESS, HEALTH, WORLD).
**Reason:** Free, no API key, unlimited requests, covers global news. Can add NewsData.io, Guardian API, etc. later as v2 sources.

## 2026-04-17: CORS dynamic origin matching
**Context:** Agents CORS was hardcoded to workers.dev domain.
**Decision:** CORS now checks request Origin against an allowed list (workers.dev + zeemish.io). Added CORS preflight (OPTIONS) handler.
**Reason:** Workers.dev domain will change to zeemish.io in production. Dynamic matching handles both without code changes.

## 2026-04-17: CSRF origin check uses URL parsing, not substring
**Context:** Security audit found the CSRF check used `origin.includes(host)` which is bypassable.
**Decision:** Changed to `new URL(origin).host === host` for strict comparison.
**Reason:** Substring matching allows attacker domains that contain the host string. URL parsing is correct.

## 2026-04-17: Courses renamed to Library
**Context:** Daily pieces are now the primary content, not structured courses.
**Decision:** Rename Courses to Library. Library shows all daily pieces in reverse chronological order.
**Reason:** Courses imply a fixed curriculum. Library implies a growing collection. Daily pieces accumulate into the library naturally.

## 2026-04-17: "The body you live in" course removed
**Context:** Placeholder content from the old architecture before daily pieces existed.
**Decision:** Delete entirely — course metadata, all 12 lesson MDX files, course page routes.
**Reason:** Clean slate. No dead content on a live site.

## 2026-04-17: Dashboard rebuilt as admin control room
**Context:** Running an autonomous agent pipeline without visibility is dangerous.
**Decision:** Full dashboard rebuild with pipeline status, recent pieces table, observer events, engagement data, manual trigger.
**Reason:** You can't run a system you can't see.

## 2026-04-17: Zeemish Protocol established
**Context:** Zishan defined Zeemish's purpose in one line.
**Decision:** "Educate myself for humble decisions" is the founding protocol. Added to voice contract, site footer, and CLAUDE.md.
**Reason:** Every agent, every piece, every design choice serves this purpose. It's the answer to "why does this site exist?"

## 2026-04-17: Reviser does NOT revise published pieces
**Context:** Zishan clarified that published pieces are permanent records.
**Decision:** Reviser's role changed from "propose revisions to existing pieces" to "analyse engagement patterns and write learnings for future pieces." It feeds the learnings database only.
**Reason:** Published content is a permanent record. The way to improve is not to rewrite the past but to make the future better. The Drafter reads learnings when writing new pieces — that's the improvement loop.

## 2026-04-17: Reviser renamed to Learner
**Context:** "Reviser" implies changing published content. It doesn't do that.
**Decision:** Rename ReviserAgent to LearnerAgent. "Learns from reader behaviour to make future pieces better."
**Reason:** The name should match the job. It learns. It doesn't revise.

## 2026-04-17: Merge EngagementAnalyst + Reviser into LearnerAgent
**Context:** Two agents doing related work — one watched engagement, the other extracted learnings. Unnecessary separation.
**Decision:** Merge into one LearnerAgent. It watches reader engagement (completions, drop-offs, audio vs text) AND writes patterns into the learnings database. 13 agents total now (12 public + Observer internal).
**Reason:** Simpler. One agent owns the entire "learn from readers" responsibility. Fewer moving parts.

## 2026-04-17: Restore Curator + Drafter as separate agents; Director becomes a pure orchestrator
**Context:** A prior refactor merged Curator and Drafter into Director "temporarily" — migration `v10` deleted their Durable Object classes. Director ended up doing four jobs (orchestrate, curate, draft, log-on-behalf-of-others) in one 308-line file. Documentation drifted to match the code ("11 agents") instead of the architecture ("13 agents"). "Paused" audio agents were a label, not a structural fact.
**Decision:** Restore `CuratorAgent` and `DrafterAgent` as separate Durable Objects with their own files, states, and prompt files (`curator-prompt.ts`, `drafter-prompt.ts`). Director becomes a pure orchestrator with zero LLM calls. Director's state splits into `status: 'idle' | 'running' | 'error'` + `currentPhase: DirectorPhase | null`. Audio agents stay paused — Director's pipeline does not reference them, so "paused" is now structural (cannot run by accident) rather than documentary.
**Reason:** Separation of concerns makes the system observable, debuggable, and replaceable. Each agent becomes a first-class row on the dashboard with its own status and last-run. A bug in drafting no longer takes down story selection. Swapping Drafter for a new version no longer risks touching Curator logic. Cost control on audio becomes a property of the wire diagram, not a promise in a README.
**Shipped in 3 PRs:** (1) scaffold empty stubs + DO bindings + migration v11; (2) migrate prompts and logic out of Director, rewrite Director to delegate; (3) sync CLAUDE.md, `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, public dashboard, admin `STEP_LABELS`.

## 2026-04-17: Decouple piece identity from publication date (planned, not yet implemented)
**Context:** After restoring Curator + Drafter and running a manual test trigger, a second piece for 2026-04-17 published cleanly through the pipeline — but Zishan could not view it on the site. Investigation showed the system treats "publication date" and "piece identity" as the same thing in three places:
1. URL routing: `src/pages/daily/[date].astro` uses `piece.data.date` as the URL param, so two pieces on the same date produce a URL collision — only one is reachable.
2. Director's guard: `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` treats "today has a piece" as "today is full".
3. Filename prefix `YYYY-MM-DD-slug.mdx` makes the date visually dominant, though the slug is what disambiguates on disk.

The D1 `daily_pieces` table itself does not enforce date uniqueness — the conflation lives in the surface and the guard, not in the data model. So the architecture is lying about a constraint that isn't real.

**Decision:** Multiple pieces per day is the product vision, not an edge case. "One per day" was a temporary scaffold. Next session: decouple piece identity from publication date.
- URL becomes `/daily/{slug}/` (or `/pieces/{slug}/` — TBD) instead of `/daily/{date}/`. Date stays as metadata, not identity.
- Director's guard changes from "date already claimed" to "slug already published" (dedupe by content, not time).
- `content/daily-pieces/` filename pattern stays — slug is already the unique piece, date is just a sort aid.
- Library + "today's piece" sections still sort/filter by date, but no longer require uniqueness.
- Backwards compatibility: existing `/daily/YYYY-MM-DD/` URLs need a redirect or fallback (decide in implementation).

**Reason:** Same principle as the Director refactor — the surface should match what the architecture actually wants to express. Date-as-identity baked a 1:1 constraint into URLs and pipeline logic that neither the data model nor the product goal needs. Fixing it unlocks multiple-pieces-per-day (6 or 12 stories eventually), safe manual re-triggers during development, and accurate library rendering when pieces share a date.

**Scope for next session:** Plan the fix in detail (including URL redirect strategy for existing pieces), then implement in stages similar to the agent refactor.

## 2026-04-17: One piece per day is the product — reverse the prior "decouple" plan
**Context:** The prior entry (same day) planned to decouple piece identity from publication date to support multiple pieces per day. On reflection, Zishan decided against drifting into that larger refactor. One piece per day is the product. Architecture stays as-is.

**Decision:** Keep date-as-identity in URL routing, Director's guard, and the filename pattern. Do NOT decouple. The prior decision stands as a possibility considered and rejected; this entry supersedes it.

**Reason:** "Don't drift." The agent-side refactor we just shipped was necessary architectural work. Chasing another large surface refactor on the same day would repeat the original mistake — reacting to a surfaced edge case by rewriting the system instead of confirming the product. One story a day is simple, understandable, and fits the Zeemish Protocol. The admin force-trigger created one accidental duplicate today (two pieces for 2026-04-17) — that's a dev-mode artifact, not an architecture problem.

**Consequence for the duplicate currently in the repo:** Two pieces exist for 2026-04-17 (`europe-led-coalition...` and `what-lagging-jet-fuel...`). Both published via Publisher. The URL can only reach one. Left in place for now; Zishan can delete the unwanted one by hand later if desired, or leave as a record of the first real Curator+Drafter run.

**Remaining work tied to this:** The admin force-trigger that bypasses the guard can still create dev-mode duplicates. That's acceptable during build. If it becomes annoying later, a simple fix is to make the force-trigger delete today's D1 row + MDX file before running, so the new piece replaces instead of duplicating. Not planned — listed here so it's not forgotten.

## 2026-04-17: Agent system hardening pass — principle alignment, no silent failures
**Context:** Audit of `agents/src/` found the pipeline structurally sound but drifting from two principles documented in `docs/AGENTS.md` and `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`: (1) "One prompt per agent, co-located in `{agent}-prompt.ts`" — followed only by Curator and Drafter, and (2) "no silent failure" — the fact-checker could return first-pass-only results when web search failed with nothing surfaced.

**Decision:** Ship an alignment pass — no behaviour change at the reader edge, no migrations, no API edits.

- Extracted inline prompts into dedicated files for voice-auditor, structure-editor, fact-checker, integrator, and learner (5 new `*-prompt.ts` files). Makes the Director's eventual prompt-edit approval surface (architecture §4.2) reviewable.
- `FactCheckResult` gained `searchAvailable: boolean`. When DuckDuckGo is unreachable, Director logs a warn via Observer so Zishan knows the draft was judged by Claude's first-pass assessment alone.
- `LearnerAgent` now uses the shared `extractJson` parser from `shared/parse-json.ts` instead of inline regex — same robustness as every other agent.
- `StructureEditorAgent` now writes learnings for both passing drafts (suggestions, confidence 60) and failing drafts (issues, confidence 40). Previously only passing-with-suggestions cases became learnings — a biased sample feeding into Drafter's future prompts (architecture §4.3).
- `IntegratorAgent` dropped dead `revisionCount` state. Director now spawns `integrator-daily-${today}` (fresh DO per day, matching the daily-cadence model and Publisher's existing pattern).
- `ScannerAgent` accepts an optional `SCANNER_RSS_FEEDS_JSON` env override with safe fallback to hardcoded defaults — feeds change without a redeploy.
- `wrangler.toml` gained a history banner above v5's migration clarifying the LearnerAgent/EngagementAnalyst/Reviser refactor trail.

**Reason:** The architecture locked the 13-agent roster and the "no silent failure" principle in April 2026. Small deviations compound into voice drift (biased learnings) and trust erosion (silent gate bypasses). This pass costs one afternoon and restores alignment before those problems materialise. Zero runtime changes to the reader path — any breakage surfaces on the next scheduled 2am UTC run and is `git revert`-reversible.

**Explicitly out of scope (not regressions, separate work):** D1 schema changes (`voice_score` is already nullable), DuckDuckGo → real search API, scanner XML regex → proper parser, weekend daily pieces, reset-today single-command script, deleting the `shared/prompts.ts` tombstone, audio pipeline (paused by design), `observer_events.severity = 'approval_needed'`.

## 2026-04-17: Dropped course-era `agent_tasks`, fixed orphaned FK on `audit_results`
**Context:** Verifying the first run against the hardened pipeline surfaced that `audit_results` had zero rows across all historical runs. Root cause: the table's `FOREIGN KEY (task_id) REFERENCES agent_tasks(id)` constraint (defined in `0004_audit_results.sql`) pointed at `agent_tasks`, a table created in `0002_observer_events.sql` but never populated by any code. Every Director INSERT silently failed the FK check and the try/catch swallowed the error. Side-effect: the site dashboard's stats and today pages (`src/pages/api/dashboard/stats.ts`, `today.ts`) silently returned empty audit data.

**Decision:** Migration `0008_drop_agent_tasks.sql` drops `agent_tasks` entirely (unused since the course model was retired — see the 2026-04-17 entries above), and drops+recreates `audit_results` without the FK. The recreated table has `idx_audit_task` and `idx_audit_created` indexes for dashboard queries.

**Reason:** Courses are gone; `agent_tasks` was a leftover from the course-era architecture. Keeping a dead table with a live FK pointing at it was producing a real, invisible failure in the audit trail. Clean-slate drop is safe because `audit_results` was empty and `agent_tasks` was unused.

**Verified:** Migration ran cleanly on remote D1. Manual INSERT/SELECT/DELETE round-trip into the new `audit_results` works. Table count now 12 (was 13); migration count now 8 (was 7). Director's next run will populate `audit_results` properly, unlocking the dashboard stats and long-term per-auditor trend analysis.

## 2026-04-17: Daily pieces run every day (weekends included)

**Context:** Zeemish is sold as a *daily* teaching product but `DirectorAgent.dailyRun()` skipped Saturday/Sunday via an `isWeekend` guard. The cron (`0 2 * * *`) was already daily — only the code gated weekends out. Readers arriving on a weekend saw yesterday's piece prominent on the home page, conflicting with the brand promise.

**Decision:** Removed the `dayOfWeek`/`isWeekend` check from `agents/src/director.ts`. The scheduled run now fires every day of the week. If the news is thin on a given weekend, Curator's existing "no teachable stories" skip path logs via Observer and the day is left blank — same graceful behaviour we already have on a quiet weekday.

**Reason:** The product claim is daily. Either ship daily or change the claim. We chose ship. No new Scanner sources for weekends — the RSS feed list is already broad enough that weekends rarely lack signal, and if they do, a blank day is more honest than a forced piece. Supersedes the "weekend daily pieces" item previously listed as out of scope in the 2026-04-17 "Nine-point hardening pass" entry above.

**Verified:** TypeScript compiles clean. Docs synced in the same commit (`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `docs/RUNBOOK.md`). Next Saturday's 2am UTC run is the live verification.

## 2026-04-17: Admin rot swept — `isRunning` heuristic + trigger error handling

**Context:** `CLAUDE.md` flagged two admin-surface bugs as "remaining minor items." They were each small but compounding: (1) the pipeline monitor treated an audit-round `failed` status as pipeline-terminal, even though Integrator + next round follows, so the UI stopped polling in the middle of a run; (2) the admin "Trigger Daily Piece" button used a fire-and-forget `fetch` inside a sync try/catch, so HTTP failures (401, 500) never reached the UI — users saw "Starting pipeline..." stuck forever.

**Decision:**
- `src/pages/api/dashboard/pipeline.ts` — `isRunning` now keys off Director's three explicit terminal-marker steps (`done`, `error`, `skipped`). Audit-round `failed` statuses are no longer conflated with pipeline termination.
- `agents/src/server.ts` — `/daily-trigger` returns `202 Accepted` immediately and hands the pipeline work to `ctx.waitUntil()`. Caller-facing latency drops from "minutes" to "milliseconds"; errors from DO stub creation still surface synchronously.
- `src/pages/dashboard/admin.astro` — `await`s the fetch, inspects `res.ok`, surfaces HTTP status + JSON error body to the operator. Polling only begins after the 202 acks.

**Reason:** Admin tools decay first because only Zishan sees them. These two were the biggest "lie to operator" bugs on the surface — the dashboard looked trustworthy while being subtly wrong. Fixing the trigger at the source (async via `waitUntil`) meant the admin-side workaround could be removed rather than decorated.

**Verified:** Both workers build clean. Will verify end-to-end after next manual trigger — admin UI should show "Started (run YYYY-MM-DD)" immediately, polling begins, pipeline runs, `isRunning` flips to `false` only when a terminal marker is written.

## 2026-04-17: One-command reset-today script

**Context:** Dev iteration on the daily pipeline involves a 3-step reset (git rm MDX + D1 DELETE across 5 tables + trigger fresh run). Runbook documented it correctly, but typos in the SQL (notably the `observer_events.created_at` epoch-ms cutoff) had bitten us before.

**Decision:** `scripts/reset-today.sh` bundles the three steps into one command. Reads `ADMIN_SECRET` from env, uses the known-good SQL verbatim from the runbook, fails fast on any step. Manual 3-step procedure retained as a fallback.

**Reason:** Codify the known-good steps in a script so they can't drift, so the operator can't typo the epoch-ms cutoff, and so reset is one command instead of three. Zishan's ask from the previous session.

**Verified:** `bash -n` syntax check passes. Live-tested after committed alongside Phase 1-4.

## 2026-04-17: KV-backed rate limiting (replaces in-memory Map)

**Context:** `src/lib/rate-limit.ts` used a module-level `Map<key, window>`. On Cloudflare Workers, isolates die and recycle continuously and don't share state — so the limiter reset on every recycle and couldn't count across isolates. Effectively no rate limit. The login/magic-link/upgrade/Zita endpoints were all wearing this fig leaf.

**Decision:** Replace with Workers KV (`RATE_LIMIT_KV` binding). Key layout: `rl:<key>` → `{ count, resetAt }` JSON; TTL = window seconds so KV auto-expires entries. Signature went from sync to async; 4 callers updated in the same commit. Old in-memory implementation removed — no dual-path.

**Reason:** KV is eventually consistent, which introduces a small boundary window where a determined attacker could exceed the cap before KV propagates. For the soft limits we use (5 logins / 15 min, 3 magic links / hour, 20 Zita messages / 15 min) that's acceptable — we're stopping credential-stuffing and Claude-cost blowups, not an APT. The in-memory version didn't stop either.

**Verified:** `wrangler types` emits `RATE_LIMIT_KV: KVNamespace` into `Env`. `pnpm build` clean. Live verification: curl login 6 times with wrong password — 6th returns 429; wait 15 min, allowed again; `wrangler kv key list --binding=RATE_LIMIT_KV` shows the entry with TTL.

## 2026-04-17: Publish-anyway on max-revision audit failure (low-quality flag)

**Context:** On a round-3 audit failure, Director set its own status to `error`, logged escalation, and published nothing. For a daily-cadence product, that meant some days had no piece — a hole in the archive and on the home page. Zishan's call: "we still publish, the score will be low. no archive."

**Decision:** On max-revision failure, Director now:
1. Splices `qualityFlag: "low"` into MDX frontmatter (same regex pattern as Drafter's date-force);
2. Calls Publisher with a commit message tagged `[low-quality, gates: voice/structure/facts]`;
3. Inserts into `daily_pieces` with `quality_flag='low'` and `fact_check_passed` reflecting the actual last round;
4. Still logs Observer escalation (operator needs to know);
5. Completes with `status: 'idle'` (no longer `'error'`).

Reader surface:
- `/daily/YYYY-MM-DD/` renders the low piece with a yellow banner acknowledging it didn't fully pass checks.
- `/library/`, `/daily/` archive index, home page's "From the library", and all dashboard archive queries filter `qualityFlag !== 'low'` / `quality_flag IS NULL`.
- `/api/dashboard/today` exposes `qualityFlag` so live tooling can badge today's low publish distinctly.
- Admin pipeline monitor labels low-quality `done` steps with "LOW QUALITY" + failed gate names.

Schema: migration `0009_quality_flag.sql` adds `daily_pieces.quality_flag TEXT DEFAULT NULL`. Content-collection schema gets `qualityFlag: z.enum(['low']).optional()`.

**Reason:** The daily promise matters more than a perfect catalogue. A blank day breaks trust in the brand; a flagged-and-filtered day preserves daily cadence while keeping the archive clean. The "Published pieces are permanent" hard rule is intact — we never revise or delete the low piece, we just exclude it from the archive presentation.

**Verified:** Both workers build clean. Full verification requires a forced audit failure — will run on next reset-today cycle with a deliberately pathological brief, or wait for a naturally-failing day.

## 2026-04-17: Beat navigation activated via rehype plugin, not Drafter output

**Context:** The `<lesson-shell>` / `<lesson-beat>` Web Components were fully built in Stage 2 — beat-by-beat navigation, prev/next, progress bar, session resume, server sync, engagement tracking — but dormant. DrafterAgent was emitting plain markdown (`## hook`, `## what-is-hormuz`) rather than the wrapper tags described in the original spec, so every daily piece rendered as one continuous wall of prose. The reader's primary surface was quietly broken.

**Decision:** Add a small rehype plugin (`src/lib/rehype-beats.ts`, ≤ 120 lines) that walks the MDX HAST tree, splits the document at `h2` boundaries, and wraps each section in `<lesson-beat name="{slug}">` inside a single `<lesson-shell>`. The plugin also humanises kebab-case headings for display (`what-is-hormuz` → `What Is Hormuz`). No agent changes.

**Why a render-time transform instead of changing Drafter:**
- Agent pipeline stays untouched — the voice contract, prompt library, and audit gates are all validated against the existing output format. Touching Drafter risks regressions on output the audit layer has been tuned for.
- Retroactive: every past piece, including the in-tree Hormuz example, benefits immediately. No re-publishing.
- Safe fallback: if an MDX file has no `h2` headings (legacy or intro-only pieces), the plugin is a no-op and the page renders as regular prose.
- Progressive enhancement preserved: without JS the wrapped structure still reads as a long document.

**Tradeoff accepted:** Drafter can continue emitting `## slug-style` headings forever. We're treating those markdown headings as a structural seam the build knows how to cut along. If we later want richer beat metadata (duration, media, pull quote), we move that into frontmatter `beats:` rather than teaching the Drafter to emit XML.

**Verified:** `npm run build` produces 7 `<lesson-beat>` elements for the Hormuz test piece; beat-by-beat navigation, keyboard arrows, progress bar, and finish-redirect all work in the static preview.

## 2026-04-17: Soften quality surfacing — tier over filter

**Context:** The "publish-anyway" work (decision above) kept the daily cadence by publishing low-quality pieces but then hid them — filtered out of `/library/`, `/daily/`, the homepage "From the library" strip, and every dashboard archive query. On the direct URL the piece rendered behind a yellow banner that said *"This one didn't fully pass our voice, structure, and fact checks."* Two problems: (1) hiding a published piece contradicts the transparency brand (the dashboard is literally the "factory floor"); (2) the scolding language — "Failed" in red on the public dashboard, "LOW QUALITY" labels, the apologetic banner — treated a 78/85 piece as a disgrace rather than what it is: slightly below bar but readable. Zishan's call: treat every published piece equally, show a quiet tier instead of filtering, stop bragging or apologising.

**Decision:** Three-tier reader-facing label, derived from voice score:
- `polished` — voiceScore ≥ 85 (passes the voice bar)
- `solid` — 70 ≤ voiceScore < 85 (below bar, readable)
- `rough` — voiceScore < 70 (noticeably below, still published)

Fallback when `voiceScore` is missing: default to `polished`, unless `qualityFlag === 'low'` (then `rough`). Helper in `src/lib/audit-tier.ts`.

Changes:
1. New `voiceScore` field in MDX frontmatter + content schema. Director splices it on every publish (not just failures) alongside the conditional `qualityFlag`.
2. Removed `quality_flag IS NULL` / `qualityFlag !== 'low'` filters from every reader-facing query: `/library/`, `/daily/`, homepage, `/api/dashboard/recent`, `/api/dashboard/stats`, and the dashboard page's 4 D1 queries. Counts and lists now reflect reality.
3. Deleted the yellow banner on `/daily/[date]/`. Tier appears instead as a single quiet word in the existing metadata line (`8 min · 6 beats · Business · Solid`) — same `text-zee-muted` tone as the rest of the line, no colour change.
4. Public dashboard `Quality Scores` grid softened: Voice card shows the tier word (`Polished`/`Solid`/`Rough`), not `Passing`/`Failed`; Facts/Structure use `Passing`/`Mixed`. No red anywhere — neutral progress bars.
5. Dashboard footer updated — old line claimed *"No piece publishes without passing all three"* which is no longer true.
6. Admin surface (`/dashboard/admin/`) intentionally unchanged — operators still see `Voice: 78/100`, `LOW QUALITY` labels in the pipeline monitor, failed-gate detail. Raw truth for the factory floor.

**Kept as-is:** `quality_flag` column on `daily_pieces`, `qualityFlag` in MDX schema, Director still writes both. Non-destructive per project convention, useful as a secondary signal in the tier helper, and preserves optionality for future admin tooling.

**Reason:** Transparency is the brand. Treating one published piece as unworthy of the archive is the opposite of "educate myself for humble decisions" — it's the system hiding its own shortcomings. The tier lets a reader calibrate without being scolded, and the consistent treatment (every piece shows its tier) means the word `rough` isn't a warning singled-out on weak days — it's just information, same as the read time.

**Verified:** `npm run build` clean, content schema accepts new `voiceScore` field. Today's piece (2026-04-17, QVC) renders as `Rough` via the `qualityFlag: low` fallback path without a manual voice score backfill. Library, daily index, and homepage include it chronologically. Yellow banner gone.

## 2026-04-17: Avg voice score aggregated from `daily_pieces.voice_score`, not `audit_results`

**Context:** After the soften-quality pass (commit 80ebe10) every public surface was switched from `quality_flag IS NULL` filtering to "every published piece counts". Two queries were missed — `voiceAgg` in `src/pages/dashboard/index.astro` and `avgVoice` in `src/pages/api/dashboard/stats.ts`. Both still read from `audit_results` with `WHERE auditor = 'voice' AND passed = 1`, which excludes every piece scoring below the 85 voice bar. Today's piece scored 78 → `passed = 0` → excluded → Avg voice card rendered `—` despite a real score existing on the piece page. Secondary issue: even with the filter removed, aggregating over `audit_results` double-counts every revision round.

**Decision:** Aggregate from `daily_pieces.voice_score` instead.

```sql
SELECT AVG(voice_score) AS avg, COUNT(*) AS n
FROM daily_pieces
WHERE voice_score IS NOT NULL;
```

**Reason:**
- `daily_pieces` has exactly one row per published piece.
- Director writes `lastVoiceScore` there on every publish (`agents/src/director.ts:263-268`), so the value is the final-round score — the same number the reader sees and the same number `auditTier()` uses to derive the tier word.
- `WHERE voice_score IS NOT NULL` cleanly excludes historical pieces from before the plumbing landed.
- Same table already backs `totalPieces` and `subjects`, so the avg now lives in the same semantic universe as its neighbours on the Library stats strip.

The API endpoint also now returns `voiceSampleSize` alongside `avgVoiceScore` so external consumers get the same honesty the dashboard UI already shows ("from N pieces").

**Verified:** `npm run build` clean; local static build; live deploy confirms dashboard renders a number and "from N pieces" subtitle.

## 2026-04-18: "How this was made" surfaced as a drawer on each piece, not a page

**Context:** Transparency is the brand (CLAUDE.md). Before today, a reader saw only the finished piece — the machinery behind it (13 agents, audit scores, voice-contract rules, rejected candidates, revision rounds) was invisible. The user asked for a complete transparency surface readers can open on any piece.

**Decision:** Add a "How this was made" drawer that slides in from the right of the daily piece page. Not a dedicated `/daily/.../process/` route. Not a section expanded below the piece.

The open affordance is a full-width, quiet link-style row at the bottom of each piece. Clicking it opens a drawer with four sections: piece summary, timeline, per-round auditor output, rules applied, and the candidates Scanner surfaced. URL hash `#made` makes the drawer deep-linkable without a new route.

**Why a drawer, not a page:**
- Transparency lives *next* to the work, not behind a page-jump. A reader interested in "how was this made" is still interested in the piece itself; yanking them to a separate route breaks that thread.
- The drawer preserves scroll position on the piece. Close → you're back where you were, reading.
- One URL per piece keeps the library/daily routing model simple. Deep-links via `#made` work without new routes.

**Why it ships with only existing data, no DB or agent changes:**
- `pipeline_log` already has the full per-phase timeline (keyed by `run_id = YYYY-MM-DD`).
- `audit_results` already has per-round scores + violations / claims / issues (keyed by `task_id = daily/YYYY-MM-DD`, grouped by `draft_id`).
- `daily_candidates` already has the full Scanner candidate set.
- `daily_pieces` already has piece metadata + voice_score + quality_flag.
- Commit URL + file path are already written into the `publishing.done` step of `pipeline_log`.

Data that doesn't exist is explicitly not displayed: no reader visits (engagement isn't wired for daily pieces), no Curator reasoning (never stored), no intermediate drafts (not kept). The drawer hides sections whose data is empty rather than inventing placeholders.

**Shape of the fix:**
- New public endpoint `src/pages/api/daily/[date]/made.ts` aggregates the four tables above into one JSON envelope. Independent of the admin dashboard endpoints — simpler to consume than orchestrating three calls client-side.
- New `src/components/MadeBy.astro` renders the open button + drawer scaffold.
- New `src/interactive/made-drawer.ts` Web Component: open/close, focus trap, Escape to close, body scroll lock, URL hash sync, fetch-on-mount, render.
- New `src/styles/made.css` — standalone CSS, same pattern as `beats.css` / `zita.css` (avoids Tailwind purge).
- Rules card uses keyword matching between auditor violations and voice-contract rules — an honest, if imperfect, signal of which rules the audit flagged something adjacent to. Each rule "lights up" when a keyword from its list appears in any violation string.
- `src/lib/pipeline-steps.ts` extracted from `admin.astro` so admin + drawer share one step→label map and can't drift.

**Verified:** `npm run build` clean. Static preview: drawer opens, closes via button / Escape / backdrop, hash deep-link works. Full content requires D1 — confirmed live after deploy.

## 2026-04-18: Dashboard refocused on system-over-time, not per-piece

**Context:** The "How this was made" drawer (shipped earlier today) covers everything per-piece — timeline, audit rounds, rules, candidates. After it shipped, the public dashboard's most prominent sections (Today's Pipeline, Quality Scores, Recent Pieces) became duplicates of either the homepage hero or the drawer. The dashboard had no unique job.

**Decision:** Refocus the public dashboard on cross-piece, cross-day signals only. The drawer owns "how this piece was made"; the dashboard owns "how the factory is running over time".

**New structure:**
1. Page header (eyebrow / title / live subtitle: pieces published, days running, next-run countdown).
2. Today — one-line status strip (Published / Running / Pending), no fat card.
3. This week's output — 4 stat cards: pieces (week + lifetime), avg voice (week, lifetime fallback), tier mix (Polished·Solid·Rough), avg revision rounds.
4. Recent runs — vertical list of the last 7 days with tier dot, voice score, rounds, candidate count, headline; click → goes to that piece (which has the drawer).
5. How it's holding up — three honest signal rows: unresolved escalations (with context), fact-check web availability, avg candidates per day. Rows hide entirely if their data doesn't exist (no placeholder dashes).
6. Agent team — same 13 names, but the most recently active agent (last `pipeline_log` row within 24h) gets an ambient `● active Nm ago` marker.
7. How this works — short paragraph + Voice contract link. Admin Panel link appears here gated on isAdmin (moved from a prominent CTA at the top).

**Removed entirely:**
- Today's Pipeline fat card (drawer + homepage cover this).
- Quality Scores three-card grid (drawer covers per-round; the run log covers cross-piece).
- Recent Pieces simple list (replaced by the richer Recent Runs feed).
- Library 4-stat grid (merged into This week's output).
- Top-level Admin Panel button (moved to discreet footer link).

**Why these queries (all existing tables — no new schema):**
- Tier mix derives from `daily_pieces.voice_score` via `auditTier()` (already canonical).
- Avg rounds counts distinct `audit_results.draft_id` per task_id (suffix `-rN`).
- Unresolved escalations from `observer_events WHERE severity='escalation' AND acknowledged_at IS NULL`.
- Fact-check status counts last-7-days `observer_events WHERE severity='warn' AND title LIKE '%fact-check%'`.
- "Active agent" maps `pipeline_log` step name → agent via inline `STEP_TO_AGENT` table; only shown if the latest step is within 24h.

**Rationale:** Trust through specificity. The dashboard tells the truth at one piece (sample size shown) and at thirty pieces (week-vs-lifetime split). Empty sections vanish rather than show dashes. Every number is a thing the system actually knows.

**Verified:** `npm run build` clean. Static pages still 200. Dashboard requires D1 — verified post-deploy on the live worker.

## 2026-04-18: Site polish bundle — 404, OG meta, drawer lazy-load

**Context:** Post-dashboard-redesign audit found seven fixable rough edges. Shipped together as one quick-wins bundle.

### What landed
1. **Custom 404 page** (`src/pages/404.astro`) — replaces the default Astro dark/monospace 404. On-brand: gold eyebrow + "You've reached a dead end" title + three exit doors (today / library / dashboard).
2. **OG / Twitter sharing meta** (`src/layouts/BaseLayout.astro`) — full set of og:title / og:description / og:type / og:url / og:image / og:site_name + twitter:card + canonical link. Daily pieces pass `ogType="article"` and the piece description; everything else defaults to `"website"`. Requires `astro.config.mjs` to set `site` for absolute URL resolution.
3. **OG image** (`public/og-image.svg`) — typography-only branded card, 1200×630, cream + teal + gold. Same image for every page (per-piece dynamic OG is a separate project).
4. **Google Fonts preconnect** — added `<link rel="preconnect">` for both `fonts.googleapis.com` and `fonts.gstatic.com` (with crossorigin) before the font stylesheet load. ~50ms first-paint improvement.
5. **Library filter focus ring** — replaced `focus:ring-0` with `focus:ring-2 focus:ring-zee-primary/30 rounded`. Was an a11y regression — keyboard users had no focus indication on the filter input.
6. **Drawer lazy-load** (`src/interactive/made-drawer.ts` + `src/components/MadeBy.astro`) — `<made-drawer>` no longer fetches `/api/daily/[date]/made` on mount. Only on click or `#made` hash. Saves one D1 query per page view for readers who never open the drawer. Trade-off accepted: the button copy is now static ("The pipeline of 13 agents behind this piece") with no live audit-round count. Inside the drawer the reader sees real numbers.
7. **Dashboard mobile wrap** — "How it's holding up" rows now stack `flex-col` on small screens, revert to `sm:flex-row sm:justify-between` at 640px+. Fixes the awkward two-line wrap of "3 checks this week used Claude-only" at 375px.

### What was deferred (still real, just bigger)
- `public/_headers` exists with full CSP/HSTS but isn't being honored by the live response. Cloudflare Workers Static Assets uses a different mechanism — needs separate investigation.
- Login page styling refresh
- Zita panel rebrand (white → zee-bg)
- Per-piece dynamic OG image generation (Cloudflare Worker route)
- Skip-link / full WCAG audit

**Verified:** `npm run build` clean. Static preview confirmed: `/totally-fake/` renders custom 404; daily page no longer fires the made-API call on mount; drawer opens and fetches on click. Live verification post-deploy.

## 2026-04-18: Admin redesigned as a control room + per-piece deep-dive

**Context:** The admin page was a mix of broken (Recent Agent Tasks queried `agent_tasks`, dropped in migration 0008) and misleading (the 14-day Engagement table showed legacy lessons-era reader data, never daily-piece data). It also had no per-piece detail — operator could see today's pipeline and recent observer events, but couldn't click into any historical piece to see audit notes, candidates, or the day's events.

**Decision:** Rewrite admin as a control room. Add a per-piece deep-dive route. Refresh login to match the design system. All from existing data — no schema, no agent, no API changes.

**Admin (`src/pages/dashboard/admin.astro`)**:
- Page header: gold eyebrow ("THE CONTROL ROOM") + title + subtitle, matching account/dashboard.
- Today's run: trigger button + step-by-step pipeline log (existing functionality; refactored to share `pipelineStepLabel()` with the public dashboard and the per-piece drawer).
- System state: 4 stat cards — pipeline runs (lifetime), open escalations, errors this week, avg revisions.
- Observer events: same severity-coloured cards, but acknowledged-state now updates in-place (no page reload). Card softens, Acknowledge button removed.
- All pieces: every published piece, newest first, with tier dot + date + voice score + rounds + candidates count + low-flag indicator. Filter input shows when >5 pieces. Each row links to `/dashboard/admin/piece/{date}/`.
- Pipeline history: terminal step per run for the last 14 distinct runs, derived from `pipeline_log` with a single SQL window query.
- Engagement section replaced with an honest placeholder pointing to CLAUDE.md.
- Recent Agent Tasks table dropped (the table doesn't exist).

**Per-piece deep-dive (`src/pages/dashboard/admin/piece/[date].astro`, NEW)**:
- Same admin gate as `admin.astro`.
- Server-rendered, queries D1 directly — no new API endpoint.
- Sections: piece header (tier eyebrow, headline, all metadata, view-on-site + commit + source links), pipeline timeline (collapsed by step, each expandable to show full data JSON), audit rounds (full violations / claims / structure issues, no truncation, no "see more"), all candidates (no 6-cap), observer events for the day (36h window), raw data dumps for `daily_pieces` / `audit_results` / `pipeline_log` rows in collapsible `<details>` blocks.
- The reader-facing drawer caps `alsoConsidered` at 6 and parses violation strings; admin sees all 50 candidates and the raw notes JSON.

**Inline bug fix**: The `isRunning` heuristic on the public `/api/dashboard/pipeline` endpoint only checks step name, not status. Fixed on the consumer side in admin's polling: a run is only "running" if the latest row's `status === 'running'` AND its step is not in `['done', 'error', 'skipped']`. The API endpoint stays untouched (no other consumers verified safe).

**Login (`src/pages/login.astro`)**: Refreshed page header to match account/dashboard pattern (eyebrow + title + subtitle), wider container (`max-w-md` from `max-w-sm`), styled error/success notices in zee-* tokens instead of red/green Tailwind defaults, label uppercase-tracked. Magic-link form flow unchanged.

**Reused**: `auditTier()` + `auditTierLabel()` from `src/lib/audit-tier.ts`, `pipelineStepLabel()` from `src/lib/pipeline-steps.ts`, `getUser()` from `src/lib/db.ts`. Same divider-list + stat-card patterns used everywhere else.

**Verified**: `npm run build` clean. Live verification post-deploy with admin login.

## 2026-04-18: Director.onStart no longer cancels its own cron

**Context:** The 2am UTC run on 2026-04-18 never fired. `pipeline_log` for the day was empty; today's piece never produced. Yesterday's piece (2026-04-17) shipped only because it was a manual `/daily-trigger`. The cron has effectively never fired in production.

**Root cause:** The Agents SDK's `alarm()` handler calls `super.alarm()` *before* scanning `cf_agents_schedules` for due rows. `super.alarm()` triggers `#ensureInitialized()`, which runs `onStart()`. Director's `onStart()` was:

```ts
const existing = await this.getSchedules();
for (const s of existing) await this.cancelSchedule(s.id);
await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
```

When the alarm woke the DO at 2am, `onStart()` deleted the cron row and re-inserted it. The new row's `time` is `getNextCronTime('0 2 * * *')` evaluated *after* 2am — i.e. tomorrow's 2am. The alarm body then queried `WHERE time <= now`, found nothing, and exited silently. Self-perpetuating: every 2am wake-up hits the same trap.

**Decision:** Drop the cancel loop. Cron schedules in the Agents SDK are idempotent on `(callback, cron, payload)` — repeated `schedule()` calls return the existing row instead of inserting. The cancel-then-recreate pattern was unnecessary defensive code that turned into the actual bug.

```ts
async onStart() {
  await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
}
```

**Recovery:** Today's piece run manually from admin. Fix takes effect from tomorrow's 2am onward (after deploy).

**Why this slipped:** The cron path had never fired before. Yesterday was the first production day, and yesterday's piece was a manual trigger from the reset-today flow. Today's was meant to be the first true autonomous fire.

**Verified:** SDK source confirms idempotency at `agents/node_modules/agents/dist/index.js:1474` — cron path checks `WHERE type='cron' AND callback AND cron AND payload LIMIT 1`, returns existing row if found.

## 2026-04-19: First autonomous cron fire exposes three silent-failure bugs

**Context:** 2am UTC cron fired autonomously for the first time (the cron fix deployed 2026-04-18 worked). Pipeline produced a Polished piece — Voice 95/100, 1 round, 0 revisions, 50 candidates, committed at 02:01. But the first real auto-run also exposed three regressions that manual-trigger runs had been masking:

1. `/daily/2026-04-19/` rendered as one flowing prose block — no `<lesson-shell>`/`<lesson-beat>` slides, no Next/Previous, no pagination. 04-17 and 04-18 render correctly.
2. Auditor escalated at 02:01:48: *"No audio rows found for 2026-04-19 — producer did not run or persist failed."* Admin timeline misleadingly showed `audio-producing ✓`. Reader: "Audio version coming soon" indefinitely.
3. Dashboard "how it's holding up" surfaced *fact-check web: Offline — 5 checks this week used Claude-only*, meaning every Facts ✓ this week had silently degraded to first-pass Claude only.

**Diagnosis — bugs 1 and 2 are the same bug:** `agents/src/drafter-prompt.ts` lists beat names in the brief but never specifies how to demarcate them in the MDX body. Claude free-styled: 04-17 and 04-18 happened to use `## beat-name` markdown headings; 04-19 used `<beat id="beat-name">` custom JSX tags. Both are valid MDX. Two downstream consumers hard-code `##`:
- `src/lib/rehype-beats.ts:85` only wraps `h2` nodes into `<lesson-beat>`. Zero h2s → plugin no-ops at line 90 → flat prose.
- `agents/src/audio-producer.ts:145` `extractBeats()` splits on `/\n## /`. Zero matches → empty array → producer loops over nothing → returns "success" with no ElevenLabs calls and no D1 writes. Pipeline log gets `audio-producing ✓` regardless.

**Diagnosis — bug 3 is two bugs stacked:** The DDG Instant Answer API (`api.duckduckgo.com`) is a Wikipedia-topic oracle, not a general web search. Specific factual claims return HTTP 200 with empty `Abstract`/`RelatedTopics`. `fact-checker.ts:137-163` had a bare `catch { return null }` + `if (!response.ok) return null` that collapsed three distinct outcomes into a single nullable string. The "Web search unavailable" warn then fired for both actual network failures AND "DDG reached but had no answer" — conflating infrastructure health with question-specificity. No fetch timeout either.

**Decisions:**

1. **Drafter prompt mandates `##` syntax.** Added "Beat format (required)" section to `DRAFTER_PROMPT` with the `## beat-name` pattern, explicit forbiddance of JSX tags, and the *why* (downstream renderer + audio producer both split on `## `). One-line clarification at the root of both bugs 1 and 2.

2. **`extractBeats()` throws on zero beats.** Converts silent zero-row "success" into a visible escalation via Director's existing try/catch. The audio pipeline `✓` becomes `✗` with a real reason; Auditor's "no rows found" check becomes a backstop instead of the primary alarm.

3. **Fact-checker refactored to discriminated outcomes.** New `WebSearchOutcome` and `SearchPassOutcome` types encode `ok | empty | error`. `webSearch()` returns `{status: 'error', reason}` for unreachable/5xx/timeout, `{status: 'empty'}` for reachable-but-no-answer, `{status: 'ok', text}` otherwise. `check()` maps these to three honest combos of `FactCheckResult.{searchUsed, searchAvailable}`:
   - `both true` → pass-3 reassessment ran on real content
   - `searchAvailable: true, searchUsed: false` → DDG was reachable, had no relevant answer, first-pass Claude is the final word — **not** a quality regression, no Observer warn
   - `both false` → DDG unreachable, real infrastructure problem
   5-second `AbortSignal.timeout` added. The dashboard's *Fact-check web: Offline* signal is now truthful — it fires only on real network failure.

4. **Reset 04-19 rather than patch the MDX.** The committed body had `<beat>` tags — the permanence rule forbids content edits. Reset (git rm + D1 wipe across 6 tables) preserves the rule and lets the fixed Drafter produce a clean replacement.

**Alternatives considered:**

- **Teach `rehype-beats.ts` to also accept `<beat>` tags.** Retroactively fixes 04-19 without MDX edit — tempting. Rejected: legitimising two valid syntaxes invites future Drafter drift and hides the real bug (prompt ambiguity). One syntax, enforced at source.
- **Replace DDG Instant Answer with Brave/Serper/Claude-web-search.** Correct long-term fix — DDG IA realistically resolves ~5% of specific factual claims. Scoped out of tonight's patch; logged in CLAUDE.md "Remaining minor items". Tonight's refactor at least makes the signal honest about the narrow coverage.
- **Enforce `beatCount` = actual `##` count via Structure-Editor gate.** Uncovered a data-integrity drift on 04-17 (declares 6, has 8 `##` headings). Reader UI counts actual headings so rendering is correct; only `daily_pieces.beat_count` is stale metadata. Also logged in minor items.

**Reason — why a prompt fix over making both consumers accept multiple syntaxes:** The contract Drafter owes downstream is *"one section per `##` heading, kebab-case slug."* Two consumers already enforce it. Loosening them (adding `<beat>` tolerance to either) multiplies the surface area of valid inputs and invites the next drift — `<section>`, `###`, `<div data-beat=...>`. One source of truth at the producer, not defensive tolerance at every consumer.

**Reason — why throw in `extractBeats()` rather than return an empty sentinel:** The 04-19 failure was invisible because the success signal (pipeline-log `✓`) was emitted from Director *after* a successful function return, regardless of whether that success had produced any rows. Throwing surfaces the real failure in Director's try/catch, which is already wired to Observer escalation. The old pattern meant the Auditor's "no rows found" check was the alarm — triggered ~60s downstream with a symptom ("no rows") instead of a root cause ("zero beats found in MDX"). The throw moves diagnosis upstream.

**Recovery:** Reset 04-19 (git rm MDX + D1 wipe 6 tables: `daily_pieces`, `daily_candidates`, `pipeline_log`, `audit_results`, `observer_events`, `daily_piece_audio`). User triggers fresh pipeline from admin. Fixed Drafter emits `##` syntax → rehype-beats produces `<lesson-beat>` slides → extractBeats returns 6 beats → audio-producer writes 6 rows → Publisher's second commit splices `audioBeats` into frontmatter → reader sees paginated slides + working audio.

**Verified:** `npx tsc --noEmit` on agents/ — zero errors in touched files. `server.ts` pre-existing Durable Object stub type errors are unrelated and pre-date this change.

**References:** [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts), [agents/src/audio-producer.ts](../agents/src/audio-producer.ts), [agents/src/fact-checker.ts](../agents/src/fact-checker.ts), [src/lib/rehype-beats.ts](../src/lib/rehype-beats.ts). CLAUDE.md "Remaining minor items" now lists the DDG IA narrow-coverage limitation and the `beatCount` declared-vs-actual drift.

## 2026-04-19: Audio pipeline hardening — fetch timeout + Continue/Start-over retry UX

**Context:** After the first three-bug fix landed and 04-19 was re-triggered, text + beats published cleanly but audio stalled at 2 of 6 beats. Last row (`the-cost-structure`) persisted at 08:19:05 UTC; 18+ minutes later, `pipeline_log` still showed `audio-producing running`, no `done`, no `failed`, no observer escalation, and the admin page showed no retry button because the existing logic was a binary branch: *show rows if any exist, show retry button only if none exist.* Operator had partial state + zero way to act on it.

**Root cause:** `agents/src/audio-producer.ts` `callElevenLabs()` had no fetch timeout. When ElevenLabs stalled the TCP connection on beat 3 (likely rate limit or transient network glitch with no response), `fetch()` hung indefinitely. The Durable Object eventually hibernated, leaving Director's `await producer.generateAudio(...)` in limbo — no resolve, no reject. Same silent-failure pattern we'd just fixed in DDG fact-checker but never propagated to ElevenLabs.

Retry UI gap compounded the problem: partial rows are exactly when operators need a retry button most (the pipeline is stuck, not complete), but the existing template hid it.

**Decisions:**

1. **30-second `AbortSignal.timeout` on ElevenLabs fetch.** Matches the DDG fix pattern. Typical response for a 2000-char beat is 5-15s; 30s is generous headroom. On timeout, `fetch` rejects, existing 3-attempt retry loop in `callElevenLabs` fires (1s then 2s backoff), all 3 fail fast, exception bubbles up to Director's try/catch at `director.ts:336-346`, which logs `audio-producing failed` + emits an Observer escalation via `logAudioFailure`. Silent hang → visible escalation.

2. **`retryAudioFresh(date)` on Director.** Wipes R2 objects (`list({prefix: audio/daily/YYYY-MM-DD/}) → delete` each), `daily_piece_audio` rows, `daily_pieces.has_audio`, and `pipeline_log` rows matching `step LIKE 'audio%'`. Then delegates to existing `retryAudio(date)` for MDX read + pipeline re-run. Text-phase pipeline rows (scanning/curating/drafting/auditing/publishing/done) are preserved — they describe a piece that remains published. Only audio-side state is reset.

3. **`/audio-retry` endpoint accepts `mode=continue|fresh` query param** (default `continue` for backwards compatibility with any external callers). Site proxy at `src/pages/api/agents/audio-retry.ts` passes through.

4. **Admin UI rework** at `src/pages/dashboard/admin/piece/[date].astro`. New completion signal: `piece.has_audio === 1`. Whenever that's false, retry affordance is visible. When partial rows exist, TWO buttons appear: **Continue** (default `mode=continue`, resumes missing beats) and **Start over** (`mode=fresh`, confirm() dialog stating the clip count that will be deleted + cost, then wipe-and-regenerate). Row listing and retry affordance stack vertically instead of being mutually exclusive — operator sees current state AND has an action.

**Alternatives considered:**

- **Per-beat retry buttons (regenerate just this one clip).** Rejected — adds UI complexity for a rare need. If one beat's audio is bad, Start over with six cheap ElevenLabs calls is simpler than per-row targeting, and production traffic is low enough that the extra cost is negligible.
- **Double-click-to-confirm on Start over instead of browser confirm() dialog.** Cleaner visual feel but needs state management for the 3-second arm window. Browser `confirm()` is zero-JS-state, explicit about consequences (clip count in the message), and idiomatic for destructive admin actions.
- **Auto-retry on stall (detect `audio-producing running` > 5min and re-fire).** Rejected for now — adds a polling/watchdog dimension to the system. The new timeout on ElevenLabs fetch should prevent stalls in the first place; if they still happen, operator gets a visible retry button. Revisit if stalls recur despite the timeout.

**Reason — why the timeout is a 30s per-attempt and not a smaller outer deadline:** ElevenLabs latency varies by text length and server load. 5-15s typical, occasionally 20-25s for long beats. A 10s timeout would false-positive frequently. 30s gives headroom for normal variance but still fails fast if the connection is truly stuck.

**Reason — why `retryAudioFresh` wipes before delegating instead of having `runAudioPipeline` take a `reset` flag:** Keeps the pipeline method free of mode branching. `runAudioPipeline` should only know how to produce + audit + publish given fresh input; the "is this a fresh attempt or a resume" decision belongs at the caller. Cleaner separation.

**Verified:** `npx tsc --noEmit` on agents/ — zero new errors in touched files. The server.ts DurableObjectStub noise that flags `retryAudioFresh` is the same pre-existing pattern that flags `retryAudio`, `getStatus`, `triggerDailyPiece`, etc. Runtime is unaffected.

**References:** [agents/src/audio-producer.ts](../agents/src/audio-producer.ts) (callElevenLabs + AbortSignal.timeout), [agents/src/director.ts](../agents/src/director.ts) (retryAudioFresh), [agents/src/server.ts](../agents/src/server.ts) (/audio-retry mode dispatch), [src/pages/api/agents/audio-retry.ts](../src/pages/api/agents/audio-retry.ts) (proxy passthrough), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro) (UI + script).

## 2026-04-19: Audio RPC wall-clock budget — chunked generation

**Context:** After Phase D fixes (ElevenLabs timeout + retry UI + retryAudioFresh) deployed and 04-19 was re-triggered, audio again stalled at exactly 2 of 6 beats. Hit **Continue** once → 2→4. Hit it again → 4→6. Pattern made the root cause crisp:

| Run | Beat 1 | Beat 2 | Elapsed |
|---|---|---|---|
| First autonomous | 08:18:47 | 08:19:05 | ~18s |
| First retrigger | 09:14:08 | 09:14:20 | ~12s |
| Continue click 1 | N/A | N/A | ~20s, +2 beats |
| Continue click 2 | N/A | N/A | ~15s, +2 beats |

Each producer invocation cleared ~2 beats in ~20-25s then silently died — no error logged, no observer escalation, no pipeline_log `failed` row. The 30s AbortSignal.timeout we added in Phase D wasn't the culprit: individual ElevenLabs calls completed in 10-15s. The **outer RPC call** from Director → Producer was the thing hitting a ~30s wall-clock budget.

**Root cause:** Cloudflare Durable Object RPC calls are bounded by a wall-clock budget (~30 seconds) before the platform considers them stuck and terminates/hibernates the callee. When producer's `generateAudio(brief, mdx)` ran a for-loop over 6 beats × ~10-15s each of ElevenLabs latency, total wall time was 60-90s — well over budget. Cloudflare silently killed the DO; the pending promise in Director's `await` never resolved. Every symptom tonight — silent hang, no error, admin UI showing partial state indefinitely — traces back to this single budget.

**Decision:** Chunk the producer work. Rename + refactor `generateAudio()` to `generateAudioChunk(brief, mdx, maxBeats = 2)` — processes at most N new beats per call, returns `{processedBeats, totalBeats, completedCount, totalCharacters}`. Director's `runAudioPipeline` replaces the single `await producer.generateAudio(...)` with a bounded while-loop (≤10 iterations) calling `generateAudioChunk` until `completedCount >= totalBeats`. Each call runs for ≤25s (2 beats × ~12s + overhead), comfortably under the RPC budget. All remaining state (auditor, publisher second-commit) is unchanged — they already read from D1.

**Chunk size chosen = 2:** Safe margin under the 30s budget even at ElevenLabs' slow end (2 × 15s = 30s + overhead is risky; 2 × 12s = 24s + overhead fits). Could raise to 3 but no reason to — the loop cost is negligible.

**Cross-chunk prosodic continuity:** ElevenLabs stitches audio across calls via `previous_request_ids` (up to 3 prior request IDs per call). In the old single-call version, this lived in an in-memory array that survived because the whole loop was one DO invocation. Across chunks, that array is gone on each new call. **Fix:** at the start of each chunk, query `daily_piece_audio` for the last 3 non-null `request_id`s by `generated_at DESC`, reverse to oldest-first, use those as the seed `previous_request_ids`. The stitching works unchanged across chunk boundaries — listeners can't tell the audio was generated in 3 calls instead of 1.

**Publisher reads audioBeats map from D1, not from Director's in-memory accumulation.** D1 is the only source of truth that covers (a) all beats from the current run's chunks, (b) any beats carried over from a prior partial run via R2 head-check skip. In-memory accumulation in Director would miss case (b) if a retry happened to land on Continue after a partial.

**Safety belts in Director's while-loop:**
- `MAX_CHUNK_ITERATIONS = 10` — hard ceiling on loop reruns; for a 20k-char piece at 2 beats/chunk, ≤6 iterations is expected; throws at 10 to prevent runaway cost
- `processedBeats.length === 0 && completedCount < totalBeats` → no progress → throw (prevents infinite loops if producer silently refuses work)

**Alternatives considered:**

- **Use DO alarm() to chain beat generation.** Producer schedules an alarm to fire in ~2s which picks up the next beat, continues until done, sets a "complete" state that Director polls. Rejected — adds state machine complexity (alarm scheduling, completion polling, timeout detection) for no real benefit over the cleaner synchronous loop. Also leaks "running" state if Director's polling side dies.
- **Use Cloudflare Queues between Director and Producer.** Over-engineered for a sequential 6-step pipeline. Queues are for decoupling async consumers, not orchestrating a deterministic sequence.
- **Use `ctx.waitUntil` on the producer side to return early + continue in background.** Changes the RPC contract (caller gets back instantly without results) and introduces the same polling + completion-detection complexity as the alarm approach. Rejected for the same reasons.
- **Put the loop inside the producer (use ctx.waitUntil + multiple inner RPCs).** Same wall-clock budget still applies to the outer producer RPC; just shifts the problem.

**Reason — why a bounded loop rather than "just keep calling until done":** A runaway loop could spend unbounded ElevenLabs credits if producer gets into a weird state where beats look unprocessed but can't be generated. `MAX_CHUNK_ITERATIONS = 10` is roughly 2× the expected ceiling for the largest piece we'd ship (12 beats × 2 per chunk = 6 iterations), so legitimate work always succeeds but a bug never costs more than ~$1 of credits before escalating.

**Reason — why not just do 1 beat per chunk:** Each chunk has fixed overhead (subAgent lookup, D1 queries for priorRequestIds + countRow, return-trip latency). Doing 1 beat per chunk means 6 chunks of overhead. 2 per chunk halves that; 3 would start flirting with the 30s budget at ElevenLabs' slow end. 2 is the Pareto sweet spot.

**Verified:** `npx tsc --noEmit` — zero errors in touched files. `pnpm build` — site build passes. End-to-end verification pending reset + re-trigger.

**References:** [agents/src/audio-producer.ts](../agents/src/audio-producer.ts) (generateAudioChunk + ChunkResult + priorRequestIds from D1), [agents/src/director.ts](../agents/src/director.ts) (runAudioPipeline chunk-loop + audioBeats from D1 for publisher).

## 2026-04-19: DO eviction was the real root cause (not a per-RPC budget) — keepAlive() fix

**Context:** Phase F chunking made the producer robust but didn't fix the underlying stall. After Phase F deployed, next trigger stalled at **1/5 beats** — even worse than the 2/6 we'd seen before. Only explanation: the problem wasn't at the producer-RPC level. Going back to the pipeline_log timestamps told the real story:

```
scanning      0s  → done 2s      (Scanner)
curating      2s  → done 30s     (Curator, 28s — Claude call)
drafting      30s → done 78s     (Drafter, 48s — Claude generates ~1300 words)
auditing_r1   78s → done 106s    (three auditors in parallel)
publishing    106s → done 107s   (GitHub commit)
done          107s
audio-producing 108s → running
  └─ hook beat generated at 116s (8s into audio)
  └─ silence after 116s
```

Director's Durable Object ran for 116 seconds and died. The text phase alone consumed 107s of that. Audio only got 9 seconds before the DO was evicted.

**Root cause (found, not guessed):** Grepping the Agents SDK source at `agents/node_modules/agents/dist/index.js` for timeout/hibernation code surfaced the `keepAlive()` method docstring:

> *"Use this when you have long-running work and need to prevent the DO from going idle (**eviction after ~70-140s of inactivity**). The heartbeat fires every `keepAliveIntervalMs` (default 30s) via the alarm system."*

This is a documented Agents SDK feature, not a Cloudflare platform limit. Without `keepAlive()`, the runtime considers a long-running DO "inactive" after ~70-140s and hibernates it — killing any in-flight awaits including cross-facet RPC chains. The exact 70-140s range is why we saw stalls in that window consistently. The reason the Continue button worked is that `/audio-retry` kicks off a fresh HTTP request → fresh Director invocation → fresh 70-140s window, which gave audio enough budget to do 2 more beats before hitting the window again.

**Decision:** Wrap `Director.triggerDailyPiece`, `retryAudio`, and `retryAudioFresh` with `await this.keepAlive()` + `try/finally` disposer. The SDK's keepAlive uses the alarm system to fire a 30s heartbeat that resets the inactivity timer. Reference-counted internally, so nested calls (`retryAudioFresh` → `retryAudio`) are safe and the heartbeat only stops once all refs are disposed.

```ts
async triggerDailyPiece(force = false) {
  const dispose = await this.keepAlive();
  try {
    // full pipeline body — text + audio
  } finally {
    dispose();
  }
}
```

**What Phase F chunking still buys us (not wasted work):**

1. **Retry semantics are cleaner.** `generateAudioChunk(maxBeats=2)` processes bounded work per call. A retry resumes exactly where prior runs left off via R2 head-check; no infinite loops on weird state.
2. **Cross-chunk prosodic continuity via D1.** Loading the last 3 `request_id`s from `daily_piece_audio` at chunk start means ElevenLabs stitching works across multiple retries, not just within one invocation's in-memory window.
3. **Safer per-RPC budget.** Even with `keepAlive`, Agents SDK's client-side RPC timeout default is 60s. Chunked calls stay well under that regardless of DO inactivity.
4. **Progress is visible sooner.** Each chunk persists rows incrementally, so the admin dashboard reflects progress during generation instead of all-or-nothing at the end.

**Why I misdiagnosed it in Phase F:**

Pattern matched "30s Cloudflare RPC timeout" — a known Cloudflare limit I'd seen mentioned in platform docs. The 2/6-beat ceiling and the ~25s elapsed time both fit. But the correlation wasn't causation: the real signal was the **total Director invocation wall-clock**, not the producer-RPC-call duration. Chunking addressed the symptom (per-producer-call stays short) without fixing the cause (Director's surrounding invocation times out). 1/5 on the next trigger — worse than 2/6 — was the data point that broke the hypothesis and forced me to actually read the SDK source.

**Alternatives considered:**

- **Split audio into a separate HTTP request after text completes.** Would give audio its own fresh Director invocation (same trick the Continue button uses). Rejected: more moving parts than `keepAlive()`, and still needs `keepAlive()` for pieces whose audio alone runs past 140s (12-beat newspapers).
- **Use DO alarms to chain audio chunks.** Each alarm fire is a fresh invocation. Rejected same reason — adds orchestration complexity (state machine, completion detection, timeout handling) when a single SDK method call does the same thing cleaner.
- **Static options `keepAliveIntervalMs: 20000`** (tighter heartbeat). Rejected — 30s default is fine; the eviction timer is 70-140s, so 30s heartbeats have 40-110s of slack. Changing it adds config surface without improving reliability.

**Verified:** `npx tsc --noEmit` clean in touched files; `pnpm build` passes. End-to-end verification via reset + fresh trigger next.

**Lesson for next time:** When empirical pattern-matching gives a plausible story that fits the symptoms, resist the urge to ship without verifying against the SDK/platform source. The 30s RPC timeout story was plausible enough to waste a deploy cycle. Ten minutes of grepping `node_modules/agents/dist/` would have surfaced `keepAlive()` immediately.

**References:** [agents/src/director.ts](../agents/src/director.ts) (keepAlive wrappers on triggerDailyPiece, retryAudio, retryAudioFresh); SDK doc in `agents/node_modules/agents/dist/index.js:1671-1699`.

## 2026-04-19: Audio via alarm, not inline (keepAlive was a partial fix)

**Context:** Phase G added `keepAlive()` based on the Agents SDK docstring *"eviction after ~70-140s of inactivity"*. Next trigger still stalled at 2/5 beats after 117s. keepAlive wasn't helping. Asked a research agent to pull **actual Cloudflare docs** instead of continuing to guess.

**What the docs actually say** (quoted from [Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)):

- HTTP/RPC-triggered DO invocations: *"If you consume more than 30 seconds of compute between incoming network requests, there is a heightened chance that the individual Durable Object is evicted and reset."* **There is no hard wall-clock limit** while the caller stays connected — but the "30s of compute between incoming requests" eviction rule kills long-running inline work.
- **Alarm handlers: "maximum wall time of 15 minutes."** They are a separate invocation boundary with their own fresh budget.
- **CPU budget: 30s default, up to 5 minutes via `limits.cpu_ms`.** CPU time excludes I/O waits (fetch, KV, D1), so our ElevenLabs-heavy audio phase burns almost no CPU — CPU wasn't the blocker.
- `keepAlive()` uses alarm-system heartbeats to simulate "incoming network requests" and reset the inactivity timer. But **Durable Objects are single-threaded**: alarms can't fire while the current invocation is holding the DO. So during a long inline method call, queued heartbeats can't actually deliver — they pile up waiting for the current call to finish, exactly when we need them.

**Root cause (definitive):** Our `triggerDailyPiece` runs inline from an HTTP-triggered invocation. Text phase: ~90s. Audio starts: ~2s of compute per beat × 5 beats = ~10s CPU with ~60s wall (ElevenLabs I/O). Cumulative compute-between-requests hits the ~30s eviction threshold midway through audio, and since no new HTTP request arrives during the whole pipeline, the DO gets reset. keepAlive heartbeats can't fire because the DO is busy running triggerDailyPiece. Whole invocation dies silently around 110-120s.

**Decision:** Move audio out of the HTTP-triggered invocation entirely. After text publishes, `triggerDailyPiece` calls `await this.schedule(1, 'runAudioPipelineScheduled', { date, filePath, title })` and returns. Schedule row is persisted in SQLite, alarm fires 1 second later in a **fresh DO invocation with up to 15 minutes of wall time**. Audio runs comfortably under that budget (6 beats × 15s ≈ 90s).

New method: `runAudioPipelineScheduled(payload)` — receives payload from the SDK scheduler, re-reads committed MDX from GitHub (keeps scheduled payloads small), calls existing `runAudioPipeline`. If MDX is missing (piece was deleted), logs an observer failure and exits cleanly.

Same change applied to `retryAudio`: validates inputs synchronously (so admin sees bad-date errors immediately), then schedules the audio work on an alarm. `retryAudioFresh` cascades through `retryAudio` so it inherits the schedule.

**Why Phase F and Phase G aren't wasted work:**

- **Phase F chunking** still lets the producer resume cleanly from partial prior runs via R2 head-check skip. Safer retry semantics, cross-chunk `request_id` stitching from D1.
- **Phase G keepAlive** stays on `triggerDailyPiece` + `retryAudioFresh`. Not the primary mechanism, but harmless; it protects shorter stretches of work (text phase alone is ~107s) and costs nothing when the DO isn't near the eviction boundary.

**Alternatives considered:**

- **`keepAliveWhile` helper + longer CPU limits.** Research agent suggested using `keepAliveWhile` instead of manual try/finally. Same result — still bound by the "compute between incoming requests" rule even if CPU is raised to 5min via `limits.cpu_ms`. The rule is about incoming request cadence, not CPU budget.
- **Split audio into per-beat alarms** (one alarm per beat). Overkill — single alarm invocation has 15 minutes, more than enough for 12 beats. Adds scheduling overhead without benefit.
- **Have `/audio-retry` call the alarm handler directly via fetch.** The SDK's `schedule()` does this cleanly already; no reason to reinvent it.
- **Use `runFiber` for automatic checkpointing + recovery.** Tempting (it uses `keepAlive` + `cf_agents_runs` for resumable work) but adds complexity we don't need — our audio work is already resumable via R2 head-check skip. Save `runFiber` for work with non-idempotent state.

**Reason — why we hit this specifically for audio and not text:** Text phase's work is dominated by Claude API calls via the Anthropic SDK, each of which is one outbound fetch. Between calls, Director does short logic (parse response, log step). The pattern of "call → await → short sync work → next call" keeps the DO regularly yielding, and Cloudflare's eviction heuristic apparently gives leeway to that shape. Audio's work is dominated by ElevenLabs fetches + R2 puts + D1 inserts — similar shape, but by the time audio starts, we've already burned most of the compute-between-requests budget on text. The issue is cumulative, not about audio being structurally different.

**Lesson for next time:** When a platform behavior doesn't match a plausible reading of the SDK docs, pull the actual platform docs before shipping another fix. Two wrong fixes (Phase F chunking, Phase G keepAlive) preceded the one that reads the platform limits page. Total cost: two CI cycles and one user retry cycle. Verifying the platform doc would have taken 5 minutes.

**Verified:** `npx tsc --noEmit` clean; `pnpm build` passes. End-to-end verification in Phase H.5 via reset + fresh trigger.

**References:** [agents/src/director.ts](../agents/src/director.ts) (runAudioPipelineScheduled + schedule(1, ...) wiring); [Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/); [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/).

**VERIFIED (2026-04-19 ~10:30 UTC):** Post-deploy trigger ran end-to-end in one shot. Text phase published cleanly (Voice 92/100, 1 round, 0 revisions, 6 beats, *"Why Jet Fuel Price Spikes Break Some Airlines and Not Others"*). Audio ran from the scheduled alarm invocation: generated all 6 beats totalling 9,299 characters, auditor passed, `publishAudio` committed the `audioBeats` frontmatter map (commit `6fd4466`), `has_audio = 1`. Live `/daily/2026-04-19/` shows a working `<audio-player>` (not "coming soon") + beat navigation. **Zero Continue clicks required.**

One informational artefact in the pipeline timeline: `audio-producing ✗ Durable Object reset because its code was updated.` followed immediately by a retry that succeeded. This was a deploy-during-scheduled-alarm race — the Phase H deploy propagated to the live worker between `schedule(1, ...)` and alarm fire. Cloudflare reset the DO to load the new code, the Agents SDK's scheduled-task retry absorbed the reset, second fire succeeded. Future runs (autonomous 2am UTC or manual triggers against stable code) won't show this — it's a lifecycle event tied specifically to mid-flight deploys. Also a nice demonstration that the alarm-based path is resilient to DO resets in a way the old inline path wasn't.

Post-verification cleanup: all 11 unacknowledged observer_events (3 stale escalations from 04-17/04-18 before tonight's fixes + 4 fact-check-web warnings + 4 audio-published infos) acknowledged in bulk. Dashboard inbox is clean.
