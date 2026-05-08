/**
 * <lesson-progress> — slim row of progress dots near the top of a
 * paginated daily piece. One dot per step (each `<lesson-beat>` plus
 * each `[data-lesson-step]` region — interactive, quiz, finish). The
 * active dot is filled; tap any dot to jump.
 *
 * Data flow:
 *   - On connect: query `<lesson-shell>` for the step list. If shell
 *     hasn't built its list yet (custom-element connect order is not
 *     guaranteed), wait for the one-shot `lesson-shell:ready` event.
 *   - Subscribes to `lesson-shell:stepchange` to keep the active dot
 *     in sync with whichever step is current.
 *   - On dot tap, dispatches `lesson-progress:goto` with `{ stepId }`
 *     for `<lesson-shell>` to consume.
 *
 * Visibility: hidden by CSS when `:root[data-lesson-paginated="true"]`
 * is not set. Scroll-mode pages render this component but it shows
 * nothing — keeps LessonLayout markup mode-agnostic.
 */

interface ShellStep {
  id: string;
  kind: string;
}

interface LessonShellPublic {
  getSteps(): ShellStep[];
  getCurrentStepId(): string | null;
}

class LessonProgress extends HTMLElement {
  private steps: ShellStep[] = [];
  private currentStepId: string | null = null;
  private stepchangeHandler: EventListener | null = null;
  private readyHandler: EventListener | null = null;

  connectedCallback() {
    const shell = this.findShell();
    if (shell) {
      this.steps = shell.getSteps();
      this.currentStepId = shell.getCurrentStepId();
      this.render();
    } else {
      // <lesson-shell> may connect after us. Wait for its ready event.
      this.readyHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail as { steps?: ShellStep[] } | undefined;
        if (detail?.steps) this.steps = detail.steps;
        const s = this.findShell();
        this.currentStepId = s?.getCurrentStepId() ?? null;
        this.render();
      };
      document.addEventListener('lesson-shell:ready', this.readyHandler, { once: true });
    }

    this.stepchangeHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { stepId?: string } | undefined;
      if (!detail?.stepId) return;
      this.currentStepId = detail.stepId;
      this.updateDots();
    };
    window.addEventListener('lesson-shell:stepchange', this.stepchangeHandler);
  }

  disconnectedCallback() {
    if (this.stepchangeHandler) {
      window.removeEventListener('lesson-shell:stepchange', this.stepchangeHandler);
      this.stepchangeHandler = null;
    }
    if (this.readyHandler) {
      document.removeEventListener('lesson-shell:ready', this.readyHandler);
      this.readyHandler = null;
    }
  }

  private findShell(): LessonShellPublic | null {
    const el = document.querySelector('lesson-shell');
    if (!el) return null;
    const candidate = el as unknown as Partial<LessonShellPublic>;
    if (typeof candidate.getSteps !== 'function') return null;
    if (typeof candidate.getCurrentStepId !== 'function') return null;
    return candidate as LessonShellPublic;
  }

  private render() {
    if (this.steps.length === 0) {
      this.innerHTML = '';
      return;
    }
    const dots = this.steps
      .map(
        (s, i) =>
          `<button type="button" class="lesson-progress-dot" data-step-id="${escapeAttr(s.id)}" data-step-kind="${escapeAttr(s.kind)}" aria-label="Step ${i + 1} of ${this.steps.length}: ${escapeAttr(s.id)}"></button>`,
      )
      .join('');
    this.innerHTML = `<nav class="lesson-progress-bar" aria-label="Lesson steps">${dots}</nav>`;
    for (const btn of this.queryDots()) {
      btn.addEventListener('click', () => {
        const stepId = btn.dataset.stepId;
        if (!stepId) return;
        document.dispatchEvent(
          new CustomEvent('lesson-progress:goto', { detail: { stepId } }),
        );
      });
    }
    this.updateDots();
  }

  private queryDots(): HTMLButtonElement[] {
    return Array.from(this.querySelectorAll('.lesson-progress-dot')) as HTMLButtonElement[];
  }

  private updateDots() {
    for (const btn of this.queryDots()) {
      if (btn.dataset.stepId === this.currentStepId) {
        btn.setAttribute('data-active', 'true');
        btn.setAttribute('aria-current', 'step');
      } else {
        btn.removeAttribute('data-active');
        btn.removeAttribute('aria-current');
      }
    }
  }
}

/** Minimal HTML attribute escaper for the dot-button data-step-id and
 *  aria-label values. Beat names are kebab-case slugs but defensive
 *  escaping covers any future rename to richer step IDs. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

customElements.define('lesson-progress', LessonProgress);

export { LessonProgress };
