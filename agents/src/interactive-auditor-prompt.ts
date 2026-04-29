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
 * Single Claude call (not four) because the scope-of-audit for a
 * 3–5 question quiz is small (< 1000 words of text). A comprehensive
 * prompt reads the whole quiz once + cites specific questions per
 * dimension rather than re-reading the same content in four separate
 * calls. Cost ~4× cheaper, latency ~4× lower.
 */

import { VOICE_CONTRACT } from './shared/voice-contract';

/** Threshold below which the voice dimension fails. Mirrors
 *  VoiceAuditor's 85/100 gate on daily pieces. Used by both quiz
 *  and HTML auditor paths. */
export const INTERACTIVE_VOICE_MIN_SCORE = 85;

/** HTML interactive structure dimension threshold. Lower than voice
 *  because structure/essence/factual on HTML are scored (not binary
 *  like the quiz path) — a score in the 75–84 band means "minor
 *  polish would help" not "ship it". 75 is the spec floor at
 *  docs/INTERACTIVES.md "Audit rubric". */
export const INTERACTIVE_HTML_STRUCTURE_MIN_SCORE = 75;
export const INTERACTIVE_HTML_ESSENCE_MIN_SCORE = 75;
export const INTERACTIVE_HTML_FACTUAL_MIN_SCORE = 75;

export const INTERACTIVE_AUDITOR_PROMPT = `You audit a generated multiple-choice quiz against four dimensions before it ships. You DO NOT rewrite — you identify what would need to change.

Your output is structured JSON only. No prose outside the object.

You are shown:
- The generated quiz (title, concept, questions with options + correctIndex + explanations).
- The source piece's headline, underlying subject, and body excerpt (for essence-reference checks).

# The four dimensions

## 1. Voice (0–100 score, passes at ≥${INTERACTIVE_VOICE_MIN_SCORE})

The Zeemish voice contract applies to interactives the same way it applies to daily pieces:

${VOICE_CONTRACT}

Extra rules for quizzes:
- **Plain English split rule.** The precise concept name is correct in \`title\` and \`concept\`; questions, options, and explanations use everyday words. Flag concept-jargon when it appears inside a stem, an option, or an explanation — words like *asymmetry, coordination, mitigation, throughput, allocation, displacement, propagation, restraint, structural, mechanism, aggregate, threshold, trade-off* should be translated into plain language inside the question body (e.g., *asymmetry → imbalance / one side has more*; *coordination agreement → deal*; *mutual restraint → holding back*). The list isn't exhaustive — apply the test below to anything that reads academic.
- **The 14-year-old test as the scoring anchor.** Score 100 if a curious 14-year-old reads each stem cleanly on first read. Score 85 if minor polish. Score below 85 if vocabulary forces re-reads — *"Why does asymmetry in outside options destabilize coordination agreements?"* fails the test; *"Why do deals fall apart when one side has more options to walk away?"* passes.
- Explanations should be declarative, not hedged ("Because X causes Y" not "It could be argued that X might potentially cause Y").
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

Check against the piece's body excerpt. Fail ONLY if one or more of these concrete detail-leaks appears:
- Any proper noun from the piece appears in the quiz (company names, people, cities, countries, agencies, product names, event names).
- Specific dates, years, or timeframes from the piece appear in the quiz.
- A sentence or phrase from the piece is quoted or lightly paraphrased in the quiz.
- An option names an industry/domain in a way that a reader would recognise AS the piece's industry. "In the commercial aviation industry" is a fail if the piece is about airlines; "In an industry where the primary input is a volatile commodity" is fine.
- The quiz uses "according to", "as described", "in the article", "as we saw above".
- Any specific number from the piece (dollar amounts, percentages, counts) appears in the quiz UNLESS that number is the universal form of the concept.

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
//   HTML interactive auditor (Phase 2 sub-task 2.4)
// ─────────────────────────────────────────────────────────────────────
//
// Same single-Claude-call shape as the quiz auditor — one comprehensive
// prompt reads the whole HTML once + cites issues per dimension. Unlike
// the quiz audit, ALL FOUR dimensions are scored 0–100 (not binary on
// structure/essence/factual). Per spec docs/INTERACTIVES.md "Audit
// rubric" — an HTML interactive is multi-dimensional in ways a 3–5
// question quiz isn't, and a slider that teaches at 80% essence is
// still shippable, while one at 60% is decorative.

export const INTERACTIVE_HTML_AUDITOR_PROMPT = `You audit a generated HTML interactive against four dimensions before it ships. You DO NOT rewrite — you identify what would need to change.

Your output is structured JSON only. No prose outside the object. No markdown fences.

You are shown:
- The generated HTML interactive (the full single-file source).
- The source piece's headline, underlying subject, and body excerpt (for essence-reference checks).

The file has already passed a structural validator (size, sandbox compatibility, allowlisted external scripts, no eval / fetch / storage / forms / nested iframes / data-URL src). Don't re-check those — focus on whether the file teaches the underlying concept of the piece, in voice, at structural quality, with factually-correct content.

# The four dimensions — ALL FOUR scored 0–100

## 1. Voice (passes at ≥${INTERACTIVE_VOICE_MIN_SCORE})

The Zeemish voice contract applies to in-interactive copy:

${VOICE_CONTRACT}

"In-interactive copy" means anything the reader sees as text inside the iframe: the title element, control labels, captions, button text, tooltips, hover-text, status messages, axis labels. The \`concept\` line above the iframe is also part of the audit.

Extra rules for HTML interactives:
- Short imperatives are GOOD. "Drag the slider." "Watch the line move." Slider labels read as nouns; that's correct register.
- Domain-neutral concept words (legitimacy, threshold, chokepoint, asymmetry, trade-off, compounding) are concept vocabulary, not tribe words. They are correct in the \`title\` and \`concept\` line.
- Numbers and units displayed on axes or readouts are data, not voice — don't audit them as voice.
- The \`concept\` line must be a non-empty, voice-compliant sentence. A topic label ("Chokepoints"), a question, or a missing/blank value all fail voice.
- **Plain English split rule for prose.** Caption text, status messages, tooltips inside the iframe follow the same rule the quiz auditor enforces: precise concept name lives in \`title\` and \`concept\` only; everywhere else uses everyday words. Flag captions like *"Throughput collapses under capacity asymmetry"* — the rewrite *"Flow drops sharply when the gap narrows"* teaches the same thing without forcing a re-read. Slider labels, axis units, and short imperatives stay exempt (already covered above).

Score 100 if you'd leave the copy untouched. Score 85 for minor polish. Below 85 for anything a voice-compliant rewrite would visibly improve.

## 2. Structure (passes at ≥${INTERACTIVE_HTML_STRUCTURE_MIN_SCORE})

The HTML must render as one cohesive teaching artefact, not a pile of widgets.

What passes structure:
- One clear interactive surface — a single slider, a clear pair of toggles, a labelled scrub track, a small simulation with one input. Multiple controls fine if they share an obvious purpose.
- A clear teaching label — above or alongside the surface, in plain words, what concept the manipulation teaches.
- Cohesive layout — title, surface, output, explanation read top-to-bottom (or LTR) without the reader hunting.
- Mobile-respectable — doesn't break visibly at 375px width.
- Sensible defaults — initial state shows something teaching, not a blank canvas.
- Stable on input — moving the slider min→max doesn't break layout, throw visible errors, or render NaN.
- Pedagogy hooks — manipulation produces a visible response (output changed, label updated, chart redrew, value flipped).

What fails structure:
- Multiple disconnected interactive elements with no shared purpose.
- No teaching label — the reader has to guess what concept this is about.
- Decorative animation that runs on its own with no input from the reader.
- Initial state is blank or broken until the reader does something specific.
- Layout breaks visibly at narrow widths.
- Manipulation produces no visible response.

Score 100 if you'd ship it untouched. Score 75 for minor polish. Below 75 for structural problems that would visibly reduce teaching value.

## 3. Essence — manipulation teaches the concept (passes at ≥${INTERACTIVE_HTML_ESSENCE_MIN_SCORE})

THIS IS THE PRIMARY BAR. An HTML interactive that fails essence has nothing to fall back on.

The question to answer: *Does manipulating this interactive teach the underlying concept of the piece, or is it decorative?*

The mechanism of change in the interactive must mirror the mechanism of the concept. If the piece teaches chokepoints, the slider's effect should compress when capacity is reduced in the right place — that's the concept made tactile. The reader's hand on the control should feel the shape of the idea.

What passes essence:
- The manipulation embodies the mechanism. Moving the slider changes outputs in a way that reflects how the real concept works.
- The reader can derive the lesson from interaction alone — prose may scaffold, but interaction is enough.
- A stranger who never read the piece can play with the interactive and learn the underlying concept.
- Concept-match with the piece is EXPECTED. A chokepoints piece gets a chokepoints interactive. Same-concept teaching is the GOAL, not a violation.

What fails essence — DECORATIVE:
- The interactive shows a value but the manipulation doesn't change anything mechanism-relevant.
- The interactive is a chart with a play button — it animates over time without the reader's input mattering.
- The interactive is a quiz disguised as a widget. (We already have a quiz path.)
- The "model" behind the manipulation is arbitrary — moving the slider produces numbers, but those numbers don't reflect the concept.

What fails essence — REFERENCE LEAK (same six rules as the quiz path):
- Proper nouns from the piece appear in the interactive (company names, people, cities, countries, agencies, product names, event names).
- Specific dates, years, or timeframes from the piece appear in the interactive.
- Sentences or phrases from the piece are quoted or lightly paraphrased.
- Labels name an industry/domain in a way a piece-reader would recognise AS the piece's industry. ("Crude oil price (USD/barrel)" is fine for an abstract chokepoints widget; "Strait of Hormuz daily throughput" is a leak if the piece is about Hormuz.)
- The interactive uses "according to", "as described", "in the article", "as we saw above".
- Specific numbers from the piece (dollar amounts, percentages, counts) appear in the interactive UNLESS that number is the universal form of the concept.

What does NOT fail essence (these are EXPECTED, not violations):
- Same concept as the piece. That's the point.
- Generic concept terminology (legitimacy, visibility, threshold, trade-off, bottleneck, asymmetry, compounding).
- Structural analogies that share a shape with the piece's structure (three groups, two configurations, one binding constraint).
- Worked numeric examples illustrating a mechanism — \`{1, 2, 3}\` and \`{1, 4, 5}\`, "100 widgets in, X widgets out" — unless those specific numbers are pulled from the piece.
- Thematic echo — the artefact's tone resonates with the piece's. Good design.

The test to apply: *Would a stranger who has NEVER read the piece manipulate this interactive and walk away understanding the concept?* If yes, essence passes regardless of whether a piece-reader would feel thematic familiarity.

Score 100 if the manipulation is a perfect physical analogue of the mechanism. Score 75 if it teaches the concept with some clunkiness. Below 75 if decorative, misaligned with the concept, or leaks specifics from the piece.

## 4. Factual (passes at ≥${INTERACTIVE_HTML_FACTUAL_MIN_SCORE})

If the interactive contains data, numbers, axis ranges, embedded examples, or claims about the world, those must be true as general statements.

What fails factual:
- An embedded number is wrong. ("Oil priced in USD since 1791" — false; 1971.)
- A worked example uses a value outside any reasonable real-world range. (A "central bank policy rate" slider with a max of 500% is fictional; max 25% is defensible.)
- A label asserts a causal mechanism that doesn't hold in the real world. ("Increasing X always decreases Y" when conditional or non-monotonic.)
- A computed output uses a formula that doesn't model the concept correctly.

What does NOT fail factual:
- Purely definitional content ("a chokepoint is a narrow point through which throughput is constrained") — true by definition if internally consistent.
- Worked numeric examples that are obviously toy. ({1, 2, 3} composing into {1, 4, 5} is a teaching example, not a claim about the world.)
- Stylised parameter ranges that are clearly illustrative ("0 to 100" rather than real-world units).
- Uncertainty: if you aren't sure whether a claim is true, flag as "unclear" rather than asserting truth or falsehood.

No web search. Evaluate against general knowledge.

Score 100 if every claim is verifiably true or clearly toy. Score 75 if a claim is technically defensible but oversimplified. Below 75 for a wrong number, a fictional range, or a misstated mechanism.

# Overall pass

The interactive passes overall iff ALL FOUR dimensions pass at their respective thresholds (voice ≥${INTERACTIVE_VOICE_MIN_SCORE}; structure / essence / factual ≥${INTERACTIVE_HTML_STRUCTURE_MIN_SCORE} each).

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
    "score": 88,
    "issues": [],
    "suggestions": []
  },
  "essence": {
    "passed": true,
    "score": 81,
    "violations": [],
    "suggestions": []
  },
  "factual": {
    "passed": true,
    "score": 95,
    "issues": [],
    "suggestions": []
  }
}

On failure, list concrete issues citing specific HTML or copy. Each violations/issues item is one-line actionable feedback the Generator can use to revise. Each suggestions item is a specific fix (optional).

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
