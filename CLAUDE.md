# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

**Currently working on (2026-05-01):** Curator + Scanner diversity intervention — three commits shipped. Curator's TEACHABILITY interpretation was anchored to crisis/policy/system-failure framings, and Scanner pulled only 6 Google News topic feeds, structurally biasing the candidate pool. Curator prompt rewritten around a 10-domain breadth taxonomy with a recent-category-concentration block and an inline variety instruction; Scanner widened from 6 → 17 RSS feeds (per-feed cap 6, global cap 80) bringing in direct breadth feeds (Aeon, Quanta, JSTOR Daily, Atlas Obscura, Nautilus, Phys.org, Live Science, New Scientist, Knowable, Smithsonian, Tech Review). FOLLOWUPS opened a 7-cron verification window with named escalation paths per failure mode. Architecture rule: "the fix is in the prompt and the input list, not in pre-creating empty categories."

**Full chronology:** `docs/DECISIONS.md` is the append-only log of every dated session entry — Path A.1, Path A, Phase A/F+G/H+I, Close-beat loosening, web_search swap, Pair-slug, InteractiveGenerator retry, Area 5/4/3/2 work, Curator reframe, Categoriser zero-fix, all of it. **Open / observing items:** `docs/FOLLOWUPS.md`. **Archived plans (closed projects):** `docs/archive/` (Interactives v3 plan + notes, 2026-04 refinement plan, 2026-04 voice audit).

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

Everything that follows is an attempt to show you what that means — and how to do it.

## What Zeemish v2 is

An autonomous multi-agent publishing system. 16 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, categorise them into the library taxonomy, generate a standalone quiz per piece, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces and an optional quiz at the end of each.

## Current state

**LAUNCHED 2026-04-18 at https://zeemish.io.** Tag: `v1.0.0`; latest milestone `v1.6.0` (2026-04-25, Curator/Categoriser tightening). Old breathing-tools site at zeemish.io retired (custom-domain binding moved from `zeemish-site` worker to `zeemish-v2` worker via Cloudflare dashboard). New site live with daily piece, audio, engagement tracking, public + admin dashboard, security headers on auth-touching surfaces. Workers.dev URL still active as fallback. The exact git commit at launch is what `v1.0.0` points at — use it as the reference if anyone asks "what shipped on day one".

## What was built

1. **Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Reader Surface:** Single-scroll daily piece page (Area 5, 2026-04-26): title → audio → every beat → embedded companion interactive → embedded quiz → finish state. `<lesson-shell>` is a passive engagement reporter; `<audio-player>` auto-advances + smooth-scrolls beat-by-beat on clip end. Standalone `/interactives/<slug>/` URL still works.
3. **Accounts & Progress:** Anonymous-first auth, D1, progress tracking, magic link login (Resend)
4. **Agent Team:** 16 agents on Cloudflare Agents SDK, full pipeline with quality gates + audio narration + post-publish categorisation + post-publish interactive (quiz) generation
5. **Self-Improvement:** Engagement tracking, LearnerAgent, learnings database (Drafter reads from at runtime; Learner + Drafter self-reflection write into post-publish)
6. **Zita:** Socratic learning guide in every piece
7. **Daily Pieces:** ScannerAgent, Director daily mode, news-driven teaching on hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC once per day; admin-configurable)
8. **Dashboard:** Public factory floor (/dashboard/) + admin control room (/dashboard/admin/)

## Architecture

### Two Workers
- **zeemish-v2** — Astro site: pages + API routes. `https://zeemish.io` (custom domain; workers.dev URL still active as fallback)
- **zeemish-agents** — 16 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (20 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1
- AI: Anthropic Claude Sonnet 4.5
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy)

### The 16 Agents (one job per agent, one file per agent)

Pipeline: Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher → Audio Producer → Audio Auditor → Publisher.publishAudio (second commit splices audioBeats into frontmatter). Text ships first — audio is ship-and-retry so the day is never blank. Observer receives events throughout. Learner + Categoriser + InteractiveGenerator (which internally calls InteractiveAuditor) run off-pipeline post-publish.

1. **ScannerAgent** — fetches 17 RSS feeds (Google News topics + direct breadth feeds), deduplicates, stores up to 80 candidates per run
2. **DirectorAgent** — pure orchestrator. Routes work between agents. Zero LLM calls. Hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC once per day).
3. **CuratorAgent** — picks the most teachable story from today's candidates, plans beats + hook + teaching angle. Reframed 2026-04-25 around the Zeemish Protocol (no "60+ teachability threshold" gate); diversity-tuned 2026-05-01 with a 10-domain breadth taxonomy + recent-category-concentration block.
4. **DrafterAgent** — writes the MDX from the brief, enforces `<lesson-shell>` / `<lesson-beat>` format. Reads recent learnings at runtime; self-reflects post-publish.
5. **VoiceAuditorAgent** — voice compliance gate (≥85/100)
6. **FactCheckerAgent** — verifies every claim (single-pass: Claude with Anthropic `web_search_20250305` server tool; today's date in user message; search-first for current-event claims). Path A.1 (2026-05-01) harvests citation URLs from `web_search_tool_result.content[]` for the drawer's "Sources consulted" line.
7. **StructureEditorAgent** — reviews flow and pacing
8. **IntegratorAgent** — handles revisions before approval (3 rounds max)
9. **AudioProducerAgent** — generates per-beat MP3 via ElevenLabs (Frederick Surrey, `eleven_multilingual_v2`, 96 kbps), saves to R2, writes `daily_piece_audio` rows. 20k-char hard cap per piece, 3-attempt retry on transient failures, request-stitching for prosodic continuity. Provider-agnostic TTS normaliser handles Roman numerals + brand pronunciation.
10. **AudioAuditorAgent** — reads `daily_piece_audio` rows, verifies R2 objects exist + file sizes are sane + total chars under cap. Passes/fails without touching git.
11. **PublisherAgent** — commits to GitHub, piece goes live
12. **LearnerAgent** — learns from reader behaviour and producer signals, writes patterns for future pieces. Three sources: producer (post-publish), self-reflection (Drafter post-publish), reader (engagement-driven).
13. **CategoriserAgent** — assigns 1–3 library categories to each piece post-publish (off-pipeline alarm), strongly biased toward reusing the existing taxonomy. Layered defense (≥75 reuse floor, single retry on empty/all-sub-floor, `Patterns Yet to Cluster` fallback).
14. **ObserverAgent** — logs every pipeline event for the admin dashboard
15. **InteractiveGeneratorAgent** — produces a standalone quiz per piece post-publish (off-pipeline alarm). Teaches the underlying concept, never references the source piece. Owns a produce→audit→revise loop up to 3 rounds; ships as `quality_flag='low'` on max-fail rather than abandoning.
16. **InteractiveAuditorAgent** — single Claude call judges quizzes across voice / structure-pedagogy / essence-not-reference / factual dimensions. Called internally by InteractiveGenerator each round.

### Dashboard
- **Public** (`/dashboard/`) — anyone can visit. Shows pipeline status, quality scores, agent team, library stats, recent pieces. Transparency is the brand.
- **Admin** (`/dashboard/admin/`) — ADMIN_EMAIL only. Pipeline controls, observer events with acknowledge, engagement data, agent tasks. Per-piece deep-dive at `/dashboard/admin/piece/[date]/[slug]/` with full timeline + audit rounds + scanner candidates + Zita conversations + observer events.

### Database (D1 — 20 tables, 28 migrations)
See `docs/SCHEMA.md` for the canonical schema (always source-of-truth for table + migration counts).
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: observer_events, engagement, learnings, audit_results, pipeline_log
- Daily: daily_candidates, daily_pieces (+ `has_audio` + `interactive_id` cols), daily_piece_audio (per-beat MP3 rows), admin_settings
- Categoriser: categories, piece_categories
- Interactives: interactives, interactive_engagement, interactive_audit_results, daily_audit_claims

### Key directories
```
src/pages/              Routes (index, daily, library, dashboard, account, login, API)
src/pages/api/dashboard/ Dashboard API (today, recent, stats, analytics, observer)
src/interactive/        Web Components (lesson-shell, lesson-beat, audio-player, zita-chat, made-drawer, quiz-card, interactive-frame)
src/lib/                Auth, DB helpers, rate limiting, formatting (formatDate, formatTime, audit-tier, categories, interactives)
src/styles/             global.css (Tailwind) + beats.css + zita.css + made.css + quiz.css + lesson-finish.css (standalone, not Tailwind-processed)
src/layouts/            BaseLayout, LessonLayout
content/daily-pieces/   Daily teaching pieces (YYYY-MM-DD-slug.mdx)
content/interactives/   Standalone teaching artefacts (quizzes as {slug}.json, HTML as {slug}-html.json)
agents/src/             16 agent files + per-agent prompt files + shared code
migrations/             D1 schema migrations (0001–0028)
docs/                   Living documentation
docs/archive/           Closed-project plans (Interactives v3, 2026-04 refinement, voice audit)
docs/handoff/           Frozen pre-launch specs
```

### Security
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Passwords: PBKDF2 100k iterations, timing-safe comparison
- CSRF: origin header check (strict URL parsing)
- Rate limiting: login (5/15min), Zita (20/15min), upgrade (5/15min)
- Agents: ADMIN_SECRET bearer token, CORS restricted to allowed origins + preflight
- Dashboard: public view (no auth), admin view (ADMIN_EMAIL gated)
- Input validation: JSON try-catch, message length limits
- CSP header, X-Frame-Options DENY

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET, ADMIN_EMAIL
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

### Site navigation
**Daily · Library · Dashboard · Account**

## Documentation index
- `docs/PROJECT-BRIEF.md` — current-state project brief; paste-able into Claude project-level descriptions
- `docs/ARCHITECTURE.md` — what's built, deviations from plan
- `docs/AGENTS.md` — all 16 agents (Role + Character per agent), endpoints, secrets
- `docs/SCHEMA.md` — all 20 D1 tables, 28 migrations (canonical)
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `docs/DECISIONS.md` — technical decisions, append-only chronological log
- `docs/FOLLOWUPS.md` — known bugs and queued work, append-only
- `docs/INTERACTIVES.md` — interactives spec
- `docs/INTERACTIVES_STATUS.md` — interactives implementation status
- `docs/SESSION_PROTOCOL.md` — session-handoff protocol
- `docs/zita-design.md` — Zita design doc (deep-Zita v1 build sequence)
- `docs/handoff/` — frozen pre-launch specs (architecture, daily pieces, dashboard, instructions, founding doc)
- `docs/archive/` — closed-project plans (kept for git-blame readers)

## Remaining minor items
- Voice contract `.ts` has belief line synced, but may drift — `.md` is canonical
- Audio-Auditor does file checks only (no STT round-trip)
- Audio `/audio/*` route returns 200 with full body for Range requests instead of 206 partial — browsers buffer the whole clip rather than seek. Per-beat clips are small so it's tolerable; revisit if seek behaviour or bandwidth becomes a concern
- Audio R2 objects use `Cache-Control: public, max-age=31536000, immutable` (1-year edge cache). Per-beat regen lands at the same deterministic R2 key → same URL → returning readers may keep hearing the stale cached MP3 until browser/CDN cache expires. Hard-refresh bypasses. Admin UI surfaces the warning on the per-beat Regenerate confirm dialog. Cache-header tuning for regen-aware invalidation is a future project (see FOLLOWUPS "CDN cache invalidation on per-beat audio regen")
- Rate limiter is KV-backed (Workers KV, eventually consistent)
- CSP uses `unsafe-inline` for scripts (required by Astro)
- Dashboard pipeline API's `isRunning` heuristic is buggy on the API itself — admin's consumer fixes it inline; if other consumers want the right answer, fix the endpoint properly
- Zita chat panel uses white background — feels off-brand vs the cream `zee-bg` used elsewhere; rebrand needed
- OG image is one static PNG for every page (1200×630, generated via `scripts/generate-og-image.mjs`); per-piece dynamic OG (headline + tier rendered to PNG at the edge) is a future Worker route project
- No skip-to-content link for keyboard users; full WCAG audit deferred
- **Security headers on prerendered HTML (`/`, `/daily/*`, `/library`) — known gap.** Despite `_routes.json` `include: ["/*"]` + `run_worker_first = true` + middleware `Cache-Control: no-store` on HTML, Cloudflare Workers Static Assets serves prerendered `.html` files directly without invoking the worker. Server-rendered routes (`/dashboard/`, `/api/*`, `/audio/*`, `/account`, `/login`) DO get all 6 headers. The static reading pages have no auth, no cross-origin fetches, no third-party scripts beyond Google Fonts (preconnect only). Practical residual risk = clickjacking (low). Two future paths: (a) Cloudflare Transform Rule injecting headers at the edge, (b) `prerender = false` on those pages (~15-50ms perf hit). See `docs/DECISIONS.md` 2026-04-18 "Ship as-is despite header gap" for the full reasoning.
- **Cloudflare Workers Static Assets (read this before touching cache or headers):** Three caching/routing layers interact and you have to defeat all of them to get headers on prerendered HTML — adapter `_routes.json` (overridden by `scripts/post-build.sh`), `run_worker_first` in wrangler.toml, and the CDN edge cache. Even so, prerendered HTML in production is still served without the worker for filesystem-resolvable paths; the gap is documented and accepted. Don't relitigate.
- DNS `R2 listens.zeemish.io` and `Worker api.zeemish.io → zeemish-api` are leftover from the OLD breathing-tools site. Different subdomains, not in the way of launch. Retire when convenient.
- Cache-purge needed on every Cloudflare deploy to evict CDN-cached prerendered HTML — until the header-gap above is closed
- Drafter-declared `beatCount` in frontmatter can drift from actual `##` heading count in the MDX body. Reader UI counts actual headings in `src/lib/rehype-beats.ts` and is correct regardless. Durable fix still pending: add a Structure-Editor gate or drop the frontmatter field and derive at render time.
- Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`); `rehype-beats.ts` humanises for display. Lossy for acronyms and punctuation. Fixed via optional `beatTitles` frontmatter map (added 2026-04-19) that overrides per-beat. Parallel durable fix still pending: teach Drafter to write display-formatted `##` headings.

## Quality surfacing

Every published piece shows a tier in the metadata line: `Polished` (voice ≥ 85), `Solid` (70–84), `Rough` (< 70). Derived at render time from `voiceScore` in MDX frontmatter via `src/lib/audit-tier.ts`. No archive filtering — a published piece is a published piece. Admin surface keeps raw `Voice: N/100` + `LOW QUALITY` labels for operator truth.

Interactives that max-fail audit on round 3 ship with `quality_flag='low'` (post-Area-4 reversal). The drawer's per-claim audit section names which dimension(s) failed (`essence-not-reference`, `voice`, `structure & pedagogy`, `factual`).

## Dev-mode testing

One-command reset: `ADMIN_SECRET=... ./scripts/reset-today.sh` (git rm MDX + D1 clear across 5 tables + trigger fresh pipeline). `--piece-id` flag scopes to a single piece at multi-per-day cadence. See `docs/RUNBOOK.md` → "Reset today" for what it does and the manual fallback.

Seed Categoriser across historical pieces: `ADMIN_SECRET=… ./scripts/seed-categories.sh`. Idempotent.

## Hard rule
**Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

Frontmatter metadata (voiceScore, audioBeats, qualityFlag, pieceId, publishedAt, sourceUrl, claimReviews) is the explicit carve-out — Director splices these at publish time without touching body content.

## Key rules
- TypeScript strict everywhere
- No new dependencies without justification
- Docs updated alongside code, same commit (CLAUDE.md, DECISIONS.md, RUNBOOK, SCHEMA, AGENTS, ARCHITECTURE)
- Voice contract: plain English, no jargon, no tribe words, short sentences. The contract at `content/voice-contract.md` is canonical (mirror at `agents/src/shared/voice-contract.ts`).
- Manto voice doctrine was tried 2026-04-27 and rolled back 2026-04-28; voice rule is the contract only. Don't reach for a posture-doctrine layer above it.
- When in doubt: "Does this help someone educate themselves for humble decisions?"
