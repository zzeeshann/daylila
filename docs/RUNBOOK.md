# Zeemish v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

> **URLs:** The site lives at `https://zeemish.io` (custom domain bound to the `zeemish-v2` worker, launched 2026-04-18). The workers.dev URL `https://zeemish-v2.zzeeshann.workers.dev` is still active as a fallback but no longer the canonical entrypoint. The agents worker remains on `https://zeemish-agents.zzeeshann.workers.dev` — internal API, not user-facing.

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- wrangler (`npm install -g wrangler`, then `wrangler login`)

## Run locally

### Site (Astro)
```bash
cd zeemish-v2
pnpm install
pnpm dev
# Open http://localhost:4321
```

### Agents worker
```bash
cd agents
pnpm install
pnpm dev
# Runs at http://localhost:8787
```

## Build for production
```bash
pnpm build
# Output in dist/
```

## Submit sitemap to search engines

One-time human action after the SEO foundations shipped (2026-04-25). The sitemap auto-generates on every request — submission is just registering the URL with the major crawlers so they know to schedule fetches. Re-submission isn't needed when new pieces publish; the crawlers re-poll the URL on their own cadence.

### Google Search Console
1. Go to https://search.google.com/search-console
2. Add property → URL prefix → `https://zeemish.io`
3. Verify ownership (DNS TXT record on the Cloudflare zone, or the HTML file method — DNS is preferred since the site auto-deploys)
4. Sitemaps → Add a new sitemap → enter `sitemap.xml` → Submit
5. Wait 1–3 days for the first crawl; check Coverage report for any errors

### Bing Webmaster Tools
1. Go to https://www.bing.com/webmasters
2. Add a site → `https://zeemish.io`
3. Verify ownership (same DNS TXT method works)
4. Sitemaps → Submit sitemap → `https://zeemish.io/sitemap.xml`

### Regenerate the OG image
When the brand or design changes:
```bash
node scripts/generate-og-image.mjs
git add public/og-image.png
git commit -m "chore(seo): refresh og:image"
```
The script's inline SVG is the source of truth — edit it there, not in the PNG.

## Deploy

### Site
```bash
pnpm build
wrangler deploy
# Deploys to https://zeemish.io (workers.dev URL still active as fallback)
```
Also auto-deploys on every push to `main` via GitHub Actions.

### Agents
```bash
cd agents
wrangler deploy
# Deploys to https://zeemish-agents.zzeeshann.workers.dev
```
Also auto-deploys on every push to `main` via GitHub Actions (same as site).

## Secrets

### Site worker
```bash
wrangler secret put ANTHROPIC_API_KEY    # For Zita chat
wrangler secret put AGENTS_ADMIN_SECRET  # For dashboard trigger proxy
wrangler secret put RESEND_API_KEY       # For magic link emails
wrangler secret put ADMIN_EMAIL          # For admin dashboard access
```

### Agents worker
```bash
cd agents
wrangler secret put ANTHROPIC_API_KEY   # For Claude API calls
wrangler secret put GITHUB_TOKEN        # For Publisher commits
wrangler secret put ELEVENLABS_API_KEY  # For Audio-Producer TTS
wrangler secret put ADMIN_SECRET        # For trigger endpoint auth
```

### Optional agents-worker settings
```bash
# Override Scanner's RSS feed list without a redeploy.
# Shape: {"CATEGORY": "https://feed.url/...", ...}
# Malformed JSON falls back to the hardcoded defaults in scanner.ts.
wrangler secret put SCANNER_RSS_FEEDS_JSON
```

## D1 Database

### Run migrations
There are 23 migrations (`0001_init.sql` … `0023_interactive_audit_results.sql`). Note: `0019_piece_id_backfill.sql` is a manual-only migration (commented UPDATEs — auto-apply is a no-op; run via `wrangler d1 execute --file` if you need to backfill a fresh DB).
Apply them (idempotent — skips any already recorded in `d1_migrations`):
```bash
wrangler d1 migrations apply zeemish --remote

# Check what's in the database
wrangler d1 execute zeemish --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```
See `### Migration tracker hygiene` below before applying on a live DB — the tracker must be in sync or `migrations apply` will try to replay everything.

### Query the database
```bash
wrangler d1 execute zeemish --remote --command="SELECT * FROM users LIMIT 5"
wrangler d1 execute zeemish --remote --command="SELECT * FROM observer_events ORDER BY created_at DESC LIMIT 10"
```

### Migration tracker hygiene
Migrations are tracked in the `d1_migrations` table. As of 2026-04-21 the tracker is in sync (16 rows, 0001–0016). Keep it that way:

- **Use `wrangler d1 migrations apply zeemish --remote`** for any new migration on a live DB — not `wrangler d1 execute --file=...` and not `wrangler d1 execute --command=...`. Only `migrations apply` writes to `d1_migrations`; the other paths run the SQL but leave the tracker blind, which is how we got into the 2026-04-20 mess.
- **Pre-flight check** before applying:
  ```bash
  wrangler d1 execute zeemish --remote --command="SELECT name FROM d1_migrations ORDER BY id"
  ```
  The result should list every `.sql` file in `migrations/` except the pending one. If rows are missing, the tracker is drifted and `migrations apply` will try to replay everything — likely hitting `duplicate column name` on an `ALTER TABLE ADD COLUMN` that's already live.
- **If drift is detected:** recovery is to manually `INSERT INTO d1_migrations (name) VALUES ('NNNN_…')` for the already-applied rows the tracker is missing, then re-run `migrations apply`. Full procedure and the specific rows inserted on 2026-04-20 are documented in [DECISIONS.md](DECISIONS.md) 2026-04-20 "Surfacing the learning loop" (operational-notes bullet on the migration-apply snag).

## Trigger a daily piece

Daily pieces are the only content type. The manual trigger and the
scheduled run use the same `/daily-trigger` endpoint.

### Via curl (requires ADMIN_SECRET)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/daily-trigger" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Via dashboard
Visit https://zeemish.io/dashboard/admin/ and use
the trigger button (requires ADMIN_EMAIL login).

### Automatic
The Director runs on an hourly cron, gated by `admin_settings.interval_hours` (see [`src/pages/dashboard/admin/settings.astro`](../src/pages/dashboard/admin/settings.astro)). At the default value 24, only the 02:00 UTC slot fires — preserving the "every morning" cadence. Admins can flip to 1/2/3/4/6/8/12 hours via the settings page without a redeploy; change propagates at the next hourly alarm. It scans news, picks the story whose underlying system best teaches the protocol, drafts, audits, and publishes. At the default cadence the piece is ready by ~04:00 UTC. Curator's default is to PICK; skip is rare and reserved for narrow conditions (single breaking event re-reported with no new angle, or pure product/spec announcements with no system to teach). When a skip does fire, the reason names the specific condition, not a category dismissal — see DECISIONS 2026-04-25 "Curator reframed around the Zeemish protocol".

### Check Director status
```bash
# /status requires auth — it's an admin endpoint
curl "https://zeemish-agents.zzeeshann.workers.dev/status" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### View daily pieces
- Archive: https://zeemish.io/daily/
- Single piece: https://zeemish.io/daily/YYYY-MM-DD/

## Interactives v3 — HTML interactive flag

The `admin_settings.interactives_html_enabled` flag (migration 0024,
default `'false'`) gates the HTML-interactive generation path that
lands in Phase 2 of the Interactives v3 work. Quizzes are NOT gated
— InteractiveGenerator's existing quiz path runs unchanged regardless
of the flag.

Phase 3 of v3 ships an admin-UI toggle alongside the cadence dropdown.
Until then, the only way to flip is `wrangler d1 execute`:

```bash
# Read current value
wrangler d1 execute zeemish --remote --command \
  "SELECT * FROM admin_settings WHERE key = 'interactives_html_enabled';"

# Flip on (Phase 2 read site must already be deployed):
wrangler d1 execute zeemish --remote --command \
  "UPDATE admin_settings SET value='true', updated_at=strftime('%s','now')*1000
     WHERE key='interactives_html_enabled';"

# Flip off (rollback):
wrangler d1 execute zeemish --remote --command \
  "UPDATE admin_settings SET value='false', updated_at=strftime('%s','now')*1000
     WHERE key='interactives_html_enabled';"
```

Read by Director on the next pipeline run (no DO restart). Generator
falls back to `false` if the row is missing (Phase 2 reader uses the
same `getAdminSetting<T>` helper as `interval_hours`).

The full migration rollback (drop the row entirely) is a one-line
DELETE; see `migrations/0024_interactives_html_flag.sql` header for
the exact statement and rationale.

## Reset today (clean slate for a dev-mode re-test)

Daily pieces are the product. Cadence is configurable via
`admin_settings.interval_hours` (default 24 → one piece/day at 02:00
UTC; admins can flip to 1/2/3/4/6/8/12 via `/dashboard/admin/settings/`
without a redeploy). The admin manual trigger bypasses the slot-window
guard so you can test end-to-end during development, but that can leave
duplicate state from multiple runs within a slot.

### One command
```bash
export ADMIN_SECRET="..."   # same as AGENTS_ADMIN_SECRET

# Full-day reset (default) — wipes every piece for today's date:
./scripts/reset-today.sh

# Single-piece reset (multi-per-day cadence) — wipes just that piece:
./scripts/reset-today.sh --piece-id ab95f0f8-b419-4e2e-95a8-46ca0290957a

# Single-piece reset + fresh pipeline run (also needs ADMIN_SECRET):
./scripts/reset-today.sh --piece-id <uuid> --retrigger
```
Default mode does three steps (git rm + D1 clear + trigger) in order,
pushes the cleanup commit, and prints the run's HTTP status. Runs in
under a minute including the push wait.

`--piece-id` mode scopes every delete by piece_id on the nine
piece-id-capable tables, plus a ±20min time window around the piece's
`published_at` for pipeline_log + observer_events (the two without a
piece_id column; matches Learner's synthesis window math). git rm
matches the MDX by `pieceId: "<uuid>"` frontmatter. Does not fire a
new pipeline run unless `--retrigger` is also passed — at multi-per-day
cadence a single-piece re-run has no natural cron slot, so the
operator makes the trigger decision explicitly. See
`scripts/reset-today.sh --help` for the exact table list.

### Verify
- Pipeline monitor on `/dashboard/admin/` shows step-by-step progress
- Public pipeline data: `curl /api/dashboard/pipeline` (no auth)
- Single piece in D1 after completion: `wrangler d1 execute zeemish --remote --command="SELECT date, headline, voice_score FROM daily_pieces WHERE date = date('now')"`
- Live URL: `/daily/YYYY-MM-DD/` should return 200 after the post-publish deploy completes (~30s)

### Manual fallback (if the script misbehaves)
#### 1. Remove today's MDX file(s) from git
```bash
git rm content/daily-pieces/$(date -u +%Y-%m-%d)-*.mdx
git commit -m "test: reset for pipeline re-test"
git push
# Wait ~30s for auto-deploy to strip them from the live site
```

#### 2. Clear today's D1 rows across all 5 tables
```bash
DATE=$(date -u +%Y-%m-%d)
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_pieces WHERE date = '$DATE'; \
   DELETE FROM daily_candidates WHERE date = '$DATE'; \
   DELETE FROM daily_piece_audio WHERE date = '$DATE'; \
   DELETE FROM pipeline_log WHERE run_id = '$DATE'; \
   DELETE FROM audit_results WHERE task_id LIKE 'daily/$DATE%'; \
   DELETE FROM observer_events WHERE created_at >= (strftime('%s','now','start of day') * 1000);"
```
Note: `observer_events` uses an epoch-ms `created_at` timestamp (not a
date string), so the cutoff is computed inside SQL with
`strftime(...,'start of day')`. A prior version of this runbook used a
shell `DATE_MS` formula that reused the current time-of-day on macOS
BSD `date`, leaving morning-run events behind after an afternoon
reset. If you forget this table, the admin dashboard Observer feed
still shows earlier "Published: …" events even after the underlying
pieces are deleted — accurate history but visually confusing during a
reset.

#### 3. Trigger a fresh run
Either press "Trigger Daily Piece" on `/dashboard/admin/`, or curl as above.

## Seed categories across historical pieces

Area 2 sub-task 2.3. One-time backfill — fires the 14th agent (Categoriser) against every published piece so the category taxonomy and `piece_categories` rows catch up before the library filter + admin page ship.

```bash
export ADMIN_SECRET="..."   # same value as AGENTS_ADMIN_SECRET

# Live run
./scripts/seed-categories.sh

# Preview (no HTTP calls)
DRY_RUN=1 ./scripts/seed-categories.sh
```

What it does:
- Pulls every piece from `daily_pieces` ordered by `published_at ASC`. Oldest first matters — Categoriser is reuse-biased, so running the earliest pieces first lets the initial taxonomy form from real pieces; later runs mostly reuse rather than proliferate.
- Per piece: pre-checks `piece_categories` for existing rows (skips if found) → POSTs `/categorise-trigger?piece_id=<uuid>` → polls until `piece_categories` shows the write (up to 90s timeout, 3s interval) → prints the assigned slug(s) with confidence.
- Prints a "Taxonomy after run:" summary at the end — every category with its piece count.

Idempotent: re-running is safe. Already-categorised pieces are skipped at the agent layer (no Claude call, no writes). Use when you want to retag pieces after an admin merge/delete flow (sub-task 2.5) wipes a category's rows — run the script and it'll fire only on the now-empty pieces.

Failure surface: an individual piece failure (Claude API blip, GitHub 404 on the re-read) prints a line and continues to the next piece. The tail summary shows `failed: N`. Script exits 1 if any fail. Retry by re-running — idempotence handles the already-done ones.

## Check what agents have been doing
All three endpoints are admin-only and require `ADMIN_SECRET`.
```bash
# Last 24 hours digest
curl "https://zeemish-agents.zzeeshann.workers.dev/digest" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"

# Recent events
curl "https://zeemish-agents.zzeeshann.workers.dev/events?limit=10" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"

# Engagement report
curl "https://zeemish-agents.zzeeshann.workers.dev/engagement?course=daily" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### What to watch for on a fresh run
- `severity: 'info'`, title `Published: …` — the happy path
- `severity: 'escalation'`, title `Escalation: …` — failed 3 revision rounds
- `severity: 'warn'`, title `Error: fact-check` — web search (DuckDuckGo)
  was unreachable, so fact-checking used Claude's first-pass assessment
  only. Pipeline continued, but unverified claims may have slipped past.
  Worth re-running or spot-checking the piece.
- `severity: 'info'`, title `Zita synthesis skipped: …` — P1.5 fired at
  01:45 UTC but the piece had fewer than 5 reader messages. Expected at
  current traffic levels.
- `severity: 'info'`, title `Zita synthesis: …` — P1.5 produced at
  least one Zita-source learning; tokens-in/out + latency in the body.
- `severity: 'warn'`, titles starting `Zita …` without "synthesis" —
  site-origin events: `zita_history_truncated` (long session past the
  40-message cap, full row count in context), `zita_rate_limited`
  (user exceeded 20/15min), `zita_claude_error` (Claude API non-OK,
  upstream body in context), `zita_handler_error` (unhandled
  exception in the chat handler). The first three are expected
  occasional signal; `zita_handler_error` warrants investigation.

## Zita operations

### How the synthesis fires (automatic is the default)
The P1.5 synthesis runs **automatically**, you don't need to do anything:

- Each piece publishes on the cron slot (default: once daily at 02:00 UTC). That same run schedules a synthesis at `publish + 23h45m` (85,500 seconds), relative to each piece individually. At the default cadence that lands at ~01:45 UTC the next day, just before the next 02:00 UTC run; at multi-per-day cadences every piece gets its own ~24h reader window before synthesis fires. Phase 6 (2026-04-21) moved this from an absolute clock target to a relative-delay-per-piece to avoid stacking synth jobs at multi-per-day.
- If the piece got ≥5 reader messages, the synthesis runs, writes up to 10 `source='zita'` rows into `learnings`, and those rows flow into the next Drafter prompt via `getRecentLearnings(10)`.
- If it got fewer than 5, the synthesis skips silently (one `info` observer event, zero Claude cost).
- Failures are non-retriable: one `warn` observer event ("Zita synthesis missed: …"), and the loop moves on. The piece is already live and permanent — a missed batch of learnings is recoverable via manual trigger.

The **Run synthesis** button on `/dashboard/admin/piece/[date]/` is there for the recovery case (a scheduled run failed and you want to retry) and the testing case (verify the synthesis works against an older piece). Under normal operation you never need it.

### Admin surfaces
- **Reader chats:** `/dashboard/admin/zita/` (ADMIN_EMAIL only) — 30-day window, conversations grouped by reader × piece, expandable transcripts.
- **Per-piece chats:** `/dashboard/admin/piece/[date]/` → "Questions from readers" section.
- **Run synthesis button:** on the same per-piece page, next to the "Questions from readers" header. Uses your admin session, no secret to type.

### Manual trigger via curl (if you prefer)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/zita-synthesis-trigger?date=2026-04-20" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
# Returns 202 {"status":"started","date":"2026-04-20","title":"…"}.
# Observer event lands within ~10s on success (logZitaSynthesisMetered),
# a few seconds on the skip path.
```

### Inspect what synthesis produced
```bash
wrangler d1 execute zeemish --remote --command="SELECT source, category, observation FROM learnings WHERE piece_date = '2026-04-20' AND source = 'zita'"
```

### Cost metering
Every synthesis run — skipped or success — writes a `logZitaSynthesisMetered` observer event with `{tokensIn, tokensOut, durationMs}`. First real run (2026-04-21, against the 2026-04-20 Hormuz piece): 1,636 in / 368 out / 10.7s / 5 learnings written. ~$0.01 at current Sonnet 4.5 prices. Watch drift there before it matters.

### Limits & knobs (all code-level constants, single-file edits)

| Knob | Value | Where | Purpose |
|---|---|---|---|
| Max reader message length | 2,000 chars | [`src/pages/api/zita/chat.ts`](../src/pages/api/zita/chat.ts) input guard | Stops paste-bomb abuse |
| Reader rate limit | 20 msgs / 15 min / user | same file, `checkRateLimit(…, 20, 900)` | Stops runaway clients; 429 fires `zita_rate_limited` observer event |
| Per-turn history sent to Claude | Last 40 messages | `ZITA_HISTORY_LIMIT` | Bounds per-turn cost; clipping logs `zita_history_truncated` |
| Max stored content length | 4,000 chars | `ZITA_STORED_CONTENT_CAP` | Hard ceiling on what lands in `zita_messages.content` — appends `[…truncated]` marker if hit |
| Synthesis minimum threshold | 5 reader messages per piece | `ZITA_SYNTHESIS_MIN_USER_MESSAGES` in [`agents/src/learner.ts`](../agents/src/learner.ts) | Below this, synthesis skips without calling Claude |
| Synthesis write cap | 10 learnings per run | `ZITA_LEARNINGS_WRITE_CAP` | If Claude produces more, overflow is logged via observer |
| Synthesis schedule | publish + 23h45m (per piece) | [`agents/src/director.ts`](../agents/src/director.ts) `triggerDailyPiece` | Same ~24h reader window regardless of publish time; no stacking at multi-per-day cadences |
| Claude model + max_tokens | Sonnet 4.5, 300 per turn | chat.ts | Short replies enforced at the API level |
| Synthesis max_tokens | 2,000 | `learner.ts` synthesis call | Enough for 10 learnings |

## Dashboard API endpoints (site worker)
```bash
# Admin only (ADMIN_EMAIL):
GET  /api/dashboard/observer  # Observer events
POST /api/dashboard/observer  # Acknowledge event { eventId }
GET  /api/dashboard/pipeline  # Live pipeline state (admin poll + reset-today.sh monitor)
```

No public JSON API — public dashboard + library pages query D1 directly via Astro frontmatter (see `/dashboard/` and `/library/` source). The prior `recent.ts` / `stats.ts` / `memory.ts` / `analytics.ts` / `today.ts` endpoints were created early but superseded by direct queries; removed in the 2026-04-22 dead-endpoint audit.

Admin Astro pages (also ADMIN_EMAIL-gated): `/dashboard/admin/`, `/dashboard/admin/piece/[date]/[slug]/`, `/dashboard/admin/zita/`, `/dashboard/admin/settings/`.

## Audio — retry, troubleshooting, cost

### Retry audio for a piece

Admin deep-dive at `/dashboard/admin/piece/{date}/{slug}/` exposes three retry affordances. Pick by scope of the fix:

- **Continue** — only visible when audio is incomplete (`has_audio=0` + partial rows). Resume from where the prior run stopped. R2 head-check skips already-generated beats, fills in the missing ones. Safe, cheap, no ElevenLabs cost for completed beats. Guarded: refuses when `has_audio=1` (a prior attempt hit this guard on 2026-04-22 — "refuses-to-double-fire" defense-in-depth).
- **Start over** — always visible when audio rows exist. Wipes every R2 clip + D1 row + `has_audio` flag, regenerates every beat from scratch. Scary confirm dialog — readers on an already-published piece briefly have no audio until the rerun completes. Use when the existing audio is bad overall (wrong prompt, wrong voice settings, normaliser change landed that needs every beat reprocessed, etc).
- **Regenerate** (per-beat button on every audio row) — always visible. Deletes one R2 object + one `daily_piece_audio` row, keeps `has_audio=1` so the other beats keep playing for readers, regenerates just that one beat. Use for surgical fixes (one Roman-numeral beat, one mispronounced word, etc). Cloudflare CDN may serve the stale clip for a short window — hard-refresh the public page to confirm the new clip is live.

Endpoint shape (same on both workers):
```
POST /audio-retry?piece_id=<uuid>&mode=continue|fresh|beat[&beat=<kebab-name>]
POST /audio-retry?date=YYYY-MM-DD&mode=continue|fresh|beat[&beat=<kebab-name>]
```
Prefer `piece_id` — unambiguous at multi-per-day cadence. `date` fallback resolves to the latest published piece on that date.

Via curl (whole piece, continue):
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?date=2026-04-18&mode=continue" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

Via curl (single beat — needs piece_id):
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?piece_id=<uuid>&mode=beat&beat=hook" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Audio failure modes — what Observer will say
- **"Audio failure: {title}"** phase `producer` + reason "Over 20000-char cap…" — piece is longer than the budget. Shorten the piece (trim beats) or bump `CHAR_CAP` in `audio-producer.ts`.
- **"Audio failure: {title}"** phase `producer` + reason "ElevenLabs 401/403" — bad/expired `ELEVENLABS_API_KEY`. Rotate it via `wrangler secret put`.
- **"Audio failure: {title}"** phase `producer` + reason "ElevenLabs 429" — concurrency or rate limit. Wait and retry. If recurring, upgrade the ElevenLabs plan tier.
- **"Audio failure: {title}"** phase `auditor` + reason "Audio file missing in R2…" — producer wrote a row but R2 put silently failed (rare). Retry.
- **"Audio failure: {title}"** phase `auditor` + reason "Audio suspiciously small…" — truncated download. Retry.
- **"Audio failure: {title}"** phase `publisher` + reason "GitHub API error…" — token expired or repo write permissions changed. Check `GITHUB_TOKEN`.

### Cost monitoring
`daily_piece_audio.character_count` is the source of truth for ElevenLabs spend. At $0.10 / 1k chars on pay-as-you-go:
```bash
# Chars used in the last 30 days
npx wrangler d1 execute zeemish --remote --command \
  "SELECT SUM(character_count) as chars FROM daily_piece_audio WHERE date >= date('now', '-30 day');"

# Chars used today
npx wrangler d1 execute zeemish --remote --command \
  "SELECT COALESCE(SUM(character_count), 0) as chars FROM daily_piece_audio WHERE date = date('now');"
```

### Force-regenerate one beat's audio (manual fallback)
Normally covered by the admin page's per-beat **Regenerate** button (2026-04-23). If the admin UI is unreachable or you're automating, the manual path is:
```bash
# Find the piece_id first (admin page URL has it; or via D1):
npx wrangler d1 execute zeemish --remote --command \
  "SELECT id FROM daily_pieces WHERE date = '2026-04-18' ORDER BY published_at DESC LIMIT 1;"

# Retry via endpoint (cleanest — Director handles D1 + R2 deletion atomically):
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?piece_id=<uuid>&mode=beat&beat=hook" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```
If you need to manually clean state (e.g. to test the head-check path without the Director endpoint):
```bash
# Look up the r2_key — it's stored verbatim in daily_piece_audio.r2_key.
# Post-migration 0015 the PK is (piece_id, beat_name) — query by those,
# not by date.
npx wrangler d1 execute zeemish --remote --command \
  "SELECT r2_key FROM daily_piece_audio WHERE piece_id = '<uuid>' AND beat_name = 'hook';"

npx wrangler r2 object delete zeemish-audio/<r2_key-from-above>
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_piece_audio WHERE piece_id = '<uuid>' AND beat_name = 'hook';"

# Then Continue retry to regenerate the missing beat via head-check:
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/audio-retry?piece_id=<uuid>&mode=continue" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

## Revert a bad publish
The PublisherAgent commits directly to `main`. To revert:
```bash
git log --oneline | head -10           # Find the bad commit
git revert <commit-sha>                # Creates a revert commit
git push                               # Triggers auto-deploy
```

## Add a daily piece manually
Create an MDX file at `content/daily-pieces/YYYY-MM-DD-{slug}.mdx`:
```yaml
---
title: "How interest rates actually work"
date: "2026-04-17"
newsSource: "Reuters"
underlyingSubject: "monetary policy"
estimatedTime: "10 min"
beatCount: 5
description: "The ECB just cut rates. Here's what that means."
---

<lesson-shell>
<lesson-beat name="hook">
Your hook text here.
</lesson-beat>
<!-- more beats -->
</lesson-shell>
```
Then commit and push — GitHub Actions rebuilds and deploys the site
automatically. Don't `wrangler deploy` locally without committing, as
the next auto-deploy will rebuild from `main` and strip the
uncommitted file.

## Project structure
```
zeemish-v2/
├── src/                    Astro site (pages, components, layouts)
│   ├── pages/              Routes (index, daily, library, account, login, dashboard, API)
│   ├── components/         Astro components (AudioPlayer)
│   ├── layouts/            BaseLayout, LessonLayout
│   ├── interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
│   ├── lib/                Auth + DB helpers
│   ├── styles/             Global CSS
│   └── middleware.ts       Anonymous auth middleware
├── content/                MDX content
│   ├── daily-pieces/       Daily teaching pieces (YYYY-MM-DD-slug.mdx)
│   ├── voice-contract.md   Voice rules for agents
│   └── subject-values.json Subject priorities
├── agents/                 Separate Cloudflare Worker
│   ├── src/                Agent code (16 agents, one file each)
│   └── wrangler.toml       Agent worker config
├── migrations/             D1 schema migrations
├── docs/                   Living documentation
│   ├── handoff/            Original architecture docs
│   ├── ARCHITECTURE.md     What's built vs. planned
│   ├── AGENTS.md           Agent documentation
│   ├── SCHEMA.md           D1 database schema
│   ├── DECISIONS.md        Technical decision log
│   └── RUNBOOK.md          This file
├── .github/workflows/      CI/CD
├── CLAUDE.md               Context for Claude Code sessions
└── wrangler.toml           Site worker config
```
