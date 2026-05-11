import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { extractUsage } from './shared/usage';
import {
  INTERACTIVE_AUDITOR_PROMPT,
  INTERACTIVE_HTML_AUDITOR_PROMPT,
  INTERACTIVE_VOICE_MIN_SCORE,
  INTERACTIVE_HTML_STRUCTURE_MIN_SCORE,
  INTERACTIVE_HTML_ESSENCE_MIN_SCORE,
  INTERACTIVE_HTML_FACTUAL_MIN_SCORE,
  buildAuditorPrompt,
  buildHtmlAuditorPrompt,
  type AuditableQuiz,
  type AuditableHtml,
  type AuditPieceContext,
} from './interactive-auditor-prompt';

export interface InteractiveAuditDimension {
  passed: boolean;
  violations?: string[];
  issues?: string[];
  suggestions: string[];
  score?: number;
}

export interface InteractiveAuditResult {
  passed: boolean;
  voice: InteractiveAuditDimension & { score: number; violations: string[] };
  structure: InteractiveAuditDimension & { issues: string[] };
  essence: InteractiveAuditDimension & { violations: string[] };
  factual: InteractiveAuditDimension & { issues: string[] };
  /** Uncached input tokens — what response.usage.input_tokens reports.
   *  When prompt caching is in use, this is the new-input portion only;
   *  the system prompt's contribution shows up under cacheCreateTokens
   *  on the cold call and cacheReadTokens on warm calls. */
  tokensIn: number;
  tokensOut: number;
  /** Cache-write tokens — system-prompt block on the COLD call. Billed
   *  at 1.25× input rate. 0 when the cache hit. */
  cacheCreateTokens: number;
  /** Cache-read tokens — system-prompt block on every WARM call. Billed
   *  at 0.1× input rate. 0 when the cache missed. */
  cacheReadTokens: number;
  durationMs: number;
}

interface InteractiveAuditorState {
  auditsPerformed: number;
  auditsPassed: number;
  auditsFailed: number;
}

/** Safe read of an array-of-strings field from parsed JSON — defensive
 *  so a malformed auditor response can't crash the caller. */
function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** Safe boolean with default. */
function asBool(x: unknown, fallback: boolean): boolean {
  return typeof x === 'boolean' ? x : fallback;
}

/** Safe integer score clamped to [0, 100]. */
function asScore(x: unknown): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0;
  return Math.max(0, Math.min(100, n));
}

/** Discriminated input for `audit()`. The auditor dispatches on
 *  `type` to the right rubric (quiz: 4 dims, voice scored + 3 binary;
 *  html: 4 dims all scored). Result envelope is identical so the
 *  Generator's revise feedback path stays one shape. */
export type AuditableArtefact =
  | { type: 'quiz'; quiz: AuditableQuiz }
  | { type: 'html'; html: AuditableHtml };

/**
 * InteractiveAuditorAgent — 16th agent.
 *
 * Audits a generated interactive (quiz OR html) against four dimensions:
 *   1. Voice — plain English, no tribe words, no flattery (voice contract)
 *   2. Structure — quiz: plausible wrongs + teaching explanations;
 *                  html: cohesive surface + clear teaching label + stable on input
 *   3. Essence-not-reference — no proper nouns, dates, or specifics from
 *      the source piece (the PRIMARY bar that makes interactives usable
 *      standalone)
 *   4. Factual — any claims about the world are true as general statements
 *
 * Single Claude call per audit (not four). One comprehensive prompt
 * reads the whole artefact once + cites issues per dimension. Cheaper
 * and more coherent than four separate audits.
 *
 * Quiz path uses INTERACTIVE_AUDITOR_PROMPT; structure/essence/factual
 * are binary pass/fail (voice scored).
 *
 * HTML path uses INTERACTIVE_HTML_AUDITOR_PROMPT; ALL FOUR dimensions
 * are scored 0–100. Score thresholds: voice ≥${INTERACTIVE_VOICE_MIN_SCORE},
 * structure / essence / factual ≥${INTERACTIVE_HTML_STRUCTURE_MIN_SCORE} each.
 *
 * Does NOT rewrite. Returns pass/fail + per-dimension feedback. The
 * revise loop lives in InteractiveGeneratorAgent — it reads the audit
 * feedback and produces the next round.
 *
 * Fail-on-parse behaviour: if Claude returns non-JSON or the JSON is
 * malformed, Auditor throws. Generator's loop catches and treats as an
 * audit failure (round doesn't pass, but doesn't crash the run).
 *
 * Caching: HTML system prompt is large + stable, sent as a single
 * Anthropic prompt-cache block (cache_control: ephemeral). The quiz
 * prompt is smaller and currently uncached.
 */
export class InteractiveAuditorAgent extends Agent<Env, InteractiveAuditorState> {
  initialState: InteractiveAuditorState = {
    auditsPerformed: 0,
    auditsPassed: 0,
    auditsFailed: 0,
  };

  /**
   * Audit an interactive against the four dimensions. Dispatches by
   * `artefact.type` to the right rubric.
   *
   * @param artefact  Discriminated input — `{type: 'quiz', quiz}` or
   *                  `{type: 'html', html}`. Both shapes structurally
   *                  validated by the Generator before this call.
   * @param piece     Source piece context — used only for
   *                  essence-reference checks.
   */
  async audit(
    artefact: AuditableArtefact,
    piece: AuditPieceContext,
  ): Promise<InteractiveAuditResult> {
    if (artefact.type === 'quiz') {
      return this.auditQuiz(artefact.quiz, piece);
    }
    return this.auditHtml(artefact.html, piece);
  }

  /** Quiz audit path — voice scored, structure/essence/factual binary. */
  private async auditQuiz(
    quiz: AuditableQuiz,
    piece: AuditPieceContext,
  ): Promise<InteractiveAuditResult> {
    const started = Date.now();

    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2500,
      system: INTERACTIVE_AUDITOR_PROMPT,
      messages: [
        { role: 'user', content: buildAuditorPrompt(quiz, piece) },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    const usage = extractUsage(response.usage);

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson<Record<string, unknown>>(text);
    } catch {
      throw new Error('audit: Claude returned non-JSON output (quiz path)');
    }

    const voiceRaw = (parsed.voice ?? {}) as Record<string, unknown>;
    const structureRaw = (parsed.structure ?? {}) as Record<string, unknown>;
    const essenceRaw = (parsed.essence ?? {}) as Record<string, unknown>;
    const factualRaw = (parsed.factual ?? {}) as Record<string, unknown>;

    const voiceScore = asScore(voiceRaw.score);
    const voiceViolations = asStringArray(voiceRaw.violations);
    const voiceSuggestions = asStringArray(voiceRaw.suggestions);
    // Defensive pass-gate: Claude's `passed` field is trusted, but
    // clamp to the score threshold as a backstop. A claimed pass with
    // score 60 is a bug in the response — treat as fail.
    const voicePassed = asBool(voiceRaw.passed, false) && voiceScore >= INTERACTIVE_VOICE_MIN_SCORE;

    const structureIssues = asStringArray(structureRaw.issues);
    const structureSuggestions = asStringArray(structureRaw.suggestions);
    const structurePassed = asBool(structureRaw.passed, false) && structureIssues.length === 0;

    const essenceViolations = asStringArray(essenceRaw.violations);
    const essenceSuggestions = asStringArray(essenceRaw.suggestions);
    const essencePassed = asBool(essenceRaw.passed, false) && essenceViolations.length === 0;

    const factualIssues = asStringArray(factualRaw.issues);
    const factualSuggestions = asStringArray(factualRaw.suggestions);
    const factualPassed = asBool(factualRaw.passed, false) && factualIssues.length === 0;

    const passed = voicePassed && structurePassed && essencePassed && factualPassed;

    this.setState({
      auditsPerformed: this.state.auditsPerformed + 1,
      auditsPassed: this.state.auditsPassed + (passed ? 1 : 0),
      auditsFailed: this.state.auditsFailed + (passed ? 0 : 1),
    });

    return {
      passed,
      voice: {
        passed: voicePassed,
        score: voiceScore,
        violations: voiceViolations,
        suggestions: voiceSuggestions,
      },
      structure: {
        passed: structurePassed,
        issues: structureIssues,
        suggestions: structureSuggestions,
      },
      essence: {
        passed: essencePassed,
        violations: essenceViolations,
        suggestions: essenceSuggestions,
      },
      factual: {
        passed: factualPassed,
        issues: factualIssues,
        suggestions: factualSuggestions,
      },
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      cacheCreateTokens: usage.cacheCreateTokens,
      cacheReadTokens: usage.cacheReadTokens,
      durationMs: Date.now() - started,
    };
  }

  /** HTML audit path — ALL FOUR dimensions scored 0–100. Defensive
   *  pass-gates clamp Claude's `passed` against per-dimension score
   *  thresholds (a claimed pass with score 60 is a bug in the
   *  response — treat as fail). System prompt is sent as a cached
   *  block; the per-artefact user message is uncached. */
  private async auditHtml(
    html: AuditableHtml,
    piece: AuditPieceContext,
  ): Promise<InteractiveAuditResult> {
    const started = Date.now();

    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: [
        {
          type: 'text',
          text: INTERACTIVE_HTML_AUDITOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: buildHtmlAuditorPrompt(html, piece) },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    const usage = extractUsage(response.usage);

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson<Record<string, unknown>>(text);
    } catch {
      throw new Error('audit: Claude returned non-JSON output (html path)');
    }

    const voiceRaw = (parsed.voice ?? {}) as Record<string, unknown>;
    const structureRaw = (parsed.structure ?? {}) as Record<string, unknown>;
    const essenceRaw = (parsed.essence ?? {}) as Record<string, unknown>;
    const factualRaw = (parsed.factual ?? {}) as Record<string, unknown>;

    const voiceScore = asScore(voiceRaw.score);
    const voiceViolations = asStringArray(voiceRaw.violations);
    const voiceSuggestions = asStringArray(voiceRaw.suggestions);
    const voicePassed = asBool(voiceRaw.passed, false) && voiceScore >= INTERACTIVE_VOICE_MIN_SCORE;

    const structureScore = asScore(structureRaw.score);
    const structureIssues = asStringArray(structureRaw.issues);
    const structureSuggestions = asStringArray(structureRaw.suggestions);
    const structurePassed =
      asBool(structureRaw.passed, false) && structureScore >= INTERACTIVE_HTML_STRUCTURE_MIN_SCORE;

    const essenceScore = asScore(essenceRaw.score);
    const essenceViolations = asStringArray(essenceRaw.violations);
    const essenceSuggestions = asStringArray(essenceRaw.suggestions);
    const essencePassed =
      asBool(essenceRaw.passed, false) && essenceScore >= INTERACTIVE_HTML_ESSENCE_MIN_SCORE;

    const factualScore = asScore(factualRaw.score);
    const factualIssues = asStringArray(factualRaw.issues);
    const factualSuggestions = asStringArray(factualRaw.suggestions);
    const factualPassed =
      asBool(factualRaw.passed, false) && factualScore >= INTERACTIVE_HTML_FACTUAL_MIN_SCORE;

    const passed = voicePassed && structurePassed && essencePassed && factualPassed;

    this.setState({
      auditsPerformed: this.state.auditsPerformed + 1,
      auditsPassed: this.state.auditsPassed + (passed ? 1 : 0),
      auditsFailed: this.state.auditsFailed + (passed ? 0 : 1),
    });

    return {
      passed,
      voice: {
        passed: voicePassed,
        score: voiceScore,
        violations: voiceViolations,
        suggestions: voiceSuggestions,
      },
      structure: {
        passed: structurePassed,
        score: structureScore,
        issues: structureIssues,
        suggestions: structureSuggestions,
      },
      essence: {
        passed: essencePassed,
        score: essenceScore,
        violations: essenceViolations,
        suggestions: essenceSuggestions,
      },
      factual: {
        passed: factualPassed,
        score: factualScore,
        issues: factualIssues,
        suggestions: factualSuggestions,
      },
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      cacheCreateTokens: usage.cacheCreateTokens,
      cacheReadTokens: usage.cacheReadTokens,
      durationMs: Date.now() - started,
    };
  }
}
