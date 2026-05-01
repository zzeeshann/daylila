> **Archived 2026-05-01:** all six Part-1 actions + the Part 2 architecture-flexibility documentation shipped on 2026-04-26. See `docs/DECISIONS.md` for the full record.

# Zeemish refinement plan — 2026-04

**Source brief:** `~/Downloads/ZEEMISH_REFINEMENT_BRIEF.md` (2026-04-26 hand-off, kept outside the repo)

**Single test for every change in this session:** *Does this help someone educate themselves for humble decisions?*

**Mission framing:** Humbleness. Quietness. Calmness. Consciousness. Zita = "little hope".

## Why this exists

Zeemish launched 2026-04-18 and is operationally healthy. The pipeline ships, topic diversity is solved (six different topics across the last six pieces), audio + interactives + library + dashboard all live. This refinement pass is not about fixing what works. It is about closing the gap between what the system *does* and what the system *knows it is*. The four-word mission and Zita's framing live in Zishan's head; the agents behave correctly but don't *know who they are* in writing; the voice contract is drifting in consistent, prompt-level ways; the book freezes at early-Area-5 and misses the soul chapter that explains why Zeemish exists. This plan is the pass that gets all of that into the repo.

**Constraints:** No agent refactor. No schema change. No new dependencies. No pipeline-flow changes. No regenerating published pieces. Each action ships as one commit with all relevant docs synced.

## Research findings

### 1.1 Piece length

16 published pieces audited (2026-04-17 through 2026-04-26). Range **728–1,488 words**. Median ~1,130. The Chernobyl piece (2026-04-26, the brief's calibration point) is **1,277 words across 5 beats** (255 words per beat) and lands cleanly with no drag. Pieces below 800 (Executions 728, Tariffs 781) work only when sparse — they feel thin if forced into 5–6 beats. Pieces above 1,400 (Air traffic 1,488, Airline fuel 1,484) start to strain density.

The drift isn't word count, it's **beat count**. Voyager (1,223 words / 7 beats) repeats its principle in beat 6; the teaching had landed by beat 5. Pieces with 5–6 beats hit the sweet spot regardless of length. Verdict: keep 1000–1500 words. Add explicit beat-count guidance instead.

### 1.2 Agent characters

16 agents audited. Of these:
- **Has character today:** Curator only (anti-gatekeeping disposition shines through after the 2026-04-25 reframe).
- **Partial character:** Drafter, Learner, Categoriser, InteractiveGenerator.
- **Function-only descriptions:** the remaining 11.

Top three most needing character work: **Drafter** (writes the teaching but reveals no opinion on what good explanation means beyond the voice contract), **Learner** (synthesises patterns but never says what kind of learning it values), **InteractiveGenerator** (the "essence not reference" rule is a constraint, not a character).

### 1.3 Curator topic taxonomy

The current TEACHABILITY section in `agents/src/curator-prompt.ts` (post-2026-04-25 reframe) has 8 worked examples. The brief proposes 8 categories that should be visible in Curator's awareness. Comparing the two:

- **Already covered well:** policy/institutional incentive design, business/market structure, supply chain/chokepoints, science/pattern recognition.
- **Partially covered:** culture/language (the brief's framing of word-shift and practice spread/death is not the same as the existing "celebrities + parasocial relationships" example); psychology (existing "crime → human psychology" covers one slice; biases + attention + belief change deserve standalone presence).
- **Genuine gaps (6):** social conditioning (norms, defaults, invisible pressure), psychological & cognitive patterns as standalone, environmental systems (ecological mechanics — nothing there now), money & ordinary life (personal financial systems — current example is macro-only), health systems (diagnostic reasoning, clinical trials, triage — nothing there now), technology & daily life (current example is adoption-focused, not mechanism-focused).

Verdict: add the 6 genuine gaps as new TEACHABILITY examples. Sharpen the 2 partials. Result: 14 worked examples (8 existing + 6 new), with 2 sharpened. Not 16 — the brief's 8 categories overlap with existing in 2 cases.

### 1.4 Voice contract drift

Five most-recent pieces audited against `content/voice-contract.md`. The drift is **systematic**, not one-off. Three recurring patterns:

1. **Summary-first hooks** — every piece in the sample has at least one. Hook explains the situation before asking the question. (FISA, Soldier-betting, Maine data centres, Palestine elections all open this way.)
2. **Explanatory teaching opens** — Teaching beat #1 typically begins "X is …" or "When X happens, Y …" (didactic). Should open with a specific observation, then extract the principle.
3. **Over-explaining closes** — Palestine elections close runs four sentences ("Elections in contested spaces are never just about outcomes…"). Voice contract rule: one sentence that lands.

Banned-words check across the 5 pieces is clean — zero hits.

The drift is consistent enough that the fix lives in the prompt and the contract, not in per-piece tuning. Full audit doc with verbatim quotes and example rewrites lands at `docs/VOICE_AUDIT_2026-04.md`.

A separate finding surfaced in this audit: `content/voice-contract.md` line 34 says "1500–2500 words across all teaching beats" while the Drafter prompt says "1000-1500 words across all beats". Production is publishing 728–1,488 word pieces — the Drafter prompt is winning, the voice contract is stale. Both will be aligned in Action 1.

### 1.5 Holistic simplification audit

**Unnecessarily complex (3 candidates):**
- `submissions` table — scaffolded in 0001 for course-era practice data; zero writers and zero readers since the lessons era ended. Ghost table.
- `progress` table — 13 lifetime writes, all course-shaped, none read at runtime. Course-era leftover.
- `daily_pieces.has_interactive` column — explicitly deprecated in 0022, kept physical because SQLite DROP COLUMN forces a table rebuild with FK ripple. Acceptable trade-off; documented in SCHEMA.md.

**Well-designed (leave alone):** `daily_piece_audio` per-beat keying, `learnings` source/category orthogonal axes, `admin_settings` k/v shape, observer multi-dimensional logging.

**Missing or fragile:**
- No test coverage for the multi-per-day piece-id split logic (one-time manual backfill, no regression net).
- Audio CDN cache invalidation gap on per-beat regen (known; dashboard "hard-refresh to confirm" copy is the workaround).
- `pipeline_log.run_id` semantic dual-life (still date-shaped, with `piece_id` column added alongside in migration 0018 — a future session needs to commit one way).

**Specific brief questions:**
- **Audio Auditor: keep.** Genuine separation of concerns; collapsing into Producer would create a monolithic generate-and-validate agent. Documented at `agents/src/audio-auditor.ts:58`.
- **Observer: just-right.** 13 piece-scoped helpers agent-side, 4 system-scoped site-side (asymmetry documented). One brittleness — backfill relied on manual wrangler execute, no CI gate.
- **Dashboard: matches operator needs.** Surfaces operator decisions (tier mix, escalations, fact-check offline state, rounds, candidates). Reader metrics deliberately separated to per-piece admin pages.

These findings ship as a `docs/DECISIONS.md` entry — pure record, no action.

### 1.6 Book gap analysis

Chapter list spans 5 parts, 18 written or outlined chapters plus appendices. Findings:
- **Soul chapter: missing.** Zero hits across `book/` for "Humbleness" / "Quietness" / "Calmness" / "Consciousness" / "little hope". Chapter 08 ("The idea") embeds the protocol and hospitality principle as design constraints but does not name the four-word mission or Zita's meaning.
- **Stale chapters: none.** Chapters 08–10 reference the multi-per-day cadence; Chapter 17 was updated 2026-04-21; outlines (07, 11–13, 15–16) can't be stale.
- **Missing post-launch coverage** (separate work, flagged to FOLLOWUPS): Categoriser (14th agent, not in chapter 09), InteractiveGenerator + InteractiveAuditor (15th + 16th agents, undocumented), Area 5 single-scroll layout (chapter 10 still describes the old paginated `<lesson-shell>` state machine).

## Actions, sequenced

Each action ships as a single commit. Pause for read after each.

### Action 1 — Voice contract audit + Drafter prompt revision

- Land `docs/VOICE_AUDIT_2026-04.md` with the three drift patterns, verbatim example quotes from the 5-piece sample, and 1–2 example rewrites per pattern.
- Update `content/voice-contract.md`: fix the 1500–2500 / 1000–1500 contradiction in the Teaching rule; tighten Hook to "observe and ask, never summarise and explain"; tighten Teaching to "open with a specific observation, the principle follows".
- Mirror to `agents/src/shared/voice-contract.ts` (single source of truth — Voice Auditor + Interactive Auditor pick this up automatically).
- Update `agents/src/drafter-prompt.ts` with the same reset language.

### Action 2 — Drafter beat-count guidance

- Drafter prompt: "Target 5–6 beats per piece. 7+ beats is the padding zone." Word range stays 1000–1500.
- Voice contract gets the same beat-count rule alongside the structure rules.
- No StructureEditor change — its 3–6 beat range still applies.

### Action 3 — Curator taxonomy expansion

- Add 6 new TEACHABILITY examples to `agents/src/curator-prompt.ts`: social conditioning, psychology/cognition, environmental systems, money/ordinary life, health systems, technology/daily life. One worked-example pattern each, matching the existing 8.
- Sharpen 2 existing examples (culture/language, psychology) to name the underlying mechanism.
- Sync `docs/AGENTS.md` Curator section.
- Sync `book/09-the-fourteen-roles.md` Curator chapter.

### Action 4 — Agent characters in `docs/AGENTS.md`

- For each of the 16 agents, write 3–5 sentences covering: (1) what this agent fundamentally cares about; (2) what character failure looks like for it; (3) how it should approach its work.
- Land as a "Character" paragraph inside each agent's existing section in `docs/AGENTS.md`. **No separate file.** Single source of truth per agent; reads as one continuous "who and what" rather than two parallel documents.
- The brief proposed `docs/AGENT_CHARACTERS.md`; that proposal is overridden in favour of in-place expansion. Decision recorded.
- Whether agent system prompts should *inject* character text at runtime is deferred — flagged for a future session.

### Action 5 — Holistic simplification audit entry

- Append to `docs/DECISIONS.md`: "Holistic simplification audit — 2026-04-26". Three sub-sections — well-designed surfaces, unnecessarily complex candidates (with leave-physical-and-document verdicts; no DROPs this session), missing or fragile gaps (with one-line "what would close this" notes; no implementation this session).
- Pure record. No code change.

### Action 6 — Soul chapter (book)

- Write a new chapter draft, ~600 words, in Zeemish voice. Working title: *"The four words underneath the work"* or whatever lands cleanly during writing.
- Content: name and unpack Humbleness / Quietness / Calmness / Consciousness; explain Zita as "little hope" and what that means for the platform's emotional register; describe the hospitality principle (Hindu grandmother in Delhi, Muslim teenager in Bradford, atheist programmer in Berlin, Catholic nurse in Manila — all should feel the same piece was written for them) as it lands today.
- Slot as standalone Chapter 00.5 between Preface and Chapter 01. The four words are a *foundation*, not part of "The idea" (which is about the project's shape).
- Update the book's CONTENTS.
- Add a FOLLOWUPS entry for the missing post-launch coverage (Categoriser chapter addendum, Interactives v3 chapter, Area 5 layout chapter). Don't write those here.

### Part 2 — Architecture flexibility (documentation only)

After Part 1 actions are complete and approved. Three short paragraphs added to `docs/ARCHITECTURE.md` under a new `## Future flexibility` section:

- **LLM portability** — what it would take to make the model configurable at the worker level. Today every agent file calls `claude-sonnet-4-5` directly. The change is: read model from `admin_settings` (or env var) at agent-init, store as instance field, pass into every API call. No abstraction layer; `anthropic.messages.create({ model: this.model, ... })` works for any Claude model. Build estimate: ~4 hours.
- **Audio portability** — `AudioProvider` interface shape: `{ generate(text, voice_settings, previous_request_ids?): Promise<{ audio_buffer, request_id, character_count }> }`. Implementations live alongside the producer; producer chooses provider via `admin_settings`. OpenAI TTS / Google TTS slot in without producer rewrites. Build estimate: ~6 hours.
- **Multi-environment support** — no staging today. To add: separate D1 (`zeemish-staging`), separate R2 (`zeemish-audio-staging`), separate worker names, separate GitHub branch (`staging` → staging workers, `main` → prod). Worker code reads `ENVIRONMENT` from wrangler.toml `[vars]` to switch DB bindings. Build estimate: ~8 hours.

## Out of scope

- Refactoring any working agent.
- Schema changes (no migrations this session).
- New dependencies.
- Pipeline-flow changes.
- Regenerating or updating any published piece (permanence rule).
- Building any of the Part 2 flexibility items — documentation only.
- Writing the missing post-launch book chapters (Categoriser, Interactives v3, Area 5) — flagged via FOLLOWUPS, separate work.
- Curator skip-rate tuning (covered by FOLLOWUPS observing entry, unblock 2026-04-28).
- Categoriser novel-category rate tuning (covered by FOLLOWUPS observing entry, unblock 2026-04-30).

## Verification per action

- **Action 1 (voice):** wait for the next 02:00 / 14:00 UTC pipeline run. Confirm the new piece's hook is observe-and-ask, teaching opens with observation, close lands in one sentence.
- **Action 2 (beat count):** same next-piece check — confirm 5–6 beats not 7+.
- **Action 3 (Curator taxonomy):** watch Curator pick reasoning over 5–7 cron runs. Look for novel category framings ("this teaches diagnostic reasoning" / "how rent-setting works" / "ecological mechanics").
- **Action 4 (characters):** documentation; verify by reading after the commit.
- **Action 5 (simplification):** documentation; verify by reading after the commit.
- **Action 6 (soul chapter):** verify by reading the chapter against the four-words mission. Does it sound like Zeemish? Does it land?
- **Part 2 (architecture flex):** documentation; verify the three paragraphs read crisply and the effort estimates are honest.
