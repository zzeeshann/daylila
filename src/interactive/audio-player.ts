/**
 * <audio-player> — beat-aware MP3 player for the single-scroll
 * daily-piece layout (Area 5).
 *
 * Reads a JSON-encoded map of { beatName → publicUrl } from the
 * `data-audio-beats` attribute. Plays one beat's clip at a time. On
 * clip end, advances to the next beat in DOM order: loads its clip,
 * smooth-scrolls the corresponding <lesson-beat> into view, autoplays.
 *
 * Pre-Area-5, beat-switching was driven by `lesson-beat:change` events
 * from <lesson-shell>'s pagination state machine. Now <lesson-shell>
 * is a passive engagement reporter and does not dispatch beat changes,
 * so the player owns the next-clip + scroll responsibility. Prev /
 * next clip buttons + a current-beat caption let the reader navigate
 * audio independently of scroll position (Area 5.7).
 *
 * Progressive enhancement: if JS fails or the data is missing, the
 * server-rendered "Audio unavailable" state stays visible — readers
 * still get the piece as text.
 */
interface AudioBeatsMap {
  [beatName: string]: string;
}

class AudioPlayer extends HTMLElement {
  private audio: HTMLAudioElement | null = null;
  private audioBeats: AudioBeatsMap = {};
  /** Beat names in the order they appear in the DOM. The map's
   *  iteration order is unreliable across content-collection writes;
   *  the DOM is the source of truth for "what comes next". */
  private beatOrder: string[] = [];
  /** Human-readable beat titles, parsed from each <lesson-beat>'s
   *  first <h2>. Falls back to the kebab name if the heading isn't
   *  reachable (e.g. legacy intro-only piece). */
  private beatTitles: Map<string, string> = new Map();
  private currentBeat: string | null = null;
  private hasReportedFirstPlay = false;

  private playBtn: HTMLButtonElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private captionEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;

  connectedCallback() {
    try {
      const raw = this.getAttribute('data-audio-beats') ?? '{}';
      this.audioBeats = JSON.parse(raw);
    } catch {
      this.audioBeats = {};
    }

    if (Object.keys(this.audioBeats).length === 0) return;

    // Build playback order from DOM. Beats present in <lesson-beat>
    // elements but missing from the audio map are skipped silently
    // (e.g. a beat that failed audio gen during ship-and-retry).
    const beatEls = Array.from(document.querySelectorAll('lesson-beat')) as HTMLElement[];
    this.beatOrder = beatEls
      .map((el) => el.getAttribute('name') ?? '')
      .filter((name) => name.length > 0 && this.audioBeats[name]);
    if (this.beatOrder.length === 0) {
      // Fall back to map iteration order if the DOM has no usable beats
      // (legacy/intro-only pieces). The player still works; just no
      // auto-advance scroll target.
      this.beatOrder = Object.keys(this.audioBeats);
    }

    // Capture human-readable titles for the caption row. Reads each
    // beat's first <h2> text — the same heading the reader sees above
    // the beat. rehype-beats applies `beatTitles` overrides at build
    // time, so this naturally inherits any acronym / punctuation
    // restoration the operator added.
    for (const el of beatEls) {
      const name = el.getAttribute('name') ?? '';
      if (!name) continue;
      const heading = el.querySelector('h2')?.textContent?.trim();
      if (heading) this.beatTitles.set(name, heading);
    }

    this.playBtn = this.querySelector('[data-play-btn]');
    this.prevBtn = this.querySelector('[data-prev-btn]');
    this.nextBtn = this.querySelector('[data-next-btn]');
    this.captionEl = this.querySelector('[data-beat-caption]');
    this.progressEl = this.querySelector('[data-progress]');
    this.progressFill = this.querySelector('[data-progress-fill]');
    this.timeEl = this.querySelector('[data-time]');

    this.audio = new Audio();
    this.audio.preload = 'metadata';

    // Start on the first beat in DOM order.
    this.loadBeat(this.beatOrder[0]);

    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('loadedmetadata', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => this.updatePlayIcon());
    this.audio.addEventListener('pause', () => this.updatePlayIcon());
    this.audio.addEventListener('error', () => this.onLoadError());

    this.playBtn?.addEventListener('click', () => this.toggle());
    this.prevBtn?.addEventListener('click', () => this.stepBeat(-1));
    this.nextBtn?.addEventListener('click', () => this.stepBeat(1));
    this.progressEl?.addEventListener('click', (e) =>
      this.seekFromClick(e as MouseEvent),
    );
  }

  disconnectedCallback() {
    this.audio?.pause();
  }

  private loadBeat(beatName: string) {
    if (!this.audio) return;
    const url = this.audioBeats[beatName];
    if (!url) return;
    this.currentBeat = beatName;
    this.audio.src = url;
    this.resetProgressUI();
    this.refreshChrome();
  }

  /**
   * Step forward or backward through the beat order. If audio was
   * playing, the new clip autoplays; otherwise it stays paused. Also
   * smooth-scrolls the target beat into view so the page follows the
   * audio (matching the auto-advance UX). Disabled at the boundaries.
   */
  private stepBeat(direction: -1 | 1) {
    if (!this.currentBeat) return;
    const idx = this.beatOrder.indexOf(this.currentBeat);
    if (idx === -1) return;
    const target = this.beatOrder[idx + direction];
    if (!target) return;
    const wasPlaying = !!this.audio && !this.audio.paused;
    this.loadBeat(target);
    this.scrollBeatIntoView(target);
    if (wasPlaying) {
      this.audio?.play().catch(() => {
        // Autoplay blocked — reader can press play manually
      });
    }
  }

  private toggle() {
    if (!this.audio) return;
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
      if (!this.hasReportedFirstPlay) {
        this.hasReportedFirstPlay = true;
        window.dispatchEvent(new CustomEvent('audio-player:firstplay'));
      }
    } else {
      this.audio.pause();
    }
  }

  private onEnded() {
    const nextBeat = this.nextBeatName();
    if (nextBeat) {
      this.loadBeat(nextBeat);
      this.scrollBeatIntoView(nextBeat);
      this.audio?.play().catch(() => {
        // Autoplay blocked — reader can press play manually
      });
    }
    // Always dispatch — kept for any future listener (no-op today;
    // <lesson-shell> stopped consuming this in Area 5).
    window.dispatchEvent(
      new CustomEvent('audio-player:ended', {
        detail: { beatName: this.currentBeat },
      }),
    );
  }

  private nextBeatName(): string | null {
    if (!this.currentBeat) return null;
    const idx = this.beatOrder.indexOf(this.currentBeat);
    if (idx === -1) return null;
    const next = this.beatOrder[idx + 1];
    return next ?? null;
  }

  private scrollBeatIntoView(beatName: string) {
    const target = document.querySelector(`lesson-beat[name="${cssEscape(beatName)}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Refresh the prev/next disabled state + the caption line whenever
   * the current beat changes. Caption format: `{n} of {total} · {title}`.
   * Falls back to the kebab name when no <h2> heading was captured.
   */
  private refreshChrome() {
    if (!this.currentBeat) return;
    const idx = this.beatOrder.indexOf(this.currentBeat);
    const total = this.beatOrder.length;
    if (this.prevBtn) this.prevBtn.disabled = idx <= 0;
    if (this.nextBtn) this.nextBtn.disabled = idx === -1 || idx >= total - 1;
    if (this.captionEl) {
      const human =
        this.beatTitles.get(this.currentBeat) ?? this.humanise(this.currentBeat);
      this.captionEl.textContent =
        idx >= 0 && total > 0
          ? `Beat ${idx + 1} of ${total} · ${human}`
          : human;
    }
  }

  /** Fallback humaniser when no <h2> was captured for a beat. Same
   *  shape as rehype-beats's default — kebab → Title Case. */
  private humanise(slug: string): string {
    return slug
      .split('-')
      .filter((p) => p.length > 0)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }

  private onLoadError() {
    if (this.timeEl) this.timeEl.textContent = 'unavailable';
    // Don't throw — degrade to text-only silently.
  }

  private updateProgress() {
    if (!this.audio) return;
    const dur = this.audio.duration;
    const cur = this.audio.currentTime;
    if (this.progressFill && isFinite(dur) && dur > 0) {
      this.progressFill.style.width = `${(cur / dur) * 100}%`;
    }
    if (this.timeEl) this.timeEl.textContent = formatTime(cur);
  }

  private resetProgressUI() {
    if (this.progressFill) this.progressFill.style.width = '0%';
    if (this.timeEl) this.timeEl.textContent = '0:00';
  }

  private updatePlayIcon() {
    if (!this.audio || !this.playBtn) return;
    const playing = !this.audio.paused;
    this.playBtn.setAttribute(
      'aria-label',
      playing ? 'Pause audio' : 'Play audio',
    );
    this.playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  }

  private seekFromClick(e: MouseEvent) {
    if (!this.audio || !this.progressEl || !this.audio.duration) return;
    const rect = this.progressEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.audio.currentTime = this.audio.duration * pct;
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** CSS.escape polyfill — beat names are kebab-case slugs from MDX
 *  but the attribute selector still wants escaping for safety
 *  (an exotic future slug with a colon or quote would break the
 *  query string otherwise). */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return s.replace(/([^\w-])/g, '\\$1');
}

const PLAY_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3L13 8L4 13V3Z" /></svg>';
const PAUSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.5" height="10" rx="0.5"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.5"/></svg>';

customElements.define('audio-player', AudioPlayer);

export { AudioPlayer };
