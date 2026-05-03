# Zeemish Audit Contract

This document is the single source of truth for how Zeemish *judges* its own work. The voice contract governs how Zeemish sounds; the beat contract governs how daily pieces are shaped; the interactive contract governs how the post-publish artefacts are shaped. This contract governs the gates each draft passes through, the bound on revision rounds, the rule that ships a piece anyway when those gates max-fail, and the reader-facing tier label that flows from the voice score.

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

## How agents apply this contract

- **Voice Auditor.** Reads the contract via the named constant `VOICE_PASS_THRESHOLD = 85`, injected into its system prompt's JSON-spec line as `"passed": boolean (score >= ${VOICE_PASS_THRESHOLD})`. The auditor's full voice rules come from the voice contract (`${VOICE_CONTRACT}` injection); the threshold here is response-format spec, not rule body.
- **Director.** Imports `MAX_AUDIT_ROUNDS = 3` from `agents/src/shared/audit-thresholds.ts` and bounds the audit-then-revise loop on it. Sets `qualityFlag = "low"` per the rule above when round 3 fails. Splices the flag into MDX frontmatter and persists it to the `daily_pieces.quality_flag` column.
- **Interactive Generator.** Imports `MAX_AUDIT_ROUNDS` (aliased locally as `INTERACTIVE_MAX_ROUNDS` for in-file readability) and applies it on both quiz and HTML loops. Sets `qualityFlag = "low"` on max-fail with the same setter shape as Director.
- **Interactive Auditor.** Imports `VOICE_PASS_THRESHOLD` (aliased locally as `INTERACTIVE_VOICE_MIN_SCORE` for in-file readability) and applies it as the voice dimension's pass bar on both quiz and HTML paths. The HTML auditor's structure / essence / factual thresholds are a separate rule (the interactive shape thresholds at 75) and not governed by this contract.
- **Site-side audit-tier reader.** Imports `VOICE_PASS_THRESHOLD` and `TIER_SOLID_FLOOR` from `src/lib/audit-thresholds.ts` (the site-worker mirror; same shape as `src/lib/cadence.ts` mirroring `agents/src/shared/admin-settings.ts`). Both worker packages carry their own constants because no shared package exists; the site-side file's header comment names this contract canonical and the agents-side file as the parallel.

## Change log

- 2026-05-06 — v1.0 — extracted from `agents/src/voice-auditor-prompt.ts`, `agents/src/voice-auditor.ts`, `agents/src/director.ts`, `agents/src/interactive-generator.ts`, `agents/src/interactive-auditor-prompt.ts`, and `src/lib/audit-tier.ts` (Foundation Fix Task 02 fourth extraction session, branch `foundation-fix-02-extraction-audit-thresholds`). Behaviour-preserving — rule values unchanged.
