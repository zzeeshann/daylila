# Daylila Categoriser Contract

This document is the single source of truth for how Daylila *files* each piece in the library taxonomy. The voice contract governs how Daylila sounds; the beat contract governs how daily pieces are shaped; the interactive contract governs how the post-publish artefacts are shaped; the audit contract governs the gates each draft passes through; the fact-check contract governs the verification rule; the curator contract governs which story the day's piece teaches; the audio contract governs how the piece is narrated. This contract governs the rule the Categoriser applies after a piece publishes — how many categories a piece gets, the confidence floor at which an existing category counts as a fit, when a brand-new category is allowed, and where a piece lands when nothing fits at all.

## What gets assigned

After a piece publishes, the Categoriser reads the final MDX, the piece's headline and underlying subject, and the full list of categories that already exist in the library (with their descriptions and current piece counts). Then it returns 1 to 3 category assignments — every piece lands in **at least one**, and **no more than three**.

The lower bound matters as much as the upper. An empty assignments array is never a valid answer — every piece must be findable in the library taxonomy. Three is an upper bound, not a target — most pieces fit cleanly in one category, occasionally two when a piece genuinely spans (a monetary-policy piece that also teaches supply chains, for instance). Don't pad.

## The most important rule: prefer reuse over novelty

Categories are a taxonomy for readers to browse the library. They only work if they mean something specific. A taxonomy that grows a new category for every piece becomes noise — it's a list of headlines, not a map.

Strongly prefer reusing an existing category. Before proposing a new one, ask:

- Is there an existing category whose description covers this piece's *underlying subject*, even if the headline is new?
- Could this piece plausibly sit alongside pieces already in one of the existing categories? (Check the piece counts — a category with 6 pieces has a defined shape; a category with 1 piece hasn't converged yet.)
- Am I proposing a new category because the piece is genuinely different, or because the headline uses a different word than the existing category names?

If on the fence between reuse and novel: reuse.

## Tiered decision (apply in order — never return zero)

1. **Ideal reuse — confidence 75 or above.** An existing category's description clearly covers this piece's primary underlying subject. Pick it. A second category is allowed if the piece genuinely spans — but only if the second is also at 75 or above.

2. **Stretch reuse — confidence 60 to 74.** No existing category fits cleanly, but one is the closest match AND the piece's underlying subject isn't different enough from the existing taxonomy to warrant a brand-new category. Reuse the closest existing — the reasoning sentence MUST name what makes the fit stretchy ("thematic echo, not primary subject" / "adjacent mechanism, not core"). This keeps the taxonomy converging rather than fragmenting.

3. **New category — only if neither tier applies.** The piece's underlying subject is materially absent from the existing list — no existing category fits even at 60. Propose ONE new category. A good new category:
   - Is a *subject*, not a topic-of-the-week ("Chokepoints & Supply", not "Suez Canal").
   - Could plausibly hold 10 or more future pieces ("Monetary Policy", not "This Week's Fed Meeting").
   - Has a one-sentence description that would help another piece's categoriser know whether to put it here.
   - Has a kebab-case slug derived from the name ("chokepoints-and-supply"). Keep it short — under 4 words in the name.

**At most one new category per piece.** If two aspects of the piece feel novel, pick the more important one and reuse-or-stretch-reuse the other. The taxonomy converges when novelty is rationed.

## Confidence — what the number means

Each assignment carries a confidence score from 0 to 100. For existing-category assignments, confidence reflects how well the piece fits that category's stated scope. For a new category, confidence reflects how confidently the proposer believes it's a durable addition to the taxonomy.

Existing-category assignments below 60 confidence are rejected by the writer — they don't reach `piece_categories`. Either find a better existing fit or propose a new category instead.

## The fallback path

Every piece lands somewhere. If both Claude attempts (the initial call and the single retry) return zero usable assignments, the agent writes one row to a reserved category:

- **Slug:** `patterns-yet-to-cluster`
- **Hidden** from every reader-facing surface — the chip bar at `/library/`, the per-category page, the per-piece "Filed under" drawer, the per-user account observation.
- **Filtered** from the Categoriser's own context list — Claude must never see this slug as a "reuse target", or the retry layer's purpose collapses.

A piece landing here is an **operator review signal**, not a reader-facing category. The observer feed fires `logCategoriserFallback` at warn severity. If this slug accumulates more than one or two pieces in normal operation, the prompt or taxonomy needs tuning.

The recovery sequence the agent walks:

1. **First attempt.** Claude returns assignments. The resolver caps at 3, drops anything below 60 confidence on the existing-category path, dedupes by category id, creates new categories on the fly when proposed.
2. **Retry — fired only when the first attempt resolved to zero usable rows.** The retry message names the violation (empty array, or all-sub-floor existing-cat assignments) and pushes Claude toward stretch-reuse or proposing one new category. The retry does not re-prompt from scratch — the first response stays in the conversation so Claude has full context for the second attempt.
3. **Last resort.** Both attempts produced nothing usable. The agent writes one row pointing at `patterns-yet-to-cluster`. Director's observer event fires at warn severity.

## Response shape

Strict JSON. One object per call. The `assignments` array carries 1 to 3 entries. Each entry has either a `categoryId` (existing) or a `newCategory` block (novel) — never both. Each entry carries a `confidence` (0–100) and a `reasoning` sentence — short, naming what makes the fit work or what makes it stretchy. No prose, no markdown fences, no explanation outside the object.

The full response shape lives inline in the Categoriser system prompt's "Response format (strict)" section — that's TypeScript-typed contract on the response, not rule body about *what* to assign. This contract owns the assignment rules; the prompt scaffolding owns the JSON shape.

## How agents apply this contract

- **CategoriserAgent.** Reads this contract via `${CATEGORISER_CONTRACT}` injection in its system prompt at `agents/src/categoriser-prompt.ts`. Imports `CATEGORISER_MAX_ASSIGNMENTS`, `CATEGORISER_REUSE_CONFIDENCE_FLOOR`, `CATEGORISER_REUSE_CONFIDENCE_STRETCH`, `CATEGORISER_FALLBACK_SLUG` from `agents/src/shared/categoriser-thresholds.ts`. The resolver enforces the 1–3 cap (slice) and the 60-floor sub-filter (drop) before writing. The fallback-path guard reads the reserved slug to identify the seeded row in `categories`. The retry message is a per-call user turn that stays inline in the prompt file — its `60` and `74` literals are kept in sync with this contract by hand.
- **Director.** Imports `CATEGORISER_FALLBACK_SLUG` so its `getRecentCategoryCounts` query (the soft-preference signal the Curator reads) excludes the hidden fallback. The slug must not be visible to Curator either — surfacing it as a "category with N recent pieces" would mislead the breadth signal.
- **Site worker.** Imports `FALLBACK_SLUG` from `src/lib/categoriser-thresholds.ts` (the asymmetric site-side mirror — the site enforces the fallback-slug filter at render time only; floors and assignment caps are agent-side rules). Three site-side use-sites: `src/lib/categories.ts` (chip bar at `/library/` excludes the fallback; `getCategoryBySlug` returns null when asked for the fallback so the per-category page 404s); `src/pages/api/daily/[date]/made.ts` ("Filed under" drawer excludes the fallback so a piece parked there reads as no-category-yet to readers); `src/pages/account.astro` (subjects observation excludes the fallback so it doesn't appear in a reader's recently-read taxonomy). All three pass the slug as a bound SQL parameter, no inline literals.
- **Migration 0027.** `migrations/0027_categoriser_fallback_category.sql` seeds the `categories` table with the reserved row at first deploy. The slug literal there is **data**, not a code use-site of the rule. SQL migrations cannot import TypeScript constants; the migration runs idempotently once per environment via `INSERT OR IGNORE`. Treat the migration's slug literal as deliberate non-change — the canonical slug lives in `agents/src/shared/categoriser-thresholds.ts` (and its site-side mirror); the migration's value is frozen at deploy time. Same posture as audit-contract's references to migration-shipped enum values.
- **`agents/scripts/verify-categoriser-floor.mjs`** is a JS regression mirror of the resolver-shape decisions (empty-array → retry, sub-floor → retry, stretch-reuse kept, boundary at 60 kept, boundary at 59 dropped). The verifier inlines `CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60` and `CATEGORISER_MAX_ASSIGNMENTS = 3` and is hand-synced with this contract and `agents/src/shared/categoriser-thresholds.ts` when values change. Same convention as `verify-fact-checker.mjs` and `verify-interactive-voice.mjs`.

## Change log

- 2026-05-10 — v1.0 — extracted from `agents/src/categoriser-prompt.ts` and the literal SQL strings at `agents/src/director.ts:1697` and `src/pages/api/daily/[date]/made.ts:324` (Foundation Fix Task 02 eighth and final extraction session, branch `foundation-fix-02-extraction-categoriser`). Behaviour-preserving — rule values + canonical phrasings unchanged. The four named constants moved from `categoriser-prompt.ts` into the new `agents/src/shared/categoriser-thresholds.ts`; the site-side `FALLBACK_SLUG` moved from `src/lib/categories.ts` into the new `src/lib/categoriser-thresholds.ts` (re-exported from categories.ts for back-compat). With this entry Phase 1 of Foundation Fix is complete — all eight rule clusters extracted.
