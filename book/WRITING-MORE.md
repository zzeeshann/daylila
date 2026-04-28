# Writing More Chapters

*Instructions for Claude Code, or for a future Claude session, on how to expand the outline chapters into full ones without the voice drifting.*

---

## The voice

Read one of the written chapters first (chapter 06, 08, or 14 are good choices). Notice the voice. It is the same voice Zeemish itself uses when it publishes a daily piece. That voice is not an accident and it is not interchangeable with a generic tech-writing voice.

The voice rules, in brief:

- Plain English. No jargon without immediate translation in the same sentence.
- Short sentences. Direct. Honest. No flattery.
- Specific beats general. A real example is worth three abstract ones.
- Trust the reader. Never tell them they're doing great.
- No tribe words: no "journey," "unlock," "dive in," "transform," "empower," "embrace," "mindfulness," "wellness."
- The hospitality principle: a Hindu grandmother in Delhi, a Muslim teenager in Bradford, an atheist programmer in Berlin, a Catholic nurse in Manila — they should all read the same chapter and feel it was written for them.

If in doubt, open `content/voice-contract.md` in the Zeemish repo. The same contract applies.

## The shape of a chapter

Most written chapters follow this shape. You don't have to, but it's a good default.

1. **Hook.** One or two sentences that name what the chapter is about, in a way that makes someone want to keep reading.
2. **The simplest explanation.** Before the nuance. Before the jargon. What is this thing, at the level a child could grasp?
3. **The middle.** The actual content — how it works, why it works that way, what the parts are.
4. **The specific.** One real example from Zeemish or from the wider world. Specific beats general.
5. **The close.** One or two sentences that land. Often these tie back to the hook.

Aim for 600–1200 words per chapter. Beginner books work best when chapters are short enough to finish in ten minutes.

## Diagrams

Use Mermaid where a diagram genuinely helps. GitHub renders Mermaid natively. The flowchart in chapter 10 is a good reference — simple, linear, labelled.

Don't use a diagram to show off. Use one when the prose alone would be clumsier.

## How to write a new chapter

Say the chapter you're expanding is `01-what-is-the-internet.md`, which currently has just an outline.

1. Read `00-preface.md` and at least one written chapter to internalise the voice.
2. Read the outline that already exists in the target file. It tells you what needs covering.
3. Read the glossary (`99-glossary.md`) — if the chapter introduces a new term, add it there too, in the same commit.
4. Write the chapter. Follow the shape above. Keep it under 1200 words unless the topic genuinely requires more.
5. Update `CONTENTS.md` — change the chapter's status from ○ to ✓.
6. Commit with a message like `book: write chapter 01 (what is the internet)`. Docs-level commit. No code changes.

## What not to do

- Do not rewrite chapters that are already written. If you think a written chapter has a real error, flag it and wait for a human decision.
- Do not add marketing language. This book is a teaching tool, not a pitch.
- Do not pad. If a chapter is 700 words and says everything it needs to say, stop. Length is not quality.
- Do not use "we" in a way that excludes the reader. When Zeemish is the actor, name Zeemish. When the reader is part of the action, say "you."

## When the book is done

The book is never done. New chapters get added as the system grows. If a new agent is introduced to Zeemish, a new chapter follows. If a major architectural change ships, the relevant chapter is updated or a new appendix is written.

The book grows the way the system grows. Incrementally. Honestly. Versioned in the same repo so the two can't drift out of sync without someone noticing.
