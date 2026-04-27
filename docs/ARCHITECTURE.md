# Zeemish v2 — Living Architecture

The canonical architecture is in `handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`. This file tracks what's **actually built** vs. what's planned.

## Hard rule: published content is permanent

**Published pieces are permanent. Any agent can READ old pieces to learn from them. No agent WRITES to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

This applies to every agent. No exceptions. The past stays. The future gets better.

## What's built

### Stage 1 — Foundation (complete)
- [x] Directory skeleton
- [x] Astro + Tailwind + MDX + TypeScript strict
- [x] Cloudflare Workers deploy (wrangler.toml + Static Assets)
- [x] GitHub Actions CI/CD (auto-deploys both site and agents on push to main)

### Stage 2 — Reader Surface (complete)
- [x] Content collections (dailyPieces) with Zod schemas
- [x] `<lesson-shell>` + `<lesson-beat>` Web Components — single-scroll layout (Area 5, 2026-04-26). Beats render as continuous prose; `<lesson-shell>` is a passive engagement reporter (mounts → fires `view`; observes finish-state sentinel for `complete`; observes inline interactive section for `interactive_offered`).
- [x] Beat CSS in standalone `src/styles/beats.css` (not Tailwind-processed, survives purging)
- [x] AudioPlayer web component — beat-aware `<audio-player>` that reads `audioBeats: { beatName → publicUrl }` from frontmatter and plays per-beat clips. On clip end (single-scroll layout from Area 5): loads the next beat's clip in DOM order, smooth-scrolls the matching `<lesson-beat>` into view, autoplays. Pre-Area-5 it consumed `lesson-beat:change` from `<lesson-shell>`'s pagination state machine; that listener is gone. Graceful degrade: missing audio shows "coming soon"; 404 shows "unavailable".
- [x] BaseLayout + LessonLayout with breadcrumbs, date eyebrow, beat/subject meta line. LessonLayout (Area 5) also renders the inline companion interactive section + finish-state footer below `<slot/>`.
- [x] Progressive enhancement (without JS, beats show as long scroll). The single-scroll layout's JS shape now matches the no-JS shape — no pagination state machine to fail back from.
- [x] `formatDate()` and `formatTime()` helpers in `src/lib/format.ts`
- [x] `src/lib/rehype-beats.ts` — render-time MDX transform that wraps `##`-demarcated sections in `<lesson-shell>`/`<lesson-beat>`. Drafter keeps emitting plain markdown; the plugin connects the pipes so the dormant Web Component activates. Humanises kebab-case headings (`## what-is-hormuz` → "What Is Hormuz"). No-op when MDX has no h2s.
- [x] Inline embedded companion interactive — Area 4's quiz + Phase 2's HTML interactive both render at the bottom of the daily piece page (Area 5, 2026-04-26). The standalone `/interactives/<slug>/` URL still works ("essence not reference" — Area 4's design property is preserved). Shared helper `src/lib/interactives.ts` keeps the standalone route + the daily route on one bundle shape.
- [x] Finish-state footer with tagline, `Read another →`, `Browse library →`, and a Web Share API + clipboard-fallback share button. Mobile-first; tap targets ≥44px.
- [x] "How this was made" transparency drawer (`src/components/MadeBy.astro` + `src/interactive/made-drawer.ts` + `src/styles/made.css` + `/api/daily/[date]/made`). Per-piece timeline, audit rounds, rules applied, rejected candidates. Aggregates `pipeline_log` + `audit_results` + `daily_candidates` + `daily_pieces`. No new schema, no agent changes. Deep-linkable via `#made`.

### Stage 3 — Reader Accounts & Progress (complete)
- [x] Astro Cloudflare adapter (static pages + server-rendered API routes)
- [x] D1 database: 19 tables, 23 migrations (see `docs/SCHEMA.md`)
- [x] Anonymous-first auth middleware (cookie on first API call)
- [x] Progress API: save beat, mark complete, fetch progress
- [x] Auth API: email upgrade, login, logout
- [x] PBKDF2 password hashing via Web Crypto API
- [x] Account page, login page
- [x] Security headers (`public/_headers` — X-Frame, CSP, XSS, etc.)
- [x] Rate limiting on login (5 attempts per 15 min per IP)
- [x] lesson-shell POSTs progress (fire-and-forget, offline-safe)

### Stage 4 — Agent Team (complete — 16 agents, all wired)
- [x] Separate `agents/` Worker with Cloudflare Agents SDK (v0.11.1)
- [x] DirectorAgent — pure orchestrator, zero LLM calls, hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC only), manual trigger
- [x] CuratorAgent — picks most teachable story, plans beats (restored from v10 deletion; owns its prompt file)
- [x] DrafterAgent — writes MDX from brief (restored from v10 deletion; owns its prompt file)
- [x] VoiceAuditorAgent — scores voice compliance 0-100, ≥85 to pass (owns its prompt file)
- [x] StructureEditorAgent — reviews beat structure, pacing; writes learnings for both passing (confidence 60) and failing (40) drafts (owns its prompt file)
- [x] FactCheckerAgent — verifies claims (two-pass: Claude + DuckDuckGo web search); exposes `searchAvailable` on result, Director logs an Observer warn when search fails so the pipeline honours the "no silent failure" principle (owns its prompt file)
- [x] IntegratorAgent — merges audit feedback, revises draft, up to 3 rounds; stateless (fresh DO per day: `integrator-daily-${today}`) (owns its prompt file)
- [x] AudioProducerAgent — ElevenLabs TTS (Frederick Surrey, `eleven_multilingual_v2`, `mp3_44100_96`), saves per-beat MP3 to R2, writes `daily_piece_audio` rows. 20k-char budget cap, 3-attempt retry, request-stitching for prosodic continuity. Text normalisation via `agents/src/shared/tts-normalize.ts` (provider-agnostic): "Zeemish → Zee-mish" prosody alias + Roman-numeral → spelled-word conversion (e.g. "Schedule IV and V" → "Schedule four and five") with pronoun-safe three-pass logic. Live 2026-04-18; normaliser layer added 2026-04-23.
- [x] AudioAuditorAgent — reads `daily_piece_audio` rows + HEADs R2, checks size (0.3×–3× of expected for 96 kbps narration at ~12.5 chars/sec), total char cap, missing objects. Live 2026-04-18.
- [x] PublisherAgent — commits MDX to GitHub via Contents API
- [x] ObserverAgent — logs events, provides digest/events endpoints
- [x] LearnerAgent — watches engagement + writes learnings for future pieces; uses shared `extractJson` parser (merged from EngagementAnalyst + Reviser; owns its prompt file)
- [x] Full pipeline: Scanner → Curator → Drafter → 3 parallel auditors → Integrator (if any gate fails) → Publisher (text commit) → Audio Producer → Audio Auditor → Publisher.publishAudio (metadata-only second commit splicing audioBeats). Text commit is atomic — newspaper-never-skips — audio retries asynchronously via admin dashboard button on failure.
- [x] Auth on trigger endpoint (ADMIN_SECRET bearer token)
- [x] Dashboard: `/dashboard/` (public factory floor) + `/dashboard/admin/` (ADMIN_EMAIL gated)
- [x] Audit results persisted to D1 `audit_results` table (migration 0008 fixed the orphaned FK that had silently blocked all writes — see DECISIONS.md)
- [x] R2 bucket `zeemish-audio` for audio storage (agents worker writes per-beat MP3s at `audio/daily/{date}/{beat}.mp3`)
- [x] Optional `SCANNER_RSS_FEEDS_JSON` env override lets ops change Scanner's feed list without a redeploy

### Stage 5 — First Course (removed)
- Course content deleted — daily pieces are now the primary content unit
- "The body you live in" served its purpose as a testing ground for the pipeline
- Library page at /library/ replaces /courses/

### Stage 6 — Self-Improvement Loop (complete — all four signal sources wired)
- [x] EngagementAnalystAgent built and deployed
- [x] LearnerAgent built (merged from EngagementAnalyst + Reviser)
- [x] Engagement tracking API (`/api/engagement/track`)
- [x] lesson-shell tracks views and completions
- [x] D1 tables: engagement, learnings
- [x] StructureEditorAgent writes learnings — **removed 2026-04-20** in favour of Learner's post-publish synthesis (DECISIONS 2026-04-20 "Drop StructureEditor's writeLearning calls")
- [x] Reader-side: `LearnerAgent.analyseAndLearn` writes `source='reader'` learnings when engagement signals arrive (pending reader traffic)
- [x] Producer-side (P1.3, 2026-04-19): `LearnerAgent.analysePiecePostPublish` writes `source='producer'` learnings immediately after `publishing done`
- [x] Self-reflection (P1.4, 2026-04-19): `DrafterAgent.reflect` writes `source='self-reflection'` learnings immediately after `publishing done`
- [x] Zita-question synthesis (P1.5, 2026-04-21): `LearnerAgent.analyseZitaPatternsDaily` writes `source='zita'` learnings, scheduled at **01:45 UTC on day+1** (not publish+1h — needs a day of reader traffic to accumulate). Guarded no-op below 5 user messages per piece. See DECISIONS 2026-04-21 "P1.5 Learner skeleton".
- [x] Drafter runtime reads `getRecentLearnings(DB, 10)` with no source filter — all four sources auto-flow into tomorrow's prompt

### Stage 7 — Zita (complete)
- [x] Zita chat API (`/api/zita/chat`) — Socratic guide via Claude API
- [x] `<zita-chat>` Web Component — floating chat on lesson pages
- [x] Per-user per-lesson conversation history in D1
- [x] Integrated into LessonLayout
- [x] **Scoped by piece_date (2026-04-21)** — every daily piece had been pooling conversations under `(course='daily', lesson_number=0)`; migration 0013 adds `zita_messages.piece_date` with backfill for the 92 pre-migration rows. System prompt now names the piece the reader is on. See DECISIONS 2026-04-21 "Scope zita_messages by piece_date".
- [x] **History soft cap at 40 (2026-04-21)** — per-turn Claude call capped at last 40 messages; `zita_history_truncated` observer event fires when the cap clips. Full history stays in D1.
- [x] **Admin view (2026-04-21)** — `/dashboard/admin/zita/` (standalone) + per-piece "Questions from readers" section on `/dashboard/admin/piece/[date]/`. Joins `zita_messages` with `daily_pieces` headlines.
- [x] **Safety observer events (2026-04-21)** — `zita_claude_error` (on Claude non-OK, captures upstream status + body snippet), `zita_rate_limited` (on 429, captures userId), `zita_handler_error` (on unhandled exception). Storage cap of 4000 chars on both user and assistant content INSERTs.
- [x] **Design doc for deep-Zita (2026-04-21)** — [`docs/zita-design.md`](zita-design.md) covers multi-turn state, tool-use loop scope, Vectorize library index, failure modes, no-human-handoff decision, voice-consistency harness. Gates all deep-Zita code.
- [ ] Deep-Zita v1 (library search, tool-use loop, session summary, reader profile, voice harness, category logging) — sequenced in design doc §7, not yet built.

### Daily Pieces System (complete)
- [x] ScannerAgent (#14) — fetches Google News RSS across 6 categories
- [x] Director daily mode — picks most teachable story, writes brief, runs pipeline
- [x] Daily piece pages at /daily/ and /daily/YYYY-MM-DD/
- [x] Home page redesign — today's piece prominent, library below
- [x] D1 tables: daily_candidates, daily_pieces (migration 0006)
- [x] Content collection: dailyPieces with date/newsSource/underlyingSubject schema
- [x] Scheduled: Director on hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC every day including weekends)
- [x] First daily piece published and live

### Public discoverability surfaces (complete — 2026-04-25)
- [x] `/sitemap.xml` — SSR endpoint at [src/pages/sitemap.xml.ts](../src/pages/sitemap.xml.ts). Enumerates homepage, /daily/, /library/, every published daily piece (with slug-inclusive URL), every interactive, every category page (D1-driven). Hand-rolled rather than `@astrojs/sitemap` because the integration only emits prerendered routes — `/library/` and `/library/<slug>/` are SSR. Fail-open on D1 error so static entries always render. Cache-Control: `public, max-age=3600`. Submit to Google Search Console once; never has to be touched again.
- [x] `/rss.xml` — SSR endpoint at [src/pages/rss.xml.ts](../src/pages/rss.xml.ts). RSS 2.0 feed of every daily piece, newest first by `publishedAt` DESC. Per-item: title, canonical link, description (frontmatter), pubDate (`publishedAt` → RFC 1123), guid (`pieceId` with `isPermaLink="false"` so feed readers de-duplicate by stable UUID even if URL shape changes). Description-only for v1; full `<content:encoded>` deferred until reader demand surfaces. Hand-rolled — `@astrojs/rss`'s default guid is the link with `isPermaLink="true"` and isn't overridable without duplicating the element.
- [x] `robots.txt` advertises the sitemap via `Sitemap: https://zeemish.io/sitemap.xml` directive at the bottom.
- [x] BaseLayout `<head>` carries `<link rel="alternate" type="application/rss+xml" title="Zeemish daily pieces" href="/rss.xml" />` so Feedly / Inoreader / NetNewsWire auto-discover the feed from any page.
- [x] `/og-image.png` — 1200×630 PNG OG card for social platforms (Twitter / LinkedIn / Facebook / WhatsApp / iMessage / Slack — none render SVG OG, so the prior `og-image.svg` was effectively broken on every share). Generated via [scripts/generate-og-image.mjs](../scripts/generate-og-image.mjs) (one-off, run when design changes — not a build step). Sharp renders an inline SVG with system sans-serif fallback (Helvetica Neue on macOS). Same image for every page; per-piece dynamic OG (headline + tier rendered at the edge) is a future Worker route project.
- [x] `<meta name="description">` always renders on every page via a single `metaDescription` constant in BaseLayout that also feeds `og:description` and `twitter:description`. Fallback is the brand description ("Educate yourself for humble decisions. Daily teaching, made by N agents."). Pre-fix, pages without an explicit description prop (login, auth/verify, dashboard/admin) had no description tag at all.
- [x] JSON-LD Article schema on daily-piece pages via [src/layouts/BaseLayout.astro](../src/layouts/BaseLayout.astro). Self-gated by the new optional `article` prop (interactives share `ogType="article"` but opt out by not passing the prop). Article (not NewsArticle — Zeemish teaches, doesn't report) with headline, description, datePublished + dateModified (same per the permanence rule), image array, author + publisher (Organization Zeemish with logo as ImageObject + dimensions), mainEntityOfPage. When a piece has audio, an `AudioObject` lands in `associatedMedia` pointing at a representative beat — picker prefers legacy `audioSrc`, then the `"hook"` beat (standard opening across every current piece), then first iteration order. v1 emits one AudioObject per Article; per-beat array deferred. Defensive `\u003c` escape on the JSON-LD body protects against `</script>` injection. Validated post-deploy via schema.org validator (0 errors) and Google Rich Results Test (1 valid Article detected).

## What's NOT built (honest gaps)

### Small remaining items
- Voice contract duplicated in .md and .ts — manual sync required

## Deviations from plan
1. **Single Astro Worker for site + API** instead of separate workers. Avoids CORS.
2. **Workflows v2 added** — PublishLessonWorkflow wraps the pipeline in durable steps.
3. **Agent code is flat files** (e.g. `scanner.ts`) not subdirectories.
4. **Dashboard is in Astro site** not a separate `dashboard/` project.
5. **Fact-Checker uses Claude reasoning only**, not Workers AI Search.
6. **Daily pieces only** — courses removed, daily news-driven teaching is the only content type.
7. **Audio failure doesn't block publishing — ship-and-retry** — text commits the moment Integrator approves. Audio runs as a separate phase; if Producer, Auditor, or `publishAudio` fails, Observer logs an escalation and the admin deep-dive (`/dashboard/admin/piece/{date}/{slug}/`) surfaces three retry affordances: **Continue** (resume where a failed run stopped), **Start over** (wipe all R2 clips + D1 rows and regenerate from scratch), and per-beat **Regenerate** (surgical refresh of one clip — for post-publish fixes like the 2026-04-23 TTS normaliser change). A newspaper never skips a day.
8. **Metadata carve-out to the permanence rule** — `publishAudio` modifies an already-committed MDX file to add `audioBeats: {…}` to frontmatter. This is a deliberate carve-out: the "published pieces are permanent" hard rule governs teaching **content** (beats, narrative, facts), not frontmatter **metadata** (`voiceScore`, `qualityFlag`, `audioBeats`). `publishToPath` still refuses to overwrite; `publishAudio` is the only metadata-only path. See DECISIONS 2026-04-18.
9. **Site worker serves `/audio/*` from R2 via an Astro catch-all route** — `src/pages/audio/[...path].ts` + `AUDIO_BUCKET` R2 binding on the site worker's wrangler.toml. Not a middleware rule (initially built that way but Cloudflare Static Assets intercepts unrecognised paths with the prerendered 404.html before middleware runs; registering as a real Astro route makes the worker run). Range requests supported for seeking. `Cache-Control: public, max-age=31536000, immutable` — 1-year edge cache. Caveat since 2026-04-23 per-beat regen landed: regenerated clips live at the same deterministic R2 key → same URL → returning readers may hear the stale cached MP3 until browser/CDN cache expires. Hard-refresh bypasses. Cache-header tuning for regen-aware invalidation is a future project (see FOLLOWUPS).
10. **Per-agent prompt files** — every pipeline agent owns its prompt file: `curator-prompt.ts`, `drafter-prompt.ts`, `voice-auditor-prompt.ts`, `structure-editor-prompt.ts`, `fact-checker-prompt.ts`, `integrator-prompt.ts`, `learner-prompt.ts`. Matches the "one prompt per agent, co-located" principle in AGENTS.md. `shared/prompts.ts` is a tombstone.
11. **No silent failure enforcement** — Director logs an Observer warn (severity='warn') when FactChecker's web search is unavailable, so the draft is known to have been assessed by Claude's first-pass only.

## Future flexibility

This section documents three shapes of future change that have been considered but not built. They live here so the next session that needs them can see the change size before starting. Documentation only; no code change implied by anything in this section.

**LLM portability — make the Claude model configurable at the worker level.** Today every Claude call hardcodes `claude-sonnet-4-5-20250929` directly inline at the call site. A grep across `agents/src/` finds 18+ instances spanning 11 agent files; even within a single agent (Learner has 3, InteractiveGenerator has 4) the constant repeats per call. The change shape is small: read `MODEL_ID` from `admin_settings` (or an environment variable) once at agent-init time, store it as an instance field on each agent, replace the inline literals with `this.model` in every `anthropic.messages.create({ model: this.model, ... })` call. No abstraction layer needed — the Anthropic SDK's `model` parameter accepts any model ID, so the same code shape works for `claude-sonnet-4-7-XXXXX`, `claude-opus-4-7-XXXXX`, or a future variant. **Effort to actually build: ~4 hours** — 11 files of mechanical replacement, a new admin_settings key, optionally a dashboard surface to flip the model without redeploy. The harder question is the QUALITY check: changing the model invalidates the voice-tier baseline (Polished/Solid/Rough thresholds were calibrated against Sonnet 4.5), so any swap should be paired with a manual re-audit of the next 5-10 pieces against the existing tier shape.

**Audio portability — abstract the TTS provider behind an interface.** ElevenLabs lives in exactly one place: `agents/src/audio-producer.ts:callElevenLabs` (the URL `api.elevenlabs.io/v1/text-to-speech/...` appears once). The provider-agnostic text normaliser at `agents/src/shared/tts-normalize.ts` was already designed for this — Roman-numeral conversion and prosody aliases live upstream of the ElevenLabs-specific code on purpose. The change shape is: define an `AudioProvider` interface — `{ generate(text: string, voice_settings: VoiceSettings, previous_request_ids?: string[]): Promise<{ audio_buffer: ArrayBuffer, request_id: string, character_count: number }> }` — extract the current ElevenLabs code into `agents/src/providers/elevenlabs.ts` as one implementation, and let the producer choose at runtime via `admin_settings.audio_provider`. OpenAI TTS, Google Cloud TTS, or a future provider implements the same interface and slots in without producer changes. Per-provider voice IDs and stitching-window semantics live inside each implementation. **Effort to build: ~6 hours** including the interface design, ElevenLabs implementation extraction, one second-provider implementation, and an admin-settings key + dashboard switch. Per-beat audio regen, the 20k-char budget cap, and the audio auditor all stay provider-agnostic and need no change.

**Multi-environment support — add a staging environment without duplicating the code.** Today there is no staging environment; `wrangler deploy` from `main` ships straight to prod for both workers. The change shape is: separate D1 database (`zeemish-staging`), separate R2 bucket (`zeemish-audio-staging`), separate worker names (`zeemish-v2-staging`, `zeemish-agents-staging`), separate GitHub branch convention (`staging` → CI auto-deploys staging workers, `main` → CI auto-deploys prod). Worker code reads an `ENVIRONMENT` value from each `wrangler.toml`'s `[vars]` section to switch DB and R2 bindings; no code branches inside the application logic, just the binding declarations. Secrets get duplicated per-environment in Cloudflare's secret store (`ANTHROPIC_API_KEY` could be the same key, `GITHUB_TOKEN` may want a staging-only token scoped to a staging branch, `ELEVENLABS_API_KEY` likely the same). **Effort to build: ~8 hours** including the wrangler.toml duplication, GitHub Actions workflow updates (one workflow per environment with a branch filter), Cloudflare secret-store setup per environment, and a smoke-test pass on staging to confirm Scanner / Curator / Drafter / Publisher / Audio all work against staging-scoped resources. The bigger discipline question is what staging is FOR — running the pipeline against staging news feeds and writing to a staging Library is one shape; using staging only for code changes that don't touch the agent prompts is a narrower shape. Decide that first.

These three changes are independent — any one can ship without the others, and none of them require the others as prerequisites.
