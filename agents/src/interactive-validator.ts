/**
 * HTML interactive validator — eight rules from docs/INTERACTIVES.md
 * "Validator rules". Pure function: takes the HTML source, returns
 * structured pass/fail with the specific rules that failed.
 *
 * Runs in two places (sub-task 2.3 wires both):
 *   - Generator, before commit. Pre-commit gate — if validate() fails,
 *     Generator runs the revise loop without the file ever touching
 *     disk or git.
 *   - Auditor, as structural input. The Auditor doesn't re-run the
 *     validator; it's TOLD the file passed. The validator's output is
 *     a precondition for entering the audit loop.
 *
 * Implementation is text-scanning with a comment-stripping pre-pass.
 * No HTML parser dependency — Cloudflare Workers don't ship one
 * server-side and a regex pass against a Claude-generated file is
 * sufficient for the kinds of bypass we expect to see.
 *
 * String literals are NOT analysed for context — a literal `"eval"`
 * inside a string would false-positive on the dynamic-code rule.
 * Acceptable per spec; the cost of a false positive is one extra
 * revision round.
 *
 * The validator is the source of truth for the size cap and external
 * script allowlist. Other modules (the prompt at
 * interactive-generator-prompt.ts; future admin UIs) import the
 * constants below rather than redefining them.
 */

/** Stable kebab-case identifier per rule. Values surface in observer
 *  events and per-round audit-row notes — keep stable across versions. */
export type RuleId =
  | 'size-cap'
  | 'storage-api'
  | 'dynamic-code'
  | 'external-script-allowlist'
  | 'network-call'
  | 'nested-iframe'
  | 'form-element'
  | 'unsafe-url-scheme';

export interface Violation {
  /** Stable rule identifier. */
  rule: RuleId;
  /** One-line actionable feedback consumed verbatim by the revise prompt. */
  message: string;
  /** Up to ~200 chars of the offending text. */
  snippet?: string;
  /** Byte offset of the first match within the source. Optional. */
  byteOffset?: number;
}

export type ValidatorResult =
  | { passed: true }
  | { passed: false; violations: Violation[] };

/** Hard cap on HTML interactive file size in UTF-8 bytes. 50 KB is
 *  generous for a single-file artefact with one external D3 v7 import
 *  (D3 itself is loaded externally, not bundled). */
export const HTML_FILE_BYTES_MAX = 50 * 1024;

/** Human-readable description of the external-script allowlist. Used
 *  by prompts and any future admin UI that surfaces the rule. The
 *  regexes below are the source of truth for what actually validates.
 *
 *  Expanded 2026-05-17 (Lab Renewal) from D3-only to nine curated
 *  cdnjs libraries — D3 (kept) plus Three.js (3D), Pixi.js (2D canvas /
 *  particles), p5.js (creative coding), Tone.js (audio synthesis),
 *  GSAP (animation timelines), Plotly.js (interactive charts),
 *  Howler.js (sound effects), Anime.js (animation). Sandbox is
 *  `<iframe sandbox="allow-scripts">` (no allow-same-origin) — script
 *  context is isolated; loading any of these is no riskier than D3.
 *  None of these are required — many labs need no library at all.
 *
 *  Regex pattern: each library uses the cdnjs convention
 *    `/ajax/libs/<lib>/<version>/<file>.js` (or .min.js). Per-library
 *  patterns are tolerant of patch versions but pin the major version
 *  where the library has had breaking changes (D3 v7+; Three.js
 *  unpinned; Pixi unpinned; etc.). */
export const HTML_SCRIPT_ALLOWLIST_DESCRIPTION =
  'cdnjs only — D3 v7, Three.js, Pixi.js, p5.js, Tone.js, GSAP, Plotly.js, Howler.js, Anime.js';

/** Allowlist regexes — each `<script src=...>` URL must match at least
 *  one. cdnjs only across all libraries; major-version constraints per
 *  library where breaking changes are real (D3 pinned to v7).
 *
 *  Pattern shape per library:
 *    `https://cdnjs.cloudflare.com/ajax/libs/<lib>/<version>/<file>`
 *  with `.js` and `.min.js` both accepted. */
export const HTML_SCRIPT_ALLOWLIST_REGEXES: readonly RegExp[] = [
  // D3 v7 — pinned major; published-piece compatibility from the
  // original allowlist (Phase 2).
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/7\.\d+\.\d+\/d3(\.min)?\.js$/,
  // Three.js — 3D scenes. Any version on cdnjs.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/[\w.-]+\/three(\.min)?\.js$/,
  // Pixi.js — 2D canvas, sprites, particles.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pixi\.js\/[\w.-]+\/pixi(\.min)?\.js$/,
  // p5.js — creative coding (canvas + sketch).
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/p5\.js\/[\w.-]+\/p5(\.min)?\.js$/,
  // Tone.js — audio synthesis.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/tone\/[\w.-]+\/Tone(\.min)?\.js$/,
  // GSAP — animation timelines.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[\w.-]+\/gsap(\.min)?\.js$/,
  // Plotly.js — interactive charts.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/plotly\.js\/[\w.-]+\/plotly(\.min)?\.js$/,
  // Howler.js — sound effects.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/howler\/[\w.-]+\/howler(\.min)?\.js$/,
  // Anime.js — lightweight animation.
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/animejs\/[\w.-]+\/anime(\.min)?\.js$/,
];

/** Cap on the snippet field surfaced inside a Violation. */
const SNIPPET_MAX_CHARS = 200;

/**
 * Validate an HTML interactive against the eight rules. Returns
 * `{ passed: true }` if all rules pass, otherwise
 * `{ passed: false, violations: [...] }` with one or more violations.
 *
 * Returns ALL violations found across all rules — the Generator's
 * revise prompt lists them; one failure per rule is enough information
 * for revision but multi-rule failures get all surfaced so the
 * revision attempt can fix them in one pass.
 */
export function validate(html: string): ValidatorResult {
  const violations: Violation[] = [];

  // Rule 1 — size-cap. Checked against the raw input, not the
  // comment-stripped view — comments still ship as bytes.
  const byteLength = utf8ByteLength(html);
  if (byteLength > HTML_FILE_BYTES_MAX) {
    const actualKB = (byteLength / 1024).toFixed(1);
    violations.push({
      rule: 'size-cap',
      message: `File is ${actualKB} KB; the limit is 50 KB. Trim inline data, drop unused CSS, simplify repeated SVG paths, or remove dead code.`,
    });
  }

  // Pre-processing — strip HTML comments for tag-scan, then extract
  // every <script>...</script> body and strip JS comments for
  // script-scan. See spec "Pre-processing".
  const tagScan = stripHtmlComments(html);
  const scriptScan = stripJsComments(extractScriptBodies(tagScan));

  // Rule 2 — storage-api. Script-scan only; the tag-scan view would
  // false-positive on a literal "localStorage" inside a CSS comment.
  collectFirstMatch(
    scriptScan,
    /\b(localStorage|sessionStorage|indexedDB)\b/,
    'storage-api',
    'Sandbox iframe cannot use localStorage / sessionStorage / indexedDB — they throw SecurityError at runtime. Hold state in memory for the session only.',
    violations,
  );

  // Rule 3 — dynamic-code. Four sub-patterns united into a single
  // alternation; one violation suffices for the rule.
  collectFirstMatch(
    scriptScan,
    /\beval\s*\(|\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/,
    'dynamic-code',
    'Dynamic code execution is forbidden inside the sandbox. Replace eval / new Function / setTimeout("...") / setInterval("...") with a function reference: setTimeout(fn, ms).',
    violations,
  );

  // Rule 4 — external-script-allowlist. Scan tag-scan for every
  // <script src=...> URL; emit one violation per disallowed URL so
  // the revise prompt can name each.
  collectScriptSrcViolations(tagScan, violations);

  // Rule 5 — network-call. Five sub-patterns united into one
  // alternation; one violation suffices for the rule.
  collectFirstMatch(
    scriptScan,
    /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bnavigator\.sendBeacon\s*\(/,
    'network-call',
    'Sandboxed interactives must be self-contained. Replace fetch / XMLHttpRequest / WebSocket / EventSource / navigator.sendBeacon with inline data; for engagement events, postMessage to the parent.',
    violations,
  );

  // Rule 6 — nested-iframe. tag-scan only.
  collectFirstMatch(
    tagScan,
    /<iframe\b/i,
    'nested-iframe',
    'Nested <iframe> is forbidden — outer sandbox cannot constrain inner attributes. Render the content directly in this file.',
    violations,
  );

  // Rule 7 — form-element. tag-scan only.
  collectFirstMatch(
    tagScan,
    /<form\b/i,
    'form-element',
    '<form> is forbidden — the sandbox disallows submission and the element would be visible-but-broken UI. Wire JS event handlers on inputs instead.',
    violations,
  );

  // Rule 8 — unsafe-url-scheme. tag-scan only. Scoped to src= and
  // href= attributes; CSS url(...) data: URIs are explicitly fine.
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
//   Pre-processing
// ─────────────────────────────────────────────────────────────────────

/** Strip HTML comments. Greedy across newlines. */
function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Concatenate the contents of every <script>...</script> block. The
 *  caller is responsible for stripping JS comments after. External
 *  scripts (with `src=` and an empty body) contribute nothing here —
 *  they're caught by Rule 4 instead. */
function extractScriptBodies(tagScanHtml: string): string {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagScanHtml)) !== null) {
    parts.push(m[1]);
  }
  return parts.join('\n');
}

/** Strip JS comments. Block comments (/* ... *​/) first to handle the
 *  case where a block contains line-comment markers; then line comments
 *  to end-of-line. String-literal context is intentionally NOT analysed
 *  per spec — false positives accepted as one extra revision round. */
function stripJsComments(js: string): string {
  let out = js.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\n\r]*/g, '');
  return out;
}

/** UTF-8 byte length. Workers don't have Node's Buffer; TextEncoder is
 *  a Web global available in both Workers and modern Node. */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ─────────────────────────────────────────────────────────────────────
//   Per-rule helpers
// ─────────────────────────────────────────────────────────────────────

/** Find the first regex match in `text`; if found, push one violation
 *  with a snippet around the match. */
function collectFirstMatch(
  text: string,
  pattern: RegExp,
  rule: RuleId,
  message: string,
  out: Violation[],
): void {
  const m = pattern.exec(text);
  if (!m) return;
  out.push({
    rule,
    message,
    snippet: snippetAround(text, m.index, m[0].length),
    byteOffset: m.index,
  });
}

/** Iterate every `<script src=...>` URL in tag-scan and emit one
 *  violation per URL not on the allowlist. Inline scripts (no `src=`)
 *  do not trigger this rule — their body is governed by rules 2/3/5
 *  via script-scan. */
function collectScriptSrcViolations(tagScanHtml: string, out: Violation[]): void {
  const re = /<script\s[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi;
  let m: RegExpExecArray | null;
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

/** Build a snippet around a match, capped at SNIPPET_MAX_CHARS,
 *  preferring the matched span at the start. */
function snippetAround(text: string, index: number, length: number): string {
  const end = Math.min(text.length, index + Math.min(length, SNIPPET_MAX_CHARS));
  const slice = text.slice(index, end).replace(/\s+/g, ' ').trim();
  if (slice.length <= SNIPPET_MAX_CHARS) return slice;
  return slice.slice(0, SNIPPET_MAX_CHARS - 1) + '…';
}
