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
- **Role:** Fetches news from Google News RSS (6 categories), deduplicates, stores candidates in D1.
- **Sources:** TOP, TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD feeds
- **Output:** 30–50 daily candidates in `daily_candidates` table
- **No API key** — uses free Google News RSS
- **Method:** `scan(pieceId)` — Director passes the run-scoped UUID pre-allocated at the top of `triggerDailyPiece`; Scanner stamps it onto every candidate row at INSERT time so the admin per-piece deep-dive can filter cleanly at multi-per-day cadence.
- **File:** `agents/src/scanner.ts`

### 2. DirectorAgent
- **Role:** Pure orchestrator. Routes work between agents. Zero LLM calls.
- **State:** `{ status: 'idle' | 'running' | 'error', currentPhase, currentTask, lastDailyPiece, error }`
- **Methods:** `triggerDailyPiece()`, `getStatus()`, `dailyRun()` (hourly cron; gates on `admin_settings.interval_hours` — at default 24 only the 02:00 UTC slot fires)
- **Spawns:** Scanner, Curator, Drafter, auditors, Integrator, Publisher, Observer as sub-agents
- **Writes `pipeline_log`:** step-by-step log visible in admin dashboard. Each row carries `piece_id` (added migration 0018) so multi-per-day runs stay separate at the admin deep-dive level; `run_id` stays `YYYY-MM-DD` for day-grouping views.
- **Piece_id allocation:** `pieceId = crypto.randomUUID()` at the top of `triggerDailyPiece()` — pre-allocated before Scanner runs so every `pipeline_log` / `audit_results` / `daily_candidates` row carries it from the first write. The same UUID becomes `daily_pieces.id` at the publish step and is spliced into MDX frontmatter. Orphan piece_ids (scanner-skipped or pre-publish errors) are acceptable — their rows don't render on any piece's admin page because there's no matching `daily_pieces` row. See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables".
- **File:** `agents/src/director.ts`

### 3. CuratorAgent
- **Role:** Picks the story from today's candidates whose underlying system best teaches readers something they didn't see before, and plans its structure (beats, hooks, teaching angle). Reads through the lens of the Zeemish protocol — "every story connects to a system; your job is to find the connection."
- **Selection criteria:** Teachability (find the system, don't gate-keep), universality (Delhi/Bradford/Berlin/Manila test on the LESSON, not the subject), freshness (genuinely new today vs. rehash), depth potential (almost every story has 1000–1500 words of teaching if you find the connection), no tribal framing (subject is fair game; tribal framing is not).
- **Input:** `DailyCandidate[]` + recent piece semantic cards (30-day history). Each recent-piece card carries `{headline, underlyingSubject}` — widened from headline-only on 2026-04-24 after two same-day pieces landed on the same underlying concept (different wire services, different headline shapes, same underlying_subject). Headlines alone don't convey conceptual overlap; subjects do.
- **Output:** `DailyPieceBrief` or `{ skip: true, reason }` — includes `selectedCandidateId: string` (the exact UUID of the chosen `daily_candidates.id` row). Director uses it to flip `selected = 1` on that row, which drives the "picked candidate" teal-dot marker on the per-piece admin deep-dive.
- **Method:** `curate(candidates, recentPieces)` — `recentPieces` now typed as `Array<{headline: string; underlyingSubject: string}>`.
- **Default: PICK (2026-04-25 reframe):** Skip is rare — reserved for the narrow conditions where the entire candidate set is one breaking event being re-reported with no new angle, OR every candidate is a pure product/spec announcement with no underlying system to teach. The decline reason must NAME the specific condition (not "low-teachability" or "shallow" boilerplate). When in doubt, find the connection. See DECISIONS 2026-04-25 "Curator reframed around the Zeemish protocol; '60+ teachability threshold' dropped".
- **Prompt contract (2026-04-22 fix):** `buildCuratorPrompt` renders each candidate with an `id: <uuid>` line so Claude can return a real row id; prompt instruction explicitly says "selectedCandidateId MUST be the exact id string shown above — do not invent, truncate, or guess." Before this fix the UUIDs weren't in the prompt at all — Claude guessed, the UPDATE matched 0 rows, and `.catch(() => {})` hid the silent failure. Director now logs via `observer.logError` on (a) UPDATE throw, (b) `meta.changes === 0`, (c) Curator returning no `selectedCandidateId`. See DECISIONS 2026-04-22 "Curator prompt exposes candidate UUIDs".
- **Semantic-diversity prompt (2026-04-24):** "Already published recently" block renders each recent piece as a 2-line mini-card (`- "headline"\n  Underlying subject: ...`). Instruction names the failure: "Two pieces teaching the same concept on the same day is a failure state" + "even from a different news source, even with different headline wording." See DECISIONS 2026-04-24 "Curator prompt enriched with recent-piece semantic context".
- **Protocol-as-lens prompt (2026-04-25):** Zeemish protocol embedded at the top of `CURATOR_PROMPT` (three-sentence form, matching `VOICE_CONTRACT`). TEACHABILITY criterion replaces the old "Celebrity scandals: low / Supply chain disruptions: high" pair with eight breadth-showing examples (crime → human psychology, celebrity → influence dynamics, death/loss/dignity → philosophy, etc.). The "60+ teachability threshold" was dropped entirely (it was a ghost number — Claude was told to skip if "all score below 60" without ever being told how to score). NO CULTURE WAR was reframed as NO TRIBAL FRAMING — the rule is about voice, not subject. See DECISIONS 2026-04-25 entry above.
- **File:** `agents/src/curator.ts`
- **Prompt:** `agents/src/curator-prompt.ts`

### 4. DrafterAgent
- **Role:** Writes the MDX for a daily piece from a brief, AND self-reflects on the final piece post-publish (P1.4). Enforces `<lesson-shell>` / `<lesson-beat>` format and forces the correct date into frontmatter so it can't drift from the run date.
- **Input:** `DailyPieceBrief`
- **Output:** `{ mdx, wordCount }` from `draft(brief)`; `ReflectionResult` (`{date, written, overflowCount, considered, tokensIn, tokensOut, durationMs}`) from `reflect(brief, mdx, date)`.
- **Methods:**
  - `draft(brief)` — primary MDX generation. Queries `getRecentLearnings(DB, 10)` and includes them in a "Lessons from prior pieces" block between the Voice Contract and the Brief (contract binds → lessons guide → brief specifies). Fail-open: DB error yields an empty learnings array and the block is omitted. The block is also omitted when the table is empty — no placeholder.
  - `reflect(brief, mdx, date)` — post-publish self-reflection (P1.4). The prompt opens by naming the stateless reality ("You didn't write this piece — a prior invocation did…") so the call doesn't LARP remembered struggle. Writes up to 10 rows with `source='self-reflection'`. Throws on Claude/JSON failure so Director's alarm handler can catch + log to observer_events. Returns tokens-in/out and wall-clock latency so Director can meter cost — this is the one Sonnet call in the pipeline that doesn't gate anything, so visibility is the whole point. Written rows surface in the `/daily/[date]/` drawer's "What the system learned from this piece" section under the "Drafter self-reflection" group, and count toward the `/dashboard/` Memory panel's self-reflection total.
- See DECISIONS 2026-04-19 "Drafter reads learnings at runtime" (P1.1) and "Drafter self-reflects post-publish" (P1.4).
- **File:** `agents/src/drafter.ts`
- **Prompt:** `agents/src/drafter-prompt.ts` (`DRAFTER_PROMPT` for generation, `DRAFTER_REFLECTION_PROMPT` for post-publish reflection)

### 5. VoiceAuditorAgent
- **Role:** Reviews drafts against the voice contract. Scores 0–100, must be ≥85.
- **Flags:** Tribe words, flattery, jargon without explanation, padding
- **Method:** `audit(mdx)`
- **File:** `agents/src/voice-auditor.ts`
- **Prompt:** `agents/src/voice-auditor-prompt.ts`

### 6. FactCheckerAgent
- **Role:** Verifies factual claims. Two-pass: Claude identifies claims, DuckDuckGo verifies unconfirmed ones.
- **Limitation:** Web search uses DuckDuckGo instant answers (limited depth)
- **Gate semantics:** Passes if no claim is `incorrect`; unverified claims are acceptable. When web search fails, result has `searchAvailable: false` and Director logs a warn via Observer — per the "no silent failure" principle.
- **Method:** `check(mdx)`
- **File:** `agents/src/fact-checker.ts`
- **Prompt:** `agents/src/fact-checker-prompt.ts`

### 7. StructureEditorAgent
- **Role:** Reviews beat structure, pacing, length. Checks hook, teaching, close rules.
- **Checks:** 3–6 beats, one idea per beat, valid frontmatter, no filler
- **Learnings:** Does not write to the learnings DB. Post-publish, `LearnerAgent.analysePiecePostPublish` reads `audit_results` (which includes this auditor's findings) and synthesises producer-origin learnings from the full quality record — that subsumes the signal this gate produces. See DECISIONS 2026-04-20 "Drop StructureEditor's writeLearning calls".
- **Method:** `review(mdx)`
- **File:** `agents/src/structure-editor.ts`
- **Prompt:** `agents/src/structure-editor-prompt.ts`

### 8. IntegratorAgent
- **Role:** Takes feedback from all three gates, revises draft, resubmits.
- **Retry:** Up to 3 revision passes before escalation.
- **Instance:** Fresh DO per day (`integrator-daily-${today}`) — daily pipelines are discrete events.
- **Method:** `revise(mdx, voice, structure, facts)`
- **File:** `agents/src/integrator.ts`
- **Prompt:** `agents/src/integrator-prompt.ts`

### 9. AudioProducerAgent
- **Role:** Generates per-beat MP3 audio via ElevenLabs, saves to R2, writes `daily_piece_audio` rows.
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
- **Checks (majors fail audit):** missing rows, missing R2 object, 0-byte file, size <30% of expected (960 bytes/char at 96 kbps), total chars over 20k cap.
- **Checks (minors):** size >3× expected, beat text <50 chars.
- **No STT:** deliberately out of scope. STT catches hallucinations, which isn't what TTS gets wrong. Real-Cloudflare STT support isn't there yet anyway.
- **Method:** `audit({ pieceId, date })`
- **File:** `agents/src/audio-auditor.ts`

### 11. PublisherAgent
- **Role:** Commits approved MDX to GitHub repo via Contents API. Two surfaces:
  - `publishToPath(filePath, mdx, commitMsg)` — first commit (text). **Refuses to overwrite existing files** — published content is permanent.
  - `publishAudio(filePath, audioBeats)` — second commit (metadata-only). Splices `audioBeats:` YAML block into frontmatter. Idempotent — re-running with the same beats returns the existing sha as a no-op.
  - `readPublishedMdx(filePath)` — public read helper for `Director.retryAudio`.
- **Metadata carve-out:** `publishAudio` modifies a published file. The "published pieces are permanent" rule governs teaching content (beats, narrative, facts); frontmatter metadata (voiceScore, qualityFlag, audioBeats) is an allowed exception. See `DECISIONS.md` 2026-04-18.
- **spliceAudioBeats regex fix (2026-04-22):** the strip regex `/\naudioBeats:\n(?:  .+\n)*/` previously consumed the `\n` before `audioBeats:`, so a re-splice on an already-spliced file dropped the newline separator before the closing `---`. This caused the 2026-04-17 frontmatter corruption (`qualityFlag: "low"\n---\n` → `qualityFlag: "low"---`). Fix captures the leading newline `/(\n)audioBeats:\n(?:  .+\n)*/ → '$1'`. Covered by [`agents/scripts/verify-splice.mjs`](../agents/scripts/verify-splice.mjs) (4 test cases, runs as `pnpm verify-splice`). See DECISIONS 2026-04-22 "spliceAudioBeats regex consumed leading newline".
- **Output:** `PublishResult` — commit SHA, commit URL, file path.
- **File:** `agents/src/publisher.ts`

### 12. LearnerAgent
- **Role:** Writes patterns into the `learnings` database so tomorrow's Drafter can see what today's pipeline and readers taught us. All four signal sources are wired as of 2026-04-21:
  - **Producer-side (P1.3, wired 2026-04-19; engagement aggregation extended in Interactives v3 Phase 4.2 on 2026-04-26):** `analysePiecePostPublish(pieceId, date)` reads the full quality record for a just-published piece — `daily_pieces`, `audit_results`, `pipeline_log`, `daily_candidates` — and writes `source='producer'` learnings. All four input queries scope by `piece_id` (migrations 0014 + 0018 + 0019, 2026-04-22 piece_id schema fix) for unambiguous multi-per-day isolation. As of Phase 4.2, also reads aggregated `interactive_engagement` over the last 14 days (capped 20 rows, joined to `interactives`) so the prompt context includes a per-interactive `views/starts/completions/users/avgScore` rollup across PRIOR pieces. Learnings about engagement patterns land with `category='engagement'` (already accepted by `normalizeProducerCategory`). Fired by Director off-pipeline immediately after `publishing done`, via a 1-second `this.schedule(...)` so it never blocks the ship. Caps writes at 10 per run; overflow logs to observer_events. Non-retriable by design: a DB/Claude/JSON failure logs to observer_events and moves on.
  - **Reader-side (pending traffic):** `analyse(courseId, days)` produces an engagement report from `engagement`; `analyseAndLearn(lessonData)` extracts learnings and writes `source='reader'`. Only fires when readers generate engagement events (no readers on the daily pieces yet).
  - **Self-reflection (P1.4, wired 2026-04-19):** Drafter's own `reflect(brief, mdx, date, pieceId)` post-publish review, `source='self-reflection'`. Fired by Director off-pipeline immediately after `publishing done`.
  - **Zita (P1.5, wired 2026-04-21):** `analyseZitaPatternsDaily(pieceId, date)` reads `zita_messages WHERE piece_id = ?`, groups by reader, synthesises question patterns. Guarded no-op below 5 user messages (returns `{skipped: true}` without firing a Claude call). Scheduled at **publish + 23h45m** (relative delay per piece, not an absolute clock) so every piece gets the same ~24h window regardless of publish time at multi-per-day. Writes `source='zita'` rows via `writeLearning(..., 60, 'zita', date, pieceId)`. Same 10-row cap + non-retriable posture. See DECISIONS 2026-04-21 "P1.5 Learner skeleton" and 2026-04-21 "Multi-piece cadence — Phase 6 Zita synthesis timing".
- **Output:** Producer post-publish result (`{date, written, overflowCount, considered}`) returned to Director for overflow logging; Zita synthesis returns the same shape plus `{skipped, userMsgCount, tokensIn, tokensOut, durationMs}` for cost metering. All learning rows written to `learnings` with `source` populated.
- **Does NOT touch published content.** Published pieces are permanent. All improvements feed forward.
- **Reader surfaces:** Two public views into what the loop produces. (1) `/dashboard/` "What we've learned so far" panel — counts by source plus the latest observation across all pieces, queried directly from D1 in the page's Astro frontmatter (the earlier `/api/dashboard/memory` endpoint was superseded and removed in the 2026-04-22 dead-endpoint audit). (2) Per-piece "What the system learned from this piece" section inside the `/daily/[date]/` How-this-was-made drawer — the specific learnings written about that piece, grouped by source, fed by `/api/daily/[date]/made`'s extended envelope. Both surfaces join on `learnings.piece_date` (added in migration 0012) + `learnings.source` (migration 0011).
- **Admin surface (new 2026-04-21):** `/dashboard/admin/zita/` surfaces the raw reader-chat signal the Zita-source synthesis feeds on. Per-piece deep-dive (`/dashboard/admin/piece/[date]/`) gains a "Questions from readers" section for per-piece context.
- **File:** `agents/src/learner.ts`
- **Prompts:** `agents/src/learner-prompt.ts` (`LEARNER_POST_PUBLISH_PROMPT` for producer-side, `LEARNER_ANALYSE_PROMPT` for reader-side, `LEARNER_ZITA_PROMPT` for Zita-question synthesis)

### 13. CategoriserAgent
- **Role:** Assigns 1–3 categories to each just-published daily piece. 14th agent, lives off-pipeline after `publishing done` (same shape as Learner's post-publish analysis and Drafter.reflect). Strongly biased toward reusing an existing category — creates a new one only when the existing taxonomy genuinely doesn't cover the piece.
- **Reuse bias:** The prompt names the anti-pattern directly — a taxonomy that grows a category for every piece becomes a headline list, not a map. Reuses when an existing category fits at confidence ≥75 (`CATEGORISER_REUSE_CONFIDENCE_FLOOR`, raised 60 → 75 on 2026-04-25 after a cross-domain stretch where a state-violence piece picked up "Commodity Shocks" at 70% via its secondary pharma-supply-chain thread). 75 is high enough to require the piece's *primary* underlying subject to fit the reused category; secondary thematic echoes don't clear it. Creates at most one new category per call, and only for *subjects* (durable, could hold 10+ future pieces) — not topic-of-the-week labels.
- **Input:** `pieceId` (UUID, pre-allocated by Director), `date` (for logging/return shape), final MDX (Director re-reads from GitHub and passes in — same pattern as Drafter.reflect).
- **Output:** `CategoriserResult` — `{pieceId, date, skipped, assignmentsWritten, novelCategoriesCreated, novelCategoryNames, considered, tokensIn, tokensOut, durationMs, existingAssignments}`. Surfaced back to Director for metered logging via `observer.logCategoriserMetered`. The `existingAssignments` field (added 2026-04-25) populates only on the skipped path — names the rows already attached to the piece so the observer feed isn't blind on idempotency-guard hits.
- **Idempotent:** short-circuits with `skipped: true` if the piece already has `piece_categories` rows, no Claude call. Guard query was widened 2026-04-25 from `SELECT COUNT(*)` to `SELECT … JOIN categories` so the skipped log surfaces the actual rows in `existingAssignments`. Triggered by a deploy-during-pipeline race where the first invocation INSERTed rows successfully but its observer success-log was killed by DO eviction; Cloudflare's at-least-once alarm semantics re-queued, the retry hit the guard, and the operator-visible feed was a misleading "Categorisation skipped" with no detail. Now reads "Already assigned to: <name> (<conf>%), …". See DECISIONS 2026-04-25 "Tighten Categoriser reuse floor + surface existing assignments on skipped log". Belt-and-braces on top of the composite PK `(piece_id, category_id)` which blocks duplicate rows anyway.
- **Locked-category semantic:** the `categories.locked` flag (set from admin UI in sub-task 2.5) means "MUST NOT reassign AWAY from this category." For this agent that's a no-op — it only INSERTs, never DELETEs or re-tags. The flag is enforced at admin-time (merge/delete paths). Documented in the agent header for future reference.
- **Method:** `categorise(pieceId, date, mdx)`
- **Maintains `categories.piece_count`:** denormalised counter bumped alongside each `piece_categories` INSERT so the library chip-sort read path stays cheap. Admin page's "Recount" action (sub-task 2.5) is the drift escape hatch.
- **Failure posture:** Non-retriable by design — a DB / Claude / JSON failure logs to `observer_events` via `logCategoriserFailure` and moves on. The piece is live; a missed categorisation just means the library filter won't surface this piece under a category until a manual retag (seed script or admin UI).
- **File:** `agents/src/categoriser.ts`
- **Prompt:** `agents/src/categoriser-prompt.ts`

### 16. InteractiveAuditorAgent
- **Role:** Audits what InteractiveGenerator produced. 16th agent (Area 4 sub-task 4.5). Four dimensions — voice, structure/pedagogy, essence-not-reference, factual — in a single Claude call (the quiz is small enough that a combined-dimensions audit is both cheaper and more coherent than four specialised auditors). Does NOT rewrite; returns pass/fail + per-dimension feedback. The revise loop lives in Generator.
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
- **Owns the produce → audit → revise loop (4.5).** Up to 3 rounds, matching the daily-piece auditor pattern. InteractiveAuditor (the 16th agent) is an internal sub-agent — Director's alarm just calls `generate()` and gets back a terminal result. Round 1 produces; rounds 2+ revise with the prior round's audit feedback. Commit only on a passing round.
- **"Essence not reference" bar:** Prompt (`INTERACTIVE_GENERATOR_PROMPT` in `interactive-generator-prompt.ts`) spends most of its words on this one rule. Explicit prohibitions on proper nouns, dates, quotes, and phrases like "according to the piece". Worked examples show right vs wrong quiz subjects for pieces about SEC filings, grid failures, and shipping chokepoints — each resolving to a pattern (information asymmetry / cascades / chokepoints) rather than the specific trigger. InteractiveAuditor enforces this as the primary audit dimension.
- **`concept` is required + audited:** the one-sentence concept line names the underlying principle the quiz teaches. It feeds the page subtitle AND the per-page meta description (BaseLayout's `description` prop). Content-collection schema requires it (`z.string().min(1)`); structural validator throws on empty before file write; auditor's voice dimension flags topic-labels or off-voice phrasing. Three layers of defense so an empty/weak concept never reaches readers (or search engines). See DECISIONS 2026-04-25 "Require `concept` on interactives schema".
- **Input:** `pieceId` (UUID, pre-allocated by Director), `date` (for logging), final MDX (Director re-reads from GitHub and passes in — same pattern as Categoriser / Drafter.reflect). Generator itself also reads the piece's categories from `piece_categories` and the 10 most recent interactives for diversity context.
- **HTML interactive support (Phase 2):** `generate()` runs both quiz + html paths internally with per-type idempotence. The html path is gated by `admin_settings.interactives_html_enabled` (default `'false'`); when on, the Generator runs `runHtmlLoop` as a parallel produce → validate → audit → revise loop with the same 3-round budget. Validator at `agents/src/interactive-validator.ts` runs BEFORE the auditor — 8 rules covering size cap, sandbox compliance, dynamic-code, network calls, etc. Validator max-fail = no commit; auditor max-fail = ship-as-low. Quiz + html share a slug (one URL per piece) — the html path looks up the existing quiz row and inherits its slug; collision resolution is type-scoped via the migration 0026 `UNIQUE(slug, type)` shape.
- **Cache-token capture (Phase 3.4):** Every Claude call site in `runQuizLoop` (produceQuiz, reviseQuiz, auditor.audit) and `runHtmlLoop` (produceHtml, reviseHtml, auditor.audit) reads `cache_creation_input_tokens` + `cache_read_input_tokens` via the shared `extractUsage` helper. Cumulative totals flow through both `QuizArtefactResult` + `HtmlArtefactResult` and into the `logInteractiveGeneratorMetered` observer event. Powers the `/dashboard/admin/interactives/` MTD cost surface.
- **Output:** `InteractiveGeneratorResult` — `{pieceId, date, htmlEnabled, quiz: QuizArtefactResult, html: HtmlArtefactResult | null, durationMs}`. Each artefact result carries `{ran, skipped, declined, committed, auditorMaxFailed, qualityFlag, interactiveId, slug, title, concept, questionCount/htmlByteLength, revisionCount, roundsUsed, voiceScore, finalAudit, tokensIn, tokensOut, cacheCreateTokens, cacheReadTokens, durationMs}`; html adds `validatorMaxFailed`. Surfaced back to Director for metered logging via `observer.logInteractiveGeneratorMetered`. **Four terminal states (per artefact):**
  - `skipped`: `daily_pieces.interactive_id` already set (idempotent re-run, no Claude call). Shape: `{committed: false, auditorMaxFailed: false, qualityFlag: null}`.
  - `declined`: Claude returned the empty shape in any round — "this concept is too redundant with recent interactives". Shape: `{committed: false, declined: true, qualityFlag: null}`.
  - `committed (clean)`: a round passed full audit; file + D1 writes landed with `voice_score` + `revision_count` populated from the final audit. Shape: `{committed: true, auditorMaxFailed: false, qualityFlag: null}`.
  - `committed (low)`: 3 rounds exhausted without passing audit, but the last attempt is SHIPPED with `quality_flag='low'` (2026-04-24 reversal of 4.5's abandon). File + D1 writes land; readers see the interactive at `/interactives/<slug>/` with a "Rough" tier tag; admin UI marks FLAGGED LOW; retry button remains available. Shape: `{committed: true, auditorMaxFailed: true, qualityFlag: 'low'}`.
- **Ship-as-low on max-fail (reverses 4.5's abandon, 2026-04-24):** The earlier "abandon not ship-as-low" posture was theoretical — the FISA piece's first real-world run showed max-fails come from over-strict essence interpretation (concept-echoes flagged as reference leaks), not from generator-produces-garbage. A 3-rounds-refined quiz is still a useful reader artefact. Paired with the essence-rule loosening, genuine max-fails should be rare; ship-as-low acts as a safety net for the remaining edge cases. Permanence rule still clean — `quality_flag='low'` is an explicit marker (same mechanism daily_pieces use for sub-85 voice). Sub-task 4.1's column and 4.6's "vestigial future-proofing" filter were both deliberate hedges for exactly this reversal. See DECISIONS 2026-04-24 "Loosen InteractiveAuditor essence rule + ship-as-low on max-fail".
- **Write path:** On commit (clean OR low), commits `content/interactives/<slug>.json` via Publisher's `publishToPath` (refuses overwrite, same mechanic as daily-piece ship). JSON includes `qualityFlag: 'low'` when shipped-low, omits the field otherwise (content-collection schema uses `.optional()`). Then INSERTs an `interactives` row (content_json NULL — file is source of truth per 4.2; voice_score + revision_count populated from the final round; `quality_flag` = `'low'` on ship-as-low, NULL on clean pass) and UPDATEs `daily_pieces.interactive_id`. Commit message includes `[flagged low]` suffix when shipped-low. Slug collision resolution: if the base slug exists, tries `-2`, `-3`, … up to `-5`; throws if all taken.
- **Structural validation inside the loop:** each round's Claude output must pass 3–5 questions, 2–6 options per question, integer `correctIndex` in bounds, non-empty `title` / `slug` / `concept` / `explanation`. Failure throws with a specific error message — not treated as a failed audit round, but as an infrastructure error (Director catches and logs via `logInteractiveGeneratorFailure`).
- **Idempotent:** short-circuits with `skipped: true` if `daily_pieces.interactive_id` is already set. Decline path returns without commit or D1 write. Commit path runs for both clean-pass and ship-as-low.
- **Method:** `generate(pieceId, date, mdx)`
- **Failure posture:** Non-retriable by design — Claude / JSON parse / validation / GitHub commit / D1 failure logs to `observer_events` via `logInteractiveGeneratorFailure` and moves on. Auditor rejection is NOT an infrastructure failure — it's an expected `auditorMaxFailed: true` terminal. Manual retry via `POST /interactive-generate-trigger?piece_id=<uuid>` or the admin piece-detail page's "Retry interactive" button once the cause is fixed.
- **Destructive regeneration (Phase 3.3):** Distinct from the idempotent retry above. `POST /interactive-regenerate-trigger?piece_id=<uuid>&type=<quiz|html>` (admin-only) wipes the existing `interactives` row + `interactive_audit_results` rows + the `content/interactives/<slug>[-html].json` file, clears `daily_pieces.interactive_id` on quiz path, fires an `interactive_regenerated` info-severity observer event with operator email, then schedules a fresh `generateInteractiveScheduled` alarm. Wipe runs synchronously (operator sees real auth/rate-limit failures); fresh generation runs in the alarm's own DO invocation. The wipe path uses `Publisher.deleteInteractiveFile(filePath, msg)` with a path-prefix guard scoped to `content/interactives/` — the daily-piece permanence rule lives in the Publisher API surface, not just the prompt convention.
- **File:** `agents/src/interactive-generator.ts`
- **Prompt:** `agents/src/interactive-generator-prompt.ts` (initial generation + revision shapes; HTML system prompt embeds [`docs/examples/interactive-reference.html`](INTERACTIVES.md#reference-hand-built-example) as a few-shot reference inside a `cache_control: ephemeral` block)

### 14. ObserverAgent
- **Role:** Logs events (published, escalated, errors, audio failures, learner failures, learning overflow, reflection metered/failed, Zita synthesis metered/failed, categoriser metered/failed, interactive generator metered/failed) to D1. Powers dashboard.
- **Methods:** `logPublished()`, `logEscalation()`, `logError()`, `logAudioPublished()`, `logAudioFailure()`, `logDailyRunSkipped()`, `logLearnerFailure()`, `logLearnerOverflow()`, `logReflectionMetered()`, `logReflectionFailure()`, `logZitaSynthesisMetered()`, `logZitaSynthesisFailure()`, `logCategoriserMetered()`, `logCategoriserFailure()`, `logInteractiveGeneratorMetered()`, `logInteractiveGeneratorFailure()`, `getRecentEvents()`, `getDailyDigest()`
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
# pieces. Idempotent — the agent skips pieces that already have
# daily_pieces.interactive_id set.
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
- `agents/src/fact-checker-prompt.ts` — FactChecker's two-pass system prompts
- `agents/src/integrator-prompt.ts` — Integrator's system prompt builder (interpolates VOICE_CONTRACT)
- `agents/src/learner-prompt.ts` — Learner's analyse-and-learn system prompt
- `agents/src/shared/voice-contract.ts` — voice contract as string constant
- `agents/src/shared/parse-json.ts` — robust JSON extraction from LLM responses
- `agents/src/shared/prompts.ts` — tombstone; prompts moved to their owning agents

## Known limitations
- Audio Auditor does basic file checks only (no STT round-trip — deliberately out of scope; STT catches hallucinations, not TTS failure modes)
- Site worker needs R2 binding + `/audio/*` route for audio URLs to resolve in production (tracked in ARCHITECTURE deviation + Phase 9 deploy list)
- Voice contract duplicated in `.md` and `.ts` (manual sync required)
- Fact-Checker web search uses DuckDuckGo instant answers (limited depth)
- Scanner XML parsing uses regex (fragile with malformed RSS)
