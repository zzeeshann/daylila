# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 0 — Spec, rubric, validator rules, sandbox rules** (not started)

## Last completed sub-task

None. v3 plan + status doc + session protocol installed. Empty `INTERACTIVES_PLAN_NOTES.md` ready for use. No code written. No commits made for v3 work yet other than the plan-install commit.

## Next sub-task

**Phase 0, sub-task 0.1: write `docs/INTERACTIVES.md`.**

Specifically:
1. Write `docs/INTERACTIVES.md` — covers what HTML interactives are, how they relate to quizzes, iframe sandbox shape, validator rule list, audit rubric, drawer-only rough-marker UX rule (with the exact reader text from the plan), pause toggle behaviour, prompt caching strategy.
2. Append `docs/DECISIONS.md` entry for the v3 architectural decisions.
3. Update `book/09-the-fourteen-roles.md` Generator + Auditor sections.
4. Append `docs/FOLLOWUPS.md` `[open]` entry for the book chapter filename rename.

Both open implementation calls from the v2-→-v3 conversation are resolved in the v3 plan itself (rough-marker = drawer only; hand-built example = permanent reference at `docs/examples/interactive-reference.html`). Phase 0 just writes them down in `docs/INTERACTIVES.md`; no fresh decision needed.

This is one logical phase. Ends with a `[phase-0.1]` commit cluster, then `git tag interactives-v3.0-complete` once the Phase 0 "Definition of done" passes (per `docs/INTERACTIVES_PLAN.md`).

## Blockers

None.

## Plan vs repo notes

(Empty. v3 plan was written with full repo knowledge. Will be populated only if Phase 1+ implementation surfaces a mismatch.)

## Live state

- `interactives_html_enabled`: setting doesn't exist yet (Phase 1).
- `interactives` table: exists (migration 0022). Quiz path live, HTML path not yet.
- `interactive_engagement` table: exists (migration 0022). Populated for quizzes; will extend to HTML in Phase 4.
- `interactive_audit_results` table: exists (migration 0023). Per-round per-dimension audit notes.
- `InteractiveGenerator` (#15): producing quizzes only.
- `InteractiveAuditor` (#16): auditing quizzes only.
- Site: 8 quizzes published. No HTML interactives yet. `/interactives/<slug>/` route serves quiz content via `<quiz-card>`.

## Sessions log

(Append a one-line summary at the end of every session. This is human-readable history.)

| Date | Phase | Sub-tasks completed | Notes |
|---|---|---|---|
| 2026-04-26 | n/a | v3 plan + status + session protocol installed; empty PLAN_NOTES created | Replaces v2 seed plan (in `~/Downloads/files/`) which pre-dated Area 4 and described building things that already exist. Commit `[interactives-plan-v3]`. |

## Tags

| Tag | Date | Commit |
|---|---|---|

(Empty until Phase 0 completes.)
