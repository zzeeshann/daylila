# Rule Inventory

**Status:** Living. Produced 2026-05-03 as Task 01 of the Foundation Fix programme. Successor to the duplication map in `docs/FOLLOWUPS.md` → `[open] 2026-04-30 (last): Centralise contracts`.

**Purpose:** One row per rule that controls how an agent or validator behaves. Pass 1 verified the existing FOLLOWUPS map; Pass 2 walked the rest of `agents/src/`, `src/lib/`, `agents/scripts/`, and `migrations/` to fill gaps. The map is the prerequisite for Task 02 (extract rules into `.md` contract files).

A rule, for this inventory, is: a numeric threshold, a structural spec, a behavioural rubric, a format constraint, a voice/style rule, a validator spec, or a magic number that encodes one of those. Implementation details (caching, retry policy, timeout values), schema column types, and infrastructure config are excluded.

Every cited line number was verified against the working tree at commit `9861805` on 2026-05-03.

---

## Voice and tone

### Rule: Voice contract (full body)

- **What it says:** the canonical Zeemish voice rules — Plain English, no tribe words, short sentences, specific beats general, no flattery, trust the reader; lesson-structure section duplicates beat / hook / close rules at the bottom; ends with the editor's read-aloud test.
- **Where defined:** `content/voice-contract.md` (canonical, 48 lines) ↔ `agents/src/shared/voice-contract.ts` (49-line TypeScript mirror exporting `VOICE_CONTRACT`). Embedded into prompts at `agents/src/voice-auditor-prompt.ts:13`, `agents/src/interactive-generator-prompt.ts:124` and `:445`, `agents/src/interactive-auditor-prompt.ts:48` and `:229`, plus injected via builder at `agents/src/drafter.ts:91` and `agents/src/integrator.ts:58`.
- **Type:** voice
- **Used by:** Drafter, Voice Auditor, Integrator, Interactive Generator (quiz + html paths), Interactive Auditor (quiz + html paths)
- **Duplicated:** yes — two storage sites (`.md` canonical + `.ts` mirror) plus 7 in-prompt embed sites across 5 prompt files. Manual sync convention; the `.ts` header self-documents the constraint ("If you update one, update the other"). Cloudflare Workers cannot `readFileSync` markdown at runtime; codegen option recommended in FOLLOWUPS.
- **Notes:** Tier 1 row 1 of the FOLLOWUPS map. VERIFIED.

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
- **Where defined:** `agents/src/voice-auditor-prompt.ts:26` (literal `85` in the JSON spec line `"passed": boolean (score >= 85)`); `agents/src/voice-auditor.ts:38` (`result.passed = result.score >= 85`); `src/lib/audit-tier.ts:27` (`if (voiceScore >= 85) return 'polished'`); `agents/src/interactive-auditor-prompt.ts:23` (`INTERACTIVE_VOICE_MIN_SCORE = 85`, properly injected via `${...}`).
- **Type:** threshold (magic number)
- **Used by:** Voice Auditor (pass gate), Director (revision loop), audit-tier display, Interactive Auditor.
- **Duplicated:** yes — three sites hardcode the literal `85` (voice-auditor-prompt.ts:26, voice-auditor.ts:38, audit-tier.ts:27); the interactive auditor uses a named constant. The values agree.
- **Notes:** The audit-tier file's docstring at `src/lib/audit-tier.ts:8-10` documents this is the same threshold as the auditor's pass bar — but it still hardcodes the number rather than importing.

### Rule: Audit-tier thresholds (polished / solid / rough)

- **What it says:** voiceScore ≥85 → polished; 70-84 → solid; <70 → rough. Missing voiceScore + qualityFlag='low' → rough; missing voiceScore + no flag → polished.
- **Where defined:** `src/lib/audit-tier.ts:27-29` (single site).
- **Type:** threshold
- **Used by:** every public-facing piece's metadata line (derived at render time).
- **Duplicated:** no — this is the only enforcement of the 70 floor; the 85 ceiling shares value with the voice gate (above) but is logically the tier boundary, not the gate.
- **Notes:** Single-source rule; lives in code constant, not `.md`. Will need extraction in Task 02 if the threshold is to be a contract.

---

## Beat structure and piece shape

### Rule: 1000–1500 words across all beats

- **What it says:** total piece length sits between 1000 and 1500 words.
- **Where defined:** `content/voice-contract.md:33`; `agents/src/drafter-prompt.ts:17`; `agents/src/structure-editor-prompt.ts:14`. Curator references the same range in the depth-potential criterion at `agents/src/curator-prompt.ts:55` ("almost every story has a concept rich enough for 1000–1500 words").
- **Type:** structural (numeric range)
- **Used by:** Drafter (writes to it), Structure Editor (gates on it), Curator (uses it for depth judgment), Voice Auditor (sees it via the contract).
- **Duplicated:** yes, 4 surfaces. Values agree.
- **Notes:** Tier 1 row 2 of the FOLLOWUPS map. VERIFIED.

### Rule: Target 5–6 beats per piece (3–6 acceptable; 7+ is padding)

- **What it says:** target 5–6 beats; 3–6 acceptable; 7+ is the padding zone.
- **Where defined:** `content/voice-contract.md:34`; `agents/src/drafter-prompt.ts:18`; `agents/src/structure-editor-prompt.ts:11`.
- **Type:** structural (numeric range)
- **Used by:** Drafter, Structure Editor, Voice Auditor (via contract).
- **Duplicated:** yes, 3 surfaces. Values agree (the structure-editor states the broader 3–6 range; the contract and drafter state the 5–6 target — these are nested, not conflicting).
- **Notes:** Tier 1 row 3 of the FOLLOWUPS map. VERIFIED.

### Rule: Hook format (one screen, observation first, question follows)

- **What it says:** open the hook with the observation that creates the question, then let the question follow. No "in this lesson we'll learn…" openings.
- **Where defined:** `content/voice-contract.md:36`; `agents/src/drafter-prompt.ts:19`; `agents/src/structure-editor-prompt.ts:12`.
- **Type:** structural (rubric)
- **Used by:** Drafter (writes to it), Structure Editor (gates on it), Voice Auditor (via contract).
- **Duplicated:** yes, 3 surfaces. Values agree.
- **Notes:** Tier 1 row 5 of the FOLLOWUPS map. VERIFIED.

### Rule: ONE idea per teaching beat; specific observation, not definition

- **What it says:** each teaching beat carries one idea, opens with a specific observation (fact, moment, number) — never a definition or generalisation.
- **Where defined:** `content/voice-contract.md:37`; `agents/src/drafter-prompt.ts:20`; `agents/src/structure-editor-prompt.ts:13`.
- **Type:** structural (rubric)
- **Used by:** Drafter, Structure Editor, Voice Auditor (via contract).
- **Duplicated:** yes, 3 surfaces. Values agree.
- **Notes:** Tier 1 row 4 of the FOLLOWUPS map. VERIFIED.

### Rule: Close format (1–4 sentences, no summary/CTA/congratulations)

- **What it says:** close is 1–4 sentences; length is whatever lands; no summary, no call-to-action, no congratulations.
- **Where defined:** `content/voice-contract.md:39`; `agents/src/drafter-prompt.ts:21`; `agents/src/structure-editor-prompt.ts:15`.
- **Type:** structural (rubric)
- **Used by:** Drafter, Structure Editor, Voice Auditor (via contract).
- **Duplicated:** yes, 3 surfaces. Values agree (loosened on 2026-04-30 from "ONE sentence" to "one to four sentences" across all four sites — see DECISIONS).
- **Notes:** Tier 1 row 6 of the FOLLOWUPS map. VERIFIED.

### Rule: No JSX tags; use `## kebab-case` headings

- **What it says:** beats are demarcated by `## kebab-case` markdown headings only; no `<lesson-shell>` / `<lesson-beat>` / `<beat>` / `<section>` JSX tags. The build step wraps headings into Web Components automatically; the audio producer also splits on `## `.
- **Where defined:** `agents/src/drafter-prompt.ts:36`; `agents/src/structure-editor-prompt.ts:16`.
- **Type:** format
- **Used by:** Drafter, Structure Editor, downstream rehype + audio producer (consumers, not enforcers).
- **Duplicated:** yes, 2 surfaces. Values agree.
- **Notes:** Tier 1 row 8 of the FOLLOWUPS map. VERIFIED.

### Rule: MDX frontmatter required fields

- **What it says:** every published piece's MDX frontmatter must include `title`, `date`, `newsSource`, `underlyingSubject`, `estimatedTime`, `beatCount`, `description`.
- **Where defined:** `agents/src/drafter-prompt.ts:47` and `:89` (drafter prompt — both initial-draft and the user-message restatement); `agents/src/structure-editor-prompt.ts:17` (structure-editor CHECK #7, listing the same seven fields).
- **Type:** format
- **Used by:** Drafter (writes them), Structure Editor (gates on them), content collection, render-time pages.
- **Duplicated:** yes, 3 surfaces. Values agree.
- **Notes:** Not in the FOLLOWUPS map. Pass 2 addition.

### Rule: SEO meta-description (140–160 chars, must differ from title, names underlying concept)

- **What it says:** the `description` frontmatter field is 140–160 chars, must not repeat the title verbatim, must name the underlying concept (not just the news event), follows the voice contract.
- **Where defined:** `agents/src/drafter-prompt.ts:38-44` (single site, dedicated section in DRAFTER_PROMPT).
- **Type:** format
- **Used by:** Drafter only (writer); rendered as `<meta name="description">` at site render time.
- **Duplicated:** no.
- **Notes:** Single-source rule, lives in TypeScript prompt prose. Pass 2 addition.

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
- **Where defined:** `agents/src/interactive-generator-prompt.ts:432-441` (numbered 1–6 list); `agents/src/interactive-auditor-prompt.ts:288-294` (paraphrased bullet list, explicitly noted as "same six rules as the quiz path").
- **Type:** rubric
- **Used by:** Interactive Generator (writer), Interactive Auditor (gate).
- **Duplicated:** yes, 2 surfaces. The auditor's wording is a paraphrase rather than verbatim copy — drift risk is "rules disagree slightly" not "exact-text drift".
- **Notes:** Tier 1 row 7 of the FOLLOWUPS map. VERIFIED (with the paraphrase caveat noted).

### Rule: Plain-English split for quizzes

- **What it says:** the precise concept name belongs in `title` and `concept` only; questions, options, and explanations use everyday words a curious 14-year-old reads cleanly on first pass. Translation list of common offending concept-jargon (asymmetry, coordination, mitigation, throughput, allocation, displacement, propagation, restraint, structural, mechanism, aggregate, threshold, trade-off).
- **Where defined:** `agents/src/interactive-generator-prompt.ts:126` ("Plain English for quizzes — the split rule" subsection); `agents/src/interactive-auditor-prompt.ts:51` ("Plain English split rule" + "14-year-old test"); `book/09-the-sixteen-roles.md:159-175` (narrative phrasing); `agents/scripts/verify-interactive-voice.mjs` (JS heuristic mirroring the flag list).
- **Type:** rubric
- **Used by:** Interactive Generator, Interactive Auditor, public book chapter, regression verifier.
- **Duplicated:** yes, 4 surfaces (3 paraphrased + 1 JS heuristic). Generator gives writer permission; auditor gives auditor a checklist; book gives reader narrative — intentionally different framings of the same underlying rule. Verifier mirrors the flag list "by hand" per its own header.
- **Notes:** Tier 2 row 1 of the FOLLOWUPS map. VERIFIED. The 14-year-old test (Tier 2 row 2) is folded into this rule on the auditor side at `:51`.

### Rule: Manipulation embodies the mechanism (HTML essence)

- **What it says:** the mechanism of change in an HTML interactive must mirror the mechanism of the underlying concept (slider's effect compresses when capacity is reduced, etc.).
- **Where defined:** `agents/src/interactive-generator-prompt.ts:463`; `agents/src/interactive-auditor-prompt.ts:273`.
- **Type:** rubric
- **Used by:** Interactive Generator (HTML path), Interactive Auditor (HTML path).
- **Duplicated:** yes, 2 surfaces. Values agree (paraphrased).
- **Notes:** Tier 2 row 3 of the FOLLOWUPS map. VERIFIED.

### Rule: HTML interactive validator — eight rule IDs

- **What it says:** every HTML interactive is checked against eight stable rules pre-audit: `size-cap`, `storage-api`, `dynamic-code`, `external-script-allowlist`, `network-call`, `nested-iframe`, `form-element`, `unsafe-url-scheme`. The validator is the source of truth for the size cap and the external-script allowlist; the prompt imports those constants rather than redefining them.
- **Where defined:** `agents/src/interactive-validator.ts:32-40` (RuleId union); rule logic in the rest of the file. Allowlist regex set at `:70`.
- **Type:** validator
- **Used by:** Interactive Generator (pre-commit gate), Interactive Auditor (told the file passed; doesn't re-run).
- **Duplicated:** no — single source per `interactive-validator.ts:23-27` header.
- **Notes:** Spec lives at `docs/INTERACTIVES.md` "Validator rules". Pass 2 addition.

### Rule: Categoriser max assignments (1–3 per piece)

- **What it says:** every piece lands in 1–3 categories. Empty assignments array is never valid.
- **Where defined:** `agents/src/categoriser-prompt.ts:12` (`CATEGORISER_MAX_ASSIGNMENTS = 3`); injected at `:77` (`Return between 1 and ${CATEGORISER_MAX_ASSIGNMENTS} assignments`); enforced at `agents/src/categoriser.ts:454` (slice cap).
- **Type:** threshold
- **Used by:** Categoriser only.
- **Duplicated:** no — properly injected.
- **Notes:** Pass 2 addition.

### Rule: Categoriser confidence floors (75 reuse / 60 stretch)

- **What it says:** existing-category assignments at confidence ≥75 are ideal reuse; 60–74 is stretch reuse with required reasoning naming what's stretchy; <60 is rejected by the writer (triggers retry → fallback).
- **Where defined:** `agents/src/categoriser-prompt.ts:20` (`CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75`); `:29` (`CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60`); injected throughout the prompt body and retry message; enforced at `agents/src/categoriser.ts:459`.
- **Type:** threshold
- **Used by:** Categoriser (prompt + writer).
- **Duplicated:** no — properly injected via constants.
- **Notes:** Tier 3 row 2 of the FOLLOWUPS map. RESOLVED — values agree everywhere; single-source.

### Rule: Categoriser fallback slug (`patterns-yet-to-cluster`)

- **What it says:** when both Claude attempts return zero valid assignments, the piece is assigned to a reserved fallback category. Hidden from the public library chip bar AND filtered from the Categoriser context list.
- **Where defined:** `agents/src/categoriser-prompt.ts:36` (`CATEGORISER_FALLBACK_SLUG`); `src/lib/categories.ts:26` (`FALLBACK_SLUG` — second TypeScript constant, same value); literal slug in `agents/src/director.ts:1694` and `src/pages/api/daily/[date]/made.ts:324` SQL `WHERE c.slug != 'patterns-yet-to-cluster'`; data row in `migrations/0027_categoriser_fallback_category.sql:36`.
- **Type:** magic-number (reserved string)
- **Used by:** Categoriser (writer), Director (queries), made-drawer endpoint, library UI.
- **Duplicated:** yes, 2 named constants + 2 literal SQL strings + 1 migration data row. The two named constants live in separate worker bundles (`agents/` vs `src/`) and cannot share an import; the SQL literals do not import either constant.
- **Notes:** Pass 2 addition. Cross-worker drift risk; same shape as the `ALLOWED_INTERVAL_HOURS` mirror.

---

## Audit thresholds and gates

### Rule: Daily piece max revisions (3)

- **What it says:** Director runs the auditor → integrator loop up to 3 rounds; on round 3 fail, the piece ships with `qualityFlag='low'`.
- **Where defined:** `agents/src/director.ts:23` (`MAX_REVISIONS = 3`); used at `:327` and `:372`.
- **Type:** threshold
- **Used by:** Director only.
- **Duplicated:** no within Director. **Same value as `INTERACTIVE_MAX_ROUNDS = 3` in `agents/src/interactive-generator.ts:38`** — same rule shape, two separate constants.
- **Notes:** Pass 2 addition.

### Rule: Quality flag — `low` taxonomy

- **What it says:** `qualityFlag` is either `null` or the literal string `'low'`. `'low'` means "shipped on max-fail of the audit loop". Frontmatter splice + D1 column + render-time tier fallback all agree.
- **Where defined:** type union in `src/lib/audit-tier.ts:24` (`qualityFlag?: 'low' | null` — the `auditTier` function param); set in `agents/src/director.ts:395` (`const qualityFlag: 'low' | null = passed ? null : 'low'`); spliced into MDX frontmatter at `:483`; persisted to D1 at `:514`.
- **Type:** format (taxonomy)
- **Used by:** Director (writer), audit-tier (reader fallback).
- **Duplicated:** the `'low'` literal appears in code constants and frontmatter splices but consistently. Single-source taxonomy.
- **Notes:** Pass 2 addition. Documented in CLAUDE.md "Quality surfacing".

---

## Curator selection criteria

### Rule: Selection criteria order (5 numbered)

- **What it says:** Curator picks against five criteria in priority order — TEACHABILITY (find the underlying system), UNIVERSALITY (concept must travel), FRESHNESS, DEPTH POTENTIAL, NO TRIBAL FRAMING.
- **Where defined:** `agents/src/curator-prompt.ts:24-58` (single site).
- **Type:** rubric
- **Used by:** Curator only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Reframed 2026-04-25 around the Zeemish Protocol; criterion 1 carries the 10-domain breadth taxonomy below.

### Rule: 10-domain breadth taxonomy

- **What it says:** Curator considers ten domains (inner life, meaning and belief, expression, language and thought, science not as crisis, body and health, how humans live together, skills and craft, technology beyond crisis, time and place) plus worked pairings of news shapes that map into each.
- **Where defined:** `agents/src/curator-prompt.ts:28-49` (single site, embedded in TEACHABILITY criterion).
- **Type:** rubric
- **Used by:** Curator only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

### Rule: Recent-category concentration soft skip (3+ in 30 days)

- **What it says:** if a candidate's underlying subject would land in a category already holding 3+ recent pieces (last 30 days), prefer a candidate that opens a thinner category — unless the news event genuinely demands the fuller category. Soft preference, not a hard skip.
- **Where defined:** `agents/src/curator-prompt.ts:128-130` (prompt prose); `agents/src/director.ts` `getRecentCategoryCounts(30)` supplies the data (referenced in the curator-prompt comment at `:108-115`); `patterns-yet-to-cluster` is excluded from the count.
- **Type:** rubric (soft)
- **Used by:** Curator (read), Director (data source).
- **Duplicated:** no — single-source rule.
- **Notes:** Pass 2 addition. Diversity-tuned 2026-05-01.

### Rule: SAME-EVENT and SAME-CONCEPT hard skips

- **What it says:** Curator MUST skip candidates that are about the same news event as a recent piece (different wire-service angles do not count as different stories), AND must skip candidates that teach the same underlying concept as a recent piece, even at a different event.
- **Where defined:** `agents/src/curator-prompt.ts:132-138` (single site).
- **Type:** rubric (hard)
- **Used by:** Curator only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

### Rule: Curator skip output shape

- **What it says:** if Curator skips, it must return `{ skip: true, reason }` where `reason` names the specific candidate condition — never a category dismissal like "low-teachability" or "shallow".
- **Where defined:** `agents/src/curator-prompt.ts:80-86` (single site — the `{ skip: true, reason }` JSON spec plus the "reason must NOT be a category dismissal" sentence).
- **Type:** format
- **Used by:** Curator only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

---

## Fact-check verification rules

### Rule: Verdict taxonomy (`verified` / `unverified` / `incorrect`)

- **What it says:** every claim is one of three verdicts. `incorrect` requires direct contradicting evidence from web search; absence of evidence is `unverified`, never `incorrect`.
- **Where defined:** `agents/src/fact-checker-prompt.ts:31-39` (single site, "VERDICTS" + "RULES" sections).
- **Type:** format (taxonomy)
- **Used by:** Fact Checker (writer), drawer renderer at `src/interactive/made-drawer.ts` (reader), `daily_audit_claims` table.
- **Duplicated:** no — single source in prompt; consumers read the column.
- **Notes:** Pass 2 addition.

### Rule: Search-first for current-event claims

- **What it says:** for any claim with a specific name, date, number, or current-event reference, use the web_search tool BEFORE assigning a status. Do not rely on training data for current-event claims. General well-known science (e.g. "cortisol is a stress hormone") does not require a search.
- **Where defined:** `agents/src/fact-checker-prompt.ts:25-29` ("THE WEB SEARCH TOOL" section, single site).
- **Type:** rubric
- **Used by:** Fact Checker only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

### Rule: Web-search tool max_uses (8)

- **What it says:** Anthropic `web_search_20250305` server tool is invoked with `max_uses: 8` per fact-check call.
- **Where defined:** `agents/src/fact-checker.ts:86` (single site, literal in API call).
- **Type:** threshold (magic number)
- **Used by:** Fact Checker only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Tunable per FOLLOWUPS escalation note ("drop max_uses from 8 to 4 if cost runs >$30/month").

### Rule: Cutoff-confession phrase blacklist

- **What it says:** Fact Checker notes must never include phrasings that confess the model's training cutoff to readers — "speculative fiction", "knowledge cutoff", "as of my", "is set in 2026", "is hypothetical", "this is beyond". If web search returned nothing, write "Could not verify against current sources."
- **Where defined:** `agents/src/fact-checker-prompt.ts:41` (the rule, in prompt prose); `src/interactive/made-drawer.ts:511-535` (defense-in-depth filter at render time, with explicit phrase array at `:532`).
- **Type:** rubric (with render-time filter)
- **Used by:** Fact Checker (writer), made-drawer (filter).
- **Duplicated:** yes, 2 surfaces — but with different roles (prompt rule vs. defense filter). The phrase list at `made-drawer.ts:532` does not import from the prompt; the prompt does not import from the filter.
- **Notes:** Pass 2 addition.

---

## Audio production rules

### Rule: ElevenLabs voice + model (Frederick Surrey, eleven_multilingual_v2, mp3_44100_96)

- **What it says:** every audio clip uses voice `j9jfwdrw7BRfcR43Qohk` (Frederick Surrey), model `eleven_multilingual_v2`, output format `mp3_44100_96` (96 kbps).
- **Where defined:** `agents/src/audio-producer.ts:58` (`VOICE_ID`); `:59` (`MODEL_ID`); `:62` (`OUTPUT_FORMAT`). Persisted into `daily_piece_audio` rows at `:362-363`.
- **Type:** magic-number (reserved string)
- **Used by:** Audio Producer only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Voice ID added to "My Voices" so the ID is stable against shared-library removals (per code comment).

### Rule: Audio character cap (20,000 per piece)

- **What it says:** one piece cannot spend more than 20,000 characters of ElevenLabs budget. Sized for a 12-beat piece (~200 words/beat + headroom). Budget for a standard 4–6-beat piece is well under.
- **Where defined:** `agents/src/audio-producer.ts:67` (`CHAR_CAP = 20_000`).
- **Type:** threshold
- **Used by:** Audio Producer only; throws `AudioBudgetExceededError` on overrun.
- **Duplicated:** no.
- **Notes:** Pass 2 addition.

### Rule: Audio retry attempts (3)

- **What it says:** each ElevenLabs TTS call retries up to 3 times on transient failures. 4xx responses do not retry; 5xx + network errors do.
- **Where defined:** `agents/src/audio-producer.ts:309` (loop bound); `:324` (4xx no-retry); `:335` (final-attempt rethrow).
- **Type:** threshold
- **Used by:** Audio Producer only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Retry policy is implementation, but the 3-attempt count itself is rule-shaped.

### Rule: Per-call beats budget (default 2)

- **What it says:** each Audio Producer alarm cycle generates at most 2 new beats (default `maxBeats=2`). Director calls more rounds if needed; this bounds the per-invocation runtime to fit Cloudflare Worker CPU budgets.
- **Where defined:** `agents/src/audio-producer.ts:122` (`maxBeats: number = 2`).
- **Type:** threshold
- **Used by:** Audio Producer only.
- **Duplicated:** no.
- **Notes:** Pass 2 addition. Implementation-shaped but rule-encoding (controls how the producer paces work).

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

1. **Voice contract (full body)** — 2 storage sites (`.md` + `.ts` mirror) + 7 in-prompt embed sites across 5 prompt files. Agree (manual sync). High drift risk; codegen recommended in FOLLOWUPS.
2. **1000–1500 words** — `voice-contract.md` + `drafter-prompt.ts` + `structure-editor-prompt.ts` + `curator-prompt.ts` (4 surfaces). Agree.
3. **5–6 beats target / 3–6 acceptable** — `voice-contract.md` + `drafter-prompt.ts` + `structure-editor-prompt.ts` (3 surfaces). Agree.
4. **Hook format** — `voice-contract.md` + `drafter-prompt.ts` + `structure-editor-prompt.ts` (3 surfaces). Agree.
5. **ONE idea per teaching beat** — `voice-contract.md` + `drafter-prompt.ts` + `structure-editor-prompt.ts` (3 surfaces). Agree.
6. **Close format (1–4 sentences)** — `voice-contract.md` + `drafter-prompt.ts` + `structure-editor-prompt.ts` (3 surfaces). Agree.
7. **No JSX tags / kebab-case headings** — `drafter-prompt.ts` + `structure-editor-prompt.ts` (2 surfaces). Agree.
8. **MDX frontmatter required fields** — `drafter-prompt.ts` (×2) + `structure-editor-prompt.ts` (3 surfaces). Agree.
9. **Voice score ≥85 pass threshold** — `voice-auditor-prompt.ts` + `voice-auditor.ts` + `audit-tier.ts` (literal `85` in 3 sites) + `interactive-auditor-prompt.ts` (named constant). Agree.
10. **Essence-not-reference (six prohibitions)** — `interactive-generator-prompt.ts` (numbered list) + `interactive-auditor-prompt.ts` (paraphrased bullets). Agree (paraphrase drift risk).
11. **Plain-English split for quizzes / 14-year-old test** — `interactive-generator-prompt.ts` + `interactive-auditor-prompt.ts` + `book/09-the-sixteen-roles.md` + `verify-interactive-voice.mjs` (4 surfaces, intentionally different framings). Agree.
12. **Manipulation embodies the mechanism** — `interactive-generator-prompt.ts` + `interactive-auditor-prompt.ts` (2 surfaces, paraphrased). Agree.
13. **Cutoff-confession phrase blacklist** — `fact-checker-prompt.ts` (rule) + `made-drawer.ts` (defense filter) (2 surfaces, different roles). Agree.
14. **Categoriser fallback slug** — `agents/src/categoriser-prompt.ts` (named const) + `src/lib/categories.ts` (named const, separate worker) + literal SQL in `director.ts` and `made.ts` + migration data (5 surfaces). Agree. Cross-worker drift risk.
15. **`ALLOWED_INTERVAL_HOURS`** — `agents/src/shared/admin-settings.ts` + `src/lib/cadence.ts` (2 surfaces, separate worker packages). Agree. Cross-worker drift risk.
16. **Max revision rounds (3)** — `director.ts` `MAX_REVISIONS` + `interactive-generator.ts` `INTERACTIVE_MAX_ROUNDS` (2 separate constants, same value, same rule shape applied to different artefacts).
17. **Slug normalisation** — `categoriser.ts` + `interactive-generator.ts` (2 separate function implementations).
18. **Learning shape** — 3 surfaces within `learner-prompt.ts` (post-publish, Zita, analyse), each restating the same `{ category, observation }` shape and the same hedging ban.

---

## Single-source rules

Rules that already live in exactly one place and one format.

In `.md` (good — already the centralisation target shape):
- The voice-contract body itself (canonical at `content/voice-contract.md`) — though it has the `.ts` mirror, the `.md` is the source.

In code constants (will need extraction in Task 02):
- Voice Auditor scoring deductions (`voice-auditor-prompt.ts`)
- Audit-tier thresholds 85/70 (`src/lib/audit-tier.ts`)
- Quiz min/max questions (`interactive-generator-prompt.ts` constants — properly injected)
- Interactive auditor 4-dimension thresholds 85/75 (`interactive-auditor-prompt.ts` constants — properly injected)
- Interactive max rounds 3 (`interactive-generator.ts`)
- Categoriser max assignments / reuse floors / stretch / fallback slug (`categoriser-prompt.ts` constants)
- Curator's 5 numbered selection criteria (`curator-prompt.ts`)
- Curator's 10-domain breadth taxonomy (`curator-prompt.ts`)
- Curator's 30-day recent-category soft skip (`curator-prompt.ts`)
- Curator's SAME-EVENT / SAME-CONCEPT hard skips (`curator-prompt.ts`)
- Curator's skip output shape (`curator-prompt.ts`)
- Fact Checker verdict taxonomy (`fact-checker-prompt.ts`)
- Fact Checker search-first rule (`fact-checker-prompt.ts`)
- Fact Checker `web_search` `max_uses=8` (`fact-checker.ts`)
- Audio Producer voice / model / format constants (`audio-producer.ts`)
- Audio character cap 20,000 (`audio-producer.ts`)
- Audio retry attempts 3 (`audio-producer.ts`)
- Audio per-call beats budget 2 (`audio-producer.ts`)
- Scanner per-feed cap 6 (`scanner.ts`)
- Scanner global cap 80 (`scanner.ts`)
- Daily piece max revisions 3 (`director.ts`) — value-shared with the interactive constant above
- SEO meta-description length 140–160 chars (`drafter-prompt.ts`)
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
