/**
 * HTML interactive render-time wrapper.
 *
 * Single-scroll layout (Area 5) — the daily piece page is a long
 * scroll. A nested scrollbar inside the HTML interactive's iframe is
 * jarring on top of the parent's scroll. Solution: at render time
 * (server-side), append a tiny resize-probe `<script>` to the
 * `srcdoc` HTML. From inside the sandbox, the probe posts the
 * document body's scroll height to the parent via `postMessage`. The
 * parent's `<interactive-frame>` Web Component listens, then sets the
 * iframe's height attribute to match. No nested scroll.
 *
 * Why server-side wrap (not iframe-content modification at generation
 * time): the InteractiveGenerator's HTML output is permanent
 * (content collection JSON file + `quality_flag` lock). Modifying
 * stored HTML would violate the permanence rule. Wrapping at render
 * time leaves stored content untouched.
 *
 * Why `postMessage` (not direct `iframe.contentDocument` access):
 * srcdoc-iframe origin behaviour varies by browser (Chrome treats it
 * as same-origin-as-parent; Safari + Firefox give it an opaque
 * origin). `postMessage` works in every browser and is the
 * spec-blessed cross-frame channel.
 *
 * Magic-token filtering on the parent side (`zeemishFrame: 'resize'`)
 * keeps the parent from acting on stray messages from other tabs or
 * extensions. The sandbox is `allow-scripts` only (no
 * `allow-same-origin`), so a malicious sender's blast radius is
 * limited to making our iframe taller or shorter — minimal.
 */

const RESIZE_PROBE = `
<script>
(function () {
  if (window.__zeemishResizeProbe) return;
  window.__zeemishResizeProbe = true;
  var lastHeight = 0;
  function measure() {
    return Math.max(
      document.documentElement.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0,
    );
  }
  function send(force) {
    var h = measure();
    if (force || h !== lastHeight) {
      lastHeight = h;
      try {
        window.parent.postMessage({ zeemishFrame: 'resize', height: h }, '*');
      } catch (e) { /* ignore */ }
    }
  }
  function replay() {
    // Race-safety: the parent's <interactive-frame> listener may not be
    // attached when the iframe first runs this script (custom-element
    // upgrade can lag iframe load on cold paint). Send a few extra
    // heights over the first ~1.5s so a late-attaching listener still
    // gets the right value.
    [50, 200, 500, 1200].forEach(function (ms) {
      setTimeout(function () { send(true); }, ms);
    });
  }
  function arm() {
    send(true);
    replay();
    if (typeof ResizeObserver === 'function' && document.body) {
      new ResizeObserver(function () { send(false); }).observe(document.body);
    }
    window.addEventListener('load', function () { send(false); });
    window.addEventListener('resize', function () { send(false); });
    // Ping/echo: the parent can request a fresh height by posting
    // {zeemishFrame:'ping'}; we reply with the current height.
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (d && d.zeemishFrame === 'ping') send(true);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }
})();
</script>
`.trim();

/**
 * Append a resize-probe script to a srcdoc HTML string.
 * Idempotent: re-wrapping is a no-op (the probe's `__zeemishResizeProbe`
 * guard prevents double-arming if upstream stores wrapped HTML).
 */
export function wrapWithResizeProbe(html: string): string {
  if (html.includes('__zeemishResizeProbe')) return html;
  // Insert before the closing </body> tag if present; otherwise append.
  const closingBody = /<\/body\s*>/i;
  if (closingBody.test(html)) {
    return html.replace(closingBody, `${RESIZE_PROBE}\n</body>`);
  }
  return `${html}\n${RESIZE_PROBE}`;
}
