# Daylila v2 — Follow-ups Log

Append-only. One entry per known issue worth fixing later. Close via DECISIONS entry (note the FOLLOWUPS line that's now resolved). Never delete entries.

**Status markers** (start of each entry title): `[open]` — ready to pick up · `[observing]` — paused pending data, with an unblock note · `[resolved]` — shipped, commit SHA in a **Resolved:** line at the end of the entry · `[wontfix]` — deliberately scoped out, with a **Won't fix:** line explaining the call.

Format per entry:
- **Title** — one-line summary
- **Surfaced:** date + how it came up
- **Hypothesis:** what we think is wrong (may be incomplete)
- **Investigation hints:** where to start
- **Priority:** blocker / medium / low

---

## [observing] 2026-05-10: Zita tribe-word drift watch after VOICE_CONTRACT injection (PR #37)

- **Surfaced:** 2026-05-10 alongside the LLM-surface-cleanup priority-6 commit lifting Zita's system prompt out of `src/pages/api/zita/chat.ts` into `src/lib/zita-prompt.ts` and injecting `${VOICE_CONTRACT}` via Vite's `?raw` query suffix. Pre-2026-05-10 the prompt restated voice rules abstractly (rule 5: "Plain English. Same voice rules as Daylila: no jargon, no tribe words, no flattery."); the named tribe-words list (mindfulness, journey, empower, transform, wellness, unlock, dive in, embrace, lean into, unpack, holistic, optimize, hack, curate, intentional) was nowhere in Zita's system prompt. Post-deploy, the list is in the prompt verbatim.
- **What to watch:** the qualitative signal is whether Zita echoes a tribe word back when a reader's message contains one. The audit's named regression mode was "a reader asks 'give me a journey of insights'" → pre-fix Zita might echo "journey"; post-fix Zita should not. There is no D1 meter for this — it's a manual probe.
- **Probe plan:** operator opens a Zita chat in production and types each of these prompts in turn; the response should NOT echo the bold tribe word.
  - "Give me a **journey** of insights about this piece."
  - "Help me **transform** my thinking on this."
  - "How do I **unlock** the deeper meaning?"
  - "What does this piece **empower** me to do?"
  - "How does this connect to **mindfulness** practice?"
- **Pass shape:** Zita responds to the underlying question without echoing the bold word back. (Zita is allowed to discuss the concept in non-tribe-word terms — e.g. "Walking through the piece's argument step by step…" instead of echoing "journey".)
- **Fail shape:** Zita echoes the tribe word back in its reply. This would mean either: (a) the contract injection isn't reaching the chat call site (build-time Vite resolution failed silently — unlikely given the bundle grep verified content embedded, but possible if cache); (b) Claude is reading the contract but treating it as descriptive rather than prescriptive at the chat layer. (b) would need a thicker scaffold — e.g. moving the contract higher in the system prompt, or adding an explicit "you must not use any word from the tribe-words list" instruction above the injection.
- **Unblock criterion:** five clean probes across five different prompts = pass; flip to `[resolved]` with the probe transcript SHA-referenced. One failed probe = flip to `[open]` with the failure mode named.
- **Priority:** low. Zita is admin-facing-ish (most readers don't engage with it heavily); a tribe-word echo is a soft quality regression, not a correctness or cost issue.

## [partially-resolved] 2026-05-10: Two pre-existing TS errors deferred from the LLM-surface meter commit

- **Surfaced:** 2026-05-10, while running `npx tsc --noEmit` from `agents/` to verify the priority-2 token-capture commit. Two errors are pre-existing and unrelated to that commit; operator's call was "separate fix, separate day" so they don't bloat the meter PR.
- **The two errors:**
  1. **`src/server.ts` Durable Object stub typing — 26 errors.** `DurableObjectNamespace<undefined>` doesn't carry the agent class methods (`triggerDailyPiece`, `retryAudio`, `analyseZitaPatternsScheduled`, etc.). The same shape this file's earlier 2026-04-19 entry covered for an older count of 25. Code works at runtime; tsc just can't resolve the methods. Cloudflare Agents SDK typing gap. Fix is either (a) cast at every `.get(stub)` call site to the right agent type, or (b) wait for an SDK release that exports a typed `DurableObjectNamespace<T>` shape. (b) is preferable — (a) bloats the file with casts that go stale on every method addition. The earlier 2026-04-19 entry is still open at line 1188 of this file; this is the same issue at a higher count after subsequent agent methods landed. **STILL OPEN.**
  2. **`src/audio-auditor.ts:200` arity mismatch.** **RESOLVED 2026-05-11.** Investigation surfaced this was not just a tsc warning but an actual prod data leak — every audio audit since Task 05 shipped (2026-05-12) wrote `Pipeline error: audio_audit_results persist failed: Cannot read properties of undefined (reading 'issues')` because the missing `runId` arg meant `result` was `undefined` and `result.issues.filter(...)` at line 250 threw. The `audio_audit_results` table received ZERO persist data from the main branch since Task 05; only the no-rows-branch summary rows (line 111, correct 3-arg call) ever landed. Original hypothesis about "garbage run_ids" was wrong — the call threw before the INSERT ever ran. Fixed in one-character change: `(brief.pieceId, brief.runId ?? null, result)`. See DECISIONS 2026-05-11 "Three forward fixes" Finding 2.
- **Priority:** low. (1) is an existing SDK gap operator has lived with for weeks.

## [observing] 2026-05-09 (late evening): Widget appearance rate after Drafter prompt rebalance

- **Surfaced:** 2026-05-09 late-evening, alongside DECISIONS entry "PR #27 widget rebalance — Drafter scans for earning moments before deciding zero." Today's Mars/Psyche piece shipped clean end-to-end but with zero widgets across 7 beats despite multiple beat-shapes that PR #27 was designed for (Beat 3 two-frame contrast, Beat 1 think-for-two-seconds question, Beat 5 mission catalogue). The Drafter prompt's "earned, not budgeted" framing was over-anchoring "default zero" because the deletion heuristic ran without a symmetric insertion-prompt and the audit feedback loop only flagged over-use (`widget_without_purpose`), never under-use. Surgical fix at [agents/src/drafter-prompt.ts:28-118](agents/src/drafter-prompt.ts:28): reordered so a scan-for-earning-moments instruction (three concrete shape-questions, one per widget tag) and a topic-shape permission (physics / mechanisms / contrasts → typical one widget; opinion / news-summary → zero normal) come BEFORE the deletion heuristic. Negative examples + "earned, not budgeted" paragraph unchanged.
- **Hypothesis:** None — observation. The fix is a prompt rebalance based on N=1; verification is whether the rate of widget appearance lifts off zero on widget-eligible topics over the next 14 days. Risk modes: (a) Drafter still ships zero widgets on physics / mechanism pieces (rebalance was insufficient — strengthen the scan, e.g., make it a numbered checklist or add a fourth widget-shape positive example matching the Mars Beat 3 pattern); (b) Drafter overshoots into 2-3 widgets per piece on every topic (rebalance was too strong — reinforce the deletion heuristic or add a "no more than two widgets per piece" cap to the prompt); (c) Drafter writes widgets that are decoration (Structure Editor's `widget_without_purpose` token catches this — watch for an uptick in `widget_without_purpose` audit failures).
- **Investigation hints:**
  - Daily check during the watch: open each fresh published piece's MDX in `content/daily-pieces/`, count widget tags by type. Note the topic shape (physics / mechanism / opinion / news-summary / etc.). Mark each piece as "widget-eligible (had earning moment)" or "widget-ineligible (zero is correct)" based on a re-read.
  - Query: `SELECT id, slug, voice_score FROM daily_pieces WHERE published_at > strftime('%s','now','-14 days')*1000 ORDER BY published_at DESC` then for each piece, `grep -c 'lesson-reveal\|lesson-compare\|lesson-callout' content/daily-pieces/<file>.mdx`.
  - Audit-side signal: `SELECT failure_reasons FROM audit_results WHERE created_at > strftime('%s','now','-14 days')*1000 AND failure_reasons LIKE '%widget_without_purpose%'`. A spike here means risk mode (c) is firing.
  - Engagement-side signal: once Phase 2 of widgets ships ([deferred] 2026-05-09 entry above), open-rate per widget tells which earning shapes are real vs decoration. Until then, presence/absence is the only signal.
- **Unblock:** Either:
  - 14 calendar days × ≥10 widget-eligible pieces with ≥60% carrying at least one widget → rebalance is working, flip to [resolved] with the post-deploy SHA.
  - Sustained zero widgets on widget-eligible topics across 5+ pieces → rebalance was insufficient, flip to [open] and tighten the scan further (operator-pick: numbered checklist vs additional positive example vs Structure-Editor `widget_under_used` token).
  - 2+ pieces with ≥3 widgets each, OR a sustained `widget_without_purpose` audit-failure rate >20% → rebalance overshot, flip to [open] and dial back (reinforce deletion heuristic; consider a cap).
- **Priority:** Medium — widgets exist to make specific teaching shapes land harder. Without them firing on widget-eligible pieces, PR #27's infrastructure has been ~free-shipped to prod with no reader-visible benefit. Watch is ~14 days; calendar trigger 2026-05-23.

---

## [observing] 2026-05-09: Streaming-conversion regression watch — Curator + Drafter + Integrator + InteractiveGenerator HTML

- **Surfaced:** 2026-05-09 evening, alongside the Curator 124s 499 timeout fix (DECISIONS entry of same date). Six call sites moved from `client.messages.create({...})` to `await client.messages.stream({...}).finalMessage()`. The SDK contract guarantees a `Message` return type from `.finalMessage()` matching `messages.create`, but a regression could surface as: parse failures (the stream returns truncated content), `.usage` field missing or zeroed (cost-tracking goes blind), prefill-discontinuation (HTML methods rely on `{ role: 'assistant', content: '{' }` prefill — the stream must preserve continuation-only content), or Anthropic-side error-shape change between create and stream paths.
- **Hypothesis:** None — observation. Watching for any of the four regression modes above on the next 14 days of cron firings. The watch ends 2026-05-23.
- **Investigation hints:**
  - Look for any `parse_error` or `client_error` observer events in the curator/drafter/integrator/interactive-generator domains.
  - Token usage on `observer_events.body` ("Tokens: in=X out=Y") should remain populated — if `.usage` returns null on streaming, those numbers go to 0 or vanish entirely.
  - Cost dashboard (Anthropic console) — daily token cost should drop slightly (no more 3× retry billing on Curator failures, plus summary-truncation savings). If costs SPIKE instead, something's wrong.
  - InteractiveGenerator HTML prefill — the JSON envelope's first `{` is added back at parse time via `'{' + continuation`. If streaming returns the full message including the prefilled `{`, double-`{` corrupts the parser. Spot-check one HTML output post-deploy.
- **Unblock:** Either:
  - 14 calendar days of clean streaming operation across cron firings (≥10 pipeline runs without regression) → flip to [resolved] with the post-deploy SHA.
  - Any single regression instance → flip to [open] with the failure mode named, prep for partial revert.
- **Priority:** Medium — defense in depth, not active rescue. Watching for tail risks.

---

## [deferred] 2026-05-09: Widget engagement signals to LearnerAgent (PR #3 Phase 2)

- **Surfaced:** 2026-05-09 PR #3. Phase 1 landed three in-beat MDX widgets (`<lesson-reveal>` / `<lesson-compare>` / `<lesson-callout>`) plus the engagement-track event types (`widget_reveal_opened` / `widget_compare_viewed` / `widget_callout_seen`) plus migration 0043 adding three counter columns on `engagement`. Lesson-shell forwards widget events; the endpoint UPSERTs the counters. Today's LearnerAgent reads four signal sources (producer post-publish, Drafter self-reflection, reader engagement, producer-vs-reader implicit gap). Widget events become a fifth source: which widgets readers actually open vs which sit unused — a `<lesson-reveal>` that nobody opens after 30 days is decoration in disguise; a `<lesson-callout>` that everyone scrolls past silently is fine (it's an aside, not a click target).
- **Hypothesis:** None — observation. Phase 2 work: extend LearnerAgent's post-publish prompt to include a "widget engagement rates" block reading from `engagement.widget_reveal_opens / widget_compare_views / widget_callouts_seen` joined with widget-presence in MDX. Output learnings like "widget X had Y% open rate against Z views" per piece, fed back into the Drafter's getRecentLearnings(10) loop so future Drafters know which widget shapes earn their place vs which decorate.
- **Investigation hints:** start by reading [agents/src/learner.ts](agents/src/learner.ts) `analysePiecePostPublish` — same shape as the other engagement reads. Need a per-piece widget count from MDX (parse `<lesson-reveal>` / `<lesson-compare>` / `<lesson-callout>` count via the same parser the audio producer uses; see `expandWidgetsForTTS` in `agents/src/audio-producer.ts`). The interesting metric is OPEN-RATE not COUNT (1 reveal opened by 5 of 10 viewers = 50%; 5 reveals each opened by 1 of 10 viewers = 10% — different signals).
- **Unblock:** ≥30 days × ≥30 pieces with widgets in the wild. Calendar trigger: 2026-06-09 + however long it takes for 30 pieces to ship widgets (Drafter using widgets sparingly per "earned not budgeted" — could be slower than 1/day).
- **Priority:** Medium — widgets are useless without a feedback loop telling future Drafters which kinds earned their place. Without this, the "earned not budgeted" rule is enforced only by Structure-Editor's static heuristic; the read-side loop is what makes the rule self-tuning over time.

---

## [observing] 2026-05-09: Entertainment / Sports feed rejection-rate watch (PR #1)

- **Surfaced:** 2026-05-09 PR #1. Replaced 11 narrow-academic breadth feeds with 4 broader Google News feeds (ENTERTAINMENT, SPORTS, food-cooking-search, personal-finance-search). The Entertainment topic feed is heavily gossip-shaped at top of stream; Sports is heavily score-recap shaped. Curator filters via `low_signal` / `tribal_framing` / `no_teaching_angle` rejection categories. Pre-deploy verification (live RSS fetch on 2026-05-09) showed each feed returning a mix where the teachable ~30% is exactly the Inner-life / Skills / Expression / How-humans-live content the library was missing.
- **Hypothesis:** None — observation. The feeds will produce candidates whose teachable density differs from Google News topic feeds (TOP / SCIENCE / HEALTH / etc.). If Curator's rejection rate on Entertainment or Sports candidates runs >80% sustained, that's wasted candidate budget — the per-feed cap (8) is being filled mostly by candidates Curator immediately rejects.
- **Investigation hints:** weekly query against `daily_candidates` keyed by `category` field (Scanner stamps the feed key here):
  ```
  SELECT category,
         COUNT(*) AS total,
         SUM(CASE WHEN rejection_category IS NOT NULL THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN selected = 1 THEN 1 ELSE 0 END) AS picked
    FROM daily_candidates
   WHERE created_at > strftime('%s','now','-14 days')*1000
     AND category IN ('ENTERTAINMENT','SPORTS','FOOD_COOKING','PERSONAL_FINANCE')
   GROUP BY category;
  ```
  If `rejected/total > 0.8` for a feed sustained over 2 weeks, swap the feed query to a narrower one (e.g. `entertainment industry analysis` instead of the topic feed; `sports tactics analysis` instead of the SPORTS topic). The swap is a one-line change in `agents/src/scanner.ts` `RSS_FEEDS` map.
- **Unblock:** ≥14 days of post-deploy data. Calendar trigger: 2026-05-23.
- **Priority:** Medium — high rejection rate is wasted Anthropic spend on the Curator prompt (each rejection still costs the rejection_reason token writeback). Not breaking anything; just inefficient.

---

## [deferred] 2026-05-09: Drop `daily_pieces.word_count` + `beat_count` columns

- **Surfaced:** 2026-05-09 PR #0 made both columns inert. Director no longer writes them; all five site-worker readers derive from the published MDX via `src/lib/piece-stats.ts`; Learner dropped them from its post-publish prompt (voice score + audit rounds + engagement carry the learning signal — word/beat count were ambient context). Today's writes leave the columns NULL; historical values are stale brief-time numbers no longer relied upon. See DECISIONS 2026-05-09 "PR #0 — Beat-count + word-count drift fix".
- **Hypothesis:** None — staged removal. Single migration `ALTER TABLE daily_pieces DROP COLUMN word_count` and `DROP COLUMN beat_count`. SQLite supports DROP COLUMN since 3.35; D1 underlying engine supports it.
- **Investigation hints:** before the migration, grep `agents/src/`, `src/`, and `migrations/` once more for the column names — the PR #0 cleanup should have caught all readers, but a second pass catches anything added since. Look especially at any new admin tooling, reports, or data-export scripts that reference the column names. The migration is forward-only and non-reversible without restore from backup, so verify zero readers remain before applying.
- **Unblock:** ≥30 days of clean operation post-PR-#0 with no operator surface noticing missing data, plus zero bulk-query usage discovered. Calendar trigger: 2026-06-09.
- **Priority:** Low — columns are inert; cosmetic schema cleanup. Carries no functional risk if left in place indefinitely (precedent: `admin_settings.reading_mode` row preserved as audit trail since C7 cleanup 2026-05-08).

---

## [deferred] 2026-05-09: `made.ts` content-collection cache for drawer endpoint

- **Surfaced:** 2026-05-09 PR #0. The drawer's `/api/daily/[date]/made` endpoint now calls `getCollection('dailyPieces')` to derive word + beat count from the MDX body. At today's traffic (low) the iteration cost is invisible; at scale it could become a hotspot since the drawer fetch fires every time a reader expands the panel.
- **Hypothesis:** None — performance follow-up only triggered by data. Cache shape (when needed): module-level `Map<pieceId, PieceStats>` keyed by piece id, invalidated on rebuild (Astro content collections are immutable per build, so the cache is naturally bounded by deploy lifetime).
- **Investigation hints:** measure first. Wrangler analytics or Cloudflare logs for `/api/daily/*/made` — if p95 latency stays <50ms, no action. Cache only if drawer-open p95 ever exceeds ~150ms or daily-piece traffic crosses ~50 RPS.
- **Unblock:** drawer endpoint p95 >150ms sustained over 24h, or a noticeable click-to-expand lag reported by a reader, or anticipated traffic step-change (e.g. a launch).
- **Priority:** Low — premature optimisation today; documented so the option's there when needed.

---

## [observing] 2026-05-08: Drawer narrative arc — confirm forward-looking framing reads cleanly across 5+ fresh pieces

- **Surfaced:** 2026-05-08 alongside the drawer narrative-arc landing (DECISIONS entry "Drawer narrative arc clarified — Final state block + forward-looking reframe"). The Drafter reflection prompt and all three Learner prompts were rewritten to instruct forward-looking framing. The self-check at the bottom of each prompt asks the model "would a reader hear a critique of what they read, or a pattern for what comes next?" — the right behaviour is the latter, every time.
- **Hypothesis:** None — observation. The fix is the right shape, but Sonnet 4.5 occasionally drifts back into past-tense critique style on edge cases (unusual subject domains, single notable failure modes). The drawer-side intro paragraph carries the framing even if one bullet drifts, but the goal is bullets that are forward-looking on their own without leaning on the wrapper.
- **Investigation hints:** read each fresh day's `learnings` rows (`SELECT observation, source FROM learnings WHERE piece_date = '<YYYY-MM-DD>' ORDER BY created_at`). Mark each row as "forward" / "past-tense" / "ambiguous". If >1 in 5 reads as past-tense critique on a given day, tighten the prompt examples or add another self-check pass. Do NOT add code-side validation (per the 2026-05-07 Categoriser-fragmentation lesson; rules live in contracts, not in regex).
- **Unblock:** ≥5 fresh published pieces with the new prompts live (~5 days at 1 piece/day cadence). Re-read 5 drawers top-to-bottom, ask a non-technical person if any reads like a verdict on the article. If yes, surface as a follow-up tightening pass.
- **Priority:** Low — the drawer-side intro paragraph and Final-state block prevent the reader-misread-as-verdict failure mode even if individual bullets drift; this entry is about polishing the forward-looking phrasing quality.

---

## [deferred] 2026-05-08: Voice contract clause — forward-looking framing for reflective notes

- **Surfaced:** 2026-05-08 during the drawer narrative-arc work. Sub-task 6 of `docs/foundation-fix/POST-FOUNDATION-DRAWER-NARRATIVE-ARC.md` flags optionally adding a clause to `content/voice-contract.md` that codifies the forward-looking framing for reflective notes. Brief calls it "discretionary" — skipped from the main commit because not blessed for this scope, and the fix lives correctly in the agent prompts + drawer copy (canonical sources for that surface).
- **Hypothesis:** None — discretionary scope question. Adding the clause would lock the new posture so future prompt or copy rewrites can't drift away from it. Risk of skipping: the next prompt rewrite (e.g., a future Foundation-Fix pass on Drafter or Learner) might not know the forward-looking framing was deliberate and could revert it.
- **Investigation hints:** the clause would land in `content/voice-contract.md` near the existing rules ("Plain English", "No tribe words", etc.) — one sentence, voice-contract-compliant: e.g. *"Reflective and post-publish notes are framed as forward-looking patterns for future pieces, not past-tense critiques of what shipped."* Codegen rebuild required (`pnpm codegen` + `pnpm verify-contracts-fresh`) — the contract is injected into VoiceAuditor, FactChecker via `${VOICE_CONTRACT}`, so the clause would propagate automatically. Verify there's no unintended audit-side effect (e.g., VoiceAuditor scoring reflective notes against the rule when they're not body content).
- **Priority:** Low — the agent prompts already carry the forward-looking instruction; the clause is policy-codification, not a behaviour change.

---

## [deferred] 2026-05-08: Book transparency chapter — possible new chapter at programme close

- **Surfaced:** 2026-05-08 during drawer narrative-arc work. The brief named "book/12-transparency.md per docs/foundation-fix/BOOK-UPDATES.md" but no such chapter exists — `book/12-publishing.md` is outline-only and about MDX/Astro mechanics, and BOOK-UPDATES.md doesn't list a transparency chapter. The drawer narrative-arc paragraph landed in chapter 11 (quality gates) as the closest existing transparency anchor.
- **Hypothesis:** None — book scope decision. Either (a) the brief's mention was speculative and chapter 11 is sufficient, or (b) transparency genuinely deserves its own chapter at programme close. Per BOOK-UPDATES.md's "after the programme" guidance ("Two new chapters at close: When the System Outgrew Its Map, What Comes Next"), a third candidate could be a transparency chapter — the made-drawer + admin transparency surfaces have grown enough across Foundation Fix to warrant standalone treatment.
- **Investigation hints:** read `docs/foundation-fix/BOOK-UPDATES.md` "After the programme" section + the existing [open] 2026-04-26 entry below ("Book is missing three post-launch chapters"). If a transparency chapter is added, BOOK-UPDATES.md should be updated first to register the chapter and what it covers (the made-drawer narrative arc, the admin per-piece deep-dive, the dashboard removal, the foundation-fix data-leak closures that feed the drawer, the contract-as-truth principle that landed in SESSION_OPENER).
- **Priority:** Low — chapter 11's appended paragraph carries the new arc; this is a structural-completeness question for the book at programme close, not a near-term gap.

---

## [resolved] 2026-05-07: `design/favicon-source-1024.png` shows old Zeemish "Z" — needs replacement with 1024×1024 Day Lila master

- **Surfaced:** 2026-05-07 brand-icon swap. The redesigned PNG set (apple-touch-icon, icon-192, icon-512) plus the new favicon.svg landed cleanly, but the delivery zip didn't include a 1024×1024 source master. The old Zeemish Z-mark file at `design/favicon-source-1024.png` is now stale — it shows the previous brand. Not deleted (per `feedback_non_destructive.md`; git preserves history but the live file is misleading to anyone opening it expecting the current brand).
- **Hypothesis:** None — operational gap. The PNG set in `public/` is fine; this is purely about the design source master used for future regen. When the operator (or designer) generates a 1024×1024 PNG of the new D-mark, replace `design/favicon-source-1024.png` with it. Same teal `#1A6B62` background + cream `#FAF8F4` D-shape + gold `#C49A1A` dot already in the deployed assets.
- **Investigation hints:** look at `public/icon-512.png` for the current pixel-true reference; the 1024 master should be a 2× upscale of that design (NOT a 2× upscale of the 512 PNG itself — that loses sharpness). If the operator has a Figma/Sketch source, export 1024×1024 from there. If not, hand-design or ask Claude to upscale the 512 PNG with care for the rounded-corner artefacts.
- **Priority:** low. Doesn't affect anything the reader sees. Only matters when the brand changes again or when someone wants a 1024-px hero icon for press/social.
- **Resolved:** 2026-05-07 — operator delivered the 1024×1024 Day Lila D-mark PNG (matches the deployed `public/icon-512.png` design at 2× resolution). Replaced both `design/favicon-source-1024.png` and the archived copy in `design/brand-handoff/favicon-source-1024.png`. See DECISIONS entry "Brand-icon source master 1024px landed" same date.

---

## [open] 2026-05-14: Drop `pipeline_log_backup_20260507` after retention worker has run for ≥7 days in DRY_RUN mode

- **Surfaced:** 2026-05-07 alongside migration 0037 (Foundation Fix Task 08 PR 08a/b). The pipeline_log rebuild created a snapshot table `pipeline_log_backup_20260507` as rollback insurance for the column-rename + new run_id UUID column. Same pattern as the 0014/0015 backup tables, all of which were dropped at the 7-day mark per FOLLOWUPS housekeeping discipline.
- **Hypothesis:** None — housekeeping. Drop on or after 2026-05-14 once: (a) the new `run_date` column is feeding all 4 site-side queries cleanly, (b) the new `run_id` UUID column has populated on at least 7 days of new pipeline runs, and (c) the retention worker's first DRY_RUN observer events have been reviewed without surprises.
- **Investigation hints:** before dropping, verify `SELECT COUNT(*) FROM pipeline_log_backup_20260507` matches the expected pre-rebuild row count, and `SELECT run_date, COUNT(*) FROM pipeline_log GROUP BY run_date ORDER BY run_date DESC LIMIT 14` shows clean day-grouping.
- **Priority:** Low.

---

## [open] 2026-05-14: Flip retention worker out of DRY_RUN mode

- **Surfaced:** 2026-05-07 alongside the retention worker landing in PR 08a/b. The worker ships in DRY_RUN mode (`agents/wrangler.toml` `[vars] RETENTION_DRY_RUN = "true"`) for the first 7 days post-deploy as a safety rail — first run fires 04:00 UTC the day after deploy.
- **Hypothesis:** None — operational rollout. After 7 days of DRY_RUN observer events have been reviewed and the candidate counts look correct (no published-piece counts in the candidates, no surprises in row counts vs schema understanding), flip to live via `wrangler secret put RETENTION_DRY_RUN false` (or remove the `[vars]` line and redeploy). Memory `feedback_non_destructive.md` applies — confirm with the user before flipping; auto-mode does not cover this transition.
- **Investigation hints:** see `docs/RETENTION.md` "Flipping to live mode" + the operator queries section. The 7-day review window is a soft target; longer is fine if anything looks off.
- **Priority:** Medium. Until flipped, the worker logs but doesn't prune — `observer_events` will continue to grow unboundedly.

---

## [followup] 2026-05-07: Update book chapter(s) to reflect Categoriser fragmentation work + contract-as-truth principle

**Surfaced:** 2026-05-07, same session as the Categoriser taxonomy cleanup that landed in commit `4d9a650`. Three new pieces of canonical context now exist that aren't in the book:

1. **Categoriser fragmentation diagnosis (process-vs-domain).** The 26-categories-for-49-pieces audit surfaced that the existing taxonomy was organised at the wrong axis — process-level intellectual moves (`Knowledge Formation` describes how a piece thinks, not what it's about) instead of domain-level subjects (`Brain`, `Trade`, `Justice`). Cross-tag evidence sealed it: pieces routinely sat in two of the four broad categories simultaneously, confirming overlap not distinct domains. Both names AND descriptions encoded the wrong axis. The diagnosis matters as a *naming-and-bucketing-as-doctrine* story — the kind of thing chapter 08's first-person voice handles well ("the taxonomy was lying to itself; we caught it lying").

2. **Contract-as-truth architectural principle (now codified in `docs/SESSION_OPENER.md`).** Mid-plan during the Categoriser fix, the operator caught a regression I was about to commit: code-side regex validation of names + descriptions, retry-message branches firing on code-detected violations, a verifier script for qualitative compliance. The correction was sharp: rules live in contracts; agent reads them; code persists D1 rows and shapes JSON envelopes — never validates contract rules. If enforcement beyond the agent reading the contract is needed, the answer is another agent (VoiceAuditor / FactChecker / InteractiveAuditor shape), not regex. This is the load-bearing architectural principle the Foundation Fix Phase 1 contract extractions were defending — and it's now written down as the first session-opener rule. The book should carry this principle as an explicit chapter or section, not just leave it implicit in the chapter-09 agent walkthrough.

3. **26 → 11 taxonomy cleanup, end-to-end.** The two-stage operator-review pattern (Stage A: design via one Claude call against prod D1; Stage B: generate forward-only migration from operator-edited JSON) — including the Stage A regression Checkpoint 1 caught (Claude proposed deleting the locked operator-review fallback row despite explicit instruction; would have broken the agent on next cron) — is a self-contained ship-the-fix story worth telling. The follow-up `0040_cleanup_zombie_orphans.sql` migration that swept piece_categories rows for the 2026-05-01 02:03 UTC `audio-publishing` zombie is also a worthwhile vignette (a fragmentation cleanup happening to expose unrelated zombie data, dealt with cleanly via a forward-only sweep).

**Voice:** match existing chapters — chapter 08 (`book/08-zeemish-the-idea.md`) is the anchor for first-person where Zishan speaks; third-person about the system; plain English; short sentences. Same posture as the existing [open] 2026-04-26 entry below ("Book is missing three post-launch chapters") which already queues a Categoriser chapter section — fold this 2026-05-07 work into the same scope rather than duplicating: the Categoriser story now has more substance (fragmentation diagnosis + cleanup + contract-as-truth lesson) than the 2026-04-26 entry's original "story of why a 14th agent exists" outline.

**Sequencing:** **Open separate session.** Operator instruction. Documentation work, not code work — no migration risk, no agent runtime impact. The five [observing] watch entries from the Categoriser fix carry their own observation windows; this book work doesn't gate on them.

**Investigation hints:** Read in this order — `docs/DECISIONS.md` 2026-05-07 entries (both "Layer 3 applied" and "Layer 1+2"); the `[resolved] 2026-05-07: Categoriser taxonomy fragmentation` entry below; `docs/SESSION_OPENER.md` (the Architectural principle section); CLAUDE.md latest-session entry. Existing [open] 2026-04-26 book-chapters entry below is the parent scope.

---

## [resolved] 2026-05-07: Categoriser taxonomy fragmentation — `Knowledge Formation` becoming a dumping ground; new categories spawned with `piece_count=1`

**Resolved 2026-05-07** by migration `0039_categoriser_cleanup.sql` (commit landing this entry) + follow-up `0040_cleanup_zombie_orphans.sql` (cleared orphan piece_categories rows from a known zombie pipeline run that initially blocked two old-category deletions). Final state verified against prod D1 + curl-rendered `/library/` HTML: **10 reader-visible single-word categories** (`Science` 11, `Governance` 9, `Trade` 7, `Medicine` 6, `Biology` 5, `Brain` 5, `Justice` 4, `Infrastructure` 3, `Business` 2, `Ecology` 2) + locked `patterns-yet-to-cluster` fallback (0 pieces, hidden). Down from 26 reader-visible categories pre-cleanup. No `&`, no `and`, no 3+ word names. All ten new categories `locked=1`. Sum of piece_counts = 54 (49 pieces × 1-3 categories), distribution flat (no dumping ground; no singletons).

**The fix had three layers:**

1. **Layer 1+2 (commit `c9938ab`)** — agents-side. Contract `content/categoriser-contract.md` v1.0 → v1.1: `Category names` section locks single-word naming with concrete pairs from prod (`Brain` not `Neural Architecture & Specialization`, `Trade` not `Resource Constraints & Trade-offs`, etc.); `Category descriptions` section locks domain-level descriptions (names the territory, not the intellectual move) with three concrete anti-patterns (`How knowledge accumulates...` etc.); `Walk through every existing category` sub-section adds the explicit two-signal reuse test (description + recent piece headlines). Prompt JSON example tweaks at `categoriser-prompt.ts:48-52`. Recent-headlines + filling-fast density signal threaded into `buildCategoriserPrompt` via two new D1 queries in `categoriser.ts`. **Architectural posture (codified in `docs/SESSION_OPENER.md`):** rules live in the contract; agent reads it; code only persists D1 rows and shapes JSON envelopes — no regex validation, no retry-message branches firing on code-detected violations, no verifier scripts testing qualitative compliance.

2. **Layer 3a (commit `785490b` + `6d11e09`)** — cleanup scripts. `scripts/categoriser-cleanup-plan.mjs` (Stage A: read prod D1, inject v1.1 contract into prompt, single Claude call, write JSON plan; zero D1 writes); `scripts/categoriser-cleanup-apply.mjs` (Stage B: read operator-edited JSON, emit forward-only migration). Stage B was hardened with a fallback-slug guard (commit `6d11e09`) after the first Stage A run had Claude include `patterns-yet-to-cluster` in disposition with action=merge_into target=null — the guard now hard-codes the slug as a constant and excludes it unconditionally from oldSlugsToCheck. This is persistence/safety, not contract-rule enforcement.

3. **Layer 3b (this commit)** — applied. Migration `0039_categoriser_cleanup.sql` (10 INSERT new categories with `locked=1`; DELETE all piece_categories for 49 reassigned pieces; INSERT 54 fresh assignments at confidence=100; DELETE 26 old categories with no remaining piece_categories rows; recompute piece_count). 68 D1 commands executed in 7.64ms. Two old categories survived deletion because of orphan piece_categories rows from the 2026-05-01 02:03 UTC `audio-publishing` zombie pipeline run (piece_id `afdfb4e4-aa19-4cbc-9192-7ac66bc94d78`, no matching `daily_pieces` row); follow-up migration `0040_cleanup_zombie_orphans.sql` deleted ALL orphan piece_categories rows (`piece_id NOT IN (SELECT id FROM daily_pieces)` — sweeps the afdfb4e4 zombie plus any others from the open six-zombies entry below) and re-ran the old-category deletion.

**Watch entries that remain open** (post-deploy observation gates from Layer 1+2):

- `[observing]` — naming rule compliance over next 14 cron firings (operator spot-checks any new categories; expectation: zero `&` / `and` / 3+-word names).
- `[observing]` — description rule compliance over next 14 cron firings (operator spot-checks descriptions of newly-created categories; expectation: domain-level shape, no `How ...` openers).
- `[observing]` — reuse-bias effectiveness over next 14 cron firings (≤1 novel category created across the window).
- `[observing]` — description-vs-headlines drift over next 30 days.
- `[deferred]` — **CategoriserAuditor agent** as the unblock-when path if observed compliance drift becomes material (≥2 contract-violating names or descriptions in any 14-firing window). Same shape as VoiceAuditor / FactChecker / InteractiveAuditor.

The [open] zombie-pipeline-runs entry below is partially relevant — migration 0040 cleared the piece_categories side of the afdfb4e4 zombie. The `pipeline_log` row remains stuck at `audio-publishing running` and the watchdog work to retroactively close those rows is still pending. That entry stays open. **Why both name AND description rules**: prod D1 sampling confirmed names AND descriptions both encoded a process-level axis (`Knowledge Formation` description: "How knowledge accumulates through systematic observation" — beautifully written, useless as a filter; admits any science). Domain-level rewrite (`Brain` → "Brain anatomy, neuroscience, cognition...") forces the territory framing that lets pieces be excluded on their merits. **Why headlines AND descriptions**: descriptions alone ossify (frozen at creation); headlines alone don't anchor. Together = description bounds territory, headlines reveal drift, mismatch is a signal. **Watch entries** (post-deploy):

- `[observing]` — naming rule compliance over next 14 cron firings (operator spot-checks any new categories; expectation: zero `&` / `and` / 3+-word names since the agent reads a contract that explicitly forbids them with concrete examples).
- `[observing]` — description rule compliance over next 14 cron firings (operator spot-checks descriptions of newly-created categories; expectation: domain-level shape, no `How ...` openers).
- `[observing]` — reuse-bias effectiveness over next 14 cron firings (≤1 novel category created across the window).
- `[observing]` — description-vs-headlines drift over next 30 days (do new pieces landing in a category match its description's stated domain?).
- `[deferred]` — **CategoriserAuditor agent** as the unblock-when path if observed non-compliance becomes material. Same shape as VoiceAuditor / FactChecker / InteractiveAuditor. Trigger condition: ≥2 contract-violating names or descriptions across any 14-firing window. Until that trigger fires, contract-only enforcement is the right level of investment.

---

- **Surfaced:** 2026-05-07 audit of two consecutive brain-themed pieces, both Categorised within 24h of each other:
  - 2026-05-06 "Single dose of magic mushroom psychedelic can cause anatomical brain changes" → stretched into existing `knowledge-formation` at confidence 78 (just above the 75 floor); the piece is about psilocybin's anatomical mechanism, not epistemics.
  - 2026-05-07 "Specific expansion of motor cortical projections in a singing mouse" → triggered creation of a brand-new `neural-architecture-specialization` category with `piece_count=1`.
  Same Categoriser made opposite decisions on near-identical subject matter in 24h. CLAUDE.md says Categoriser is "strongly biased toward reusing the existing taxonomy" — observable behaviour suggests it isn't.
- **Hypothesis:** taxonomy is fragmenting because (a) the existing 27-category taxonomy genuinely lacks a brain/biology bucket, so Categoriser correctly creates `Neural Architecture & Specialization` for the singing mouse piece — but the system has no way to retroactively re-categorise the magic mushroom piece into the new bucket; AND (b) `Knowledge Formation` is being abused as a dumping ground (11 pieces with `Knowledge Formation` ranging from epistemics to cancer biology to Mars trajectories — confidence floor of 75 is too easy to clear with a stretch); AND (c) the Categoriser prompt may not be presenting recent pieces under each category to surface "is there really no fit?" before the create-new path. Recent new-category creation cadence is 8 in 8 days, most with `piece_count=1` — taxonomy entropy is rising not consolidating.
- **Investigation hints:** start with `content/categoriser-contract.md` to read the actual rule body (Phase 1 contract extraction landed 2026-05-10 — `CATEGORISER_CONTRACT` is canonical). Then read `agents/src/categoriser.ts` + `agents/src/categoriser-prompt.ts` to see how the existing taxonomy is presented in the prompt and what threshold logic gates create-vs-reuse. Operator query for the dumping-ground signal: `SELECT c.slug, c.piece_count, COUNT(*) AS pieces FROM piece_categories pc JOIN categories c ON pc.category_id = c.id GROUP BY c.id ORDER BY pieces DESC LIMIT 10`. Three candidate fixes worth weighing: (1) lower the floor from 75 → 65, accepting more "stretched fit" reuses; (2) seed broader umbrella categories (`Brain & Cognition`, `Biological Systems`, etc.) so the bias toward reuse has real hooks; (3) prompt-level: show Categoriser a sample of recent pieces under each candidate category so it sees what the bucket has actually been used for.
- **Sequencing:** **First post-Foundation-Fix priority** (Zi, 2026-05-07). Pick up after Foundation Fix Task 08 (retention + run_id) closes the original 8-task scope. Then this; then the silent-zombies entry below.
- **Priority:** medium. Doesn't block the pipeline; ships taxonomy that the library page renders. The reader experience degrades slowly — when the library has 30 categories with 1 piece each, "browse by topic" becomes useless.

## [open] 2026-05-07: Six zombie pipeline runs in `pipeline_log` with no terminal `done`/`error`/`failed` row — 5 of 6 silent (no observer event)

- **Surfaced:** 2026-05-07 audit. Survey of `pipeline_log` rows whose `piece_id` does NOT match any `daily_pieces.id` returns six orphans:
  | piece_id | Date / time UTC | Last logged step | Surfaced as observer error? |
  |---|---|---|---|
  | `0ff03a67-…` | 2026-05-07 02:00 | `curating running` | YES — 529 caught + logged |
  | `764656f7-…` | 2026-05-03 02:02 | `auditing_r2 running` | NO |
  | `9be1538c-…` | 2026-05-02 14:01 | `scanning running` | NO |
  | `afdfb4e4-…` | 2026-05-01 02:03 | `audio-publishing running` | NO |
  | `f55e80f7-…` | 2026-04-30 02:00 | `scanning running` | NO (separate same-day 529 was logged) |
  | `9eab8da6-…` | 2026-04-28 02:20 | `audio-publishing running` | NO |
  Two specifically wedged at `audio-publishing` (different shape from the others).
- **Hypothesis:** Director's `try / catch` on `triggerDailyPiece` only fires when the catch sees an error. Some failure modes — DO eviction mid-async, network stall, alarm-chain interruption — kill the in-flight work without raising a catchable error. The pipeline_log row stays at `running` forever and there's no closing event for the operator to spot. The bottom-of-FOLLOWUPS "wedge handling" entry queued the proper fix behind Foundation Fix Phase 2 — Phase 2 closed 2026-05-07, this entry is the surfacing.
- **Investigation hints:** the prior queued entry at the bottom of this file ("Pipeline wedges silently — runs leave `pipeline_log` rows stuck at `running`") has the proposed fix shape: a one-time D1 cleanup migration (or admin button) that retroactively closes `pipeline_log` rows whose last entry is older than 30 minutes and not in `[done, error, skipped, failed]`, plus a Director-level watchdog that fires N minutes after `dailyRun` start. The two `audio-publishing` zombies suggest the audio second-commit path has its own wedge mode worth a separate investigation hint — it runs as a scheduled alarm separate from the text pipeline (`runAudioPipelineScheduled`), so the watchdog needs to cover both alarm chains.
- **Why now:** Phase 2 of the Foundation Fix programme is closed (2026-05-07 with Task 07). The prior queued entry's "Hold for: Foundation Fix Phase 2 completion" precondition is met.
- **Sequencing:** **Second post-Foundation-Fix priority — picks up AFTER the Categoriser fragmentation entry above** (Zi, 2026-05-07). Pick up after Foundation Fix Task 08 closes AND the Categoriser fragmentation work ships. Operator currently monitors zombies manually and explicitly does not want auto-recovery yet — when picked up, the watchdog should default to logging an observer escalation and retroactively closing the `pipeline_log` row with a `stalled` status, NOT auto-retrying. Auto-retry decision deferred to a separate later evaluation once the silent-failure surface is visible.
- **Priority:** medium. Each zombie costs 0 reader-visible damage but accumulates noise in the admin pipeline view ("Running" rows that aren't running) and hides genuine new wedges in the noise.

## [observing] 2026-05-07: Anthropic 529 / overloaded_error killed daily run — application-level retry on hold

- **Surfaced:** 2026-05-07 02:00 UTC scheduled `dailyRun` died with `Pipeline error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CanPCTrqPZVWh8Pwpp1y2"}` (observer_events `0dc5ffe6-621e-439d-b73e-e84404bacf28`). Failure ~51s after Scanner finished filtering candidates (78 remained) — inside Curator's first LLM call. **The Anthropic console shows 3 RED requests for this run** (request IDs `req_011CanP8rnrwB3hjAXUsbM3A` / `req_011CanPB6xDQNSJoMJ5py4QB` / `req_011CanPCTrqPZVWh8Pwpp1y2` at 02:00:37 / 02:00:55 / 02:00:58 UTC) — that's the SDK's built-in retry firing twice and giving up. No piece published; no Drafter call; first real test of Task 04's `loaded_at` / `load_count` instrumentation slipped to the 06:08 UTC manual admin retrigger which succeeded.
- **Recurrence (correction to original entry):** 529s are NOT one-off — operator survey shows **5 incidents in 10 days** (2026-04-27, 04-28, 04-30, 05-04, 05-07). Roughly every other day. The original "single incident is consistent with one-off Anthropic congestion" framing was wrong.
- **Hypothesis (unchanged):** add a single application-level retry to [`agents/src/director.ts:120`](../agents/src/director.ts:120) — when the caught error matches `/529|overloaded/i`, sleep ~5min then call `triggerDailyPiece()` once more. Longer than the SDK's built-in 2-attempt exponential backoff (which already fired and gave up before the error bubbled). The failed run dies before any `daily_pieces` INSERT, so a second attempt allocates a fresh `pieceId` cleanly; cosmetic cost is duplicate `daily_candidates` rows under the orphaned first `pieceId`.
- **Why still observing despite the recurrence:** "let the system mature and then we think of it later" decision (Zi, 2026-05-07). The 06:08 UTC manual retrigger recovered same-day, and operator workflow is well-established (admin "Trigger daily piece" button). Implementing retry now risks masking a different failure mode behind a "looks like it healed" success. Re-evaluate after the next 529 incident — if it pattern-matches recurring, ship the retry. If a 529 leads to a wedge that the manual retrigger CANNOT recover, reclassify as `[open]` and ship.
- **Investigation hints:** confirm Anthropic SDK's default retry config before picking sleep duration (the 3 RED requests in 21s suggest 2 retries with exponential backoff topping out around 18s — application retry needs to wait long enough that the congestion window has actually closed). Check whether `daily_candidates` has any piece_id-scoped UNIQUE that would block a re-insert.
- **Priority:** low. Manual admin retrigger recovers same-day; not a blocker.

## [deferred] 2026-05-07: Drop-off heatmaps when N>30 days of dwell data accrue across N>30 pieces

- **Surfaced:** 2026-05-07, Foundation Fix Task 07 ("L17 closed"). Task 07 lands the data — every `audio-player` flush boundary writes a row to `audio_dwell_events` (migration 0035) — but does not surface it on any reader-facing or admin surface. Brief explicitly: "no dashboard work this task". The data lands going forward so the future heatmap consumer has accumulated input.
- **Hypothesis:** the natural admin surface is a per-piece drop-off heatmap on `src/pages/dashboard/admin/piece/[date]/[slug].astro` — for each beat, render a horizontal bar showing average completion ratio (`AVG(ratio)`) and listener count (`COUNT(DISTINCT user_id)`). High-ratio bars = the beat held attention; low-ratio = readers tap in but don't stay. Operator query #2 in `scripts/dwell-health.sql` (per-beat dwell distribution) is the backbone — same SELECT, rendered visually. A reader-facing surface (made-drawer) is a separate, lower-priority question; most readers don't care which beat had the steepest drop-off.
- **Unblock criterion (data sample size, NOT calendar date):** ≥30 days of accrual across ≥30 pieces with ≥1 listener each. Heatmap is statistically meaningful only at that scale; rendering it earlier would be visualisation noise and misread as system signal. Phrased this way explicitly so the next pickup-task uses real-data thresholds, not "wait 30 days".
- **Why deferred:** same posture as the Task 03 + Task 04 + Task 05 + Task 06 deferred surface entries below. Designing this is content + UI work, not data work — bundling would have grown scope ~30%. The brief explicitly named drawer / dashboard work as defer-by-default for Task 07.
- **Investigation hints:** start with the admin per-piece page (operator-shaped detail, simpler audience). Use the `idx_dwell_piece_occurred` composite index on `(piece_id, occurred_at)` for the per-piece scan; the leftmost prefix handles the WHERE. Per-user retrospectives (e.g. "show all dwell rows for this signed-in user") are even further deferred — `idx_dwell_user_occurred` is in place to serve them when picked up.
- **Priority:** low. The data flows; the surface is downstream readability work. Pick up after the unblock criterion is met.

## [deferred] 2026-05-07: Surface revision trail (rounds + decisions) on the made-drawer + admin per-piece

- **Surfaced:** 2026-05-07, Foundation Fix Task 06 ("L4, L8, L9 closed"). Task 06 lands the data — every `draft()` call writes round 0 to `draft_revisions`, every `revise()` call writes round N + per-decision rows to `draft_revisions` + `integrator_decisions` (migration 0034) — but does not surface it on any reader-facing or admin surface.
- **Hypothesis:** the natural reader-facing surface is the *How this was made* drawer's existing "What the auditors said" section (rendered from `audit_results` per round). The natural extension is per-round word counts + per-feedback-item dispositions ("Voice flagged 'unlock' — accepted, replaced with 'enable'"). The natural admin surface is the per-piece deep-dive (`src/pages/dashboard/admin/piece/[date]/[slug].astro`) with the full revision trail rendered alongside the existing audit-rounds table — operator-shaped detail showing how the prose evolved across rounds.
- **Why deferred:** same posture as the Task 03 + Task 04 + Task 05 deferred surface entries above. Designing this is content + UI work, not data work — bundling would have grown scope ~30%. The brief explicitly named drawer work as defer-by-default. Both consumer files (`src/pages/api/daily/[date]/made.ts`, the admin page) SELECT explicit columns; the new tables are silently safe.
- **Investigation hints:** start with the admin per-piece page (operator-shaped detail, simpler audience). Reader-facing made-drawer is a separate and lower-priority question — most readers don't care which feedback items the Integrator overruled; the drawer's audit-rounds section already gives them voice/structure/fact verdicts. The decisions array's diagnostic value is mostly for operators and the future Task 09 verification work.
- **Priority:** low. The data flows; the surface is downstream readability work. Pick up after Phase 2 completes.

## [resolved] 2026-05-12: Integrator regression risk — passing dimensions can flip to failing across rounds

- **Surfaced:** 2026-05-12, observed on the 2026-05-06 magic-mushroom piece (`content/daily-pieces/2026-05-06-single-dose-of-magic-mushroom-psychedelic-can-cause-anatomic.mdx`). Voice scored 95 in Round 1, dropped to 92 in Round 2 after the Integrator's revision introduced "unlock" (a banned tribe word), then recovered to 95 in Round 3. The piece would have shipped as Polished on Round 1 alone; the round-trip across dimensions cost two extra rounds.
- **Hypothesis:** Integrator's `revise()` only sees failed audit feedback (three `if (!result.passed)` blocks at `agents/src/integrator.ts`). Claude inside the Integrator never knows what was passing, so its rewrite to fix one dimension can inadvertently break another. Across 3 rounds this manifests as dimension-flipping ("whack-a-mole") that ships pieces as Rough not because the writing was bad but because the Integrator was chasing its tail. Phase 2 Task 06's `integrator_decisions` data will conflate "genuinely hard piece" with "Integrator chasing its tail" — making the question "is the system getting better?" harder to answer cleanly.
- **Investigation hints:** Read `agents/src/integrator.ts` (~75 lines, "Stateless — Director spawns a fresh instance per day" comment in the header is the giveaway). The fix is two-part: (1) pass all three audits to the prompt with explicit PRESERVE/FIX framing so passing dimensions survive the rewrite; (2) add Durable Object state for round-to-round memory within a single piece, keyed by `piece_id`, cleared when `piece_id` changes. Full brief at `docs/foundation-fix/09-INTEGRATOR-AWARENESS.md`; session-kickoff prompt at `docs/foundation-fix/09-INTEGRATOR-AWARENESS-prompt.md`.
- **Prerequisite for the fix:** Foundation Fix Task 06 must ship first (creates `integrator_decisions`); the verification SQL counts pass→fail flips from that table. Need ~10+ multi-round pieces accumulated post-Task-06 before the pre-deploy spot-check has data to verify against. Phase 3 Task 08 is also a prereq (run_id end-to-end).
- **Sequencing:** queued as Phase 4 Task 09 in `docs/foundation-fix/00-MASTER-PLAN.md`. Picks up after Task 08 closes the original programme AND a 2–4 week watch window has accrued data on `integrator_decisions`.
- **Stop-condition:** if after the watch window the regression doesn't show up in `integrator_decisions` data, Task 09's stop-condition fires ("regression doesn't show up in production data → may not be needed yet") and the task is descoped. The catalyst observation on the magic-mushroom piece is qualitative evidence; empirical confirmation comes from the table.
- **Priority:** medium. Doesn't block any pipeline; ships pieces as Rough that might otherwise be Solid. Pick up after Task 08 closes the original programme and Task 06's data has accumulated.
- **Resolved:** 2026-05-07 in branch `post-foundation-09-integrator-awareness`. Watch-window stop-condition fired at deploy time (integrator_decisions empty because Task 06 only shipped 2026-05-07; today's piece cleared R0 single-round so no multi-round data accrued); operator chose Path 2 — proceed treating the magic-mushroom 95→92→95 anecdote as the qualitative anchor and rely on post-deploy regression-rate audit as the verification gate. Code change: `IntegratorAgent` now extends `Agent<Env, IntegratorState>` with `initialState`; `revise()` builds the user message from new pure helpers `buildCurrentRoundFeedback` (always three sections, PRESERVE/FIX framing) and `buildPreviousRoundContext` (round-N-1 PASS/FAIL summary when state holds a same-piece snapshot). State write is unconditional (snapshots regardless of parseError/persistError — the audit results themselves are what next round needs); state read is keyed by piece_id with lazy reset (mismatched piece_id → ignored on read, overwritten on write). System prompt's RULES block updated to instruct PRESERVE on PASS sections and call out pass→fail flips as regressions. Contract bumped v1.0 → v1.1 in same commit. Pure helpers exported for future unit-test reach. No migration. New post-deploy operator queries at `scripts/integrator-regression-health.sql` (4 read-only queries: recent_regressions / multi_round_pieces_count / per_piece_regressions / round_distribution); new [observing] FOLLOWUPS entry queued for the 30-day post-deploy regression-rate evaluation.

## [observing] 2026-05-07: Integrator regression-rate evaluation — 30-day post-deploy window

- **Surfaced:** 2026-05-07, Foundation Fix Task 09 closing PR. Task 09 ships the prompt change (always-three-sections PRESERVE/FIX framing) + DO state (round-to-round audit snapshot keyed by piece_id) but the empirical pre-deploy spot-check was descoped because `integrator_decisions` hadn't accrued multi-round data yet — Task 06 shipped the same day. This entry is the queued post-deploy verification.
- **Unblock:** ≥10 multi-round pieces in `integrator_decisions` with the Task 09 code live (~2-4 weeks at ~1 piece/day, ~50% multi-round rate). After that, run `wrangler d1 execute zeemish --remote --file=scripts/integrator-regression-health.sql` and read all four queries.
- **Decision to make:** is the regression-prevention working? Possible outcomes:
  - **Working** — query 1 returns 0 or near-zero `overruled→accepted` flips per feedback_source. Close as `[resolved]`; the watch window achieved its purpose.
  - **Partial** — flip count is non-zero but visibly lower than the qualitative magic-mushroom-style baseline (1 regression per multi-round piece). The PRESERVE framing helps but isn't sufficient. Investigation: inspect the actual prompt sent to Claude on a flipping round (admin pipeline-log view's request-payload field) to see whether the previous-round context renders correctly and whether the PASS instruction reads as protective.
  - **Not working** — flip count matches or exceeds the pre-deploy expectation. Either the prompt change didn't take effect or the DO state isn't being read correctly. Diagnose by inspecting the rendered prompt; verify `IntegratorState.lastSnapshot` is populated round-to-round via the admin DO state inspector.
- **Priority:** medium. Decision deferred ~30 days; setting up the rails was the work, not the analysis. Same posture as Task 04's 30-day Learner evaluation.

## [observing] 2026-05-07: Rough-tier signal vs Solid-tier signal post-Task-09

- **Surfaced:** 2026-05-07, Foundation Fix Task 09 closing PR. Named in the brief's "what this enables later" section: once the Integrator is round-aware, Rough pieces post-fix should be genuinely hard pieces (good signal for the Learner) rather than a mix of hard pieces and dimension-whack-a-mole.
- **Unblock:** ≥30 days of post-Task-09 `integrator_decisions` data + matching `audit_results` data. After that, evaluate whether Rough-tier pieces (voice < 70) are now meaningfully different from Solid-tier (70-84) in their revision patterns — e.g. fewer pass→fail flips per Rough piece would suggest Rough is now genuinely-hard signal; same flip rate as before would suggest the prevention isn't biting and Rough remains a noisy mix.
- **Investigation hints:** join `daily_pieces.voice_score` (or the regenerated tier from `audit_results`) against per-piece pass→fail flip count from `integrator_decisions`. If the distribution separates cleanly (Rough pieces have fewer flips than Solid), that's a clean Learner signal. If it doesn't separate, the Learner's "Rough = hard piece" assumption needs more work upstream of Task 09.
- **Priority:** low. Speculative until 30 days of data body. Premature to act on.

## [deferred] 2026-05-07: Surface integrator regression awareness in admin per-piece deep-dive / made-drawer

- **Surfaced:** 2026-05-07, Foundation Fix Task 09 closing PR. The data lands going forward (`integrator_decisions` with both rounds' decisions per piece, plus the new prompt + state behaviour visible via DO state inspection); no reader-facing or admin surface renders the round-to-round transition story yet.
- **Hypothesis:** the natural admin surface is the per-piece deep-dive's existing decisions table at `src/pages/dashboard/admin/piece/[date]/[slug].astro` (already renders `integrator_decisions`). Extension would render pass→fail flip annotations between rounds: "Round 2 introduced [tribe_word]; Round 3 fixed it." Reader-facing surface on the made-drawer is similar but lower priority — most readers don't care which feedback items the Integrator overruled; the drawer's audit-rounds section already gives them voice/structure/fact verdicts per round.
- **Why deferred:** same posture as the Tasks 03 / 04 / 05 / 06 / 07 deferred surface entries. Designing this is content + UI work, not data work — bundling would have grown scope ~30%. The brief explicitly named drawer work as defer-by-default. Both consumer files SELECT explicit columns; the round-pair derivation is a render-time computation against existing rows.
- **Investigation hints:** start with the admin per-piece page (operator-shaped detail, simpler audience). The `round_pairs` CTE in `scripts/integrator-regression-health.sql` is the rendering shape — pair adjacent rounds, flag pass→fail transitions. Reader-facing made-drawer can pick up later from the same shape.
- **Priority:** low. The data flows; the surface is downstream readability work.

## [deferred] 2026-05-12: Surface audio_audit_results on admin per-piece deep-dive

- **Surfaced:** 2026-05-12, Foundation Fix Task 05 ("L10, L11, L12 closed"). Task 05 lands the data — every `AudioAuditorAgent.audit()` call writes per-issue rows + a summary row to `audio_audit_results` (migration 0033) — but does not surface it on any reader-facing or admin surface.
- **Hypothesis:** the natural admin surface is the per-piece deep-dive's existing `audioRows` table at `src/pages/dashboard/admin/piece/[date]/[slug].astro:217` (already SELECTs from `daily_piece_audio` in column-explicit form, so the new `file_size_bytes` column is silently safe but not rendered). The shape would be: an "Audio audit history" panel below the current audioRows render, showing each `audit()` invocation as a row with timestamp, summary verdict (`passed`, `notes` rollup), and a nested expand for per-issue rows when `passed=0`. Window-function pattern parallel to operator-query #1 in `scripts/audio-audit-health.sql`.
- **Why deferred:** same posture as the Task 03 + Task 04 deferred surface entries below. Designing this is content + UI work, not data work — bundling would have grown scope ~30%. Both consumer files SELECT explicit columns by name; the new table + column don't break either page.
- **Investigation hints:** start with the admin per-piece page (operator-shaped detail, simpler audience). Reader-facing audio audit history on the made-drawer is a separate and lower-priority question — most readers don't care which beat had a size anomaly; the drawer's `MadeAudio` envelope already gives them a pass/fail summary via `has_audio`.
- **Priority:** low. The data flows; the surface is downstream readability work. Pick up after Phase 2 completes.

## [deferred] 2026-05-12: Backfill made-drawer's totalSizeBytes from daily_piece_audio.file_size_bytes

- **Surfaced:** 2026-05-12, Foundation Fix Task 05. Task 05 closes L11 (the `file_size_bytes` column lands on `daily_piece_audio`); the made-drawer envelope at [`src/pages/api/daily/[date]/made.ts:295`](../src/pages/api/daily/[date]/made.ts:295) currently returns `totalSizeBytes: null` with a comment naming "not stored in D1 — R2 HEAD is agents-worker-only". With the new column populated going forward, that field can return `SUM(file_size_bytes)`.
- **Hypothesis:** one-line query change in `made.ts` — replace `totalSizeBytes: null` with the sum of the per-row `file_size_bytes` already SELECTed (or extended into the SELECT). NULL on pre-Task-05 historical rows means the sum will be partial for older pieces; honest behaviour is to return null when any row has NULL, or to return the partial sum with a flag — content-design call.
- **Why deferred:** trivial code change but requires deciding the partial-sum vs null-on-any-NULL behaviour, which is a content decision tied to how the made-drawer renders the value. Pick up next time the made-drawer is touched for other reasons.
- **Priority:** low. Cosmetic; the `null` is honest today.

## [observing] 2026-05-11: Learner feedback loop — 30-day signal vs noise evaluation

- **Surfaced:** 2026-05-11, Foundation Fix Task 04 ("L15 closed"). The loop now records load events (`loaded_at` / `load_count`) on every `getRecentLearnings(10)` call, applied attribution (`applied_to_prompts` JSON-append) on every successful publish, and validation timestamps (`last_validated_at`) only for loaded learnings whose piece cleared the Polished-strict bar (voice ≥ 90 AND 1 round). The data lands going forward; this entry is the queued evaluation.
- **Unblock:** ≥30 days of cron runs against the new schema. After that, run `wrangler d1 execute zeemish --remote --file=scripts/learner-health.sql` and read all four queries (noise / signal / workhorses / retirement candidates).
- **Decision to make:** is the Learner meaningfully selecting useful patterns, or just generating noise? Possible outcomes:
  - **Keep** — `signal` count is non-trivial and `workhorses` show validation; loop is producing what it claimed to produce.
  - **Narrow extraction logic** — `noise` count dwarfs `signal`; many loaded patterns never reach Polished-strict pieces. Tighten what Learner writes (higher confidence floor, or category-specific extraction).
  - **Replace with a different signal source** — both counts are low because `getRecentLearnings(10)` is too narrow; consider relevance scoring (tag match against brief subject) as the v2 retrieval shape.
- **Do NOT delete learnings during the observation window** — even ones that look unused. Loop needs to settle.
- **Priority:** medium. Decision deferred ~30 days; setting up the rails was the work, not the analysis.

## [deferred] 2026-05-11: Surface Learner feedback (loaded / applied / validated) in made-drawer + admin per-piece

- **Surfaced:** 2026-05-11, Foundation Fix Task 04. The data lands going forward; no reader-facing or admin surface renders it yet.
- **Hypothesis:** the natural reader-facing surface is the per-piece *How this was made* drawer's "What the system learned from this piece" section — currently renders `learnings` rows by source (producer / self-reflection / Zita), one logical extension is "and N rows from prior pieces were loaded into this draft, M of which were validated by this publish". Admin surface is the per-piece deep-dive table — operator-shaped detail showing which specific learnings were loaded + their validation count over time.
- **Why deferred:** same posture as the Task 03 deferred surface entry above. Design work, not data work — bundling would have grown scope 30%. Both consumer files (`src/pages/api/daily/[date]/made.ts`, `src/pages/dashboard/admin/piece/[date]/[slug].astro`) SELECT explicit columns; the new columns are silently safe.
- **Priority:** low. Pick up after the 30-day evaluation entry above resolves — its outcome (keep / narrow / replace) shapes what the surface should say.

## [deferred] 2026-05-06: Surface curator pick + rejection reasoning in made-drawer + admin per-piece

- **Surfaced:** 2026-05-06, Foundation Fix Task 03 ("L1, L2, L25 closed"). Task 03 lands the data — `pick_reasoning` on the picked candidate, `rejection_category` + `rejection_reason` on every rejection — but does not surface it on any reader-facing or admin surface.
- **Hypothesis:** Both `daily_candidates`-reading surfaces (`src/pages/api/daily/[date]/made.ts:210` for the public *How this was made* drawer, `src/pages/dashboard/admin/piece/[date]/[slug].astro:166` for the admin per-piece deep-dive) currently render the also-considered list as headline + score. The natural reader-facing surface for the new fields is the made-drawer ("why this candidate was picked / what categories the rejected ones fell into / one-sentence reasons on the top-5 runner-ups"); the natural admin surface is the same per-piece deep-dive (operator-shaped detail).
- **Why deferred:** designing this is content + UI work, not data work. Doing it inside Task 03 would have grown scope ~30% and bundled two different judgment kinds (data persistence + reader copy). The Foundation Fix programme's "do not bundle this with other agent fixes" principle applies. The new fields are silently safe — both SELECTs name explicit columns, so adding the three new ones to `daily_candidates` doesn't break either page.
- **Investigation hints:** the made-drawer is the higher-impact surface (every published piece carries it). Start by deciding what reader-shaped detail to expose (full pickReasoning? rejection categories as a count chart? the top-5 reasons verbatim?) before touching code. Operator surface is simpler — admin per-piece can just show all four fields alongside the existing teal-dot table.
- **Priority:** low. The data flows; the surface is downstream readability work. Pick up after Phase 2 completes.

## [observing] 2026-05-06: 2026-04-26 U.S. Mint piece — `selected = 0` despite post-2026-04-22 publish

- **Surfaced:** 2026-05-06 during Foundation Fix Task 03 backfill verification. Spot-check across all daily_pieces showed one post-fix piece (`9280146e-16ad-4c7a-977a-1900dc9b3324`, "U.S. Mint Buys Drug Cartel Gold and Sells It as 'American'", 2026-04-26) reporting `picked_count = 0`. The piece was published correctly; its candidate row exists in `daily_candidates` (id `59fb31d6-2d87-4778-a71b-82cbc02b1c1e`) with the correct piece_id, source `The New York Times`, and headline matching except for curly-quote normalization. The Director UPDATE that flips `selected = 1` did not land for this piece's run despite the 2026-04-22 fix being in place.
- **Hypothesis:** Three possibilities, in order of plausibility:
  1. Curator returned a `selectedCandidateId` that didn't exactly match the candidate's `id` (UUID typo, hallucination, or curly-quote contamination in the response). Director's UPDATE matched 0 rows; the 2026-04-22-introduced `observer.logError` should have fired in the admin feed for this run — check observer_events for that day.
  2. The `daily_candidates` row was inserted by a later Scanner run after Director's UPDATE fired against an earlier-shape id (race / UPDATE-before-INSERT ordering bug). Less likely given Director awaits Scanner before calling Curator.
  3. Some transient D1 write failure on this single UPDATE that didn't propagate through the .run() promise.
- **Investigation hints:** `SELECT * FROM observer_events WHERE piece_id = '9280146e-16ad-4c7a-977a-1900dc9b3324' AND severity = 'error' ORDER BY created_at;` — the 2026-04-22 fix logs three distinct error shapes (UPDATE throw, 0-rows, no selectedCandidateId). Whichever fired tells you which hypothesis. Also pull the Curator response from pipeline_log for that run (via the admin per-piece deep-dive) and compare its `selectedCandidateId` against the candidate row's id character-by-character.
- **Why not extended into the L25 backfill:** Task 03's `scripts/backfill-selected-flag.sql` deliberately bounds at `date <= '2026-04-22'` to avoid the multi-feed false-positive trap. Repairing this single piece outside that bound needs a different identity signal (the MDX `sourceUrl` frontmatter would work — it's a deterministic URL match). Out of scope for L25 — this is a separate, isolated bug.
- **Priority:** low. One piece's teal-dot is wrong on the per-piece admin; reader-facing impact is the made-drawer's `picked` envelope rendering `null` for this piece. Cosmetic until/unless the same shape repeats — surface a [observing] window if a second instance appears.

## [open] 2026-05-06: Embedding-driven "past similar choices" for Curator (Optional follow-up from Task 03)

- **Surfaced:** 2026-05-06 in `docs/foundation-fix/03-CURATOR-FIX.md` "Optional follow-up (defer)" section. Task 03 lands the data substrate: `pick_reasoning` and `rejection_reason` on every Curator run going forward. Once enough accumulates, that table becomes a goldmine for tightening Curator's taste.
- **Hypothesis:** Once 30+ days of `pick_reasoning` and `rejection_reason` data accumulate (~60 picks at 2/day cadence, ~5,000 rejections), embed the reasoning text and use nearest-neighbour search at Curator runtime to surface a "past similar choices" block — analogous to how Drafter currently reads recent learnings. Curator sees its own past taste alongside today's candidates; the system gradually develops coherent identity rather than re-deciding every run from scratch.
- **Investigation hints:** Vectorize is already on the platform plan (per ARCHITECTURE.md and chapter 16). The simplest first cut would be: embed the picked candidate's `pick_reasoning` + the top-5 rejected `rejection_reason`s, k-NN against today's candidate headlines (also embedded), inject the top 3 nearest "past similar pick" mini-cards into Curator's user-message prompt. No prompt-rule body change — just a new data block alongside the existing recent-pieces and category-concentration blocks.
- **Why deferred:** explicitly out of Foundation Fix scope. Defer until after the platform plan begins (per the brief).
- **Priority:** low. Speculative until the data substrate has 30+ days of body — premature implementation would optimize against a sample size of nothing.

## [observing] 2026-05-01: Curator + Scanner diversity intervention — verification window

- **Surfaced:** 2026-05-01 user brief flagged narrow conceptual range across 32 pieces (top 5 of 18 categories holding 22 of 32; 18-Apr / 20-Apr Hormuz near-duplicate). Investigation against prod D1 surfaced TWO real causes: (1) Curator's TEACHABILITY interpretation skewed toward crisis/policy/system-failure framings despite genuinely diverse stories sitting in the rejected pool ("Darkness can travel faster than light", "Scorpion exoskeletons fortified with metal", "Spooky feelings caused by boiler sounds"), (2) Scanner pulls only 6 Google News topic feeds, structurally biasing the candidate pool toward wire-service breaking-news shapes. Two commits this session: Curator prompt rewrite around 10-domain breadth taxonomy + new RECENT CATEGORY CONCENTRATION block (commit 1), Scanner direct feeds extending the input pool (commit 2).
- **What we're watching:** Next 7 cron firings (≈2026-05-04 14:00 UTC, with 2 firings/day at `interval_hours=12`). Two signals to track:
  1. **Category breadth:** at least 3 of 7 pieces should land in a category currently holding ≤2 recent pieces, OR open a brand-new category (Categoriser-side novel propose at ≥75 confidence per migration 0027 + categoriser-prompt.ts).
  2. **Source breadth:** at least 2 of 7 pieces should be sourced from a non-Google-News feed — the candidate's `category` label in `daily_candidates` should be one of the new domain feeds (AEON, QUANTA, JSTOR_DAILY, NAUTILUS, etc., once commit 2 ships).
- **Healthy mid-band:** 2-4 thin-category picks AND 2-4 non-Google-News-source picks per 7 firings. That's the system drifting toward breadth without over-rotating.
- **Failure mode A — soft preference not biting (0-1/7 thin-category):** Curator's interpretation is still anchored to crisis framings. Escalation: list the 5 thinnest categories explicitly in the prompt (concrete pull) instead of relying on the descriptive count block alone.
- **Failure mode B — Scanner cap pinching (0-1/7 non-Google-News-source):** Per-feed cap added in commit 2 isn't preserving budget for new feeds. Escalation: lower per-feed cap on TOP / TECHNOLOGY / SCIENCE / BUSINESS Google News feeds OR raise per-feed cap on direct feeds.
- **Failure mode C — over-rotation (5+/7 thin-category):** Curator skipping strong news events because the override language ("unless the news event genuinely demands the fuller category") isn't reading. Escalation: tighten override language with explicit examples; lower the soft-preference threshold from 3+ to 4+ pieces.
- **Diagnostic queries:** `SELECT date, headline, underlying_subject FROM daily_pieces WHERE date >= date('now', '-7 days') ORDER BY published_at DESC` for the picks; `SELECT c.name, COUNT(DISTINCT pc.piece_id) FROM categories c JOIN piece_categories pc ON c.id = pc.category_id JOIN daily_pieces dp ON pc.piece_id = dp.id WHERE dp.date >= date('now', '-7 days') GROUP BY c.id` for thin-category counts; `SELECT date, category, headline FROM daily_candidates WHERE selected = 1 AND date >= date('now', '-7 days')` for source-domain attribution.
- **Unblock:** by 2026-05-08 — either the system has bent toward breadth (mid-band signal) and we close as `[resolved]` against this session's commits, or one of the failure modes hit and we ship the named escalation.
- **Priority:** medium (signals system health, not a blocker; current cadence is healthy and pieces ship regardless of breadth verdict).

## [observing] 2026-05-01: Library "32 pieces · 32 subjects" label may overstate diversity

- **Surfaced:** 2026-05-01 user brief: *"the '32 pieces · 32 subjects' library label is overstating diversity — several 'subjects' are paraphrases of each other."* Spot-checked: the library label likely renders `dailyPieces.length` for both numbers; the "subjects" count is misleading at best (every piece has a unique `underlying_subject` string, but several are conceptual paraphrases).
- **Hypothesis:** Render site is in `src/pages/library/index.astro` or a related Astro component. The honest replacement is `getCategories().length` (count of distinct library categories, currently 24) or `new Set(pieces.map(p => p.underlying_subject)).size` (still likely matches piece count but at least labels truthfully).
- **Investigation hints:** Grep `src/pages/library/` for "subjects" string render. Check if the count is computed inline or pulled from `src/lib/categories.ts:getCategories()`. The fix is one or two line changes in the .astro template.
- **Priority:** low (cosmetic / honesty hygiene, not a system bug). Defer until the post-Curator-fix verification window completes — the "subjects" count will mean different things if the breadth intervention bites.

## [observing] 2026-05-03: InteractiveGenerator — Claude drops quotes around long `concept` values

**Surfaced:** 2026-05-03 night, after the Foundation Fix Task 02 Phase A codegen deploy. The 2026-05-03 paleontology piece's quiz (`Locked in stone for 210 million years…`) parse-failed all 3 rounds. The diagnostic patch shipped same night (commit `80bb7b6`) preserves per-round head text into the surviving error message and renders it in the per-piece admin. The crocodile piece's three head strings showed identical wobble:

```
R1: "concept": When you can't observe behavior directly, physical form reveals function—because structures that sol…
R2: "concept": When direct observation is impossible, you can reconstruct what something did by measuring…
R3: "concept": When you can't observe behavior directly, you infer function from physical form—deeper jaws suggest…
```

`slug` and `title` are correctly quoted; `concept` is a bare unquoted sentence after the colon. JSON parser fails at the first `W`. The same exact wobble hit the 2026-05-03 antibody piece's HTML round 1 (`"concept": A recognition system under resource constraint…`) — that one recovered on round 2 because Layer 1 retry got Claude into a different state. The crocodile got unlucky and burned all three rounds on the same shape.

**Hypothesis:** Claude occasionally treats a long sentence-shaped string value as if the shape itself implies "this is a name / identifier" and emits it without quotes. The wobble is independent of topic and predates the codegen deploy (the 2026-04-27 + 2026-04-30 quiz/html parse-fails documented elsewhere in this file are likely the same shape, but those happened before the diagnostic patch existed so we can't confirm from heads). Long values that contain em-dashes or compound punctuation may push Claude further off the JSON discipline.

**Why it's not a deploy regression:** the antibody piece (also post-deploy) hit the bug AND recovered via retry. The wobble exists whether the codegen ran or not; the codegen content shift (markdown bold restored + bullet list expanded + html CSS pseudo-element restored) does not interact with this Claude-side quoting behaviour.

**Mitigation already in place:** the 2026-04-30 PM Layer 1 (try/catch counts parse-fail as a consumed round) + Layer 2 (`{ role: 'assistant', content: '{' }` prefill) hardening absorbs ~67% of single-round wobbles via retry budget. The crocodile case is the unlucky 3-in-a-row; antibody R1 is the typical 1-in-3 that recovers cleanly.

**Three forward fixes ranked by durability:**

1. **Anthropic structured-output JSON mode.** `response_format: { type: 'json_schema', schema: ... }` forces the API to return structurally valid JSON conforming to a declared schema. Eliminates the wobble entirely. Requires checking SDK + model support for `claude-sonnet-4-5-20250929`; may interact with the assistant-prefill hardening (which would become unnecessary). Most durable, biggest API change.
2. **Tighten Layer 2 prefill.** Change `{ role: 'assistant', content: '{' }` to something further into the JSON state machine, e.g. `{\n  "slug": "` so Claude is locked inside a string when it begins generating. Forces continuation as a string; covers the wobble for the slug field's first character. The concept/title fields would still be at risk on subsequent positions, so this only partially closes the gap. Smallest change; cheapest to ship; doesn't fully solve it.
3. **JSON-repair preprocessor in `parseAndValidate`.** Before throwing, run a small repair that detects `"key": <bare-unquoted-value>,` shapes and inserts the missing quotes. Fragile (brittle regex over JSON-ish text) and adds maintenance surface. Covers more wobble shapes than #2 but less reliably than #1.

**Don't ship the fix during Foundation Fix.** This wobble is observable, mitigated, and not blocking. The system honestly reports the failure and ships pieces with quality_flag='low' or no quiz when retry exhausts. Every cron piece still publishes; users are not impacted. Address after Foundation Fix Phase 2 + 3 land — that's when the system has clean data flowing and an isolated experiment on prompt+API changes can be evaluated cleanly.

**Watch.** Track parse-fail rate over the next 14 days. Healthy mid-band: ≤1 all-3-round failure per 14 cron pieces (=12% across both quiz + html paths). Above that, escalate to fix #1.

**Diagnostic surface:** observer events under `Interactive generation failed` now contain `R1: ... || R2: ... || R3: ...` per-round heads in the reason string, rendered cleanly on the per-piece admin (`/dashboard/admin/piece/[date]/[slug]/`). When investigating, read the heads first — the outer "across all 3 rounds" message is the wrapper, the heads are the data.

**Priority:** medium. Pre-existing wobble, mitigated, doesn't block pipeline. Worth fixing when bandwidth permits and Foundation Fix has cleared.

**Update 2026-05-05 — Layer 3 mitigation (JSON-repair revision) shipped without addressing the wobble itself.** The 2026-05-04 piece's quiz + HTML both burned all 3 rounds on the same unquoted-`concept` defect (slugs `observation-shaped-by-expectation` / `model-limits-search-space` / `model-bounded-search` for quiz; `search-filtered-by-expectation` / `search-boundary-from-model` / `assumption-driven-search` for HTML — different drafts each round, identical malform). Manual admin retrigger succeeded immediately, confirming the failure is stochastic. Investigation surfaced a STRUCTURAL gap distinct from the wobble itself: rounds 2 and 3 re-ran the initial prompt with NO signal that the previous output was malformed (the audit-revise path only fires when JSON parsed but auditor failed). So whenever the wobble repeats across sampling variation, the loop hammers the same prompt 3 times. Layer 3 closes this gap by populating `lastParseFailHead` on the parse-fail catch and routing the next round through `repairQuiz` / `repairHtml` with the broken head quoted back to Claude. Layer 3 does NOT address the wobble itself — Claude can still produce malformed JSON on any given round; Layer 3 just gives the next round something different to look at. The "Three forward fixes" above (#1 structured-output JSON mode, #2 tighter prefill, #3 JSON-repair preprocessor) all remain queued for post-Phase-2 — see the dedicated `[observing] 2026-05-05` entry below for the trigger condition.

---

## [observing] 2026-05-05: InteractiveGenerator wobble — root-cause fix deferred to post-Phase-2 (option a — Anthropic tool-calling / structured output)

- **Surfaced:** 2026-05-05, after the Layer 3 (JSON-repair revision) mitigation shipped same day. Layer 3 closes the structural retry-blindness gap that turned a single Claude wobble into a 3-round burn, but it does NOT eliminate the wobble itself — Claude still occasionally drops opening quotes on long natural-language `concept` values.
- **Hypothesis:** see `[observing] 2026-05-03` above for the full diagnostic surface (heads, repro shape, ruled-out causes). The wobble is at the model output layer, not the prompt or parser layers.
- **The deferred fix — option (a), Anthropic tool-calling / structured output.** Define a `submit_quiz` tool with a JSON schema; force `tool_choice` to that tool. The API guarantees the response is a tool-use block conforming to the schema — no text path, no quote-drop possibility. Same shape for `submit_html`. Touches all 6 Claude call sites in InteractiveGenerator (produce + revise + repair, ×2 paths) plus the response-parsing path (tool_use block → typed input, not text → JSON.parse). The HTML path's long HTML-string-as-tool-input has unverified character-length implications; pre-flight check against Anthropic's tool-input limits before scoping. Layer 2's assistant-prefill `{` becomes redundant under tool-calling and should be removed.
- **Why deferred:** Foundation Fix Phase 2 is in flight. Tool-calling reshapes the API contract for InteractiveGenerator; mixing that change with Phase 2 would muddy attribution if anything regresses. Ship Phase 2 cleanly first.
- **Trigger to escalate (sharp):** **if parse-fail terminal exhaustion (`across all 3 rounds`) recurs on 2+ pieces post-Layer-3, escalate immediately.** Layer 3 should reduce the all-rounds-fail rate to <1 in 30 cron pieces (~3%); 2 in any 30-piece window means the wobble is more frequent than the retry budget can absorb, and Layer 3's "different prompt each round" isn't enough. Don't wait for Phase 2 completion — option (a) becomes the priority work that day.
- **Trigger to descope (also sharp):** if 30+ post-Layer-3 cron pieces ship with zero terminal parse-fails, the wobble + Layer 3 combination is healthy enough that option (a) is no longer urgent — keep it queued for general API-hardening work but don't let it block other priorities.
- **Watch:** observer events under `Interactive generation failed` per `[observing] 2026-05-03`'s diagnostic surface. The per-piece admin's `parseFailures` array is the canonical signal; an entry with `roundsUsed: 3` and a populated `errorMessage` matching `parseAndValidate*: Claude returned non-JSON output across all 3 rounds` is one terminal exhaustion. Count from 2026-05-05 forward.
- **Where to start when escalating:** read the SDK + model docs for tool-calling on `claude-sonnet-4-5-20250929` (or the current pinned model); spike the quiz path first (smaller envelope, no HTML-string size question); confirm `tool_choice` forces the tool over the model's text path; verify cache_control still works with the system block + tool list; remove Layer 2 prefill from all 6 call sites; update `verify-parse-retry.mjs` to reflect that tool-calling makes parse-fail effectively impossible (the budget logic stays for genuine API errors).
- **Priority:** medium-low while parse-fail rate stays inside the watch-band; medium-high the day the trigger fires.

---

## [wontfix] 2026-05-01: Don't pre-create empty categories

- **Surfaced:** 2026-05-01 plan briefly considered seeding the `categories` table with the 10 domains from the breadth taxonomy (Inner life / Meaning and belief / etc.) as empty rows so Curator + Categoriser see them. User explicit: *"the fix is in the prompt and the input list, not in pre-creating empty categories."*
- **Won't fix:** Empty categories with `piece_count=0` would clutter the library chip bar at `/library/`. Categoriser already creates novel categories at confidence ≥75 organically when Curator picks a piece that doesn't fit existing taxonomy (per migration 0027 + categoriser-prompt.ts; Knowledge Formation was created this way for the golden-orb piece on 2026-04-29). The breadth fix is in the input (Scanner feeds, commit 2 of the 2026-05-01 intervention) and the interpretation (Curator prompt, commit 1). Categories grow when pieces land in them. Future sessions tempted to "help" by pre-seeding the table should re-read this entry first and the user's 2026-05-01 message.

---

## [resolved 2026-05-03] 2026-04-30 (last): Centralise contracts — single source of truth across agents

**Resolution (2026-05-03):** Phase A shipped on branch `foundation-fix-02-extraction` as Foundation Fix Task 02's first session. Codegen lives at `agents/scripts/codegen-contracts.mjs`; output module at `agents/src/shared/generated/contracts.ts`; drift verifier at `agents/scripts/verify-contracts-fresh.mjs`; CI gate is the new `check-agents` job in `.github/workflows/deploy-site.yml`. The two manual mirrors (`agents/src/shared/voice-contract.ts`, `agents/src/shared/interactive-html-reference.ts`) are deleted; six import sites migrated to the generated module. Both mirrors had drifted from canonical (voice stripped markdown bold + restructured the editor's-test bullets; html dropped a `.choke::before` block + inline JS comments) — codegen now embeds the canonical bytes verbatim. **Tier-3 disposition:** rows 1–3 (`QUIZ_MIN/MAX_QUESTIONS`, `CATEGORISER_REUSE_*`, `INTERACTIVE_*_MIN_SCORE`) are all correctly injected via `${...}` per the inventory's RESOLVED notes; original FOLLOWUPS "Phase B" is no longer needed. **Phases C and D remain deferred** per the original analysis. Full reasoning in `docs/DECISIONS.md` 2026-05-03 entry. Below is the original investigation, kept for context.

---



**Surfaced:** 2026-04-30 (last). After shipping the Close-beat loosening (4 prompt edits across `content/voice-contract.md`, `agents/src/shared/voice-contract.ts`, `agents/src/drafter-prompt.ts`, `agents/src/structure-editor-prompt.ts`), the operator asked: *why is the voice contract duplicated in 4 places? What was the original reason? Is this pattern repeated elsewhere? What would a clean version look like?* This entry is the investigation. Two parallel Explore agents mapped the duplication landscape and surveyed the build-pipeline constraints that shaped the current pattern. No code change shipped from this investigation; the operator wants to read first, decide later.

**Hypothesis (now confirmed):** The voice contract is the most visible case but not the only one. Across the 16-agent codebase there are **~12–15 distinct rules duplicated across 2–4 surfaces**, with ~5 cases of *exact* text duplication and the rest paraphrased. The 2026-04-28 Manto-doctrine rollback (commit `79a914d`) is the empirical evidence of cost: a single doctrine reversal had to coordinate across 5 separate files. The duplication exists for a real technical reason (Cloudflare Workers can't `readFileSync` at runtime, so prompt content must be inlined as TypeScript string constants at bundle time), but the *manual sync* between markdown sources and TypeScript mirrors is convention, not necessity — and convention drifts.

### Scope — what's actually duplicated

#### Tier 1 — exact text, multiple agent prompts (highest drift risk)

| Rule | Surfaces | Files |
|---|---|---|
| Voice contract (full body) | 4 | `content/voice-contract.md` ↔ `agents/src/shared/voice-contract.ts`; embedded via `${VOICE_CONTRACT}` in `voice-auditor-prompt.ts`, `interactive-generator-prompt.ts`, `interactive-auditor-prompt.ts`, `drafter.ts`, `integrator.ts` (5 import sites) |
| `1000–1500 words across all beats` | 3 | `voice-contract.md:33`, `drafter-prompt.ts:17`, `structure-editor-prompt.ts:14` |
| `Target 5–6 beats; 7+ is padding zone` | 3 | `voice-contract.md:34`, `drafter-prompt.ts:18`, `structure-editor-prompt.ts:11` |
| `ONE idea per teaching beat / specific observation, not definition` | 3 | `voice-contract.md:37`, `drafter-prompt.ts:20`, `structure-editor-prompt.ts:13` |
| Hook format (`one screen, observation first`) | 3 | `voice-contract.md:36`, `drafter-prompt.ts:19`, `structure-editor-prompt.ts:12` |
| Close format (just loosened to `1–4 sentences, no summary/CTA/congrats`) | 3 | `voice-contract.md:39`, `drafter-prompt.ts:21`, `structure-editor-prompt.ts:15` |
| 6 essence-not-reference prohibitions (proper nouns / dates / quoted phrases / industry labels / "according to" / piece-specific numbers) | 2 | `interactive-generator-prompt.ts:432–448` and `interactive-auditor-prompt.ts:285–300` (exact list, two places) |
| `No JSX tags; use ## kebab-case headings` | 2 | `drafter-prompt.ts:36`, `structure-editor-prompt.ts:16` |

#### Tier 2 — paraphrased across surfaces (drift via wording, not content)

| Rule | Surfaces |
|---|---|
| Plain English split for quizzes (concept-jargon allowed in `title`/`concept` only) | 3 — `interactive-generator-prompt.ts:126`, `interactive-auditor-prompt.ts:51`, `book/09-the-sixteen-roles.md:159–175` (three different paraphrasings of the same rule) |
| 14-year-old reading test as scoring anchor | 2 — `interactive-auditor-prompt.ts:51`, `book/09-the-sixteen-roles.md:175` |
| "Manipulation embodies the mechanism" (HTML essence guidance) | 2 — `interactive-generator-prompt.ts:463`, `interactive-auditor-prompt.ts:273` |

#### Tier 3 — constants defined but not injected (silent drift class)

| Constant | Defined | Used in prompt | Drift risk |
|---|---|---|---|
| `QUIZ_MIN_QUESTIONS = 3`, `QUIZ_MAX_QUESTIONS = 5` | `interactive-generator-prompt.ts:20–21` | Hardcoded as `"3–5"` in prompt prose, NOT `${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS}` | Medium — change the constant, prompt prose stays stale |
| `CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75`, `CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60` | `categoriser-prompt.ts:4–5` | Properly injected via `${...}` | Low (this is the right pattern) |
| `INTERACTIVE_VOICE_MIN_SCORE = 85`, structure/essence/factual ≥75 | `interactive-auditor-prompt.ts:28–31` | Properly injected | Low |

#### Tier 4 — known precedent (already self-documented as fragile)

[`agents/src/shared/interactive-html-reference.ts`](agents/src/shared/interactive-html-reference.ts) is a 1:1 string mirror of `docs/examples/interactive-reference.html`. Its own header says: *"This .ts mirror exists because Cloudflare Workers can't readFileSync at runtime; the prompt module needs the content as a string at build time. … A pnpm script (`pnpm verify-reference-sync`) is queued in FOLLOWUPS to detect drift."* That FOLLOWUPS entry was never actually written — meta-evidence that the convention "edit both together; queue a verifier later" loses energy in flight.

#### The Manto rollback — empirical cost evidence

Commit `79a914d` (2026-04-28) had to coordinate across 11 files to reverse one doctrine: deleted `content/ZEEMISH_MANTO_VOICE.md`, `agents/src/shared/voice-doctrine.ts`, `agents/scripts/verify-doctrine.mjs`, `book/08.5-the-voice-doctrine.md`, `docs/VOICE.md`; modified `drafter-prompt.ts`, `voice-auditor-prompt.ts`, `integrator-prompt.ts`, `curator-prompt.ts`, `voice-contract.md`, `voice-contract.ts`. A subsequent commit `072da00` had to *re-apply* the dedup rule that the rollback had inadvertently swept up — direct evidence that surgical edits across N duplicated surfaces are error-prone. The duplication's marginal cost was paid in operator time during a stress event.

### Why the duplication exists (the real technical constraint)

- Cloudflare Workers (where the agents run as Durable Objects) **cannot `fs.readFileSync` at runtime**. Prompt content must be embedded in the TypeScript bundle at build time.
- The site (`zeemish-v2` worker) and the agents (`zeemish-agents` worker) are **separate Wrangler projects**, each with its own `package.json` + lockfile + bundle. There is no `pnpm-workspace.yaml` or workspace config — they are independent monorepo entries.
- Agents can't currently `import '../../content/voice-contract.md'` because (a) markdown isn't a default esbuild loader for TypeScript, and (b) the file is outside the agents project root.
- **Wrangler v4 (used here) does NOT support user esbuild plugin config in `wrangler.toml`**. So the "esbuild markdown loader" approach is not directly accessible without wrapping Wrangler in a custom build script.

So the constraint is real. What's *not* a constraint is the manual sync convention. Two architectural options sidestep the manual step.

### Architectural options

#### Option A — Build-time codegen (recommended)

A pre-build script reads canonical markdown sources, writes generated TypeScript constants. Agents import the generated file.

**Concrete shape:**
- New `agents/scripts/codegen-contracts.mjs` — reads `content/voice-contract.md`, `docs/examples/interactive-reference.html`, and any other named canonical source; writes `agents/src/shared/generated/contracts.ts` exporting `VOICE_CONTRACT`, `INTERACTIVE_HTML_REFERENCE`, etc. as string constants.
- Hook into `agents/package.json`: add `"build": "node scripts/codegen-contracts.mjs"`, `"prebuild": "..."` or chain into the deploy script.
- GitHub Actions `.github/workflows/deploy-agents.yml`: insert the codegen step before `wrangler deploy`. Local dev: add `"predev"` so `wrangler dev` re-codegens.
- Delete the manual mirror files (`agents/src/shared/voice-contract.ts`, `agents/src/shared/interactive-html-reference.ts`); replace imports with the generated path.
- Optional: a verifier `pnpm verify-contracts-fresh` that re-runs codegen and `git diff --exit-code` to fail CI if the committed generated file is stale.

**Cost:** ~30 minutes implementation, no runtime overhead (content baked at build time, identical to current pattern), no async refactor of prompt code, no architecture change.

**Risk:** Generated files in git. Two patterns possible: (a) check in the generated file (drift visible in diffs, CI verifies freshness — preferred for this codebase's "diff is the audit trail" culture), or (b) gitignore generated files (cleaner but loses visibility). Recommend (a).

#### Option B — esbuild markdown loader plugin (not feasible here)

Standard pattern in non-Workers TypeScript projects: register an esbuild plugin that treats `*.md` imports as `export default "<content>"`. Then `import VOICE_CONTRACT from '../../content/voice-contract.md'` Just Works.

**Blocker:** Wrangler v4 doesn't expose esbuild plugin config. Would require wrapping Wrangler in a custom build script that calls the bundler API directly — fragile, breaks with Wrangler upgrades, defeats the simplicity goal.

#### Option C — Static Assets binding (runtime fetch)

Add `[assets]` block to `agents/wrangler.toml`, copy markdown to `agents/public/`, fetch at runtime via the binding.

**Cost:** Async refactor of every prompt-build site (5+ agents become async); 1–5ms per cold-start invocation; introduces a manual sync between `content/` and `agents/public/` (defeats the whole point unless paired with codegen-to-public).

**Verdict:** worse than A on every axis except theoretical purity. Skip.

### What centralisation does NOT solve

- **Cross-prompt re-quoting of structural rules** (Tier 1 rows 2–6: word count, beat target, ONE idea, hook format, close format, no-JSX) is partly intentional. Drafter writes from the rule; StructureEditor audits against the rule. They COULD both import a single `BEAT_STRUCTURE_RULES` constant — but then the rule needs to be authored in a form that reads naturally in *both* a write-this prompt context and an audit-this prompt context. That's harder than it looks. Worth attempting for the simplest rules (word count, beat target) and skipping for the more context-dependent ones (hook/close format) until the simpler centralisation has been observed for a few weeks.
- **Paraphrased rules** (Tier 2): generator says "concept-jargon OK in title, banned in stems"; auditor says "exempt: title, concept; flag: stem, options, explanation"; book says "the precise concept name belongs in title and concept only." These three wordings are intentionally different — generator gives the writer permission, auditor gives the auditor a checklist, book gives the reader narrative. Centralising the underlying *rule* into a shared `PLAIN_ENGLISH_SPLIT_RULE` constant and having each surface inject the appropriate framing is possible but pushes complexity into the constant's authoring. Not part of v1 of this work.
- **Constants-without-injection** (Tier 3 — `QUIZ_MIN_QUESTIONS` / `QUIZ_MAX_QUESTIONS`) is independent of contracts work. One-line fix per site: change `"3–5"` in the prompt to `${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS}`. Could ship inside this work or separately.

### Risks

1. **Local dev friction.** `wrangler dev` needs the generated file to exist. Mitigate via `predev` script and a CI check that the committed generated file matches what codegen would produce.
2. **Generated-file diff noise in PRs.** Solved by the verifier-on-CI pattern; the file is regenerated, diff is reviewed alongside source.
3. **Cross-project path coupling.** Agents script will read `../content/voice-contract.md` — a path crossing the agents-project boundary. Acceptable; documented in the script's header. Doesn't require pnpm workspace setup.
4. **Migration risk.** Initial codegen run must produce text byte-identical to the current `voice-contract.ts` (and `interactive-html-reference.ts`) so no semantic drift sneaks in during the swap. Verifier diff is the gate.
5. **Rolling back this work.** If the codegen approach goes wrong, rollback is `git revert` on the codegen commit + restore the deleted manual mirror files. Rollback-safe.
6. **Doesn't reduce prompt-level re-quoting.** The 4-place voice contract becomes 1 source + N injection sites — fixes the *mirror* drift class entirely, but the auditor still embeds the contract verbatim into its prompt. That's correct; the agent needs the rule in-prompt to enforce it. The win is that all N injection sites read from the same source.
7. **Tooling sprawl.** One more script in CI. Same shape as existing `verify-*.mjs` scripts; not novel.

### Proposed sequence if greenlit

**Phase A (~1 hour):** Codegen for voice contract + html reference + (optionally) categoriser prompt's confidence constants. Migrate 2 mirror files. Add CI verifier. Single commit.

**Phase B (~30 minutes):** Fix Tier 3 constants-without-injection (`QUIZ_MIN_QUESTIONS` / `QUIZ_MAX_QUESTIONS` injected into prompt prose). Independent of A but natural sequel. Single commit.

**Phase C (~2 hours, separate plan):** Tier 1 structural-rule centralisation for the simplest cases (word count, beat target, no-JSX rule). Author each as a constant that reads naturally in both write-context and audit-context. Test by inspection of resulting prompt text. May or may not happen — depends on whether the v1 Phase A produces drift-free output for several weeks.

**Phase D (~unknown, deferred):** Tier 2 paraphrased rules — likely never. The intentionally-different framings are a feature, and centralising would make the prompts harder to read and tune.

### Why this isn't shipping right now

The user's stated cadence is "small changes, not major ones" (this session's Close-beat fix being the canonical example). Phase A is small in absolute terms (~1 hour) but architectural in shape — it changes how the agents project consumes content from outside its tree, and adds a CI step. The right call is to read this entry, decide whether to schedule Phase A (now / next session / when the next doctrine reversal forces our hand), and pick a moment where the disruption is sized appropriately.

The Manto rollback is also recent enough (2026-04-28) that the operator has fresh memory of the cost. Useful pressure for scheduling the work; also useful caution for not over-engineering the cure.

### Investigation hints (for whoever picks this up)

- Plan agents that ran this investigation: see `~/.claude/plans/now-about-the-pieces-dazzling-valiant.md` for the Close-beat work that surfaced the question, plus the inline tables above for the duplication map.
- Existing precedent for build-time content embedding: [`agents/src/shared/interactive-html-reference.ts`](../agents/src/shared/interactive-html-reference.ts) header — already self-documents the constraint AND mentions a verifier that was never written.
- Existing convention for verifier scripts: `agents/scripts/verify-*.mjs` (`verify-pair-slug`, `verify-parse-retry`, `verify-categoriser-floor`, `verify-interactive-voice`). Same shape will work for `verify-contracts-fresh`.
- GitHub Actions: `.github/workflows/deploy-agents.yml` is where the codegen step inserts.

**Priority:** medium. Not blocking; ongoing fragility cost. Drift surface grows monotonically with system size. The next doctrine evolution (whatever shape it takes) will pay this cost in operator time and rollback risk if not addressed first.

**2026-05-03:** Rule inventory completed in `docs/RULE-INVENTORY.md` — Task 01 of foundation-fix programme. Successor map; this entry stays open until Task 02 extracts the rules into contract files.

---

## [observing] 2026-04-30: FactChecker rewrite — verify next 5–10 cron pieces actually search

**Surfaced 2026-04-30** (after Close-beat). FactChecker rewritten to replace DuckDuckGo Instant Answer with Anthropic's `web_search_20250305` server tool. Triggered by the J. Craig Venter piece's drawer rendering "this appears to be speculative fiction set in 2026" on a real death the model didn't know about (cutoff). Plus Phase B drawer cutoff-confession filter (defense-in-depth) + Phase H ClaimReview JSON-LD + Phase I per-claim audit table.

**Evolution log** (consolidated 2026-05-01 night):
- 2026-04-30 (after Phase A): added Phase F+G per-claim drawer sub-section (`renderClaimSources` rendering Claude-self-reported `sources` URLs + cited_text). **Removed in Path A** below — 0% populated in production.
- 2026-05-01 morning (commit `ca36448`): tried a soft prompt nudge to coax Claude into populating per-claim `sources`. **Reverted in Path A** the same evening — the nudge wasn't fighting Claude's willingness, it was fighting the wrong design (asking for a redundant retype).
- 2026-05-01 evening (commit `270d431`): Path A — drop per-claim self-report entirely; agent harvests URLs server-side from `web_search_result_location` citation blocks; drawer Facts section ends with a single round-level "Sources consulted: domain1 · domain2 · …" line. Phase F+G per-claim sub-section deleted.
- 2026-05-01 night (commit `a270174`): Path A.1 — correct the harvest source. Citations only attach to text blocks where Claude EXPLICITLY cites; paraphrased notes get no citations. The always-populated track is `web_search_tool_result.content[]` (search hits). parseResponse extended to walk both. Lebanon-shape regression added as verifier case 9.

For full narratives see CLAUDE.md sections "FactChecker Path A.1 — correct the URL harvest source", "Path A — flat citation harvest", "Phase H + I", "Phase F + G" (superseded), "Anthropic web_search replaces DuckDuckGo". Decision logs in DECISIONS.md under matching dates.

**Current criteria — verify on the next 5–10 cron-generated pieces** (Path A.1 onward, 2026-05-01 night):

- **Every piece's fact audit has `searchUsed=true`.** News-anchored claims should trigger searches. `searchUsed=false` is acceptable only on rare evergreen pieces where every claim is verifiable from training data alone.
- **No cutoff-confession phrasing in drawer notes.** Scan rendered drawer at `/daily/<date>/<slug>/#made` for the strings *"speculative fiction"*, *"knowledge cutoff"*, *"as of my"*, *"is set in 2026"*, *"is hypothetical"*, *"this is beyond"*. The hardened prompt forbids them; Phase B drawer filter is defense-in-depth.
- **No `Anthropic web_search tool unavailable` observer warns** unless Anthropic's API actually fails (≤1/week tolerable; >5% of calls = real problem).
- **Drawer reads naturally** — notes are short, name what was searched and what was found, or honestly say *"couldn't verify against current sources."*
- **Drawer Facts section ends with a "Sources consulted: domain1 · domain2 · …" line** with ≥2 distinct domains on every news-driven piece. Visible reader surface, capped at 5 unique domains by hostname dedup.
- **D1 sanity:** `SELECT json_extract(notes, '$.sources') FROM audit_results WHERE piece_id = '<NEW>' AND auditor = 'fact'` returns a non-empty JSON array of URLs.
- **Page header chrome unchanged** — only the existing date / time / subject / Source: NYT ↗ meta line. No aggregate Sources line at the top of the piece.
- **JSON-LD ClaimReview** count per piece equals the number of verified-status claims (Phase H, unchanged). View source for `<script type="application/ld+json">` blocks containing `"ClaimReview"`. Validate against Google Rich Results Test + schema.org validator. Google rich results unlikely (IFCN policy); the win is machine-readable provenance.
- **Cost** after 7 days: Anthropic dashboard's `usage.server_tool_use.web_search_requests` should land in 30–60/day range. Flag if >100/day.
- **Notes JSON shape** — Path A and later rows persist the full `FactCheckResult` object `{passed, claims, searchUsed, searchAvailable, sources}`. Pre-Path-A rows store the bare claims array. API endpoint's `parseFact` handles both; future admin tooling reading `audit_results.notes` should too.
- **Phase F+G per-claim drawer sub-section** confirmed deleted (no `.made-claim-sources` nodes anywhere).
- **Phase I `daily_audit_claims` table** continues populating its core columns (claim_text, status, note, round, piece_id) for any future "claims explorer" admin work. `sources_json` + `search_query` columns now write NULL on every row by design (Path A.1 deprecation).

**Escalation paths.**

- **Cutoff-confession phrasing leaks despite the prompt:** drawer filter at [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts) `sanitizeFactNote` is the second line of defense; if even that misses, tighten the prompt with worked before/after examples.
- **Anthropic web_search returns errors >5% of calls:** check Console privacy toggle (web search disabled org-wide?). If enabled and still failing, fall back to Brave Search API (`webSearch` private method comes back, signature unchanged from the pre-2026-04-30 DDG path).
- **Cost runs >$30/month:** drop `max_uses` from 8 to 4 (covers 3 claims with 1 retry; rare news pieces with 7+ fact-dense claims may suffer). Or system-prompt hint: *"Cap yourself at 5 searches per piece — choose the most fact-dense claims."*
- **`searchUsed=false` on news-driven pieces:** prompt's search-first rule isn't biting. Inspect notes; if Claude is rationalising *"general knowledge"*, tighten the *"general well-known science vs current event with specific name/date/number"* distinction.
- **Sources line empty despite `searchUsed=true`:** parseResponse harvest is broken. Inspect `result.sources` in `audit_results.notes` JSON directly. Path A.1 walks both `web_search_tool_result.content[]` and `text.citations[]`; if both are empty in the response itself, web_search returned nothing useful — rare and acceptable.
- **Sources line shows aggregator domains alongside primary sources** (visible product trade-off observed on the 2026-05-01 genetic-code piece — `nsaneforums.com` landed alongside nature.com / science.org / pubmed). Two refinements parked: domain-quality ranking (push primary publications first), citation-bearing track preference (when present, prefer citation URLs over uncited search hits). Neither blocking; ship if/when the noise becomes visibly distracting.

**Unblock:** after 5–10 cron-generated pieces have shipped post-fix (≈2026-05-05 to 2026-05-10 at `interval_hours=12`). Mark `[resolved]` if the criteria hold; escalate per above otherwise.

**Priority:** medium. Not blocking — fact-checker degraded behaviour ships pieces (with verbose-but-wrong notes) rather than blocking them, so a regression here is embarrassing rather than catastrophic.

---

## [observing] 2026-04-30: Close-beat loosening — verify next 5 cron-generated pieces breathe

**Surfaced:** 2026-04-30 (last). Constraint loosened from "ONE sentence" to "one to four sentences" across 4 surfaces (voice contract .md + .ts, Drafter prompt, StructureEditor CHECK #5). See DECISIONS 2026-04-30 (last) "Loosened Close beat from 'ONE sentence' to 'one to four sentences'" and CLAUDE.md "Close-beat loosened from one sentence to one-to-four (2026-04-30, last)".

**What we want to see in the next 5 cron-generated daily pieces** (≈2026-05-01 02:00 UTC onward):

- At least 2 of 5 ship with Closes longer than 1 sentence (the rule allows it; pre-fix audit data suggests Drafter naturally reaches for 2–3 sentences when not constrained).
- Voice scores stay in the 85–95 band (loosening should not lower scores; Voice Auditor unchanged).
- No Closes that summarise the piece, call to action, or congratulate the reader (the negative guards stay strict in all 4 surfaces).
- No StructureEditor failures specifically citing "Close has more than one sentence" (CHECK #5 updated to allow 1–4).
- Subjectively: the strongest landings should echo the news hook, apply the teaching to the reader's world, or both — the empirical pattern from the pre-fix audit (Hormuz, Palestinian elections, Tampa, sperm-detection, NOLA-sheriff).

**Escalation paths.**

- **If loosening doesn't bite (5/5 next pieces still ship 1-sentence taglines):** add a worked before/after example pair to the Drafter prompt at [agents/src/drafter-prompt.ts:21](../agents/src/drafter-prompt.ts:21), mirroring the interactive Plain English prompt edit shape (2026-04-29 commit `573fdd6`). Pre-fix audit has 7 mechanical Closes ready to use as "before" examples; pair them with the 5 strongest landings as "after" examples.
- **If loosening bites too hard (Closes start summarising or rambling past 4 sentences):** tighten StructureEditor CHECK #5 back toward "one to three sentences" and add an explicit summary-detection cue (e.g., "fail if the close opens with 'In summary' / 'To recap' / 'The key takeaway' or restates more than one teaching beat").
- **If voice scores drop (sub-85 on flagged pieces with longer Closes):** investigate whether Voice Auditor needs an ending-shape rule. Today it doesn't audit endings; this would be the natural next surface to look at.

**Unblock:** after 5 cron-generated pieces have shipped post-fix (≈2026-05-03 02:00 UTC at `interval_hours=12`). Mark `[resolved]` if the criteria hold; escalate per above otherwise.

**Priority:** medium.

---

## [resolved] 2026-04-30: Divergent quiz + html slugs for one piece (sperm-cell, two URLs)

**Surfaced:** 2026-04-30 PM. Operator noticed the 2026-04-30 sperm-cell piece had its quiz at `/interactives/detection-floors-and-invisible-presence/` and its html at `/interactives/detection-floor-as-resource-choice/` — two URLs each rendering only half the bundle. Every prior dual-artefact piece shares one slug between quiz + html. Manual quiz retry after auto-cron parse-fails landed at a different Claude-proposed slug than the html that had already shipped.

**Hypothesis confirmed:** asymmetric slug-inheritance. `runHtmlLoop` queries D1 for an existing quiz row and inherits its slug; `runQuizLoop` had no symmetric lookup. Latent until the morning's `c687601` decoupling fix (quiz failure no longer aborts html), which made it possible for html to ship first and quiz to retry later. Schema (migration 0026's `UNIQUE(slug, type)`) had already been made permissive; only the writer-side inheritance was missing.

**Resolution:** Fix shipped 2026-04-30 PM (this session). Extracted `resolvePairSlug(pieceId, type, claudeProposed)` private helper in [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts) (~line 1487). Both `runQuizLoop` (line 706) and `runHtmlLoop` (block at lines 1083-1092) now call it. Whichever artefact ships SECOND inherits the FIRST's slug regardless of order. New verifier `pnpm verify-pair-slug` (5 cases). Backfilled the sperm piece by renaming `detection-floor-as-resource-choice-html.json` → `detection-floors-and-invisible-presence-html.json` + slug field edit + queued D1 surgery (`UPDATE interactives SET slug = 'detection-floors-and-invisible-presence' WHERE id = '9f53032c-1d1a-46dd-973b-658cd3acfa67' AND type = 'html';`). See DECISIONS 2026-04-30 (PM, late) "Symmetric slug-pairing for quiz + html" and CLAUDE.md "Pair-slug bug fix (2026-04-30 PM)" for the full narrative.

**Resolved:** code edit + backfill in this session.

---

## [observing] 2026-04-30: Pair-slug ordering — verify next 5 cron-or-manual interactive pairs land at one URL

**Surfaced:** 2026-04-30 PM, same session as the resolved entry above. The fix is symmetric — verify it bites both directions.

**Watch for** over the next 5 dual-artefact pairs (cron + any manual retries):
- Every piece's quiz file (`<slug>.json`) and html file (`<slug>-html.json`) share the same base slug.
- Both render at one `/interactives/<slug>/` URL with quiz card + HTML iframe inline.
- Order independence: at least one of the next 5 pairs should ship html-before-quiz (since quiz parse-fails are still possible until Layer 1 + Layer 2 catch every flake), exercising the new direction.

**Unblock condition:** all 5 pairs land at one URL. Mark `[resolved]` with cron-firing SHAs.

**Escalation path:** if a piece still ships at two URLs:
- (a) Check git log for the order of the two interactive commits — if the second one came AFTER the first by a meaningful gap (>1 min) and slugs still diverged, `resolvePairSlug` isn't being called; verify the call sites at line 706 + 1083 weren't reverted by a refactor.
- (b) If both committed within seconds of each other (auto-cron path), check whether the html commit's D1 INSERT was visible to the quiz commit's SELECT — Cloudflare D1 is eventually consistent across DO replicas; if the quiz path runs in a fresh DO instance that hasn't seen the html INSERT, the SELECT returns null and the slug falls back to `resolveFreeSlug`. In that case, sequence the two loops in `generate()` to await the first commit before the second runs (already the case in the in-DO sequential `runQuizLoop` → `runHtmlLoop` flow; would only fail if the two loops were ever moved to parallel). Read the call site in `agents/src/interactive-generator.ts:generate` to confirm sequential.

**Priority:** medium — observation gates confidence; doesn't block other work.

---

## [observing] 2026-04-30: SEO snippet flip — confirm homepage SERP description switches off footer text

**Surfaced:** 2026-04-30 evening, when an operator's Google search for "zeemish" surfaced the homepage with the SERP snippet *"Educate yourself for humble decisions. Made by 16 agents. © 2026 Daylila."* — the footer text, not a meaningful description. Fix shipped: homepage description differentiated to ~142 chars naming the news anchor and system-thinking framing; `<footer>` marked `data-nosnippet`; BreadcrumbList JSON-LD on daily pieces; LearningResource JSON-LD on interactives; og:image dimensions + alt; library index description dynamic by top-4 categories. See DECISIONS 2026-04-30 (evening) "SEO snippet fix + structured-data expansion" and CLAUDE.md section of the same name.

**Watch for** over the next 1–2 weeks:
- Google Search Console homepage snippet renders the new meta description (`"Daily teaching anchored in today's news, written and audited by 16 autonomous agents…"`) instead of footer text. Crawl frequency on a domain with daily fresh content is typically 1–3 days; longer if Google deprioritises the homepage in favour of fresh daily pieces.
- Daily-piece SERP results may render Home › Daily › Title breadcrumb above the snippet (Google chooses whether to display BreadcrumbList; presence in the schema is necessary but not sufficient).
- Interactive pages remain indexed; the LearningResource schema doesn't unlock a specific rich-result type but does help with educational-content search differentiation.
- Run Google Rich Results Test (https://search.google.com/test/rich-results) on a live daily piece + a live interactive 24-48 hours post-deploy. Expect Article + BreadcrumbList valid on the daily-piece URL; LearningResource valid on the interactive URL. Schema.org validator (https://validator.schema.org/) — expect 0 errors on both.
- Search Console Coverage report — no new "Crawled — currently not indexed" or "Discovered — currently not indexed" entries from the schema additions.

**Unblock condition:** Homepage SERP snippet for "zeemish" no longer reads the footer text (any of: new meta description used, breadcrumb displayed, or just visibly different from `"Educate yourself for humble decisions. ... © 2026 Daylila."`). Mark `[resolved]` once observed.

**Escalation path:** if 2 weeks pass and the snippet still falls back to footer-shape text:
- (a) The `data-nosnippet` attribute may not be propagating through Cloudflare Workers Static Assets — verify with `curl -s https://daylila.com/ | grep -o 'data-nosnippet'`. If absent, Cloudflare CDN is serving cached HTML; manual cache purge needed (per CLAUDE.md "Remaining minor items").
- (b) Description still considered too generic — extend with 1-2 concrete teaching examples (e.g. *"Stories like commodity shocks, infrastructure debt, and chokepoints — explained as systems, not events."*).
- (c) Add `<meta name="googlebot" content="max-snippet:160">` as a directive override (per Google's snippet-control docs).

**Priority:** medium. Cosmetic for the SERP layer; doesn't affect any reader behaviour. Sitemap is already submitted (per [resolved] entry below) so crawls are happening; this is just a snippet-quality improvement.

---

## [observing] 2026-04-29: Plain English layer for interactives — verify register over next 5 cron-generated quizzes

**Surfaced:** 2026-04-29 same session as the fix shipped. Plan `~/.claude/plans/for-the-interactives-specially-enchanted-crab.md`. Quizzes were passing voice 88/100 with stems like *"Why does asymmetry in outside options destabilize coordination agreements even when mutual restraint would benefit all participants?"* Fix shipped: quiz generator now embeds `VOICE_CONTRACT` (parity with HTML generator) + new "Plain English for quizzes — split rule" subsection with concept-jargon translation list, 14-year-old test, and worked before/after pair. Quiz auditor's plain-English line strengthened with the same checklist + scoring anchor. HTML generator + auditor get mirror Plain-English bullets for caption text / status messages / tooltips. Verifier `pnpm verify-interactive-voice` (10 cases) passes.

**Watch for** over the next 5 cron-generated quizzes (≈2026-05-01 14:00 UTC):
- Every quiz's `title` + `concept` line uses precise concept words — they're correct register there.
- Every question stem uses everyday words — a curious 14-year-old reads cleanly first time.
- Concept-jargon (asymmetry, coordination, mitigation, throughput, allocation, displacement, propagation, restraint, structural, mechanism, aggregate, threshold, trade-off) absent from stems / options / explanations unless quoted as a definition (which the prompt also discourages).
- Explanations declarative — no *"could be argued / might potentially / arguably / it is suggested that / it could be that"*.
- Voice score in `interactives.voice_score` stays ≥85. If a quiz drops below 85 on the new rules, that's the auditor catching the new register correctly during the produce→audit→revise loop — expected outcome, not a regression.

**Unblock condition:** ≥4 of 5 quizzes cleanly readable on first read by a non-specialist, zero hedge phrases in explanations, zero concept-jargon in stems. Mark `[resolved]` with cron-firing SHAs and a one-line commentary on register.

**Escalation path:** if next 5 quizzes still use academic vocabulary in stems (the prompt change isn't biting), pick one of:
- (a) Tighten the flag-list with more concept words observed in production cron output (the JS verifier's `JARGON_FLAG_LIST` and the prompt's translation list both grow together — keep them in sync by hand).
- (b) Add a runtime pre-Claude shim using the verifier's `checkSimpleEnglish` heuristic — reject jargon-heavy first attempts before the auditor burns tokens. Wires into `agents/src/interactive-generator.ts` `runQuizLoop` between produce and audit, raises a synthetic `auditor failed: jargon` so the existing revise-loop machinery handles it without a separate code path.

If neither bites within ~10 cron quizzes total, revisit whether the change should escalate to a voice-contract tightening (would cascade to Drafter / Voice Auditor / Integrator on daily pieces — bigger blast radius, deliberately deferred at the 2026-04-29 fix).

**2026-04-30 cycle-1 update (essence false-positive watch folded into this entry).** Operator triaged 4 `WARN` "Interactive(s) shipped (flagged low)" events from 2026-04-29 in the live admin feed. Plan `~/.claude/plans/are-these-normal-investigate-lexical-hennessy.md`. Findings:

- 2 of 3 verifiable HTML interactives (`gradient-climbing-navigation` smell-maps `7857a1b`, `embedded-continuation` capitalism `35ae1c5` + `8516546`) are **clean abstract teachings — zero leaks** of names/dates/quotes/industry labels. Both flagged-low on essence; auditor caught only concept-match + thematic echo despite the loosened rule explicitly excluding both. **Cycle 2 of the essence false-positive watch confirmed** (predicted by CLAUDE.md 2026-04-24 entry: *"1–2 fresh cycles will tell us whether to ship a second tuning pass"*).
- Hippos HTML (`waste-driven-ecosystem-reorganization` `309a3f7`, voice 72) is **post-fix, system working as designed**. Plain English fix `573fdd6` deployed 22:05 UTC; HTML committed 22:45 UTC. Auditor correctly caught real Plain-English misses on `structural` (Q5 stem: *"structurally difficult beyond the logistics"*) and `mechanisms` (Q4 explanation: *"the existing cleanup mechanisms cannot match"*) — both on the new explicit translation list. 2 revisions plateaued at 72 on complex-domain (ecosystem/nutrient biology) prose; shipped `qualityFlag='low'` per Area 4 design.

**Extended unblock condition:** the original 5-cron Plain-English watch holds (≥4/5 cleanly readable, zero hedge phrases, zero concept-jargon in stems). Additionally, watch the **essence false-positive rate** over the same 5-firing window — if ≥3 of 5 ship flagged-low for essence with no concrete leak (verified by reading the JSON content), that's the auditor's loosened rule still over-strict and the recommended next step is **Move A from the 2026-04-30 plan**: surgical prompt-only edit at [agents/src/interactive-auditor-prompt.ts](agents/src/interactive-auditor-prompt.ts) `INTERACTIVE_HTML_AUDITOR_PROMPT` essence section — re-emphasise the "Do NOT fail for" list with a worked PASS example using one of today's verified false-positive HTMLs (`gradient-climbing-navigation` or `embedded-continuation`). If essence false-positive rate is ≤2 of 5, the loosened rule is good enough; mark this entire entry resolved.

**Risk on Move A:** over-correcting and missing real leaks. Mitigation: keep the 6 "Fail if" concrete rules verbatim; only tighten the "Do NOT fail for" guidance with the worked PASS example.

---

## [observing] 2026-04-29: Categoriser zero-floor + retry + fallback — verify shape over next 5 cron firings

**Surfaced:** 2026-04-29 same session as the fix shipped. Plan `~/.claude/plans/majestic-mixing-meerkat.md`. The 2026-04-28 golden-orb piece was assigned 0 categories due to layered prompt/code/filter gaps — fix shipped in this session as a strengthened prompt (tiered ≥75 / 60 / novel decision), a sub-60 confidence filter, a single retry on empty/all-sub-floor, and a reserved "Patterns Yet to Cluster" fallback category (migration 0027).

**Watch for** over the next 5 cron firings (≈2026-05-01 14:00 UTC):
- Every piece must end with `assignments_written ≥ 1` (no piece can land in `daily_pieces` with zero `piece_categories` rows).
- Zero `Categoriser fallback fired` warn observer events. The retry layer should catch nearly every case; if the fallback fires, the prompt or taxonomy needs another tuning pass.
- Zero rows in `piece_categories` with `confidence < 60` (sub-floor filter must hold).
- Median assignments-per-piece stays in the 1–2 band.
- Novel-category creation rate ≤ 2 per 5 pieces. If higher, the stretch-reuse path may be too restrictive — consider relaxing the prompt's "if you're on the fence, stretch-reuse" wording.

**Unblock condition:** all 5 pieces hit ≥1 assignment, zero fallback events, zero sub-60 rows. Mark `[resolved]` with cron-firing SHAs.

**Escalation path:** if any cron fires `Categoriser fallback fired`, pull the piece's full underlying_subject + body excerpt + observer event chain from D1; investigate whether (a) the prompt can be tuned to recognise the cluster, or (b) the taxonomy genuinely needs a new permanent category seeded.

**Priority:** medium — observation gates confidence in the fix; doesn't block other work.

---

## [observing] 2026-04-29: Resource Constraints ↔ Infrastructure Debt and Chokepoints ↔ Commodity Shocks overlap pairs

**Surfaced:** 2026-04-29 taxonomy audit during the golden-orb fix. Two category pairs co-fire frequently and look conceptually adjacent:
- Resource Constraints & Trade-offs (3 pieces) ↔ Infrastructure & Technical Debt (3 pieces) — co-fired on the Maine data center piece (90% / 75%).
- Chokepoints & Supply (4 pieces) ↔ Commodity Shocks (3 pieces) — co-fired on Hormuz, Airline fuel, U.S. Mint cartel-gold (3×).

Both pairs feel like legitimately distinct mechanisms (resource constraints = hard limits; infrastructure debt = falling-behind costs; chokepoints = geographic bottleneck; commodity shocks = price volatility), but with 22 pieces total it's too early to call. Aggressive merging now risks losing useful distinctions; if the pairs continue to always co-fire and never differentiate, that's a merge signal.

**Unblock condition:** revisit when each category in either pair has ≥5 pieces. By then either: (a) they routinely fire alone (independent, keep), (b) they always co-fire with no daylight (merge candidate), or (c) operator-clear distinct semantics emerge in piece-bodies (clarify descriptions instead of merging).

**Priority:** low — taxonomy hygiene, not correctness.

---

## [open] 2026-04-27: reset-today.sh --piece-id misses interactives + interactive_audit_results + content/interactives/<slug>.json

**Surfaced:** 2026-04-27 architectural-fix session. After deleting two wrangles pieces via `scripts/reset-today.sh --piece-id`, manual cleanup found orphans the script didn't touch:
- 2 `interactives` rows (one quiz, one html, both pointing at the deleted piece's source_piece_id)
- 24 `interactive_audit_results` rows (3 rounds × 4 dimensions × 2 interactive types)
- 5 `interactive_engagement` rows
- 2 `content/interactives/<slug>.json` files in git (`inversion-of-suspicion.json` + `inversion-of-suspicion-html.json`)

Plus 1 separate orphan in `engagement` — a fresh INSERT landed against the deleted piece_id during the brief window after delete (CDN-cached page hit by a reader, fired engagement track). The reset script DID delete `engagement` at delete time, but didn't re-clean afterward. This second case is racier and harder to fix in the script; the admin-UI INNER JOIN fix shipped 2026-04-27 architectural-fix session hides them from the operator's view (which is the right level — orphan rows themselves are harmless data, just shouldn't render).

**Hypothesis:** The reset script was written (2026-04-22 in commit `3208c86`) before the interactives content type existed (Area 4 sub-task 4.1 shipped 2026-04-24, migration 0022). Three new tables + a new content folder appeared after the script was written; nobody extended the DELETE list.

**Investigation hints:**
- Extend the `[3/4] Clearing D1 rows scoped by piece_id + time window...` block in [`scripts/reset-today.sh:170-180`](../scripts/reset-today.sh) to add:
  ```
  DELETE FROM interactive_audit_results WHERE interactive_id IN (SELECT id FROM interactives WHERE source_piece_id = '$PIECE_ID');
  DELETE FROM interactive_engagement WHERE interactive_id IN (SELECT id FROM interactives WHERE source_piece_id = '$PIECE_ID');
  DELETE FROM interactives WHERE source_piece_id = '$PIECE_ID';
  ```
  Order matters — child tables first (audit + engagement reference interactives.id), then parent.
- Extend the `[2/4] Removing matching MDX file from git...` block to also `git rm` interactive JSON files. Lookup pattern: scan `content/interactives/*.json`, parse each, match on `source_piece_id == $PIECE_ID`. Slug-suffix variants (`-html`) are bundled by piece_id in `groupBySlug`; both files for a given source_piece_id should be removed.
- Manual fallback used today: `npx wrangler d1 execute zeemish --remote --command="DELETE FROM interactive_audit_results WHERE interactive_id IN (...); DELETE FROM interactive_engagement WHERE interactive_id IN (...); DELETE FROM interactives WHERE id IN (...);"` then `git rm` the JSONs.

**Priority:** low — manual cleanup works, and operator resets are infrequent (this was the third today only because of voice-doctrine iteration). But every operator reset is now an opportunity for orphan accumulation, and we just landed an admin-UI fix that papers over the symptom — the script's the right layer for the durable fix.

---

## [observing] 2026-04-27 (architectural fix): Curator dedup filter — recurrence watch

**Surfaced:** 2026-04-27 evening, after the prompt fix at `11c2450` failed within minutes of deploy. Curator picked the same SCOTUS / cell-location story for the **fourth time** in one day, with diverse 50-candidate set + new prompt's worked example using the literal same scenario as a SKIP example. Hard pre-Curator headline-overlap filter shipped this commit at [`agents/src/shared/dedup-headlines.ts`](../agents/src/shared/dedup-headlines.ts) + wired into [`agents/src/director.ts`](../agents/src/director.ts) `triggerDailyPiece` between `getRecentDailyPieces` and `curator.curate`. See DECISIONS 2026-04-27 (architectural fix) for the full diagnosis + four rejected alternatives.

**What to verify:**
1. Over the next 7 cron firings + any operator-triggered runs (~through 2026-05-04 at `interval_hours=24`; sooner if operator runs voice tests), watch the admin observer feed for `Candidates filtered: N of 50 (headline overlap with recent pieces)` events. Expected: low filter rate (0–5 of 50) most days, occasional 10+ when news is dominated by a story Daylila has already covered.
2. Same-day twin-piece check: any date with 2+ pieces — diff their headlines + check if the news events match. Specifically: if a SCOTUS case, lawsuit, investigation, legislation, or corporate scandal appears in two pieces' headlines on the same date, the filter did not hold (unlikely with shared-token threshold ≥4) OR the second piece's headline diverged enough to slip past (the next escalation lever).
3. Filter-rate sanity: if filter removes all 50 candidates on a day with the defensive fallback firing, the threshold may be too low. Watch for the warn event `Headline-overlap dedup would have removed all 50 candidates`. Should be near-impossible at 30-day recent-pieces window.

**Unblock conditions** (any one of):
- 7 cron runs + manual triggers pass with no twin pieces → mark `[resolved]`. The hard filter held.
- A fifth twin-pieces incident → mark `[open]`, escalate. Tuning levers in priority order: (a) check the tokenizer — did the new candidate's headline use synonyms that didn't share substantive tokens? Add canonicalisation; (b) lower `DEDUP_MIN_SHARED_TOKENS` from 4 to 3 (more aggressive) and re-run the verify harness to check false-positive rate; (c) consider pre-Scanner LLM-based clustering (the option this fix deliberately did not take — adds another LLM call but catches paraphrased headlines).
- Filter rate >50% of candidates on a typical news day (no major event dominating) → tune by raising `DEDUP_MIN_SHARED_TOKENS` to 5, re-run verify harness, redeploy.

**Investigation hints:**
- Production query: `SELECT created_at, title, body FROM observer_events WHERE title LIKE 'Candidates filtered:%' ORDER BY created_at DESC LIMIT 20;` — see filter rate + which candidates got filtered.
- `SELECT date, headline, underlying_subject, voice_score FROM daily_pieces WHERE published_at >= 1777327330000 ORDER BY published_at;` — check for any twin-pieces post-fix (1777327330000 ≈ deploy time of architectural fix).
- Defensive-fallback signal: `SELECT * FROM observer_events WHERE title LIKE 'Error: dedup-filter%' ORDER BY created_at DESC;` — should return zero rows in normal operation.

**Priority:** medium — observation only, not blocking, but failure mode is reader-visible (twin pieces on the live site = embarrassing + operator-rescue work + wasted Anthropic + ElevenLabs spend per duplicate). The 2026-04-27 evening incident burned ~$3-5 in API + audio + interactives generation across the four retries; this is real money even at small scale. If the unblock signal hits, escalate same-day.

---

## [resolved] 2026-04-27 (evening, later): Curator SAME-EVENT/SAME-CONCEPT rule recurrence watch

**Surfaced:** 2026-04-27 evening. Operator-triggered manual pipeline runs at 15:01 UTC + 20:40 UTC (in addition to the 02:01 UTC autonomous slot) both landed on the same SCOTUS / cell-location-data news event. Curator picked "Supreme Court Reviews Police Use of Cell Location Data" (subject: how proximity data becomes evidence and why the boundary between finding and tracking matters) and then later "Supreme Court Wrangles With Geofence Warrants" (subject: what geofence warrants actually are and how proximity data becomes criminal evidence) — same SCOTUS case, same underlying concept. Wrangles piece deleted via `scripts/reset-today.sh --piece-id 9ee14d8e-…` (commit `72f312d`).

Recurrence of the 2026-04-24 twin-pieces failure pattern. The 2026-04-24 fix added `underlying_subject` to the recent-pieces context Curator sees and named "Two pieces teaching the same concept on the same day is a failure state" but used soft "PREFER a different candidate — unless the news is genuinely developing" wording. Today Claude rationalized through the soft language when the concrete framings diverged ("proximity data" vs. "geofence warrants").

**Fix shipped:** prompt-strength change at [agents/src/curator-prompt.ts](../agents/src/curator-prompt.ts). De-dup section split into TWO named MUST-skip failure modes — SAME NEWS EVENT (same SCOTUS case, lawsuit, investigation, bill, scandal, person's death, disaster — even at different procedural moments or wire angles) and SAME UNDERLYING CONCEPT (same chokepoint, incentive trap, bias, regulatory mechanic). "PREFER" replaced with "MUST pick a different candidate". Three worked examples including a literal walkthrough of today's exact failure. See DECISIONS 2026-04-27 (evening, later) "Curator duplicate-pick — SAME-EVENT / SAME-CONCEPT rule" for full trade-offs.

**What to verify:**
1. Over the next 7 cron firings + any operator-triggered runs (~through 2026-05-04 at `interval_hours=24`; sooner if operator runs voice tests), watch `daily_pieces.underlying_subject` and `daily_candidates` for the picked candidate. Cross-reference against the 7-day window `getRecentDailyPieces` exposes.
2. Watch the admin observer feed for Curator decline events. If decline rate jumps (e.g., to >20% of triggered runs), the new rule may be over-rejecting — verify the declines name a specific recent piece they're avoiding (legitimate skip) vs. dismissing categories generically (over-rejection).
3. Same-day twin-piece check: any date with 2+ pieces — diff their `underlying_subject` strings + check if the news events match. Specifically: if a SCOTUS case, a lawsuit, an investigation, a piece of legislation, or a corporate scandal appears in two pieces' subjects on the same date, the fix did not hold.

**Unblock conditions** (any one of):
- 7 cron runs + manual triggers pass with no SAME-EVENT or SAME-CONCEPT pair landed → mark `[resolved]`. The worked-examples + MUST-skip wording held.
- A third twin-pieces incident → mark `[open]`, escalate. Tuning levers in priority order: (a) add a procedural pre-check to the prompt — "before picking, ask: is this the same news event as any of the recent pieces? If yes, skip regardless of angle" — placing it as the first instruction Claude reads after the candidate list; (b) add more worked examples drawn from the actual recurrence; (c) consider the JOIN to `daily_candidates` for picked-candidate news source + summary (the option this fix deliberately did not take).
- Decline rate jumps >20% with declines that misfire (skip a teachable candidate by misidentifying it as a duplicate) → tune by softening the SAME-CONCEPT example threshold or by clarifying the "narrow exception" wording around substantively new concepts.

**Investigation hints:**
- Production query: `SELECT date, headline, underlying_subject, voice_score FROM daily_pieces WHERE published_at >= <fix_commit_ts> ORDER BY published_at;` — eyeball for same-event or same-concept pairs.
- `SELECT created_at, title, body FROM observer_events WHERE title LIKE '%Curator declined%' OR title LIKE '%Curator skipped%' ORDER BY created_at DESC LIMIT 20;` — watch the decline reasons; they should name the specific recent piece being avoided.
- Cross-check with the existing `[observing] 2026-04-26: Curator taxonomy expansion to 14 examples` watch entry — that one tracks novel framings; this one tracks duplicate suppression. They share an observation window and a shared signal (Curator output diversity).

**Priority:** medium — observation only, not blocking, but the failure mode is reader-visible (twin pieces on the live site = embarrassing and operator-rescue work). If the unblock signal hits, escalate.

**Resolved:** 2026-04-27 (architectural fix, same evening). The prompt fix this entry watches FAILED at the first test — Curator picked the same SCOTUS story for the fourth time within minutes of the fix deploying, with diverse 50-candidate set + new prompt's worked example using the literal same scenario as a SKIP example. The diagnosis was that the prompt approach is structurally wrong (model rewarded for picking, not skipping; rationalizes through soft language; even worked examples are read as "specific situations, not patterns"), not under-tightened. The replacement is a hard server-side dedup filter at `agents/src/shared/dedup-headlines.ts` that removes near-duplicate candidates BEFORE Curator sees them — Curator literally cannot pick what's not in its input. The prompt fix from `11c2450` stays as defense-in-depth for same-CONCEPT different-event cases that share zero substantive headline tokens. Tracked under the new `[observing] 2026-04-27 (architectural fix)` entry above. See DECISIONS 2026-04-27 (architectural fix) "Curator duplicate-pick — hard pre-Curator headline-overlap filter" for full diagnosis + four rejected alternatives.

---

## [resolved] 2026-04-27: HTML interactive parseAndValidateHtml flake — recurrence watch

**Surfaced:** 2026-04-27 02:06 UTC — Ben Sasse piece's HTML interactive failed at `parseAndValidateHtml: Claude returned non-JSON output` (Claude ignored the JSON output format and emitted prose or code-fenced response the parser couldn't recover). One-time model flake on round 1; piece kept its quiz, missed its HTML companion. Operator triggered Generate HTML via the new admin UI button after `6b6ed8a` deployed; the retry succeeded on the very next round, shipping "Visibility and Attention Debt" at `c466f4f` with `qualityFlag='low'`.

**Recurrence:** 2026-04-30 02:04 UTC — Voting Rights Act piece's quiz interactive failed at the same shape, `parseAndValidate: Claude returned non-JSON output` (quiz path this time, not HTML). Two flakes inside 3 days triggered the unblock condition this entry already named: "If recurrence ≥1 within 7 days, escalate to `[open]` and harden the loop."

**First fix attempt (2026-04-30 morning, partial):** Two-layer hardening to [agents/src/interactive-generator.ts](../agents/src/interactive-generator.ts). Layer 1 wraps the produce/revise calls in try/catch and counts parse-fails as failed rounds within the 3-round budget. Layer 2 prepends `{ role: 'assistant', content: '{' }` to all 4 Claude calls. Both layers are correct in design — but the operator's regenerate revealed they didn't address the actual production failure mode.

**Root cause (2026-04-30 PM):** The manual retry path at `/interactive-generate-trigger` ran `ctx.waitUntil(director.generateInteractiveScheduled(...))` from the HTTP handler — bounded by the worker's HTTP request lifetime / subrequest budget. Auto-cron and destructive-regenerate paths use `this.schedule(1, 'generateInteractiveScheduled', ...)` which fires as an alarm with the full 15-minute budget. A 3-round quiz auditor max-fail loop is ~120 seconds; HTML adds another ~90+; together they exceed the subrequest budget. Production failure mode: worker terminates mid-flight, partial Claude responses get truncated by the cut transport, Layer 1 honestly counts those as parse-fails (the SDK delivers truncated content as plain text). HTML path then never runs because the alarm has already terminated. Empirical proof: 3 successive Claude calls against the actual Voting Rights piece prompt all returned valid JSON in a local terminal (no CF budget); cross-piece D1 audit showed every auto-cron-published piece since 2026-04-26 has both quiz + html, only the manually-retried piece was missing html.

**Final fix (2026-04-30 PM):** Two structural changes in addition to the morning's Layer 1 + Layer 2:

- **Manual retry routes through alarm path.** New thin `Director.requestInteractiveGenerate(payload)` method that calls `this.schedule(1, 'generateInteractiveScheduled', payload)` and returns. Server endpoint awaits this and returns 202 `'scheduled'`. The work fires in a fresh alarm with full 15-min budget — same shape as auto-cron and destructive regenerate.
- **Quiz/html decoupled in `generate()`.** Each loop wrapped in try/catch with new `errorMessage: string | null` field on both result types. A quiz throw no longer aborts the HTML path. Director's metered handler emits per-artefact failure events when `errorMessage` is populated, with `(quiz)` / `(html)` suffixes so operators see exactly which path failed.

**What stayed unchanged:** `extractJson`'s 3-pass fallback chain (markdown-fence strip → whole-text parse → first-`{`-to-last-`}` extraction); the prompt's existing "No prose outside the object. No markdown fences." directives; the 3-round budget shape; the existing terminal states (declined / committed / committed-low / 3-round exhaustion → operator retry).

**Verification:**
- Synthetic test [agents/scripts/verify-parse-retry.mjs](../agents/scripts/verify-parse-retry.mjs) — 4 cases (round 1 parse-fail → round 2 success, rounds 1+2 parse-fail → round 3 success, all 3 parse-fail → terminal throw, no parse-fails → committed). All pass. Runs as `pnpm verify-parse-retry` from `agents/`.
- Agents-side typecheck — 27 pre-existing `server.ts` SubAgent errors unchanged; touched files (`interactive-generator.ts`, `observer.ts`, `director.ts`) compile clean.
- Site-side `pnpm build` clean.
- Live observation window: monitor next 5 cron firings (≈2026-05-03 02:00 UTC) for any `Interactive generation parse retry` info events (Layer 1 firing) AND any `Interactive generation failed: ... parseAnd*` warn events (Layer 1 missed → 3-round exhaustion). Expected: zero terminal failures; ≤1 parse-retry breadcrumb across the 5 runs (Layer 2 should drop the rate substantially).

**Operator next:** the 2026-04-30 Voting Rights Act piece's quiz can be regenerated via `/dashboard/admin/piece/2026-04-30/supreme-court-limits-key-provision-of-the-landmark-voting-/` → click **Generate** on the quiz row (idempotent on `interactive_id IS NULL`). With Layer 2 prefill in place the regenerate should land cleanly on round 1; even if it flakes, Layer 1 catches it and round 2 should land.

---

## [resolved] 2026-04-27: Admin had no UI to retry a missing HTML companion when quiz exists

**Surfaced:** 2026-04-27 — Ben Sasse piece's HTML interactive failed; per-piece admin's "Retry interactive" button was hidden because `daily_pieces.interactive_id` was set (pointing at the quiz). Interactives list page's "Regenerate" button required an existing row of the target type to delete first, so couldn't bootstrap missing HTML. Only path was `curl POST /interactive-generate-trigger` with `ADMIN_SECRET`.

**Resolved:** 2026-04-27 across three commits:
- `6b6ed8a feat(admin): two-row interactive section + honest list-page footnote` — per-piece admin Interactive section now exposes Quiz · HTML rows with state-aware Generate (idempotent bootstrap) / Regenerate (destructive) buttons + inline last-failure reason. Interactives list page footnote replaced + first iteration of "Pieces missing interactives" subsection (two columns).
- `4195a2b fix(admin): gap-list redesign — single flat row + slug-inclusive URLs` — operator review caught duplication and ambiguous date-only URLs at multi-per-day. Redesigned to single flat list, one row per piece, inline status pills (`quiz ✓ · html ✗`), one Open link per row, slug-inclusive URLs sourced from the dailyPieces content collection.
- Operator-verified: clicked Generate HTML on Ben Sasse → `c466f4f feat(interactives): Visibility and Attention Debt (value-revelation-under-constraint) [html, flagged low]` shipped via the new flow.

See DECISIONS 2026-04-27 "Two-row interactive admin section + honest list-page footnote" + "Gap-list redesign — single flat row per piece, slug-inclusive URLs" for full trade-off logs.

---

## [resolved] 2026-04-27: Agents-worker deploy broken since refinement.2 merge

**Surfaced:** 2026-04-27 13:48 UTC — operator noticed red CI status on every commit since the morning's `9c2dd82` merge. Investigation showed the `deploy-site` job (Astro site worker) was passing every run, but `deploy-agents` was failing with `Syntax error "#"` at [agents/src/structure-editor-prompt.ts:16](../agents/src/structure-editor-prompt.ts:16). The line had markdown-style code spans `` `## kebab-case` `` and `` `<lesson-shell>` `` inside a backtick-delimited template literal — the inner backticks terminated the outer template and esbuild parsed `## kebab-case` as JS where `#` is invalid private-field syntax. Bug introduced by refinement.2 commit `93d6500`.

**Why prod stayed up:** Cloudflare keeps the last-good deploy live when a new deploy fails. The agents-worker ran the pre-7:06 AM code (`9609f6a` Categoriser-floor) all day — including handling the Generate HTML retry on Ben Sasse correctly. The deploy gap risk is FUTURE prompt changes / fixes, not current runtime.

**Resolved:** `ca3bce8 fix(agents): escape backticks in structure-editor-prompt template literal` — backslash-escaped the four inner backticks. Local `wrangler deploy --dry-run` confirmed clean build (1678 KiB, 16 DO bindings). CI ran `ca3bce8` green; agents-worker is back on the latest code.

**Lesson:** when a CHECK item or piece of agent prompt copy contains markdown code spans, those backticks need to be `\\\`` in source or the template literal breaks. A future tightening: wire a CI assertion that `agents/src/*-prompt.ts` files compile through esbuild before the deploy step (would have caught this without burning a deploy).

---

## [resolved] 2026-04-26: Area 5 single-scroll layout in progress

**Snapshot tag:** `area-5-snapshot` (commit `148f7f4`) — rollback point. Pushed to origin at the start of Area 5 work; the tag pins the daily-piece reader surface in its paginated-stepper shape so a `git reset --hard area-5-snapshot` recovers the pre-Area-5 state without ambiguity.

**Scope:** convert `/daily/<date>/<slug>/` from paginated stepper (Previous / Next / Finish, one beat visible at a time) to a single scrolling page (title → audio → every beat → embedded interactive → embedded quiz → finish state). Agents, pipeline, MDX output, D1 schema, audio agent pipeline, and `/interactives/<slug>/` standalone route all stay untouched.

**Resolved:** Area 5 shipped 2026-04-26 across three core commits ([area-5.1] lesson-shell collapse, [area-5.2] audio auto-advance, [area-5.3] inline interactive + finish state). Doc-sync commit + `area-5-done` tag close the contract. A four-commit post-tag polish pass landed on top the same evening ([area-5.4] info-button MadeBy + iframe auto-resize, [area-5.5] Zita-toggle circle, [area-5.6] finish-state tagline drop, [area-5.7] audio prev/next + current-beat caption — through `b480080`). See DECISIONS 2026-04-26 "Area 5 — Single scroll layout" + "Area 5 post-tag polish pass" for per-trade-off logs.

---

## [open] 2026-04-26: Book is missing three post-launch chapters — Categoriser, Interactives v3, Area 5 single-scroll

**Surfaced:** Refinement Action 6 (soul chapter draft). The book's structure was substantially written in the 2-week window before Area 5 closed; it freezes at "early Area 5" and predates three significant system additions. The four-word soul chapter shipped (00.5); the three post-launch chapters are separate work. Each addition changed how Daylila *behaves* enough that the book can't honestly describe the system without covering them.

**Missing chapters:**
- **Categoriser as the 14th agent** — Chapter 09 was renamed `09-the-sixteen-roles.md` and got a Categoriser section in Area 2 sub-task 2.6, but the chapter doesn't tell the *story* of why the agent exists (taxonomy growth pressure on the library, the 2026-04-25 reuse-floor tightening, the locked-category semantic). Drop-in section in Chapter 09 or a small standalone chapter "How the library categorises itself".
- **Interactives v3 (HTML interactives)** — Chapter 09 was further updated for InteractiveGenerator + InteractiveAuditor (15 + 16). But Interactives v3 (Phases 0-4, 2026-04-25 → 2026-04-26) introduced HTML interactives as a parallel artefact alongside quizzes, the validator → audit → revise loop, the cache-token telemetry, the engagement → Learner closure. None of this is in the book. Likely a new standalone chapter in Part 3 ("12.5 — Interactives, the second artefact"), or a major addition to chapter 11 (quality gates) since the validator is a new gate type.
- **Area 5 single-scroll layout** — Chapter 10 ("A day in the life of a piece") describes the OLD pagination-based `<lesson-shell>` state machine that was replaced 2026-04-26. The chapter walks a reader through Previous / Next / Finish; the actual reader experience is now title → audio → every beat → embedded interactive → embedded quiz → finish state, all on one scroll. Chapter 10 needs a substantial rewrite of its reader-experience section.

**What to write each:**
- Categoriser: ~600-800 words. Story of why a 14th agent (the library was growing without a map), the reuse bias (every new category is a permanent commitment), the 2026-04-25 cross-domain stretch + floor tightening, the locked-category semantic.
- Interactives v3: ~800-1000 words. The two-artefact pattern (quiz + html), the validator-as-gate, the produce → validate → audit → revise loop with two concurrent paths, the engagement → Learner feedback loop closure.
- Area 5 layout: ~400-600 words IF rewriting chapter 10 in place. If a standalone chapter, ~600-800 words covering the why-pagination-failed → single-scroll-decision → audio-auto-advance + smooth-scroll → embedded interactive + finish state.

**Investigation hints:** All three are documented in CLAUDE.md (Categoriser in the Area 2 + Curator-reframe sections; Interactives v3 in the v3 Phase 0-4 section; Area 5 in the Area 5 + post-tag polish sections) and DECISIONS.md (search 2026-04-23 through 2026-04-26 entries). Voice anchor for the new chapters: existing chapter 08 (`book/08-zeemish-the-idea.md`) — first-person where Zishan speaks, third-person about the system, plain English, short sentences.

**Priority:** medium. The book is read by people trying to understand Daylila; the gap means readers may finish the book with a working knowledge of an outdated system. Not a correctness problem; a documentation freshness problem. Slot when book-writing energy is available, or when a reader specifically asks about one of the three areas and the explanation would land better as a chapter than as a one-off note.

---

## [observing] 2026-04-26: Curator taxonomy expansion to 14 examples — track novel category framings over next 5–7 cron runs

**Surfaced:** Refinement Action 3 (commit landing this entry). TEACHABILITY criterion in `agents/src/curator-prompt.ts` grew from 8 to 14 worked examples (6 new categories + 1 sharpened) covering social conditioning, psychology/cognition standalone, environmental systems, money / ordinary life, health systems, and technology / daily life. The pre-expansion 8 categories biased Curator toward what news RSS feeds surface cleanly (policy / market structure / supply chain). The expansion's hypothesis: a rent-setting story will land under BUSINESS but Curator should now frame it as personal-financial mechanics, not market structure; a diagnostic-reasoning story under HEALTH should frame as evidence-becomes-practice, not science-discovery.

**What to verify:** Read the `underlying_subject` field of every `daily_pieces` row from 2026-04-27 onward through ≈2026-05-03 (5–7 cron runs at `interval_hours=12` = 10–14 pieces). Look for novel framings that wouldn't have shown up under the original 8 examples. Specifically watch for phrases like *"diagnostic reasoning"* / *"how rent-setting works"* / *"ecological mechanics"* / *"how attention gets designed in"* / *"how words shift meaning"* / *"how norms harden into defaults"*.

**Unblock criteria** (≈2026-05-03):
- ≥2 of 10–14 pieces frame their underlying system through one of the 6 new category lenses → expansion worked.
- Voice score average stays ≥85 across the same window → no regression in writing quality from the broader interpretive aperture.
- No same-day concept clashes (the 2026-04-24 twin-pieces failure pattern) → broader visibility didn't break the dedup signal.

If novel framings don't appear: bias is deeper than the example set. Tighten with a directive ("when a candidate's underlying system fits one of the bottom 6 examples, prefer that framing over the top 6 if it teaches something the library hasn't covered"). If voice scores drop: trim the new examples that pulled toward over-explanation (likely health systems — the diagnostic-reasoning category attracts didactic openings).

**Investigation hints:** Production query — `SELECT date, headline, underlying_subject, voice_score FROM daily_pieces WHERE date >= '2026-04-27' ORDER BY date, published_at;`. Cross-reference against the 2026-04-26 14-example list in [`agents/src/curator-prompt.ts`](../agents/src/curator-prompt.ts).

**Priority:** low — observation only, not blocking. The pre-expansion 8 examples still apply alongside the new 6, so Curator can't get worse from this change; it can only stay the same or open up.

---

## [observing] 2026-04-26: `interactive_started` event now fires on every daily-piece page load

**Surfaced:** Area 5 close-out (Phase D verification). Pre-Area-5, the `<quiz-card>` and `<interactive-frame>` Web Components only mounted when a reader visited `/interactives/<slug>/` directly — `interactive_started` was a meaningful "reader loaded the interactive" signal. Post-Area-5, both components are embedded inline at the bottom of every daily piece page, so they mount + fire `interactive_started` on every daily-page load — even for readers who never scroll to the section. The standalone `/interactives/` route's semantics are unchanged.

**Hypothesis:** the right fix is to defer `interactive_started` firing in both components until first viewport intersection (≥0.5 threshold, mirroring `interactive_offered`'s threshold from `<lesson-shell>`). On the standalone route the component is above the fold, intersection happens nearly immediately on first paint — behaviour unchanged. On the daily route, only readers who actually scroll to the section fire `started`. Both surfaces benefit.

**What to verify before fixing:**
- Look at admin `/dashboard/admin/interactives/` engagement counts after Area 5 ships. If `interactive_started` count tracks daily-page views rather than interactive engagements (i.e. ~doubles or ~triples), that's the signal to fix.
- Watch for any analytics consumer (operator dashboard, Learner aggregation, future cost-per-engagement math) that would be misled by inflated `started` counts. None today, but if a Phase 4 cohort study leans on `started`, that's the trigger.

**Investigation hints:** `src/interactive/quiz-card.ts:59` (`interactive_started` POST on `connectedCallback`) and `src/interactive/interactive-frame.ts:51` (same pattern). Replace both `connectedCallback` POSTs with a one-shot IntersectionObserver mirroring lesson-shell.ts:120-149's `observeInteractive` shape, deduped by sessionStorage key `zeemish-interactive-started:{interactiveId}`.

**Priority:** low — engagement-data noise, not a correctness or reader-facing issue. Fix when an analytics consumer surfaces or as part of a future engagement-data hygiene pass.

---

## [observing] 2026-04-26: Verify Area 5 single-scroll layout in production

**Surfaced:** Area 5 close-out (commit `area-5-done`). Local-preview verification covered structural, engagement, audio auto-advance + smooth-scroll (manually dispatched `ended`), share button (clipboard fallback path), and mobile resize. Real audio in dev returns 404 because R2 isn't bound to the dev server — production audio is the only place to confirm the auto-advance + smooth-scroll loop completes naturally over real clip durations.

**What to verify on prod after deploy:**
- Visit a recent daily piece on `daylila.com`, click play, let the first beat's audio finish naturally. Confirm: clip 2 loads + autoplays, page smooth-scrolls so beat 2's heading is at the top of the viewport, audio caption advances to "Beat 2 of N · {Title}", no jank.
- Let it run through every beat. Confirm: each transition smooth-scrolls + caption updates, no transition silently fails (especially across the longest beats — typically `the-pattern` or `why-hard`).
- Try the prev/next clip buttons mid-listen. Confirm: clicking prev returns to the previous beat with the new clip autoplaying + page scrolling back; prev disables at beat 1, next disables at the last beat.
- Scroll to the embedded interactive section. Confirm: HTML interactive iframe renders at its natural content height (no inner scrollbar) + `interactive_offered` event in admin observer feed.
- Scroll to the finish footer. Confirm: `complete` engagement event in admin observer feed; the three actions render, share button works (mobile native sheet on iOS Safari, clipboard fallback on desktop), small `ⓘ How this was made` info button below opens the drawer cleanly.
- Reload the page. Confirm engagement events DO NOT re-fire (sessionStorage dedup).

**Unblock condition:** Operator runs the test once on prod and confirms or names what regressed.

**Priority:** medium — first single-scroll prod verification window.

---

## [observing] 2026-04-26: Verify Phase 3.3 destructive regenerate end-to-end on prod

**Surfaced:** Phase 3.3 close-out (commit `ddb5cdd`). Local-preview verification only confirmed the auth-gate (401 on all four input shapes); the actual wipe → fresh-generation flow needs a real run against a Rough row on prod.

**What to verify:**
- Pick a Rough row from `/dashboard/admin/interactives/` (the Mint piece's quiz "Identity Loss Through Transformation" `[flagged low]` is a fresh candidate).
- Click `Regenerate`. Confirm dialog should enumerate the wipe (file + interactives row + audit rows + `daily_pieces.interactive_id` clear + scheduled alarm).
- After confirm: success status appears, button stays disabled.
- Wait ~30s, reload the page. Row should reappear with a fresh slug + fresh audit pills (or stay rough if the auditor maxes out again — that's also fine; just shouldn't 500).
- Check observer feed on `/dashboard/admin/`: should show one `interactive_regenerated` info event (operator email + deleted slug) followed by one `Interactive(s) generated|shipped (flagged low)` metered event.

**Unblock condition:** the user runs the test once on prod. Pass = mark resolved with the SHA.

**Priority:** medium — destructive endpoint, untested on a real piece. Ship-as-low fallback means a bad regen doesn't 404 the URL, but a wipe-without-fresh-generation is worth catching before it bites silently.

---

## [observing] 2026-04-26: Verify Phase 3.4 cost telemetry populates with cache numbers post-deploy

**Surfaced:** Phase 3.4 close-out (commit `03c3d88`). All InteractiveGenerator events written today (Mint piece + earlier today's runs) pre-date the cache-capture deploy, so they appear with `cacheCreate=0` / `cacheRead=0` and trigger the page's "events pre-date cache capture" footnote. The first cron firing AFTER the 3.4 push will be the first event with full cache numbers.

**What to verify:**
- Visit `/dashboard/admin/interactives/` and find the "Cost (month-to-date · Apr 2026)" section.
- Today: expect cache fields = 0 + the italic footnote about partial breakdown.
- After tomorrow's 02:00 UTC cron (or the next manual `/daily-trigger` run): the new event should carry real `cache_creation_input_tokens` + `cache_read_input_tokens` values. The 5-stat row should show non-zero "Cache write · read" tokens with a non-zero cost component.
- Check observer feed for the new metered event's body — should read like `Tokens: in=N out=M cacheCreate=K cacheRead=L. Latency: …` (4-up shape, not the old 2-up).

**Unblock condition:** at least one new metered event lands post-deploy with non-zero cache numbers visible in the surface.

**Priority:** low — observability only. The capture path is unit-tested via typecheck; runtime values just need to flow through.

---

## [observing] 2026-04-26: Verify Mint piece "How this was made" drawer renders both quiz + html sections

**Surfaced:** Phase 2.7's first auto-run produced both a quiz (`683cee9` flagged-low) AND an HTML interactive (`d1e2e31` clean pass) for the U.S. Mint piece. The drawer should now show two distinct interactive sections per the Phase 2.6 dual-artefact extension.

**What to verify:**
- Visit `https://daylila.com/daily/2026-04-26/u-s-mint-buys-drug-cartel-gold-and-sells-it-as-american/`.
- Open the "How this was made" drawer at the bottom.
- Should show two interactive sections (separate from each other):
  - **Quiz**: title "Identity Loss Through Transformation", with the dimension-named Rough note (essence-not-reference, structure, factual, or whatever maxed). Voice score + revision count visible.
  - **HTML interactive**: title "Mixing and Traceability", clean pass (no Rough note), with iframe size + revision count.
- The standalone interactive page at `/interactives/identity-loss-through-transformation/` should render both stacked when visited directly.

**Unblock condition:** drawer rendering on prod matches description.

**Priority:** low — Phase 2.6 reader surface was unit-verified via stubbed fixtures; this is the first non-fixture confirmation.

---

## [observing] 2026-04-26: Phase 4 Learner output mentions interactive engagement

**Surfaced:** Phase 4 ships the engagement → Learner loop. Per Phase 4 Definition of Done in `INTERACTIVES_PLAN.md:186-190`: "Next Learner run mentions interactive engagement in its written reflection."

**What to verify (after Phase 4 ships):**
- The next Learner pass (post-publish alarm on the next daily piece) should produce at least one `learnings` row with `source='producer'` whose body mentions interactive engagement (views, manipulations, dwell, or similar).
- Visible on `/dashboard/` (the public learnings panel) and on the per-piece "How this was made" drawer's learnings section.
- Initial output will be thin (sample size = 1 piece's worth of HTML interactive engagement); thin is fine — what matters is the loop being closed.

**Unblock condition:** Phase 4 has shipped + at least one daily piece has been published with a Learner run after the Phase 4 deploy.

**Priority:** medium — closes the v3 self-improvement loop. Without it, Phase 4 is "shipped but unverified."

---

## [resolved] 2026-04-26: Curator regression — list-number prefix being returned as `selectedCandidateId`

**Surfaced:** 2026-04-26 11:01 UTC observer feed during Interactives v3 Phase 2 closeout. Auto-cron at the U.S. Mint slot fired warn event:

> `Error: curator` — `Pipeline error: selectedCandidateId 10 matched 0 rows in daily_candidates — id shape drift from Curator`

Same bug class as 2026-04-22's `[resolved]` Curator selectedCandidateId entry (commit `6999c5e`), but a NEW failure mode: Claude returned `"10"` instead of a UUID. 10 is the LIST INDEX, not the id.

**Hypothesis:** The prompt at [`agents/src/curator-prompt.ts:92`](../agents/src/curator-prompt.ts) renders each candidate as `${i + 1}. id: ${c.id}\n   [${c.category}] ...`. When Claude renders 10+ candidates (Scanner pulls 50), the numbered prefix `10.` looks structurally like an id — Claude grabbed the visible-first-token instead of the explicit `id: <uuid>` field. The 2026-04-22 fix added the `id: <uuid>` annotation + the "MUST be the exact id string" instruction (line 99) but didn't remove the leading `${i + 1}.` numbering. With <10 candidates the index is 1 char and easy to ignore; once we cross into 2-digit indices Claude gets confused.

User's manual retrigger from admin worked — the pipeline can recover via `/daily-trigger` or by scaling back. Auto-cron path is brittle until fixed.

**Investigation hints:**
- Re-read the 2026-04-22 fix (`6999c5e`) — the exception path it added is what fired the observer event today; that part works. The defect is upstream in the prompt rendering.
- Two candidate fixes:
  1. **Drop the numbered prefix entirely.** Render `id: ${c.id}\n   [${c.category}] "${c.headline}" (${c.source})\n   ${c.summary}` with no leading number. Claude doesn't need the index.
  2. **Move the UUID to the front.** Render `[${c.id}] [${c.category}] "${c.headline}" ...` so the first visible token IS the id.
- Also worth tightening the response-format example (line 59): "`selectedCandidateId`": "the id of the chosen story" — replace with a concrete UUID-shaped placeholder so Claude pattern-matches on shape.
- Verification: re-run `/daily-trigger` against today's slot post-fix; confirm `selectedCandidateId` is a UUID matching a `daily_candidates.id`.

**Priority:** medium — auto-cron robustness regression. Each cron firing has some probability of hitting this when candidate count crosses 10 (which it always does at Scanner's default 50/feed). Manual retrigger is the workaround until fixed. Doesn't block Phase 3 work.

**Resolved:** 2026-04-26. Took fix #1 (drop the `${i + 1}.` numbered prefix) — Claude doesn't need the index for selection, and `id: <uuid>` is now the first visible token on each candidate's first line. Also tightened the response-format example at line 59 to use a UUID-shaped placeholder ("<uuid copied verbatim from the chosen candidate's id: field — e.g. 0f3a8b6c-...>") so Claude pattern-matches on shape rather than copying the literal hint string. Final instruction at line 99 explicitly forbids substituting "a list position number". The 2026-04-22 exception path at [`director.ts:243`](../agents/src/director.ts) stays in place as defence-in-depth — any future shape drift surfaces the same warn event for forensic context. See DECISIONS 2026-04-26 "Curator candidate rendering: drop list-number prefix to stop Claude returning the index as selectedCandidateId". Verification trigger: next auto-cron at 2026-04-26 14:00 UTC; expected `selectedCandidateId` shape is a UUID matching a `daily_candidates.id` row.

---

## [observing] 2026-04-25: Categoriser novel-category rate after floor 60→75 — track next 10 cron firings

**Surfaced:** 2026-04-25 same-day Categoriser post-mortem on the firing-squads piece. The piece picked up a cross-domain stretch ("Commodity Shocks" at 70% confidence on a state-violence subject). Floor raised 60 → 75 same session to cut off the stretch zone. See DECISIONS 2026-04-25 "Tighten Categoriser reuse floor + surface existing assignments on skipped log + delete bad firing-squads → Commodity Shocks assignment".

**Hypothesis:** Floor change shifts ambiguous-fit pieces away from the reuse bucket and toward either (a) a tighter clean reuse at 80+, (b) a novel category, or (c) zero-second-category (assignmentsWritten=1). Most pieces will end up in (a) or (c). A small minority will end up in (b) — that's the intended escape valve when the existing taxonomy genuinely doesn't cover the piece. The risk is over-correction: too many novel categories means the taxonomy proliferates, breaks the reuse-bias-was-holding argument that justified deferring sub-task 2.5 (admin categories page).

**What to watch over the next 10 cron firings (≈5 days at `interval_hours=12`):**

1. **Novel-category rate.** Query: `SELECT COUNT(*) FROM categories WHERE created_at >= <floor_change_commit_ts>`. If more than 3 novel categories created in the next 10 pieces (current rate: 7 in 12), the floor is too high; tune back to 70. If 1-2, the floor is well-calibrated. Zero is also fine (the existing taxonomy may be saturated for current news patterns).
2. **Assignments-per-piece distribution.** Query: `SELECT piece_id, COUNT(*) FROM piece_categories WHERE created_at >= <floor_change_commit_ts> GROUP BY piece_id`. If the median drops below 1.5, Categoriser is being too cautious; the secondary-category slot is the natural place for cross-domain teaching that legitimately spans subjects. If pieces consistently get only 1 category, the floor may be cutting too aggressively.
3. **Confidence distribution on existing-category reuses.** Query: `SELECT confidence FROM piece_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.created_at >= <floor_change_commit_ts> AND c.created_at < <floor_change_commit_ts>`. Should now cluster at 80+. Anything below 75 is a bug (floor isn't being respected); anything in the 75-79 band is the new ambiguous zone — watch for misclassifications there.
4. **Sub-task 2.5 unblock signal.** If the catalogue hits ~30 categories before ~30 pieces, the reuse-bias argument that justified deferring sub-task 2.5 has broken; admin categories page becomes urgent. Current: 7 categories, 13 pieces (12 + firing-squads).

**Investigation hints when resumed:**
- Floor constant: [`agents/src/categoriser-prompt.ts:CATEGORISER_REUSE_CONFIDENCE_FLOOR`](agents/src/categoriser-prompt.ts).
- The skipped-log surface change is unrelated to this observing entry — it just makes the data easier to read in the admin feed when re-runs happen. No effect on assignment shape.
- Useful one-liner for quick health check: `wrangler d1 execute zeemish --remote --command "SELECT slug, name, piece_count FROM categories ORDER BY piece_count DESC"`.

**Unblock condition:** 10 cron firings observed (≈2026-04-30 14:00 UTC). Move to `[resolved]` if novel-category creation rate ≤ 3/10 AND median assignments-per-piece is between 1 and 2 AND no confidence-band-violators in piece_categories. Otherwise tune the floor and reset the observation window.

**Priority:** medium. Cron is firing every 12 hours; the data accrues on its own.

---

## [observing] 2026-04-25: Curator pick rate after protocol-reframe — track next 7 cron firings

**Surfaced:** 2026-04-25 same-day. Curator's 14:00 UTC slot declined every one of 50 candidates with the "60+ teachability threshold" boilerplate. Same-session fix dropped the threshold, embedded the Daylila protocol at the top of `CURATOR_PROMPT`, replaced TEACHABILITY's biased examples with breadth-showing ones across 8 categories, reframed NO-CULTURE-WAR as voice-not-subject, and required skip reasons to name the specific condition rather than dismiss by category. See DECISIONS 2026-04-25 "Curator reframed around the Daylila protocol; '60+ teachability threshold' dropped".

**Hypothesis:** Pick rate should rise from current rate (1 skip in last few firings) to ~95%+. Skip should now only fire on the narrow conditions named in the new prompt (single breaking event re-reported with no new angle, or pure product/spec announcements with no system to teach).

**What to watch over the next 7 cron firings (≈3.5 days at `interval_hours=12`):**

1. **Pick rate.** Query: `SELECT step, status, data FROM pipeline_log WHERE step='skipped' AND created_at >= <reframe_commit_ts> ORDER BY created_at DESC`. If more than 1 skip in 7 firings, the prompt rewrite isn't strong enough — investigate the skip reasons and tune.
2. **Voice score distribution.** Query: `SELECT date, slug, voice_score FROM daily_pieces WHERE published_at >= <reframe_commit_ts>`. If voice scores drift below 80 average (vs ≥85 historical), Curator is picking thin stories and Drafter is padding — the auditors are catching it but quality is degrading. Tune DEPTH POTENTIAL guidance back up.
3. **Quality-flag rate.** Query: `SELECT date, slug, quality_flag FROM daily_pieces WHERE published_at >= <reframe_commit_ts>`. If `quality_flag='low'` rate rises above 1-in-10, same conclusion as #2 — picking too aggressively.
4. **Skip reason quality.** When a skip does fire, read the reason in `pipeline_log.data`. New prompt requires it to NAME the specific condition (e.g., "all 50 candidates are reprints of X breaking event with no new angle"). If the reason is still category-dismissal boilerplate ("low-teachability", "shallow"), Claude is ignoring the new instruction — tune the wording.

**Investigation hints when resumed:**
- The reframe ships in `agents/src/curator-prompt.ts`. The decline path through `agents/src/curator.ts` and `agents/src/director.ts` is unchanged.
- Doc surfaces (voice-contract.md + voice-contract.ts + CLAUDE.md) gained the third protocol sentence in the same commit.
- Verify the prompt deployed correctly: `grep "Default: PICK" agents/src/curator-prompt.ts` after the agents-worker auto-deploy completes.
- Consider running a one-shot test against today's 50 candidates from `daily_candidates WHERE date='2026-04-25'` (specifically piece_id `fd5b4687…`) once any tuning is needed — confirm the new prompt picks one of: murder case, firing squads, Planned Parenthood Botox, DOJ procedures.

**Unblock condition:** 7 cron firings observed (≈2026-04-28 14:00 UTC). Move to `[resolved]` if pick rate ≥6/7 AND voice score average ≥85 AND quality_flag='low' rate is 0-1/7.

**Priority:** medium. Cron is firing every 12 hours; the data accrues on its own.

---

## [resolved] 2026-04-25: Submit daylila.com sitemap to Google Search Console

**Surfaced:** 2026-04-25 SEO foundations shipping (commit `b089d6d`). The `/sitemap.xml` endpoint is live and auto-updates on every request, but neither Google Search Console nor Bing Webmaster Tools knows the URL exists yet. Until submitted, organic indexing waits on whatever the crawlers happen to discover via inbound links — slow and uneven.

**Hypothesis:** This is a one-time human action, not code work. RUNBOOK has the step-by-step under "Submit sitemap to search engines". Verifying ownership uses a DNS TXT record on the Cloudflare zone (preferred over the HTML-file method since auto-deploy doesn't touch DNS).

**Resolved:** 2026-04-25. Sitemap submitted to Google Search Console as a domain property (`daylila.com`, not the URL-prefix variant — domain property covers `https://`, `http://`, and every subdomain in one go, which is the right shape for a single-origin site). Verified via DNS TXT on the Cloudflare zone. Sitemap processed successfully on first read; **31 pages discovered** (matches the SSR endpoint's enumeration of homepage + /daily/ + /library/ + 12 daily pieces × slug-inclusive URLs + 7 interactives + 3 category pages + the /daily/ and /library/ indexes). First crawl impressions and Coverage report data will accrue over 1–3 days. Monitor Coverage for any "Crawled — currently not indexed" entries from the pre-Phase-4 date-only URLs (separate FOLLOWUPS entry below covers the 301-redirect option).

**Bing Webmaster Tools — deferred by decision.** Skipping the Bing submission for now. Bing's organic share is small relative to the effort of maintaining a second webmaster property; can revisit if AI-search traffic (Bing powers Copilot's web grounding, You.com, etc.) gets interesting enough to warrant per-source visibility. No action queued; no FOLLOWUPS entry to track.

---

## [wontfix] 2026-04-25: URL canonicalisation — pre-Phase-4 date-only URLs 404 with no 301

**Surfaced:** 2026-04-25 SEO foundations review. Per CLAUDE.md "Multi-piece cadence — Phase 4 URL routing", the canonical reader URL changed from `/daily/YYYY-MM-DD/` to `/daily/YYYY-MM-DD/{slug}/` on 2026-04-21. Phase 4's decision was "no 301 redirect layer — old URLs stop existing (dev-phase decision from Phase 1 DECISIONS)". At submission time this was correct (site was 3 days old, near-zero external links). With Search Console submission imminent (preceding entry), and time accruing for any external links pointing at the old shape, the indexing impact is starting to matter.

**Hypothesis:** Add a 301 redirect at the route level. Two options:
1. **Astro middleware.** Match `/daily/YYYY-MM-DD/$` (no slug), look up the matching piece's slug from the content collection (build-time data, no D1), 301 to `/daily/YYYY-MM-DD/{slug}/`. Single match per date works at `interval_hours=24`; at multi-per-day cadence the match is ambiguous (two pieces share a date). Solution: redirect to `/daily/{date}/` index page (which already shows a disambiguation list when multiple pieces exist for the date — see Phase 7 `[date]/index.astro` route).
2. **Cloudflare Bulk Redirect.** Static rule list managed in the Cloudflare dashboard. Simpler but requires manual maintenance.

Option 1 wins on automation — content collection is the source of truth, no manual sync.

**Investigation hints when resumed:**
- Pre-Phase-4 published pieces: 5 (per Phase 4 backfill — see CLAUDE.md). Their old URLs: `/daily/2026-04-13/` through `/daily/2026-04-17/`. Hit each with curl after the fix to confirm 301 → 200 chain.
- The `[date]/index.astro` route already exists for the legacy URL handler (Phase 7 commit `3208c86`) — it redirects when unambiguous, shows a disambiguation list at multi-per-day. Verify it's still working before adding new logic; it may already cover this case.

**Priority:** low. Mitigated significantly by the existing `[date]/index.astro` legacy URL handler (verify it's actually intercepting first — preceding bullet). If it is, this entry can close immediately.

**Won't fix:** 2026-04-26 — Site is 8 days old; no evidence of incoming traffic on the pre-Phase-4 URL shape. The existing `[date]/index.astro` legacy handler intercepts most cases. Reopen if Search Console shows incoming hits on `/daily/YYYY-MM-DD/` shape.

---

## [wontfix] 2026-04-25: Drafter slug strategy — concept-based slugs over headline-derived

**Surfaced:** 2026-04-25 SEO foundations review. Current daily-piece slugs derive from the news headline via Director: `slugify(curatorBrief.headline).slice(0, 60)`. That gives URLs like `maine-gov-janet-mills-vetoes-ban-on-data-center-construction` — accurate but news-cycle-bound. Six months from now the underlying teaching ("data centre grid capacity") is still relevant; the proper-noun-heavy slug is not. SEO ranking and reader memorability would both benefit from concept-based slugs.

**Hypothesis:** Two changes, in order:
1. Drafter prompt addition: include a `slug` field in the Drafter's JSON output schema. Prompt instruction: "Write a 2–4 word concept-focused slug. Examples: `data-center-grid-capacity`, `chokepoints-and-cascades`, `proportional-displacement`. Avoid proper nouns, dates, and headline phrasing — these date the URL."
2. Director: prefer `draft.slug` when present, fall back to current headline-derived slug for safety. Same `slugify` + 60-char cap + collision-resolution as today.

**Caveats:**
- Existing pieces stay at their current URL forever (permanence rule). Only new pieces get concept slugs.
- Need a slug-collision strategy across the growing library — current headline-based slugs are unique by virtue of being long; concept slugs are short and may collide. Same `-2`/`-3` suffix mechanic from interactives sub-task 4.4.
- Writer-side change only (no schema, no migration). Rollback is a one-line revert.

**Investigation hints when resumed:**
- Director slug derivation lives at [agents/src/director.ts](../agents/src/director.ts) (search for `slugify` or `filename`).
- Drafter prompt lives at [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts) — JSON output schema is the touch site.
- Look at the 7 existing interactives in `content/interactives/` for examples of well-chosen concept-based slugs (`chokepoints-and-cascades`, `proportional-displacement-visibility`, `phase-change-disruption`) — that prompt design is the pattern to copy.

**Priority:** low. Cosmetic for the URL layer; doesn't affect ranking until the library has enough pieces that long-tail SEO matters (currently 12 pieces, 8 days live). Revisit when piece count crosses ~50 or when a competing concept-tagged URL outranks a Daylila piece on the same topic.

**Won't fix:** 2026-04-26 — Pure SEO/longevity optimisation with no current breakage. Library is 14 pieces over 9 days; the long-tail SEO threshold (~50 pieces) is not yet near. Reopen when piece count crosses ~50 or when a competing concept-tagged URL outranks a Daylila piece on the same topic.

---

## [open] 2026-04-24: reset-today.sh doesn't recount categories.piece_count after piece-id delete

**Surfaced:** 2026-04-24 during operator-led cleanup of the duplicate 2026-04-24 piece (pieceId 159a972a). After wiping the piece's `piece_categories` row via `scripts/reset-today.sh --piece-id` pattern, the `information-asymmetry-markets` category chip on /library/ still showed "2" while only 1 piece remained. `categories.piece_count` is denormalised (per sub-task 2.1 — writer maintains, admin "Recount" button is the drift escape hatch) but 2.5's admin Recount UI is deferred. The script has no inline recount step, so every operator delete drifts the library chip count.

**Hypothesis:** Add a recount step to `scripts/reset-today.sh` in BOTH modes (full-day reset and --piece-id reset) after the D1 DELETEs:

```sql
UPDATE categories
SET piece_count = (SELECT COUNT(*) FROM piece_categories WHERE category_id = categories.id),
    updated_at  = strftime('%s','now') * 1000;
```

Idempotent + reconciles historical drift. Also add an explicit `DELETE FROM piece_categories WHERE piece_id = ?` line to the script (currently handled at the DB layer, but naming it in the script makes intent clear).

**Investigation hints when resumed:**
- In-session manual fix for the 2026-04-24 drift was the exact UPDATE above, run via `wrangler d1 execute --remote`. 8 categories reconciled successfully.
- `scripts/reset-today.sh` lines 171-180 (piece-id mode D1 wipe) and 235-240 (full-day mode) are the insertion points.
- Update the header comment's "Tables touched" block to name piece_categories + the recount.
- Docs: brief mention in RUNBOOK under "Reset today" + a DECISIONS entry (or closure of this FOLLOWUPS entry via an append to DECISIONS 2026-04-24 "Curator prompt enriched with recent-piece semantic context").

**Priority:** low. Drift is cosmetic (library chip counter vs actual piece count); doesn't affect rendering or SQL joins. Risk scales with operator-led delete frequency — if deletes become routine, bump priority.

---

## [wontfix] 2026-04-24: agents-worker server.ts SDK-typing baseline (25 errors)

**Surfaced:** 2026-04-24 session noted the persistent "typecheck clean — 25 errors all in server.ts (pre-existing baseline)" shorthand I use on every agent-worker commit. Operator asked directly whether to fix; agreed to leave for now and log here.

**Hypothesis:** The 25 errors in `agents/src/server.ts` are Cloudflare Agents SDK typing gaps — the SDK's exported types don't describe the `DurableObjectNamespace<T>` / `DurableObjectStub<T>` shape well enough for TypeScript to verify method calls like `.triggerDailyPiece()`, `.retryAudio()`, `.analyseZitaPatternsScheduled()`, etc. Code works at runtime; TypeScript just can't see the methods.

Fix (when triggered):
- Create `agents/src/types/agents-sdk.d.ts` with module augmentation declaring the agent methods on the DO stubs. Shape approximately:
  ```ts
  declare module 'agents' {
    // augment DurableObjectNamespace<T> so .get().<method>() typechecks
    // cleanest is per-agent interface for each agent class
  }
  ```
- No runtime change, no `as any` casts, no 25 `@ts-expect-error` comments. Just declaring what the SDK didn't export.
- One file, one commit. Expected ~30-60 min.

**When to trigger:**
- Before wiring a CI typecheck gate (currently ungated, so 25 errors are tolerated)
- Next time server.ts is touched for substantive work (piggyback on real work)
- If the noise ever obscures a real regression while investigating a bug

**Investigation hints when resumed:**
- Read `agents/node_modules/agents/dist/index.d.ts` to see the SDK's type exports.
- The 25 errors cluster around two patterns: (a) `env.DIRECTOR.get(id)` returns `DurableObjectStub<undefined>`, not `DurableObjectStub<DirectorAgent>`; (b) calling `.triggerDailyPiece()` etc. on that stub triggers "property does not exist". Fix either upgrades the SDK's type annotations or augments them locally.
- Historical mentions in DECISIONS / CLAUDE.md: "25 errors, all pre-existing server.ts SDK-typing" — these are the ones.

**Priority:** low. Developer experience only; zero user-visible impact; no blocking effect on deploys.

**Won't fix:** 2026-04-26 — Pre-existing baseline, runtime fine, zero user-visible impact. No CI typecheck gate exists yet. Reopen when an SDK upgrade forces a typing pass or when the noise obscures a real regression during debugging.

---

## [resolved] 2026-04-24: Per-round audit notes for interactives

**Surfaced:** 2026-04-24 during Area 4 sub-task 4.1 schema design. InteractiveAuditor (sub-task 4.5) runs up to 3 revision rounds, same pattern as Integrator on daily pieces. Daily pieces persist per-round audit detail in `audit_results` (auditor / passed / score / notes / draft_id / piece_id / created_at) — operators can see the full revision history on the admin piece-detail page. Interactives currently persist only `revision_count` on the `interactives` row itself. Round-level notes (what the auditor flagged, what changed between rounds) are not captured.

**Hypothesis:** Not wrong to defer. For the minimum Generator+Auditor loop to work, `revision_count` (did it pass on round 1 / 2 / 3?) is enough. Per-round notes become valuable (a) when a debugging session needs to understand *why* an interactive was revised and what changed, OR (b) when 4.5 ships and we find the auditor's flags are worth surfacing on the admin page like daily-piece audit rounds are.

**Resolved:** 2026-04-25. Both unblock conditions hit: 4.5 has shipped, AND the 2026-04-25 Maine drawer's voice-vs-Rough contradiction was a debugging session that needed the dimension-named context. Migration `0023_interactive_audit_results.sql` adds `interactive_audit_results(id, interactive_id, round, dimension, passed, score, notes, created_at)` with composite index on `(interactive_id, round)`. Writer is InteractiveGeneratorAgent's loop — pre-allocates `interactiveId` before the produce→audit→revise loop and persists 4 rows per round (one per dimension) via the new `persistAuditRows` helper after each `auditor.audit()` call. Reader is `made.ts` API which surfaces `failedDimensions: string[]` on `MadeInteractive` (latest round's failed dimensions only, in fixed voice→structure→essence→factual order). Drawer's `qualityFlag === 'low'` branch reads it via the new `buildLowNote(failedDimensions)` helper, naming the rubric inline ("essence-not-reference") when present, falling back to generic copy when empty (legacy interactives + clean-pass parents). Schema design choices (TEXT dimension instead of CHECK, no FK REFERENCES, orphan-tolerance) match codebase convention. The two existing `quality_flag='low'` rows (FISA + Maine) were NOT backfilled — final-round data remains observable via observer_events for forensic context. See DECISIONS 2026-04-25 "Ship interactive_audit_results table".

---

## [wontfix] 2026-04-24: Coherent null-pieceId handling on admin piece-detail page

**Surfaced:** 2026-04-24 during Area 3 sub-task 3.2 code review. When a slug typo hits `/dashboard/admin/piece/<date>/<wrong-slug>/`, the content-collection lookup returns undefined → `pieceId = null`. Different sections handle this inconsistently:
- Lenient (fall back to date-keyed lookup, show *some* data): `piece` (most-recent by date), `audit_results` (by task_id='daily/<date>'), `pipeline_log` (by run_id), `daily_candidates` (by date).
- Strict (query gated on `pieceId`, return empty): `daily_piece_audio`, `zita_messages`, `observer_events` (post-3.2).

**Hypothesis:** Mixed behaviour is a historical artifact — the lenient fallbacks pre-date `piece_id` columns being on the child tables; the strict gates were added alongside the new columns in 2026-04-22 migrations. Neither mode is "wrong", but having both on one page is confusing: a bad slug shows piece/audit/pipeline data with an empty audio/zita/observer section, making it look like three sections silently failed rather than the slug being wrong.

**Decision needed:** pick one side and apply consistently.
- Option A — all lenient: add date-keyed fallback to audio / zita / observer queries when pieceId is null. Slug typo → shows day-view. Generous; may mislead at multi-per-day.
- Option B — all strict: remove date fallback from piece / audit / pipeline / candidates queries when pieceId is null. Slug typo → renders the existing "No piece" error state. Honest; best in a world where all post-Phase-7 MDX has `pieceId` so the only way to hit null is a typo.

**Recommendation:** B. Post-Phase-7 every MDX has pieceId and the content schema requires it. Null pieceId at runtime = operator typo; that deserves an error state, not partial data that looks plausible.

**Investigation hints:** [src/pages/dashboard/admin/piece/[date]/[slug].astro](../src/pages/dashboard/admin/piece/[date]/[slug].astro) — the `if (pieceId) { ... } else { ... date-based fallback ... }` blocks around lines 128-188. Removing the else branches collapses the code by ~30 lines.

**Priority:** low. Slug typos are operator-caused and caught the moment the operator notices "that's not my piece". Tightening is purely hygiene.

**Won't fix:** 2026-04-26 — Admin UI hygiene only, reader-invisible. Six clean days post-3.2 with no operator complaint about the mixed strict/lenient sections. Reopen if a slug typo materially misleads an operator during incident triage.

---

## [observing] 2026-04-23: Admin categories page — deferred from Area 2 plan

**Surfaced:** 2026-04-23 late evening during Area 2 execution. Original sub-task 2.5 scope: `/dashboard/admin/categories/` with name · slug · piece count · lock toggle · [Rename] [Merge] [Delete] per row, each action firing an `admin_category_*` observer event. Deliberately deferred — not dropped.

**Why deferred:** Categoriser's reuse-bias prevention (strong prompt discipline + slug-collision fallback + ≥60 confidence floor) is the primary strategy for keeping the taxonomy clean. Admin curation tools are the fallback for when the bias doesn't hold. Building the fallback before observing the system on real pieces contradicts the autonomous ethos — we'd be answering "how do I fix bad categorisation?" before knowing whether it happens.

**Current state — data layer is complete, UI is not:**
- `categories` + `piece_categories` tables (migration 0021) shipped ✓
- CategoriserAgent writes through them ✓
- `src/lib/categories.ts` read helpers (`getCategories`, `getCategoryBySlug`, `getPieceIdsInCategory`) shipped ✓
- Reader-facing library filter (`/library/<slug>/`) shipped ✓
- `/categorise-trigger` admin endpoint exists for manual retag ✓
- Admin UI (merge / rename / delete / lock) **not built**

**Unblock when:** (a) drift becomes observable — Categoriser creates a category that an operator wants to rename or merge, OR (b) the catalogue reaches ~30 pieces (point at which the 7-category v0 taxonomy will likely need a pruning pass regardless), whichever comes first. In the interim, `wrangler d1 execute` is the emergency lever — `UPDATE categories SET name = …` or `DELETE FROM piece_categories WHERE category_id = …` work but don't audit-log.

**Investigation hints when resumed:**
- Reference pattern: `src/pages/dashboard/admin/settings.astro` (admin-gated SSR page) + `src/pages/api/dashboard/admin/settings.ts` (admin-gated REST endpoint that fires `admin_settings_changed` observer event).
- Merge semantics: SQL transaction that rewrites `piece_categories.category_id` from source → target, then DELETEs source row, then adjusts `piece_count` on target (or recomputes). Guard against merging a category into itself.
- Delete semantics: gate on `piece_count = 0`. Don't offer DELETE on a populated category — force a merge first.
- Lock semantic is currently inert for CategoriserAgent (it only INSERTs, never DELETEs or re-tags). Admin sets `locked = 1`; agent respects it only if a future code path tries to reassign (not shipped). Documented in `agents/src/categoriser.ts` header.
- Observer events to fire: `admin_category_renamed`, `admin_category_merged`, `admin_category_deleted`, `admin_category_locked`, `admin_category_unlocked`. Mirror the shape of `admin_settings_changed`.

**Priority:** low until drift is observed, then medium.

---

## [open] 2026-04-23: CDN cache invalidation on per-beat audio regen

**Surfaced:** 2026-04-23 during live verification of the admin per-beat Regenerate button (shipped in commit `ce3de81`, DECISIONS 2026-04-23 "Provider-agnostic TTS normaliser + admin per-beat audio regen").

**Hypothesis:** Audio R2 keys are deterministic (`audio/daily/{date}/{piece_id}/{beat_name}.mp3`) — regenerating a beat overwrites the same key, so the URL stays identical. Site worker's `/audio/*` catch-all route serves R2 objects with `Cache-Control: public, max-age=31536000, immutable` (1-year edge cache). After per-beat regen, returning readers may keep hearing the stale cached MP3 at browser + Cloudflare edge until the cache TTL expires. First-time listeners hear the new clip; hard-refresh bypasses for returning listeners. Today's admin UI explicitly warns about this in the per-beat Regenerate confirm dialog, and the live verification flow included a manual hard-refresh step.

**Investigation hints:**
- `src/pages/audio/[...path].ts` — the site-worker route serving R2 audio. Cache-Control header source.
- Options: (a) short-circuit cache on a known "recently regenerated" signal (would need D1 read per audio request — too expensive); (b) append a cache-buster to `public_url` on regen (e.g. `?v={request_id}`) and update the splice to propagate it — requires Publisher commit on every regen, undoes some of the Fix 2 benefit from `891c6f2`; (c) invalidate Cloudflare cache via API on regen (requires an API token + a write path from Director); (d) drop the `immutable` and lower `max-age` (trades universal browser cache speed for freshness — bandwidth cost).
- Option (c) is cleanest conceptually — regen is a rare operator action, not per-reader. Option (d) is the 5-minute fix if we just want "stop caching for a year."

**Priority:** low. Per-beat regen is an operator action; operators know to hard-refresh. Impact scales with regen frequency — if we start running it weekly for voice-contract improvements, priority becomes medium.

---

## [resolved] 2026-04-22: Admin / dashboard / public pages — full multi-per-day audit for pooling + stale references

**Status:** fully resolved across 9 commits on 2026-04-22. Observer events pooling (the original trigger) resolved via migration 0020. All 5 numbered points (including the daily_candidates.selected bug + residual WHERE date = ? + 3 admin/dashboard audit items surfaced 2026-04-22 evening) closed — see inline strikethroughs.

**Surfaced:** 2026-04-22 end of session. User viewing `/dashboard/admin/piece/2026-04-22/uk-bill-bans-.../` after the piece_id schema fix shipped noticed the **Observer events this day** section still pools both same-date pieces' events on each piece's page (admin-settings change + both pieces' `Published`, `Reflection`, `Audio failure`, `Audio published` events — 9 events total visible when the piece only generated ~3 of them). Intentional by the schema-fix design (kept as 36h day window) but not what an operator viewing a per-piece deep-dive expects. Broader request: a comprehensive audit of admin + dashboard + public surfaces for any remaining pooling, stale references, or inconsistencies the Phase 1-5 schema fix didn't address.

**Observer events on per-piece admin specifically — resolved 2026-04-22 (Phase B commit).** Fix path 1 chosen (schema over bandaid, per user preference). Migration 0020 added `observer_events.piece_id` + index. `agents/src/observer.ts` signature extended across 13 helpers with an optional trailing `pieceId`; `agents/src/director.ts` threads pieceId through all 13 call sites. Per-piece admin query now prefers piece_id match with a 36h day-of-publish OR-fallback for legacy NULL rows (pre-0020 events + site-worker writers that haven't threaded pieceId yet — site-side piece_id threading is a separate future task because `/api/zita/chat` doesn't currently receive piece_id from the client). System events (admin_settings_changed, zita_rate_limited) keep piece_id NULL permanently and only surface on the per-piece page via the 36h fallback window. See DECISIONS 2026-04-22 "observer_events.piece_id column for per-piece admin scoping".

**Broader admin + dashboard + public cleanup items to surface during the audit:**

1. **Admin home** (`/dashboard/admin/`):
   - ~~"All pieces" rounds + candidates counts keyed on `daily/${date}` / `date` — pools same-date pieces.~~ **Resolved 2026-04-22 (Phase C).** Both queries now bind on `piece_id IN (...)` using the SELECT's `id` column; tiebreaker `ORDER BY date DESC, published_at DESC` on the parent SELECT preserves publish order at multi-per-day. See DECISIONS 2026-04-22 "Admin + dashboard run log scoped by piece_id".
   - ~~Observer events section is global (last 30 by created_at DESC) — is that the right scope?~~ **Resolved 2026-04-22.** Raised LIMIT 30 → 100. The top stats (`openEscalations` + `errorsThisWeek`) already surface what-needs-attention; the feed stays as a chronological log. At current volume 100 rows ≈ 3-4 weeks; at hypothetical 1h cadence ≈ 10 hours.
   - ~~"All pieces" list links to per-piece admin page via `adminPieceHref(date, pieceId?)` — verify the slug lookup works for every historical piece.~~ **Resolved 2026-04-22.** Spot-checked all 7 production pieces via `curl` — each `/daily/{date}/{slug}/` URL returns 200. `adminPieceHref` helper uses `slugByPieceId` Map from the content collection and falls back to `slugByDate` when pieceId is absent (covers any legacy MDX that predates the content-schema pieceId requirement — none exist in production).
   - ~~Pipeline history (last 14 runs grouped by run_id = date) — at multi-per-day a "run" is a day, grouping hides per-piece run quality.~~ **Resolved 2026-04-22.** Switched to piece_id grouping via `LEFT JOIN daily_pieces ON dp.id = pl.piece_id` + correlated subquery keyed on piece_id (with null-fallback to run_id for any legacy rows). Each row shows date + headline + verdict. Orphan piece_ids (scanner-skipped / pre-publish errors) render as "(unpublished run)". `lifetimeRuns` stat unchanged — it still counts distinct run_ids (= distinct days), which is a valid day-level stat.
   - Engagement widget `GROUP BY piece_id` (migration 0017 post) — verify no stale `GROUP BY lesson_id` fragments.

2. **Admin Zita page** (`/dashboard/admin/zita/`):
   - ~~Groups conversations by `(user_id, piece_date)` — pools same-date pieces' chats into one conversation row.~~ **Resolved 2026-04-22 (Phase D).** `GROUP BY user_id, piece_id` now; headline lookup switched from `daily_pieces WHERE date IN (...)` (last-writer-wins at multi-per-day) to `WHERE id IN (...)`. Render loop keys on piece_id with piece_date fallback for legacy NULL rows. See DECISIONS 2026-04-22 "Admin Zita grouped by piece_id".
   - Per-piece admin's "Questions from readers" section already piece_id-scoped — verified untouched.

3. **Public dashboard** (`/dashboard/`):
   - ~~"Today's piece" hero at [`src/pages/dashboard/index.astro:59`](../src/pages/dashboard/index.astro) — open residual-sites entry below notes `WHERE date = ? LIMIT 1` picks arbitrary at multi-per-day. 1-line fix.~~ **Resolved 2026-04-22 (Phase C).** Added `ORDER BY published_at DESC` to the hero SELECT.
   - ~~Week pieces + run log rounds/candidates counts pooled by date.~~ **Resolved 2026-04-22 (Phase C).** Same piece_id join swap as admin home. Tiebreaker `ORDER BY date DESC, published_at DESC` on the parent SELECT.
   - "How it's holding up" signals, "What we've learned so far" panel, week's output stat grid — day-aggregates are correct as-is (they're legitimately day-level metrics); the only per-piece count in this section is `avgRoundsWeek` which derives from the now-piece-id-keyed roundsByPiece map and stays correct.
   - Recent pieces list + library list sorted by `published_at DESC` — already correct post-Phase-4.

4. **`daily_candidates.selected` never-flipped bug** — separate FOLLOWUPS entry, but audit surfaced it again: 0 rows across all 7 piece_ids have `selected=1`, so admin per-piece "Picked candidate marked with teal dot" never renders the teal dot. Curator's `selectedCandidateId` return value either isn't populated or doesn't match any candidate UUID. Investigate alongside this audit.

5. ~~**Frontmatter splice vs daily_pieces.word_count drift** — Drafter reports wordCount at draft time (e.g. 1080), Director's INSERT computes `currentMdx.split(/\s+/).length` on POST-splice MDX which adds a few words (voiceScore, publishedAt, pieceId frontmatter lines). Admin page shows the INSERT value (1086); pipeline timeline shows Drafter's value (1080). Minor; consider showing both or one canonical number.~~ **Resolved 2026-04-22.** Director's INSERT now uses Drafter's `wordCount` directly (captured at draft time) instead of re-computing on post-splice MDX. One source of truth: `drafting done` pipeline_log step and `daily_pieces.word_count` now agree. Existing historical rows stay as-is (no backfill — ~6-word drift per piece, cosmetic).

6. **Reset-today.sh at multi-per-day** — separate FOLLOWUPS entry, still open. Worth revisiting during the audit because the broken teal-dot + the reset-day semantic are both "day-keyed intent but multi-per-day reality."

**Investigation hints:**
- Start with a grep sweep: `grep -rn "WHERE date = \|WHERE run_id = \|WHERE task_id = 'daily/" src/ agents/src/`. Every match should be categorized as either "keep date-keyed (day-aggregate view)" or "switch to piece_id". The 7 day-aggregation queries from the 2026-04-22 piece_id schema fix plan are canonically kept; any new ones need the same classification.
- Admin per-piece page is the highest-visibility surface — start there. Public dashboard hero is next.
- For observer_events specifically: count events per piece per day to gauge how much pooling is happening — at 1/day it's a non-issue, at 12h it's ~2x, at 1h it's ~24x.

**Priority:** Medium. No correctness regression (data itself is honest, just pooled); UX fidelity for operators at multi-per-day. Not a blocker.

---

## [resolved] 2026-04-22: Late-caught multi-per-day blocker — same-date guard in `triggerDailyPiece` silently killed every non-first slot

**Surfaced:** 2026-04-22 afternoon. User flipped `admin_settings.interval_hours=12` evening of 2026-04-21. The 02:00 UTC run published normally. The 14:00 UTC slot was expected to produce a second piece and didn't — zero pipeline_log entry, zero observer event, dashboard showed no trace. User opened with "check the issue, don't guess".

**Hypothesis / root cause:** [agents/src/director.ts:140-146](../agents/src/director.ts:140) had a pre-Phase-3 guard: `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` → `if (existing) return null`. At `interval_hours=12`, the 14:00 UTC slot passed Phase 3's hourly gate (`(14 - 2 + 24) % 12 === 0`), entered `triggerDailyPiece`, matched the 02:00 UTC piece by calendar date, returned null *before* writing any logStep. Phase 1–7's multi-per-day audits keyed on `WHERE run_id = ?` paths and never examined this `WHERE date = ?` guard.

**Fix:** slot-aware guard + observer-on-skip. See DECISIONS 2026-04-22 "Slot-aware guard for multi-per-day cadence" for full trade-offs. Guard now queries `WHERE published_at >= ?` bound to slotStartMs (top of current UTC hour). New `observer.logDailyRunSkipped` info-severity event fires on same-slot re-dispatch — silent skip is no longer possible. Today's missed 14:00 UTC slot backfilled via `/daily-trigger` with force=true after deploy.

**Priority:** Blocker at any `interval_hours < 24`. At default 24, guard semantic is unchanged.

**Resolved:** `5922f43` (2026-04-22).

---

## [resolved] 2026-04-22: Admin Today's Run panel shows both pieces' steps as one flat stream at multi-per-day

**Surfaced:** 2026-04-22 PM during multi-per-day audit (two pieces shipped today at `interval_hours=12`). [`/api/dashboard/pipeline`](../src/pages/api/dashboard/pipeline.ts) returns all `pipeline_log` rows where `run_id = '<date>'`, which pools both pieces' ~13 steps each into one 26-step list with no visual break. Admin home (`/dashboard/admin/`) renders that list as-is — an operator reading top-to-bottom sees `audio-publishing ✓` run into `Scanner reads the news ·` with no hint that's a second run.

**Hypothesis:** cosmetic-only. Data is correct (per-piece admin deep-dive is piece-scoped as of DECISIONS 2026-04-22 "Time-window scoping for admin per-piece deep-dive"). Just needs UI grouping. Two paths:

1. **Frontend only:** in [`admin.astro`'s pollPipeline handler](../src/pages/dashboard/admin.astro), detect run boundaries by step name transitions (e.g. current step is `publishing done` or `audio-publishing done` or a new `scanning running` arrives while prior run terminated) and render as collapsible `<details>` blocks, one per run.
2. **Backend + frontend:** add `pipeline_log.piece_id` (blocked on the bigger schema item below), scope the API response by run, client renders clean groups.

Path 1 is shippable today; path 2 comes for free if the schema work lands.

**Priority:** Low. Scrollable, data is honest, per-piece deep-dive is the authoritative per-piece view.

**Resolved:** `e17c25e` (2026-04-22) via Phase 4 of the multi-per-day piece_id schema fix (path 2 — came for free once `pipeline_log.piece_id` landed in migration 0018). `/api/dashboard/pipeline` now returns `groups[]` and `headlines{}` keyed by piece_id; `admin.astro`'s poller renders each run as a collapsible `<details>` block titled with the piece headline + publish time, newest open by default. Deploy verified on production daylila.com. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".

---

## [resolved] 2026-04-22: Day-keyed tables (`audit_results`, `pipeline_log`, `daily_candidates`) lack `piece_id` — time-window scoping is the stopgap

**Surfaced:** 2026-04-22 during the admin per-piece deep-dive misattribution fix (DECISIONS 2026-04-22 "Time-window scoping for admin per-piece deep-dive"). The astro-site side of that bug landed via a `published_at`-bounded window on the 3 day-keyed queries. Acceptable stopgap at multi-per-day but not a proper fix:

1. **`audit_results`** — no `piece_id` column. Rows written by [`director.ts:942`](../agents/src/director.ts:942) with `task_id='daily/<date>'` and `draft_id='daily/<date>-r<N>'`. Both same-date pieces write identical draft_ids at round 1, so the admin page's group-by-draft_id (pre-fix) collided them with D1 last-writer-wins. Time-window scope side-steps the collision but doesn't remove the ambiguity in the table itself.
2. **`pipeline_log`** — no `piece_id` column (Phase 3 walk-back kept `run_id = YYYY-MM-DD` permanently after the 2026-04-21 site-worker consumer regression). Same pooling problem across all admin + dashboard + Learner + retry-audio consumers.
3. **`daily_candidates`** — no `piece_id` column. Two scanner runs on the same date write 50 rows each; candidates look pooled on the per-piece deep-dive without a time window.

**Hypothesis / real fix:**
- Migration: add nullable `piece_id TEXT` to all three tables. No PK rebuild needed (each already has its own primary key).
- Backfill: join `daily_pieces` on `date` at 1/day (unambiguous). At multi-per-day use time windows between `published_at` boundaries for the 2026-04-22 rows specifically — same logic that the astro-side stopgap uses.
- Director change: allocate `piece_id` at run start (currently allocated inside the publish step at [director.ts:286](../agents/src/director.ts:286)). Thread it through `saveAuditResults`, `logStep`, `daily_candidates` INSERT. Pre-allocation means pieces that never publish (scanner-skipped, error before publish) still have a piece_id for their rows — needs a "draft pieces" story or accept orphaned rows with a piece_id that never becomes a `daily_pieces.id`.
- Astro side: swap the 3 time-window queries for `WHERE piece_id = ?` direct lookups.
- Phase 3's `pipeline_log.run_id = YYYY-MM-DD` semantic is preserved — run_id stays date for the day-grouping view (admin pipeline history, reset-today.sh, etc.); `piece_id` is the additive per-piece axis.

**Investigation hints:**
- Director pre-allocation is the hard part. Current flow: Scanner → Curator → Drafter → audits → Integrator → Publisher (which allocates the UUID + INSERTs the piece). Moving allocation to run-start means the UUID exists before we know if a piece will even ship.
- Consumer audit beyond the admin page: `made.ts`, dashboard home, Learner's post-publish synthesis (time-window currently in `analysePiecePostPublish`), reset-today.sh `--piece-id`, audio retry-fresh DELETE, engagement writes (engagement.piece_id already shipped as migration 0017).
- Parallel site-worker query updates must land in the same deploy window to avoid the 2026-04-21 run_id regression pattern.

**Priority:** Medium. Time-window scope on admin per-piece is correct-enough that this isn't urgent. Promote to blocker only if operator trust in a same-date piece view slips, or if the 30min buffer edge case (manual audio retry hours later attributing to wrong piece in pipeline timeline) bites.

**Resolved:** `e17c25e` (2026-04-22) via the full 5-phase schema fix in this session. Migration 0018 added `piece_id` to `pipeline_log` (0014 had already added it to the other two); migration 0019 backfilled 512 historical rows (9 audit_results + 153 pipeline_log + 350 daily_candidates) with two strategies: date-join for pre-2026-04-22 1/day rows, midpoint-split for the 2026-04-22 multi-per-day rows. Director pre-allocates piece_id at run-start (moved from publish-time); `logStep()` + `saveAuditResults()` + `scanner.scan()` + `learner.analysePiecePostPublish()` all thread piece_id. Site-side admin page + `/api/daily/[date]/made.ts` + `/api/dashboard/pipeline.ts` all scope by piece_id. Midpoint bandaid deleted. Verified row-by-row against production D1: 0 NULL piece_id across all three tables, correct per-piece partitioning for 2026-04-22. Production admin pages confirmed post-deploy: tobacco shows AUDIT ROUNDS (1) with tobacco-only data, air-traffic shows ROUNDS (1+2) with its own data, admin home Today's Run shows two collapsible per-piece blocks. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables" for full phase details and trade-offs.

---

## [resolved] 2026-04-22: Residual `WHERE date = ? LIMIT 1` sites surfaced during slot-aware-guard audit

**Surfaced:** 2026-04-22 PM. Post-fix sweep for `WHERE date = ? LIMIT 1` across the repo (to confirm no other silent-skip paths) turned up two sites that aren't correctness blockers but pick an arbitrary same-date piece at multi-per-day:

1. ~~[src/pages/api/daily/[date]/made.ts:71](../src/pages/api/daily/[date]/made.ts) — the made-drawer's per-piece metadata lookup~~ **Resolved 2026-04-22 via Phase 4 of the piece_id schema fix.** `/api/daily/[date]/made` now accepts `?pieceId=` and prefers it for all 5 piece-scoped queries (metadata, timeline, audit rounds, candidates, audio); date-keyed path now uses `ORDER BY published_at DESC LIMIT 1`. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".
2. ~~[src/pages/dashboard/index.astro:59](../src/pages/dashboard/index.astro) — public dashboard's "today's piece" hero query.~~ **Resolved 2026-04-22 (Phase C commit).** Added `ORDER BY published_at DESC` to the hero SELECT so same-date pieces show the most-recently-published one, matching the homepage + daily-index sorts. See DECISIONS 2026-04-22 "Admin + dashboard run log scoped by piece_id".

**Hypothesis:** both existed pre-Phase-4 URL change and were missed by the Phase 4–7 audits. Neither blocks cadence — the slot-aware guard (resolved entry above) was the only real blocker. These are UX fidelity fixes.

**Investigation hints:**
- `dashboard/index.astro` — 1-line patch, add `ORDER BY published_at DESC` to the query.

**Priority:** Low. Only matters at multi-per-day; at `interval_hours=24` it's an unambiguous single-row query.

**Resolved:** 2026-04-22. Both sites (made.ts and dashboard/index.astro:59) now sort by `published_at DESC`. Fall-back for made.ts already shipped in Phase 4 of the morning's piece_id schema fix; dashboard/index.astro:59 shipped in the Phase C audit commit this evening.

---

## [resolved] 2026-04-21: Unblock multi-per-day flip — pre-run DELETEs + Learner input scoping

**Surfaced:** 2026-04-21 during the Phase 3 pipeline_log consumer audit (see DECISIONS 2026-04-21 "Multi-piece cadence — Phase 3 hourly cron + runtime gate"). Three sites in the agents worker are scoped by `WHERE run_id = ? .bind(today)` or equivalent and behave correctly at 1 piece/day but pool across pieces at multi-per-day. `interval_hours` cannot be flipped below 24 until these are resolved.

**Hypothesis / fix for each site:**

1. **[`agents/src/director.ts:109`](../agents/src/director.ts) — pre-run DELETE.**
   ```ts
   await this.env.DB.prepare('DELETE FROM pipeline_log WHERE run_id = ?').bind(today).run()
   ```
   Clears stale intra-day rows before a fresh run starts. At 1/day this correctly wipes an earlier failed attempt. At multi/day this wipes earlier completed runs' history when run 2+ starts. Fix options:
   - (a) Remove the DELETE entirely — pipeline_log accumulates forever, `scripts/reset-today.sh` remains the only wipe path.
   - (b) Scope by `created_at > (start-of-this-hour)` — delete only rows from "this hour's attempt".
   - (c) Scope by a new `piece_id` column filled from pre-allocated UUID — but that's a bigger schema + code change.
   - Lean option (a): simplest, log grows ~19-31 rows/day, 200-700/month at multi-per-day cadences. Negligible storage.

2. **[`agents/src/director.ts:783`](../agents/src/director.ts) — audio retry-fresh DELETE.**
   ```ts
   DELETE FROM pipeline_log WHERE run_id = ? AND step LIKE 'audio%'
   ```
   Retry-fresh semantic: wipe a day's audio attempt history. At multi/day this wipes audio logs across ALL that day's pieces, not just the one being retried. The retry target is already known per-piece by date — needs a piece-scoped filter. Blocks until either a piece_id column lands on pipeline_log or the retry path shifts to using `daily_piece_audio` as the truth (which is already piece-scoped post-Phase-1).

3. **[`agents/src/learner.ts:338`](../agents/src/learner.ts) — post-publish synthesis input.**
   ```ts
   SELECT step, status, data, created_at FROM pipeline_log WHERE run_id = ? .bind(date)
   ```
   Learner's `analysePiecePostPublish(date)` reads the pipeline log for the date to synthesise producer-origin learnings. At multi/day the SELECT returns ALL that day's pieces' steps, noisifying the synthesis with other pieces' data. Needs either per-piece scoping (piece_id column) or time-window scoping (only rows between the piece's run start and publish time, via a piece-specific timestamp range).

**Investigation hints:**
- Lean fix for (1): remove the DELETE, add nothing. Verify `reset-today.sh` still works as the manual wipe.
- For (2) and (3): adding `pipeline_log.piece_id` is the shared primitive. Requires Director to allocate piece_id at run start (not publish time) and pass through every `logStep` call. That's a Phase 3.5 / 4 concern.
- Test both before flipping: `UPDATE admin_settings SET value='4' WHERE key='interval_hours'`, let two runs complete same day, verify neither wiped the other.

**Priority:** Blocker for multi-per-day cadence. Not urgent otherwise — Phase 3 ships at `interval_hours=24` which exercises none of these paths.

**Resolved:** 2026-04-21 via three atomic commits in sequence:
- `ecedb87` — item #1 (pre-run `pipeline_log` DELETE removed). See DECISIONS "Remove pre-run pipeline_log DELETE."
- `900905d` — item #2 (audio retry-fresh + R2 key shape), plus a latent persistBeatRow NOT NULL bug found during scoping. See DECISIONS "Scope audio pipeline state per piece_id."
- `30ddbdd` — item #3 (Learner synthesis input scoped by time window). See DECISIONS "Scope Learner synthesis input by time window."

All three deploy clean through CI. Admin UI for interval flip (Phase 5) unblocked.

---

## [resolved] 2026-04-21: `writeLearning` doesn't persist `piece_id` — made-drawer pools at multi-per-day

**Surfaced:** 2026-04-21 during cadence Phase 6 (Zita synthesis timing + piece_id scoping) scoping. The Learner's synthesis path now scopes its INPUT by piece_id, but its OUTPUT writes via [`agents/src/shared/learnings.ts`](../agents/src/shared/learnings.ts) `writeLearning(...)` still only persists `piece_date`, not `piece_id`. At multi-per-day cadence, the made-drawer's per-piece "What the system learned" section ([`src/pages/api/daily/[date]/made.ts`](../src/pages/api/daily/[date]/made.ts) + [`src/interactive/made-drawer.ts`](../src/interactive/made-drawer.ts)) queries `WHERE piece_date = ?` — pools all same-date pieces' learnings into every piece's drawer.

**Hypothesis:** `writeLearning` signature extended to `(db, category, observation, evidence, confidence, source, pieceDate, pieceId)`. All four callers updated to thread piece_id alongside the existing piece_date arg:

1. `Learner.analysePiecePostPublish` — already takes pieceId since Phase 6 blocker #3. Pass it down.
2. `Drafter.reflect` — Director's `reflectOnPieceScheduled` payload needs pieceId. Propagate.
3. `Learner.analyseAndLearn` (reader-behaviour path) — needs pieceId derived from the engagement row's lesson_id. At multi-per-day the `lesson_id = daily/<date>` mapping breaks; decide between adding piece_id to engagement or deriving via a join.
4. `Learner.analyseZitaPatternsDaily` — already takes pieceId since this commit. Pass it down.

Made-drawer consumer updates in parallel: `/api/daily/[date]/made` already receives date in the URL; look up piece_id via `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` (post-Phase-4 route passes slug too, which would disambiguate at multi-per-day — use slug to find the exact piece), then filter `learnings WHERE piece_id = ?`.

**Investigation hints:**
- Made-drawer URL at post-Phase-4 is `/daily/{date}/{slug}/` and the `<made-drawer>` component fetches `/api/daily/{date}/made`. The API still takes date only — will need to accept slug too for piece-id resolution at multi-per-day.
- Drafter.reflect's call site at director.ts `reflectOnPieceScheduled` doesn't have pieceId in its current payload; scheduled from triggerDailyPiece which DOES have pieceId post-blocker-#2. Easy add.
- Reader-learn path (`analyseAndLearn`) is harder — engagement rows are keyed by `lesson_id` which was designed pre-multi-per-day. May need its own FOLLOWUPS depending on how engagement tracking evolves.

**Priority:** Medium. Not a blocker for multi-per-day flip itself (cadence switch works) but the per-piece drawer at multi-per-day shows wrong data until this lands. At `interval_hours=24` (current prod) the behaviour is correct because piece_date uniquely identifies a piece. So: required before flipping, not before shipping Phase 5/6 admin UI.

**Resolved:** 2026-04-22 — `writeLearning` signature extended with `pieceId` 8th param, 4 callers threaded, made-drawer + API scoped by piece_id, `pieceId` added to content schema and spliced into frontmatter by Director, 5 existing MDX files backfilled. Reader-engagement path (`analyseAndLearn`) is partial — derives piece_id via date lookup which is unambiguous at 1/day but picks arbitrary at multi/day. Engagement-table piece_id column is a separate FOLLOWUPS item (new entry below). See DECISIONS 2026-04-22 "writeLearning persists piece_id".

---

## [resolved] 2026-04-22: Admin per-piece deep-dive route is date-keyed — shows first-by-id at multi-per-day

**Surfaced:** Flagged as deferred in Phase 4 + Phase 5 DECISIONS entries. Reader-facing URLs moved to `/daily/YYYY-MM-DD/slug/` (Phase 4); admin per-piece route at [`src/pages/dashboard/admin/piece/[date].astro`](../src/pages/dashboard/admin/piece/[date].astro) stayed date-keyed. At `interval_hours=24` unambiguous (one piece per date). At multi-per-day the page's `SELECT * FROM daily_pieces WHERE date = ? LIMIT 1` picks arbitrary same-date piece.

**Hypothesis:** nested route `src/pages/dashboard/admin/piece/[date]/[slug].astro` mirroring the reader route. Admin home page ([`src/pages/dashboard/admin.astro:320`](../src/pages/dashboard/admin.astro)) link generation updated to include slug — use `deriveSlug` from [`src/lib/slug.ts`](../src/lib/slug.ts) against each piece's MDX entry id (needs `getCollection('dailyPieces')` at request time, same pattern Phase 4 introduced for the "View on site" link).

**Investigation hints:**
- Admin home page currently generates links as `/dashboard/admin/piece/${p.date}/`. Change to `/dashboard/admin/piece/${p.date}/${deriveSlug(entry.id)}/`. At 1/day the admin page would still show one piece per date URL; at multi-per-day each piece gets its own admin URL.
- Consider: keep backward compat by having `src/pages/dashboard/admin/piece/[date]/index.astro` render a list when multiple pieces share the date; redirect to the single piece when only one exists. Matches the cleaner-if-ambiguous principle.
- Page body uses `date` throughout for filters — switch to piece_id keyed where appropriate (audio already piece-id post-Phase-1; pipeline_log stays date-keyed per Phase 3 walk-back). "Questions from readers" section should scope by piece_id.

**Priority:** Low. UX degradation only at multi-per-day; at `interval_hours=24` the route is correct. Does not block the cadence flip.

**Resolved:** 2026-04-22 in commit `3208c86`. Nested route `src/pages/dashboard/admin/piece/[date]/[slug].astro` replaces the old flat `[date].astro`; new `[date]/index.astro` handles legacy URLs (302 to the single slug when unambiguous, disambiguation list at multi-per-day, "No piece" display when empty). Per-piece D1 queries scope by piece_id (daily_pieces `WHERE id = ?`, daily_piece_audio, zita_messages); day-scoped queries unchanged (audit_results, pipeline_log, candidates, observer_events — intentional day-view). Admin home link generator threads slug via a new `adminPieceHref(date, pieceId?)` helper driven off `getCollection('dailyPieces')`. zita.astro's deep-link left as `/dashboard/admin/piece/{date}/` — hits the new index.astro which routes correctly. See DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup — five-commit wrap".

---

## [resolved] 2026-04-22: `nextRunRelative()` on public dashboard assumes 02:00 UTC cron

**Surfaced:** 2026-04-22 during end-of-session audit. [`src/pages/dashboard/index.astro`](../src/pages/dashboard/index.astro) `nextRunRelative()` hard-codes the next 02:00 UTC slot for the subtitle ("Next run in Xh Ym"). At `interval_hours=24` (current prod) the value is correct. At multi-per-day the next run is any `(hour - 2 + 24) % intervalHours === 0` hour — the display would read wrong.

**Hypothesis:** read `admin_settings.interval_hours` at the top of the page (page already `prerender = false`, D1 is available), compute the next anchor-2-mod-interval slot. Extract the gate math into [`src/lib/cadence.ts`](../src/lib/cadence.ts) or similar so both Director (agents worker) and this dashboard page reference the same slot-math description (or duplicate the formula defensively like `ALLOWED_INTERVAL_HOURS` already is).

**Investigation hints:**
- Formula already in Director at [agents/src/director.ts](../agents/src/director.ts) `dailyRun` gate: `(hour - 2 + 24) % intervalHours === 0` passes. Reverse to compute next slot: find smallest `h > 0` where `((currentHour + h - 2 + 24) % intervalHours) === 0`.
- Server-render time uses `Date.now()`, so rate is deterministic at page-render moment.
- Keep the fallback hard-coded 02:00 UTC if the admin_settings read fails or returns a non-divisor — same defensive posture as Director's parseIntervalHours.

**Priority:** Low. Visible UX glitch if admin flips `interval_hours<24`; purely cosmetic, no data or behaviour consequence.

**Resolved:** 2026-04-22 in commit `7ebae47`. New [`src/lib/cadence.ts`](../src/lib/cadence.ts) holds `ALLOWED_INTERVAL_HOURS`, `parseIntervalHours`, `getIntervalHours(db)`, `nextRunAtMs(nowMs, intervalHours)`, `nextRunRelative(nowMs, intervalHours)`. Dashboard reads `admin_settings.interval_hours` at render time (defensive 24 fallback), passes through to three surfaces — subtitle, pending-state hint, no-runs-in-7-days hint — all now cadence-aware. 14 unit-test cases across {1,2,3,4,6,12,24} at two anchor times pass. Site-side `ALLOWED_INTERVAL_HOURS` duplication deduped: admin settings API now imports from cadence.ts. See DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup — five-commit wrap".

---

## [resolved] 2026-04-22: `reset-today.sh` has no `--piece-id` flag — deletes all same-date pieces

**Surfaced:** 2026-04-22 during Phase 7 audit. [`scripts/reset-today.sh`](../scripts/reset-today.sh) step 2 runs `DELETE FROM daily_pieces WHERE date = '$DATE'` (and same-date deletes for candidates, pipeline_log, audit_results, observer_events). At `interval_hours=24` one piece per date so "reset today" = "reset the one piece" — correct. At multi-per-day all same-date pieces get wiped. Sometimes that's the intent ("full-day reset"); sometimes the operator wants just one piece.

**Hypothesis:** add an optional `--piece-id <uuid>` flag. When provided, scope deletes by piece_id for tables with piece_id column (daily_pieces, audit_results, learnings, zita_messages, daily_piece_audio, daily_candidates post-Phase-1-backfill) and by a time-window lookup for pipeline_log (scope to the piece's creation window since run_id stays date-keyed per Phase 3 walk-back). Also git-rm only the matching MDX file rather than all `$DATE-*.mdx`.

**Investigation hints:**
- Without flag: keep current behaviour (wipe all of today) — explicit operator choice.
- With flag: need piece_id → MDX filename mapping. Either grep the MDX files for `pieceId: "<uuid>"` frontmatter, or accept `--slug` as an alternative and match filename by `$DATE-$SLUG.mdx`.
- Observer_events DELETE shouldn't need scoping — it's already time-windowed by `strftime('%s','now','start of day')`.

**Priority:** Low. Dev-operational tool for iteration. Works correctly at current cadence.

**Resolved:** 2026-04-22 in commit `205ce1e`. `--piece-id <uuid>` scopes wipe to that piece across 7 piece-id-capable tables (daily_pieces, daily_candidates, audit_results, daily_piece_audio, zita_messages, learnings, engagement); ±20min time-window filter for the two piece-id-less tables (pipeline_log kept date-keyed per Phase 3 walk-back, observer_events by `created_at`). Window math mirrors Learner's `LEARNER_PIPELINE_LOOKBACK_MS/LOOKAHEAD_MS`. `--retrigger` opt-in for single-piece re-runs (default is wipe-only because multi-per-day has no natural cron slot for a single-piece trigger). UUID validation prevents silent-zero-rows DELETE on typos. ADMIN_SECRET only required when a trigger actually fires. RUNBOOK updated with both modes. See DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup — five-commit wrap".

---

## [resolved] 2026-04-22: Copy cleanup — "one piece per day" / "every morning at 2am UTC" phrasing at multi-per-day

**Surfaced:** 2026-04-22 during Phase 7 audit. Several copy-visible files still phrase the cadence as fixed at one-piece-per-day + 02:00 UTC. At multi-per-day these read wrong.

**Hypothesis:** grep for specific strings:
- `"every morning at 2am UTC"` — likely in README, book chapters, marketing copy.
- `"one piece per day"` / `"one piece, every morning"` — same places.
- Dashboard footer / about text if any.

Replacement strategy: either neutral ("every morning" / "on cadence") OR accurate-at-current-cadence ("at 02:00 UTC, one piece per day by default; admin-configurable"). Cadence decision #9 in Phase 1 DECISIONS: "keep 'daily'" as the reading-rhythm framing. Prose should reflect rhythm not rate.

**Investigation hints:**
- Grep: `grep -rn "2am UTC\|every morning\|one piece per day" --include="*.md" --include="*.astro" --include="*.ts"`.
- Likely files: `README.md`, `book/*.md`, `src/pages/index.astro` "no piece today" branch (line 82 area), `docs/ARCHITECTURE.md`, `docs/handoff/*.md`.
- Handoff docs (`docs/handoff/`) are frozen historical specs — don't touch.
- The Phase 1 decision #9 ("keep daily") is load-bearing — don't rebrand to "hourly" across the board.

**Priority:** Low. Cosmetic prose. Not time-sensitive.

**Resolved:** 2026-04-22 in commit `19910d7`. 10 files touched: README.md intro + book ch 8/9/99 (author-narrative) + book is left forensic for chapter 10's 2026-04-19 walkthrough + src/pages/index.astro + src/pages/dashboard/index.astro footer + docs/{ARCHITECTURE, AGENTS, RUNBOOK, CLAUDE.md}. Reader-visible marketing moved to neutral rhythm language ("every morning" / "each morning"); operational docs spell out the current default explicitly ("hourly cron gated by `admin_settings.interval_hours`, 24 → only 02:00 UTC fires; admin-configurable"). Zita synthesis row in RUNBOOK also updated to publish+23h45m per piece (Phase 6 reality). Historical references intentionally left alone: DECISIONS (append-only), handoff/ specs, book chapter 10's forensic 2026-04-19 walkthrough. See DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup — five-commit wrap".

---

## [resolved] 2026-04-22: `engagement` table has no `piece_id` — reader-path attribution ambiguous at multi-per-day

**Surfaced:** 2026-04-22 during the writeLearning piece_id extension. Learner's `analyseAndLearn` (reader-engagement path) derives piece_id via `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` because `engagement` rows are keyed by `lesson_id` (string like `daily/YYYY-MM-DD`) and don't carry piece_id directly. At `interval_hours=24` the lookup is unambiguous; at multi-per-day the same date has multiple pieces and the LIMIT 1 picks an arbitrary one — learnings written under that reader signal would attribute to the wrong piece.

**Hypothesis:** add `engagement.piece_id TEXT` column + backfill historical rows + update the lesson-shell writer ([`src/interactive/lesson-shell.ts`](../src/interactive/lesson-shell.ts) + its POST endpoint) to resolve piece_id from the piece's `data-piece-id` attribute (available post-Phase-7 on every piece page) and include it in the engagement write.

**Investigation hints:**
- lesson-shell has access to `piece.data.pieceId` via Astro server render context. Pass it into the engagement POST body.
- Migration: `ALTER TABLE engagement ADD COLUMN piece_id TEXT;` plus `CREATE INDEX idx_engagement_piece_id`. Backfill existing rows via `piece_date → daily_pieces.id` join — at 1/day unambiguous for all historical engagement data.
- Once engagement has piece_id, `Learner.analyseAndLearn` reads it directly, no date-lookup, no partial-fix caveat.

**Priority:** Low. Reader engagement writes land in prod but the Learner reader-path is effectively dormant (no real reader traffic volume yet). At flip time, multi-per-day reader attribution is partial but not visibly wrong — no live reader reports hit the drawer's learnings-by-piece view yet. Address when real reader volume + multi-per-day cadence overlap.

**Resolved:** 2026-04-22 in commit `9d20b81`. Migration 0017 rebuilt `engagement` with PK `(piece_id, course_id, date)`; 13 historical rows backfilled from daily_pieces via date-join (5 piece_ids, 0 NULLs). Snapshot `engagement_backup_20260422` held for 7-day rollback. rehype-beats reads `pieceId` from MDX frontmatter and injects `data-piece-id` on the auto-generated `<lesson-shell>`; lesson-shell POSTs it to `/api/engagement/track`; the endpoint falls back to a date lookup for stale bundles (acceptable for the edge case, new bundles always send it). Learner's `analyseAndLearn` reads piece_id directly off the engagement row — no more date-based arbitrary lookup; `analyse()` GROUP BY switched to piece_id so same-date pieces stay separate. Admin widget query joins daily_pieces on piece_id. Resolves the "partial fix at multi-per-day" note in DECISIONS 2026-04-22 "writeLearning persists piece_id" §2.4.

---

## [open] 2026-04-26: Drop `interactives_backup_20260426` snapshot

**Surfaced:** 2026-04-26 alongside migration 0026 (Interactives v3 Phase 2 sub-task 2.5). The 8-row snapshot was created as a free-rollback safety net for the `interactives` table rebuild that relaxed `UNIQUE(slug)` → `UNIQUE(slug, type)`. Should be dropped on or after **2026-05-04** once Phase 2.6+ has been live for a week and the new composite UNIQUE has been exercised by at least one Generator run that committed both quiz + html on the same slug.

**Hypothesis:** None — housekeeping, not a bug. Tiny (8 rows) so cost of keeping a few extra days is nothing. The retention window gives time to spot any column-shape regression that the post-apply verification might have missed (the migration carried 13 columns through an explicit INSERT...SELECT, so a column-rename or NOT-NULL drift is theoretically detectable here).

**Investigation hints:**
- Before dropping: re-run the post-apply verifier (`SELECT COUNT(*) FROM interactives` should equal 8 + however many new rows have committed since 2026-04-26; `PRAGMA index_list(interactives)` should show 3 named indexes + `sqlite_autoindex_interactives_1` from `UNIQUE(slug, type)`).
- Drop command: `DROP TABLE interactives_backup_20260426;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** low — housekeeping.

---

## [resolved] 2026-04-22: Drop `engagement_backup_20260422` snapshot

**Surfaced:** 2026-04-22 alongside migration 0017 (Phase 7 engagement piece_id). The 13-row snapshot was created as a free-rollback safety net for the engagement table rebuild. Should be dropped on or after **2026-04-29** once the new `(piece_id, course_id, date)` PK has absorbed at least a week of reader-path writes without shape regressions.

**Hypothesis:** None — housekeeping, not a bug. Retention window gives time to detect any row-shape regression the manual verification missed. Tiny (13 rows) so cost of keeping a few extra days is nothing.

**Investigation hints:**
- Before dropping: re-run the post-backfill verification (`SELECT COUNT(*) AS total, COUNT(DISTINCT piece_id) AS unique_pieces FROM engagement`) and confirm the 5 piece_id groups still match.
- Drop command: `DROP TABLE engagement_backup_20260422;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** Low. One-line operational task, no downstream dependency.

**Resolved:** 2026-04-26 — `DROP TABLE engagement_backup_20260422;` executed on remote D1 in this session's docs-cleanup commit (3 days inside the 2026-04-29 retention window, accelerated as part of the cleanup pass). Migration 0017's `(piece_id, course_id, date)` PK has been writing reader-path rows for 4 days without shape regression.

---

## [resolved] 2026-04-21: `daily_candidates.selected` never flipped on historical runs

**Surfaced:** 2026-04-21 during multi-piece cadence Phase 1 sizing audit. Prod `daily_candidates` has 250 rows across 5 dates (50/day, consistent with Scanner's `MAX_CANDIDATES_PER_DAY` cap) but **zero rows have `selected = 1`** — meaning no historical daily_candidates row maps back to the piece it became. Director's post-curation UPDATE at [director.ts:150-156](../agents/src/director.ts) is wrapped in `.run().catch(() => {})` which silently swallows any error.

**Hypothesis:** Three candidates:
1. `curatorResult.selectedCandidateId` is falsy in the returned shape, so the UPDATE is skipped by the truthy guard (`if (curatorResult.selectedCandidateId)`). Would be visible in the admin Director logs if the selected id was empty.
2. The id string shape mismatches between Scanner's write (`agents/src/scanner.ts:120` uses `crypto.randomUUID()`) and Curator's return. Curator's prompt may be returning a truncated or different-shape identifier.
3. The UPDATE runs but throws — `.catch(() => {})` swallows with no observer event, so it's invisible in the admin feed.

**Investigation hints:**
- Pull the most recent Curator output from admin dashboard (task-level data) and compare `selectedCandidateId` returned vs the IDs in `daily_candidates` for that date.
- Temporarily replace the `.catch(() => {})` with a `.catch(err => observer.logError(...))` to expose silent failures.
- Matters for Phase 3: with piece_id FKs in place, Director should set `daily_candidates.piece_id` and `selected=1` atomically for the winning candidate. Won't help if the current code path never fires the UPDATE.

**Priority:** Medium. Non-blocking for Phase 1 (piece_id column added nullable), but Phase 3's admin observability depends on being able to trace "which candidate became which piece." Investigate alongside or before Phase 3.

**Resolved:** 2026-04-22 — root cause was hypothesis #2: `buildCuratorPrompt` in [agents/src/curator-prompt.ts](../agents/src/curator-prompt.ts) rendered candidates as a numbered list with headline/source/summary but **never included the candidate UUID**, so Claude had no real `id` to return. Whatever string Claude emitted for `selectedCandidateId` matched 0 rows, and `.run().catch(() => {})` at [director.ts:227-232](../agents/src/director.ts) hid it. Fixed in two parts: (1) prompt now shows `id: <uuid>` next to each candidate plus an explicit "MUST be the exact id string" instruction; (2) silent catch replaced with try/catch that inspects `meta.changes` and logs via `observer.logError` on both throw and 0-rows, plus a third branch that logs when Curator returns no `selectedCandidateId` at all. Three regression modes now visible in the admin observer feed. Historical 250 rows of `selected=0` stay as-is (no backfill — the winning id for those runs is not recoverable). See DECISIONS 2026-04-22 "Curator prompt exposes candidate UUIDs".

**Update 2026-05-06 — historical backfill shipped (Foundation Fix Task 03).** The "no backfill — winning id not recoverable" claim above is superseded. A normalized-headline match scoped by `(date, source)` with `date <= '2026-04-22'` recovers the winning candidate for all 7 pre-fix pieces (2026-04-17 through 2026-04-22, with 2026-04-22 carrying two pieces). Script: [`scripts/backfill-selected-flag.sql`](../scripts/backfill-selected-flag.sql). Idempotent. Applied to remote D1 in commit `8500462`; verification SELECT confirmed `picked_count = 1` per piece. The audit's suggested `daily_pieces.id → daily_candidates.piece_id` join was structurally wrong on this codebase (Scanner stamps `piece_id` on every candidate row at INSERT time, not just the picked one). See DECISIONS 2026-05-06 "L1, L2, L25 closed".

---

## [resolved] 2026-04-21: Drop `daily_piece_audio_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0015 (multi-piece cadence Phase 1). The 32-row snapshot was created as a free-rollback safety net for the daily_piece_audio PK rebuild. Should be dropped on or after **2026-04-28** once Phase 3 has been live for a week and queries against the new `(piece_id, beat_name)` PK have been exercised by at least one real multi-per-day run.

**Hypothesis:** None — housekeeping, not a bug. Retention window gives us time to detect any row-shape regressions in the new table that manual verification missed. Small (32 rows) so cost of keeping it a few extra days is nothing.

**Investigation hints:**
- Before dropping: re-run the verification query from migration 0015 (`SELECT piece_id, COUNT(*) FROM daily_piece_audio GROUP BY piece_id ORDER BY piece_id`) and confirm the 5 piece_id groups match the snapshot's 8+6+6+6+6 distribution.
- Drop command: `DROP TABLE daily_piece_audio_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** Low. One-line operational task, no downstream dependency.

**Resolved:** 2026-04-26 — `DROP TABLE daily_piece_audio_backup_20260421;` executed on remote D1 in this session's docs-cleanup commit. 32-row snapshot retained 5 days past the 7-day retention window; migration 0015's `(piece_id, beat_name)` PK has been exercised across multi-per-day cycles since Phase 3, no row-shape regressions observed.

---

## [resolved] 2026-04-21: Drop `pipeline_log_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0014's manual backfill UPDATEs (multi-piece cadence Phase 1). The 111-row snapshot was created before rewriting `pipeline_log.run_id` from `YYYY-MM-DD` strings to `daily_pieces.id` UUIDs. **Update 2026-04-21 (same day): the backfill was rolled back — the snapshot was consumed for that rollback.** See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill". The snapshot still holds the correct pre-rewrite values (which are also the current live values, since they were restored from it) — keeping it through 2026-04-28 gives a second-attempt audit window before Phase 3 re-approaches adding a `piece_id` column to this table.

**Hypothesis:** None — housekeeping.

**Investigation hints:**
- Before dropping: verify `SELECT run_id, COUNT(*) FROM pipeline_log GROUP BY run_id` matches the snapshot distribution (5 date-shape run_ids, 31/23/19/19/19 = 111 rows). If anything has drifted, don't drop.
- Drop command: `DROP TABLE pipeline_log_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry.

**Priority:** Low.

**Resolved:** 2026-04-26 — `DROP TABLE pipeline_log_backup_20260421;` executed on remote D1 in this session's docs-cleanup commit. 111-row snapshot already served its purpose as the rollback source on 2026-04-21 evening (when the run_id backfill was reverted); current `pipeline_log.run_id` values have been stable since. No further audit needed.

---

## [resolved] 2026-04-21: Drop `zita_messages_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0013 Commit A. The 92-row snapshot was created as a free-rollback safety net while verifying the hand-mapped content-based backfill of `zita_messages.piece_date`. Should be dropped on or after **2026-04-28** once Phase 1 Commit B has been live for a week and the per-piece distribution (`SELECT piece_date, COUNT(*) FROM zita_messages GROUP BY piece_date`) has remained stable through at least one full daily cycle with new writes.

**Hypothesis:** None — this is housekeeping, not a bug. The retention window is to give us one admin Zita view session (Phase 3) against real data, during which a bad mapping would become visible in grouping before it ages out of easy correction.

**Investigation hints:**
- Before dropping: re-run the verification SELECT from migration 0013 Step 3 and compare against the expected distribution documented in the migration file.
- Drop command: `DROP TABLE zita_messages_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** Low. One-line operational task, no downstream dependency.

**Resolved:** 2026-04-26 — `DROP TABLE zita_messages_backup_20260421;` executed on remote D1 in this session's docs-cleanup commit. 92-row snapshot held through the Phase 3 admin Zita view and Phase 4–6 Zita work; piece_date distribution remained stable across the retention window.

---

## [resolved] 2026-04-19: Publisher.publishAudio double-fires on Continue retry path

**Surfaced:** 2026-04-19 during retro audio generation for 2026-04-17. Admin "Continue" retry button (after a mid-pipeline silent stall at 4/8 beats) produced two `audio-publishing done` events in observer_events: 543651b (first, correct) and 02882fd (second, corrupted). The second commit deleted the audioBeats map and collapsed `qualityFlag: "low"\n---\n` onto a single line `qualityFlag: "low"---`.

**Hypothesis:** Two bugs stacked:
1. The Continue path in Director fires a full `runAudioPipeline` instead of resuming from the last-written beat. First producer call ran all 4 remaining chunks (total 8 beats, 4 chunks); second producer call ran 1 chunk as no-op (all R2 objects already present). Both calls still flowed through to Audio Auditor and Publisher.
2. Publisher's second `publishAudio` call should have no-op'd via the `updatedMdx === current.mdx` guard at [publisher.ts:103](../agents/src/publisher.ts:103). It did not. Instead, `spliceAudioBeats` produced `qualityFlag: "low"---` with no YAML terminator — a state that the regex logic on paper should not be able to generate. Needs a trace with actual inputs captured.

**Investigation hints:**
- Read `agents/src/publisher.ts:230-247` (spliceAudioBeats). Confirm both regexes behave as expected when called with (a) a file that already contains the full audioBeats block and (b) the same audioBeats map that was spliced last time. On paper the idempotent guard should fire.
- Check `getFileContent` — could it be returning stale/cached content from GitHub's API such that `current.mdx` doesn't reflect 543651b's post-state? If so the guard compares against wrong baseline.
- Check Director's Continue path (`runAudioPipelineScheduled` + retryAudio) for whether it dedupes already-completed beats before invoking Producer. If Producer runs at all on Continue-when-already-done, Publisher will also get re-invoked.

**Priority:** Medium. Manual recovery is a `git revert` (small, safe). Automated daily pipeline (2am UTC cron) does NOT exercise the Continue path, so tonight's run is unaffected. But any future manual retry risks corrupting the frontmatter again until this is fixed.

**Resolved:** 2026-04-22 — root cause was bug 2 (the regex), not bug 1 (the double-fire). `spliceAudioBeats`'s strip regex `/\naudioBeats:\n(?:  .+\n)*/` consumed the leading `\n` before `audioBeats:`. On re-splice of an already-spliced file, strip produced `qualityFlag: "low"---\n` (newline lost), the splice regex then couldn't find `\n---\n` and became a no-op, and the idempotent guard `updatedMdx === current.mdx` failed because `withoutExisting` ≠ `current.mdx` — so publisher committed the stripped-but-not-respliced file. Fixed by capturing the leading newline `/(\n)audioBeats:\n(?:  .+\n)*/ → '$1'`. Covered by `agents/scripts/verify-splice.mjs` (4 test cases, runs as `pnpm verify-splice`). Double-firing is addressed separately by Phase E2 retryAudio short-circuit (below FOLLOWUPS). See DECISIONS 2026-04-22 "spliceAudioBeats regex consumed leading newline".

---

## [resolved] 2026-04-20: StructureEditor writes violation-shaped observations into learnings, not forward-going lessons

**Surfaced:** 2026-04-20 during Commit 2 of Build 2. The per-piece drawer's "What the system learned from this piece" section surfaces `learnings.observation` verbatim. For pieces written before P1.3/P1.4 (pre-2026-04-19), the only producer-origin writer was StructureEditor, whose rows read as raw audit violations ("Hook exceeds one screen - it's two full paragraphs with ~120 words") — the rule-break itself, not a forward-going pattern the Drafter should apply. Reads starkly in the drawer next to Learner/Drafter-reflect writes that phrase observations as applicable lessons.

**Hypothesis:** `agents/src/structure-editor.ts:47` passes `result.issues[i]` / `result.suggestions[i]` directly as the `observation` argument. The StructureEditor prompt produces audit-time diagnostic language, not forward-going lesson language. Two possible fixes:
1. Prompt-level retune: teach StructureEditor to rewrite each issue/suggestion into lesson-shaped prose before writing (e.g. "Keep the hook within one screen — two-paragraph hooks exceed the budget" instead of "Hook exceeds one screen…").
2. Drop StructureEditor's writeLearning calls entirely. `Learner.analysePiecePostPublish` (P1.3) already reads `audit_results` and synthesises producer-origin learnings from them post-publish, and it writes lesson-shaped prose. If the sets substantially overlap, StructureEditor's writes are redundant; dropping them removes the tone mismatch without a prompt retune.

**Investigation hints:**
- Diff the set of learnings Learner.analysePiecePostPublish writes against what StructureEditor writes for the same piece. If Learner already covers the ground, option 2 is cleaner.
- 2026-04-17's drawer shows 4 StructureEditor learnings, all violation-shaped. No Learner rows for that piece (predates P1.3). Good test case once the next pipeline run has fresh data from both writers on the same piece.

**Priority:** Low. The drawer faithfully surfaces what the system wrote — honesty beats prettiness. Retune when next retuning StructureEditor.

**Resolved:** 2026-04-20 — chose Option 2. Investigation compared SE's 4 rows for 2026-04-17 QVC vs Learner's 5 producer rows for 2026-04-20 Hormuz: Learner reads `audit_results` so SE's findings are *input* to the synthesis, SE emits duplicates within a single audit (2 of 4 QVC rows repeated "hook exceeds one screen"), and SE's rows teach Drafter rules the Structure Editor prompt already enforces. Dropped the writeLearning call + issues/suggestions loop from `agents/src/structure-editor.ts`; unused `writeLearning` import and `pieceDate` parameter on `review()` removed alongside; Director's call site updated. Historical rows stay in D1 and age out of Drafter's `getRecentLearnings(10)` as new Learner / Drafter-reflection writes accumulate. See DECISIONS 2026-04-20 "Drop StructureEditor's writeLearning calls".

---

## [resolved] 2026-04-20: D1 migration tracker out of sync on first `wrangler d1 migrations apply`

**Surfaced:** 2026-04-20 while applying migration 0012. First run of `wrangler d1 migrations apply zeemish --remote` tried to replay ALL 12 migrations from scratch — the `d1_migrations` tracker table was empty, so wrangler thought nothing had been applied. 0001–0008 (CREATE TABLE IF NOT EXISTS) succeeded idempotently, 0009 (`ALTER TABLE ADD COLUMN quality_flag`) failed with `duplicate column name` because the column already existed from an earlier ad-hoc apply. Recovered manually by `INSERT INTO d1_migrations (name) VALUES ('0009_*'), ('0010_*'), ('0011_*');` then re-running `migrations apply`, which then only applied 0012.

**Hypothesis:** All prior migrations were applied ad-hoc via `wrangler d1 execute --file migrations/NNNN_*.sql` (or via the Cloudflare dashboard's query console) rather than through `wrangler d1 migrations apply`. Those bypass paths run the SQL but don't write to `d1_migrations`. Migration 0012 was the first to go through `migrations apply`, so it triggered the full replay.

**Investigation hints:**
- Check git history / project chat logs for how 0001–0011 were originally applied. If ad-hoc, document the expected path going forward (always `migrations apply`) in `docs/RUNBOOK.md`.
- Consider adding a pre-migration hygiene check to a future deploy script: `SELECT COUNT(*) FROM d1_migrations` — if the count doesn't match the number of `.sql` files in `migrations/` minus any pending, warn before running `apply`.
- Alternatively, future migrations could start with a defensive comment block explaining how to verify the tracker state before applying, so the next person doesn't hit the same surprise.

**Priority:** Low. One-time recovery is done; the tracker is now in sync (12 rows, 0001–0012). But the next contributor who adds migration 0013 will avoid a same-shape failure only if they run `apply` on a DB whose tracker is already correct — which from now on it will be.

**Resolved:** 2026-04-20 — added a `### Migration tracker hygiene` subsection to [docs/RUNBOOK.md](RUNBOOK.md) covering (a) use `migrations apply`, not `execute --file` or `execute --command`, (b) the pre-flight `SELECT name FROM d1_migrations ORDER BY id` check, and (c) a link to the 2026-04-20 DECISIONS recovery steps rather than re-documenting the procedure. Existing `### Run migrations` block left intact as fresh-DB bootstrap documentation with a pointer from the new section.

---

## [wontfix] 2026-04-20: D1 rejects correlated subqueries referencing the outer table in SELECT projection / UPDATE SET

**Surfaced:** 2026-04-20 running migration 0012's one-time backfill. The commented backfill in the migration file used the standard SQLite pattern for a nearest-timestamp join:
```sql
UPDATE learnings SET piece_date = (
  SELECT dp.date FROM daily_pieces dp WHERE dp.published_at IS NOT NULL
  ORDER BY ABS(dp.published_at - learnings.created_at) ASC LIMIT 1
) WHERE ...;
```
D1 rejected this with `no such column: learnings.created_at` — the inner subquery can't resolve the outer table. Same error on the SELECT preview variant using `l.created_at` alias. Rewrote the backfill as two date-equality UPDATEs (same outcome for this 13-row case, because every `created_at` landed on the same calendar day as its corresponding piece's `published_at`) and shipped. Migration file's comment block was updated post-hoc to match what actually ran.

**Hypothesis:** D1's query planner (libSQL fork) may not support the full SQLite correlated-subquery semantics that stock SQLite does. Plain SQLite 3.33+ supports this pattern natively. Needs a minimal reproducer filed at [workers-sdk#new-issue](https://github.com/cloudflare/workers-sdk/issues/new/choose) to confirm it's a D1 limitation vs. a wrangler shell-quoting quirk (reasonably confident it's the former based on the error text and two failed attempts with different aliasing).

**Investigation hints:**
- Build a minimal repro on a scratch D1: two tables, correlated subquery in SELECT projection, see if it fails on real D1 vs. local `miniflare`. If consistent, file the issue.
- For future UPDATEs that need nearest-timestamp joins, use either: (a) `UPDATE … FROM (subquery) WHERE learnings.id = mapping.id` if D1 supports the PostgreSQL-style syntax, (b) `UPDATE … SET col = (SELECT …)` where the inner subquery avoids touching the outer table, or (c) direct explicit updates per value cluster (what we did here).
- If this turns out to be a real D1 limitation, add a note to `docs/DECISIONS.md` so future migrations avoid the pattern upfront.

**Priority:** Low. Unblocks nothing today; the 0012 backfill shipped via the rewrite. Only matters again when a future migration wants a similar nearest-X backfill against existing rows.

**Won't fix:** 2026-04-26 — D1 limitation that blocks nothing; the workaround patterns are documented in the entry. No current or planned migration needs the rejected pattern. Documenting as platform-shape rather than tracking as actionable. Reopen if a future migration wants nearest-X backfill semantics.

---

## [resolved] 2026-04-20: `/api/dashboard/today.ts` appears to be uncalled dead code

**Surfaced:** 2026-04-20 during Build 1 of the dashboard Memory panel. Treated `today.ts` as the canonical convention example for the new `memory.ts` endpoint. Grep for `/api/dashboard/today` across the repo turns up matches only in docs (`docs/DECISIONS.md`, `docs/RUNBOOK.md`, `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md`) — no TypeScript / Astro / HTML consumer. The public dashboard page queries D1 directly in its Astro frontmatter; admin uses its own client-side fetches against different endpoints.

**Hypothesis:** The endpoint is a leftover from an earlier dashboard design where the public view was client-rendered. After the 2026-04-18 dashboard refocus (server-rendered via frontmatter queries), it was never removed. Safe to delete — no runtime caller.

**Investigation hints:**
- Confirm by grepping the built worker bundle (`dist/_worker.js/`) and the admin dashboard's client-side JS for any late-binding reference.
- Check `src/pages/api/dashboard/*.ts` for other similar zombies (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) — the same 2026-04-18 refocus may have orphaned others.
- Before deletion, decide whether to keep a minimal public JSON surface for future external consumers (a "public API" posture) or commit to server-rendered-only and remove all orphans.

**Priority:** Low. Dead code adds surface area but doesn't break anything. Fold into a future API-layer cleanup sweep.

**Resolved:** 2026-04-20 — endpoint file deleted; RUNBOOK verify step rewritten to use a `wrangler d1 execute` query; RUNBOOK's public API list pruned. `docs/DECISIONS.md:556` and `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md:200` left intact (append-only convention + frozen handoff spec). Sibling endpoints (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) not audited in this pass — logged as its own followup. See DECISIONS 2026-04-20 "Remove /api/dashboard/today".

---

## [resolved] 2026-04-19: Audio pipeline silent stall between alarm chunks on longer pieces

**Surfaced:** 2026-04-19 during retro audio for 2026-04-17. First retry attempt stopped at 4 of 8 beats. No `audio-failed` event in observer_events. No error logged. Alarm chain simply stopped firing. User clicked Continue and the pipeline resumed and finished cleanly.

**Hypothesis:** Even with alarm-based audio + keepAlive + Phase F chunking (2 beats per RPC, alarm-scheduled), the alarm chain can break silently between chunks on longer pieces — likely when a producer chunk + auditor + self-reschedule exceeds its wall budget but doesn't throw, so no failure event is emitted. Continue is the correct recovery path. But the lack of any signal means nobody knows the pipeline stopped until a reader notices missing audio.

**Investigation hints:**
- Add a watchdog alarm that fires N minutes after `runAudioPipelineScheduled` starts and checks whether `has_audio == 1`. If not and no `audio-*` events since the watchdog armed, emit `audio-stalled` into observer_events.
- When P1.3 ships (Learner reads producer-side signals), add a learning heuristic: `audio.beats < piece.beatCount AND zero audio-failed events within N hours of audio-started` → flag as silent stall pattern.
- Could also be the DO eviction cliff extending beyond what keepAlive's heartbeat covers under ElevenLabs latency variance — consider a longer heartbeat or doubling the keepAlive grace window.

**Priority:** Medium. Continue recovers cleanly, so no data is lost. But the silent failure mode is a class-of-bug concern: any future retry that silently stalls leaves the piece in partial state indefinitely.

**Resolved:** 2026-04-22 (Phase E3 of audio retry trio fix). `runAudioPipelineScheduled` at [`agents/src/director.ts`](../agents/src/director.ts) now schedules a 12-min watchdog via `this.schedule(12 * 60, 'checkAudioStalled', {pieceId, date, title, armedAt: Date.now()})`. New method `checkAudioStalled(payload)` runs three checks: (1) has_audio=1 → no-op (pipeline completed), (2) any `Audio failure` observer_event for this pieceId created since armedAt → no-op (pipeline already reported its failure), (3) otherwise emit `logAudioFailure(phase='producer', reason='Silent stall — audio pipeline exceeded 12min watchdog...')` as an escalation. The 12-min timing gives the outer alarm (15-min wall budget) 3-min headroom so the watchdog fires while or just after the outer alarm terminates. Happy path cost is one no-op alarm fire. See DECISIONS 2026-04-22 "12-min watchdog alarm for silent audio stalls".

---

## [wontfix] 2026-04-19: Title-case articles/conjunctions in humanize() or at the Drafter

**Surfaced:** 2026-04-19 during P2.1 retrofit. `humanize("what-is-a-chokepoint")` produces "What Is A Chokepoint" — the capital "A" is technically correct letter-by-letter but stylistically wrong for English title case, which lowercases articles, conjunctions, and short prepositions (under 4 letters) except when they're the first word.

**Hypothesis:** Two paths to fix, separate decision:
1. Teach `humanize()` in `src/lib/rehype-beats.ts` about English title-case rules — lowercase a short stop-word list (a, an, the, and, or, but, of, to, in, on, at, by, for, with) unless it's the first word.
2. Upgrade Drafter to write display-formatted `##` headings directly (e.g. `## What Is a Chokepoint`) so neither humanize() nor the `beatTitles` override is needed for new pieces.

Option 2 is the more durable fix — it aligns with the parallel durable fix already tracked in CLAUDE.md for the broader kebab→display lossiness (acronyms, punctuation). Option 1 is a smaller bandaid that still benefits retroactive pieces where Drafter output can't be changed.

**Investigation hints:**
- Option 1: add a stop-word list + first-word rule to `humanize()`. Kept out of today's scope because 2026-04-18 is the only current piece with the aesthetic issue and the user judged it non-corrective.
- Option 2: update `DRAFTER_PROMPT` in `agents/src/drafter-prompt.ts` to demand display-formatted `##` headings. Requires rehype-beats to keep handling non-kebab headings (it already does via `isKebabOnly` branch). Confirm downstream agents (AudioProducer, FactChecker) don't depend on kebab-case matching.

**Priority:** Low. Aesthetic, not corrective. Only affects pieces where Drafter's kebab slug uses multiple words including articles/conjunctions.

**Won't fix:** 2026-04-20 — scoped out as part of the broader P2.1 decision. The bigger punctuation-stripping bug the improvement plan named (QVC's / "Teaching 1:") was addressed by the `beatTitles` frontmatter override ([b204dbd](https://github.com/zzeeshann/daylila/commit/b204dbd)); this narrower title-case-of-articles remainder isn't worth the prompt retune or stopword list. If the Drafter is ever retuned for a different reason, option 2 (display-formatted `##` headings in the prompt) is the cheap way to pick it up as a side effect — until then, no action.

---

## [resolved] 2026-04-19: Surface producer-side learnings + self-reflection in the UI

**Surfaced:** 2026-04-19 as P1.3+P1.4 landed. The learning loop is now writing `source='producer'` and `source='self-reflection'` rows into `learnings` after every publish, and the Drafter reads them on the next run — but nothing in the reader-facing UI exposes what the system is learning about itself. The per-piece transparency drawer ("How this was made") already shows audit rounds and candidates; the public dashboard shows quality signals and recent runs. Neither currently shows the learnings that drove the *next* piece's prompt.

**Hypothesis:** Two additions, both nice-to-have, neither blocking:
1. **Per-piece drawer.** Add a "What the system learned from this piece" section to the existing transparency drawer (`src/pages/api/daily/[date]/made.ts` + whatever renders it). Pull rows from `learnings` where `evidence.date = <piece date>` (producer rows write this) or matched via any provenance link. Show observation + category + source badge. Deep-link to the piece that produced the learning if applicable.
2. **Public dashboard panel.** On `/dashboard/`, add a "How we're learning" panel next to "How it's holding up". Show last-7-days counts per source (`reader` / `producer` / `self-reflection` / `zita`), count of distinct observations, and maybe a rotating sample of the most recent 3 observations. Makes the self-improvement loop visible without clicking into a piece.

**Prerequisite:** Don't design this until P1.3+P1.4 have actually run and 3-5 real producer + self-reflection rows exist to design against. The prompt quality of early reflections will shape the best UI treatment — a row that reads "hook was thin on monetary policy" wants different framing than a row that reads "voice violations recurred in beat 4". Ship after 3-5 days of real learnings accumulate so the UI is designed to the actual shape of the data, not a guess.

**Investigation hints:**
- `src/pages/api/daily/[date]/made.ts` already aggregates per-piece state; extending it to include learnings is a small join. The evidence JSON carries `date` for producer + self-reflection writes so filtering by piece is straightforward.
- For the public dashboard panel: `GROUP BY source` + count + top-N observations by `created_at DESC`. No schema changes — `idx_learnings_source` is already in place.
- Be honest about empty states. Day 1-3 will have 0-10 rows total; the panel should show "Early days — N learnings so far" rather than empty/broken.

**Priority:** Low. Nice-to-have transparency; no system depends on it. Revisit when ~20+ learnings exist across sources so the UI has enough density to be worth designing.

**Resolved:** 2026-04-20 — shipped as Build 1 (dashboard Memory panel, [b96c8d6](https://github.com/zzeeshann/daylila/commit/b96c8d6)) and Build 2 (per-piece drawer section + `piece_date` migration/backfill, [a0a9b22](https://github.com/zzeeshann/daylila/commit/a0a9b22)). Both surfaces live on prod. See DECISIONS 2026-04-20 "Surfacing the learning loop".

---

## [resolved] 2026-04-19: Continue retry path may trigger full re-run instead of resuming

**Surfaced:** 2026-04-19. When combined with the Publisher double-fire bug above, the Continue button corrupted 2026-04-17's frontmatter. Observer events show producer ran twice (chunks: 4, then chunks: 1) — second run should have been a true no-op (skip producer entirely) but instead walked the full pipeline again.

**Hypothesis:** Director's `retryAudio` branch doesn't short-circuit when `has_audio == 1` or when all beats already exist in D1. It always calls `runAudioPipeline` which always calls Producer → Auditor → Publisher. Producer correctly skips generation when R2 objects are present (hence `chunks: 1` for the second call), but the downstream steps still fire.

**Investigation hints:**
- Read `agents/src/director.ts` `retryAudio` and `runAudioPipeline`. Add an early return if `piece.has_audio === 1 && all beat rows present in daily_piece_audio`.
- Alternative: make Publisher's idempotency guard strictly enforce the no-op (which it should already — see related FOLLOWUP above).
- Consider whether Continue vs Start-over should even share the same runAudioPipeline entry point. Start-over wipes and runs; Continue should resume from the last successful beat without re-triggering the publish step if nothing new was produced.

**Priority:** Medium. Paired with the Publisher double-fire, this is what corrupted 2026-04-17. Fixing either one prevents the corruption; fixing both defends in depth.

**Resolved:** 2026-04-22 (Phase E2 of audio retry trio fix). `retryAudio` at [`agents/src/director.ts`](../agents/src/director.ts) now reads `has_audio` alongside date + headline and short-circuits with an Observer warn when `has_audio === 1`. Operator sees a "retryAudio no-op" event in the admin feed; no pipeline_log rows, no git commit, no risk of double commit. "Start over" (retryAudioFresh) is the explicit escape hatch — it clears `has_audio=0` first so it always runs. Defense-in-depth layered with Phase E1's spliceAudioBeats regex fix: even if a race dispatches two retries simultaneously, only one passes this guard. See DECISIONS 2026-04-22 "retryAudio short-circuits when audio already complete".

---

## [resolved] 2026-04-19: Book chapter 9 vs Structure Editor — "4–6 beats" vs "3–6 beats"

**Surfaced:** 2026-04-19 during pre-commit review of the book import. [book/09-the-thirteen-roles.md](../book/09-the-thirteen-roles.md) line 73 describes Structure Editor as checking "there are 4–6 beats." Actual code ([agents/src/structure-editor-prompt.ts:10](../agents/src/structure-editor-prompt.ts:10)) says "Has 3-6 beats (hook, 2-3 teaching, optional practice, close)."

**Hypothesis:** Spec-vs-implementation drift, not a book error per se. The project brief's daily-piece format (4–6 beats) matches the book's claim; the Structure Editor gate is one beat more permissive than the spec. Both "the code matches the brief" and "the brief matches the book" would resolve it; currently neither is true.

**Investigation hints:**
- If the spec is canonical: tighten `STRUCTURE_EDITOR_PROMPT` in `agents/src/structure-editor-prompt.ts` to gate on 4-6, and let the next pipeline run flag any existing 3-beat pieces (there aren't any in content/daily-pieces/ as of this writing — all three shipped pieces are 6–8 beats).
- If the code's looser gate is intentional: update the book + project brief to say "3–6 beats" and note why the floor is three, not four.
- Related to P2.2 (Watch beat enforcement) still queued from the 2026-04-19 plan — any Structure Editor update should likely land in the same pass as that one.

**Priority:** Low. Nobody's blocked; both documents-and-code read the same to ordinary readers. Worth fixing next time Structure Editor is touched for any reason.

**Resolved:** 2026-04-20 — book line aligned to code. Code is authoritative (the enforcer wins when book and code drift); tightening `STRUCTURE_EDITOR_PROMPT` to 4–6 would make legitimate 3-beat pieces suddenly fail structural audit — real consequence for a one-line doc fix. Project brief's "4–6 beats" claim left untouched (handoff material, frozen historical spec). Scope held to the single named line — no sibling chapters read, no consistency sweep.

---

## [resolved] 2026-04-19: Book chapter 10 reconstructed commit message, not actual

**Surfaced:** 2026-04-19 during pre-commit review of the book import. [book/10-a-day-in-the-life.md](../book/10-a-day-in-the-life.md) line 71 says Publisher committed the 2026-04-19 piece with the message `feat(daily): publish 2026-04-19 piece on airline fuel shocks`. Actual commit was `feat(daily): 2026-04-19 — Airline industry faces a shakeup as jet fuel hits hard`.

**Hypothesis:** Not a bug — narrative reconstruction for readability. The book chose a cleaner example commit message to illustrate the pattern, rather than the auto-generated headline-based one the Publisher actually produces.

**Investigation hints:**
- If/when the book gets machine-read against commit history (e.g. for an auto-generated "how this chapter lines up with git log" appendix), this line won't match. Either the book's example needs updating to the real string, or the machine-check needs a "narrative reconstruction" escape hatch.
- The Publisher's actual commit-message template lives in [agents/src/director.ts](../agents/src/director.ts) near the publishing step (grep `commitMsg`) — worth a cross-reference if the book ever tries to show the actual string.

**Priority:** Low. No bug, just a divergence between narrative prose and the literal git log that's worth being honest about if the book grows into a forensic record.

**Resolved:** 2026-04-20 — book line replaced with the literal commit subject verified against `git log` (four matching commits across the 2026-04-19 reset/retry cycle, all carrying the same `feat(daily): 2026-04-19 — Airline industry faces a shakeup as jet fuel hits hard` subject). Chose literal over narrative because the book is now a forensic record of what actually happened, not an illustrative guide. Scope held to the single named line — no sibling chapters read.

---

## [resolved] 2026-04-19: Curator conceptual diversity (P1.2)

**Surfaced:** 2026-04-19 in the external system-improvement plan (`~/Downloads/ZEEMISH-IMPROVEMENT-PLAN-2026-04-19.md`, never committed to the repo). After the first three published pieces — QVC 2026-04-17, Hormuz 2026-04-18, airlines 2026-04-19 — all three landed on the same meta-concept: systems built for efficiency fail at their narrowest point, and incumbents can't adapt. Visible after three days. A reader arriving on day three and reading all three pieces would think Daylila is the systems-fragility blog — not what the brief says it is. As of 2026-04-20 a fourth piece (Hormuz shipping) reinforces the pattern.

**Hypothesis:** Curator has no context about what recent pieces have already taught. Two paths, recommended in order:
1. Add an `underlying_concept` column to `daily_pieces`. Curator backfills it as it runs. At curate time, show Curator a summary of the last 5–7 pieces (title + `underlying_concept`) and instruct it to prefer candidates whose concept is distant from the recent set.
2. Derive the concept tag on the fly via a small Claude call at curate time — cheaper to ship, pays a Claude call every day.

Option 1 is what the external plan recommends. Not a hard constraint — Curator should still be allowed to pick a related concept if news genuinely demands it; prefer distance, all else equal, and record the reasoning.

**Investigation hints:**
- Check `daily_pieces` current state. As of 2026-04-20 there are four pieces; two are literally about Hormuz chokepoints; thematic overlap across all four.
- Before building this, observe whether the closed loop (P1.1 + P1.3 + P1.4, all shipped 2026-04-19) has shifted Curator's clustering on its own via the learnings feed the Drafter now reads. If the self-reflections written post-Hormuz mention topic sameness, and the next Curator run sees those via its brief or the Drafter's prompt, organic correction may remove the need for this entry entirely.
- If after a week of pieces (by 2026-04-26) clustering persists, ship option 1. See `docs/AGENTS.md` Curator section, `docs/SCHEMA.md` for the new column, `docs/DECISIONS.md` for a "Curator now enforces conceptual diversity" entry.

**Priority:** Low in blast radius, visibly important in editorial quality. No system depends on it.

**Unblock after:** one week of pieces (by 2026-04-26) — check if the closed loop has shifted Curator's clustering on its own, or if hard-coded concept-distance is still needed. If clustering has organically diversified, close as `[resolved]` with a DECISIONS entry naming the organic resolution. If clustering persists, promote to `[open]` and ship option 1.

**Update 2026-04-24 — smaller-scope fix shipped; entry stays `[observing]`:** 2026-04-24 hit a worse-than-anticipated version of the clustering: at `interval_hours=12`, the 02:00 UTC and 14:00 UTC slots both produced pieces teaching information asymmetry / prediction markets from the same news event (soldier bets on Maduro ouster). The observation arrived two days before the planned 2026-04-26 unblock date, and same-day-not-week-over-week. Shipped the smaller option — enriched Curator's "Already published recently" prompt with each recent piece's `underlying_subject` alongside its headline (zero schema change, zero backfill; `underlying_subject` already written by Drafter on every row). The 14:01 UTC duplicate was operator-deleted. Full P1.2 path (new `underlying_concept` column + concept-distance scoring per option 1 above) deliberately NOT shipped — the smaller fix uses an already-populated column and covers the observed failure mode (different wire services, different lexical framing, same concept). Re-evaluate in a week: if another same-concept pair lands post-fix, escalate to the full P1.2 path. Full rationale in DECISIONS 2026-04-24 "Curator prompt enriched with recent-piece semantic context".

**Resolved:** 2026-04-26 — Two days post-fix and through 6 cron firings, no recurrence. Last 6 pieces (chronological): Chernobyl wildlife / US Mint cartel gold / Palestinians vote / DOJ firing squads / Maine data-center veto / Mike Johnson extension — span resilience under hostile constraints, supply-chain integrity, political legitimacy, state-violence philosophy, infrastructure scarcity, legislative consensus. Six distinct conceptual domains, zero subject-family pairs. The 2026-04-24 prompt enrichment with `underlying_subject` covered the failure mode without the full P1.2 path. Reopen if a same-concept pair lands on a future cron firing. See DECISIONS 2026-04-26 "FOLLOWUPS cleanup pass — six-clean-day decisions".

---

## [resolved] 2026-04-20: Audit sibling dashboard API endpoints for the same dead-code pattern

**Surfaced:** 2026-04-20 during the `today.ts` removal (resolved this session). The resolution raised the question of whether `analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts` were similarly orphaned by the 2026-04-18 dashboard refocus. Not investigated in today's commit to hold scope.

**Hypothesis:** Some of them are likely dead too. The 2026-04-18 refocus moved the public dashboard to server-rendered frontmatter queries, and the admin page has its own client-side fetches — the same conditions that left `today.ts` uncalled apply to its siblings.

**Investigation hints:**
- Same grep pattern used on `today.ts`: zero runtime callers across `src/`, `scripts/`, `agents/` means dead.
- Check the admin dashboard's client-side scripts (`dist/_worker.js/manifest_*.mjs` `inlinedScripts` array) for late-binding fetches before deleting any endpoint that might still be referenced from the admin UI.
- `/api/dashboard/observer` has a POST handler for acknowledging events — that one is almost certainly live. Don't delete it; verify first.
- For any endpoint that survives the audit, decide (like we did for `today.ts`) whether to keep it for future external consumers or remove. Err toward removing — speculative API surface rots.

**Priority:** Low. Dead code adds surface area but doesn't break anything.

**Resolved:** 2026-04-22. Grep across `src/` and `scripts/` found zero runtime callers for `analytics.ts`, `recent.ts`, `stats.ts`, `memory.ts` — all four deleted. `memory.ts` was a special case: created 2026-04-20 for the dashboard Memory panel (build 1 of the learnings surfacing work) but the Astro page ended up querying D1 directly in frontmatter, so the endpoint was born orphaned. `observer.ts` (admin acknowledge POST + GET) and `pipeline.ts` (admin poller + `reset-today.sh` monitor) survive the audit — both have live callers. Doc updates: RUNBOOK "Dashboard API endpoints" list collapsed to the two survivors + a note that public dashboard queries D1 directly in frontmatter; AGENTS + CLAUDE.md Learner sections rewritten to reference direct queries instead of `/api/dashboard/memory`.

---

## [open] 2026-05-04: Agent outbound `fetch()` calls have no timeout — third-party slowdowns become silent zombie pipeline runs

**Surfaced:** 2026-05-04. Two pipeline runs today wedged with no error event: (1) the 14:00 UTC auto-cron stuck at `curating running` for piece `90fdb2cc` — coincided with Anthropic outage 13:59–14:45 UTC (Opus 4.5 / Sonnet 4.5 / Opus 4.7 elevated errors per https://status.claude.com); (2) the 15:48 UTC manual trigger stuck at `publishing running` for piece `bd52a75b` — coincided with GitHub critical incident "Incident with Issues and Webhooks" started 15:45 UTC (Publisher's PUT fired at 15:52 UTC, 7 min into the GitHub incident). Cloudflare worker logs for piece `bd52a75b`'s `publishToPath` invocation: `outcome: canceled`, `wallTimeMs: 164128`, `cpuTimeMs: 1` — i.e. 164 seconds of pure I/O wait on the GitHub PUT, then CF cancelled the Durable Object invocation silently. No JS exception thrown, so no `publishing failed` row in `pipeline_log`, no observer error event, zero entries on the CF "Errors" counter. Same shape applies to the 14:00 zombie (Anthropic instead of GitHub). A separate but related `waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled` warning fired at 15:49:20 UTC — likely the post-publish `this.schedule(1, 'analyseProducerSignalsScheduled' / 'reflectOnPieceScheduled', ...)` calls at director.ts:547-568 hitting the same lifetime budget.

**Hypothesis:** Every agent's outbound `fetch()` (Publisher → GitHub at publisher.ts:42-58 + 108-129 + 165-185 + 205-220 + 237-255; Curator/Drafter/auditors → Anthropic; AudioProducer → ElevenLabs; AudioAuditor → R2 HEAD checks) runs without `AbortSignal.timeout()`. When the remote service is slow, the await blocks until Cloudflare's invocation lifetime budget exceeds (≈164s observed, may vary by context), at which point CF cancels the Durable Object invocation. Cancellation is silent — it kills execution mid-`await` without throwing — so no catch block fires, no error event surfaces, and the corresponding `pipeline_log` row stays at `running` forever. The 14:00 + 15:48 zombies were ROOT-CAUSED by external service incidents that happened to land on the same day; the underlying engineering bug is the absence of timeouts that would convert a slow-API event into a clean throw + `failed` event.

**Investigation hints:**
- Confirmed via Cloudflare dashboard → Workers → zeemish-agents → Observability. Search for `publishToPath` and `curate` rows; expand and inspect `outcome`, `wallTimeMs`, `cpuTimeMs`. The canceled rows are unmistakable.
- Code locations to harden: `agents/src/publisher.ts:42-58` (PUT contents), `:108-129` (DELETE), `:165-185` (PUT for audio splice), `:205-220` (GET tree), `:237-255` (GET file content); every Anthropic SDK call across `curator.ts`, `drafter.ts`, `voice-auditor.ts`, `structure-editor.ts`, `fact-checker.ts`, `integrator.ts`, `categoriser.ts`, `interactive-generator.ts`, `interactive-auditor.ts`; `audio-producer.ts` ElevenLabs call; `audio-auditor.ts` R2 HEAD calls.
- Director's pipeline phases at `agents/src/director.ts:249` (curator), `:495-502` (publisher), and the audit/integrator round loop have no try/catch — a thrown error from any agent currently bubbles up to the alarm with no `<step> failed` row written first.
- Pipeline_log zombie rows for forensic reference: `piece_id = '90fdb2cc-...'` last step `curating running` at 2026-05-04 14:00:07 UTC; `piece_id = 'bd52a75b-...'` last step `publishing running` at 2026-05-04 15:52:18 UTC. Headlines: "(Group 2 — never curated)" and "Astronomers believe they've detected an atmosphere around a tiny, icy world beyond Pluto" (Group 3, mid-publish). Daily pieces table never received a row for either.
- Both runs' D1 + R2 + GitHub state is clean — no half-committed file, no orphaned audio. The only mutations are the two `pipeline_log` `running` rows and `daily_candidates`.
- Anthropic web_search server tool calls inside FactChecker have their own `max_uses=8` budget but still no per-fetch timeout from CF's perspective.

**Fix shape (when picked up):**
1. Add `agents/src/shared/fetch-with-timeout.ts` — wraps `fetch` with `AbortSignal.timeout(15_000)` + 3-attempt exponential-backoff retry (1s/3s/9s) + structured error messages naming the upstream service.
2. Replace every raw `fetch()` call in agents with the helper.
3. Wrap each pipeline phase in director.ts in try/catch that writes `<step> failed` to `pipeline_log` + an observer error event before re-throwing.
4. Audit `this.schedule(...)` calls at director.ts:547-568 for the `waitUntil()` lifetime issue — possibly migrate post-publish background work to a separate alarm chain rather than fire-and-await scheduling.
5. Add a one-time D1 cleanup migration (or admin UI button) to insert `<step> failed` rows for any `pipeline_log` row whose last entry is older than 30 minutes and not in `[done, error, skipped, failed]` — closes today's two zombies without manual SQL.

**Priority:** medium. Not a blocker — pipelines succeed on healthy days, and Foundation Fix Phase 2 has higher narrative-value priority. Becomes a blocker the moment a third-party service has a multi-hour incident; current behaviour is "site silently has no daily piece for the day, no operator alert."

**Hold for:** Foundation Fix Phase 2 completion. Until then, operator workflow on a wedge is: spot it via admin dashboard's "running" row sticking, manually re-trigger from admin, accept that the zombie row stays in pipeline_log as a forensic artefact.
