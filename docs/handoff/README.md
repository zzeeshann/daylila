> **Frozen pre-launch handoff (2026-04-16).** This was the original brief Zishan wrote for Claude Code before any code existed. Numbers and roster sizes here ("thirteen specialised agents") reflect the pre-launch design, not current state. Current state lives in [`/CLAUDE.md`](../../CLAUDE.md), [`/docs/ARCHITECTURE.md`](../ARCHITECTURE.md), and [`/docs/AGENTS.md`](../AGENTS.md).

# ZEEMISH v2 — Handoff to Claude Code

**Read this first. Then read the architecture doc. Then begin work.**

---

## What Zeemish v2 is

Zeemish v2 is an **autonomous publishing system**. A team of specialised AI agents decides what subjects to publish on, drafts the content, audits it for quality and voice, generates audio, publishes, measures engagement, and improves over time. The human (Zishan) sets initial values and direction, observes, and intervenes when the system needs correction.

Readers see a polished, content-first learning site. Behind it runs the agent team — thirteen specialised agents coordinated via Cloudflare's Agents SDK and Workflows v2, producing beat-based lessons with generated audio on subjects that matter.

## Your role, Claude Code

You are working with Zishan to build Zeemish v2 from scratch. He is a capable developer learning best practices as he goes. Your job:

1. **Follow the committed architecture.** It's in `ZEEMISH-V2-ARCHITECTURE-REVISED.md`. Do not propose alternatives without a strong reason.
2. **Explain as you build.** Every significant decision or piece of code: a sentence or two on *why* this approach.
3. **Small commits, clear messages.** Commit messages explain *why*, not *what*.
4. **Show your work.** If unsure between two approaches, state the tradeoff and pick one.
5. **Ask before assuming.** Zishan's environment, tools, and preferences are his.

## The canonical documents (in order of priority)

1. **`ZEEMISH-V2-ARCHITECTURE-REVISED.md`** — **the committed plan**. The source of truth. Stack, schema, directory structure, agent team, build order. When making any technical decision, consult this.

2. **`ZEEMISH-BUILD-GUIDE.md`** — human-facing step-by-step for Zishan. You may reference it for stage context, but the architecture doc is the technical source of truth.

3. **`ZEEMISH-LEARNING-CHECKPOINTS.md`** — concepts Zishan wants to understand as we go. Don't skip explaining them.

4. **`ZEEMISH-V2-BRIEF.md`** — older founding doc. Useful for voice context only. Superseded by the architecture for all technical decisions.

The older `ZEEMISH-V2-ARCHITECTURE.md` (without -REVISED) is **superseded and should be ignored** unless Zishan specifically asks about earlier thinking.

## Hard rules

- **No deviation from the stack without explicit Zishan approval.** The stack is:
  - Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
  - Backend: Cloudflare Workers + D1 + R2
  - Agents: Cloudflare Agents SDK + Workflows v2 (Durable Objects underneath)
  - AI: Anthropic Claude (Sonnet default, Opus for hard drafts)
  - Audio: ElevenLabs
  - Deploy: GitHub Actions
- **TypeScript strict mode everywhere.**
- **Vanilla HTML output from Astro, no React/Vue as whole-site framework.** Astro islands for interactivity are fine.
- **No new dependencies without justification.** Every `npm install` gets a one-line reason.
- **Never suggest "let me refactor everything."** Incremental commits.

## Agent architecture is the big change

If you read the older architecture doc (without -REVISED), you'll see Zeemish v2 was originally human-authored with AI assistance. **That's not the current plan.** The current plan is fully autonomous agent-based authoring, with quality gates instead of human approval gates, and self-improvement from engagement signals.

The reader-facing parts (Stages 1–3) are still the same. The authoring tool (Stage 4) becomes the agent team instead of a manual UI. This affects weeks 7 onward significantly.

## Voice and tone rules (for any reader-facing copy you write)

- Plain English. No jargon without immediate translation.
- No "mindfulness," "journey," "empower," "transform," "wellness," "unlock," "dive in," "embrace."
- Short sentences. Direct. No flattery.
- Specific beats general.
- Trust the reader.

Full voice contract lives at `/content/voice-contract.md` once the repo exists. This file is versioned and becomes the system prompt for the Voice-Auditor agent.

## How to start

1. Read `ZEEMISH-V2-ARCHITECTURE-REVISED.md` completely.
2. Check which stage Zishan is on (Section 10 of that doc).
3. If Stage 1 hasn't started: your first job is to create the repo skeleton exactly as specified in Section 6, set up Astro + Tailwind + MDX + TypeScript, and get "Hello Zeemish v2" deploying to Cloudflare.
4. Before starting any stage, confirm with Zishan: "We're starting Stage X — [name]. Here's what that means and here's my first move. Good to proceed?"
5. At the end of each stage, summarise what was built and what's next.

## Communication

- Short responses. Zishan prefers it.
- Show code blocks, not prose descriptions of code.
- When you hit ambiguity, ask one question and stop.
- Celebrate finished things briefly and move on.

## Documentation rules (critical)

Claude Code must maintain **living documentation inside the repo** as it builds. This is non-negotiable. The reason: Zishan works across multiple Claude Code sessions. Each new session starts fresh. Without in-repo docs, the next session has no idea what was built, why, or how.

### Required docs, maintained continuously:

1. **`docs/ARCHITECTURE.md`** — a living copy of the architecture decisions actually implemented (not the planning doc — the real state of the codebase). Updated at the end of every stage. Includes: what's built, what's not yet built, any deviations from the original plan and why.

2. **`docs/DECISIONS.md`** — an append-only log of significant technical decisions. Format:
   ```
   ## 2026-04-17: Chose pnpm over npm
   **Context:** Setting up the repo.
   **Decision:** Use pnpm for package management.
   **Reason:** Faster installs, strict dependency resolution, saves disk space.
   ```
   One entry per decision. Never edit old entries — only append.

3. **`docs/AGENTS.md`** — (created at Stage 4) documents each agent: its role, its system prompt location, its inputs/outputs, how to test it in isolation.

4. **`docs/SCHEMA.md`** — the current D1 schema with a plain-English explanation of each table and column. Updated whenever migrations run.

5. **`docs/RUNBOOK.md`** — how to: run locally, deploy, add a new lesson manually, trigger an agent run, check logs, revert a bad publish. Written for a developer who just cloned the repo.

6. **`CLAUDE.md`** at the repo root — a short file specifically for Claude Code sessions. Contains: what was last worked on, which stage we're at, any known issues or blockers. Updated at the end of every session. This is the first thing the next Claude Code session reads.

### Rules for documentation:

- **Write docs alongside code, not after.** If you build a feature, its doc update is in the same commit.
- **Docs are plain markdown.** No generated docs, no JSDoc-to-markdown tooling. Write it by hand, clearly.
- **If a doc contradicts the code, the code is right and the doc needs fixing.** Flag this to Zishan.
- **Keep docs short.** A page that nobody reads is worse than no page. One paragraph per topic. Link to code when useful.

## Special note for Stage 4+ (agent team)

When you reach Stage 4, before writing any agent code:

1. Read Cloudflare Agents SDK docs: `https://developers.cloudflare.com/agents/`
2. Read the Workflows durable agents guide: `https://developers.cloudflare.com/workflows/get-started/durable-agents/`
3. Run through `npm create cloudflare@latest -- --template cloudflare/agents-starter`

Understand the SDK's mental model before building. The architecture doc describes *what* each agent does; the SDK determines *how* each agent is structured in code.

---

**Begin by confirming you've read this file and the revised architecture doc, then propose the first concrete move.**
