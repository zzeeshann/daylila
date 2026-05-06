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
 *   - on first ≥50% intersection with viewport: POST `interactive_viewed`,
 *     once per session per interactive (sessionStorage de-dup matches the
 *     `<lesson-shell>` `interactive_offered` pattern). The ratio
 *     started/viewed measures "did the reader scroll deep enough into the
 *     piece to actually see the HTML interactive?" — only available
 *     because mount and view are distinct events.
 *
 * Iframe-content postMessage protocol (manipulation/dwell signals from
 * inside the sandbox) is deferred to v2 — sandbox semantics + content
 * stability won out over per-interactive reporting for the v3 loop.
 */

class InteractiveFrame extends HTMLElement {
  private interactiveId = '';
  private startedFired = false;
  private viewObserver: IntersectionObserver | null = null;
  private resizeMessageHandler: ((e: MessageEvent) => void) | null = null;

  connectedCallback() {
    this.interactiveId = this.getAttribute('data-interactive-id') ?? '';

    if (!this.startedFired) {
      this.startedFired = true;
      this.postEvent('interactive_started', {});
    }

    this.observeViewport();
    this.listenForResize();
  }

  disconnectedCallback() {
    if (this.viewObserver) {
      this.viewObserver.disconnect();
      this.viewObserver = null;
    }
    if (this.resizeMessageHandler) {
      window.removeEventListener('message', this.resizeMessageHandler);
      this.resizeMessageHandler = null;
    }
  }

  /**
   * Listen for resize messages from inside the sandboxed iframe.
   * The probe injected at render time (src/lib/interactive-html.ts)
   * posts `{ zeemishFrame: 'resize', height: <px> }` whenever the
   * inner document body height changes. Setting the iframe's
   * inline `height` lets the page eliminate the nested scrollbar
   * that the fixed CSS height (`600px`) would otherwise force on
   * tall interactives.
   *
   * Magic-token filter (no origin check) — srcdoc-iframe origin
   * varies by browser; `zeemishFrame === 'resize'` is the contract.
   * Sandbox is `allow-scripts` only, so a stray sender can't reach
   * our APIs; worst case is a wrong height.
   */
  private listenForResize(): void {
    const iframe = this.querySelector('iframe');
    if (!(iframe instanceof HTMLIFrameElement)) return;

    this.resizeMessageHandler = (e: MessageEvent) => {
      // Only honour messages from THIS element's iframe, not other
      // frames on the page (a piece could in theory carry multiple
      // iframes, today only one).
      if (e.source !== iframe.contentWindow) return;
      const data = e.data as { zeemishFrame?: string; height?: number } | null;
      if (!data || data.zeemishFrame !== 'resize') return;
      const h = typeof data.height === 'number' ? data.height : 0;
      if (h <= 0 || h > 10000) return; // sanity clamp
      iframe.style.height = `${Math.ceil(h)}px`;
    };
    window.addEventListener('message', this.resizeMessageHandler);

    // Ask the iframe for a fresh height now in case it loaded BEFORE
    // this listener attached (custom-element upgrade can lag the
    // iframe's first paint on cold loads). The probe inside the
    // sandbox echoes height on `{zeemishFrame:'ping'}`. Retry a
    // couple of times in case the iframe itself is still loading.
    const ping = () => {
      const w = iframe.contentWindow;
      if (!w) return;
      try { w.postMessage({ zeemishFrame: 'ping' }, '*'); } catch { /* ignore */ }
    };
    if (iframe.contentWindow) ping();
    iframe.addEventListener('load', ping, { once: true });
    setTimeout(ping, 250);
    setTimeout(ping, 1000);
  }

  private observeViewport(): void {
    if (!this.interactiveId) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const sessionKey = `daylila-interactive-viewed:${this.interactiveId}`;
    try {
      if (sessionStorage.getItem(sessionKey) === '1') return;
    } catch {
      // sessionStorage can throw in privacy modes — fall through and
      // accept that the event may fire more than once per session.
    }

    this.viewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
          try {
            sessionStorage.setItem(sessionKey, '1');
          } catch {
            /* ignore — see above */
          }
          this.postEvent('interactive_viewed', {});
          this.viewObserver?.disconnect();
          this.viewObserver = null;
          break;
        }
      },
      { threshold: 0.5, rootMargin: '0px' },
    );
    this.viewObserver.observe(this);
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
