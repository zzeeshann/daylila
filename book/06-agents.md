# 06 — What is an agent? (And what it's not)

The word "agent" has had a rough year. It's been used to mean so many different things by so many different products that by the time you see "16 AI agents" on a website, you might reasonably wonder whether the phrase means anything at all.

This chapter is about what the word actually means, what it doesn't mean, and what Daylila's 16 agents actually are.

## The simplest definition

An **agent**, in the context of AI software, is a program that uses a language model to decide what to do next, then does it, and repeats.

The key word is *decides*. A regular program has its steps written out by a human ahead of time. An agent has some of its steps decided at runtime by the model, based on what the program has seen so far.

Here is a regular program:

```
1. Get the news headlines.
2. For each headline, check if it's about politics.
3. If yes, discard. If no, save.
```

Here is an agent-shaped program doing the same thing:

```
1. Get the news headlines.
2. Send the headlines to the model with this question:
   "Which of these are teachable and which are just noise?
   For each teachable one, explain what a reader could learn."
3. Use the model's answer to decide what to save.
```

The difference is where the judgment happens. In the first version, the judgment is in step 2 and was written by a programmer ("is it about politics"). In the second version, the judgment is delegated to the model at runtime.

That's the essential thing. An agent is a program that moves some of its decision-making from design-time to runtime, and delegates those decisions to a language model.

## The spectrum

There's a spectrum of how much decision-making gets delegated.

**Shallow agent.** The program has one clear job. It calls the model once, uses the answer, and moves on. Most of Daylila's agents are this shape. Curator calls Claude once to pick a story. Voice Auditor calls Claude once to check voice. Done.

**Deep agent.** The program lets the model decide what to do next from a menu of options, then carries out that action, then asks the model what to do next, and so on. This is what people usually mean when they talk about "autonomous AI agents." A deep agent might be able to use tools (call APIs, search the web, run code) and chain them together without a human specifying each step.

Daylila's agents are mostly shallow. Each one has a fixed job. The decision about *which* job runs next is handled by the Director, which does not itself use a model at all. It just routes.

A deep agent is harder to build reliably. It tends to wander, make expensive mistakes, or get stuck in loops. Most production systems use shallow agents wired together into a fixed pipeline. That's what Daylila does.

## What an agent is NOT

A single call to an LLM is not an agent. If you have a chat window where you type a message and the model replies, that's just a **chatbot**. No agent.

A piece of code that uses regular expressions to pull information out of text is not an agent. There's no model in the loop.

A "robot" or "assistant" marketed on a website is not necessarily an agent. Marketing departments use the word loosely.

And most importantly: **an agent is not an independent mind.** An agent does not wake up and decide what to do with its day. An agent runs when it's called, makes one decision (or a few), and stops. Between runs, it doesn't exist in any meaningful sense — it's just code, waiting.

When you see "16 agents," don't picture 16 little people. Picture 16 specialised functions, each with one job, each using an LLM for one specific decision. That's what agents are in practice.

## Daylila's sixteen roles, rated by agent-ness

Not all of Daylila's "agents" actually use a language model. Being honest about this matters. Here's the breakdown:

**Real agents (uses Claude for its decision):**
- Curator — picks the most teachable story, writes the brief
- Drafter — writes the piece, and separately reflects on it
- Voice Auditor — judges whether the piece follows the voice contract
- Fact Checker — judges whether the claims are correct
- Structure Editor — judges whether the piece flows well
- Integrator — takes auditor feedback and revises
- Learner — looks at signals and writes patterns
- Categoriser — assigns 1–3 library categories to each piece post-publish, strongly biased toward reusing the existing taxonomy
- Interactive Generator — produces a quiz that teaches the same underlying concept as the piece, without referencing it
- Interactive Auditor — judges that quiz across voice, structure, essence, and factual dimensions

**Orchestrators and workers (no model, just code):**
- Scanner — fetches news RSS feeds, dedupes
- Director — routes work between agents, zero model calls
- Audio Producer — calls ElevenLabs (a different kind of AI, for voice), no Claude
- Audio Auditor — checks file sizes in R2
- Publisher — commits to GitHub
- Observer — logs events

So of the sixteen, ten are "really agents" in the sense of using a language model to decide something. The other six are supporting code — necessary, but not making language-model decisions.

This is typical. A system doesn't need all its parts to be agents. It needs the right parts to be agents and the right parts to be plumbing.

## Why the sixteen are split the way they are

The design principle, stated plainly: give each role one job, and make that job either "use code" or "use the model," never both mixed into one file. This keeps the code easy to read and easy to change.

If Drafter had Scanner's job glued onto it, the Drafter file would be hard to reason about. What does Drafter do? It fetches RSS and writes MDX. But why? Because a human wrote it that way twelve months ago and now we can't change it without breaking things.

By keeping each agent's job small and focused, Daylila stays changeable. Six months from now, if a new news source needs to be added, only Scanner changes. If the voice contract changes, only Voice Auditor changes. This is the whole reason to use the agent framing at all: it organises the code into small, changeable pieces.

The 16-agent framing is true at the level of "this is how the code is organised." It is not true at the level of "these are independent collaborating minds." Don't confuse the organising principle with an autonomy claim.

## Where the rules live

Each agent needs rules. Drafter needs rules about what voice to write in. Curator needs rules about what makes a story teachable. The Voice Auditor needs the same rules Drafter used, so it can check the work against them.

A rule that lives in two places drifts. Change it in one file, forget the other, and the auditor stops agreeing with the writer. Coordinating one rule change across four files in a single afternoon is not a hypothetical here — it has happened.

The fix is one file per rule. The voice contract is the first one — `content/voice-contract.md`, plain markdown that any agent can read at runtime. Anything that needs to know how Daylila sounds reads from that one file.

There is one wrinkle. The agents run on Cloudflare Workers, and Workers cannot read files off disk at runtime. Until May 2026 the workaround was a parallel TypeScript file that mirrored the markdown by hand — and, predictably, the two drifted. The mirror lost the bold markers. It restructured a bullet list into prose. Nobody noticed. So at build time, a small script now reads the canonical markdown and embeds it into the agents bundle as a string. Editing the markdown is enough. The script is `agents/scripts/codegen-contracts.mjs`; the output is checked in so the diff is visible; a verifier in CI fails the deploy if anyone forgets to regenerate.

Most other rules — what counts as a teachable story, how long a piece should be, how a quiz should be shaped — still live inside the prompts that use them. Some are copy-pasted across two or three prompts. Those are being moved out, one rule at a time, into their own markdown files. Same shape as the voice contract: one file, every agent reads from there. As of 2026-05-05, three contracts have moved out: the voice contract (how Daylila sounds), the beat contract (how daily pieces are shaped), and the interactive contract (how quizzes and HTML interactives are shaped). The remaining clusters — fact-check, curator, audio, categoriser — follow next.

## The question to ask about any agent system

When someone shows you a system with agents, ask: *what does each agent decide, and what's the consequence if it decides wrong?*

If the agent decides what colour to paint a button, the stakes are low. If the agent decides whether to send a legal document, the stakes are high.

Daylila's agents decide things like "which story to cover" and "does this piece follow the voice contract." Medium stakes. The quality gates exist because the Drafter might write something off-voice. The fact checker exists because the Drafter might be confidently wrong. The Integrator exists because the auditors might flag real issues that need fixing.

The stakes shape the architecture. Higher stakes, more gates, more review. Daylila's gates are enough for a daily teaching piece. They would not be enough for a medical diagnosis system. Know what you're building.
