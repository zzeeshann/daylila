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

### Walk through every existing category before proposing a new one

Before proposing a new category, walk through each existing category in turn. For each, ask:

- Does the candidate piece's underlying subject sit inside this category's stated **domain** (description)?
- Is it the kind of thing the **recent piece headlines** under this category suggest belongs here?

Only if both signals fail across all existing categories, propose a new one. The description bounds the territory the category *intends* to cover; the recent headlines reveal what *actually landed there*. A mismatch between description and headlines is itself a signal — the category may be drifting, and adding a piece that doesn't match the description but does match the recent drift would deepen the drift, not the bucket. When that mismatch is visible, prefer either (a) a different existing category whose description AND headlines both fit, or (b) a new domain-level category that captures the piece's underlying subject without inheriting the drift.

## Tiered decision (apply in order — never return zero)

1. **Ideal reuse — confidence 75 or above.** An existing category's description clearly covers this piece's primary underlying subject. Pick it. A second category is allowed if the piece genuinely spans — but only if the second is also at 75 or above.

2. **Stretch reuse — confidence 60 to 74.** No existing category fits cleanly, but one is the closest match AND the piece's underlying subject isn't different enough from the existing taxonomy to warrant a brand-new category. Reuse the closest existing — the reasoning sentence MUST name what makes the fit stretchy ("thematic echo, not primary subject" / "adjacent mechanism, not core"). This keeps the taxonomy converging rather than fragmenting.

3. **New category — only if neither tier applies.** The piece's underlying subject is materially absent from the existing list — no existing category fits even at 60. Propose ONE new category. A good new category:
   - Names a **domain**, not a topic-of-the-week (`Chokepoints`, not `Suez Canal`).
   - Could plausibly hold 10 or more future pieces (`Trade`, not `This Week's Tariff Hearing`).
   - Follows the naming rule (see "Category names" below) and the description rule (see "Category descriptions" below).

**At most one new category per piece.** If two aspects of the piece feel novel, pick the more important one and reuse-or-stretch-reuse the other. The taxonomy converges when novelty is rationed.

## Category names

Category names are **one word**. Two words are allowed only when one word is genuinely ambiguous in the library's context. No ampersands, no `and`, no hyphens, no three-or-more-word names — those signal that two ideas are being yoked together and the category should split or one half should be dropped.

Concrete pairs from this library's history (left = correct, right = the multi-word form that fragmented the taxonomy):

- `Brain` (not `Neural Architecture & Specialization`)
- `Trade` (not `Resource Constraints & Trade-offs`)
- `Justice` (not `State Violence & Justice Systems`)
- `Knowledge` (not `Knowledge Formation`)
- `Markets` (not `Information Asymmetry & Markets`)
- `Cartels` (not `Cartels & Coordination Problems`)

`Climate Policy` is an acceptable two-word example — `Climate` alone is too broad given the library's mix of natural-climate pieces and policy pieces. The two-word allowance is the exception, not the default.

The slug is derived from the name in kebab-case: `Brain` → `brain`, `Climate Policy` → `climate-policy`. The slug carries the URL; the name carries the chip-bar label. Both must be readable on their own.

## Category descriptions

A category description names a **domain** — what kinds of subjects, fields, or phenomena belong here. It does NOT describe an intellectual move (knowledge formation, pattern recognition, optimisation, trade-offs). Intellectual moves frame *how* a piece thinks, and almost any piece can be reframed to fit them. That is why such descriptions become dumping grounds — the description is so general that no piece can be excluded from it on its own merits.

A good description names the *territory*. Concrete examples:

- `Brain` → *"Brain anatomy, brain development, neuroscience, cognition, neural learning, and how the nervous system processes signals."* Names the domain. A piece about plant cells doesn't fit, no matter how clever the framing.
- `Trade` → *"International trade, tariffs, supply chains, commodity markets, chokepoints, and the economics of global commerce."* Names the territory. A piece about brain trade-offs doesn't fit, even though it's about "trade-offs" in the abstract.

Anti-patterns (do not write):

- *"How knowledge accumulates through systematic observation."* — describes a meta-process; admits any science.
- *"How systems operate under hard limits."* — describes a meta-process; admits any engineering or biology.
- *"How patterns emerge from noisy data."* — describes a meta-process; admits any biology, finance, ML, or sensor piece.

Self-test before writing: would a reader, browsing the library, expect a different *kind* of piece in this category than in any other? If the description could plausibly cover any technical piece, it's at the wrong level — rewrite to name the territory.

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

- 2026-05-07 — v1.1 — taxonomy-fragmentation rewrite. Triggered by 26-categories-for-49-pieces audit: two dumping grounds (`Knowledge Formation` 12, `Resource Constraints & Trade-offs` 12), thirteen singletons. Diagnosis via prod D1 sampling: the existing taxonomy was organised at the wrong axis (process-level intellectual moves, not domain-level subjects), and both names AND descriptions encoded that wrong axis. Three rule additions: (a) **Category names** section locks single-word naming (two words only when one is ambiguous); no `&`, no `and`, no 3+ words — with concrete pairs pulled from prod (`Brain` not `Neural Architecture & Specialization`, `Trade` not `Resource Constraints & Trade-offs`, etc.). (b) **Category descriptions** section locks domain-level descriptions (names the territory, not the intellectual move) — with concrete examples and anti-patterns (`"How knowledge accumulates..."`, `"How systems operate under hard limits..."`). (c) **Walk through every existing category before proposing a new one** sub-section under "prefer reuse over novelty" — explicit two-signal test (description + recent piece headlines), with description-vs-headlines drift treated as a signal that the bucket is fragmenting. Tier-3 bullets simplified to point at the new sections instead of inlining naming/description rules. Architectural posture: rules live in this contract; agent reads it; code only persists D1 rows and shapes JSON envelopes — no regex validation in `categoriser.ts`, no retry-message branches firing on code-detected violations, no verifier scripts testing qualitative compliance. Same posture as voice / fact-check / audit / interactive contracts. If observed compliance drift becomes material (≥2 violating names or descriptions in any 14-firing window), the unblock path is a CategoriserAuditor agent (deferred).
- 2026-05-10 — v1.0 — extracted from `agents/src/categoriser-prompt.ts` and the literal SQL strings at `agents/src/director.ts:1697` and `src/pages/api/daily/[date]/made.ts:324` (Foundation Fix Task 02 eighth and final extraction session, branch `foundation-fix-02-extraction-categoriser`). Behaviour-preserving — rule values + canonical phrasings unchanged. The four named constants moved from `categoriser-prompt.ts` into the new `agents/src/shared/categoriser-thresholds.ts`; the site-side `FALLBACK_SLUG` moved from `src/lib/categories.ts` into the new `src/lib/categoriser-thresholds.ts` (re-exported from categories.ts for back-compat). With this entry Phase 1 of Foundation Fix is complete — all eight rule clusters extracted.
