# Task 05 — Audio Auditor Persistence — Implementation Plan

**Brief:** [`docs/foundation-fix/05-AUDIO-AUDIT.md`](./05-AUDIO-AUDIT.md)
**Branch:** `foundation-fix-05-audio-audit` (off `main` at `2c26ba0`)
**Closes:** L10 (`daily_piece_audio.duration_seconds` always NULL), L11 (no `file_size_bytes` column), L12 (no `audio_audit_results` table)
**Precedent:** [DECISIONS 2026-05-06 "L1, L2, L25 closed"](../DECISIONS.md) (Task 03), [DECISIONS 2026-05-11 "L15 closed"](../DECISIONS.md) (Task 04)

---

## At-a-glance

- **One bundled migration `0033_audio_audit_persistence.sql`** — `CREATE TABLE audio_audit_results` (10 columns, no `audit_round`, no FK, single composite index) + `ALTER TABLE daily_piece_audio ADD COLUMN file_size_bytes INTEGER`. Header comment names all three closures (L10/L11/L12).
- **Closed-enum `AudioIssueType`** (8 values) added to `agents/src/types.ts`. Auditor maps each existing issue branch to one value at the push site; Director defensively validates on persistence and `observer.logError`s once-per-run on unknowns. Same posture as Task 03's `RejectionCategory`.
- **Persistence lives inside `AudioAuditorAgent.audit()`**, mirroring `InteractiveGeneratorAgent.persistAuditRows()`. One `this.env.DB.batch()` call after the verdict is computed. Wrapped in try/catch — verdict survives a D1 hiccup; `persistError: string | null` propagates up to Director for one-shot Observer logging.
- **Always-write at least one row.** Summary row (`beat_name=NULL`, `issue_type=NULL`, `passed=1` if no major issues else `0`) plus one row per issue. Lets `SELECT passed FROM audio_audit_results WHERE piece_id=? AND beat_name IS NULL ORDER BY created_at DESC LIMIT 1` answer "did this piece audit cleanly" in one query.
- **Retries append, no wipe, no `audit_round` column.** Each `audit()` call writes a fresh batch with a new `created_at`. Operator queries that want "the latest verdict" use `ORDER BY created_at DESC LIMIT 1`. YAGNI on `audit_round` since the auditor has no produce→audit→revise loop.

---

## Q1 — `audio_audit_results` schema shape

10 columns, dropping two from the brief's 12 and renaming one for the actual PK shape.

| Column | Type | Why |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID. Mirrors migration 0023's PK shape; AUTOINCREMENT INTEGER would diverge from the codebase's UUID-first norm. |
| `piece_id` | `TEXT NOT NULL` | The only join key the brief and reads need. |
| `beat_name` | `TEXT` (nullable) | Replaces the brief's `beat_index INTEGER`. `daily_piece_audio` PK is `(piece_id, beat_name)`; `beat_name` is the kebab string the auditor already produces (`AudioIssue.beatName: string \| null`). Storing `beat_index` would mean recomputing an ordinal that doesn't exist in the source data and breaking the natural join. NULL = piece-level issue (matching `AudioIssue.beatName: null`) or summary row. |
| `passed` | `INTEGER NOT NULL` | 0/1 codebase convention. `passed=1` on summary row when no major issues; `passed=0` on every issue row and on the summary row when any major issue exists. |
| `issue_type` | `TEXT` (nullable) | Closed enum (Q2). NULL on summary row. |
| `issue_severity` | `TEXT` (nullable) | `'minor' \| 'major'` — matches the existing `AudioIssue.severity` union exactly so we don't reinvent vocabulary. NULL on summary row. |
| `notes` | `TEXT` (nullable) | The free-form `AudioIssue.issue` string verbatim (preserves the auditor's "Audio suspiciously small: 12KB for 800 chars (expected ~78KB). Possibly truncated." prose so admin queries don't need to re-format). On the summary row carries a short rollup string `"Audited N beats, K issues (M major)"`. |
| `r2_key` | `TEXT` (nullable) | Useful for missing-file / size-anomaly issues — the operator can `wrangler r2 object head` the exact key without re-deriving the path. NULL for piece-level issues and summary rows. |
| `actual_size_bytes` | `INTEGER` (nullable) | Populated when the issue is size-related (the `obj.size` value the auditor already has in scope). NULL otherwise (text-too-short, no-rows, char-cap, summary). Drops the brief's `expected_size_bytes` — it's a deterministic function of `character_count × EXPECTED_BYTES_PER_CHAR` and storing it duplicates a constant. |
| `created_at` | `INTEGER NOT NULL` | Unix ms (codebase norm — `interactive_audit_results.created_at` is INTEGER ms, not the brief's `DATETIME DEFAULT CURRENT_TIMESTAMP`). |

**Dropped from brief:** `audit_round` (Q6 reasoning), `expected_size_bytes` (derivable). The FK `REFERENCES daily_pieces(id)` is also dropped — migration 0023 explicitly chose no FK ("Application-layer integrity. Orphan rows… are acceptable").

**Indexes:** one composite `idx_audio_audit_piece_created ON audio_audit_results(piece_id, created_at)`. Mirrors `idx_int_audit_interactive_round` shape — leftmost-prefix matching means a single `piece_id` lookup also benefits, and the `created_at` tail orders the latest verdict cheaply. The brief's second index `(passed) WHERE passed = 0` is speculative; Year-1 row count is small (~3k rows worst case) and SQLite full-scans those in milliseconds. Same calculus as Task 03's no-speculative-index call.

## Q2 — `issue_type` closed enum

**Closed enum, mirroring `RejectionCategory`'s posture.** The auditor IS the only writer (parallel to Curator being the only Curator-rejection writer); the codebase controls every issue path end-to-end.

The seven distinct issue shapes from `agents/src/audio-auditor.ts:80–151`:

| Auditor branch | Enum value |
|---|---|
| `"No audio rows found for {date} — producer did not run or persist failed"` | `no_audio_rows` |
| `"Audio file missing in R2: {r2_key}"` | `missing_file` |
| `"Audio file is 0 bytes"` | `empty_file` |
| `"Audio suspiciously small: …KB for … chars (expected ~…KB). Possibly truncated."` | `size_too_small` |
| `"Audio suspiciously large: …KB for … chars (expected ~…KB)."` | `size_too_large` |
| `"Very short text ({n} chars) — beat may not be worth audio"` | `text_too_short` |
| `"Total characters {n} exceeds cap {cap}"` | `character_cap_exceeded` |

Plus `unknown` reserved as a catch-all for forward-compat (mirroring how Director's defensive validation in Task 03 logs once on unknowns rather than dropping data).

Encoded in `agents/src/types.ts`:

```ts
export type AudioIssueType =
  | 'no_audio_rows' | 'missing_file' | 'empty_file'
  | 'size_too_small' | 'size_too_large' | 'text_too_short'
  | 'character_cap_exceeded' | 'unknown';
export const AUDIO_ISSUE_TYPES: ReadonlySet<AudioIssueType> = new Set([
  'no_audio_rows', 'missing_file', 'empty_file',
  'size_too_small', 'size_too_large', 'text_too_short',
  'character_cap_exceeded', 'unknown',
]);
```

The mapping site is the auditor itself (it knows which branch fired). The `AudioIssue` interface gains an `issueType: AudioIssueType` field — additive; every `issues.push({...})` site sets it explicitly at construction time.

## Q3 — Where the persistence write lives

**Inside `AudioAuditorAgent.audit()`**, immediately before the existing `this.setState(...) ; return result` tail.

Justification:
- Audio Auditor is structurally closer to InteractiveGenerator than to Curator. Both InteractiveGenerator and AudioAuditor are sub-agents Director invokes via `this.subAgent(...)`, both have direct `this.env.DB` access in the same DO context, both own a self-contained "produce a verdict + persist" lifecycle.
- Curator's pattern (return data, let Director persist) made sense in Task 03 because Director already had to UPDATE `daily_candidates` to flip `selected=1` — a natural merge site. No analogous merge exists here.
- `persistAuditRows()` from `agents/src/interactive-generator.ts:1585` is the exact precedent.

**Failure-mode handling:** wrap the batch in try/catch locally. On throw, store the error message in `result.persistError`. The `AudioAuditResult` interface gains `persistError: string | null`. Director reads it after the audit call and fires `observer.logError('audio-auditor', 0, persistError, pieceId)` exactly once per audit call. No per-row spam. The `passed` boolean and `issues` array are computed in memory before the persistence batch fires; Director's branch logic at `director.ts:1487` (`if (!auditResult.passed)`) fires on the in-memory verdict identically to today.

## Q4 — Summary row vs no summary row

**Write the summary row.** One extra row per audit; the cost is trivial (~365 extra rows/year) and the read-side payoff is real:

1. **Single-query verdict.** `SELECT passed FROM audio_audit_results WHERE piece_id=? AND beat_name IS NULL ORDER BY created_at DESC LIMIT 1` answers the most common question.
2. **Disambiguates "audited and clean" from "never audited."** Without the summary row, zero rows is ambiguous (clean? never ran? wiped?). With it: zero rows = never audited; summary row passed=1 = audited and clean.
3. **Historical truth survives rule changes.** If the auditor's `passed` rule ever shifts (e.g. promoting a `minor` to fail-blocking), the historical `passed` value stays honest about the verdict at the time, without retroactive recompute.

The Interactive precedent's lack of summary row works for *that* table because every dimension row is binary and there are exactly four per round (fixed cardinality, cheap MIN). Audio's issue count varies (0 to N) with no fixed dimension, so the explicit summary is more honest.

**Summary row shape:** `beat_name=NULL`, `issue_type=NULL`, `issue_severity=NULL`, `notes="Audited {N} beats, {K} issues ({M} major)"`, `r2_key=NULL`, `actual_size_bytes=NULL`, `passed = !hasMajor ? 1 : 0`.

## Q5 — Always-write vs only-on-issues

**Always write — at minimum the summary row.** Tied to Q4: the summary row IS the "this piece was audited" marker. Zero issues → 1 row (summary, passed=1). N issues → N+1 rows.

## Q6 — Retries and idempotency

**Append every audit run. No `audit_round` column.**

- The auditor doesn't have produce→audit→revise rounds; it runs once per pipeline invocation. An `audit_round` column would always read `1` — dead weight.
- `Director.retryAudio` / `Director.retryAudioBeat` (lines 1620–1745) re-run the whole audio pipeline; calling the auditor again is the *expected* path after an operator-triggered fix. The append history is exactly what an operator wants ("we tried 3 times, here's what changed").
- `created_at INTEGER` is the natural ordering. "Latest verdict" = `ORDER BY created_at DESC LIMIT 1`. "Audit history" = `ORDER BY created_at ASC`.
- Wipe-prior-rows would conflict with the forward-only / non-destructive posture from Tasks 03 and 04.
- An explicit `audit_round` column adds a write-time `SELECT MAX(audit_round)+1` per call for no read-side benefit. If a future reader wants "attempt N" labels, it derives at query time from `ROW_NUMBER() OVER (PARTITION BY piece_id ORDER BY created_at)` (SQLite supports window functions since 3.25).

**Bind-count safety:** a piece with 12 beats + summary = 13 rows × ~9 binds = ~117 binds per batch. D1's per-statement bind cap is ~100; the *batch* is N statements each bound independently, so per-statement count is ~9. Safe. Code comment at the batch site names the awareness, parallel to Task 04's comment.

## Q7 — Mirror on the site worker?

**Confirm deferred-surface posture.** Same calculus as Tasks 03 and 04:

- Persistence lands; the surface is content-design work.
- The admin per-piece deep-dive's `audioRows` SELECT is column-explicit (`SELECT beat_name, r2_key, public_url, character_count, duration_seconds, …` at `src/pages/dashboard/admin/piece/[date]/[slug].astro:217`); won't break when `file_size_bytes` joins the table.
- An "audio audit history" panel on the per-piece page that shows the latest summary + per-beat issues is exactly the right surface — but content-design decides what it looks like. Queue it.

**Two new `[deferred]` FOLLOWUPS entries:**

1. Surface `audio_audit_results` on admin per-piece deep-dive (next to `audioRows` table).
2. Backfill `made.ts:295`'s `totalSizeBytes: null` to `SUM(file_size_bytes)` once L11 populates and the made-drawer is touched for other reasons.

## Q8 — `duration_seconds` derivation strategy (L10)

**Compute from bytes assuming 96 kbps.** `duration_seconds = Math.round(byteLength / 12000)`.

- ElevenLabs' `text-to-speech/{voice_id}` endpoint returns audio bytes + `request-id` header only; no duration metadata.
- 96 kbps is the configured `output_format` (`AUDIO_OUTPUT_FORMAT = 'mp3_44100_96'` in `agents/src/shared/audio-thresholds.ts`). 96 kbps × 1 sec = 12 KB/sec. Math is deterministic for the actual bitrate the pipeline produces.
- The auditor's `EXPECTED_BYTES_PER_CHAR = 960` constant already encodes the same 96 kbps × 12.5 chars/sec assumption. Using the same calculation upstream keeps the pipeline internally consistent.
- Use case is admin display + crude operator queries, not playback timing (the player gets exact duration from the MP3 file at render time).
- `/with-timestamps` endpoint would double API spend per beat (~$0.30 → ~$0.60 per piece on average) for an integer-rounded display value. No.
- MPEG frame parsing is overengineered (~50 LOC for an integer).

Doc-comment at the call site names `AUDIO_OUTPUT_FORMAT` as the source-of-truth assumption, with a "if you change one, change both" warning. `daily_piece_audio.duration_seconds INTEGER` is already in the schema (always-NULL today) — no migration needed for L10, only the producer needs to populate it.

## Q9 — `file_size_bytes` collection point (L11)

**`audioBuffer.byteLength` captured immediately after `arrayBuffer()`** at `agents/src/audio-producer.ts:331`. Threaded into `BeatAudio` (interface gains `fileSizeBytes: number`), bound by `persistBeatRow` in the existing INSERT OR REPLACE. Single migration ALTER `daily_piece_audio ADD COLUMN file_size_bytes INTEGER`. Both columns nullable so historical rows stay as honest NULLs (forward-only, per the brief).

The `persistBeatRow` SQL at `audio-producer.ts:350` gains `file_size_bytes` in the column list and replaces the `NULL` literal at line 353 with two binds (`duration_seconds` from byte-derivation + `file_size_bytes` from byteLength).

## Q10 — Migration shape

**One bundled migration: `migrations/0033_audio_audit_persistence.sql`.**

Contents:
1. Header comment (mirroring 0031 / 0032 prose shape) naming all three closures (L10 file_size_bytes column, L11 duration_seconds population, L12 audio_audit_results table) and citing the DECISIONS entry by date.
2. `CREATE TABLE IF NOT EXISTS audio_audit_results (...)` — 10-column shape from Q1.
3. `CREATE INDEX IF NOT EXISTS idx_audio_audit_piece_created ON audio_audit_results(piece_id, created_at)`.
4. `ALTER TABLE daily_piece_audio ADD COLUMN file_size_bytes INTEGER` — additive nullable.
5. POST-APPLY VERIFY block as SQL comment (`PRAGMA table_info(...)`, expected column list, expected index, `SELECT COUNT(*) = 0`).

Filename `audio_audit_persistence.sql` (not `audio_audit_results.sql`) advertises that it spans both tables. Bundle vs split: the brief itself bundles them ("tiny and adjacent enough to land in this same task"), both leaks populate from the same producer commit, and splitting creates an awkward in-between state where agent code can't yet write `file_size_bytes` because the column doesn't exist.

## Q11 — Verifier?

**No new verifier.** Tasks 03 and 04 didn't add verifiers. The closed-enum validation at the persistence call site (auditor-side mapping + Director-side defensive check + `observer.logError`-once-per-run) provides runtime drift visibility. Existing `pnpm verify-contracts-fresh` covers contract drift. `tsc --noEmit` covers the typed-union enum shape.

A `verify-audio-audit-persistence.mjs` would mostly assert "the writer respects the closed enum" and "row count matches expected" — already enforced at the type system + runtime-validation layer.

## Q12 — Operator queries

**Ship `scripts/audio-audit-health.sql`** with four read-only queries, parallel to Task 04's `scripts/learner-health.sql`:

1. **`recent_audits`** — last 30 piece audits via `(piece_id, latest summary row, pass/fail, issue count)`. Window function over `created_at` to scope to the latest summary per piece.
2. **`issue_type_breakdown`** — last 30 days, count by `issue_type`, ORDER BY count DESC. Drives investigation priority on what the auditor flags most.
3. **`unfilled_metadata`** — `daily_piece_audio` rows where `file_size_bytes IS NULL` or `duration_seconds IS NULL`. Pre-Task-05 historical rows expected; non-zero count post-Task-05 means producer broke.
4. **`size_anomalies`** — beats where `actual_size_bytes / character_count` falls outside the auditor's MIN/MAX_SIZE_RATIO band but somehow wasn't flagged. Cross-check on the auditor itself.

All four SELECT-only; safe against prod with no risk of writes. Each annotated with what its result means.

**RUNBOOK addition** parallel to Task 04's "Verify Learner feedback loop populates":

```
### Verify audio audit results populate
After the next cron-triggered piece publishes (24h+ after deploy):

  wrangler d1 execute zeemish --remote --command \
    "SELECT * FROM audio_audit_results WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)"

Expect: at least one row (summary), plus one per audit issue if any.

  wrangler d1 execute zeemish --remote --command \
    "SELECT id, file_size_bytes, duration_seconds FROM daily_piece_audio
     WHERE piece_id = (SELECT id FROM daily_pieces ORDER BY created_at DESC LIMIT 1)"

Expect: every row has both columns populated. NULL means producer didn't fill them.
```

## Q13 — Docs touched in same commit

- **`docs/SCHEMA.md`** — new `audio_audit_results` section between current `interactive_audit_results` (line 368) and the migrations summary; existing `daily_piece_audio` section gets a new `file_size_bytes` row + the `duration_seconds` row's "Nullable — not currently measured" note flips to "Populated since Task 05 / migration 0033 — bytes ÷ 12000 (96 kbps assumption); NULL on pre-Task-05 historical rows".
- **`docs/AGENTS.md`** — Audio Auditor section (line 138–146) gains a "Persistence" subsection naming the new table, the closed-enum mapping, the always-summary-row rule, and the append-on-retry semantic. Audio Producer section (line 124–137) gains a "Metadata fields" note for the two new columns.
- **`docs/DECISIONS.md`** — append entry titled "L10, L11, L12 closed YYYY-MM-DD" mirroring 2026-05-11's shape (decisions-up-front block, files-touched block, verification block).
- **`docs/FOLLOWUPS.md`** — confirmed no-op on entry removal (the brief's "remove L10, L11, L12" doesn't apply literally; those IDs aren't current entries). Add the two `[deferred]` entries from Q7 (admin per-piece audit-history surface; made-drawer `totalSizeBytes` backfill).
- **`CLAUDE.md`** — latest-session header at top + the Audio Auditor agent description in the agents-team list gains "now persists per-issue rows + summary row to `audio_audit_results`".
- **`docs/RUNBOOK.md`** — "Verify audio audit results populate" subsection from Q12 + "Operator queries: Audio audit health" pointer.
- **`book/13-audio-pipeline.md`** — section on the auditor gets a "Where the verdict lives" paragraph naming `audio_audit_results` (parallel shape to Voice Auditor's "Where the 85 lives" / Categoriser's "Where the rule lives" / Audio Producer's "Where the rule lives").
- **`book/99-glossary.md`** — add new "Audio audit" entry alphabetically between "Audio contract" and "Beat" (currently glossary has "Audio contract" but not the audit verdict by name).

## Q14 — Failure posture confirmation

Both confirmed:

(a) **Persistence write inside auditor wraps in try/catch + logs once via Director.** The throw is caught locally; sentinel `persistError: string | null` field on `AudioAuditResult` propagates up. Director fires `observer.logError('audio-auditor', 0, persistError, pieceId)` exactly once per audit call. No per-row spam.

(b) **Audit verdict that Director consumes is unaffected by persistence outcome.** The `passed` boolean and `issues` array are computed in-memory before the persistence batch fires. If the batch throws, the catch block stores `persistError`; the `result` object returns unchanged. Director's branch at `director.ts:1487` (`if (!auditResult.passed)`) fires on the in-memory verdict identically to today's behaviour.

Audio is ship-and-retry: text already shipped (per `runAudioPipeline` ordering — text-publisher → audio-producer → audio-auditor → audio-publisher). A persistence hiccup on the audit-results table does not block audio pipeline completion or escalation. Same posture as Task 04's "fail-open on both UPDATEs".

## Q15 — Order of operations + commit sequence

Four commits, parallel to Tasks 03 and 04:

1. **Commit 1 (DB layer):** `migrations/0033_audio_audit_persistence.sql`, `scripts/audio-audit-health.sql`, `docs/SCHEMA.md`, `docs/RUNBOOK.md`. Lands migration + read-side ops queries together. Migration is non-destructive (additive nullable column + new empty table); safe to deploy before agent code lands.
2. **Commit 2 (agent code):** `agents/src/types.ts` (add `AudioIssueType`, `AUDIO_ISSUE_TYPES`, extend `AudioIssue` with `issueType`, extend `AudioAuditResult` with `persistError`), `agents/src/audio-auditor.ts` (map each issue branch to its `issueType`, add `persistAuditRows` private method called at end of `audit()`), `agents/src/audio-producer.ts` (capture `byteLength`, compute duration, thread both into `BeatAudio` + `persistBeatRow`), `agents/src/director.ts` (read `auditResult.persistError` and fire `observer.logError` once if present).
3. **Commit 3 (operator docs):** `CLAUDE.md`, `docs/AGENTS.md`, `docs/DECISIONS.md` (the new entry), `docs/FOLLOWUPS.md` (the two `[deferred]` entries).
4. **Commit 4 (book):** `book/13-audio-pipeline.md`, `book/99-glossary.md`.

**Migration apply sequencing:** ship Commit 1 → CI deploys → operator runs `wrangler d1 migrations apply zeemish --remote` (additive-only so safe) → ship Commits 2–4 → CI deploys agent code that writes to the new column + table. If the order slips, the try/catch around `persistAuditRows` is the safety net; `observer.logError` will surface in the admin feed within hours.

---

## Verification plan

- `cd agents && pnpm verify-contracts-fresh` ✓ (no contract changes; sanity check codegen still matches).
- `cd agents && pnpm tsc --noEmit` — expect only the 26 pre-existing `src/server.ts` Durable Object errors documented in CLAUDE.md, zero new errors.
- `cd agents && pnpm verify-splice && pnpm verify-normalize && pnpm verify-validator && pnpm verify-dedup && pnpm verify-categoriser-floor && pnpm verify-interactive-voice && pnpm verify-parse-retry && pnpm verify-pair-slug && pnpm verify-fact-checker` — full verifier suite green.
- Migration applied to remote D1 via operator action; `PRAGMA table_info(audio_audit_results)` shows 10 columns; `PRAGMA table_info(daily_piece_audio)` shows the new `file_size_bytes` column.
- End-to-end check: documented as a permanent post-cron verification step in RUNBOOK; first verification waits for the next cron run.

---

## Risk register

- **R1: ElevenLabs response is not actually 96 kbps for some payloads.** Mitigation: doc-comment on the `byteLength / 12000` site naming `AUDIO_OUTPUT_FORMAT` as the source-of-truth assumption with a "if you change one, change both" warning.
- **R2: Bind-count overflow on a hypothetical 50-beat piece.** Today's pieces are 4–8 beats; AUDIO_CHAR_CAP would block a 50-beat piece. Mitigation: code comment at batch site naming D1's per-batch awareness (parallel to Task 04's comment). Per-statement count stays ~9 binds, so even 100-statement batches are safe.
- **R3: Persistence catch swallows a real schema problem on first deploy.** If migration didn't apply remotely before agent code ships, every audit logs one `persistError`. Mitigation: ordering migration-apply between Commits 1 and 2. If it slips, `observer.logError` surfaces within hours; revert is `git revert` on Commit 2.
- **R4: Retry-append produces noisy histories on flaky pipelines.** Cleanup is Task 08's question (retention). Mitigation: Q12's `recent_audits` query filters to "latest summary per piece" via window function, hiding noise from default health view.
- **R5: `actual_size_bytes` populated only on size-related issues.** Reader querying "show me sizes for all flagged beats" gets NULL on `text_too_short`. Intentional (don't fabricate a value the issue type didn't depend on). Mitigation: SCHEMA doc-row calls out "NULL when issue_type doesn't depend on size".
- **R6: The `unknown` enum value masks future drift.** New issue path added without a corresponding `AudioIssueType` extension would persist as `unknown`. Mitigation: review discipline + the issue-type breakdown query (Q12) surfaces non-zero `unknown` counts. Acceptable for v1.

---

## What is NOT in scope

- Surfacing `audio_audit_results` on any reader-facing or admin UI surface (deferred per Q7).
- Backfilling the `made.ts` envelope's `totalSizeBytes: null` to `SUM(file_size_bytes)` (deferred per Q7).
- Changing what the Audio Auditor *checks*. We are persisting what it already produces.
- Retroactively populating `audio_audit_results` for historical pieces (forward-only).
- Retroactively populating `file_size_bytes` / `duration_seconds` on historical `daily_piece_audio` rows (forward-only).
- Deleting `observer_events.context` data for old `logAudioFailure` events (kept for backup; eventual cleanup via Task 08 retention).
- Adding STT round-trip to the auditor (out of scope per existing AGENTS.md note).
- Extracting an audio-audit-thresholds shared cluster (the auditor's `EXPECTED_BYTES_PER_CHAR`, `MIN_SIZE_RATIO`, `MAX_SIZE_RATIO`, very-short-text < 50 are deliberately co-located in the auditor per AGENTS.md line 141).
