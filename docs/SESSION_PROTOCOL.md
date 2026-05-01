# Session Protocol

How to work on Zeemish across many Claude Code sessions without losing the thread.

This document is **reusable**. It applies to the interactives work, the video work later, and any other multi-session project. Don't write a new one each time — extend this if rules need to evolve.

## Why this exists

Big projects take many Claude Code sessions. Context windows reset. Without a protocol, work gets duplicated, sub-tasks get skipped, the project drifts. The protocol's job is to make any fresh session, with no memory of previous ones, instantly able to answer:

1. What project are we in?
2. What phase?
3. What's the next sub-task?
4. What state is the code, database, and live site in?

## Files involved

- `CLAUDE.md` — top of file always names the active project and current phase. Updated at the end of every session if those changed.
- `docs/<PROJECT>_PLAN.md` — the master plan. Reference document. Rarely changes.
- `docs/<PROJECT>_STATUS.md` — the live source of truth for "where are we." Updated at the end of every session.
- `docs/<PROJECT>_PLAN_NOTES.md` — append-only log of places where the plan was wrong and the repo was right.
- `docs/FOLLOWUPS.md` — append-only log of deferred work and known issues.

## Git conventions

### Commit messages

Every commit related to a planned project gets a phase prefix:

```
[phase-2.3] wire validator into generator revision loop

WHY: generator was committing files that failed structural checks.
Running the validator before commit prevents this and lets the audit
loop catch the failure at round 2 rather than after deploy.
```

Format:
- `[phase-X.Y]` prefix where X is the phase number, Y is a sub-task counter within that phase. Sub-tasks are decided session-by-session, not pre-numbered.
- Short imperative summary on the first line.
- Blank line.
- `WHY:` paragraph explaining the reasoning. Required.
- `WHAT:` bullet list of what changed (optional, only if non-obvious).

### Tags

Each phase ends with an immovable tag:

```
git tag phase-X-complete
git push origin phase-X-complete
```

Tags are the canonical record of "this phase finished." If `STATUS.md` and tags disagree, tags win.

Project-end milestone tags:

```
git tag <project>-v1
git push origin <project>-v1
```

Example: the interactives-v3 work ends with `interactives-v3-complete`; the video work later will follow the same shape under its own project name.

## Session start protocol

Run this at the beginning of every session. No exceptions, even if you think you remember.

1. **Identify the active project.** Read `CLAUDE.md`. Top of file should say "Currently working on: <project>." If it doesn't, ask the user.
2. **Read the protocol.** This file. (You're doing it now.)
3. **Read the status.** `docs/<PROJECT>_STATUS.md`. Note: current phase, last completed sub-task, next sub-task, any blockers.
4. **Check git ground truth.**
   - `git status` — working tree should be clean. If not, ask user before doing anything.
   - `git tag --list "phase-*-complete"` — list completed phases. Verify against status doc. If they disagree, **tags win**; reconcile the status doc as your first action and tell the user.
   - `git log --oneline -20` — see recent commits. Confirms the trail matches the status.
5. **Read the plan section for the current phase.** Just that section, not the whole plan.
6. **Read any plan notes.** `docs/<PROJECT>_PLAN_NOTES.md` — places where the plan and repo disagreed in earlier sessions. Useful context.
7. **Confirm with the user.** Say something like:

   > Currently in Phase 2 of the interactives work, sub-task 2.3 next: wire the validator into the Generator revision loop. Last commit was `[phase-2.2]`. Working tree clean. Ready to continue. OK to proceed?

   Wait for confirmation before doing any work.

## During the session

- One sub-task per commit (or a small commit cluster). Sub-tasks should be small enough to complete and commit in a focused session.
- If a sub-task balloons mid-work — you discover it actually needs three things — split it. Commit what's done. Add the rest to the status doc as 3.4a, 3.4b, 3.4c.
- Update `docs/<PROJECT>_PLAN_NOTES.md` immediately whenever the plan was wrong and you went with the repo. Don't save it for the end.
- Update `docs/FOLLOWUPS.md` immediately whenever you defer something. Don't trust yourself to remember at the end.

## Session end protocol

Run this at the end of every session, even if work is incomplete.

1. **Self-test what you built.** Run linter, typechecker, any relevant smoke tests. Fix what's fixable now. Note what isn't.
2. **Commit cleanly.** Use the `[phase-X.Y]` convention. Each commit should compile and pass the basic checks; squash WIP commits before pushing if needed.
3. **If a phase is complete:**
   - Tag it: `git tag phase-X-complete && git push origin phase-X-complete`.
   - Run any defined "definition of done" checks from the plan. Confirm each.
4. **Update `docs/<PROJECT>_STATUS.md`.** This is the single most important step. Include:
   - Current phase.
   - Last completed sub-task with commit hash.
   - Next sub-task with a one-paragraph description specific enough that a fresh session knows exactly what to do.
   - Blockers (if any).
   - "Plan vs repo" notes if anything disagreed today.
   - Live state notes (what flag values, what the dashboard shows, etc.) if relevant.
5. **Update `CLAUDE.md`** if the active project or phase changed.
6. **Push everything.** Commits, tags, doc updates. Nothing local-only.
7. **Report to the user.** Last message of the session should be:
   - What you built.
   - What state things are in (deployed? flag on/off? new tables? dashboard changes?).
   - Anything the user should look at or test.
   - Where the next session will start.
   - Any plan/repo mismatches encountered.

Sample end-of-session report:

> Done for this session.
>
> Built: HTML validator now runs inline before commit. If a generated interactive fails any of the eight validator rules (size cap, sandbox-violators, eval, network calls, etc.), Generator requests a revision up to 3 rounds. After max-fail, the row is flagged per the Phase 1 schema decision and the piece ships — matches the newspaper-never-skips rule from CLAUDE.md.
>
> State: `interactives_html_enabled` still `false`. No live impact. Tag `phase-2.3` not pushed (sub-tasks aren't tagged), but `[phase-2.3]` commit is on main.
>
> To check: review `agents/src/interactive-validator.ts` and the new check inside `interactive-generator.ts` if you want to see the inline gate. Nothing to look at live yet.
>
> Next session starts at phase 2.4: hand-write the reference HTML interactive for a recent piece, save to `docs/examples/interactive-reference.html`. Plan says I write it, you review on prod, then we flip the flag.
>
> Plan-vs-repo: none today. `archive/INTERACTIVES_PLAN_NOTES.md` still empty.

## When something goes wrong mid-session

- **Tests fail and you can't fix them in this session.** Commit nothing. Reset to last clean commit. Update status doc with what was attempted and why it failed. Add to FOLLOWUPS.md.
- **The plan asks for something that conflicts with `CLAUDE.md` rules.** Stop. Tell the user. Do not implement either way.
- **The plan asks for something that doesn't fit the repo.** Implement the repo's way. Document in PLAN_NOTES.md. Flag in end-of-session report.
- **You discover a bug in already-shipped code.** Add to FOLLOWUPS.md. Don't fix it as a side quest unless it blocks the current sub-task.

## When the user says "continue"

Run the session start protocol. Don't assume context carries over from a previous chat. The status doc is the truth.
