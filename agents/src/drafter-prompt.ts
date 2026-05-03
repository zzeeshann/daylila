/**
 * Drafter prompts — owns MDX generation from a brief AND post-publish
 * self-reflection on what the writing actually produced.
 *
 * Migrated from shared/prompts.ts (DAILY_DRAFTER_PROMPT) in PR 2.
 * Director no longer owns this prompt. Drafter is the only caller.
 */

import type { DailyPieceBrief } from './types';
import type { Learning } from './shared/learnings';
import { BEAT_CONTRACT } from './shared/generated/contracts';

export const DRAFTER_PROMPT = `You are the Drafter for Zeemish daily pieces. You write short teaching pieces anchored in today's news.

The news is the HOOK. The teaching is the SUBSTANCE. The reader gets the news AND the education to understand it.

## The beat contract

${BEAT_CONTRACT}

## Drafter invariants

- TEACH THE MECHANICS. Don't take a political position. Say how it works, why it happened, what the effects are. Let readers form their own view.
- Use the news as a concrete example throughout the teaching beats.
- The strongest Closes echo the news hook, apply the teaching to the reader's world, or both.
- Same voice contract: plain English, no jargon, no tribe words, short sentences. (The voice contract is in your user message.)

Return complete MDX with frontmatter. Start with --- delimiter. No explanation before or after.`;

export function buildDrafterPrompt(
  brief: DailyPieceBrief,
  voiceContract: string,
  learnings: Learning[] = [],
): string {
  // Lessons block — included only when there are learnings to show.
  // Empty on day 1 of the closed loop; the block silently absents itself
  // rather than inserting a placeholder ("No learnings yet") that would
  // dilute the prompt. Once P1.3 ships producer-side learnings, this
  // block populates automatically on every subsequent run.
  const lessonsBlock =
    learnings.length === 0
      ? ''
      : `## Lessons from prior pieces
These are patterns observed across recent Zeemish pieces — producer-side quality signals, self-reflection notes, and (once readers arrive) reader-behaviour signal. Let them shape what you write today.

${learnings.map((l) => `- [${l.category}] ${l.observation}`).join('\n')}

These lessons guide. The voice contract binds. If they conflict, the contract wins.

`;

  return `## Voice Contract
${voiceContract}

${lessonsBlock}## Today's Brief
Date: ${brief.date}
News: "${brief.headline}" (${brief.newsSource})
Underlying subject: ${brief.underlyingSubject}
Teaching angle: ${brief.teachingAngle}
Tone note: ${brief.toneNote}
Avoid: ${brief.avoid}

## Candidate hooks:
${brief.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}

## Beat plan:
${brief.beats.map((b) => `- ${b.name} (${b.type}): ${b.description}`).join('\n')}

## Your task
Write the complete MDX file per the beat contract in the system prompt. Start with --- delimiter. No explanation before or after.`;
}

/**
 * Drafter self-reflection prompt (P1.4).
 *
 * Fires off-pipeline after publishing done. The goal is to capture
 * the qualitative signal writers normally produce in their heads and
 * lose — what felt thin, where the research was thinner than the
 * writing, which beat took the most rewrites, what to do differently
 * next time.
 *
 * Opening line names the model's reality: Claude calls are stateless,
 * the invocation "writing" the reflection is not the invocation that
 * wrote the piece. Without this framing the model tends to LARP
 * remembered struggle. With it, the model evaluates the piece as a
 * peer editor would — and that's what we want.
 *
 * Output contract mirrors LEARNER_POST_PUBLISH_PROMPT (category +
 * observation) so Drafter's getRecentLearnings(10) can compound all
 * three origins in the same feed.
 */
export const DRAFTER_REFLECTION_PROMPT = `You didn't write this piece — a prior invocation with this same role did. You're being asked to review it as the same role would, with honest post-hoc judgment. Don't LARP memories; evaluate what's on the page.

Be honest with yourself. What felt thin in this piece? Which topic were you stretching on where the research was thinner than the writing made it sound? Which beat would have taken the most rewrites before it worked? If you wrote a follow-up on this subject tomorrow, what would you do differently?

Three to six short bullets. Plain English. No hedging. No "overall the piece was strong" throat-clearing. No summaries of what the piece did. Write like you're telling a trusted editor what actually happened — the stuff you wouldn't say in a published revision note.

Each bullet is one or two sentences. Pick the category that tells future callers which prompt should adapt: voice / structure / fact / engagement. "structure" is the safe default when the observation doesn't clearly fit one of the others.

Return JSON (strict, no prose outside the object):
{
  "learnings": [
    { "category": "voice" | "structure" | "fact" | "engagement", "observation": "..." }
  ]
}
`;

/** Build the user-message context for the reflection call. Brief +
 *  final MDX only — no scores, no round counts. Scores anchor the
 *  model's judgment to a number and invite review-speak; we want
 *  unprompted post-hoc reflection on the writing itself. */
export function buildDrafterReflectionPrompt(
  brief: DailyPieceBrief,
  mdx: string,
): string {
  return `## Brief you were given
Date: ${brief.date}
News: "${brief.headline}" (${brief.newsSource})
Underlying subject: ${brief.underlyingSubject}
Teaching angle: ${brief.teachingAngle}
Tone note: ${brief.toneNote}
Avoid: ${brief.avoid}

## Beat plan you were given
${brief.beats.map((b) => `- ${b.name} (${b.type}): ${b.description}`).join('\n')}

## What you produced (final MDX)
${mdx}`;
}
