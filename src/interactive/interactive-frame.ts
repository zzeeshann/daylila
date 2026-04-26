/**
 * <interactive-frame> — sandboxed-iframe Web Component for HTML
 * interactives.
 *
 * The iframe is server-rendered as a child of this element with the
 * full HTML inlined via `srcdoc=` (Astro's HTML escaping protects
 * against attribute injection). The component itself is a thin shell —
 * it doesn't mount or transform the iframe; it only fires engagement
 * events. Server-side rendering of the iframe is intentional:
 *
 *   - JSON payload would need its own escaping for `</script>`
 *     sequences inside the html string (real risk: HTML interactives
 *     contain `<script>` blocks). srcdoc on the attribute side avoids
 *     this entirely.
 *   - SSR-rendered iframes work without JS (better progressive
 *     enhancement). If this script never loads, the reader still sees
 *     the rendered interactive — they just don't trigger engagement
 *     events. That's the right priority order.
 *
 * The iframe runs inside the EXACT sandbox shape from
 * docs/INTERACTIVES.md "The iframe sandbox shape" — `sandbox="allow-scripts"`
 * (one token), `loading="lazy"`, `referrerpolicy="no-referrer"`,
 * `title={concept}`. The route page composes these attributes; this
 * component does NOT touch them. Sandbox is a server-asserted
 * contract.
 *
 * Events fired (matching the quiz path's fire-and-forget shape):
 *   - on connect: POST `interactive_started` to /api/interactive/track.
 *
 * Phase 4 hook (deferred): listen for `message` events from the
 * iframe's contentWindow and forward to /api/interactive/track as
 * `interactive_engaged` events. The sandbox without `allow-same-origin`
 * still allows postMessage in both directions, so an interactive that
 * wants to report engagement (e.g. "manipulated > N times") posts a
 * `{type: 'interactive_engagement', event: '...'}` message to the
 * parent. We add the listener in Phase 4 when the engagement aggregator
 * lands.
 */

class InteractiveFrame extends HTMLElement {
  private interactiveId = '';
  private startedFired = false;

  connectedCallback() {
    this.interactiveId = this.getAttribute('data-interactive-id') ?? '';

    if (!this.startedFired) {
      this.startedFired = true;
      this.postEvent('interactive_started', {});
    }

    // Phase 4 hook — listener for postMessage events from the iframe's
    // contentWindow. Currently inert; lands when engagement aggregation
    // is wired in.
    //
    // const iframe = this.querySelector('iframe');
    // window.addEventListener('message', (e) => {
    //   if (iframe && e.source === iframe.contentWindow) {
    //     const data = e.data as { type?: string; event?: string };
    //     if (data?.type === 'interactive_engagement' && typeof data.event === 'string') {
    //       this.postEvent('interactive_engaged', { engagement_event: data.event });
    //     }
    //   }
    // });
  }

  private postEvent(eventType: string, extra: Record<string, unknown>): void {
    if (!this.interactiveId) return;
    const body = JSON.stringify({
      interactive_id: this.interactiveId,
      event_type: eventType,
      ...extra,
    });
    fetch('/api/interactive/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Endpoint may be unavailable in some environments; fail-silent
      // matches the quiz-card pattern.
    });
  }
}

customElements.define('interactive-frame', InteractiveFrame);

export { InteractiveFrame };
