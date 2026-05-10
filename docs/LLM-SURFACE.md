# Daylila LLM Surface — Audit 2026-05-10

A complete map of every place Daylila talks to a language model — the call site,
what's actually sent, where the prompt content lives, what we know about token
sizes, what reads vague or one-directional in the prompt itself, and how easy
each prompt is to edit without touching code. Ends with a ranked list of the
highest-impact improvements.

**Status update 2026-05-10:** the seven highest-impact improvements ranked at the
end of this document have shipped. See the "Status — improvements 1-7 shipped"
section at the bottom of this file for the per-priority PR links + outcomes.
Items 8, 9, 10 stay parked. Original audit text below is preserved verbatim as
the snapshot that triggered the work.

This was investigation only when written. Nothing in the body below recommends a
code change be applied — those recommendations were lifted into the
`/Users/zee/.claude/plans/llm-surface-cleanup-reflective-flurry.md` plan file
and shipped from there.

---

## Step 1 — Call inventory (the surface area)

Daylila makes Anthropic SDK calls from **two workers** and **one site endpoint**:

| # | Owner | Method | File:line | model | max_tokens | Streaming | Cached |
|---|-------|--------|-----------|-------|-----------|-----------|--------|
| 1 | CuratorAgent | `messages.stream` | [agents/src/curator.ts:54](agents/src/curator.ts:54) | sonnet-4-5 | 8000 | ✓ | — |
| 2 | DrafterAgent.draft (main) | `messages.stream` | [agents/src/drafter.ts:99](agents/src/drafter.ts:99) | sonnet-4-5 | 8000 | ✓ | — |
| 3 | DrafterAgent.reflect | `messages.create` | [agents/src/drafter.ts:195](agents/src/drafter.ts:195) | sonnet-4-5 | 1500 | — | — |
| 4 | VoiceAuditorAgent.audit | `messages.create` | [agents/src/voice-auditor.ts:41](agents/src/voice-auditor.ts:41) | sonnet-4-5 | 2000 | — | — |
| 5 | StructureEditorAgent.review | `messages.create` | [agents/src/structure-editor.ts:34](agents/src/structure-editor.ts:34) | sonnet-4-5 | 2000 | — | — |
| 6 | FactCheckerAgent.check | `messages.create` + `web_search_20250305` tool | [agents/src/fact-checker.ts:86](agents/src/fact-checker.ts:86) | sonnet-4-5 | 4000 | — | — |
| 7 | IntegratorAgent.revise | `messages.stream` | [agents/src/integrator.ts:109](agents/src/integrator.ts:109) | sonnet-4-5 | 8000 | ✓ | — |
| 8 | CategoriserAgent — first attempt | `messages.create` | [agents/src/categoriser.ts:363](agents/src/categoriser.ts:363) | sonnet-4-5 | 1500 | — | — |
| 9 | CategoriserAgent — retry | `messages.create` | [agents/src/categoriser.ts:394](agents/src/categoriser.ts:394) | sonnet-4-5 | 1500 | — | — |
| 10 | LearnerAgent.analyseAndLearn | `messages.create` | [agents/src/learner.ts:219](agents/src/learner.ts:219) | sonnet-4-5 | 1500 | — | — |
| 11 | LearnerAgent.analysePiecePostPublish | `messages.create` | [agents/src/learner.ts:447](agents/src/learner.ts:447) | sonnet-4-5 | 2000 | — | — |
| 12 | LearnerAgent.analyseZitaPatternsDaily | `messages.create` | [agents/src/learner.ts:588](agents/src/learner.ts:588) | sonnet-4-5 | 2000 | — | — |
| 13 | InteractiveGenerator.produceQuiz | `messages.create` | [agents/src/interactive-generator.ts:1281](agents/src/interactive-generator.ts:1281) | sonnet-4-5 | 3000 | — | — |
| 14 | InteractiveGenerator.reviseQuiz | `messages.create` | [agents/src/interactive-generator.ts:1327](agents/src/interactive-generator.ts:1327) | sonnet-4-5 | 3000 | — | — |
| 15 | InteractiveGenerator.repairQuiz | `messages.create` | [agents/src/interactive-generator.ts:1375](agents/src/interactive-generator.ts:1375) | sonnet-4-5 | 3000 | — | — |
| 16 | InteractiveGenerator.produceHtml | `messages.stream` | [agents/src/interactive-generator.ts:1427](agents/src/interactive-generator.ts:1427) | sonnet-4-5 | 16000 | ✓ | ephemeral |
| 17 | InteractiveGenerator.reviseHtml | `messages.stream` | [agents/src/interactive-generator.ts:1495](agents/src/interactive-generator.ts:1495) | sonnet-4-5 | 16000 | ✓ | ephemeral |
| 18 | InteractiveGenerator.repairHtml | `messages.stream` | [agents/src/interactive-generator.ts:1552](agents/src/interactive-generator.ts:1552) | sonnet-4-5 | 16000 | ✓ | ephemeral |
| 19 | InteractiveAuditor.auditQuiz | `messages.create` | [agents/src/interactive-auditor.ts:151](agents/src/interactive-auditor.ts:151) | sonnet-4-5 | 2500 | — | — |
| 20 | InteractiveAuditor.auditHtml | `messages.create` | [agents/src/interactive-auditor.ts:246](agents/src/interactive-auditor.ts:246) | sonnet-4-5 | 4000 | — | ephemeral |
| 21 | Zita chat | raw `fetch` to `/v1/messages` | [src/pages/api/zita/chat.ts:168](src/pages/api/zita/chat.ts:168) | sonnet-4-5 | 300 | — | — |
| 22 | backfill-pick-domain (one-shot script) | `messages.create` | [scripts/backfill-pick-domain.mjs:114](scripts/backfill-pick-domain.mjs:114) | sonnet-4-5 | (n/a) | — | — |

**21 production call sites + 1 backfill script.** All use `claude-sonnet-4-5-20250929`.
Three workers/contexts:

- **Site worker** (`zeemish-v2`) — Zita only.
- **Agents worker** (`zeemish-agents`) — everything else.
- **Operator scripts** — `backfill-pick-domain.mjs` runs ad-hoc from a laptop.

Agents that make **zero LLM calls**: Director, Scanner, Publisher, Observer,
AudioProducer (uses ElevenLabs HTTP), AudioAuditor (R2 HEAD only), Retention
worker. All are pure orchestration / IO.

The Drafter has two distinct calls (`draft` and `reflect`); the Categoriser has
two-call architecture (initial + retry); the Learner has three independent
prompt heads in one agent file; the InteractiveGenerator has six call shapes
(quiz produce/revise/repair × html produce/revise/repair) plus its dispatch
into the InteractiveAuditor's two paths. So **16 logical agents, 21 calls.**

---

## Step 2 — What's actually sent

For each call, this section names the system prompt, the user prompt, and the
dynamic data interpolated into both. Everything below is what flows on the wire
to Anthropic.

### 1. Curator — pick a story + plan beats

- **System prompt** — `CURATOR_PROMPT` from
  [agents/src/curator-prompt.ts:21](agents/src/curator-prompt.ts:21). Three
  layers, top-to-bottom:
  - inline opener (`You are the Curator of Daylila.`)
  - inline Daylila Protocol three-sentence framing
  - `${CURATOR_CONTRACT}` injected (138 lines from
    [content/curator-contract.md](content/curator-contract.md))
  - inline output JSON spec, including the rejections array shape and the
    verbatim-UUID instruction.
- **User prompt** — `buildCuratorPrompt(candidates, recentPieces, recentCategoryCounts, recentDomainCounts)`
  at [agents/src/curator-prompt.ts:76](agents/src/curator-prompt.ts:76). Four
  data blocks:
  - up to 80 candidates from `daily_candidates` (each `id` + `[category]` +
    headline + source + summary; summaries truncated to 250 chars at
    [agents/src/scanner.ts:185](agents/src/scanner.ts:185)),
  - last 30 days of published headlines + underlying subjects,
  - last 30 days of category counts (excluding `patterns-yet-to-cluster`),
  - last 30 days of pick-domain counts.
- **Repeats the rules** at the bottom (verbatim-UUID, soft preferences) so the
  user message is self-anchoring even if the model skipped the system header.

### 2. Drafter — write the MDX

- **System prompt** — `DRAFTER_PROMPT` from
  [agents/src/drafter-prompt.ts:13](agents/src/drafter-prompt.ts:13).
  - inline opener (`You are the Drafter for Daylila…`)
  - `${BEAT_CONTRACT}` injected (67 lines)
  - inline Drafter invariants (4 bullets)
  - inline "When a beat earns a widget" section: 6 worked examples (3 positive
    + 3 negative), the deletion heuristic, the topic-shape permission
    paragraph, the "voice rules apply inside widgets" paragraph.
- **User prompt** — `buildDrafterPrompt(brief, voiceContract, learnings)` at
  [agents/src/drafter-prompt.ts:132](agents/src/drafter-prompt.ts:132).
  - **Voice contract injected as a user-message section** (not system —
    unusual). Pulled from `VOICE_CONTRACT` (38 lines).
  - lessons block — last 10 rows from `learnings` (`getRecentLearnings(10)`),
    only when non-empty; emits a write side-effect on `loaded_at` /
    `load_count`.
  - "Today's Brief" — date, headline, news source, underlying subject,
    teaching angle, tone note, avoid.
  - candidate hooks (3 strings) + beat plan (6–8 entries from Curator).
- The voice contract appearing in the user message means readers reading the
  agent's prompt structure see voice rules as "input data" while the beat
  contract sits as "system instructions". Functionally identical for the
  model, but it makes diff diff'ing across agents harder.

### 3. Drafter reflection — post-publish self-review

- **System prompt** — `DRAFTER_REFLECTION_PROMPT` at
  [agents/src/drafter-prompt.ts:202](agents/src/drafter-prompt.ts:202). 100%
  inline string literal. No contract injection. Opens with the explicit
  statelessness frame ("You didn't write this piece — a prior invocation with
  this same role did.").
- **User prompt** — `buildDrafterReflectionPrompt(brief, mdx)` at
  [agents/src/drafter-prompt.ts:228](agents/src/drafter-prompt.ts:228). Brief
  fields + the final MDX, no scores or round counts (deliberate).

### 4. Voice Auditor

- **System prompt** — `buildVoiceAuditorSystem()` at
  [agents/src/voice-auditor-prompt.ts:11](agents/src/voice-auditor-prompt.ts:11).
  - inline opener
  - `${VOICE_CONTRACT}` injected
  - **inline scoring rubric with hard-coded penalties** —
    `tribe word → -10`, `flattery → -15`, `jargon → -10`,
    `long padded sentence → -5`, `"In this lesson…" opening → -20`,
    `summary/CTA in close → -15`. Magic numbers; not in any contract.
  - Inline output JSON spec + closed-enum `failure_reasons` taxonomy.
- **User prompt** — `Audit this draft:\n\n${mdx}` (literal). The full MDX
  including frontmatter goes through.

### 5. Structure Editor

- **System prompt** — `STRUCTURE_EDITOR_PROMPT` at
  [agents/src/structure-editor-prompt.ts:10](agents/src/structure-editor-prompt.ts:10).
  - `${BEAT_CONTRACT}` injected
  - **inline 9-rule audit checklist that partly restates the contract.**
    Notable inline-vs-contract overlap: `Total word count outside 900–1100`
    (literal duplicated), `Beat count outside 5–8 … 9+ padding zone` (literal
    duplicated), `Any single beat over 200 words` (literal duplicated). When
    the beat contract changes the numeric, this prompt must be hand-edited too.
  - inline `IMPORTANT: Be reasonable.` paragraph (more on this in Step 5)
  - inline output JSON + closed-enum `failure_reasons`.
- **User prompt** — `Review this lesson structure:\n\n${mdx}` (literal).

### 6. Fact Checker

- **System prompt** — `FACT_CHECKER_PROMPT` at
  [agents/src/fact-checker-prompt.ts:29](agents/src/fact-checker-prompt.ts:29).
  - one-line opener
  - `${FACT_CHECK_CONTRACT}` injected (82 lines, the longest of the contracts)
  - inline output JSON + closed-enum `failure_reasons`.
- **User prompt** — `Today is ${today}. Fact-check this lesson:\n\n${mdx}`
  (literal). Today's date is computed in code with `new Date().toISOString().slice(0, 10)`
  so the cutoff-vs-now boundary is current.
- **Tools** — `web_search_20250305` with `max_uses: 8` (`WEB_SEARCH_MAX_USES`
  from the threshold module). The tool call results bounce back into the
  conversation, so total turn size is unbounded by the prompt — ~5–15k tokens
  added in observed runs depending on how many searches Claude triggers.

### 7. Integrator

- **System prompt** — `buildIntegratorSystem()` at
  [agents/src/integrator-prompt.ts:20](agents/src/integrator-prompt.ts:20).
  - `${INTEGRATOR_CONTRACT}` injected (69 lines)
  - `${VOICE_CONTRACT}` injected
  - `${BEAT_CONTRACT}` injected
  - inline RULES paragraph (PRESERVE/FIX framing, smallest-edit rule)
  - inline strict response-format JSON
  - inline allowed-values reminder (re-stating the closed enums from the
    contract).
  Combined system prompt is large — three contracts plus inline scaffolding
  ≈ 6–8 KB.
- **User prompt** — assembled in [agents/src/integrator.ts:113](agents/src/integrator.ts:113).
  Three layered sections:
  - optional `## Previous round (round N-1) audit summary` block when DO state
    holds a same-piece snapshot (`buildPreviousRoundContext` at line 301)
  - `## Original draft:` + the full current MDX
  - `## Feedback from auditors:` (`buildCurrentRoundFeedback` at line 234) —
    always emits all three dimensions marked PASS or FAIL with PRESERVE/FIX
    framing, never drops a passing dimension before prompt construction.

### 8 + 9. Categoriser (initial + retry)

- **Initial system prompt** — `CATEGORISER_PROMPT` at
  [agents/src/categoriser-prompt.ts:26](agents/src/categoriser-prompt.ts:26).
  Inline opener + `${CATEGORISER_CONTRACT}` injected (118 lines) + inline
  response-format JSON + inline reminder of one-of-categoryId-or-newCategory.
- **User prompt** — `buildCategoriserPrompt(piece, existing)`. Piece block
  (headline, underlying subject, body excerpt up to 2000 chars, frontmatter
  stripped). Existing-categories block — for each category: id, name, slug,
  description, piece_count, recent headlines (up to 3), `filling_fast: true`
  flag for ≥3 pieces in 7 days.
- **Retry call** — same system prompt, full conversation reused (initial user
  + assistant first response + new user `CATEGORISER_RETRY_MESSAGE` at
  [agents/src/categoriser-prompt.ts:142](agents/src/categoriser-prompt.ts:142)).
  Retry message contains hardcoded literal `60` and `74` with a comment
  acknowledging hand-sync against the contract.

### 10. Learner.analyseAndLearn (engagement → learnings)

- **System prompt** — `LEARNER_ANALYSE_PROMPT` at
  [agents/src/learner-prompt.ts:88](agents/src/learner-prompt.ts:88). 100%
  inline. No contract injection. Three example "good learnings" given as
  in-prompt text.
- **User prompt** — built inline in [agents/src/learner.ts:226](agents/src/learner.ts:226).
  Lesson id + completion rate + views + drop-off beat + reason. No piece body,
  no audit, no engagement specifics beyond the metric headlines.

### 11. Learner.analysePiecePostPublish (producer-side learnings)

- **System prompt** — `LEARNER_POST_PUBLISH_PROMPT` at
  [agents/src/learner-prompt.ts:11](agents/src/learner-prompt.ts:11). 100%
  inline. Names the drawer surface ("Patterns extracted for tomorrow's
  Drafter"), instructs forward-looking framing, gives 5 worked example
  learnings.
- **User prompt** — assembled at [agents/src/learner.ts:415](agents/src/learner.ts:415).
  Piece metadata, picked candidate, top-5 skipped candidates, every audit
  round's findings (notes truncated to 1500 chars per row), aggregated last
  14-day interactive engagement, full pipeline timeline.

### 12. Learner.analyseZitaPatternsDaily

- **System prompt** — `LEARNER_ZITA_PROMPT` at
  [agents/src/learner-prompt.ts:54](agents/src/learner-prompt.ts:54). 100%
  inline. Same shape as post-publish — 4 example learnings, JSON output spec.
- **User prompt** — every Zita conversation for the piece grouped by reader,
  rendered as `Reader: …` / `Zita: …` lines, plus piece metadata. Guarded by
  a 5-user-message minimum at [agents/src/learner.ts:537](agents/src/learner.ts:537).

### 13–18. Interactive Generator (6 call shapes)

All six share `INTERACTIVE_GENERATOR_PROMPT` (quiz path) or
`INTERACTIVE_HTML_GENERATOR_PROMPT` (HTML path) — see
[agents/src/interactive-generator-prompt.ts:69](agents/src/interactive-generator-prompt.ts:69)
and [agents/src/interactive-generator-prompt.ts:407](agents/src/interactive-generator-prompt.ts:407).

- **Quiz system prompt** — opener + 3 worked examples (essence-not-reference)
  + `${VOICE_CONTRACT}` + `${INTERACTIVE_CONTRACT}` + inline quiz-specific
  anti-pattern + inline output JSON.
- **HTML system prompt** — opener + 3 worked examples + `${VOICE_CONTRACT}` +
  `${INTERACTIVE_CONTRACT}` + a long inline "Sandbox compatibility" section
  duplicating part of the contract's HTML validator constraints (forbidden
  APIs, forbidden elements, forbidden URL schemes, external-script allowlist,
  file-size cap), the engagement-events sentence, the diversity-with-past
  sentence, the entire `INTERACTIVE_HTML_REFERENCE` chokepoints HTML file
  (~12 KB) inlined as the reference template, and the inline output JSON
  spec.
- **Cache** — HTML-path system prompt is sent as a single
  `cache_control: { type: 'ephemeral' }` block. Quiz-path system prompt is not
  cached.
- **Prefill anchor** — every call prefills the assistant turn with `{` and
  prepends it back to the parsed text. Belt-and-braces against pre-amble.
- **User prompts** —
  - `buildInteractivePrompt` / `buildHtmlInteractivePrompt` — piece header +
    body excerpt (2500 chars) + recent interactives (slug, title, concept).
  - `buildRevisionPrompt` / `buildHtmlRevisionPrompt` — previous attempt
    rendered as readable text + auditor feedback per dimension + (HTML only)
    validator violations + piece block + recent block.
  - `buildJsonRepairPrompt` / `buildHtmlJsonRepairPrompt` — broken-output
    head (~200 chars) + minimal piece block + JSON-validity instruction.

### 19 + 20. Interactive Auditor (quiz + html)

- **Quiz system prompt** — `INTERACTIVE_AUDITOR_PROMPT` at
  [agents/src/interactive-auditor-prompt.ts:37](agents/src/interactive-auditor-prompt.ts:37).
  Opener + `${VOICE_CONTRACT}` + `${INTERACTIVE_CONTRACT}` + four-dimensional
  scoring rubric inline (voice scored 0–100, structure / essence / factual
  binary) + the strict-JSON output spec.
- **HTML system prompt** — `INTERACTIVE_HTML_AUDITOR_PROMPT` at
  [agents/src/interactive-auditor-prompt.ts:225](agents/src/interactive-auditor-prompt.ts:225).
  Same shape, but ALL FOUR dimensions scored 0–100, with a 75 floor on
  structure/essence/factual. Sent as a cached block.
- **User prompt** — quiz rendered as readable text (Q/A/explanation per
  question) OR full HTML source. Plus piece block (headline, underlying
  subject, body excerpt) for essence checks.

### 21. Zita chat (site worker)

- **System prompt** — fully inline at
  [src/pages/api/zita/chat.ts:28](src/pages/api/zita/chat.ts:28). 8 numbered
  "core rules" (ask before telling, scaffold, 2–4 sentences, plain English,
  etc.). **Does not import or inject the canonical voice contract.**
- **Per-request prefix** — when course is `daily`,
  `You are discussing the piece titled "${lesson_title}", published ${piece_date}.`
  is prepended.
- **Per-request suffix** — `## Current lesson context` block with course slug,
  lesson number, lesson title, and `lesson_context` if the client passed one.
- **User messages** — last 40 rows from `zita_messages` for this user/piece
  (chronologically reversed) + the new user message. The 40-row cap fires an
  `info`-severity observer event when truncated.

### 22. backfill-pick-domain (one-shot script)

- One Claude call per backfill batch (default 30 pieces). Loads
  `content/curator-contract.md` from disk; minimal scaffolding asking Claude
  to assign one of the 10 domain enum values to each piece. Stage A only —
  emits SQL for operator review before any D1 write.

---

## Step 3 — Where the prompt content lives

For each call, this is how far the actual English instructions sit from the
place that fires the API call. Five categories below; the assignment per call
is in the table.

| Category | Meaning |
|----------|---------|
| `contract+inline` | System prompt is mostly a `${CONTRACT}` injection from `content/*.md`, with thin inline scaffolding around it (opener, output JSON, response-shape reminder). Editing English in `content/*.md` does not require touching code. |
| `inline-with-contract-mix` | Some rules live in `content/*.md` and are injected; *other* rules of the same domain live as inline string literals in the prompt module. Editing the inline rules requires editing `.ts`. Drift risk between contract and inline. |
| `inline-only` | Prompt is entirely a TypeScript string literal in a `*-prompt.ts` file. No contract injection at all. Editing English requires editing `.ts`. |
| `inline-in-call-site` | Prompt lives in the same file that fires the API call (no `*-prompt.ts` separation at all). |
| `script` | Prompt lives in an operator script under `scripts/`. |

| # | Owner | Prompt content location | Why |
|---|-------|------------------------|-----|
| 1 | Curator | `contract+inline` | `${CURATOR_CONTRACT}` carries rule body. Inline: opener, Daylila Protocol opener (also in voice-contract.md), response-format JSON, verbatim-UUID rule. |
| 2 | Drafter (main) | `inline-with-contract-mix` | `${BEAT_CONTRACT}` injected (system) and `${VOICE_CONTRACT}` injected (user message). Inline: Drafter invariants (4 bullets), worked widget examples (6), deletion heuristic, topic-shape permission. |
| 3 | Drafter reflection | `inline-only` | All English in `DRAFTER_REFLECTION_PROMPT` literal. |
| 4 | Voice Auditor | `inline-with-contract-mix` | `${VOICE_CONTRACT}` injected. Inline: scoring rubric with hard-coded penalties (-10/-15/-20). |
| 5 | Structure Editor | `inline-with-contract-mix` | `${BEAT_CONTRACT}` injected. Inline: 9-rule audit checklist, the "Be reasonable" paragraph, several literals (`900–1100`, `5–8`, `200 words`) restated from the contract. |
| 6 | Fact Checker | `contract+inline` | `${FACT_CHECK_CONTRACT}` carries rule body. Inline: opener, `Today is X` instruction, output JSON, failure_reasons. |
| 7 | Integrator | `contract+inline` | Three contracts injected. Inline: RULES paragraph, response format, closed-enum reminder. |
| 8+9 | Categoriser | `contract+inline` | `${CATEGORISER_CONTRACT}` carries rule body. Inline: response-format JSON, retry message (with hand-synced literals `60` and `74`). |
| 10 | Learner.analyseAndLearn | `inline-only` | `LEARNER_ANALYSE_PROMPT` literal. No contract. |
| 11 | Learner.analysePiecePostPublish | `inline-only` | `LEARNER_POST_PUBLISH_PROMPT` literal. No contract. |
| 12 | Learner.analyseZitaPatternsDaily | `inline-only` | `LEARNER_ZITA_PROMPT` literal. No contract. |
| 13–15 | Interactive Generator (quiz) | `contract+inline` | `${VOICE_CONTRACT}` + `${INTERACTIVE_CONTRACT}` injected. Inline: 3 worked examples, opener, output JSON, quiz anti-pattern. |
| 16–18 | Interactive Generator (HTML) | `inline-with-contract-mix` | Two contracts injected. Inline: 3 worked examples, "Sandbox compatibility" duplicating contract's validator constraints, full reference HTML, output JSON. |
| 19 | Interactive Auditor (quiz) | `contract+inline` | Two contracts injected. Inline: four-dimensional rubric paragraphs, output JSON. |
| 20 | Interactive Auditor (HTML) | `inline-with-contract-mix` | Two contracts injected. Inline: four-dimensional rubric prose with several literal values (`75` floor, `≥85` voice, etc.) restated from the contract. |
| 21 | Zita chat | `inline-in-call-site` | Lives at the top of [src/pages/api/zita/chat.ts](src/pages/api/zita/chat.ts). No contract injection — the only LLM call where editing English requires changing the chat handler. |
| 22 | backfill-pick-domain | `script` | Reads `content/curator-contract.md` from disk; minimal inline scaffolding. |

The clean `contract+inline` calls (8/21) are the easy editing surface. The
`inline-with-contract-mix` calls (5/21) are the worst pattern: rules of the
same domain fragmented across markdown and TypeScript, with literal numeric
values duplicated in both. The pure `inline-only` calls (4/21 — the three
Learner heads + Drafter reflection) are honest about being inline; they
never claim to read a contract.

The full bundled prompt content shipped to the agents worker lives in
[agents/src/shared/generated/contracts.ts](agents/src/shared/generated/contracts.ts)
(~98 KB, regenerated by `cd agents && pnpm codegen` from `content/*.md`). CI
gate `pnpm verify-contracts-fresh` blocks deploys on stale checked-in copies.

---

## Step 4 — Token sizes (what we know, what we don't)

There is **no canonical token-usage table** in the codebase. Three layers of
visibility exist, and they cover different calls:

### Layer 1 — Captured + logged to observer_events

These calls surface input/output tokens in `observer_events.body`, queryable
from the admin dashboard. Recent values pulled from prod D1 (last week):

| Call | Recent input (tokens) | Recent output | Latency | Captured? |
|------|----------------------|----------------|---------|-----------|
| Drafter reflection | 2,584–3,167 | 342–506 | 9–16 s | ✓ |
| Categoriser (success path) | 5,763–6,500 | 91–202 | 3–5 s | ✓ |
| Learner.analyseZitaPatternsDaily | (variable) | (variable) | (variable) | ✓ when not skipped |
| Interactive Generator (HTML) | 4,272–13,674 input + 7–27 k cacheRead | 3,293–8,485 | 46–157 s | ✓ |

Cache reads on the HTML path land in the 7–27 k range, indicating the cached
system prompt is roughly 13 k tokens (cacheCreate value on cold runs).

### Layer 2 — Captured in code, not logged

`DrafterAgent.reflect` captures `response.usage` (line 203) and so does
`Learner.analyseZitaPatternsDaily` (line 647). Director routes both into
`observer.logReflection*` and `observer.logCategoriser*` for surfacing.

### Layer 3 — Never captured at all

These calls **discard `response.usage` entirely**:

- CuratorAgent.curate
- DrafterAgent.draft (the main draft, NOT the reflection)
- VoiceAuditorAgent.audit
- StructureEditorAgent.review
- FactCheckerAgent.check
- IntegratorAgent.revise
- LearnerAgent.analyseAndLearn
- LearnerAgent.analysePiecePostPublish (producer-side; the more frequent of
  the Learner trio)
- Zita chat
- The two Categoriser CALLS individually (only the aggregated agent-result is
  logged; per-call breakdown isn't surfaced — `consideredFirst` etc. is
  attempt-level meta but token totals aren't separable).

The shape of the gap: **every expensive mainline call (Curator, Drafter,
auditors, Integrator) burns Anthropic budget invisibly. The cheap post-publish
calls (Categoriser, reflection, Zita synthesis) are well-metered.** This is
backwards — the expensive calls are exactly the ones a runaway prompt would
hide in.

The 2026-05-09 Curator timeout incident (35 k input × 3 retries × $0.18 =
$0.54 burned per click; CLAUDE.md "Curator 124s 499 timeout regression") was
diagnosed from Anthropic console UI, not from D1. If Anthropic's console were
unavailable for an hour, we would not have a way to spot a token-bloat
regression.

### Estimated input sizes from the prompts themselves

(Computed from inline + injected content; ±20%.)

- Curator system: ~7–8 k tokens (~6 k for the contract injection alone).
- Drafter system + user: ~3–4 k tokens of contract+rules; plus a draft is
  ~2.7 k output.
- Voice auditor: ~1.5 k system + MDX (~1.5 k) ≈ 3 k input.
- Structure editor: ~1.5 k system + MDX (~1.5 k) ≈ 3 k input.
- Fact checker: ~2 k system + MDX (~1.5 k) + web_search round-trip results
  (5–15 k) → highly variable, observed total 5–15 k.
- Integrator: ~3 k system (three contracts) + MDX + audit feedback ≈ 6–9 k
  input; output 3 k+ when streaming a full revised MDX.
- Interactive HTML: system block ~13 k tokens (cached); user ~1 k; output 4–8
  k. The cache makes the cold/warm cost asymmetric — first call of a day pays
  the full system block, subsequent calls within the cache window pay 1/10×.
- Zita: system ~250 tokens; up to 40 history turns + new message; output cap
  300 tokens.

### Calls where size doesn't match the task

- **Voice Auditor `max_tokens: 2000`** — produces a JSON envelope with
  ≤6 violations + suggestions. Empirical notes column averages 389 chars.
  2000 is ~6× larger than typical output.
- **Structure Editor `max_tokens: 2000`** — empirical notes average 96 chars
  (mean) with max 902. 2000 tokens is ~20× larger than typical output.
- **Fact Checker `max_tokens: 4000`** — empirical notes average 4,935 chars
  (mean) with max 10,213. 4000 tokens is roughly right; the *input* is the
  unbounded leg via web_search.
- **Categoriser `max_tokens: 1500`** — observed output is 91–202 tokens.
  1500 is a generous safety margin (the resolver caps at 3 assignments).
- **Drafter reflection `max_tokens: 1500`** — observed output 342–506 tokens.
- **Interactive HTML `max_tokens: 16000`** — observed output 3,293–8,485
  tokens. 16000 is genuine headroom for a 50 KB HTML file (~12.5 k tokens).
- **Drafter main `max_tokens: 8000`** — observed output ~2,700 tokens
  (logs/CLAUDE.md). 8000 sits comfortably above for outliers.
- **Curator `max_tokens: 8000`** — observed output ~4,800 tokens after PR #25
  expanded the rejections array. 8000 was raised from 3000 specifically to fit
  this. Tight but adequate.
- **Integrator `max_tokens: 8000`** — observed output 3,123 tokens.
- **Zita `max_tokens: 300`** — exactly right for the 2–4 sentence target.

---

## Step 5 — Quality read of each prompt (English flags)

Reading each prompt as English. What's vague, contradictory, one-directional,
under-contextual, or stuffed with information that doesn't help the task.

### Curator system prompt — clean, post-2026-05-09

Strong example for the rest of the system. The opener + Protocol three-line
inline framing is a posture-setter — it's a different layer than the
mechanical pick rules in the contract. The contract itself is well-shaped
(Tier-1 selection criteria, soft preferences, hard skips, output records).
The bottom-of-prompt skip-conditions reminder reinforces what the contract
already said — possibly redundant but harmless.

The user-message duplicates several rule reminders ("Apply the SAME-EVENT and
SAME-CONCEPT hard-skip rules…"). Acceptable as anchoring.

One small drift: the user message names "the 10-domain taxonomy is
breadth-showing — if 3+ recent picks have landed in one domain…" — the `3+`
threshold is also in the contract under "Recent-category concentration", but
it's stated as `3+` in user message and as "3+" in contract; if the contract
ever moves to 4, a hand sync is required.

### Drafter system + user — clean, post-2026-05-09 widget rebalance

The widget framing now reads symmetric: scan-for-earning-moments instruction
comes BEFORE the deletion heuristic (CLAUDE.md "PR #27 widget rebalance",
2026-05-09). The 6 worked examples (3 positive + 3 negative) are concrete and
actionable. The "topic-shape permission" paragraph closes the opt-out — opinion
or news-summary shapes get zero widgets without guilt.

Voice contract injected into user message rather than system is a positional
oddity. Functionally identical for the model; cosmetic only.

### Drafter reflection — strong framing, clean

"You didn't write this piece — a prior invocation with this same role did" is
a load-bearing sentence — the model would otherwise LARP remembered struggle.
Worked through carefully; produces the forward-looking framing wanted.

### Voice Auditor — hidden hand-coded scoring rubric

The inline rubric:

```
Tribe words (mindfulness, journey, empower, etc.) → automatic -10 per instance
Flattery ("great job reading this") → -15
Jargon without explanation → -10
Long padded sentences → -5 each
"In this lesson we'll learn..." openings → -20
Summary/CTA/congratulations in close → -15
```

Three problems:

1. **The penalties are magic numbers in the prompt, not in any contract.**
   Editing them requires editing `voice-auditor-prompt.ts`. They aren't
   versioned with the voice contract.

2. **The rubric is one-directional in a way that biases scores down.** Five
   long sentences are -25; one tribe word is -10. A piece with mild structural
   pattern issues can score worse than a piece with a single banned word —
   even though the contract treats tribe words as harder violations than long
   sentences.

3. **The reduction examples list 6 violation kinds; the closed-enum
   `failure_reasons` list right below has 6 different tokens. They overlap but
   don't match.** "In this lesson…" opener is a -20 deduction but isn't in the
   closed enum (closest is `weak_hook` — but that lives on the Structure
   Editor, not the Voice Auditor). "Long padded sentences" is `-5 each` but
   the enum says "Emit one token per VIOLATION KIND, not per instance" —
   meaning 5 long sentences collapse to one `long_sentence` token while
   producing -25 in score. The score and the token count are computed by
   different rules.

This prompt scored a 95 on the magic-mushroom piece, then 92, then 95 (the
trigger for Foundation Fix Task 09 / Integrator regression awareness — see
CLAUDE.md). The hand-coded penalties are a plausible source of that
non-monotonicity: changing a single sentence shifts the score by one
deduction, and the sum of deductions is not stable across paraphrasings.

### Structure Editor — partial drift from beat contract

The 9-rule inline checklist restates literal values from the beat contract:

- Rule 1 names `900–1100` (also in beat-contract.md)
- Rule 2 names `5–8`, `9+ padding zone`, `200 words` (all in beat-contract.md)

If beat-contract.md ever changes these numbers, this prompt must be hand-edited
too. There is no codegen-time check for the literal duplication — only the
contract itself is codegenned.

The "IMPORTANT: Be reasonable. Minor formatting differences or slight word
count variations are NOT failures." paragraph is the kind of vague fence the
user has flagged before. It's there to dampen false-fail noise, but it
contradicts rule 1 in the same prompt, which lists "Total word count outside
900–1100" as a fail. A better mental model: the rule says fail outside
900–1100; the "be reasonable" paragraph says don't always fail outside
900–1100. The model has to resolve the contradiction itself.

### Fact Checker — clean

The contract injection carries the rule body. The web-search-first rule + the
cutoff-confession ban are correctly scoped to the contract. The only inline
content is the output JSON spec and the failure_reasons enum.

One observable drift, found in production: at least one recent run dropped a
token labelled `unknown` ("Fact checker dropped 1 unknown failure_reason
token(s) from the response"). The closed-enum guard is doing its job. Worth
watching.

### Integrator — heavy, well-shaped post-Task-09

Three contracts in one system prompt is the most-stuffed system prompt in the
codebase. The PRESERVE/FIX framing addresses what was a real regression issue
(magic-mushroom piece R1→R2 voice 95→92).

The previous-round-context block is well-written prose. It explicitly names
"any pass→fail flip across rounds is a regression introduced by your last
revision and must be repaired without re-breaking what's now passing."

One small drift: the inline `Allowed values:` reminder repeats the closed-enum
values that already live in the contract. Reasonable for anchoring, but
tedious to maintain.

### Categoriser — well-shaped after the v1.1 rewrite

The taxonomy-fragmentation rewrite (2026-05-07) made this contract concrete.
Every rule has a worked example. The retry message is a clean second-shot
nudge that quotes the violation and points at the two viable paths
(stretch-reuse / one new category).

The `60`/`74` literals in the retry message are flagged as hand-synced — the
file's comment names this. If the contract numbers ever change, this is one
place that won't follow automatically.

### Learner.analyseAndLearn — vague, under-contextual

This is the prompt that fires when an underperforming piece is detected via
engagement metrics. It is the simplest of the three Learner heads — and the
weakest:

- The user message gives the model: lesson id, completion rate, views,
  drop-off beat, reason. Nothing else. No piece body, no audit detail, no
  comparison to other pieces.
- The system prompt's three example "good learnings" are abstract:
  *"Hooks that open with a specific number get 20% higher completion than
  hooks that open with a question"* — a learning shaped like a study result,
  but the model would have no data to support such a claim from a single
  metric snapshot.
- The model is asked to "extract 2-4 specific, actionable learnings" from
  one row of metrics. The shape is a one-shot guess.

This call's role in the pipeline is small (engagement reports trigger it on
underperformers; the scale is currently low) — but the prompt is the only one
in the system that asks for output without giving the model enough material
to produce truthful output. The other two Learner heads do this much better
(`analysePiecePostPublish` gives full piece + audit + engagement;
`analyseZitaPatternsDaily` gives every Zita conversation verbatim).

### Learner post-publish — clean

Forward-looking framing is anchored. The 5 worked examples are concrete and
the rewrite-from-past-tense-to-future-tense instruction is well-stated. The
user-message data block is rich (every audit round's full notes, picked +
skipped candidates, 14-day engagement, pipeline timeline).

### Learner Zita synthesis — clean

Same shape as post-publish. The 5-user-message floor is enforced in code so
the model isn't asked for patterns from a single conversation.

### Interactive Generator (quiz) — clean

3 worked examples + voice + interactive contracts + tight output JSON spec.
The quiz-specific anti-pattern rule sits at the right scope (one extra rule
on top of the contract).

### Interactive Generator (HTML) — heavy + drift risk

The system prompt is the single biggest in the codebase: contracts +
worked examples + sandbox spec + reference HTML + JSON spec. Around 13 k
tokens, hence the cache. The reference HTML is ~12 KB on its own. Worth the
cost — first-pass HTML quality is high enough that 1-revision rounds are
common.

But the inline "Sandbox compatibility" section duplicates the contract's
"HTML validator constraints" section in different prose. Forbidden APIs in
both. Forbidden URL schemes in both. The two lists are *almost* identical
but not bit-for-bit; if the contract changes one allowlist entry, this prompt
must be hand-edited.

The recent observed `Verification Depth and Cost` HTML interactive (CLAUDE.md
2026-05-09 evening, "shipped flagged-low") is a good signal that the prompt
is converging well-enough most of the time — but the failure mode there
(voice 68/100, essence failed) is the kind of thing this prompt's framing
should catch in round 1.

### Interactive Auditor (quiz + HTML) — well-shaped, long

Both auditor prompts are dense but well-structured. The four dimensions are
clearly named and each has a "what passes / what fails / the test to apply"
shape. The Plain English split rule is the clearest part of either contract.

Some drift: the HTML auditor's structure-section's 7 bullet points
("One clear interactive surface", "A clear teaching label", etc.) almost
verbatim repeat the 8 shape rules from interactive-contract.md. The prompt
flags 7; the contract has 8. Not a behavioural problem because the contract
is the authoritative source — but it indicates the rubric was hand-typed,
not generated from the contract.

### Zita system prompt — drift from the canonical voice contract

The Zita prompt has its own 8-rule list. Rule 5 says *"Plain English. Same
voice rules as Daylila: no jargon, no tribe words, no flattery."* — but it
doesn't list which words are tribe words, doesn't import the canonical voice
contract, and the actual voice contract has 6 numbered non-negotiables that
Zita's prompt restates as 8 numbered rules (re-grouped, partly overlapping).

If Daylila's voice rules ever change in `content/voice-contract.md`, Zita's
prompt does NOT update. A reader chatting with Zita could plausibly hear a
tribe word that the daily piece's auditor would have caught. Low-impact
drift, but real.

The prompt also lives in a `*.ts` file at the call-site (the chat handler,
not a `*-prompt.ts` module), which is the only LLM call where prompt-editing
requires touching a runtime handler.

---

## Step 6 — Code/content separation matrix

How easy is it to edit the English without touching code?

| Call | Editing English requires editing… | Difficulty |
|------|-----------------------------------|------------|
| Curator | `content/curator-contract.md` (rule body); `agents/src/curator-prompt.ts` for opener / output JSON | Easy for rules, medium for response shape |
| Drafter (main) | `content/beat-contract.md` + `content/voice-contract.md` (rule bodies); `agents/src/drafter-prompt.ts` for invariants + widget worked examples | Easy for contract rules, medium for the inline widget framing |
| Drafter reflection | `agents/src/drafter-prompt.ts` only | Hard — pure inline |
| Voice Auditor | `content/voice-contract.md` for rules; `agents/src/voice-auditor-prompt.ts` for the hand-coded scoring rubric | Hard — the rubric is the actual scoring instrument |
| Structure Editor | `content/beat-contract.md` for rules; `agents/src/structure-editor-prompt.ts` for the 9-rule inline checklist + "Be reasonable" line | Hard — drift between contract and inline |
| Fact Checker | `content/fact-check-contract.md` (rule body); `agents/src/fact-checker-prompt.ts` for output JSON + closed enum | Easy for rules, medium for shape |
| Integrator | `content/integrator-contract.md` + voice + beat contracts; `agents/src/integrator-prompt.ts` for RULES + response format | Easy for rules, medium for shape |
| Categoriser | `content/categoriser-contract.md` (rule body); `agents/src/categoriser-prompt.ts` for retry message (with hand-synced literals) | Easy for rules, medium for retry |
| Learner.analyseAndLearn | `agents/src/learner-prompt.ts` only | Hard |
| Learner.analysePiecePostPublish | `agents/src/learner-prompt.ts` only | Hard |
| Learner.analyseZitaPatternsDaily | `agents/src/learner-prompt.ts` only | Hard |
| Interactive Generator (quiz) | voice + interactive contracts; `agents/src/interactive-generator-prompt.ts` for opener + worked examples | Easy for rules, medium for examples |
| Interactive Generator (HTML) | voice + interactive contracts; `agents/src/interactive-generator-prompt.ts` for sandbox spec + worked examples; `docs/examples/interactive-reference.html` for the reference template | Easy for rules, medium for examples + sandbox spec, easy for reference |
| Interactive Auditor (quiz + HTML) | voice + interactive contracts; `agents/src/interactive-auditor-prompt.ts` for rubric prose | Easy for rules, medium for rubric |
| Zita | `src/pages/api/zita/chat.ts` only | Hardest — at the call site, no separation |
| backfill-pick-domain | `content/curator-contract.md` (loaded from disk) + `scripts/backfill-pick-domain.mjs` for inline scaffolding | Easy for rules, easy for scaffolding |

The clean third (8/22 calls) is genuinely contract-driven. The middle third
(8/22) is contract+inline mixed — the contract is canonical but inline rule
bodies still exist and can drift. The last third (6/22) is fully inline
TypeScript (Drafter reflection, three Learner heads, Zita, with the latter
also being at the call site).

---

## Step 7 — Synthesis

### What's working

- **Eight contracts in `content/*.md` cover the canonical rule bodies.** This
  is the win of the Foundation Fix Phase 1 programme. The voice / beat /
  audit / fact-check / curator / audio / categoriser / interactive contracts
  ARE the source of truth, and codegen makes it impossible to ship a stale
  copy to the agents bundle.
- **Closed-enum failure tokens (Tasks 03/06/08c)** mean every audit round can
  be queried by failure shape, not just by free-text notes. The
  agents-side runtime mirrors (`VOICE_FAILURE_REASONS`, `INTEGRATOR_DECISIONS`,
  `PICK_DOMAINS`, etc.) catch enum drift at the parse boundary; unknown
  tokens drop with a `parseError` for one observer event.
- **Streaming is correctly applied** to every call whose output is large
  enough to risk a CF Workers ~125s subrequest idle timeout (Curator, Drafter
  main, Integrator, all three HTML interactive paths). The 2026-05-09
  Curator timeout incident is unlikely to recur.
- **Prompt caching is correctly applied** on the HTML Generator + HTML
  Auditor — the only prompts large + stable enough to benefit. Cache hit
  rates in production show 7–27 k cacheRead tokens against ~13 k cacheCreate.
- **Forward-looking framing** for the post-publish reflection / Zita
  synthesis / Learner heads is well-handled — the explicit "patterns
  extracted for tomorrow's Drafter" framing reads cleanly to readers in the
  drawer, rather than as a verdict on the piece they just finished.
- **Reference HTML inlined for HTML Generator** is a strong concrete
  template; one of the higher-leverage prompt design choices in the system.

### Where the surface is fragile

- **Voice Auditor's hand-coded scoring rubric** (`-10`, `-15`, `-20`) is a
  hidden contract. It's not in any markdown file; it's not in any thresholds
  module; editing it requires editing `voice-auditor-prompt.ts`. It produces
  the score `passed: boolean (score >= 85)` gate fires on. Worth treating as
  a contract-shaped artefact.
- **Structure Editor's 9-rule inline checklist** restates literal values
  from the beat contract. Drift between the prompt and the contract is
  silent — no codegen check.
- **Interactive HTML Generator's "Sandbox compatibility" section**
  duplicates the contract's HTML validator constraints in different prose.
  Same drift shape as the Structure Editor.
- **Three Learner heads have no contract injection at all.** All English
  lives in `learner-prompt.ts`. The prompts are good, but they sit outside
  the contract programme and they don't import voice rules — meaning the
  Learner could in principle write a learning that *itself* uses tribe
  words, with no auditor in the loop.
- **Zita lives at the call site.** Voice rules drift from canonical. The
  prompt is at the top of `chat.ts` rather than in `*-prompt.ts`. No
  contract injection.
- **Mainline LLM calls discard `response.usage`.** Curator, Drafter main,
  three auditors, Integrator, and the producer-side Learner head all drop
  token counts on the floor. The 2026-05-09 35 k-input regression was
  diagnosed via Anthropic's console UI. Token telemetry is the lowest layer
  of observability and we mostly don't have it for the expensive calls.

### Highest-impact improvements (ranked)

1. **Capture `response.usage` on every mainline call and persist via
   `observer.logCallMetered`.** Minimal code change (capture + threading
   through Director's existing log helpers; no schema change needed,
   `pipeline_log.data` is JSON). Would have caught the 2026-05-09 Curator
   bloat in D1, not in Anthropic console. Highest leverage relative to
   effort.

2. **Promote the Voice Auditor's hand-coded penalty rubric to a contract.**
   Either move the `-10/-15/-20` table into `content/voice-contract.md`
   (alongside the non-negotiables), with the prompt becoming a thin
   `${VOICE_CONTRACT}` injection — same posture as the other auditors. Or
   move it into `content/audit-contract.md` as a "voice scoring rubric"
   section. Closes the hidden-contract gap.

3. **Extract the Structure Editor's 9-rule checklist into the beat
   contract** (with literal values like `900–1100`, `5–8`, `200 words`
   centralised in one place). Same drift fix — would mean
   `structure-editor-prompt.ts` becomes a thin `${BEAT_CONTRACT}` injection
   with no inline rule restatement.

4. **Inject `${VOICE_CONTRACT}` into Zita's system prompt** (and lift the
   Zita prompt out of `chat.ts` into a `src/lib/zita-prompt.ts`). Closes
   the largest user-facing voice drift in the system. The 8-rule numbered
   list can stay as inline framing; only the canonical voice rules need to
   come from the contract.

5. **Redesign or delete `Learner.analyseAndLearn`.** It's the lowest-context
   LLM call in the codebase — a one-row metric snapshot in, "actionable
   learnings" out. Either fold it into `analysePiecePostPublish` (which has
   far richer context) or delete the engagement-trigger path entirely.

6. **Deduplicate the Interactive HTML Generator's sandbox spec.** The inline
   "Sandbox compatibility" section duplicates the contract's HTML validator
   constraints. The prompt could trust the contract injection and drop the
   inline copy.

7. **Telemetry pass on `max_tokens` ceilings.** Voice Auditor at 2000 vs.
   ~400 chars typical output, Structure Editor at 2000 vs. ~100 chars typical,
   Categoriser at 1500 vs. 100–200 token output — these ceilings are
   safety-margin generous but no observation stream confirms they're never
   hit. A one-time check across the prod log would either confirm headroom
   or flag a tightening opportunity.

8. **Failure-token enum drift watch.** The fact-checker `unknown` token in
   the recent observer event log is the system working as designed — the
   parser caught Claude's drift. But there's no queue / dashboard surfacing
   the drift rate over time. A weekly query against
   `audit_results.failure_reasons LIKE '%unknown%'` (one of the operator
   queries in `scripts/audit-failure-reasons-health.sql`) is the sensor;
   an alert at >1 in 30 audits closes the loop.

9. **Document the Voice Auditor's penalty model alongside its score.** Even
   if the penalties stay in the prompt, capturing them in a table inside
   `audit-contract.md` makes the score explainable — "the piece dropped from
   95 to 92 because Claude detected one new tribe word, and that's a -10
   instance the model rounded into the score". Audit results would become
   reverse-engineerable from the violations array, which is currently a
   guess.

10. **Per-call prompt-content ownership comment.** Adopt a one-line standard
    at the top of every `*-prompt.ts` file noting which `content/*.md`
    contracts this file injects, plus a list of any inline rule bodies that
    aren't in a contract. The `categoriser-prompt.ts` doc-comment is the
    closest existing example — extend the convention everywhere.

None of these are urgent in the sense of a current incident. The
2026-05-09 Curator timeout is fixed; the closed-enum drift is silent so far;
the Voice Auditor's score behaviour produced exactly one weird episode (the
magic-mushroom 95→92→95) and the Integrator-regression-awareness fix
(Task 09) addressed the symptom. But the structural improvements above would
collectively lower the floor — the next regression of similar shape would
be diagnosable in D1 instead of Anthropic console, and the next prompt-rule
edit would land in markdown without the operator wondering whether a hidden
TypeScript number is silently overriding it.

---

## Status — improvements 1-7 shipped 2026-05-10

The seven ranked priorities at the top of this section all landed across one
day's work on 2026-05-10. Each shipped as its own PR; each was reviewed
against the audit's predicted signal before merge. PR table:

| # | Priority | PR | Outcome |
|---|---|---|---|
| 1 | Curator input trim (cap 80→24, summary 250→150, hard-skip window 30→14) | [#32](https://github.com/zzeeshann/daylila/pull/32) | Curator input 27k → 11.7k (−58%); latency 141.8s → 71.8s (−49%); pick quality strong on the 2026-05-10 fossil piece (voice 95). |
| 2 | Token capture on every mainline call via `observer.logLLMCall` | [#31](https://github.com/zzeeshann/daylila/pull/31) | Six per-call meter rows on every pipeline run; verified honest against Anthropic console (Curator measured 27,593 in / 5,271 out within 2% of console reading). |
| 3 | Contract simplification (curator + categoriser + fact-check) | [#35](https://github.com/zzeeshann/daylila/pull/35) | Codegen bundle 101477 → 87516 bytes (−13.7%). Operator-orientation moved to `docs/`; model-orientation stays in `content/`. Per-call savings ~820 + ~770 + ~550 tokens. |
| 4 | Voice Auditor penalty rubric move | [#33](https://github.com/zzeeshann/daylila/pull/33) | `-10/-15/-20` rubric promoted to `audit-contract.md`; Voice Auditor becomes the first prompt-reader of AUDIT_CONTRACT. Path B chosen over path A after multi-reader gate caught the "measure becomes target" risk in `voice-contract.md`. |
| 5 | Structure Editor + HTML Generator drift cleanup | [#34](https://github.com/zzeeshann/daylila/pull/34) | Structure Editor's 9-bullet checklist + 7-token enum dropped (both already in beat-contract.md and audit-contract.md). HTML Generator's "Sandbox compatibility" section dropped (already in interactive-contract.md). Two dead imports + a re-export removed. |
| 6 | Zita prompt lift + `${VOICE_CONTRACT}` injection | [#37](https://github.com/zzeeshann/daylila/pull/37) | Lifted to `src/lib/zita-prompt.ts`; voice contract injected via Vite `?raw`. Site worker becomes a contract reader for the first time. Pre-flight verified `astro build` resolves the `?raw` import before commit per the locked rule. |
| 7 | `LearnerAgent.analyseAndLearn` flagged unreachable | [#36](https://github.com/zzeeshann/daylila/pull/36) | One-line comment above the function — zero callers confirmed; option (a) merging into `analysePiecePostPublish` deferred until token-capture data shows whether engagement-driven analysis produces useful learnings. |

**Posture that emerged from the work.**

- Contracts hold model-orientation only. Operator-orientation lives in `docs/AGENTS.md`, `docs/SCHEMA.md`, `docs/DECISIONS.md`, and git history. (Established in priority 3; future contract changes should keep the audience separation.)
- AUDIT_CONTRACT becomes the home for enforcement vocabulary — penalty rubrics + failure_reasons enums — because that vocabulary should be visible to judges (auditors) but not to writers (Drafter / Integrator / InteractiveGenerator). (Established in priority 4; reinforced by priority 5.)
- The site worker can read a contract via Vite's `?raw` when only one site-side reader exists. If a second appears, revisit and consider codegen. (Established in priority 6.)

**What stays deferred** (items 8, 9, 10 from the audit's ranked list, plus items the audit didn't surface):

- **`max_tokens` ceilings audit** (item 7 in the ranked list — re-numbered to a deferred item). A one-time check across the prod log to confirm headroom or flag tightening opportunities. Now that the priority-2 meter persists `tokensOut` on every call, the audit becomes a single SQL query: `SELECT title, MAX(json_extract(context, '$.tokensOut')) FROM observer_events WHERE title LIKE 'LLM %' GROUP BY title;`. Defer until ~30 days of meter data accrue.
- **Failure-token enum drift watch** (item 8). Operator query already exists at `scripts/audit-failure-reasons-health.sql`. Needs an alert wired in — defer until either the rate exceeds the silent-noise threshold OR a regression makes it visible.
- **Per-file ownership comments** (item 10). One-line standard at the top of every `*-prompt.ts` file listing the contracts it injects + any inline rule bodies that aren't in a contract. After priorities 4 + 5 + 6 the `voice-auditor-prompt.ts` / `structure-editor-prompt.ts` / `zita-prompt.ts` headers do this implicitly via their doc-comments. Could be formalised as a convention; not blocking anything.

All three are bounded by available data (item 7), missing alerting infrastructure (item 8), or low marginal value (item 10). None are blocking.

The next round of LLM-surface work begins when one of three triggers fires:

1. A meter row shows a regression that wasn't caught by the audit posture.
2. A new agent or call site enters the system and needs prompt structure.
3. Operator priorities shift — a different concern (cost, latency, quality) becomes the primary lens.

Audit closed.
