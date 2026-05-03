# Zeemish Interactive Contract

This document is the single source of truth for how Zeemish quizzes and HTML interactives are *shaped*. The voice contract governs how Zeemish *sounds*; this contract governs how the post-publish artefacts (a 3–5 question quiz + a single-file HTML interactive) teach the underlying concept of a daily piece without referencing the piece itself.

Read together with the voice contract at write- and audit-time.

## The one rule: essence, not reference

The reader of a quiz or interactive does not know the source piece exists. Each artefact must stand alone as a teaching asset about a concept — useful to a stranger who landed on its URL from a search result, a library chip, a friend's link. If a reader of the source piece could tell which piece it came from, the rule has been broken.

The piece is the SOURCE of a concept. The concept is the SUBJECT of the artefact. The artefact teaches the underlying pattern the news event illustrates — not the news event itself.

## Hard prohibitions (apply to both quiz and HTML)

1. Do not use proper nouns from the piece (company names, people, cities, countries, agencies, product names, event names) anywhere in the artefact.
2. Do not use specific dates, years, or timeframes from the piece.
3. Do not quote sentences or phrases from the piece.
4. Do not write "according to the piece", "as described", "in the article", "as we saw above". There is no piece as far as the reader knows.
5. Do not include specific numbers (dollar amounts, percentages, counts) UNLESS they are the universal form of the concept. "A human body is ~60% water" is the concept. "$18.2 billion in quarterly losses" is the piece.
6. Do not name an industry/domain in a way a reader would recognise AS the piece's industry. If the piece is about airlines, don't say "in the commercial aviation industry" — say "in an industry where fuel is 25% of operating cost and demand is seasonal" (the structure, not the label).

## Plain English split rule (applies inside artefact prose)

The artefact teaches a sophisticated concept, but the prose surfaces — every quiz stem, option, and explanation; every HTML caption, status message, and tooltip — must read like everyday speech. The precise concept name belongs in two places only: the `title` and the `concept` line. Everywhere else uses words a curious 14-year-old would understand on first read, without re-reading.

**Translate concept-jargon into everyday words inside stems / options / explanations / captions:**

- asymmetry → imbalance, one side has more
- coordination / coordination agreement → working together, a deal
- mitigation → softening damage, reducing harm
- throughput → flow, how much gets through
- allocation → who gets what, sharing out
- displacement → being pushed aside, replaced
- propagation → spreading, passing along
- restraint / mutual restraint → holding back, sticking with the plan
- structural → built into the system, baked in
- mechanism → how it works, what causes it
- aggregate → total, added up
- threshold → tipping point, line
- trade-off → giving up X to get Y

The list isn't exhaustive. The 14-year-old test is the scoring anchor: **if a curious 14-year-old can't answer the question without re-reading the stem, simplify it.**

**Worked before/after — same concept, rewritten:**

```
Wrong (academic):
"Why does asymmetry in outside options destabilize coordination
agreements even when mutual restraint would benefit all participants?"

Right (plain):
"Why do deals fall apart when one side has more options to walk away?"
```

Both questions test the same idea. The second one a teenager reads once and answers. The first one even a smart adult re-reads twice.

**No hedging.** Make claims, don't soften them. Banned in explanations: *"could be argued that"*, *"might potentially"*, *"arguably"*, *"it is suggested that"*, *"it could be that"*. Write *"X causes Y"* not *"X might be considered to potentially cause Y"*.

**Exemptions.** Slider labels, axis units, and short imperatives stay terse. "Drag the slider", "Capacity:", "Inputs", "USD/barrel" — already correct register, no Plain-English split applies. Domain-neutral concept words (legitimacy, threshold, chokepoint, asymmetry, trade-off, compounding) are concept vocabulary, not tribe words; they are correct in `title` and `concept` line.

## Quiz shape

- 3–5 questions. Each teaches a distinct facet of the concept. Questions should build: a definition-level opener, then mechanism, then implication, then edge or mis-application.
- Exactly 4 options per question.
- Exactly one correct option.
- Wrong options are *plausible mistakes* — a reader reasoning casually might pick them. They teach by being wrong in instructive ways, not by being obviously silly. Avoid "All of the above" and "None of the above" — they dodge the teaching.
- Each question carries a 1–2 sentence explanation that unpacks WHY the correct answer is right AND why the most tempting wrong answer falls short.
- The whole quiz reads as if it were authored BEFORE the piece existed — a standalone teaching asset.

## HTML interactive shape

The interactive must render as one cohesive teaching artefact, not a pile of widgets:

- **One clear interactive surface.** The reader can identify the thing they're meant to manipulate without guessing — a single slider, a clear pair of toggles, a labelled scrub track, a small simulation with one input. Multiple controls are fine *if* they share an obvious purpose (two sliders that compose into one model output) and bad if they fragment the page into disconnected demos.
- **A clear teaching label.** Above or alongside the interactive surface, in plain words, what concept the manipulation teaches. The reader doesn't have to infer.
- **Cohesive layout.** Title, surface, output, explanation read top-to-bottom (or left-to-right) without the reader hunting.
- **Mobile-respectable.** The interactive doesn't break at 375 px width. Use viewport meta and responsive CSS.
- **Sensible defaults.** Initial state shows something teaching — not a blank canvas requiring three clicks before anything happens.
- **Stable on input.** Moving the slider from min to max doesn't break the layout, throw a visible error, or render NaN.
- **Pedagogy hooks.** The reader can tell what happened when they manipulated something — output changed, a label updated, a chart redrew, a value flipped.
- **Manipulation embodies the mechanism.** The mechanism of change in the interactive must mirror the mechanism of the concept. If the piece teaches chokepoints, the slider's effect should compress when capacity is reduced in the right place. The reader's hand on the control should feel the shape of the idea. This is the primary essence bar — an interactive that fails it is decorative, not teaching.

The canonical reference is `docs/examples/interactive-reference.html` — a chokepoints worked example that is structural and voice template, not content to copy.

### HTML validator constraints

The file runs inside `<iframe sandbox="allow-scripts">`. The validator at `agents/src/interactive-validator.ts` is the gate; it checks eight rules pre-audit:

- `size-cap` — 50 KB hard cap on the inline HTML/CSS/JS. D3 v7 loaded externally from cdnjs does NOT count against this.
- `storage-api` — no `localStorage`, `sessionStorage`, `indexedDB`. Sandbox without `allow-same-origin` throws SecurityError. State lives in memory for the session.
- `dynamic-code` — no `eval(...)`, `new Function(...)`, or string-form `setTimeout("...", ...)` / `setInterval("...", ...)`. Function references are fine; the string form is forbidden.
- `external-script-allowlist` — external `<script src=...>` is allowed ONLY for D3 v7 from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/d3/7.<minor>.<patch>/d3.min.js`). Anything else fails the validator. Inline `<script>` is fully allowed.
- `network-call` — no `fetch(...)`, `new XMLHttpRequest()`, `new WebSocket(...)`, `new EventSource(...)`, `navigator.sendBeacon(...)`. Every byte the interactive needs ships in the file.
- `nested-iframe` — no `<iframe>` inside the interactive.
- `form-element` — no `<form>` element. Sandbox disallows submission; it would be visible-but-broken UI.
- `unsafe-url-scheme` — no `data:` or `blob:` URLs in `src=` / `href=` attributes. `data:` URIs in CSS `url(...)` for background images and fonts ARE fine.

## Title + concept + slug (applies to both)

- `title`: 2–6 words, names the concept. Not a headline. Not a question. Examples: "Chokepoints and Cascades", "Information Asymmetry", "Moral Hazard", "Coalition Math".
- `concept`: one sentence naming the underlying principle this artefact teaches. A stranger reading this line on the artefact's page should understand what they'll learn. A topic label, a question, or a missing/blank value all fail voice.
- `slug`: kebab-case, derived from the concept (not from the piece headline). Short (under 4 words). Examples: "chokepoints-and-cascades", "information-asymmetry", "moral-hazard-in-markets".

## How agents apply this contract

- **InteractiveGenerator (quiz path)** writes the JSON quiz; reads this contract via `${INTERACTIVE_CONTRACT}` injection in its system prompt. Adds one quiz-specific anti-pattern inline: *no "Which of the following best describes what happened in…" stems — there is no "what happened" as far as the reader knows.*
- **InteractiveGenerator (HTML path)** writes the JSON HTML interactive; reads this contract via `${INTERACTIVE_CONTRACT}` injection.
- **InteractiveAuditor (quiz path)** judges the quiz on four dimensions (voice, structure / pedagogy, essence-not-reference, factual); reads this contract via `${INTERACTIVE_CONTRACT}` injection.
- **InteractiveAuditor (HTML path)** judges the HTML on the same four dimensions, with structure / essence / factual scored 0–100 instead of binary; reads this contract via `${INTERACTIVE_CONTRACT}` injection.
- **`agents/scripts/verify-interactive-voice.mjs`** is a regression mirror of the Plain English split rule + jargon flag list; hand-synced with this contract (same convention as the rest of the verify-* family).

## Change log

- 2026-05-05 — v1.0 — extracted from `agents/src/interactive-generator-prompt.ts` and `agents/src/interactive-auditor-prompt.ts` (Foundation Fix Task 02 third extraction session, branch `foundation-fix-02-extraction-quiz`). Behaviour-preserving — rule values + canonical phrasings unchanged.
