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
  /**
   * Foundation Fix Task 08 (2026-05-07) — retention worker safety rail.
   * 'true' (default for first 7 days post-deploy) makes the daily 04:00
   * UTC retention worker count + log rows that WOULD be deleted, but
   * delete nothing. Operator flips to 'false' (or unsets) only after
   * reviewing the dry-run observer events. See agents/src/retention.ts
   * and docs/RETENTION.md.
   */
  RETENTION_DRY_RUN?: string;
  /**
   * Tavily Search API key. Required by the 2026-05-16 fact-checker
   * re-architecture (Tavily replaces Anthropic's web_search server tool
   * as the search backend; see agents/src/fact-checker-tavily.ts).
   * Set via `wrangler secret put TAVILY_API_KEY` against zeemish-agents.
   * Free tier (1,000 credits/month) covers most months once the
   * per-claim cache in `claim_verifications` warms up; PAYG at
   * $0.008/credit beyond. If unset, FactCheckerAgent throws on the
   * first call — Director's existing try/catch logs once via
   * observer.logError and the audit_results row carries parseError.
   */
  TAVILY_API_KEY?: string;
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

/** Closed enum of teachability-taxonomy domains. One value per Curator
 *  pick — Curator self-classifies the story it picked into the domain
 *  whose lens does the most teaching work. Persisted to
 *  daily_pieces.pick_domain (migration 0042) so Director can supply
 *  trailing-30-day domain concentration to the next Curator run.
 *
 *  Tokens MUST match the bullet list at content/curator-contract.md:19-28.
 *  The codegen step asserts exact-match — drift between contract and
 *  enum fails build. Add a domain by editing the contract first; codegen
 *  will then refuse to build until this enum is updated to match.
 *
 *  Same closed-enum posture as RejectionCategory + AudioIssueType +
 *  IntegratorDecision — defensive validation at the writer; unknown
 *  values fall to `unknown` and surface via operator query.
 *
 *  PR #1 (2026-05-09). */
export type PickDomain =
  | 'inner-life'
  | 'meaning'
  | 'expression'
  | 'language'
  | 'science'
  | 'body'
  | 'how-humans-live'
  | 'skills'
  | 'technology'
  | 'time-and-place'
  | 'unknown';

export const PICK_DOMAINS: ReadonlySet<PickDomain> = new Set<PickDomain>([
  'inner-life',
  'meaning',
  'expression',
  'language',
  'science',
  'body',
  'how-humans-live',
  'skills',
  'technology',
  'time-and-place',
  'unknown',
]);

/** Per-call usage telemetry surfaced from any agent that makes a
 *  Claude call. Director reads these off the result and forwards them
 *  to ObserverAgent.logLLMCall so the admin observer feed carries the
 *  cost shape of every mainline LLM call. tokensIn / tokensOut come
 *  from `response.usage.input_tokens / output_tokens`; durationMs is
 *  measured wall-clock around the call. Optional cache fields are
 *  populated only by callers that pass an Anthropic prompt-cache block. */
export interface LLMCallMetrics {
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  cacheCreateTokens?: number;
  cacheReadTokens?: number;
}

/** Result of Curator picking a story (or deciding to skip) */
export type CuratorResult = (
  | {
      skip: false;
      brief: DailyPieceBrief;
      selectedCandidateId?: string;
      pickReasoning?: string;
      pickDomain?: PickDomain;
      rejections?: CuratorRejection[];
    }
  | { skip: true; reason: string }
) & LLMCallMetrics;

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
  /** Per-call usage. Director forwards to observer.logLLMCall. */
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
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

/** Closed enum of failure reasons the Voice Auditor can emit.
 *  Stored as comma-separated values in `audit_results.failure_reasons`
 *  on rows where `passed=0`. Each token tags ONE specific kind of
 *  voice-contract violation; an auditor pass can list multiple tokens.
 *  Lives in `content/audit-contract.md` "Voice Auditor failure_reasons
 *  enum" section as the canonical source. Same closed-enum posture as
 *  RejectionCategory (Task 03), AudioIssueType (Task 05), and
 *  IntegratorDecision / FeedbackSource (Task 06).
 *
 *  `unknown` is reserved for forward-compat — if Claude emits a token
 *  the closed Set hasn't seen yet, it persists as `unknown` (drift
 *  becomes visible via the `failure_reasons LIKE '%unknown%'` operator
 *  query) rather than silently dropping the row.
 *
 *  Foundation Fix Task 08 PR 08c (2026-05-07). Closes leak L24. */
export type VoiceFailureReason =
  | 'tribe_word'
  | 'long_sentence'
  | 'vague_subject'
  | 'no_specific_example'
  | 'flattery'
  | 'jargon_without_translation'
  | 'unknown';

export const VOICE_FAILURE_REASONS: ReadonlySet<VoiceFailureReason> = new Set<VoiceFailureReason>([
  'tribe_word',
  'long_sentence',
  'vague_subject',
  'no_specific_example',
  'flattery',
  'jargon_without_translation',
  'unknown',
]);

/** Closed enum of failure reasons the Structure Editor can emit.
 *  Same shape as VoiceFailureReason. Tags structural issues with the
 *  beat contract — beat count, hook shape, pacing, length floors,
 *  etc. Lives in `content/audit-contract.md` "Structure Editor
 *  failure_reasons enum" section.
 *
 *  Foundation Fix Task 08 PR 08c (2026-05-07). */
export type StructureFailureReason =
  | 'weak_hook'
  | 'missing_close'
  | 'beat_too_long'
  | 'pacing_uneven'
  | 'wrong_beat_count'
  | 'wrong_word_count'
  | 'widget_without_purpose'
  | 'unknown';

export const STRUCTURE_FAILURE_REASONS: ReadonlySet<StructureFailureReason> = new Set<StructureFailureReason>([
  'weak_hook',
  'missing_close',
  'beat_too_long',
  'pacing_uneven',
  'wrong_beat_count',
  'wrong_word_count',
  'widget_without_purpose',
  'unknown',
]);

/** Closed enum of failure reasons the Fact Checker can emit. Tags the
 *  shape of the fact-check failure (an unverified claim, a contradicted
 *  claim, etc.); the Fact Checker also writes per-claim status into
 *  `daily_audit_claims` since 2026-04-30, so this enum complements
 *  that more granular record at the per-audit summary level. Lives in
 *  `content/audit-contract.md` "Fact Checker failure_reasons enum"
 *  section.
 *
 *  Foundation Fix Task 08 PR 08c (2026-05-07). */
export type FactFailureReason =
  | 'unverified_claim'
  | 'contradicted_claim'
  | 'missing_source'
  | 'cutoff_confession'
  | 'search_not_used'
  | 'unknown';

export const FACT_FAILURE_REASONS: ReadonlySet<FactFailureReason> = new Set<FactFailureReason>([
  'unverified_claim',
  'contradicted_claim',
  'missing_source',
  'cutoff_confession',
  'search_not_used',
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

/** Snapshot of one revise() call's audit results. Stored in
 *  IntegratorState so the next call (still inside the same piece) can
 *  carry the previous round's audits into the prompt for round-to-round
 *  regression awareness. Foundation Fix Phase 4 Task 09 (2026-05-07).
 *
 *  Carries the full audit results (Fork 2 pick: full payload vs
 *  pass/fail flags only) so Claude can spot specific re-introduced
 *  violations like "voice was passing at 95 last round; preserve it."
 *  pieceId is the keying field — when the next revise() call's pieceId
 *  differs, the snapshot is treated as stale and ignored (state resets
 *  cleanly without an explicit clear). Lazy reset matches the brief and
 *  avoids race windows around the per-day DO instance lifecycle. */
export interface IntegratorRoundSnapshot {
  pieceId: string;
  /** The round just COMPLETED before the current revise() call.
   *  Round 1 → snapshot.revisionRound=1 stored after Round-1 revise. */
  revisionRound: number;
  voice: import('./voice-auditor').VoiceAuditResult;
  structure: import('./structure-editor').StructureAuditResult;
  fact: import('./fact-checker').FactCheckResult;
}

/** IntegratorAgent's Durable Object state. Single-snapshot shape per
 *  Fork 1 of the Task 09 plan: store only the most-recent revision's
 *  audits, keyed by pieceId. New piece → snapshot ignored on read,
 *  overwritten on write. Same posture as the other audit-side agents
 *  (`AudioAuditorState.lastResult` etc.). */
export interface IntegratorState {
  lastSnapshot: IntegratorRoundSnapshot | null;
}

/** A single claim the Extract step pulled out of a draft. The
 *  Verify step receives the same `claim_id` back so the per-claim
 *  verdict can be threaded into FactCheckResult.claims in the original
 *  draft order. `search_query` is what we send to Tavily — Claude
 *  generates a focused, decontextualised query (e.g. "femur dinosaur
 *  Thailand 2026 weight estimate" rather than the raw claim prose) so
 *  the same evergreen claim across two pieces fingerprints identically.
 *
 *  2026-05-16 Tavily re-architecture. */
export interface ExtractedClaim {
  claim_id: string;
  claim_text: string;
  search_query: string;
}

/** Closed enum of claim verdicts the Tavily-backed fact-checker can
 *  emit. Mirrors the existing FactClaim.status enum (`verified` |
 *  `unverified` | `incorrect`) but renames `incorrect` to the
 *  `contradicted` token used in the audit-contract's failure_reasons
 *  enum — the same shape in two places caused enough confusion that the
 *  Tavily pipeline canonicalises on the contract's vocabulary. The
 *  agent translates `contradicted` back to `incorrect` when filling
 *  FactClaim.status so the existing FactClaim → daily_audit_claims
 *  persistence path doesn't have to change.
 *
 *  `cutoff_confession_attempted` flags the case where Claude tried to
 *  emit a cutoff-confession verdict (forbidden by the contract) — the
 *  agent translates this to `unverified` for FactClaim.status and adds
 *  `cutoff_confession` to FactCheckResult.failureReasons.
 *
 *  `unknown` is reserved for forward-compat — drift surfaces via the
 *  same `failure_reasons LIKE '%unknown%'` operator query the other
 *  closed-enum auditors use. */
export type TavilyClaimVerdict =
  | 'verified'
  | 'unverified'
  | 'contradicted'
  | 'cutoff_confession_attempted'
  | 'unknown';

export const TAVILY_CLAIM_VERDICTS: ReadonlySet<TavilyClaimVerdict> = new Set<TavilyClaimVerdict>([
  'verified',
  'unverified',
  'contradicted',
  'cutoff_confession_attempted',
  'unknown',
]);

/** A single Tavily search result snippet. Mirrors the relevant slice of
 *  Tavily's response.results[N] — only the fields the Verify step needs.
 *  Stored in claim_verifications.tavily_snippets as JSON. Kept compact
 *  on purpose; raw HTML and image fields are not persisted. */
export interface TavilySnippet {
  title: string;
  url: string;
  content: string;
  score: number;
}

/** Row shape for the claim_verifications table (migration 0044). Read
 *  by fact-checker-tavily.ts on cache lookup; written after a fresh
 *  Tavily search + Verify pass produces a verdict. Cache TTL is checked
 *  at READ time (rows with last_used_at older than
 *  TAVILY_CACHE_TTL_DAYS are treated as miss); no separate eviction
 *  worker yet — stale rows just take space until a retention pass is
 *  added.
 *
 *  Fingerprint key: sha256(normalised_claim_text + '|' + search_query).
 *  Normalisation: lowercase, collapse whitespace, strip trailing
 *  punctuation. Both fields included so a paraphrased claim with the
 *  same search query still fingerprints distinctly. */
export interface CachedClaimVerification {
  id: string;
  claim_fingerprint: string;
  claim_text: string;
  search_query: string;
  tavily_snippets: TavilySnippet[];
  verdict: TavilyClaimVerdict;
  evidence_urls: string[];
  source_piece_id: string | null;
  hit_count: number;
  created_at: number;
  last_used_at: number;
}
