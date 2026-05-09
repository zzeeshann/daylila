/**
 * <reveal prompt="..."> — "tap to reveal" expandable widget.
 *
 * Earns its place when the reader can plausibly *guess* before reading
 * on. Skip when the answer needs specialist knowledge — that's just
 * hiding the lesson behind a tap.
 *
 * Usage in MDX (PR #3, 2026-05-09):
 *
 *     <lesson-reveal prompt="If half the moon is always lit, why aren't all phases just 'half'?">
 *     We see different fractions of that lit half as the moon orbits Earth.
 *     The Sun keeps lighting the same half; our viewing angle changes.
 *     </lesson-reveal>
 *
 * Custom-element naming requires a hyphen — that's why the MDX tag is
 * `<lesson-reveal>` not `<reveal>`. Same family-prefix pattern as
 * <lesson-beat> / <lesson-shell> / <lesson-progress>.
 *
 * Without JS (progressive enhancement): renders as a `<details>`-shaped
 * native expandable, so the reader still gets the prompt + answer.
 *
 * Audio narration: the audio producer narrates the prompt and SKIPS the
 * body — the reader does the thinking step. See widget-aware extraction
 * in agents/src/audio-producer.ts.
 *
 * Engagement: emits a one-shot CustomEvent on first open. The
 * <lesson-shell> parent forwards it to /api/engagement/track with
 * event_type 'widget_reveal_opened' for Learner-side density signals.
 */
class Reveal extends HTMLElement {
  static get observedAttributes() {
    return ['prompt'];
  }

  private opened = false;

  connectedCallback() {
    if (this.dataset.upgraded === 'true') return;
    this.dataset.upgraded = 'true';

    const prompt = this.getAttribute('prompt') ?? '';
    const body = this.innerHTML;

    this.innerHTML = `
      <details class="widget-reveal">
        <summary>${this.escape(prompt)}</summary>
        <div class="widget-reveal-body">${body}</div>
      </details>
    `;

    const details = this.querySelector('details');
    if (!details) return;
    details.addEventListener('toggle', () => {
      if (details.open && !this.opened) {
        this.opened = true;
        this.dispatchEvent(
          new CustomEvent('widget:reveal-opened', {
            bubbles: true,
            detail: { prompt },
          }),
        );
      }
    });
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    } as Record<string, string>)[c] ?? c);
  }
}

customElements.define('lesson-reveal', Reveal);

export { Reveal };
