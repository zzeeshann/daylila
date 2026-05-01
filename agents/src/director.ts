import { Agent } from 'agents';
import { VoiceAuditorAgent } from './voice-auditor';
import { StructureEditorAgent } from './structure-editor';
import { FactCheckerAgent } from './fact-checker';
import { IntegratorAgent } from './integrator';
import { PublisherAgent } from './publisher';
import { ObserverAgent } from './observer';
import { ScannerAgent } from './scanner';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';
import { AudioProducerAgent, AudioBudgetExceededError } from './audio-producer';
import { AudioAuditorAgent } from './audio-auditor';
import { LearnerAgent } from './learner';
import { CategoriserAgent } from './categoriser';
import { InteractiveGeneratorAgent } from './interactive-generator';
import { getAdminSetting, parseIntervalHours } from './shared/admin-settings';
import { filterDuplicateCandidates } from './shared/dedup-headlines';
import type { Env, DirectorState, DirectorPhase, DailyPieceBrief } from './types';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

const MAX_REVISIONS = 3;

/**
 * DirectorAgent — pure orchestrator.
 *
 * Does NOT call Claude. Does NOT pick stories. Does NOT draft MDX.
 * Only routes work between agents:
 *
 *   Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher
 *
 * Audio runs AFTER the text piece is committed (ship-and-retry —
 * a newspaper never skips a day). Flow: AudioProducer → AudioAuditor
 * → Publisher.publishAudio (second commit splicing audioBeats into
 * frontmatter). Any audio failure is observed + retryable from the
 * admin dashboard; the text piece stays permanent either way.
 *
 * Scheduled at 2:00 AM UTC every day.
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentPhase: null,
    currentTask: null,
    lastDailyPiece: null,
    error: null,
  };

  /**
   * Set up the hourly cron. Cron schedules in the Agents SDK are
   * idempotent on (callback, cron, payload), so calling this on every DO
   * start is safe — duplicates are deduped, not appended.
   *
   * Multi-piece cadence Phase 3: the cron fires every hour; the handler
   * (`dailyRun`) gates on `admin_settings.interval_hours` and bails
   * silently when it's not this slot's turn. At `interval_hours=24`
   * (default) only the 02:00 UTC slot passes the gate, preserving the
   * current 1-piece/day behaviour exactly. Flipping the interval via
   * admin settings changes cadence without a redeploy.
   *
   * Do NOT cancel existing schedules from here. The SDK's alarm() handler
   * runs super.alarm() (which triggers onStart) BEFORE scanning the
   * schedule table for due rows. Cancelling here on an alarm wake-up
   * would delete the very row that just fired, silently swallowing the
   * run. Legacy `'0 2 * * *'` cleanup lives inside `dailyRun` instead —
   * safe because by then the alarm has dispatched.
   */
  async onStart() {
    await this.schedule('0 * * * *', 'dailyRun', { type: 'daily-piece' });
  }

  /**
   * Hourly run — scheduled every hour UTC. Method name stays `dailyRun`
   * (the SDK callback-name-is-method-name coupling means renaming would
   * require schedule-table surgery; the semantic drift is documented
   * here instead). Reads `admin_settings.interval_hours`, computes the
   * hour-2-anchored slot modulo, and bails silently when it's not this
   * slot's turn. Then opportunistically cancels any legacy `'0 2 * * *'`
   * row left behind by the Phase 3 cron migration (idempotent no-op
   * once cleaned up).
   */
  async dailyRun() {
    try {
      // ── Gate: is this slot's hour one we should fire on? ──────────
      // Anchored to hour 2 UTC so the current 02:00 ritual is preserved
      // at any interval. Non-divisors of 24 fall back to 24 inside
      // parseIntervalHours, so `(h-2+24) % 24 === 0` at h=2 only.
      const intervalHours = await getAdminSetting(
        this.env.DB, 'interval_hours', parseIntervalHours, 24
      );
      const hour = new Date().getUTCHours();
      if (((hour - 2 + 24) % intervalHours) !== 0) return;

      // ── One-time migration: cancel legacy '0 2 * * *' cron row. ───
      // Runs inside the handler (not onStart) so the in-flight alarm
      // has already dispatched and re-scheduled. cancelSchedule is
      // idempotent — returns false when the row is already gone.
      // After the first un-gated firing post-deploy this is a no-op.
      // SDK's getSchedules only filters by id/type/timeRange, so we
      // pull all cron rows and match callback+cron client-side.
      try {
        const schedules = this.getSchedules({ type: 'cron' });
        for (const s of schedules) {
          if ((s as { callback?: string; cron?: string }).callback === 'dailyRun'
              && (s as { callback?: string; cron?: string }).cron === '0 2 * * *') {
            await this.cancelSchedule(s.id);
          }
        }
      } catch { /* best-effort cleanup */ }

      await this.triggerDailyPiece();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Daily run failed';
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, message);
    }
  }

  /**
   * Produce one daily teaching piece from today's news.
   *
   * Guard: by default, skips if today's piece already exists (protects the
   * scheduled 2am run from double-publishing on a cron hiccup).
   *
   * @param force — pass true from manual admin triggers to bypass the guard
   *   and always run the full pipeline. Useful during development when you
   *   want to test end-to-end even after today's piece has published.
   */
  async triggerDailyPiece(force = false): Promise<{ brief: DailyPieceBrief; mdx: string } | null> {
    // Keep the Director DO alive across the multi-phase pipeline. Agents
    // SDK documents eviction "after ~70-140s of inactivity" and our text
    // pipeline alone runs ~100-110s — audio always straddled the cliff.
    // `keepAlive()` fires a 30s heartbeat alarm that resets the inactivity
    // timer. Held until the end of the method via the try/finally; the
    // disposer stops the heartbeat so the DO can hibernate normally when
    // we're done. See DECISIONS 2026-04-19 "DO eviction root cause".
    const keepAliveDispose = await this.keepAlive();
    try {
    const today = new Date().toISOString().slice(0, 10);

    // Pre-allocate piece_id at run-start so every logStep + audit row
    // + candidate row carries it from the first write. Scanner-skipped
    // and pre-publish errors leave orphan piece_ids (no matching
    // daily_pieces row); readers that care JOIN on daily_pieces.id to
    // filter. Moved here in 2026-04-22 from its former slot in the
    // publish step so pipeline_log / audit_results / daily_candidates
    // all inherit it without a second pass. The daily_pieces INSERT
    // below still uses this same UUID so identity agrees across all
    // tables. See DECISIONS 2026-04-22 "piece_id columns on day-keyed
    // tables".
    const pieceId = crypto.randomUUID();

    // Cadence config — read above the guard below because the guard's
    // slot-start math depends on intervalHours. Phase 3's hourly-cron
    // gate has already rejected non-slot hours before we reach here.
    const intervalHours = await getAdminSetting(
      this.env.DB, 'interval_hours', parseIntervalHours, 24
    );

    // Guard: skip if a piece has already been published within the
    // current slot (bypassed when force=true). The old shape checked
    // `WHERE date = ?` which worked at 1-piece/day but silently killed
    // every non-first slot at multi-per-day cadence — see DECISIONS
    // 2026-04-22 "Slot-aware guard for multi-per-day cadence". Slot-
    // start is the top of the current UTC hour: Phase 3's gate
    // `(hour - 2 + 24) % intervalHours === 0` guarantees we only reach
    // here on valid slot-boundary hours, so "this hour's minute 00"
    // IS the slot start, regardless of interval. A successful run
    // stamps daily_pieces.published_at to a timestamp within the slot
    // window, so a same-slot re-dispatch catches it.
    if (!force) {
      const now = new Date();
      const slotStartMs = Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
        now.getUTCHours(), 0, 0, 0,
      );
      const existing = await this.env.DB
        .prepare('SELECT id FROM daily_pieces WHERE published_at >= ? LIMIT 1')
        .bind(slotStartMs)
        .first<{ id: string }>();
      if (existing) {
        const observer = await this.subAgent(ObserverAgent, 'observer');
        await observer.logDailyRunSkipped(today, intervalHours, slotStartMs, existing.id);
        return null;
      }
    }

    // ─── Phase 1: Scanner ────────────────────────────────────────────
    this.enterPhase('scanner', `daily/${today}`);
    await this.logStep(today, pieceId,'scanning', 'running', { intervalHours });
    const scanner = await this.subAgent(ScannerAgent, 'scanner');
    const candidates = await scanner.scan(pieceId);
    await this.logStep(today, pieceId,'scanning', 'done', { candidateCount: candidates.length });

    if (candidates.length === 0) {
      await this.logStep(today, pieceId,'skipped', 'done', { reason: 'No candidates found' });
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, 'Scanner found no candidates', pieceId);
      this.exitToIdle();
      return null;
    }

    // ─── Phase 2: Curator ────────────────────────────────────────────
    this.enterPhase('curator');
    await this.logStep(today, pieceId,'curating', 'running', {});
    const curator = await this.subAgent(CuratorAgent, 'curator');
    const recentPieces = await this.getRecentDailyPieces(30);

    // Hard pre-Curator dedup. Curator (Sonnet) keeps picking
    // near-duplicate stories despite multiple prompt-language tightenings
    // (DECISIONS 2026-04-24, 2026-04-27 prompt fix, 2026-04-27
    // architectural fix). Remove duplicates BEFORE Claude sees them.
    // Defensive fallback: if the filter would eat every candidate (the
    // dedup catches everything), pass the original list through to
    // Curator and log a warn — better to risk a duplicate than skip the
    // day silently. With 50 candidates this fallback should never trip.
    const recentHeadlines = recentPieces.map((p) => p.headline);
    const { kept: keptCandidates, filtered: filteredCandidates } =
      filterDuplicateCandidates(candidates, recentHeadlines);

    const observerForFilter = await this.subAgent(ObserverAgent, 'observer');
    if (filteredCandidates.length > 0 && keptCandidates.length > 0) {
      await observerForFilter.logCandidatesFiltered(
        today,
        candidates.length,
        filteredCandidates.length,
        filteredCandidates.map((f) => ({
          candidateHeadline: f.candidate.headline,
          matchedHeadline: f.match.matchedHeadline,
          sharedTokens: f.match.sharedTokens,
        })),
        pieceId,
      );
    }

    const candidatesForCurator = keptCandidates.length > 0 ? keptCandidates : candidates;
    if (filteredCandidates.length > 0 && keptCandidates.length === 0) {
      await observerForFilter.logError(
        'dedup-filter', 0,
        `Headline-overlap dedup would have removed all ${candidates.length} candidates against recent pieces; falling back to unfiltered list (better a possible duplicate than no piece). Investigate the threshold or Scanner output.`,
        pieceId,
      );
    }

    const recentCategoryCounts = await this.getRecentCategoryCounts(30);
    const curatorResult = await curator.curate(candidatesForCurator, recentPieces, recentCategoryCounts);

    if (curatorResult.skip) {
      await this.logStep(today, pieceId,'skipped', 'done', { reason: curatorResult.reason });
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, curatorResult.reason, pieceId);
      this.exitToIdle();
      return null;
    }

    const brief = curatorResult.brief;
    // Director owns the publication date — the brief represents "what to
    // teach," not "when to publish." Overriding here means Drafter's
    // date-force in MDX frontmatter can never drift from Director's run date,
    // regardless of what Claude put in the brief.
    brief.date = today;
    await this.logStep(today, pieceId,'curating', 'done', {
      headline: brief.headline, subject: brief.underlyingSubject, newsSource: brief.newsSource,
    });

    // Mark selected candidate in D1. The UPDATE was previously wrapped in
    // `.catch(() => {})`, which hid both exceptions AND silent 0-row mismatches.
    // As of 2026-04-22 the curator prompt shows candidate UUIDs to Claude so
    // the id returned is a real one; surface both failure modes via Observer
    // so the next regression isn't silent like the 2026-04-21 one was.
    if (curatorResult.selectedCandidateId) {
      try {
        const upd = await this.env.DB
          .prepare('UPDATE daily_candidates SET selected = 1, teachability_score = 100 WHERE id = ?')
          .bind(curatorResult.selectedCandidateId)
          .run();
        if (!upd.meta || upd.meta.changes === 0) {
          const observer = await this.subAgent(ObserverAgent, 'observer');
          await observer.logError(
            'curator', 0,
            `selectedCandidateId ${curatorResult.selectedCandidateId} matched 0 rows in daily_candidates — id shape drift from Curator`,
            pieceId,
          );
        }
      } catch (err) {
        const observer = await this.subAgent(ObserverAgent, 'observer');
        await observer.logError(
          'curator', 0,
          `Failed to mark selected candidate: ${err instanceof Error ? err.message : String(err)}`,
          pieceId,
        );
      }
    } else {
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError(
        'curator', 0,
        `Curator returned no selectedCandidateId — prompt regression or empty candidate list`,
        pieceId,
      );
    }

    // ─── Phase 3: Drafter ────────────────────────────────────────────
    this.enterPhase('drafter');
    await this.logStep(today, pieceId,'drafting', 'running', {});
    const drafter = await this.subAgent(DrafterAgent, 'drafter');
    const { mdx, wordCount } = await drafter.draft(brief);
    await this.logStep(today, pieceId,'drafting', 'done', {
      wordCount, beatCount: brief.beats?.length ?? 0,
    });

    // ─── Phase 4: Auditors (parallel, up to MAX_REVISIONS rounds) ─────
    this.enterPhase('auditors');
    const taskId = `daily/${today}`;
    let currentMdx = mdx;
    let passed = false;
    let lastVoiceScore = 0;
    let totalRounds = 0;
    let failedGates: string[] = [];
    /** Last round's fact-check result, hoisted out of the loop for the
     *  Phase H frontmatter splice (claimReviews → JSON-LD render). The
     *  splice consumes the FINAL round's verified claims, not earlier
     *  rounds, since Integrator may have rewritten the prose in
     *  between. */
    let lastFactResult: import('./fact-checker').FactCheckResult | null = null;

    for (let round = 1; round <= MAX_REVISIONS; round++) {
      totalRounds = round;
      await this.logStep(today, pieceId,`auditing_r${round}`, 'running', { round });
      const [voiceResult, structureResult, factResult] = await Promise.all([
        (await this.subAgent(VoiceAuditorAgent, `voice-daily-r${round}`)).audit(currentMdx),
        (await this.subAgent(StructureEditorAgent, `struct-daily-r${round}`)).review(currentMdx),
        (await this.subAgent(FactCheckerAgent, `fact-daily-r${round}`)).check(currentMdx),
      ]);

      lastFactResult = factResult;

      await this.saveAuditResults(taskId, pieceId, round, voiceResult, structureResult, factResult);

      // "No silent failure" (architecture §3.2): if the fact-checker's
      // web_search tool was unavailable, surface it via Observer. Pipeline
      // continues with whatever Claude could verify from training data,
      // but Zishan needs to know — that fallback is unreliable for the
      // news-anchored claims that dominate daily pieces.
      if (!factResult.searchAvailable) {
        const obs = await this.subAgent(ObserverAgent, 'observer');
        await obs.logError(
          'fact-check',
          0,
          'Anthropic web_search tool unavailable — fact-check fell back to training-data inference',
        ).catch(() => {});
      }

      lastVoiceScore = voiceResult.score ?? 0;
      failedGates = [];
      if (!voiceResult.passed) failedGates.push('voice');
      if (!structureResult.passed) failedGates.push('structure');
      if (!factResult.passed) failedGates.push('facts');

      await this.logStep(today, pieceId,`auditing_r${round}`, failedGates.length === 0 ? 'done' : 'failed', {
        round, voiceScore: lastVoiceScore,
        voicePassed: voiceResult.passed, factsPassed: factResult.passed, structurePassed: structureResult.passed,
        violations: voiceResult.violations?.slice(0, 3),
      });

      if (voiceResult.passed && structureResult.passed && factResult.passed) {
        passed = true;
        break;
      }

      // ─── Integrator: revise if any gate failed ──────────────────────
      if (round < MAX_REVISIONS) {
        this.enterPhase('integrator');
        await this.logStep(today, pieceId,`revising_r${round}`, 'running', { round, failedGates });
        const integrator = await this.subAgent(IntegratorAgent, `integrator-daily-${today}`);
        const revision = await integrator.revise(currentMdx, voiceResult, structureResult, factResult);
        currentMdx = revision.revisedMdx;
        await this.logStep(today, pieceId,`revising_r${round}`, 'done', { round });
        this.enterPhase('auditors'); // back to audit for next round
      }
    }

    // ─── Phase 5: Publisher ──────────────────────────────────────────
    //
    // Publish-anyway on audit failure: previously the else branch stopped
    // here with Director in 'error' state and no piece for the day. A
    // daily-cadence product can't have "no piece" days. Instead, when gates
    // fail after max revisions, we stamp `qualityFlag: "low"` into the MDX
    // frontmatter and publish the best revision we have. Library + recent
    // queries filter it out of the archive; /daily/YYYY-MM-DD/ still
    // renders it with a banner so the day isn't blank. Hard rule intact:
    // we never revise a piece after publish — a low piece is permanent,
    // just filtered from archive views.
    const observer = await this.subAgent(ObserverAgent, 'observer');
    const qualityFlag: 'low' | null = passed ? null : 'low';

    // Splice `voiceScore` into frontmatter for EVERY publish (not only on
    // failure). The reader-facing audit tier (polished / solid / rough)
    // is derived from this number at render time, so it must be present
    // in the MDX whether the piece passed or not. Same regex pattern
    // Drafter uses for `date`.
    currentMdx = currentMdx.replace(
      /^(---\n[\s\S]*?)(\n---\n)/,
      `$1\nvoiceScore: ${lastVoiceScore}$2`,
    );

    // publishedAt captured here (BEFORE the frontmatter splice + publish
    // commit) because it needs to flow into the MDX frontmatter AND into
    // the daily_pieces INSERT below. pieceId was pre-allocated at the
    // top of this method so every earlier logStep / audit row already
    // carries it.
    const publishedAtMs = Date.now();
    currentMdx = currentMdx.replace(
      /^(---\n[\s\S]*?)(\n---\n)/,
      `$1\npublishedAt: ${publishedAtMs}$2`,
    );

    // Splice `pieceId` into frontmatter. Required by the content schema
    // so the made-drawer's fetch to /api/daily/[date]/made can pass
    // piece_id directly — required at multi-per-day to avoid pooling
    // learnings across same-date pieces (the last multi-per-day
    // correctness blocker before safely flipping interval_hours). Uses
    // the same UUID that drives the daily_pieces INSERT below so the
    // two sources agree on identity. See DECISIONS 2026-04-22
    // "writeLearning piece_id extension".
    currentMdx = currentMdx.replace(
      /^(---\n[\s\S]*?)(\n---\n)/,
      `$1\npieceId: "${pieceId}"$2`,
    );

    // Splice `sourceUrl` into frontmatter from the picked candidate.
    // daily_candidates.url is the only place the source URL lands —
    // never propagated through DailyPieceBrief / daily_pieces. Reader-
    // side link surfaces in the meta line (LessonLayout). Pre-2026-04-22
    // pieces have no reliably resolvable URL (selectedCandidateId fix
    // in 6999c5e); skip silently when missing.
    if (curatorResult.selectedCandidateId) {
      try {
        const sourceUrlRow = await this.env.DB
          .prepare('SELECT url FROM daily_candidates WHERE id = ? LIMIT 1')
          .bind(curatorResult.selectedCandidateId)
          .first<{ url: string | null }>();
        const sourceUrl = sourceUrlRow?.url?.trim();
        if (sourceUrl) {
          currentMdx = currentMdx.replace(
            /^(---\n[\s\S]*?)(\n---\n)/,
            `$1\nsourceUrl: ${JSON.stringify(sourceUrl)}$2`,
          );
        }
      } catch {
        // Fail-quiet: missing source link is acceptable, blocking the
        // publish over a metadata read isn't.
      }
    }

    // Splice `claimReviews` into frontmatter (Phase H, 2026-04-30).
    // Just the verified claim text strings — JSON-LD ClaimReview render
    // in BaseLayout consumes them. Path A (2026-05-01) reverted Phase
    // A's per-claim {claim, sources} object shape; the drawer reads
    // citation URLs directly from audit_results.notes (where the agent's
    // flat result.sources is persisted). Sanity cap at 20.
    if (lastFactResult && lastFactResult.claims.length > 0) {
      const verifiedClaims = lastFactResult.claims
        .filter((c) => c.status === 'verified')
        .map((c) => c.claim)
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 20);
      if (verifiedClaims.length > 0) {
        currentMdx = currentMdx.replace(
          /^(---\n[\s\S]*?)(\n---\n)/,
          `$1\nclaimReviews: ${JSON.stringify(verifiedClaims)}$2`,
        );
      }
    }

    if (!passed) {
      // Splice `qualityFlag: "low"` into the frontmatter too. No longer
      // drives archive filtering (see 2026-04-17 soften-quality decision)
      // but kept as a fallback signal for the tier helper and for
      // admin/operator tooling.
      currentMdx = currentMdx.replace(
        /^(---\n[\s\S]*?)(\n---\n)/,
        `$1\nqualityFlag: "low"$2`,
      );
      // Log escalation — Zishan still needs to know when a piece shipped
      // low. Publisher runs after this so the Observer entry exists
      // regardless of whether the git commit succeeds.
      await observer.logEscalation('daily', 0, brief.headline, lastVoiceScore, totalRounds, failedGates, pieceId);
    }

    this.enterPhase('publisher');
    await this.logStep(today, pieceId,'publishing', 'running', { qualityFlag });
    const publisher = await this.subAgent(PublisherAgent, `publisher-daily-${today}`);
    const slug = brief.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const filePath = `content/daily-pieces/${today}-${slug}.mdx`;
    const commitMsg = passed
      ? `feat(daily): ${today} — ${brief.headline}`
      : `feat(daily): ${today} — ${brief.headline} [tier: rough, unresolved: ${failedGates.join('/')}]`;

    const publishResult = await publisher.publishToPath(filePath, currentMdx, commitMsg);

    // Log to daily_pieces table. fact_check_passed reflects the last
    // audit round, not an assumption. `pieceId` + `publishedAtMs` were
    // captured earlier (before the frontmatter splice) so identity +
    // timestamp agree between MDX and D1.
    const factsPassed = failedGates.includes('facts') ? 0 : 1;
    // Use Drafter's wordCount (captured at draft time, before Director's
    // frontmatter splices added ~6 tokens for voiceScore/pieceId/publishedAt).
    // Prior shape re-computed `currentMdx.split(/\s+/).length` here which
    // inflated the count and drifted from the `drafting done` pipeline_log
    // step. One source of truth: Drafter's value.
    await this.env.DB
      .prepare(
        `INSERT INTO daily_pieces (id, date, headline, underlying_subject, source_story, word_count, beat_count, voice_score, fact_check_passed, quality_flag, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(pieceId, today, brief.headline, brief.underlyingSubject, brief.newsSource ?? '',
        wordCount, brief.beats?.length ?? 0, lastVoiceScore, factsPassed, qualityFlag, publishedAtMs, publishedAtMs)
      .run().catch(() => {});

    await this.logStep(today, pieceId,'publishing', 'done', { commitUrl: publishResult.commitUrl, filePath: publishResult.filePath, qualityFlag });
    await this.logStep(today, pieceId,'done', 'done', {
      headline: brief.headline,
      date: today,
      voiceScore: lastVoiceScore,
      revisions: totalRounds - 1,
      qualityFlag,
      ...(passed ? {} : { failedGates }),
    });

    // Observer notification — differentiated so the admin feed shows a
    // low-quality publish distinctly from a clean one (escalation already
    // logged above in the !passed branch).
    if (passed) {
      await observer.logPublished('daily', 0, brief.headline, lastVoiceScore, totalRounds - 1, publishResult.commitUrl, pieceId);
    }

    // ─── Post-publish producer-side learning (P1.3, off-pipeline) ────
    // Right after publishing done, kick the Learner to read the full
    // quality record and write producer-origin rows into `learnings`
    // for tomorrow's Drafter to see. Scheduled (not awaited) so it
    // never blocks the ship. Non-retriable by design — if it fails,
    // the scheduled method logs to observer_events and moves on. Fires
    // before the audio schedule so alarm ordering is deterministic.
    await this.schedule(1, 'analyseProducerSignalsScheduled', {
      pieceId,
      date: today,
      title: brief.headline,
    });

    // ─── Post-publish self-reflection (P1.4, off-pipeline) ───────────
    // Drafter reviews the final MDX as a peer editor would — captures
    // the "what felt thin / what would I do differently" signal that
    // writers normally lose. Writes source='self-reflection' learnings
    // that compound with producer + reader signals in the same feed.
    // Metered on each run so cost/latency drift is visible before it
    // matters. Same off-pipeline + non-retriable posture as the
    // Learner. Brief is carried in the payload (small) so the
    // reflection prompt has the original ask alongside the MDX.
    await this.schedule(1, 'reflectOnPieceScheduled', {
      pieceId,
      date: today,
      title: brief.headline,
      filePath: publishResult.filePath,
      brief,
    });

    // ─── Post-publish Zita-question synthesis (P1.5, off-pipeline) ──
    // Unlike producer + self-reflection above (both fire at publish+1s
    // because they analyse signals complete at publish), Zita synthesis
    // needs a full day of reader traffic to accumulate against this
    // piece. Schedule as a RELATIVE delay of publish+23h45m — each
    // piece gets its own synthesis window rather than stacking on an
    // absolute clock target. Critical at multi-per-day: the old
    // absolute-01:45-UTC-day+1 target would have queued N pieces'
    // synthesis jobs on one clock, and same-date pieces published at
    // 14:00 UTC would only get ~12h of reader window before firing.
    // Relative delay gives every piece the same ~24h window regardless
    // of publish time. Guarded inside Learner by a ≥5 user-message
    // threshold; a piece with thin traffic logs a skipped info event
    // and fires no Claude call. See DECISIONS 2026-04-21 "Zita
    // synthesis timing — per-piece relative delay (Phase 6)".
    const ZITA_SYNTHESIS_DELAY_SECONDS = 23 * 60 * 60 + 45 * 60; // 85500s
    await this.schedule(ZITA_SYNTHESIS_DELAY_SECONDS, 'analyseZitaPatternsScheduled', {
      pieceId,
      date: today,
      title: brief.headline,
    });

    // ─── Post-publish categorisation (14th agent, off-pipeline) ──────
    // Fires immediately after publishing done, same shape as producer
    // learnings + self-reflection. Categoriser assigns 1–3 categories
    // to the piece — strongly biased toward reusing the existing
    // taxonomy. Non-blocking, non-retriable: a failure logs to
    // observer_events and moves on. The filePath is in the payload so
    // the alarm callback can re-read the committed MDX from GitHub
    // (same pattern as reflectOnPieceScheduled — keeps scheduled-row
    // payloads small). See DECISIONS 2026-04-23 (late evening) "Area
    // 2 sub-task 2.2 — CategoriserAgent".
    await this.schedule(1, 'categoriseScheduled', {
      pieceId,
      date: today,
      title: brief.headline,
      filePath: publishResult.filePath,
    });

    // ─── Post-publish interactive generation (15th agent, off-pipeline) ─
    // Same shape as Categoriser: fires 1s after publishing done in a
    // fresh DO invocation, re-reads the MDX from GitHub inside the
    // alarm handler (keeps scheduled-row payload small), fail-silent
    // on error (piece is live regardless; no interactive is the
    // degraded-but-fine state). Sub-task 4.5 wraps the Generator's
    // output with an Auditor's voice/essence/fact gate — that work
    // plugs into this same alarm path without moving the schedule.
    // See DECISIONS 2026-04-24 "Area 4 sub-task 4.4 — InteractiveGeneratorAgent".
    await this.schedule(1, 'generateInteractiveScheduled', {
      pieceId,
      date: today,
      title: brief.headline,
      filePath: publishResult.filePath,
    });

    // ─── Audio pipeline (ship-and-retry, text already live) ──────────
    // Schedule audio to run in an alarm-triggered invocation instead of
    // inline. Cloudflare docs: HTTP-triggered DO invocations get evicted
    // after ~30s of compute between incoming network requests (our text
    // phase alone is ~100s, making the audio tail unsafe). Alarm handlers
    // have a separate 15-minute wall-clock budget and are a fresh DO
    // invocation — exactly the boundary we need. The text piece is
    // already permanent either way; audio is ship-and-retry. See
    // DECISIONS 2026-04-19 "Audio via alarm, not inline".
    await this.schedule(2, 'runAudioPipelineScheduled', {
      pieceId,
      date: today,
      filePath: publishResult.filePath,
      title: brief.headline,
    });

    this.setState({
      ...this.state, status: 'idle', currentPhase: null, currentTask: null,
      lastDailyPiece: { title: brief.headline, date: today },
    });

    return { brief, mdx: currentMdx };
    } finally {
      keepAliveDispose();
    }
  }

  /**
   * Alarm callback — runs the Learner's post-publish producer analysis
   * in a fresh DO invocation, off the main publishing path. Scheduled
   * by `triggerDailyPiece` right after `publishing done`.
   *
   * Non-retriable by design: if anything throws (DB read, Claude call,
   * JSON parse), we log to observer_events and return. The piece is
   * already live; a missed iteration of the learning loop isn't
   * catastrophic and retry logic is exactly the kind of defensive
   * plumbing that turns into mystery failures later.
   *
   * Overflow handling: Learner caps writes at PRODUCER_LEARNINGS_WRITE_CAP
   * and returns the overflow count. If non-zero, we log a visibility
   * warn — usually a signal that the analysis restated one pattern
   * multiple ways and the prompt needs tightening.
   */
  async analyseProducerSignalsScheduled(payload: {
    pieceId: string;
    date: string;
    title: string;
  }): Promise<void> {
    const { pieceId, date, title } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const learner = await this.subAgent(LearnerAgent, 'learner');
      const result = await learner.analysePiecePostPublish(pieceId, date);
      if (result.overflowCount > 0) {
        await observer
          .logLearnerOverflow(date, title, result.written, result.overflowCount, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logLearnerFailure(date, title, reason, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Alarm callback — runs Learner's Zita-question synthesis in a
   * fresh DO invocation 01:45 UTC on day+1. Scheduled by
   * `triggerDailyPiece` right after `publishing done`, but with a
   * 23-hour-ish delay to let a full day of reader traffic accumulate
   * against this piece.
   *
   * Non-retriable on failure (same posture as analyseProducerSignals
   * and reflect). On skip (insufficient reader traffic) or success,
   * logs a single metered info event so cost / skip-rate drift is
   * visible over time.
   */
  async analyseZitaPatternsScheduled(payload: {
    pieceId: string;
    date: string;
    title: string;
  }): Promise<void> {
    const { pieceId, date, title } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const learner = await this.subAgent(LearnerAgent, 'learner');
      const result = await learner.analyseZitaPatternsDaily(pieceId, date);
      await observer
        .logZitaSynthesisMetered(date, title, result, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logZitaSynthesisFailure(date, title, reason, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Alarm callback — runs the Drafter's post-publish self-reflection
   * in a fresh DO invocation. Scheduled by `triggerDailyPiece` right
   * after `publishing done` alongside the Learner's producer analysis.
   *
   * Re-reads the committed MDX from GitHub rather than carrying it in
   * the payload — keeps the scheduled payload small. The brief IS in
   * the payload (a few KB) because the reflection prompt wants the
   * original ask alongside what was produced.
   *
   * Non-retriable on failure: logs to observer_events and returns.
   * On success, logs a single metered info event with
   * tokens-in/out + latency so cost drift is visible over time.
   */
  async reflectOnPieceScheduled(payload: {
    pieceId: string;
    date: string;
    title: string;
    filePath: string;
    brief: DailyPieceBrief;
  }): Promise<void> {
    const { pieceId, date, title, filePath, brief } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
      const current = await publisher.readPublishedMdx(filePath);
      if (!current) {
        console.error(`reflectOnPieceScheduled: MDX not found at ${filePath} for ${date}`);
        await observer
          .logReflectionFailure(date, title, `MDX not found at ${filePath}`, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
        return;
      }
      const drafter = await this.subAgent(DrafterAgent, 'drafter');
      const result = await drafter.reflect(brief, current.mdx, date, pieceId);
      await observer
        .logReflectionMetered(date, title, result, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logReflectionFailure(date, title, reason, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Alarm callback — runs the Categoriser on a just-published piece
   * in a fresh DO invocation. Scheduled by `triggerDailyPiece` right
   * after `publishing done`, same shape as the Learner + self-
   * reflection schedules.
   *
   * Re-reads the committed MDX from GitHub rather than carrying it
   * in the payload — keeps scheduled-row payloads small. Idempotence
   * is belt-and-braces: the agent's internal guard returns
   * `skipped: true` if the piece already has piece_categories rows,
   * and the composite PK on piece_categories blocks duplicate rows
   * underneath that.
   *
   * Non-retriable on failure (same posture as analyseProducerSignals
   * and reflect): Director catches, logs via observer, moves on. The
   * piece is live; a missed categorisation just means the library
   * filter won't surface this piece under a category until a manual
   * retag (via the seed script or the admin UI in sub-task 2.5).
   */
  async categoriseScheduled(payload: {
    pieceId: string;
    date: string;
    title: string;
    filePath: string;
  }): Promise<void> {
    const { pieceId, date, title, filePath } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
      const current = await publisher.readPublishedMdx(filePath);
      if (!current) {
        await observer
          .logCategoriserFailure(date, title, `MDX not found at ${filePath}`, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
        return;
      }
      const categoriser = await this.subAgent(CategoriserAgent, 'categoriser');
      const result = await categoriser.categorise(pieceId, date, current.mdx);
      // Retry breadcrumb fires whenever the first Claude call returned
      // empty/all-sub-floor — info severity, doesn't replace the
      // terminal log.
      if (result.retried && result.retryReason) {
        await observer
          .logCategoriserRetried(
            date,
            title,
            {
              reason: result.retryReason,
              consideredFirst: result.consideredFirst,
              tokensInFirst: result.tokensInFirst,
              tokensOutFirst: result.tokensOutFirst,
            },
            pieceId,
          )
          .catch(() => { /* observer write failure never blocks */ });
      }
      // Terminal log — fallback (warn) replaces the regular metered
      // event when both attempts produced nothing usable. Otherwise
      // the metered (info) path fires as before.
      if (result.fallbackFired) {
        await observer
          .logCategoriserFallback(
            date,
            title,
            {
              tokensInTotal: result.tokensIn,
              tokensOutTotal: result.tokensOut,
              durationMs: result.durationMs,
            },
            pieceId,
          )
          .catch(() => { /* observer write failure never blocks */ });
      } else {
        await observer
          .logCategoriserMetered(date, title, result, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logCategoriserFailure(date, title, reason, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Schedule a fresh InteractiveGenerator run for a piece. Used by
   * the manual retry endpoint at `/interactive-generate-trigger` to
   * give the work a full 15-minute alarm budget — the same posture as
   * the post-publish auto-trigger and the destructive regenerate path.
   *
   * Pre-2026-04-30: the manual retry endpoint called
   * `generateInteractiveScheduled` directly via subAgent RPC from the
   * HTTP handler's `ctx.waitUntil()`. That ran the entire produce →
   * audit → revise → publish chain inside the HTTP-request worker
   * context, which is bounded by Cloudflare Workers' subrequest
   * wall-clock budget. The 2026-04-30 Voting Rights Act regenerate
   * surfaced this: 3 rounds × ~30s/round = ~90s, well past budget,
   * causing partial Claude responses to look like parse-fails AND
   * cutting HTML off mid-flight after quiz commit. Auto-cron and
   * destructive regenerate were unaffected because both already used
   * `this.schedule()` for the alarm budget.
   *
   * This method just queues the alarm and returns — no work happens in
   * the caller's context. Returns immediately.
   */
  async requestInteractiveGenerate(payload: {
    pieceId: string;
    date: string;
    title: string;
    filePath: string;
  }): Promise<void> {
    await this.schedule(1, 'generateInteractiveScheduled', payload);
  }

  /**
   * Alarm callback — runs the InteractiveGenerator on a just-published
   * piece. Scheduled by `triggerDailyPiece` after `publishing done`,
   * same posture as `categoriseScheduled` / `reflectOnPieceScheduled`.
   *
   * Generator depends on `piece_categories` being populated — the
   * 1-second schedule delay for BOTH `categoriseScheduled` and this
   * means they fire in a deterministic-ish order (same alarm tick).
   * If Categoriser hasn't landed yet the Generator still runs; the
   * diversity context just lacks category hints for one iteration.
   * Acceptable — the essence-not-reference rule doesn't depend on
   * categories; they're a nudge, not a requirement.
   *
   * Non-retriable on failure (same posture as Categoriser + Drafter
   * .reflect): catches, logs via observer, moves on. Piece is live.
   * Manual retry via POST /interactive-generate-trigger.
   */
  async generateInteractiveScheduled(payload: {
    pieceId: string;
    date: string;
    title: string;
    filePath: string;
  }): Promise<void> {
    const { pieceId, date, title, filePath } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
      const current = await publisher.readPublishedMdx(filePath);
      if (!current) {
        await observer
          .logInteractiveGeneratorFailure(date, title, `MDX not found at ${filePath}`, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
        return;
      }
      const generator = await this.subAgent(InteractiveGeneratorAgent, 'interactive-generator');
      const result = await generator.generate(pieceId, date, current.mdx);
      await observer
        .logInteractiveGeneratorMetered(
          date,
          title,
          {
            htmlEnabled: result.htmlEnabled,
            quiz: result.quiz,
            html: result.html,
            totalDurationMs: result.durationMs,
          },
          pieceId,
        )
        .catch(() => { /* observer write failure never blocks */ });
      // 2026-04-30 hardening — emit one info-severity breadcrumb per
      // round that returned non-JSON output. Loop already retried
      // within the 3-round budget; these events make the recovery
      // visible in the admin feed without firing as warns.
      for (const pf of result.quiz.parseFailures) {
        await observer
          .logInteractiveGeneratorParseFail(date, title, 'quiz', pf.round, pieceId)
          .catch(() => { /* observer write failure never blocks */ });
      }
      if (result.html) {
        for (const pf of result.html.parseFailures) {
          await observer
            .logInteractiveGeneratorParseFail(date, title, 'html', pf.round, pieceId)
            .catch(() => { /* observer write failure never blocks */ });
        }
      }
      // 2026-04-30 PM — per-artefact failure events. generate() now
      // catches loop throws so a quiz failure doesn't block HTML;
      // the captured reason lands in result.{quiz,html}.errorMessage.
      // Each populates a separate logInteractiveGeneratorFailure warn
      // so the admin feed shows the per-type terminal state rather
      // than a single ambiguous warn that hides whichever path ran.
      if (result.quiz.errorMessage) {
        await observer
          .logInteractiveGeneratorFailure(
            date,
            `${title} (quiz)`,
            result.quiz.errorMessage,
            pieceId,
          )
          .catch(() => { /* observer write failure never blocks */ });
      }
      if (result.html?.errorMessage) {
        await observer
          .logInteractiveGeneratorFailure(
            date,
            `${title} (html)`,
            result.html.errorMessage,
            pieceId,
          )
          .catch(() => { /* observer write failure never blocks */ });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logInteractiveGeneratorFailure(date, title, reason, pieceId)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Operator-triggered destructive regeneration of one interactive
   * artefact for a piece. Used by `/interactive-regenerate-trigger`
   * (Phase 3 sub-task 3.3 of Interactives v3).
   *
   * Flow:
   *   1. Resolve piece (date + title from `daily_pieces`).
   *   2. Resolve target interactive row (by source_piece_id + type).
   *   3. (HTML only) Refuse if `interactives_html_enabled = false` —
   *      avoids the silent no-op where Generator skips the html path.
   *   4. Delete the file from GitHub (Publisher.deleteInteractiveFile,
   *      scoped to `content/interactives/`).
   *   5. Delete D1 rows: `interactive_audit_results` for the id, then
   *      the `interactives` row.
   *   6. (Quiz only) Clear `daily_pieces.interactive_id` so the
   *      Generator's quiz-path idempotence guard treats this as fresh.
   *   7. Log the regeneration as an info-severity observer event.
   *   8. Schedule `generateInteractiveScheduled` on a 1s alarm — fresh
   *      DO invocation runs the produce → audit → revise loop end-to-
   *      end. The metered result fires as a separate observer event
   *      when generation completes.
   *
   * Slug behaviour: a quiz-only regen MAY produce a different slug
   * if Claude returns a different proposal from the same source piece,
   * which would break the quiz/html shared-slug invariant. v1 accepts
   * this edge case; a `slugLock` parameter is the v2 enhancement if
   * drift becomes an operational concern. HTML-only regen never
   * drifts because the html path's `existingQuiz` lookup pins the
   * slug to the still-present quiz row.
   *
   * Failure posture: any step that throws bubbles up — caller is the
   * operator, who needs to see the failure and retry. NOT silent.
   * The fresh-generation alarm follows its own non-retriable posture
   * (the 4.5 ship-as-low + abandon-on-validator-fail behaviour).
   */
  async regenerateInteractive(payload: {
    pieceId: string;
    type: 'quiz' | 'html';
    changedBy: string;
  }): Promise<{
    ok: true;
    pieceId: string;
    type: 'quiz' | 'html';
    deletedSlug: string;
    deletedInteractiveId: string;
    deletedFilePath: string;
  }> {
    const { pieceId, type, changedBy } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');

    // Resolve piece.
    const piece = await this.env.DB
      .prepare('SELECT id, date, headline FROM daily_pieces WHERE id = ?')
      .bind(pieceId)
      .first<{ id: string; date: string; headline: string }>();
    if (!piece) {
      throw new Error(`regenerateInteractive: piece ${pieceId} not found`);
    }
    // Derive the piece's MDX path the same way Director does at publish
    // time (no `daily_pieces.file_path` column; algorithm is stable
    // under the permanence rule that prevents headline edits).
    const pieceSlug = piece.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const pieceFilePath = `content/daily-pieces/${piece.date}-${pieceSlug}.mdx`;

    // Resolve target interactive.
    const target = await this.env.DB
      .prepare(
        `SELECT id, slug, title FROM interactives
         WHERE source_piece_id = ? AND type = ? LIMIT 1`,
      )
      .bind(pieceId, type)
      .first<{ id: string; slug: string; title: string }>();
    if (!target) {
      throw new Error(
        `regenerateInteractive: no ${type} interactive found for piece ${pieceId}`,
      );
    }

    // HTML guard: refuse if flag is off (would silently no-op otherwise).
    if (type === 'html') {
      const htmlEnabled = await getAdminSetting<boolean>(
        this.env.DB,
        'interactives_html_enabled',
        (raw) => raw === 'true',
        false,
      );
      if (!htmlEnabled) {
        throw new Error(
          `regenerateInteractive: interactives_html_enabled is false. Flip it on /dashboard/admin/settings/ before regenerating an HTML interactive.`,
        );
      }
    }

    // Compute file path. quiz → <slug>.json; html → <slug>-html.json.
    const fileName = type === 'html' ? `${target.slug}-html.json` : `${target.slug}.json`;
    const filePath = `content/interactives/${fileName}`;

    // Delete file FIRST. If this fails (rate limit, auth), bail before
    // the D1 wipe so D1 + repo stay consistent. The 404 case is a
    // no-op inside deleteInteractiveFile.
    const publisher = await this.subAgent(
      PublisherAgent,
      `interactive-regen-${target.slug}-${type}`,
    );
    await publisher.deleteInteractiveFile(
      filePath,
      `chore(interactives): regenerate ${target.title} (${target.slug}) [${type}]`,
    );

    // Delete D1 rows.
    await this.env.DB
      .prepare('DELETE FROM interactive_audit_results WHERE interactive_id = ?')
      .bind(target.id)
      .run();
    await this.env.DB
      .prepare('DELETE FROM interactives WHERE id = ?')
      .bind(target.id)
      .run();

    // Clear daily_pieces.interactive_id only on quiz regen (the column
    // is the quiz pointer per pre-Phase-2 semantics; HTML regen leaves
    // it alone so the quiz row's invariant doesn't break).
    if (type === 'quiz') {
      await this.env.DB
        .prepare('UPDATE daily_pieces SET interactive_id = NULL WHERE id = ?')
        .bind(pieceId)
        .run();
    }

    // Audit-trail event.
    await observer
      .logInteractiveRegenerated(
        piece.date,
        piece.headline,
        type,
        target.slug,
        target.id,
        filePath,
        changedBy,
        pieceId,
      )
      .catch(() => { /* observer write failure never blocks */ });

    // Schedule fresh generation. Same payload shape as the
    // post-publish auto-trigger so generateInteractiveScheduled
    // doesn't need to know it's a regen.
    await this.schedule(1, 'generateInteractiveScheduled', {
      pieceId,
      date: piece.date,
      title: piece.headline,
      filePath: pieceFilePath,
    });

    return {
      ok: true,
      pieceId,
      type,
      deletedSlug: target.slug,
      deletedInteractiveId: target.id,
      deletedFilePath: filePath,
    };
  }

  /**
   * Alarm callback — runs the audio pipeline in a fresh DO invocation.
   *
   * Invoked by the Agents SDK scheduler after `triggerDailyPiece` (or
   * `retryAudio`) calls `this.schedule(1, 'runAudioPipelineScheduled',
   * payload)`. Running under an alarm gives us up to 15 minutes of wall
   * time — plenty for all 6-12 beats × ~10-15s each of ElevenLabs
   * latency, well clear of the ~30s compute-between-requests eviction
   * risk that hits HTTP-triggered invocations.
   *
   * Re-reads the committed MDX from GitHub rather than carrying it in
   * the payload — scheduled payloads live in SQLite and stay small.
   */
  async runAudioPipelineScheduled(payload: {
    pieceId: string;
    date: string;
    filePath: string;
    title: string;
  }): Promise<void> {
    const { pieceId, date, filePath, title } = payload;

    // Arm a silent-stall watchdog — 12min gives the outer alarm (15min
    // wall budget) 3min of head-room. If the audio pipeline exceeds
    // its budget mid-ElevenLabs-call, Cloudflare terminates the alarm
    // and nothing throws; without this watchdog there's no signal to
    // the admin feed that anything went wrong. See DECISIONS 2026-04-22
    // "12-min watchdog alarm for silent audio stalls". `checkAudioStalled`
    // is a no-op when has_audio=1 (pipeline completed normally) or
    // when an audio-failure event already fired since `armedAt`.
    await this.schedule(12 * 60, 'checkAudioStalled', {
      pieceId,
      date,
      title,
      armedAt: Date.now(),
    });

    const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
    const current = await publisher.readPublishedMdx(filePath);
    if (!current) {
      // Piece was deleted or renamed between scheduling and firing —
      // nothing to do. Log it and exit cleanly.
      console.error(`runAudioPipelineScheduled: MDX not found at ${filePath} for ${date}`);
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logAudioFailure(
        date,
        title,
        'producer',
        `Scheduled audio skipped — MDX not found at ${filePath}`,
        pieceId,
      );
      return;
    }

    await this.runAudioPipeline(pieceId, date, current.mdx, filePath, title);
  }

  /**
   * Silent-stall watchdog. Scheduled 12 min after `runAudioPipelineScheduled`
   * begins. If `has_audio=1` by the time this fires, the pipeline
   * completed normally — no-op. If any `Audio failure` observer_event
   * for this pieceId fired since `armedAt`, the pipeline already
   * reported its failure — no-op. Otherwise: the pipeline stopped
   * executing without completing or reporting — emit `logAudioFailure`
   * so the operator knows to manually retry.
   *
   * Root cause addressed: ElevenLabs per-attempt timeout is 90s × up
   * to 3 attempts + backoffs ≈ 273s worst case per beat. A piece with
   * 8 beats at 2/chunk × up to ~273s-ish/beat can exceed the 15-min
   * alarm wall budget. Cloudflare terminates the invocation; nothing
   * throws; no observer event fires. This watchdog makes the stall
   * visible instead of silent. See FOLLOWUPS 2026-04-19
   * "Audio pipeline silent stall between alarm chunks" for history.
   */
  async checkAudioStalled(payload: {
    pieceId: string;
    date: string;
    title: string;
    armedAt: number;
  }): Promise<void> {
    const { pieceId, date, title, armedAt } = payload;

    // (1) If has_audio=1, the pipeline completed normally before the
    // watchdog fired. No-op.
    const piece = await this.env.DB
      .prepare('SELECT has_audio FROM daily_pieces WHERE id = ? LIMIT 1')
      .bind(pieceId)
      .first<{ has_audio: number }>();
    if (piece?.has_audio === 1) return;

    // (2) If an audio-failure observer_event for this pieceId fired
    // since `armedAt`, the pipeline already reported its failure. No-op.
    // (Covers Producer/Auditor/Publisher explicit failures that the
    // runAudioPipeline try/catch paths emit.)
    const failureRow = await this.env.DB
      .prepare(
        `SELECT id FROM observer_events
         WHERE piece_id = ? AND title LIKE 'Audio failure:%' AND created_at >= ?
         LIMIT 1`,
      )
      .bind(pieceId, armedAt)
      .first();
    if (failureRow) return;

    // (3) Silent stall — pipeline exceeded the 12-min watchdog with
    // no completion and no failure event. Surface as escalation so
    // operator can manually retry from the admin dashboard.
    const observer = await this.subAgent(ObserverAgent, 'observer');
    await observer.logAudioFailure(
      date,
      title,
      'producer',
      `Silent stall — audio pipeline exceeded 12min watchdog with no completion or failure event. Manual retry likely required.`,
      pieceId,
    );
  }

  /**
   * Run the audio pipeline AFTER the text piece has been committed.
   *
   * Ship-and-retry semantics: any failure here is logged to Observer
   * as an escalation and returns cleanly. Text stays live regardless.
   * Admin can retry audio from the dashboard (Phase 7).
   *
   * Flow: audio-producer → audio-auditor → audio-publisher (second
   * commit splicing audioBeats into MDX frontmatter). audioBeats is
   * metadata, not content — the "published pieces are permanent"
   * rule governs teaching content, not frontmatter metadata like
   * voiceScore or audioBeats.
   */
  private async runAudioPipeline(
    pieceId: string,
    date: string,
    mdx: string,
    filePath: string,
    title: string,
  ): Promise<void> {
    const observer = await this.subAgent(ObserverAgent, 'observer');

    // ─── audio-producer (chunked) ───────────────────────────────────
    // Single-call producer blew the ~30s DO RPC ceiling once pieces got
    // to ~3+ beats (ElevenLabs 10-15s/beat × 6 beats > 30s). Now we
    // call producer.generateAudioChunk in a bounded loop — each call
    // processes at most MAX_BEATS_PER_CHUNK new beats, stays well under
    // the ceiling, and persists rows incrementally. The loop ends when
    // D1's row count reaches `totalBeats`. See DECISIONS 2026-04-19
    // "Audio RPC wall-clock budget" for why chunking over alarms.
    const MAX_BEATS_PER_CHUNK = 2;
    const MAX_CHUNK_ITERATIONS = 10; // safety belt for runaway loops
    this.enterPhase('audio-producer');
    await this.logStep(date, pieceId,'audio-producing', 'running', {});
    let totalBeats = 0;
    let totalCharacters = 0;
    let chunkIterations = 0;
    try {
      const producer = await this.subAgent(AudioProducerAgent, `audio-producer-${date}`);
      while (true) {
        if (++chunkIterations > MAX_CHUNK_ITERATIONS) {
          throw new Error(
            `Audio pipeline exceeded ${MAX_CHUNK_ITERATIONS} chunk iterations — likely stuck`,
          );
        }
        const chunk = await producer.generateAudioChunk({ pieceId, date }, mdx, MAX_BEATS_PER_CHUNK);
        totalBeats = chunk.totalBeats;
        totalCharacters = chunk.totalCharacters;
        if (chunk.completedCount >= totalBeats) break;
        if (chunk.processedBeats.length === 0) {
          // No progress and still incomplete — producer is stuck
          throw new Error(
            `Producer made no progress at ${chunk.completedCount}/${totalBeats} beats`,
          );
        }
      }
    } catch (err) {
      const reason = err instanceof AudioBudgetExceededError
        ? `Over ${err.cap}-char cap (would spend ${err.totalChars} chars)`
        : err instanceof Error ? err.message : 'Producer failed';
      await this.logStep(date, pieceId,'audio-producing', 'failed', { reason });
      await observer.logAudioFailure(date, title, 'producer', reason, pieceId);
      return;
    }
    await this.logStep(date, pieceId,'audio-producing', 'done', {
      beatCount: totalBeats,
      totalCharacters,
      durationEstimate: Math.round((totalCharacters / 5 / 150) * 60),
      chunks: chunkIterations,
    });

    // ─── audio-auditor ──────────────────────────────────────────────
    this.enterPhase('audio-auditor');
    await this.logStep(date, pieceId,'audio-auditing', 'running', {});
    const auditor = await this.subAgent(AudioAuditorAgent, `audio-auditor-${date}`);
    const auditResult = await auditor.audit({ pieceId, date });
    await this.logStep(date, pieceId,'audio-auditing', auditResult.passed ? 'done' : 'failed', {
      passed: auditResult.passed,
      beatCount: auditResult.beatCount,
      totalCharacters: auditResult.totalCharacters,
      totalSizeBytes: auditResult.totalSizeBytes,
      issueCount: auditResult.issues.length,
      majorIssues: auditResult.issues.filter((i) => i.severity === 'major').map((i) => i.issue),
    });
    if (!auditResult.passed) {
      const majorReasons = auditResult.issues
        .filter((i) => i.severity === 'major')
        .map((i) => i.issue)
        .join('; ');
      await observer.logAudioFailure(date, title, 'auditor', majorReasons, pieceId);
      return;
    }

    // ─── audio-publisher (second commit) ────────────────────────────
    // Source of truth for the audioBeats map is D1 — covers the full
    // set of beats regardless of how many chunks produced them, plus
    // any beats from prior partial runs picked up via R2 head-check.
    this.enterPhase('audio-publisher');
    await this.logStep(date, pieceId,'audio-publishing', 'running', {});
    // ORDER BY beat_name ASC (not generated_at) so the audioBeats map
    // serialises identically across runs regardless of which beat was
    // regenerated most recently. Publisher's splice compares the full
    // YAML block byte-for-byte — with generated_at ordering, per-beat
    // regen + Start over produced noisy pure-reorder commits (the
    // regen'd beat moved to the end of the map). beat_name order means
    // Publisher's idempotent check actually fires when nothing changed.
    // Site renderers look up beats by name, not by map order, so readers
    // see no difference.
    const allBeatsRes = await this.env.DB
      .prepare(
        `SELECT beat_name, public_url FROM daily_piece_audio
         WHERE piece_id = ? ORDER BY beat_name ASC`,
      )
      .bind(pieceId)
      .all<{ beat_name: string; public_url: string }>();
    const audioBeats: Record<string, string> = Object.fromEntries(
      allBeatsRes.results.map((r) => [r.beat_name, r.public_url]),
    );
    const finalBeatCount = allBeatsRes.results.length;
    try {
      const publisher = await this.subAgent(PublisherAgent, `audio-publisher-${date}`);
      const publishResult = await publisher.publishAudio(filePath, audioBeats);
      await this.env.DB
        .prepare('UPDATE daily_pieces SET has_audio = 1 WHERE id = ?')
        .bind(pieceId)
        .run()
        .catch(() => {});
      await this.logStep(date, pieceId,'audio-publishing', 'done', {
        commitUrl: publishResult.commitUrl,
        beatCount: finalBeatCount,
      });
      await observer.logAudioPublished(
        date,
        title,
        finalBeatCount,
        totalCharacters,
        publishResult.commitUrl,
        pieceId,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Publisher failed';
      await this.logStep(date, pieceId,'audio-publishing', 'failed', { reason });
      await observer.logAudioFailure(date, title, 'publisher', reason, pieceId);
    }
  }

  /**
   * Re-run the audio pipeline for an already-published piece. Invoked
   * from the admin dashboard's "Retry audio" button after an earlier
   * audio failure (observer escalation).
   *
   * Validates inputs, then schedules `runAudioPipelineScheduled` to run
   * in an alarm-triggered invocation (15-minute wall budget) instead of
   * running inline. Same reason as triggerDailyPiece: HTTP-triggered
   * invocations risk eviction after ~30s of compute between incoming
   * requests; alarms get a fresh budget. Returns quickly — admin UI
   * polls pipeline_log / daily_piece_audio for progress.
   *
   * Idempotent — if audio already landed, Producer's R2 head-check
   * skips generation, Auditor re-verifies, Publisher's splice is a no-op.
   *
   * `force=true` bypasses the has_audio=1 short-circuit and is reserved
   * for internal callers that have already deleted the specific beat(s)
   * they want regenerated (retryAudioBeat). UI-triggered Continue keeps
   * force=false so the 2026-04-17-class double-fire guard stays in place.
   */
  async retryAudio(pieceId: string, force = false): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
      throw new Error(`retryAudio: invalid pieceId "${pieceId}"`);
    }

    const piece = await this.env.DB
      .prepare('SELECT date, headline, has_audio FROM daily_pieces WHERE id = ? LIMIT 1')
      .bind(pieceId)
      .first<{ date: string; headline: string; has_audio: number }>();
    if (!piece) throw new Error(`retryAudio: no piece with id ${pieceId}`);
    const { date } = piece;

    // Short-circuit when audio is already published — a second Continue
    // click (either from a double-tap or a stale tab) re-running the
    // full pipeline produced the 2026-04-17 corruption when stacked
    // with the spliceAudioBeats regex bug (resolved separately in
    // `55fce9f`). Defense-in-depth: refuse the work, surface via
    // Observer so the operator notices. "Start over" (retryAudioFresh)
    // is the escape hatch — it wipes has_audio first so it always runs.
    // Per-beat regen (retryAudioBeat) passes force=true after deleting
    // just the target beat; producer's head-check then regenerates only
    // the missing row.
    if (!force && piece.has_audio === 1) {
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError(
        'audio',
        0,
        `retryAudio no-op: piece ${pieceId} already has audio published (has_audio=1). Use "Start over" or per-beat Regenerate to trigger a rewrite.`,
        pieceId,
      );
      return;
    }

    // filePath lives in the publishing.done step's data column.
    // run_id stays YYYY-MM-DD (cadence Phase 3 walk-back) but we now
    // additionally scope by `piece_id = ?` (migration 0018) so
    // multi-per-day same-date pieces don't collide. One row per piece
    // by construction — LIMIT 1 is defensive, not load-bearing.
    const pubRow = await this.env.DB
      .prepare(
        `SELECT data FROM pipeline_log
         WHERE run_id = ? AND piece_id = ?
           AND step = 'publishing' AND status = 'done'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(date, pieceId)
      .first<{ data: string | null }>();
    if (!pubRow?.data) throw new Error(`retryAudio: no publishing.done row for ${date}`);
    let filePath: string | null = null;
    try {
      filePath = JSON.parse(pubRow.data)?.filePath ?? null;
    } catch { /* malformed JSON */ }
    if (!filePath) throw new Error(`retryAudio: no filePath in publishing.done for ${date}`);

    // Schedule audio to fire in an alarm-triggered invocation (15-min wall
    // budget). Validation above catches common error paths before the
    // alarm is scheduled — so the caller sees failures synchronously.
    await this.schedule(1, 'runAudioPipelineScheduled', {
      pieceId,
      date,
      filePath,
      title: piece.headline,
    });
  }

  /**
   * "Start over" audio variant — wipe every trace of a prior audio
   * attempt (R2 objects, daily_piece_audio rows, has_audio flag,
   * audio-* pipeline_log entries), then call retryAudio. Used when the
   * existing audio is bad (wrong content, truncated clips, stale voice
   * settings) and a clean regenerate is safer than resuming.
   *
   * Text piece itself is untouched — this only resets the audio-side
   * state. Admin dashboard's "Start over" button invokes this path.
   */
  async retryAudioFresh(pieceId: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
      throw new Error(`retryAudioFresh: invalid pieceId "${pieceId}"`);
    }

    // keepAlive is reference-counted inside the SDK — nesting with the
    // inner retryAudio() call is safe; the heartbeat stops only when all
    // refs are disposed.
    const keepAliveDispose = await this.keepAlive();
    try {
      // `daily_piece_audio` is the authoritative source for this piece's
      // audio state (post-Phase-1 PK is (piece_id, beat_name)). Iterate
      // its rows to find every R2 object's exact stored key — no path
      // reconstruction. This works for BOTH legacy pieces stored at
      // `audio/daily/{date}/{beat}.mp3` AND new pieces stored at
      // `audio/daily/{date}/{piece_id}/{beat}.mp3`. See DECISIONS
      // 2026-04-21 "Scope audio pipeline state per piece_id" →
      // "Dual-path read contract — permanent."
      const rows = await this.env.DB
        .prepare('SELECT r2_key FROM daily_piece_audio WHERE piece_id = ?')
        .bind(pieceId)
        .all<{ r2_key: string }>();
      await Promise.all(
        rows.results.map((r) => this.env.AUDIO_BUCKET.delete(r.r2_key)),
      );

      // Wipe D1 beat rows
      await this.env.DB
        .prepare('DELETE FROM daily_piece_audio WHERE piece_id = ?')
        .bind(pieceId)
        .run();

      // Clear has_audio on the piece so dashboard + site reflect "pending"
      await this.env.DB
        .prepare('UPDATE daily_pieces SET has_audio = 0 WHERE id = ?')
        .bind(pieceId)
        .run()
        .catch(() => {});

      // No pipeline_log DELETE here. Audio-step rows stay as
      // append-only history — the admin view dedups by newest-wins.
      // Removing the prior wipe resolves the multi-per-day blocker
      // where the DELETE spanned all pieces on a date.

      // Delegate to existing retryAudio — it handles MDX read + audio pipeline
      await this.retryAudio(pieceId);
    } finally {
      keepAliveDispose();
    }
  }

  /**
   * Regenerate a single beat's audio without touching the other beats.
   * Narrow-scope cousin of retryAudioFresh — deletes exactly one R2
   * object + one daily_piece_audio row, leaves has_audio=1 so readers
   * keep seeing the audio player for the other beats, then runs the
   * full audio pipeline (force=true). The producer's R2 head-check
   * auto-skips the beats that still exist on R2, so only the deleted
   * beat regenerates. Publisher's splice is a no-op when the rebuilt
   * audioBeats map serialises identically to the previously-committed
   * frontmatter (same beat names, same deterministic R2 paths).
   *
   * Admin "Regenerate" button per-row invokes this path. Primary use:
   * refreshing one beat after a normaliser change (e.g. Roman-numeral
   * pronunciation) without touching the other four.
   */
  async retryAudioBeat(pieceId: string, beatName: string): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) {
      throw new Error(`retryAudioBeat: invalid pieceId "${pieceId}"`);
    }
    if (!/^[a-z0-9-]+$/.test(beatName)) {
      throw new Error(`retryAudioBeat: invalid beatName "${beatName}"`);
    }

    const row = await this.env.DB
      .prepare('SELECT r2_key FROM daily_piece_audio WHERE piece_id = ? AND beat_name = ? LIMIT 1')
      .bind(pieceId, beatName)
      .first<{ r2_key: string }>();
    if (!row) {
      // No existing row — either the beat name is wrong or this beat
      // was never generated (e.g. pipeline stopped mid-way). For the
      // latter case, operator should use "Continue" on the whole piece.
      // Log and bail so we don't hide a typo.
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError(
        'audio',
        0,
        `retryAudioBeat: no daily_piece_audio row for piece ${pieceId} beat "${beatName}". Use Continue to generate missing beats.`,
        pieceId,
      );
      return;
    }

    const keepAliveDispose = await this.keepAlive();
    try {
      await this.env.AUDIO_BUCKET.delete(row.r2_key);
      await this.env.DB
        .prepare('DELETE FROM daily_piece_audio WHERE piece_id = ? AND beat_name = ?')
        .bind(pieceId, beatName)
        .run();
      // Leave has_audio=1 intact — the other beats still play for
      // readers. runAudioPipeline will re-UPDATE has_audio=1 after
      // Publisher (no-op if already 1).
      await this.retryAudio(pieceId, /* force */ true);
    } finally {
      keepAliveDispose();
    }
  }

  getStatus(): DirectorState {
    return this.state;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      return new Response(JSON.stringify(this.getStatus()), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  /** Move Director into a new pipeline phase */
  private enterPhase(phase: DirectorPhase, task?: string): void {
    this.setState({
      ...this.state,
      status: 'running',
      currentPhase: phase,
      ...(task !== undefined ? { currentTask: task } : {}),
    });
  }

  /** Reset Director to idle after a skip/no-op */
  private exitToIdle(): void {
    this.setState({ ...this.state, status: 'idle', currentPhase: null, currentTask: null });
  }

  /** Recent daily pieces surfaced to Curator to avoid repetition. Includes
   *  `underlying_subject` alongside `headline` so Claude can detect conceptual
   *  overlap across different-source / different-headline same-story picks
   *  (the 2026-04-24 twin-pieces incident — both taught information asymmetry
   *  via prediction markets from the same news event). Headlines alone lexically
   *  look different; subjects make the semantic cluster legible. The 2026-04-27
   *  recurrence (twin SCOTUS / cell-location pieces) showed that data alone
   *  isn't enough — Curator can rationalize when subject phrasings diverge.
   *  The fix landed in the prompt as named SAME-EVENT and SAME-CONCEPT failure
   *  modes with worked examples; this query stays unchanged. */
  private async getRecentDailyPieces(
    days: number,
  ): Promise<Array<{ headline: string; underlyingSubject: string }>> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const result = await this.env.DB
        .prepare('SELECT headline, underlying_subject FROM daily_pieces WHERE date >= ? ORDER BY date DESC')
        .bind(since.toISOString().slice(0, 10))
        .all<{ headline: string; underlying_subject: string }>();
      return result.results.map((r) => ({
        headline: r.headline,
        underlyingSubject: r.underlying_subject,
      }));
    } catch { return []; }
  }

  /** Recent category concentration surfaced to Curator as a soft-preference
   *  signal. Mirrors getRecentDailyPieces in shape — fail-quiet on D1 errors,
   *  date-windowed not lifetime, sorted DESC by count. The hidden
   *  `patterns-yet-to-cluster` fallback (migration 0027) is excluded — its
   *  presence in the list would mislead Curator about real concentration.
   *  See DECISIONS 2026-05-01 "Curator sees recent category concentration as
   *  soft preference". */
  private async getRecentCategoryCounts(
    days: number,
  ): Promise<Array<{ name: string; count: number }>> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const result = await this.env.DB
        .prepare(
          `SELECT c.name AS name, COUNT(DISTINCT pc.piece_id) AS count
             FROM categories c
             INNER JOIN piece_categories pc ON c.id = pc.category_id
             INNER JOIN daily_pieces dp ON pc.piece_id = dp.id
            WHERE dp.date >= ?
              AND c.slug != 'patterns-yet-to-cluster'
            GROUP BY c.id
            ORDER BY count DESC, c.name ASC`,
        )
        .bind(since.toISOString().slice(0, 10))
        .all<{ name: string; count: number }>();
      return result.results.map((r) => ({ name: r.name, count: Number(r.count) }));
    } catch { return []; }
  }

  /** Save audit results to D1 for durable audit trail. `pieceId` is the
   *  run-scoped UUID (pre-allocated at the top of triggerDailyPiece); it
   *  scopes rows per-piece at multi-per-day cadence — same UUID that
   *  ends up as daily_pieces.id for this run. See DECISIONS 2026-04-22
   *  "piece_id columns on day-keyed tables".
   *
   *  Phase I (2026-04-30 after Phase H): also writes one row per claim
   *  to `daily_audit_claims` (migration 0028) so future admin views and
   *  cross-piece analytics can query per-claim data without parsing
   *  JSON. The parent `audit_results.notes` JSON stays the source of
   *  truth for back-compat with the 23 historical rows; the new table
   *  is additive structured data. Best-effort try/catch — a transient
   *  D1 failure on the per-claim INSERTs can't sink an otherwise-passing
   *  audit (matches the per-round persist pattern from
   *  `interactive_audit_results`). Pre-generates the fact `audit_results.id`
   *  so child rows can reference it via `audit_result_id`. */
  private async saveAuditResults(
    taskId: string,
    pieceId: string,
    round: number,
    voice: VoiceAuditResult,
    structure: StructureAuditResult,
    facts: FactCheckResult,
  ): Promise<void> {
    const now = Date.now();
    const draftId = `${taskId}-r${round}`;
    const factAuditId = crypto.randomUUID();
    // Path A (2026-05-01): persist the full FactCheckResult object as
    // notes JSON, not just the claims array. The drawer's
    // /api/daily/[date]/made.ts endpoint reads `result.sources` (flat
    // citation URL list) from this JSON to render the "Sources
    // consulted" line under the Facts section. Pre-Path-A rows have a
    // bare claims array; the API parser handles both shapes.
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'voice', voice.passed ? 1 : 0, voice.score, JSON.stringify(voice.violations), now, pieceId),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'structure', structure.passed ? 1 : 0, null, JSON.stringify(structure.issues), now, pieceId),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(factAuditId, taskId, draftId, 'fact', facts.passed ? 1 : 0, null, JSON.stringify(facts), now, pieceId),
      ]);
    } catch { /* audit logging shouldn't break the pipeline */ }

    // Per-claim breakout into daily_audit_claims (migration 0028).
    // Path A (2026-05-01) dropped per-claim source attribution, so the
    // sources_json + search_query columns are now always NULL for new
    // rows. Columns stay in the schema (additive nullable) for back-
    // compat; an admin "claims explorer" view can still query by piece
    // + round + status without the per-claim source attribution.
    if (Array.isArray(facts.claims) && facts.claims.length > 0) {
      try {
        const stmts = facts.claims.map((claim, idx) =>
          this.env.DB.prepare(
            `INSERT INTO daily_audit_claims
              (id, audit_result_id, piece_id, round, claim_index, claim_text, status, note, sources_json, search_query, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            factAuditId,
            pieceId,
            round,
            idx,
            claim.claim ?? '',
            claim.status ?? 'unverified',
            claim.note ?? null,
            null,
            null,
            now,
          ),
        );
        await this.env.DB.batch(stmts);
      } catch {
        /* per-claim breakout failure is non-fatal; parent audit_results
         * still holds the full JSON. */
      }
    }
  }

  /** Write a step to the pipeline_log table for the admin monitor.
   *  `runId` stays YYYY-MM-DD for day-grouping consumers (Phase 3
   *  walk-back); `pieceId` is the additive per-piece axis introduced
   *  in migration 0018 to isolate multi-per-day runs. Orphan piece_ids
   *  (runs that skip or error before publishing) are acceptable —
   *  readers filter on daily_pieces.id JOIN where needed. */
  private async logStep(
    runId: string,
    pieceId: string,
    step: string,
    status: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.env.DB
        .prepare('INSERT INTO pipeline_log (id, run_id, step, status, data, created_at, piece_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), runId, step, status, JSON.stringify(data), Date.now(), pieceId)
        .run();
    } catch { /* pipeline log shouldn't break the pipeline */ }
  }
}
