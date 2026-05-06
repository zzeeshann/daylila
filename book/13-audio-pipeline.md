# 13 — The audio pipeline (and why it took three tries)

*Status: outline. To be expanded by a future session — see WRITING-MORE.md.*

---

## What this chapter covers

The story of how the audio pipeline got built is genuinely interesting, because it shows what happens when your intuitions about how a system works turn out to be wrong.

**Attempt 1: Inline generation.** Audio was generated immediately after the piece published, in the same Durable Object call. Result: the DO got evicted after ~90 seconds of work, killing the audio midway through. Nothing in the logs explained why.

**Attempt 2: Chunking.** The pipeline was split into chunks of 2 beats per call, so no single call exceeded the DO time budget. Still failed. The diagnosis: Durable Objects don't only get evicted by the 30-second compute budget — they get evicted by *inactivity between requests*, and the whole text pipeline was already running 107 seconds. Audio was always straddling the eviction cliff.

**Attempt 3: keepAlive hack.** Added a keepalive heartbeat to the DO to prevent eviction. This helped but still wasn't enough — the next trigger stalled at 2/5 beats.

**Attempt 4 (the fix): alarm-scheduled.** The audio pipeline was moved out of the HTTP request entirely. Director schedules an alarm (`this.schedule(1, 'runAudioPipelineScheduled', payload)`), which fires in a fresh invocation with a separate 15-minute wall-clock budget. This finally worked.

## Where the rule lives

Since 2026-05-09, the audio pipeline's six rule constants — the ElevenLabs voice, the model, the output format, the 20,000-character per-piece cap, the 3-attempt retry count, and the per-call 2-beat budget — all live in a single contract file (`content/audio-contract.md`). The rationale is in the contract too: why Frederick Surrey was added to the operator's "My Voices" library so the ID survives shared-library removals, why the multilingual model was chosen, why 96 kbps over 128, why 20,000 was the cap, and why the chunked-call budget had to fit under Cloudflare's Durable Object RPC ceiling. No Claude prompt currently injects the contract — the Audio Producer makes zero Claude calls and so does the Audio Auditor — so the contract is canonical narrative for human readers, with the runtime values flowing through six named constants in `agents/src/shared/audio-thresholds.ts`. The auditor's defense-in-depth budget check and Director's call-site beat-budget safety belt now both import from the same module rather than carrying their own copies.

## Where the verdict lives

Since 2026-05-12, every audit run leaves a trace. The Audio Auditor's verdict — pass or fail, plus one row per issue it found and a summary row covering the whole piece — gets written to a new table called `audio_audit_results`. Before this, the verdict survived only as a JSON blob inside the events log, where you could see *that* an audit failed but couldn't ask "show me the last thirty audits and which ones flagged a beat as suspiciously small" without expensive parsing.

The shape mirrors the equivalent table for the interactive auditor that was built a few weeks earlier — same idea applied to a different rail. Each issue becomes a row with a closed-enum classification (eight values like `missing_file`, `size_too_small`, `text_too_short`), the auditor's free-form note prose verbatim, and the R2 key plus actual byte size when those matter. Plus one summary row per audit invocation, carrying a rollup of the verdict and the issue count. The summary row matters because without it, "no rows" is ambiguous — you can't tell if the piece was never audited or audited and clean. With the summary, "no rows" means never audited; one summary row with `passed=1` means audited and clean.

There's no `audit_round` column. The Audio Auditor doesn't run rounds the way the Voice Auditor does — it runs once per pipeline invocation and either passes or escalates. When the operator triggers a retry, the auditor runs again and a fresh batch of rows lands with a new timestamp. "Latest verdict" means "ordered by created_at descending, take the most recent summary." History is in the order of writes, no extra column needed.

Two related leaks closed in the same commit. The `daily_piece_audio` table had a `duration_seconds` column from day one but nothing ever populated it — every row was NULL. And there was no column at all for the file size. Both now populate from what ElevenLabs hands back: the byte length of the response is the file size, and dividing that by 12,000 gives the approximate duration in seconds (96 kbps audio runs at 12,000 bytes per second, by definition). Both numbers are slightly approximate; the reader gets exact playback timing from the MP3 file at render time. These columns are for admin display and operator queries — "how much audio did we ship this week" needs a sum, not a guess.

## Why this matters for the book

This is the story of how the Cloudflare Durable Object platform's actual semantics differed from what we expected, and how the fix required understanding the difference between HTTP-triggered invocations (time-limited) and alarm-triggered invocations (not). It's also a small case study in the "silent failure is data" principle — each time audio stalled, the right move was to diagnose, not retry.

## Key terms introduced

- Durable Object eviction, compute budget, wall-clock budget, alarm scheduling, chunked generation, prosodic continuity (for the ElevenLabs side), ship-and-retry pattern, the "newspaper never skips a day" rule
