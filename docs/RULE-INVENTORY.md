# Rule Inventory

**Status:** Living. Produced 2026-05-03 as Task 01 of the Foundation Fix programme. Successor to the duplication map in `docs/FOLLOWUPS.md` → `[open] 2026-04-30 (last): Centralise contracts`.

**Purpose:** One row per rule that controls how an agent or validator behaves. Pass 1 verified the existing FOLLOWUPS map; Pass 2 walked the rest of `agents/src/`, `src/lib/`, `agents/scripts/`, and `migrations/` to fill gaps. The map is the prerequisite for Task 02 (extract rules into `.md` contract files).

A rule, for this inventory, is: a numeric threshold, a structural spec, a behavioural rubric, a format constraint, a voice/style rule, a validator spec, or a magic number that encodes one of those. Implementation details (caching, retry policy, timeout values), schema column types, and infrastructure config are excluded.

Every cited line number was verified against the working tree at commit `9861805` on 2026-05-03.

---

## Voice and tone

### Rule: Voice contract (full body)

- **What it says:** the canonical Daylila voice rules — Plain English, no tribe words, short sentences, specific beats general, no flattery, trust the reader; lesson-structure section duplicates beat / hook / close rules at the bottom; ends with the editor's read-aloud test.
- **Where defined:** `content/voice-contract.md` (canonical, 48 lines). At build time, `agents/scripts/codegen-contracts.mjs` writes it as `VOICE_CONTRACT` into `agents/src/shared/generated/contracts.ts`. Embedded into prompts at `agents/src/voice-auditor-prompt.ts:13`, `agents/src/interactive-generator-prompt.ts:124` and `:445`, `agents/src/interactive-auditor-prompt.ts:48` and `:229`, plus injected via builder at `agents/src/drafter.ts:91` and `agents/src/integrator.ts:58`.
- **Type:** voice
- **Used by:** Drafter, Voice Auditor, Integrator, Interactive Generator (quiz + html paths), Interactive Auditor (quiz + html paths)
- **Duplicated:** **RESOLVED 2026-05-03 (Foundation Fix Task 02 Phase A — codegen).** The manual `agents/src/shared/voice-contract.ts` mirror is deleted; the canonical `.md` is the single source of truth at build time. Five prompt files still embed the contract verbatim (`${VOICE_CONTRACT}`) — that's correct: the agent needs the rule in-prompt to enforce it, and all five embeds now read the same generated source.
- **Notes:** Tier 1 row 1 of the FOLLOWUPS map. RESOLVED.

### Rule: Tribe-word ban list

- **What it says:** never use mindfulness, journey, empower, transform, wellness, unlock, dive in, embrace, lean into, unpack, holistic, optimize, hack (verb), curate (when "choose" works), intentional (when "deliberate" works).
- **Where defined:** `content/voice-contract.md:21` (canonical body of the contract); inherited by every embed site listed above. Voice Auditor enforces with `-10 per instance` deduction at `agents/src/voice-auditor-prompt.ts:23`.
- **Type:** voice
- **Used by:** every agent that loads `VOICE_CONTRACT`; Voice Auditor scores it.
- **Duplicated:** no — single source inside the contract body. (The deduction value lives only in the Voice Auditor prompt.)
- **Notes:** Inventory pass found no third-party use of this list outside the contract. Single-source within voice cluster.

### Rule: Voice Auditor scoring deductions

- **What it says:** tribe word -10 each, flattery -15, jargon without translation -10, long padded sentence -5 each, "in this lesson we'll learn" opening -20, summary/CTA/congratulations close -15.
- **Where defined:** `agents/src/voice-auditor-prompt.ts:22-29` (single site).
- **Type:** rubric
- **Used by:** VoiceAuditorAgent only.
- **Duplicated:** no.
- **Notes:** Hand-tuned scoring math; not surfaced anywhere else (the contract names the rules; the rubric scores them).

### Rule: Voice score pass threshold (≥85)

- **What it says:** a draft passes the voice gate when the auditor score is 85 or higher; below 85 triggers a revision round.
- **Where defined:** **RESOLVED 2026-05-06 (Foundation Fix Task 02 — audit-thresholds cluster extraction).** Canonical at `content/audit-contract.md`; runtime value `VOICE_PASS_THRESHOLD = 85` exported from `agents/src/shared/audit-thresholds.ts` (agents) and `src/lib/audit-thresholds.ts` (site-side mirror, same shape as cadence.ts ↔ admin-settings.ts). All four prior sites now import: `voice-auditor-prompt.ts:27` (interpolated as `${VOICE_PASS_THRESHOLD}` in JSON spec line), `voice-auditor.ts:39`, `audit-tier.ts:16` (via site mirror), `interactive-auditor-prompt.ts:24` (`INTERACTIVE_VOICE_MIN_SCORE = VOICE_PASS_THRESHOLD` alias preserved for in-file readability).
- **Type:** threshold (magic number)
- **Used by:** Voice Auditor (pass gate), Director (revision loop), audit-tier display, Interactive Auditor.
- **Duplicated:** RESOLVED. Single source in `content/audit-contract.md`; named TS constant in two parallel worker mirrors (cross-worker mirror pattern, intentional).
- **Notes:** Tier 3 threshold from the original FOLLOWUPS map. RESOLVED.

### Rule: Audit-tier thresholds (polished / solid / rough)

- **What it says:** voiceScore ≥85 → polished; 70-84 → solid; <70 → rough. Missing voiceScore + qualityFlag='low' → rough; missing voiceScore + no flag → polished.
- **Where defined:** **RESOLVED 2026-05-06** — canonical at `content/audit-contract.md`; runtime constants `VOICE_PASS_THRESHOLD = 85` and `TIER_SOLID_FLOOR = 70` exported from `src/lib/audit-thresholds.ts` (site-side mirror) and consumed by `src/lib/audit-tier.ts`.
- **Type:** threshold
- **Used by:** every public-facing piece's metadata line (derived at render time).
- **Duplicated:** RESOLVED. Single source + cross-worker mirror (intentional, same shape as cadence.ts ↔ admin-settings.ts).
- **Notes:** RESOLVED. The 70 floor was the only enforcement until extraction; the 85 ceiling now shares the named constant with the voice gate.

---

## Beat structure and piece shape

### Rule: 1000–1500 words across all beats

- **What it says:** total piece length sits between 1000 and 1500 words.
- **Where defined:** **RESOLVED 2026-05-04 (Foundation Fix Task 02 — beats cluster extraction).** Canonical at `content/beat-contract.md`; codegenned into `BEAT_CONTRACT` in `agents/src/shared/generated/contracts.ts`; injected via `${BEAT_CONTRACT}` at `agents/src/drafter-prompt.ts:19`, `agents/src/structure-editor-prompt.ts:13`, and `agents/src/integrator-prompt.ts:18`. Structure-editor still surfaces the value inline at `:20` as an audit threshold ("Total word count outside 1000–1500"). Curator-prompt.ts:63 retains the value-reference inline mention inside the DEPTH POTENTIAL criterion (documented residual; Curator does not enforce the rule).
- **Type:** structural (numeric range)
- **Used by:** Drafter (writes to it), Structure Editor (gates on it), Integrator (revises against it), Curator (uses for depth judgment), Voice Auditor + Interactive surfaces (no longer see it after voice-contract section 3 was moved out — they don't enforce it).
- **Duplicated:** RESOLVED. Single source in `content/beat-contract.md`; one auto-generated mirror in `contracts.ts`; intentional audit-threshold value at `structure-editor-prompt.ts:20`; documented Curator residual at `curator-prompt.ts:63`.
- **Notes:** Tier 1 row 2 of the FOLLOWUPS map. RESOLVED.

### Rule: Target 5–6 beats per piece (3–6 acceptable; 7+ is padding)

- **What it says:** target 5–6 beats; 3–6 acceptable; 7+ is the padding zone.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`; injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor surfaces the value inline at `:21` as an audit threshold ("Beat count outside 3–6, or in the 7+ padding zone").
- **Type:** structural (numeric range)
- **Used by:** Drafter, Structure Editor, Integrator.
- **Duplicated:** RESOLVED. Single source + auto-mirror + intentional audit-threshold value.
- **Notes:** Tier 1 row 3 of the FOLLOWUPS map. RESOLVED.

### Rule: Hook format (one screen, observation first, question follows)

- **What it says:** open the hook with the observation that creates the question, then let the question follow. No "in this lesson we'll learn…" openings.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`; injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor item 3 references the rule with audit-context phrasing. Voice-auditor's `-20` deduction at `voice-auditor-prompt.ts:20` for "In this lesson we'll learn…" openings is the auditor's own scoring math (separate from the beat rule).
- **Type:** structural (rubric)
- **Used by:** Drafter, Structure Editor, Integrator.
- **Duplicated:** RESOLVED.
- **Notes:** Tier 1 row 5 of the FOLLOWUPS map. RESOLVED.

### Rule: ONE idea per teaching beat; specific observation, not definition

- **What it says:** each teaching beat carries one idea, opens with a specific observation (fact, moment, number) — never a definition or generalisation.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`; injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor item 4 references the rule with audit-context phrasing.
- **Type:** structural (rubric)
- **Used by:** Drafter, Structure Editor, Integrator.
- **Duplicated:** RESOLVED.
- **Notes:** Tier 1 row 4 of the FOLLOWUPS map. RESOLVED.

### Rule: Close format (1–4 sentences, no summary/CTA/congratulations)

- **What it says:** close is 1–4 sentences; length is whatever lands; no summary, no call-to-action, no congratulations.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`; injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor item 5 references the rule with audit-context phrasing. Voice-auditor's `-15` deduction for "summary/CTA/congratulations close" at `voice-auditor-prompt.ts:21` is the auditor's own scoring math (separate from the beat rule).
- **Type:** structural (rubric)
- **Used by:** Drafter, Structure Editor, Integrator.
- **Duplicated:** RESOLVED. (Loosened on 2026-04-30 from "ONE sentence" to "one to four sentences" across all surfaces — see DECISIONS.)
- **Notes:** Tier 1 row 6 of the FOLLOWUPS map. RESOLVED.

### Rule: No JSX tags; use `## kebab-case` headings

- **What it says:** beats are demarcated by `## kebab-case` markdown headings only; no `<lesson-shell>` / `<lesson-beat>` / `<beat>` / `<section>` JSX tags. The build step wraps headings into Web Components automatically; the audio producer also splits on `## `.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md` ("No JSX tags" subsection); injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor item 6 references the rule with audit-context phrasing.
- **Type:** format
- **Used by:** Drafter, Structure Editor, Integrator, downstream rehype + audio producer (consumers, not enforcers).
- **Duplicated:** RESOLVED.
- **Notes:** Tier 1 row 8 of the FOLLOWUPS map. RESOLVED.

### Rule: MDX frontmatter required fields

- **What it says:** every published piece's MDX frontmatter must include `title`, `date`, `newsSource`, `underlyingSubject`, `estimatedTime`, `beatCount`, `description`.
- **Where defined:** **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md` ("Required frontmatter" subsection); injected via `${BEAT_CONTRACT}` at Drafter, Structure Editor, and Integrator. Structure-editor item 7 keeps the comma-separated field list inline as an audit reference (intentional Tier-2 paraphrase per Q6.b: write-context uses backticked markdown, audit-context uses comma list).
- **Type:** format
- **Used by:** Drafter (writes them), Structure Editor (gates on them), Integrator (revises them), content collection, render-time pages.
- **Duplicated:** RESOLVED. Single source + auto-mirror + intentional audit-context paraphrase.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: SEO meta-description (140–160 chars, must differ from title, names underlying concept)

- **What it says:** the `description` frontmatter field is 140–160 chars, must not repeat the title verbatim, must name the underlying concept (not just the news event), follows the voice contract.
- **Where defined:** **RESOLVED 2026-05-04** — relocated to `content/beat-contract.md` ("SEO meta-description" subsection) as part of the beats-cluster extraction. Still single-source: only `BEAT_CONTRACT` carries it.
- **Type:** format
- **Used by:** Drafter (writer); rendered as `<meta name="description">` at site render time. Structure Editor + Integrator now also see the rule via `${BEAT_CONTRACT}` injection but don't enforce content beyond the frontmatter-presence check.
- **Duplicated:** no — single source.
- **Notes:** Pass 2 addition. Was code-prose; now lives in `.md`. RESOLVED.

### Rule: Drafter beat-frontmatter `beatCount` can drift from actual `##` count

- **What it says:** Drafter declares `beatCount` in frontmatter; actual `##` count in body is the source of truth at render time. Documented as a known gap in `CLAUDE.md` "Remaining minor items".
- **Where defined:** `src/lib/rehype-beats.ts` derives the truthful count; `agents/src/drafter-prompt.ts:47` requires the (potentially-drifting) frontmatter field.
- **Type:** structural
- **Used by:** rehype renderer (truth), Drafter (claim).
- **Duplicated:** yes by design — render-time truth vs. authoring claim. They can disagree.
- **Notes:** Open item. Not strictly a rule that "controls behaviour" but listed because Task 02 may want to drop the frontmatter field and derive at render.

---

## Quiz / interactive shape

### Rule: Quiz question count (3–5 inclusive)

- **What it says:** a quiz has 3 to 5 questions, inclusive.
- **Where defined:** `agents/src/interactive-generator-prompt.ts:51-52` (`QUIZ_MIN_QUESTIONS = 3`, `QUIZ_MAX_QUESTIONS = 5`); injected into prompt prose at `:115` and `:193` (`${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS}`); enforced at `agents/src/interactive-generator.ts:1642-1644` (`validateQuiz` rejects out-of-range counts).
- **Type:** threshold
- **Used by:** Interactive Generator (writer + validator).
- **Duplicated:** no — properly injected via constant template literals everywhere; the FOLLOWUPS map's claim of "Hardcoded as `3–5` in prompt prose" is **RESOLVED** (the prompt was reworked to use `${...}` injection). Single-source rule now.
- **Notes:** Tier 3 row 1 of the FOLLOWUPS map. RESOLVED — moved from drift-risk to single-source.

### Rule: Quiz / interactive 4 audit dimensions + thresholds

- **What it says:** quizzes and HTML interactives are scored on four dimensions — voice, structure, essence, factual — and pass overall iff all four pass at their per-dimension thresholds.
- **Where defined:** `agents/src/interactive-auditor-prompt.ts:23-32` (constants: `INTERACTIVE_VOICE_MIN_SCORE = 85`; `INTERACTIVE_HTML_STRUCTURE_MIN_SCORE`, `INTERACTIVE_HTML_ESSENCE_MIN_SCORE`, `INTERACTIVE_HTML_FACTUAL_MIN_SCORE = 75` each); injected into prompt prose at `:44`, `:225`, `:242`, `:265`, `:304`, `:326`. Enforced in `agents/src/interactive-auditor.ts:181`, `:279`, `:285`, `:291`, `:297`.
- **Type:** threshold
- **Used by:** Interactive Auditor (quiz + HTML paths), Interactive Generator (revise loop reads pass/fail).
- **Duplicated:** no — properly injected via constants everywhere. Single-source rule.
- **Notes:** Tier 3 row 3 of the FOLLOWUPS map. RESOLVED.

### Rule: Interactive max revision rounds (3)

- **What it says:** the produce → audit → revise loop runs up to 3 rounds before shipping with `qualityFlag='low'`.
- **Where defined:** `agents/src/interactive-generator.ts:38` (`INTERACTIVE_MAX_ROUNDS = 3`); used at `:563` and `:857` (quiz + HTML loops). The constant's docstring at `:36-37` explicitly says *"Matches the daily-piece auditor loop's MAX_REVISIONS. 3 rounds = 1 initial + 2 revisions."*
- **Type:** threshold
- **Used by:** Interactive Generator only.
- **Duplicated:** no within Interactive Generator. **Same numeric value as the daily-piece `MAX_REVISIONS = 3` at `agents/src/director.ts:23`** — same rule shape, two separate constants, with the duplication intentional and documented in the comment. Worth noting for Task 02.
- **Notes:** Pass 2 addition.

### Rule: Essence-not-reference (six prohibitions for interactives)

- **What it says:** interactive HTML and quiz copy must not name proper nouns / specific dates / quoted phrases / "according to" phrasing / piece-specific numbers / industry labels recognisable as the piece's industry.
- **Where defined:** **RESOLVED 2026-05-05 (Foundation Fix Task 02 — interactive cluster extraction).** Canonical at `content/interactive-contract.md` ("Hard prohibitions" section, six numbered rules); codegenned into `INTERACTIVE_CONTRACT` in `agents/src/shared/generated/contracts.ts`; injected via `${INTERACTIVE_CONTRACT}` at `interactive-generator-prompt.ts` (both quiz and HTML system prompts) and `interactive-auditor-prompt.ts` (both quiz and HTML auditor prompts). The auditor prompts retain inline audit-context paraphrases of the six rules in their Essence dimension's "REFERENCE LEAK" sub-list (intentional Tier-2 audit-context paraphrase per beats Q6) — the lead-in references the contract as the canonical source. The quiz generator retains a 7th quiz-specific anti-pattern inline ("'Which of the following best describes what happened in…'") — quizzes have stems, HTML doesn't, so it's path-specific not cluster-wide. `docs/INTERACTIVES.md` mirrors the list for spec-doc readability with a "since 2026-05-05" pointer.
- **Type:** rubric
- **Used by:** Interactive Generator (writer), Interactive Auditor (gate).
- **Duplicated:** RESOLVED. Single source in `content/interactive-contract.md`; one auto-generated mirror in `contracts.ts`; intentional audit-context paraphrases in the auditor prompts; intentional spec-doc mirror in INTERACTIVES.md.
- **Notes:** Tier 1 row 7 of the FOLLOWUPS map. RESOLVED.

### Rule: Plain-English split for quizzes

- **What it says:** the precise concept name belongs in `title` and `concept` only; questions, options, and explanations use everyday words a curious 14-year-old reads cleanly on first pass. Translation list of common offending concept-jargon (asymmetry, coordination, mitigation, throughput, allocation, displacement, propagation, restraint, structural, mechanism, aggregate, threshold, trade-off).
- **Where defined:** **RESOLVED 2026-05-05** — extracted to `content/interactive-contract.md` ("Plain English split rule" section with the 13-word translation list + 14-year-old test as scoring anchor + hedge-phrase ban). Codegenned into `INTERACTIVE_CONTRACT`; injected at the same four prompt sites as the essence rule. `agents/scripts/verify-interactive-voice.mjs` JS heuristic now mirrors the contract (header comment updated 2026-05-05; same hand-sync convention as `verify-categoriser-floor.mjs`). `book/09-the-sixteen-roles.md` paragraph still carries the narrative phrasing — kept as narrative, with a "since 2026-05-05 the rule lives in the contract" pointer added in the same commit. `docs/INTERACTIVES.md:428` similarly mirrors the prose for spec-doc readability with a contract pointer.
- **Type:** rubric
- **Used by:** Interactive Generator, Interactive Auditor, public book chapter, regression verifier, INTERACTIVES spec doc.
- **Duplicated:** RESOLVED. Single source + auto-mirror + intentional verifier hand-sync (per documented convention) + intentional book narrative + intentional spec-doc mirror.
- **Notes:** Tier 2 row 1 of the FOLLOWUPS map. RESOLVED. The 14-year-old test (Tier 2 row 2) is folded into this rule.

### Rule: Manipulation embodies the mechanism (HTML essence)

- **What it says:** the mechanism of change in an HTML interactive must mirror the mechanism of the underlying concept (slider's effect compresses when capacity is reduced, etc.).
- **Where defined:** **RESOLVED 2026-05-05** — extracted to `content/interactive-contract.md` ("HTML interactive shape" section, the eighth rule). Codegenned into `INTERACTIVE_CONTRACT`; injected at `interactive-generator-prompt.ts` HTML path and `interactive-auditor-prompt.ts` HTML auditor. The HTML auditor's Essence dimension retains an inline audit-context paraphrase ("Per the interactive contract, manipulation embodies the mechanism…") because the auditor needs the rule named at scoring time. `docs/INTERACTIVES.md:462` mirrors the prose for spec-doc readability with a contract pointer.
- **Type:** rubric
- **Used by:** Interactive Generator (HTML path), Interactive Auditor (HTML path), INTERACTIVES spec doc.
- **Duplicated:** RESOLVED. Single source + auto-mirror + intentional audit-context paraphrase + intentional spec-doc mirror.
- **Notes:** Tier 2 row 3 of the FOLLOWUPS map. RESOLVED.

### Rule: HTML interactive validator — eight rule IDs

- **What it says:** every HTML interactive is checked against eight stable rules pre-audit: `size-cap`, `storage-api`, `dynamic-code`, `external-script-allowlist`, `network-call`, `nested-iframe`, `form-element`, `unsafe-url-scheme`. The validator is the source of truth for the size cap and the external-script allowlist; the prompt imports those constants rather than redefining them.
- **Where defined:** `agents/src/interactive-validator.ts:32-40` (RuleId union); rule logic in the rest of the file. Allowlist regex set at `:70`.
- **Type:** validator
- **Used by:** Interactive Generator (pre-commit gate), Interactive Auditor (told the file passed; doesn't re-run).
- **Duplicated:** no — single source per `interactive-validator.ts:23-27` header.
- **Notes:** Spec lives at `docs/INTERACTIVES.md` "Validator rules". Pass 2 addition.

### Rule: Categoriser max assignments (1–3 per piece)

- **What it says:** every piece lands in 1–3 categories. Empty assignments array is never valid.
- **Where defined:** **RESOLVED 2026-05-10** — extracted to `content/categoriser-contract.md` ("What gets assigned" section). Codegenned into `CATEGORISER_CONTRACT`; injected at `agents/src/categoriser-prompt.ts` system prompt. Runtime value `CATEGORISER_MAX_ASSIGNMENTS = 3` exported from `agents/src/shared/categoriser-thresholds.ts`; enforced at `agents/src/categoriser.ts:454` (slice cap). Foundation Fix Task 02 eighth extraction session.
- **Type:** threshold
- **Used by:** Categoriser only.
- **Duplicated:** RESOLVED. Single shared constant; rule body in canonical contract.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Categoriser confidence floors (75 reuse / 60 stretch)

- **What it says:** existing-category assignments at confidence ≥75 are ideal reuse; 60–74 is stretch reuse with required reasoning naming what's stretchy; <60 is rejected by the writer (triggers retry → fallback).
- **Where defined:** **RESOLVED 2026-05-10** — extracted to `content/categoriser-contract.md` ("Tiered decision" section). Codegenned into `CATEGORISER_CONTRACT`; injected at `agents/src/categoriser-prompt.ts` system prompt. Runtime values `CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75` and `CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60` exported from `agents/src/shared/categoriser-thresholds.ts`; the `60` floor enforced at `agents/src/categoriser.ts:459`. Foundation Fix Task 02 eighth extraction session.
- **Type:** threshold
- **Used by:** Categoriser (prompt + writer).
- **Duplicated:** RESOLVED. Single shared constants; rule body in canonical contract. The retry-message inline `60` and `74` literals at `categoriser-prompt.ts:163,166` stay hand-synced (codegen JSON.stringify's the markdown verbatim, so template-literal interpolations in the inline retry string would never reach Claude — same shape as fact-check's retry context).
- **Notes:** Tier 3 row 2 of the FOLLOWUPS map. RESOLVED.

### Rule: Categoriser fallback slug (`patterns-yet-to-cluster`)

- **What it says:** when both Claude attempts return zero valid assignments, the piece is assigned to a reserved fallback category. Hidden from the public library chip bar AND filtered from the Categoriser context list.
- **Where defined:** **RESOLVED 2026-05-10** — extracted to `content/categoriser-contract.md` ("The fallback path" section). Runtime value `CATEGORISER_FALLBACK_SLUG = 'patterns-yet-to-cluster'` exported from `agents/src/shared/categoriser-thresholds.ts` (agents-side canonical); site-side mirror `FALLBACK_SLUG` exported from `src/lib/categoriser-thresholds.ts` and re-exported via `src/lib/categories.ts:26` for back-compat. Both literal SQL strings replaced with bound parameters: `agents/src/director.ts:1697` (uses `CATEGORISER_FALLBACK_SLUG`); `src/pages/api/daily/[date]/made.ts:324` (uses `FALLBACK_SLUG`). Migration 0027's seed-row data literal stays as deliberate non-change (SQL migrations cannot import TS constants; idempotent INSERT OR IGNORE). Foundation Fix Task 02 eighth extraction session.
- **Type:** magic-number (reserved string)
- **Used by:** Categoriser (writer), Director (queries), made-drawer endpoint, library UI, account observation.
- **Duplicated:** RESOLVED. Two named constants on the two worker bundles (intentional cross-worker mirror — separate packages with no shared imports, same shape as the `cadence.ts` ↔ `admin-settings.ts` mirror); zero remaining literal SQL strings; migration 0027 seed row is data, not code use-site.
- **Notes:** Pass 2 addition. RESOLVED.

---

## Audit thresholds and gates

### Rule: Daily piece max revisions (3)

- **What it says:** Director runs the auditor → integrator loop up to 3 rounds; on round 3 fail, the piece ships with `qualityFlag='low'`.
- **Where defined:** **RESOLVED 2026-05-06** — canonical at `content/audit-contract.md`; runtime value `MAX_AUDIT_ROUNDS = 3` exported from `agents/src/shared/audit-thresholds.ts`; aliased to `MAX_REVISIONS` at `director.ts:17` import. Use-sites at `:327` and `:372` unchanged. Same constant imported by InteractiveGenerator (aliased there as `INTERACTIVE_MAX_ROUNDS`) — single source of truth for the rule that "interactive max-rounds matches daily-piece max-revisions" was previously stated as a docstring claim, now an import.
- **Type:** threshold
- **Used by:** Director (daily-piece loop), InteractiveGenerator (quiz + HTML loops).
- **Duplicated:** RESOLVED. Single shared constant; two named local aliases preserve readability.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Quality flag — `low` taxonomy

- **What it says:** `qualityFlag` is either `null` or the literal string `'low'`. `'low'` means "shipped on max-fail of the audit loop". Frontmatter splice + D1 column + render-time tier fallback all agree.
- **Where defined:** **RESOLVED 2026-05-06 (rule body)** — canonical English statement of the taxonomy + its trigger condition + the publish-anyway philosophy lives at `content/audit-contract.md`. TS type union sites (`audit-tier.ts:24`, `interactive-generator.ts:108/:162`, `observer.ts:481/:511`, `LessonLayout.astro:31/:67`, `content.config.ts:55/:129`) and setter sites (`director.ts:395`, `interactive-generator.ts:724/:1105`) and persist sites (`director.ts:483/:514`, `interactive-generator.ts:741/:780/:1135/:1173`) all left intentionally unchanged — the `'low'` literal at those sites IS the rule application, not duplication of the rule body. Cross-worker self-mirror, same shape as the slug normalisation pattern.
- **Type:** format (taxonomy)
- **Used by:** Director (writer), InteractiveGenerator (writer, both quiz + HTML paths), audit-tier (reader fallback), Observer (event types), Astro Zod schemas (write-side enforcement).
- **Duplicated:** RESOLVED (rule body). Type union sites self-mirror by sharing the `'low' | null` literal — no shared package across two worker bundles plus two Zod schemas.
- **Notes:** Pass 2 addition. RESOLVED. Documented in CLAUDE.md "Quality surfacing".

---

## Curator selection criteria

### Rule: Selection criteria order (5 numbered)

- **What it says:** Curator picks against five criteria in priority order — TEACHABILITY (find the underlying system), UNIVERSALITY (concept must travel), FRESHNESS, DEPTH POTENTIAL, NO TRIBAL FRAMING.
- **Where defined:** **RESOLVED 2026-05-08 (Foundation Fix Task 02 — curator cluster extraction).** Canonical at `content/curator-contract.md` ("Selection criteria" section); codegenned into `CURATOR_CONTRACT` in `agents/src/shared/generated/contracts.ts`; injected via `${CURATOR_CONTRACT}` into the Curator system prompt at `agents/src/curator-prompt.ts`.
- **Type:** rubric
- **Used by:** Curator only.
- **Duplicated:** RESOLVED. Single source.
- **Notes:** Pass 2 addition. Reframed 2026-04-25 around the Daylila Protocol; criterion 1 carries the 10-domain breadth taxonomy below. RESOLVED.

### Rule: 10-domain breadth taxonomy

- **What it says:** Curator considers ten domains (inner life, meaning and belief, expression, language and thought, science not as crisis, body and health, how humans live together, skills and craft, technology beyond crisis, time and place) plus worked pairings of news shapes that map into each.
- **Where defined:** **RESOLVED 2026-05-08** — extracted to `content/curator-contract.md` (sub-section under TEACHABILITY criterion in "Selection criteria").
- **Type:** rubric
- **Used by:** Curator only.
- **Duplicated:** RESOLVED. Single source.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Recent-category concentration soft skip (3+ in 30 days)

- **What it says:** if a candidate's underlying subject would land in a category already holding 3+ recent pieces (last 30 days), prefer a candidate that opens a thinner category — unless the news event genuinely demands the fuller category. Soft preference, not a hard skip.
- **Where defined:** **RESOLVED 2026-05-08** — canonical at `content/curator-contract.md` ("Recent-category concentration — soft preference" section). The 30-day data window is exported as `CURATOR_RECENT_WINDOW_DAYS = 30` from `agents/src/shared/curator-thresholds.ts` (agents-only — no site-side mirror); consumed at `director.ts:245` (`getRecentCategoryCounts(CURATOR_RECENT_WINDOW_DAYS)`). The "3+" threshold stays as inline prose in the contract (no programmatic consumer; only Claude reads it). `patterns-yet-to-cluster` is excluded from the count.
- **Type:** rubric (soft)
- **Used by:** Curator (read), Director (data source).
- **Duplicated:** RESOLVED. Single source for the rule body; the 30-day window self-mirrors via the named TS constant; the 3+ threshold lives once in the contract.
- **Notes:** Pass 2 addition. Diversity-tuned 2026-05-01. RESOLVED. The [observing] 2026-05-01 verification window (unblock 2026-05-08) is operator guidance for a future tuning decision, not part of this extraction — any unblock-tweak (tighten 3+ to 4+, list the 5 thinnest categories) now lands cleanly in the contract.

### Rule: SAME-EVENT and SAME-CONCEPT hard skips

- **What it says:** Curator MUST skip candidates that are about the same news event as a recent piece (different wire-service angles do not count as different stories), AND must skip candidates that teach the same underlying concept as a recent piece, even at a different event.
- **Where defined:** **RESOLVED 2026-05-08** — extracted to `content/curator-contract.md` ("SAME-EVENT and SAME-CONCEPT — hard skips" section, with the three worked examples preserved verbatim from the prior buildCuratorPrompt:139-142 location). The 30-day recent-pieces data window is `CURATOR_RECENT_WINDOW_DAYS = 30`; consumed at `director.ts:207` (`getRecentDailyPieces(CURATOR_RECENT_WINDOW_DAYS)`).
- **Type:** rubric (hard)
- **Used by:** Curator only. Defense-in-depth: hard pre-Curator filter at `agents/src/shared/dedup-headlines.ts` (separate cluster, mirrored by `verify-dedup.mjs`) removes near-duplicates BEFORE Curator sees them.
- **Duplicated:** RESOLVED. Single source.
- **Notes:** Pass 2 addition. RESOLVED. Recurrence-watch live at `[observing] 2026-04-27 (architectural fix)`.

### Rule: Curator skip output shape

- **What it says:** if Curator skips, it must return `{ skip: true, reason }` where `reason` names the specific candidate condition — never a category dismissal like "low-teachability" or "shallow".
- **Where defined:** **RESOLVED 2026-05-08** — extracted to `content/curator-contract.md` ("The skip output shape" section, with the JSON spec + "reason must NOT be a category dismissal" instruction + the "If you cannot name the specific condition, you have not earned the skip" closing). The system prompt at `curator-prompt.ts` retains a one-line response-format reminder pointing at the contract; the `parsed.skip` parser at `curator.ts:51` is a use-site of the shape, not duplication of the rule body.
- **Type:** format
- **Used by:** Curator only.
- **Duplicated:** RESOLVED. Single source for the rule body; the `'skip'` literal at curator.ts:51 self-mirrors as use-site.
- **Notes:** Pass 2 addition. RESOLVED.

---

## Fact-check verification rules

### Rule: Verdict taxonomy (`verified` / `unverified` / `incorrect`)

- **What it says:** every claim is one of three verdicts. `incorrect` requires direct contradicting evidence from web search; absence of evidence is `unverified`, never `incorrect`.
- **Where defined:** **RESOLVED 2026-05-07 (Foundation Fix Task 02 — fact-check cluster extraction).** Canonical at `content/fact-check-contract.md` ("The verdict taxonomy" section, with the asymmetry rule + pass condition); codegenned into `FACT_CHECK_CONTRACT` in `agents/src/shared/generated/contracts.ts`; injected via `${FACT_CHECK_CONTRACT}` into the Fact Checker system prompt at `agents/src/fact-checker-prompt.ts`. Six TS literal sites self-mirror the `'verified' | 'unverified' | 'incorrect'` union (intentional self-mirror per audit Q4 precedent on `qualityFlag`): `fact-checker.ts:55` type union, `fact-checker.ts:188` parser status validation, `director.ts:463` claimReviews splice filter, `integrator.ts:50` fact-issue feedback filter, `made-drawer.ts:594-597` status-to-CSS class mapping (with `'contested'` legacy alias preserved as render-side back-compat shim), `director.ts:1770` defensive `?? 'unverified'` fallback.
- **Type:** format (taxonomy)
- **Used by:** Fact Checker (writer), Director (splice + defensive fallback), Integrator (feedback filter), drawer renderer (status mapping), `daily_audit_claims` table.
- **Duplicated:** RESOLVED. Single source for the rule body; six TS literal sites self-mirror via the shared union — no shared package across two worker bundles.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Search-first for current-event claims

- **What it says:** for any claim with a specific name, date, number, or current-event reference, use the web_search tool BEFORE assigning a status. Do not rely on training data for current-event claims. General well-known science (e.g. "cortisol is a stress hormone") does not require a search.
- **Where defined:** **RESOLVED 2026-05-07** — extracted to `content/fact-check-contract.md` ("The web-search rule" section); injected via `${FACT_CHECK_CONTRACT}` at `agents/src/fact-checker-prompt.ts`.
- **Type:** rubric
- **Used by:** Fact Checker only.
- **Duplicated:** RESOLVED. Single source.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Web-search tool max_uses (8)

- **What it says:** Anthropic `web_search_20250305` server tool is invoked with `max_uses: 8` per fact-check call.
- **Where defined:** **RESOLVED 2026-05-07** — canonical at `content/fact-check-contract.md` ("The web-search budget" section); runtime value `WEB_SEARCH_MAX_USES = 8` exported from `agents/src/shared/fact-check-thresholds.ts`; consumed at `agents/src/fact-checker.ts:86` via import.
- **Type:** threshold (magic number)
- **Used by:** Fact Checker only.
- **Duplicated:** RESOLVED. Single source. No site-side mirror (the site does not call Anthropic's API).
- **Notes:** Pass 2 addition. RESOLVED. Tunable per FOLLOWUPS escalation note ("drop max_uses from 8 to 4 if cost runs >$30/month").

### Rule: Cutoff-confession phrase blacklist

- **What it says:** Fact Checker notes must never include phrasings that confess the model's training cutoff to readers — "speculative fiction", "knowledge cutoff", "as of my", "is set in 2026", "is hypothetical", "this is beyond". If web search returned nothing, write "Could not verify against current sources."
- **Where defined:** **RESOLVED 2026-05-07** — canonical at `content/fact-check-contract.md` ("Cutoff-confession ban" section, with both the longer illustrative phrasings and the canonical 5-substring filter list as data + the `'training data'` dropped rationale + the canonical replacement string). Writer-side rule travels via `${FACT_CHECK_CONTRACT}` injection at `agents/src/fact-checker-prompt.ts`. Cross-worker mirror via parallel TS constants: `agents/src/shared/fact-check-thresholds.ts` exports `CUTOFF_CONFESSION_PHRASES` (for surface completeness, per `TIER_SOLID_FLOOR` precedent — agents side has no programmatic consumer today); `src/lib/fact-check-thresholds.ts` exports `CUTOFF_CONFESSION_PHRASES` + `CUTOFF_CONFESSION_REPLACEMENT` (consumed by `made-drawer.ts:541-545` filter).
- **Type:** rubric (with render-time filter)
- **Used by:** Fact Checker (writer, via contract injection), made-drawer (filter, via TS import).
- **Duplicated:** RESOLVED. Single source in `content/fact-check-contract.md`; one auto-generated mirror in `contracts.ts`; cross-worker TS-constant mirror (parallel arrays on each side, same shape as cadence.ts ↔ admin-settings.ts and audit-thresholds ↔ audit-thresholds).
- **Notes:** Pass 2 addition. RESOLVED.

---

## Audio production rules

### Rule: ElevenLabs voice + model (Frederick Surrey, eleven_multilingual_v2, mp3_44100_96)

- **What it says:** every audio clip uses voice `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey), model `eleven_multilingual_v2`, output format `mp3_44100_96` (96 kbps).
- **Where defined:** **RESOLVED 2026-05-09** — canonical at `content/audio-contract.md` ("Voice, model, and output format" section, with the My Voices stability rationale + the multilingual model choice + the 96 kbps trade-off rationale). Runtime values via `AUDIO_VOICE_ID`, `AUDIO_MODEL_ID`, `AUDIO_OUTPUT_FORMAT` in `agents/src/shared/audio-thresholds.ts`. Audio Producer imports all three; persisted into `daily_piece_audio.voice_id` and `daily_piece_audio.model` for every produced row.
- **Type:** magic-number (reserved string)
- **Used by:** Audio Producer (writer, via TS-constant import). Site-side `made-drawer.ts:296,303` reads the persisted column values for friendly-label display, NOT a rule mirror — graceful fallback if values change.
- **Duplicated:** RESOLVED. Single source in `content/audio-contract.md`; one auto-generated mirror in `contracts.ts`; runtime values in `audio-thresholds.ts`. Site-side display lookups are not rule mirrors.
- **Notes:** Pass 2 addition. Voice ID added to "My Voices" so the ID is stable against shared-library removals (per code comment, now narrated in the contract). RESOLVED.

### Rule: Audio character cap (20,000 per piece)

- **What it says:** one piece cannot spend more than 20,000 characters of ElevenLabs budget. Sized for a 12-beat piece (~200 words/beat + headroom). Budget for a standard 4–6-beat piece is well under.
- **Where defined:** **RESOLVED 2026-05-09** — canonical at `content/audio-contract.md` ("Character cap — 20,000 per piece" section). Runtime value via `AUDIO_CHAR_CAP = 20_000` in `agents/src/shared/audio-thresholds.ts`. Audio Producer imports for the per-piece budget gate (throws `AudioBudgetExceededError` on overrun); Audio Auditor imports for defense-in-depth verification on persisted rows.
- **Type:** threshold
- **Used by:** Audio Producer + Audio Auditor (defense-in-depth duplicate consumer — closed in this extraction).
- **Duplicated:** RESOLVED. Was duplicated as `CHAR_CAP = 20_000` in audio-producer.ts:67 and audio-auditor.ts:40; both now import `AUDIO_CHAR_CAP`.
- **Notes:** Pass 2 addition. RESOLVED.

### Rule: Audio retry attempts (3)

- **What it says:** each ElevenLabs TTS call retries up to 3 times on transient failures. 4xx responses do not retry; 5xx + network errors do. 90-second per-attempt `AbortSignal.timeout`. 1s/2s exponential backoff between attempts.
- **Where defined:** **RESOLVED 2026-05-09** — canonical at `content/audio-contract.md` ("Retry policy — 3 attempts" section). Runtime value via `AUDIO_MAX_RETRIES = 3` in `agents/src/shared/audio-thresholds.ts`; Audio Producer imports at the loop bound + final-attempt rethrow. The 90-second timeout (single use-site at audio-producer.ts:319) stays inline alongside the fetch call — narrated in contract, not extracted as a constant.
- **Type:** threshold
- **Used by:** Audio Producer only.
- **Duplicated:** no — single-source code constant.
- **Notes:** Pass 2 addition. Retry policy is implementation, but the 3-attempt count itself is rule-shaped. RESOLVED.

### Rule: Per-call beats budget (default 2)

- **What it says:** each Audio Producer alarm cycle generates at most 2 new beats (default `maxBeats=2`). Director calls more rounds if needed; this bounds the per-invocation runtime to fit Cloudflare Worker CPU budgets (DO RPC ~30s wall-clock ceiling).
- **Where defined:** **RESOLVED 2026-05-09** — canonical at `content/audio-contract.md` ("Per-call beats budget — default 2" section). Runtime value via `AUDIO_BEATS_PER_CHUNK = 2` in `agents/src/shared/audio-thresholds.ts`. Audio Producer imports as the default `maxBeats` parameter; Director imports (aliased as `MAX_BEATS_PER_CHUNK` for in-file readability) as the call-site safety belt.
- **Type:** threshold
- **Used by:** Audio Producer + Director (call-site safety belt — closed in this extraction).
- **Duplicated:** RESOLVED. Was duplicated as the producer's `maxBeats: number = 2` default at audio-producer.ts:122 and Director's `MAX_BEATS_PER_CHUNK = 2` at director.ts:1296; both now import `AUDIO_BEATS_PER_CHUNK`.
- **Notes:** Pass 2 addition. Implementation-shaped but rule-encoding (controls how the producer paces work). Same shape as `MAX_AUDIT_ROUNDS` extraction in audit-thresholds Q3. RESOLVED.

---

## Scanner rules

### Rule: Per-feed candidate cap (6)

- **What it says:** each RSS feed contributes at most 6 candidates per scan. Lowered from 15 → 6 on 2026-05-01 alongside the feed-list expansion (17 feeds × 6 = 102 candidates pre-dedup).
- **Where defined:** `agents/src/scanner.ts:69` (`PER_FEED_CAP = 6`).
- **Type:** threshold
- **Used by:** Scanner only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

### Rule: Global candidate cap (80)

- **What it says:** at most 80 unique candidates are stored per scan and passed to Curator. Raised from 50 → 80 on 2026-05-01.
- **Where defined:** `agents/src/scanner.ts:76` (`GLOBAL_CAP = 80`).
- **Type:** threshold
- **Used by:** Scanner (writer), Curator (reader).
- **Duplicated:** no — single-source code constant. CLAUDE.md, AGENTS.md prose currently state "80" inline; check Task 02 whether to centralise the citation.
- **Notes:** Pass 2 addition. The Foundation Fix master plan flags that the original brief said 50; the system has grown past that.

---

## Cadence and gating

### Rule: `interval_hours` allowed values (divisors of 24)

- **What it says:** `admin_settings.interval_hours` must be one of `[1, 2, 3, 4, 6, 8, 12, 24]`. Non-divisors drift across days. Defensive parse falls back to `24` for any value outside the set.
- **Where defined:** `agents/src/shared/admin-settings.ts:45` (`ALLOWED_INTERVAL_HOURS`); `src/lib/cadence.ts:16` (same constant, second copy in the site worker package).
- **Type:** threshold (allowed-values set)
- **Used by:** Director (cron gate), admin settings API (POST validation), site cadence display.
- **Duplicated:** yes, 2 surfaces. Two separate worker packages with no shared imports; the site-side header at `cadence.ts:1-13` self-documents the constraint and names the parallel agents-side file.
- **Notes:** Pass 2 addition. Same shape as the voice-contract mirror — cross-worker drift risk; codegen would close it.

### Rule: Cron gate anchored to UTC hour 2

- **What it says:** Director's `dailyRun` fires when `((UTC_hour - 2 + 24) % interval_hours) === 0`. At `interval_hours=24` the pipeline fires once per day at 02:00 UTC.
- **Where defined:** `agents/src/director.ts` `dailyRun` method (cron gate); `src/lib/cadence.ts:55-71` `nextRunAtMs` (reverse computation for the public dashboard countdown — used the public dashboard subtitle, which has been retired but the helper remains).
- **Type:** structural (gating expression)
- **Used by:** Director, public-facing cadence helpers (limited remaining surface).
- **Duplicated:** the expression is encoded in two places — the gate (agents) and the inverse (site). Both read the same `interval_hours` setting.
- **Notes:** Pass 2 addition. The hour-2 anchor preserves the 02:00 UTC ritual at every divisor-of-24 interval.

---

## Publisher rules

### Rule: Published pieces are permanent (content immutability)

- **What it says:** Publisher refuses to overwrite the CONTENT of an existing published piece. `publishToPath` checks for file existence before commit. Frontmatter metadata (voiceScore, audioBeats, qualityFlag, pieceId, publishedAt, sourceUrl, claimReviews) is the explicit carve-out — these splice without touching body content.
- **Where defined:** `agents/src/publisher.ts:21-29` (header comment on `PublisherAgent`); enforced in `publishToPath` body. CLAUDE.md "Hard rule" line is the canonical English statement.
- **Type:** rubric (operational hard rule)
- **Used by:** Publisher (writer), every agent that touches MDX (must respect carve-out).
- **Duplicated:** the rule is stated in the publisher header AND in CLAUDE.md AND in the per-task book updates rule. They agree.
- **Notes:** Pass 2 addition. This is the most important non-numeric rule in the system and lives partly in code, partly in prose.

### Rule: GitHub repo target (`zzeeshann/zeemish-v2`, branch `main`)

- **What it says:** Publisher commits MDX to `zzeeshann/zeemish-v2` on branch `main`.
- **Where defined:** `agents/src/publisher.ts:15-17` (`REPO_OWNER`, `REPO_NAME`, `BRANCH` constants).
- **Type:** magic-number (reserved string)
- **Used by:** Publisher only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Strictly infrastructure, but listed because Task 02 may want to lift to env config.

---

## Learner rules

### Rule: Learning shape and category union

- **What it says:** every learning is `{ category, observation }` where category is one of `voice` / `structure` / `fact` / `engagement`. Observation is one declarative sentence (no hedging, no "might/could/perhaps"), optionally followed by a prescriptive sentence. Each pass returns 0–10 learnings.
- **Where defined:** `agents/src/learner-prompt.ts:46-54` (post-publish prompt rules); `:80-88` (Zita prompt rules — same shape); `LEARNER_ANALYSE_PROMPT` (same shape, reader-engagement signals).
- **Type:** format (taxonomy + shape)
- **Used by:** Learner only.
- **Duplicated:** yes, 3 surfaces within `learner-prompt.ts` (post-publish, Zita, analyse). Same rule, three slightly different framings.
- **Notes:** Pass 2 addition.

### Rule: Engagement window (14 days)

- **What it says:** Learner reads aggregated reader engagement on PRIOR pieces' interactives over the last 14 days when evaluating a just-published piece.
- **Where defined:** `agents/src/learner-prompt.ts:18` (single site, in prompt prose).
- **Type:** threshold
- **Used by:** Learner only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

---

## Slug format

### Rule: Kebab-case slug normalisation

- **What it says:** slugs (categories, interactives, beat headings) are lowercased and stripped to a kebab-case safe alphabet.
- **Where defined:** `agents/src/categoriser.ts:33` (slug normaliser, `.toLowerCase()` + strip); `agents/src/interactive-generator.ts:49` (separate slug normaliser, same shape).
- **Type:** format
- **Used by:** Categoriser (new-category slugs), Interactive Generator (artefact slugs), Drafter (beat headings via `## kebab-case` rule).
- **Duplicated:** yes, 2 normaliser implementations (Categoriser + Interactive Generator). Behaviour agrees but they are separate functions.
- **Notes:** Pass 2 addition. Beat heading kebab-case rule is listed separately under "No JSX tags" above.

---

## Schema-encoded rules

### Rule: `interactives.UNIQUE(slug, type)` composite key

- **What it says:** an interactive's `(slug, type)` pair is unique. Allows the same slug to appear once for `quiz` and once for `html` so `bundleFromEntries` can render both at one URL.
- **Where defined:** `migrations/0026_interactives_unique_slug_type.sql:66`.
- **Type:** validator (schema-encoded)
- **Used by:** D1 (write-side enforcement); `resolvePairSlug` at `agents/src/interactive-generator.ts` reads existing rows and inherits the slug.
- **Duplicated:** no — schema is single source. The pairing rule it encodes (quiz + html share a slug) is documented in DECISIONS 2026-04-30 PM and verified by `agents/scripts/verify-pair-slug.mjs`.
- **Notes:** Pass 2 addition. Schema as rule.

---

## Verifier scripts (rule-mirroring)

The `agents/scripts/verify-*.mjs` family encodes rule shapes as JS regression tests, kept in sync by hand with the canonical prompt or code site. These are not new rules; they are mirror surfaces for existing rules.

- `verify-categoriser-floor.mjs` → mirrors the 60/75 floors (Categoriser cluster)
- `verify-dedup.mjs` → mirrors Scanner deduplication semantics (Scanner cluster)
- `verify-fact-checker.mjs` → mirrors Fact Checker parse + harvest shape (Fact-check cluster)
- `verify-interactive-voice.mjs` → mirrors Plain-English split rule + jargon flag list (Quiz cluster)
- `verify-normalize.mjs` → mirrors slug normalisation (Slug cluster)
- `verify-pair-slug.mjs` → mirrors the quiz+html pairing rule (Schema-encoded cluster)
- `verify-parse-retry.mjs` → mirrors interactive JSON parse/retry semantics (Quiz cluster)
- `verify-splice.mjs` → mirrors frontmatter metadata splice (Publisher carve-out)
- `verify-validator.mjs` → mirrors interactive HTML validator rule IDs (Quiz cluster)

---

## Duplications found

Numbered list of every rule appearing in 2+ places. "Agree" means the duplicates carry the same value or shape; "drift risk" means manual sync.

1. **Voice contract (full body)** — **RESOLVED 2026-05-03 (Foundation Fix Task 02 Phase A — codegen).** Canonical `content/voice-contract.md` is the single source; `agents/scripts/codegen-contracts.mjs` embeds it into `agents/src/shared/generated/contracts.ts` at build time. The five in-prompt embed sites now all read from one source.
2. **1000–1500 words** — **RESOLVED 2026-05-04 (Foundation Fix Task 02 — beats cluster extraction).** Canonical at `content/beat-contract.md`; `BEAT_CONTRACT` injected at Drafter, Structure Editor, Integrator. `structure-editor-prompt.ts:20` keeps the value inline as an audit threshold; `curator-prompt.ts:63` keeps the value-reference inline (documented residual).
3. **5–6 beats target / 3–6 acceptable** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`. `structure-editor-prompt.ts:21` keeps the value inline as an audit threshold.
4. **Hook format** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`. Voice-auditor's `-20` deduction is the auditor's own scoring (separate from the beat rule).
5. **ONE idea per teaching beat** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`.
6. **Close format (1–4 sentences)** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`. Voice-auditor's `-15` deduction is the auditor's own scoring (separate from the beat rule).
7. **No JSX tags / kebab-case headings** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`.
8. **MDX frontmatter required fields** — **RESOLVED 2026-05-04** — extracted to `content/beat-contract.md`. `structure-editor-prompt.ts:26` keeps the comma-separated field list inline as an audit-context paraphrase (intentional Tier-2 split per Q6.b).
9. **Voice score ≥85 pass threshold** — **RESOLVED 2026-05-06 (Foundation Fix Task 02 — audit-thresholds cluster extraction).** Canonical at `content/audit-contract.md`; `VOICE_PASS_THRESHOLD = 85` in `agents/src/shared/audit-thresholds.ts` + `src/lib/audit-thresholds.ts` (cross-worker mirror). All four prior sites import.
10. **Essence-not-reference (six prohibitions)** — **RESOLVED 2026-05-05 (Foundation Fix Task 02 — interactive cluster extraction).** Canonical at `content/interactive-contract.md`; `INTERACTIVE_CONTRACT` injected at the four interactive prompt sites. Auditor prompts retain audit-context paraphrases of the six rules; quiz path retains a 7th quiz-specific anti-pattern inline. INTERACTIVES.md spec doc carries an intentional spec-doc mirror with a contract pointer.
11. **Plain-English split for quizzes / 14-year-old test** — **RESOLVED 2026-05-05** — extracted to `content/interactive-contract.md`. `verify-interactive-voice.mjs` JS heuristic now hand-syncs with the contract (header pointer updated). Book chapter 09 + INTERACTIVES.md retain narrative / spec-doc mirrors with contract pointers.
12. **Manipulation embodies the mechanism** — **RESOLVED 2026-05-05** — extracted to `content/interactive-contract.md` (eighth HTML interactive shape rule). HTML auditor retains audit-context paraphrase. INTERACTIVES.md spec mirror updated.
13. **Cutoff-confession phrase blacklist** — **RESOLVED 2026-05-07 (Foundation Fix Task 02 — fact-check cluster extraction).** Canonical at `content/fact-check-contract.md`; writer-side via `${FACT_CHECK_CONTRACT}` injection in fact-checker-prompt.ts; render-side via parallel TS constants in `agents/src/shared/fact-check-thresholds.ts` + `src/lib/fact-check-thresholds.ts` (cross-worker mirror). made-drawer.ts:541-545 filter imports both `CUTOFF_CONFESSION_PHRASES` and `CUTOFF_CONFESSION_REPLACEMENT` from the site-side mirror.
14. **Categoriser fallback slug** — `agents/src/categoriser-prompt.ts` (named const) + `src/lib/categories.ts` (named const, separate worker) + literal SQL in `director.ts` and `made.ts` + migration data (5 surfaces). Agree. Cross-worker drift risk.
15. **`ALLOWED_INTERVAL_HOURS`** — `agents/src/shared/admin-settings.ts` + `src/lib/cadence.ts` (2 surfaces, separate worker packages). Agree. Cross-worker drift risk.
16. **Max revision rounds (3)** — **RESOLVED 2026-05-06.** `MAX_AUDIT_ROUNDS = 3` in `agents/src/shared/audit-thresholds.ts`; both director.ts and interactive-generator.ts import (with local aliases `MAX_REVISIONS` / `INTERACTIVE_MAX_ROUNDS` preserving in-file readability).
17. **Slug normalisation** — `categoriser.ts` + `interactive-generator.ts` (2 separate function implementations).
18. **Learning shape** — 3 surfaces within `learner-prompt.ts` (post-publish, Zita, analyse), each restating the same `{ category, observation }` shape and the same hedging ban.

---

## Single-source rules

Rules that already live in exactly one place and one format.

In `.md` (good — already the centralisation target shape):
- The voice-contract body itself (canonical at `content/voice-contract.md`).
- The beat contract body (canonical at `content/beat-contract.md`, extracted 2026-05-04 — owns word count, beat target, hook/teaching/practice/close formats, no-JSX rule, frontmatter required fields, SEO meta-description).
- The interactive contract body (canonical at `content/interactive-contract.md`, extracted 2026-05-05 — owns essence-not-reference, six prohibitions, Plain English split + jargon translations, quiz shape, HTML interactive shape, validator constraints, title/concept/slug rules).
- The audit contract body (canonical at `content/audit-contract.md`, extracted 2026-05-06 — owns the three gates, the 85/70 thresholds, the 3-round revision bound, the publish-anyway-on-max-fail rule, the `qualityFlag` taxonomy, and the reader-facing tier mapping).
- The fact-check contract body (canonical at `content/fact-check-contract.md`, extracted 2026-05-07 — owns the verdict taxonomy + asymmetry rule, the search-first rule for current-event claims, the cutoff-confession ban + canonical 5-substring filter list + `'training data'` dropped rationale, and the `max_uses=8` web-search budget).
- The curator contract body (canonical at `content/curator-contract.md`, extracted 2026-05-08 — owns the five selection criteria, the 10-domain breadth taxonomy + worked pairings, the recent-category concentration soft skip with safety-valve override, the SAME-EVENT / SAME-CONCEPT hard skips with three worked examples, and the skip output shape).

In code constants (will need extraction in Task 02):
- Voice Auditor scoring deductions (`voice-auditor-prompt.ts`)
- Quiz min/max questions (`interactive-generator-prompt.ts` constants — properly injected)
- Interactive auditor HTML 75 thresholds (`interactive-auditor-prompt.ts` constants — properly injected; voice 85 now imports from audit-thresholds)
- Categoriser max assignments / reuse floors / stretch / fallback slug (`categoriser-prompt.ts` constants)
- (extracted 2026-05-07: Fact Checker verdict taxonomy, search-first rule, cutoff-confession ban, and `WEB_SEARCH_MAX_USES = 8` all live in `content/fact-check-contract.md` + `agents/src/shared/fact-check-thresholds.ts` + `src/lib/fact-check-thresholds.ts` mirror)
- (extracted 2026-05-08: Curator's 5 selection criteria, 10-domain breadth taxonomy, recent-category soft skip, SAME-EVENT / SAME-CONCEPT hard skips, and skip output shape all live in `content/curator-contract.md`; the 30-day window via `CURATOR_RECENT_WINDOW_DAYS` in `agents/src/shared/curator-thresholds.ts` — agents-only, no site-side mirror)
- (extracted 2026-05-09: Audio Producer voice / model / format constants, character cap 20,000, retry attempts 3, and per-call beats budget 2 all live in `content/audio-contract.md`; runtime values via `AUDIO_VOICE_ID` / `AUDIO_MODEL_ID` / `AUDIO_OUTPUT_FORMAT` / `AUDIO_CHAR_CAP` / `AUDIO_MAX_RETRIES` / `AUDIO_BEATS_PER_CHUNK` in `agents/src/shared/audio-thresholds.ts` — agents-only, no site-side mirror; Audio Auditor's CHAR_CAP defense-in-depth duplicate and Director's call-site MAX_BEATS_PER_CHUNK both unified into the shared constants)
- Scanner per-feed cap 6 (`scanner.ts`)
- Scanner global cap 80 (`scanner.ts`)
- (extracted 2026-05-06: daily-piece max-revisions and interactive max-rounds both import `MAX_AUDIT_ROUNDS` from `agents/src/shared/audit-thresholds.ts`)
- HTML interactive validator 8 rule IDs (`interactive-validator.ts`)
- Quality flag taxonomy (`audit-tier.ts` type union + `director.ts` setter)
- Publisher repo / branch constants (`publisher.ts`)
- Learner engagement window 14 days (`learner-prompt.ts`)

In schema (D1 migration):
- `interactives.UNIQUE(slug, type)` composite key encodes the quiz+html pairing rule.

In English prose only:
- Published-piece content immutability (the "hard rule") — stated in `publisher.ts` header comment + `CLAUDE.md` "Hard rule" line + `book/12-publishing.md`. The rule itself is enforced by the `publishToPath` existence check, but the rule statement (and the metadata carve-out) lives only as English text.

---

## Suggested cluster grouping (for Task 02 to finalise)

The clusters above (Voice and tone, Beat structure and piece shape, Quiz / interactive shape, Audit thresholds and gates, Curator selection criteria, Fact-check verification rules, Audio production rules, Scanner rules, Cadence and gating, Publisher rules, Learner rules, Slug format, Schema-encoded rules) are the working grouping the inventory found. They roughly map onto natural contract files:

- `content/voice-contract.md` — already exists. Voice and tone cluster.
- `content/beat-contract.md` (proposed) — Beat structure and piece shape cluster, plus the MDX frontmatter requirements + SEO description rule.
- `content/quiz-contract.md` (proposed) — Quiz / interactive shape cluster (essence prohibitions, plain-English split, 4-dimension audit, max rounds).
- `content/curator-contract.md` (proposed) — Curator selection criteria cluster.
- `content/fact-check-contract.md` (proposed) — Fact-check verification rules cluster.
- `content/audio-contract.md` (proposed) — Audio production rules cluster.
- Scanner / Publisher / Cadence rules are thinner — Task 02 may keep them as code constants and document them in `docs/AGENTS.md` rather than spinning up a contract file each.

These are suggestions only; Task 02 owns the final shape.

---

## Extraction progress

Tracks Foundation Fix Task 02. One cluster per session. Update after each session lands.

- [x] **voice** — canonical `content/voice-contract.md`; codegenned into `agents/src/shared/generated/contracts.ts` via `agents/scripts/codegen-contracts.mjs` (2026-05-03, Foundation Fix Task 02 Phase A, branch `foundation-fix-02-extraction`).
- [x] **interactive-html-reference** — canonical `docs/examples/interactive-reference.html`; codegenned alongside the voice contract in the same module (2026-05-03).
- [x] **beats** — canonical `content/beat-contract.md`; codegenned alongside voice + html reference (2026-05-04, Foundation Fix Task 02 second extraction session, branch `foundation-fix-02-extraction-beats`). Read by Drafter, Structure Editor, Integrator. Voice-contract section 3 ("Lesson structure rules") removed in the same commit — beat-contract.md is now the single source.
- [x] **interactive (quiz + HTML)** — canonical `content/interactive-contract.md`; codegenned alongside voice + beats + html reference (2026-05-05, Foundation Fix Task 02 third extraction session, branch `foundation-fix-02-extraction-quiz`). Read by InteractiveGenerator (both quiz and HTML paths) and InteractiveAuditor (both paths). Carries: essence-not-reference rule, six hard prohibitions, Plain English split rule + 13-word jargon translation list + 14-year-old test + hedge-phrase ban, quiz shape (3–5 questions etc), eight HTML interactive shape rules including manipulation-embodies-the-mechanism, validator constraints in plain English, title / concept / slug rules. Quiz path retains one inline path-specific anti-pattern ("'Which of the following best describes what happened in…'" — quizzes have stems, HTML doesn't). Auditor prompts retain audit-context paraphrases of the six prohibitions and the plain-English flag list (Tier-2 audit-context per beats Q6). `verify-interactive-voice.mjs` continues to mirror the jargon flag list and hedge regexes by hand (header comment updated to name the contract as canonical source).
- [x] **audit-thresholds** — canonical `content/audit-contract.md`; codegenned alongside voice + beats + interactive + html reference (2026-05-06, Foundation Fix Task 02 fourth extraction session, branch `foundation-fix-02-extraction-audit-thresholds`). Carries: the three gates, the voice-pass threshold (85), the audit-tier mapping (polished ≥85, solid 70–84, rough <70), the 3-round revision bound (applied identically to daily-piece and interactive loops), the publish-anyway-on-max-fail rule, and the closed `qualityFlag` taxonomy. Runtime values via named TS constants in `agents/src/shared/audit-thresholds.ts` (agents) and `src/lib/audit-thresholds.ts` (site-side mirror, same shape as cadence.ts ↔ admin-settings.ts). No prompt currently injects `${AUDIT_CONTRACT}` at runtime — the contract is canonical narrative for human readers; values flow through the named constants. The `INTERACTIVE_VOICE_MIN_SCORE` constant in interactive-auditor-prompt.ts is preserved as a re-export alias of `VOICE_PASS_THRESHOLD` for in-file readability. `qualityFlag: 'low' | null` TS type-union sites stay code-side as a documented self-mirror (no shared package across two worker bundles + two Astro Zod schemas).
- [x] **fact-check** — canonical `content/fact-check-contract.md`; codegenned alongside voice + beats + interactive + audit + html reference (2026-05-07, Foundation Fix Task 02 fifth extraction session, branch `foundation-fix-02-extraction-fact-check`). Read by FactCheckerAgent via `${FACT_CHECK_CONTRACT}` injection. Carries: the verdict taxonomy (closed three-value set + asymmetry rule + pass condition), the search-first rule for current-event claims (with the architectural-commitment rationale), the cutoff-confession ban (with both the longer illustrative phrasings the prompt teaches Claude AND the canonical 5-substring filter list as data + the `'training data'` dropped rationale + the canonical replacement string), and the `max_uses = 8` web-search budget (with the FOLLOWUPS escalation note). Runtime values via named TS constants in `agents/src/shared/fact-check-thresholds.ts` (agents — `WEB_SEARCH_MAX_USES`, `CUTOFF_CONFESSION_PHRASES`) and `src/lib/fact-check-thresholds.ts` (site-side mirror — `CUTOFF_CONFESSION_PHRASES`, `CUTOFF_CONFESSION_REPLACEMENT`). Asymmetric exports because consumers differ on each side: agents calls Anthropic's API (needs the budget); site renders the drawer's defense filter (needs the array + replacement). The `'verified' | 'unverified' | 'incorrect'` TS literal union self-mirrors across six sites (intentional, per audit Q4 precedent on `qualityFlag`); the drawer's `'contested'` legacy alias is documented in the contract as render-side back-compat shim, NOT added to the taxonomy. Integrator's prompt (`integrator-prompt.ts`) does NOT receive `${FACT_CHECK_CONTRACT}` — Integrator does not re-verdict, just revises prose; documented as deliberate non-change. `verify-fact-checker.mjs` continues to mirror `parseResponse` shape by hand (header pointer updated to name the contract canonical).
- [x] **curator** — canonical `content/curator-contract.md`; codegenned alongside voice + beats + interactive + audit + fact-check + html reference (2026-05-08, Foundation Fix Task 02 sixth extraction session, branch `foundation-fix-02-extraction-curator`). Read by CuratorAgent via `${CURATOR_CONTRACT}` injection. Carries: the five selection criteria (TEACHABILITY / UNIVERSALITY / FRESHNESS / DEPTH POTENTIAL / NO TRIBAL FRAMING), the 10-domain breadth taxonomy + 10 worked pairings (sub-section under TEACHABILITY), the Default: PICK framing, the recent-category concentration soft skip with safety-valve override, the SAME-EVENT / SAME-CONCEPT hard skips with three worked examples, and the skip output shape. The 30-day data window via `CURATOR_RECENT_WINDOW_DAYS = 30` in `agents/src/shared/curator-thresholds.ts` (agents-only — no site-side mirror; the site does not read curator rules). The "3+" soft-skip threshold stays as inline prose in the contract (no programmatic consumer; only Claude reads it). The Daylila Protocol three-sentence opener stays inline in `curator-prompt.ts` above the contract injection — voice-contract.md is its canonical home; Curator's lift is system-prompt framing per DECISIONS 2026-04-25. Response-format JSON spec + verbatim-UUID rule stay inline in the system prompt below the injection (response-shape, not rule body — same posture as fact-check Q5 / audit Q5 / beats Q6). User-message rule prose collapsed to a Tier-2 audit-context paraphrase under each data block (beats Q6 precedent). No new `verify-curator.mjs` (Curator's behaviour is rule prose Claude reads, not a parser-loop). The hard pre-Curator filter at `agents/src/shared/dedup-headlines.ts` is a separate cluster (Scanner-side, mirrored by `verify-dedup.mjs`).
- [x] **audio** — canonical `content/audio-contract.md`; codegenned alongside voice + beats + interactive + audit + fact-check + curator + html reference (2026-05-09, Foundation Fix Task 02 seventh extraction session, branch `foundation-fix-02-extraction-audio`). Read by Audio Producer + Audio Auditor + Director via TS-constant imports — no Claude prompt currently injects the contract at runtime (Audio Producer makes zero Claude calls — TTS-only via ElevenLabs HTTP; Audio Auditor makes zero Claude calls — R2 HEAD checks only). Carries: the ElevenLabs voice/model/format triple (Frederick Surrey `j9jfwdrw7BRfcR43Qohk`, `eleven_multilingual_v2`, `mp3_44100_96`) with My Voices stability + multilingual + 96kbps trade-off rationales, the 20,000-character per-piece cap with sizing rationale (12-beat × 200 words/beat + headroom), the 3-attempt retry policy with shape (4xx no-retry / 5xx + network do retry, 90s per-attempt timeout, 1s/2s backoff), and the per-call 2-beat budget with DO RPC 30s ceiling rationale. Runtime values via six `AUDIO_`-prefixed exports in `agents/src/shared/audio-thresholds.ts` (agents-only — no site-side mirror; the site does not enforce audio rules). Two duplicate consumers closed in this extraction: `CHAR_CAP = 20_000` (producer + auditor defense-in-depth) → both import `AUDIO_CHAR_CAP`; `MAX_BEATS_PER_CHUNK = 2` (producer default param + Director call-site safety belt) → both import `AUDIO_BEATS_PER_CHUNK` (Director keeps the local name as `as`-aliased import for in-file readability — same shape as `MAX_REVISIONS = MAX_AUDIT_ROUNDS` from audit-thresholds Q3). The 90-second `AbortSignal.timeout` and the 5-key `voice_settings` object stay inline (single-call surfaces, narrated in contract). No new `verify-audio.mjs` (Producer is HTTP/R2/D1 implementation). Site-side `made-drawer.ts:296,303` literals are display-label lookups against persisted DB columns, not rule mirrors (graceful fallback if values change).
- [x] **categoriser** — canonical `content/categoriser-contract.md`; codegenned alongside voice + beats + interactive + audit + fact-check + curator + audio + html reference (2026-05-10, Foundation Fix Task 02 eighth and FINAL extraction session, branch `foundation-fix-02-extraction-categoriser`). Read by CategoriserAgent via `${CATEGORISER_CONTRACT}` injection. Carries: 1–3 assignment cap, 75-confidence ideal-reuse floor, 60-confidence stretch-reuse floor, empty-array prohibition + single-retry recovery + last-resort fallback path, the reserved `patterns-yet-to-cluster` slug, the at-most-one-new-category-per-run discipline. Runtime values via four named constants in `agents/src/shared/categoriser-thresholds.ts` (`CATEGORISER_MAX_ASSIGNMENTS`, `CATEGORISER_REUSE_CONFIDENCE_FLOOR`, `CATEGORISER_REUSE_CONFIDENCE_STRETCH`, `CATEGORISER_FALLBACK_SLUG`); asymmetric site-side mirror at `src/lib/categoriser-thresholds.ts` carrying only `FALLBACK_SLUG` for chip bar / made-drawer / account fallback filters (the floors and assignment cap are agents-only rules). Two literal SQL strings collapsed to bound parameters (`agents/src/director.ts:1697`, `src/pages/api/daily/[date]/made.ts:324`). Migration 0027 seed-row literal stays as deliberate-non-change data. `agents/scripts/verify-categoriser-floor.mjs` keeps its body, gets a header pointer naming the contract canonical (same convention as `verify-fact-checker.mjs`).

**8 / 8 — Phase 1 of Foundation Fix complete.** All eight rule clusters extracted (voice 2026-05-03, beats 2026-05-04, interactive 2026-05-05, audit-thresholds 2026-05-06, fact-check 2026-05-07, curator 2026-05-08, audio 2026-05-09, categoriser 2026-05-10). Phase 2 begins next (`docs/foundation-fix/03-CURATOR-FIX.md`, `04-LEARNER-LOOP.md`, and onward).

Tier 3 disposition (already injected, no extraction needed):
- `QUIZ_MIN/MAX_QUESTIONS` (interactive-generator-prompt.ts) — RESOLVED via `${...}` template literals.
- `CATEGORISER_REUSE_CONFIDENCE_FLOOR` / `STRETCH` (categoriser-prompt.ts) — RESOLVED via `${...}`.
- `INTERACTIVE_HTML_*_MIN_SCORE` (interactive-auditor-prompt.ts, the 75 constants) — RESOLVED via `${...}`. The voice 85 constant `INTERACTIVE_VOICE_MIN_SCORE` was extracted into `agents/src/shared/audit-thresholds.ts` on 2026-05-06 as part of the audit-thresholds cluster (kept as a re-export alias).
