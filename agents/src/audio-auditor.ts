import { Agent } from 'agents';
import type { Env, AudioIssueType } from './types';
import { AUDIO_ISSUE_TYPES } from './types';
import { AUDIO_CHAR_CAP } from './shared/audio-thresholds';

export interface AudioAuditBrief {
  pieceId: string;
  date: string; // YYYY-MM-DD — retained for display/logging only
  runId?: string | null; // Foundation Fix Task 08 (2026-05-07) — per-run UUID
}

export interface AudioAuditResult {
  passed: boolean;
  issues: AudioIssue[];
  beatCount: number;
  totalCharacters: number;
  totalSizeBytes: number;
  /** Populated only when persistence to audio_audit_results threw.
   *  Director reads this AFTER consuming `passed` and fires
   *  observer.logError once per audit. The verdict (`passed` /
   *  `issues`) is unaffected — computed in-memory before the
   *  persistence batch runs. Foundation Fix Task 05 (L12). */
  persistError: string | null;
}

export interface AudioIssue {
  beatName: string | null; // null = piece-level issue, not tied to a beat
  issue: string;
  severity: 'minor' | 'major';
  /** Closed-enum classification of the issue branch. Set at every
   *  push site in audit(); persisted to audio_audit_results.issue_type
   *  via the closed-enum AudioIssueType in ./types. Foundation Fix
   *  Task 05 (L12). */
  issueType: AudioIssueType;
  /** R2 key of the file the issue refers to (when applicable —
   *  missing-file / size-anomaly issues). NULL on piece-level issues
   *  (no_audio_rows, character_cap_exceeded). */
  r2Key?: string;
  /** Actual size in bytes (when applicable — populated on size-related
   *  issues only; not fabricated for text_too_short / no_audio_rows /
   *  character_cap_exceeded). */
  actualSizeBytes?: number;
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
            issueType: 'no_audio_rows',
          },
        ],
        beatCount: 0,
        totalCharacters: 0,
        totalSizeBytes: 0,
        persistError: null,
      };
      result.persistError = await this.persistAuditRows(brief.pieceId, brief.runId ?? null, result);
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
          issueType: 'missing_file',
          r2Key: row.r2_key,
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
          issueType: 'empty_file',
          r2Key: row.r2_key,
          actualSizeBytes: size,
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
          issueType: 'size_too_small',
          r2Key: row.r2_key,
          actualSizeBytes: size,
        });
      } else if (ratio > MAX_SIZE_RATIO) {
        issues.push({
          beatName: row.beat_name,
          issue: `Audio suspiciously large: ${kb(size)}KB for ${row.character_count} chars (expected ~${kb(expectedBytes)}KB).`,
          severity: 'minor',
          issueType: 'size_too_large',
          r2Key: row.r2_key,
          actualSizeBytes: size,
        });
      }

      if (row.character_count < 50) {
        issues.push({
          beatName: row.beat_name,
          issue: `Very short text (${row.character_count} chars) — beat may not be worth audio`,
          severity: 'minor',
          issueType: 'text_too_short',
        });
      }
    }

    if (totalCharacters > AUDIO_CHAR_CAP) {
      issues.push({
        beatName: null,
        issue: `Total characters ${totalCharacters} exceeds cap ${AUDIO_CHAR_CAP}`,
        severity: 'major',
        issueType: 'character_cap_exceeded',
      });
    }

    const hasMajor = issues.some((i) => i.severity === 'major');
    const result: AudioAuditResult = {
      passed: !hasMajor,
      issues,
      beatCount: rows.length,
      totalCharacters,
      totalSizeBytes,
      persistError: null,
    };
    result.persistError = await this.persistAuditRows(brief.pieceId, brief.runId ?? null, result);
    this.setState({ lastResult: result });
    return result;
  }

  /**
   * Persist one summary row + one row per issue to audio_audit_results.
   * Mirrors InteractiveGeneratorAgent.persistAuditRows() — same DO,
   * same this.env.DB.batch() pattern.
   *
   * Always writes at least the summary row so "audited and clean" is
   * unambiguously distinguishable from "never audited" at read time.
   * Each call appends fresh rows with a new created_at; Director's
   * retry paths re-invoke audit() which appends again, preserving
   * forensic history (no audit_round column needed — created_at
   * orders runs).
   *
   * Failure posture: try/catch returns the error message instead of
   * throwing. The audit verdict (`passed`, `issues`) is computed in
   * memory BEFORE this method runs; a D1 hiccup here cannot affect
   * Director's branch logic. Director reads `persistError` after the
   * audit call and fires observer.logError once if populated (no
   * per-row spam, parallel to Task 03's pattern).
   *
   * Bind-count safety: with ~6 beats today, the batch is ~7 statements
   * × 9 binds each = ~63 binds total. D1's per-statement bind cap is
   * ~100; per-statement count is ~9, comfortably safe. If the audio
   * char cap ever rises enough to support 100+ beats per piece, this
   * batch needs chunking — but AUDIO_CHAR_CAP would block that long
   * before bind-count became the bottleneck.
   *
   * Foundation Fix Task 05 (L12). Closed enum AudioIssueType lives in
   * ./types; AUDIO_ISSUE_TYPES is the runtime mirror used to validate
   * before binding (unknown values fall through to 'unknown' so drift
   * surfaces via the issue_type_breakdown operator query).
   */
  private async persistAuditRows(
    pieceId: string,
    runId: string | null,
    result: AudioAuditResult,
  ): Promise<string | null> {
    try {
      const now = Date.now();
      const stmt = this.env.DB.prepare(
        `INSERT INTO audio_audit_results
         (id, piece_id, beat_name, passed, issue_type, issue_severity,
          notes, r2_key, actual_size_bytes, created_at, run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const majorCount = result.issues.filter((i) => i.severity === 'major').length;
      const summaryNotes = `Audited ${result.beatCount} beats, ${result.issues.length} issues (${majorCount} major)`;

      const issueRows = result.issues.map((issue) =>
        stmt.bind(
          crypto.randomUUID(),
          pieceId,
          issue.beatName,
          0, // every issue row is a fail
          AUDIO_ISSUE_TYPES.has(issue.issueType) ? issue.issueType : 'unknown',
          issue.severity,
          issue.issue,
          issue.r2Key ?? null,
          issue.actualSizeBytes ?? null,
          now,
          runId,
        ),
      );

      const summaryRow = stmt.bind(
        crypto.randomUUID(),
        pieceId,
        null, // beat_name NULL = summary row
        result.passed ? 1 : 0,
        null, // issue_type NULL on summary
        null, // issue_severity NULL on summary
        summaryNotes,
        null, // r2_key NULL on summary
        null, // actual_size_bytes NULL on summary
        now,
        runId,
      );

      await this.env.DB.batch([...issueRows, summaryRow]);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'audio_audit_results persist failed';
    }
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
