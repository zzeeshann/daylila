# 17 — Zita: the deep agent Daylila doesn't yet have

*Status: vision chapter. Zita exists in shallow form today. This chapter describes what Zita could become, and why that version is the one that matters most. When Zita actually works this way, this chapter will be rewritten as documentation of reality. Until then, it is a statement of direction.*

*Update (2026-04-21): the design document this chapter calls for — see "The honest order of operations" below — has been written and lives at [`docs/zita-design.md`](../docs/zita-design.md). Decisions have been made for each of the six questions this chapter poses (multi-turn state, tools, library index, failure modes, human handoff, voice testing). The design stage is complete; the build has not started. Shallow Zita has also received its own improvements in the meantime — conversations are now scoped by piece_date so they don't pool across different days, the per-turn history is bounded, the admin can see what readers are asking via `/dashboard/admin/zita/`, safety events land in the observer feed, and the P1.5 learning loop is wired so Zita's questions feed `source='zita'` rows into tomorrow's Drafter prompt. See `CLAUDE.md` "Zita improvement plan" for the 2026-04-21 six-phase rollout.*

---

Zita is the small conversational helper at the bottom of every Daylila piece. Right now, it asks readers questions. You've finished the piece on chokepoints. Zita says: *Can you think of a chokepoint in your own life — a single point of failure that an entire system depends on?* You type an answer. Zita asks a follow-up. That's roughly all.

This is Zita as a shallow agent. One Claude call, one prompt, a handful of turns, no memory past the current session. It works. It's also not the Zita Daylila needs.

The Zita Daylila needs is a deep agent. This chapter is about what that actually means, and why Zita — of all sixteen roles — is the single highest-leverage piece of work left in this project.

## Deep versus shallow, again

Chapter 6 drew the line. A shallow agent makes one decision, then stops. A deep agent is given a goal and decides what to do next from a menu — call a tool, search for context, follow a thread — and keeps going until the goal is met.

Most of Daylila's sixteen roles are shallow by design. Curator picks a story and stops. Drafter writes a piece and stops. Stopping is a feature. Stopping is what keeps the system reliable.

But a reader learning something new is not a single decision. A reader learning is a conversation that unfolds. The first question reveals what the reader already knew. The second reveals what they misunderstood. The third reveals what they're actually curious about. A shallow agent cannot follow this arc. A deep agent can.

## What a deep Zita could do

A deep Zita would remember this conversation. Not just the current turn — the whole conversation across a session. What has been discussed. What the reader got right. Where they stumbled.

A deep Zita would remember past conversations. If a reader asked about chokepoints two weeks ago and is now on a piece about hedging, Zita should be able to connect the two: *You wondered last week whether your employer had a chokepoint. That's the same question as what an airline's fuel hedge protects against. Here's why.*

A deep Zita would have access to the library. Every piece Daylila has ever published would be indexed. If a reader asks about a pattern that appeared earlier, Zita could find it and reference it: *Three weeks ago we wrote about why incumbents fail. The same pattern explains why QVC couldn't adapt.* That's a connection a reader can't make alone, because no reader has read three weeks of Daylila in a row. The system has.

A deep Zita would know when to answer versus when to ask. Socratic questioning is the default, but sometimes a reader needs an answer, not another question. Knowing the difference — and choosing on purpose — is a judgment a shallow agent cannot make. A deep one can.

A deep Zita would adapt to the reader. A reader who answers in short, definite sentences wants different questioning than one who answers in hedged paragraphs. A twelve-year-old needs different language than a fifty-year-old. The current Zita treats every reader the same because it only sees one message at a time. A deep Zita would see the whole of a reader and shape itself.

## What needs to be built

This is not free. A deep Zita requires real infrastructure that doesn't exist yet.

**Conversation memory.** A store of every message, per reader, queryable so the next reply can be informed by everything said so far. The `zita_messages` table exists, but nothing currently reads from it when composing a reply.

**Library search.** An index of every published piece, searchable by concept and keyword. When Zita wants to reference the QVC piece, it needs a way to find it. This doesn't exist.

**A tool-use loop.** Today's Zita is one Claude call. A deep Zita is many calls — it plans, fetches context, drafts a reply, revises. Anthropic's API supports tool use well. Using it well takes design.

**Guardrails that hold over long conversations.** A deep agent with tools can be led astray by a clever reader. Prompt injection, jailbreaking, conversations that drift off-topic. Most guardrails slowly leak across fifty turns. Zita's guardrails have to stay strong.

**Voice consistency across long conversations.** A shallow agent only has to sound like Daylila once. A deep agent has to sound like Daylila across many replies without drifting into generic chatbot register.

None of this is impossible. All of it is work. Weeks of careful building and months of iteration, if done well.

## Why this is the real work

Everything else in Daylila produces the teaching. Zita is where the teaching actually lands.

A piece that is read but not absorbed is a failed teaching. A piece that provokes one good question in one reader — and then helps that reader think the question through — is a successful teaching. Zita is the instrument of that moment.

Zita is also, practically, the richest source of the learning signal that makes the whole system compound. Chapter 14 named four signals. Reader behaviour tells you *that* a reader stopped reading at beat 3. Zita tells you *why*. The questions readers ask reveal what the piece failed to teach — and those revelations feed directly into the next piece's prompt.

So Zita is both where learning lands and how the system learns. That's not true of any other role in the pipeline. Scanner reads. Publisher commits. Audio narrates. Zita teaches and is taught, at the same time.

Making Zita deep is the work that turns Daylila from a daily teaching publication into a daily teaching practice. The pieces are important. Zita is where the pieces become something that happens *to* a reader, not something that merely appears in front of them.

## The honest order of operations

It's tempting to start writing code for a deep Zita tomorrow. Don't.

Before code, write a design document. `docs/zita-design.md`. What multi-turn state does Zita need? Which tools should it have access to — just the current piece, the full library, external web search? Where will the library index live? What failure modes are you most worried about, and what would happen if each one fired? Which reader behaviours would cause Zita to explicitly hand off to a human?

The design doc is the slow thinking before the fast building. It's cheap to write. It's the thing that stops you from shipping a deep agent that looks impressive in a demo and falls apart under the first clever reader.

After the design, the build. After the build, the testing. After the testing, the replacement of this chapter with a description of what actually works.

The order matters. Design doc. Build. Test. Document. Anything shorter than this and Zita will be another half-deep agent — impressive-seeming, unreliable, and quietly causing problems that are hard to debug six months in.

## What this chapter is, honestly

A promise in the gentlest sense. Not a commitment to a timeline. A commitment to a direction.

When Zita is actually deep, this chapter is rewritten. It will lose the asterisk at the top. It will describe what Zita does, not what it could do. Until then, the gap between this chapter and reality is the measure of the work ahead — and the reason the work matters.

The Zita a reader meets today asks thoughtful questions within a single session. The Zita described in this chapter would know the reader across months, remember every conversation they've had, connect today's piece to last month's pattern, and shape its voice to the reader it's talking to.

The second one is what Daylila is for. The first one is where we are today. The distance between them is the work.
