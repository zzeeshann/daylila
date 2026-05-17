# Daylila Interactive Contract

This document is the single source of truth for how Daylila quizzes and HTML interactives are *shaped*. The voice contract governs how Daylila *sounds*; this contract governs how the post-publish artefacts (a 3–5 question quiz + a single-file HTML interactive) teach the underlying concept of a daily piece without referencing the piece itself.

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
7. **Standard units of measurement are universal, never piece-references.** SI units, time units, currency units, common physical/scientific units — nm, GHz, kelvin, decibels, days, hours, seconds, USD, EUR, watts, joules, mph — are units, not references, even when the source piece uses them. The *value* the piece names ("121.6 nm", "$18.2 billion") is the piece; the *unit* is always allowed. A wavelength slider for a spectroscopy concept may use nm freely; a coordination-cost lab for a labour dispute may use days freely.

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

- **A clear teaching label.** Above or alongside the interactive surface, in plain words, what concept the manipulation teaches. The reader doesn't have to infer.
- **Cohesive layout.** Title, surface, output, explanation read top-to-bottom (or left-to-right) without the reader hunting.
- **Mobile-respectable.** The interactive doesn't break at 375 px width. Use viewport meta and responsive CSS.
- **Sensible defaults.** Initial state shows something teaching — not a blank canvas requiring three clicks before anything happens.
- **Stable on input.** Manipulating the surface from edge to edge doesn't break the layout, throw a visible error, or render NaN.
- **Pedagogy hooks.** The reader can tell what happened when they manipulated something — output changed, a label updated, a chart redrew, a value flipped.

**Shape diversity.** A slider isn't the only shape. Click sequences, comparison toggles, drag-arrange grids, step-through timelines, 3D scenes, particle systems, audio-reactive visuals, multi-panel canvases — all are valid. Pick the affordance that matches the concept's mechanism. A coordination-failure concept might call for parallel-actor toggles where one's choice flips another's options; a threshold concept might call for a step-through where the system snaps at a value; a flow concept might call for a particle stream the reader rerouted. The shape is part of the teaching.

**Manipulation embodies the mechanism** — strong authorial preference. The mechanism of change in the interactive should mirror the mechanism of the concept. If the piece teaches chokepoints, the slider's effect should compress when capacity is reduced in the right place. The reader's hand on the control should feel the shape of the idea. This is a strong authorial preference, not a numeric pass/fail gate. The hard floor for essence is the seven prohibitions above. A lab that respects those and teaches the underlying pattern in any form passes essence.

The repository includes a chokepoints worked example at `docs/examples/interactive-reference.html` as one design vocabulary. It's not a template to copy — every concept has its own shape, and copying the slider+bars pattern when the concept calls for something else weakens the lab.

### HTML validator constraints

The file runs inside `<iframe sandbox="allow-scripts">`. The validator at `agents/src/interactive-validator.ts` is the gate; it checks eight rules pre-audit:

- `size-cap` — 50 KB hard cap on the inline HTML/CSS/JS. Libraries loaded externally from cdnjs do NOT count against this.
- `storage-api` — no `localStorage`, `sessionStorage`, `indexedDB`. Sandbox without `allow-same-origin` throws SecurityError. State lives in memory for the session.
- `dynamic-code` — no `eval(...)`, `new Function(...)`, or string-form `setTimeout("...", ...)` / `setInterval("...", ...)`. Function references are fine; the string form is forbidden.
- `external-script-allowlist` — external `<script src=...>` is allowed from cdnjs for a curated set of well-known sandbox-safe libraries: **D3 v7** (data viz), **Three.js** (3D scenes), **Pixi.js** (2D canvas, sprites, particles), **p5.js** (creative coding), **Tone.js** (audio synthesis), **GSAP** (animation timelines), **Plotly.js** (interactive charts), **Howler.js** (sound effects), **Anime.js** (lightweight animation). All loaded from `https://cdnjs.cloudflare.com/ajax/libs/<lib>/...`. Anything else fails the validator. Inline `<script>` is fully allowed. None of these libraries are required — many labs need no library at all.
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
- **InteractiveAuditor (quiz path)** judges the quiz on four dimensions (voice, structure / pedagogy, essence-not-reference, factual); reads this contract via `${INTERACTIVE_CONTRACT}` injection. Voice scored 0–100 (≥85 passes); structure / essence / factual binary pass/fail.
- **InteractiveAuditor (HTML path)** judges the HTML on the same four dimensions. Voice scored 0–100 (≥85 passes). Structure / essence / factual are **binary pass/fail** — the auditor either names a specific concrete violation (proper noun X appears, factually wrong claim Y, manipulation does literally nothing) or passes. No numeric scoring on those three dimensions. Reads this contract via `${INTERACTIVE_CONTRACT}` injection.
- **`agents/scripts/verify-interactive-voice.mjs`** is a regression mirror of the Plain English split rule + jargon flag list; hand-synced with this contract (same convention as the rest of the verify-* family).

## Change log

- 2026-05-05 — v1.0 — extracted from `agents/src/interactive-generator-prompt.ts` and `agents/src/interactive-auditor-prompt.ts` (Foundation Fix Task 02 third extraction session, branch `foundation-fix-02-extraction-quiz`). Behaviour-preserving — rule values + canonical phrasings unchanged.
- 2026-05-17 — v1.1 — Lab Renewal. Three coordinated changes: (1) Hard prohibition #7 added — standard units of measurement (nm, GHz, kelvin, decibels, days, USD, etc.) are universal, never piece-references, closing the structural tension that produced the cosmic-web piece's round 3 essence drop. (2) "Manipulation embodies the mechanism" demoted from primary essence bar (numeric gate at 75) to strong authorial preference; hard essence floor is the seven prohibitions. Shape diversity language added — sliders are one shape among many. The "One clear interactive surface" sub-rule removed (multiple surfaces are also valid; the rule was producing slider+bars homogeneity). (3) HTML auditor's structure / essence / factual dimensions move from numeric 0–100 scoring (75 floor) to binary pass/fail with named specific violations, matching the healthy quiz auditor. Validator allowlist expanded from D3-only to nine curated cdnjs libraries (Three.js, Pixi.js, p5.js, Tone.js, GSAP, Plotly, Howler, Anime alongside D3). Canonical chokepoints HTML reference no longer injected into the Generator prompt — file remains on disk as one design vocabulary, not a template to copy. Triggered by the 2026-05-16 cosmic-web piece's flagged-low HTML lab and the broader 35% HTML flag-low rate across the prior 14 days. Behaviour-changing for HTML labs only; quiz pipeline untouched.
