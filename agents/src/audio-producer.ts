import { Agent } from 'agents';
import type { Env } from './types';
import { normalizeForTTS } from './shared/tts-normalize';
import {
  AUDIO_VOICE_ID,
  AUDIO_MODEL_ID,
  AUDIO_OUTPUT_FORMAT,
  AUDIO_CHAR_CAP,
  AUDIO_MAX_RETRIES,
  AUDIO_BEATS_PER_CHUNK,
} from './shared/audio-thresholds';

/**
 * Audio brief for a daily piece. `pieceId` is the primary identity
 * (matches `daily_pieces.id`). `date` stays on the brief for R2 path
 * grouping (`audio/daily/{date}/{pieceId}/…`) and for display/logging,
 * but all D1 filters use `pieceId` to avoid cross-piece pooling at
 * multi-per-day cadence.
 */
export interface AudioBrief {
  pieceId: string;
  date: string; // YYYY-MM-DD
}

export interface AudioResult {
  beatAudioPaths: BeatAudio[];
  totalDurationEstimate: number; // seconds
  totalCharacters: number;
}

export interface BeatAudio {
  beatName: string;
  r2Key: string;
  publicUrl: string;
  characterCount: number;
  requestId: string | null;
  /** Size of the MP3 payload from ElevenLabs (audioBuffer.byteLength).
   *  Closes data leak L11. Foundation Fix Task 05. */
  fileSizeBytes: number;
  /** Approximate playback length in seconds, computed as
   *  Math.round(byteLength / 12000) — assumes 96 kbps per
   *  AUDIO_OUTPUT_FORMAT='mp3_44100_96'. Closes data leak L10
   *  (column existed since migration 0010, always-NULL until now).
   *  Foundation Fix Task 05. */
  durationSeconds: number;
}

/**
 * Return shape of a single `generateAudioChunk` call. Director uses
 * `completedCount` vs `totalBeats` to decide whether to call again.
 *
 * - `processedBeats` — beats actually generated in THIS call (newly
 *   created MP3s). Empty if all remaining beats already existed in R2.
 * - `totalBeats` — total beats extracted from the MDX (stable across
 *   chunks for a given piece).
 * - `completedCount` — total beats with rows in `daily_piece_audio` for
 *   this date AFTER this chunk finished. When `completedCount ===
 *   totalBeats`, Director stops looping.
 * - `totalCharacters` — sum of characters across all prepared beats
 *   (used for budget check + duration estimate; stable across chunks).
 */
export interface ChunkResult {
  processedBeats: BeatAudio[];
  totalBeats: number;
  completedCount: number;
  totalCharacters: number;
}

interface AudioProducerState {
  lastResult: AudioResult | null;
}

// Voice / model / format / cap / retries / beats-per-chunk live in
// content/audio-contract.md (canonical narrative) and flow through
// agents/src/shared/audio-thresholds.ts (runtime values). Imported
// at the top of this file.

/**
 * Bytes-per-second of audio output, derived from AUDIO_OUTPUT_FORMAT.
 * 96 kbps MP3 = 96,000 bits/sec = 12,000 bytes/sec.
 *
 * Used to derive `duration_seconds` on every persisted beat row from
 * the actual MP3 byte length (no extra ElevenLabs call needed; the
 * /text-to-speech endpoint returns audio bytes only — duration would
 * require a separate /with-timestamps call that doubles per-beat
 * cost). The auditor's `EXPECTED_BYTES_PER_CHAR = 960` constant in
 * audio-auditor.ts encodes the same 96 kbps assumption (12,000 bytes
 * × ~12.5 chars/sec narration ≈ 960 bytes/char), so the pipeline
 * stays internally consistent.
 *
 * **If AUDIO_OUTPUT_FORMAT changes, update this divisor in lockstep.**
 * 192 kbps would be 24,000; 64 kbps would be 8,000. Drift between the
 * two means duration_seconds silently lies.
 */
const BYTES_PER_SECOND_AT_96KBPS = 12_000;

/**
 * Widget-aware TTS preparation (PR #3, 2026-05-09). Translates the
 * three in-beat widget tags into narratable prose BEFORE the generic
 * HTML/MDX strip in `prepareForTTS`. Exported for unit-testability
 * and for the future verifier script.
 *
 * Per-tag narration rules — see prepareForTTS doc-comment for the full
 * spec. Anything not matching a widget pattern is left untouched and
 * falls through to the generic strip.
 */
export function expandWidgetsForTTS(text: string): string {
  let out = text;

  // <lesson-reveal prompt="..."> body </lesson-reveal>
  // → narrate the prompt, skip the body.
  out = out.replace(
    /<lesson-reveal\s+prompt="([^"]*)"[^>]*>[\s\S]*?<\/lesson-reveal>/gi,
    (_m, prompt) => `\n${prompt.trim()}\n`,
  );

  // <lesson-compare> ... <lesson-state label="X">body</lesson-state> ... </lesson-compare>
  // → narrate "X: body. Y: body." in sequence. Discard the outer wrapper.
  out = out.replace(
    /<lesson-compare[^>]*>([\s\S]*?)<\/lesson-compare>/gi,
    (_m, inner) => {
      const states: string[] = [];
      const stateRe = /<lesson-state\s+label="([^"]*)"[^>]*>([\s\S]*?)<\/lesson-state>/gi;
      let m: RegExpExecArray | null;
      while ((m = stateRe.exec(inner)) !== null) {
        const label = m[1].trim();
        // Strip any nested HTML/markdown out of body before narration.
        const body = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (label && body) states.push(`${label}: ${body}`);
      }
      return states.length === 0 ? '' : `\n${states.join('. ')}.\n`;
    },
  );

  // <lesson-callout type="aside"> body </lesson-callout>  → skip
  // <lesson-callout type="..."> body </lesson-callout>    → narrate body
  out = out.replace(
    /<lesson-callout(\s+[^>]*)?>([\s\S]*?)<\/lesson-callout>/gi,
    (_m, attrs, body) => {
      const isAside = /\btype\s*=\s*"aside"/i.test(attrs ?? '');
      if (isAside) return '';
      return `\n${body.trim()}\n`;
    },
  );

  return out;
}

/**
 * Thrown when a piece's total character count exceeds the budget.
 * Director catches this, skips the audio phase (text is already
 * published), and escalates to Observer. Producer refuses to spend
 * money it wasn't authorised for.
 */
export class AudioBudgetExceededError extends Error {
  constructor(public readonly totalChars: number, public readonly cap: number = AUDIO_CHAR_CAP) {
    super(`Piece needs ${totalChars} chars, budget is ${cap}. Aborting audio.`);
    this.name = 'AudioBudgetExceededError';
  }
}

/**
 * AudioProducerAgent — one job: generate MP3 audio from approved MDX.
 *
 * Separation: never touches git, never sets has_audio, never knows
 * Publisher exists. Writes per-beat rows to daily_piece_audio for the
 * downstream Auditor + Publisher to read.
 *
 * Runs AFTER Publisher commits text (newspaper never skips a day).
 * Audio is produced, audited, then Publisher does a second commit
 * splicing the URLs into frontmatter.
 */
export class AudioProducerAgent extends Agent<Env, AudioProducerState> {
  initialState: AudioProducerState = { lastResult: null };

  /**
   * Generate audio for up to `maxBeats` of a piece's beats, then return.
   *
   * Why chunked: Cloudflare Durable Object RPC calls have a ~30s wall-
   * clock ceiling. A 6-beat piece at ~10-15s/beat of ElevenLabs latency
   * blows past that in a single call — the producer DO silently
   * hibernates mid-loop and the caller's await never resolves. Proven
   * empirically on 2026-04-19: both runs stalled at exactly 2 beats in
   * ~20-25s elapsed, regardless of content. See DECISIONS 2026-04-19
   * "Audio RPC wall-clock budget" for the investigation.
   *
   * Director calls this in a loop, checking `completedCount` vs
   * `totalBeats` to know when to stop. Each call stays well under the
   * RPC ceiling (2 beats × ~15s ≈ 30s worst case).
   *
   * Order of operations:
   *   1. Extract beats from MDX, prepare text for TTS (stable per call)
   *   2. Sum characters — abort with AudioBudgetExceededError if > AUDIO_CHAR_CAP
   *   3. Load last 3 request_ids from D1 for cross-chunk prosodic continuity
   *   4. Iterate prepared beats — skip any already in R2, process up to
   *      maxBeats new ones. For each: ElevenLabs call → R2 put → D1 upsert.
   *   5. Return ChunkResult with counts so Director can decide to loop
   */
  async generateAudioChunk(
    brief: AudioBrief,
    mdx: string,
    maxBeats: number = AUDIO_BEATS_PER_CHUNK,
  ): Promise<ChunkResult> {
    const beats = this.extractBeats(mdx);

    const prepared = beats
      .map((b) => ({ name: b.name, text: this.prepareForTTS(b.content) }))
      .filter((b) => b.text.trim().length > 0);

    const totalCharacters = prepared.reduce((sum, b) => sum + b.text.length, 0);
    if (totalCharacters > AUDIO_CHAR_CAP) {
      throw new AudioBudgetExceededError(totalCharacters);
    }

    // Cross-chunk prosodic continuity: pull the last 3 request_ids from
    // D1 so ElevenLabs can stitch this chunk's audio onto the prior
    // chunk's naturally. In-memory window doesn't survive across RPC
    // calls because each call may land on a fresh DO instance.
    const priorRes = await this.env.DB
      .prepare(
        `SELECT request_id FROM daily_piece_audio
         WHERE piece_id = ? AND request_id IS NOT NULL
         ORDER BY generated_at DESC LIMIT 3`,
      )
      .bind(brief.pieceId)
      .all<{ request_id: string }>();
    // Reverse so oldest-first, matching the order ElevenLabs expects
    const priorRequestIds: string[] = priorRes.results
      .map((r) => r.request_id)
      .reverse();

    const processedBeats: BeatAudio[] = [];
    let processedThisCall = 0;

    for (const beat of prepared) {
      if (processedThisCall >= maxBeats) break;

      // Piece_id subdirectory in the path avoids same-date beat-name
      // collisions at multi-per-day cadence (every piece has a "hook"
      // beat). Legacy pre-cadence-Phase-5 pieces stay at the older
      // date-only path; readers fetch via `public_url` which derives
      // from the stored r2_key per-row, so the dual-path is safe.
      const r2Key = `audio/daily/${brief.date}/${brief.pieceId}/${beat.name}.mp3`;
      const existing = await this.env.AUDIO_BUCKET.head(r2Key);

      // Skip already-done beats without counting against maxBeats — a
      // retry on a 4/6 piece should find 4 existing, skip them fast,
      // and generate the remaining 2 (fitting in one call). Only newly
      // generated beats count toward the cap.
      if (existing) continue;

      const res = await this.callElevenLabs(beat.text, priorRequestIds);
      await this.env.AUDIO_BUCKET.put(r2Key, res.audio, {
        httpMetadata: { contentType: 'audio/mpeg' },
      });

      // Closes L11 (file_size_bytes) + L10 (duration_seconds). The
      // Math.round on duration matches the auditor's integer-display
      // expectations and the SCHEMA's INTEGER column type. Foundation
      // Fix Task 05.
      const fileSizeBytes = res.audio.byteLength;
      const durationSeconds = Math.round(fileSizeBytes / BYTES_PER_SECOND_AT_96KBPS);

      const publicUrl = `/${r2Key}`;
      const beatAudio: BeatAudio = {
        beatName: beat.name,
        r2Key,
        publicUrl,
        characterCount: beat.text.length,
        requestId: res.requestId,
        fileSizeBytes,
        durationSeconds,
      };
      processedBeats.push(beatAudio);

      await this.persistBeatRow(brief.pieceId, brief.date, beatAudio);

      if (res.requestId) {
        priorRequestIds.push(res.requestId);
        if (priorRequestIds.length > 3) priorRequestIds.shift();
      }
      processedThisCall++;
    }

    // Source of truth for completion is D1, not an in-memory counter.
    // Retries, partial prior runs, and concurrent invocations all land
    // here consistently.
    const countRow = await this.env.DB
      .prepare('SELECT COUNT(*) AS cnt FROM daily_piece_audio WHERE piece_id = ?')
      .bind(brief.pieceId)
      .first<{ cnt: number }>();
    const completedCount = countRow?.cnt ?? 0;

    return {
      processedBeats,
      totalBeats: prepared.length,
      completedCount,
      totalCharacters,
    };
  }

  /**
   * Extract beat names and inner content from MDX.
   *
   * Drafter emits plain markdown with `## kebab-name` section headings.
   * The `<lesson-beat>` tags readers see are added by `rehype-beats.ts`
   * at render time, not in the MDX source — so we parse the heading
   * format directly here.
   *
   * Each `##` heading starts a new beat; the beat name is the raw
   * heading text (kebab-case, matching what rehype-beats uses for the
   * `name` attribute). Content runs until the next `##` or end of MDX.
   * Frontmatter is stripped first.
   */
  private extractBeats(mdx: string): Array<{ name: string; content: string }> {
    const body = mdx.replace(/^---[\s\S]*?\n---\n/, '');
    const beats: Array<{ name: string; content: string }> = [];
    const parts = body.split(/\n## /);
    // parts[0] is content before the first `##` (usually empty or just
    // a whitespace block after frontmatter). Skip it.
    for (let i = 1; i < parts.length; i++) {
      const newline = parts[i].indexOf('\n');
      if (newline === -1) continue;
      const name = parts[i].slice(0, newline).trim();
      const content = parts[i].slice(newline + 1).trim();
      if (name) beats.push({ name, content });
    }
    // Fail loud. If Drafter ever drifts off the `##` convention again
    // (e.g. emits `<beat>` tags), silent zero-beat success would leak
    // through as "audio-producing ✓" with no rows in daily_piece_audio.
    // Throwing here converts that into a visible escalation instead.
    if (beats.length === 0) {
      throw new Error(
        'Audio producer found zero beats in MDX — Drafter likely emitted non-## section syntax. Check the MDX source.',
      );
    }
    return beats;
  }

  /**
   * Strip MDX/HTML, then hand off to the provider-agnostic normaliser
   * in shared/tts-normalize.ts (Daylila prosody alias + Roman-numeral
   * conversion). Stripping stays here because the regex-heavy MDX
   * cleanup is specific to the producer's input shape; the normaliser
   * deals only with plain prose so it can be reused by any future TTS
   * provider.
   *
   * Widget-aware extraction (PR #3, 2026-05-09): the three in-beat
   * widget tags get translated to narratable prose BEFORE the generic
   * tag strip. Per-tag rules:
   *
   *   <lesson-reveal prompt="..."> body </lesson-reveal>
   *     → narrate the prompt, skip the body. Reader does the
   *       thinking step on the page; audio doesn't ruin it.
   *
   *   <lesson-compare>
   *     <lesson-state label="A">body A</lesson-state>
   *     <lesson-state label="B">body B</lesson-state>
   *   </lesson-compare>
   *     → narrate "A: body A. B: body B." in sequence. Each state's
   *       label cues the listener to the contrast.
   *
   *   <lesson-callout type="aside"> body </lesson-callout>
   *     → skipped from audio (type="aside" only).
   *   <lesson-callout type="define|note"> body </lesson-callout>
   *     → narrate the body inline.
   */
  private prepareForTTS(text: string): string {
    const widgetExpanded = expandWidgetsForTTS(text);
    const stripped = widgetExpanded
      .replace(/^---[\s\S]*?---/m, '')
      .replace(/<[^>]+>/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return normalizeForTTS(stripped);
  }

  /**
   * POST to ElevenLabs TTS. 3-attempt retry with exponential backoff
   * on 5xx / network errors / timeouts. 4xx errors (bad key, quota, bad
   * voice ID) throw immediately — retrying won't fix them.
   *
   * 90-second AbortSignal timeout per attempt. Without it, if ElevenLabs
   * stalls the TCP connection (no response, no error), the fetch hangs
   * indefinitely, the Durable Object eventually hibernates, and
   * Director's await on `generateAudio()` stays pending forever — which
   * is how 2026-04-19's second run silently failed at beat 3 of 6.
   *
   * Sizing: Integrator sometimes consolidates beats (8 → 5 on 2026-04-22),
   * pushing individual beats to ~3000-3400 chars. At `speed: 0.95`,
   * eleven_multilingual_v2 on a ~3000-char beat can genuinely take 30-60s
   * on the happy path — which blew the old 30s cap on 2026-04-22's beat 3
   * and burned all 3 retries. 90s is ~6x the typical happy-path latency
   * and still leaves headroom under the alarm's 15-min budget even if
   * every retry exhausts.
   */
  private async callElevenLabs(
    text: string,
    previousRequestIds: string[],
  ): Promise<{ audio: ArrayBuffer; requestId: string | null }> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${AUDIO_VOICE_ID}?output_format=${AUDIO_OUTPUT_FORMAT}`;
    const body = JSON.stringify({
      text,
      model_id: AUDIO_MODEL_ID,
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
        speed: 0.95,
      },
      ...(previousRequestIds.length > 0 && { previous_request_ids: previousRequestIds }),
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= AUDIO_MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': this.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body,
          signal: AbortSignal.timeout(90_000),
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status >= 400 && response.status < 500) {
            throw new ElevenLabsClientError(response.status, errText);
          }
          throw new Error(`ElevenLabs ${response.status} (transient): ${errText}`);
        }

        const requestId = response.headers.get('request-id');
        const audio = await response.arrayBuffer();
        return { audio, requestId };
      } catch (err) {
        lastError = err;
        if (err instanceof ElevenLabsClientError || attempt === AUDIO_MAX_RETRIES) throw err;
        // 1s, 2s for the two retry gaps
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  /**
   * Upsert one beat's row into daily_piece_audio. Idempotent — if
   * producer re-runs (manual retry, partial failure recovery), each
   * row is refreshed rather than duplicated.
   *
   * file_size_bytes (added migration 0033, L11) and duration_seconds
   * (was always NULL pre-Task-05, L10) populate from the BeatAudio
   * carrier — both derived from audioBuffer.byteLength right after the
   * ElevenLabs response. Foundation Fix Task 05.
   */
  private async persistBeatRow(pieceId: string, date: string, beat: BeatAudio): Promise<void> {
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO daily_piece_audio
         (piece_id, beat_name, date, r2_key, public_url, character_count,
          duration_seconds, file_size_bytes, request_id, model, voice_id, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        pieceId,
        beat.beatName,
        date,
        beat.r2Key,
        beat.publicUrl,
        beat.characterCount,
        beat.durationSeconds,
        beat.fileSizeBytes,
        beat.requestId,
        AUDIO_MODEL_ID,
        AUDIO_VOICE_ID,
        Date.now(),
      )
      .run();
  }
}

/** 4xx from ElevenLabs — don't retry. */
class ElevenLabsClientError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`ElevenLabs ${status}: ${body}`);
    this.name = 'ElevenLabsClientError';
  }
}
