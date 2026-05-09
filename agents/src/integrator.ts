import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Env,
  IntegratorDecisionRecord,
  IntegratorState,
  IntegratorRoundSnapshot,
} from './types';
import { INTEGRATOR_DECISIONS, FEEDBACK_SOURCES } from './types';
import { buildIntegratorSystem } from './integrator-prompt';
import { extractJson } from './shared/parse-json';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

export interface IntegrationResult {
  /** The revised MDX, ready for the next audit round. */
  revisedMdx: string;
  /** One record per feedback item the Integrator addressed. May be
   *  empty when parse fell back to raw-text fallback (parseError set)
   *  or when Claude legitimately addressed zero items (rare; the
   *  prompt instructs it to fix every flagged issue). */
  decisions: IntegratorDecisionRecord[];
  /** Populated when JSON parsing failed OR enum-validation dropped
   *  rows. Director reads this AFTER consuming `revisedMdx` and fires
   *  observer.logError once per revision call (no per-row spam). The
   *  revised MDX is preserved on parse-fail by falling back to the
   *  raw text response — the publish path is unaffected. */
  parseError: string | null;
  /** Populated only when the persistence batch threw. Same posture as
   *  AudioAuditorAgent.persistError (Foundation Fix Task 05) — the
   *  in-memory verdict is computed before persistence runs, so a D1
   *  hiccup cannot affect Director's branch logic. */
  persistError: string | null;
}

/** Internal — what we expect Claude to return as the structured
 *  envelope when it parses cleanly. Decisions get re-validated against
 *  closed enums before persistence; this type is the optimistic shape. */
interface IntegratorRawEnvelope {
  revisedMdx?: string;
  decisions?: Array<{
    feedback_source?: string;
    feedback_summary?: string;
    decision?: string;
    reasoning?: string;
    resulting_change?: string;
  }>;
}

/**
 * IntegratorAgent — takes audit feedback from all three gates,
 * synthesises it, and revises the draft. Submits back for re-audit.
 * Max 3 revision passes before escalation.
 *
 * Round-aware within a single piece (Foundation Fix Phase 4 Task 09,
 * 2026-05-07). Durable Object state carries the previous round's
 * audits via `IntegratorState.lastSnapshot`, keyed by pieceId. Round 2
 * sees what Round 1 looked like (PASS/FAIL per dimension + scores +
 * failure tokens) so the prompt can flag pass→fail flips as
 * regressions to repair. State resets lazily — when the next revise()
 * call's pieceId differs from the stored snapshot, the snapshot is
 * ignored on read and overwritten on write. The DO instance is still
 * per-day (Director spawns `integrator-daily-${today}`); state lives
 * only within one day's pipeline runs.
 *
 * Foundation Fix Task 06 (L8 + L9): each call also persists one row to
 * draft_revisions (the revised MDX) and one row per addressed feedback
 * item to integrator_decisions. Persistence is fail-open via the
 * persistError sentinel; the publish path is preserved on D1 hiccups.
 * JSON-parse fallback preserves revisedMdx on shape drift.
 */
export class IntegratorAgent extends Agent<Env, IntegratorState> {
  initialState: IntegratorState = { lastSnapshot: null };

  async revise(
    pieceId: string,
    runId: string | null,
    revisionRound: number,
    mdx: string,
    voiceResult: VoiceAuditResult,
    structureResult: StructureAuditResult,
    factResult: FactCheckResult,
  ): Promise<IntegrationResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    // Round-to-round state read. Lazy reset: any snapshot whose
    // pieceId differs from the current call is treated as stale and
    // ignored. Round 1 of a fresh piece sees no previous-round
    // context; the prompt handles that case cleanly.
    const stored = this.state.lastSnapshot;
    const previousForPrompt: IntegratorRoundSnapshot | null =
      stored && stored.pieceId === pieceId ? stored : null;

    const previousContext = previousForPrompt
      ? buildPreviousRoundContext(previousForPrompt) + '\n\n'
      : '';
    const currentFeedback = buildCurrentRoundFeedback(
      voiceResult,
      structureResult,
      factResult,
    );

    // Streaming, not messages.create. Output sizes mirror Drafter
    // (full revised MDX) plus a structured-decisions JSON envelope —
    // recently observed at 3,123 output tokens. Same CF Workers ~125s
    // subrequest idle reasoning as Curator + Drafter. See DECISIONS
    // 2026-05-09 "Curator 124s 499 timeout regression".
    const response = await client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: buildIntegratorSystem(),
      messages: [
        {
          role: 'user',
          content: `${previousContext}## Original draft:\n\n${mdx}\n\n## Feedback from auditors:\n\n${currentFeedback}`,
        },
      ],
    }).finalMessage();

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse + validate. Two-stage: extractJson then per-row enum guard.
    // Parse-fail OR every-row-dropped-by-enum-guard surfaces as
    // parseError; Director logs once via observer.logError. Either way
    // revisedMdx is preserved (raw text on parse-fail, parsed string
    // otherwise) so the publish path continues unaffected.
    const { revisedMdx, decisions, parseError } = parseIntegratorEnvelope(rawText, mdx);

    const persistError = await this.persistRevision(
      pieceId,
      runId,
      revisionRound,
      revisedMdx,
      decisions,
    );

    // Round-to-round state write. Snapshot what THIS round audited so
    // the next call (still inside this piece) carries it as previous-
    // round context. Stored regardless of parseError / persistError —
    // those concern persistence to D1 / response-shape parsing, not
    // the audit results themselves which are what next round needs.
    this.setState({
      lastSnapshot: {
        pieceId,
        revisionRound,
        voice: voiceResult,
        structure: structureResult,
        fact: factResult,
      },
    });

    return { revisedMdx, decisions, parseError, persistError };
  }

  /**
   * Persist one draft_revisions row + one integrator_decisions row per
   * addressed feedback item, in a single this.env.DB.batch().
   *
   * Mirrors AudioAuditorAgent.persistAuditRows (Foundation Fix Task 05)
   * — same DO, same fail-open posture, same try/catch returning a
   * persistError sentinel for Director to log once via observer.logError.
   *
   * Bind-count safety: draft row is 6 binds; each decision row is 8
   * binds. Even on a maximal-feedback round (~30 items, well above the
   * empirical max of ~8) the batch is ~6 + 30×8 = 246 binds total
   * across 31 statements. D1's per-statement bind cap is ~100; per-
   * statement count here is ≤8, comfortably safe. The total batch
   * statement-count cap is well above 31.
   */
  private async persistRevision(
    pieceId: string,
    runId: string | null,
    revisionRound: number,
    mdx: string,
    decisions: IntegratorDecisionRecord[],
  ): Promise<string | null> {
    try {
      const now = Date.now();
      const wordCount = mdx.split(/\s+/).filter((s) => s.length > 0).length;

      const draftRow = this.env.DB
        .prepare(
          `INSERT INTO draft_revisions
            (piece_id, revision_round, mdx_content, word_count, authored_by, created_at, run_id)
           VALUES (?, ?, ?, ?, 'integrator', ?, ?)`,
        )
        .bind(pieceId, revisionRound, mdx, wordCount, now, runId);

      const decisionStmt = this.env.DB.prepare(
        `INSERT INTO integrator_decisions
          (piece_id, revision_round, feedback_source, feedback_summary,
           decision, reasoning, resulting_change, created_at, run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const decisionRows = decisions.map((d) =>
        decisionStmt.bind(
          pieceId,
          revisionRound,
          d.feedbackSource,
          d.feedbackSummary,
          d.decision,
          d.reasoning ?? null,
          d.resultingChange ?? null,
          now,
          runId,
        ),
      );

      await this.env.DB.batch([draftRow, ...decisionRows]);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'integrator persist failed';
    }
  }
}

/**
 * Build the current round's feedback section. Always emits all three
 * dimensions (Voice / Structure / Fact) marked PASS or FAIL — passing
 * sections carry an explicit PRESERVE instruction, failing sections
 * carry the violation/issue/claim detail.
 *
 * Foundation Fix Phase 4 Task 09 (2026-05-07). Pre-Task-09 behaviour
 * was three `if (!result.passed)` blocks that dropped passing audits
 * before prompt construction; the result was Claude rewriting drafts
 * without knowing which dimensions were already passing, so its fix
 * for one dimension could inadvertently re-break another. Always-three
 * sections + PRESERVE/FIX framing closes that gap.
 *
 * Pure — exported for unit testing.
 */
export function buildCurrentRoundFeedback(
  voice: VoiceAuditResult,
  structure: StructureAuditResult,
  fact: FactCheckResult,
): string {
  const sections: string[] = [];

  // Voice
  if (voice.passed) {
    sections.push(
      `## Voice — PASS (score ${voice.score}/100)\nPRESERVE this dimension. Do not introduce changes that would lower the voice score: no tribe words, no flattery, keep sentences short, keep the specific examples.`,
    );
  } else {
    const tokens = voice.failureReasons?.length
      ? ' Failure tokens: ' + voice.failureReasons.join(', ') + '.'
      : '';
    sections.push(
      `## Voice — FAIL (score ${voice.score}/100)\nFIX the violations below.${tokens}`,
    );
    voice.violations.forEach((v) => sections.push(`- VIOLATION: ${v}`));
    voice.suggestions.forEach((s) => sections.push(`- SUGGESTED FIX: ${s}`));
  }

  // Structure
  if (structure.passed) {
    sections.push(
      `## Structure — PASS\nPRESERVE the beat shape (count, hook, close, pacing). Do not introduce changes that would alter the structural skeleton.`,
    );
  } else {
    const tokens = structure.failureReasons?.length
      ? ' (failure tokens: ' + structure.failureReasons.join(', ') + ')'
      : '';
    sections.push(`## Structure — FAIL${tokens}\nFIX the issues below.`);
    structure.issues.forEach((i) => sections.push(`- ISSUE: ${i}`));
    structure.suggestions.forEach((s) => sections.push(`- SUGGESTED FIX: ${s}`));
  }

  // Fact
  if (fact.passed) {
    sections.push(
      `## Fact — PASS\nPRESERVE every factual claim and its sourcing. Do not introduce new claims or rephrase existing ones in ways that change their meaning.`,
    );
  } else {
    const tokens = fact.failureReasons?.length
      ? ' (failure tokens: ' + fact.failureReasons.join(', ') + ')'
      : '';
    sections.push(`## Fact — FAIL${tokens}\nFIX the claim issues below.`);
    fact.claims
      .filter((c) => c.status !== 'verified')
      .forEach((c) => sections.push(`- ${c.status.toUpperCase()}: "${c.claim}" — ${c.note}`));
  }

  return sections.join('\n');
}

/**
 * Build the previous-round context block. Prepended to the user
 * message when the Integrator's DO state holds a snapshot whose
 * pieceId matches the current revise() call.
 *
 * Carries the full audit results from the previous round (PASS/FAIL +
 * scores + failure tokens) so Claude can spot pass→fail flips across
 * rounds and treat them as regressions to repair rather than fresh
 * problems. Foundation Fix Phase 4 Task 09 (2026-05-07).
 *
 * Pure — exported for unit testing.
 */
export function buildPreviousRoundContext(prev: IntegratorRoundSnapshot): string {
  const voiceTokens = prev.voice.failureReasons?.length
    ? ' — tokens: ' + prev.voice.failureReasons.join(', ')
    : '';
  const structureTokens = prev.structure.failureReasons?.length
    ? ' — tokens: ' + prev.structure.failureReasons.join(', ')
    : '';
  const factTokens = prev.fact.failureReasons?.length
    ? ' — tokens: ' + prev.fact.failureReasons.join(', ')
    : '';

  return [
    `## Previous round (round ${prev.revisionRound}) audit summary`,
    `This is what the audits looked like BEFORE your previous revision. If a dimension was PASS in the previous round and is FAIL this round, that is a regression introduced by your last edit — fix the current failure WITHOUT re-breaking the now-passing dimension.`,
    '',
    `- Voice: ${prev.voice.passed ? 'PASS' : 'FAIL'} (score ${prev.voice.score}/100)${voiceTokens}`,
    `- Structure: ${prev.structure.passed ? 'PASS' : 'FAIL'}${structureTokens}`,
    `- Fact: ${prev.fact.passed ? 'PASS' : 'FAIL'}${factTokens}`,
  ].join('\n');
}

/**
 * Parse the Integrator's response envelope.
 *
 * On parse success: validate each decision against closed enums
 * (FEEDBACK_SOURCES, INTEGRATOR_DECISIONS); drop unknown rows and
 * surface a count via parseError so drift is visible without sinking
 * the publish path. revisedMdx falls back to the raw response if the
 * parsed value is missing or empty (defensive — Claude rarely returns
 * a JSON envelope with an empty MDX field, but if it does, the raw
 * response is the only thing we have).
 *
 * On parse failure: treat the raw response as the MDX (legacy behaviour
 * pre-Task-06), set decisions to [], and surface the error message via
 * parseError. The publish path is preserved.
 *
 * Pure — exported for unit testing alongside `verify-integrator-parse.mjs`.
 */
export function parseIntegratorEnvelope(
  rawText: string,
  fallbackMdx: string,
): { revisedMdx: string; decisions: IntegratorDecisionRecord[]; parseError: string | null } {
  let parsed: IntegratorRawEnvelope | null = null;
  try {
    parsed = extractJson<IntegratorRawEnvelope>(rawText);
  } catch (err) {
    // Parse-fail fallback: treat raw as MDX. Same posture as
    // InteractiveGenerator's parse-retry path (added 2026-05-05) — a
    // bad parse degrades gracefully, doesn't block the loop.
    return {
      revisedMdx: rawText.trim().length > 0 ? rawText : fallbackMdx,
      decisions: [],
      parseError: err instanceof Error ? err.message : 'integrator JSON parse failed',
    };
  }

  const revisedMdx =
    typeof parsed?.revisedMdx === 'string' && parsed.revisedMdx.trim().length > 0
      ? parsed.revisedMdx
      : (rawText.trim().length > 0 ? rawText : fallbackMdx);

  const rawDecisions = Array.isArray(parsed?.decisions) ? parsed!.decisions! : [];
  const decisions: IntegratorDecisionRecord[] = [];
  let dropped = 0;

  for (const d of rawDecisions) {
    const source = d.feedback_source;
    const verdict = d.decision;
    const summary = d.feedback_summary;

    if (
      typeof source !== 'string' ||
      typeof verdict !== 'string' ||
      typeof summary !== 'string' ||
      summary.length === 0 ||
      !FEEDBACK_SOURCES.has(source as IntegratorDecisionRecord['feedbackSource']) ||
      !INTEGRATOR_DECISIONS.has(verdict as IntegratorDecisionRecord['decision'])
    ) {
      dropped += 1;
      continue;
    }

    decisions.push({
      feedbackSource: source as IntegratorDecisionRecord['feedbackSource'],
      feedbackSummary: summary,
      decision: verdict as IntegratorDecisionRecord['decision'],
      reasoning: typeof d.reasoning === 'string' ? d.reasoning : undefined,
      resultingChange: typeof d.resulting_change === 'string' ? d.resulting_change : undefined,
    });
  }

  // Two cases populate parseError:
  //  1. Some rows survived but others were dropped (validation drift).
  //  2. Zero rows survived AND the raw envelope had decisions present
  //     (every row was malformed — strong drift signal).
  // An empty rawDecisions array on a valid parse is fine — the
  // Integrator may have legitimately addressed zero items (rare but
  // possible if the audit-revise loop fired with empty feedback).
  let parseError: string | null = null;
  if (dropped > 0) {
    parseError =
      decisions.length === 0
        ? `integrator: dropped ${dropped} of ${rawDecisions.length} decision rows (all malformed)`
        : `integrator: dropped ${dropped} of ${rawDecisions.length} decision rows (validation drift)`;
  }

  return { revisedMdx, decisions, parseError };
}
