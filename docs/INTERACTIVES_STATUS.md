# Interactives v3 — Status

This is the live source of truth for the HTML-interactives-alongside-quizzes work. Updated at the end of every session. If this doc disagrees with `git tag --list "interactives-v3.*-complete"`, the tags win — reconcile this doc immediately and tell the user.

---

## Active project

Interactives v3 — adding HTML interactives (sliders, scrubbable timelines, whatever shape Claude judges fits the concept) alongside the quiz system that shipped in Area 4. Plan in `docs/INTERACTIVES_PLAN.md`. Spec in `docs/INTERACTIVES.md`. Protocol in `docs/SESSION_PROTOCOL.md`.

## Current phase

**Phase 1 — Feature flag + (maybe) schema additions** (not started)

Phase 0 (spec, rubric, validator rules, sandbox rules, decisions, book) complete and tagged.

## Last completed sub-task

**Phase 0, sub-task 0.1 — `[phase-0.1]` commit cluster.** All Phase 0 deliverables landed in one commit:
- `docs/INTERACTIVES.md` — full spec including non-technical sections, audit rubric (4 dimensions: voice ≥85, structure / essence / factual ≥75 each), validator rule list (8 rules with regex/check shapes), iframe sandbox shape (`sandbox="allow-scripts"` only, full token-by-token rationale), rough-marker UX rule (drawer-only, exact reader text), pause toggle behaviour, prompt caching strategy.
- `docs/DECISIONS.md` — appended the 2026-04-26 entry covering all six v3 architectural decisions (no new agents, no type registry, sandbox shape, both-per-piece, ship-rough, prompt caching).
- `book/09-the-sixteen-roles.md` — additive paragraphs at end of sections 14 (Interactive Generator) and 15 (Interactive Auditor) noting the v3 HTML extension. Existing prose left intact.
- `CLAUDE.md` — added "Currently working on" line per `SESSION_PROTOCOL.md` requirement.

Tag `interactives-v3.0-complete` pushed.

## Next sub-task

**Phase 1, sub-task 1.1 — feature flag.** Add `interactives_html_enabled` (default `false`) to `admin_settings`. The longer name (vs. `interactives_enabled`) avoids implying that quizzes are gated. Then **sub-task 1.2 — schema decision and (maybe) migration:**

The leading option per the v3 spec is to add `interactives.quality_tier TEXT` with values `'polished' | 'solid' | 'rough'`, mirroring the daily-piece tier vocabulary at [`src/lib/audit-tier.ts`](../src/lib/audit-tier.ts). Backfill the 2 existing `quality_flag='low'` rows to `quality_tier='rough'`. The alternative is to keep `quality_flag='low'` and render it as "Rough" at read time, but the 2026-04-25-pm drawer fix dropped the "Rough" label *because* of the daily-piece tier collision, so reusing the word for any-dimension max-fail brings that collision back. Decide before writing the migration.

Update `docs/SCHEMA.md` (table + migration counts) and `docs/RUNBOOK.md` (how to flip the flag, how to roll back). Verify `interactives_html_enabled = false` post-migration (Generator + Auditor behaviour unchanged on prod). Tag `interactives-v3.1-complete`.

## Blockers

None.

## Plan vs repo notes

One entry in `docs/INTERACTIVES_PLAN_NOTES.md` from this session — book chapter filename was already renamed to `09-the-sixteen-roles.md` on 2026-04-24 (commit `41edf46`), two days before v3 was commissioned. The plan's task to add a FOLLOWUPS book-rename entry was skipped because the rename is already done; chapter content was updated under the correct filename. See PLAN_NOTES for the full audit trail.

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
| 2026-04-26 | 0 | 0.1 — spec + rubric + validator rules + sandbox shape + decisions + book ch9 update | All Phase 0 deliverables in one `[phase-0.1]` commit. Plan-vs-repo: book chapter filename already renamed (recorded in PLAN_NOTES). Tag `interactives-v3.0-complete`. |

## Tags

| Tag | Date | Commit |
|---|---|---|
| `interactives-v3.0-complete` | 2026-04-26 | (set at commit time) |
