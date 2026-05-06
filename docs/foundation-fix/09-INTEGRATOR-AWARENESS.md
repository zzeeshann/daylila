# Task 09 — Integrator: Regression Awareness

**Phase:** Post-foundation (or 4 if you extend the programme)
**Type:** Code change to two files + DO state addition + prompt update + contract update
**Estimated session length:** 60–90 minutes
**Prerequisite:** Phase 2 Task 06 complete (`integrator_decisions` table exists). Phase 3 complete.

## Context

The Integrator currently only sees feedback from FAILED auditors. Look at `agents/src/integrator.ts` — the feedback array is built with three `if (!result.passed)` blocks. Passing audits are dropped before the prompt is even constructed. Claude inside the Integrator never knows what was passing.

The class header even confirms it:

> *"Stateless — Director spawns a fresh instance per day."*

The agent extends `Agent<Env>` so it could store anything between calls, but `revise()` doesn't touch state.

This causes a regression risk that's easy to demonstrate:

- **Round 1:** Voice passes (92), Fact fails, Structure fails. Integrator gets only Fact + Structure feedback. Its rewrite to fix those two might inadvertently change something that affects voice.
- **Round 2:** Voice now fails, Fact passes, Structure passes. Integrator gets only Voice feedback. Its rewrite to fix voice might re-introduce a fact or structure issue.
- **Round 3:** Could flip again. After three rounds, ships as Rough.

The piece is shipping as Rough not because the writing was genuinely bad but because the Integrator was whack-a-moling between dimensions with no memory of what was working. Phase 2 Task 06's `integrator_decisions` data will conflate "genuinely hard piece" with "Integrator chasing its tail" — making the question "is the system getting better?" harder to answer cleanly.

This task fixes the regression risk in two parts:

1. **Within-round awareness** — pass all three audit results (including passes) to the prompt so Claude can preserve passing dimensions while fixing failing ones.
2. **Round-to-round awareness** — store last round's audit results in DO state so the Integrator sees "voice was passing last round; this round we still need to preserve it."

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/AGENTS.md` — Integrator section
3. `agents/src/integrator.ts` (~75 lines, the current implementation)
4. `agents/src/integrator-prompt.ts` (the system prompt builder)
5. `agents/src/director.ts` around lines 314–383 (the audit loop, for context — no changes here)
6. `content/integrator-contract.md` (the rule contract)
7. The verification SQL in Task 06's brief (`integrator_decisions` table shape)

## Sub-task 1 — Pass all audits to the prompt

Modify the feedback assembly in `revise()`. Today it skips passing audits entirely. Change it to always include all three dimensions, with framing that distinguishes them:

- For passing audits: include the score and an explicit "preserve this dimension — do not change anything that would affect it" instruction.
- For failing audits: keep the existing violations + suggestions structure.

The prompt sent to Claude should always have three sections (Voice, Fact, Structure), each marked PASS or FAIL with the relevant detail.

## Sub-task 2 — Update `integrator-prompt.ts`

The system prompt builder needs new instructions:

- "You will see PASS or FAIL for each of three dimensions: voice, fact, structure."
- "For dimensions marked PASS: preserve them. Do not introduce changes that affect those qualities."
- "For dimensions marked FAIL: fix them based on the violations and suggestions provided."
- "If a dimension was passing in the previous round and is now failing, that is a regression introduced by your last revision. Be especially careful: fix what's currently failing without re-breaking what's now passing."

## Sub-task 3 — Add DO state for round-to-round awareness

The Integrator class extends `Agent<Env>`. Add state that tracks the last call's audit results, keyed by `piece_id`. Pass them into the next call's prompt as "previous round" context.

State reset rule: when `piece_id` differs from the stored piece_id, clear state. A new piece's first revision should not see another piece's history. Round 1 of any piece sees no "previous round" data and the prompt handles that case cleanly.

The "Stateless — Director spawns a fresh instance per day" comment in the class header needs to be replaced. The Integrator is no longer stateless within a piece, by design.

## Sub-task 4 — Update `integrator-contract.md`

Document the new behavior in the contract:

- The Integrator sees all three audit results each round, with explicit PASS/FAIL framing.
- Passing dimensions are protected: the Integrator must not introduce changes that affect them.
- Round-to-round state: the Integrator remembers the previous round's audits within a single piece.
- State resets when piece_id changes.

The contract is the source of truth. The agents/code is the executor.

## Sub-task 5 — Update docs

- `docs/AGENTS.md` — Integrator section: replace the "stateless" framing with "round-aware within a piece." Document the new prompt shape.
- `docs/DECISIONS.md` — append: "YYYY-MM-DD Integrator regression awareness landed. Passing audits and previous round state now flow into revisions. Closes the regression-risk follow-up filed YYYY-MM-DD."
- `docs/FOLLOWUPS.md` — close the open entry that filed this issue.
- `CLAUDE.md` — update the agent description if affected.
- The audit-loop book chapter per `docs/foundation-fix/BOOK-UPDATES.md` — the chapter currently describes the auditors as the protective gate; this update means the Integrator is also protective now, not just reactive.

## What success looks like

- The Integrator's prompt always shows all three dimensions.
- DO state correctly carries last round's audits within a piece and clears between pieces.
- After deployment, querying `integrator_decisions` (from Task 06) for round-to-round transitions shows fewer "previously passing dimension now failing" rows.
- Pieces that were shipping as Rough due to dimension whack-a-mole start landing as Solid or Polished instead.
- Average revision rounds per Solid-tier piece may decrease (fewer rounds wasted on regression).
- One commit per logical change typical (integrator.ts + prompt change, contract update, docs). Probably 2–3 commits in this session.

## What NOT to do

- Do not change what the auditors check. The auditors stay exactly the same.
- Do not change the Director's audit loop. Round count, parallel audit invocation, pass condition — all unchanged. The fix is contained to `integrator.ts` and `integrator-prompt.ts`.
- Do not extend round-to-round memory beyond the current piece. The Integrator forgets when piece_id changes. This task is about regression protection within a single piece's 3-round budget, not about cross-piece learning (that's the Learner's job).
- Do not bundle this with any other agent fix.
- Do not retrofit historical pieces. Going forward only.

## How to verify it worked

**Pre-deploy spot check.** Find a recent piece in `integrator_decisions` that took 2+ rounds. Look at the audit transitions round-to-round. Document a case where a dimension flipped pass → fail. That's the failure mode this task fixes.

**Post-deploy verification.** Watch the next ~10 pieces that go through 2+ revision rounds. Run:

```sql
WITH round_pairs AS (
  SELECT
    a.piece_id,
    a.feedback_source,
    a.revision_round AS round_n,
    a.decision AS decision_n,
    b.revision_round AS round_n_plus_1,
    b.decision AS decision_n_plus_1
  FROM integrator_decisions a
  JOIN integrator_decisions b
    ON a.piece_id = b.piece_id
   AND a.feedback_source = b.feedback_source
   AND b.revision_round = a.revision_round + 1
)
SELECT feedback_source, COUNT(*) AS regressions
FROM round_pairs
WHERE decision_n = 'overruled'  -- was passing
  AND decision_n_plus_1 = 'accepted'  -- now needs fixing
GROUP BY feedback_source;
```

Compare regressions/piece before and after deploy. Expected: the per-source regression count drops noticeably.

If the count doesn't drop, either the prompt change didn't take effect or the DO state isn't being read correctly. Diagnose by inspecting the actual prompt sent to Claude on a fresh run.

## What this enables later (deferred)

Once the Integrator is round-aware, two future improvements become possible:

- **Smarter early termination.** If the Integrator sees the same dimension flipping back and forth across rounds, it could surface this to the Director as "this piece can't be reconciled — ship it as Rough now rather than burning round 3."
- **Better Rough-tier signal.** Rough pieces post-fix should be genuinely hard pieces (good signal for the Learner). Today they're a mix of hard pieces and whack-a-mole; that distinction was invisible.

Add to `docs/FOLLOWUPS.md` after this lands:

> Once 30 days of post-fix `integrator_decisions` data accumulates, evaluate whether Rough-tier pieces are now meaningfully different from Solid-tier in their revision patterns. If yes, the data is ready to feed the Learner. If not, deeper rework needed.
