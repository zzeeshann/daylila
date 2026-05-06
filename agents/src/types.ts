/**
 * Shared types for the Daylila agent team.
 */

/** Cloudflare Worker environment bindings */
export interface Env {
  ANTHROPIC_API_KEY: string;
  DB: D1Database;
  DIRECTOR: DurableObjectNamespace;
  VOICE_AUDITOR: DurableObjectNamespace;
  STRUCTURE_EDITOR: DurableObjectNamespace;
  FACT_CHECKER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace;
  PUBLISHER: DurableObjectNamespace;
  OBSERVER: DurableObjectNamespace;
  LEARNER: DurableObjectNamespace;
  AUDIO_PRODUCER: DurableObjectNamespace;
  AUDIO_AUDITOR: DurableObjectNamespace;
  SCANNER: DurableObjectNamespace;
  CURATOR: DurableObjectNamespace;
  DRAFTER: DurableObjectNamespace;
  CATEGORISER: DurableObjectNamespace;
  INTERACTIVE_GENERATOR: DurableObjectNamespace;
  INTERACTIVE_AUDITOR: DurableObjectNamespace;
  AUDIO_BUCKET: R2Bucket;
  GITHUB_TOKEN: string;
  ADMIN_SECRET: string;
  ELEVENLABS_API_KEY: string;
  /**
   * Optional JSON-encoded override for Scanner's RSS feed list.
   * Shape: `{"CATEGORY": "https://feed.url/...", ...}`.
   * Set via `wrangler secret put SCANNER_RSS_FEEDS_JSON '{...}'` to
   * change feeds without a redeploy. Malformed JSON falls back to the
   * hardcoded defaults in scanner.ts.
   */
  SCANNER_RSS_FEEDS_JSON?: string;
}

/** Plan for a single beat within a piece */
export interface BeatPlan {
  name: string;
  type: 'hook' | 'teaching' | 'practice' | 'close';
  description: string;
}

/**
 * Which pipeline phase Director is coordinating.
 * Each value names the agent currently running — Director itself only routes.
 *
 * Audio phases run AFTER publisher — text ships first (newspaper never
 * skips a day), then audio is produced + audited, then publisher does a
 * second commit splicing the audio URLs into frontmatter.
 */
export type DirectorPhase =
  | 'scanner'
  | 'curator'
  | 'drafter'
  | 'auditors'
  | 'integrator'
  | 'publisher'
  | 'audio-producer'
  | 'audio-auditor'
  | 'audio-publisher';

/** Director agent state — pure orchestrator, no content work */
export interface DirectorState {
  status: 'idle' | 'running' | 'error';
  currentPhase: DirectorPhase | null;
  currentTask: string | null;
  lastDailyPiece: { title: string; date: string } | null;
  error: string | null;
}

/** A daily piece brief — news-anchored teaching */
export interface DailyPieceBrief {
  date: string;
  headline: string;
  newsSource: string;
  underlyingSubject: string;
  teachingAngle: string;
  hooks: string[];
  beats: BeatPlan[];
  estimatedTime: string;
  toneNote: string;
  avoid: string;
}

/** Curator agent state */
export interface CuratorState {
  status: 'idle' | 'curating' | 'error';
  lastBrief: { headline: string; date: string } | null;
  error: string | null;
}

/** Drafter agent state */
export interface DrafterState {
  status: 'idle' | 'drafting' | 'error';
  lastDraft: { headline: string; date: string; wordCount: number } | null;
  error: string | null;
}

/** Closed enum for daily_candidates.rejection_category — see
 *  content/curator-contract.md "Rejection category enum" for the rule body.
 *  Director defensively logs unknown values via observer.logError. */
export type RejectionCategory =
  | 'off_topic'
  | 'duplicate'
  | 'too_local'
  | 'no_teaching_angle'
  | 'wrong_shape'
  | 'low_signal'
  | 'tribal_framing'
  | 'already_covered';

/** Runtime mirror of RejectionCategory for membership checks. Director
 *  validates Curator output against this set and logs the count of
 *  unknown categories via observer.logError so drift becomes visible
 *  without per-row spam. */
export const REJECTION_CATEGORIES: ReadonlySet<RejectionCategory> = new Set<RejectionCategory>([
  'off_topic',
  'duplicate',
  'too_local',
  'no_teaching_angle',
  'wrong_shape',
  'low_signal',
  'tribal_framing',
  'already_covered',
]);

/** A single rejection record — one per non-picked candidate per Curator
 *  run. Persisted to daily_candidates.rejection_category +
 *  rejection_reason via Director. The id MUST be the exact UUID from the
 *  candidate's `id:` field in the prompt. rejectionReason is populated
 *  only on the top 5 candidates Curator weighed most seriously. */
export interface CuratorRejection {
  id: string;
  rejectionCategory: RejectionCategory;
  rejectionReason?: string;
}

/** Result of Curator picking a story (or deciding to skip) */
export type CuratorResult =
  | {
      skip: false;
      brief: DailyPieceBrief;
      selectedCandidateId?: string;
      pickReasoning?: string;
      rejections?: CuratorRejection[];
    }
  | { skip: true; reason: string };

/** Result of Drafter writing MDX for a brief */
export interface DrafterResult {
  mdx: string;
  wordCount: number;
  /** IDs of learnings the Drafter pulled from getRecentLearnings(10)
   *  this run. Threaded back to Director so the success-path UPDATE
   *  can append this piece's id to applied_to_prompts (and, if the
   *  piece clears the Polished-strict bar, also write
   *  last_validated_at). Empty array is valid — the table may be
   *  empty (early days) or the read may have failed open (DB hiccup);
   *  either way no feedback UPDATE fires. Foundation Fix Task 04. */
  loadedLearningIds: string[];
  /** Populated only when persistence to draft_revisions threw on the
   *  round-0 write. Director reads this AFTER consuming `mdx` and
   *  fires observer.logError once if populated. The MDX itself is
   *  unaffected — computed before the persistence call runs.
   *  Foundation Fix Task 06 (L4). */
  persistError: string | null;
}

/** Closed enum for audio_audit_results.issue_type — one value per
 *  branch in AudioAuditorAgent.audit(). The auditor sets `issueType`
 *  on every AudioIssue at construction time; the persistence batch
 *  carries it through unchanged. `unknown` is reserved for forward-
 *  compat — a future issue path added to the auditor without a
 *  corresponding union extension persists as `unknown` rather than
 *  being dropped. Same posture as RejectionCategory above. Foundation
 *  Fix Task 05. */
export type AudioIssueType =
  | 'no_audio_rows'
  | 'missing_file'
  | 'empty_file'
  | 'size_too_small'
  | 'size_too_large'
  | 'text_too_short'
  | 'character_cap_exceeded'
  | 'unknown';

/** Runtime mirror of AudioIssueType for membership checks. Used by
 *  the auditor's persistence path to validate before binding into the
 *  closed-enum column; unknown values fall through to `unknown` so
 *  drift becomes visible via the issue_type_breakdown operator query
 *  rather than silently dropping rows. */
export const AUDIO_ISSUE_TYPES: ReadonlySet<AudioIssueType> = new Set<AudioIssueType>([
  'no_audio_rows',
  'missing_file',
  'empty_file',
  'size_too_small',
  'size_too_large',
  'text_too_short',
  'character_cap_exceeded',
  'unknown',
]);

/** A news candidate from the Scanner */
export interface DailyCandidate {
  id: string;
  headline: string;
  source: string;
  category: string;
  summary: string;
  url: string;
  teachabilityScore?: number;
}

/** Closed enum for integrator_decisions.decision — the disposition the
 *  Integrator records on each piece of auditor feedback. accepted = the
 *  prose was revised per the feedback. overruled = the Integrator chose
 *  not to act on the feedback (rare; the prompt instructs it to fix
 *  every flagged issue, but a fact-check flag the Integrator believes
 *  is spurious is a legitimate overrule). partial = some aspect
 *  addressed, others deliberately left. Same posture as
 *  RejectionCategory + AudioIssueType — loose TEXT in the table,
 *  defensive validation at the writer. Foundation Fix Task 06. */
export type IntegratorDecision = 'accepted' | 'overruled' | 'partial';

/** Runtime mirror of IntegratorDecision for membership checks. The
 *  persistence path drops decision rows whose `decision` value isn't
 *  in this set; the count of drops surfaces via Integrator's
 *  `parseError` sentinel (Director logs once via observer.logError),
 *  matching the AudioIssueType drop-with-visibility posture. */
export const INTEGRATOR_DECISIONS: ReadonlySet<IntegratorDecision> = new Set<IntegratorDecision>([
  'accepted',
  'overruled',
  'partial',
]);

/** Closed enum for integrator_decisions.feedback_source — which
 *  auditor raised the item the Integrator addressed. One value per
 *  auditor agent in the daily-piece pipeline. Foundation Fix Task 06. */
export type FeedbackSource = 'voice_auditor' | 'fact_checker' | 'structure_editor';

/** Runtime mirror of FeedbackSource for membership checks. Same drop-
 *  with-visibility posture as INTEGRATOR_DECISIONS. */
export const FEEDBACK_SOURCES: ReadonlySet<FeedbackSource> = new Set<FeedbackSource>([
  'voice_auditor',
  'fact_checker',
  'structure_editor',
]);

/** A single Integrator decision record — one per feedback item the
 *  Integrator addressed in a single revision round. Persisted to
 *  integrator_decisions. The Integrator returns these inside
 *  IntegrationResult.decisions; the agent's persistence batch writes
 *  one row per record alongside the round's draft_revisions row.
 *  Foundation Fix Task 06 (L9). */
export interface IntegratorDecisionRecord {
  feedbackSource: FeedbackSource;
  feedbackSummary: string;
  decision: IntegratorDecision;
  reasoning?: string;
  resultingChange?: string;
}
