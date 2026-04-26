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
 *  regexes below are the source of truth for what actually validates. */
export const HTML_SCRIPT_ALLOWLIST_DESCRIPTION =
  'https://cdnjs.cloudflare.com/ajax/libs/d3/7.<minor>.<patch>/d3.min.js (D3 v7 only, cdnjs only)';

/** Allowlist regexes — each `<script src=...>` URL must match at least
 *  one. cdnjs D3 v7 only as of Phase 2 (per docs/INTERACTIVES.md). */
export const HTML_SCRIPT_ALLOWLIST_REGEXES: readonly RegExp[] = [
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/d3\/7\.\d+\.\d+\/d3\.min\.js$/,
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
