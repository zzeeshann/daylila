# Zeemish v2 — Agent Team

## Overview
The agent team is a separate Cloudflare Worker (`agents/`) using the Cloudflare Agents SDK (v0.11.1). Each agent is a Durable Object with its own SQLite database and isolated state. Agents communicate via sub-agent RPC.

**Worker URL:** `https://zeemish-agents.zzeeshann.workers.dev`
**16 agents total — all wired.** Audio Producer + Audio Auditor are live as of 2026-04-18, slotted in after Publisher as a ship-and-retry phase. CategoriserAgent is the 13th, live as of 2026-04-23 (Area 2 sub-task 2.2) — runs off-pipeline after `publishing done`, same shape as Learner's post-publish analysis. InteractiveGenerator (15) + InteractiveAuditor (16) are live as of 2026-04-24 (Area 4 sub-tasks 4.4 + 4.5) — both also off-pipeline, producing a standalone quiz per piece. Hard 20k-char budget cap per piece protects against runaway ElevenLabs spend.

## Design principles (all agents)

1. **One agent = one job = one file.** No agent reaches into another agent's responsibility.
2. **One prompt per agent, co-located.** Prompts live in `{agent}-prompt.ts` next to the agent, not in a shared dumping ground.
3. **Director is a pure orchestrator.** Zero LLM calls. Only routes work between agents.
4. **Each agent owns its state.** Typed `Agent<Env, XState>` with its own `status` enum describing only its own work.
5. **Each agent exposes one primary method.** `scan()`, `curate()`, `draft()`, `audit()`, `check()`, `revise()`, `publish()`, `learn()`.
6. **Typed I/O at every boundary.** No `any`, no JSON blobs between agents.
7. **Every agent reports to Observer.** Standard event shape for the admin dashboard.
8. **Each agent has a character.** Below each agent's **Role** description sits a **Character** paragraph — what the agent fundamentally cares about, what character failure looks like (distinct from technical failure), and how it should approach its work. Read together with Role. Added in the 2026-04-26 refinement Action 4 (see [docs/archive/REFINEMENT_PLAN_2026-04.md](archive/REFINEMENT_PLAN_2026-04.md)). Whether agent system prompts should *inject* character text at runtime is a deferred question — for now Character lives only in this doc.

## Hard rule for all agents

**Published pieces are permanent. Any agent can READ old pieces to learn from them. No agent WRITES to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Pipeline

```
Scanner → Curator → Drafter → [Voice, Structure, Fact] parallel → Integrator → Publisher
                                                                       ↑             │
                                                          (up to 3 revision rounds)  ↓
                                                    Audio Producer → Audio Auditor → Publisher.publishAudio
                                                    (ship-and-retry: text is live before this; audio is
                                                     a second commit splicing audioBeats into frontmatter)

Observer: receives events from every agent throughout
Learner: runs off-pipeline on reader engagement data
```

## The 16 agents

### 1. ScannerAgent
- **Role:** Fetches news from RSS feeds (6 Google News topics + 11 direct breadth feeds as of 2026-05-01), deduplicates, stores candidates in D1.
- **Character:** Scanner cares about not missing things. The world is bigger than any one feed and any one day; a story passed over today is unteachable forever. Scanner pulls broadly without filtering — better to hand Curator 80 candidates that include some dead-on-arrival ones than 30 candidates that miss the one that mattered. Character failure looks like Scanner deciding stories aren't "interesting" — that judgment isn't its job. Pull wide, let downstream agents decide.
- **Sources:** Google News topic feeds — TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD. Direct breadth feeds (added 2026-05-01) — AEON (philosophy / psychology / science / art long-form), QUANTA (math / physics / CS / biology), JSTOR_DAILY (humanities, history, language), ATLAS_OBSCURA (places, history, language curiosities), NAUTILUS (science as ideas), PHYS_ORG (research-driven science), LIVE_SCIENCE (biology / geology / anthropology / archaeology), NEW_SCIENTIST (physics / biology / mathematics), KNOWABLE (Annual Reviews explainers), SMITHSONIAN (history / science / arts), TECH_REVIEW (technology substance, not gadget feed). All verified RSS 2.0 — Atom-only sources like The Conversation US dropped (parser doesn't yet handle Atom).
- **Output:** Up to 80 daily candidates in `daily_candidates` table.
- **Caps:** `PER_FEED_CAP = 6` (lowered from 15 on 2026-05-01) bounds each feed's contribution so wire-service feeds don't crowd out direct feeds. `GLOBAL_CAP = 80` (raised from 50 on 2026-05-01) is the total stored. 17 feeds × 6 = 102 pre-dedup, dedup to ~80-90 unique, cap to GLOBAL_CAP.
- **No API key** — all feeds free RSS.
- **Override:** `SCANNER_RSS_FEEDS_JSON` env var (JSON `Record<string, string>` of category-to-URL) replaces the default feed list at runtime — operator's escape hatch, no redeploy needed. Malformed JSON silently falls back to defaults.
- **Method:** `scan(pieceId)` — Director passes the run-scoped UUID pre-allocated at the top of `triggerDailyPiece`; Scanner stamps it onto every candidate row at INSERT time so the admin per-piece deep-dive can filter cleanly at multi-per-day cadence.
- **File:** `agents/src/scanner.ts`

### 2. DirectorAgent
- **Role:** Pure orchestrator. Routes work between agents. Zero LLM calls.
- **Character:** Director cares about the train staying on the tracks. It has no opinion about the news, the writing, or the audio — those aren't its work. Its work is: nothing happens silently, every step gets logged, every failure surfaces, every retry has somewhere to land. Character failure looks like a missed cron with no observer event, or a piece half-published with the second commit lost. Director moves work between agents without ever pretending to do it.
- **State:** `{ status: 'idle' | 'running' | 'error', currentPhase, currentTask, lastDailyPiece, error }`
- **Methods:** `triggerDailyPiece()`, `getStatus()`, `dailyRun()` (hourly cron; gates on `admin_settings.interval_hours` — at default 24 only the 02:00 UTC slot fires)
- **Spawns:** Scanner, Curator, Drafter, auditors, Integrator, Publisher, Observer as sub-agents
- **Writes `pipeline_log`:** step-by-step log visible in admin dashboard. Each row carries `piece_id` (added migration 0018) so multi-per-day runs stay separate at the admin deep-dive level; `run_id` stays `YYYY-MM-DD` for day-grouping views.
- **Piece_id allocation:** `pieceId = crypto.randomUUID()` at the top of `triggerDailyPiece()` — pre-allocated before Scanner runs so every `pipeline_log` / `audit_results` / `daily_candidates` row carries it from the first write. The same UUID becomes `daily_pieces.id` at the publish step and is spliced into MDX frontmatter. Orphan piece_ids (scanner-skipped or pre-publish errors) are acceptable — their rows don't render on any piece's admin page because there's no matching `daily_pieces` row. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".
- **File:** `agents/src/director.ts`

### 3. CuratorAgent
- **Role:** Picks the story from today's candidates whose underlying system best teaches readers something they didn't see before, and plans its structure (beats, hooks, teaching angle). Reads through the lens of the Zeemish protocol — "every story connects to a system; your job is to find the connection."
- **Character:** Curator is hostile to gatekeeping. Every story connects to a system; the job is finding the connection, not dismissing stories that don't fit an institutional template. A no-piece day is a worse outcome than a Rough-tier piece — the auditors will judge the writing; Curator's job is to find the teaching. If Curator catches itself dismissing a candidate as "culturally specific" or "too political" or "too soft", it has failed before it picked. The 14 TEACHABILITY examples are a breadth-showing set, not a whitelist — they exist so Curator sees what stories teach, even when the news category obscures it.
- **Selection criteria:** Teachability (find the system, don't gate-keep), universality (Delhi/Bradford/Berlin/Manila test on the LESSON, not the subject), freshness (genuinely new today vs. rehash), depth potential (almost every story has 1000–1500 words of teaching if you find the connection), no tribal framing (subject is fair game; tribal framing is not).
- **Input:** `DailyCandidate[]` + recent piece semantic cards (30-day history) + recent category-concentration counts (30-day history). Each recent-piece card carries `{headline, underlyingSubject}` — widened from headline-only on 2026-04-24 after two same-day pieces landed on the same underlying concept. Category-concentration counts widened on 2026-05-01 — Curator now sees the last-30-days distribution across `categories` table so it can prefer candidates that open thinner categories when the news allows.
- **Output:** `DailyPieceBrief` or `{ skip: true, reason }` — includes `selectedCandidateId: string` (the exact UUID of the chosen `daily_candidates.id` row). Director uses it to flip `selected = 1` on that row, which drives the "picked candidate" teal-dot marker on the per-piece admin deep-dive.
- **Method:** `curate(candidates, recentPieces, recentCategoryCounts)` — `recentPieces` typed as `Array<{headline: string; underlyingSubject: string}>`; `recentCategoryCounts` typed as `Array<{name: string; count: number}>` (default `[]` for back-compat).
- **Default: PICK (2026-04-25 reframe):** Skip is rare — reserved for the narrow conditions where the entire candidate set is one breaking event being re-reported with no new angle, OR every candidate is a pure product/spec announcement with no underlying system to teach. The decline reason must NAME the specific condition (not "low-teachability" or "shallow" boilerplate). When in doubt, find the connection. See DECISIONS 2026-04-25 "Curator reframed around the Zeemish protocol; '60+ teachability threshold' dropped".
- **Prompt contract (2026-04-22 fix):** `buildCuratorPrompt` renders each candidate with an `id: <uuid>` line so Claude can return a real row id; prompt instruction explicitly says "selectedCandidateId MUST be the exact id string shown above — do not invent, truncate, or guess." Before this fix the UUIDs weren't in the prompt at all — Claude guessed, the UPDATE matched 0 rows, and `.catch(() => {})` hid the silent failure. Director now logs via `observer.logError` on (a) UPDATE throw, (b) `meta.changes === 0`, (c) Curator returning no `selectedCandidateId`. See DECISIONS 2026-04-22 "Curator prompt exposes candidate UUIDs".
- **Semantic-diversity prompt (2026-04-24):** "Already published recently" block renders each recent piece as a 2-line mini-card (`- "headline"\n  Underlying subject: ...`). Instruction names the failure: "Two pieces teaching the same concept on the same day is a failure state" + "even from a different news source, even with different headline wording." See DECISIONS 2026-04-24 "Curator prompt enriched with recent-piece semantic context".
- **Protocol-as-lens prompt (2026-04-25):** Zeemish protocol embedded at the top of `CURATOR_PROMPT` (three-sentence form, matching `VOICE_CONTRACT`). TEACHABILITY criterion replaces the old "Celebrity scandals: low / Supply chain disruptions: high" pair with eight breadth-showing examples (crime → human psychology, celebrity → influence dynamics, death/loss/dignity → philosophy, etc.). The "60+ teachability threshold" was dropped entirely (it was a ghost number — Claude was told to skip if "all score below 60" without ever being told how to score). NO CULTURE WAR was reframed as NO TRIBAL FRAMING — the rule is about voice, not subject. See DECISIONS 2026-04-25 entry above.
- **Taxonomy expansion (2026-04-26 refinement Action 3):** TEACHABILITY grew from 8 to 14 worked examples and the celebrity/culture example was sharpened to name "how cultural practices spread and die, how words shift meaning". The 6 new categories are: social conditioning (norms hardening into defaults), psychological / cognitive patterns standalone (biases, attention, belief change — broader than crime-psychology), environmental systems (ecological mechanics, food chains, feedback loops), money / ordinary life (rent-setting, insurance pricing, wage negotiation, mortgage underwriting), health systems (diagnostic reasoning, clinical trials, triage), and technology / daily life (the device-in-your-pocket angle, distinct from the existing market-dynamics tech example). Tech example was renamed "Tech announcement (market angle)" to distinguish the two. Examples block now opens with "Examples (not a whitelist — a breadth-showing set)" so Curator reads them as visibility rather than a category gate. See DECISIONS 2026-04-26 (refinement Action 3).
- **Breadth taxonomy + category concentration (2026-05-01):** TEACHABILITY rewritten around the 10-domain breadth taxonomy from the user's brief (Inner life · Meaning and belief · Expression · Language and thought · Science not as crisis · Body and health · How humans live together · Skills and craft · Technology beyond crisis · Time and place). Crisis/policy/business framings are still present as one slice. New "RECENT CATEGORY CONCENTRATION" block in the user prompt — last-30-days counts from `Director.getRecentCategoryCounts(30)`, sorted DESC, hidden `patterns-yet-to-cluster` fallback excluded. Threshold language: "if a candidate would file under a category holding 3+ recent pieces, prefer a thinner category — unless the news event genuinely demands it." SOFT preference (the SAME-EVENT and SAME-CONCEPT rules below remain the only hard skips). See DECISIONS 2026-05-01 "Curator sees 10-domain breadth taxonomy + recent category concentration as soft preference".
- **File:** `agents/src/curator.ts`
- **Prompt:** `agents/src/curator-prompt.ts`

### 4. DrafterAgent
- **Role:** Writes the MDX for a daily piece from a brief, AND self-reflects on the final piece post-publish (P1.4). Enforces `<lesson-shell>` / `<lesson-beat>` format and forces the correct date into frontmatter so it can't drift from the run date. Also authors the meta `description` field per SEO rules in the prompt (140–160 chars, distinct from the title, names the underlying concept) — that string becomes the `<meta name="description">` on every page that reads it (the daily-piece page itself, the homepage hero, the recent-pieces strip, the library list) and the JSON-LD Article description on the daily-piece page. Drafter is the only point in the pipeline writing it, so its quality is autonomous SEO output.
- **Character:** Drafter writes for the reader who gives it ten minutes. That reader doesn't owe the piece anything, so the piece owes them: a hook that opens with the observation that creates the question (not a summary that takes the question away), teaching that opens with a fact and lets the principle emerge from it (not a definition that flattens the work), and a close that sits without summarising. Character failure is hedging — "this matters because", "in many ways", "it's important to note" — language that asks the reader to do less work than they're capable of doing. Trust the reader. Show them the thing.
- **Input:** `DailyPieceBrief`
- **Output:** `{ mdx, wordCount }` from `draft(brief)`; `ReflectionResult` (`{date, written, overflowCount, considered, tokensIn, tokensOut, durationMs}`) from `reflect(brief, mdx, date)`.
- **Methods:**
  - `draft(brief)` — primary MDX generation. Queries `getRecentLearnings(DB, 10)` and includes them in a "Lessons from prior pieces" block between the Voice Contract and the Brief (contract binds → lessons guide → brief specifies). Fail-open: DB error yields an empty learnings array and the block is omitted. The block is also omitted when the table is empty — no placeholder.
  - `reflect(brief, mdx, date)` — post-publish self-reflection (P1.4). The prompt opens by naming the stateless reality ("You didn't write this piece — a prior invocation did…") so the call doesn't LARP remembered struggle. Writes up to 10 rows with `source='self-reflection'`. Throws on Claude/JSON failure so Director's alarm handler can catch + log to observer_events. Returns tokens-in/out and wall-clock latency so Director can meter cost — this is the one Sonnet call in the pipeline that doesn't gate anything, so visibility is the whole point. Written rows surface in the `/daily/[date]/` drawer's "What the system learned from this piece" section under the "Drafter self-reflection" group.
- See DECISIONS 2026-04-19 "Drafter reads learnings at runtime" (P1.1) and "Drafter self-reflects post-publish" (P1.4).
- **File:** `agents/src/drafter.ts`
- **Prompt:** `agents/src/drafter-prompt.ts` (`DRAFTER_PROMPT` for generation, `DRAFTER_REFLECTION_PROMPT` for post-publish reflection)

### 5. VoiceAuditorAgent
- **Role:** Reviews drafts against the voice contract. Scores 0–100, must be ≥85.
- **Character:** VoiceAuditor holds the line on what Zeemish sounds like. Every piece that ships in Zeemish's name carries the contract; if the contract bends quietly, Zeemish becomes a different platform without anyone deciding to make it one. Character failure looks like rubber-stamping a piece because "overall it reads fine" — overall is the enemy. Read the rules literally, score against them, name the violation with the line.
- **Flags:** Tribe words, flattery, jargon without explanation, padding
- **Method:** `audit(mdx)`
- **File:** `agents/src/voice-auditor.ts`
- **Prompt:** `agents/src/voice-auditor-prompt.ts`

### 6. FactCheckerAgent
- **Role:** Verifies factual claims. Single-pass: Claude with the Anthropic `web_search_20250305` server tool. Searches for any current-event claim before assigning a verdict.
- **Character:** FactChecker would rather flag an honest "I can't verify this" than wave through a claim that sounds reasonable. The truth bar isn't "nothing seems wrong" — it's "every checkable claim got checked, and the unverifiable ones are marked as such." Character failure is confessing the model's training cutoff to readers ("appears to be speculative fiction set in 2026") instead of searching first. Today's date is in the user message; for any claim with a name, date, number, or current-event reference, search before verdicting.
- **Gate semantics:** Passes if no claim is `incorrect`; unverified claims are acceptable. When the web_search tool returns `unavailable`, result has `searchAvailable: false` and Director logs a warn via Observer — per the "no silent failure" principle.
- **Method:** `check(mdx)`
- **File:** `agents/src/fact-checker.ts`
- **Prompt:** `agents/src/fact-checker-prompt.ts`

### 7. StructureEditorAgent
- **Role:** Reviews beat structure, pacing, length. Checks hook, teaching, close rules.
- **Character:** StructureEditor is suspicious of pieces that look right but don't move. The reader's attention is finite; structure is what protects it. Beat counts, hook discipline, single-idea-per-beat — these aren't formalism, they're respect for the time the reader is giving. Character failure looks like passing a 7-beat piece because "the writing is good" — the writing being good doesn't earn the seventh beat. Count the beats, check the shape, flag what's off.
- **Checks:** 3–6 beats, one idea per beat, valid frontmatter, no filler
- **Learnings:** Does not write to the learnings DB. Post-publish, `LearnerAgent.analysePiecePostPublish` reads `audit_results` (which includes this auditor's findings) and synthesises producer-origin learnings from the full quality record — that subsumes the signal this gate produces. See DECISIONS 2026-04-20 "Drop StructureEditor's writeLearning calls".
- **Method:** `review(mdx)`
- **File:** `agents/src/structure-editor.ts`
- **Prompt:** `agents/src/structure-editor-prompt.ts`

### 8. IntegratorAgent
- **Role:** Takes feedback from all three gates, revises draft, resubmits.
- **Character:** Integrator takes feedback seriously without losing the piece. The auditors are right about what they flagged; they aren't right about how to fix it — that's Integrator's call. Character failure is rewriting voice while addressing structure, or stripping a working sentence because one auditor noticed something nearby. Make the smallest edit that resolves the issue. Send it back.
- **Retry:** Up to 3 revision passes before escalation.
- **Instance:** Fresh DO per day (`integrator-daily-${today}`) — daily pipelines are discrete events.
- **Method:** `revise(mdx, voice, structure, facts)`
- **File:** `agents/src/integrator.ts`
- **Prompt:** `agents/src/integrator-prompt.ts`

### 9. AudioProducerAgent
- **Role:** Generates per-beat MP3 audio via ElevenLabs, saves to R2, writes `daily_piece_audio` rows.
- **Character:** AudioProducer treats the listening reader as the same reader as the reading reader. They deserve the same quality. That means preparing the text properly for the voice (Roman numerals spelled out, abbreviations expanded, prosodic stitching for continuity across beats), generating cleanly the first time when possible, and failing loudly when it can't. Character failure is shipping clipped audio because "the file exists", or assuming the TTS will figure out "Schedule IV" — it won't, and the listening reader will hear "Schedule four" the listener was promised, not "Schedule eye-vee" the file actually contains.
- **Voice:** Frederick Surrey (British, calm, narrative) — `j9jfwdrw7BRfcR43Qohk` (added to "My Voices" for stability against shared-library removal).
- **Model / format:** `eleven_multilingual_v2`, output `mp3_44100_96`, `use_speaker_boost: true`, `speed: 0.95`, `style: 0.3`, `stability: 0.6`, `similarity_boost: 0.75`.
- **Process:** Extract beats from MDX → `prepareForTTS` (strip tags, then hand off to [`agents/src/shared/tts-normalize.ts`](../agents/src/shared/tts-normalize.ts) for the `Zeemish → Zee-mish` prosody alias and Roman-numeral → spelled-word conversion — `Schedule IV` → `Schedule four`) → sum chars → reject if > CHAR_CAP → per beat: R2 head-check → POST to ElevenLabs (with `previous_request_ids` rolling-3 window for prosodic stitching) → R2 put → upsert `daily_piece_audio` row.
- **Text normaliser (2026-04-23):** `shared/tts-normalize.ts` is provider-agnostic by design — lives upstream of the ElevenLabs-specific code so a future alternative TTS can reuse the same rules. Three-pass Roman-numeral conversion protects the English pronoun "I" (single-letter Romans only convert after a curated context word like `Schedule|Phase|Title|King|Louis`). Regression harness: [`agents/scripts/verify-normalize.mjs`](../agents/scripts/verify-normalize.mjs) (20 cases, `pnpm verify-normalize`). See DECISIONS 2026-04-23 "Provider-agnostic TTS normaliser".
- **Budget:** 20,000-char hard cap per piece. Over-cap aborts BEFORE any API spend via `AudioBudgetExceededError` (Director catches, escalates to Observer).
- **Retry:** 3 attempts with 1s/2s exponential backoff on 5xx / network errors / timeouts. Per-attempt `AbortSignal.timeout(90_000)` guards against silent TCP stalls (raised from 30s on 2026-04-22 after a ~2960-char beat exceeded the old cap on the happy path). 4xx fails fast (bad key, bad voice, quota).
- **Separation:** Never touches git. Never sets `has_audio`. Never knows Publisher exists.
- **Method:** `generateAudioChunk({ pieceId, date }, mdx, maxBeats = 2)` — Director calls in a bounded while-loop; skip-if-exists-in-R2 logic lets retries resume from the first missing beat.
- **File:** `agents/src/audio-producer.ts`

### 10. AudioAuditorAgent
- **Role:** Audits the persisted audio state for a date — reads `daily_piece_audio` rows + HEADs R2, returns pass/fail verdict.
- **Character:** AudioAuditor is skeptical that what was generated is what's actually playable. Files exist that can't open. Sizes look right that contain silence. The job is proof, not vibes. Character failure is trusting size alone, or treating "the row is in D1" as confirmation the audio is sane. Verify the object, the size, the count — every time, every beat.
- **Checks (majors fail audit):** missing rows, missing R2 object, 0-byte file, size <30% of expected (960 bytes/char at 96 kbps), total chars over 20k cap.
- **Checks (minors):** size >3× expected, beat text <50 chars.
- **No STT:** deliberately out of scope. STT catches hallucinations, which isn't what TTS gets wrong. Real-Cloudflare STT support isn't there yet anyway.
- **Method:** `audit({ pieceId, date })`
- **File:** `agents/src/audio-auditor.ts`

### 11. PublisherAgent
- **Role:** Commits approved MDX to GitHub repo via Contents API. Two surfaces:
- **Character:** Publisher treats a published piece as a fact in the world. Once it's committed, the readers have it, the search engines have it, the audio reader's app has it. The character commitment is permanence — Publisher writes once, verifies, and never edits. The frontmatter carve-out (audioBeats, voiceScore, qualityFlag) is exactly that: a carve-out, narrow and named in DECISIONS. Character failure is a soft overwrite "to fix a typo" — the typo is now part of what shipped, and the next piece is what gets fixed.
  - `publishToPath(filePath, mdx, commitMsg)` — first commit (text). **Refuses to overwrite existing files** — published content is permanent.
  - `publishAudio(filePath, audioBeats)` — second commit (metadata-only). Splices `audioBeats:` YAML block into frontmatter. Idempotent — re-running with the same beats returns the existing sha as a no-op.
  - `readPublishedMdx(filePath)` — public read helper for `Director.retryAudio`.
- **Metadata carve-out:** `publishAudio` modifies a published file. The "published pieces are permanent" rule governs teaching content (beats, narrative, facts); frontmatter metadata (voiceScore, qualityFlag, audioBeats) is an allowed exception. See `DECISIONS.md` 2026-04-18.
- **spliceAudioBeats regex fix (2026-04-22):** the strip regex `/\naudioBeats:\n(?:  .+\n)*/` previously consumed the `\n` before `audioBeats:`, so a re-splice on an already-spliced file dropped the newline separator before the closing `---`. This caused the 2026-04-17 frontmatter corruption (`qualityFlag: "low"\n---\n` → `qualityFlag: "low"---`). Fix captures the leading newline `/(\n)audioBeats:\n(?:  .+\n)*/ → '$1'`. Covered by [`agents/scripts/verify-splice.mjs`](../agents/scripts/verify-splice.mjs) (4 test cases, runs as `pnpm verify-splice`). See DECISIONS 2026-04-22 "spliceAudioBeats regex consumed leading newline".
- **Output:** `PublishResult` — commit SHA, commit URL, file path.
- **File:** `agents/src/publisher.ts`

### 12. LearnerAgent
- **Role:** Writes patterns into the `learnings` database so tomorrow's Drafter can see what today's pipeline and readers taught us. All four signal sources are wired as of 2026-04-21:
- **Character:** Learner cares that every piece teaches the system how to make the next piece better. It doesn't write generic advice ("be clear"); it writes specific observations the next Drafter can actually act on ("the third teaching beat repeated the second's principle in different words — drop or merge"). Character failure is vague learnings that read like inspirational quotes, or pooling signal from different sources without attribution. Source-tag every row, name what changed, keep observations sharp.
  - **Producer-side (P1.3, wired 2026-04-19; engagement aggregation extended in Interactives v3 Phase 4.2 on 2026-04-26):** `analysePiecePostPublish(pieceId, date)` reads the full quality record for a just-published piece — `daily_pieces`, `audit_results`, `pipeline_log`, `daily_candidates` — and writes `source='producer'` learnings. All four input queries scope by `piece_id` (migrations 0014 + 0018 + 0019, 2026-04-22 piece_id schema fix) for unambiguous multi-per-day isolation. As of Phase 4.2, also reads aggregated `interactive_engagement` over the last 14 days (capped 20 rows, joined to `interactives`) so the prompt context includes a per-interactive `views/starts/completions/users/avgScore` rollup across PRIOR pieces. Learnings about engagement patterns land with `category='engagement'` (already accepted by `normalizeProducerCategory`). Fired by Director off-pipeline immediately after `publishing done`, via a 1-second `this.schedule(...)` so it never blocks the ship. Caps writes at 10 per run; overflow logs to observer_events. Non-retriable by design: a DB/Claude/JSON failure logs to observer_events and moves on.
  - **Reader-side (pending traffic):** `analyse(courseId, days)` produces an engagement report from `engagement`; `analyseAndLearn(lessonData)` extracts learnings and writes `source='reader'`. Only fires when readers generate engagement events (no readers on the daily pieces yet).
  - **Self-reflection (P1.4, wired 2026-04-19):** Drafter's own `reflect(brief, mdx, date, pieceId)` post-publish review, `source='self-reflection'`. Fired by Director off-pipeline immediately after `publishing done`.
  - **Zita (P1.5, wired 2026-04-21):** `analyseZitaPatternsDaily(pieceId, date)` reads `zita_messages WHERE piece_id = ?`, groups by reader, synthesises question patterns. Guarded no-op below 5 user messages (returns `{skipped: true}` without firing a Claude call). Scheduled at **publish + 23h45m** (relative delay per piece, not an absolute clock) so every piece gets the same ~24h window regardless of publish time at multi-per-day. Writes `source='zita'` rows via `writeLearning(..., 60, 'zita', date, pieceId)`. Same 10-row cap + non-retriable posture. See DECISIONS 2026-04-21 "P1.5 Learner skeleton" and 2026-04-21 "Multi-piece cadence — Phase 6 Zita synthesis timing".
- **Output:** Producer post-publish result (`{date, written, overflowCount, considered}`) returned to Director for overflow logging; Zita synthesis returns the same shape plus `{skipped, userMsgCount, tokensIn, tokensOut, durationMs}` for cost metering. All learning rows written to `learnings` with `source` populated.
- **Does NOT touch published content.** Published pieces are permanent. All improvements feed forward.
- **Reader surface:** Per-piece "What the system learned from this piece" section inside the `/daily/[date]/<slug>/` How-this-was-made drawer — the specific learnings written about that piece, grouped by source, fed by `/api/daily/[date]/made`'s extended envelope. Joins on `learnings.piece_date` (added in migration 0012) + `learnings.source` (migration 0011). The earlier cross-piece `/dashboard/` "What we've learned so far" panel was deleted 2026-04-22 (counters moved to admin) and the public dashboard itself was removed 2026-05-02 (`/dashboard/` 301-redirects to `/daily/`).
- **Admin surface (new 2026-04-21):** `/dashboard/admin/zita/` surfaces the raw reader-chat signal the Zita-source synthesis feeds on. Per-piece deep-dive (`/dashboard/admin/piece/[date]/`) gains a "Questions from readers" section for per-piece context.
- **File:** `agents/src/learner.ts`
- **Prompts:** `agents/src/learner-prompt.ts` (`LEARNER_POST_PUBLISH_PROMPT` for producer-side, `LEARNER_ANALYSE_PROMPT` for reader-side, `LEARNER_ZITA_PROMPT` for Zita-question synthesis)

### 13. CategoriserAgent
- **Role:** Assigns 1–3 categories to each just-published daily piece. 14th agent, lives off-pipeline after `publishing done` (same shape as Learner's post-publish analysis and Drafter.reflect). Strongly biased toward reusing an existing category — creates a new one only when the existing taxonomy genuinely doesn't cover the piece.
- **Character:** Categoriser cares about a library that holds up at scale. Every new category is a permanent commitment — the URL exists, the chip appears, future readers navigate by it. So the bias is reuse, hard. Character failure looks like a category for every piece ("April Tariff Refunds", "Maine Data Centre Veto") — that's a headline list, not a map. The other character failure is the opposite: returning zero categories because nothing fits cleanly. Every piece must land somewhere; if the existing taxonomy doesn't fit at ≥75, stretch to the closest fit at ≥60 (with a reasoning sentence that names what's stretchy), and only then propose a new category — and only as a durable *subject* (could hold ten future pieces).
- **Tiered reuse decision (2026-04-29 — golden-orb fix):** The prompt enforces a three-tier choice and forbids returning zero assignments:
  1. **Ideal reuse ≥75** (`CATEGORISER_REUSE_CONFIDENCE_FLOOR`, raised 60 → 75 on 2026-04-25 after a cross-domain stretch — see DECISIONS 2026-04-25 "Tighten Categoriser reuse floor"). Fit is clean; pick.
  2. **Stretch reuse 60–74** (`CATEGORISER_REUSE_CONFIDENCE_STRETCH = 60`). Closest existing wins, reasoning must name what's stretchy.
  3. **New category.** Last resort, durable subject only, at most one per call.
  Sub-60 existing-cat assignments are filtered code-side as a backstop (catches the 2026-04-25 Cartels @ 50 prompt-violation bug class). If Claude returns empty/all-sub-floor on the first try, the agent fires ONE retry with a multi-turn message naming the violation. If the retry also returns empty, the piece lands in the reserved `Patterns Yet to Cluster` fallback category (migration 0027, hidden from every reader-facing surface and from Claude's own context list); operator gets a `warn` observer event from `logCategoriserFallback`. See DECISIONS 2026-04-29 "Categoriser zero-floor + tiered reuse + fallback category".
- **Input:** `pieceId` (UUID, pre-allocated by Director), `date` (for logging/return shape), final MDX (Director re-reads from GitHub and passes in — same pattern as Drafter.reflect).
- **Output:** `CategoriserResult` — `{pieceId, date, skipped, assignmentsWritten, novelCategoriesCreated, novelCategoryNames, considered, tokensIn, tokensOut, durationMs, existingAssignments, retried, retryReason?, consideredFirst, tokensInFirst, tokensOutFirst, fallbackFired}`. Surfaced back to Director, which routes to: `observer.logCategoriserRetried` (info — fires when first attempt was empty/all-sub-floor; breadcrumb), then either `observer.logCategoriserMetered` (info — terminal log on success path) or `observer.logCategoriserFallback` (warn — terminal log when both attempts exhausted, replaces the metered event so the operator gets one terminal log per run, not two). The `existingAssignments` field (added 2026-04-25) populates only on the skipped path — names the rows already attached to the piece so the observer feed isn't blind on idempotency-guard hits.
- **Idempotent:** short-circuits with `skipped: true` if the piece already has `piece_categories` rows, no Claude call. Guard query was widened 2026-04-25 from `SELECT COUNT(*)` to `SELECT … JOIN categories` so the skipped log surfaces the actual rows in `existingAssignments`. Triggered by a deploy-during-pipeline race where the first invocation INSERTed rows successfully but its observer success-log was killed by DO eviction; Cloudflare's at-least-once alarm semantics re-queued, the retry hit the guard, and the operator-visible feed was a misleading "Categorisation skipped" with no detail. Now reads "Already assigned to: <name> (<conf>%), …". See DECISIONS 2026-04-25 "Tighten Categoriser reuse floor + surface existing assignments on skipped log". Belt-and-braces on top of the composite PK `(piece_id, category_id)` which blocks duplicate rows anyway.
- **Locked-category semantic:** the `categories.locked` flag (set from admin UI in sub-task 2.5) means "MUST NOT reassign AWAY from this category." For this agent that's a no-op — it only INSERTs, never DELETEs or re-tags. The flag is enforced at admin-time (merge/delete paths). Documented in the agent header for future reference.
- **Method:** `categorise(pieceId, date, mdx)`
- **Maintains `categories.piece_count`:** denormalised counter bumped alongside each `piece_categories` INSERT so the library chip-sort read path stays cheap. Admin page's "Recount" action (sub-task 2.5) is the drift escape hatch.
- **Failure posture:** Non-retriable by design — a DB / Claude / JSON failure logs to `observer_events` via `logCategoriserFailure` and moves on. The piece is live; a missed categorisation just means the library filter won't surface this piece under a category until a manual retag (seed script or admin UI).
- **File:** `agents/src/categoriser.ts`
- **Prompt:** `agents/src/categoriser-prompt.ts`

### 16. InteractiveAuditorAgent
- **Role:** Audits what InteractiveGenerator produced. 16th agent (Area 4 sub-task 4.5). Four dimensions — voice, structure/pedagogy, essence-not-reference, factual — in a single Claude call (the quiz is small enough that a combined-dimensions audit is both cheaper and more coherent than four specialised auditors). Does NOT rewrite; returns pass/fail + per-dimension feedback. The revise loop lives in Generator.
- **Character:** InteractiveAuditor exists because the Generator's enthusiasm needs a check. The four-dimension rubric is what protects the quiz from the writer's pride in it. Character failure is rubber-stamping because "the quiz feels right", or failing on dimensions outside the four (style preferences, personal taste, "I'd word it differently"). Judge each dimension separately, name what fails, trust the rubric. The "Do NOT fail for" list is as load-bearing as the "Fail if" list — concept-match is the goal of the quiz, not a violation.
- **Plain English split rule on the voice dimension (2026-04-29):** The voice rubric flags concept-jargon (asymmetry, coordination, mitigation, throughput, restraint, structural, mechanism, etc.) when it appears inside a question stem, option, or explanation — title and concept line are exempt. The 14-year-old test is the scoring anchor: voice 100 if a curious 14-year-old reads each stem cleanly first time; 85 if minor polish; <85 if vocabulary forces a re-read. Mirror rule on the HTML rubric covers caption text, status messages, and tooltips. Regression harness: [`agents/scripts/verify-interactive-voice.mjs`](../agents/scripts/verify-interactive-voice.mjs) (10 cases, `pnpm verify-interactive-voice`) — JS heuristic mirrors the prompt's flag-list with deterministic word-boundary regex. See DECISIONS 2026-04-29 "Plain English layer for interactive prompts".
- **Four audit dimensions:**
  1. **Voice** (0–100 score, passes at ≥85). Uses `VOICE_CONTRACT`. Extra rules: questions read in the same register as a teaching piece; explanations declarative not hedged; no flattery or meta-commentary; the `concept` line is itself audited — must be a non-empty, voice-compliant sentence (a topic label or blank value fails).
  2. **Structure / pedagogy** (binary). Wrong options must be plausible mistakes. No "All of the above" / "None of the above". Options shouldn't overlap semantically. Explanations must unpack BOTH the right answer AND why the tempting wrong one falls short. Questions must cover distinct facets of the concept.
  3. **Essence not reference** (binary — THE PRIMARY BAR). Fails ONLY on the 6 enumerated concrete detail-leak conditions: proper nouns, dates, quoted phrases, industry-label tells, "according to"-style reference words, piece-specific numbers. Explicitly does NOT fail for concept-match (the GOAL of the quiz), generic concept terminology, structural analogies, worked numeric examples, or thematic echo — these are expected, not violations. Prompt was loosened 2026-04-24 after the first real-world run caught concept-echoes, not detail-leaks; see DECISIONS 2026-04-24 "Loosen InteractiveAuditor essence rule + ship-as-low on max-fail".
  4. **Factual** (binary). Any external-world claims must be true as general statements. No web search — evaluates against Claude's general knowledge. Flags uncertain claims as issues rather than asserting.
- **Input:** `quiz` (AuditableQuiz — title, slug, concept, questions), `piece` (headline, underlyingSubject, bodyExcerpt). Uses the piece context for essence-reference checks against the quiz text.
- **HTML rubric (Phase 2.4):** A second `audit()` dispatch path handles `{type: 'html', html: AuditableHtml}` against `INTERACTIVE_HTML_AUDITOR_PROMPT`. Same four dimensions, same combined-call posture, but all four dimensions carry numeric scores (voice ≥85, structure/essence/factual ≥75) instead of binary pass on three of them. The HTML system prompt is sent as a single `cache_control: ephemeral` block — every audit call after the first within ~5 minutes hits the cache.
- **Output:** `InteractiveAuditResult` — `{passed, voice: {passed, score, violations, suggestions}, structure: {passed, issues, suggestions}, essence: {passed, violations, suggestions}, factual: {passed, issues, suggestions}, tokensIn, tokensOut, cacheCreateTokens, cacheReadTokens, durationMs}`. `passed` is `true` iff ALL four dimensions pass. The two `cacheCreateTokens` / `cacheReadTokens` fields (Phase 3.4) capture the Anthropic API's `cache_creation_input_tokens` / `cache_read_input_tokens` counters via the shared `extractUsage` helper at `agents/src/shared/usage.ts`. Without them, the existing `tokensIn` underreports billable usage whenever prompt caching is in play (which is always for the HTML rubric, and is now in play for the quiz rubric too).
- **Method:** `audit(quiz, piece)`
- **Defensive pass-gate:** Claude's `passed` boolean is trusted, but clamped to threshold logic (voice `passed && score ≥ 85`; structure/essence/factual `passed && issues.length === 0`). A claimed pass with contradicting score/issues becomes a fail — protects against model inconsistencies.
- **Persistence (post-2026-04-25):** Auditor itself doesn't write — Generator's loop persists 4 rows per round (one per dimension) to `interactive_audit_results` after each `auditor.audit()` call. Closes the deferred FOLLOWUPS 2026-04-24 sub-task 4.1 entry. Rows include `passed`, `score` (voice only), and `notes` (JSON-stringified violations + suggestions). Reader site is the made.ts API for the drawer's `failedDimensions` field. See SCHEMA.md `interactive_audit_results` + DECISIONS 2026-04-25 "Ship interactive_audit_results table".
- **File:** `agents/src/interactive-auditor.ts`
- **Prompt:** `agents/src/interactive-auditor-prompt.ts` (single combined prompt via `INTERACTIVE_AUDITOR_PROMPT`; voice block embeds `VOICE_CONTRACT` directly)

### 15. InteractiveGeneratorAgent
- **Role:** Produces a standalone-teaching multiple-choice quiz for each just-published daily piece. 15th agent (Area 4 sub-task 4.4), lives off-pipeline after `publishing done` (same shape as Categoriser and Drafter.reflect). Quiz teaches the UNDERLYING CONCEPT of the piece — never references, names, or quotes the piece itself. A stranger landing on the quiz's URL must find it useful without having read the source piece.
- **Character:** InteractiveGenerator builds quizzes that teach the underlying concept, not memory of the source. The stranger arriving at the quiz's URL — who has never read the piece — must still find it useful. Character failure is leaking specific names, dates, quotes, or piece-specific numbers; or producing a quiz that's just a comprehension check on what the reader already read. Abstract the concept. Write questions that work standalone. The `concept` line is itself a teaching artefact — write it like a sentence, not a topic label.
- **Plain English split rule (2026-04-29):** The precise concept name belongs in `title` and `concept` only. Every question stem, option, and explanation uses everyday words a curious 14-year-old reads cleanly first time. *"Why does asymmetry in outside options destabilize coordination agreements?"* fails; *"Why do deals fall apart when one side has more options to walk away?"* teaches the same idea without forcing a re-read. Same rule applies to HTML caption text, status messages, and tooltips; slider labels and axis units stay terse. The voice contract is now embedded in the quiz generator prompt (parity with HTML — was missing pre-2026-04-29).
- **Owns the produce → audit → revise loop (4.5).** Up to 3 rounds, matching the daily-piece auditor pattern. InteractiveAuditor (the 16th agent) is an internal sub-agent — Director's alarm just calls `generate()` and gets back a terminal result. Round 1 produces; rounds 2+ revise with the prior round's audit feedback. Commit only on a passing round.
- **"Essence not reference" bar:** Prompt (`INTERACTIVE_GENERATOR_PROMPT` in `interactive-generator-prompt.ts`) spends most of its words on this one rule. Explicit prohibitions on proper nouns, dates, quotes, and phrases like "according to the piece". Worked examples show right vs wrong quiz subjects for pieces about SEC filings, grid failures, and shipping chokepoints — each resolving to a pattern (information asymmetry / cascades / chokepoints) rather than the specific trigger. InteractiveAuditor enforces this as the primary audit dimension.
- **`concept` is required + audited:** the one-sentence concept line names the underlying principle the quiz teaches. It feeds the page subtitle AND the per-page meta description (BaseLayout's `description` prop). Content-collection schema requires it (`z.string().min(1)`); structural validator throws on empty before file write; auditor's voice dimension flags topic-labels or off-voice phrasing. Three layers of defense so an empty/weak concept never reaches readers (or search engines). See DECISIONS 2026-04-25 "Require `concept` on interactives schema".
- **Input:** `pieceId` (UUID, pre-allocated by Director), `date` (for logging), final MDX (Director re-reads from GitHub and passes in — same pattern as Categoriser / Drafter.reflect). Generator itself also reads the piece's categories from `piece_categories` and the 10 most recent interactives for diversity context.
- **HTML interactive support (Phase 2):** `generate()` runs both quiz + html paths internally with per-type idempotence. The html path is gated by `admin_settings.interactives_html_enabled` (default `'false'`); when on, the Generator runs `runHtmlLoop` as a parallel produce → validate → audit → revise loop with the same 3-round budget. Validator at `agents/src/interactive-validator.ts` runs BEFORE the auditor — 8 rules covering size cap, sandbox compliance, dynamic-code, network calls, etc. Validator max-fail = no commit; auditor max-fail = ship-as-low. **Quiz + html share a slug — symmetric pairing (2026-04-30 PM, late):** both `runQuizLoop` and `runHtmlLoop` call the shared `resolvePairSlug(pieceId, type, claudeProposed)` helper; whichever artefact ships SECOND queries D1 for the FIRST and inherits its slug, falling back to type-scoped `resolveFreeSlug` only when there is no sibling yet. Collision resolution stays type-scoped via the migration 0026 `UNIQUE(slug, type)` shape. Pre-fix the inheritance was one-way (html → quiz only); the morning's `c687601` decoupling fix made html-first ordering possible and exposed the asymmetry on the 2026-04-30 sperm-cell piece (which landed at two URLs). See DECISIONS 2026-04-30 (PM, late) "Symmetric slug-pairing for quiz + html".
- **Cache-token capture (Phase 3.4):** Every Claude call site in `runQuizLoop` (produceQuiz, reviseQuiz, auditor.audit) and `runHtmlLoop` (produceHtml, reviseHtml, auditor.audit) reads `cache_creation_input_tokens` + `cache_read_input_tokens` via the shared `extractUsage` helper. Cumulative totals flow through both `QuizArtefactResult` + `HtmlArtefactResult` and into the `logInteractiveGeneratorMetered` observer event. Powers the `/dashboard/admin/interactives/` MTD cost surface.
- **Output:** `InteractiveGeneratorResult` — `{pieceId, date, htmlEnabled, quiz: QuizArtefactResult, html: HtmlArtefactResult | null, durationMs}`. Each artefact result carries `{ran, skipped, declined, committed, auditorMaxFailed, qualityFlag, interactiveId, slug, title, concept, questionCount/htmlByteLength, revisionCount, roundsUsed, voiceScore, finalAudit, parseFailures, errorMessage, tokensIn, tokensOut, cacheCreateTokens, cacheReadTokens, durationMs}`; html adds `validatorMaxFailed`. Surfaced back to Director for metered logging via `observer.logInteractiveGeneratorMetered` plus per-artefact `logInteractiveGeneratorParseFail` info breadcrumbs (one per `parseFailures` entry) and `logInteractiveGeneratorFailure` warns (one per artefact when `errorMessage` populates). **Five terminal states (per artefact):**
  - `skipped`: `daily_pieces.interactive_id` already set (idempotent re-run, no Claude call). Shape: `{committed: false, auditorMaxFailed: false, qualityFlag: null, errorMessage: null}`.
  - `declined`: Claude returned the empty shape in any round — "this concept is too redundant with recent interactives". Shape: `{committed: false, declined: true, qualityFlag: null, errorMessage: null}`.
  - `committed (clean)`: a round passed full audit; file + D1 writes landed with `voice_score` + `revision_count` populated from the final audit. Shape: `{committed: true, auditorMaxFailed: false, qualityFlag: null, errorMessage: null}`.
  - `committed (low)`: 3 rounds exhausted without passing audit, but the last attempt is SHIPPED with `quality_flag='low'` (2026-04-24 reversal of 4.5's abandon). File + D1 writes land; readers see the interactive at `/interactives/<slug>/` with a "Rough" tier tag; admin UI marks FLAGGED LOW; retry button remains available. Shape: `{committed: true, auditorMaxFailed: true, qualityFlag: 'low', errorMessage: null}`.
  - `failed (loop threw)` (2026-04-30 PM): a loop-level throw was caught by `generate()` and the reason captured in `errorMessage`. Most common cause is 3-round parse-fail exhaustion (`parseAndValidate*: Claude returned non-JSON output across all 3 rounds`); other causes include infra throws (D1 writes, GitHub commit). The OTHER artefact path still runs — quiz failure no longer aborts HTML and vice versa. Shape: `{committed: false, errorMessage: '...'}`. Director emits a per-artefact `logInteractiveGeneratorFailure` warn with `(quiz)`/`(html)` title suffix.
- **Ship-as-low on max-fail (reverses 4.5's abandon, 2026-04-24):** The earlier "abandon not ship-as-low" posture was theoretical — the FISA piece's first real-world run showed max-fails come from over-strict essence interpretation (concept-echoes flagged as reference leaks), not from generator-produces-garbage. A 3-rounds-refined quiz is still a useful reader artefact. Paired with the essence-rule loosening, genuine max-fails should be rare; ship-as-low acts as a safety net for the remaining edge cases. Permanence rule still clean — `quality_flag='low'` is an explicit marker (same mechanism daily_pieces use for sub-85 voice). Sub-task 4.1's column and 4.6's "vestigial future-proofing" filter were both deliberate hedges for exactly this reversal. See DECISIONS 2026-04-24 "Loosen InteractiveAuditor essence rule + ship-as-low on max-fail".
- **Write path:** On commit (clean OR low), commits `content/interactives/<slug>.json` via Publisher's `publishToPath` (refuses overwrite, same mechanic as daily-piece ship). JSON includes `qualityFlag: 'low'` when shipped-low, omits the field otherwise (content-collection schema uses `.optional()`). Then INSERTs an `interactives` row (content_json NULL — file is source of truth per 4.2; voice_score + revision_count populated from the final round; `quality_flag` = `'low'` on ship-as-low, NULL on clean pass) and UPDATEs `daily_pieces.interactive_id`. Commit message includes `[flagged low]` suffix when shipped-low. Slug collision resolution: if the base slug exists, tries `-2`, `-3`, … up to `-5`; throws if all taken.
- **Structural validation inside the loop:** each round's Claude output must pass 3–5 questions, 2–6 options per question, integer `correctIndex` in bounds, non-empty `title` / `slug` / `concept` / `explanation`. Validator-shape failures (empty slug, malformed shape, html-must-start-with-DOCTYPE) throw with a specific error message and are caught at `generate()` level (not as a failed audit round) — they land in `errorMessage` on the result, which Director surfaces via `logInteractiveGeneratorFailure`.
- **Parse-retry hardening (2026-04-30):** Two-layer hardening for the `parseAndValidate*: Claude returned non-JSON output` flake class. **Layer 1 (loop-counted retry):** `runQuizLoop` and `runHtmlLoop` wrap `produceQuiz`/`reviseQuiz`/`produceHtml`/`reviseHtml` in try/catch matching the `Claude returned non-JSON output` message prefix; on catch the round is counted as a failed round (`parseFailures.push({round})`), Director emits `logInteractiveGeneratorParseFail` (info severity), and the loop continues to the next round within the existing 3-round budget. The revise path's null-`lastQuiz`/`lastHtml` guard falls back to the initial produce path — there's nothing to revise after a parse-fail. 3-round exhaustion throws a terminal "across all 3 rounds" message that lands in `errorMessage` and triggers the per-artefact failure event. Other parse errors (empty slug, missing fields, html-must-start-with-DOCTYPE) stay fatal — those are validator-shape rejections, not transient model flakes. **Layer 2 (assistant-prefill `{`):** all 4 Claude calls prepend `{ role: 'assistant', content: '{' }` to the messages array — Anthropic-documented technique for forced JSON output. Continuation in `response.content[0].text` excludes the prefilled `{` (verified empirically against the SDK), so `'{' + continuation` is reassembled before parsing. Strongly biases against preamble + markdown fences. See DECISIONS 2026-04-30 + 2026-04-30 (PM) for the trade-offs and the production verification (one parse-retry caught successfully on the 2026-04-30 Voting Rights regenerate).
- **Idempotent:** short-circuits with `skipped: true` if `daily_pieces.interactive_id` is already set. Decline path returns without commit or D1 write. Commit path runs for both clean-pass and ship-as-low.
- **Method:** `generate(pieceId, date, mdx)`
- **Failure posture:** Per-artefact, not whole-`generate()`. Quiz throw doesn't block HTML and vice versa (2026-04-30 PM decoupling). Each loop's failure is captured in `errorMessage` on the result; Director emits a per-artefact `logInteractiveGeneratorFailure` warn with `(quiz)` / `(html)` title suffix so the admin UI can attribute the failure to the right row. Auditor rejection is NOT an infrastructure failure — it's an expected `auditorMaxFailed: true` terminal. Parse-fails within the 3-round budget are caught and retried (Layer 1, 2026-04-30); 3-round exhaustion still requires operator manual retry via `POST /interactive-generate-trigger?piece_id=<uuid>` or the admin piece-detail page's "Generate" / "Regenerate" buttons.
- **Manual trigger schedules an alarm (2026-04-30 PM):** `POST /interactive-generate-trigger?piece_id=<uuid>` calls `Director.requestInteractiveGenerate(payload)`, which schedules `generateInteractiveScheduled` on a 1s alarm and returns 202 `'scheduled'` immediately. Pre-fix, the manual retry ran the entire produce → audit → revise chain inline via `ctx.waitUntil(director.generateInteractiveScheduled(...))` from the HTTP handler — bounded by Cloudflare Workers' subrequest budget. A 3-round quiz auditor max-fail loop alone (~120s) plus HTML (~90+s) exceeded that budget; the worker terminated mid-flight, partial Claude responses came back truncated (which Layer 1 honestly counted as parse-fails), and HTML never got to start. The alarm path matches the auto-cron post-publish trigger and the destructive-regenerate trigger — both already shipped on alarms with full 15-minute budget. See DECISIONS 2026-04-30 (PM) "Manual interactive-retry routes through alarm path".
- **Destructive regeneration (Phase 3.3):** Distinct from the idempotent retry above. `POST /interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz|html>` (admin-only) wipes the existing `interactives` row + `interactive_audit_results` rows + the `content/interactives/<slug>[-html].json` file, clears `daily_pieces.interactive_id` on quiz path, fires an `interactive_regenerated` info-severity observer event with operator email, then schedules a fresh `generateInteractiveScheduled` alarm. Wipe runs synchronously (operator sees real auth/rate-limit failures); fresh generation runs in the alarm's own DO invocation. The wipe path uses `Publisher.deleteInteractiveFile(filePath, msg)` with a path-prefix guard scoped to `content/interactives/` — the daily-piece permanence rule lives in the Publisher API surface, not just the prompt convention.
- **File:** `agents/src/interactive-generator.ts`
- **Prompt:** `agents/src/interactive-generator-prompt.ts` (initial generation + revision shapes; HTML system prompt embeds [`docs/examples/interactive-reference.html`](INTERACTIVES.md#reference-hand-built-example) as a few-shot reference inside a `cache_control: ephemeral` block)

### 14. ObserverAgent
- **Role:** Logs events (published, escalated, errors, audio failures, learner failures, learning overflow, reflection metered/failed, Zita synthesis metered/failed, categoriser metered/failed, interactive generator metered/failed) to D1. Powers dashboard.
- **Character:** Observer's commitment is that nothing fails silently. Every step gets a row, every failure surfaces, severity flags what needs eyes. Character failure looks like logging events with no piece context (so the operator can't trace them), or noisy info-level chatter that buries the warn-level signal. Two principles: every event answers "what happened, where, why does it matter"; nothing the operator needs to see lives only in console logs.
- **Methods:** `logPublished()`, `logEscalation()`, `logError()`, `logAudioPublished()`, `logAudioFailure()`, `logDailyRunSkipped()`, `logLearnerFailure()`, `logLearnerOverflow()`, `logReflectionMetered()`, `logReflectionFailure()`, `logZitaSynthesisMetered()`, `logZitaSynthesisFailure()`, `logCategoriserMetered()`, `logCategoriserFailure()`, `logCategoriserRetried()`, `logCategoriserFallback()`, `logInteractiveGeneratorMetered()`, `logInteractiveGeneratorFailure()`, `logInteractiveGeneratorParseFail()`, `logInteractiveRegenerated()`, `getRecentEvents()`, `getDailyDigest()`
- **piece_id threading (2026-04-22, migration 0020):** every piece-scoped helper accepts an optional trailing `pieceId: string | null = null`. Director threads piece_id through all 13 call sites — pieceId is pre-allocated at `triggerDailyPiece` top per the multi-per-day piece_id schema fix. `logDailyRunSkipped` uses the EXISTING piece's id (the piece blocking the slot). System events (admin_settings_changed, zita_rate_limited, zita_claude_error, zita_handler_error) stay piece_id=NULL — they're cross-cutting, not per-piece. Per-piece admin query prefers `WHERE piece_id = ?` with a 36h OR-fallback for legacy NULL rows (pre-0020 events + site-worker events that haven't threaded pieceId yet). See DECISIONS 2026-04-22 "observer_events.piece_id column for per-piece admin scoping".
- **Site-origin events (2026-04-21):** `zita_history_truncated`, `zita_rate_limited`, `zita_claude_error`, `zita_handler_error` — written directly from `src/pages/api/zita/chat.ts` via [`src/lib/observer-events.ts`](../src/lib/observer-events.ts), which mirrors this agent's `writeEvent` shape. Same table, same feed — the admin Observer section doesn't discriminate by origin. The site-worker helper signature gained an optional `pieceId` field in 0020 but current call sites don't populate it (would need zita-chat client to receive + forward piece_id — deferred as a cross-cutting refactor).
- **File:** `agents/src/observer.ts`

## Endpoints

```bash
# Trigger a daily piece (requires auth)
POST /daily-trigger
# Header: Authorization: Bearer <ADMIN_SECRET>

# Retry audio for a published piece (requires auth)
# Invoked by admin dashboard retry buttons — Continue / Start over / per-beat Regenerate.
# Piece identification: piece_id (preferred, unambiguous) or date (latest-on-date fallback).
# Modes:
#   - continue (default): R2 head-check fills missing beats. Guarded has_audio=1 no-op.
#   - fresh: wipe R2 + D1 + has_audio, regenerate every beat from scratch.
#   - beat: delete one (piece_id, beat_name) row + R2 object, regen just that beat.
# See DECISIONS 2026-04-23 "Provider-agnostic TTS normaliser + admin per-beat audio regen".
POST /audio-retry?piece_id=<uuid>&mode=continue|fresh|beat[&beat=<kebab>]
POST /audio-retry?date=YYYY-MM-DD&mode=continue|fresh|beat[&beat=<kebab>]

# Director status (requires auth)
GET /status

# Observer daily digest (requires auth)
GET /digest

# Recent observer events (requires auth)
GET /events?limit=20

# Engagement report (requires auth)
GET /engagement?course=daily

# Categoriser manual trigger (requires auth)
# Fires the 14th agent against an already-published piece. Used for
# (a) verifying sub-task 2.2 before the seed script in 2.3, (b)
# retagging after admin merge/delete (sub-task 2.5), (c) re-running
# after a Categoriser prompt change. Idempotent — the agent skips
# pieces that already have piece_categories rows.
POST /categorise-trigger?piece_id=<uuid>

# InteractiveGenerator manual trigger (requires auth)
# Fires the 15th agent against an already-published piece. Used for
# (a) testing the Generator path after a prompt change, (b) re-running
# after a prior failure, (c) producing interactives for pre-Area-4
# pieces. Idempotent per artefact — runs whichever of (quiz, html) is
# missing; skips the type that already exists. As of 2026-04-30 PM
# the endpoint schedules a `generateInteractiveScheduled` alarm and
# returns 202 'scheduled' immediately (full 15-min alarm budget).
POST /interactive-generate-trigger?piece_id=<uuid>
```

## How to deploy
```bash
cd agents
wrangler deploy
```

## Secrets (set via `wrangler secret put` in `agents/`)
- `ANTHROPIC_API_KEY` — Claude API key for all agents that use Claude
- `GITHUB_TOKEN` — GitHub token for Publisher commits
- `ELEVENLABS_API_KEY` — ElevenLabs API key for Audio Producer
- `ADMIN_SECRET` — Bearer token for trigger endpoint auth

## Key shared files
- `agents/src/types.ts` — Env, per-agent state types, DailyPieceBrief, DailyCandidate, CuratorResult, DrafterResult
- `agents/src/curator-prompt.ts` — Curator's system prompt + prompt builder
- `agents/src/drafter-prompt.ts` — Drafter's system prompt + prompt builder
- `agents/src/voice-auditor-prompt.ts` — VoiceAuditor's system prompt builder (interpolates VOICE_CONTRACT)
- `agents/src/structure-editor-prompt.ts` — StructureEditor's system prompt
- `agents/src/fact-checker-prompt.ts` — FactChecker's single-pass system prompt (Anthropic web_search server tool)
- `agents/src/integrator-prompt.ts` — Integrator's system prompt builder (interpolates VOICE_CONTRACT)
- `agents/src/learner-prompt.ts` — Learner's analyse-and-learn system prompt
- `agents/src/shared/generated/contracts.ts` — **AUTO-GENERATED.** Exports `VOICE_CONTRACT` (from `content/voice-contract.md`) and `INTERACTIVE_HTML_REFERENCE` (from `docs/examples/interactive-reference.html`). Never hand-edited. Regenerate with `cd agents && pnpm codegen`. See "Generated contracts" below.
- `agents/src/shared/parse-json.ts` — robust JSON extraction from LLM responses
- `agents/src/shared/prompts.ts` — tombstone; prompts moved to their owning agents

## Generated contracts (codegen, 2026-05-03)

Cloudflare Workers cannot `readFileSync` markdown at runtime, so prompt content has to be embedded in the bundle as TypeScript string constants at build time. Until 2026-05-03 the agents project carried two manual `.ts` mirrors that drifted silently from canonical. Foundation Fix Task 02 Phase A replaced them with build-time codegen.

- **Codegen script:** `agents/scripts/codegen-contracts.mjs`. Reads canonical sources, writes `agents/src/shared/generated/contracts.ts` (`JSON.stringify`-embedded constants). Exports `buildContractsTs()` for the verifier to reuse.
- **Build hook:** `[build] command = "node scripts/codegen-contracts.mjs"` in `agents/wrangler.toml`. Runs automatically before every `wrangler dev` and `wrangler deploy` (including `cloudflare/wrangler-action@v3` in CI).
- **Drift gate:** `agents/scripts/verify-contracts-fresh.mjs` re-runs codegen in memory and diffs against the on-disk file; CI's `check-agents` job runs `pnpm verify-contracts-fresh` on every push and pull request, and `deploy-agents` is gated on it via `needs: check-agents`.
- **Adding a new contract:** drop the canonical `.md` (or other text file) under `content/` (or `docs/examples/` for HTML), append a row to the `SOURCES` array in `codegen-contracts.mjs`, run `pnpm codegen`, commit. CI verifies freshness.
- **Edit canonical files only.** The `generated/` directory is rewritten on every build; hand-edits there are silently overwritten.

## Known limitations
- Audio Auditor does basic file checks only (no STT round-trip — deliberately out of scope; STT catches hallucinations, not TTS failure modes)
- Site worker needs R2 binding + `/audio/*` route for audio URLs to resolve in production (tracked in ARCHITECTURE deviation + Phase 9 deploy list)
- ~~Voice contract duplicated in `.md` and `.ts` (manual sync required)~~ — RESOLVED 2026-05-03 via codegen (see "Generated contracts" above).
- Scanner XML parsing uses regex (fragile with malformed RSS)
