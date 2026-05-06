Now we're starting Task 09 — Integrator regression awareness. This is post-foundation (Phase 2 and Phase 3 are complete). The brief is at `docs/foundation-fix/09-INTEGRATOR-AWARENESS.md`.

The issue: today the Integrator only sees failed audits. If voice passed and the Integrator's fix to fact or structure inadvertently breaks voice, the system has no mechanism to prevent it. Pieces can ship as Rough not because the writing was bad but because the Integrator was chasing its tail across dimensions. The regression was observed in real production data on the 2026-05-06 magic-mushroom piece — voice scored 95 in Round 1, dropped to 92 in Round 2 after the Integrator's revision introduced "unlock" (a banned tribe word), then recovered to 95 in Round 3.

The fix has two parts: pass all three audit results (including passes) into the prompt with explicit PRESERVE/FIX framing, and add Durable Object state so the Integrator sees the previous round's audits within a single piece.

## Pre-flight — get current git state before reading anything else

```
git status
git fetch
git pull
git log --oneline -10
```

Report what you find. If main is behind, pull. If there are uncommitted changes, stop and tell me.

## Verify prerequisites are actually in place — don't assume from documentation

- Phase 2 Task 06 has shipped (the `integrator_decisions` table exists). Confirm by querying the remote D1 database — adapt the exact wrangler syntax to your CLI version, the query is `SELECT name FROM sqlite_master WHERE type='table' AND name='integrator_decisions';`.
- Phase 3 Task 08 has shipped (run_id exists across tables). Check the latest migration number in `migrations/` is 0030+ and `daily_pieces.run_id` column exists.
- The relevant FOLLOWUPS entry referencing this regression has status `[open]` (not `[resolved]` or `[wontfix]`).

If any prerequisite isn't in place, STOP and tell me what's missing. Don't try to work around it.

## Read in this order. Re-read each file in full — don't rely on memory of what these files look like

1. `CLAUDE.md`
2. `docs/foundation-fix/09-INTEGRATOR-AWARENESS.md` (the brief — self-contained spec)
3. `docs/DECISIONS.md` (Phase 2 + Phase 3 closing entries; integrator-contract canonical entry; any decisions referencing the Integrator)
4. `docs/FOLLOWUPS.md` (find the open regression-risk entry that this task closes)
5. `agents/src/integrator.ts` (~75 lines — note the "Stateless" comment that this task changes)
6. `agents/src/integrator-prompt.ts` (read the actual code, don't infer what it does from the name)
7. `agents/src/director.ts` around lines 314–383 (the audit loop, for context — no changes here)
8. `content/integrator-contract.md` (the rule contract)

## Verify the regression pattern exists in production data before proposing the fix

Run the regression-counting SQL from the brief against `integrator_decisions`. Find at least one concrete piece where a previously-passing dimension flipped to fail in the next round, and quote the result. If you can't find one in the last 30 days, STOP and tell me — the fix may not be needed yet, or the data may not be there to verify.

## Don't assume — verify by reading the actual code

- Don't assume how the Integrator's `revise()` filters audits. Read the function.
- Don't assume how the Agent base class handles state between calls. Read the agents SDK source if needed.
- Don't assume the integrator_decisions schema. Query `PRAGMA table_info(integrator_decisions);` against the remote D1 database.
- Don't assume the contract injection mechanism. Confirm by reading the codegen output or a recent rendered prompt.

## Branch off main

```
git checkout main && git pull && git checkout -b post-foundation-09-integrator-awareness
```

## Important constraints

- This task ADDS state to a previously-stateless agent. The "Stateless — Director spawns a fresh instance per day" comment in the class header needs to be updated alongside the behaviour change. State is keyed by piece_id and resets when piece_id changes.
- All three audit results now flow into the prompt every call. For passing ones, the prompt shows PASS with the score and an explicit "preserve this dimension" instruction. For failing ones, the existing violation/suggestion structure stays.
- Rule changes go in `content/integrator-contract.md` — codegen picks them up via the contract injection. Do not bury new rule body inline in `integrator-prompt.ts`.
- Verification depends on Phase 2 Task 06's `integrator_decisions` table. The brief's regression-counting SQL is the success metric.
- Docs update in same commit as code: `AGENTS.md` (Integrator entry), `DECISIONS.md` (append), `FOLLOWUPS.md` (close entry), `CLAUDE.md` (if affected), the audit-loop book chapter per `BOOK-UPDATES.md`.
- The fix is contained to `integrator.ts` and `integrator-prompt.ts` — no Director changes, no auditor changes, no schema migration.
- Reference the 2026-05-06 magic-mushroom-piece observation in the DECISIONS entry as the catalyst that validated the regression in production data.

## Plan-mode workflow

**Phase 1 — Initial Understanding:** run pre-flight git, verify prerequisites, run the regression SQL, read the listed files. Report findings before proceeding to design.

**Phase 2 — Design:** launch a Plan agent. Cover: (1) the new prompt shape with PRESERVE framing; (2) the DO state shape — what's stored, keyed by piece_id, reset rule when piece_id changes; (3) the `integrator-prompt.ts` changes — instructions for preserving passes and noticing regressions; (4) the contract update; (5) which docs and book chapters update.

**Phase 3 — Review:** cross-check against the brief's "what success looks like" — verification can be done against the `integrator_decisions` table from Task 06 using the regression-counting SQL.

**Phase 4 — Final Plan:** write to the plan file. Cite line numbers from your actual reads, not from memory. Include verification section (pre-deploy spot-check + post-deploy 10-piece audit).

**Phase 5 — ExitPlanMode for approval.**

## Stop-conditions — if any of these turn out to be true, STOP and report. Don't work around

- The regression doesn't show up in production data → may not be needed yet.
- The Integrator code already has some of what we're proposing → tell me, may not need full task.
- Task 06 or Task 08 hasn't actually shipped → prerequisite missing.
- The contract injection doesn't work the way the brief assumes → tell me before designing the fix.

Asking is cheaper than reverting.
