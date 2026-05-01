# ZEEMISH v2 — Project Brief

## What Zeemish is

Zeemish is an autonomous learning platform that turns today's real-world news into daily educational pieces — teaching ordinary people the systems, patterns, and ideas behind what's actually happening in the world.

**The Zeemish Protocol: "Educate myself for humble decisions."**

Every morning, a team of 16 AI agents scans the news, picks the most teachable story, writes a 10-minute piece explaining the underlying system (not just the headline), audits it for voice, accuracy, and structure, narrates it beat-by-beat as audio, categorises it into the growing library taxonomy, generates a standalone companion quiz that teaches the same underlying concept, and publishes it all — autonomously. The human (Zishan) sets direction, watches the dashboard, and intervenes only when needed.

The news is the hook. The teaching is the substance. "Here's what happened" is CNN. "Here's why it happened and how the underlying thing works" is Zeemish.

## Who it's for

Ordinary people who want to understand the world they live in. Not experts. Not students cramming for exams. Adults who know something is going on — with AI, with money, with power, with systems — and want to actually understand it. Willing to give 10 minutes a day. Not willing to wade through jargon, tribes, or self-help language.

## The voice

- Plain English. No jargon without immediate translation.
- No tribe words: no "mindfulness," "journey," "empower," "transform," "wellness," "unlock," "dive in," "embrace."
- Short sentences. Direct. Honest. No flattery.
- Specific beats general. Numbers, examples, research.
- Trust the reader. Never tell them they're doing great.
- The hospitality principle: a Hindu grandmother in Delhi, a Muslim teenager in Bradford, an atheist programmer in Berlin, a Catholic nurse in Manila — they should all read the same piece and feel it was written for them.

## The daily piece format

One piece per day. 1000-1500 words. 3-6 beats:

1. **Hook** — the news, in 2 sentences, then the question that turns it into a lesson
2. **Teaching (2-3 beats)** — the underlying system explained in plain English
3. **Watch** — what to look for next, one paragraph
4. **Close** — one sentence that lands
5. **Companion quiz** — every piece generates a standalone 3-5 question quiz, linked from the last beat. Lives at `/interactives/<slug>/` and teaches the same underlying concept independently of the piece.

## The agent team

| Agent | Job |
|-------|-----|
| Scanner | Fetches news RSS, deduplicates, stores ~50 candidates per run |
| Director | Pure orchestrator — routes work between agents, zero LLM calls |
| Curator | Picks the most teachable candidate, plans beats + hook + teaching angle |
| Drafter | Writes MDX from the brief (voice contract + recent learnings loaded); also reflects on each piece after publish |
| Voice Auditor | Scores voice compliance 0-100, must be ≥85 to pass |
| Fact Checker | Verifies claims using Claude with the Anthropic `web_search_20250305` server tool; the drawer's Facts section ends with a "Sources consulted" line listing the unique domains searched |
| Structure Editor | Reviews hook, beats, pacing, close |
| Integrator | Merges feedback from auditors, revises the draft, up to 3 rounds |
| Publisher | Commits MDX to GitHub — piece goes live within two minutes via GitHub Actions |
| Audio Producer | Narrates each beat via ElevenLabs, saves MP3s to R2 |
| Audio Auditor | Verifies each beat's MP3 in R2 (exists, right size, total under cap) |
| Learner | Writes patterns to a learnings database so tomorrow's draft gets better — reads four signal sources: reader engagement, producer-side audit record, Drafter self-reflection, Zita reader questions |
| Categoriser | Assigns 1-3 library categories post-publish, biased toward reusing the existing taxonomy |
| Interactive Generator | Produces the companion quiz post-publish — teaches the underlying concept without naming the source piece |
| Interactive Auditor | Judges the quiz across voice, structure, essence, and factual dimensions; gates each revision round |
| Observer | Logs every pipeline event to D1 — powers the public dashboard and admin surfaces |

Quality gates: nothing publishes unless Voice Auditor, Fact Checker, AND Structure Editor all approve. Up to 3 revision rounds; pieces that max-fail ship with a low-quality marker (readers see a "Rough" tier tag) rather than skipping the day — a newspaper never skips a day. Self-improvement: the four signal sources above feed tomorrow's Drafter prompt via the learnings database, so the system's writing improves over time.

## The stack

- **Frontend:** Astro + MDX + Tailwind CSS + Web Components + TypeScript strict
- **Backend:** Cloudflare Workers + D1 (SQLite, 19 tables) + R2 (audio + assets)
- **Agents:** Cloudflare Agents SDK — each agent is a Durable Object; post-publish work runs on DO alarms
- **AI:** Anthropic Claude Sonnet 4.5 (single model across the pipeline)
- **Audio:** ElevenLabs (Frederick Surrey, one locked voice)
- **Auth:** Resend (magic-link email), PBKDF2 passwords, anonymous-first
- **Deploy:** GitHub Actions → Cloudflare (site worker + agents worker, both auto-deploy on push to main)

## Site structure

- **Daily** (`/daily/<date>/<slug>/`) — today's piece, prominent on the homepage hero
- **Library** (`/library/`) — all published pieces, newest first, filterable by category and title
- **Interactives** (`/interactives/<slug>/`) — standalone companion quizzes, one per piece
- **Dashboard** (`/dashboard/`) — public factory floor; anyone can watch the pipeline run. Admin surfaces at `/dashboard/admin/` (ADMIN_EMAIL gated) for manual triggers, engagement data, and per-piece deep-dives
- **Account** (`/account/`) — user progress, settings, login

Every piece carries a "How this was made" drawer at the bottom — full pipeline timeline, audit rounds, rejected candidates, and the specific learnings this piece fed back into the system. Transparency is the brand.

## Design

- Warm cream background (#FAF8F4), dark ink text (#1A1A1A), deep teal accent (#1A6B62), muted gold secondary (#C49A1A)
- DM Sans body font, clean and readable
- Optimised for long-form reading on mobile (Android primary test device)
- No dark mode (cream is the brand)
- Generous whitespace, slow animations, things that breathe

## Hard rules for Claude Code

- Follow the committed architecture. Don't propose alternatives without a strong reason.
- TypeScript strict mode everywhere.
- No new dependencies without stating the pain they remove.
- Small commits, clear messages that explain WHY not WHAT.
- Explain significant decisions as you build — Zishan is learning best practices.
- Maintain living documentation inside the repo: CLAUDE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/SCHEMA.md, docs/RUNBOOK.md, docs/AGENTS.md, docs/FOLLOWUPS.md.
- Update docs alongside code in the same commit, not after.
- Never suggest "let me refactor everything." Incremental commits.
- Published pieces are permanent. No agent revises, regenerates, or updates any published piece. Improvements feed forward into the learnings database and improve future pieces only.
- When in doubt: "Does this help someone educate themselves for humble decisions?" If yes, ship it. If no, cut it.

## Current state

Launched 2026-04-18 at https://zeemish.io, tagged `v1.0.0`. All 16 agents wired. Daily news-driven teaching live with audio narration, library categorisation, and per-piece companion quizzes.

Self-improvement loop closed 2026-04-19: Drafter reads from the learnings table at runtime; four signal sources write back after each publish.

Multi-piece cadence shipped 2026-04-21: hourly cron gated by an admin-configurable `interval_hours` setting. Currently running at 12 — two pieces per day at 02:00 + 14:00 UTC.

Area 4 — Interactives — completed 2026-04-24: every piece gets a standalone companion quiz that teaches the same concept on its own URL, useful without reading the source piece.

## Key documents in the repo

- `CLAUDE.md` — start here. What was last worked on, current state, known issues.
- `docs/ARCHITECTURE.md` — living architecture reference
- `docs/DECISIONS.md` — append-only decision log
- `docs/AGENTS.md` — each of the 16 agents documented
- `docs/SCHEMA.md` — D1 tables and migrations
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `docs/FOLLOWUPS.md` — append-only log of known bugs and work queued for future sessions
- `content/voice-contract.md` — the voice rules, versioned
- `book/` — a fourth transparency surface. An honest-prose book explaining every part of the system in plain English. The README says what the software does; the book says why it was built that way. Sixteen chapters, written in the same voice as the daily pieces.

## What Zeemish becomes over time

After 1 month: 30 pieces. A habit.
After 6 months: 180 pieces. A real library, clustered by subject.
After 1 year: 365 pieces. An encyclopaedia of "how the world actually works."
After 3 years: 1000+ pieces. Searchable. Curated reading paths. A resource that gets more valuable every single day.

Not a course platform. Not a news site. A daily practice of understanding, produced autonomously, growing forever.

**Hope. Trust. Progress.**
