# Task 01 — Rule Inventory

**Phase:** 1 (Rule centralisation)  
**Type:** Read-only investigation. No code changes. No new files except the inventory report itself.  
**Estimated session length:** 30–60 minutes.  
**Prerequisite:** None. This is the first task.

## Context

Zeemish has rules scattered across many places: agent prompt files, TypeScript constants, validators, the existing voice contract, brief docs, and inline magic numbers. Some rules are duplicated in multiple places, which means a change in one place silently disagrees with another.

We previously agreed (logged in `docs/DECISIONS.md` and `docs/FOLLOWUPS.md` in April 2026) that:

> Agent prompts (rubrics, voice rules, validator specs, type specs) should live in markdown read at runtime via prompt caching, not duplicated in TypeScript constants. The voice contract already follows this pattern.

A previous investigation in `docs/FOLLOWUPS.md` (entry: `[open] 2026-04-30 (last): Centralise contracts`) already produced a substantial map of the duplications. It documents Tier 1 (8 exact-text duplications with line-number evidence), Tier 2 (3 paraphrased rules), Tier 3 (constants defined but not injected), Tier 4 (the html-reference precedent), the Cloudflare Workers runtime constraint (no `readFileSync` at runtime, no esbuild-plugin support in Wrangler v4), and a recommended approach (Option A: build-time codegen, phases A/B/C/D).

**This task does not start from scratch.** It verifies and completes that existing map. Task 01 produces `docs/RULE-INVENTORY.md` as the consolidated successor document, importing what's already documented in FOLLOWUPS and filling any gaps.

## What this task does

Produces a single new file: `docs/RULE-INVENTORY.md`.

This file is the complete map of every rule in the system that controls how an agent or validator behaves. The map is the prerequisite for Task 02, which will use it to decide how to group rules into contract files.

## What to read first

In this order:

1. `CLAUDE.md` — project state and current direction
2. `docs/FOLLOWUPS.md` — specifically the `[open] 2026-04-30 (last): Centralise contracts` entry. **Read this in full before any other reading on this task.** It contains the existing duplication map.
3. `docs/DECISIONS.md` — past architectural decisions, especially the markdown-as-runtime-truth principle (April 2026)
4. `content/voice-contract.md` — the model for what a rule contract looks like

## What counts as a "rule"

A rule is any of these:

- **Numeric thresholds.** Voice score ≥ 85, max 3 revision rounds, 80 candidates per scan, 3-6 beats per piece, 3-5 quiz questions, 1000-1500 words per piece, etc.
- **Structural specs.** Beat shape (hook → teaching → watch → close), MDX frontmatter required fields, audio file naming, slug format.
- **Behavioural rubrics.** What the Voice Auditor scores against. What the Structure Editor scores against. What "teachable" means to the Curator. What "verified" means to the Fact Checker.
- **Format constraints.** Quiz answer-option count, reasoning paragraph length, allowed file extensions, allowed tags.
- **Voice/style rules.** Anything that shapes how text reads (already in `voice-contract.md` — note where it's referenced from).
- **Validator specs.** Anything an interactive auditor or schema validator checks.
- **Magic numbers.** Any literal in code (`if (score >= 85)`, `MAX_ROUNDS = 3`, `SLICE(0, 80)`) that encodes a rule.

A rule is NOT:

- Implementation details (caching strategy, retry policy, timeout values).
- Database schema (column types, indices).
- Infrastructure config (R2 bucket names, worker bindings).

If unsure, include it. The grouping in Task 02 will sort signal from noise.

## How to find them

Two passes, in this order. (Three is overkill given the existing FOLLOWUPS map — the first pass is verification, not discovery.)

**Pass 1 — Verify the existing map.** For each rule already listed in the FOLLOWUPS centralise-contracts entry, confirm it still exists at the cited line numbers, the duplications still match, and nothing has been silently changed since 2026-04-30. Mark each as VERIFIED, MOVED (still duplicated but file/line shifted), or RESOLVED (already centralised since the entry was written).

**Pass 2 — Fill gaps.** Walk through `agents/src/`, `src/`, `workers/`, `docs/`, `content/`, and the project root. Look for rules NOT in the FOLLOWUPS map. These are the additions.

## What `docs/RULE-INVENTORY.md` must contain

For each rule, one row in this format:

```
### Rule: <short name>

- **What it says:** <one-sentence description>
- **Where defined:** file path : line numbers (every place it appears)
- **Type:** threshold | structural | rubric | format | voice | validator | magic-number
- **Used by:** which agents or surfaces depend on this rule
- **Duplicated:** yes / no — if yes, list the conflicting locations and note any disagreement between them
- **Notes:** anything weird (e.g. "voice contract referenced but not loaded at runtime here")
```

Group the rules by **proposed topic cluster** at the end of the file. Suggested clusters (do not finalise — Task 02 will decide):

- Voice and tone
- Beat structure and piece shape
- Quiz / interactive shape
- Audit thresholds and gates
- Curator selection criteria
- Fact-check verification rules
- Audio production rules
- Categoriser rules

If a rule fits in more than one cluster, list it under each but mark the primary one.

End the file with two short sections:

- **"Duplications found"** — a numbered list of every rule that appears in two or more places, with a one-line note on whether the duplicates agree.
- **"Single-source rules"** — rules that already live in exactly one place and one format. Note whether that one place is a `.md` file (good) or a code constant (will need extraction in Task 02).

## What success looks like

- `docs/RULE-INVENTORY.md` exists and lists every rule found.
- Every rule has its file path and line number(s) cited.
- Every duplication is flagged.
- The file ends with a proposed cluster grouping.
- `docs/FOLLOWUPS.md` gets a one-line update: "Rule inventory completed in `docs/RULE-INVENTORY.md` — Task 01 of foundation-fix programme."
- One commit. Message: `docs: produce rule inventory for centralisation work`.

## What NOT to do

- Do not extract any rule into a new contract file. That is Task 02.
- Do not change any existing code or prompt.
- Do not redesign the voice contract or any existing `.md`.
- Do not propose a final cluster grouping. Suggestions only.
- Do not skip rules because "they're obvious." Magic numbers in code count. List them.
- Do not bundle this with anything else.

## How to verify it worked

Read the inventory. Sanity check:

- Voice score threshold (≥85) is listed and shows where it's referenced (probably `agents/src/director.ts` and the voice contract).
- Quiz question count (3-5) is listed.
- Candidate cap (80) is listed.
- Revision rounds (3) is listed.
- Beat count (3-6) is listed.
- The voice contract is listed as a single-source rule already living in `.md`.

If any of those are missing, the inventory pass was incomplete. Re-run.
