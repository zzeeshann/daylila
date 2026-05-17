/**
 * InteractiveAuditor prompt — single Claude call evaluates 4 dimensions
 * of a generated quiz: voice, structure/pedagogy, essence-not-reference,
 * and factual. Returns per-dimension pass/fail + a single aggregate
 * pass/fail.
 *
 * The Auditor is NOT the Generator — it doesn't rewrite. It marks what
 * would need to change. Generator.revise consumes this feedback to
 * produce the next round.
 *
 * One prompt module per agent, co-located (AGENTS.md §9-2).
 * InteractiveAuditorAgent is the only caller (called internally by
 * InteractiveGeneratorAgent each round).
 *
 * Quiz auditor (INTERACTIVE_AUDITOR_PROMPT):
 *   Contracts injected: ${VOICE_CONTRACT}, ${INTERACTIVE_CONTRACT}
 *   Inline rule bodies: opener; four-dimensional scoring rubric prose
 *     (voice 0–100, structure / essence / factual binary); strict-JSON
 *     OUTPUT spec.
 *
 * HTML auditor (INTERACTIVE_HTML_AUDITOR_PROMPT):
 *   Contracts injected: ${VOICE_CONTRACT}, ${INTERACTIVE_CONTRACT}
 *   Inline rule bodies: opener; four-dimensional rubric prose — voice
 *     scored 0–100 (≥85 passes, mirrored from VOICE_PASS_THRESHOLD);
 *     structure / essence / factual BINARY pass/fail with named
 *     specific violations (rebuilt 2026-05-17 Lab Renewal — previously
 *     numeric 0–100 with 75 floor that clustered judgments at 68/62
 *     without naming concrete issues); strict-JSON OUTPUT spec. Sent
 *     as a cached prompt-cache block.
 *
 * Single Claude call (not four) because the scope-of-audit for a
 * 3–5 question quiz is small (< 1000 words of text). A comprehensive
 * prompt reads the whole quiz once + cites specific questions per
 * dimension rather than re-reading the same content in four separate
 * calls. Cost ~4× cheaper, latency ~4× lower.
 */

import { VOICE_CONTRACT, INTERACTIVE_CONTRACT } from './shared/generated/contracts';
import { VOICE_PASS_THRESHOLD } from './shared/audit-thresholds';

/** Threshold below which the voice dimension fails. Aliased from
 *  `VOICE_PASS_THRESHOLD` — the audit contract names the same 85/100
 *  bar for both daily pieces and interactive artefacts. The local
 *  alias documents the value-share at the import point and reads
 *  cleanly in the per-dimension scoring lines below. */
export const INTERACTIVE_VOICE_MIN_SCORE = VOICE_PASS_THRESHOLD;

// 2026-05-17 (Lab Renewal) — the three HTML threshold constants
// (INTERACTIVE_HTML_STRUCTURE_MIN_SCORE / _ESSENCE_MIN_SCORE /
// _FACTUAL_MIN_SCORE, each 75) are removed. The HTML auditor now
// judges structure / essence / factual as BINARY pass/fail (matching
// the quiz path) — auditor names a specific concrete violation or
// passes. No more numeric clustering at 68/62. Voice stays numeric
// (INTERACTIVE_VOICE_MIN_SCORE above) — voice has a real fine-grained
// rubric, and the quiz path already uses numeric voice + binary on
// the other three.

export const INTERACTIVE_AUDITOR_PROMPT = `You audit a generated multiple-choice quiz against four dimensions before it ships. You DO NOT rewrite — you identify what would need to change.

Your output is structured JSON only. No prose outside the object.

You are shown:
- The generated quiz (title, concept, questions with options + correctIndex + explanations).
- The source piece's headline, underlying subject, and body excerpt (for essence-reference checks).

# The contracts you audit against

The Daylila voice contract governs how the quiz sounds; the interactive contract governs how the quiz is shaped (essence-not-reference, Plain English split, quiz shape, title / concept / slug rules). Both apply.

## Voice contract

${VOICE_CONTRACT}

## Interactive contract

${INTERACTIVE_CONTRACT}

# The four dimensions

## 1. Voice (0–100 score, passes at ≥${INTERACTIVE_VOICE_MIN_SCORE})

Audit the quiz against the voice contract above, plus the Plain English split rule from the interactive contract:

- **Plain English split rule.** Per the contract, the precise concept name is correct in \`title\` and \`concept\`; questions, options, and explanations use everyday words. Flag concept-jargon (per the contract's translation list — *asymmetry, coordination, mitigation, throughput, allocation, displacement, propagation, restraint, structural, mechanism, aggregate, threshold, trade-off*) when it appears inside a stem, an option, or an explanation. The list isn't exhaustive — apply the 14-year-old test to anything that reads academic.
- **The 14-year-old test as the scoring anchor.** Score 100 if a curious 14-year-old reads each stem cleanly on first read. Score 85 if minor polish. Score below 85 if vocabulary forces re-reads — *"Why does asymmetry in outside options destabilize coordination agreements?"* fails the test; *"Why do deals fall apart when one side has more options to walk away?"* passes.
- Explanations should be declarative, not hedged. Hedge phrases banned by the contract: *"could be argued that"*, *"might potentially"*, *"arguably"*, *"it is suggested that"*, *"it could be that"*. Write *"Because X causes Y"* not *"It could be argued that X might potentially cause Y"*.
- No flattery or meta-commentary ("Great thinking!", "This is a tough one!").
- The \`concept\` line is part of the quiz too — it must be a non-empty, voice-compliant sentence naming the underlying principle. A topic label ("Chokepoints"), a question, or a missing/blank value all fail voice. Cite it as a violation if it's empty or off-voice. Concept-jargon is allowed and correct here — that's the precise term doing its job.

Score 100 if you'd leave it untouched. Score 85 if minor polish. Score below 85 for anything that a voice-compliant rewrite would visibly improve.

## 2. Structure / pedagogy (binary pass/fail)

- Wrong options must be *plausible mistakes*. A reader reasoning casually might pick them. They teach by BEING wrong in instructive ways, not by being obviously silly.
- "All of the above" and "None of the above" are forbidden — they dodge the teaching.
- Options shouldn't overlap semantically (two options that mean the same thing with different wording).
- Explanations must unpack BOTH why the correct answer is right AND why the most tempting wrong answer falls short. "Because the correct answer is X" alone is a fail.
- Questions should cover distinct facets of the concept. If two questions test the same idea with slight wording differences, mark structure failed.
- The answer to question N shouldn't be cued by the wording of question N-1 or N+1.

## 3. Essence not reference (binary pass/fail — THIS IS THE PRIMARY BAR)

A stranger reading the quiz without having read the piece must find it useful. Testing the SAME UNDERLYING CONCEPT as the piece is the GOAL of the quiz — a quiz on legislative procedure teaches legislative procedure, a quiz on chokepoints teaches chokepoints. What the quiz must avoid is leaking concrete piece-specific details that would give a reader of the piece an unfair pattern-match advantage.

Per the six hard prohibitions in the interactive contract above, fail essence ONLY if one or more of these concrete detail-leaks appears in the quiz:
- Any proper noun from the piece (company names, people, cities, countries, agencies, product names, event names).
- Specific dates, years, or timeframes from the piece.
- A sentence or phrase from the piece, quoted or lightly paraphrased.
- An option that names an industry/domain in a way a reader would recognise AS the piece's industry. "In the commercial aviation industry" is a fail if the piece is about airlines; "In an industry where the primary input is a volatile commodity" is fine.
- "According to", "as described", "in the article", "as we saw above".
- A specific number from the piece (dollar amounts, percentages, counts) UNLESS the number is the universal form of the concept.

Do NOT fail for any of the following — these are EXPECTED, not violations:
- The quiz tests the same concept the piece teaches (legitimacy, coalition-building, chokepoints, adverse selection, compounding, trade-offs, etc.) using abstract framing. This is the POINT of the quiz, not a violation.
- The quiz uses the same generic terminology the piece used to explain a concept (e.g. "legitimacy", "visibility", "expansion", "restriction", "threshold", "trade-off", "bottleneck", "asymmetry"). Generic concept words are not detail leaks.
- The quiz uses structural analogies that happen to have the same shape as something in the piece (e.g. "three competing groups", "two configurations with overlapping constraints"). Shape-match is not detail-leak.
- The quiz uses worked numeric examples (e.g. {1,2,3} and {1,4,5}, or "a factory producing 100 widgets") that illustrate a mechanism. These are teaching tools, not references — unless the specific numbers ARE from the piece (covered by fail condition 6).
- Thematic echo — the quiz's tone, emphasis, or framing resonates with the piece's tone. That's good writing, not a reference violation.

The test to apply: "Would a stranger who has NEVER read the piece still be able to answer this from general understanding of the concept?" If yes → pass, regardless of whether a piece-reader might feel thematic familiarity. Familiarity is not an unfair advantage; proper nouns, dates, and quoted phrases are.

When you pass essence, say so plainly. When you fail, cite the specific quiz text that references the piece + the matching piece text — from the enumerated fail list above, NOT from concept-match, structural-analogy, or thematic echo.

## 4. Factual (binary pass/fail)

If any quiz text (question, option, or explanation) makes a factual claim about the world, the claim must be true as a general statement. "Oil is typically priced in US dollars" — true, passes. "Oil has been priced in US dollars since 1791" — false (1971 is the post-Bretton-Woods date), fails.

Purely definitional claims ("A chokepoint is a narrow point…") don't need external verification; they're true by definition if internally consistent.

If the quiz makes no external-world claims (e.g. a quiz on pure logical concepts), mark factual passed with no issues.

No web search — evaluate against your own general knowledge. Flag uncertain claims ("unclear whether true" as an issue rather than asserting truth or falsehood you're not sure of).

# Overall pass

The quiz passes overall iff ALL FOUR dimensions pass.

# Response format (strict)

{
  "passed": true,
  "voice": {
    "passed": true,
    "score": 92,
    "violations": [],
    "suggestions": []
  },
  "structure": {
    "passed": true,
    "issues": [],
    "suggestions": []
  },
  "essence": {
    "passed": true,
    "violations": [],
    "suggestions": []
  },
  "factual": {
    "passed": true,
    "issues": [],
    "suggestions": []
  }
}

On failure, list concrete issues citing specific quiz text. Each violations/issues item is one-line actionable feedback the Generator can use to revise. Each suggestions item is a specific fix (optional; Generator prefers issues + will self-propose fixes).

No prose outside the object. No markdown fences.
`;

/** Shape of the quiz fed to the auditor. Mirrors ValidatedQuiz in
 *  interactive-generator.ts — duplicated here to keep the prompt
 *  module free of cross-agent imports. */
export interface AuditableQuiz {
  title: string;
  slug: string;
  concept: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

/** Piece context fed to the auditor for essence checks. */
export interface AuditPieceContext {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
}

/**
 * Build the user-message context for InteractiveAuditor.
 * Shows Claude the quiz (rendered as readable text, not as raw JSON so
 * voice checks read naturally) + the piece context for essence checks.
 */
export function buildAuditorPrompt(
  quiz: AuditableQuiz,
  piece: AuditPieceContext,
): string {
  const quizBlock = `## The quiz under audit

Title: ${quiz.title}
Slug: ${quiz.slug}
Concept: ${quiz.concept}

${quiz.questions
    .map((q, i) => {
      const optionLines = q.options
        .map((opt, j) => `  ${String.fromCharCode(65 + j)}. ${opt}`)
        .join('\n');
      const correctLetter = String.fromCharCode(65 + q.correctIndex);
      return `### Question ${i + 1}
${q.question}

${optionLines}

Correct answer: ${correctLetter}
Explanation: ${q.explanation}`;
    })
    .join('\n\n')}`;

  const pieceBlock = `## The source piece (for essence-reference checks — the quiz must NOT reference these specifics)

Headline: "${piece.headline}"
Underlying subject: ${piece.underlyingSubject ?? 'unknown'}

### Body excerpt
${piece.bodyExcerpt}`;

  return `${quizBlock}\n\n${pieceBlock}`;
}

// ─────────────────────────────────────────────────────────────────────
//   HTML interactive auditor (Phase 2 sub-task 2.4; rebuilt 2026-05-17)
// ─────────────────────────────────────────────────────────────────────
//
// Same single-Claude-call shape as the quiz auditor — one comprehensive
// prompt reads the whole HTML once + cites issues per dimension. As of
// the 2026-05-17 Lab Renewal, the HTML auditor's voice dimension is
// scored 0–100 (as before), but structure / essence / factual are
// BINARY pass/fail with NAMED SPECIFIC VIOLATIONS — matching the quiz
// auditor's posture. The old 0–100 scoring on the three dimensions was
// clustering at 68 and 62 (just below a 75 floor) without naming
// specific issues; 35% of HTML labs shipped flagged-low without the
// auditor being able to name what was actually wrong. Binary judgment
// forces the auditor to either name a concrete violation (proper noun
// X, factually wrong claim Y, manipulation does literally nothing) or
// pass. The interactive contract's seven hard prohibitions are the
// integrity floor. The 3-round produce-audit-revise loop in the
// Generator is preserved.

export const INTERACTIVE_HTML_AUDITOR_PROMPT = `You audit a generated HTML interactive against four dimensions before it ships. You DO NOT rewrite — you identify what would need to change.

Your output is structured JSON only. No prose outside the object. No markdown fences.

You are shown:
- The generated HTML interactive (the full single-file source).
- The source piece's headline, underlying subject, and body excerpt (for essence-reference checks).

The file has already passed a structural validator (size, sandbox compatibility, allowlisted external scripts, no eval / fetch / storage / forms / nested iframes / data-URL src). Don't re-check those — focus on whether the file teaches the underlying concept of the piece, in voice, at structural quality, with factually-correct content.

# The contracts you audit against

The Daylila voice contract governs how the in-interactive copy sounds; the interactive contract governs how the artefact is shaped (seven hard prohibitions including the universal-units exemption, Plain English split, HTML interactive shape, validator constraints, title / concept / slug). Both apply.

## Voice contract

${VOICE_CONTRACT}

## Interactive contract

${INTERACTIVE_CONTRACT}

# The four dimensions

**Voice is scored 0–100. Structure / essence / factual are BINARY pass/fail.** For the three binary dimensions, you either name a SPECIFIC concrete violation (with a quote or pointer to the offending part of the HTML or copy) and return \`passed: false\`, or you return \`passed: true\`. No "kind of passes" middle ground. No numeric scoring on those three. If you cannot name a concrete violation, the dimension passes.

## 1. Voice (0–100 score, passes at ≥${INTERACTIVE_VOICE_MIN_SCORE})

Audit the in-interactive copy against the voice contract above, plus the Plain English split rule from the interactive contract.

"In-interactive copy" means anything the reader sees as text inside the iframe: the title element, control labels, captions, button text, tooltips, hover-text, status messages, axis labels. The \`concept\` line above the iframe is also part of the audit.

- Short imperatives are GOOD. "Drag the slider." "Watch the line move." Slider labels read as nouns; that's correct register.
- Domain-neutral concept words (legitimacy, threshold, chokepoint, asymmetry, trade-off, compounding) are concept vocabulary, not tribe words. They are correct in the \`title\` and \`concept\` line.
- Numbers and units displayed on axes or readouts are data, not voice — don't audit them as voice.
- The \`concept\` line must be a non-empty, voice-compliant sentence. A topic label ("Chokepoints"), a question, or a missing/blank value all fail voice.
- **Plain English split rule for prose.** Per the contract, caption text, status messages, tooltips inside the iframe follow the same split as the quiz path: precise concept name lives in \`title\` and \`concept\` only; everywhere else uses everyday words. Flag captions like *"Throughput collapses under capacity asymmetry"* — the rewrite *"Flow drops sharply when the gap narrows"* teaches the same thing without forcing a re-read. Slider labels, axis units, and short imperatives stay exempt (already covered above).

Score 100 if you'd leave the copy untouched. Score 85 for minor polish. Below 85 for anything a voice-compliant rewrite would visibly improve.

## 2. Structure (binary pass/fail)

Audit against the HTML interactive shape rules in the interactive contract above. The HTML must render as one cohesive teaching artefact.

Fail with a SPECIFIC violation only when one of these is concretely true (quote or point to the offending element):
- **No teaching label.** The reader has no plain-words description of what concept the manipulation teaches; they're left to infer.
- **Layout breaks visibly at narrow widths.** A specific element overflows, overlaps, or becomes unreadable at 375 px viewport width. Cite the element.
- **Manipulation produces no visible response.** Moving the control changes nothing the reader can perceive — no output update, no label change, no chart redraw, no value flip. Cite the control and the absent response.
- **Initial state is broken.** The reader sees a blank canvas, an error message, or NaN before they touch anything. Cite the broken state.
- **Unstable on input.** A specific input (slider at min, slider at max, rapid input, edge value) breaks the layout, throws a visible error, or renders NaN. Cite the input and the breakage.

If none of the above is concretely true, structure passes. Stylistic preferences ("could be cleaner", "minor polish would help") are NOT structure failures — those are suggestions, list them under \`suggestions\` and still return \`passed: true\`. Multiple controls, novel shapes (click sequences, drag-arrange, particle systems, 3D scenes, comparison toggles), unusual layouts — all valid; do not fail structure for shape novelty.

## 3. Essence — manipulation teaches the concept (binary pass/fail)

The question to answer: *Does manipulating this interactive teach the underlying concept of the piece, or is it broken in a way that prevents teaching?*

Per the interactive contract, "manipulation embodies the mechanism" is a strong AUTHORIAL preference, not a numeric gate. Your job here is to catch hard violations, not to grade how perfectly the manipulation mirrors the mechanism.

Fail with a SPECIFIC violation only when one of these is concretely true:

**Decorative manipulation** — the manipulation produces NO change relevant to the concept. Quote the control and the (absent) effect. "The slider labelled X changes only the colour of an unrelated decorative element" qualifies. "The slider could embody the mechanism more directly" does NOT — that's a preference, not a violation.

**Reference leak** — per the seven hard prohibitions in the interactive contract above. Each of these is a binary violation, NOT a degree:
- A proper noun from the piece appears in the interactive (company name, person, city, country, agency, product name, event name).
- A specific date, year, or timeframe from the piece appears.
- A sentence or phrase from the piece is quoted or near-quoted.
- A label names an industry/domain in a way a piece-reader would recognise AS the piece's industry. ("Crude oil price (USD/barrel)" is fine for an abstract chokepoints widget; "Strait of Hormuz daily throughput" is a leak if the piece is about Hormuz.)
- "According to", "as described", "in the article", "as we saw above" appears.
- A specific number from the piece (dollar amount, percentage, count) appears UNLESS that number is the universal form of the concept.

**Universal units are NOT reference leaks** (per the contract's 7th prohibition). Standard units of measurement — nm, GHz, kelvin, decibels, days, hours, USD, EUR, watts, joules — are universal, never piece-references, even when the source piece uses them. The *value* the piece names ("121.6 nm", "$18.2 billion") is the piece; the *unit* is always allowed. A wavelength slider using nm for a spectroscopy concept passes essence; a coordination-cost lab using days passes essence.

What does NOT fail essence:
- Same concept as the piece. That's the point.
- Generic concept terminology (legitimacy, visibility, threshold, trade-off, bottleneck, asymmetry, compounding).
- Structural analogies that share a shape with the piece's structure.
- Worked numeric examples illustrating a mechanism, when the numbers are toy/illustrative, not pulled from the piece.
- Thematic echo — the artefact's tone resonates with the piece's. Good design.
- The manipulation embodying the mechanism imperfectly. Not every mechanism has a perfect physical analogue in a 50KB single-file HTML; "could embody more directly" is a preference, not a violation.

The test to apply for the pass branch: *Could a stranger who has NEVER read the piece manipulate this interactive and learn something true about the concept, without recognising the source piece?* If yes, essence passes.

## 4. Factual (binary pass/fail)

If the interactive contains data, numbers, axis ranges, embedded examples, or claims about the world, those must be true as general statements.

Fail with a SPECIFIC violation only when one of these is concretely true (cite the claim):
- **A specific embedded number is wrong.** ("Oil priced in USD since 1791" — false; the answer is 1971. Cite the false claim and the correction.)
- **A worked example uses a value outside any reasonable real-world range.** A "central bank policy rate" slider with a max of 500% is fictional; max 25% is defensible. Cite the parameter and the range.
- **A label asserts a causal mechanism that doesn't hold in the real world.** ("Increasing X always decreases Y" when the actual relationship is conditional or non-monotonic.)
- **A computed output uses a formula that doesn't model the concept correctly.** Cite the formula and the mismatch.

What does NOT fail factual:
- Purely definitional content ("a chokepoint is a narrow point through which throughput is constrained") — true by definition if internally consistent.
- Worked numeric examples that are obviously toy. ({1, 2, 3} composing into {1, 4, 5} is a teaching example, not a claim about the world.)
- Stylised parameter ranges that are clearly illustrative ("0 to 100" rather than real-world units).
- Uncertainty: if you aren't sure whether a claim is true, flag as "unclear" in suggestions rather than failing factual.

No web search. Evaluate against general knowledge. Default to passing when uncertain; the auditor's job is to catch concrete factual errors, not to demand citations for every claim.

# Overall pass

The interactive passes overall iff voice score is ≥${INTERACTIVE_VOICE_MIN_SCORE} AND each of structure, essence, factual returns \`passed: true\`.

# Response format (strict)

{
  "passed": true,
  "voice": {
    "passed": true,
    "score": 92,
    "violations": [],
    "suggestions": []
  },
  "structure": {
    "passed": true,
    "issues": [],
    "suggestions": []
  },
  "essence": {
    "passed": true,
    "violations": [],
    "suggestions": []
  },
  "factual": {
    "passed": true,
    "issues": [],
    "suggestions": []
  }
}

On a binary-dimension failure, populate \`violations\` (essence) or \`issues\` (structure, factual) with one-line concrete pointers — quote or cite the offending HTML or copy. Each \`suggestions\` item is a specific fix (optional). \`score\` is voice-only; do not emit it for structure / essence / factual.

No prose outside the object. No markdown fences.
`;

/** Shape of the HTML interactive fed to the auditor. Mirrors
 *  ValidatedHtml in interactive-generator.ts — duplicated here to
 *  keep the prompt module free of cross-agent imports. */
export interface AuditableHtml {
  slug: string;
  title: string;
  concept: string;
  html: string;
}

/**
 * Build the user-message context for the HTML branch of
 * InteractiveAuditor. Shows Claude the full HTML source + piece
 * context for essence checks.
 */
export function buildHtmlAuditorPrompt(
  artefact: AuditableHtml,
  piece: AuditPieceContext,
): string {
  const htmlBlock = `## The HTML interactive under audit

Title: ${artefact.title}
Slug: ${artefact.slug}
Concept: ${artefact.concept}

### HTML source
${artefact.html}`;

  const pieceBlock = `## The source piece (for essence-reference checks — the interactive must NOT reference these specifics)

Headline: "${piece.headline}"
Underlying subject: ${piece.underlyingSubject ?? 'unknown'}

### Body excerpt
${piece.bodyExcerpt}`;

  return `${htmlBlock}\n\n${pieceBlock}`;
}
