# Zeemish Interactives — Spec

How interactives work in Zeemish v2. The reference document for anyone — agent, operator, or future Claude session — who needs to know what an interactive is, what it must do, what it must not do, and how the system handles one that falls short.

This is the spec; it doesn't change session-to-session. Implementation status lives in [`INTERACTIVES_STATUS.md`](INTERACTIVES_STATUS.md). The phase plan lives in [`INTERACTIVES_PLAN.md`](INTERACTIVES_PLAN.md).

---

## What an interactive is

An **interactive** is a small artefact attached to a daily piece that teaches the same concept the piece teaches, but through manipulation rather than reading.

There are two shapes:

1. **Quiz** — 3–5 multiple-choice questions, shipped as JSON, rendered by [`<quiz-card>`](../src/interactive/quiz-card.ts). Live since 2026-04-24 (Area 4).
2. **HTML interactive** — a single self-contained HTML file, shipped as `.html`, rendered inside a sandboxed iframe by `<interactive-frame>`. Free-form: a slider, a scrubbable timeline, a small simulation, a pair of side-by-side configurations the reader can toggle between — whatever shape Claude judges fits the concept of the piece.

Both shapes are addressable on their own URL (`/interactives/<slug>/`). Both are 1:1 with a piece — every published piece gets a quiz **and** an HTML interactive. Always. Like audio. Like categorisation.

The two shapes are siblings, not alternatives. They teach the same concept different ways: the quiz checks whether the reader can recognise the pattern when stated; the HTML interactive lets the reader feel the mechanism by changing inputs and watching outputs.

## How interactives relate to quizzes

The shipped quiz pipeline (Area 4, [`agents/src/interactive-generator.ts`](../agents/src/interactive-generator.ts) + [`agents/src/interactive-auditor.ts`](../agents/src/interactive-auditor.ts)) doesn't change. Quizzes still ship the same way. The HTML path is **additive** — same agents extend their responsibilities to a second artefact type, same Director hook, same observer-event surface (extended).

The shared rules across both shapes:

- **Essence not reference.** The interactive teaches the underlying concept. It must not name proper nouns from the piece, quote sentences from the piece, or display piece-specific dates/numbers. A reader who never read the piece must find it useful. (Same rule as the quiz auditor's essence dimension at [`agents/src/interactive-auditor-prompt.ts`](../agents/src/interactive-auditor-prompt.ts) lines 57–78.)
- **Voice contract.** Any in-interactive copy — labels, captions, button text, tooltips — follows [`content/voice-contract.md`](../content/voice-contract.md) the same way a daily piece does. Plain English. No tribe words. No flattery.
- **Standalone.** The interactive lives at its own URL and must work without the source piece open in another tab.
- **Three-round revision loop.** The Generator produces; the Auditor judges; the Generator revises. Up to three rounds per artefact. After max-fail the artefact ships flagged (see "Always ship" below).

What's different between quiz and HTML:

| | Quiz | HTML interactive |
|---|---|---|
| Format | JSON | Single HTML file |
| Renderer | [`<quiz-card>`](../src/interactive/quiz-card.ts) | `<interactive-frame>` (iframe sandbox) |
| Validator | Zod schema in [`src/content.config.ts`](../src/content.config.ts) | [`agents/src/interactive-validator.ts`](../agents/src/interactive-validator.ts) (Phase 2) |
| Audit dimensions | Voice / Structure-pedagogy / Essence / Factual | Voice / Structure / Essence / Factual (see "Audit rubric" below) |
| Network access | None (static JSON) | None (sandbox blocks it) |
| Storage access | None | None (sandbox blocks it) |

## Rough-marker UX rule

When an HTML interactive fails the audit on round 3, it ships anyway. The newspaper-never-skips rule from [`CLAUDE.md`](../CLAUDE.md) applies: better one flagged interactive than none. The flag is recorded in the database (column name + tier vocabulary resolved in Phase 1; see [`INTERACTIVES_PLAN.md`](INTERACTIVES_PLAN.md)).

The reader-facing surface for the flag is **the "How this was made" drawer only.** The interactive itself sits inline on the page with no above-iframe banner, no "Rough" tier word, no warning chrome.

The drawer note reads exactly:

> This interactive didn't pass all our checks. We shipped it rather than leave the day blank.

Plus a one-line dimension-named reason inherited from [`src/lib/made-by.ts`](../src/lib/made-by.ts) `failedDimensions` (the same pattern shipped on 2026-04-25 for flagged quizzes — see CLAUDE.md "Interactive audit-results table + dimension-named drawer copy"). Examples:

> The auditor flagged the essence-not-reference rubric across all 3 rounds.

> The auditor flagged the structure and essence-not-reference rubrics across all 3 rounds.

This placement was decided when v3 was commissioned and is non-negotiable:

- **Above-iframe was overkill.** The drawer already names which dimensions failed. Doubling the surface would shout at the reader without adding information.
- **No "Rough" word on the interactive flag.** The 2026-04-25-pm drawer commit deliberately dropped that word for `quality_flag='low'` interactives because it collided with the daily-piece tier vocabulary at [`src/lib/audit-tier.ts`](../src/lib/audit-tier.ts) (a piece can be voice-Polished and quiz-flagged simultaneously, which made "Rough" self-contradictory). The HTML path inherits the same constraint.
- **Inline-clean.** Readers who don't open the drawer never know the difference. That's intentional. The drawer is the transparency surface; if a reader cares enough to look, they get the full picture.

## Pause toggle behaviour

A single admin setting — `interactives_html_enabled`, default `false` until Phase 2's manual proof passes — gates the entire HTML path.

- **Off:** Generator produces quiz only. Auditor audits quiz only. No HTML file written. No `<interactive-frame>` rendered. Drawer omits the HTML section. The quiz path is unaffected.
- **On:** Generator produces both. Auditor audits both. Both ship per piece.

The setting lives in `admin_settings` (Phase 1) alongside `interval_hours`. Flips fire an `admin_settings_changed` observer event for the audit trail. Effect propagates at the next post-publish alarm (within ~12 hours at the default cadence; immediately on `/interactive-generate-trigger`).

This toggle exists as a quality circuit-breaker, not a cost defence. If a deploy regresses the HTML path — bad output, sandbox bypass, prompt drift — flip the flag, ship a fix, flip it back. Existing HTML files stay live regardless of the flag (newspaper rule).

The toggle is **global**, not per-piece. Per-piece gating would imply a manipulability score, which we explicitly do not have — every piece gets both artefacts when the flag is on. If a single interactive is a problem, the answer is the per-piece regenerate button (Phase 3), not a per-piece off-switch.

## Prompt caching strategy

The HTML generation prompt is large and stable: voice contract + structural rules + sandbox constraints + validator spec + few-shot examples. The per-piece brief (the underlying concept, plus enough piece context for essence checks) is small and changes every call.

We use Anthropic prompt caching to put the stable parts in cache blocks and the brief in the uncached portion.

**What goes in cache:**

- The voice contract ([`agents/src/shared/voice-contract.ts`](../agents/src/shared/voice-contract.ts) — embedded into both Generator and Auditor prompts already).
- The HTML structural rules (single-file, sandbox-compatible, allowlist-only externals, no storage, no network — the validator rule list reproduced as positive instructions).
- The sandbox spec (the iframe attribute list and the rationale for each).
- Few-shot examples (the hand-built reference at [`docs/examples/interactive-reference.html`](examples/interactive-reference.html), once Phase 2 ships it; possibly one or two more once we have variety).

**What stays uncached:**

- The piece's headline, underlying subject, and body excerpt.
- Prior-round audit feedback (when the call is a revision).
- The slug list of recent interactives (for the decline-as-redundant signal that quiz Generator already uses).

Cache reads cost 0.1× the standard rate. At two pieces per day on Sonnet, the HTML interactive work is expected to add ~$2–3/month over the existing spend. The exact cost line surfaces in admin telemetry in Phase 3.

**Why caching is the right tool here:**

- The stable blocks are large (voice contract is ~2000 tokens; the rules + examples push the cached portion north of 5000 tokens). Uncached, those tokens would re-bill on every call.
- The blocks are genuinely shared across every generation. There is no per-piece tuning of the rules — the only per-piece input is the brief.
- Anthropic's 5-minute cache TTL is well-matched to the cadence: the HTML generation alarm fires shortly after the quiz alarm, so back-to-back calls within the same publish event share the cache.

The Auditor follows the same pattern: rubric + voice contract cached, the artefact under audit + piece context uncached.

## The iframe sandbox shape

Generated HTML runs inside a single `<iframe>` with a tightly-scoped `sandbox` attribute. The shape below is **non-negotiable** — the validator catches what it can pre-flight, but the sandbox is what actually contains a generated file at runtime.

### The exact attribute set

```html
<iframe
  sandbox="allow-scripts"
  loading="lazy"
  referrerpolicy="no-referrer"
  title="<concept line, voice-audited>"
></iframe>
```

That's it. One token in `sandbox`. No others.

### Why `allow-scripts` and nothing else

The HTML5 sandbox is deny-by-default. With `sandbox=""` (empty value) every script-driven feature is off — but interactives are a script-driven artefact by definition, so we add exactly one token back. Every other `allow-*` is omitted on purpose.

| Token | What it does | Why we don't set it |
|---|---|---|
| `allow-scripts` | Lets JS run in the iframe. | **Set.** Without it the interactive is a dead document. |
| `allow-same-origin` | Treats the iframe's origin as the parent's origin (cookies, storage, same-origin fetches all work). | **Never set.** This is the single most dangerous token to add. With it, a generated file can read `document.cookie`, manipulate `localStorage` for the parent origin, and break out of every other isolation boundary. The whole point of the sandbox collapses if this is on. |
| `allow-top-navigation` | Lets the iframe navigate the parent window via `window.top.location = ...`. | **Never set.** A redirect from a generated file would yank the reader off Zeemish. |
| `allow-top-navigation-by-user-activation` | Same as above but only after a user gesture. | **Not set.** Even gated, top-frame navigation from a generated artefact is the wrong shape — the parent page owns reader navigation. |
| `allow-forms` | Lets `<form>` submissions fire. | **Not set.** The validator already rejects `<form>` (rule 7). Belt and braces. |
| `allow-popups` | Lets `window.open(...)` create new tabs. | **Not set.** A generated file that pops a new tab is doing something we didn't ask for. |
| `allow-popups-to-escape-sandbox` | If a popup is allowed, lets it open without the sandbox attribute set. | **Not set** (vacuous since `allow-popups` is off, but explicit deny in the table). |
| `allow-modals` | Lets `alert()`, `confirm()`, `prompt()` fire. | **Not set.** Modals from a sandboxed iframe are jarring, and a teaching interactive that needs `alert()` is using the wrong primitive. |
| `allow-pointer-lock` | Lets the iframe request pointer lock (mouse capture). | **Not set.** No interactive shape we care about needs it. |
| `allow-orientation-lock` | Lets the iframe lock screen orientation on mobile. | **Not set.** Anti-pattern for a teaching surface. |
| `allow-presentation` | Lets the iframe call the Presentation API (cast to a screen). | **Not set.** Out of scope. |
| `allow-storage-access-by-user-activation` | Lets the iframe request storage access on user gesture (cross-site cookies). | **Not set.** Defeats isolation by design. |
| `allow-downloads` | Lets the iframe trigger file downloads. | **Not set.** A generated file shouldn't be handing the reader files. |

If a future interactive shape genuinely requires a token outside `allow-scripts`, that's a [`DECISIONS.md`](DECISIONS.md) entry and a fresh look at whether the shape is actually one we want — not a quiet attribute change.

### What this configuration prevents

With only `allow-scripts`, the iframe is treated as an **opaque origin**. The cumulative effect is:

- **Storage isolation.** `localStorage`, `sessionStorage`, and `indexedDB` calls throw `SecurityError`. Cookies for `zeemish.io` are unreachable.
- **DOM isolation.** The iframe cannot read or write `parent.document`, `top.document`, or any property on the parent that crosses the origin boundary.
- **Navigation isolation.** No `window.top.location =`, no `window.parent.location =`, no `<a target="_top">` jumps.
- **Network surface narrowed.** Same-origin fetches throw. Cross-origin fetches reach opaque origins (no credentials, no readable response). The validator's `network-call` rule catches the patterns up front.
- **No credentialed requests.** No cookies sent on any iframe-originated request.
- **CSS isolation.** The iframe's stylesheet cannot affect the parent. The parent's stylesheet cannot affect the iframe. Each side is its own document tree.
- **JS isolation.** A `throw` inside the iframe stays inside. A runaway `while(true)` busy-loops the iframe but doesn't freeze the parent thread (modern engines run iframes in their own event loops on most builds, though a worst-case main-thread block is theoretically possible — see "Future hardening" below).

### What it allows

- `postMessage` between iframe and parent. Works in both directions without any sandbox token. **This is the engagement-event channel for Phase 4.** The parent registers a `message` listener bound to the iframe's window; the iframe posts `{type: 'interactive_engagement', event: '...'}` payloads when the reader manipulates the surface; the parent forwards to `/api/interactive/track`. All actual network calls happen on the parent side, in code we audit.
- Inline scripts inside the file. The validator's `external-script-allowlist` rule (#4) gates remote scripts; inline JS is fully allowed.
- Same-frame navigation (`window.location.hash = '#fragment'`) is benign — it stays inside the iframe.
- DOM manipulation, canvas, SVG, CSS animations, requestAnimationFrame, WebGL — all the tools an interactive needs.

### Loading strategy: `srcdoc` vs `src`

The plan defers this to Phase 2 implementation. Both work with the same sandbox attribute. Trade-offs:

**`srcdoc="<full file>"` — inline.**
- Pro: atomic load (no second round trip), no extra URL/route to maintain, the iframe is fully populated before the parent finishes parsing.
- Pro: simpler caching story — the parent page either has it or doesn't; no separate cache lifecycle.
- Con: inflates the parent page HTML by up to 50 KB per interactive. At one interactive per piece this is bearable; at multiple per page (e.g. a library index that previewed interactives) it becomes a bandwidth problem.
- Con: harder to inspect in devtools (the file is a string attribute, not a separate document with a URL).

**`src="/interactives/<slug>/embed"` — separate URL.**
- Pro: cacheable independently of the parent page (a returning reader hits the CDN edge).
- Pro: cleaner devtools — the embed has its own URL bar entry inside the iframe inspector.
- Pro: smaller parent page; the 50 KB ships only when the iframe actually loads.
- Con: extra round trip, potentially slower first paint.
- Con: requires an `/embed` route on the worker that serves the raw HTML with the right `Content-Type` and (importantly) the right cache headers.

**Leaning toward `src=` for production, `srcdoc=` acceptable for the manual proof.** The cache and bandwidth wins compound across the catalogue; the round-trip cost is hidden behind `loading="lazy"`. Lock the choice in Phase 2 and record it in DECISIONS.

### CSP and the parent page

The parent page's Content Security Policy does **not** propagate into the iframe. The sandboxed iframe is its own document and would need its own CSP header to enforce script-src restrictions inside.

We do not currently ship a CSP header on the iframe document. The validator is the equivalent gate (no `eval`, no external scripts off the allowlist, no inline data-URL sources). If a future Phase wants belt-and-braces, the embed route can serve the file with a strict CSP header — `default-src 'none'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data: 'self';` is the rough shape. Tracked as a possible future hardening, not Phase 2 work.

### The `referrerpolicy` and `loading` attributes

- `referrerpolicy="no-referrer"` — the iframe doesn't leak the parent URL to the cdnjs request for D3 (or any other allowlisted external load). Defensive privacy hygiene.
- `loading="lazy"` — the iframe doesn't load until it's near the viewport. Daily-piece pages may have the interactive below the fold by several scrolls (last beat → drawer → interactive prompt → interactive embed); lazy loading saves bandwidth for readers who don't scroll that far.

`title` is required for accessibility — it's the iframe's accessible name in screen readers. Set it to the interactive's `concept` line, which is voice-audited.

### Runtime failure surface

When the sandbox blocks something, the iframe's behaviour is:

- Storage API call → `SecurityError` thrown, JS execution continues unless the file uses an unhandled-throw.
- Same-origin fetch → `TypeError`, same handling.
- `window.top.location = ...` → silent no-op or `SecurityError` depending on the engine.
- `<form>` submission → silent no-op.

The validator catches all of these patterns pre-commit, so a shipped file should never trigger them. If one does (e.g. via a sandbox-bypass technique that gets past the regex), the runtime surface is "the iframe partially or fully fails to render." That degraded state is reader-visible — broken interactive, no error chrome — which is a bad experience but not a security incident. The drawer's rough-marker UX would not have caught it (the file passed the audit), so this is one of the cases where Phase 3's per-piece regenerate button is the recovery path.

### Future hardening (not Phase 2)

Possible additions, recorded here so they aren't quietly forgotten:

- **`<iframe csp="...">` attribute.** Browser-level CSP enforcement on the iframe contents, distinct from the served HTTP CSP header. Spec-supported, browser support landed broadly in 2023+. Tightens script-src to `'self' cdnjs.cloudflare.com` at the iframe boundary regardless of what the embed document declares.
- **`<iframe credentialless>` attribute.** Forces the iframe to load with no credentials (no cookies sent on subresource loads). Useful if we expand the external script allowlist to anything that could conceivably set a cookie.
- **Subresource Integrity (SRI)** on the D3 import — `<script src="..." integrity="sha384-..." crossorigin="anonymous"></script>`. Pins the exact bytes of the loaded script; if cdnjs were ever compromised, SRI would fail-closed. The validator allowlist could be extended to require an `integrity=` attribute alongside the `src=`.
- **Per-iframe Permissions-Policy.** `<iframe allow="camera 'none'; microphone 'none'; geolocation 'none'; ...">` — nothing in our generated content needs these, so an explicit deny is defense-in-depth.
- **Sandbox runtime watchdog.** Wrap the iframe's `srcdoc` with a tiny outer script that arms a `setTimeout` to `console.error('iframe wedged')` if the file never reaches a known-good lifecycle event. Surface to admin telemetry. Useful for catching "passed the audit, doesn't actually run" cases.

None of the above is in scope for Phase 2. They're catalogued so the next person to harden the sandbox doesn't have to rediscover them.

## Validator rules

The validator is a pure function that takes the HTML source and returns structured pass/fail. It runs in two places:

- **Generator, before commit.** Pre-commit gate — if the validator fails, Generator runs the revise loop without the file ever touching disk or git.
- **Auditor, as structural input.** The Auditor doesn't re-run the validator; it's told the file passed. The validator's output is a precondition for entering the audit loop.

Implementation lives at `agents/src/interactive-validator.ts` (Phase 2). One module. No HTML parser dependency — text scanning with light pre-processing. The rules below are the entire surface; nothing else fails a file.

### Output shape

```typescript
type ValidatorResult =
  | { passed: true }
  | { passed: false; violations: Violation[] };

type Violation = {
  rule: RuleId;            // kebab-case, stable identifier
  message: string;         // one-line, ready for the Generator's revise prompt
  snippet?: string;        // up to 200 chars of the offending text, when surfacing helps
  byteOffset?: number;     // optional, when known
};

type RuleId =
  | 'size-cap'
  | 'storage-api'
  | 'dynamic-code'
  | 'external-script-allowlist'
  | 'network-call'
  | 'nested-iframe'
  | 'form-element'
  | 'unsafe-url-scheme';
```

`message` is consumed verbatim by the Generator's revision prompt. Make it actionable — name the rule and what to do instead, not just what's wrong.

### Pre-processing

Before any rule runs, the validator builds two views of the file:

1. **Tag-scan view** — the full HTML with HTML comments stripped: `<!-- ... -->` removed (greedy, multiline). All other content untouched.
2. **Script-scan view** — the concatenation of every `<script>...</script>` block's contents, with JS comments stripped: `//` to end-of-line, plus `/* ... */` (greedy, multiline). String literals are NOT analysed for context — a literal `"eval"` inside a string would false-positive on the dynamic-code rule. Acceptable: in an HTML interactive, the literal string "eval" outside an actual eval context is vanishingly rare, and the cost of a false-positive is one extra revision round.

Stripping comments matters because Claude sometimes inlines explanatory comments like `// no localStorage allowed in this sandbox` or `<!-- TODO: replace eval -->` that would otherwise trip the regex.

### Rule 1 — `size-cap`

**Reject if:** file size > 50 KB (51,200 bytes).

**Check:** `Buffer.byteLength(html, 'utf8') > 50 * 1024`.

**Why:** the iframe loads the file inline (`srcdoc=` or fetched once); a runaway file balloons page weight and signals the Generator produced something bloated. 50 KB is generous for a single-file artefact with one D3 import (D3 itself is loaded externally from the allowlist, not bundled).

### Rule 2 — `storage-api`

**Reject if:** the script-scan view matches any of:

```
\b(localStorage|sessionStorage|indexedDB)\b
```

**Why:** the sandbox without `allow-same-origin` already throws on these, but a file using them is broken-by-design — readers see nothing teaching, the iframe is just dead. Catching it here turns a runtime ghost into a clean revision signal.

**Note:** the regex catches `localStorage`, `window.localStorage`, `globalThis.indexedDB`. It does NOT catch `window['localStorage']` (string-property indexing). Acceptable — the sandbox runtime catches that path too, and Claude doesn't reach for that idiom.

### Rule 3 — `dynamic-code`

**Reject if:** the script-scan view matches any of:

```
\beval\s*\(
\bnew\s+Function\s*\(
\bsetTimeout\s*\(\s*['"`]
\bsetInterval\s*\(\s*['"`]
```

**Why:** dynamic code execution is an attack surface and a debugging black hole. None of it is needed for the kinds of interactives we expect (sliders, scrubbable timelines, simulations — all expressible as plain functions). `setTimeout`/`setInterval` are fine when the first argument is a function reference; the regex specifically catches the string-form (`setTimeout("doThing()", 100)`) which is `eval`-by-another-name.

**Note:** the sandbox `allow-scripts` does NOT block `eval` by default. CSP would, but we don't ship a CSP header inside the iframe (the parent's CSP doesn't propagate). The validator IS the gate.

### Rule 4 — `external-script-allowlist`

**Reject if:** any `<script>` tag with a `src` attribute references a URL not on the allowlist.

**Allowlist (initial — Phase 2):**
- `https://cdnjs.cloudflare.com/ajax/libs/d3/7.<minor>.<patch>/d3.min.js`

Regex match for the allowlist:
```
^https://cdnjs\.cloudflare\.com/ajax/libs/d3/7\.\d+\.\d+/d3\.min\.js$
```

**Check:** scan tag-scan view for `<script\s[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]`. For each captured URL, fail unless it matches an allowlist regex.

**Why:** external scripts are remote code execution by design. The allowlist is one entry because we have one identified need (D3 v7 for chart-heavy interactives). Adding a library means adding a regex to the allowlist and recording the decision in [`DECISIONS.md`](DECISIONS.md), not loosening the rule. cdnjs is the chosen CDN because it has integrity hashes available and a stable URL shape.

**Note:** inline `<script>` blocks (no `src` attribute) are allowed — they're the file's own JS. The dynamic-code and storage-api rules cover what they can't do.

### Rule 5 — `network-call`

**Reject if:** the script-scan view matches any of:

```
\bfetch\s*\(
\bnew\s+XMLHttpRequest\b
\bnew\s+WebSocket\b
\bnew\s+EventSource\b
\bnavigator\.sendBeacon\s*\(
```

**Why:** an HTML interactive is self-contained — every byte it needs ships in the file. Network calls leak telemetry, fetch live data we can't audit, or signal that the Generator forgot the no-network rule. Engagement events use `postMessage` to the parent (Phase 4), not network — the parent does the network call.

**Note:** the sandbox without `allow-same-origin` makes same-origin fetches throw, but cross-origin fetches with no credentials still go through (to opaque origins). Defense-in-depth catches it here.

### Rule 6 — `nested-iframe`

**Reject if:** the tag-scan view matches `<iframe\b`.

**Why:** nested sandboxes get confused. The parent already runs the file in an `<iframe sandbox="allow-scripts">`; a nested iframe inside means a second sandbox layer with its own attribute set, and the outer sandbox can't fully constrain what attributes the inner iframe declares. Cleanest answer: no nested iframes.

### Rule 7 — `form-element`

**Reject if:** the tag-scan view matches `<form\b`.

**Why:** the sandbox disallows form submission anyway (no `allow-forms`), so a form would just be visible-but-broken UI. More importantly, form patterns suggest the Generator misunderstood the brief — interactives manipulate state in JS, they don't submit data. Reject defensively.

### Rule 8 — `unsafe-url-scheme`

**Reject if:** the tag-scan view contains any `src=` (or `href=` on a `<script>`-equivalent tag) using a `data:` or `blob:` URL.

Regex: `\b(?:src|href)\s*=\s*['"]\s*(?:data|blob):`

**Why:** `data:` URLs in `src=` are a well-known sandbox-bypass surface (they can carry executable JS). `blob:` URLs are usually the output of `URL.createObjectURL`, which combined with no network input means we shouldn't see them legitimately. The validator catches both as a class.

**Note:** this rule does NOT reject `data:` URIs in CSS `url(...)` (background images, fonts) — those are fine. The rule is scoped to `src=` / `href=` attributes specifically.

### Failure path

The validator returns the violations array, message-first. Example:

```json
{
  "passed": false,
  "violations": [
    {
      "rule": "size-cap",
      "message": "File is 64 KB; the limit is 50 KB. Trim inline data, drop unused CSS, or reduce repeated SVG paths."
    },
    {
      "rule": "external-script-allowlist",
      "message": "External script src 'https://example.com/lib.js' is not on the allowlist. Allowed: cdnjs D3 v7 only.",
      "snippet": "<script src=\"https://example.com/lib.js\"></script>"
    }
  ]
}
```

The Generator's revise prompt receives the violations as a numbered list and is instructed to address every one in the next round. After three failed rounds, the file ships flagged per the rough-marker UX rule above.

### What the validator does NOT check

The validator is intentionally narrow. The following are **not** validator concerns:

- **Voice, structure, essence, factual.** These are Auditor dimensions.
- **Accessibility.** No alt text check, no ARIA check, no contrast check. Future work; not Phase 2.
- **Browser compatibility.** Modern Chromium baseline assumed. If a feature fails in Safari or Firefox, that's a content-quality issue surfaced as a structural Auditor signal, not a validator rule.
- **HTML well-formedness.** The browser is forgiving; the iframe will render. Malformed HTML that still produces a teaching artefact is fine. Malformed HTML that produces something visibly broken trips the structural Auditor.
- **JS errors at runtime.** Out of scope without a sandboxed run-and-observe step. If we ever add one, it lives behind a separate flag.

## Audit rubric

The Auditor is a single Claude call that judges a generated HTML interactive across four dimensions. It DOES NOT rewrite — it identifies what would need to change. The Generator's revise loop consumes the feedback to produce the next round.

Why one call instead of four: an HTML interactive is one cohesive artefact (a few hundred lines of HTML/CSS/JS, plus its rendered output). A comprehensive prompt that reads it once and cites issues per dimension is both cheaper (~4× fewer API calls) and more coherent than four separate audits — same trade-off the quiz Auditor already makes at [`agents/src/interactive-auditor.ts`](../agents/src/interactive-auditor.ts).

The Auditor sees:
- The full HTML source (sandboxed iframe contents, raw text).
- The piece's headline, underlying subject, and body excerpt (for essence-reference checks).
- The validator's structured pass/fail — the Auditor doesn't re-run the validator, but the Auditor IS told that the file passed it. Anything the validator caught is gone before the Auditor runs.

### The four dimensions

#### 1. Voice (0–100, passes at ≥85)

The Zeemish voice contract applies to in-interactive copy the same way it applies to a daily piece. "In-interactive copy" means anything the reader sees as text:

- The interactive's title (rendered above the iframe).
- The `concept` line (a one-sentence statement of what the interactive teaches).
- Labels on controls (slider labels, button labels, axis labels).
- Captions and explanatory text inside the iframe.
- Tooltips, hover-text, and any text that appears on interaction.
- Status messages ("Try moving the slider", "When you set X to Y, Z happens").

What fails voice (non-exhaustive):
- Tribe words used unquoted (per the voice contract list at [`content/voice-contract.md`](../content/voice-contract.md)).
- Hedging filler ("It could be argued that", "potentially", "in many cases").
- Marketing flourish ("Discover how X", "Unlock the secret of Y", "Amazing").
- Flattery or meta-commentary ("Great question!", "This is the fun part!", "You'll love this one").
- Academic jargon where plain English would do.
- Sentences that read fine in a slide deck but not in a teaching piece.
- Empty `concept` value, or a `concept` that is a topic label ("Chokepoints") or a question rather than a sentence — same rule the quiz Auditor enforces.

What does NOT fail voice:
- Short imperatives. "Drag the slider." "Watch the line move." Interactive copy is allowed to be terse — a quiz question reads as a sentence; a slider label reads as a noun.
- Domain-neutral concept words (legitimacy, threshold, chokepoint, asymmetry, trade-off). These are concept vocabulary, not tribe words.
- Numbers and units displayed on axes or as readouts. They're data, not voice.

Score 100 if you'd leave the copy untouched. Score 85 if minor polish would help. Below 85 for anything a voice-compliant rewrite would visibly improve.

#### 2. Structure (0–100, passes at ≥75)

The HTML must render as one cohesive teaching artefact, not a pile of widgets.

What passes structure:
- **One clear interactive surface.** The reader can identify the thing they're meant to manipulate without guessing — a single slider, a clear pair of toggles, a labelled scrub track. Multiple controls are fine *if* they share an obvious purpose (two sliders that compose into one model output) and bad if they fragment the page into three half-finished demos.
- **A clear teaching label.** Above or alongside the interactive surface, in plain words, what concept the manipulation teaches. The reader doesn't have to infer.
- **Cohesive layout.** Title, surface, output, explanation read top-to-bottom (or left-to-right) without the reader hunting. Mobile-respectable: the interactive doesn't break at 375px width.
- **Sensible defaults.** Initial state shows something teaching, not a blank canvas requiring three clicks before anything happens.
- **Stable on input.** Moving the slider from min to max doesn't break the layout, throw a visible error, or render NaN.
- **Pedagogy hooks.** The reader can tell what happened when they manipulated something. Output changed, a label updated, a chart redrew, a value flipped — *something* responsive that they can attribute to their action.

What fails structure:
- Multiple disconnected interactive elements with no shared purpose ("here's a slider AND a quiz AND a chart").
- No teaching label — the reader has to guess what concept this is about.
- Decorative animation that runs on its own with no input from the reader (that's a video, not an interactive).
- Initial state is blank or broken until the reader does something specific.
- Layout breaks visibly at narrow widths.
- Manipulation produces no visible response.

Score 100 if you'd ship it untouched. Score 75 for minor polish. Below 75 for structural problems that would visibly reduce the artefact's teaching value.

#### 3. Essence — manipulation teaches the concept (0–100, passes at ≥75)

**This is the primary bar. An HTML interactive that fails essence has nothing to fall back on.**

The question to answer: *Does manipulating this interactive teach the underlying concept of the piece, or is it decorative?*

The mechanism of change in the interactive must mirror the mechanism of the concept. If the piece teaches **chokepoints**, the slider's effect should compress when you reduce capacity in the right place — that's the concept made tactile. If the piece teaches **adverse selection**, toggling a parameter should make the pool worse in the way adverse selection makes pools worse. The reader's hand on the control should feel the shape of the idea.

What passes essence:
- The manipulation embodies the mechanism. Moving the slider changes outputs in a way that reflects how the real concept works.
- The reader can derive the lesson from interaction alone — no prose required, though prose may scaffold.
- A stranger who never read the piece can play with the interactive and learn the underlying concept.
- Concept-match with the piece is EXPECTED. A chokepoints piece gets a chokepoints interactive. Same-concept teaching is the GOAL, not a violation. (Same rule and reasoning as the quiz Auditor's essence dimension at [`agents/src/interactive-auditor-prompt.ts`](../agents/src/interactive-auditor-prompt.ts).)

What fails essence — DECORATIVE:
- The interactive shows a value but the manipulation doesn't change anything mechanism-relevant. (A slider that just moves a needle on a gauge with no underlying model is decorative.)
- The interactive is a chart with a play button — it animates over time without the reader's input mattering.
- The interactive is a quiz disguised as a widget. (We already have a quiz path; the HTML interactive should not duplicate it.)
- The "model" behind the manipulation is arbitrary — moving the slider produces numbers, but those numbers don't reflect the concept. The reader gains no transferable understanding.

What fails essence — REFERENCE LEAK:
The same six concrete-detail-leak rules as the quiz Auditor apply to HTML interactives:
- Proper nouns from the piece appear in the interactive (company names, people, cities, countries, agencies, product names, event names).
- Specific dates, years, or timeframes from the piece appear in the interactive.
- Sentences or phrases from the piece are quoted or lightly paraphrased in the interactive.
- Labels name an industry/domain in a way a piece-reader would recognise AS the piece's industry. ("Crude oil price (USD/barrel)" is fine for an abstract chokepoints widget; "Strait of Hormuz daily throughput" is a leak if the piece is about Hormuz.)
- The interactive uses "according to", "as described", "in the article", "as we saw above".
- Specific numbers from the piece (dollar amounts, percentages, counts) appear in the interactive UNLESS that number is the universal form of the concept.

What does NOT fail essence (these are EXPECTED):
- Same concept as the piece. That's the point.
- Generic concept terminology (legitimacy, visibility, threshold, trade-off, bottleneck, asymmetry, compounding).
- Structural analogies that share a shape with the piece's structure (three groups, two configurations, one binding constraint).
- Worked numeric examples that illustrate a mechanism — `{1, 2, 3}` and `{1, 4, 5}`, "100 widgets in, X widgets out" — unless those specific numbers are pulled from the piece.
- Thematic echo — the artefact's tone and emphasis resonate with the piece's. That's good design.

The test to apply: *Would a stranger who has NEVER read the piece manipulate this interactive and walk away understanding the concept?* If yes, essence passes regardless of whether a piece-reader would feel thematic familiarity.

Score 100 if the manipulation is a perfect physical analogue of the mechanism. Score 75 if it teaches the concept but with some clunkiness. Below 75 if the interactive is decorative, misaligned with the concept, or leaks specifics from the piece.

#### 4. Factual (0–100, passes at ≥75)

If the interactive contains data, numbers, axis ranges, embedded examples, or claims about the world, those must be true as general statements.

What fails factual:
- An embedded number is wrong. ("Oil priced in USD since 1791" — false; 1971.)
- A worked example uses a value that's outside any reasonable real-world range. (A slider for "central bank policy rate" with a max of 500% is fictional; max of 25% is defensible.)
- A label asserts a causal mechanism that doesn't hold in the real world. ("Increasing X always decreases Y" when the relationship is conditional or non-monotonic.)
- A computed output uses a formula that doesn't model the concept correctly.

What does NOT fail factual:
- Purely definitional content ("a chokepoint is a narrow point through which throughput is constrained" — true by definition if internally consistent).
- Worked numeric examples that are obviously toy. ({1, 2, 3} composing into {1, 4, 5} is a teaching example, not a claim about the world.)
- Stylised parameter ranges that are clearly illustrative ("0 to 100" rather than the real-world units).
- Uncertainty: if the Auditor isn't sure whether a claim is true, flag as "unclear" rather than asserting truth or falsehood. The Generator's revise loop will conservatively rephrase.

No web search. Evaluate against general knowledge.

Score 100 if every claim is verifiably true or clearly toy. Score 75 if a claim is technically defensible but oversimplified. Below 75 for a wrong number, a fictional range, or a misstated mechanism.

### Overall pass

The HTML interactive passes overall iff ALL FOUR dimensions pass at their respective thresholds (voice ≥85; structure, essence, factual ≥75 each).

A scored-not-binary shape on all four (rather than the quiz Auditor's 1-scored-3-binary shape) reflects that an HTML interactive is multi-dimensional in ways a 3-question quiz is not. A slider that teaches at 80% essence is shippable; a slider that teaches at 60% essence is decorative. Binary pass/fail is too coarse.

### Output shape

The Auditor returns the same JSON envelope shape across all four dimensions, mirroring the quiz Auditor for code-reuse:

```json
{
  "passed": true,
  "voice":     { "passed": true, "score": 92, "violations": [], "suggestions": [] },
  "structure": { "passed": true, "score": 88, "issues":     [], "suggestions": [] },
  "essence":   { "passed": true, "score": 81, "violations": [], "suggestions": [] },
  "factual":   { "passed": true, "score": 95, "issues":     [], "suggestions": [] }
}
```

Each dimension has both `score` (0–100) and `passed` (the score-vs-threshold result, computed and asserted by the Auditor as a defensive check — same clamp pattern as quiz at [`agents/src/interactive-auditor.ts`](../agents/src/interactive-auditor.ts)). On failure, the violations/issues array names the specific HTML or copy that triggered the call, one item per failure. Suggestions are optional fixes — the Generator usually self-proposes from the issues alone.

### Per-round persistence

Every Auditor call writes one row per dimension to `interactive_audit_results` (the table that landed 2026-04-25 for quizzes — same table, no schema change). Up to 12 rows per piece per artefact (3 rounds × 4 dimensions). The dimension-named drawer copy reads from the latest round's failed dimensions on the rough-marker path described in "Rough-marker UX rule" above.

### What the Auditor does NOT do

- It does not run the HTML in a browser. It reads the source.
- It does not run the validator. The validator is the Generator's pre-commit gate; anything it catches never reaches the Auditor.
- It does not rewrite. It marks. The Generator owns rewrites.
- It does not check for cross-browser compatibility, accessibility, or performance. Those are validator concerns (size cap, sandbox compliance) or future work.

## Admin surfaces

Phase 3 (`v3.3`) shipped four operator-facing surfaces. All ADMIN_EMAIL-gated; observer events follow the pattern `admin_settings_changed` (toggle) / `interactive_regenerated` (regen) / inherited `Interactive(s) generated|skipped|shipped (flagged low)|failed` (cost telemetry source).

### Settings toggle

`/dashboard/admin/settings/` carries an "HTML interactives (v3)" section under the cadence dropdown. Checkbox bound to `admin_settings.interactives_html_enabled` (string `'true' | 'false'` in storage; boolean on the wire). Save fires an `admin_settings_changed` observer event with operator email + before/after values for the audit trail. Effective on the next post-publish alarm — already-published pieces are unaffected by a flip in either direction.

The wrangler `d1 execute` recipes in [`RUNBOOK.md`](RUNBOOK.md) "Interactives v3 — HTML interactive flag" stay as a fallback for when the admin UI is unavailable, with the explicit note that bypassing the UI skips the observer audit trail.

### List view

`/dashboard/admin/interactives/` is the catalogue. Lists every shipped interactive (quiz + html) with a per-row card: type pill, status badge (Clean / Rough / Pending), tier label when set, title link to the public page, source-piece headline link to the per-piece admin deep-dive, voice score, four audit pills for the latest round (voice / structure / essence / factual with pass/fail + voice score), revision count, published date.

Sort order is locked: `quality_flag='low'` first (rough surfaces to the top), then by `published_at DESC`. Type filter chip bar (All / Quiz / HTML) mirrors the admin observer-feed severity-chip pattern verbatim.

A soft "N pieces have no quiz · M pieces have no HTML interactive" line above the catalogue points the operator at the per-piece admin page when first-time generation is needed; the gating toggle is linked inline.

### Per-piece destructive regenerate

Each row carries a `Regenerate` button. Clicking it walks a confirm dialog enumerating exactly what gets wiped (file at `content/interactives/<slug>[-html].json` + interactives row + every interactive_audit_results row + interactive_id clear on quiz path) before POSTing to `/api/agents/interactive-regenerate?piece_id=…&type=quiz|html`.

The site-side proxy ADMIN_EMAIL-gates the call and forwards `changed_by=user.email` so the resulting observer event attributes the operator. The agents-worker endpoint (`/interactive-regenerate-trigger`) runs the wipe synchronously — operator sees the real failure on auth / rate limit / missing target — then schedules a fresh `generateInteractiveScheduled` alarm. The fresh produce → audit → revise loop runs in the alarm's own DO invocation 1s later; the operator reloads the page in a minute or two to see the new row.

HTML regen is refused (400) when `interactives_html_enabled = false` to avoid a silent no-op where the Generator's html path skips. The error message points at the settings flip.

Slug-drift caveat: a quiz-only regen MAY produce a different slug if Claude returns a different proposal from the same source piece, breaking the quiz/html shared-slug invariant from Phase 2.5. HTML-only regen never drifts because the html path's `existingQuiz` lookup pins the slug to the still-present quiz row. The v2 fix is a `slugLock` parameter on `Generator.generate`.

### Cost telemetry

The list view's header carries a "Cost (month-to-date · MMM YYYY)" stats row: MTD spend / Generator runs / uncached input + cost / cache write · cache read + cost / output + cost.

Numbers come from observer_events context JSON. Phase 3.4 extended both Generator and Auditor to capture all four Anthropic billing counters at every Claude call site via [`agents/src/shared/usage.ts`](../agents/src/shared/usage.ts) `extractUsage()`:

- `tokensIn` — uncached input portion (the new-prompt content not in the cache).
- `tokensOut` — total output, never cached.
- `cacheCreateTokens` — system-prompt block on the COLD call. Billed at 1.25× input rate.
- `cacheReadTokens` — system-prompt block on every WARM call. Billed at 0.1× input rate.

Without the two cache fields, any cost estimate undercounts the real bill by exactly the cached-system-prompt portion. With them, the cost surface is honest from the moment Phase 3.4 ships. Pricing math (Sonnet 4.5: $3/M input, $15/M output, cache write at 1.25× input, cache read at 0.1× input) is one constant in the page; rate changes are a one-line edit.

Pre-3.4 events have no cache fields. The page auto-detects the gap and footnotes "Some events this month pre-date cache capture; their cache breakdown shows as 0 and the input/output totals undercount the system-prompt portion." The flag self-clears as old events age out of the window.

Scope: covers InteractiveGenerator + InteractiveAuditor only. Drafter / Curator / Categoriser / Learner / Reflector / Voice/Structure/Fact auditors aren't in the surface yet — each needs its own `extractUsage` call at the call site; the helper is shared and ready.

## Phase 4 — Engagement signals into Learner

The v3 self-improvement loop closes by routing reader engagement on shipped interactives back into the prompts that produce future ones. Two surfaces, both small.

### Reader signal: `<interactive-frame>` `interactive_viewed`

`<interactive-frame>` (parent of the sandboxed iframe) wires an `IntersectionObserver` in `connectedCallback` with `threshold: 0.5`. The first time the iframe is at least 50% on-screen, the component POSTs `{event_type: 'interactive_viewed', interactive_id}` to `/api/interactive/track` and disconnects the observer. A `sessionStorage` key (`zeemish-interactive-viewed:<id>`) makes the event fire **once per session per interactive** — back-nav within a session doesn't double-count. The same component still fires `interactive_started` on mount; the two signals are deliberately distinct, because the `started/viewed` ratio measures "did the reader scroll deep enough into the piece to actually see the HTML interactive?".

Iframe-content postMessage protocol is **deferred to v2**. The parent-level observer works for every HTML interactive Claude generates without prompt changes, doesn't add an iframe-content surface to maintain, and doesn't have to design around the sandbox's no-`allow-same-origin` posture. The cost is that "manipulated the slider" isn't measurable — only "looked at it" is. If engagement learnings start asking the manipulation question, v2 revisits.

The endpoint accepts `'viewed'` alongside the existing `offered | started | completed | skipped` event types. No migration: `interactive_engagement.event_type` is loose TEXT per migration 0022's decision #2.

### Aggregation: Learner reads `interactive_engagement`

`Learner.analysePiecePostPublish` (the post-publish run that fires ~1s after every daily piece publishes) gains a fourth D1 query reading aggregated engagement over the last 14 days, capped at 20 rows, joined to `interactives` for slug/type/title/quality_flag/voice_score. The rollup goes into the prompt context as a "Recent interactive engagement" block between the audit results and the pipeline timeline.

Because Learner runs ~1s after publish — before the `InteractiveGenerator` alarm fires for THIS piece — the rollup is necessarily across **prior** pieces' interactives. Same shape as Drafter's `getRecentLearnings` loop: past data informs future work. Learnings derived land in `learnings` with `source='producer'` and `category='engagement'` (the category was already accepted by `normalizeProducerCategory`; only the prompt was extended to teach Claude when to use it).

`LEARNER_POST_PUBLISH_PROMPT` adds an analytic frame for the data:
- `starts / views` — did readers who scrolled to the iframe actually engage? (Low ratio = the artefact's affordances aren't obvious.)
- `completions / starts` — for quizzes, did the question set hold attention?
- `avgScore` (quizzes only) — high score with low starts means the quiz is too easy AND nobody's playing; low score with high starts means readers misread the underlying concept.

For HTML interactives, `views=0` is normal pre-deploy and signals "not yet measured" rather than "skipped".

### Surfaces

The new learnings flow through the existing reader views without further code:
- `/dashboard/` "What we've learned so far" panel — the aggregate counts include the new `engagement`-category producer rows alongside reader/self-reflection/zita rows.
- `/daily/[date]/<slug>/` "How this was made" drawer — per-piece "What the system learned from this piece" section grouped by source includes the new engagement learnings under the producer group.

No standalone admin engagement view ships in this phase. Cost telemetry (Phase 3.4) covers the operator-side observability surface; engagement aggregates are a pedagogical signal, not an operational one.

### What is NOT in Phase 4

- **No iframe-content changes.** HTML interactives Claude generates don't gain a postMessage protocol.
- **No quiz-card extension.** `viewed` event is HTML-only this round; `<quiz-card>` continues to fire `started` + `completed` as before.
- **No new alarm.** Engagement aggregation rides the existing 1-second post-publish alarm; no second 23h delayed pass like Zita synthesis.
- **No engagement dashboard surface.** A standalone admin view becomes worth building once we have weeks of data.

## Reference: hand-built example

The canonical "good looks like this" file lives at [`docs/examples/interactive-reference.html`](examples/interactive-reference.html). It is created in Phase 2 (sub-task 2.7), is **permanent** (never deleted), and is updated in place if voice or style evolves.

When the system disagrees with a human about whether a generated interactive is good, the reference file is the tiebreaker.

## Cross-references

- [`INTERACTIVES_PLAN.md`](INTERACTIVES_PLAN.md) — phase plan (don't re-litigate the architectural decisions documented there).
- [`INTERACTIVES_STATUS.md`](INTERACTIVES_STATUS.md) — live "where are we" doc.
- [`SESSION_PROTOCOL.md`](SESSION_PROTOCOL.md) — how the work runs across sessions.
- [`AGENTS.md`](AGENTS.md) — Generator (#15) and Auditor (#16) responsibilities.
- [`SCHEMA.md`](SCHEMA.md) — `interactives`, `interactive_engagement`, `interactive_audit_results`, `admin_settings`.
- [`DECISIONS.md`](DECISIONS.md) — append-only architectural log, including the 2026-04-26 v3 entry.
- [`../CLAUDE.md`](../CLAUDE.md) — project rules (newspaper-never-skips, permanence rule, voice).
- [`../content/voice-contract.md`](../content/voice-contract.md) — the voice contract itself.
- [`../agents/src/interactive-auditor-prompt.ts`](../agents/src/interactive-auditor-prompt.ts) — quiz audit rubric (the essence dimension is reused for HTML).
- [`../src/lib/audit-tier.ts`](../src/lib/audit-tier.ts) — daily-piece tier vocabulary (deliberately not reused for the HTML rough flag).
