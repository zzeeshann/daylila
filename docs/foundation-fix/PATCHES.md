# Patches to Apply Before Task 01

**Source:** Claude Code's review of the Foundation Fix files after saving them to the repo. Three of its five flags were correct and require small fixes before Task 01 begins.

**How to apply:** Open Claude Code in a fresh session. Tell it: *"Apply the patches in `docs/foundation-fix/PATCHES.md` to the existing foundation-fix task files. One commit. Message: `docs: patch foundation fix plan with corrections from review`. Then stop."*

---

## Patch 1 — Fact Checker is not offline

**File:** `00-MASTER-PLAN.md`

**Find this section** under "Why now":

> The Fact Checker's web layer has been offline for some time; pieces are publishing without the second-source verification the design originally required.

**Replace with:**

> The Fact Checker was rebuilt on 2026-04-30 with Anthropic's `web_search_20250305` server tool and hardened the day after. It is actively searching and surfacing "Sources consulted" lines on every piece. This means the data leak fixes in Phase 2 inherit a working Fact Checker — the audit findings on it are about persistence (per-claim status, search-used flags), not about whether the agent is running.

**Also update** the same file's mention of the Fact Checker elsewhere if it implies the agent is broken. The agent is fine. The persistence around it is what's being fixed.

---

## Patch 2 — Cadence is 2 runs/day, not 5

**File:** `00-MASTER-PLAN.md`

**Find:**

> The Scanner pulls 80 candidates per run (not 50 as in the brief), with ~5 runs per day producing ~400 candidate-judgments per day.

**Replace with:**

> The Scanner pulls 80 candidates per run (not 50 as in the original brief). Cadence is currently `interval_hours=12` — 2 runs per day, producing ~160 candidate-judgments per day. The brief documents a different number; documentation has not caught up.

**Reason:** The actual `admin_settings.interval_hours` value is 12, not the 5-runs-per-day I extrapolated from a screenshot. 160 per day across 365 days is still ~58,000 candidate-judgments per year, which is plenty to justify the persistence work. Just state the number correctly.

---

## Patch 3 — Task 01 reframes as verification, not fresh investigation

**File:** `01-RULE-INVENTORY.md`

**Find this section** ("Context"):

> A previous investigation in `docs/FOLLOWUPS.md` mapped roughly 12–15 duplicated rules. This task picks up that thread and finishes the inventory before any extraction work begins.

**Replace with:**

> A previous investigation in `docs/FOLLOWUPS.md` (entry: `[open] 2026-04-30 (last): Centralise contracts`) already produced a substantial map of the duplications. It documents Tier 1 (8 exact-text duplications with line-number evidence), Tier 2 (3 paraphrased rules), Tier 3 (constants defined but not injected), Tier 4 (the html-reference precedent), the Cloudflare Workers runtime constraint (no `readFileSync` at runtime, no esbuild-plugin support in Wrangler v4), and a recommended approach (Option A: build-time codegen, phases A/B/C/D).
>
> **This task does not start from scratch.** It verifies and completes that existing map. Task 01 produces `docs/RULE-INVENTORY.md` as the consolidated successor document, importing what's already documented in FOLLOWUPS and filling any gaps.

**Find this section** ("What to read first"):

> 1. `CLAUDE.md` — project state and current direction
> 2. `docs/DECISIONS.md` — past architectural decisions, especially the markdown-as-runtime-truth principle
> 3. `docs/FOLLOWUPS.md` — the earlier investigation that started this work
> 4. `content/voice-contract.md` — the model for what a rule contract looks like

**Replace with:**

> 1. `CLAUDE.md` — project state and current direction
> 2. `docs/FOLLOWUPS.md` — specifically the `[open] 2026-04-30 (last): Centralise contracts` entry. **Read this in full before any other reading on this task.** It contains the existing duplication map.
> 3. `docs/DECISIONS.md` — past architectural decisions, especially the markdown-as-runtime-truth principle (April 2026)
> 4. `content/voice-contract.md` — the model for what a rule contract looks like

**Find this section** ("How to find them"):

> Three passes, in this order: ...

**Replace the opening with:**

> Two passes, in this order. (Three is overkill given the existing FOLLOWUPS map — the first pass is verification, not discovery.)
>
> **Pass 1 — Verify the existing map.** For each rule already listed in the FOLLOWUPS centralise-contracts entry, confirm it still exists at the cited line numbers, the duplications still match, and nothing has been silently changed since 2026-04-30. Mark each as VERIFIED, MOVED (still duplicated but file/line shifted), or RESOLVED (already centralised since the entry was written).
>
> **Pass 2 — Fill gaps.** Walk through `agents/src/`, `src/`, `workers/`, `docs/`, `content/`, and the project root. Look for rules NOT in the FOLLOWUPS map. These are the additions.

The rest of Task 01's instructions stand.

---

## Patch 4 — `docs/CLAUDE.md` is wrong

**Files affected:** all task files that reference reading `CLAUDE.md`. Search for `docs/CLAUDE.md` and replace with `CLAUDE.md` (it lives at repo root, not in `docs/`).

This appears in `00-MASTER-PLAN.md`, possibly `01-RULE-INVENTORY.md`, and a handful of other task files. One pass over the directory catches them all.

---

## Patch 5 — Add the book update protocol

A new file is being added at `docs/foundation-fix/BOOK-UPDATES.md` (separate from these patches; see that file directly). It defines how the book gets updated alongside foundation fix work.

**Update `00-MASTER-PLAN.md`** to add a new bullet under "Past decisions to honour":

> - **The book updates alongside the engineering.** Every task in this programme has a corresponding book update task documented in `docs/foundation-fix/BOOK-UPDATES.md`. Skipping the book update is not allowed; it's part of "what success looks like" for every task.

That's the only master-plan change for this patch. The detailed book guidance lives in the BOOK-UPDATES file.

---

## Patch 6 — Note that the public dashboard is going

**File:** `00-MASTER-PLAN.md`

**Find any mention of "the dashboard"** in the "Why now" section that frames the dashboard as a transparency surface to be fixed.

**Replace with this single bullet under "Why now":**

> The public dashboard at `/dashboard/` is being retired in favour of the per-piece transparency built into `/daily/` (the expandable "Scanner pulled 80 stories for this run" panels under each piece). Foundation Fix work does not invest in dashboard repairs. Where the audit found dashboard counter staleness, that fix is not in scope; the surface is going away.

This shifts the framing in Task 03 (Curator) and elsewhere if any task suggested dashboard updates. Audit each task file for "dashboard" mentions; if any task implies dashboard work, replace with "no dashboard work; the data lands in D1 and that's enough."

---

## After applying

Commit message: `docs: patch foundation fix plan based on review (Fact Checker live, cadence corrected, Task 01 reframed, book protocol added, dashboard going)`

Then stop. Task 01 starts in a fresh session.
