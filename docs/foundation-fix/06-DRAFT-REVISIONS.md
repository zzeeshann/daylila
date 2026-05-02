# Task 06 — Drafter & Integrator: Persist Revisions and Diffs

**Phase:** 2 (High-severity data fixes)  
**Type:** New table + schema migration + code change to two agents.  
**Estimated session length:** 90–120 minutes.  
**Prerequisite:** Task 05 complete.

## Context

Three high-severity leaks share a code path:

| ID | What |
|----|------|
| L4 | Initial draft + per-round revisions only in memory; only the final MDX is committed to git |
| L8 | Per-round MDX diffs stored nowhere |
| L9 | Per-feedback-item accept/overrule reasoning stored nowhere |

After this task, every piece has a complete revision history: what the Drafter wrote first, what each auditor flagged, what the Integrator changed and why, and how the piece evolved across up to three rounds.

This unlocks two things:

1. The "How this was made" drawer can show real per-round content, not just timestamps.
2. The Learner gets a much richer signal — it can see *what kinds of revisions tend to happen* and *what feedback patterns recur*.

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/AGENTS.md` — Drafter, Integrator, and the auditors
3. `docs/SCHEMA.md` — current draft-related tables (likely none)
4. `agents/src/drafter.ts`
5. `agents/src/integrator.ts`
6. `agents/src/director.ts` — the orchestration that runs the audit-revise loop
7. The data audit, sections L4, L8, L9

## What this task does

### Sub-task 1 — Create the `draft_revisions` table

Migration filename: `migrations/00XX_draft_revisions.sql`.

```sql
CREATE TABLE draft_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id TEXT NOT NULL,
  revision_round INTEGER NOT NULL,    -- 0 = initial draft, 1+ = post-revision
  mdx_content TEXT NOT NULL,           -- the full MDX at this revision
  word_count INTEGER,
  authored_by TEXT NOT NULL,           -- 'drafter' or 'integrator'
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (piece_id) REFERENCES daily_pieces(id),
  UNIQUE(piece_id, revision_round)
);

CREATE INDEX idx_draft_revisions_piece ON draft_revisions(piece_id);
```

Each round of editing adds one row. Round 0 is the Drafter's initial output. Round 1+ are Integrator outputs after auditor feedback. Final published version lives in git as before; D1 holds the trail.

### Sub-task 2 — Create the `integrator_decisions` table

```sql
CREATE TABLE integrator_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id TEXT NOT NULL,
  revision_round INTEGER NOT NULL,
  feedback_source TEXT NOT NULL,        -- 'voice_auditor', 'fact_checker', 'structure_editor'
  feedback_summary TEXT NOT NULL,       -- the specific issue raised
  decision TEXT NOT NULL,               -- 'accepted', 'overruled', 'partial'
  reasoning TEXT,                       -- Integrator's reasoning for the decision
  resulting_change TEXT,                -- one-line summary of what changed in the MDX
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (piece_id) REFERENCES daily_pieces(id)
);

CREATE INDEX idx_integrator_decisions_piece ON integrator_decisions(piece_id);
CREATE INDEX idx_integrator_decisions_source ON integrator_decisions(feedback_source);
```

One row per piece of feedback the Integrator addressed. Accept/overrule/partial captures the disposition; reasoning captures the why; resulting_change captures the what.

### Sub-task 3 — Update the Drafter

In `agents/src/drafter.ts`, after the initial draft is produced:

```sql
INSERT INTO draft_revisions (piece_id, revision_round, mdx_content, word_count, authored_by)
VALUES (?, 0, ?, ?, 'drafter');
```

This happens before the first audit cycle.

### Sub-task 4 — Update the Integrator

The Integrator currently returns `{ revisedMdx, changesSummary }` where `changesSummary` is the input feedback, not a diff.

Update the Integrator prompt to produce a structured output:

```
{
  "revisedMdx": "<full new MDX>",
  "decisions": [
    {
      "feedback_source": "voice_auditor",
      "feedback_summary": "Sentence 14 uses 'unlock' which is a banned word",
      "decision": "accepted",
      "reasoning": "Banned per voice contract; replaced with 'enable'",
      "resulting_change": "Sentence 14: 'unlock' → 'enable'"
    },
    ...
  ]
}
```

In `agents/src/integrator.ts`:

- Parse the new output.
- After the revised MDX is produced, write a row to `draft_revisions` for the new round.
- For each decision in the `decisions` array, write a row to `integrator_decisions`.

In `agents/src/director.ts`:

- Pass `piece_id` to the Integrator so it can write rows directly. (Or have the Director do the writes after receiving the structured response — choose the cleaner pattern.)

### Sub-task 5 — Update the Integrator contract file

Update `content/integrator-contract.md` (extracted in Phase 1) to specify the new structured output. Include:

- The shape of the `decisions` array.
- The fixed enum for `decision`: `accepted` | `overruled` | `partial`.
- The fixed enum for `feedback_source`: `voice_auditor` | `fact_checker` | `structure_editor`.

If the contract file doesn't exist yet (Phase 1 incomplete for Integrator), create it now following the voice-contract pattern.

### Sub-task 6 — Update the "How this was made" drawer

The drawer on every published piece can now show the revision trail. Suggested additions to the drawer:

- For each revision round: word count, authored by, link to view the diff.
- For each Integrator decision: feedback source, what was raised, what was decided, why.

This is a small UI change. If it's straightforward, include it in this task. If it's substantial, defer to a separate small task and just note in `docs/FOLLOWUPS.md` that the data is now there for the drawer to consume.

## Update docs

- `docs/SCHEMA.md` — document both new tables.
- `docs/AGENTS.md` — Drafter, Integrator, and the audit loop section: explain the new persistence.
- `docs/DECISIONS.md` — append: "L4, L8, L9 closed YYYY-MM-DD. Draft revisions and integrator decisions now persist."
- `docs/FOLLOWUPS.md` — remove L4, L8, L9. If the drawer update was deferred, note it.
- `CLAUDE.md` — update agent descriptions if affected.

## What success looks like

- `draft_revisions` and `integrator_decisions` tables exist.
- Every new piece produces:
  - One `draft_revisions` row per round (1 if no revisions needed; 2-3 if revised).
  - One `integrator_decisions` row per feedback item addressed.
- Old pieces stay as-is. Revision data starts from the next run.
- Docs match.
- Three or four commits typical: migrations, drafter update, integrator update, contract file update.

## What NOT to do

- Do not store the diff itself. Storing both round N and round N+1 of MDX is enough — diffs can be computed at read time. Adding diff storage is gold-plating.
- Do not change *how* the Integrator decides. We are recording its decisions, not changing them.
- Do not retroactively reconstruct revision history for historical pieces. Old data unknown. Going forward only.
- Do not bundle this with other agent work.

## How to verify it worked

After the next piece publishes (especially a Solid or Rough one — they go through more revisions):

```sql
SELECT
  p.id, p.tier,
  COUNT(DISTINCT dr.revision_round) AS rounds,
  COUNT(id.id) AS integrator_decisions
FROM daily_pieces p
LEFT JOIN draft_revisions dr ON dr.piece_id = p.id
LEFT JOIN integrator_decisions id ON id.piece_id = p.id
WHERE p.id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
GROUP BY p.id;
```

Expected:
- For a Polished piece (1 round): `rounds` = 1, `integrator_decisions` = 0.
- For a Solid piece (2-3 rounds): `rounds` = 2 or 3, `integrator_decisions` ≥ 1.

If `rounds` = 0, the Drafter's persistence didn't land. If `integrator_decisions` is always 0 even for revised pieces, the Integrator's persistence didn't land.

## What this enables later (deferred)

Once 30 days of revision data accumulate:

- Pattern analysis: which feedback types lead to which decisions? Are certain Voice Auditor flags always overruled (suggesting the auditor is wrong) or always accepted (suggesting genuine signal)?
- Revision trajectories: do Solid-tier pieces share a common revision pattern? Can we see drift in the kinds of issues being raised over time?

Add to `docs/FOLLOWUPS.md`:

> Revision and decision data starts accumulating YYYY-MM-DD. After 30 days, run analysis on integrator_decisions patterns. Likely surfaces auditor calibration issues and feedback-quality signal.
