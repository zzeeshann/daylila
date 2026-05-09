# Daylila Audit Contract

This document is the single source of truth for how Daylila *judges* its own work. The voice contract governs how Daylila sounds; the beat contract governs how daily pieces are shaped; the interactive contract governs how the post-publish artefacts are shaped. This contract governs the gates each draft passes through, the bound on revision rounds, the rule that ships a piece anyway when those gates max-fail, and the reader-facing tier label that flows from the voice score.

## The three gates

Every draft is scored in parallel by three auditors:

- **Voice Auditor.** Scores 0–100 against the voice contract. Passes when the score is ≥85.
- **Structure Editor.** Returns binary pass/fail. Checks the beat contract — word count, beat count, hook/teaching/close shape, frontmatter.
- **Fact Checker.** Returns binary pass/fail. Verifies every claim against current sources via web search.

A round passes only when **all three** auditors pass. If any one fails, the Integrator revises and the next round runs.

## The revision loop

Up to **3 rounds** of audit-then-revise per piece. (1 initial draft + 2 revisions.)

The same value applies to the post-publish interactive (quiz + HTML) generation loop — one rule, applied to two artefact types. The daily-piece auditor loop and the interactive produce-audit-revise loop both bound at 3.

3 is the practical answer to "how many shots before the system would do better starting from a different brief than asking Claude to revise again." Rounds 1 and 2 reliably move the needle on most pieces; round 3 is a ship-or-flag boundary, not a deeper-rewrite opportunity.

## Publish-anyway on max-fail

If round 3 fails, the piece **ships anyway** with `qualityFlag: "low"` stamped into its frontmatter. A daily-cadence product can't have "no piece" days — a newspaper never skips a day. Library + recent queries filter low pieces from archive views; the per-date piece URL still renders the piece with a Rough banner so the day isn't blank.

Hard rule intact: a piece flagged `low` is permanent. It is never revised after publish. The signal feeds forward into the Learner so the next day's draft starts smarter.

## The qualityFlag taxonomy

`qualityFlag` is a closed taxonomy. Two values only:

- `"low"` — the piece (or interactive) shipped on max-fail of the audit loop.
- absent / `null` — the piece passed cleanly within the round budget.

No other values. The taxonomy is the same on the daily-piece path, the quiz path, and the HTML interactive path — same word, same meaning, three artefact types.

## Reader-facing tier mapping

Every published daily piece displays one tier word, derived from `voiceScore` at render time:

- `voiceScore ≥ 85` → **Polished**
- `70 ≤ voiceScore < 85` → **Solid**
- `voiceScore < 70` → **Rough**

The thresholds are deliberate. 85 is the auditor's pass bar — pieces above it passed cleanly. 70 is the floor below which prose is *noticeably* rough, not just below the bar. Solid (70–84) flags an honest below-bar reading without scolding the piece; Rough lets the reader calibrate. Daily cadence matters more than perfection — a Rough piece is more useful than no piece.

When `voiceScore` is missing (a small number of historical pieces predate the splice), the fallbacks are:
- `qualityFlag = "low"` → Rough.
- otherwise → Polished. (Historical pieces that passed pre-splice — preserves the original behaviour without a backfill.)

## Voice Auditor failure_reasons enum

Closed enum. Voice Auditor emits ONE token per VIOLATION KIND (not per instance) on rounds that fail. Five "tribe word" violations across the piece collapse to one `tribe_word` token. Pass rounds emit `[]`.

| Token | Meaning |
|-------|---------|
| `tribe_word` | Any tribe word from the voice contract (mindfulness, journey, empower, dive in, transform, embrace, etc.). |
| `long_sentence` | Sentence too long, padded, or with trailing throat-clearing. |
| `vague_subject` | Passive voice or subject erased (e.g. "it's important to note"). |
| `no_specific_example` | Abstract claim without a concrete example. |
| `flattery` | Congratulating the reader, "great job"-style language. |
| `jargon_without_translation` | Technical term used without immediate plain-English translation. |
| `unknown` | Forward-compat sentinel. Emitted ONLY by the parser when Claude returns a token outside the closed list — never by Claude directly. Surfaces in operator queries via `failure_reasons LIKE '%unknown%'`. |

Persisted to `audit_results.failure_reasons` as comma-separated tokens (since migration 0038, 2026-05-07). Runtime mirror: `VOICE_FAILURE_REASONS: ReadonlySet<VoiceFailureReason>` in `agents/src/types.ts`.

## Structure Editor failure_reasons enum

Closed enum. Same one-token-per-violation-kind shape. Pass rounds emit `[]`.

| Token | Meaning |
|-------|---------|
| `weak_hook` | Hook does not open with the observation that creates the question, or uses a "In this lesson, we'll learn…" opening, or summarises before asking. |
| `missing_close` | Close summarises, calls to action, congratulates, or rambles past four sentences. |
| `beat_too_long` | Any beat is padded or carries more than one idea, or runs past 200 words. |
| `pacing_uneven` | Beats vary wildly in weight; the piece doesn't breathe at a consistent pace. |
| `wrong_beat_count` | Outside the 5–8 range, or in the 9+ padding zone (6–8 is target). |
| `wrong_word_count` | Outside 900–1100. |
| `widget_without_purpose` | A `<lesson-reveal>` / `<lesson-compare>` / `<lesson-callout>` widget that decorates rather than teaches — deletable without losing the lesson, or replaceable with a sentence. Per the beat contract's earned-not-budgeted rule (PR #3, 2026-05-09). |
| `unknown` | Forward-compat sentinel. Same shape as the voice enum. |

Note that the Structure Editor doesn't have its own contract file — structure rules live in `content/beat-contract.md`. The failure_reasons enum lives here in the audit contract because it governs how audit verdicts are SHAPED, not how pieces are shaped.

Persisted to `audit_results.failure_reasons` since migration 0038. Runtime mirror: `STRUCTURE_FAILURE_REASONS: ReadonlySet<StructureFailureReason>` in `agents/src/types.ts`.

## Fact Checker failure_reasons enum

Closed enum. Tags the SHAPE of the fact-check failure at the audit-summary level. Per-claim status (`verified` / `unverified` / `incorrect`) is recorded separately in `daily_audit_claims` (migration 0028, 2026-04-30) — this enum complements that more granular record. Pass rounds emit `[]`.

| Token | Meaning |
|-------|---------|
| `unverified_claim` | At least one claim's status is `unverified` (Claude searched but couldn't confirm). |
| `contradicted_claim` | At least one claim's status is `incorrect` (Claude found evidence against it). |
| `missing_source` | At least one claim needed a citation but no search returned a usable source. |
| `cutoff_confession` | Claude fell back to "I don't know past my cutoff" instead of searching. Direct violation of the fact-check contract's search-first rule. |
| `search_not_used` | Claude skipped searching for current-event claims that the contract requires verification of. |
| `unknown` | Forward-compat sentinel. Same shape as the voice + structure enums. |

Persisted to `audit_results.failure_reasons` since migration 0038. Runtime mirror: `FACT_FAILURE_REASONS: ReadonlySet<FactFailureReason>` in `agents/src/types.ts`.

## Audit suggestions count

Migration 0038 also adds `audit_results.suggestions_count INTEGER` — the number of suggestion strings Claude produced this round. Drift detector for "auditor went silent" cases (Claude returning a fail verdict with zero suggestions). For the fact-checker the column counts `claims.length` (every claim is implicitly a suggestion to verify); for voice and structure it counts `suggestions.length` directly.

## How agents apply this contract

- **Voice Auditor.** Reads the contract via the named constant `VOICE_PASS_THRESHOLD = 85`, injected into its system prompt's JSON-spec line as `"passed": boolean (score >= ${VOICE_PASS_THRESHOLD})`. The auditor's full voice rules come from the voice contract (`${VOICE_CONTRACT}` injection); the threshold here is response-format spec, not rule body.
- **Director.** Imports `MAX_AUDIT_ROUNDS = 3` from `agents/src/shared/audit-thresholds.ts` and bounds the audit-then-revise loop on it. Sets `qualityFlag = "low"` per the rule above when round 3 fails. Splices the flag into MDX frontmatter and persists it to the `daily_pieces.quality_flag` column.
- **Interactive Generator.** Imports `MAX_AUDIT_ROUNDS` (aliased locally as `INTERACTIVE_MAX_ROUNDS` for in-file readability) and applies it on both quiz and HTML loops. Sets `qualityFlag = "low"` on max-fail with the same setter shape as Director.
- **Interactive Auditor.** Imports `VOICE_PASS_THRESHOLD` (aliased locally as `INTERACTIVE_VOICE_MIN_SCORE` for in-file readability) and applies it as the voice dimension's pass bar on both quiz and HTML paths. The HTML auditor's structure / essence / factual thresholds are a separate rule (the interactive shape thresholds at 75) and not governed by this contract.
- **Site-side audit-tier reader.** Imports `VOICE_PASS_THRESHOLD` and `TIER_SOLID_FLOOR` from `src/lib/audit-thresholds.ts` (the site-worker mirror; same shape as `src/lib/cadence.ts` mirroring `agents/src/shared/admin-settings.ts`). Both worker packages carry their own constants because no shared package exists; the site-side file's header comment names this contract canonical and the agents-side file as the parallel.

## Change log

- 2026-05-06 — v1.0 — extracted from `agents/src/voice-auditor-prompt.ts`, `agents/src/voice-auditor.ts`, `agents/src/director.ts`, `agents/src/interactive-generator.ts`, `agents/src/interactive-auditor-prompt.ts`, and `src/lib/audit-tier.ts` (Foundation Fix Task 02 fourth extraction session, branch `foundation-fix-02-extraction-audit-thresholds`). Behaviour-preserving — rule values unchanged.
- 2026-05-07 — v1.1 — added three failure_reasons enum sections (Voice / Structure / Fact) + the audit suggestions count note, alongside Foundation Fix Task 08 PR 08c (closes leak L24). Migration 0038 adds the persistence columns. Each closed-enum token + the per-auditor token list is canonical here; runtime mirrors live in `agents/src/types.ts`.
