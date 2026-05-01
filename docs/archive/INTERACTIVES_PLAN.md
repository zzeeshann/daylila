> **Archived 2026-05-01:** Interactives v3 shipped on 2026-04-26 — all 5 phases tagged on origin (`interactives-v3.0-complete` through `interactives-v3.4-complete`, project tag `interactives-v3-complete`). See `docs/DECISIONS.md` for the full record.

# Zeemish — Interactives v3

Master plan for adding HTML interactives — explorable widgets generated per piece — alongside the quizzes that shipped in Area 4.

CLAUDE.md hard rules win when in doubt.

## Read these before starting any phase

In this order, every session:
1. `CLAUDE.md`
2. `docs/SESSION_PROTOCOL.md` — how we work across sessions
3. `docs/INTERACTIVES_STATUS.md` — where we are right now
4. `docs/INTERACTIVES_PLAN.md` (this file) — the phase you're in
5. `docs/INTERACTIVES.md` — the spec, once Phase 0 has produced it

If the status doc disagrees with `git tag --list "interactives-v3.*-complete"`, treat the tags as truth and reconcile the status doc before doing any other work.

---

## Where this fits

**Area 4 (2026-04-23 → 2026-04-25) shipped quizzes:**
- `interactives` table (migration 0022), `interactive_audit_results` (0023), `interactive_engagement` (0022)
- `InteractiveGenerator` (#15) produces them, `InteractiveAuditor` (#16) gates them
- Schema is type-discriminated (Zod `discriminatedUnion`, `type: 'quiz'` only branch)
- Content lives in `content/interactives/<slug>.json`
- Reader surface at `/interactives/<slug>/`, in-piece prompt on the last beat, drawer surfacing on `/daily/<date>/<slug>/#made`
- 8 quizzes published; latest one shipped today (2026-04-26) for the firing-squads piece

This plan extends the same pipeline to produce a SECOND artefact per piece: an HTML interactive (a slider, a scrubbable timeline, or whatever shape Claude judges fits the concept). **Both ship per piece; quizzes are unchanged.**

---

## Architectural decisions baked into v3

These are **not** open questions. They were settled by Zishan when commissioning v3 against the shipped repo. Don't re-litigate during implementation.

**No new agents.** `InteractiveGenerator` and `InteractiveAuditor` extend their responsibilities to cover the new HTML shape. Same files, same Director hooks, same observer events (extended). No "Curator," no "Composer," no "Selector" — those words would have collided with the existing `Categoriser` (#13) and they're not needed.

**No type registry.** Free-form HTML, generated per piece by Claude against one HTML generation prompt. Sandboxed in `<iframe sandbox="allow-scripts">`. One validator. One audit rubric. Adding a "type" later means tuning the prompt, not creating folders. The registry pattern in the v2 seed plan was the right idea for a system being built from scratch; for the system that already shipped it would have been a parallel architecture without a justification.

**The iframe sandbox is non-negotiable.** No `allow-same-origin`, no `allow-top-navigation`, no `allow-forms`, no `allow-popups`. Generated HTML never touches the parent page — CSS isolation, JS isolation, no cookie/storage access, no top-frame navigation, no postMessage to anything other than the engagement beacon (Phase 4).

**Validator rejects:**
- Files over 50 KB
- `localStorage` / `sessionStorage` / `indexedDB`
- `eval`, `new Function`, `setTimeout(string)`, `setInterval(string)`
- External `<script src>` not on the allowlist
  - **Allowlist:** `https://cdnjs.cloudflare.com/ajax/libs/d3/7.*` (D3 v7 only, cdnjs only)
- Network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`)
- `<iframe>` (no nested sandboxing)
- `<form>` (sandbox disallows submission anyway, but reject defensively)
- Any `data:` or `blob:` URLs in `src=` attributes (defensive)

**Every piece gets BOTH quiz AND interactive. Always.** Like audio. Like categorisation. No manipulability scoring, no per-piece "is this teachable" gate. The Generator produces both as part of its existing post-publish work.

**Always ship — newspaper never skips a day.** Auditor allows up to three revision rounds (matches the shipped quiz convention at [`agents/src/interactive-generator.ts`](../agents/src/interactive-generator.ts)). If the interactive max-fails round 3, it ships flagged (column name resolved during Phase 1) and the "How this was made" drawer surfaces a short honest note for readers:

> This interactive didn't pass all our checks. We shipped it rather than leave the day blank.

The drawer is the only surface that carries this note — the interactive itself sits inline without an above-iframe banner. This aligns with the 2026-04-25-pm drawer commit that deliberately dropped the "Rough" word from the same surface for `quality_flag='low'` interactives. The decision *not* to ship would mean the piece has half its post-publish artefacts; better one flagged interactive than none.

**Prompt caching, not cost gating.** The HTML generation prompt + voice rules + validator spec + few-shot examples are stable across every generation. They go in cached prompt blocks; the per-piece brief is the uncached portion. Cache reads cost 0.1× standard rate. At 2 pieces/day on Sonnet, the new HTML interactive work runs ~$2–3/month on top of existing spend. The admin pause toggle (Phase 3) exists as a quality circuit-breaker, not a cost defence.

---

## Five phases

Each phase is one PR (or a small commit cluster). Each ends in `git tag interactives-v3.X-complete`. Stop after each phase, show Zishan, get sign-off, then move to the next.

### Phase 0 — Spec, rubric, validator rules, sandbox rules. No code.

**Goal:** decide and write everything before any code change. No agent runs. No schema change. No site change.

**Tasks:**

1. **`docs/INTERACTIVES.md`** — the spec. Covers:
   - What HTML interactives are; how they relate to quizzes (both ship per piece)
   - The iframe sandbox shape (exact attribute list, why each)
   - The validator rule list (the eight rejection categories above, each with the AST/regex check that catches it)
   - The audit rubric (the four dimensions below)
   - The rough-marker UX rule — drawer-only placement; reader text quoted in the "Always ship" decision above
   - The pause toggle behaviour
   - The prompt caching strategy
2. **The audit rubric** (lives inside `docs/INTERACTIVES.md` or as a sibling file — decide during Phase 0):
   - **Voice** — does the in-interactive copy follow the contract (per `content/voice-contract.md`). Pass: ≥85/100.
   - **Structure** — does the HTML render as one cohesive piece, with a clear interactive surface and a clear teaching label. Pass: ≥75/100.
   - **Essence** — does manipulating the interactive teach the underlying concept, or is it decorative. Pass: ≥75/100. (Direct lift from the existing essence-not-reference rubric in `agents/src/interactive-auditor-prompt.ts`.)
   - **Factual** — are any embedded numbers / data points correct. Pass: ≥75/100.
3. **`docs/DECISIONS.md`** — append entry covering the v3 decisions: why no new agents, why HTML over registry, why iframe sandbox, why both-per-piece, why ship-rough, why prompt caching not cost gating.
4. **Book** — update `book/09-the-fourteen-roles.md` Generator + Auditor sections to note each handles two artefact types now (quiz + HTML). Same voice as daily pieces. (Filename rename to "the-sixteen-roles" is deferred — see #5.)
5. **`docs/FOLLOWUPS.md`** — add `[open]` entry for the book chapter filename rename (`09-the-fourteen-roles.md` → `09-the-sixteen-roles.md`). NOT done in this work; it's a separate book-rename pass that touches every cross-chapter reference. Marker: 16 agents now, filename says fourteen.

**Decisions resolved by Zishan when commissioning v3 (do not re-litigate):**

(a) **Rough-marker note placement: drawer only.** The interactive sits inline; the rough flag lives in the existing "How this was made" drawer alongside the rest of the transparency surface. Above-iframe was overkill given that the drawer already names which dimensions failed (since the 2026-04-25 dimension-named drawer copy commit). The exact reader text is quoted in the "Always ship" decision above.

(b) **Phase 2 hand-built example: permanent reference.** Saved as `docs/examples/interactive-reference.html` (create the directory if it doesn't exist). It is the canonical "good looks like this" file for future sessions and never gets deleted. If voice or style evolves later, the file gets updated in place rather than retired.

**Definition of done:**
- `docs/INTERACTIVES.md` is complete enough that a person could write an HTML interactive by hand that the system would (eventually) accept.
- `docs/DECISIONS.md` has the v3 entry.
- `book/09-the-fourteen-roles.md` has updated Generator + Auditor sections.
- `docs/FOLLOWUPS.md` has the book filename rename entry.
- Tag `interactives-v3.0-complete` pushed.

---

### Phase 1 — Feature flag + (maybe) schema additions

**Goal:** make the database and config ready. No agent code change in this phase.

**Tasks:**

1. **Feature flag.** Add a key to `admin_settings` (the existing key/value table from migration 0016). Working name `interactives_html_enabled`, default `false`. A meta-flag named `interactives_enabled` was Zishan's shorthand in the v3 spec; the longer name avoids accidentally suggesting quizzes are gated too. Final name resolved here.
2. **Schema check.** Verify against migrations 0022 + 0023 what's actually there before adding anything.
   - **Leading option** (per Zishan's spec): add `interactives.quality_tier TEXT` with values `'polished' | 'solid' | 'rough'`, mirroring the daily-piece tier vocabulary from [`src/lib/audit-tier.ts`](../src/lib/audit-tier.ts). Backfill the 2 existing `quality_flag='low'` rows to `quality_tier='rough'`.
   - **Alternative** (lower-cost, semantically muddier): keep `quality_flag='low'` and render it as "Rough" at read time via `audit-tier.ts`. The 2026-04-25-pm drawer fix dropped the "Rough" label *because* of the daily-piece tier collision; reusing the word for any-dimension max-fail brings that collision back unless we own it explicitly.
3. **Update** `docs/SCHEMA.md` and `docs/RUNBOOK.md` (how to flip the flag, how to roll back).

**Definition of done:**
- Migration applies locally + remote.
- `interactives_html_enabled = false`.
- Generator + Auditor behaviour unchanged on prod (still emit quizzes only).
- `docs/SCHEMA.md` reflects the new column / setting.
- Tag `interactives-v3.1-complete` pushed.

---

### Phase 2 — Generator extended; Auditor extended; reader surface

**Goal:** end-to-end pipeline producing HTML interactives gated by the flag. Real interactives in the repo, served at real URLs.

**Tasks:**

1. **HTML generation prompt.** Extend [`agents/src/interactive-generator-prompt.ts`](../agents/src/interactive-generator-prompt.ts) with a second prompt path for HTML generation. Same voice rules embedded; new structural rules (single-file HTML, sandbox-compatible, allowlist-only externals). Use Anthropic prompt caching: the HTML generation prompt + voice contract + validator spec + few-shot examples are sent as cached blocks; the request-specific brief is the uncached portion.
2. **Validator.** New shared module `agents/src/interactive-validator.ts`. Checks the rule list from Phase 0. Returns structured pass/fail with the specific rule that failed. Used by Generator inline before commit, and by Auditor for the structural dimension.
3. **Generator extension.** `InteractiveGenerator.generate()` produces HTML alongside quiz. Two artefacts per piece. Same produce → audit → revise loop, up to 3 rounds per artefact. On HTML max-fail: ship with the Phase-1-decided rough flag/tier. (Quiz path unchanged.)
4. **Auditor extension.** `InteractiveAuditor.audit()` accepts an artefact type (quiz | html), routes to the right rubric. Quiz rubric unchanged. HTML rubric is the four-dimension shape from Phase 0.
5. **File commit.** HTML lives at `content/interactives/<slug>.html` (parallel to `<slug>.json` for the quiz). Publisher's existing GitHub commit path commits both atomically per piece. `interactives` row schema decision: either a second sibling row keyed by artefact type, or new columns referencing both file paths. Decide during Phase 1 ahead of Phase 2.
6. **Reader surface.** New Web Component `<interactive-frame>` mirroring `<quiz-card>` (look at [`src/interactive/quiz-card.ts`](../src/interactive/quiz-card.ts) for the pattern). Renders the iframe with the right `sandbox=` attribute. Loads the HTML file as `srcdoc=` (no separate URL bar entry) or as `src=` (cleaner for larger files) — decide during Phase 2 implementation. The rough-marker note ships in the drawer (per Phase 0 decision (a)), not in this component.
7. **Manual-proof step before flipping the flag:**
   - Hand-write one HTML interactive for a recent published piece. Commit it to `docs/examples/interactive-reference.html` (create the directory if absent). This is the permanent reference file per Phase 0 decision (b) — never deleted; updated in place if voice evolves.
   - Look at it on prod together. If it teaches well and respects voice, flip `interactives_html_enabled = true`.

**Definition of done:**
- Flag = `true`.
- The next published piece produces both a quiz and an HTML interactive.
- "How this was made" drawer shows both.
- Tag `interactives-v3.2-complete` pushed.

**Rollback:** flip `interactives_html_enabled = false`. Generator stops producing HTML. Existing HTML files stay live (newspaper rule).

---

### Phase 3 — Admin surface

**Goal:** the operator-facing pattern that exists for audio and engagement. Mirror the audio admin shape — Zishan knows what that looks like, no spec needed from scratch.

**Tasks:**

1. **List view at `/dashboard/admin/interactives/`.** ADMIN_EMAIL gated. Lists every interactive with: status (clean / rough / pending), audit scores per dimension (latest round), quality_tier or quality_flag (per Phase 1), revision count, regenerate button. Sortable so rough ones bubble to the top.
2. **Per-piece regenerate button.** New endpoint `POST /interactive-regenerate-trigger?piece_id=<uuid>` mirroring the existing `audio-retry` pattern. Wipes the existing HTML + audit rows for the piece and triggers a fresh produce → audit → revise loop.
3. **Global pause toggle.** Wire `interactives_html_enabled` to a flip-switch on the existing admin settings page (the cadence dropdown is the precedent shape). Same `admin_settings_changed` observer event for audit trail.
4. **Cost telemetry.** Month-to-date token count for interactive generation, broken out by cached vs uncached. Sourced from a new `agent_cost_telemetry` table OR by extending `observer_events` with token counts (decide during Phase 3 based on what's already there).
5. **Update** `docs/AGENTS.md`, `docs/RUNBOOK.md`, `docs/INTERACTIVES.md`.

**Definition of done:**
- Admin can see, sort, and regenerate every HTML interactive.
- Pause toggle works (verified end-to-end: flip off, next cron produces no HTML; flip on, next cron produces HTML).
- Cost telemetry visible.
- Tag `interactives-v3.3-complete` pushed.

---

### Phase 4 — Engagement signals into Learner

**Goal:** close the self-improvement loop. The `interactive_engagement` table (migration 0022) already exists; nothing reads from it today.

**Tasks:**

1. **Engagement events.** Extend `<interactive-frame>` to fire engagement events to the existing `/api/interactive/track` endpoint. (Quiz already does this; HTML interactive is new — postMessage from sandboxed iframe to parent for "manipulated > N times in session" events. The sandbox allows postMessage to parent by default.)
2. **Aggregate.** Per-interactive aggregates feed into the Learner's input. Source `'producer'` learnings extended with patterns about which interactive shapes get used vs. skipped.
3. **Update** `docs/AGENTS.md` (Learner section) and `docs/INTERACTIVES.md`.

**Definition of done:**
- Next Learner run mentions interactive engagement in its written reflection.
- Visible in the existing learnings view + drawer.
- Tag `interactives-v3.4-complete` pushed.
- Tag `interactives-v3-complete` pushed as the project milestone.

---

## What NOT to do in this work

- No new agents. Generator + Auditor extend; nothing else.
- No type registry. Validator + audit rubric + HTML generation prompt are the architecture.
- No per-piece manipulability scoring. Both artefacts always.
- No skipping a piece's interactive on max-fail. Ship rough.
- No `allow-same-origin` on the iframe. Ever.
- No external scripts beyond D3 v7 from cdnjs.
- No fixing the book chapter filename in this work — it goes to FOLLOWUPS for a separate rename pass.
- No changes to the existing quiz pipeline. Generator + Auditor's quiz code paths run as they do today.

## Order-of-operations summary

| Phase | What ships | Risk | Reversible by |
|---|---|---|---|
| 0 | Spec, rubric, validator rules, sandbox rules, book chapter | None | Deleting the files |
| 1 | Feature flag + (maybe) `quality_tier` column | Migration could fail | `wrangler d1 migrations rollback`, flip flag |
| 2 | Generator + Auditor extension + `<interactive-frame>` | Bad HTML shipped | Flip flag off, revert phase 2 commits |
| 3 | Admin surface | Could over-pause | Flip toggle back on |
| 4 | Engagement → Learner | Privacy/analytics surface (postMessage from sandbox) | Disabling the listener |
