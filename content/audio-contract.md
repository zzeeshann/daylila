# Daylila Audio Contract

This document is the single source of truth for how Daylila *narrates* its daily pieces. The voice contract governs how Daylila sounds in prose; the beat contract governs how daily pieces are shaped; the interactive contract governs how the post-publish artefacts are shaped; the audit contract governs the gates each draft passes through; the fact-check contract governs the verification rule; the curator contract governs which story the day's piece teaches. This contract governs the audio pipeline that turns an approved piece into a per-beat MP3 narration — which voice, which model, which output format, the per-piece spend cap, the retry policy on transient failures, and the per-call beats budget that paces the producer to fit the platform's runtime ceilings.

## Voice, model, and output format

Every audio clip Daylila produces uses one fixed combination:

- **Voice — Frederick Surrey** (`j9jfwdrw7BRfcR43Qohk`). A calm, British, narrative voice — the closest fit to how Daylila reads on the page. The voice ID is added to the operator's "My Voices" library on the ElevenLabs side so the ID survives shared-library removals; the producer's reference would otherwise break silently if ElevenLabs ever rotated the public catalogue.
- **Model — `eleven_multilingual_v2`.** A multilingual model so the voice handles non-English proper nouns (place names, transliterated words, brand names) without the prosody collapse a strict-English model exhibits on the same content.
- **Output format — `mp3_44100_96`.** 44.1 kHz MP3 at 96 kbps. Indistinguishable from 128 kbps for a single-voice narration, ~25% smaller R2 footprint and egress cost. The audio audit's expected-bytes-per-character bound is calibrated against this bitrate; changing the bitrate would invalidate that calibration.

The voice settings on every call — `stability: 0.6`, `similarity_boost: 0.75`, `style: 0.3`, `use_speaker_boost: true`, `speed: 0.95` — are TTS provider tuning, not rule body. They are documented here for narrative completeness and stay inline at the single HTTP-call surface in `audio-producer.ts`.

## Character cap — 20,000 per piece

One piece cannot spend more than **20,000 characters** of ElevenLabs budget. This is a hard cost tripwire, not an aspiration. Sized for a 12-beat newspaper-style piece at ~200 words/beat plus headroom; a standard 4–6-beat piece is well under. If the producer's prepared text exceeds the cap, it throws `AudioBudgetExceededError` and skips the audio phase entirely — the text piece is already published, audio is ship-and-retry, the day's piece never goes blank because the budget tripped.

The audio auditor carries the same cap as a defense-in-depth check: if rows somehow land in `daily_piece_audio` whose character counts sum above the cap, the auditor flags it as a major issue. Two consumers, one rule, one canonical value.

## Retry policy — 3 attempts

Each ElevenLabs TTS call is retried up to **three attempts** on transient failures. The shape of the policy:

- **4xx responses do not retry** — bad API key, quota exhausted, bad voice ID, malformed request. Retrying won't fix any of them. The producer throws `ElevenLabsClientError` immediately and Director catches it as an audio failure.
- **5xx responses + network errors + timeouts do retry.** Exponential backoff between attempts: 1 second after the first failure, 2 seconds after the second.
- **Per-attempt timeout — 90 seconds.** An `AbortSignal.timeout(90_000)` wraps every fetch. Without it, an ElevenLabs TCP stall (no response, no error) hangs the fetch indefinitely; the Durable Object eventually hibernates; Director's await on `generateAudio` stays pending forever. Sized at ~6× the typical happy-path latency for a 3000-character beat at `speed: 0.95`, with headroom under the alarm's 15-minute wall budget even when every retry exhausts.

The 90-second timeout has a single use-site at `audio-producer.ts:319`; it stays inline alongside the fetch call rather than being hoisted to a named constant. Its sizing rationale is documented in the comment block above the call.

## Per-call beats budget — default 2

Each Audio Producer alarm cycle generates at most **2 new beats** per call. Director calls the producer in a bounded loop, and each call processes up to this many beats before returning so D1 can persist incrementally and the next call can resume.

The reason: Cloudflare Durable Object RPC calls have a ~30-second wall-clock ceiling. A 6-beat piece at ~10–15 seconds per beat of ElevenLabs latency blows past that in a single call — the producer DO silently hibernates mid-loop and the caller's await never resolves. (Proven empirically on 2026-04-19: both runs stalled at exactly 2 beats in ~20–25 seconds elapsed, regardless of content. See `docs/DECISIONS.md` 2026-04-19 "Audio RPC wall-clock budget" for the investigation.) Two beats × ~15 seconds ≈ 30 seconds worst case fits cleanly under the ceiling.

Director carries the same value at its call-site as a safety belt — if Director ever calls the producer with a different `maxBeats`, the producer's default still bounds the chunk; if the producer's default changes, Director's call-site continues to control the chunk size at its own loop. Two consumers, one rule, one canonical value. (Same shape as the daily-piece and interactive-revision loops both bounding at `MAX_AUDIT_ROUNDS`.)

## How agents apply this contract

- **Audio Producer.** Reads this contract via constants in `agents/src/shared/audio-thresholds.ts`. Imports `AUDIO_VOICE_ID`, `AUDIO_MODEL_ID`, `AUDIO_OUTPUT_FORMAT` for the ElevenLabs HTTP call. Imports `AUDIO_CHAR_CAP` for the per-piece budget gate (throws `AudioBudgetExceededError` on overrun). Imports `AUDIO_MAX_RETRIES` for the retry-loop bound. Imports `AUDIO_BEATS_PER_CHUNK` as the default `maxBeats` parameter on `generateAudioChunk`.
- **Audio Auditor.** Imports `AUDIO_CHAR_CAP` for the defense-in-depth budget verification — flags a major issue if persisted rows somehow exceed the cap. The auditor's other size-sanity bounds (expected bytes per character, min/max ratios, very-short-text floor) are a separate cluster (audio-audit thresholds) governed elsewhere.
- **Director.** Imports `AUDIO_BEATS_PER_CHUNK` for the chunked-call loop in `runAudioPipelineScheduled`. Catches `AudioBudgetExceededError` and routes the piece through audio-skip (text already published, no day goes blank).
- **Site worker.** Has no consumers of this contract. The display-side label lookups in `src/interactive/made-drawer.ts` (the `'eleven_multilingual_v2'` model match for a friendly label, and the hardcoded `Frederick Surrey` voice name) read the persisted column values for display rendering, not the rule body. Both fall through gracefully if the rule's values change. Agents-only posture, parallel to `agents/src/shared/curator-thresholds.ts`.

No Claude prompt currently injects `${AUDIO_CONTRACT}` at runtime — the producer makes zero Claude calls (TTS-only via ElevenLabs HTTP) and the auditor makes zero Claude calls (R2 HEAD checks only). The contract is canonical narrative for human readers (developers, operators, future agents). Codegen still produces `AUDIO_CONTRACT` so a future post-publish audio narrator (a podcast intro generator, an audio-quality summariser) can opt-in via `${...}` injection without redesign.

## Change log

- 2026-05-09 — v1.0 — extracted from `agents/src/audio-producer.ts`, `agents/src/audio-auditor.ts`, and `agents/src/director.ts` (Foundation Fix Task 02 seventh extraction session, branch `foundation-fix-02-extraction-audio`). Behaviour-preserving — rule values + canonical phrasings unchanged. The producer's `VOICE_ID` / `MODEL_ID` / `OUTPUT_FORMAT` / `CHAR_CAP` local constants and the auditor's defense-in-depth `CHAR_CAP` and Director's call-site `MAX_BEATS_PER_CHUNK` collapsed into six exports in the new `agents/src/shared/audio-thresholds.ts` module.
