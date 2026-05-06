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
}

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
