/**
 * <lesson-shell> — the lesson page step coordinator.
 *
 * Builds a step list from `<lesson-beat>` elements and
 * `[data-lesson-step]` regions in DOM order. Step kinds are
 * `'beat' | 'interactive' | 'quiz'`. Owns `currentStep`. Listens for
 * `audio-player:requeststep` (clip-end auto-advance, prev/next button)
 * and `lesson-progress:goto` (dot tap). On each step change,
 * dispatches `lesson-shell:stepchange` for `<audio-player>` and
 * `<lesson-progress>` to follow. Hides non-current beats and step
 * regions via the CSS rule in `src/styles/lesson-pagination.css`,
 * which keys off `:root[data-lesson-hydrated="true"]` so no-JS readers
 * always see the long-scroll fallback. Sets a second flag
 * `:root[data-lesson-on-last-step="true"]` whenever the active step is
 * the final entry in `this.steps`; the lesson-pagination CSS rule for
 * the finish footer keys off the absence of that attribute.
 *
 * History: pre-Area-5, this component owned a different beat-by-beat
 * pagination state machine (Previous / Next / Finish UI in shadow DOM,
 * sessionStorage-restored beat index). Area 5 stripped it. The C3
 * commit (2026-05-08) brought the coordinator role back, redesigned —
 * step IDs not beat indices, keyed off shell's own dataset not external
 * state, audio-player follows lesson-shell rather than the inverse.
 * C7 (2026-05-08) collapsed the dual-mode dance from C1–C6 into the
 * single paginated mode below; the legacy IntersectionObserver path
 * is gone, the admin flag is gone, paginated is the only mode. C8b
 * (2026-05-08) dropped the `'finish'` step kind — the finish footer
 * is no longer a paginated step, instead it renders below the last
 * content step via the new on-last-step CSS gate above. Complete-dwell
 * trigger shifted from `kind === 'finish'` to "last step in this.steps"
 * with the same reader-facing semantic.
 */

type StepKind = 'beat' | 'interactive' | 'quiz';

/** ms a reader must remain on the LAST step in the step list before
 *  `complete` fires. Calibrated to filter misclicks on the last
 *  progress dot (~1s reflexive back-tap budget) without slowing down
 *  intentional readers (a deliberate landing on the last step lets the
 *  eye register the finish-footer's Read another / Browse library
 *  links in 2-3s). The trigger shifted from `kind === 'finish'` to
 *  "current step is the last in this.steps" with C8b (2026-05-08); the
 *  reader-facing semantic is preserved — for a piece with quiz, the
 *  last step is the quiz step + the finish footer renders directly
 *  below it; for a piece with interactive but no quiz, the interactive
 *  step; for a piece with neither, the close beat. See DECISIONS
 *  2026-05-08 "C5: engagement semantics under pagination" for the
 *  original 2.5s justification + "C8b: drop finish step" for the
 *  trigger shift. */
const COMPLETE_DWELL_MS = 2500;

interface Step {
  id: string;
  kind: StepKind;
  element: HTMLElement;
}

class LessonShell extends HTMLElement {
  private steps: Step[] = [];
  private currentStepId: string | null = null;
  private audioFirstPlayHandler: EventListener | null = null;
  private requeststepHandler: EventListener | null = null;
  private gotoHandler: EventListener | null = null;
  /** Pending complete-on-finish-dwell timer. Set when the reader
   *  enters the last step (typically `finish`); cleared on any
   *  step-change before the dwell elapses. */
  private completeDwellTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once `setupCoordinator()` finished and `:root[data-lesson-
   *  hydrated]` was set. Drives disconnectedCallback's :root cleanup
   *  scope so an early-out (no parseable steps) doesn't try to undo
   *  state it never set. */
  private active = false;

  /**
   * Extract content info from URL: /daily/{date}/{slug}/.
   *
   * `piece_id` is set as `data-piece-id` on this element by
   * rehype-beats at build time, sourced from MDX frontmatter.
   */
  private get lessonInfo(): { course_slug: string; lesson_number: number; piece_date: string; piece_id: string | undefined } | null {
    const dailyMatch = window.location.pathname.match(/\/daily\/(\d{4}-\d{2}-\d{2})\//);
    if (dailyMatch) {
      const pieceId = this.dataset.pieceId;
      return {
        course_slug: 'daily',
        lesson_number: 0,
        piece_date: dailyMatch[1],
        piece_id: pieceId && pieceId.length > 0 ? pieceId : undefined,
      };
    }
    return null;
  }

  connectedCallback() {
    // Engagement: view (fires once per page load).
    this.trackEngagement('view');
    this.trackRead('view');

    // Audio first-play forwards to engagement; audio-player owns the
    // firstplay debounce so we just listen.
    this.audioFirstPlayHandler = () => this.trackEngagement('audio_play');
    window.addEventListener('audio-player:firstplay', this.audioFirstPlayHandler);

    this.setupCoordinator();
  }

  disconnectedCallback() {
    if (this.audioFirstPlayHandler) {
      window.removeEventListener('audio-player:firstplay', this.audioFirstPlayHandler);
      this.audioFirstPlayHandler = null;
    }
    if (this.requeststepHandler) {
      window.removeEventListener('audio-player:requeststep', this.requeststepHandler);
      this.requeststepHandler = null;
    }
    if (this.gotoHandler) {
      document.removeEventListener('lesson-progress:goto', this.gotoHandler);
      this.gotoHandler = null;
    }
    if (this.active) {
      delete document.documentElement.dataset.lessonHydrated;
      delete document.documentElement.dataset.lessonCurrentStep;
      delete document.documentElement.dataset.lessonOnLastStep;
    }
    if (this.completeDwellTimer) {
      clearTimeout(this.completeDwellTimer);
      this.completeDwellTimer = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Step coordinator
  // ────────────────────────────────────────────────────────────────

  private setupCoordinator() {
    this.buildSteps();
    if (this.steps.length === 0) {
      // No paginatable content (legacy bundle with no h2 headings —
      // rehype-beats wouldn't render <lesson-shell> in that case, so
      // this is a defensive path). The view + audio_play engagement
      // wired in connectedCallback above still fires; nothing else to
      // do here.
      return;
    }

    // Pick the initial step. URL hash takes precedence (Resume URLs);
    // otherwise the first step in DOM order (the hook).
    const hash = window.location.hash.replace(/^#/, '');
    const matched = hash ? this.steps.find((s) => s.id === hash) : null;
    const initial = matched ?? this.steps[0];

    // Hide all non-initial steps via the [data-current] mark below.
    // The CSS hide-rule (src/styles/lesson-pagination.css) gates on
    // :root[data-lesson-hydrated="true"], set here only after the
    // step list builds successfully. The hydrated guard means no-JS
    // readers never trigger the hide-rule and the page renders as
    // continuous prose.
    document.documentElement.dataset.lessonHydrated = 'true';
    this.active = true;

    // Suppress the browser's automatic anchor-scroll when resuming
    // from a hash. The browser's scroll-to-anchor fires near the load
    // event, AFTER lesson-shell's connectedCallback returns; an
    // imperative window.scrollTo wouldn't reliably override it. Strip
    // the hash from the URL via history.replaceState while keeping
    // the rest intact — once the browser sees no hash, there's no
    // anchor to scroll to. The Resume contract still works: the hash
    // was already read above into `matched` and informs the initial
    // step. The reader lands with the chrome (title, meta, dots,
    // audio player) at the top and the resumed step below it — the
    // natural shape of an opened-from-link page.
    if (matched && typeof history.replaceState === 'function') {
      const cleanUrl = window.location.pathname + window.location.search;
      history.replaceState(history.state, '', cleanUrl);
    }

    this.applyCurrent(initial.id, { dispatchChange: false, scroll: false });

    // Wire input handlers for prev/next requests + dot taps.
    this.requeststepHandler = (e: Event) => this.handleRequestStep(e as CustomEvent);
    window.addEventListener('audio-player:requeststep', this.requeststepHandler);

    this.gotoHandler = (e: Event) => this.handleGoto(e as CustomEvent);
    document.addEventListener('lesson-progress:goto', this.gotoHandler);

    // Tell <lesson-progress> + <audio-player> the step list is ready.
    document.dispatchEvent(
      new CustomEvent('lesson-shell:ready', {
        detail: { steps: this.steps.map((s) => ({ id: s.id, kind: s.kind })) },
      }),
    );

    // Fire the initial stepchange so audio-player loads the right
    // clip on resume + lesson-progress paints the active dot.
    this.dispatchStepChange(initial);
  }

  private buildSteps() {
    // Beats first (DOM order, scoped to this lesson-shell descendants).
    const beatEls = Array.from(this.querySelectorAll('lesson-beat[name]')) as HTMLElement[];
    for (const el of beatEls) {
      const id = el.getAttribute('name');
      if (id && id.length > 0) {
        this.steps.push({ id, kind: 'beat', element: el });
      }
    }
    // Then [data-lesson-step] regions in DOM order (siblings of the
    // article that wraps lesson-shell + beats). After C8b (2026-05-08)
    // the finish footer no longer carries data-lesson-step="finish";
    // only `interactive` and `quiz` are valid step-region kinds. The
    // `finish` validator branch is retained as a defensive no-op so a
    // mistakenly-stamped footer is silently skipped rather than blowing
    // up the type union.
    const stepEls = Array.from(document.querySelectorAll('[data-lesson-step]')) as HTMLElement[];
    for (const el of stepEls) {
      const id = el.dataset.lessonStep;
      if (!id) continue;
      const kind = (id === 'interactive' || id === 'quiz') ? id : null;
      if (!kind) continue;
      this.steps.push({ id, kind, element: el });
    }
  }

  /**
   * Update DOM + dispatch stepchange. Used by initial mount, dot tap,
   * audio prev/next button, and clip-end auto-advance.
   *
   * @param opts.dispatchChange  fire `lesson-shell:stepchange`
   *                             (initial mount uses dispatchStepChange
   *                             explicitly; subsequent navigations let
   *                             goToStep handle it).
   * @param opts.scroll          smooth-scroll the new step element to
   *                             top (false on initial mount — would
   *                             produce a confusing animation).
   */
  private applyCurrent(stepId: string, opts: { dispatchChange: boolean; scroll: boolean }) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return;
    if (this.currentStepId === stepId) return;

    if (this.currentStepId) {
      const prev = this.steps.find((s) => s.id === this.currentStepId);
      prev?.element.removeAttribute('data-current');
    }

    this.currentStepId = stepId;
    step.element.setAttribute('data-current', '');
    document.documentElement.dataset.lessonCurrentStep = stepId;

    // Mark the document root when the active step is the last in the
    // list. The lesson-pagination CSS rule keys the finish-footer hide
    // off the absence of this attribute, so the footer renders only
    // while the reader is on the last step. Without JS, neither the
    // hydrated guard nor this attribute is ever set → the rule never
    // matches → the footer renders at the bottom of the article in
    // continuous-prose fallback mode. C8b (2026-05-08).
    if (this.isLastStep(step)) {
      document.documentElement.dataset.lessonOnLastStep = 'true';
    } else {
      delete document.documentElement.dataset.lessonOnLastStep;
    }

    if (opts.scroll) {
      step.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Engagement firing on step-change. The CSS hide-rule means
    // viewport IO never fires for non-current steps, so deterministic
    // step-into events replace the IO observers. See DECISIONS
    // 2026-05-08 "C5: engagement semantics under pagination" for the
    // dedup behaviour.
    this.fireStepEngagement(step);

    if (opts.dispatchChange) {
      this.dispatchStepChange(step);
    }
  }

  /**
   * Fire the right engagement event(s) for the new active step.
   *
   *   - **beat** → `/api/reads/track` event=`beat`. Re-fires on every
   *     step-into (NOT deduped per session). The reader can navigate
   *     back to a beat by tapping a dot or pressing audio-prev; the
   *     idempotent UPSERT on `current_beat` means D1 always reflects
   *     the reader's actual position.
   *   - **interactive** → `/api/interactive/track` event=
   *     `interactive_offered`. Deduped per session per slug.
   *   - **quiz** → reuses the interactive_offered firing path when the
   *     section carries `data-interactive-slug`. fireInteractiveOffered
   *     dedups so multiple reads of the same slug across the two step
   *     kinds don't double-count.
   *   - **last step in list** → start a 2.5s setTimeout. If the reader
   *     stays on the last step that long, fire `complete`. If they
   *     leave first, the timer is cleared. Deduped per session per
   *     piece. The dwell gate guards against a misclick on the last
   *     dot wrongly marking the piece complete. C8b (2026-05-08)
   *     shifted this from `kind === 'finish'` to "last step in list"
   *     because the finish step no longer exists — for a piece with
   *     quiz the last step is the quiz; for a piece with interactive
   *     but no quiz, the interactive; for a piece with neither, the
   *     close beat. Reader-facing meaning preserved (the finish footer
   *     renders directly below the last step on every shape).
   */
  private fireStepEngagement(step: Step) {
    // Always clear any pending complete-dwell timer when leaving any
    // step. Per Plan-agent review: a misclick + immediate back-tap
    // before 2.5s elapses MUST NOT fire complete.
    if (this.completeDwellTimer) {
      clearTimeout(this.completeDwellTimer);
      this.completeDwellTimer = null;
    }

    if (step.kind === 'beat') {
      this.trackRead('beat', step.id);
    } else if (step.kind === 'interactive' || step.kind === 'quiz') {
      // Reuse the same data-interactive-slug attribute the IO observer
      // would have used. Both interactive + quiz sections may carry
      // it — the section that does (the primary surface for that
      // piece) is the one we trigger from. fireInteractiveOffered
      // dedups so multiple reads of the same slug across the two
      // step kinds don't double-count.
      const slug = step.element.dataset.interactiveSlug;
      if (slug) this.fireInteractiveOffered(slug);
    }

    // Last-step dwell gate. Independent of the kind-specific firing
    // above — a beat can be both a `beat` event and the "last step"
    // dwell trigger when a piece has no companion (just close beat as
    // the final step).
    if (this.isLastStep(step)) {
      const info = this.lessonInfo;
      this.completeDwellTimer = setTimeout(() => {
        this.completeDwellTimer = null;
        this.fireComplete(info);
      }, COMPLETE_DWELL_MS);
    }
  }

  /** Whether the given step is the final entry in this.steps. The
   *  trigger for both the `:root[data-lesson-on-last-step]` finish-
   *  footer flag and the 2.5s complete-dwell timer. */
  private isLastStep(step: Step): boolean {
    if (this.steps.length === 0) return false;
    return this.steps[this.steps.length - 1].id === step.id;
  }

  private dispatchStepChange(step: Step) {
    const idx = this.steps.indexOf(step);
    window.dispatchEvent(
      new CustomEvent('lesson-shell:stepchange', {
        detail: {
          stepId: step.id,
          kind: step.kind,
          index: idx,
          total: this.steps.length,
        },
      }),
    );
  }

  /** Public: called from `goToStep` for external callers (lesson-
   *  progress dispatches `lesson-progress:goto`; audio-player dispatches
   *  `audio-player:requeststep`; lesson-swipe dispatches the same
   *  requeststep event). */
  goToStep(stepId: string) {
    if (!this.active) return;
    this.applyCurrent(stepId, { dispatchChange: true, scroll: true });
  }

  /** Public: read by `<lesson-progress>` on connect to render the
   *  initial dot row. */
  getSteps(): Array<{ id: string; kind: StepKind }> {
    return this.steps.map((s) => ({ id: s.id, kind: s.kind }));
  }

  getCurrentStepId(): string | null {
    return this.currentStepId;
  }

  private handleRequestStep(e: CustomEvent) {
    const detail = e.detail as { direction?: 'prev' | 'next' } | undefined;
    if (!detail?.direction) return;
    const idx = this.steps.findIndex((s) => s.id === this.currentStepId);
    if (idx === -1) return;
    const targetIdx = detail.direction === 'next' ? idx + 1 : idx - 1;
    const target = this.steps[targetIdx];
    if (!target) return;
    this.goToStep(target.id);
  }

  private handleGoto(e: CustomEvent) {
    const detail = e.detail as { stepId?: string } | undefined;
    if (!detail?.stepId) return;
    this.goToStep(detail.stepId);
  }

  // ────────────────────────────────────────────────────────────────
  // Engagement helpers
  // ────────────────────────────────────────────────────────────────

  /** Shared engagement-fire path for the `complete` event. Triggered
   *  on step-change to the last step + 2.5s dwell. Deduped per session
   *  per piece via sessionStorage. */
  private fireComplete(info: ReturnType<LessonShell['getLessonInfo']>) {
    const lessonInfo = info ?? this.lessonInfo;
    const dedupKey = this.completeDedupKey();
    if (!dedupKey || sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, '1');
    this.trackEngagement('complete');
    this.trackRead('complete');
    if (lessonInfo) {
      fetch('/api/progress/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lessonInfo),
        keepalive: true,
      }).catch(() => {});
    }
  }

  private completeDedupKey(): string | null {
    const info = this.lessonInfo;
    if (info?.piece_id) return `zeemish-completed:${info.piece_id}`;
    if (info?.piece_date) return `zeemish-completed-date:${info.piece_date}`;
    return null;
  }

  /** Wrapper getter so `fireComplete`'s parameter type can name a
   *  return shape from a private getter (TypeScript needs the
   *  intermediary). */
  private getLessonInfo() {
    return this.lessonInfo;
  }

  /** Shared engagement-fire path for the `interactive_offered` event.
   *  Deduped per session per slug via sessionStorage. */
  private fireInteractiveOffered(slug: string) {
    const dedupKey = `daylila-interactive-offered:${slug}`;
    if (sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, '1');
    fetch('/api/interactive/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interactive_id: null,
        interactive_slug: slug,
        event_type: 'interactive_offered',
      }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Fire-and-forget engagement tracking */
  private trackEngagement(eventType: string) {
    const info = this.lessonInfo;
    if (!info) return;

    fetch('/api/engagement/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: info.course_slug,
        lesson_id: info.piece_date ?? `${info.course_slug}/${info.lesson_number}`,
        piece_id: info.piece_id,
        event_type: eventType,
      }),
    }).catch(() => {});
  }

  /**
   * Fire-and-forget per-user-per-piece read tracking. Skipped when
   * piece_id isn't present on this page (legacy bundles or non-daily
   * content) — the user_piece_reads PK requires it.
   */
  private trackRead(event: 'view' | 'beat' | 'complete', beat?: string) {
    const info = this.lessonInfo;
    if (!info?.piece_id) return;

    fetch('/api/reads/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ piece_id: info.piece_id, event, beat }),
      keepalive: event === 'complete',
    }).catch(() => {});
  }
}

customElements.define('lesson-shell', LessonShell);

export { LessonShell };
