# 15 — The four signals: reader, producer, self-reflection, Zita

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

A detailed walkthrough of each of the four signal sources that feed the `learnings` table, in the same order as chapter 14 introduces them.

- **Reader signal.** What the `engagement` table actually tracks: views, completions, drop-off by beat, audio play rate. How each is captured. Why drop-off-by-beat is uniquely useful (it tells you where readers gave up, which is a very direct quality signal). Since 2026-05-07 the reader signal also includes per-beat **dwell time** in a separate `audio_dwell_events` table — every audio play, pause, beat change, 30-second heartbeat during continuous play, and tab-close writes a row carrying who, what beat, how long they listened, and why the row was flushed. Where drop-off tells you the last beat a reader visited, dwell tells you how long they actually listened on each one. Together they distinguish "skimmed past" from "engaged but bounced".
- **Producer signal.** What the Learner reads: `audit_results`, `pipeline_log`, `daily_candidates`, `daily_pieces`. Patterns visible without any readers — recurring voice violations, candidates that keep getting picked vs passed, tier distribution over time. Since 2026-05-06 the `daily_candidates` substrate is much richer: every candidate carries a rejection category (one of eight closed values), the top five runner-ups carry a one-sentence reason, and the picked candidate carries Curator's own reasoning for why this one is the most teachable today. The chapter on the Curator (chapter 9) describes the recording rule; the data is what the Learner will eventually read. As of 2026-05-11 the loop also records the **consumption side**: every learning the Drafter loaded carries a most-recent-load timestamp and a load count, the new piece's id is appended to the learning's `applied_to_prompts` list on publish, and a separate validation timestamp is written only when the piece cleared a stricter bar than the public Polished tier. Chapter 14 describes why; the data is what makes the next year of evaluation possible.
- **Self-reflection signal.** The prompt used for the Drafter's post-publish reflection. Why the prompt's specificity matters ("what felt thin" vs "how did the piece go"). How stateless context makes honest self-reflection possible — the reflecting call is the same "role" as the drafting call but doesn't carry any ego about the output.
- **Socratic signal (Zita).** How Zita works, what questions it asks, how those questions get logged. Why reader questions to Zita are different signal than reader behaviour — questions reveal confusion at a specific point in the piece.

## Why this matters for Daylila

- Chapter 14 says the loop is closed. This chapter says how, in detail, for each signal source.
- A reader who reads this chapter should come out understanding which signals Daylila can act on now and which ones will take time to accumulate.

## Key terms introduced

- engagement tracking, drop-off analysis, pipeline log, candidate pool, stateless context, Socratic interaction, confusion signal
