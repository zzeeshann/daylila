# Zeemish Fact-Check Contract

This document is the single source of truth for how Zeemish *verifies its own writing*. The voice contract governs how Zeemish sounds; the beat contract governs how daily pieces are shaped; the interactive contract governs how the post-publish artefacts are shaped; the audit contract governs the gates each draft passes through. This contract governs the rule the Fact Checker auditor applies inside its own gate — what counts as a claim, when to search, what verdicts are allowed, and what the agent must never write to readers.

## What gets checked

The Fact Checker reads the full draft and identifies every factual claim — a statement with a specific name, date, number, or current-event reference that can be verified against an outside source. Then it verifies each claim, one at a time.

What is *not* a claim, and is skipped:

- Opinions, metaphors, analogies. They are not factual statements.
- Approximate numbers in the right ballpark ("about 60% of the body is water"). The general shape is well-established.
- Well-known general science ("the human genome has about 3 billion base pairs", "cortisol is a stress hormone"). Search is not necessary; training data is sufficient.

## The web-search rule

For any claim with a specific name, date, number, or current-event reference, **search the web before assigning a status.** Do not rely on training data alone for current-event claims.

The user message carries today's date — that is the cutoff-vs-now boundary. Anything anchored to a moment past the model's training cutoff has to be looked up; the model has no other way to know.

The search-first rule is the architectural commitment that lets the verdict taxonomy below mean what it says. Without web search, "unverified" collapses to "Claude couldn't find it in training," which is a different statement than "I searched current sources and could not confirm or deny."

The Fact Checker uses Anthropic's `web_search_20250305` server tool. Claude decides per-claim whether to invoke the tool, runs searches inside the same Messages turn, and returns one JSON verdict.

## The verdict taxonomy

Every claim lands in exactly one of three verdicts. The set is closed:

- **`verified`** — confirmed by web search OR is well-established general knowledge.
- **`unverified`** — searched and could not find direct confirmation or contradiction. The right answer when current sources are silent.
- **`incorrect`** — web search returned evidence directly contradicting the claim.

The asymmetry between `unverified` and `incorrect` is load-bearing. **Mark a claim `incorrect` ONLY if web search returned evidence directly contradicting it. Absence of evidence is `unverified`, never `incorrect`.** This is what lets the gate ship pieces with honest gaps without flagging unknowns as wrong.

**Pass condition:** the round passes when **zero claims are `incorrect`**. `unverified` claims are acceptable — an honest "couldn't verify against current sources" is a respectable verdict, not a failure.

## Cutoff-confession ban

Fact Checker notes are reader-facing — the drawer renders them in the "How this was made" panel. The Fact Checker must never write phrasings that confess the model's training cutoff to readers.

Examples of what to never write:

- *"this appears to be speculative fiction"*
- *"this is hypothetical"*
- *"as of my knowledge cutoff"*
- *"this is set in 2026 which is beyond my training"*

These phrases mistake the model's epistemic state for the world's. A real death the model didn't know about is not "speculative fiction" — it's a real death the model didn't know about. (The J. Craig Venter piece on 2026-04-30 was the trigger that motivated this rule and the entire web_search rewrite.)

If web search returned nothing for a claim, the Fact Checker writes: **"Could not verify against current sources."** That's the canonical replacement.

The render-time defense filter (in the site worker's drawer) substring-matches every fact note against this canonical 5-phrase list:

```
speculative fiction
knowledge cutoff
as of my
is hypothetical
beyond my training
```

Any match replaces the entire note with the canonical replacement string above. The defense is belt-and-braces — the writer rule above is the primary line; the filter catches regressions silently rather than embarrassing readers.

The phrase `'training data'` was deliberately dropped from the filter list (it once triggered when fact notes legitimately referenced current AI/ML research mentioning training data — false-positive risk). The other 5 phrases are uniquely cutoff-confession phrasings.

## The web-search budget

The Anthropic `web_search_20250305` server tool runs with **`max_uses = 8` per fact-check call**. 8 is the per-call budget Claude is allowed to spend across all claims in a draft. Typical news-anchored pieces use 3–6 searches; 8 leaves headroom for dense fact-rich pieces.

The budget is tunable. The escalation note in `docs/FOLLOWUPS.md`: drop `max_uses` from 8 to 4 if cost runs above $30/month.

## How agents apply this contract

- **Fact Checker.** Reads this contract via `${FACT_CHECK_CONTRACT}` injection in its system prompt. Imports `WEB_SEARCH_MAX_USES` from `agents/src/shared/fact-check-thresholds.ts` and passes it as the `web_search` tool's `max_uses` parameter.
- **Director.** Filters fact claims by `c.status === 'verified'` for the `claimReviews` frontmatter splice (`director.ts:463`). The `'verified'` literal there IS the rule application — the verdict taxonomy lives in this contract; the literal in code is a use-site, not a duplication of the rule body. Same posture as the `qualityFlag` taxonomy treatment in the audit contract.
- **Integrator.** Filters fact claims by `c.status !== 'verified'` (`integrator.ts:50`) when surfacing fact issues to the next revision round. Same self-mirror posture. Integrator does not re-verdict — it revises prose; it does not need this contract injected into its prompt today.
- **made-drawer (site worker).** Renders verdict status as one of three CSS classes; defends against cutoff-confession leakage via a substring filter that imports `CUTOFF_CONFESSION_PHRASES` from `src/lib/fact-check-thresholds.ts` (the site-side mirror). The drawer also recognises `'contested'` as a fourth status string — back-compat shim for legacy audit rows whose status field predates the 2026-04-30 web_search rewrite — and renders it under the `made-claim-contested` class. This alias is render-side only; the canonical taxonomy stays at three values.
- **`agents/scripts/verify-fact-checker.mjs`** is a JS regression mirror of the parser shape; hand-synced with `parseResponse` in `agents/src/fact-checker.ts`. The verifier tests parser output, not rule body.

## Change log

- 2026-05-07 — v1.0 — extracted from `agents/src/fact-checker-prompt.ts` and `agents/src/fact-checker.ts` (Foundation Fix Task 02 fifth extraction session, branch `foundation-fix-02-extraction-fact-check`). Behaviour-preserving — rule values + canonical phrasings unchanged.
