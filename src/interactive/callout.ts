/**
 * <lesson-callout> — sidebar / definition / aside widget.
 *
 * Earns its place when an inline parenthetical would break the sentence
 * rhythm. Skip when the inline form reads cleanly — most do.
 *
 * Usage in MDX (PR #3, 2026-05-09):
 *
 *     <lesson-callout type="define">
 *     *Acetylcholine* — the neurotransmitter your muscles listen for.
 *     </lesson-callout>
 *
 * `type` attribute: `define` (default) | `aside` | `note`. Drives the
 * visual treatment via CSS data-attr selectors; same content shape.
 *
 * Without JS: renders as a styled `<aside>`-shaped block; reader still
 * sees the callout content with the type-appropriate styling.
 *
 * Audio narration: the audio producer narrates the body inline (or
 * skips for type="aside" — see widget-aware extraction in
 * agents/src/audio-producer.ts).
 *
 * Engagement: emits a one-shot CustomEvent on first viewport entry.
 * The <lesson-shell> parent forwards as 'widget_callout_seen'.
 */
class Callout extends HTMLElement {
  static get observedAttributes() {
    return ['type'];
  }

  private seenFired = false;
  private observer: IntersectionObserver | null = null;

  connectedCallback() {
    if (this.dataset.upgraded === 'true') return;
    this.dataset.upgraded = 'true';

    const type = this.getAttribute('type') ?? 'define';
    this.dataset.calloutType = type;
    this.classList.add('widget-callout');

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !this.seenFired) {
              this.seenFired = true;
              this.dispatchEvent(
                new CustomEvent('widget:callout-seen', {
                  bubbles: true,
                  detail: { type },
                }),
              );
              this.observer?.disconnect();
              this.observer = null;
            }
          }
        },
        { threshold: 0.5 },
      );
      this.observer.observe(this);
    }
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.observer = null;
  }
}

customElements.define('lesson-callout', Callout);

export { Callout };
