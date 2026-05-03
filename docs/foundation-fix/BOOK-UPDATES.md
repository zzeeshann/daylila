# Book Updates — Foundation Fix Programme

**Status:** Active. Applies to every task in the Foundation Fix programme.

**Purpose:** The book (`book/`) is one of Zeemish's four transparency surfaces. The other three update automatically (dashboard counters, the "How this was made" drawer per piece, the README on every commit). The book is the slowest and the most important — it's the one humans read end-to-end.

This file defines how the book gets updated alongside the engineering work, so it never drifts from the running system again.

**The principle:** the book updates in the same commit as the code, not after. Same as `docs/`. Skipping the book update is not allowed; it's part of "what success looks like" for every task.

---

## What the book is

Sixteen chapters, written in plain English in the same voice as the daily pieces. Each chapter explains one part of the system — what it is, what it does, and *why it was built that way*. The README says what the software does. The book says why.

Hospitality principle holds. A reader in Delhi, Bradford, Berlin, or Manila — anyone reads it, anyone gets it.

Claude Code knows the existing book contents; it can read `book/` to see what's there. This document does not duplicate that. It only specifies what to change.

---

## How each task updates the book

Every task in the programme has at least one book chapter that touches its subject matter. The task is not complete until the relevant chapter has been updated and the change is in the same commit as the code.

### Per-task book responsibility

| Task | Likely affected chapter(s) | What to update |
|------|---------------------------|----------------|
| 01 — Rule Inventory | Chapter on agents and how they receive instructions | Note that rules are being consolidated into `.md` contracts; voice contract is the model. |
| 02 — Rule Extraction | Same chapter, plus any chapter that references a specific rule | When a contract gets extracted, update the chapter that names that rule to reference the contract file. |
| 03 — Curator Fix | Chapter on the Curator (or on selection/judgment) | Now records pick reasoning and rejection reasons. Explain why this matters for transparency and future learning. |
| 04 — Learner Loop | Chapter on the self-improvement loop | The loop is now closed. Explain in plain English what "closed" means: learnings get marked when applied, validated when subsequent pieces score well. |
| 05 — Audio Audit | Chapter on audio narration | Audio audit verdicts now persist properly; metadata complete. Brief mention. |
| 06 — Draft Revisions | Chapter on the audit-and-revise loop | Every revision now persists with the Integrator's reasoning per feedback item. Explain why this matters: it makes "How this was made" honest. |
| 07 — Dwell Time | Chapter on reader engagement (if one exists) — or add a paragraph to the closest fit | Audio dwell now flows from frontend to D1. Brief mention. |
| 08 — Retention + Run ID | Chapter on data and infrastructure | Retention policy live; run_id end-to-end. Explain why retention is honest engineering: keeping data forever isn't a virtue when most of it is process noise. |

If a chapter doesn't yet exist for a topic the task touches, the task creates a short addition to the closest existing chapter rather than a new chapter. New chapters come at programme close (see "After the programme" below).

### What "update" means

Not a full rewrite. The book is mostly stable. An update means:

- A new sentence or paragraph reflecting what changed
- A small explanation of *why* the change happened (the book's job)
- Removal of any line that's now factually wrong

If a task changes Curator behaviour, the Curator chapter gets one or two sentences explaining that as of YYYY-MM-DD, the system records its reasoning for both picks and rejections. The reader doesn't need engineering details. They need the *why* — that recording reasoning is how Zeemish will learn from its own taste over time.

### Voice rules for book updates

Same as the daily pieces. Same as the existing book chapters.

- Plain English. Short sentences.
- No tribe words ("unlock", "transform", "dive in", "embrace", "mindset", "journey").
- No flattery toward the reader.
- Specific over general. Numbers, examples, concrete behaviour.
- Trust the reader. They can handle technical concepts when explained plainly.
- No jargon without immediate translation. If a sentence introduces "embedding" or "vector" or "schema migration," the next sentence translates it.

If Claude Code drafts an update that uses a tribe word, reject it and rewrite.

---

## Glossary section

A new section is being added to the book: a glossary, sorted alphabetically, with plain-English definitions of every technical term used anywhere in the book.

This is not a separate book. It's a section *of* the book — likely the last section before any conclusion the book already has.

### Why a glossary

The book already explains terms when it introduces them. A glossary is the *index* for that — somewhere a reader who's already three chapters in can quickly look up "wait, what was a vector again?" without scrolling back through earlier chapters.

It also serves a second purpose: when a future chapter introduces a new term, the author (whether human or Claude Code) can check whether that term is already defined elsewhere and reuse the existing definition rather than inventing a new one. Consistency over reinvention.

### Glossary entries to seed

These are the terms the book already uses or will use as the foundation work and forward roadmap unfold. Each entry is two to four sentences in plain English.

**Agent**  
A small, focused piece of software that does one job in the Zeemish pipeline. Sixteen agents work together to produce each daily piece. Examples: the Scanner reads the news, the Drafter writes, the Voice Auditor scores how plainly the writing reads. Each agent runs independently; the Director routes work between them.

**Audit (in Zeemish)**  
A check that an automated agent runs against a piece of work before it ships. Voice audits score how plainly the writing reads. Fact audits verify each claim against external sources. Structure audits review the shape of the piece. Three audits must pass before a piece publishes.

**Beat**  
One section of a daily piece. Most pieces have between three and six beats — a hook, two or three teaching beats, a "what to watch" paragraph, and a closing line. Each beat is narrated as a separate audio clip.

**Brief (in Zeemish)**  
A short plan the Curator writes after picking the day's news. It tells the Drafter what to teach, what hook to use, and roughly what shape the piece should take. Briefs are not the final piece; they're the seed.

**Cloudflare**  
The cloud platform Zeemish runs on. Workers (the code), D1 (the database), R2 (the file storage), Vectorize (the search index), and Workers AI (the open-source models) all live there. Zeemish defaults to Cloudflare for any new piece of infrastructure.

**Contract (in Zeemish)**  
A markdown file that defines the rules for one part of the system. The voice contract defines how Zeemish writes. A beat contract would define how pieces are shaped. Agents read contracts at runtime instead of having rules hardcoded into them. One source of truth per topic.

**Curator**  
The agent that picks one news story per run from the ~80 candidates the Scanner pulls. The Curator writes the brief that becomes the day's piece.

**D1**  
Cloudflare's relational database. Zeemish stores most structured data here — pieces, candidates, audit results, learnings, reader engagement.

**Director**  
The agent that orchestrates the others. It calls the Scanner, hands results to the Curator, hands the brief to the Drafter, runs auditors, manages revisions. The Director itself does no reasoning; it just routes work.

**Drafter**  
The agent that writes the MDX of each piece from the Curator's brief. The Drafter loads recent learnings before writing, so the system's writing improves over time.

**Embedding**  
A list of numbers that represents the meaning of a piece of text. Two pieces with similar meaning have embeddings that sit close together in mathematical space, even if they share no words. Used for search by meaning rather than search by keyword. (See also: vector.)

**Embedder (in Zeemish)**  
The agent — to be added in Phase 1 of the platform plan — that turns each published piece, candidate, and audit into an embedding and stores it in Vectorize.

**Fact Checker**  
The agent that verifies every factual claim in a draft. Currently uses Anthropic's Claude with the `web_search_20250305` tool to look claims up against external sources. Each piece publishes with a "Sources consulted" line surfaced from this work.

**Hugging Face**  
A platform that hosts open-source AI models, datasets, and free demo apps called Spaces. Zeemish uses it for the long tail — niche models Cloudflare doesn't host, datasets to publish back to the open ML world, and Spaces to prototype future subdomains for free before committing to Cloudflare.

**Integrator**  
The agent that revises a draft after auditors raise issues. The Integrator decides which feedback to accept, which to overrule, and updates the draft accordingly. Up to three rounds of revision; pieces that fail all three still ship in the Rough tier.

**Interactive Generator**  
The agent that creates the companion quiz at the bottom of each piece. The quiz teaches the same underlying concept the piece teaches, but stands alone — a reader who only sees the quiz still learns something useful.

**Leak (in Zeemish)**  
Data the system produces but does not save. The Foundation Fix programme plugs nine high-severity leaks identified in the data audit.

**Learner**  
The agent that reads four signal sources after each publish — reader engagement, the audit record, the Drafter's self-reflection, and reader questions to Zita — and writes patterns to the learnings table. The Drafter loads recent learnings the next time it writes, so the system's writing improves.

**MDX**  
A file format that combines Markdown (plain text with simple formatting) with the ability to embed small interactive components. Zeemish writes every piece as MDX so future pieces can include inline charts, definitions, or interactives without changing the file format.

**Neuron (in Cloudflare Workers AI)**  
The unit Cloudflare uses to bill AI inference. Different models cost different numbers of Neurons per request. Zeemish currently runs inside the free daily allocation of 10,000 Neurons.

**Polished / Solid / Rough**  
The three tiers a published piece can land in. Polished pieces pass all auditors on the first round. Solid pieces pass after revisions. Rough pieces fail all three rounds but still ship — a newspaper never skips a day. Readers see the tier marker on each piece.

**Run (in Zeemish)**  
One full pipeline execution that takes one news scan and produces one piece (or fails to). With multi-piece cadence, multiple runs happen per day. Foundation Fix Task 08 adds a `run_id` so each run is traceable end-to-end.

**Scanner**  
The agent that reads the news every few hours from RSS feeds, pulls ~80 candidates per run, and stores them as the raw material the Curator chooses from.

**Tier (in Zeemish)**  
See Polished / Solid / Rough.

**Vector**  
A list of numbers, used in Zeemish to represent the meaning of a piece of text. Each daily piece becomes a vector. Searching the library means turning the search query into a vector and finding the pieces whose vectors are nearest. (See also: embedding.)

**Vectorize**  
Cloudflare's vector database. Stores Zeemish's embeddings and lets the system do nearest-neighbour searches in under a second across thousands of pieces.

**Voice contract**  
A markdown file (`content/voice-contract.md`) that defines how Zeemish writes — short sentences, plain English, no tribe words, hospitality principle. The Voice Auditor scores every draft against it. Other contracts will follow the same pattern as Foundation Fix Phase 1 unfolds.

**Voice Auditor**  
The agent that scores each draft against the voice contract. Drafts must score 85 or higher to pass.

**Workers AI**  
Cloudflare's catalogue of open-source AI models, callable from any Cloudflare Worker via a binding. Zeemish uses it for embeddings, classification, and other open-model tasks.

**Zita**  
A separate agent, not part of the daily pipeline. Zita answers reader questions on the site. Reader questions to Zita are one of the four signal sources the Learner reads from.

### Glossary maintenance rule

When a Foundation Fix task introduces a new concept the book uses, that task's commit also updates the glossary. If a term gets used in book prose without a glossary entry, that's a leak — the same kind of leak the data audit flagged in code, just in documentation.

---

## After the programme

When all eight Foundation Fix tasks are complete, two new chapters get added to the book:

### Chapter: "When the System Outgrew Its Map"

The story of the Foundation Fix itself. Why Zeemish paused to survey before adding more. Written in the same voice as a daily piece — three to six beats, plain English, hook-teach-watch-close. Reads as a piece in its own right.

### Chapter: "What Comes Next"

The forward roadmap, told as story. The subdomain plan. Why search comes first. Why the map matters at month six. The LLM provider abstraction queued for later. Same voice, same shape.

These two chapters are written **at programme close, not during**. They describe the work as a whole, not piece by piece. Drafting them is the final task of the programme, after Task 08 completes. They land in the same commit as the closing FOLLOWUPS update marking the programme done.

---

## What success looks like for the book updates

For each task:

- The relevant book chapter has at least one updated sentence or paragraph reflecting the change.
- The glossary has an entry for any new term the task introduces (plus updates to existing entries if the term's meaning has shifted).
- Voice matches the existing book — short sentences, plain English, no tribe words.
- The book update lands in the same commit as the code change, not after.

For the programme as a whole:

- Two new chapters at close: "When the System Outgrew Its Map" and "What Comes Next."
- Glossary complete and consistent.
- The book end-to-end describes the system as it actually runs, not the system as it was at launch.

---

## What NOT to do

- Do not rewrite existing chapters. The book is mostly stable. Updates are surgical — a sentence here, a paragraph there.
- Do not write the two close-of-programme chapters mid-programme. They get written when the work is done, not while it's still happening.
- Do not skip a book update because "it's only a small change." Every fix changes the system; every change has a *why* worth recording.
- Do not invent new structure for the book unless explicitly approved. The sixteen-chapter shape is settled.
- Do not add a glossary entry for terms not actually used in the book. Glossary follows usage, not aspiration.
