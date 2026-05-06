import { VOICE_CONTRACT, INTERACTIVE_HTML_REFERENCE, INTERACTIVE_CONTRACT } from './shared/generated/contracts';
import {
  HTML_FILE_BYTES_MAX,
  HTML_SCRIPT_ALLOWLIST_DESCRIPTION,
} from './interactive-validator';

// Re-export the constants the prompt references so existing/future
// callers of the prompt module see them at the same import path. The
// validator owns the values; this module owns the prose around them.
export { HTML_FILE_BYTES_MAX, HTML_SCRIPT_ALLOWLIST_DESCRIPTION };

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

// HTML interactive constants are imported from interactive-validator.ts
// and re-exported at the top of this file. The validator is the source
// of truth for the size cap and the allowlist surface; this module
// references the imports below in the prompt body.

export const INTERACTIVE_GENERATOR_PROMPT = `You produce a short multiple-choice quiz that teaches the UNDERLYING CONCEPT of a just-published Daylila daily piece.

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

# Voice contract

${VOICE_CONTRACT}

# Interactive contract

The full set of rules for shaping a quiz or HTML interactive lives in the contract below. Hard prohibitions, the Plain English split rule and jargon translation list, the quiz shape (3–5 questions, 4 options, plausible wrong answers, 1–2 sentence explanations), and the title / concept / slug rules all live here:

${INTERACTIVE_CONTRACT}

# Additional quiz-specific anti-patterns

The contract above governs both quiz and HTML paths. One extra anti-pattern applies to the quiz path only:

- Do not write "Which of the following best describes what happened in…" — there is no "what happened" as far as the reader knows.

Quiz question count for this prompt: ${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS}, exactly ${QUIZ_OPTIONS_PER_QUESTION} options each.

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

/**
 * Build the user-message for a JSON-repair revision round — used when
 * the prior round's response failed `parseAndValidate` (Claude returned
 * something that didn't parse as JSON, e.g. unquoted string values mid-
 * object). Distinct from buildRevisionPrompt because there's no audited
 * structured object to quote back; only the raw broken-output head is
 * available.
 *
 * The system prompt is unchanged (`INTERACTIVE_GENERATOR_PROMPT`); this
 * user message tells Claude its previous attempt was malformed JSON
 * and asks for a fresh attempt with valid JSON. Re-derives the concept
 * — does not try to reconstruct the malformed previous output.
 */
export function buildJsonRepairPrompt(
  brokenHead: string,
  piece: PieceContextForQuiz,
  recent: RecentInteractive[],
  round: number,
): string {
  const previousBlock = `## Previous attempt (round ${round - 1}) — DID NOT parse as valid JSON

The first ~200 characters of what you returned:

${brokenHead}`;

  const instruction = `## What to do

Re-emit a fresh quiz as valid JSON. Every string value MUST be enclosed in double quotes — including multi-clause concept values that read like natural-language sentences. Use the exact JSON shape:

{ "slug": "...", "title": "...", "concept": "...", "questions": [...] }

This is a JSON-validity issue, not a content issue. Re-derive the concept from the piece's underlying pattern as you would on a fresh attempt; do not try to reconstruct the malformed previous output.

If the piece's concept cannot be taught cleanly in a standalone quiz, decline — return the empty shape {"slug":"","title":"","concept":"","questions":[]}.`;

  const pieceBlock = `## The piece (source — DO NOT reference directly)
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

  return `${previousBlock}\n\n${instruction}\n\n${pieceBlock}${recentBlock}`;
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
export const INTERACTIVE_HTML_GENERATOR_PROMPT = `You produce a single self-contained HTML interactive that teaches the UNDERLYING CONCEPT of a just-published Daylila daily piece.

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

# Voice contract

Any in-interactive copy — the title above the iframe, the concept line, control labels, captions, button text, tooltips, status messages — follows the Daylila voice contract:

${VOICE_CONTRACT}

# Interactive contract

The full set of rules for shaping a quiz or HTML interactive lives in the contract below. Hard prohibitions (the essence-not-reference list), the Plain English split rule and jargon translation list, the HTML interactive shape (one clear surface, teaching label, cohesive layout, mobile-respectable, sensible defaults, stable on input, pedagogy hooks, manipulation embodies the mechanism), the title / concept / slug rules, and the validator constraints all live here:

${INTERACTIVE_CONTRACT}

# Sandbox compatibility — the file runs inside <iframe sandbox="allow-scripts">

The validator at \`agents/src/interactive-validator.ts\` is the gate; its eight rules are listed in the contract above. The notes below are practical authoring guidance — the validator catches what it can pre-flight; the sandbox catches the rest at runtime.

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

# Diversity with past interactives

You're shown titles + concepts of the most recent interactives. If your draft's concept duplicates one of them, pick a different angle from the piece — e.g. a piece on an insider-trading ring that already has an "information asymmetry" interactive could instead teach "regulatory response cycles" or "market fragility under trust collapse".

If you genuinely cannot find a non-duplicating teachable concept in this piece — for example the piece's concept is fully covered by recent interactives — decline. Return the empty shape described below.

# Reference example — what a passing HTML interactive looks like

The file below is the canonical reference for shape, voice, structure, and essence. It teaches **chokepoints** — a narrow point in a system constrains what flows through, regardless of upstream supply. One slider compresses the chokepoint; three input lanes stay full while three output lanes shrink in lockstep; the live caption names what's binding ("upstream supply" → "the chokepoint, just barely" → "the chokepoint" → "the chokepoint, severely"). Mobile-respectable via a single \`@media\` query that flips the pipeline from horizontal to vertical at 480px.

Use this as a structural and voice template, NOT as content to copy. If your piece's concept is also chokepoints, build something that teaches the SAME concept differently — a different mechanism, a different control, a different visual. If your piece's concept is something else (asymmetry / threshold / coalition-math / amplification / displacement / etc.), the example shows the SHAPE you should mirror but the actual mechanism must come from your piece's concept.

What to copy from the reference:
- One clear control. A range slider with a label, a current-value readout, and a generous min-width.
- Sensible defaults. Initial state shows something teaching, not a blank canvas.
- Pedagogy hooks. Manipulation produces a visible response in multiple places (lanes shrink, throughput readout updates, caption changes).
- Voice. Short imperatives ("Drag to compress the chokepoint"), terse labels ("Capacity:", "Inputs", "Outputs"), declarative captions, no flattery, no tribe words.
- Mobile. A single CSS @media query handling layout flip; nothing more elaborate.
- Self-contained. Inline CSS in a single \`<style>\`, inline JS in a single \`<script>\`, no external scripts.

What NOT to copy from the reference:
- The specific concept (chokepoints) — derive from your piece's underlying subject.
- The specific colours (the reference uses Daylila's gold + teal + cream palette; you can use the same or pick palette-neutral defaults).
- The specific copy strings — voice rules apply, but text comes from YOUR concept.

\`\`\`html
${INTERACTIVE_HTML_REFERENCE}\`\`\`

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

/**
 * HTML twin of buildJsonRepairPrompt — used when the prior round's
 * HTML response failed `parseAndValidateHtml` (Claude returned non-JSON
 * for the envelope, e.g. unquoted concept value or unescaped quote
 * inside the `html` string). Same intent: tell Claude its previous
 * attempt was malformed JSON, ask for a fresh attempt with valid JSON.
 */
export function buildHtmlJsonRepairPrompt(
  brokenHead: string,
  piece: PieceContextForInteractive,
  recent: RecentInteractive[],
  round: number,
): string {
  const previousBlock = `## Previous attempt (round ${round - 1}) — DID NOT parse as valid JSON

The first ~200 characters of what you returned:

${brokenHead}`;

  const instruction = `## What to do

Re-emit a fresh HTML interactive as valid JSON. Every string value MUST be enclosed in double quotes, and every \`"\` inside the \`html\` string MUST be escaped as \`\\"\`. Use the exact JSON shape:

{ "slug": "...", "title": "...", "concept": "...", "html": "<!DOCTYPE html>..." }

This is a JSON-validity issue, not a content issue. Re-derive the concept from the piece's underlying pattern as you would on a fresh attempt; do not try to reconstruct the malformed previous output.

If the piece's concept cannot be taught cleanly in a standalone HTML interactive, decline — return the empty shape {"slug":"","title":"","concept":"","html":""}.`;

  const pieceBlock = `## The piece (source — DO NOT reference directly)
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

  return `${previousBlock}\n\n${instruction}\n\n${pieceBlock}${recentBlock}`;
}
