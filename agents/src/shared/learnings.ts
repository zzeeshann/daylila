import type { Env } from '../types';

/**
 * Where a learning came from. Loose at the DB level (TEXT, nullable)
 * so a future fifth origin can be added at the write site without a
 * schema change — but typed narrowly here so callers get compile-time
 * help for the four we currently know how to generate.
 */
export type LearningSource =
  | 'reader'          // reader-behaviour signal (engagement, drop-off)
  | 'producer'        // pipeline quality signal (auditors, curator, etc.)
  | 'self-reflection' // Drafter's own post-draft review
  | 'zita';           // patterns in Zita questions

export interface Learning {
  id: string;
  category: string;
  observation: string;
  evidence: string;
  confidence: number;
  /** JSON array of `daily_pieces.id` strings — the pieces this
   *  learning was loaded into AND that subsequently published.
   *  Repurposed from the prior INTEGER `0`/`1` shape in migration
   *  0032 (Foundation Fix Task 04). Pre-Task-04 rows still hold the
   *  literal numeric `0` or `1`; readers MUST treat any value not
   *  starting with `[` as null and writers use `LIKE '[%'` guards
   *  before json_insert so the first JSON write resets a legacy 0/1.
   *  The DB column is still declared INTEGER but SQLite's loose
   *  column affinity tolerates the TEXT shape with no ALTER. */
  applied_to_prompts: string | null;
  created_at: number;
  source: LearningSource | null;
  /** Most recent load timestamp (epoch ms), set by getRecentLearnings
   *  as a deliberate side-effect. Overwritten on each subsequent
   *  load. NULL = never loaded. Added migration 0032. */
  loaded_at: number | null;
  /** Monotonic count of loads via getRecentLearnings. Durable across
   *  loaded_at overwrites. DEFAULT 0 in DB so legacy rows query as
   *  "never loaded" alongside their NULL loaded_at. Added migration
   *  0032. */
  load_count: number;
  /** Set only when the loaded learning's piece passed the
   *  Polished-strict bar (voiceScore ≥ LEARNER_VALIDATION_VOICE_FLOOR
   *  AND revision rounds ≤ LEARNER_VALIDATION_MAX_ROUNDS). Director
   *  writes after `publishing done`. NULL on every pre-Task-04 row
   *  (forward-only). */
  last_validated_at: number | null;
}

/**
 * Write a learning to the D1 learnings table.
 * Called by agents when they notice recurring patterns.
 *
 * `source` describes the *origin* of the signal (reader / producer /
 * self-reflection / zita) and is orthogonal to `category` (voice /
 * structure / fact / engagement — *what* kind of learning it is).
 * Both matter: source tells you whether the system learned this from
 * itself or from readers; category tells you which prompt the learning
 * should inform.
 *
 * `pieceDate` pins the row to a specific daily_piece (YYYY-MM-DD).
 * Required going forward so the per-piece drawer can query
 * `WHERE piece_date = ?`. Column is nullable in the DB to preserve
 * pre-migration rows (backfilled via migration 0012's manual UPDATE);
 * the application layer enforces non-null here.
 *
 * Defensive: rejects null/empty/non-string `source` OR `pieceDate` at
 * runtime. TS strict catches these at compile time in current callers,
 * but a future regression (new caller forgetting an arg, a refactor
 * that widens types) could let a null leak in. Rather than silently
 * writing a broken row, log a warn to observer_events and skip.
 * Loud schema regression is easier to notice than a quiet null row
 * polluting the feed.
 */
export async function writeLearning(
  db: D1Database,
  category: 'voice' | 'structure' | 'engagement' | 'fact',
  observation: string,
  evidence: Record<string, unknown>,
  confidence: number,
  source: LearningSource,
  pieceDate: string,
  pieceId: string,
): Promise<void> {
  if (typeof source !== 'string' || source.length === 0) {
    await logMissingField(db, { field: 'source', category, observation, receivedType: source === null ? 'null' : typeof source }).catch(() => {
      /* if observer write fails, there's no layer below to fall through to — caller already got a silent skip, which is the best we can do */
    });
    return;
  }
  if (typeof pieceDate !== 'string' || pieceDate.length === 0) {
    await logMissingField(db, { field: 'piece_date', category, observation, receivedType: pieceDate === null ? 'null' : typeof pieceDate }).catch(() => {
      /* same rationale as above */
    });
    return;
  }
  if (typeof pieceId !== 'string' || pieceId.length === 0) {
    await logMissingField(db, { field: 'piece_id', category, observation, receivedType: pieceId === null ? 'null' : typeof pieceId }).catch(() => {
      /* same rationale as above */
    });
    return;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO learnings (id, category, observation, evidence, confidence, source, piece_date, piece_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, category, observation, JSON.stringify(evidence), confidence, source, pieceDate, pieceId, Date.now())
    .run();
}

/**
 * Write directly to observer_events — mirrors ObserverAgent.writeEvent's
 * INSERT so this module stays dependency-free (no sub-agent hop,
 * which would be a circular pull back through Env typings). Only fires
 * when writeLearning's defensive check trips on `source` or
 * `piece_date`. Severity is `warn`, not `escalation` — the pipeline is
 * still running, we just lost one row.
 */
async function logMissingField(
  db: D1Database,
  ctx: { field: 'source' | 'piece_date' | 'piece_id'; category: string; observation: string; receivedType: string },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO observer_events (id, severity, title, body, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      'warn',
      `learnings.${ctx.field} missing at write time`,
      `writeLearning refused a row because ${ctx.field} was ${ctx.receivedType}. Row skipped to avoid null-${ctx.field} regression. Category: ${ctx.category}. Observation (truncated): ${ctx.observation.slice(0, 200)}`,
      JSON.stringify(ctx),
      Date.now(),
    )
    .run();
}

/**
 * Read recent learnings across all categories.
 *
 * Drafter calls this at runtime to include recent learnings in its
 * prompt — closing the loop that was previously write-only. No
 * category filter: producer-side, self-reflection, reader-behaviour,
 * and Zita learnings all compound into the same feed the Drafter sees.
 *
 * Recency-only for v1 — relevance scoring, tag-matching, and
 * category-specific queries are intentionally deferred. If a caller
 * ever needs to slice by category again, add a separate function
 * rather than re-introducing the optional-param overload.
 *
 * **Side-effect (intentional, Foundation Fix Task 04):** every
 * successful read also writes a load event back to the same rows —
 * `loaded_at = Date.now()` (overwrites) and `load_count =
 * COALESCE(load_count, 0) + 1` (monotonic). This closes the load
 * side of the L15 feedback loop. The function name is kept (one
 * caller, Drafter) rather than renamed to `loadRecentLearnings…`
 * to avoid rippling through DECISIONS / AGENTS / RUNBOOK / etc.
 *
 * The load event lands BEFORE the draft is written. If the draft
 * later throws, the load is still recorded — which is correct: the
 * load did happen. Director's success-path UPDATE
 * (`applied_to_prompts` JSON-append + optional `last_validated_at`)
 * fires only when the piece publishes, so a draft-throw cleanly
 * leaves loaded-but-not-applied rows that surface in the
 * `noise` query of `scripts/learner-health.sql`.
 *
 * Fail-open on the load UPDATE: if it throws, the read result is
 * returned anyway. Blocking the draft on a feedback-write hiccup
 * would invert priorities — the loaded learnings still reach the
 * Drafter prompt; only the load-event accounting is missed.
 */
export async function getRecentLearnings(
  db: D1Database,
  limit = 10,
): Promise<Learning[]> {
  const result = await db
    .prepare('SELECT * FROM learnings ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<Learning>();

  if (result.results.length > 0) {
    const ids = result.results.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(', ');
    try {
      await db
        .prepare(
          `UPDATE learnings
              SET loaded_at = ?,
                  load_count = COALESCE(load_count, 0) + 1
            WHERE id IN (${placeholders})`,
        )
        .bind(Date.now(), ...ids)
        .run();
    } catch {
      // Fail-open: the draft must not block on a feedback-write
      // hiccup. The rows are still returned and reach the Drafter
      // prompt; only the load-event accounting is missed.
    }
  }

  return result.results;
}
