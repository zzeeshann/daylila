/**
 * Reference HTML interactive — the canonical "good looks like this"
 * example used as a few-shot in INTERACTIVE_HTML_GENERATOR_PROMPT.
 *
 * Mirror of docs/examples/interactive-reference.html. The .html file
 * is the human-readable canonical (Phase 0 decision (b) — permanent,
 * never deleted, updated in place if voice evolves). This .ts mirror
 * exists because Cloudflare Workers can't readFileSync at runtime;
 * the prompt module needs the content as a string at build time.
 *
 * Sync rule: when the .html file changes, update this string. A
 * pnpm script (`pnpm verify-reference-sync`) is queued in FOLLOWUPS
 * to detect drift; for now the convention is "edit both together".
 */

export const INTERACTIVE_HTML_REFERENCE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chokepoints and Cascades</title>
<style>
  :root {
    --bg: #faf7f1;
    --fg: #1a1a1a;
    --muted: #6b6b6b;
    --line: #e5e0d6;
    --gold: #c9a227;
    --teal: #1a6b62;
  }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0;
    padding: 20px;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.5;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0 0 4px;
  }
  p.subhead {
    margin: 0 0 20px;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .control {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }
  .control label {
    font-weight: 500;
    flex-shrink: 0;
  }
  .control input[type=range] {
    flex: 1;
    accent-color: var(--teal);
    min-width: 120px;
  }
  .control output {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    min-width: 3.5ch;
    text-align: right;
  }
  .pipeline {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 16px;
    align-items: center;
    margin: 24px 0 12px;
  }
  .lanes {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lane {
    height: 18px;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
    position: relative;
  }
  .lane > .fill {
    height: 100%;
    background: var(--gold);
    transition: width 180ms ease-out;
  }
  .choke {
    width: 12px;
    height: 80px;
    background: var(--teal);
    border-radius: 2px;
    position: relative;
  }
  .lanes-label {
    font-size: 0.75rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
  }
  .group {
    display: flex;
    flex-direction: column;
  }
  .reading {
    margin: 18px 0 6px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .reading strong {
    font-weight: 600;
  }
  p.caption {
    margin: 14px 0 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
  @media (max-width: 480px) {
    .pipeline {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }
    .choke {
      width: 80px;
      height: 12px;
      margin: 0 auto;
    }
  }
</style>
</head>
<body>
<h2>Drag to compress the chokepoint</h2>
<p class="subhead">Three input streams converge through one constraint, then split back out.</p>

<div class="control">
  <label for="capacity">Capacity:</label>
  <input id="capacity" type="range" min="0" max="100" value="100" aria-describedby="capacity-out">
  <output id="capacity-out" for="capacity">100</output>
</div>

<div class="pipeline" aria-hidden="true">
  <div class="group">
    <span class="lanes-label">Inputs</span>
    <div class="lanes">
      <div class="lane"><div class="fill" data-stream="in"></div></div>
      <div class="lane"><div class="fill" data-stream="in"></div></div>
      <div class="lane"><div class="fill" data-stream="in"></div></div>
    </div>
  </div>
  <div class="choke" id="choke" aria-hidden="true"></div>
  <div class="group">
    <span class="lanes-label">Outputs</span>
    <div class="lanes">
      <div class="lane"><div class="fill" data-stream="out"></div></div>
      <div class="lane"><div class="fill" data-stream="out"></div></div>
      <div class="lane"><div class="fill" data-stream="out"></div></div>
    </div>
  </div>
</div>

<div class="reading">
  Throughput per lane: <strong id="throughput">100</strong>%.
  Limited by: <strong id="limit">upstream supply</strong>.
</div>

<p class="caption" id="caption">Throughput tracks supply. Capacity is not the binding constraint.</p>

<script>
  (function () {
    var slider = document.getElementById('capacity');
    var capOut = document.getElementById('capacity-out');
    var throughput = document.getElementById('throughput');
    var limit = document.getElementById('limit');
    var caption = document.getElementById('caption');
    var choke = document.getElementById('choke');
    var inFills = document.querySelectorAll('.fill[data-stream="in"]');
    var outFills = document.querySelectorAll('.fill[data-stream="out"]');

    function setLanes(list, percent) {
      for (var i = 0; i < list.length; i++) {
        list[i].style.width = percent + '%';
      }
    }

    function update() {
      var cap = +slider.value;
      capOut.textContent = cap;
      setLanes(inFills, 100);
      setLanes(outFills, cap);
      choke.style.setProperty('--choke-scale', String(cap / 100));
      throughput.textContent = cap;
      if (cap === 100) {
        limit.textContent = 'upstream supply';
        caption.textContent = 'Throughput tracks supply. Capacity is not the binding constraint.';
      } else if (cap >= 70) {
        limit.textContent = 'the chokepoint, just barely';
        caption.textContent = 'A small constraint trims the system. Downstream still sees most of the supply.';
      } else if (cap >= 30) {
        limit.textContent = 'the chokepoint';
        caption.textContent = 'The chokepoint sets the rate, not the inputs. Downstream sees what the constraint allows.';
      } else {
        limit.textContent = 'the chokepoint, severely';
        caption.textContent = 'A narrow constraint cascades downstream. Three full inputs collapse to a thin output.';
      }
    }

    var styleEl = document.createElement('style');
    styleEl.textContent =
      '.choke::before { transform: scaleY(calc(1 - var(--choke-scale, 1))); }' +
      '@media (max-width: 480px) { .choke::before { transform: scaleX(calc(1 - var(--choke-scale, 1))); } }';
    document.head.appendChild(styleEl);

    slider.addEventListener('input', update);
    update();
  })();
</script>
</body>
</html>
`;
