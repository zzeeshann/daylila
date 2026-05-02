/**
 * <lesson-shell> — passive engagement reporter for the single-scroll
 * daily-piece layout (Area 5).
 *
 * Pre-Area-5, this component owned a beat-by-beat pagination state
 * machine (Previous / Next / Finish, sessionStorage-restored beat
 * index, hide-all-but-current via [data-visible]). With the conversion
 * to a single scrolling page, all beats are visible always — the
 * component now does three small things:
 *
 *   1. Fires `view` on mount.
 *   2. Forwards `audio-player:firstplay` to `audio_play`.
 *   3. Watches the finish-state sentinel and the interactive section
 *      via IntersectionObservers, firing `complete` and
 *      `interactive_offered` once per session each.
 *
 * Progressive enhancement: without JS, beats render as continuous
 * prose (the no-JS shape was already the canonical fallback shape).
 */

class LessonShell extends HTMLElement {
  private finishObserver: IntersectionObserver | null = null;
  private interactiveObserver: IntersectionObserver | null = null;
  private beatsObserver: IntersectionObserver | null = null;
  private audioFirstPlayHandler: EventListener | null = null;
  private observedBeats = new Set<string>();

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
    // Per-user-per-piece read record: view event.
    this.trackRead('view');

    // Audio first-play forwards to engagement; audio-player owns the
    // firstplay debounce so we just listen.
    this.audioFirstPlayHandler = () => this.trackEngagement('audio_play');
    window.addEventListener('audio-player:firstplay', this.audioFirstPlayHandler);

    // Finish-state sentinel — when the reader reaches the end of the
    // page (LessonLayout renders <footer data-lesson-finish>), fire
    // `complete` once per session per piece.
    this.observeFinish();

    // Interactive section observer — when the inline interactive
    // (LessonLayout renders <section data-lesson-interactive
    // data-interactive-slug="…">) crosses ≥0.5 viewport, fire
    // `interactive_offered` once per session per slug.
    this.observeInteractive();

    // Per-beat observer — fires `beat` to /api/reads/track when each
    // <lesson-beat name="…"> crosses ≥0.5 viewport. Powers Resume's
    // current_beat anchor.
    this.observeBeats();
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
  }

  private observeFinish() {
    const sentinel = document.querySelector('[data-lesson-finish]');
    if (!(sentinel instanceof Element)) return;

    const info = this.lessonInfo;
    const dedupKey = info?.piece_id
      ? `zeemish-completed:${info.piece_id}`
      : info?.piece_date
        ? `zeemish-completed-date:${info.piece_date}`
        : null;
    if (!dedupKey || sessionStorage.getItem(dedupKey)) return;

    this.finishObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          sessionStorage.setItem(dedupKey, '1');
          this.trackEngagement('complete');
          this.trackRead('complete');
          if (info) {
            fetch('/api/progress/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(info),
              keepalive: true,
            }).catch(() => {});
          }
          this.finishObserver?.disconnect();
          this.finishObserver = null;
          break;
        }
      }
    }, { threshold: [0.6] });
    this.finishObserver.observe(sentinel);
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
    const dedupKey = `zeemish-interactive-offered:${slug}`;
    if (sessionStorage.getItem(dedupKey)) return;

    this.interactiveObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
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
          this.interactiveObserver?.disconnect();
          this.interactiveObserver = null;
          break;
        }
      }
    }, { threshold: [0.5] });
    this.interactiveObserver.observe(section);
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
