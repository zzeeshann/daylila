/**
 * <lesson-compare> — side-by-side two-state widget.
 *
 * Earns its place when the *contrast* IS the lesson (before/after,
 * with/without, wrong/right) and prose would force the reader to hold
 * both states in working memory across paragraphs.
 *
 * Usage in MDX (PR #3, 2026-05-09):
 *
 *     <lesson-compare>
 *     <lesson-state label="Without insulation">House loses 60% of heat through the roof.</lesson-state>
 *     <lesson-state label="With insulation">Heat loss drops to 15%.</lesson-state>
 *     </lesson-compare>
 *
 * Without JS: renders as two stacked `<aside>`-shaped blocks; the
 * contrast is preserved.
 *
 * Audio narration: the audio producer narrates both labels and bodies
 * in sequence. See widget-aware extraction in agents/src/audio-producer.ts.
 *
 * Engagement: emits a one-shot CustomEvent on first viewport entry
 * (mirrors the per-step engagement rhythm). The <lesson-shell> parent
 * forwards as 'widget_compare_viewed'.
 */
class Compare extends HTMLElement {
  private viewedFired = false;
  private observer: IntersectionObserver | null = null;

  connectedCallback() {
    if (this.dataset.upgraded === 'true') return;
    this.dataset.upgraded = 'true';

    this.classList.add('widget-compare');
    // Wrap state children for grid layout
    const states = Array.from(this.querySelectorAll('lesson-state'));
    if (states.length === 0) return;

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !this.viewedFired) {
              this.viewedFired = true;
              this.dispatchEvent(
                new CustomEvent('widget:compare-viewed', {
                  bubbles: true,
                  detail: { stateCount: states.length },
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

class CompareState extends HTMLElement {
  static get observedAttributes() {
    return ['label'];
  }

  connectedCallback() {
    if (this.dataset.upgraded === 'true') return;
    this.dataset.upgraded = 'true';
    const label = this.getAttribute('label') ?? '';
    const body = this.innerHTML;
    this.classList.add('widget-compare-state');
    this.innerHTML = `
      <div class="widget-compare-label">${this.escape(label)}</div>
      <div class="widget-compare-body">${body}</div>
    `;
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

customElements.define('lesson-compare', Compare);
customElements.define('lesson-state', CompareState);

export { Compare, CompareState };
