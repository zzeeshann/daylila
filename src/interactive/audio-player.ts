/**
 * <audio-player> — beat-aware MP3 player following <lesson-shell>'s
 * step coordinator.
 *
 * Reads a JSON-encoded map of { beatName → publicUrl } from the
 * `data-audio-beats` attribute. Plays one beat's clip at a time.
 *
 * Coordination model (single mode since C7, 2026-05-08): the audio
 * player follows lesson-shell's step state, never drives it. Prev /
 * next button + clip-end auto-advance dispatch
 * `audio-player:requeststep`; lesson-shell handles the request,
 * decides the next step (could be a non-audio step like the
 * interactive widget or quiz), and dispatches
 * `lesson-shell:stepchange`. The player's stepchange listener loads
 * the matching clip if the new step has audio, otherwise hides itself
 * (`style.display = 'none'`) — there's no clip to play, so a relabelled
 * caption over a dead play button is just visual noise. The chrome is
 * default-hidden synchronously at the top of `connectedCallback` so a
 * hash-resumed non-audio step doesn't flash the audio chrome before
 * the first stepchange runs. The `autoplayOnNextLoad` flag bridges the
 * clip-end → stepchange boundary so auto-advance keeps playing across
 * the request round-trip even though `audio.paused` is true after
 * `ended` fires.
 *
 * Initial step: when lesson-shell connects (before audio-player; per
 * the order in `register.ts`), it reads the URL hash and sets its
 * current step. audio-player on connect queries
 * `lesson-shell.getCurrentStepId()` to align — Resume URLs land on
 * the right beat with the matching clip loaded.
 *
 * Events dispatched (window-level CustomEvents):
 *   - `audio-player:firstplay` — once per page load when the reader
 *     first taps play. Powers `audio_play` engagement.
 *   - `audio-player:beatchange` — every time `loadBeat` runs, with
 *     detail `{ beatName, index, total }`. Informational; no current
 *     consumer.
 *   - `audio-player:requeststep` — from prev/next button, Media
 *     Session previoustrack/nexttrack handlers, and clip-end
 *     auto-advance, with detail `{ direction: 'prev' | 'next' }`.
 *     Lesson-shell consumes this.
 *   - `audio-player:ended` — after every clip end (informational;
 *     no current consumer).
 *
 * Progressive enhancement: if JS fails or the data is missing, the
 * server-rendered "Audio unavailable" state stays visible — readers
 * still get the piece as text.
 */
interface AudioBeatsMap {
  [beatName: string]: string;
}

/** Closed enum for /api/engagement/audio's `ended_reason` field. The
 *  writer at src/pages/api/engagement/audio.ts validates the same five
 *  strings; drift surfaces as a 400, not a silent drop. */
type DwellEndedReason = 'pause' | 'ended' | 'beat_change' | 'heartbeat' | 'pagehide';

/** Heartbeat cadence — every 30s during continuous play. Covers iOS
 *  Safari's unreliable pagehide path. Cheap; bounded by audio length. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Per-`timeupdate` clamp on accumulated dwell. Prevents tab-throttling
 *  jumps from inflating dwell_seconds (e.g. a backgrounded tab reporting
 *  a 60s gap on the next foreground tick). With this clamp + the 30s
 *  heartbeat flushing, no single (piece, beat) row can exceed
 *  ~2s × heartbeat-ticks ≈ 30s per heartbeat. The brief warned about
 *  "7000s for a 240s clip" — that pathology is impossible here. */
const MAX_TICK_DELTA_S = 2;

/** Skip flushes shorter than this — sub-half-second dwell is noise.
 *  pagehide is the exception (we'd lose those rows otherwise). */
const MIN_FLUSH_DWELL_S = 0.5;

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
  /** Piece headline for Media Session metadata. Without this, the
   *  lock-screen / headphone controls show a blank title. */
  private pieceTitle = '';
  /** Throttle position-state writes — once a second is enough for the
   *  lock-screen scrubber and avoids hammering the API on timeupdate. */
  private lastPositionWrite = 0;

  /** piece_id used by the dwell signal POSTs. Read once from
   *  <lesson-shell data-piece-id> at connect time (rehype-beats stamps
   *  it from MDX frontmatter). null on stale/legacy bundles —
   *  flushDwell early-returns in that case, matching lesson-shell's
   *  trackRead null-skip posture. */
  private pieceId: string | null = null;
  /** Seconds of play accumulated since the last flush (NOT since clip
   *  start). Reset to 0 in flushDwell after the POST is initiated. */
  private dwellAccumulated = 0;
  /** performance.now() of the last counted timeupdate. null while
   *  paused / ended / not yet started. */
  private lastTickAt: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pagehideHandler: EventListener | null = null;
  private stepchangeHandler: EventListener | null = null;
  /** Set by onEnded when a clip ends; consumed by the next stepchange
   *  listener entry to autoplay across the boundary. Without this, the
   *  natural auto-advance reads as paused (audio.paused=true after
   *  ended fires) and stepchange wouldn't autoplay. */
  private autoplayOnNextLoad = false;

  private playBtn: HTMLButtonElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private captionEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;

  connectedCallback() {
    // Default to hidden synchronously, before the first paint. Resume
    // URLs that land on a non-audio step (e.g. /piece/#interactive) would
    // otherwise flash the audio chrome between connect and the first
    // stepchange listener firing. onStepChange flips display back to ''
    // when the active step is a beat with audio.
    this.style.display = 'none';

    try {
      const raw = this.getAttribute('data-audio-beats') ?? '{}';
      this.audioBeats = JSON.parse(raw);
    } catch {
      this.audioBeats = {};
    }

    this.pieceTitle = this.getAttribute('data-piece-title') ?? '';

    // piece_id is stamped on <lesson-shell> by rehype-beats; both
    // elements live in the same DOM tree and the same build pass.
    // Avoids threading a new prop through LessonLayout / AudioPlayer
    // .astro callers — the DOM lookup matches the same trust boundary.
    const shell = document.querySelector('lesson-shell');
    const shellPieceId = shell?.getAttribute('data-piece-id');
    this.pieceId = shellPieceId && shellPieceId.length > 0 ? shellPieceId : null;

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

    // Start on the beat lesson-shell says is current. Lesson-shell
    // upgrades before audio-player (per the order in register.ts) and
    // has already read the URL hash + stripped it via
    // history.replaceState by this point — querying shell aligns the
    // audio with the body on Resume URLs. Falls back to the first
    // beat in DOM order if shell isn't present (defensive; structurally
    // shouldn't happen since rehype-beats renders both together).
    const shellEl = document.querySelector('lesson-shell') as { getCurrentStepId?: () => string | null } | null;
    const shellStep = shellEl?.getCurrentStepId?.();
    const initialBeat = (shellStep && this.audioBeats[shellStep]) ? shellStep : this.beatOrder[0];
    this.loadBeat(initialBeat);
    // Lesson-shell already dispatched its initial stepchange before our
    // listener was wired (it runs setupCoordinator() inside its own
    // connectedCallback, which fires earlier in register.ts). If the
    // initial step is a beat with audio, restore the chrome here —
    // otherwise the synchronous `display = 'none'` at the top of
    // connectedCallback would leave a beat step with no chrome.
    if (shellStep && this.audioBeats[shellStep]) {
      this.style.display = '';
    }

    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('loadedmetadata', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => {
      this.updatePlayIcon();
      this.onPlay();
    });
    this.audio.addEventListener('pause', () => {
      this.updatePlayIcon();
      this.onPause();
    });
    this.audio.addEventListener('error', () => this.onLoadError());

    this.playBtn?.addEventListener('click', () => this.toggle());
    this.prevBtn?.addEventListener('click', () => this.stepBeat(-1));
    this.nextBtn?.addEventListener('click', () => this.stepBeat(1));
    this.progressEl?.addEventListener('click', (e) =>
      this.seekFromClick(e as MouseEvent),
    );

    this.installMediaSessionHandlers();

    // Dwell-time signal (Foundation Fix Task 07, L17). Heartbeat fires
    // every 30s during continuous play; pagehide handler covers tab
    // close. iOS Safari does NOT fire pagehide reliably on tab-close —
    // the heartbeat is the cover for that gap.
    this.heartbeatTimer = setInterval(() => {
      if (this.audio && !this.audio.paused) {
        this.flushDwell('heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.pagehideHandler = () => this.flushDwell('pagehide');
    window.addEventListener('pagehide', this.pagehideHandler);

    this.stepchangeHandler = (e: Event) => this.onStepChange(e as CustomEvent);
    window.addEventListener('lesson-shell:stepchange', this.stepchangeHandler);
  }

  disconnectedCallback() {
    this.audio?.pause();
    this.clearMediaSession();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pagehideHandler) {
      window.removeEventListener('pagehide', this.pagehideHandler);
      this.pagehideHandler = null;
    }
    if (this.stepchangeHandler) {
      window.removeEventListener('lesson-shell:stepchange', this.stepchangeHandler);
      this.stepchangeHandler = null;
    }
  }

  /**
   * Coordinated-mode handler. Fires when <lesson-shell> changes step.
   * If the new step is a beat with audio, restore the chrome (it's
   * default-hidden in connectedCallback to avoid first-paint flash on
   * hash-resumed non-audio steps) and load the matching clip. Otherwise
   * (interactive / quiz), hide the chrome — there's no clip to play, so
   * a "Step 7 of 9 · Interactive" caption over a dead play button only
   * adds confusion. The reader sees the body content of the step
   * directly; chrome reappears the moment they navigate back to a beat.
   */
  private onStepChange(e: CustomEvent) {
    const detail = e.detail as { stepId?: string; kind?: string; index?: number; total?: number } | undefined;
    if (!detail?.stepId) return;
    const isBeat = detail.kind === 'beat' && !!this.audioBeats[detail.stepId];
    if (isBeat) {
      this.style.display = '';
      const wasPlaying = !!this.audio && !this.audio.paused;
      const shouldAutoplay = wasPlaying || this.autoplayOnNextLoad;
      this.autoplayOnNextLoad = false;
      if (this.currentBeat !== detail.stepId) {
        this.loadBeat(detail.stepId);
      }
      if (shouldAutoplay) {
        this.audio?.play().catch(() => {
          // Autoplay blocked — reader can press play manually
        });
      }
      return;
    }
    // Non-audio step. Hide the chrome, pause whatever was playing.
    this.style.display = 'none';
    this.audio?.pause();
    this.autoplayOnNextLoad = false;
  }

  private loadBeat(beatName: string) {
    if (!this.audio) return;
    const url = this.audioBeats[beatName];
    if (!url) return;
    // Flush dwell for the OUTGOING beat before swapping. currentBeat
    // is still the old beat at this point — the flush attributes the
    // accumulated seconds to the right row.
    if (this.currentBeat !== null && this.currentBeat !== beatName) {
      this.flushDwell('beat_change');
    }
    this.currentBeat = beatName;
    this.audio.src = url;
    this.resetProgressUI();
    this.refreshChrome();
    this.refreshMediaSessionMetadata();
    // Infrastructure for the paginated coordinator (<lesson-shell>)
    // to follow the audio rail. No consumer in scroll mode today.
    window.dispatchEvent(
      new CustomEvent('audio-player:beatchange', {
        detail: {
          beatName,
          index: this.beatOrder.indexOf(beatName),
          total: this.beatOrder.length,
        },
      }),
    );
  }

  /**
   * Prev / next button (and Media Session previoustrack/nexttrack)
   * handler. Dispatches `audio-player:requeststep` for lesson-shell to
   * decide the next step — could be an audio beat or a non-audio step
   * (interactive / quiz / finish). The eventual stepchange comes back
   * to `onStepChange` which loads the matching clip when applicable.
   */
  private stepBeat(direction: -1 | 1) {
    window.dispatchEvent(
      new CustomEvent('audio-player:requeststep', {
        detail: { direction: direction === 1 ? 'next' : 'prev' },
      }),
    );
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
    // Flush BEFORE the requeststep dispatch — currentBeat must still
    // point at the just-ended clip when the dwell row is built. The
    // eventual stepchange would trigger a 'beat_change' flush, but we
    // want the closing event to record as 'ended' (for the ended-
    // reason breakdown in scripts/dwell-health.sql).
    this.flushDwell('ended');
    const hasNext = this.hasNextBeat();
    if (hasNext) {
      // Announce the navigation intent. Lesson-shell decides what
      // comes next (audio beat / interactive / quiz / finish). The
      // autoplayOnNextLoad flag carries the auto-advance intent across
      // the request round-trip so onStepChange resumes playback even
      // though audio.paused is true post-ended.
      this.autoplayOnNextLoad = true;
      window.dispatchEvent(
        new CustomEvent('audio-player:requeststep', {
          detail: { direction: 'next' },
        }),
      );
    }
    // Informational; no current consumer.
    window.dispatchEvent(
      new CustomEvent('audio-player:ended', {
        detail: { beatName: this.currentBeat },
      }),
    );
  }

  private hasNextBeat(): boolean {
    if (!this.currentBeat) return false;
    const idx = this.beatOrder.indexOf(this.currentBeat);
    if (idx === -1) return false;
    return idx + 1 < this.beatOrder.length;
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
    this.accumulateDwell();
    const dur = this.audio.duration;
    const cur = this.audio.currentTime;
    if (this.progressFill && isFinite(dur) && dur > 0) {
      this.progressFill.style.width = `${(cur / dur) * 100}%`;
    }
    if (this.timeEl) this.timeEl.textContent = formatTime(cur);
    this.maybeWritePositionState();
  }

  /**
   * Wall-clock dwell accumulator. Called from every `timeupdate` while
   * playing. Uses performance.now() deltas (NOT audio.currentTime
   * deltas) — currentTime resets to 0 on loadBeat, can jump backward
   * on seekFromClick, and doesn't reflect wall-clock time during
   * stalls. Per-tick delta is clamped to [0, MAX_TICK_DELTA_S] so a
   * backgrounded-tab gap can't inflate dwell_seconds.
   */
  private accumulateDwell() {
    if (!this.audio || this.audio.paused) return;
    const now = performance.now();
    if (this.lastTickAt === null) {
      this.lastTickAt = now;
      return;
    }
    const delta = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.dwellAccumulated += Math.min(delta, MAX_TICK_DELTA_S);
  }

  private onPlay() {
    // Re-arm the tick marker on play / re-play. Don't reset if it's
    // already armed (some browsers fire `play` multiple times for the
    // same playing audio — re-arming would discard the in-flight tick).
    if (this.lastTickAt === null) {
      this.lastTickAt = performance.now();
    }
  }

  private onPause() {
    // Flush whatever has accumulated since the last flush. The
    // dwellAccumulated < MIN_FLUSH_DWELL_S guard inside flushDwell
    // skips noise (e.g. a `pause` immediately followed by `ended`,
    // which can fire back-to-back in some browsers — second call has
    // dwellAccumulated=0 and is skipped).
    this.flushDwell('pause');
  }

  /**
   * Central choke point for every dwell signal. Five callers:
   * onPause / onEnded / loadBeat (beat_change) / heartbeat tick /
   * pagehide. Builds the payload, dispatches to the right transport
   * (sendBeacon for pagehide, fetch+keepalive otherwise), then
   * resets state.
   *
   * Skips sub-half-second flushes EXCEPT pagehide — pagehide is
   * one-shot, so we'd lose the row otherwise.
   */
  private flushDwell(reason: DwellEndedReason) {
    if (!this.audio || !this.pieceId || !this.currentBeat) {
      // Stale-bundle / pre-init / no-piece-id case — drop the signal.
      this.dwellAccumulated = 0;
      this.lastTickAt = this.audio && !this.audio.paused ? performance.now() : null;
      return;
    }

    // Final tick before building the payload — captures the trailing
    // fraction since the last `timeupdate`.
    if (this.lastTickAt !== null && !this.audio.paused) {
      this.accumulateDwell();
    }

    const dwell = this.dwellAccumulated;
    if (dwell < MIN_FLUSH_DWELL_S && reason !== 'pagehide') {
      // Reset so the next play session starts clean.
      this.dwellAccumulated = 0;
      this.lastTickAt = this.audio.paused ? null : performance.now();
      return;
    }

    const dur = this.audio.duration;
    const ratio =
      isFinite(dur) && dur > 0 ? Math.min(dwell / dur, 1.5) : null;

    const payload = {
      piece_id: this.pieceId,
      beat_name: this.currentBeat,
      dwell_seconds: dwell,
      ratio,
      ended_reason: reason,
    };

    if (reason === 'pagehide' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([JSON.stringify(payload)], {
          type: 'application/json',
        });
        navigator.sendBeacon('/api/engagement/audio', blob);
      } catch {
        // sendBeacon throws synchronously on quota; the row is lost.
      }
    } else {
      fetch('/api/engagement/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }

    this.dwellAccumulated = 0;
    this.lastTickAt = this.audio.paused ? null : performance.now();
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
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }

  private seekFromClick(e: MouseEvent) {
    if (!this.audio || !this.progressEl || !this.audio.duration) return;
    const rect = this.progressEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.audio.currentTime = this.audio.duration * pct;
  }

  /**
   * Register Media Session action handlers once per element. These are
   * what the OS calls when the reader taps play/pause/skip on the lock
   * screen, taps a headphone button, or uses a Bluetooth remote. Setting
   * them is also what tells iOS Safari + Android Chrome that this page
   * is doing legitimate background media playback — without them, the
   * audio gets suspended a few minutes after screen lock.
   */
  private installMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler('play', () => {
        this.audio?.play().catch(() => {});
      });
      ms.setActionHandler('pause', () => {
        this.audio?.pause();
      });
      ms.setActionHandler('previoustrack', () => this.stepBeat(-1));
      ms.setActionHandler('nexttrack', () => this.stepBeat(1));
      ms.setActionHandler('seekto', (details) => {
        if (!this.audio || details.seekTime == null) return;
        this.audio.currentTime = details.seekTime;
      });
    } catch {
      // Some browsers throw on unknown actions — silent fallback.
    }
  }

  /**
   * Refresh metadata each time we move to a new beat so the lock screen
   * shows e.g. "Beat 3 of 6 · The Pattern" alongside the piece title.
   */
  private refreshMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    const total = this.beatOrder.length;
    const idx = this.currentBeat ? this.beatOrder.indexOf(this.currentBeat) : -1;
    const beatHuman = this.currentBeat
      ? this.beatTitles.get(this.currentBeat) ?? this.humanise(this.currentBeat)
      : '';
    const beatLabel =
      idx >= 0 && total > 0
        ? `Beat ${idx + 1} of ${total} · ${beatHuman}`
        : beatHuman;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.pieceTitle || 'Daylila',
      artist: 'Daylila',
      album: beatLabel,
      artwork: [
        { src: '/og-image.png', sizes: '1200x630', type: 'image/png' },
      ],
    });
  }

  /**
   * Throttled position-state writer (≤1 Hz). Powers the accurate
   * scrubber + elapsed-time on the lock screen.
   */
  private maybeWritePositionState() {
    if (!('mediaSession' in navigator) || !this.audio) return;
    const setter = navigator.mediaSession.setPositionState;
    if (typeof setter !== 'function') return;
    const now = Date.now();
    if (now - this.lastPositionWrite < 1000) return;
    const dur = this.audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    this.lastPositionWrite = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(this.audio.currentTime, dur),
        playbackRate: this.audio.playbackRate || 1,
      });
    } catch {
      // setPositionState throws on bad values — swallow.
    }
  }

  /**
   * Wipe the lock-screen surface when the player goes away (page nav,
   * SPA-style cleanup). Avoids stale "Beat 3 of 6" lingering on the OS
   * after the reader has moved on.
   */
  private clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch {
      // Some browsers throw on assignment — silent.
    }
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PLAY_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3L13 8L4 13V3Z" /></svg>';
const PAUSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.5" height="10" rx="0.5"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.5"/></svg>';

customElements.define('audio-player', AudioPlayer);

export { AudioPlayer };
