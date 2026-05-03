# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

**Latest session (2026-05-02, second session — Account rebuild + visual consistency):** Account rebuilt as a private practice record. New `user_piece_reads` table (migration 0029, PK `(user_id, piece_id)`) + `/api/reads/track` endpoint + lesson-shell wired for view/per-beat/complete events. `/account/` renders Resume → Recently read → Saved (Phase 2) → Subjects (categories observation) → Quizzes (conditional) → Your questions (Zita, conditional) → Identity. Anonymous-first; signed-in adds an email line. Empty states honest — sections hide entirely when there's no data. Streak line ("X of last 14 days") only when ≥2. `mergeProgress` extended to carry `user_piece_reads` through magic-link + password sign-in (and `verify.astro` refactored to call the helper instead of duplicating SQL). `<lesson-beat>` now emits `id={name}` so deep-link `#beat` anchors work for Resume continue-reading. Zita writer at `chat.ts:220` fixed to populate `piece_id` (was NULL since migration 0014). Phase 2 ships `saved_pieces` (migration 0030) + `/api/saved/toggle` + meta-line `· ☆ Save` / `· ★ Saved` link on every piece + Saved section on Account. After the rebuild, three site-wide visual-consistency passes landed: every interactive element gets an affordance glyph (`↗` external / `→` internal / `☆ ★` toggle); hairline `divide-y divide-zee-border/60` between Account sections; colour tokens normalized (gold = page-identity eyebrows + per-piece subject pills only; teal = every link **and** every affordance glyph at rest, not just hover; muted = section labels; ink = headlines + body). Rollback tag: `pre-account-rebuild` at SHA `ea0786a`. Done tag: `account-rebuild-done`. New helper: `formatShortDate` ("Fri 1 May") in `src/lib/format.ts`.

**Earlier today:** Daily rebuilt as a run-block timeline; public Dashboard removed (`/dashboard/` 301-redirects to `/daily/`). Rollback tag: `pre-daily-rebuild` at SHA `4ca6392`.

**Full chronology:** `docs/DECISIONS.md` is the append-only log of every dated session entry — Path A.1, Path A, Phase A/F+G/H+I, Close-beat loosening, web_search swap, Pair-slug, InteractiveGenerator retry, Area 5/4/3/2 work, Curator reframe, Categoriser zero-fix, all of it. **Open / observing items:** `docs/FOLLOWUPS.md`. **Archived plans (closed projects):** `docs/archive/` (Interactives v3 plan + notes, 2026-04 refinement plan, 2026-04 voice audit).

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

Everything that follows is an attempt to show you what that means — and how to do it.

## What Zeemish v2 is

An autonomous multi-agent publishing system. 16 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, categorise them into the library taxonomy, generate a standalone quiz per piece, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces and an optional quiz at the end of each.

## Current state

**LAUNCHED 2026-04-18 at https://zeemish.io.** Tag: `v1.0.0`; latest milestone `v1.6.0` (2026-04-25, Curator/Categoriser tightening). Old breathing-tools site at zeemish.io retired (custom-domain binding moved from `zeemish-site` worker to `zeemish-v2` worker via Cloudflare dashboard). New site live with daily piece, audio, engagement tracking, admin control room, security headers on auth-touching surfaces. Workers.dev URL still active as fallback. The exact git commit at launch is what `v1.0.0` points at — use it as the reference if anyone asks "what shipped on day one".

## What was built

1. **Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Reader Surface:** Single-scroll daily piece page (Area 5, 2026-04-26): title → audio → every beat → embedded companion interactive → embedded quiz → finish state. `<lesson-shell>` is a passive engagement reporter; `<audio-player>` auto-advances + smooth-scrolls beat-by-beat on clip end. Standalone `/interactives/<slug>/` URL still works.
3. **Accounts & Progress:** Anonymous-first auth, D1, progress tracking, magic link login (Resend)
4. **Agent Team:** 16 agents on Cloudflare Agents SDK, full pipeline with quality gates + audio narration + post-publish categorisation + post-publish interactive (quiz) generation
5. **Self-Improvement:** Engagement tracking, LearnerAgent, learnings database (Drafter reads from at runtime; Learner + Drafter self-reflection write into post-publish)
6. **Zita:** Socratic learning guide in every piece
7. **Daily Pieces:** ScannerAgent, Director daily mode, news-driven teaching on hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC once per day; admin-configurable)
8. **Dashboard:** Admin control room only (/dashboard/admin/). Public dashboard removed 2026-05-02 — its transparency role lives on every piece's *How this was made* drawer; aggregate operator-shaped metrics belong in admin. Public visitors to `/dashboard/` redirect 301 → `/daily/`. Operator entry: footer "Admin →" link gated on `ADMIN_EMAIL`.

## Architecture

### Two Workers
- **zeemish-v2** — Astro site: pages + API routes. `https://zeemish.io` (custom domain; workers.dev URL still active as fallback)
- **zeemish-agents** — 16 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (22 tables) + R2 (audio)
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
6. **FactCheckerAgent** — verifies every claim (single-pass: Claude with Anthropic `web_search_20250305` server tool; today's date in user message; search-first for current-event claims). Reads `content/fact-check-contract.md` via `${FACT_CHECK_CONTRACT}` injection since 2026-05-07 — verdict taxonomy + search-first rule + cutoff-confession ban + `max_uses=8` budget all live there. Path A.1 (2026-05-01) harvests citation URLs from `web_search_tool_result.content[]` for the drawer's "Sources consulted" line.
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
- **Public dashboard removed 2026-05-02.** `/dashboard/` redirects 301 → `/daily/`. Reader-facing transparency lives on every piece's *How this was made* drawer (per-piece pipeline timeline, audit rounds, candidates, learnings). Daily itself surfaces the candidate sets Scanner pulled for each run.
- **Admin** (`/dashboard/admin/`) — ADMIN_EMAIL only. Pipeline controls, observer events with acknowledge, engagement data, agent tasks. Per-piece deep-dive at `/dashboard/admin/piece/[date]/[slug]/` with full timeline + audit rounds + scanner candidates + Zita conversations + observer events. Operator entry: footer "Admin →" link in `BaseLayout.astro` (gated on `ADMIN_EMAIL`, only visible on SSR pages).

### Database (D1 — 22 tables, 30 migrations)
See `docs/SCHEMA.md` for the canonical schema (always source-of-truth for table + migration counts).
- Reader: users, progress, submissions, zita_messages, user_piece_reads, saved_pieces, magic_tokens
- Agent: observer_events, engagement, learnings, audit_results, pipeline_log
- Daily: daily_candidates, daily_pieces (+ `has_audio` + `interactive_id` cols), daily_piece_audio (per-beat MP3 rows), admin_settings
- Categoriser: categories, piece_categories
- Interactives: interactives, interactive_engagement, interactive_audit_results, daily_audit_claims

### Key directories
```
src/pages/              Routes (index, daily, library, dashboard/admin, account, login, API). Public /dashboard/ is a redirect-only page → /daily/.
src/pages/api/dashboard/ Admin API (observer, pipeline, admin/settings). The early today/recent/stats/analytics/memory endpoints were removed in the 2026-04-22 dead-endpoint audit.
src/interactive/        Web Components (lesson-shell, lesson-beat, audio-player, zita-chat, made-drawer, quiz-card, interactive-frame)
src/lib/                Auth, DB helpers, rate limiting, formatting (formatDate, formatTime, audit-tier, categories, interactives)
src/styles/             global.css (Tailwind) + beats.css + zita.css + made.css + quiz.css + lesson-finish.css (standalone, not Tailwind-processed)
src/layouts/            BaseLayout, LessonLayout
content/daily-pieces/   Daily teaching pieces (YYYY-MM-DD-slug.mdx)
content/interactives/   Standalone teaching artefacts (quizzes as {slug}.json, HTML as {slug}-html.json)
agents/src/             16 agent files + per-agent prompt files + shared code
agents/src/shared/generated/ AUTO-GENERATED prompt-content modules — do NOT hand-edit; regenerate via `cd agents && pnpm codegen`
agents/scripts/         Verifier scripts (`verify-*.mjs`) + codegen (`codegen-contracts.mjs`)
migrations/             D1 schema migrations (0001–0028)
docs/                   Living documentation
docs/archive/           Closed-project plans (Interactives v3, 2026-04 refinement, voice audit)
docs/handoff/           Frozen pre-launch specs
```

### Agent-prompt contracts (codegen, 2026-05-03; beats added 2026-05-04; interactive added 2026-05-05; audit added 2026-05-06; fact-check added 2026-05-07; curator added 2026-05-08)
Canonical contract content lives in markdown / HTML under `content/` and `docs/examples/` and is embedded into the agents bundle at build time by `agents/scripts/codegen-contracts.mjs`, hooked through `[build]` in `agents/wrangler.toml`. The generated module is `agents/src/shared/generated/contracts.ts` (checked in; CI gate `pnpm verify-contracts-fresh` blocks deploy on a stale committed file). Edit canonical files only — never the `generated/` directory. The codegen currently carries seven exports: `VOICE_CONTRACT` (from `content/voice-contract.md` — now voice rules only after the lesson-structure section moved out on 2026-05-04), `INTERACTIVE_HTML_REFERENCE` (from `docs/examples/interactive-reference.html`), `BEAT_CONTRACT` (from `content/beat-contract.md` — extracted 2026-05-04, read by Drafter, Structure Editor, Integrator), `INTERACTIVE_CONTRACT` (from `content/interactive-contract.md` — extracted 2026-05-05, read by InteractiveGenerator + InteractiveAuditor on both quiz and HTML paths), `AUDIT_CONTRACT` (from `content/audit-contract.md` — extracted 2026-05-06, no prompt currently injects it; the contract is canonical narrative and named TS constants in `agents/src/shared/audit-thresholds.ts` carry the runtime values), `FACT_CHECK_CONTRACT` (from `content/fact-check-contract.md` — extracted 2026-05-07, injected at the FactChecker prompt; runtime threshold values via `agents/src/shared/fact-check-thresholds.ts` with site-side mirror at `src/lib/fact-check-thresholds.ts` for the drawer's render-time cutoff-confession filter), and `CURATOR_CONTRACT` (from `content/curator-contract.md` — extracted 2026-05-08, injected at the Curator system prompt; the 30-day recent-pieces / category-concentration window via `CURATOR_RECENT_WINDOW_DAYS` in `agents/src/shared/curator-thresholds.ts` — agents-only, no site-side mirror). Subsequent Foundation Fix Task 02 sessions extend the SOURCES array with new clusters.

### Security
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Passwords: PBKDF2 100k iterations, timing-safe comparison
- CSRF: origin header check (strict URL parsing)
- Rate limiting: login (5/15min), Zita (20/15min), upgrade (5/15min)
- Agents: ADMIN_SECRET bearer token, CORS restricted to allowed origins + preflight
- Dashboard: admin view only (ADMIN_EMAIL gated). Public `/dashboard/` was removed 2026-05-02; it 301-redirects to `/daily/`.
- Input validation: JSON try-catch, message length limits
- CSP header, X-Frame-Options DENY

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET, ADMIN_EMAIL
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

### Site navigation
**Daily · Library · Account** (Dashboard removed from public nav 2026-05-02; admin reachable via footer link gated on `ADMIN_EMAIL` or directly at `/dashboard/admin/`).

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
- **Security headers on prerendered HTML (`/`, `/daily/[date]/[slug]/`) — known gap.** Despite `_routes.json` `include: ["/*"]` + `run_worker_first = true` + middleware `Cache-Control: no-store` on HTML, Cloudflare Workers Static Assets serves prerendered `.html` files directly without invoking the worker. Server-rendered routes (`/daily/`, `/library/`, `/library/[slug]/`, `/dashboard/`, `/api/*`, `/audio/*`, `/account`, `/login`) DO get all 6 headers. (`/daily/` joined the SSR side on 2026-05-02 with the rebuild — index needs D1 access; `/library/` was already SSR.) The remaining static pages have no auth, no cross-origin fetches, no third-party scripts beyond Google Fonts (preconnect only). Practical residual risk = clickjacking (low). Two future paths: (a) Cloudflare Transform Rule injecting headers at the edge, (b) `prerender = false` on those pages (~15-50ms perf hit). See `docs/DECISIONS.md` 2026-04-18 "Ship as-is despite header gap" for the full reasoning.
- **Cloudflare Workers Static Assets (read this before touching cache or headers):** Three caching/routing layers interact and you have to defeat all of them to get headers on prerendered HTML — adapter `_routes.json` (overridden by `scripts/post-build.sh`), `run_worker_first` in wrangler.toml, and the CDN edge cache. Even so, prerendered HTML in production is still served without the worker for filesystem-resolvable paths; the gap is documented and accepted. Don't relitigate.
- DNS `R2 listens.zeemish.io` and `Worker api.zeemish.io → zeemish-api` are leftover from the OLD breathing-tools site. Different subdomains, not in the way of launch. Retire when convenient.
- Cache-purge needed on every Cloudflare deploy to evict CDN-cached prerendered HTML — until the header-gap above is closed
- Drafter-declared `beatCount` in frontmatter can drift from actual `##` heading count in the MDX body. Reader UI counts actual headings in `src/lib/rehype-beats.ts` and is correct regardless. Durable fix still pending: add a Structure-Editor gate or drop the frontmatter field and derive at render time.
- Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`); `rehype-beats.ts` humanises for display. Lossy for acronyms and punctuation. Fixed via optional `beatTitles` frontmatter map (added 2026-04-19) that overrides per-beat. Parallel durable fix still pending: teach Drafter to write display-formatted `##` headings.

## Quality surfacing

Every published piece shows a tier in the metadata line: `Polished` (voice ≥ 85), `Solid` (70–84), `Rough` (< 70). Derived at render time from `voiceScore` in MDX frontmatter via `src/lib/audit-tier.ts`. No archive filtering — a published piece is a published piece. Admin surface keeps raw `Voice: N/100` + `LOW QUALITY` labels for operator truth. Threshold rule body lives at `content/audit-contract.md` since 2026-05-06; runtime values via `src/lib/audit-thresholds.ts` (site-side mirror of `agents/src/shared/audit-thresholds.ts`).

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
- Voice contract: plain English, no jargon, no tribe words, short sentences. The contract at `content/voice-contract.md` is canonical; codegenned into `agents/src/shared/generated/contracts.ts` for the agents bundle (see "Agent-prompt contracts" section above).
- Manto voice doctrine was tried 2026-04-27 and rolled back 2026-04-28; voice rule is the contract only. Don't reach for a posture-doctrine layer above it.
- When in doubt: "Does this help someone educate themselves for humble decisions?"
