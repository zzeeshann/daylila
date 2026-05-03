import { Agent } from 'agents';
import type { Env } from './types';
import { AUDIO_CHAR_CAP } from './shared/audio-thresholds';

export interface AudioAuditBrief {
  pieceId: string;
  date: string; // YYYY-MM-DD — retained for display/logging only
}

export interface AudioAuditResult {
  passed: boolean;
  issues: AudioIssue[];
  beatCount: number;
  totalCharacters: number;
  totalSizeBytes: number;
}

export interface AudioIssue {
  beatName: string | null; // null = piece-level issue, not tied to a beat
  issue: string;
  severity: 'minor' | 'major';
}

interface AudioAuditorState {
  lastResult: AudioAuditResult | null;
}

interface AudioRow {
  beat_name: string;
  r2_key: string;
  public_url: string;
  character_count: number;
  duration_seconds: number | null;
  request_id: string | null;
  model: string;
  voice_id: string;
  generated_at: number;
}

// Defense in depth — Producer already aborts over-budget runs via the
// same AUDIO_CHAR_CAP from content/audio-contract.md.
// 96 kbps MP3 ≈ 12,000 bytes/sec. Narration at ~150 wpm, ~5 chars/word
// → ~12.5 chars/sec. Expected ≈ 12,000 / 12.5 ≈ 960 bytes per character.
const EXPECTED_BYTES_PER_CHAR = 960;
// Intentionally loose. Low bound catches real truncation without
// false-positive-blocking audio on a piece that reads a bit faster or
// slower than average. High bound catches obviously-wrong payloads.
const MIN_SIZE_RATIO = 0.3;
const MAX_SIZE_RATIO = 3.0;

/**
 * AudioAuditorAgent — one job: audit the persisted audio state for a
 * given date.
 *
 * Reads rows from daily_piece_audio (source of truth for what was
 * produced) and HEADs the matching R2 objects. Flags mismatches,
 * truncation, over-budget spend, and missing files.
 *
 * Separation: never generates audio, never commits to git. Returns a
 * verdict — Director decides what to do with a failure (observer
 * escalation, admin-retry button).
 *
 * STT round-trip is deliberately out of scope — no Workers-native STT
 * yet, and the failure mode it catches (hallucinated/wrong words) is
 * not what ElevenLabs actually gets wrong at the TTS layer.
 */
export class AudioAuditorAgent extends Agent<Env, AudioAuditorState> {
  initialState: AudioAuditorState = { lastResult: null };

  async audit(brief: AudioAuditBrief): Promise<AudioAuditResult> {
    const rows = await this.loadRows(brief.pieceId);
    const issues: AudioIssue[] = [];

    if (rows.length === 0) {
      const result: AudioAuditResult = {
        passed: false,
        issues: [
          {
            beatName: null,
            issue: `No audio rows found for ${brief.date} — producer did not run or persist failed`,
            severity: 'major',
          },
        ],
        beatCount: 0,
        totalCharacters: 0,
        totalSizeBytes: 0,
      };
      this.setState({ lastResult: result });
      return result;
    }

    let totalCharacters = 0;
    let totalSizeBytes = 0;

    for (const row of rows) {
      totalCharacters += row.character_count;

      const obj = await this.env.AUDIO_BUCKET.head(row.r2_key);
      if (!obj) {
        issues.push({
          beatName: row.beat_name,
          issue: `Audio file missing in R2: ${row.r2_key}`,
          severity: 'major',
        });
        continue;
      }

      const size = obj.size ?? 0;
      totalSizeBytes += size;

      if (size === 0) {
        issues.push({
          beatName: row.beat_name,
          issue: 'Audio file is 0 bytes',
          severity: 'major',
        });
        continue;
      }

      const expectedBytes = row.character_count * EXPECTED_BYTES_PER_CHAR;
      const ratio = size / expectedBytes;

      if (ratio < MIN_SIZE_RATIO) {
        issues.push({
          beatName: row.beat_name,
          issue: `Audio suspiciously small: ${kb(size)}KB for ${row.character_count} chars (expected ~${kb(expectedBytes)}KB). Possibly truncated.`,
          severity: 'major',
        });
      } else if (ratio > MAX_SIZE_RATIO) {
        issues.push({
          beatName: row.beat_name,
          issue: `Audio suspiciously large: ${kb(size)}KB for ${row.character_count} chars (expected ~${kb(expectedBytes)}KB).`,
          severity: 'minor',
        });
      }

      if (row.character_count < 50) {
        issues.push({
          beatName: row.beat_name,
          issue: `Very short text (${row.character_count} chars) — beat may not be worth audio`,
          severity: 'minor',
        });
      }
    }

    if (totalCharacters > AUDIO_CHAR_CAP) {
      issues.push({
        beatName: null,
        issue: `Total characters ${totalCharacters} exceeds cap ${AUDIO_CHAR_CAP}`,
        severity: 'major',
      });
    }

    const hasMajor = issues.some((i) => i.severity === 'major');
    const result: AudioAuditResult = {
      passed: !hasMajor,
      issues,
      beatCount: rows.length,
      totalCharacters,
      totalSizeBytes,
    };
    this.setState({ lastResult: result });
    return result;
  }

  private async loadRows(pieceId: string): Promise<AudioRow[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT beat_name, r2_key, public_url, character_count,
              duration_seconds, request_id, model, voice_id, generated_at
       FROM daily_piece_audio
       WHERE piece_id = ?
       ORDER BY beat_name`,
    )
      .bind(pieceId)
      .all<AudioRow>();
    return results ?? [];
  }
}

function kb(bytes: number): number {
  return Math.round(bytes / 1024);
}
