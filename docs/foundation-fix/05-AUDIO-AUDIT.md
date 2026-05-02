# Task 05 — Audio Auditor: Persist Audit Results

**Phase:** 2 (High-severity data fixes)  
**Type:** New table + schema migration + small code change.  
**Estimated session length:** 45–60 minutes.  
**Prerequisite:** Task 04 complete.

## Context

The Audio Auditor checks each beat's MP3 in R2 — verifies existence, file size, total duration cap. It produces structured audit results (`AudioIssue[]`).

These results are never persisted to D1. They survive only as JSON inside `observer_events.context`, which is not queryable without expensive `json_extract` operations.

The Interactive Auditor uses the right pattern: a dedicated `interactive_audit_results` table with one row per audit dimension per round. The Audio Auditor should follow the same pattern.

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/AGENTS.md` — Audio Auditor section
3. `docs/SCHEMA.md` — current audio tables
4. `migrations/0023_interactive_audit_results.sql` (or similar) — the model to copy
5. `agents/src/audio-auditor.ts` — the source of audit results
6. The data audit, section L12

## What this task does

### Sub-task 1 — Create the `audio_audit_results` table

Migration filename: `migrations/00XX_audio_audit_results.sql` (next number).

Schema modelled on `interactive_audit_results`:

```sql
CREATE TABLE audio_audit_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id TEXT NOT NULL,
  beat_index INTEGER,           -- which beat this audit refers to (NULL for whole-piece checks)
  audit_round INTEGER NOT NULL DEFAULT 1,
  passed INTEGER NOT NULL,      -- 0 or 1
  issue_type TEXT,              -- enum: missing_file, size_too_small, size_too_large, duration_over_cap, etc
  issue_severity TEXT,          -- enum: low, medium, high, critical
  notes TEXT,                   -- free-form details
  r2_key TEXT,                  -- the file being audited
  expected_size_bytes INTEGER,  -- if applicable
  actual_size_bytes INTEGER,    -- if applicable
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (piece_id) REFERENCES daily_pieces(id)
);

CREATE INDEX idx_audio_audit_piece ON audio_audit_results(piece_id);
CREATE INDEX idx_audio_audit_failed ON audio_audit_results(passed) WHERE passed = 0;
```

The `issue_type` enum should match what the Audio Auditor actually produces. List should live in the contract file extracted in Phase 1 (likely `content/audio-contract.md`). If not yet extracted, pull the values from `agents/src/audio-auditor.ts` and document them in `docs/SCHEMA.md`.

### Sub-task 2 — Persist results

In `agents/src/audio-auditor.ts`, after the audit produces `AudioIssue[]`, write each issue as a row in `audio_audit_results`. Plus a summary row marking the overall pass/fail per piece.

Specifically:
- One row per issue found, with `passed = 0` and the relevant fields populated.
- One summary row at the end with `beat_index = NULL`, `passed = 1` if no issues, `passed = 0` if any.

The Director may need a small change to call into the new persistence path. If the Audio Auditor currently returns a structured result and the Director writes it elsewhere, adjust where the writes happen.

### Sub-task 3 — Stop relying on `observer_events.context` for audio audit data

Audio audit verdicts should now read from `audio_audit_results`, not from `observer_events`. Search the codebase for any reads of audio audit data from `observer_events.context` and migrate them. The Observer can still log the *event* of audit completion, but the audit *data* lives in the new table.

### Sub-task 4 — Add the small leaks (L10, L11) at the same time

Two related smaller leaks share this code path:

- **L10:** `daily_piece_audio.duration_seconds` column exists but is always bound NULL.
- **L11:** No `file_size_bytes` column on `daily_piece_audio` at all.

Fix both:

```sql
ALTER TABLE daily_piece_audio ADD COLUMN file_size_bytes INTEGER;
```

In `agents/src/audio-producer.ts`, populate `duration_seconds` and `file_size_bytes` when generating each beat's audio. ElevenLabs returns enough metadata to compute both; if not, derive them from the resulting MP3 (file size from R2 response headers, duration from a small audio probe).

These fixes are tiny and adjacent enough to land in this same task. Document them as bonuses in the commit message.

## Update docs

- `docs/SCHEMA.md` — document the new table and the two new columns on `daily_piece_audio`.
- `docs/AGENTS.md` — Audio Auditor section: note the new persistence pattern. Audio Producer section: note the new fields.
- `docs/DECISIONS.md` — append: "L10, L11, L12 closed YYYY-MM-DD. Audio audit results now persist to dedicated table; audio metadata complete."
- `docs/FOLLOWUPS.md` — remove L10, L11, L12.
- `CLAUDE.md` — update if Audio Auditor's role section is referenced.

## What success looks like

- `audio_audit_results` table exists.
- Every Audio Auditor run produces rows in it (one per issue, one summary).
- `daily_piece_audio.duration_seconds` and `file_size_bytes` populate on new audio generation.
- Old data unfilled — historical audio rows have NULL for both. Going forward only.
- Docs match.
- Two commits typical: migration + persistence in one, audio metadata fix in another.

## What NOT to do

- Do not delete `observer_events.context` data. Keep it for now as a backup. Eventually it will roll off via retention (Task 08), but not in this task.
- Do not change what the Audio Auditor *checks*. We are persisting what it already produces, not extending its checks.
- Do not retroactively populate `audio_audit_results` for historical pieces.

## How to verify it worked

After the next piece publishes:

```sql
SELECT * FROM audio_audit_results
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1);

SELECT id, beats_count, file_size_bytes, duration_seconds
FROM daily_piece_audio
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1);
```

Expected:
- At least one row in `audio_audit_results` (the summary, plus any issues).
- `file_size_bytes` populated on every beat row.
- `duration_seconds` populated on every beat row.

If empty, the writes didn't land.
