# Task 02 — Rule Extraction Into Contract Files

**Phase:** 1 (Rule centralisation)  
**Type:** Iterative refactor. One contract per session.  
**Estimated session length:** 60–90 minutes per contract.  
**Prerequisite:** Task 01 complete. `docs/RULE-INVENTORY.md` exists.

## Context

Task 01 produced an inventory of every rule in the system. Some rules are duplicated. Some live in code constants. Some live in inline prompts. The voice contract (`content/voice-contract.md`) is the single existing example of a rule contract done well.

This task replicates the voice contract pattern for one cluster of rules at a time.

The principle (already agreed in `docs/DECISIONS.md`):

> Agent prompts — rubrics, voice rules, validator specs — should live in markdown files, read at runtime via prompt caching. Single source of truth. No duplication between code and prose.

## How this task is different from a typical refactor

This is **iterative**. We extract **one contract per session**, ship it, review it, then move to the next. Do not extract two contracts in the same session. Do not refactor the whole codebase in one pass.

The reason: each contract change touches multiple agents and prompts. Reviewing one cluster at a time is the only way to catch subtle behavioural changes.

## Per-session work

Each session of Task 02 does this:

1. Read `docs/RULE-INVENTORY.md` and pick **one cluster** to extract. Start with the highest-leverage cluster (most duplicated, most central). Suggested order if no other guidance: **beat structure** → **quiz/interactive** → **audit thresholds** → **fact-check** → **curator** → **audio** → **categoriser**.

2. Confirm with the user *before extracting* which cluster you'll do this session. If running unattended, take the next one in the order above that hasn't been done.

3. Create the new contract file at `content/<cluster>-contract.md`. Follow the structure of `content/voice-contract.md` — versioned, plain-English rules, examples where useful.

4. Update every place in the code where a rule from this cluster lives. Replace inline prompts and constants with runtime reads of the new contract file.

5. Confirm prompt caching still works. The contract should be loaded once per request, not re-read on every Claude call inside a single agent run.

6. Update documentation:
   - `docs/AGENTS.md` — note which agents now read this contract
   - `docs/DECISIONS.md` — append: "Rule cluster X extracted to `content/<cluster>-contract.md` on YYYY-MM-DD"
   - `docs/RULE-INVENTORY.md` — mark the cluster's rules as "extracted, see `content/<cluster>-contract.md`"
   - `CLAUDE.md` — if the cluster is referenced in the project state, update it

7. Commit. Message format: `refactor: extract <cluster> rules into content/<cluster>-contract.md`. Body explains which agents now read it and what the previous duplication was.

## What to read first

Each session, before any extraction:

1. `CLAUDE.md`
2. `docs/RULE-INVENTORY.md` — the map produced in Task 01
3. `docs/DECISIONS.md` — especially the markdown-as-runtime-truth decision
4. `content/voice-contract.md` — the model
5. The agents that the chosen cluster touches

## Structure of a contract file

Every contract file follows this skeleton:

```markdown
# <Cluster Name> Contract

**Version:** 1.0  
**Last updated:** YYYY-MM-DD  
**Read by:** Agent A, Agent B, Validator C

## Purpose

One paragraph in plain English. What this contract governs. Why it exists.

## Rules

### Rule 1: <name>

What the rule is. Numbers and shapes specified concretely.

**Why:** one sentence on the reasoning.  
**Examples (if useful):** plain illustrations.  
**Edge cases:** any exceptions and how to handle them.

### Rule 2: ...

[etc]

## How agents apply this contract

One short section per agent that reads this file. What they do with it.

## Change log

- YYYY-MM-DD — v1.0 — extracted from <list of previous locations>
- YYYY-MM-DD — v1.1 — <what changed and why>
```

The voice contract is the canonical example. New contracts should not invent their own shape unless there's a specific reason.

## Special handling for the voice contract

The voice contract already exists. Do not rewrite it. Only:

- Confirm it is read at runtime by every agent that should read it.
- Note any agent that *should* read it but currently doesn't.
- Add it to the contracts list at the top of `docs/AGENTS.md`.

## What success looks like for one session

After one session:

- One new `content/<cluster>-contract.md` file exists, modelled on the voice contract.
- Every duplicate or hardcoded version of those rules in code is gone, replaced by a runtime read.
- Behaviour is unchanged. The contract documents what the system already does, not what we wish it did.
- `docs/AGENTS.md`, `docs/DECISIONS.md`, `docs/RULE-INVENTORY.md`, and `CLAUDE.md` are updated in the same commit.
- Tests (if any exist) still pass.
- One commit. Message follows the format above.

## What NOT to do in a single session

- Do not extract more than one cluster.
- Do not change the rules while extracting them. If a rule looks wrong, note it in `docs/FOLLOWUPS.md` and continue extracting it as-is. Behaviour-preserving refactor only.
- Do not invent new rules to "round out" the contract. Only document rules that already exist.
- Do not delete the old code locations without replacing them with a runtime read — leaving an agent without its rules silently breaks behaviour.
- Do not change voice contract content. It's already done.

## How to verify it worked

Three checks per session:

1. **The contract file exists and reads cleanly.** Plain English, no jargon, follows the voice contract's style.
2. **Behaviour is unchanged.** Run the affected agents (or trigger a test piece if possible) and confirm output looks identical to before. The point is to move the rules, not change them.
3. **No duplication remains.** Search the codebase for any hardcoded version of the rules you just extracted. Should find zero, except the contract file itself.

## When to stop and ask

Stop and ask the user before proceeding if:

- A rule appears in three or more places with subtly different values (we have to decide which is canonical).
- An agent that you'd expect to read the contract has never read any rule for this cluster (we may be discovering missing behaviour, not just relocating existing behaviour).
- The contract file would be longer than the voice contract (probably too broad — split it).

## Tracking progress

After each session, update a checklist at the bottom of `docs/RULE-INVENTORY.md`:

```
## Extraction progress

- [x] voice (already existed)
- [x] beats — content/beat-contract.md (commit abc1234, 2026-05-04)
- [ ] quiz
- [ ] audit-thresholds
- [ ] fact-check
- [ ] curator
- [ ] audio
- [ ] categoriser
```

When all clusters are extracted and the checklist is complete, Phase 1 is done and we move to Phase 2.
