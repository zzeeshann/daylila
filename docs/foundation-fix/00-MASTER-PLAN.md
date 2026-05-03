# Zeemish Foundation Fix — Master Plan

## What this is

A focused programme of work to do two things, in order:

1. **Separate scattered rules into dedicated `.md` contract files** so prompts, validators, and human contributors all read from one source of truth per topic.
2. **Plug the high-severity data leaks** found in the data audit so future work has a clean foundation to build on.

This is foundation work. No new features. No new subdomains. No new agents. Just making the system honest about what it knows, and stopping it from losing data it should be keeping.

## Why now

The system has grown past its blueprint. Three signals confirmed this:

- The Scanner pulls 80 candidates per run (not 50 as in the original brief). Cadence is currently `interval_hours=12` — 2 runs per day, producing ~160 candidate-judgments per day. The brief documents a different number; documentation has not caught up.
- The Fact Checker was rebuilt on 2026-04-30 with Anthropic's `web_search_20250305` server tool and hardened the day after. It is actively searching and surfacing "Sources consulted" lines on every piece. This means the data leak fixes in Phase 2 inherit a working Fact Checker — the audit findings on it are about persistence (per-claim status, search-used flags), not about whether the agent is running.
- The public dashboard at `/dashboard/` is being retired in favour of the per-piece transparency built into `/daily/` (the expandable "Scanner pulled 80 stories for this run" panels under each piece). Foundation Fix work does not invest in dashboard repairs. Where the audit found dashboard counter staleness, that fix is not in scope; the surface is going away.
- A code-level data audit found **9 high-severity leaks** — places where the system produces useful judgments and reasoning but never persists them to D1.

Adding new surface area on top of an unmeasured, leaky base would compound the drift. The right move is to stabilise first, then build.

## The two threads

This work has two threads that interleave but have different shapes.

### Thread A — Rule centralisation

We agreed in earlier sessions (decisions logged in `docs/DECISIONS.md` and `docs/FOLLOWUPS.md`) that:

- Agent prompts — rubrics, voice rules, validator specs, type specs — should live in markdown files read at runtime via prompt caching.
- The voice contract (`content/voice-contract.md`) is the model. Other rules should follow the same pattern.
- Single source of truth per topic. No duplication between code constants and prose docs.

An earlier investigation identified roughly 12–15 duplicated rules across the codebase. Phase 1 below picks up that work and finishes it.

### Thread B — Data leak fixes

The data audit (saved at `plans/just-answer-no-code-synthetic-sifakis.md`) lists 25 leaks. We are only fixing the high-severity ones in this programme. The medium and low ones get cleaned up over the following weeks as we touch each agent for other reasons.

The high-severity leaks, in priority order:

| ID | Where | What's leaking |
|----|-------|----------------|
| L25 | Curator | `daily_candidates.selected=1` UPDATE never landed — historical data partially corrupt |
| L2  | Curator | Per-rejection reasoning never even produced (prompt issue) |
| L1  | Curator | Reasoning for the picked candidate not persisted |
| L15 | Learner | `applied_to_prompts` and `last_validated_at` columns exist but no UPDATE anywhere — feedback loop is half-built |
| L4  | Drafter | Initial + per-round drafts only in memory |
| L8  | Integrator | Per-round MDX diffs nowhere |
| L9  | Integrator | Per-feedback-item accept/overrule reasoning nowhere |
| L12 | Audio Auditor | No `audio_audit_results` table; verdicts only in `observer_events.context` JSON |
| L17 | Reader | Audio dwell time computed but never POSTed |

## Phase order and dependencies

```
Phase 1 — Rule centralisation
  01  Inventory all scattered rules        (read-only, produces report)
  02  Extract rules to .md contracts       (iterative, one contract at a time)

Phase 2 — High-severity data fixes
  03  Curator: rejection reasoning + selected-flag fix     (L2 + L25 + L1 together)
  04  Learner: close the feedback loop                     (L15)
  05  Audio Auditor: persist audit results                 (L12)
  06  Drafter + Integrator: persist revisions and diffs    (L4 + L8 + L9)
  07  Reader: dwell time pipe                              (L17)

Phase 3 — Hygiene
  08  Retention policy + run_id                            (L16 + L23 + L24)
```

Phase 1 runs first because once rules live in dedicated `.md` files, the data fixes in Phase 2 can update those files (e.g. recording rejection reasoning shape) instead of editing prompts buried in TypeScript.

Phase 2 tasks can run in any order after Phase 1 lands, but the order above is roughly by dependency and impact.

Phase 3 is hygiene that doesn't block anything but should land within the same programme so we don't carry tech debt into the next one.

## How to use these task files

Each numbered file (`01-`, `02-`, ..., `08-`) is a self-contained brief for **one Claude Code session**.

For each task:

1. Open Claude Code in the repo on a new branch.
2. Tell it: *"Read `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`, and `docs/AGENTS.md` first. Then read this task file in full."* Paste the task file.
3. Let Claude Code propose a plan inside Claude Code, review it, then approve.
4. After it's done, review the diff. Confirm docs were updated alongside code.
5. Commit, push, and only then move to the next task.

Important: **do not let Claude Code do more than one task per session.** Each task is small enough to land cleanly. Combining them creates messy diffs and blurs review.

## What success looks like

When all eight tasks are done:

- Every duplicated rule lives in exactly one `.md` file. Agents read that file at runtime. Code constants that duplicated the rule are gone.
- All 9 high-severity leaks are closed. New rows persist with reasoning. Old broken rows are documented if not fixable.
- The Learner's feedback loop is closed: learnings get marked when applied, validated when subsequent pieces score well.
- `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `docs/SCHEMA.md`, `docs/DECISIONS.md`, and `docs/FOLLOWUPS.md` are all updated to reflect the new state.

After this programme completes, the platform plan (subdomains, embeddings, side projects) picks back up on a foundation we trust.

## What this programme is NOT

- Not a refactor. We are not redesigning agents. We are completing work that was started.
- Not a feature programme. Nothing user-facing changes except possibly the "How this was made" drawer becoming richer.
- Not a measurement programme. Drift detection, A/B testing the Learner, auditor calibration — all deferred. We need data first; measurement comes after we have something to measure.
- Not exhaustive. The medium and low severity leaks (L3, L5, L6, L7, L10, L11, L13, L14, L16-partial, L18-22, L24) are not in scope here.

## A note on voice

Every commit message, every doc update, every PR description should follow the Zeemish voice contract. Plain English. No tribe words. No "let's dive in" or "transform" or "unlock." Specific over general. The voice rules apply to internal documentation as much as to published pieces — the system describes itself in the same voice it writes.

## Past decisions to honour

Before starting any task, Claude Code should refresh on these decisions which already shape this work:

- **Markdown-as-runtime-truth for agent prompts.** Logged in `docs/DECISIONS.md` (April 2026). Voice contract is the model.
- **Published pieces are permanent.** No agent revises, regenerates, or updates a published piece. Improvements feed forward only. This rule survives this programme intact.
- **Small commits, clear messages explaining WHY not WHAT.**
- **Update docs alongside code in the same commit, not after.**
- **The book updates alongside the engineering.** Every task in this programme has a corresponding book update task documented in `docs/foundation-fix/BOOK-UPDATES.md`. Skipping the book update is not allowed; it's part of "what success looks like" for every task.

If any task in this programme would violate one of these decisions, stop and flag it before proceeding.
