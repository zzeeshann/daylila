import { VOICE_CONTRACT } from './shared/voice-contract';

/**
 * InteractiveGenerator prompts — produce interactives that teach the
 * *underlying concept* of a just-published daily piece. Two paths:
 *
 *   - QUIZ path (Area 4, live since 2026-04-24): a 3–5 question
 *     multiple-choice JSON artefact. Renders inside <quiz-card>.
 *   - HTML path (Interactives v3, Phase 2): a single self-contained
 *     HTML file rendered inside an <iframe sandbox="allow-scripts">.
 *     A slider, a scrubbable timeline, a small simulation — whatever
 *     shape Claude judges fits the concept of the piece.
 *
 * One prompt module per agent, co-located (AGENTS.md §9-2).
 * InteractiveGeneratorAgent is the only caller.
 *
 * THE QUALITY BAR (shared across both paths): essence, not reference.
 *
 * If someone who has never read the source piece lands on the
 * artefact's URL and can't tell which piece it came from, we did it
 * right. If a reader of the piece can score 100% by pattern-matching
 * details they remember (quiz) or feel that "this is THE piece's
 * model" (HTML), we did it wrong.
 *
 * Both prompts spend most of their words on this one rule because
 * it's the easiest thing to get wrong and the only thing that makes
 * the interactive worth a standalone URL.
 *
 * # Prompt caching
 *
 * The HTML system prompt is large (voice contract + structural rules
 * + sandbox spec + validator rules + future few-shot examples) and
 * stable. Call sites pass it as a single Anthropic prompt-cache block;
 * the per-piece brief in `messages` is the uncached portion. See
 * docs/INTERACTIVES.md "Prompt caching strategy".
 */

/** Hard cap on questions per quiz. Content collection schema also
 *  enforces [3, 5]; this constant is re-used by the agent when it
 *  validates Claude's output before commit. */
export const QUIZ_MIN_QUESTIONS = 3;
export const QUIZ_MAX_QUESTIONS = 5;

/** Options per question. Exactly 4 is the sweet spot — enough that
 *  guessing is ~25%, few enough that authoring 4 plausible ones isn't
 *  forced. Validation enforces ≥2 and ≤6 to match the content schema,
 *  but the prompt asks for 4 to keep quizzes uniform. */
export const QUIZ_OPTIONS_PER_QUESTION = 4;

/** Cap on piece body excerpt fed into the prompt. Matches Categoriser
 *  (~2000 chars) — enough to signal the teaching shape, not so much
 *  that the generator pattern-matches on surface details. */
export const GENERATOR_BODY_EXCERPT_MAX_CHARS = 2500;

/** Hard cap on HTML interactive file size, in bytes (UTF-8). Mirrors
 *  the validator rule at agents/src/interactive-validator.ts (Phase 2
 *  sub-task 2.2). 50 KB is generous for a single-file artefact with
 *  one external D3 v7 import; bloated files signal Generator drift. */
export const HTML_FILE_BYTES_MAX = 50 * 1024;

/** External-script allowlist — the ONLY URLs the validator accepts in
 *  a `<script src=...>` tag. Source pattern lives here so the prompt
 *  and validator stay in sync. cdnjs is the chosen CDN per
 *  docs/INTERACTIVES.md "Validator rules — Rule 4". */
export const HTML_SCRIPT_ALLOWLIST_DESCRIPTION =
  'https://cdnjs.cloudflare.com/ajax/libs/d3/7.<minor>.<patch>/d3.min.js (D3 v7 only, cdnjs only)';

export const INTERACTIVE_GENERATOR_PROMPT = `You produce a short multiple-choice quiz that teaches the UNDERLYING CONCEPT of a just-published Zeemish daily piece.

You DO NOT write a quiz about the piece.

You are shown:
- The piece's headline, underlying subject, and body excerpt.
- The piece's library categories.
- Titles + concepts of recently-published interactives (for diversity).

Your only output is the JSON described at the bottom. No prose outside the object. No markdown fences.

# THE ONE RULE: essence, not reference

The reader of your quiz does not know the piece exists. Your quiz must stand alone as a teaching asset about a concept — useful to a stranger who landed on its URL from a search result, a library chip, a friend's link. If a reader of the source piece could tell it came from that piece, you failed the rule.

The piece is the SOURCE of a concept. The concept is the SUBJECT of your quiz.

Worked examples:

- Piece: a 2026 SEC filing exposing an insider-trading ring at a tech firm.
  Wrong quiz subject: "SEC enforcement of insider trading".
  Right quiz subject: "Information asymmetry in markets — how prices behave when some actors know what others don't, and why markets collapse when trust goes."

- Piece: a power-grid failure during a Texas winter storm.
  Wrong quiz subject: "Texas power grid vulnerabilities".
  Right quiz subject: "Single-point-of-failure cascades — why narrow constraints shape the behaviour of whole systems."

- Piece: a Hormuz shipping disruption that spikes oil prices.
  Wrong quiz subject: "Hormuz strait and global oil".
  Right quiz subject: "Chokepoints — physical, economic, or procedural narrow points that determine flow for an entire system."

Notice: the RIGHT subjects never name the specific trigger. They name the PATTERN the specific trigger illustrates.

# Hard prohibitions

1. Do not use proper nouns from the piece (company names, people, cities, countries, agencies, product names).
2. Do not use specific dates, years, or timeframes from the piece.
3. Do not quote sentences or phrases from the piece.
4. Do not write "according to the piece", "as described", "in the article". There is no piece as far as the reader knows.
5. Do not write "Which of the following best describes what happened in…" — there is no "what happened".
6. Do not include specific numbers (dollar amounts, percentages, counts) UNLESS they are the universal form of the concept. "A human body is ~60% water" is the concept. "$18.2 billion in quarterly losses" is the piece.
7. Do not name industries in a way that a reader would recognise as this piece's industry. If the piece is about airlines, don't say "in the commercial aviation industry" — say "in an industry where fuel is 25% of operating cost and demand is seasonal" (the structure, not the label).

# What a good quiz looks like

- ${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS} questions, each teaching a distinct facet of the concept. Questions should build: a definition-level opener, then mechanism, then implication, then edge/mis-application.
- Exactly ${QUIZ_OPTIONS_PER_QUESTION} options per question.
- Exactly one correct option.
- Wrong options are *plausible mistakes* — a reader reasoning casually might pick them. They teach by being wrong in instructive ways, not by being obviously silly. Avoid "All of the above" and "None of the above" — they dodge the teaching.
- Each question carries a 1–2 sentence explanation that unpacks WHY the correct answer is right AND why the most tempting wrong answer falls short.
- The whole quiz reads as if it were authored BEFORE the piece existed — a standalone teaching asset.

# Title + concept + slug

- \`title\`: 2–6 words, names the concept. Not a headline. Not a question. "Chokepoints and Cascades", "Information Asymmetry", "Moral Hazard".
- \`concept\`: one sentence naming the underlying principle this quiz teaches. A stranger reading this line on the interactive's page should understand what they'll learn.
- \`slug\`: kebab-case, derived from the concept (not from the piece headline). Short (under 4 words). "chokepoints-and-cascades", "information-asymmetry", "moral-hazard-in-markets".

# Diversity with past interactives

You're shown titles + concepts of the most recent interactives. If your draft's concept duplicates one of them, pick a different angle from the piece — e.g. a piece on an insider-trading ring that already has an "information asymmetry" interactive could instead teach "regulatory response cycles" or "market fragility under trust collapse".

If you genuinely cannot find a non-duplicating teachable concept in this piece — for example the piece's concept is fully covered by two recent interactives — decline to generate. Return the empty shape described below.

# Response format (strict)

On success, return JSON matching this shape exactly:

{
  "slug": "kebab-case-slug",
  "title": "Human Title",
  "concept": "One sentence naming the underlying principle this quiz teaches.",
  "questions": [
    {
      "question": "Full question text.",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 2,
      "explanation": "One to two sentences — why the correct answer is right, why the tempting wrong one falls short."
    }
  ]
}

To decline (concept too redundant or too narrow to teach in ${QUIZ_MIN_QUESTIONS}+ questions):

{
  "slug": "",
  "title": "",
  "concept": "",
  "questions": []
}

No prose. No markdown fences. No explanation outside the object.
`;

/** Shape of a recently-published interactive fed into the prompt for
 *  diversity context. */
export interface RecentInteractive {
  slug: string;
  title: string;
  concept: string | null;
}

/** Shape of a piece's category fed into the prompt. */
export interface CategoryRow {
  name: string;
  slug: string;
}

/** Shape of the piece context fed into the prompt. */
export interface PieceContextForQuiz {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
  categories: CategoryRow[];
}

/**
 * Build the user-message context for InteractiveGenerator.
 */
export function buildInteractivePrompt(
  piece: PieceContextForQuiz,
  recent: RecentInteractive[],
): string {
  const pieceBlock = `## The piece (source — DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt (first ~${GENERATOR_BODY_EXCERPT_MAX_CHARS} chars, frontmatter + component tags stripped)
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? `## Recently-published interactives
(None yet. You're creating the first one.)`
    : `## Recently-published interactives (${recent.length} most recent — do not duplicate their concept)
${recent
        .map(
          (r) => `- slug: ${r.slug}
  title: "${r.title}"
  concept: ${r.concept ?? '(no concept recorded)'}`,
        )
        .join('\n')}`;

  return `${pieceBlock}\n\n${recentBlock}`;
}

/** Shape of one audit-dimension's feedback fed into the revise
 *  prompt. Issues/violations are what the Auditor flagged; suggestions
 *  are (optional) specific fixes. */
export interface RevisionDimensionFeedback {
  passed: boolean;
  issues: string[];     // voice violations / structure issues / essence violations / factual issues
  suggestions: string[];
  score?: number;       // voice only
}

/** Full audit feedback shape passed to the revise prompt. */
export interface RevisionFeedback {
  voice: RevisionDimensionFeedback & { score: number };
  structure: RevisionDimensionFeedback;
  essence: RevisionDimensionFeedback;
  factual: RevisionDimensionFeedback;
}

/** Shape of the previous quiz fed into the revise prompt (same as
 *  ValidatedQuiz but duplicated locally to avoid cross-module
 *  imports in a prompt file). */
export interface RevisionPreviousQuiz {
  slug: string;
  title: string;
  concept: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

/**
 * Build the user-message for a revision round. Takes the previous
 * attempt + auditor feedback + original piece context and asks
 * Claude to produce a fresh quiz that addresses each failed
 * dimension. The system prompt is the same `INTERACTIVE_GENERATOR_PROMPT`
 * — revision doesn't relax the essence-not-reference rule; if anything
 * it's tighter because the prior attempt already failed once.
 */
export function buildRevisionPrompt(
  previous: RevisionPreviousQuiz,
  feedback: RevisionFeedback,
  piece: PieceContextForQuiz,
  recent: RecentInteractive[],
  round: number,
): string {
  const previousBlock = `## Previous attempt (round ${round - 1}) — DID NOT pass audit

Title: ${previous.title}
Slug: ${previous.slug}
Concept: ${previous.concept}

${previous.questions
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

  const dimensionBlock = (
    label: string,
    dim: RevisionDimensionFeedback,
  ): string => {
    if (dim.passed) return `- ${label}: PASSED`;
    const lines: string[] = [];
    lines.push(`- ${label}: FAILED${dim.score !== undefined ? ` (score ${dim.score})` : ''}`);
    for (const issue of dim.issues) lines.push(`  - ${issue}`);
    for (const suggestion of dim.suggestions) lines.push(`  - SUGGESTION: ${suggestion}`);
    return lines.join('\n');
  };

  const feedbackBlock = `## Auditor feedback

${dimensionBlock('Voice', feedback.voice)}
${dimensionBlock('Structure', feedback.structure)}
${dimensionBlock('Essence (the primary bar)', feedback.essence)}
${dimensionBlock('Factual', feedback.factual)}`;

  const instruction = `## What to do

Produce a fresh quiz that addresses every failed dimension above. Do NOT incrementally edit the previous attempt — write new questions that teach the same underlying concept but resolve the issues. Same JSON shape as the initial generation. If the essence dimension failed, you likely need to re-derive the concept from the piece's underlying pattern rather than its surface details.

If the feedback makes it clear the piece's concept cannot be taught cleanly in a standalone quiz, decline — return the empty shape {"slug":"","title":"","concept":"","questions":[]}.`;

  const pieceBlock = `## The piece (source — STILL DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? ''
    : `\n\n## Recently-published interactives (${recent.length} — still avoid duplicating)
${recent
        .map((r) => `- ${r.title}: ${r.concept ?? '(no concept recorded)'}`)
        .join('\n')}`;

  return `${previousBlock}\n\n${feedbackBlock}\n\n${instruction}\n\n${pieceBlock}${recentBlock}`;
}

// ─────────────────────────────────────────────────────────────────────
//   HTML interactive path (Phase 2)
// ─────────────────────────────────────────────────────────────────────
//
// Everything below produces HTML interactives — the second artefact
// type per piece. Live behind admin_settings `interactives_html_enabled`
// (default 'false' until Phase 2 sub-task 2.7's manual proof). Quiz
// path above is unchanged.
//
// Caching: callers pass INTERACTIVE_HTML_GENERATOR_PROMPT as a single
// Anthropic prompt-cache block. Per-piece brief in `messages` is the
// uncached portion. The voice contract is embedded inline so the
// cached block is self-contained — same pattern as the quiz Auditor
// at agents/src/interactive-auditor-prompt.ts.

/**
 * System prompt for HTML interactive generation. Stable across every
 * call until the rules genuinely change (then cache invalidates by
 * prefix). Sub-task 2.7 will append a few-shot reference once
 * docs/examples/interactive-reference.html lands.
 */
export const INTERACTIVE_HTML_GENERATOR_PROMPT = `You produce a single self-contained HTML interactive that teaches the UNDERLYING CONCEPT of a just-published Zeemish daily piece.

You DO NOT write an interactive about the piece.

Your only output is the JSON described at the bottom (no prose outside the object, no markdown fences). The JSON's \`html\` field carries the full HTML file as a string.

You are shown:
- The piece's headline, underlying subject, and body excerpt.
- The piece's library categories.
- Titles + concepts of recently-published interactives (for diversity).

# THE ONE RULE: essence, not reference

The reader of your interactive does not know the piece exists. The interactive must stand alone as a teaching artefact about a concept — useful to a stranger who landed on its URL from a search result, a library chip, or a friend's link. If a reader of the source piece could tell it came from that piece, you failed the rule.

The piece is the SOURCE of a concept. The concept is the SUBJECT of your interactive.

Worked examples (same pattern as the quiz path):

- Piece: a 2026 SEC filing exposing an insider-trading ring at a tech firm.
  Wrong subject: "SEC enforcement of insider trading".
  Right subject: an interactive that lets the reader manipulate information distribution between two market actors and watch price formation respond — teaching information asymmetry as mechanism.

- Piece: a power-grid failure during a Texas winter storm.
  Wrong subject: "Texas power grid vulnerabilities".
  Right subject: an interactive with a slider that compresses capacity at one node of a network and shows downstream throughput collapse — teaching single-point-of-failure cascades.

- Piece: a Hormuz shipping disruption that spikes oil prices.
  Wrong subject: "Hormuz strait and global oil".
  Right subject: an interactive where the reader narrows a chokepoint and feels the system's flow constrain — teaching chokepoints as a class of constraint.

The RIGHT shapes never name the specific trigger. They make the underlying PATTERN tactile through the reader's hand on a control.

# Hard prohibitions (the essence-not-reference list)

1. Do not use proper nouns from the piece (company names, people, cities, countries, agencies, product names, event names) anywhere in the HTML — labels, titles, captions, comments, all of it.
2. Do not use specific dates, years, or timeframes from the piece.
3. Do not quote sentences or phrases from the piece.
4. Do not write "according to the piece", "as described", "in the article", "as we saw above". There is no piece as far as the reader knows.
5. Do not include specific numbers (dollar amounts, percentages, counts) UNLESS they are the universal form of the concept. "A human body is ~60% water" is the concept. "$18.2 billion in quarterly losses" is the piece.
6. Do not name an industry/domain in a way a reader would recognise AS the piece's industry. If the piece is about airlines, don't label your axis "Strait of Hormuz daily throughput"; label it "Throughput (units/day)" or use a stylised generic.

# Voice contract

Any in-interactive copy — the title above the iframe, the concept line, control labels, captions, button text, tooltips, status messages — follows the Zeemish voice contract:

${VOICE_CONTRACT}

Extra rules for HTML interactives:
- Short imperatives are GOOD. "Drag the slider." "Watch the line move." Interactive copy is allowed to be terse — a slider label reads as a noun, not a sentence.
- Domain-neutral concept words (legitimacy, threshold, chokepoint, asymmetry, trade-off, compounding) are concept vocabulary, not tribe words.
- Numbers and units displayed on axes or as readouts are data, not voice — no rule applies to them as long as they are illustrative or universal (see hard prohibition 5).
- The \`concept\` line is part of the interactive too. It must be a non-empty, voice-compliant sentence naming the underlying principle the interactive teaches. A topic label ("Chokepoints"), a question, or a missing/blank value all fail voice and the artefact will be revised.

# Structural rules — the interactive must be one cohesive teaching artefact

- **One clear interactive surface.** The reader can identify the thing they're meant to manipulate without guessing — a single slider, a clear pair of toggles, a labelled scrub track, a small simulation with one input. Multiple controls are fine *if* they share an obvious purpose (two sliders that compose into one model output) and bad if they fragment the page into disconnected demos.
- **A clear teaching label.** Above or alongside the interactive surface, in plain words, what concept the manipulation teaches. The reader doesn't have to infer.
- **Cohesive layout.** Title, surface, output, explanation read top-to-bottom (or left-to-right) without the reader hunting.
- **Mobile-respectable.** The interactive doesn't break at 375 px width. Use viewport meta and responsive CSS.
- **Sensible defaults.** Initial state shows something teaching — not a blank canvas requiring three clicks before anything happens.
- **Stable on input.** Moving the slider from min to max doesn't break the layout, throw a visible error, or render NaN.
- **Pedagogy hooks.** The reader can tell what happened when they manipulated something — output changed, a label updated, a chart redrew, a value flipped.
- **Manipulation embodies the mechanism (essence).** The mechanism of change in the interactive must mirror the mechanism of the concept. If the piece teaches chokepoints, the slider's effect should compress when capacity is reduced in the right place. The reader's hand on the control should feel the shape of the idea.

# Sandbox compatibility — the file runs inside <iframe sandbox="allow-scripts">

Your file is rendered inside an iframe with exactly one sandbox token: \`allow-scripts\`. Everything below is what that means in practice. The validator catches what it can pre-flight; the sandbox catches the rest at runtime.

**Forbidden APIs (must not appear in any \`<script>\` block):**
- \`localStorage\`, \`sessionStorage\`, \`indexedDB\` — sandbox without \`allow-same-origin\` throws SecurityError on these. Your interactive cannot persist anything between page loads. State lives in memory for the session.
- \`eval(...)\`, \`new Function(...)\`, \`setTimeout("...", ...)\`, \`setInterval("...", ...)\` — dynamic code execution is forbidden. \`setTimeout(fn, ms)\` with a function reference is fine; the string-form is forbidden.
- \`fetch(...)\`, \`new XMLHttpRequest()\`, \`new WebSocket(...)\`, \`new EventSource(...)\`, \`navigator.sendBeacon(...)\` — no network calls. Every byte the interactive needs ships in the file.

**Forbidden elements:**
- \`<iframe>\` — no nested iframes. Nested sandboxes get confused; outer can't constrain inner attributes.
- \`<form>\` — sandbox disallows form submission anyway (no \`allow-forms\`); it would be visible-but-broken UI.

**Forbidden URL schemes in \`src=\` and \`href=\` attributes:**
- \`data:\` URLs in \`src=\`/\`href=\` (well-known sandbox-bypass surface).
- \`blob:\` URLs in \`src=\`/\`href=\` (output of URL.createObjectURL — unexpected here).
- \`data:\` URIs in CSS \`url(...)\` for background images and fonts ARE fine.

**External scripts:**
- Inline \`<script>\` is fully allowed — that is the file's own JS.
- External \`<script src=...>\` is allowed ONLY for: ${HTML_SCRIPT_ALLOWLIST_DESCRIPTION}.
- Anything else — any other CDN, any other library, any custom script URL — fails the validator and forces a revision.

**File size:**
- ${HTML_FILE_BYTES_MAX} bytes (50 KB) hard cap. D3 is loaded externally from cdnjs — it does NOT count against this. Your inline HTML/CSS/JS plus any inline SVG must fit.

# Engagement events (optional, future-friendly)

The parent page listens for \`window.message\` events from the iframe. If you want the interactive to report engagement (e.g. "the reader manipulated the surface"), \`window.parent.postMessage({type: 'interactive_engagement', event: 'manipulated'}, '*')\` is allowed. Don't post on initial load — only on real user interaction. Don't post more than ~once per second.

This is not required. Most interactives won't post anything.

# Title + concept + slug

- \`title\`: 2–6 words, names the concept. Not a headline. Not a question. Examples: "Chokepoints and Cascades", "Information Asymmetry", "Coalition Math".
- \`concept\`: one sentence naming the underlying principle this interactive teaches. A stranger reading this line on the interactive's page should understand what they'll learn.
- \`slug\`: kebab-case, derived from the concept (not from the piece headline). Short (under 4 words). Examples: "chokepoints-and-cascades", "information-asymmetry", "coalition-math".

# Diversity with past interactives

You're shown titles + concepts of the most recent interactives. If your draft's concept duplicates one of them, pick a different angle from the piece — e.g. a piece on an insider-trading ring that already has an "information asymmetry" interactive could instead teach "regulatory response cycles" or "market fragility under trust collapse".

If you genuinely cannot find a non-duplicating teachable concept in this piece — for example the piece's concept is fully covered by recent interactives — decline. Return the empty shape described below.

# Response format (strict)

On success, return JSON matching this shape exactly. No prose outside the object. No markdown fences.

{
  "slug": "kebab-case-slug",
  "title": "Human Title",
  "concept": "One sentence naming the underlying principle this interactive teaches.",
  "html": "<!DOCTYPE html>\\n<html lang=\\"en\\">\\n... full HTML file ...\\n</html>"
}

The \`html\` field is the entire file as a single string. Start with \`<!DOCTYPE html>\` (must be the first non-whitespace). Include \`<meta charset="utf-8">\` and \`<meta name="viewport" content="width=device-width, initial-scale=1">\`. Include a \`<title>\` matching your \`title\` field. The file must be self-contained: inline CSS in \`<style>\`, inline JS in \`<script>\`, with at most one external script (D3 v7 from cdnjs per the allowlist above).

To decline (concept too redundant or too narrow to teach in a single interactive), return the empty shape:

{
  "slug": "",
  "title": "",
  "concept": "",
  "html": ""
}
`;

/** Piece context fed to the HTML generator. Identical shape to the
 *  quiz path's PieceContextForQuiz — kept as a separate type alias so
 *  the call site reads naturally and a future divergence (e.g. extra
 *  fields for HTML-only context) doesn't ripple back into the quiz
 *  type. */
export type PieceContextForInteractive = PieceContextForQuiz;

/**
 * Build the user-message context for HTML interactive generation —
 * the uncached portion of the prompt. Same shape as the quiz path
 * (piece header + body excerpt + recent interactives for diversity);
 * separate function so the wording can drift from the quiz path
 * without coupling.
 */
export function buildHtmlInteractivePrompt(
  piece: PieceContextForInteractive,
  recent: RecentInteractive[],
): string {
  const pieceBlock = `## The piece (source — DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt (first ~${GENERATOR_BODY_EXCERPT_MAX_CHARS} chars, frontmatter + component tags stripped)
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? `## Recently-published interactives
(None yet. You're creating the first one.)`
    : `## Recently-published interactives (${recent.length} most recent — do not duplicate their concept)
${recent
        .map(
          (r) => `- slug: ${r.slug}
  title: "${r.title}"
  concept: ${r.concept ?? '(no concept recorded)'}`,
        )
        .join('\n')}`;

  return `${pieceBlock}\n\n${recentBlock}`;
}

/** Shape of the previous HTML attempt fed into the revise prompt. */
export interface RevisionPreviousHtml {
  slug: string;
  title: string;
  concept: string;
  html: string;
}

/** Shape of one validator violation fed into the revise prompt. The
 *  Generator runs the validator BEFORE the Auditor; if validator
 *  fails, the round revises with these violations and skips the
 *  Auditor entirely. The fields mirror the validator's `Violation`
 *  shape at agents/src/interactive-validator.ts (Phase 2 sub-task
 *  2.2) — kept as a thin local type so the prompt module doesn't
 *  cross-import the validator. */
export interface RevisionValidatorViolation {
  rule: string;     // RuleId from the validator
  message: string;  // one-line actionable feedback
  snippet?: string; // optional offending text (up to ~200 chars)
}

/**
 * Build the user-message for an HTML revision round. Carries the
 * prior HTML + auditor feedback + (optionally) validator violations
 * + the original piece context. The Generator decides which feedback
 * blocks to populate based on what failed:
 *
 *   - validator failed (audit not yet run): pass `validatorViolations`
 *     non-empty + `audit` undefined.
 *   - auditor failed (validator passed): pass `audit` + `validatorViolations`
 *     empty/undefined.
 *
 * The system prompt remains INTERACTIVE_HTML_GENERATOR_PROMPT for
 * every round — revision doesn't relax the rules; if anything it's
 * tighter because the prior attempt already failed once.
 */
export function buildHtmlRevisionPrompt(
  previous: RevisionPreviousHtml,
  feedback: RevisionFeedback | null,
  validatorViolations: RevisionValidatorViolation[],
  piece: PieceContextForInteractive,
  recent: RecentInteractive[],
  round: number,
): string {
  const previousBlock = `## Previous attempt (round ${round - 1}) — DID NOT pass

Title: ${previous.title}
Slug: ${previous.slug}
Concept: ${previous.concept}

### HTML source
${previous.html}`;

  const validatorBlock = validatorViolations.length === 0
    ? ''
    : `\n\n## Validator violations (these failed BEFORE the auditor saw the file)

${validatorViolations
        .map((v, i) => {
          const snippet = v.snippet ? `\n  Snippet: ${v.snippet}` : '';
          return `${i + 1}. [${v.rule}] ${v.message}${snippet}`;
        })
        .join('\n')}`;

  const dimensionBlock = (
    label: string,
    dim: RevisionDimensionFeedback,
  ): string => {
    if (dim.passed) return `- ${label}: PASSED`;
    const lines: string[] = [];
    lines.push(`- ${label}: FAILED${dim.score !== undefined ? ` (score ${dim.score})` : ''}`);
    for (const issue of dim.issues) lines.push(`  - ${issue}`);
    for (const suggestion of dim.suggestions) lines.push(`  - SUGGESTION: ${suggestion}`);
    return lines.join('\n');
  };

  const auditBlock = feedback === null
    ? ''
    : `\n\n## Auditor feedback

${dimensionBlock('Voice', feedback.voice)}
${dimensionBlock('Structure', feedback.structure)}
${dimensionBlock('Essence (the primary bar)', feedback.essence)}
${dimensionBlock('Factual', feedback.factual)}`;

  const instruction = `## What to do

Produce a fresh HTML interactive that addresses every issue above. Do NOT incrementally edit the previous file's text — write the file again from scratch in a way that resolves the issues. Same JSON shape as the initial generation, with the full HTML in the \`html\` field.

If the essence dimension failed, you likely need to re-derive the concept from the piece's underlying pattern rather than the surface details that leaked. If structure failed, rethink the interactive surface — fewer controls with a clearer purpose usually beats more controls. If the validator failed, every violation must be gone in the next attempt.

If the feedback makes it clear the piece's concept cannot be taught cleanly in a standalone HTML interactive, decline — return the empty shape {"slug":"","title":"","concept":"","html":""}.`;

  const pieceBlock = `## The piece (source — STILL DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? ''
    : `\n\n## Recently-published interactives (${recent.length} — still avoid duplicating)
${recent
        .map((r) => `- ${r.title}: ${r.concept ?? '(no concept recorded)'}`)
        .join('\n')}`;

  return `${previousBlock}${validatorBlock}${auditBlock}\n\n${instruction}\n\n${pieceBlock}${recentBlock}`;
}
