# Zeemish

> **"Educate myself for humble decisions."**
>
> "Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."
>
> Everything that follows is an attempt to show you what that means — and how to do it.

Daily teaching, anchored in today's news, produced by a pipeline of specialised Claude calls — each with one job. Live at **[zeemish.io](https://zeemish.io)**.

---

Every morning, a pipeline of 16 agents scans the news, picks the most teachable story, drafts a 1000–1500 word piece, audits it through voice / fact / structure gates, narrates it beat-by-beat via ElevenLabs, categorises it into the library taxonomy, generates a standalone quiz that teaches the same underlying concept, and publishes it all to the live site. No human touches the piece before you read it. Cadence is admin-configurable via the `interval_hours` setting (allowed values: any divisor of 24; default 24 = one piece at 02:00 UTC).

You see the result the next morning — a daily teaching piece anchored in today's news, in plain English, with audio narration. A growing library of past pieces. No login needed to read.

The whole pipeline runs in public. Visit [/daily/](https://zeemish.io/daily/) to see today's pieces and the candidate news stories Scanner pulled for each run. Every published piece has a "How this was made" drawer at the bottom showing which agents touched it and what each round of audit said. Transparency is the brand.

## What it actually is

An autonomous daily publishing pipeline of specialised Claude calls with a quality gate, orchestrated by Cloudflare Durable Objects, persisting to D1 / R2 / GitHub. The "16 agents" framing is a clean way to organise the code — sixteen distinct roles, one file per role. It is not a team of independent minds. It's a pipeline with memory.

As of 2026-04-19, that memory is closed into a loop. After every publish, two off-pipeline passes run: one reads the piece's own quality record (audit scores, revision rounds, which candidates Curator picked vs passed over) and writes patterns to a `learnings` table. The other asks the Drafter to reflect honestly on what it just wrote — what felt thin, which topic it was stretching on, what it would do differently. Both feed the Drafter's prompt on the next piece. Whether the loop produces real signal or polite noise is something we'll know after a week of pieces.

## The pipeline

**Scan → Curate → Draft → [Voice · Fact · Structure → Integrate, up to 3 rounds] → Publish → [Audio produce → Audio audit → Publish audio, alarm-scheduled] → [Learn · Reflect, alarm-scheduled, non-blocking]**

Director orchestrates; zero LLM calls of its own. Observer logs every pipeline event. Learner reads producer signals after each publish and readers when they show up. Drafter self-reflects after each publish.

Each agent does one job and lives in one file. See [agents/src/](agents/src/) and [docs/AGENTS.md](docs/AGENTS.md).

## Tech

Astro + MDX + Tailwind + TypeScript strict, on Cloudflare Workers. Two workers: the site (this repo's `src/`) and the agents (this repo's `agents/`). D1 for data, R2 for audio, the Cloudflare Agents SDK for the agent runtime, Claude Sonnet 4.5 for reasoning, ElevenLabs (Frederick Surrey voice) for narration, Resend for magic-link auth. GitHub Actions auto-deploys both workers on every push to `main`.

## How this was built

Largely built with Claude (Anthropic's assistant) as a development partner over a few weeks. The trade-offs and the *why* behind each non-obvious decision are captured in [docs/DECISIONS.md](docs/DECISIONS.md) — append-only, dated entries. Known bugs and work queued for future sessions live in [docs/FOLLOWUPS.md](docs/FOLLOWUPS.md) — also append-only. The current-state document is [CLAUDE.md](CLAUDE.md) — read that first if you want to understand the system end-to-end.

Honest software: the README tells you what it is, /daily/ shows the candidate set behind each piece, every piece's "How this was made" drawer shows the per-piece pipeline, the decision log explains why each piece is the way it is, the followups log shows what's still wrong and waiting to be fixed. No seams hidden.

## Repo map

```
agents/src/             16 agent files (one per agent)
content/daily-pieces/   Published daily pieces (YYYY-MM-DD-slug.mdx)
src/pages/              Site routes (Astro)
src/interactive/        Web Components (lesson-shell, audio-player, zita-chat, quiz-card)
content/interactives/   Standalone interactive content (quizzes; Area 4)
migrations/             D1 schema (28 migrations, 20 tables)
scripts/                Build, deploy, and ops scripts
docs/                   Living documentation
docs/handoff/           Original architecture briefs (frozen)
```

## Documentation

- [CLAUDE.md](CLAUDE.md) — project context, current state, and "Critical lesson" sections worth reading before touching cache or headers
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — what's built, deviations from the original plan
- [docs/AGENTS.md](docs/AGENTS.md) — the 16 agents in detail, endpoints, secrets
- [docs/SCHEMA.md](docs/SCHEMA.md) — D1 tables and migrations
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — how to run, deploy, trigger, revert
- [docs/DECISIONS.md](docs/DECISIONS.md) — append-only decisions, with the *why*
- [docs/FOLLOWUPS.md](docs/FOLLOWUPS.md) — append-only known bugs and work queued for future sessions

## Status

Launched 2026-04-18 at https://zeemish.io. Tagged `v1.0.0`.

Self-improvement loop closed 2026-04-19: Drafter now reads from the `learnings` table at runtime; Learner writes producer-side patterns after each publish; Drafter reflects honestly on its own work after each publish.

Multi-piece cadence shipped 2026-04-21: hourly cron + admin-configurable `interval_hours` gate (default 24 → one piece at 02:00 UTC; current production value is 12 → two pieces per day at 02:00 + 14:00 UTC). Every day-keyed D1 table (audit_results, daily_candidates, daily_piece_audio, engagement, learnings, observer_events, pipeline_log, zita_messages) carries a `piece_id` column so per-piece consumers don't pool at multi-per-day.

Known open items tracked in [docs/FOLLOWUPS.md](docs/FOLLOWUPS.md). Nothing currently blocks publication.

The original Zeemish (a separate breathing-tools site, 2024) lived at the same domain until launch day. That codebase is preserved at [github.com/zzeeshann/zeemish](https://github.com/zzeeshann/zeemish) (archived).
