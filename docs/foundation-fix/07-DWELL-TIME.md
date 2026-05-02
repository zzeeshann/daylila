# Task 07 — Reader: Dwell Time Pipe

**Phase:** 2 (High-severity data fixes)  
**Type:** Frontend event + new endpoint + small schema change.  
**Estimated session length:** 45–60 minutes.  
**Prerequisite:** Task 06 complete.

## Context

The audio player already computes dwell time for the browser's `mediaSession` API. The number exists in the frontend. It's never sent to the backend.

This is a small leak with outsized importance. Reader dwell time on audio is one of the strongest engagement signals available — it tells us whether listeners stay for the full beat, drop off mid-beat, or skip. None of that signal currently reaches the system.

## What to read first

1. `CLAUDE.md`, `docs/DECISIONS.md`, `docs/FOLLOWUPS.md`
2. `docs/SCHEMA.md` — `engagement` table
3. `src/components/audio-player.ts` (or similar — wherever `mediaSession` is computed; data audit cites `audio-player.ts:242-250, 337-354`)
4. `src/pages/api/engagement/*` (or wherever existing engagement events post)
5. The data audit, section L17

## What this task does

### Sub-task 1 — Add dwell tracking to the engagement table

Migration filename: `migrations/00XX_engagement_dwell.sql`.

```sql
ALTER TABLE engagement ADD COLUMN audio_dwell_seconds INTEGER;
ALTER TABLE engagement ADD COLUMN audio_completion_ratio REAL;
ALTER TABLE engagement ADD COLUMN beat_index INTEGER;
```

Three columns:
- `audio_dwell_seconds` — total seconds the listener actually listened (not the audio length, the listening time).
- `audio_completion_ratio` — dwell_seconds / audio_duration, a 0-1 value for easy aggregation.
- `beat_index` — which beat this engagement event refers to. NULL for piece-level events.

If `engagement` already has a `beat_index` or similar column, reuse it. Don't duplicate.

### Sub-task 2 — POST dwell on natural events

In the audio player frontend:

- On audio `pause`, `ended`, or beat-change events, send a POST to `/api/engagement/audio` with `{ piece_id, beat_index, dwell_seconds, audio_duration_seconds, completion_ratio }`.
- Use `navigator.sendBeacon` for the `pagehide` / `beforeunload` paths — guarantees delivery even on tab close.
- For mid-listen heartbeats: send every 30 seconds while playing. Cheap, captures users who close the tab without pausing.

Keep the payload small. Three numbers and an ID is enough.

### Sub-task 3 — New endpoint

Create `src/pages/api/engagement/audio.ts` (or extend the existing engagement endpoint).

The endpoint:
- Validates the payload (require `piece_id`, accept beat_index 0–10, dwell 0–3600, ratio 0–1).
- Validates that the piece exists.
- INSERTs into `engagement` with the new columns. If a row for `(user_id, piece_id, beat_index)` already exists, UPDATE instead — keep the latest dwell value.
- Anonymous users: still record, with NULL user_id. Use a session cookie or anonymous ID generated client-side and stored in localStorage.
- Returns 204 No Content on success. No body — this is a fire-and-forget write.

Privacy: don't log the IP or user-agent in the row. Just the engagement signal.

### Sub-task 4 — Update the existing engagement reader

If the dashboard or admin section reads from `engagement` to show drop-off charts, extend the queries to include the new columns. Show:
- Average dwell ratio per beat per piece (where does drop-off happen?)
- Per-piece total listen time
- Pieces with the highest completion ratios — these are the bangers

If the dashboard isn't rendering this yet, just store the data. Visualisation is a future task.

## Update docs

- `docs/SCHEMA.md` — document the three new columns.
- `docs/RUNBOOK.md` — note the new endpoint and how to query dwell data.
- `docs/DECISIONS.md` — append: "L17 closed YYYY-MM-DD. Audio dwell time now flows from frontend mediaSession to engagement table."
- `docs/FOLLOWUPS.md` — remove L17. Note: "When user sample size grows, build per-piece drop-off charts in the admin dashboard."
- `CLAUDE.md` — no change usually.

## What success looks like

- The three new columns exist.
- Listening to any piece's audio results in `engagement` rows with `audio_dwell_seconds` populated.
- Closing the tab mid-listen still records the dwell up to that point (sendBeacon working).
- Anonymous listeners' data is captured (NULL user_id rows).
- Docs match.
- Two commits typical: migration + backend endpoint, then frontend changes.

## What NOT to do

- Do not track scroll dwell, mouse position, or anything beyond audio dwell in this task. Scroll-depth tracking is a separate (medium-severity) leak we can come back to.
- Do not collect IP, user-agent, or any other identifying data. The point is a single number per (user, piece, beat) — completion ratio.
- Do not add user-facing analytics. This is internal signal only.
- Do not bundle this with any other engagement work.

## How to verify it worked

Open the site, listen to a piece for 60 seconds, close the tab. Then:

```sql
SELECT
  user_id, piece_id, beat_index,
  audio_dwell_seconds, audio_completion_ratio
FROM engagement
WHERE audio_dwell_seconds IS NOT NULL
ORDER BY id DESC
LIMIT 5;
```

Expected: a row with `audio_dwell_seconds` ≈ 60, `audio_completion_ratio` between 0 and 1.

If empty, the POST didn't land or the endpoint isn't writing.

If rows are there but `audio_dwell_seconds` is wildly inflated (e.g. 7000 seconds for a 240-second beat), the heartbeat logic is double-counting. Fix.

## What this enables later (deferred)

After ~30 days of dwell data:

- Drop-off heatmaps: which beat in which piece loses the most listeners?
- Piece-level scoring: high-completion pieces become a "best of" filter for the library.
- Drafter signal: the Learner can read dwell averages per beat-shape and learn which structures hold attention.

Don't act on these now. Add to `docs/FOLLOWUPS.md`:

> Dwell data starts accumulating YYYY-MM-DD. After 30 days, build a per-piece drop-off view in admin and decide whether to feed dwell signal to the Learner.
