/**
 * Audio production thresholds — canonical agents-side constants for
 * the audio contract (`content/audio-contract.md`).
 *
 * The contract is the single source of truth for the rule body in
 * plain English; this file is the agents-bundle TypeScript surface
 * those rules compile to.
 *
 * Agents-only — the site worker does not enforce audio rules at
 * render time. The display-side label lookups in
 * `src/interactive/made-drawer.ts` (`a.model === 'eleven_multilingual_v2'`
 * for the friendly label, the hardcoded `Frederick Surrey` voice
 * name) read the persisted `daily_piece_audio` column values for
 * display rendering, not the rule body. Both fall through gracefully
 * if values change. Same asymmetric posture as
 * `agents/src/shared/curator-thresholds.ts`.
 *
 * No prompt currently injects `${AUDIO_CONTRACT}` at runtime — Audio
 * Producer makes zero Claude calls (TTS-only via ElevenLabs HTTP),
 * Audio Auditor makes zero Claude calls (R2 HEAD checks only).
 * Codegen still produces `AUDIO_CONTRACT` so a future post-publish
 * audio narrator can opt-in via `${...}` injection without redesign.
 *
 * Foundation Fix Task 02 seventh extraction session, 2026-05-09.
 */

/** ElevenLabs voice — Frederick Surrey. Calm, British, narrative.
 *  Added to the operator's "My Voices" library so the ID survives
 *  shared-library removals. Persisted into `daily_piece_audio.voice_id`
 *  for every produced row. */
export const AUDIO_VOICE_ID = 'j9jfwdrw7BRfcR43Qohk';

/** ElevenLabs model. Multilingual so the voice handles non-English
 *  proper nouns (place names, transliterated words, brand names)
 *  without prosody collapse. Persisted into `daily_piece_audio.model`
 *  for every produced row. */
export const AUDIO_MODEL_ID = 'eleven_multilingual_v2';

/** ElevenLabs output format — 44.1 kHz MP3 at 96 kbps.
 *  Indistinguishable from 128 kbps for a single-voice narration,
 *  ~25% smaller R2 footprint + egress. Audit's expected-bytes-per-
 *  character bound is calibrated against this bitrate. */
export const AUDIO_OUTPUT_FORMAT = 'mp3_44100_96';

/** Hard cost tripwire — one piece cannot spend more than this many
 *  characters of ElevenLabs budget. Sized for a 12-beat newspaper-
 *  style piece (~200 words/beat + headroom). Producer throws
 *  `AudioBudgetExceededError` on overrun; Auditor flags the same
 *  threshold as defense-in-depth on persisted rows. */
export const AUDIO_CHAR_CAP = 20_000;

/** Maximum retry attempts per ElevenLabs TTS call. 4xx responses do
 *  not retry (bad key, quota, bad voice ID); 5xx + network errors +
 *  timeouts do, with 1s/2s exponential backoff between attempts. The
 *  per-attempt 90-second `AbortSignal.timeout` in audio-producer.ts
 *  is sized inline (single use-site). */
export const AUDIO_MAX_RETRIES = 3;

/** Per-call beats budget — Audio Producer generates at most this
 *  many new beats per `generateAudioChunk` call. Director calls in a
 *  bounded loop with the same value so neither side drifts. Sized
 *  for the Cloudflare Durable Object RPC ~30s wall-clock ceiling: at
 *  ~10–15s per beat of ElevenLabs latency, 2 beats × ~15s ≈ 30s
 *  worst case fits cleanly. See DECISIONS 2026-04-19 "Audio RPC
 *  wall-clock budget" for the empirical investigation. */
export const AUDIO_BEATS_PER_CHUNK = 2;
