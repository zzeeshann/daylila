#!/usr/bin/env node
// Regression harness for the HTML interactive validator at
// agents/src/interactive-validator.ts.
//
// Covers all 8 validator rules from docs/INTERACTIVES.md, plus the
// comment-stripping pre-pass (HTML comments + JS comments).
//
// Usage: node agents/scripts/verify-validator.mjs (or `pnpm verify-validator`).
// Exit code: 0 on all pass, 1 on any failure.
//
// Inline copy of the validator — importing .ts from node would need
// full tsc setup; keeping a plain-JS mirror (same pattern as
// verify-splice.mjs and verify-normalize.mjs) is the established way.
// Sync if either file changes.

const HTML_FILE_BYTES_MAX = 50 * 1024;
const HTML_SCRIPT_ALLOWLIST_DESCRIPTION =
  'https://cdnjs.cloudflare.com/ajax/libs/d3/7.<minor>.<patch>/d3.min.js (D3 v7 only, cdnjs only)';
const HTML_SCRIPT_ALLOWLIST_REGEXES = [
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/7\.\d+\.\d+\/d3\.min\.js$/,
];
const SNIPPET_MAX_CHARS = 200;

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function extractScriptBodies(tagScanHtml) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const parts = [];
  let m;
  while ((m = re.exec(tagScanHtml)) !== null) {
    parts.push(m[1]);
  }
  return parts.join('\n');
}

function stripJsComments(js) {
  let out = js.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\n\r]*/g, '');
  return out;
}

function utf8ByteLength(s) {
  return new TextEncoder().encode(s).length;
}

function snippetAround(text, index, length) {
  const end = Math.min(text.length, index + Math.min(length, SNIPPET_MAX_CHARS));
  const slice = text.slice(index, end).replace(/\s+/g, ' ').trim();
  if (slice.length <= SNIPPET_MAX_CHARS) return slice;
  return slice.slice(0, SNIPPET_MAX_CHARS - 1) + '…';
}

function collectFirstMatch(text, pattern, rule, message, out) {
  const m = pattern.exec(text);
  if (!m) return;
  out.push({
    rule,
    message,
    snippet: snippetAround(text, m.index, m[0].length),
    byteOffset: m.index,
  });
}

function collectScriptSrcViolations(tagScanHtml, out) {
  const re = /<script\s[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let m;
  while ((m = re.exec(tagScanHtml)) !== null) {
    const url = m[1];
    const allowed = HTML_SCRIPT_ALLOWLIST_REGEXES.some((rx) => rx.test(url));
    if (allowed) continue;
    out.push({
      rule: 'external-script-allowlist',
      message: `External script src "${url}" is not on the allowlist. Allowed: ${HTML_SCRIPT_ALLOWLIST_DESCRIPTION}.`,
      snippet: snippetAround(tagScanHtml, m.index, m[0].length),
      byteOffset: m.index,
    });
  }
}

function validate(html) {
  const violations = [];

  const byteLength = utf8ByteLength(html);
  if (byteLength > HTML_FILE_BYTES_MAX) {
    const actualKB = (byteLength / 1024).toFixed(1);
    violations.push({
      rule: 'size-cap',
      message: `File is ${actualKB} KB; the limit is 50 KB. Trim inline data, drop unused CSS, simplify repeated SVG paths, or remove dead code.`,
    });
  }

  const tagScan = stripHtmlComments(html);
  const scriptScan = stripJsComments(extractScriptBodies(tagScan));

  collectFirstMatch(
    scriptScan,
    /\b(localStorage|sessionStorage|indexedDB)\b/,
    'storage-api',
    'Sandbox iframe cannot use localStorage / sessionStorage / indexedDB — they throw SecurityError at runtime. Hold state in memory for the session only.',
    violations,
  );

  collectFirstMatch(
    scriptScan,
    /\beval\s*\(|\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/,
    'dynamic-code',
    'Dynamic code execution is forbidden inside the sandbox. Replace eval / new Function / setTimeout("...") / setInterval("...") with a function reference: setTimeout(fn, ms).',
    violations,
  );

  collectScriptSrcViolations(tagScan, violations);

  collectFirstMatch(
    scriptScan,
    /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bnavigator\.sendBeacon\s*\(/,
    'network-call',
    'Sandboxed interactives must be self-contained. Replace fetch / XMLHttpRequest / WebSocket / EventSource / navigator.sendBeacon with inline data; for engagement events, postMessage to the parent.',
    violations,
  );

  collectFirstMatch(
    tagScan,
    /<iframe\b/i,
    'nested-iframe',
    'Nested <iframe> is forbidden — outer sandbox cannot constrain inner attributes. Render the content directly in this file.',
    violations,
  );

  collectFirstMatch(
    tagScan,
    /<form\b/i,
    'form-element',
    '<form> is forbidden — the sandbox disallows submission and the element would be visible-but-broken UI. Wire JS event handlers on inputs instead.',
    violations,
  );

  collectFirstMatch(
    tagScan,
    /\b(?:src|href)\s*=\s*['"]\s*(?:data|blob):/i,
    'unsafe-url-scheme',
    'data: and blob: URLs in src= or href= attributes are forbidden — they are a sandbox-bypass surface. Inline content directly. (data: URIs in CSS url(...) for images/fonts are fine.)',
    violations,
  );

  return violations.length === 0
    ? { passed: true }
    : { passed: false, violations };
}

// ─────────────────────────────────────────────────────────────────────
//   Test cases
// ─────────────────────────────────────────────────────────────────────

const VALID_MINIMAL = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>T</title></head>
<body>
<input id="r" type="range" min="0" max="100">
<output id="o">0</output>
<script>
const r = document.getElementById('r');
const o = document.getElementById('o');
r.addEventListener('input', () => { o.textContent = r.value; });
</script>
</body>
</html>`;

const VALID_WITH_D3 = VALID_MINIMAL.replace(
  '<script>',
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>\n<script>',
);

const cases = [
  // ── Pass cases ──
  {
    name: 'valid minimal HTML passes all 8 rules',
    html: VALID_MINIMAL,
    expectPassed: true,
  },
  {
    name: 'allowlisted D3 v7 script passes external-script rule',
    html: VALID_WITH_D3,
    expectPassed: true,
  },
  {
    name: 'HTML comment mentioning localStorage does not trigger storage-api',
    html: `<!DOCTYPE html><html><body>
<!-- this interactive does NOT use localStorage -->
<script>const x = 1;</script>
</body></html>`,
    expectPassed: true,
  },
  {
    name: 'JS line-comment mentioning eval does not trigger dynamic-code',
    html: `<!DOCTYPE html><html><body>
<script>
// no eval() here
const x = 1;
</script>
</body></html>`,
    expectPassed: true,
  },
  {
    name: 'JS block-comment mentioning fetch does not trigger network-call',
    html: `<!DOCTYPE html><html><body>
<script>
/* this is not a fetch( call */
const x = 1;
</script>
</body></html>`,
    expectPassed: true,
  },
  {
    name: 'setTimeout with function reference does not trigger dynamic-code',
    html: `<!DOCTYPE html><html><body>
<script>
function tick() {}
setTimeout(tick, 100);
</script>
</body></html>`,
    expectPassed: true,
  },
  {
    name: 'CSS data: URI in url(...) does not trigger unsafe-url-scheme',
    html: `<!DOCTYPE html><html>
<head><style>body { background-image: url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=); }</style></head>
<body><div></div></body></html>`,
    expectPassed: true,
  },

  // ── Fail cases — one rule per ──
  {
    name: 'oversized file fails size-cap',
    html: '<!DOCTYPE html><html><body>' + 'x'.repeat(51 * 1024) + '</body></html>',
    expectPassed: false,
    expectRules: ['size-cap'],
  },
  {
    name: 'localStorage in script fails storage-api',
    html: `<!DOCTYPE html><html><body><script>localStorage.setItem('k','v');</script></body></html>`,
    expectPassed: false,
    expectRules: ['storage-api'],
  },
  {
    name: 'sessionStorage fails storage-api',
    html: `<!DOCTYPE html><html><body><script>const x = sessionStorage.getItem('k');</script></body></html>`,
    expectPassed: false,
    expectRules: ['storage-api'],
  },
  {
    name: 'indexedDB fails storage-api',
    html: `<!DOCTYPE html><html><body><script>const db = indexedDB.open('foo');</script></body></html>`,
    expectPassed: false,
    expectRules: ['storage-api'],
  },
  {
    name: 'eval(...) fails dynamic-code',
    html: `<!DOCTYPE html><html><body><script>eval('1+1');</script></body></html>`,
    expectPassed: false,
    expectRules: ['dynamic-code'],
  },
  {
    name: 'new Function() fails dynamic-code',
    html: `<!DOCTYPE html><html><body><script>const f = new Function('return 1');</script></body></html>`,
    expectPassed: false,
    expectRules: ['dynamic-code'],
  },
  {
    name: 'setTimeout with string fails dynamic-code',
    html: `<!DOCTYPE html><html><body><script>setTimeout("doIt()", 100);</script></body></html>`,
    expectPassed: false,
    expectRules: ['dynamic-code'],
  },
  {
    name: 'setInterval with string fails dynamic-code',
    html: `<!DOCTYPE html><html><body><script>setInterval('tick()', 100);</script></body></html>`,
    expectPassed: false,
    expectRules: ['dynamic-code'],
  },
  {
    name: 'non-allowlist external script fails external-script-allowlist',
    html: `<!DOCTYPE html><html><head><script src="https://example.com/lib.js"></script></head><body></body></html>`,
    expectPassed: false,
    expectRules: ['external-script-allowlist'],
  },
  {
    name: 'D3 v6 (wrong major) fails external-script-allowlist',
    html: `<!DOCTYPE html><html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/d3/6.7.0/d3.min.js"></script></head><body></body></html>`,
    expectPassed: false,
    expectRules: ['external-script-allowlist'],
  },
  {
    name: 'D3 from non-cdnjs CDN fails external-script-allowlist',
    html: `<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/d3@7"></script></head><body></body></html>`,
    expectPassed: false,
    expectRules: ['external-script-allowlist'],
  },
  {
    name: 'fetch(...) fails network-call',
    html: `<!DOCTYPE html><html><body><script>fetch('/api');</script></body></html>`,
    expectPassed: false,
    expectRules: ['network-call'],
  },
  {
    name: 'new XMLHttpRequest() fails network-call',
    html: `<!DOCTYPE html><html><body><script>const r = new XMLHttpRequest();</script></body></html>`,
    expectPassed: false,
    expectRules: ['network-call'],
  },
  {
    name: 'new WebSocket() fails network-call',
    html: `<!DOCTYPE html><html><body><script>const s = new WebSocket('wss://x');</script></body></html>`,
    expectPassed: false,
    expectRules: ['network-call'],
  },
  {
    name: 'navigator.sendBeacon(...) fails network-call',
    html: `<!DOCTYPE html><html><body><script>navigator.sendBeacon('/x', 'd');</script></body></html>`,
    expectPassed: false,
    expectRules: ['network-call'],
  },
  {
    name: 'nested <iframe> fails nested-iframe',
    html: `<!DOCTYPE html><html><body><iframe src="https://example.com"></iframe></body></html>`,
    expectPassed: false,
    expectRules: ['nested-iframe'],
  },
  {
    name: '<form> fails form-element',
    html: `<!DOCTYPE html><html><body><form><input></form></body></html>`,
    expectPassed: false,
    expectRules: ['form-element'],
  },
  {
    name: 'data: URL in src= fails unsafe-url-scheme',
    html: `<!DOCTYPE html><html><body><img src="data:image/png;base64,iVBORw0KGgo="></body></html>`,
    expectPassed: false,
    expectRules: ['unsafe-url-scheme'],
  },
  {
    name: 'blob: URL in href= fails unsafe-url-scheme',
    html: `<!DOCTYPE html><html><body><a href="blob:abc">x</a></body></html>`,
    expectPassed: false,
    expectRules: ['unsafe-url-scheme'],
  },

  // ── Multi-rule failure ──
  {
    name: 'multiple rule fails surface as multiple violations',
    html: `<!DOCTYPE html><html>
<head><script src="https://example.com/lib.js"></script></head>
<body>
<form><input></form>
<script>
localStorage.setItem('k','v');
fetch('/api');
eval('x');
</script>
</body></html>`,
    expectPassed: false,
    expectRules: [
      'storage-api',
      'dynamic-code',
      'external-script-allowlist',
      'network-call',
      'form-element',
    ],
  },

  // ── Multiple disallowed scripts each emit a violation ──
  {
    name: 'two disallowed external scripts emit two violations',
    html: `<!DOCTYPE html><html>
<head>
<script src="https://example.com/a.js"></script>
<script src="https://other.example.com/b.js"></script>
</head>
<body></body></html>`,
    expectPassed: false,
    // expect 2 violations of external-script-allowlist
    expectRulesCount: { 'external-script-allowlist': 2 },
  },
];

let pass = 0;
let fail = 0;

for (const tc of cases) {
  const result = validate(tc.html);
  let ok = true;
  let detail = '';

  if (tc.expectPassed) {
    if (!result.passed) {
      ok = false;
      detail = `expected pass, got fail with rules: ${result.violations
        .map((v) => v.rule)
        .join(', ')}`;
    }
  } else {
    if (result.passed) {
      ok = false;
      detail = 'expected fail, got pass';
    } else {
      const got = result.violations.map((v) => v.rule);

      if (tc.expectRules) {
        for (const expected of tc.expectRules) {
          if (!got.includes(expected)) {
            ok = false;
            detail += `missing expected rule "${expected}"; got: ${got.join(', ')}\n`;
          }
        }
      }

      if (tc.expectRulesCount) {
        for (const [rule, count] of Object.entries(tc.expectRulesCount)) {
          const actual = got.filter((g) => g === rule).length;
          if (actual !== count) {
            ok = false;
            detail += `expected ${count} of "${rule}", got ${actual}\n`;
          }
        }
      }
    }
  }

  if (ok) {
    pass += 1;
    console.log(`✓ ${tc.name}`);
  } else {
    fail += 1;
    console.log(`✗ ${tc.name}\n  ${detail.trim()}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
