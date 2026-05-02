# Zeemish Foundation Fix

This folder contains the plan and individual task briefs for the foundation fix programme.

## Read in this order

1. **`00-MASTER-PLAN.md`** — the overall plan, principles, phase order, and how to use these files.
2. The numbered task files (01–08) — one per Claude Code session.

## How to run a task

For each task file, in order:

1. Open Claude Code in the Zeemish repo on a new branch.
2. Tell Claude Code: *"Read CLAUDE.md, docs/DECISIONS.md, docs/FOLLOWUPS.md, and docs/AGENTS.md first. Then read the task brief I'm about to paste in full."*
3. Paste the task file contents.
4. Let Claude Code propose its plan, review, approve.
5. After it's done, review the diff. Confirm docs got updated alongside code.
6. Commit, push, deploy.
7. Verify per the "How to verify it worked" section in the task file.
8. **Only then** move to the next task.

One task per session. Don't combine. Each task is sized to land cleanly.

## The eight tasks

| # | Title | What it fixes |
|---|-------|---------------|
| 01 | Rule Inventory | Read-only investigation. Maps every scattered rule. |
| 02 | Rule Extraction | Iterative. Extracts rules to `.md` contract files, one cluster at a time. |
| 03 | Curator Fix | L1, L2, L25 — pick reasoning, rejection reasoning, selected-flag bug |
| 04 | Learner Loop | L15 — closes the half-built feedback loop |
| 05 | Audio Audit | L10, L11, L12 — persists audio audit results; fills audio metadata |
| 06 | Draft Revisions | L4, L8, L9 — persists every revision and every Integrator decision |
| 07 | Dwell Time | L17 — pipes audio dwell from frontend to engagement table |
| 08 | Retention + Run ID | L16, L23, L24 — adds run_id end-to-end, retention policy, audit normalisation |

## Phase boundaries

**Phase 1 — Rule centralisation:** tasks 01 and 02. Foundation for everything after.

**Phase 2 — High-severity data fixes:** tasks 03–07. Plug the leaks.

**Phase 3 — Hygiene:** task 08. Retention and traceability.

After all eight: foundation work is complete. Next session is the start of the platform plan (subdomains, embeddings).

## Principles to keep through all tasks

- One task per session. Small commits, clear messages.
- Update docs alongside code in the same commit.
- Behaviour-preserving where possible. Document what exists; only change behaviour when explicitly required by the task.
- Every commit follows the Zeemish voice: plain English, no tribe words.
- Published pieces are permanent. Never revise, regenerate, or update a published piece. Improvements feed forward only.

## When in doubt

If a task seems to require something the brief didn't anticipate, stop and check before proceeding. The cost of stopping and asking is small. The cost of doing the wrong refactor and finding out three sessions later is large.
