# Daylila Integrator Contract

This document is the single source of truth for how Daylila *revises* a draft when the audit gates flag issues. The voice contract governs how Daylila sounds; the beat contract governs how daily pieces are shaped; the interactive contract governs how post-publish artefacts are shaped; the audit contract governs the gates each draft passes through; the fact-check contract governs the verification rule; the curator contract governs which story the day's piece teaches; the audio contract governs how the piece is narrated; the categoriser contract governs how pieces file into the library taxonomy. This contract governs the rule the Integrator applies between audit rounds — what to fix, what disposition to record on each piece of feedback, and how to keep the prose intact across rewrites.

## The Integrator's job

When any of the three audit gates (Voice, Structure, Fact) flags a draft, the Integrator reads ALL of the auditor feedback, revises the MDX in place, and returns both the revised draft and an explicit record of how it handled each piece of feedback.

The Integrator does NOT decide whether the piece passes — that's the auditors' job on the next round. It does NOT pick the story or write the brief — that's Curator. It does NOT publish — that's Publisher. Its single concern is: take the feedback, address every item, and articulate what was decided.

## The most important rule: don't break what was working

Every revision round risks regressing dimensions that were already passing. A draft that scores Voice 95 in round 1 should not come out of round 2 scoring Voice 92 because the Integrator chased a Structure flag and introduced a banned tribe word along the way.

The Integrator sees ALL three audit dimensions on every call, marked PASS or FAIL. Passing dimensions are protected — the prompt instructs the Integrator to PRESERVE them, not just leave them alone but actively avoid changes that would re-break them. Failing dimensions get the existing violation/suggestion structure with the closed-enum failure tokens (Foundation Fix Task 08 PR 08c) attached for precise targeting.

Round-to-round state is also preserved within a single piece. The Integrator's Durable Object holds the previous round's audit results in `IntegratorState.lastSnapshot`, keyed by piece_id. Round 2 sees "Round 1: voice PASS 95, structure FAIL [tokens], fact PASS" as a leading section in the user message, alongside this round's audits — and is explicitly instructed that any pass→fail flip across rounds is a regression introduced by the previous revision and must be repaired without re-breaking what's now passing.

State resets lazily — when the next revise() call's piece_id differs from the stored snapshot, the snapshot is ignored on read and overwritten on write. A new piece's first revision sees no "previous round" data and the prompt handles that case cleanly. The DO instance is still per-day (Director spawns `integrator-daily-${today}`); state lives only within one day's pipeline runs and is destroyed when the next day's instance comes up.

Foundation Fix Phase 4 Task 09 (2026-05-07) — closed. Catalyst: 2026-05-06 magic-mushroom piece (`content/daily-pieces/2026-05-06-single-dose-of-magic-mushroom-psychedelic-can-cause-anatomic.mdx`) scored Voice 95 in R1, dropped to 92 in R2 after the Integrator introduced "unlock" while addressing a structure flag, recovered to 95 in R3 after a third revision. The system burned two rounds on a regression that should have shipped as Polished on R1 alone. The watch window for empirical verification (≥10 multi-round pieces in `integrator_decisions`) is queued post-deploy as a FOLLOWUPS [observing] entry.

## The decisions array — one row per feedback item addressed

Every revision call returns a structured `decisions` array. One entry per feedback item the Integrator addressed. Each entry carries:

- **`feedback_source`** — which auditor raised the item. Closed enum: `voice_auditor` | `fact_checker` | `structure_editor`. One value per auditor agent in the pipeline.
- **`feedback_summary`** — the Integrator's own paraphrase of the issue. This is deliberately the *Integrator's* articulation, not a quote of the auditor's wording. Diagnostic value: when feedback_summary doesn't match what the auditor actually said, that's signal about prompt drift.
- **`decision`** — the disposition the Integrator chose. Closed enum:
  - **`accepted`** — the prose was revised per the feedback. Default and most common.
  - **`overruled`** — the Integrator chose not to act on the feedback. Rare but legitimate — for example, a fact-check flag the Integrator believes is spurious because the claim is verbatim from a primary source the checker missed. Overrules must carry reasoning.
  - **`partial`** — some aspect of the feedback was addressed, others were deliberately left. Useful when an auditor raises a multi-part issue (one sentence flagged on both voice and structure grounds, for instance) and the Integrator addressed one but not the other.
- **`reasoning`** — one sentence on *why* the disposition was chosen. Optional but strongly preferred. When a future operator reads `integrator_decisions` weeks later, this is the primary diagnostic signal.
- **`resulting_change`** — one-line summary of what literally changed in the MDX. Optional. The diff between `draft_revisions` rounds is the source of truth for the literal change; this column is the Integrator's own one-line characterisation of it.

The `decisions` array MAY be empty when the auditor feedback was itself empty (no failed gates). It SHOULD have one entry per failed gate's flagged items in normal operation.

## Response shape

Strict JSON. One object per call. The full literal shape lives in the Integrator system prompt's "Response format (strict)" section — that's the on-the-wire contract on the response. This contract owns the decision rules; the prompt scaffolding owns the JSON shape. Two consumers, one rule, one canonical value.

## Persistence — what the system records

Each revise() call persists:

- **One row in `draft_revisions`** — the revised MDX as written by the Integrator, tagged with `revision_round` (1+) and `authored_by='integrator'`. Round 0 is the Drafter's initial output, written by the Drafter itself before any audit round. UNIQUE(piece_id, revision_round) guards against duplicate writes.
- **One row per decision in `integrator_decisions`** — the structured shape above, joined back to draft_revisions via (piece_id, revision_round).

This is metadata about how the piece was made, not the piece itself. The published piece in git remains the single source of truth for what readers see; D1 holds the trail. Same posture as `audit_results`, `audio_audit_results`, `pipeline_log`.

Persistence is **fail-open**. The audit-revise loop runs PRE-publish, but the Integrator's verdict (revised MDX) is computed in-memory before the persistence batch runs. A D1 hiccup on the persist call returns a `persistError` sentinel that Director logs once via `observer.logError`; the publish path is unaffected. Same shape as the Audio Auditor's persistError pattern (Foundation Fix Task 05).

## Parse-fail fallback

If Claude returns malformed JSON (unquoted long values, dropped delimiters — same drift class as the InteractiveGenerator wobble queued at `[observing] 2026-05-03` in `docs/FOLLOWUPS.md`), the Integrator falls back to treating the raw response as the revised MDX with `decisions: []` and a `parseError` sentinel. The publish path is preserved. Director logs once via observer.logError. If parse-fail rate exceeds 1 in 30 revisions, escalate to either tightening the prompt or moving to Anthropic structured outputs / tool calling — same forward-looking option named in FOLLOWUPS for InteractiveGenerator.

## How agents apply this contract

- **IntegratorAgent.** Reads this contract via `${INTEGRATOR_CONTRACT}` injection in its system prompt at `agents/src/integrator-prompt.ts`. Closed enums (`IntegratorDecision`, `FeedbackSource`) live in `agents/src/types.ts` as typed unions + `ReadonlySet` runtime mirrors, mirroring `RejectionCategory` (Task 03) and `AudioIssueType` (Task 05). The persistence path validates each decision against both runtime sets before binding; unknown rows are dropped and the count surfaces via `parseError` for one observer event. The agent's persistence batch (one draft_revisions row + one integrator_decisions row per decision) lives at `agents/src/integrator.ts` `persistRevision()`.
- **DrafterAgent.** Writes round 0 to `draft_revisions` inside `drafter.ts` `persistInitialDraft()`. Same fail-open posture (`persistError` sentinel returned via `DrafterResult`); Director logs once via observer.logError if populated.
- **Director.** Threads `pieceId` and `round` to both call sites (Drafter at draft-time, Integrator at each revision round). Reads `parseError` and `persistError` after each call and fires observer.logError once if either is populated. No new orchestration; just threading and logging.
- **Site worker.** Has no consumers of this contract today. The "How this was made" drawer's expansion to render the revision trail is queued in `docs/FOLLOWUPS.md` as a `[deferred]` entry — same posture as Tasks 03 + 04 + 05's deferred reader-facing surfaces.

The agent is the only consumer of the rule body — there are no scalar threshold values shared between agents and the site worker, so this contract has NO `agents/src/shared/integrator-thresholds.ts` mirror. Same posture as the audio contract (agents-only) — different from the audit / categoriser contracts which carry site-side threshold mirrors.

## Change log

- 2026-05-07 — v1.0 — extracted from `agents/src/integrator-prompt.ts` and `agents/src/integrator.ts` (Foundation Fix Task 06, branch `foundation-fix-06-draft-revisions`). Behaviour change: response shape extended from `{ revisedMdx, changesSummary }` (where changesSummary was just the input feedback echoed back) to `{ revisedMdx, decisions[] }` per the brief. New persistence to `draft_revisions` (round 1+) and `integrator_decisions` (one row per addressed feedback item). New closed enums `IntegratorDecision` and `FeedbackSource` in `agents/src/types.ts`. First post-Phase-1 contract extraction — Phase 1 closed 2026-05-10 with the categoriser extraction.
- 2026-05-07 — v1.1 — extended for Foundation Fix Task 09 (post-foundation, Phase 4 — programme COMPLETE). Behaviour change: the Integrator now sees all three audits on every call (PASS/FAIL framing for both passing and failing dimensions, not just FAIL), and Durable Object state carries the previous round's audits within a single piece. State is keyed by piece_id and resets lazily when piece_id differs from the stored snapshot. New types `IntegratorState` and `IntegratorRoundSnapshot` in `agents/src/types.ts`; `IntegratorAgent` now extends `Agent<Env, IntegratorState>` with `initialState`. New pure helpers `buildCurrentRoundFeedback` and `buildPreviousRoundContext` in `agents/src/integrator.ts`. Branch `post-foundation-09-integrator-awareness`. Closes the [open] 2026-05-12 FOLLOWUPS entry "Integrator regression risk".
