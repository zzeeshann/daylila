/**
 * <lesson-shell> — the lesson page coordinator.
 *
 * Dual-mode component. The mode is set at server-render time via the
 * `data-paginated="true"` attribute (LessonLayout reads
 * admin_settings.reading_mode and stamps the attribute):
 *
 *   - **Scroll mode (default, no `data-paginated`).** Passive engagement
 *     reporter. Beats render as continuous prose; IntersectionObservers
 *     fire `view`, `complete`, `interactive_offered`, and per-beat
 *     `read` events as the reader scrolls. This is the original Area-5
 *     behaviour, unchanged.
 *
 *   - **Paginated mode (`data-paginated="true"`).** Step coordinator.
 *     Builds a step list from `<lesson-beat>` elements and
 *     `[data-lesson-step]` regions in DOM order. Owns `currentStep`.
 *     Listens for `audio-player:requeststep` (clip-end auto-advance,
 *     prev/next button) and `lesson-progress:goto` (dot tap). On each
 *     step change, dispatches `lesson-shell:stepchange` for
 *     `<audio-player>` and `<lesson-progress>` to follow. Hides
 *     non-current beats and step regions via the CSS rule in
 *     `src/styles/lesson-pagination.css`, which keys off
 *     `:root[data-lesson-paginated="true"][data-lesson-hydrated="true"]`
 *     so no-JS readers always see the long-scroll fallback.
 *
 * Pre-Area-5, this component owned a different beat-by-beat pagination
 * state machine (Previous / Next / Finish UI rendered in shadow DOM,
 * sessionStorage-restored beat index). Area 5 stripped it. The C3
 * commit (2026-05-08) brings the coordinator role back, redesigned —
 * now driven by step IDs (not beat indices), keyed off shell's own
 * dataset (not external state), and explicitly inverted from the audio
 * rail (lesson-shell is source of truth, audio-player follows; per
 * Plan-agent review).
 */

type StepKind = 'beat' | 'interactive' | 'quiz' | 'finish';

/** ms a reader must remain on the last step (finish) before `complete`
 *  fires in paginated mode. Calibrated to filter misclicks on the last
 *  progress dot (~1s reflexive back-tap budget) without slowing down
 *  intentional readers (a deliberate landing on the finish step lets
 *  the eye register the Read another / Browse library links in 2-3s).
 *  See DECISIONS 2026-05-08 "C5: engagement semantics under pagination". */
const COMPLETE_DWELL_MS = 2500;

interface Step {
  id: string;
  kind: StepKind;
  element: HTMLElement;
}

class LessonShell extends HTMLElement {
  // Engagement (scroll-mode) state
  private finishObserver: IntersectionObserver | null = null;
  private interactiveObserver: IntersectionObserver | null = null;
  private beatsObserver: IntersectionObserver | null = null;
  private audioFirstPlayHandler: EventListener | null = null;
  private observedBeats = new Set<string>();

  // Coordinator (paginated-mode) state
  private steps: Step[] = [];
  private currentStepId: string | null = null;
  private requeststepHandler: EventListener | null = null;
  private gotoHandler: EventListener | null = null;
  private paginatedActive = false;
  /** Pending complete-on-finish-dwell timer. Set when the reader
   *  enters the last step (typically `finish`); cleared on any
   *  step-change before the dwell elapses. */
  private completeDwellTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** True when this page should render as one-step-per-screen. The
   *  flag lives on :root (LessonLayout's inline script reads
   *  admin_settings.reading_mode and stamps the attribute before any
   *  custom element parses). Reading from :root rather than from this
   *  element is the right scope — paginated mode is a page-level
   *  setting, not an element-level one — and avoids the rehype-beats
   *  threading that would otherwise be needed to put a runtime value
   *  on the rehype-emitted lesson-shell tag. Not reactive to runtime
   *  attribute changes; the admin toggle is page-reload-gated by
   *  design. */
  private get isPaginated(): boolean {
    return document.documentElement.dataset.lessonPaginated === 'true';
  }

  connectedCallback() {
    // Engagement: view (fires once per page load) — both modes.
    this.trackEngagement('view');
    this.trackRead('view');

    // Audio first-play forwards to engagement; audio-player owns the
    // firstplay debounce so we just listen.
    this.audioFirstPlayHandler = () => this.trackEngagement('audio_play');
    window.addEventListener('audio-player:firstplay', this.audioFirstPlayHandler);

    if (this.isPaginated) {
      this.setupPaginated();
    } else {
      this.setupScrollMode();
    }
  }

  disconnectedCallback() {
    if (this.audioFirstPlayHandler) {
      window.removeEventListener('audio-player:firstplay', this.audioFirstPlayHandler);
      this.audioFirstPlayHandler = null;
    }
    this.finishObserver?.disconnect();
    this.finishObserver = null;
    this.interactiveObserver?.disconnect();
    this.interactiveObserver = null;
    this.beatsObserver?.disconnect();
    this.beatsObserver = null;
    this.observedBeats.clear();

    if (this.requeststepHandler) {
      window.removeEventListener('audio-player:requeststep', this.requeststepHandler);
      this.requeststepHandler = null;
    }
    if (this.gotoHandler) {
      document.removeEventListener('lesson-progress:goto', this.gotoHandler);
      this.gotoHandler = null;
    }
    if (this.paginatedActive) {
      delete document.documentElement.dataset.lessonHydrated;
      delete document.documentElement.dataset.lessonCurrentStep;
      // lessonPaginated is server-stamped by LessonLayout — leave it
      // alone; the hide-rule gates on hydrated which we DO own.
    }
    if (this.completeDwellTimer) {
      clearTimeout(this.completeDwellTimer);
      this.completeDwellTimer = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Scroll mode (original behaviour — IntersectionObservers)
  // ────────────────────────────────────────────────────────────────

  private setupScrollMode() {
    this.observeFinish();
    this.observeInteractive();
    this.observeBeats();
  }

  private observeFinish() {
    const sentinel = document.querySelector('[data-lesson-finish]');
    if (!(sentinel instanceof Element)) return;

    const info = this.lessonInfo;
    const dedupKey = this.completeDedupKey();
    if (!dedupKey || sessionStorage.getItem(dedupKey)) return;

    this.finishObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          this.fireComplete(info ?? null);
          this.finishObserver?.disconnect();
          this.finishObserver = null;
          break;
        }
      }
    }, { threshold: [0.6] });
    this.finishObserver.observe(sentinel);
  }

  /** Shared engagement-fire path for the `complete` event. Used by
   *  scroll-mode's IO observer (60% finish-footer viewport) AND
   *  paginated-mode's step-change-to-last-step + 2.5s dwell. Deduped
   *  per session per piece via sessionStorage. */
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

  /** Public-by-shape getter so `fireComplete` can be reused; matches
   *  the existing `lessonInfo` private getter shape. */
  private getLessonInfo() {
    return this.lessonInfo;
  }

  private observeBeats() {
    const info = this.lessonInfo;
    if (!info?.piece_id) return;

    const beats = document.querySelectorAll('lesson-beat[name]');
    if (beats.length === 0) return;

    this.beatsObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        const target = entry.target;
        if (!(target instanceof HTMLElement)) continue;
        const name = target.getAttribute('name');
        if (!name || this.observedBeats.has(name)) continue;
        this.observedBeats.add(name);
        this.trackRead('beat', name);
      }
    }, { threshold: [0.5] });

    beats.forEach((beat) => this.beatsObserver?.observe(beat));
  }

  private observeInteractive() {
    const section = document.querySelector('[data-lesson-interactive]');
    if (!(section instanceof HTMLElement)) return;

    const slug = section.dataset.interactiveSlug;
    if (!slug) return;
    if (sessionStorage.getItem(`daylila-interactive-offered:${slug}`)) return;

    this.interactiveObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          this.fireInteractiveOffered(slug);
          this.interactiveObserver?.disconnect();
          this.interactiveObserver = null;
          break;
        }
      }
    }, { threshold: [0.5] });
    this.interactiveObserver.observe(section);
  }

  /** Shared engagement-fire path for the `interactive_offered` event.
   *  Deduped per session per slug via sessionStorage — same key as
   *  scroll-mode's IO observer, so a session that switches between
   *  modes (rare but possible during operator testing) doesn't
   *  double-count. */
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

  // ────────────────────────────────────────────────────────────────
  // Paginated mode (step coordinator)
  // ────────────────────────────────────────────────────────────────

  private setupPaginated() {
    this.buildSteps();
    if (this.steps.length === 0) {
      // No paginatable content (legacy bundle). Fall back to scroll
      // mode so the page is still readable.
      this.setupScrollMode();
      return;
    }

    // Pick the initial step. URL hash takes precedence (Resume URLs);
    // otherwise the first step in DOM order (the hook).
    const hash = window.location.hash.replace(/^#/, '');
    const matched = hash ? this.steps.find((s) => s.id === hash) : null;
    const initial = matched ?? this.steps[0];

    // Hide all non-initial steps via the [data-current] mark below.
    // The CSS hide-rule (src/styles/lesson-pagination.css) gates on
    // both :root[data-lesson-paginated="true"] (set server-side by
    // LessonLayout's inline script before any custom element parses)
    // AND :root[data-lesson-hydrated="true"] (set here, only after
    // the step list builds successfully). The hydrated guard means
    // no-JS readers never trigger the hide-rule and the page renders
    // as the long-scroll fallback.
    document.documentElement.dataset.lessonHydrated = 'true';
    this.paginatedActive = true;

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
    // article that wraps lesson-shell + beats).
    const stepEls = Array.from(document.querySelectorAll('[data-lesson-step]')) as HTMLElement[];
    for (const el of stepEls) {
      const id = el.dataset.lessonStep;
      if (!id) continue;
      const kind = (id === 'interactive' || id === 'quiz' || id === 'finish') ? id : null;
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

    if (opts.scroll) {
      step.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Engagement firing on step-change (paginated mode only). The
    // CSS hide-rule means viewport IO never fires for non-current
    // steps, so we replace the IO observers with deterministic
    // step-into events. See DECISIONS 2026-05-08 "C5: engagement
    // semantics under pagination" for the dedup behaviour.
    if (this.paginatedActive) {
      this.fireStepEngagement(step);
    }

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
   *     the reader's actual position. Deliberate semantic difference
   *     from scroll mode (which dedups via the observed-beats Set
   *     because IO doesn't re-fire on scroll-up at the same threshold).
   *   - **interactive** → `/api/interactive/track` event=
   *     `interactive_offered`. Deduped per session per slug.
   *   - **finish** → start a 2.5s setTimeout. If the reader stays on
   *     the finish step that long, fire `complete`. If they leave
   *     first, the timer is cleared. Deduped per session per piece.
   *     The dwell gate guards against a misclick on the last dot
   *     wrongly marking the piece complete.
   *   - **quiz** → no event today. `interactive_offered` already
   *     fired when the reader entered the interactive step (or, on
   *     quiz-only pieces, when they entered the quiz step which
   *     carries `data-lesson-interactive`). The IO observer in scroll
   *     mode also fires once per slug, so dedup is consistent across
   *     modes.
   */
  private fireStepEngagement(step: Step) {
    // Always clear any pending finish-dwell timer when leaving any
    // step. Per Plan-agent review: a misclick + immediate back-tap
    // before 2.5s elapses MUST NOT fire complete.
    if (this.completeDwellTimer) {
      clearTimeout(this.completeDwellTimer);
      this.completeDwellTimer = null;
    }

    if (step.kind === 'beat') {
      this.trackRead('beat', step.id);
      return;
    }

    if (step.kind === 'interactive' || step.kind === 'quiz') {
      // Reuse the same data-interactive-slug attribute the IO observer
      // would have used. Both interactive + quiz sections may carry
      // it — the section that does (the primary surface for that
      // piece) is the one we trigger from. fireInteractiveOffered
      // dedups so multiple reads of the same slug across the two
      // step kinds don't double-count.
      const slug = step.element.dataset.interactiveSlug;
      if (slug) this.fireInteractiveOffered(slug);
      return;
    }

    if (step.kind === 'finish') {
      const info = this.lessonInfo;
      this.completeDwellTimer = setTimeout(() => {
        this.completeDwellTimer = null;
        this.fireComplete(info);
      }, COMPLETE_DWELL_MS);
      return;
    }
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

  /** Public: called by `goToStep` from external callers (audio-player
   *  in coordinated mode could call directly, but uses requeststep
   *  events for symmetry with lesson-progress). */
  goToStep(stepId: string) {
    if (!this.paginatedActive) return;
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
  // Engagement helpers (used by both modes)
  // ────────────────────────────────────────────────────────────────

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
