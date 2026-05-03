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

## Why this matters for the book

This is the story of how the Cloudflare Durable Object platform's actual semantics differed from what we expected, and how the fix required understanding the difference between HTTP-triggered invocations (time-limited) and alarm-triggered invocations (not). It's also a small case study in the "silent failure is data" principle — each time audio stalled, the right move was to diagnose, not retry.

## Key terms introduced

- Durable Object eviction, compute budget, wall-clock budget, alarm scheduling, chunked generation, prosodic continuity (for the ElevenLabs side), ship-and-retry pattern, the "newspaper never skips a day" rule
