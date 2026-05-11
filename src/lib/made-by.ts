/**
 * Shared types + teaser-count helper for the "How this was made" drawer.
 *
 * The endpoint is src/pages/api/daily/[date]/made.ts.
 * The drawer is src/components/MadeBy.astro + src/interactive/made-drawer.ts.
 *
 * Keep types in one place so the server endpoint, the Astro component, and
 * the client-side Web Component all agree on shape.
 */

import type { AuditTier } from './audit-tier';

export interface MadePiece {
  headline: string;
  subject: string | null;
  wordCount: number | null;
  beatCount: number | null;
  voiceScore: number | null;
  tier: AuditTier;
  qualityFlag: 'low' | null;
  publishedAt: number | null;
  commitUrl: string | null;
  filePath: string | null;
}

export interface MadeTimelineStep {
  step: string;
  status: 'running' | 'done' | 'failed' | 'skipped' | string;
  t: number;
  data: Record<string, any>;
}

export interface MadeVoice {
  score: number | null;
  passed: boolean;
  violations: string[];
}

export interface MadeStructure {
  passed: boolean;
  issues: string[];
}

export interface MadeFactClaim {
  claim: string;
  status?: string;
  note?: string;
}

export interface MadeFacts {
  passed: boolean;
  claims: MadeFactClaim[];
  /** Flat dedup-by-URL list of every citation Anthropic web_search
   *  returned during this round's fact-check audit. Drawer renders a
   *  "Sources consulted" line under the claims list. Empty/absent on
   *  pre-Path-A audit rows (the agent persisted only the claims
   *  array before 2026-05-01); the drawer omits the line in that
   *  case. Path A (2026-05-01) replaced Phase F's per-claim source
   *  attribution with this flat round-level list. */
  sources?: string[];
}

/**
 * One Integrator response to one piece of audit feedback, persisted by
 * Foundation Fix Task 06 (2026-05-07) to `integrator_decisions`. Empty
 * for pieces that pre-date Task 06 or that didn't go through revision
 * (round 1 pass — no integrator call). Drawer nests these inside each
 * round's voice / structure / fact gates.
 */
export interface MadeIntegratorDecision {
  /** Closed enum at the writer: `voice_auditor` | `fact_checker` | `structure_editor`. */
  feedbackSource: string;
  /** The auditor's flagged item the Integrator was responding to —
   *  populated from Task 06's `feedback_summary` column. Nullable
   *  defensively for rows where the integrator parse-fell-through.   */
  feedbackSummary: string | null;
  /** Closed enum: `accepted` | `overruled` | `partial`. */
  decision: string;
  /** Integrator's narrative for the decision — why accept / overrule. */
  reasoning: string | null;
  /** What actually changed in the MDX — line / paragraph / beat. */
  resultingChange: string | null;
}

export interface MadeRound {
  round: number;
  voice: MadeVoice;
  structure: MadeStructure;
  fact: MadeFacts;
  /** Integrator decisions persisted at the END of this round
   *  (i.e. the response that produced the NEXT round's draft).
   *  Empty when the round passed and no integrator ran. */
  integratorDecisions: MadeIntegratorDecision[];
}

export interface MadeCandidate {
  headline: string;
  source: string;
  category: string | null;
  summary: string | null;
  url: string | null;
  teachabilityScore: number | null;
  /** Curator's narrative for picking THIS story. Populated only on the
   *  picked candidate (selected=1). Foundation Fix Task 03 (2026-05-06)
   *  added `daily_candidates.pick_reasoning`; pre-Task-03 picks return
   *  null and the drawer omits the line. */
  pickReasoning: string | null;
  /** Closed-enum category (8 values): `off_topic` | `duplicate` | `too_local`
   *  | `no_teaching_angle` | `wrong_shape` | `low_signal` | `tribal_framing`
   *  | `already_covered`. Populated on every non-picked candidate
   *  Curator actually evaluated; null for candidates the pre-Curator
   *  dedup-headlines path hard-skipped before Curator wrote a category. */
  rejectionCategory: string | null;
  /** Curator's narrative for rejecting THIS candidate. Populated only
   *  for top-N runner-ups (currently top 10 per CURATOR_CONTRACT v1.2);
   *  other rejections carry only `rejectionCategory` for storage cost. */
  rejectionReason: string | null;
}

/** One row of the Curator's rejection-by-category aggregate. */
export interface MadeRejectionBreakdown {
  /** Closed-enum slug (e.g. `off_topic`, `tribal_framing`). */
  category: string;
  /** How many candidates landed in this category for the run. */
  count: number;
}

export interface MadeCandidates {
  total: number;
  picked: MadeCandidate | null;
  alsoConsidered: MadeCandidate[];
  /** Aggregate count by rejection_category across the run.
   *  Empty for pre-Task-03 pieces (no rejection_category to group by). */
  rejectionBreakdown: MadeRejectionBreakdown[];
}

export interface MadeAudioBeat {
  beatName: string;
  publicUrl: string;
  characterCount: number;
  /** Per-beat playback duration in seconds. Populated by Audio Producer
   *  from `byteLength / BYTES_PER_SECOND_AT_96KBPS` (Foundation Fix
   *  Task 05, 2026-05-12). Null on legacy rows. */
  durationSeconds: number | null;
  /** Per-beat MP3 size in bytes — `arrayBuffer().byteLength` captured
   *  by Audio Producer (Task 05). Null on legacy rows. */
  fileSizeBytes: number | null;
}

/**
 * One row from `audio_audit_results` (Foundation Fix Task 05). The
 * audit always writes a summary row (`beatName=null`, `issueType=null`)
 * + one row per issue. Drawer renders the summary as a verdict line
 * and the issues as a per-beat list. Closed-enum `issueType`:
 * `no_audio_rows` | `missing_file` | `empty_file` | `size_too_small`
 * | `size_too_large` | `text_too_short` | `character_cap_exceeded`
 * | `unknown` (forward-compat sentinel).
 */
export interface MadeAudioAuditIssue {
  beatName: string | null;
  issueType: string | null;
  issueSeverity: string | null;
  notes: string | null;
}

export interface MadeAudioAudit {
  passed: boolean;
  summaryNote: string | null;
  issues: MadeAudioAuditIssue[];
  auditedAt: number | null;
}

/**
 * Audio state for a published piece. Populated only if audio landed
 * (has_audio = 1 on daily_pieces + rows in daily_piece_audio). If
 * audio hasn't run yet or failed, `beats` is empty — the drawer
 * shows nothing rather than lying about the state.
 */
export interface MadeAudio {
  beats: MadeAudioBeat[];
  totalCharacters: number;
  /** SUM(file_size_bytes) over the beats — populated since Foundation
   *  Fix Task 05 (2026-05-12). Null when no beat row carries the
   *  column (pre-Task-05 legacy audio). */
  totalSizeBytes: number | null;
  /** SUM(duration_seconds) over the beats — total listening time. */
  totalDurationSeconds: number | null;
  model: string | null;
  voiceId: string | null;
  generatedAt: number | null;
  /** Audio Auditor's verdict + per-beat issues. Null for pre-Task-05
   *  legacy pieces with no `audio_audit_results` row, OR for the
   *  pre-2026-05-11 deploy where every audit silently failed to
   *  persist via the line-200 arity bug. */
  audit: MadeAudioAudit | null;
}

/**
 * A single learning row pinned to this piece via `learnings.piece_date`.
 * Shape matches Build 1's dashboard Memory panel — two surfaces, one
 * schema. Source is nullable to preserve pre-P1.3 orphan rows; the
 * drawer renders those under a defensive "Learning pattern" fallback
 * group (same fallback the dashboard Memory panel uses).
 */
export interface MadeLearning {
  observation: string;
  source: string | null;
  createdAt: number;
}

/**
 * One learning from an EARLIER piece that was loaded into THIS piece's
 * Drafter (via `getRecentLearnings(10)`) and then validated by THIS
 * piece's publication (Director appends this piece's id to the
 * learning's `applied_to_prompts` JSON array on success — Foundation
 * Fix Task 04, 2026-05-11).
 *
 * Closes the read-side of the loop in the drawer: the existing
 * `learnings` array is what THIS piece WROTE for future Drafters;
 * `learningsLoaded` is what PAST pieces WROTE that shaped THIS one.
 */
export interface MadeLearningLoad {
  observation: string;
  source: string | null;
  /** Piece that originally wrote this learning. May be null on legacy
   *  pre-Task-04 rows without piece_id. */
  fromPieceId: string | null;
  fromPieceDate: string | null;
  createdAt: number;
}

/**
 * One library category Categoriser assigned to this piece. Confidence is
 * the score Claude returned at categorisation time (0–100). Empty array
 * means Categoriser hasn't run, declined, or pre-dates the agent — the
 * drawer omits the section in all three cases.
 */
export interface MadeCategory {
  slug: string;
  name: string;
  confidence: number;
}

/**
 * The standalone interactive generated from this piece by
 * InteractiveGenerator + InteractiveAuditor. `null` on the field means
 * that artefact type's path hasn't run, declined as redundant, or
 * pre-dates the agent.
 *
 * Two artefact types ship per piece since Phase 2:
 *   - `envelope.interactive` — the QUIZ (live since Area 4).
 *   - `envelope.htmlInteractive` — the HTML interactive (Phase 2,
 *     gated by `interactives_html_enabled`).
 *
 * `qualityFlag === 'low'` indicates a max-failed-but-shipped artefact
 * (per the 2026-04-24 reversal for quiz, mirrored on HTML in Phase
 * 2.4); the drawer renders normally and surfaces a dimension-named
 * note so readers can still try it.
 *
 * Both fields independent — quiz can ship while HTML declines, or
 * vice versa.
 */
export interface MadeInteractive {
  slug: string;
  type: string;
  title: string;
  voiceScore: number | null;
  qualityFlag: 'low' | null;
  revisionCount: number;
  publishedAt: number | null;
  /** Dimensions that failed at the LATEST round of audit, in fixed
   *  order (voice → structure → essence → factual). Empty array for
   *  a clean pass OR for legacy interactives generated before
   *  migration 0023 (no `interactive_audit_results` rows exist).
   *  Drawer reads this only when `qualityFlag === 'low'` to name
   *  what the auditor flagged. */
  failedDimensions: string[];
}

export interface MadeEnvelope {
  date: string;
  piece: MadePiece | null;
  timeline: MadeTimelineStep[];
  rounds: MadeRound[];
  candidates: MadeCandidates;
  audio: MadeAudio;
  categories: MadeCategory[];
  /** The QUIZ artefact for this piece — `null` if the quiz path
   *  declined / hasn't run / pre-dates the agent. Field name kept
   *  for back-compat with the shipped reader bundle. */
  interactive: MadeInteractive | null;
  /** The HTML INTERACTIVE artefact for this piece — `null` if the
   *  HTML path declined / hasn't run / `interactives_html_enabled`
   *  is false / pre-dates Phase 2. Independent from `interactive`
   *  above; both can be set, one set, or neither. */
  htmlInteractive: MadeInteractive | null;
  learnings: MadeLearning[];
  /** Read-side of the learning loop — learnings written by EARLIER
   *  pieces that shaped THIS piece. Populated since Foundation Fix
   *  Task 04 (2026-05-11). Empty on pre-Task-04 pieces (no
   *  `applied_to_prompts` linkage). */
  learningsLoaded: MadeLearningLoad[];
}

/**
 * Teaser counts for the "How this was made" open-affordance button.
 * Cheap single-row counts — three quick queries, no joins.
 * Called at page render time on `/daily/[date]`.
 */
export interface MadeTeaser {
  rounds: number;          // audit rounds this piece went through
  candidates: number;      // candidates Scanner surfaced for this date
  agentsOnDuty: number;    // static — the 11 non-paused agents in the pipeline
}

export async function loadMadeTeaser(
  db: D1Database,
  date: string,
  pieceId?: string | null,
): Promise<MadeTeaser> {
  const teaser: MadeTeaser = { rounds: 0, candidates: 0, agentsOnDuty: 11 };
  try {
    // Prefer piece_id scoping when available (unambiguous at
    // multi-per-day). Falls back to date-keyed at 1/day or when the
    // caller doesn't know the piece_id yet.
    const draftRows = pieceId
      ? await db
          .prepare('SELECT COUNT(DISTINCT draft_id) as n FROM audit_results WHERE piece_id = ?')
          .bind(pieceId)
          .first<{ n: number }>()
      : await db
          .prepare('SELECT COUNT(DISTINCT draft_id) as n FROM audit_results WHERE task_id = ?')
          .bind(`daily/${date}`)
          .first<{ n: number }>();
    teaser.rounds = draftRows?.n ?? 0;

    const candRows = pieceId
      ? await db
          .prepare('SELECT COUNT(*) as n FROM daily_candidates WHERE piece_id = ?')
          .bind(pieceId)
          .first<{ n: number }>()
      : await db
          .prepare('SELECT COUNT(*) as n FROM daily_candidates WHERE date = ?')
          .bind(date)
          .first<{ n: number }>();
    teaser.candidates = candRows?.n ?? 0;
  } catch {
    /* table may be empty in dev — zeros are fine */
  }
  return teaser;
}
