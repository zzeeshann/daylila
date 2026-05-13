import { Agent } from 'agents';
import type { Env } from './types';

export interface ObserverEvent {
  id: string;
  severity: 'info' | 'warn' | 'escalation';
  title: string;
  body: string;
  context: Record<string, unknown> | null;
  piece_id: string | null;
  run_id: string | null;
  created_at: number;
}

interface ObserverState {
  eventCount: number;
}

/**
 * ObserverAgent — the human-facing reporter.
 * Logs events about what the agent team has been doing so
 * Zishan can review from the dashboard.
 *
 * Events are stored in D1's observer_events table.
 *
 * piece_id threading (2026-04-22, migration 0020): piece-scoped
 * helpers accept an optional trailing `pieceId` so the per-piece
 * admin deep-dive can filter events by piece_id instead of the 36h
 * day window it used to fall back to. System-level events (admin
 * settings changes, global errors) pass `null` and remain visible
 * only on the admin home feed.
 *
 * run_id threading (2026-05-07, migration 0037 / Foundation Fix Task
 * 08): every method also accepts a trailing `runId: string | null =
 * null` so multi-piece-per-day runs are forensically traceable
 * end-to-end. Off-pipeline alarms (post-publish reflection,
 * categorisation, interactive generation, Zita synthesis) thread
 * the run's UUID via their schedule payload; system-level events
 * pass null. Default-null preserves call-site back-compat for any
 * legacy caller not yet updated.
 */
export class ObserverAgent extends Agent<Env, ObserverState> {
  initialState: ObserverState = { eventCount: 0 };

  /** Log a lesson being published successfully */
  async logPublished(
    source: string,
    _unused: number,
    title: string,
    voiceScore: number,
    revisionCount: number,
    commitUrl: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Published: ${title}`,
      body: `"${title}" passed all gates and was committed to the repo.`,
      context: { source, voiceScore, revisionCount, commitUrl },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Log a piece that didn't clear every gate after max revisions.
   *  Still an escalation — operator needs to know — but phrased
   *  neutrally. The piece publishes anyway with a tier label. */
  async logEscalation(
    source: string,
    _unused: number,
    title: string,
    voiceScore: number,
    rounds: number,
    failedGates: string[],
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Escalation: ${title}`,
      body: `"${title}" didn't clear all gates after ${rounds} revision rounds. Unresolved: ${failedGates.join(', ')}. Published with voice ${voiceScore}/100; worth a manual look.`,
      context: { source, voiceScore, rounds, failedGates },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Log a pipeline error. pieceId is optional — many error paths
   *  fire before a pieceId is allocated (Scanner returned zero, DB
   *  contention in Director setup). Pass null or omit in those cases. */
  async logError(
    source: string,
    _unused: number,
    error: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Error: ${source}`,
      body: `Pipeline error: ${error}`,
      context: { source, error },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Curator parse-fail with full diagnostic capture from both
   *  attempts (initial call + repair retry). Carries the full raw
   *  response text + stop_reason + token usage from each call so the
   *  next investigation has the data it needs without inference.
   *
   *  Body is a structured multi-section text dump suitable for human
   *  reading in the admin feed; context carries the same fields in
   *  JSON for programmatic queries. Severity is warn (not escalation)
   *  because Curator's catch already wrote an Error row and a manual
   *  admin retrigger typically succeeds (Sonnet 4.5 wobble is
   *  stochastic).
   *
   *  See DECISIONS 2026-05-13 "Curator parse-fail diagnostic +
   *  repair-on-parse-fail". */
  async logCuratorParseFail(fields: {
    rawTextAttempt1: string;
    rawTextAttempt2: string;
    stopReasonAttempt1: string;
    stopReasonAttempt2: string;
    tokensInAttempt1: number;
    tokensOutAttempt1: number;
    tokensInAttempt2: number;
    tokensOutAttempt2: number;
    attempt1ParseError: string;
    attempt2ParseError: string;
    pieceId: string | null;
    runId: string | null;
  }): Promise<void> {
    const body =
      `Curator parse-fail across both attempts.\n\n` +
      `## Attempt 1 (initial call)\n` +
      `stop_reason: ${fields.stopReasonAttempt1}\n` +
      `tokens_in: ${fields.tokensInAttempt1}\n` +
      `tokens_out: ${fields.tokensOutAttempt1}\n` +
      `parse_error: ${fields.attempt1ParseError}\n` +
      `raw_text (${fields.rawTextAttempt1.length} chars):\n` +
      `${fields.rawTextAttempt1}\n\n` +
      `## Attempt 2 (repair retry)\n` +
      `stop_reason: ${fields.stopReasonAttempt2}\n` +
      `tokens_in: ${fields.tokensInAttempt2}\n` +
      `tokens_out: ${fields.tokensOutAttempt2}\n` +
      `parse_error: ${fields.attempt2ParseError}\n` +
      `raw_text (${fields.rawTextAttempt2.length} chars):\n` +
      `${fields.rawTextAttempt2}`;

    await this.writeEvent({
      severity: 'warn',
      title: 'Curator parse-fail diagnostic',
      body,
      context: {
        source: 'curator',
        kind: 'parse_fail_diagnostic',
        attempt1: {
          stop_reason: fields.stopReasonAttempt1,
          tokens_in: fields.tokensInAttempt1,
          tokens_out: fields.tokensOutAttempt1,
          raw_text_len: fields.rawTextAttempt1.length,
          parse_error: fields.attempt1ParseError,
          raw_text: fields.rawTextAttempt1,
        },
        attempt2: {
          stop_reason: fields.stopReasonAttempt2,
          tokens_in: fields.tokensInAttempt2,
          tokens_out: fields.tokensOutAttempt2,
          raw_text_len: fields.rawTextAttempt2.length,
          parse_error: fields.attempt2ParseError,
          raw_text: fields.rawTextAttempt2,
        },
      },
      piece_id: fields.pieceId,
      run_id: fields.runId,
    });
  }

  /** Daily run entered triggerDailyPiece, passed Phase 3's hourly
   *  cadence gate, but found a piece already published within the
   *  current slot window. Expected protective behaviour when a cron
   *  slot is re-dispatched (same-hour double-fire, SDK oddity, or
   *  manual replay); info severity — nothing broke. Makes the skip
   *  visible in the admin feed so "where did that run go?" has an
   *  answer. Replaces the prior silent `return null`.
   *
   *  piece_id is the EXISTING piece that's already in the slot — the
   *  skip is about that piece, so attributing it there is correct. */
  async logDailyRunSkipped(
    date: string,
    intervalHours: number,
    slotStartMs: number,
    existingPieceId: string,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Daily run skipped — slot already published`,
      body: `Slot starting ${new Date(slotStartMs).toISOString()} (interval_hours=${intervalHours}) already has piece ${existingPieceId} for date ${date}. No action needed.`,
      context: { date, intervalHours, slotStartMs, existingPieceId, reason: 'slot_already_published' },
      piece_id: existingPieceId,
      run_id: runId,
    });
  }

  /** Pre-Curator headline-overlap dedup ran and removed candidates that
   *  share substantive headline tokens with recently-published pieces.
   *  Info severity — this is the deterministic backstop catching what
   *  the prompt-level rule keeps failing to catch (see DECISIONS
   *  2026-04-27 architectural fix). Visibility matters because this
   *  invisibly shapes Curator's input set; if filter rate is high, the
   *  news cycle is dominated by stories Daylila has already covered,
   *  which is itself signal.
   *
   *  pieceId is the run's piece_id (pre-allocated at the top of
   *  triggerDailyPiece) — the filter ran for THIS run's pick, even
   *  though it filters AGAINST prior pieces. */
  async logCandidatesFiltered(
    date: string,
    totalCandidates: number,
    filteredCount: number,
    samples: Array<{ candidateHeadline: string; matchedHeadline: string; sharedTokens: number }>,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    const sampleLines = samples.slice(0, 5).map((s) =>
      `- "${s.candidateHeadline}" matched "${s.matchedHeadline}" (${s.sharedTokens} shared tokens)`
    ).join('\n');
    const more = samples.length > 5 ? `\n…and ${samples.length - 5} more.` : '';
    await this.writeEvent({
      severity: 'info',
      title: `Candidates filtered: ${filteredCount} of ${totalCandidates} (headline overlap with recent pieces)`,
      body: `Pre-Curator dedup removed ${filteredCount} of ${totalCandidates} candidates for ${date}. Curator saw the remaining ${totalCandidates - filteredCount}.\n${sampleLines}${more}`,
      context: { date, totalCandidates, filteredCount, samples },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Audio landed — text + audio both live. Info severity, no action
   *  needed. Fires AFTER publisher.publishAudio second commit. */
  async logAudioPublished(
    date: string,
    title: string,
    beatCount: number,
    totalCharacters: number,
    commitUrl: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Audio published: ${title}`,
      body: `Audio for "${title}" landed in ${beatCount} beats (${totalCharacters} chars). Commit: ${commitUrl}`,
      context: { date, beatCount, totalCharacters, commitUrl },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Post-publish producer learnings analysis failed. Non-retriable —
   *  the piece is already live, a missed batch of learnings isn't
   *  catastrophic, and we don't want defensive retry logic. Surfaced
   *  as a warn (not escalation) because nothing downstream breaks. */
  async logLearnerFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Post-publish learnings missed: ${title}`,
      body: `Producer-side analysis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Post-publish producer analysis produced more learnings than the
   *  cap allows (currently 10). Logged for visibility — usually a
   *  signal that the analysis restated one pattern multiple ways. */
  async logLearnerOverflow(
    date: string,
    title: string,
    written: number,
    overflowCount: number,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Learning overflow: ${title}`,
      body: `Post-publish analysis for "${title}" produced ${written + overflowCount} learnings; wrote ${written}, dropped ${overflowCount}. Usually means the analysis restated the same pattern multiple ways — worth a look if it keeps happening.`,
      context: { date, written, overflowCount },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Self-reflection call ran — one metered info event per run so we
   *  can spot cost/latency drift before it matters. This is the one
   *  Sonnet call in the pipeline that doesn't gate anything, so
   *  visibility is the whole point: no hard cap, just a breadcrumb. */
  async logReflectionMetered(
    date: string,
    title: string,
    metrics: {
      written: number;
      overflowCount: number;
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    const overflowNote =
      metrics.overflowCount > 0
        ? ` Overflow: ${metrics.overflowCount} dropped (cap 10).`
        : '';
    await this.writeEvent({
      severity: 'info',
      title: `Reflection: ${title}`,
      body: `Self-reflection for "${title}" (${date}) produced ${metrics.considered} bullets, wrote ${metrics.written}.${overflowNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Zita synthesis ran — one metered info event per run so we can
   *  spot cost/latency drift before it matters. Same shape as
   *  logReflectionMetered. Fires on both skipped and written paths —
   *  the skipped path is informational (no Claude call happened) but
   *  worth a breadcrumb so "is the P1.5 schedule firing?" has a
   *  visible answer. */
  async logZitaSynthesisMetered(
    date: string,
    title: string,
    metrics: {
      skipped: boolean;
      userMsgCount: number;
      written: number;
      overflowCount: number;
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    if (metrics.skipped) {
      await this.writeEvent({
        severity: 'info',
        title: `Zita synthesis skipped: ${title}`,
        body: `Reader Q&A synthesis for "${title}" (${date}) skipped — only ${metrics.userMsgCount} reader message${metrics.userMsgCount === 1 ? '' : 's'}, threshold is 5. No Claude call fired. Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
        piece_id: pieceId,
        run_id: runId,
      });
      return;
    }
    const overflowNote =
      metrics.overflowCount > 0
        ? ` Overflow: ${metrics.overflowCount} dropped (cap 10).`
        : '';
    await this.writeEvent({
      severity: 'info',
      title: `Zita synthesis: ${title}`,
      body: `Reader Q&A synthesis for "${title}" (${date}) considered ${metrics.userMsgCount} reader messages, produced ${metrics.considered} bullets, wrote ${metrics.written}.${overflowNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Zita synthesis call failed — non-retriable by design, worth a
   *  warn so the admin feed knows this day's reader-signal got
   *  dropped. Same posture as logLearnerFailure / logReflectionFailure. */
  async logZitaSynthesisFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Zita synthesis missed: ${title}`,
      body: `Reader Q&A synthesis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Self-reflection call failed — non-retriable by design, but worth
   *  a warn so the admin feed knows the loop missed an iteration. */
  async logReflectionFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Reflection missed: ${title}`,
      body: `Self-reflection failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Categoriser call ran — one metered info event per run so cost
   *  drift is visible over time. Same shape as logReflectionMetered
   *  and logZitaSynthesisMetered. Fires on both skipped and written
   *  paths — the skipped path (piece already categorised, idempotent
   *  re-run) logs no Claude call but still leaves a breadcrumb so
   *  "did the categoriser run?" has a visible answer.
   *
   *  Skipped path also surfaces the existing assignments (added
   *  2026-04-25) so an admin looking at the feed can tell at a glance
   *  whether the rows are correct or whether a buggy prior run wrote
   *  them. Without this, a deploy-during-pipeline race that loses the
   *  original "Categorised:" success log would leave the operator
   *  reading "Categorisation skipped" with no way to know what's
   *  actually attached. */
  async logCategoriserMetered(
    date: string,
    title: string,
    metrics: {
      skipped: boolean;
      assignmentsWritten: number;
      novelCategoriesCreated: number;
      novelCategoryNames: string[];
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
      existingAssignments?: Array<{ name: string; slug: string; confidence: number }>;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    if (metrics.skipped) {
      const existing = metrics.existingAssignments ?? [];
      const existingNote = existing.length > 0
        ? ` Already assigned to: ${existing.map((a) => `${a.name} (${a.confidence}%)`).join(', ')}.`
        : ' No existing assignments visible (race or stale state).';
      await this.writeEvent({
        severity: 'info',
        title: `Categorisation skipped: ${title}`,
        body: `"${title}" (${date}) already has categories. No Claude call fired.${existingNote} Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
        piece_id: pieceId,
        run_id: runId,
      });
      return;
    }
    const novelNote = metrics.novelCategoriesCreated > 0
      ? ` Created ${metrics.novelCategoriesCreated} new categor${metrics.novelCategoriesCreated === 1 ? 'y' : 'ies'}: ${metrics.novelCategoryNames.join(', ')}.`
      : '';
    await this.writeEvent({
      severity: 'info',
      title: `Categorised: ${title}`,
      body: `"${title}" (${date}) assigned to ${metrics.assignmentsWritten} categor${metrics.assignmentsWritten === 1 ? 'y' : 'ies'} (considered ${metrics.considered}).${novelNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Categoriser call failed — non-retriable by design, worth a warn
   *  so the admin feed knows the piece missed its category
   *  assignments. The piece is live; a missed categorisation isn't
   *  catastrophic — the library filter just won't surface this piece
   *  under a category until the seed script or a manual admin run
   *  retags it. Same posture as logLearnerFailure /
   *  logReflectionFailure / logZitaSynthesisFailure. */
  async logCategoriserFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Categorisation missed: ${title}`,
      body: `Categoriser failed for "${title}" (${date}). Reason: ${reason}. The piece is live; it'll just miss category assignments until a manual retag.`,
      context: { date, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Categoriser's first Claude attempt returned an empty (or all
   *  sub-floor) assignments array — info-level breadcrumb so the admin
   *  feed shows the retry happening. The follow-up
   *  logCategoriserMetered (success) or logCategoriserFallback (both
   *  attempts failed) reports the terminal state. Added 2026-04-29 as
   *  part of the zero-assignment fix. */
  async logCategoriserRetried(
    date: string,
    title: string,
    detail: {
      reason: 'empty' | 'all-sub-floor';
      consideredFirst: number;
      tokensInFirst: number;
      tokensOutFirst: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    const reasonNote =
      detail.reason === 'empty'
        ? 'first response was an empty assignments array'
        : 'first response had only sub-floor (<60 confidence) existing-cat assignments';
    await this.writeEvent({
      severity: 'info',
      title: `Categorisation retried: ${title}`,
      body: `"${title}" (${date}) — Categoriser firing one retry: ${reasonNote}. First call: considered=${detail.consideredFirst}, tokens in=${detail.tokensInFirst} out=${detail.tokensOutFirst}.`,
      context: { date, ...detail },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Both Categoriser attempts returned empty/all-sub-floor — the
   *  piece was written to the reserved "Patterns Yet to Cluster"
   *  fallback category. Warn-severity because this should be rare; if
   *  it fires more than ~once per 10 pieces, the prompt or taxonomy
   *  needs tuning. Added 2026-04-29 as part of the zero-assignment
   *  fix. */
  async logCategoriserFallback(
    date: string,
    title: string,
    detail: {
      tokensInTotal: number;
      tokensOutTotal: number;
      durationMs: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Categorisation fallback fired: ${title}`,
      body: `"${title}" (${date}) landed in the reserved "Patterns Yet to Cluster" category — both Claude attempts returned empty or all-sub-floor. Operator review recommended; the taxonomy may need a new category. Tokens: in=${detail.tokensInTotal} out=${detail.tokensOutTotal}. Latency: ${detail.durationMs}ms.`,
      context: { date, ...detail },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** InteractiveGenerator ran — combined quiz + html observer event.
   *
   * As of Phase 2 (2026-04-26), the Generator produces TWO artefacts
   * per piece (quiz + html), gated by `interactives_html_enabled`.
   * One observer event covers both, with per-artefact summary lines
   * so the admin feed shows the whole story of one Generator run.
   *
   * Severity logic across both artefacts:
   *   - escalation: any artefact ran but every artefact-that-ran failed
   *     (declined / validatorMaxFailed) — Generator burned tokens with
   *     no shippable output.
   *   - warn: any artefact shipped flagged-low (auditor max-failed but
   *     committed).
   *   - info: clean pass on every artefact that ran, OR all skipped
   *     (idempotent re-run).
   *
   * Quiz fields mirror the pre-Phase-2 shape; html fields are new.
   * The observer event body composes a multi-line summary covering
   * both artefacts; `context` carries the full structured metrics
   * for forensic access.
   */
  async logInteractiveGeneratorMetered(
    date: string,
    title: string,
    metrics: {
      htmlEnabled: boolean;
      quiz: {
        ran: boolean;
        skipped: boolean;
        declined: boolean;
        committed: boolean;
        auditorMaxFailed: boolean;
        qualityFlag: 'low' | null;
        interactiveId: string | null;
        slug: string | null;
        title: string | null;
        concept: string | null;
        questionCount: number;
        revisionCount: number;
        roundsUsed: number;
        voiceScore: number | null;
        finalAudit: {
          voicePassed: boolean;
          voiceScore: number;
          structurePassed: boolean;
          essencePassed: boolean;
          factualPassed: boolean;
          topIssues: string[];
        } | null;
        tokensIn: number;
        tokensOut: number;
        cacheCreateTokens: number;
        cacheReadTokens: number;
        durationMs: number;
      };
      html: {
        ran: boolean;
        skipped: boolean;
        declined: boolean;
        committed: boolean;
        validatorMaxFailed: boolean;
        auditorMaxFailed: boolean;
        qualityFlag: 'low' | null;
        interactiveId: string | null;
        slug: string | null;
        title: string | null;
        concept: string | null;
        htmlByteLength: number;
        revisionCount: number;
        roundsUsed: number;
        voiceScore: number | null;
        finalAudit: {
          voicePassed: boolean;
          voiceScore: number;
          structurePassed: boolean;
          essencePassed: boolean;
          factualPassed: boolean;
          topIssues: string[];
        } | null;
        tokensIn: number;
        tokensOut: number;
        cacheCreateTokens: number;
        cacheReadTokens: number;
        durationMs: number;
      } | null;
      totalDurationMs: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    const quiz = metrics.quiz;
    const html = metrics.html;

    // Per-artefact summary line builders.
    const summariseQuiz = (): string => {
      if (quiz.skipped) {
        return `Quiz: skipped (already exists as ${quiz.interactiveId}).`;
      }
      if (quiz.declined) {
        return `Quiz: declined after ${quiz.roundsUsed} round${quiz.roundsUsed === 1 ? '' : 's'} — concept too redundant with recent interactives.`;
      }
      if (quiz.committed) {
        const revisionNote = quiz.revisionCount > 0 ? ` (${quiz.revisionCount} revision${quiz.revisionCount === 1 ? '' : 's'})` : '';
        const voiceNote = quiz.voiceScore !== null ? ` voice ${quiz.voiceScore}/100` : '';
        if (quiz.auditorMaxFailed) {
          const gates = quiz.finalAudit
            ? [
                quiz.finalAudit.voicePassed ? null : `voice (${quiz.finalAudit.voiceScore}/100)`,
                quiz.finalAudit.structurePassed ? null : 'structure',
                quiz.finalAudit.essencePassed ? null : 'essence',
                quiz.finalAudit.factualPassed ? null : 'factual',
              ].filter((x): x is string => x !== null).join(', ')
            : 'unknown';
          const issuesLine = quiz.finalAudit?.topIssues.length
            ? ` Top issues: ${quiz.finalAudit.topIssues.map((i) => `"${i}"`).join('; ')}.`
            : '';
          return `Quiz: shipped flagged-low — "${quiz.title}" (${quiz.questionCount} questions, /interactives/${quiz.slug}/)${revisionNote}. Failed gates: ${gates}.${issuesLine}`;
        }
        return `Quiz: shipped — "${quiz.title}" (${quiz.questionCount} questions, /interactives/${quiz.slug}/)${revisionNote}.${voiceNote} Concept: ${quiz.concept}.`;
      }
      return `Quiz: did not run.`;
    };

    const summariseHtml = (): string => {
      if (!html) return `HTML: disabled (interactives_html_enabled=false).`;
      if (html.skipped) {
        return `HTML: skipped (already exists as ${html.interactiveId}).`;
      }
      if (html.declined) {
        return `HTML: declined after ${html.roundsUsed} round${html.roundsUsed === 1 ? '' : 's'} — concept could not be expressed as a manipulable interactive.`;
      }
      if (html.validatorMaxFailed) {
        return `HTML: validator max-failed (${html.roundsUsed} rounds). No commit. Inspect Generator logs for the violation list.`;
      }
      if (html.committed) {
        const revisionNote = html.revisionCount > 0 ? ` (${html.revisionCount} revision${html.revisionCount === 1 ? '' : 's'})` : '';
        const sizeKB = (html.htmlByteLength / 1024).toFixed(1);
        if (html.auditorMaxFailed) {
          const gates = html.finalAudit
            ? [
                html.finalAudit.voicePassed ? null : `voice (${html.finalAudit.voiceScore}/100)`,
                html.finalAudit.structurePassed ? null : 'structure',
                html.finalAudit.essencePassed ? null : 'essence',
                html.finalAudit.factualPassed ? null : 'factual',
              ].filter((x): x is string => x !== null).join(', ')
            : 'unknown';
          return `HTML: shipped flagged-low — "${html.title}" (${sizeKB} KB, /interactives/${html.slug}/)${revisionNote}. Failed gates: ${gates}.`;
        }
        return `HTML: shipped — "${html.title}" (${sizeKB} KB, /interactives/${html.slug}/)${revisionNote}.`;
      }
      return `HTML: did not run.`;
    };

    // Severity rollup.
    const quizFailed = quiz.ran && !quiz.committed; // declined or zero rounds
    const htmlFailed = html?.ran && !html.committed && !html.skipped; // declined or validatorMaxFailed
    const anyShipped = quiz.committed || (html?.committed ?? false);
    const anyShippedLow =
      (quiz.committed && quiz.auditorMaxFailed) ||
      (html?.committed && html.auditorMaxFailed) ||
      false;

    let severity: 'info' | 'warn' | 'escalation';
    let titlePrefix: string;
    if (!anyShipped && (quizFailed || htmlFailed)) {
      severity = 'escalation';
      titlePrefix = 'Interactive(s) failed';
    } else if (anyShippedLow) {
      severity = 'warn';
      titlePrefix = 'Interactive(s) shipped (flagged low)';
    } else if (anyShipped) {
      severity = 'info';
      titlePrefix = 'Interactive(s) generated';
    } else {
      // Everything skipped — idempotent re-run, info.
      severity = 'info';
      titlePrefix = 'Interactive(s) skipped';
    }

    const totalTokensIn = quiz.tokensIn + (html?.tokensIn ?? 0);
    const totalTokensOut = quiz.tokensOut + (html?.tokensOut ?? 0);
    const totalCacheCreate = quiz.cacheCreateTokens + (html?.cacheCreateTokens ?? 0);
    const totalCacheRead = quiz.cacheReadTokens + (html?.cacheReadTokens ?? 0);

    // Token breakdown shown 4-up so the Phase 3.4 cost surface and
    // the operator skim share the same shape. cacheCreate=0 +
    // cacheRead=0 means caching wasn't in use for this run; cacheRead>0
    // and cacheCreate=0 means warm-cache hit; both>0 is rare (only
    // on the cold call inside a multi-call run).
    const body = [
      summariseQuiz(),
      summariseHtml(),
      `Tokens: in=${totalTokensIn} out=${totalTokensOut} cacheCreate=${totalCacheCreate} cacheRead=${totalCacheRead}. Latency: ${metrics.totalDurationMs}ms (quiz ${quiz.durationMs}ms${html ? `, html ${html.durationMs}ms` : ''}).`,
    ].join(' ');

    await this.writeEvent({
      severity,
      title: `${titlePrefix}: ${title}`,
      body,
      context: { date, ...metrics },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** InteractiveGenerator failed — non-retriable. Piece stays live
   *  without an interactive; operator can hit the trigger endpoint
   *  to retry after fixing the underlying cause. Same posture as
   *  logCategoriserFailure / logReflectionFailure. */
  async logInteractiveGeneratorFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Interactive generation failed: ${title}`,
      body: `InteractiveGenerator failed for "${title}" (${date}). Reason: ${reason}. The piece is live; retry from admin or via /interactive-generate-trigger once the cause is fixed.`,
      context: { date, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** A produce/revise round inside the InteractiveGenerator loop saw
   *  Claude return non-JSON output. Info severity — the loop counts it
   *  as a failed round and retries on the next iteration within the
   *  existing 3-round budget. The terminal state still surfaces via
   *  `logInteractiveGeneratorMetered` (committed, declined, or shipped-
   *  low) or `logInteractiveGeneratorFailure` (3-round exhaustion);
   *  this event is just the breadcrumb trail. Replaces the pre-2026-04-30
   *  fatal-throw shape where the first parse-fail abandoned the whole
   *  generation and forced operator manual retry. */
  async logInteractiveGeneratorParseFail(
    date: string,
    title: string,
    type: 'quiz' | 'html',
    round: number,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Interactive generation parse retry: ${title}`,
      body:
        `InteractiveGenerator round ${round} (${type}) for "${title}" (${date}) returned non-JSON output. ` +
        `Treating as failed round and retrying within the 3-round budget.`,
      context: { date, type, round },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Operator-triggered regeneration of an interactive. Info severity
   *  — routine ops, not a failure. The fresh `generateInteractiveScheduled`
   *  alarm fires its own `logInteractiveGeneratorMetered` event when
   *  the regenerate completes, so the admin feed shows two events:
   *  this one (the wipe) and the metered one (the fresh result). */
  async logInteractiveRegenerated(
    date: string,
    title: string,
    type: 'quiz' | 'html',
    deletedSlug: string,
    deletedInteractiveId: string,
    deletedFilePath: string,
    changedBy: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Interactive regenerated: ${title} (${type})`,
      body:
        `Operator ${changedBy} regenerated the ${type} interactive for "${title}" (${date}). ` +
        `Wiped slug "${deletedSlug}" (interactive_id: ${deletedInteractiveId}, file: ${deletedFilePath}); ` +
        `audit rows for that id deleted; fresh generate scheduled. ` +
        `The metered result fires as a separate event when generation completes.`,
      context: {
        type: 'interactive_regenerated',
        artefactType: type,
        deletedSlug,
        deletedInteractiveId,
        deletedFilePath,
        changedBy,
      },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Audio pipeline failed somewhere — text is already live, admin
   *  needs to know so they can retry. Escalation severity so it
   *  surfaces in the admin feed next to low-quality publishes. */
  async logAudioFailure(
    date: string,
    title: string,
    phase: 'producer' | 'auditor' | 'publisher',
    reason: string,
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Audio failure: ${title}`,
      body: `Audio ${phase} failed for "${title}" on ${date}. Text is already live. Reason: ${reason}. Retry from admin dashboard.`,
      context: { date, phase, reason },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /**
   * Generic per-LLM-call meter. One info-severity row per Claude call
   * on the mainline path, capturing token usage so cost regressions
   * (input bloat, output bloat, cache misses) surface in the admin
   * observer feed instead of only in the Anthropic console.
   *
   * Used by Curator, Drafter (main draft only — reflection has its own
   * shape via logReflectionMetered), Voice Auditor, Structure Editor,
   * Fact Checker, Integrator, and Learner post-publish. The
   * agent-specific meters (logReflectionMetered / logZitaSynthesisMetered
   * / logCategoriserMetered / logInteractiveGeneratorMetered) keep
   * their narrative shapes; this is for the calls that don't have one.
   *
   * Round is optional — auditors and the Integrator pass the round
   * number so a multi-round pipeline run is forensically traceable.
   * Calls with no round (Curator, Drafter, Learner post-publish) pass
   * undefined.
   *
   * Foundation Fix follow-up (2026-05-10): closes the "mainline calls
   * discard response.usage" gap from the LLM-surface audit.
   */
  async logLLMCall(
    step: string,
    title: string,
    metrics: {
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
      round?: number;
      cacheCreateTokens?: number;
      cacheReadTokens?: number;
    },
    pieceId: string | null = null,
    runId: string | null = null,
  ): Promise<void> {
    const roundNote = metrics.round !== undefined ? ` round=${metrics.round}` : '';
    const cacheNote =
      (metrics.cacheCreateTokens ?? 0) > 0 || (metrics.cacheReadTokens ?? 0) > 0
        ? ` cacheCreate=${metrics.cacheCreateTokens ?? 0} cacheRead=${metrics.cacheReadTokens ?? 0}`
        : '';
    await this.writeEvent({
      severity: 'info',
      title: `LLM ${step}: ${title}`,
      body: `${step}${roundNote} for "${title}" — tokens in=${metrics.tokensIn} out=${metrics.tokensOut}${cacheNote}. Latency: ${metrics.durationMs}ms.`,
      context: { step, ...metrics },
      piece_id: pieceId,
      run_id: runId,
    });
  }

  /** Get recent events for the dashboard */
  async getRecentEvents(limit = 20): Promise<ObserverEvent[]> {
    try {
      const result = await this.env.DB
        .prepare('SELECT * FROM observer_events ORDER BY created_at DESC LIMIT ?')
        .bind(limit)
        .all<ObserverEvent>();
      return result.results;
    } catch {
      return [];
    }
  }

  /** Get daily digest summary */
  async getDailyDigest(): Promise<{
    published: number;
    escalated: number;
    errors: number;
    events: ObserverEvent[];
  }> {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const result = await this.env.DB
        .prepare('SELECT * FROM observer_events WHERE created_at > ? ORDER BY created_at DESC')
        .bind(oneDayAgo)
        .all<ObserverEvent>();

      const events = result.results;
      return {
        published: events.filter((e) => e.severity === 'info').length,
        escalated: events.filter((e) => e.severity === 'escalation').length,
        errors: events.filter((e) => e.severity === 'warn').length,
        events,
      };
    } catch {
      return { published: 0, escalated: 0, errors: 0, events: [] };
    }
  }

  private async writeEvent(event: Omit<ObserverEvent, 'id' | 'created_at'>): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();

    try {
      await this.env.DB
        .prepare(
          `INSERT INTO observer_events (id, severity, title, body, context, piece_id, run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          event.severity,
          event.title,
          event.body,
          JSON.stringify(event.context),
          event.piece_id ?? null,
          event.run_id ?? null,
          now,
        )
        .run();

      this.setState({ eventCount: this.state.eventCount + 1 });
    } catch {
      // Don't let observer logging break the pipeline
    }
  }
}
