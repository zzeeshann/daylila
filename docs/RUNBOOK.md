# Daylila v2 — Runbook

How to run, deploy, operate, and troubleshoot. Written for a developer who just cloned the repo.

> **URLs:** The site lives at `https://daylila.com` (custom domain bound to the `zeemish-v2` worker, launched 2026-04-18). The workers.dev URL `https://zeemish-v2.zzeeshann.workers.dev` is still active as a fallback but no longer the canonical entrypoint. The agents worker remains on `https://zeemish-agents.zzeeshann.workers.dev` — internal API, not user-facing.

## Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- wrangler (`npm install -g wrangler`, then `wrangler login`)

## Run locally

### Site (Astro)
```bash
cd daylila
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
2. Add property → URL prefix → `https://daylila.com`
3. Verify ownership (DNS TXT record on the Cloudflare zone, or the HTML file method — DNS is preferred since the site auto-deploys)
4. Sitemaps → Add a new sitemap → enter `sitemap.xml` → Submit
5. Wait 1–3 days for the first crawl; check Coverage report for any errors

### Bing Webmaster Tools
1. Go to https://www.bing.com/webmasters
2. Add a site → `https://daylila.com`
3. Verify ownership (same DNS TXT method works)
4. Sitemaps → Submit sitemap → `https://daylila.com/sitemap.xml`

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
# Deploys to https://daylila.com (workers.dev URL still active as fallback)
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
There are 31 migrations (`0001_init.sql` … `0031_curator_reasoning.sql`) defining 22 tables. Note: `0019_piece_id_backfill.sql` is a manual-only migration (commented UPDATEs — auto-apply is a no-op; run via `wrangler d1 execute --file` if you need to backfill a fresh DB).
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

### Backfill: historical selected-flag

`daily_candidates.selected = 1` was silently lost on every run before the 2026-04-22 Curator-prompt fix exposed candidate UUIDs to Claude. New runs work; seven pre-fix pieces (2026-04-17 through 2026-04-22, with 2026-04-22 carrying two pieces) had every candidate marked `selected = 0`. The repair script lives at [`scripts/backfill-selected-flag.sql`](../scripts/backfill-selected-flag.sql) — a normalized-headline match scoped by `(date, source)`. The audit-suggested `daily_pieces.id → daily_candidates.piece_id` join would not work because Scanner stamps piece_id on every candidate row, not just the picked one.

```bash
# Apply the backfill (idempotent — only touches rows where selected=0):
wrangler d1 execute zeemish --remote --file scripts/backfill-selected-flag.sql
```

The script ends with a verification SELECT — every published piece should report `picked_count = 1` after the UPDATE. Re-running the script is safe and updates 0 rows on the second run.

### Verify Curator reasoning fields populate

After any new cron piece (post-Foundation-Fix-Task-03), confirm `pick_reasoning` / `rejection_category` / `rejection_reason` populate correctly. From `agents/src/director.ts`'s persistence step.

```bash
wrangler d1 execute zeemish --remote --command="
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN pick_reasoning IS NOT NULL THEN 1 ELSE 0 END) AS picked_with_reason,
  SUM(CASE WHEN rejection_category IS NOT NULL THEN 1 ELSE 0 END) AS rejected_with_category,
  SUM(CASE WHEN rejection_reason IS NOT NULL THEN 1 ELSE 0 END) AS rejected_with_reason
FROM daily_candidates
WHERE date = (SELECT MAX(date) FROM daily_candidates);
"
```

Expected for one cron run: `total ≈ 80`, `picked_with_reason = 1`, `rejected_with_category ≈ 79`, `rejected_with_reason ≈ 5`.

Enum-drift follow-on (every value should be one of the eight defined in `content/curator-contract.md`):

```bash
wrangler d1 execute zeemish --remote --command="
SELECT rejection_category, COUNT(*) AS n
FROM daily_candidates
WHERE date = (SELECT MAX(date) FROM daily_candidates)
GROUP BY rejection_category
ORDER BY n DESC;
"
```

Any value not in `{off_topic, duplicate, too_local, no_teaching_angle, wrong_shape, low_signal, tribal_framing, already_covered, NULL}` is Curator drift — surface in the admin observer feed (Director already logs unknowns via `observer.logError`).

### Verify Learner feedback loop populates

After any new cron piece (post-Foundation-Fix-Task-04), confirm the loaded learnings receive their `loaded_at` + `load_count` updates and — if the piece published — also receive the `applied_to_prompts` JSON-append (and, if Polished-strict, `last_validated_at`):

```bash
wrangler d1 execute zeemish --remote --command="
SELECT id, source, category, loaded_at, load_count,
       applied_to_prompts, last_validated_at
FROM learnings
ORDER BY loaded_at DESC NULLS LAST
LIMIT 10;
"
```

Expected on the 10 most-recently-loaded rows: `loaded_at` populated (epoch ms), `load_count >= 1`, `applied_to_prompts` is a JSON array (string starting `[`) containing the new `pieceId`. `last_validated_at` populated only when the piece's `voice_score >= 90` AND its revision rounds were 1 (`LEARNER_VALIDATION_VOICE_FLOOR` / `LEARNER_VALIDATION_MAX_ROUNDS` in `agents/src/shared/audit-thresholds.ts`).

### Operator queries: Learner health

The Learner's feedback loop tracks load + validation events as of Foundation Fix Task 04. Run `scripts/learner-health.sql` after the loop has been live for ≥10 days for meaningful counts; formal review at 30 days per the FOLLOWUPS [observing] entry on Learner-loop evaluation.

```bash
wrangler d1 execute zeemish --remote --file=scripts/learner-health.sql
```

Four read-only queries surface in order:

1. **Noise** — count of learnings loaded at least once but never landed in any successful piece.
2. **Signal** — count of learnings validated by a Polished-strict piece (voice ≥ 90, 1 round).
3. **Workhorses** — top 10 by `load_count` with their JSON-array applied count.
4. **Retirement candidates** — bottom 10 oldest never-loaded.

Safe against prod (SELECT-only). Don't delete anything during the 30-day observation window — the loop needs to settle.

### Verify audio audit results populate

After any new cron piece (post-Foundation-Fix-Task-05), confirm the auditor's verdict + per-issue rows land in `audio_audit_results` and that the producer populates the two new metadata columns on `daily_piece_audio`:

```bash
wrangler d1 execute zeemish --remote --command="
SELECT id, beat_name, passed, issue_type, issue_severity, notes
FROM audio_audit_results
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
ORDER BY created_at;
"
```

Expected: at least one row (the summary, with `beat_name IS NULL` and a `notes` rollup like `"Audited 6 beats, 0 issues (0 major)"`), plus one row per audit issue if any. A clean piece reports exactly one row, `passed=1`. A piece that flagged ships the summary row + per-issue rows; the summary's `passed` is 0 if any issue was `major` and 1 if all issues were `minor`.

```bash
wrangler d1 execute zeemish --remote --command="
SELECT id, beat_name, file_size_bytes, duration_seconds
FROM daily_piece_audio
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
ORDER BY beat_name;
"
```

Expected: every row has both `file_size_bytes` and `duration_seconds` populated. NULL on either column means producer didn't fill them — check the latest agents deploy log for `persistError` in observer events. `duration_seconds` is bytes ÷ 12000 (96 kbps assumption per `AUDIO_OUTPUT_FORMAT`); a clean ~3000-char beat should land around 240,000 bytes / 20 seconds.

### Operator queries: Audio audit health

The Audio Auditor's persistence loop tracks per-issue rows and a piece-level summary as of Foundation Fix Task 05. Run `scripts/audio-audit-health.sql` after the loop has been live for ≥7 days for meaningful counts.

```bash
wrangler d1 execute zeemish --remote --file=scripts/audio-audit-health.sql
```

Four read-only queries surface in order:

1. **Recent audits** — last 30 piece audits, latest summary row only (window function over `created_at` hides retry noise — a piece audited 3 times shows as one row, the most recent verdict).
2. **Issue type breakdown** — last 30 days, count by `issue_type` ordered DESC. Drives investigation priority.
3. **Unfilled metadata** — `daily_piece_audio` rows post-2026-05-12 with NULL `file_size_bytes` or `duration_seconds`. Non-zero count means the producer broke its populate path.
4. **Size anomalies** — beats whose `file_size_bytes / (character_count × 960)` ratio falls outside the auditor's `[MIN_SIZE_RATIO=0.3, MAX_SIZE_RATIO=3.0]` band. Cross-check on the auditor itself; rows here should also have a matching audit row of `issue_type='size_too_small'` or `'size_too_large'`.

Safe against prod (SELECT-only).

### Verify draft revisions persist

After any new cron piece (post-Foundation-Fix-Task-06), confirm the audit-revise loop's persistence lands. The query from the brief, scoped to the most recent piece:

```bash
wrangler d1 execute zeemish --remote --command="
SELECT
  p.id, p.tier,
  COUNT(DISTINCT dr.revision_round) AS rounds,
  COUNT(idd.id) AS integrator_decisions
FROM daily_pieces p
LEFT JOIN draft_revisions dr ON dr.piece_id = p.id
LEFT JOIN integrator_decisions idd ON idd.piece_id = p.id
WHERE p.id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
GROUP BY p.id;
"
```

Expected:

- **Polished piece (1 round):** `rounds = 1`, `integrator_decisions = 0`.
- **Solid piece (2-3 rounds):** `rounds = 2` or `3`, `integrator_decisions ≥ 1`.

If `rounds = 0`, the Drafter's persistence didn't land — check observer events for `drafter` errors. If `integrator_decisions = 0` even on multi-round pieces, the Integrator's persistence didn't land — check observer events for `integrator` errors (either `parseError` or `persistError`). Both surface as one event per occurrence via `observer.logError`; spam-free.

To inspect a multi-round piece end-to-end (the prose evolution + the disposition trail):

```bash
wrangler d1 execute zeemish --remote --command="
SELECT revision_round, authored_by, word_count,
       length(mdx_content) AS mdx_chars,
       datetime(created_at / 1000, 'unixepoch') AS at_utc
FROM draft_revisions
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
ORDER BY revision_round;
"
wrangler d1 execute zeemish --remote --command="
SELECT revision_round, feedback_source, decision,
       substr(feedback_summary, 1, 80) AS summary,
       substr(reasoning, 1, 80) AS reasoning
FROM integrator_decisions
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
ORDER BY revision_round, feedback_source;
"
```

### Operator queries: Draft revisions health

The Drafter + Integrator persistence loop tracks per-round MDX and per-feedback-item dispositions as of Foundation Fix Task 06. Run `scripts/draft-revisions-health.sql` after the loop has been live for ≥7 days for meaningful counts.

```bash
wrangler d1 execute zeemish --remote --file=scripts/draft-revisions-health.sql
```

Four read-only queries surface in order:

1. **Recent revisions** — last 20 pieces' rounds + decision counts. Same shape as the verification SQL above, but ordered by recency. Drives "did the system change shape recently?" review.
2. **Decision breakdown** — last 30 days, `feedback_source × decision` rollup. Healthy mid-band: ≥80% accepted, ≤15% overruled, ≤10% partial across all three auditors. Sustained high overrule rates (≥30% from one auditor) is signal that the auditor's precision has drifted.
3. **Multi-round pieces** — every round of every multi-round piece, last 30 days. Use to spot-check the data shape end-to-end after the first multi-round piece publishes; zero-decision rounds appear honestly.
4. **Unfilled metadata** — drift detector for `integrator_decisions` rows missing `reasoning` or `resulting_change`. Sustained NULL rates ≥20% are signal that Claude is dropping fields under length pressure or that the prompt's structured-output instructions need tightening.

Safe against prod (SELECT-only).

### Operator queries: Integrator regression health

The Integrator's round-to-round regression-prevention rails landed with Foundation Fix Phase 4 Task 09 (2026-05-07). Run `scripts/integrator-regression-health.sql` after ≥10 multi-round pieces have published with the new code (~2-4 weeks at ~1 piece/day, ~50% multi-round rate) for the post-deploy regression-rate evaluation.

```bash
wrangler d1 execute zeemish --remote --file=scripts/integrator-regression-health.sql
```

Four read-only queries surface in order:

1. **Recent regressions** — pass→fail flips by `feedback_source` over the last 30 days, using the `round_pairs` CTE from the brief. Pre-Task-09 baseline: the 2026-05-06 magic-mushroom voice 95→92→95 anecdote (qualitative — `integrator_decisions` was not yet populated when Task 09 shipped). Post-Task-09 expectation: per-source regression count drops noticeably as the prompt's PRESERVE/FIX framing + round-to-round state suppress whack-a-mole flips.
2. **Multi-round pieces count** — sample-size gauge for query 1. Below 5 means the empirical signal is too thin to read query 1 confidently; wait longer.
3. **Per-piece regressions** — when query 1 returns non-zero, this query names the specific pieces that triggered it. Useful for spot-checking the actual prompt sent to Claude on a flipping round (admin pipeline-log view's request-payload field) when diagnosing why the PRESERVE framing didn't take effect.
4. **Round distribution** — pieces by revision_round in the last 30 days. Sanity check on Director's audit-revise loop separately from Integrator behaviour. If round-2 count drops to zero overnight, that's a Director bug, not an Integrator improvement.

Safe against prod (SELECT-only). The 30-day evaluation outcome is queued in FOLLOWUPS as `[observing] 2026-05-07: Integrator regression-rate evaluation`.

### Verify audio dwell records populate

The reader audio dwell signal lands per-event (not per-cron). Verification fires on listener action, not pipeline run. After the migration applies and a fresh listener has played any audio for ≥1 second:

```bash
wrangler d1 execute zeemish --remote --command="
SELECT user_id,
       beat_name,
       ROUND(dwell_seconds, 1) AS dwell,
       ROUND(ratio, 2) AS ratio,
       ended_reason,
       datetime(occurred_at / 1000, 'unixepoch') AS at_utc
FROM audio_dwell_events
WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)
ORDER BY occurred_at;
"
```

Expected: ≥1 row per session that played audio. `dwell_seconds` 0–3600. `ratio` ≤ 1.5 (or NULL if `audio.duration` was NaN at flush). `ended_reason` in the five-value set (`pause` | `ended` | `beat_change` | `heartbeat` | `pagehide`). Zero rows on the latest piece means the pipe hasn't been exercised yet (no listener), not necessarily a bug — try the same query against an older piece's id, or open the page yourself and play 60 seconds.

If the row's `dwell_seconds` is wildly inflated (e.g. 7000 seconds for a 240-second beat), the per-tick clamp in `audio-player.ts` is broken — see drift-detector query 4 in `scripts/dwell-health.sql`.

### Operator queries: Dwell health

The audio dwell signal accrues per listener-event as of Foundation Fix Task 07. Run `scripts/dwell-health.sql` after the signal has been live for ≥7 days for meaningful counts.

```bash
wrangler d1 execute zeemish --remote --file=scripts/dwell-health.sql
```

Four read-only queries surface in order:

1. **Recent dwell** — last 30 pieces, total reader-seconds + reader count + average ratio. Drives "is dwell flowing for recent pieces". Healthy mid-band: every recent piece has ≥1 reader and `total_seconds` in the dozens at minimum. Empty result = the pipe broke.
2. **Per-beat dwell distribution** — last 30 days. Surfaces which beats hold attention. Drop-off heatmap precursor; the FOLLOWUPS `[deferred] 2026-05-07` entry tracks the heatmap UI work.
3. **Ended-reason breakdown** — sanity check on the closed enum. Healthy distribution: heartbeat majority, beat_change + ended steady minority, pause + pagehide small. If `pagehide` dominates, the heartbeat path is broken. If `pause` is zero across 30 days, the pause hook isn't wired.
4. **Anti-double-counting drift detector** — flags any `(user_id, piece_id, beat_name)` whose total dwell exceeds 5× the clip duration over a 7-day window. Empty result = healthy. Any rows = investigate the user_id's session for a stuck heartbeat or replay-loop bug. Runtime cousin to the brief's 7000s/240s pathology.

Safe against prod (SELECT-only).

### Migration tracker hygiene
Migrations are tracked in the `d1_migrations` table. As of late April 2026 the tracker is in sync (27 rows, 0001–0027). Keep it that way:

- **Use `wrangler d1 migrations apply zeemish --remote`** for any new migration on a live DB — not `wrangler d1 execute --file=...` and not `wrangler d1 execute --command=...`. Only `migrations apply` writes to `d1_migrations`; the other paths run the SQL but leave the tracker blind, which is how we got into the 2026-04-20 mess.
- **Pre-flight check** before applying:
  ```bash
  wrangler d1 execute zeemish --remote --command="SELECT name FROM d1_migrations ORDER BY id"
  ```
  The result should list every `.sql` file in `migrations/` except the pending one. If rows are missing, the tracker is drifted and `migrations apply` will try to replay everything — likely hitting `duplicate column name` on an `ALTER TABLE ADD COLUMN` that's already live.
- **If drift is detected:** recovery is to manually `INSERT INTO d1_migrations (name) VALUES ('NNNN_…')` for the already-applied rows the tracker is missing, then re-run `migrations apply`. Full procedure and the specific rows inserted on 2026-04-20 are documented in [DECISIONS.md](DECISIONS.md) 2026-04-20 "Surfacing the learning loop" (operational-notes bullet on the migration-apply snag).

### Verify audit failure_reasons populate (Foundation Fix Task 08 PR 08c, post-cron)

After the next pipeline run with the new auditor prompts live (post PR 08c merge + migration 0038 apply), verify the failure_reasons + suggestions_count columns are populating:

```sql
-- Recent fail rounds with closed-enum tokens:
SELECT auditor, failure_reasons, suggestions_count, created_at
FROM audit_results
WHERE created_at > unixepoch() * 1000 - 86400000
  AND passed = 0
ORDER BY created_at DESC LIMIT 10;
-- Expect non-NULL failure_reasons (e.g. "tribe_word,long_sentence" for
-- voice; "weak_hook" for structure; "unverified_claim" for fact) and
-- non-zero suggestions_count on every row.

-- Fail rounds with empty failure_reasons (drift detector):
SELECT auditor, COUNT(*) AS empty_rows
FROM audit_results
WHERE created_at > unixepoch() * 1000 - 7 * 86400000
  AND passed = 0
  AND (failure_reasons IS NULL OR failure_reasons = '')
GROUP BY auditor;
-- Expect 0 across all three auditors after the new prompts ship.
-- Non-zero means an auditor prompt regression.
```

See `scripts/audit-failure-reasons-health.sql` for the full operator query set (recent breakdowns, top-N tokens via recursive CTE, suggestions-count distribution, unknown-token drift detector). Run it 7 days after first deploy to confirm closed-enum vocabulary is healthy.

### Verify run_id populates end-to-end (Foundation Fix Task 08, post-cron)

After the next 02:00 UTC publish + 04:00 UTC retention pair runs (live or DRY_RUN), verify run_id threading lands cleanly:

```sql
-- pipeline_log carries both run_date (date) and run_id (UUID):
SELECT run_date, run_id, COUNT(*) AS steps
FROM pipeline_log
WHERE created_at > unixepoch() * 1000 - 86400000
GROUP BY run_date, run_id
ORDER BY run_date DESC, steps DESC;
-- Expect one (run_date, run_id) pair per piece. Multi-piece-per-day
-- runs share run_date but have distinct run_id UUIDs.

-- Every pipeline writer table has the same run_id for its rows:
SELECT
  (SELECT COUNT(DISTINCT run_id) FROM daily_candidates    WHERE created_at > unixepoch() * 1000 - 86400000) AS candidates,
  (SELECT COUNT(DISTINCT run_id) FROM daily_pieces        WHERE created_at > unixepoch() * 1000 - 86400000) AS pieces,
  (SELECT COUNT(DISTINCT run_id) FROM audit_results       WHERE created_at > unixepoch() * 1000 - 86400000) AS audits,
  (SELECT COUNT(DISTINCT run_id) FROM observer_events     WHERE created_at > unixepoch() * 1000 - 86400000) AS events,
  (SELECT COUNT(DISTINCT run_id) FROM draft_revisions     WHERE created_at > unixepoch() * 1000 - 86400000) AS drafts,
  (SELECT COUNT(DISTINCT run_id) FROM audio_audit_results WHERE created_at > unixepoch() * 1000 - 86400000) AS audio_audits;
-- Expect every value to equal the run count from the previous query.

-- Forensic: pull every row produced by one specific run:
SELECT 'daily_pieces'  AS tbl, headline AS detail FROM daily_pieces  WHERE run_id = ?
UNION ALL SELECT 'pipeline_log', step          FROM pipeline_log     WHERE run_id = ?
UNION ALL SELECT 'audit_results', auditor       FROM audit_results    WHERE run_id = ?
UNION ALL SELECT 'observer_events', title       FROM observer_events  WHERE run_id = ?
UNION ALL SELECT 'draft_revisions', CAST(revision_round AS TEXT) FROM draft_revisions WHERE run_id = ?
ORDER BY tbl;
-- Substitute one runId UUID. Expect a complete narrative of what one
-- pipeline execution did, end to end.
```

If a writer table shows fewer DISTINCT run_id values than pipeline_log, that writer's threading regressed; investigate.

### Operator queries: Curator parse-fail diagnostics

Read-only queries. Each row is the full diagnostic capture from a Curator parse-fail that exhausted the retry path (initial call + repair retry both produced non-JSON). Surfaced 2026-05-13 — closes the diagnostic gap exposed by the 2026-05-13 c01ab251 incident where the failure path persisted only 200 chars of the broken response.

```sql
-- Last 10 Curator parse-fail diagnostics with attempt summaries:
SELECT created_at, piece_id,
       json_extract(context, '$.attempt1.stop_reason') AS attempt1_stop,
       json_extract(context, '$.attempt1.tokens_out') AS attempt1_tokens_out,
       json_extract(context, '$.attempt2.stop_reason') AS attempt2_stop,
       json_extract(context, '$.attempt2.tokens_out') AS attempt2_tokens_out
FROM observer_events
WHERE title = 'Curator parse-fail diagnostic'
ORDER BY created_at DESC LIMIT 10;

-- Full body of the most recent parse-fail (read this to see the actual
-- broken JSON Claude returned — `tokens_out` near the 8000 cap suggests
-- truncation; well below cap suggests Sonnet wobble on a long string):
SELECT created_at, piece_id, body
FROM observer_events
WHERE title = 'Curator parse-fail diagnostic'
ORDER BY created_at DESC LIMIT 1;

-- Stop-reason breakdown across all captured parse-fails (refusal /
-- max_tokens / end_turn distribution tells you which failure mode
-- dominates):
SELECT json_extract(context, '$.attempt1.stop_reason') AS reason, COUNT(*) AS n
FROM observer_events
WHERE title = 'Curator parse-fail diagnostic'
GROUP BY reason ORDER BY n DESC;
```

If diagnostics start accumulating at a meaningful rate (>1 per week sustained), the next investigation is whether to (a) raise `max_tokens` (if `tokens_out` regularly hits the cap), (b) tighten the response shape (if Sonnet wobble is the dominant mode and the repair retry isn't recovering), or (c) ship the Anthropic tool-calling structured-output path (the option (a) from the 2026-05-05 InteractiveGenerator FOLLOWUPS entry).

### Operator queries: Retention worker health

Read-only queries. Run after the 04:00 UTC cron has fired at least once.

```sql
-- Last 7 days of retention activity (dry-run + live mixed):
SELECT created_at, title, severity,
       json_extract(context, '$.candidateCount') AS candidates,
       json_extract(context, '$.deletedCount') AS deleted,
       json_extract(context, '$.dryRun') AS dry_run,
       json_extract(context, '$.windowDays') AS window_days
FROM observer_events
WHERE title LIKE 'Retention %'
ORDER BY created_at DESC LIMIT 50;

-- Tables that haven't been pruned recently (rule mis-configured? schema drift?):
SELECT json_extract(context, '$.table') AS tbl, MAX(created_at) AS last_seen
FROM observer_events
WHERE title LIKE 'Retention %'
GROUP BY tbl ORDER BY last_seen ASC;

-- Did the published-piece guard ever trip?
SELECT created_at, title, body
FROM observer_events
WHERE title LIKE 'Retention guard tripped:%'
ORDER BY created_at DESC LIMIT 5;
-- Any rows here are bugs — the policy SQL has drifted.
```

### Flip retention worker out of DRY_RUN mode

> **Destructive — confirm with user before running.** The retention worker ships in DRY_RUN mode (`agents/wrangler.toml` `[vars] RETENTION_DRY_RUN = "true"`). After a 7-day review window of dry-run observer events, flip to live:

```sh
cd agents
npx wrangler secret put RETENTION_DRY_RUN
# Enter: false
# (Or remove the [vars] entry and redeploy.)
```

Next 04:00 UTC fire writes `Retention pruned: <table>` (severity `info`) instead of `Retention dry-run: <table>`. Counts should match the dry-run values. If something looks wrong, immediately flip back: `wrangler secret put RETENTION_DRY_RUN` → enter `true`.

See [docs/RETENTION.md](RETENTION.md) for the full policy table, manual override, and rollback procedures.

## Trigger a daily piece

Daily pieces are the only content type. The manual trigger and the
scheduled run use the same `/daily-trigger` endpoint.

### Via curl (requires ADMIN_SECRET)
```bash
curl -X POST "https://zeemish-agents.zzeeshann.workers.dev/daily-trigger" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### Via dashboard
Visit https://daylila.com/dashboard/admin/ and use
the trigger button (requires ADMIN_EMAIL login).

### Automatic
The Director runs on an hourly cron, gated by `admin_settings.interval_hours` (see [`src/pages/dashboard/admin/settings.astro`](../src/pages/dashboard/admin/settings.astro)). The schema default is 24 (one piece a day, 02:00 UTC); production is currently set to 12 (two pieces a day, 02:00 + 14:00 UTC). Admins can flip to 1/2/3/4/6/8/12/24 hours via the settings page without a redeploy; change propagates at the next hourly alarm. It scans news, picks the story whose underlying system best teaches the protocol, drafts, audits, and publishes. At the production 12h cadence each piece is ready ~2 hours after the slot fires. Curator's default is to PICK; skip is rare and reserved for narrow conditions (single breaking event re-reported with no new angle, or pure product/spec announcements with no system to teach). When a skip does fire, the reason names the specific condition, not a category dismissal — see DECISIONS 2026-04-25 "Curator reframed around the Daylila protocol".

### Check Director status
```bash
# /status requires auth — it's an admin endpoint
curl "https://zeemish-agents.zzeeshann.workers.dev/status" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"
```

### View daily pieces
- Archive: https://daylila.com/daily/
- Single piece: https://daylila.com/daily/YYYY-MM-DD/{slug}/ (slug-inclusive URL since 2026-04-21 Phase 4)

## Interactives v3 — HTML interactive flag

The `admin_settings.interactives_html_enabled` flag (migration 0024,
default `'false'`) gates the HTML-interactive generation path that
lands in Phase 2 of the Interactives v3 work. Quizzes are NOT gated
— InteractiveGenerator's existing quiz path runs unchanged regardless
of the flag.

**Primary flip path: admin UI.** Phase 3 sub-task 3.1 adds a toggle on
the existing admin settings page at `/dashboard/admin/settings/`. Flip
it under the "HTML interactives (v3)" section; the page writes the
canonical `'true'` / `'false'` string to `admin_settings`, fires an
`admin_settings_changed` observer event with before/after values, and
reflects the new value back in the form. Effective on the next
post-publish alarm — already-published pieces are unaffected.

**Fallback path: `wrangler d1 execute`.** Use only if the admin UI is
unavailable (e.g. site worker down, session lockout). No observer
audit trail is written when bypassing the UI.

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

Read by InteractiveGenerator on each post-publish alarm via
`getAdminSetting<T>`. Falls back to `false` if the row is missing,
malformed, or any value other than `'true'` (fail-closed posture).

The full migration rollback (drop the row entirely) is a one-line
DELETE; see `migrations/0024_interactives_html_flag.sql` header for
the exact statement and rationale.

The companion migration 0025 added `interactives.quality_tier` —
v3 reader-vocabulary tier (`'polished' | 'solid' | 'rough'`). Backfill
mapped existing `quality_flag='low'` rows to `quality_tier='rough'`
on apply. The column sits inert if v3 is reversed (no code reads it
until Phase 2 ships), so no schema-side rollback needed.

## Interactives v3 — regenerate one artefact for a piece

Phase 3 sub-task 3.3 ships a destructive regeneration path for a single
artefact (quiz OR html) attached to a published piece. Distinct from
the existing `/interactive-generate-trigger` (which is idempotent and
only acts when no interactive exists yet).

**Primary path: admin UI.** Open `/dashboard/admin/interactives/`,
find the row, click `Regenerate`. Confirm dialog spells out exactly
what will be wiped (file + D1 row + audit rows + interactive_id
clear when applicable + scheduled fresh-generation alarm). Background
alarm runs the produce → audit → revise loop; reload the page in a
minute or two to see the result row. The fresh result fires its own
`logInteractiveGeneratorMetered` event, so the admin observer feed
shows two events: this regenerate (info severity, operator email
attributed) and the metered result.

**Generate vs Regenerate (per-piece admin page):** the per-piece admin
at `/dashboard/admin/piece/<date>/<slug>/` shows two action types
based on row state:
- **Generate** (visible when row is missing) — fires
  `/api/agents/interactive-retry?piece_id=X` → idempotent. Director's
  `requestInteractiveGenerate` schedules `generateInteractiveScheduled`
  on a 1s alarm and returns 202 immediately (full 15-min alarm budget
  per CF DO semantics). Inside `generate()`, both quiz and html paths
  run if both rows are missing — clicking "Generate quiz" when html
  is also missing will run BOTH (skipping nothing).
- **Regenerate** (visible when row exists) — fires
  `/api/agents/interactive-regenerate?piece_id=X&type=quiz|html` →
  destructive + type-scoped. Wipes the named artefact, then schedules
  the same fresh `generate()` alarm. Same idempotent post-wipe behaviour
  as Generate (runs whatever's missing).

Both paths converge on `generateInteractiveScheduled` with full alarm
budget. Pre-2026-04-30 PM, the manual retry ran inline via
`ctx.waitUntil(...)` with the HTTP-handler subrequest budget — long
runs (2-3 min for 3 audit rounds + commit) got cut off mid-flight.
The alarm path matches auto-cron post-publish triggering and the
destructive-regenerate path. See DECISIONS 2026-04-30 (PM) "Manual
interactive-retry routes through alarm path".

**Fallback path: curl.** Use only if the admin UI is unavailable.

```bash
# Quiz regen:
curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://zeemish-agents.zzeeshann.workers.dev/interactive-regenerate-trigger?piece_id=<UUID>&type=quiz&changed_by=ops"

# HTML regen (requires interactives_html_enabled = true; 400 otherwise):
curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://zeemish-agents.zzeeshann.workers.dev/interactive-regenerate-trigger?piece_id=<UUID>&type=html&changed_by=ops"
```

**Slug drift caveat.** Quiz-only regen MAY produce a different slug if
Claude returns a different proposal from the same source piece — this
breaks the quiz/html shared-slug invariant from Phase 2.5. HTML-only
regen never drifts because the html path's `existingQuiz` lookup pins
the slug to the still-present quiz row. If quiz regen does drift in
practice, the v2 fix is a `slugLock` parameter on `Generator.generate`.

## Interactives v3 — month-to-date cost

`/dashboard/admin/interactives/` carries a "Cost (month-to-date · MMM
YYYY)" stats row above the catalogue. Numbers come from
`observer_events` rows the `logInteractiveGeneratorMetered` writer
emits — Phase 3.4 extended both Generator and Auditor to read all
four Anthropic billing counters (`input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`) at every
Claude call site via `agents/src/shared/usage.ts` `extractUsage()`.

Pricing is hard-coded to Sonnet 4.5 published rates ($3/M input,
$15/M output, cache write at 1.25× input, cache read at 0.1× input).
If Anthropic changes rates, edit `SONNET_RATES` in
`src/pages/dashboard/admin/interactives/index.astro`.

Pre-3.4 events have no cache fields. The page auto-detects and
footnotes when any event in the window pre-dates capture; the flag
self-clears as old events age out of the calendar-month window.

Scope: InteractiveGenerator + InteractiveAuditor only. Other agents
(Drafter, Curator, Categoriser, Learner, Reflector, Voice/Structure/
Fact auditors) need their own `extractUsage` call before they show
up in cost telemetry. The helper is shared and ready.

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
- Live URL: `/daily/YYYY-MM-DD/{slug}/` should return 200 after the post-publish deploy completes (~30s)

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
   DELETE FROM pipeline_log WHERE run_date = '$DATE'; \
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

## One-shot taxonomy cleanup (categoriser-cleanup-plan + categoriser-cleanup-apply)

Two-stage cleanup of the existing category taxonomy when fragmentation surfaces. **Stage A** asks Claude to design a target taxonomy + per-piece reassignments based on the live data + the v1.1 categoriser contract. Output is a JSON plan the operator reviews. **Stage B** reads the (possibly-edited) plan and emits a forward-only migration. The operator applies the migration after a final SQL review.

```bash
# Stage A — design (no D1 writes; reads prod D1 via wrangler)
ANTHROPIC_API_KEY=sk-ant-... node scripts/categoriser-cleanup-plan.mjs

# Open the JSON plan and review
$EDITOR scripts/categoriser-cleanup-plan.json

# Stage B — generate migration SQL (does NOT execute it)
node scripts/categoriser-cleanup-apply.mjs

# Read the generated migration end-to-end
$EDITOR migrations/0039_categoriser_cleanup.sql

# Apply against prod D1
wrangler d1 migrations apply zeemish --remote

# Verify
wrangler d1 execute zeemish --remote --command \
  "SELECT slug, name, piece_count FROM categories ORDER BY piece_count DESC"
```

The scripts are designed for a one-shot cleanup, not recurring use — the live agent is now reading a contract that prevents the same fragmentation pattern (see DECISIONS 2026-05-07 "Categoriser fragmentation fix"). Re-run only when material drift surfaces and the watch-band entries in FOLLOWUPS escalate. Stage A is safe to re-run any number of times (read-only); Stage B regenerates the migration file each invocation, so re-running before applying simply overwrites with the latest plan.

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
- `severity: 'warn'`, title `Error: fact-check` — Anthropic's web_search
  tool returned `unavailable` (org-level toggle off, or transient API
  failure). Fact-checking fell back to training-data inference, which
  is unreliable for the news-anchored claims that dominate daily
  pieces. Pipeline continued, but unverified claims may have slipped
  past. First check: org admin toggle at console.anthropic.com/settings/privacy.
  If enabled, retry or spot-check the piece. Replaced the 2026-04-19
  DDG Instant Answer leg on 2026-04-30 — see DECISIONS.
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

No public JSON API — `/daily/` and `/library/` query D1 directly via Astro frontmatter on each SSR render. The prior `recent.ts` / `stats.ts` / `memory.ts` / `analytics.ts` / `today.ts` endpoints were created early but superseded by direct queries; removed in the 2026-04-22 dead-endpoint audit. Public `/dashboard/` was removed 2026-05-02 and now 301-redirects to `/daily/`.

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
daylila/
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
