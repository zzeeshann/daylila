import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { getAdminSetting } from './shared/admin-settings';
import { extractUsage } from './shared/usage';
import { PublisherAgent } from './publisher';
import { InteractiveAuditorAgent, type InteractiveAuditResult } from './interactive-auditor';
import {
  INTERACTIVE_GENERATOR_PROMPT,
  INTERACTIVE_HTML_GENERATOR_PROMPT,
  GENERATOR_BODY_EXCERPT_MAX_CHARS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_MAX_QUESTIONS,
  buildInteractivePrompt,
  buildRevisionPrompt,
  buildJsonRepairPrompt,
  buildHtmlInteractivePrompt,
  buildHtmlRevisionPrompt,
  buildHtmlJsonRepairPrompt,
  type PieceContextForQuiz,
  type PieceContextForInteractive,
  type RecentInteractive,
  type CategoryRow,
  type RevisionFeedback,
  type RevisionPreviousHtml,
  type RevisionValidatorViolation,
} from './interactive-generator-prompt';
import { validate as validateHtml } from './interactive-validator';
import { MAX_AUDIT_ROUNDS as INTERACTIVE_MAX_ROUNDS } from './shared/audit-thresholds';

/** Number of recently-published interactives to show Claude for the
 *  diversity nudge. */
const RECENT_INTERACTIVES_FOR_DIVERSITY = 10;

/** Max attempts at suffixing a colliding slug (`-2`, `-3`, …). */
const SLUG_COLLISION_MAX_ATTEMPTS = 5;

// Max revision rounds (1 initial + 2 revisions) — single-source in
// `./shared/audit-thresholds.ts`, applied to both quiz and HTML
// loops. Same value as the daily-piece auditor loop, per the audit
// contract at `content/audit-contract.md`.

function stripForExcerpt(mdx: string): string {
  let body = mdx.replace(/^---\n[\s\S]*?\n---\n?/, '');
  body = body.replace(/<[^>]+>/g, '');
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body.slice(0, GENERATOR_BODY_EXCERPT_MAX_CHARS);
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface RawQuestion {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
}
interface RawQuiz {
  slug?: unknown;
  title?: unknown;
  concept?: unknown;
  questions?: unknown;
}

interface ValidatedQuiz {
  slug: string;
  title: string;
  concept: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

interface ValidatedHtml {
  slug: string;
  title: string;
  concept: string;
  html: string;
}

/** Brief audit summary suitable for observer logging (plain Claude-free
 *  strings). */
export interface FinalAuditSummary {
  voicePassed: boolean;
  voiceScore: number;
  structurePassed: boolean;
  essencePassed: boolean;
  factualPassed: boolean;
  topIssues: string[]; // first ~5 issues across dimensions for the feed
}

/** Quiz artefact terminal-state shape returned by `runQuizLoop`. */
export interface QuizArtefactResult {
  ran: boolean;                // false when caller short-circuited (existing row)
  skipped: boolean;            // true when caller short-circuited (existing row)
  declined: boolean;           // true when Claude returned the empty shape
  committed: boolean;          // true when file + D1 writes landed
  auditorMaxFailed: boolean;   // true when ALL rounds failed audit — shipped
                               // as quality_flag='low' alongside committed=true
  qualityFlag: 'low' | null;
  interactiveId: string | null;
  slug: string | null;
  title: string | null;
  concept: string | null;
  questionCount: number;
  revisionCount: number;       // 0 = passed first round, 1 = passed round 2, …
  roundsUsed: number;          // total rounds executed (1, 2, or 3)
  voiceScore: number | null;
  finalAudit: FinalAuditSummary | null;
  /** Rounds that threw `'Claude returned non-JSON output'` and were
   *  caught + counted as failed rounds (2026-04-30 hardening). Director
   *  emits one info-severity `logInteractiveGeneratorParseFail` event
   *  per entry. Empty array on the happy path.
   *
   *  `head` (2026-05-03 diagnostic) carries the inner parseAndValidate
   *  error message, including the `(len=N, head="...")` substring with
   *  the first 200 chars of what Claude returned instead of JSON. The
   *  loop also concatenates these into the all-rounds-failed throw
   *  message so the data survives QUIZ_FAIL_STUB's defaults. */
  parseFailures: Array<{ round: number; head?: string }>;
  /** Set when `runQuizLoop` threw and `generate()` caught it (rather
   *  than letting the throw bubble out and abort the whole interactive
   *  generation). Pre-2026-04-30 PM: a quiz throw exited generate()
   *  before the HTML path ran, so a quiz parse-fail also lost HTML.
   *  Now the throw is captured here, generate() continues to HTML, and
   *  Director emits `logInteractiveGeneratorFailure` for the quiz. */
  errorMessage: string | null;
  /** Aggregated token totals across every Claude call in this loop —
   *  produce + revise + audit. Cache fields land in observer events
   *  too; powers Phase 3.4 cost telemetry. See `shared/usage.ts`. */
  tokensIn: number;
  tokensOut: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

/** HTML interactive terminal-state shape returned by `runHtmlLoop`.
 *  Two failure modes that don't apply to quiz:
 *    - validatorMaxFailed: 3 rounds of validator failures, no commit.
 *      Validator catches structural problems (sandbox-violators, size,
 *      dynamic-code, etc.) — shipping a validator-failed file means
 *      the iframe SecurityErrors at runtime, so we treat it as a hard
 *      decline rather than ship-as-low.
 *    - auditorMaxFailed: 2.4 wires real audit; in 2.3 always false.
 *      When live, mirrors quiz path's ship-as-low (quality_flag='low'). */
export interface HtmlArtefactResult {
  ran: boolean;
  skipped: boolean;
  declined: boolean;
  committed: boolean;
  validatorMaxFailed: boolean; // 3 rounds of validator fails → no commit
  auditorMaxFailed: boolean;   // 3 rounds of audit fails → ship-as-low (Phase 2.4)
  qualityFlag: 'low' | null;
  interactiveId: string | null;
  slug: string | null;
  title: string | null;
  concept: string | null;
  htmlByteLength: number;
  revisionCount: number;
  roundsUsed: number;
  voiceScore: number | null;        // null in 2.3 (auditor not yet wired)
  finalAudit: FinalAuditSummary | null; // null in 2.3
  /** Same shape as QuizArtefactResult.parseFailures. `head` carries
   *  the inner parseAndValidateHtml error text per the 2026-05-03
   *  diagnostic. */
  parseFailures: Array<{ round: number; head?: string }>;
  /** See QuizArtefactResult.errorMessage. */
  errorMessage: string | null;
  /** Aggregated token totals — see QuizArtefactResult comment. */
  tokensIn: number;
  tokensOut: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

/** Result surfaced back to Director. The two artefact results are
 *  independent — quiz can succeed while HTML declines, or vice versa.
 *  `html` is null when the `interactives_html_enabled` flag is false. */
export interface InteractiveGeneratorResult {
  pieceId: string;
  date: string;
  htmlEnabled: boolean;
  quiz: QuizArtefactResult;
  html: HtmlArtefactResult | null;
  durationMs: number;
}

interface InteractiveGeneratorState {
  interactivesGenerated: number;
  interactivesDeclined: number;
  interactivesAuditorMaxFailed: number;
  htmlInteractivesGenerated: number;
  htmlInteractivesDeclined: number;
  htmlInteractivesValidatorMaxFailed: number;
  htmlInteractivesAuditorMaxFailed: number;
}

/**
 * InteractiveGeneratorAgent — 15th agent.
 *
 * Produces a standalone-teaching multiple-choice quiz for a just-
 * published daily piece. The quiz teaches the UNDERLYING CONCEPT —
 * it does not reference the piece. A stranger landing on the quiz's
 * URL should find it useful without having read the piece.
 *
 * Generator owns the produce → audit → revise loop (4.5). Up to 3
 * rounds, matching the daily-piece auditor pattern. Auditor is an
 * internal sub-agent — Director's alarm just calls `generate()` and
 * gets back a terminal result.
 *
 * Loop:
 *   round 1: produce initial quiz → structural validate → audit
 *   round 2..3 (only if prior round failed): revise with audit feedback
 *   → structural validate → audit
 *
 * Terminal states:
 *   - `skipped`       daily_pieces.interactive_id already set
 *   - `declined`      Claude returned the empty shape (first round or
 *                     any revision round — concept-too-redundant)
 *   - `committed (clean)`  a round passed all four audit dimensions;
 *                     file + D1 rows written with quality_flag=NULL.
 *                     Result shape: {committed: true, auditorMaxFailed:
 *                     false, qualityFlag: null}.
 *   - `committed (low)`  3 rounds exhausted without passing audit;
 *                     the LAST attempt is still shipped with
 *                     quality_flag='low'. File + D1 rows written;
 *                     last-beat prompt surfaces it; admin UI marks
 *                     it FLAGGED LOW. Result shape: {committed: true,
 *                     auditorMaxFailed: true, qualityFlag: 'low'}.
 *                     See DECISIONS 2026-04-24 "Loosen essence rule
 *                     + ship-as-low on max-fail" — this reverses
 *                     4.5's abandon-not-low decision.
 *
 * Why ship-as-low (2026-04-24 reversal of 4.5's abandon posture):
 *   - 4.5 abandoned on max-fail because "no mostly-fine salvage from a
 *     max-failed round" — but the real-world 2026-04-24 FISA piece ran
 *     showed max-fails were caused by the auditor's over-strict
 *     interpretation of "pattern-match to details" (catching concept
 *     echoes and structural analogies, not concrete detail leaks).
 *   - The paired essence-rule loosening makes genuine max-fails rare;
 *     when they do happen, a 3-rounds-refined quiz is still a better
 *     reader artefact than a 404. "It can't be that bad after 3 tries"
 *     (user, 2026-04-24).
 *   - Permanence rule still respected — quality_flag='low' is the same
 *     mechanism daily_pieces use for sub-85 voice score; readers see a
 *     "Rough" tier tag, admin sees "FLAGGED LOW", operator can retry.
 *
 * Does NOT touch the published piece's content. Does NOT orchestrate.
 * Fail-silent posture: throws on infrastructure failure (Claude down,
 * DB error, GitHub 5xx). Director's alarm catches + routes to
 * observer.logInteractiveGeneratorFailure. Auditor rejection is NOT
 * an infrastructure failure — it's an expected path that returns a
 * structured result with `auditorMaxFailed: true`.
 */
export class InteractiveGeneratorAgent extends Agent<Env, InteractiveGeneratorState> {
  initialState: InteractiveGeneratorState = {
    interactivesGenerated: 0,
    interactivesDeclined: 0,
    interactivesAuditorMaxFailed: 0,
    htmlInteractivesGenerated: 0,
    htmlInteractivesDeclined: 0,
    htmlInteractivesValidatorMaxFailed: 0,
    htmlInteractivesAuditorMaxFailed: 0,
  };

  async generate(
    pieceId: string,
    date: string,
    mdx: string,
  ): Promise<InteractiveGeneratorResult> {
    const started = Date.now();

    // ── 1. Read piece + per-type idempotence + flag ──────────────
    //
    // Per-type idempotence (Phase 2): a piece can have a quiz row
    // AND/OR an html row. We check each independently so a retry
    // can fill in just the missing artefact. The legacy
    // `daily_pieces.interactive_id` pointer is still maintained by
    // the quiz commit path for back-compat with the shipped reader
    // surface (sub-task 4.6 last-beat prompt) but is no longer the
    // gate.
    const [piece, existingQuiz, existingHtml, htmlEnabled] = await Promise.all([
      this.env.DB
        .prepare(
          `SELECT headline, underlying_subject, interactive_id
           FROM daily_pieces WHERE id = ? LIMIT 1`,
        )
        .bind(pieceId)
        .first<{
          headline: string;
          underlying_subject: string | null;
          interactive_id: string | null;
        }>(),
      this.env.DB
        .prepare(
          `SELECT id FROM interactives
           WHERE source_piece_id = ? AND type = 'quiz' LIMIT 1`,
        )
        .bind(pieceId)
        .first<{ id: string }>(),
      this.env.DB
        .prepare(
          `SELECT id FROM interactives
           WHERE source_piece_id = ? AND type = 'html' LIMIT 1`,
        )
        .bind(pieceId)
        .first<{ id: string }>(),
      getAdminSetting(
        this.env.DB,
        'interactives_html_enabled',
        (raw) => raw === 'true',
        false,
      ),
    ]);

    if (!piece) {
      throw new Error(`generate: no daily_pieces row for id ${pieceId}`);
    }

    const willRunQuiz = !existingQuiz;
    const willRunHtml = htmlEnabled && !existingHtml;

    // ── 2. Build shared context (only when at least one path runs) ─
    let pieceContext: PieceContextForInteractive | null = null;
    let recent: RecentInteractive[] = [];

    if (willRunQuiz || willRunHtml) {
      const catsRes = await this.env.DB
        .prepare(
          `SELECT c.name, c.slug
           FROM piece_categories pc
           JOIN categories c ON c.id = pc.category_id
           WHERE pc.piece_id = ?`,
        )
        .bind(pieceId)
        .all<{ name: string; slug: string }>();
      const categories: CategoryRow[] = catsRes.results.map((r) => ({
        name: r.name,
        slug: r.slug,
      }));

      // Recent excludes THIS piece's own siblings — when retrying for
      // HTML on a piece that already has a quiz, the quiz shouldn't
      // appear on the diversity list (the sibling SHOULD teach the
      // same concept, since both teach the piece's underlying concept).
      const recentRes = await this.env.DB
        .prepare(
          `SELECT slug, title, concept
           FROM interactives
           WHERE published_at IS NOT NULL AND source_piece_id != ?
           ORDER BY published_at DESC
           LIMIT ?`,
        )
        .bind(pieceId, RECENT_INTERACTIVES_FOR_DIVERSITY)
        .all<{ slug: string; title: string; concept: string | null }>();
      recent = recentRes.results.map((r) => ({
        slug: r.slug,
        title: r.title,
        concept: r.concept,
      }));

      pieceContext = {
        headline: piece.headline,
        underlyingSubject: piece.underlying_subject,
        bodyExcerpt: stripForExcerpt(mdx),
        categories,
      };
    }

    // ── 3. Quiz path ─────────────────────────────────────────────
    //
    // 2026-04-30 PM — quiz path failures (3-round parse-fail
    // exhaustion or infra throws) are caught here so the HTML path
    // still runs. Pre-fix: a quiz throw exited generate() before
    // HTML, losing HTML for any piece whose quiz hit a transient.
    // The captured errorMessage propagates back to Director, which
    // emits logInteractiveGeneratorFailure alongside the metered
    // event so operators see the per-artefact terminal state.
    const QUIZ_FAIL_STUB = (errorMessage: string): QuizArtefactResult => ({
      ran: true,
      skipped: false,
      declined: false,
      committed: false,
      auditorMaxFailed: false,
      qualityFlag: null,
      interactiveId: null,
      slug: null,
      title: null,
      concept: null,
      questionCount: 0,
      revisionCount: 0,
      roundsUsed: 0,
      voiceScore: null,
      finalAudit: null,
      parseFailures: [],
      errorMessage,
      tokensIn: 0,
      tokensOut: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      durationMs: 0,
    });

    let quizResult: QuizArtefactResult;
    if (willRunQuiz && pieceContext) {
      try {
        quizResult = await this.runQuizLoop(
          pieceId,
          pieceContext,
          recent,
          piece.headline,
          piece.underlying_subject,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        quizResult = QUIZ_FAIL_STUB(reason);
      }
    } else {
      // Skipped: piece already has a quiz row (or no context built).
      quizResult = {
        ran: false,
        skipped: true,
        declined: false,
        committed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: existingQuiz?.id ?? piece.interactive_id ?? null,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        revisionCount: 0,
        roundsUsed: 0,
        voiceScore: null,
        finalAudit: null,
        parseFailures: [],
        errorMessage: null,
        tokensIn: 0,
        tokensOut: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        durationMs: 0,
      };
    }

    // ── 4. HTML path (gated by flag) ─────────────────────────────
    //
    // Same try/catch posture as the quiz path so an HTML throw
    // doesn't poison the metered observer write or hide quiz state.
    const HTML_FAIL_STUB = (errorMessage: string): HtmlArtefactResult => ({
      ran: true,
      skipped: false,
      declined: false,
      committed: false,
      validatorMaxFailed: false,
      auditorMaxFailed: false,
      qualityFlag: null,
      interactiveId: null,
      slug: null,
      title: null,
      concept: null,
      htmlByteLength: 0,
      revisionCount: 0,
      roundsUsed: 0,
      voiceScore: null,
      finalAudit: null,
      parseFailures: [],
      errorMessage,
      tokensIn: 0,
      tokensOut: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      durationMs: 0,
    });

    let htmlResult: HtmlArtefactResult | null = null;
    if (willRunHtml && pieceContext) {
      try {
        htmlResult = await this.runHtmlLoop(pieceId, pieceContext, recent);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        htmlResult = HTML_FAIL_STUB(reason);
      }
    } else if (existingHtml) {
      // Skipped: piece already has an html row.
      htmlResult = {
        ran: false,
        skipped: true,
        declined: false,
        committed: false,
        validatorMaxFailed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: existingHtml.id,
        slug: null,
        title: null,
        concept: null,
        htmlByteLength: 0,
        revisionCount: 0,
        roundsUsed: 0,
        voiceScore: null,
        finalAudit: null,
        parseFailures: [],
        errorMessage: null,
        tokensIn: 0,
        tokensOut: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        durationMs: 0,
      };
    }
    // else: htmlResult stays null (flag off)

    return {
      pieceId,
      date,
      htmlEnabled,
      quiz: quizResult,
      html: htmlResult,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Quiz produce → audit → revise loop. Pre-allocates an
   * `interactiveId`, runs up to 3 rounds, commits the file + D1 row
   * on the passing round (or ships-as-low on auditor max-fail).
   * Updates `daily_pieces.interactive_id` for back-compat with the
   * 4.6 last-beat prompt surface.
   */
  private async runQuizLoop(
    pieceId: string,
    pieceContext: PieceContextForInteractive,
    recent: RecentInteractive[],
    pieceHeadline: string,
    pieceUnderlyingSubject: string | null,
  ): Promise<QuizArtefactResult> {
    const started = Date.now();
    const interactiveId = crypto.randomUUID();

    const auditor = await this.subAgent(
      InteractiveAuditorAgent,
      `interactive-auditor-${pieceId}`,
    );

    let cumulativeTokensIn = 0;
    let cumulativeTokensOut = 0;
    let cumulativeCacheCreate = 0;
    let cumulativeCacheRead = 0;
    let lastQuiz: ValidatedQuiz | null = null;
    let lastAudit: InteractiveAuditResult | null = null;
    // 2026-05-05 — when a round parse-fails, this carries the broken-
    // output head into the NEXT round's repairQuiz call so Claude sees
    // its previous attempt was malformed JSON. Cleared on any successful
    // parse so audit-feedback revisions take priority on the round after.
    let lastParseFailHead: string | null = null;
    let passed = false;
    let declinedInLoop = false;
    let roundsUsed = 0;
    // Rounds that returned non-JSON output. Caught inside the loop and
    // re-attempted within the 3-round budget; surfaces as info-severity
    // breadcrumbs through the Director's metered observer write path.
    const parseFailures: Array<{ round: number; head?: string }> = [];

    for (let round = 1; round <= INTERACTIVE_MAX_ROUNDS; round += 1) {
      roundsUsed = round;

      let produced: ValidatedQuiz | null;
      let tokensIn = 0;
      let tokensOut = 0;
      let cacheCreate = 0;
      let cacheRead = 0;

      try {
        // Three branches in priority order:
        //   - prior round parse-failed → repairQuiz with the broken head
        //   - round 1 / no prior parsed quiz / no prior audit → initial produce
        //   - prior round parsed but failed audit → reviseQuiz with feedback
        // The repair branch takes priority over revise because parse-fail
        // is a JSON-validity issue, not a content issue — there's no
        // audited object to revise from.
        if (lastParseFailHead) {
          const res = await this.repairQuiz(
            lastParseFailHead,
            pieceContext,
            recent,
            round,
          );
          produced = res.quiz;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        } else if (round === 1 || !lastQuiz || !lastAudit) {
          const res = await this.produceQuiz(pieceContext, recent);
          produced = res.quiz;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        } else {
          const res = await this.reviseQuiz(
            lastQuiz,
            lastAudit,
            pieceContext,
            recent,
            round,
          );
          produced = res.quiz;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        }
        // Reaching here means parseAndValidate succeeded — clear the
        // repair flag so the next round picks the right branch
        // (revise-with-feedback if audit fails below, or break out if
        // it passes).
        lastParseFailHead = null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.startsWith('parseAndValidate: Claude returned non-JSON output')) {
          // Loop-counted retry: treat parse-fail as a consumed round
          // and continue. The next round will route through repairQuiz
          // (lastParseFailHead is now populated) instead of re-running
          // the initial prompt blind. If all 3 rounds parse-fail, the
          // loop falls through to the !lastQuiz commit-path guard and
          // the throw surfaces to Director (operator-retry case). Other
          // errors (validator-shape, infra) stay fatal.
          //
          // 2026-05-03 diagnostic: preserve the per-round head text
          // (the `(len=N, head="...")` substring from parseAndValidate's
          // throw) so the all-rounds-failed throw below can include them.
          // Without this, generate()'s catch wraps with QUIZ_FAIL_STUB
          // (zero tokens, empty parseFailures) and the operator-facing
          // observer event only shows the outer summary.
          parseFailures.push({ round, head: msg });
          lastParseFailHead = msg;
          continue;
        }
        throw err;
      }

      cumulativeTokensIn += tokensIn;
      cumulativeTokensOut += tokensOut;
      cumulativeCacheCreate += cacheCreate;
      cumulativeCacheRead += cacheRead;

      if (!produced) {
        declinedInLoop = true;
        break;
      }

      lastQuiz = produced;

      const audit = await auditor.audit(
        {
          type: 'quiz',
          quiz: {
            slug: produced.slug,
            title: produced.title,
            concept: produced.concept,
            questions: produced.questions,
          },
        },
        {
          headline: pieceHeadline,
          underlyingSubject: pieceUnderlyingSubject,
          bodyExcerpt: pieceContext.bodyExcerpt,
        },
      );
      lastAudit = audit;
      cumulativeTokensIn += audit.tokensIn;
      cumulativeTokensOut += audit.tokensOut;
      cumulativeCacheCreate += audit.cacheCreateTokens;
      cumulativeCacheRead += audit.cacheReadTokens;

      try {
        await this.persistAuditRows(interactiveId, round, audit);
      } catch (e) {
        console.error(
          `interactive-generator: failed to persist audit rows for ${interactiveId} round ${round}`,
          e,
        );
      }

      if (audit.passed) {
        passed = true;
        break;
      }
    }

    if (declinedInLoop) {
      this.setState({
        ...this.state,
        interactivesDeclined: this.state.interactivesDeclined + 1,
      });
      return {
        ran: true,
        skipped: false,
        declined: true,
        committed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: null,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        revisionCount: Math.max(0, roundsUsed - 1),
        roundsUsed,
        voiceScore: lastAudit?.voice.score ?? null,
        finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
        parseFailures,
        errorMessage: null,
        tokensIn: cumulativeTokensIn,
        tokensOut: cumulativeTokensOut,
        cacheCreateTokens: cumulativeCacheCreate,
        cacheReadTokens: cumulativeCacheRead,
        durationMs: Date.now() - started,
      };
    }

    if (!lastQuiz) {
      // 3-round parse-fail exhaustion — same operator-retry posture as
      // the pre-2026-04-30 single-strike fatal, just earned across the
      // full budget. Director catches and routes to logInteractiveGeneratorFailure.
      if (parseFailures.length === roundsUsed) {
        // 2026-05-03 — surface per-round heads through the throw message
        // so generate()'s catch + QUIZ_FAIL_STUB wrap propagates them
        // to the observer event. Heads separated by ` || ` for cheap
        // admin-side parsing.
        const heads = parseFailures
          .map((p) => `R${p.round}: ${p.head ?? '(no head)'}`)
          .join(' || ');
        throw new Error(
          `parseAndValidate: Claude returned non-JSON output across all ${roundsUsed} rounds. ${heads}`,
        );
      }
      throw new Error('runQuizLoop: commit path reached without a lastQuiz');
    }
    const qualityFlag: 'low' | null = passed ? null : 'low';
    const auditorMaxFailed = !passed;

    const finalSlug = await this.resolvePairSlug(pieceId, 'quiz', lastQuiz.slug);
    lastQuiz.slug = finalSlug;

    const publishedAt = Date.now();
    const fileContent = JSON.stringify(
      {
        slug: lastQuiz.slug,
        type: 'quiz',
        title: lastQuiz.title,
        concept: lastQuiz.concept,
        interactiveId,
        sourcePieceId: pieceId,
        publishedAt,
        voiceScore: lastAudit?.voice.score ?? undefined,
        ...(qualityFlag === 'low' ? { qualityFlag: 'low' } : {}),
        content: {
          type: 'quiz',
          questions: lastQuiz.questions,
        },
      },
      null,
      2,
    ) + '\n';

    const filePath = `content/interactives/${lastQuiz.slug}.json`;

    const publisher = await this.subAgent(
      PublisherAgent,
      `interactive-publisher-${lastQuiz.slug}`,
    );
    const commitMsg = qualityFlag === 'low'
      ? `feat(interactives): ${lastQuiz.title} (${lastQuiz.slug}) [flagged low]`
      : `feat(interactives): ${lastQuiz.title} (${lastQuiz.slug})`;
    await publisher.publishToPath(filePath, fileContent, commitMsg);

    const voiceScore = lastAudit?.voice.score ?? null;
    const revisionCount = roundsUsed - 1;

    await this.env.DB
      .prepare(
        `INSERT INTO interactives
         (id, slug, type, title, concept, source_piece_id, content_json,
          voice_score, quality_flag, revision_count, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        interactiveId,
        lastQuiz.slug,
        'quiz',
        lastQuiz.title,
        lastQuiz.concept,
        pieceId,
        voiceScore,
        qualityFlag,
        revisionCount,
        publishedAt,
        publishedAt,
      )
      .run();

    await this.env.DB
      .prepare(`UPDATE daily_pieces SET interactive_id = ? WHERE id = ?`)
      .bind(interactiveId, pieceId)
      .run();

    this.setState({
      ...this.state,
      interactivesGenerated: this.state.interactivesGenerated + 1,
      interactivesAuditorMaxFailed:
        this.state.interactivesAuditorMaxFailed + (auditorMaxFailed ? 1 : 0),
    });

    return {
      ran: true,
      skipped: false,
      declined: false,
      committed: true,
      auditorMaxFailed,
      qualityFlag,
      interactiveId,
      slug: lastQuiz.slug,
      title: lastQuiz.title,
      concept: lastQuiz.concept,
      questionCount: lastQuiz.questions.length,
      revisionCount,
      roundsUsed,
      voiceScore,
      finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
      parseFailures,
      errorMessage: null,
      tokensIn: cumulativeTokensIn,
      tokensOut: cumulativeTokensOut,
      cacheCreateTokens: cumulativeCacheCreate,
      cacheReadTokens: cumulativeCacheRead,
      durationMs: Date.now() - started,
    };
  }

  /**
   * HTML interactive produce → validate → (TODO 2.4: audit) → revise
   * loop. Mirrors the quiz loop's three-round structure but with two
   * differences:
   *   - Validator runs as a HARD gate before any audit. Failure on
   *     all 3 rounds → no commit (validatorMaxFailed). Validator
   *     catches sandbox-violators (eval, fetch, localStorage etc.)
   *     that would SecurityError at runtime; shipping such a file
   *     would mean a broken interactive on the page.
   *   - Auditor call is NOT yet wired (sub-task 2.4 lands it).
   *     Currently any validator-pass → commit. 2.4 will add an
   *     audit call after validate, with ship-as-low on auditor
   *     max-fail mirroring the quiz path.
   *
   * Commits the HTML file at content/interactives/<slug>.html.
   * Writes an `interactives` row with type='html'. Does NOT update
   * `daily_pieces.interactive_id` — that pointer stays on the quiz
   * row for back-compat with the 4.6 last-beat prompt; readers find
   * the HTML via `interactives WHERE source_piece_id = ?`.
   *
   * Slug pairing is symmetric (see `resolvePairSlug`): whichever
   * artefact ships second inherits the first's slug, regardless of
   * order. So this loop ALSO inherits a quiz's slug if the quiz row
   * already exists, and `runQuizLoop` symmetrically inherits this
   * loop's slug when html shipped first.
   */
  private async runHtmlLoop(
    pieceId: string,
    pieceContext: PieceContextForInteractive,
    recent: RecentInteractive[],
  ): Promise<HtmlArtefactResult> {
    const started = Date.now();
    const interactiveId = crypto.randomUUID();

    let cumulativeTokensIn = 0;
    let cumulativeTokensOut = 0;
    let cumulativeCacheCreate = 0;
    let cumulativeCacheRead = 0;
    let lastHtml: ValidatedHtml | null = null;
    let lastValidatorViolations: RevisionValidatorViolation[] = [];
    let lastAudit: InteractiveAuditResult | null = null;
    let validatorPassed = false;
    let auditPassed = false;
    // 2026-05-05 — see runQuizLoop. Carries the broken-output head into
    // the next round's repairHtml call when parseAndValidateHtml threw.
    let lastParseFailHead: string | null = null;
    let declinedInLoop = false;
    let roundsUsed = 0;
    // See runQuizLoop.parseFailures. Same shape, same posture.
    const parseFailures: Array<{ round: number; head?: string }> = [];

    const auditor = await this.subAgent(
      InteractiveAuditorAgent,
      `interactive-auditor-html-${pieceId}`,
    );

    for (let round = 1; round <= INTERACTIVE_MAX_ROUNDS; round += 1) {
      roundsUsed = round;

      let produced: ValidatedHtml | null;
      let tokensIn = 0;
      let tokensOut = 0;
      let cacheCreate = 0;
      let cacheRead = 0;

      try {
        // Three branches in priority order — see runQuizLoop's matching
        // comment. Repair takes priority over revise because parse-fail
        // is a JSON-validity issue, not a content/validator issue.
        if (lastParseFailHead) {
          const res = await this.repairHtml(
            lastParseFailHead,
            pieceContext,
            recent,
            round,
          );
          produced = res.html;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        } else if (round === 1 || !lastHtml) {
          const res = await this.produceHtml(pieceContext, recent);
          produced = res.html;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        } else {
          // Build audit feedback for the revision prompt — only when the
          // PRIOR round's failure was at the audit gate (validator passed
          // but auditor rejected). When the prior round failed validator,
          // lastAudit stays null and the revision is validator-feedback-only.
          const auditFeedback: RevisionFeedback | null =
            lastAudit && validatorPassed
              ? buildAuditFeedback(lastAudit)
              : null;
          const res = await this.reviseHtml(
            lastHtml,
            lastValidatorViolations,
            auditFeedback,
            pieceContext,
            recent,
            round,
          );
          produced = res.html;
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          cacheCreate = res.cacheCreateTokens;
          cacheRead = res.cacheReadTokens;
        }
        // Reaching here means parseAndValidateHtml succeeded — clear
        // the repair flag (validator/audit gates run below).
        lastParseFailHead = null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.startsWith('parseAndValidateHtml: Claude returned non-JSON output')) {
          // 2026-05-03 diagnostic — see runQuizLoop's matching catch.
          // 2026-05-05 repair — populate lastParseFailHead so the next
          // round routes through repairHtml with the broken head.
          parseFailures.push({ round, head: msg });
          lastParseFailHead = msg;
          continue;
        }
        throw err;
      }

      cumulativeTokensIn += tokensIn;
      cumulativeTokensOut += tokensOut;
      cumulativeCacheCreate += cacheCreate;
      cumulativeCacheRead += cacheRead;

      if (!produced) {
        declinedInLoop = true;
        break;
      }

      lastHtml = produced;

      // ── Validator gate ──
      const validation = validateHtml(produced.html);
      if (!validation.passed) {
        // Validator failed → revise with violations next round (if any).
        // Reset validator state so the audit-feedback path is skipped on
        // the next iteration.
        lastValidatorViolations = validation.violations.map((v) => ({
          rule: v.rule,
          message: v.message,
          snippet: v.snippet,
        }));
        validatorPassed = false;
        lastAudit = null;
        continue;
      }

      // Validator passed.
      validatorPassed = true;
      lastValidatorViolations = [];

      // ── Auditor gate (sub-task 2.4) ──
      const audit = await auditor.audit(
        {
          type: 'html',
          html: {
            slug: produced.slug,
            title: produced.title,
            concept: produced.concept,
            html: produced.html,
          },
        },
        {
          headline: pieceContext.headline,
          underlyingSubject: pieceContext.underlyingSubject,
          bodyExcerpt: pieceContext.bodyExcerpt,
        },
      );
      lastAudit = audit;
      cumulativeTokensIn += audit.tokensIn;
      cumulativeTokensOut += audit.tokensOut;
      cumulativeCacheCreate += audit.cacheCreateTokens;
      cumulativeCacheRead += audit.cacheReadTokens;

      // Persist 4 rows (one per dimension) keyed to the pre-allocated
      // interactiveId + this round. Best-effort — a write failure here
      // must NOT abort the loop; the auditor's verdict drives commit
      // regardless of forensic persistence.
      try {
        await this.persistAuditRows(interactiveId, round, audit);
      } catch (e) {
        console.error(
          `interactive-generator: failed to persist html audit rows for ${interactiveId} round ${round}`,
          e,
        );
      }

      if (audit.passed) {
        auditPassed = true;
        break;
      }
      // Audit failed — revise with audit feedback on next round (if any).
      // Otherwise fall through to ship-as-low terminal.
    }

    // ── Terminal handling ────────────────────────────────────────
    if (declinedInLoop) {
      this.setState({
        ...this.state,
        htmlInteractivesDeclined: this.state.htmlInteractivesDeclined + 1,
      });
      return {
        ran: true,
        skipped: false,
        declined: true,
        committed: false,
        validatorMaxFailed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: null,
        slug: null,
        title: null,
        concept: null,
        htmlByteLength: 0,
        revisionCount: Math.max(0, roundsUsed - 1),
        roundsUsed,
        voiceScore: lastAudit?.voice.score ?? null,
        finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
        parseFailures,
        errorMessage: null,
        tokensIn: cumulativeTokensIn,
        tokensOut: cumulativeTokensOut,
        cacheCreateTokens: cumulativeCacheCreate,
        cacheReadTokens: cumulativeCacheRead,
        durationMs: Date.now() - started,
      };
    }

    // 3-round parse-fail exhaustion — throw so Director routes it to
    // logInteractiveGeneratorFailure (operator-retry posture). Same
    // shape as the quiz path's lastQuiz-null exhaustion guard. Sits
    // before the validator-max-failed branch because parse-fails
    // DON'T reach the validator — surfacing them as validator failures
    // would mislead operators about the cause.
    if (!lastHtml && parseFailures.length === roundsUsed) {
      // 2026-05-03 — see runQuizLoop for the heads-in-throw rationale.
      const heads = parseFailures
        .map((p) => `R${p.round}: ${p.head ?? '(no head)'}`)
        .join(' || ');
      throw new Error(
        `parseAndValidateHtml: Claude returned non-JSON output across all ${roundsUsed} rounds. ${heads}`,
      );
    }

    if (!validatorPassed || !lastHtml) {
      // 3 rounds of validator failures, no commit. Distinct from
      // declined — Claude tried but kept producing structurally
      // unsound files. Operator inspects per-round audit rows (none
      // were written — auditor never ran) and observer feed for the
      // validator violation list.
      this.setState({
        ...this.state,
        htmlInteractivesValidatorMaxFailed:
          this.state.htmlInteractivesValidatorMaxFailed + 1,
      });
      return {
        ran: true,
        skipped: false,
        declined: false,
        committed: false,
        validatorMaxFailed: true,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: null,
        slug: null,
        title: null,
        concept: null,
        htmlByteLength: lastHtml ? new TextEncoder().encode(lastHtml.html).length : 0,
        revisionCount: Math.max(0, roundsUsed - 1),
        roundsUsed,
        voiceScore: null,
        finalAudit: null,
        parseFailures,
        errorMessage: null,
        tokensIn: cumulativeTokensIn,
        tokensOut: cumulativeTokensOut,
        cacheCreateTokens: cumulativeCacheCreate,
        cacheReadTokens: cumulativeCacheRead,
        durationMs: Date.now() - started,
      };
    }

    // ── Commit path — passed cleanly OR shipped-as-low ───────────
    //
    // Validator passed at some round. If audit also passed → commit
    // with quality_flag=null. If audit max-failed across all rounds
    // that reached the audit gate → ship the LAST validator-passing
    // attempt with quality_flag='low' (mirrors quiz path's 2026-04-24
    // ship-as-low reversal of abandon-on-max-fail). The newspaper-
    // never-skips rule applies: a 3-rounds-refined HTML is a better
    // reader artefact than a 404.
    const qualityFlag: 'low' | null = auditPassed ? null : 'low';
    const auditorMaxFailed = !auditPassed;

    // ── Slug coordination (Phase 2 sub-task 2.5) ────────────────
    //
    // A piece's quiz + html share the slug — one URL per piece.
    // Whichever artefact ships SECOND inherits the slug of the one
    // already in D1; if no sibling exists, Claude's proposed slug
    // resolves through the type-scoped collision check. Symmetric
    // since 2026-04-30 PM (sperm-piece fix).
    const finalSlug = await this.resolvePairSlug(pieceId, 'html', lastHtml.slug);
    lastHtml.slug = finalSlug;

    const publishedAt = Date.now();

    // File path uses `-html.json` suffix to avoid Astro entry-id
    // collision with the sibling quiz file at `<slug>.json`. The slug
    // FIELD inside both files is the bare `<slug>`; the reader page
    // queries by `data.slug` and renders both entries that match.
    const filePath = `content/interactives/${lastHtml.slug}-html.json`;
    const fileContent = JSON.stringify(
      {
        slug: lastHtml.slug,
        type: 'html',
        title: lastHtml.title,
        concept: lastHtml.concept,
        interactiveId,
        sourcePieceId: pieceId,
        publishedAt,
        voiceScore: lastAudit?.voice.score ?? undefined,
        ...(qualityFlag === 'low' ? { qualityFlag: 'low' } : {}),
        content: {
          type: 'html',
          html: lastHtml.html,
        },
      },
      null,
      2,
    ) + '\n';

    const publisher = await this.subAgent(
      PublisherAgent,
      `interactive-publisher-html-${lastHtml.slug}`,
    );
    const commitMsg = qualityFlag === 'low'
      ? `feat(interactives): ${lastHtml.title} (${lastHtml.slug}) [html, flagged low]`
      : `feat(interactives): ${lastHtml.title} (${lastHtml.slug}) [html]`;
    await publisher.publishToPath(filePath, fileContent, commitMsg);

    const htmlByteLength = new TextEncoder().encode(lastHtml.html).length;
    const revisionCount = roundsUsed - 1;
    const voiceScore = lastAudit?.voice.score ?? null;

    await this.env.DB
      .prepare(
        `INSERT INTO interactives
         (id, slug, type, title, concept, source_piece_id, content_json,
          voice_score, quality_flag, revision_count, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        interactiveId,
        lastHtml.slug,
        'html',
        lastHtml.title,
        lastHtml.concept,
        pieceId,
        voiceScore,
        qualityFlag,
        revisionCount,
        publishedAt,
        publishedAt,
      )
      .run();

    this.setState({
      ...this.state,
      htmlInteractivesGenerated: this.state.htmlInteractivesGenerated + 1,
      htmlInteractivesAuditorMaxFailed:
        this.state.htmlInteractivesAuditorMaxFailed + (auditorMaxFailed ? 1 : 0),
    });

    return {
      ran: true,
      skipped: false,
      declined: false,
      committed: true,
      validatorMaxFailed: false,
      auditorMaxFailed,
      qualityFlag,
      interactiveId,
      slug: lastHtml.slug,
      title: lastHtml.title,
      concept: lastHtml.concept,
      htmlByteLength,
      revisionCount,
      roundsUsed,
      voiceScore,
      finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
      parseFailures,
      errorMessage: null,
      tokensIn: cumulativeTokensIn,
      tokensOut: cumulativeTokensOut,
      cacheCreateTokens: cumulativeCacheCreate,
      cacheReadTokens: cumulativeCacheRead,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Round 1 — initial produce. Returns null quiz if Claude declined
   * (empty shape). Throws on infrastructure failure or structural
   * validation failure.
   */
  private async produceQuiz(
    pieceContext: PieceContextForQuiz,
    recent: RecentInteractive[],
  ): Promise<{
    quiz: ValidatedQuiz | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: INTERACTIVE_GENERATOR_PROMPT,
      messages: [
        { role: 'user', content: buildInteractivePrompt(pieceContext, recent) },
        // 2026-04-30 hardening — prefill the assistant turn with `{`
        // so Claude must continue with valid JSON. The prompt already
        // bans preamble + markdown fences; this layer enforces it at
        // the API contract. Anthropic returns only the continuation in
        // content[0].text, so we re-add the `{` before parsing.
        { role: 'assistant', content: '{' },
      ],
    });

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      quiz: parseAndValidate(rawText),
      ...usage,
    };
  }

  /**
   * Rounds 2+ — revise the previous attempt with auditor feedback.
   * Same system prompt (essence-not-reference rule doesn't relax on
   * retry); the user message carries the prior quiz + the audit
   * violations. Returns null quiz if Claude declines mid-revision.
   */
  private async reviseQuiz(
    previous: ValidatedQuiz,
    audit: InteractiveAuditResult,
    pieceContext: PieceContextForQuiz,
    recent: RecentInteractive[],
    round: number,
  ): Promise<{
    quiz: ValidatedQuiz | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const feedback = buildAuditFeedback(audit);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: INTERACTIVE_GENERATOR_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildRevisionPrompt(previous, feedback, pieceContext, recent, round),
        },
        // See produceQuiz for the prefill rationale.
        { role: 'assistant', content: '{' },
      ],
    });

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      quiz: parseAndValidate(rawText),
      ...usage,
    };
  }

  /**
   * JSON-repair revision — used when the prior round's response failed
   * `parseAndValidate` (Claude returned non-JSON). Distinct from
   * reviseQuiz because there's no audited structured object to quote
   * back; only the raw broken-output head is available. Same model,
   * same system prompt, same prefill — only the user message differs.
   *
   * Without this path, parse-fail rounds re-run the initial produceQuiz
   * prompt blind — same input, same likely defect. See
   * docs/DECISIONS.md 2026-05-05 for the full reasoning.
   */
  private async repairQuiz(
    brokenHead: string,
    pieceContext: PieceContextForQuiz,
    recent: RecentInteractive[],
    round: number,
  ): Promise<{
    quiz: ValidatedQuiz | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: INTERACTIVE_GENERATOR_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildJsonRepairPrompt(brokenHead, pieceContext, recent, round),
        },
        // See produceQuiz for the prefill rationale.
        { role: 'assistant', content: '{' },
      ],
    });

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      quiz: parseAndValidate(rawText),
      ...usage,
    };
  }

  /**
   * Round 1 — initial HTML interactive produce. Returns null html if
   * Claude declined (empty shape). Throws on infrastructure failure
   * or structural-shape validation failure.
   *
   * The HTML system prompt is sent as a single Anthropic prompt-cache
   * block (cache_control: ephemeral). It's ~12 KB stable; the
   * per-piece brief in `messages` is small and uncached. Cache reads
   * cost 0.1× the standard rate per Anthropic; at the cadence the
   * Generator runs (1–2 pieces/day), the second invocation within
   * ~5min hits the cache for ~90% of the input.
   */
  private async produceHtml(
    pieceContext: PieceContextForInteractive,
    recent: RecentInteractive[],
  ): Promise<{
    html: ValidatedHtml | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    // Streaming, not messages.create. HTML output ranges 4.2k–7.2k
    // tokens (observed prod), ~57–156s wall-clock — already in the
    // CF Workers ~125s subrequest idle danger zone. Streaming keeps
    // bytes flowing so the connection never goes silent. See
    // DECISIONS 2026-05-09 "Curator 124s 499 timeout regression".
    const response = await client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      // 16k tokens accommodates a 50 KB HTML file (≈12.5K tokens) plus
      // the small JSON envelope overhead. The validator's size-cap rule
      // is the actual hard limit; max_tokens sits above it as headroom.
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: INTERACTIVE_HTML_GENERATOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: buildHtmlInteractivePrompt(pieceContext, recent) },
        // See produceQuiz for the prefill rationale. The HTML JSON
        // envelope's first field is also `slug`; an open brace is the
        // correct continuation anchor for both shapes.
        { role: 'assistant', content: '{' },
      ],
    }).finalMessage();

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      html: parseAndValidateHtml(rawText),
      ...usage,
    };
  }

  /**
   * Rounds 2+ — revise the previous HTML attempt with validator OR
   * auditor feedback (or, in principle, both — though they're
   * mutually exclusive in practice since audit only runs after
   * validator passes). Same cached system prompt as round 1; the
   * prefix matches so the cache hits.
   *
   * @param auditFeedback null when the prior round failed validator
   *   (audit didn't run); populated when the prior round passed
   *   validator but failed audit.
   * @param validatorViolations empty when the prior round passed
   *   validator (audit failed instead); populated when the prior
   *   round failed validator.
   */
  private async reviseHtml(
    previous: ValidatedHtml,
    validatorViolations: RevisionValidatorViolation[],
    auditFeedback: RevisionFeedback | null,
    pieceContext: PieceContextForInteractive,
    recent: RecentInteractive[],
    round: number,
  ): Promise<{
    html: ValidatedHtml | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const previousShape: RevisionPreviousHtml = {
      slug: previous.slug,
      title: previous.title,
      concept: previous.concept,
      html: previous.html,
    };
    // Streaming — see produceHtml for the CF Workers idle-timeout reasoning.
    const response = await client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: INTERACTIVE_HTML_GENERATOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildHtmlRevisionPrompt(
            previousShape,
            auditFeedback,
            validatorViolations,
            pieceContext,
            recent,
            round,
          ),
        },
        // See produceQuiz for the prefill rationale.
        { role: 'assistant', content: '{' },
      ],
    }).finalMessage();

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      html: parseAndValidateHtml(rawText),
      ...usage,
    };
  }

  /**
   * HTML twin of repairQuiz — used when the prior round's HTML response
   * failed `parseAndValidateHtml` (e.g. unquoted concept value or
   * unescaped `"` inside the html string). Same cached system block as
   * produceHtml/reviseHtml so the cache prefix matches.
   */
  private async repairHtml(
    brokenHead: string,
    pieceContext: PieceContextForInteractive,
    recent: RecentInteractive[],
    round: number,
  ): Promise<{
    html: ValidatedHtml | null;
    tokensIn: number;
    tokensOut: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    // Streaming — see produceHtml for the CF Workers idle-timeout reasoning.
    const response = await client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: INTERACTIVE_HTML_GENERATOR_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildHtmlJsonRepairPrompt(brokenHead, pieceContext, recent, round),
        },
        // See produceQuiz for the prefill rationale.
        { role: 'assistant', content: '{' },
      ],
    }).finalMessage();

    const continuation = response.content[0].type === 'text' ? response.content[0].text : '';
    const rawText = '{' + continuation;
    const usage = extractUsage(response.usage);

    return {
      html: parseAndValidateHtml(rawText),
      ...usage,
    };
  }

  /**
   * Persist 4 rows (one per dimension) for one audit round to
   * `interactive_audit_results`. Voice carries a 0–100 score;
   * the three binary dimensions leave score NULL. `notes` is the
   * auditor's per-dimension `violations` / `issues` strings,
   * JSON-stringified — same shape `audit_results.notes` carries.
   * Suggestions stay separate so a future reader can render them
   * distinctly, but for v1 we collapse violations + suggestions
   * into one `notes` array per row to keep the shape simple.
   */
  private async persistAuditRows(
    interactiveId: string,
    round: number,
    audit: InteractiveAuditResult,
  ): Promise<void> {
    const now = Date.now();
    type Row = {
      dimension: 'voice' | 'structure' | 'essence' | 'factual';
      passed: boolean;
      score: number | null;
      notes: string[];
    };
    // Quiz path leaves score undefined on structure/essence/factual
    // (binary pass/fail) → null in the row. HTML path populates all
    // four scores. Same row shape covers both.
    const rows: Row[] = [
      {
        dimension: 'voice',
        passed: audit.voice.passed,
        score: audit.voice.score,
        notes: [...audit.voice.violations, ...audit.voice.suggestions],
      },
      {
        dimension: 'structure',
        passed: audit.structure.passed,
        score: audit.structure.score ?? null,
        notes: [...audit.structure.issues, ...audit.structure.suggestions],
      },
      {
        dimension: 'essence',
        passed: audit.essence.passed,
        score: audit.essence.score ?? null,
        notes: [...audit.essence.violations, ...audit.essence.suggestions],
      },
      {
        dimension: 'factual',
        passed: audit.factual.passed,
        score: audit.factual.score ?? null,
        notes: [...audit.factual.issues, ...audit.factual.suggestions],
      },
    ];

    const stmt = this.env.DB.prepare(
      `INSERT INTO interactive_audit_results
       (id, interactive_id, round, dimension, passed, score, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const batch = rows.map((r) =>
      stmt.bind(
        crypto.randomUUID(),
        interactiveId,
        round,
        r.dimension,
        r.passed ? 1 : 0,
        r.score,
        JSON.stringify(r.notes),
        now,
      ),
    );
    await this.env.DB.batch(batch);
  }

  /**
   * Pair a quiz + html under one shared slug.
   *
   * Whichever artefact ships SECOND inherits the slug of the one that
   * shipped FIRST. If no sibling exists yet, fall back to resolving
   * Claude's proposed slug through the type-scoped collision check.
   *
   * Symmetric — quiz inherits from html and html inherits from quiz.
   * Pre-2026-04-30, only the html→quiz direction was wired, which was
   * fine while quiz always shipped first; once `c687601` decoupled the
   * two loops (quiz failure no longer aborts html), html could ship
   * first, and the missing quiz→html direction caused divergent slugs
   * (sperm piece on 2026-04-30: detection-floor-as-resource-choice +
   * detection-floors-and-invisible-presence on two URLs).
   */
  private async resolvePairSlug(
    pieceId: string,
    type: 'quiz' | 'html',
    claudeProposed: string,
  ): Promise<string> {
    const siblingType = type === 'quiz' ? 'html' : 'quiz';
    const sibling = await this.env.DB
      .prepare(
        `SELECT slug FROM interactives
         WHERE source_piece_id = ? AND type = ? LIMIT 1`,
      )
      .bind(pieceId, siblingType)
      .first<{ slug: string }>();
    if (sibling?.slug) return sibling.slug;
    return this.resolveFreeSlug(claudeProposed, type);
  }

  /**
   * Find a non-colliding slug WITHIN AN ARTEFACT TYPE. Only called on
   * the passed path; a max-failed or declined attempt never reserves
   * a slug.
   *
   * Migration 0026 (Phase 2 sub-task 2.5) relaxed `interactives.slug
   * UNIQUE` to `UNIQUE(slug, type)` so a piece's quiz + html can share
   * the slug. The collision check is therefore type-scoped — a quiz
   * named 'chokepoints-and-cascades' doesn't block an html with the
   * same slug, but it does block another quiz.
   */
  private async resolveFreeSlug(
    base: string,
    type: 'quiz' | 'html',
  ): Promise<string> {
    const normalised = normaliseSlug(base);
    if (normalised.length === 0) {
      throw new Error('resolveFreeSlug: empty slug after normalisation');
    }

    const isFree = async (candidate: string): Promise<boolean> => {
      const hit = await this.env.DB
        .prepare('SELECT 1 FROM interactives WHERE slug = ? AND type = ? LIMIT 1')
        .bind(candidate, type)
        .first<{ 1: number }>();
      return !hit;
    };

    if (await isFree(normalised)) return normalised;
    for (let n = 2; n <= SLUG_COLLISION_MAX_ATTEMPTS; n += 1) {
      const candidate = `${normalised}-${n}`.slice(0, 60);
      if (await isFree(candidate)) return candidate;
    }
    throw new Error(
      `resolveFreeSlug: "${normalised}" (type=${type}) and ${SLUG_COLLISION_MAX_ATTEMPTS - 1} numbered variants all taken`,
    );
  }
}

/**
 * Parse + structurally validate Claude's HTML interactive output.
 * Returns null on the decline shape; throws with a specific error
 * message on structural validation failure or non-JSON output.
 *
 * NOTE: this is the SHAPE check, not the validator. The validator
 * (agents/src/interactive-validator.ts) runs against `html` AFTER
 * this function returns a non-null ValidatedHtml.
 */
function parseAndValidateHtml(rawText: string): ValidatedHtml | null {
  let parsed: { slug?: unknown; title?: unknown; concept?: unknown; html?: unknown };
  try {
    parsed = extractJson<typeof parsed>(rawText);
  } catch {
    // 2026-04-30 PM diagnostic — include first 200 chars of what came
    // back so the observer event body shows the actual model output
    // (or empty/truncated content) instead of just naming the failure
    // class. The loop's catch matches on the message prefix only.
    const sample = rawText.slice(0, 200).replace(/\n/g, '\\n');
    const len = rawText.length;
    throw new Error(
      `parseAndValidateHtml: Claude returned non-JSON output (len=${len}, head=${JSON.stringify(sample)})`,
    );
  }

  const slug = typeof parsed.slug === 'string' ? parsed.slug.trim() : '';
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const concept = typeof parsed.concept === 'string' ? parsed.concept.trim() : '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';

  // Decline shape: all-empty.
  if (slug === '' && title === '' && concept === '' && html === '') {
    return null;
  }

  if (slug.length === 0) throw new Error('parseAndValidateHtml: empty slug');
  if (title.length === 0) throw new Error('parseAndValidateHtml: empty title');
  if (concept.length === 0) throw new Error('parseAndValidateHtml: empty concept');
  if (html.length === 0) throw new Error('parseAndValidateHtml: empty html');

  // The HTML must be a complete document. Tolerate leading whitespace
  // (Claude sometimes adds a newline) but reject anything that doesn't
  // start with <!DOCTYPE — partial fragments are a Claude failure mode
  // we want surfaced, not committed.
  const trimmedHtml = html.replace(/^\s+/, '');
  if (!/^<!DOCTYPE/i.test(trimmedHtml)) {
    throw new Error(
      'parseAndValidateHtml: html does not begin with <!DOCTYPE — must be a complete HTML document',
    );
  }

  return { slug, title, concept, html };
}

/**
 * Shared parse + validate. Returns null on the decline shape; throws
 * with a specific error message on structural validation failure or
 * non-JSON output.
 */
function parseAndValidate(rawText: string): ValidatedQuiz | null {
  let parsed: RawQuiz;
  try {
    parsed = extractJson<RawQuiz>(rawText);
  } catch {
    // 2026-04-30 PM diagnostic — see parseAndValidateHtml comment.
    const sample = rawText.slice(0, 200).replace(/\n/g, '\\n');
    const len = rawText.length;
    throw new Error(
      `parseAndValidate: Claude returned non-JSON output (len=${len}, head=${JSON.stringify(sample)})`,
    );
  }

  const questionsRaw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const slugRaw = typeof parsed.slug === 'string' ? parsed.slug.trim() : '';
  const titleRaw = typeof parsed.title === 'string' ? parsed.title.trim() : '';

  // Decline shape: all-empty.
  if (questionsRaw.length === 0 && slugRaw === '' && titleRaw === '') {
    return null;
  }

  return validateQuiz(parsed);
}

/**
 * Structural validation of Claude's output. Throws with a specific
 * message on first failure — Director's alarm handler logs verbatim
 * to observer_events, so the message IS the ops signal.
 */
function validateQuiz(raw: RawQuiz): ValidatedQuiz {
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const concept = typeof raw.concept === 'string' ? raw.concept.trim() : '';
  const questionsRaw = Array.isArray(raw.questions) ? raw.questions : [];

  if (slug.length === 0) throw new Error('validateQuiz: empty slug');
  if (title.length === 0) throw new Error('validateQuiz: empty title');
  if (concept.length === 0) throw new Error('validateQuiz: empty concept');
  if (questionsRaw.length < QUIZ_MIN_QUESTIONS || questionsRaw.length > QUIZ_MAX_QUESTIONS) {
    throw new Error(
      `validateQuiz: question count ${questionsRaw.length} out of bounds [${QUIZ_MIN_QUESTIONS}, ${QUIZ_MAX_QUESTIONS}]`,
    );
  }

  const questions: ValidatedQuiz['questions'] = [];
  for (let i = 0; i < questionsRaw.length; i += 1) {
    const q = questionsRaw[i] as RawQuestion;
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    const options = Array.isArray(q.options)
      ? q.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
      : [];
    const correctIndex = typeof q.correctIndex === 'number' && Number.isInteger(q.correctIndex)
      ? q.correctIndex
      : -1;
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

    if (question.length === 0) {
      throw new Error(`validateQuiz: question ${i + 1} has empty text`);
    }
    if (options.length < 2 || options.length > 6) {
      throw new Error(
        `validateQuiz: question ${i + 1} has ${options.length} options, must be 2–6`,
      );
    }
    if (options.some((o) => o.length === 0)) {
      throw new Error(`validateQuiz: question ${i + 1} has an empty option`);
    }
    const leakPattern = /\((?:correct|incorrect)\)/i;
    const leakIdx = options.findIndex((o) => leakPattern.test(o));
    if (leakIdx !== -1) {
      throw new Error(
        `validateQuiz: question ${i + 1} option ${leakIdx + 1} contains an answer-leak marker (e.g. "(correct)")`,
      );
    }
    if (correctIndex < 0 || correctIndex >= options.length) {
      throw new Error(
        `validateQuiz: question ${i + 1} correctIndex ${correctIndex} out of bounds for ${options.length} options`,
      );
    }
    if (explanation.length === 0) {
      throw new Error(`validateQuiz: question ${i + 1} has empty explanation`);
    }
    questions.push({ question, options, correctIndex, explanation });
  }

  return { slug, title, concept, questions };
}

/**
 * Compress a full InteractiveAuditResult into a flat summary suitable
 * for observer events. Keeps the top few cross-dimension issues so
 * the admin feed has concrete context without pulling the full JSON.
 */
function summariseAudit(audit: InteractiveAuditResult): FinalAuditSummary {
  const issues: string[] = [
    ...audit.voice.violations.map((v) => `voice: ${v}`),
    ...audit.structure.issues.map((i) => `structure: ${i}`),
    ...audit.essence.violations.map((v) => `essence: ${v}`),
    ...audit.factual.issues.map((i) => `factual: ${i}`),
  ].slice(0, 5);

  return {
    voicePassed: audit.voice.passed,
    voiceScore: audit.voice.score,
    structurePassed: audit.structure.passed,
    essencePassed: audit.essence.passed,
    factualPassed: audit.factual.passed,
    topIssues: issues,
  };
}

/**
 * Convert an InteractiveAuditResult into the RevisionFeedback shape
 * the prompt builder expects. Quiz auditor leaves structure/essence/
 * factual scores undefined (binary pass/fail); HTML auditor sets
 * them — the prompt builder ignores `score` on the binary
 * dimensions either way (the score field is voice-only in the
 * RevisionDimensionFeedback type).
 */
function buildAuditFeedback(audit: InteractiveAuditResult): RevisionFeedback {
  return {
    voice: {
      passed: audit.voice.passed,
      score: audit.voice.score,
      issues: audit.voice.violations,
      suggestions: audit.voice.suggestions,
    },
    structure: {
      passed: audit.structure.passed,
      issues: audit.structure.issues,
      suggestions: audit.structure.suggestions,
      score: audit.structure.score,
    },
    essence: {
      passed: audit.essence.passed,
      issues: audit.essence.violations,
      suggestions: audit.essence.suggestions,
      score: audit.essence.score,
    },
    factual: {
      passed: audit.factual.passed,
      issues: audit.factual.issues,
      suggestions: audit.factual.suggestions,
      score: audit.factual.score,
    },
  };
}
