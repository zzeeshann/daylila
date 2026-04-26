# Zeemish v2 — Follow-ups Log

Append-only. One entry per known issue worth fixing later. Close via DECISIONS entry (note the FOLLOWUPS line that's now resolved). Never delete entries.

**Status markers** (start of each entry title): `[open]` — ready to pick up · `[observing]` — paused pending data, with an unblock note · `[resolved]` — shipped, commit SHA in a **Resolved:** line at the end of the entry · `[wontfix]` — deliberately scoped out, with a **Won't fix:** line explaining the call.

Format per entry:
- **Title** — one-line summary
- **Surfaced:** date + how it came up
- **Hypothesis:** what we think is wrong (may be incomplete)
- **Investigation hints:** where to start
- **Priority:** blocker / medium / low

---

## [observing] 2026-04-26: Area 5 single-scroll layout in progress

**Snapshot tag:** `area-5-snapshot` (commit `148f7f4`) — rollback point. Pushed to origin at the start of Area 5 work; the tag pins the daily-piece reader surface in its paginated-stepper shape so a `git reset --hard area-5-snapshot` recovers the pre-Area-5 state without ambiguity.

**Scope:** convert `/daily/<date>/<slug>/` from paginated stepper (Previous / Next / Finish, one beat visible at a time) to a single scrolling page (title → audio → every beat → embedded interactive → embedded quiz → finish state). Agents, pipeline, MDX output, D1 schema, audio agent pipeline, and `/interactives/<slug>/` standalone route all stay untouched.

**Unblock condition:** Area 5 ships, tag `area-5-done` lands on the doc-sync commit. Flip this entry to `[resolved]` with the doc-sync commit SHA at that point.

**Priority:** medium

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
- Visit `https://zeemish.io/daily/2026-04-26/u-s-mint-buys-drug-cartel-gold-and-sells-it-as-american/`.
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

**Surfaced:** 2026-04-25 same-day. Curator's 14:00 UTC slot declined every one of 50 candidates with the "60+ teachability threshold" boilerplate. Same-session fix dropped the threshold, embedded the Zeemish protocol at the top of `CURATOR_PROMPT`, replaced TEACHABILITY's biased examples with breadth-showing ones across 8 categories, reframed NO-CULTURE-WAR as voice-not-subject, and required skip reasons to name the specific condition rather than dismiss by category. See DECISIONS 2026-04-25 "Curator reframed around the Zeemish protocol; '60+ teachability threshold' dropped".

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

## [resolved] 2026-04-25: Submit zeemish.io sitemap to Google Search Console

**Surfaced:** 2026-04-25 SEO foundations shipping (commit `b089d6d`). The `/sitemap.xml` endpoint is live and auto-updates on every request, but neither Google Search Console nor Bing Webmaster Tools knows the URL exists yet. Until submitted, organic indexing waits on whatever the crawlers happen to discover via inbound links — slow and uneven.

**Hypothesis:** This is a one-time human action, not code work. RUNBOOK has the step-by-step under "Submit sitemap to search engines". Verifying ownership uses a DNS TXT record on the Cloudflare zone (preferred over the HTML-file method since auto-deploy doesn't touch DNS).

**Resolved:** 2026-04-25. Sitemap submitted to Google Search Console as a domain property (`zeemish.io`, not the URL-prefix variant — domain property covers `https://`, `http://`, and every subdomain in one go, which is the right shape for a single-origin site). Verified via DNS TXT on the Cloudflare zone. Sitemap processed successfully on first read; **31 pages discovered** (matches the SSR endpoint's enumeration of homepage + /daily/ + /library/ + 12 daily pieces × slug-inclusive URLs + 7 interactives + 3 category pages + the /daily/ and /library/ indexes). First crawl impressions and Coverage report data will accrue over 1–3 days. Monitor Coverage for any "Crawled — currently not indexed" entries from the pre-Phase-4 date-only URLs (separate FOLLOWUPS entry below covers the 301-redirect option).

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

**Priority:** low. Cosmetic for the URL layer; doesn't affect ranking until the library has enough pieces that long-tail SEO matters (currently 12 pieces, 8 days live). Revisit when piece count crosses ~50 or when a competing concept-tagged URL outranks a Zeemish piece on the same topic.

**Won't fix:** 2026-04-26 — Pure SEO/longevity optimisation with no current breakage. Library is 14 pieces over 9 days; the long-tail SEO threshold (~50 pieces) is not yet near. Reopen when piece count crosses ~50 or when a competing concept-tagged URL outranks a Zeemish piece on the same topic.

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

**Resolved:** `e17c25e` (2026-04-22) via Phase 4 of the multi-per-day piece_id schema fix (path 2 — came for free once `pipeline_log.piece_id` landed in migration 0018). `/api/dashboard/pipeline` now returns `groups[]` and `headlines{}` keyed by piece_id; `admin.astro`'s poller renders each run as a collapsible `<details>` block titled with the piece headline + publish time, newest open by default. Deploy verified on production zeemish.io. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".

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

**Won't fix:** 2026-04-20 — scoped out as part of the broader P2.1 decision. The bigger punctuation-stripping bug the improvement plan named (QVC's / "Teaching 1:") was addressed by the `beatTitles` frontmatter override ([b204dbd](https://github.com/zzeeshann/zeemish-v2/commit/b204dbd)); this narrower title-case-of-articles remainder isn't worth the prompt retune or stopword list. If the Drafter is ever retuned for a different reason, option 2 (display-formatted `##` headings in the prompt) is the cheap way to pick it up as a side effect — until then, no action.

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

**Resolved:** 2026-04-20 — shipped as Build 1 (dashboard Memory panel, [b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)) and Build 2 (per-piece drawer section + `piece_date` migration/backfill, [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)). Both surfaces live on prod. See DECISIONS 2026-04-20 "Surfacing the learning loop".

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

**Surfaced:** 2026-04-19 in the external system-improvement plan (`~/Downloads/ZEEMISH-IMPROVEMENT-PLAN-2026-04-19.md`, never committed to the repo). After the first three published pieces — QVC 2026-04-17, Hormuz 2026-04-18, airlines 2026-04-19 — all three landed on the same meta-concept: systems built for efficiency fail at their narrowest point, and incumbents can't adapt. Visible after three days. A reader arriving on day three and reading all three pieces would think Zeemish is the systems-fragility blog — not what the brief says it is. As of 2026-04-20 a fourth piece (Hormuz shipping) reinforces the pattern.

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
