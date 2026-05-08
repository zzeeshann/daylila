/**
 * Swipe-to-step gestures for paginated mode (C6, 2026-05-08).
 *
 * Listens for horizontal pointer drags on the document and translates
 * them into `audio-player:requeststep` events. Lesson-shell already
 * subscribes to that event (its scroll-mode handler from C3); the
 * swipe is just one more input alongside dot taps + audio prev/next.
 *
 * Active only when paginated mode is hydrated. The check happens at
 * pointerdown rather than mount so the toggle reacts naturally if a
 * single-page reader's session somehow ended up on a piece without
 * the paginated flag (would happen during the brief window between
 * `?paginated=1` URL param and lesson-shell setting hydrated).
 *
 * Heuristics:
 *   - horizontal distance ≥ SWIPE_DISTANCE_PX → eligible swipe
 *   - vertical distance < SWIPE_DISTANCE_PX / 2 → confirms it's mostly
 *     horizontal (filters tap-then-scroll, scroll-up gestures)
 *   - startX inside EDGE_GUARD_PX of either edge → skipped (iOS uses
 *     left-edge swipes for browser back navigation; competing with
 *     that would be hostile)
 *   - duration > 600ms → skipped (slow drags read as scroll, not swipe)
 *
 * Passive listeners by default so we don't block page-scroll. Falls
 * back gracefully on environments without PointerEvent (older Android
 * WebView etc.) — the gesture simply doesn't engage; tap-dot still
 * works.
 */

const SWIPE_DISTANCE_PX = 50;
const EDGE_GUARD_PX = 24;
const SWIPE_MAX_DURATION_MS = 600;

interface SwipeStart {
  x: number;
  y: number;
  t: number;
  pointerId: number;
}

let active: SwipeStart | null = null;

function isPaginated(): boolean {
  return (
    document.documentElement.dataset.lessonPaginated === 'true' &&
    document.documentElement.dataset.lessonHydrated === 'true'
  );
}

function onPointerDown(e: PointerEvent) {
  if (!isPaginated()) return;
  // Touch + pen only — mouse drags would conflict with text selection
  // and click-handling on dots / audio buttons.
  if (e.pointerType === 'mouse') return;
  // Skip near edges to leave iOS browser back-swipe alone.
  if (e.clientX < EDGE_GUARD_PX) return;
  if (e.clientX > window.innerWidth - EDGE_GUARD_PX) return;
  active = { x: e.clientX, y: e.clientY, t: performance.now(), pointerId: e.pointerId };
}

function onPointerUp(e: PointerEvent) {
  const start = active;
  active = null;
  if (!start || start.pointerId !== e.pointerId) return;
  if (!isPaginated()) return;

  const dx = e.clientX - start.x;
  const dy = Math.abs(e.clientY - start.y);
  const dt = performance.now() - start.t;

  if (dt > SWIPE_MAX_DURATION_MS) return;
  if (Math.abs(dx) < SWIPE_DISTANCE_PX) return;
  if (dy >= SWIPE_DISTANCE_PX / 2) return;

  // Right swipe → previous step. Left swipe → next step. Matches
  // the natural reading direction (LTR; RTL would invert but Daylila
  // ships LTR-only today).
  const direction: 'prev' | 'next' = dx > 0 ? 'prev' : 'next';
  window.dispatchEvent(
    new CustomEvent('audio-player:requeststep', { detail: { direction } }),
  );
}

function onPointerCancel(e: PointerEvent) {
  if (active && active.pointerId === e.pointerId) active = null;
}

if (typeof window !== 'undefined' && 'PointerEvent' in window) {
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  document.addEventListener('pointercancel', onPointerCancel, { passive: true });
}

export {};
