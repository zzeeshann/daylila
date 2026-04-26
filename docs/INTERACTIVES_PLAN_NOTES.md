# Interactives v3 — Plan vs Repo Notes

Append-only log of places where `docs/INTERACTIVES_PLAN.md` was wrong and the repo was right. Used during implementation when a phase encounters an architectural assumption in the plan that doesn't match the actual code. Format: date, phase, what the plan said, what the repo does, why we went with the repo.

The v3 plan was written with full repo knowledge as of 2026-04-26, so this file is expected to stay empty for a while. If entries accumulate during implementation, that's a signal the plan needs revision (not just a notes-file append) — surface to Zishan in the end-of-session report.

---

## 2026-04-26 — Phase 0 — book chapter filename + agent count already updated

**Plan said:** Phase 0 task 4 — "update `book/09-the-fourteen-roles.md` Generator + Auditor sections". Phase 0 task 5 — append a `[open]` FOLLOWUPS entry for the book chapter filename rename `09-the-fourteen-roles.md → 09-the-sixteen-roles.md`, marker text "16 agents now, filename says fourteen".

**Repo says:** the file is already named `09-the-sixteen-roles.md`. Renamed in commit `41edf46` (2026-04-24, "docs: cascade '14 → 16 agents' across code, docs, and the book (Area 5 sub-task 5.1)"). The agent count cascade ran two days before v3 was commissioned. The previous rename `13 → 14` happened in `b4f283f` (2026-04-24). Chapter content is up-to-date with the 16-agent count, with sections 14 (Interactive Generator) and 15 (Interactive Auditor) describing the quiz-only behaviour as it shipped in Area 4.

**What I did:**
1. Updated `book/09-the-sixteen-roles.md` (not `…-fourteen-roles.md`) sections 14 + 15 with forward-looking paragraphs about the v3 HTML extension. Existing prose (which accurately describes what's live today) is untouched; new paragraphs are additive at the end of each section. Used forward-looking framing ("v3 work commissioned 2026-04-26", "when the HTML path ships in Phase 2") rather than present-tense — the chapter must not lie about what's running on prod.
2. **Skipped** the FOLLOWUPS book-rename entry the plan asked for. The rename is done; queueing already-completed work would be misleading. This PLAN_NOTES entry is the audit trail instead.

**Why repo, not plan:** the rename being already done makes the FOLLOWUPS entry actively wrong (it'd queue work that doesn't exist). The chapter filename is the source of truth — the plan was written 2026-04-26 with full repo knowledge, but the v3 plan author miscounted the cascade history. Per `docs/SESSION_PROTOCOL.md` "When something goes wrong mid-session: The plan asks for something that doesn't fit the repo. Implement the repo's way. Document in PLAN_NOTES.md. Flag in end-of-session report."

---

## 2026-04-26 — Phase 1 — `quality_flag='low'` row count was 3, not 2

**Plan said** (and `docs/INTERACTIVES_STATUS.md` repeated): "Backfill the 2 existing `quality_flag='low'` rows to `quality_tier='rough'`."

**Repo says:** prod has 3 such rows as of 2026-04-26 (`SELECT id, slug, quality_flag FROM interactives WHERE quality_flag IS NOT NULL`):
1. `iterative-consensus-building` (afb5cb25-…)
2. `proportional-displacement-visibility` (d9665e78-…)
3. `procedural-legitimacy-under-constraint` (e6d796da-…) — added 2026-04-26 (today) when the firing-squads piece's interactive shipped flagged-low.

**What I did:** wrote the backfill UPDATE as `WHERE quality_flag='low'` (set-shaped, count-agnostic), so it covered all 3 without code change. Recorded the post-apply count in the migration's POST-APPLY VERIFY block.

**Why repo, not plan:** plan stated a snapshot count from when v3 was commissioned; one more flagged-low interactive shipped between commissioning and Phase 1. Mechanism unaffected — count drift is the expected mode here, not a plan error worth surfacing. Logged for traceability only.
