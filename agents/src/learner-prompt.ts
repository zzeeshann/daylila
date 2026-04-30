/**
 * Learner prompts — extract actionable learnings, one prompt per origin.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * LearnerAgent is the only caller.
 *
 *  - LEARNER_ANALYSE_PROMPT       → reader-engagement signals (analyseAndLearn)
 *  - LEARNER_POST_PUBLISH_PROMPT  → producer-side signals (analysePiecePostPublish)
 */

export const LEARNER_POST_PUBLISH_PROMPT = `You analyse the pipeline record of a just-published Zeemish daily piece to extract producer-side learnings for future pieces.

You see:
- The piece's metadata (headline, subject, beat count, word count, final voice score, revision rounds).
- Every audit round's findings — voice violations, structure issues, fact-check claims.
- Which news candidate Curator picked from Scanner's shortlist, and a few it skipped.
- Aggregated reader engagement on PRIOR pieces' interactives (quizzes + HTML interactives) over the last 14 days. THIS piece's own interactives haven't run yet, so the engagement signal is necessarily about pieces that came before — patterns there inform what shapes work.
- The pipeline timeline so you can spot which step took longest.

For interactive engagement, the meaningful ratios are:
- starts / views — did readers who scrolled to the iframe actually engage? (Low ratio = the artefact's affordances aren't obvious.)
- completions / starts — for quizzes, did the question set hold attention?
- avgScore (quizzes only) — high score with low starts means the quiz is too easy AND nobody's playing; low score with high starts means readers misread the underlying concept.
For HTML interactives, views=0 is normal pre-deploy and indicates "not yet measured" rather than "skipped".

Your job is the system's own reflection: what held up, what didn't, what patterns are worth remembering so future pieces go smoother.

Good producer-side learnings:
- "Beat count of 8 required 3 revision rounds; target 4–6 unless the subject genuinely demands more."
- "Voice auditor repeatedly flagged 'jargon without immediate translation' when the piece taught a named theory (innovator's dilemma). Translate named frameworks on first mention."
- "Fact-checker web_search returned \`unavailable\` — claims verified against training data only. High-stakes numbers (dollars, dates, headcounts) deserve an explicit sanity check in the brief when this happens."
- "Hook opened with a specific number (96 million households); zero structure violations on the hook across all rounds. Specific-number hooks held up."
- "Quizzes on systems-mechanics pieces (chokepoints, cascades, traceability) showed completions/starts ≥0.4; quizzes testing identity/value subjects sat below 0.2. Where the quiz tests a process, completion holds. Where it tests an interpretation, readers bail."

Rules:
- Return between 0 and 10 learnings. Zero is fine if nothing was notable.
- Producer signal only — drawn from what the engagement data shows, not speculation about why readers behaved a certain way.
- No hedging. No "might", "could", "perhaps".
- Each learning is one sentence, optionally followed by a prescriptive sentence.
- Pick the category that tells future callers which prompt should adapt: voice / structure / fact / engagement. Use "engagement" for learnings derived from interactive engagement data; "structure" is fine when in doubt elsewhere.

Return JSON (strict, no prose outside the object):
{
  "learnings": [
    { "category": "voice" | "structure" | "fact" | "engagement", "observation": "..." }
  ]
}
`;

export const LEARNER_ZITA_PROMPT = `You analyse Zita chat conversations from readers of a Zeemish daily piece to extract learnings about where the piece succeeded and failed as a teaching artifact.

You see:
- The piece's metadata (headline, subject).
- Every conversation between a reader and Zita (Zeemish's Socratic learning guide), grouped by reader.
- Each reader's full turn-by-turn transcript.

You do NOT see engagement metrics (views, completions, drop-off) — only the Zita chats. Your job: find the patterns in what readers struggled with, misread, or asked beyond the piece, so future pieces can teach those points more clearly on first pass.

Good Zita-side learnings:
- "Readers repeatedly inverted the chokepoints framing — the piece called them 'a bug that looks like a feature' but 3 of 4 readers paraphrased it as 'feature'. First-mention phrasing needs to land harder."
- "Every conversation about the tariff piece eventually asked the same question: 'does the government pass the refund to consumers?' — the piece doesn't answer it. Worth a beat."
- "Two readers asked Zita for article recommendations; Zita honestly declined. The 'no catalogue access' refusal is fine, but the demand is a signal that cross-piece navigation is missing from the reader surface."
- "Readers who engaged past 3 turns consistently opened with vague remarks ('that's interesting', 'what do you think?') and Zita had to pull specifics out of them. Hook might be losing readers before the first concrete claim lands."

Rules:
- Return between 0 and 10 learnings. Zero is fine if nothing was notable.
- Pattern signal only, not per-conversation summary. A one-off is not a pattern; recurrence or a striking single exchange is.
- No hedging. No "might", "could", "perhaps".
- Each learning is one sentence, optionally followed by a prescriptive sentence.
- Pick the category that tells future callers which prompt should adapt: voice / structure / fact / engagement. "engagement" is the right default for reader-comprehension signals.

Return JSON (strict, no prose outside the object):
{
  "learnings": [
    { "category": "voice" | "structure" | "fact" | "engagement", "observation": "..." }
  ]
}
`;

export const LEARNER_ANALYSE_PROMPT = `You analyse reader engagement data to extract learnings for future writing.

Published pieces are permanent. Your job is to identify PATTERNS — what works, what doesn't — so future pieces are better.

Given engagement data for an underperforming piece, extract 2-4 specific, actionable learnings.

Examples of good learnings:
- "Hooks that open with a specific number get 20% higher completion than hooks that open with a question"
- "Teaching beats longer than 400 words show sharp drop-off — keep under 350"
- "Readers drop off when the subject shifts from concrete to abstract without a bridge example"

Return JSON:
{
  "learnings": [
    "specific actionable learning 1",
    "specific actionable learning 2"
  ]
}`;
