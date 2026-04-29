import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import {
  CATEGORISER_PROMPT,
  CATEGORISER_MAX_ASSIGNMENTS,
  CATEGORISER_REUSE_CONFIDENCE_STRETCH,
  CATEGORISER_FALLBACK_SLUG,
  CATEGORISER_RETRY_MESSAGE,
  buildCategoriserPrompt,
  type CategoryContextRow,
  type PieceContext,
} from './categoriser-prompt';

/** Cap the MDX body excerpt fed to Claude. Big enough to signal the
 *  piece's shape (hook + first teaching beat or two); small enough
 *  that 3 years of backfill runs stay cheap. */
const BODY_EXCERPT_MAX_CHARS = 2000;

/** Clamp the LLM's confidence number into the [0, 100] range before
 *  writing. A misbehaving response can't poison the row. */
function clampConfidence(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/** Normalise a slug to kebab-case and strip anything outside the safe
 *  set. Used when Claude proposes a new category and its slug needs
 *  to survive as a URL segment. */
function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Strip YAML frontmatter + MDX component tags from an excerpt so the
 *  LLM sees prose, not markup. Keeps the prompt focused on the
 *  piece's teaching, not its wiring. */
function stripForExcerpt(mdx: string): string {
  // Drop the leading ---...--- frontmatter block (single pass).
  let body = mdx.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Strip <lesson-shell>, <lesson-beat>, <audio-player>, etc.
  body = body.replace(/<[^>]+>/g, '');
  // Collapse runs of blank lines.
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body.slice(0, BODY_EXCERPT_MAX_CHARS);
}

/** What Claude returns, raw. Validated at runtime before we write. */
interface RawAssignment {
  categoryId?: string;
  newCategory?: {
    name?: string;
    slug?: string;
    description?: string;
  };
  confidence?: number;
  reasoning?: string;
}

/** One resolved assignment ready to write. Either points at an
 *  existing category (existingId) OR carries a freshly-created one's
 *  id (after INSERT). By the time we hit the writer, there is always
 *  exactly one concrete categoryId. */
interface ResolvedAssignment {
  categoryId: string;
  confidence: number;
  isNovel: boolean;
  novelName?: string;
}

/** One row of the piece's pre-existing assignments — surfaced on the
 *  idempotency-guard path so the observer feed shows what's actually
 *  attached to the piece, not just "skipped". Added 2026-04-25 after
 *  a deploy-during-pipeline race left a piece with rows but a
 *  misleading "Categorisation skipped" log and no "Categorised:"
 *  success log. See DECISIONS 2026-04-25 "Categoriser skipped log
 *  surfaces existing assignments". */
export interface ExistingAssignmentSummary {
  name: string;
  slug: string;
  confidence: number;
}

/** Result surfaced back to Director so it can log success / novel /
 *  overflow events distinctly in the admin feed. */
export interface CategoriserResult {
  pieceId: string;
  date: string;
  skipped: boolean;           // true when piece already has piece_categories rows
  assignmentsWritten: number;
  novelCategoriesCreated: number;
  novelCategoryNames: string[]; // for the observer body
  considered: number;         // total raw assignments across both attempts (pre-cap)
  tokensIn: number;           // total across both attempts
  tokensOut: number;          // total across both attempts
  durationMs: number;
  /** Populated only on the skipped path. Empty on the success path
   *  (the success log already names the just-written assignments via
   *  novelCategoryNames). */
  existingAssignments: ExistingAssignmentSummary[];
  /** True iff Claude was called twice — the first attempt returned
   *  empty (or all-sub-floor) and we re-prompted with the retry
   *  message. Director uses this to fire logCategoriserRetried. */
  retried: boolean;
  /** Why the retry fired. Undefined when retried=false. */
  retryReason?: 'empty' | 'all-sub-floor';
  /** Token + considered counts from JUST the first attempt — surfaced
   *  for the retry-info observer event. */
  consideredFirst: number;
  tokensInFirst: number;
  tokensOutFirst: number;
  /** True iff both attempts returned empty/all-sub-floor and the
   *  piece was written to the reserved fallback category. Director
   *  uses this to fire logCategoriserFallback (warn) instead of the
   *  regular metered log. */
  fallbackFired: boolean;
}

interface CategoriserState {
  piecesCategorised: number;
  novelCategoriesCreated: number;
}

/**
 * CategoriserAgent — 14th agent.
 *
 * Assigns 1–3 categories to a just-published daily piece. Strongly
 * biased toward reusing an existing category; creates a new one only
 * when the existing taxonomy genuinely doesn't cover the piece.
 *
 * Does NOT touch published content. Does NOT change frontmatter.
 * Does NOT orchestrate — Director schedules it via alarm after
 * `publishing done`, same shape as Learner's analysePiecePostPublish
 * and Drafter.reflect (off-pipeline, non-blocking, non-retriable).
 *
 * Idempotent: if a piece already has `piece_categories` rows it
 * returns a `skipped: true` result without firing a Claude call. This
 * is belt-and-braces alongside the composite PK on piece_categories
 * — the PK would block duplicate rows anyway, but the pre-check
 * saves a Claude call on re-runs.
 *
 * Locked-category semantic: the `categories.locked` flag (set from
 * the admin UI in sub-task 2.5) means "Categoriser MUST NOT reassign
 * a piece AWAY from this category". For this agent that's a no-op —
 * we only INSERT, never DELETE or re-tag. The flag is relevant at
 * admin-time (merge/delete paths) and documented here for future
 * reference. See DECISIONS 2026-04-23 (late evening) sub-task 2.1.
 */
export class CategoriserAgent extends Agent<Env, CategoriserState> {
  initialState: CategoriserState = {
    piecesCategorised: 0,
    novelCategoriesCreated: 0,
  };

  /**
   * Categorise a just-published piece.
   *
   * @param pieceId  daily_pieces.id (UUID, pre-allocated by Director
   *                 at the top of triggerDailyPiece)
   * @param date     YYYY-MM-DD — for logging + result shape only;
   *                 all D1 filters use piece_id
   * @param mdx      final published MDX. Caller reads it from GitHub
   *                 rather than re-reading here so Categoriser stays
   *                 ignorant of file paths, same shape as Drafter.reflect.
   *
   * Throws on failure (Claude / JSON parse / DB). Director's alarm
   * handler catches and routes to observer_events.
   */
  async categorise(
    pieceId: string,
    date: string,
    mdx: string,
  ): Promise<CategoriserResult> {
    const started = Date.now();

    // ── 1. Idempotence guard ─────────────────────────────────────
    // Query the actual rows (not just COUNT) so the skipped log can
    // surface what's already attached to the piece. Cost: one extra
    // JOIN on a path that runs rarely (manual re-trigger, deploy race,
    // alarm at-least-once retry). Without this surfacing, an admin
    // looking at "Categorisation skipped" had no way to tell whether
    // the rows were correct or whether a buggy prior run had attached
    // the wrong category — they had to query D1 by hand.
    const existingRows = await this.env.DB
      .prepare(
        `SELECT c.name AS name, c.slug AS slug, pc.confidence AS confidence
         FROM piece_categories pc
         JOIN categories c ON c.id = pc.category_id
         WHERE pc.piece_id = ?
         ORDER BY pc.confidence DESC`,
      )
      .bind(pieceId)
      .all<{ name: string; slug: string; confidence: number }>();
    const existingAssignments: ExistingAssignmentSummary[] =
      (existingRows.results ?? []).map((r) => ({
        name: r.name,
        slug: r.slug,
        confidence: r.confidence,
      }));
    if (existingAssignments.length > 0) {
      return {
        pieceId,
        date,
        skipped: true,
        assignmentsWritten: 0,
        novelCategoriesCreated: 0,
        novelCategoryNames: [],
        considered: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
        existingAssignments,
        retried: false,
        consideredFirst: 0,
        tokensInFirst: 0,
        tokensOutFirst: 0,
        fallbackFired: false,
      };
    }

    // ── 2. Piece metadata + body excerpt ─────────────────────────
    const piece = await this.env.DB
      .prepare(
        `SELECT headline, underlying_subject
         FROM daily_pieces WHERE id = ? LIMIT 1`,
      )
      .bind(pieceId)
      .first<{ headline: string; underlying_subject: string | null }>();

    if (!piece) {
      throw new Error(`categorise: no daily_pieces row for id ${pieceId}`);
    }

    const pieceContext: PieceContext = {
      headline: piece.headline,
      underlyingSubject: piece.underlying_subject,
      bodyExcerpt: stripForExcerpt(mdx),
    };

    // ── 3. Existing categories (full list — prompt needs all for reuse-bias) ─
    // The reserved fallback category is filtered out before passing
    // to Claude — it must NEVER be visible as a "reuse target", or
    // Claude could pick it directly and defeat the retry layer's
    // purpose. The fallback row is only written to by the agent's
    // last-resort path.
    const catsRes = await this.env.DB
      .prepare(
        `SELECT id, name, slug, description, piece_count
         FROM categories
         ORDER BY piece_count DESC, name ASC`,
      )
      .all<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        piece_count: number;
      }>();

    const fallbackRow = catsRes.results.find(
      (r) => r.slug === CATEGORISER_FALLBACK_SLUG,
    );
    if (!fallbackRow) {
      throw new Error(
        `categorise: reserved fallback category "${CATEGORISER_FALLBACK_SLUG}" not found in categories table — migration 0024 must be applied`,
      );
    }

    const existing: CategoryContextRow[] = catsRes.results
      .filter((r) => r.slug !== CATEGORISER_FALLBACK_SLUG)
      .map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        pieceCount: r.piece_count,
      }));

    // ── 4. Ask Claude (with a single retry on empty/all-sub-floor) ─
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const userPrompt = buildCategoriserPrompt(pieceContext, existing);

    const existingById = new Map(existing.map((c) => [c.id, c] as const));
    const existingBySlug = new Map(existing.map((c) => [c.slug, c] as const));

    // First attempt
    const first = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: CATEGORISER_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const firstText = first.content[0].type === 'text' ? first.content[0].text : '{}';
    const firstRaw = parseRawAssignments(firstText);
    const firstResolveOutcome = await this.resolveAssignments(
      firstRaw,
      existingById,
      existingBySlug,
    );

    let resolved: ResolvedAssignment[] = firstResolveOutcome.resolved;
    let considered = firstRaw.length;
    let tokensIn = first.usage?.input_tokens ?? 0;
    let tokensOut = first.usage?.output_tokens ?? 0;

    const consideredFirst = firstRaw.length;
    const tokensInFirst = tokensIn;
    const tokensOutFirst = tokensOut;

    let retried = false;
    let retryReason: 'empty' | 'all-sub-floor' | undefined;

    if (resolved.length === 0) {
      retried = true;
      retryReason =
        firstRaw.length === 0 ? 'empty' : 'all-sub-floor';

      const second = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1500,
        system: CATEGORISER_PROMPT,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: firstText },
          { role: 'user', content: CATEGORISER_RETRY_MESSAGE },
        ],
      });
      const secondText = second.content[0].type === 'text' ? second.content[0].text : '{}';
      const secondRaw = parseRawAssignments(secondText);
      const secondResolveOutcome = await this.resolveAssignments(
        secondRaw,
        existingById,
        existingBySlug,
      );

      if (secondResolveOutcome.resolved.length > 0) {
        resolved = secondResolveOutcome.resolved;
      }
      considered += secondRaw.length;
      tokensIn += second.usage?.input_tokens ?? 0;
      tokensOut += second.usage?.output_tokens ?? 0;
    }

    // ── 5. Last-resort fallback ──────────────────────────────────
    // If both attempts produced nothing usable, the piece lands in
    // the reserved "Patterns Yet to Cluster" category so the user-
    // stated rule "every piece must have a category" holds. Operator
    // gets a warn observer event from Director.
    let fallbackFired = false;
    if (resolved.length === 0) {
      fallbackFired = true;
      resolved = [
        {
          categoryId: fallbackRow.id,
          confidence: 0,
          isNovel: false,
        },
      ];
    }

    // ── 6. Write assignments + bump piece_count counters ─────────
    // piece_count is denormalised (per the sub-task 2.1 design); we
    // bump it here on insert so the library chip-sort read path gets
    // a fresh counter without needing a correlated COUNT on every
    // render. Composite PK on piece_categories gives us idempotency
    // under concurrent runs — INSERT OR IGNORE would also be safe
    // here, but at this point the upstream guard has already checked
    // the piece has zero assignments, so the plain INSERT is fine.
    let assignmentsWritten = 0;
    const now = Date.now();
    for (const r of resolved) {
      try {
        await this.env.DB
          .prepare(
            `INSERT INTO piece_categories (piece_id, category_id, confidence, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(pieceId, r.categoryId, r.confidence, now)
          .run();
        await this.env.DB
          .prepare(
            `UPDATE categories SET piece_count = piece_count + 1, updated_at = ? WHERE id = ?`,
          )
          .bind(now, r.categoryId)
          .run();
        assignmentsWritten += 1;
      } catch {
        // per-row failure isn't fatal — others still land
      }
    }

    const novelNames = resolved
      .filter((r) => r.isNovel)
      .map((r) => r.novelName!)
      .filter(Boolean);

    this.setState({
      piecesCategorised: this.state.piecesCategorised + (assignmentsWritten > 0 ? 1 : 0),
      novelCategoriesCreated: this.state.novelCategoriesCreated + novelNames.length,
    });

    return {
      pieceId,
      date,
      skipped: false,
      assignmentsWritten,
      novelCategoriesCreated: novelNames.length,
      novelCategoryNames: novelNames,
      considered,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - started,
      existingAssignments: [],
      retried,
      retryReason,
      consideredFirst,
      tokensInFirst,
      tokensOutFirst,
      fallbackFired,
    };
  }

  /**
   * Resolve raw Claude output into write-ready assignments.
   *
   * Three jobs:
   * 1. Cap to MAX so a misbehaving response can't over-tag.
   * 2. **Filter sub-floor existing-cat assignments** — anything below
   *    {@link CATEGORISER_REUSE_CONFIDENCE_STRETCH} (60) is treated as
   *    Claude violating the prompt's tiered reuse rule. Caller can
   *    detect "all sub-floor" via `resolved.length === 0` while
   *    `rawArr.length > 0`. Catches the 2026-04-25 Cartels @ 50
   *    bug class.
   * 3. Create novel categories on the spot, dedup against existing
   *    by slug, race-safe via try/catch + re-read.
   *
   * Mutates `existingById` + `existingBySlug` so a subsequent call
   * (e.g. the retry path) sees this call's just-created novel
   * categories as reuse targets.
   */
  private async resolveAssignments(
    rawArr: RawAssignment[],
    existingById: Map<string, CategoryContextRow>,
    existingBySlug: Map<string, CategoryContextRow>,
  ): Promise<{ resolved: ResolvedAssignment[] }> {
    const resolved: ResolvedAssignment[] = [];

    for (const a of rawArr.slice(0, CATEGORISER_MAX_ASSIGNMENTS)) {
      const confidence = clampConfidence(a.confidence);

      // Existing category path
      if (typeof a.categoryId === 'string' && existingById.has(a.categoryId)) {
        if (confidence < CATEGORISER_REUSE_CONFIDENCE_STRETCH) {
          continue; // sub-floor — drop
        }
        if (resolved.some((r) => r.categoryId === a.categoryId)) continue; // dedup
        resolved.push({ categoryId: a.categoryId, confidence, isNovel: false });
        continue;
      }

      // newCategory path
      const nc = a.newCategory;
      if (!nc || typeof nc.name !== 'string' || nc.name.trim().length === 0) {
        continue;
      }
      const proposedSlug = typeof nc.slug === 'string' && nc.slug.length > 0
        ? normaliseSlug(nc.slug)
        : normaliseSlug(nc.name);
      if (proposedSlug.length === 0) continue;

      // Slug collision against existing → reuse instead of duplicate.
      const slugCollision = existingBySlug.get(proposedSlug);
      if (slugCollision) {
        if (resolved.some((r) => r.categoryId === slugCollision.id)) continue;
        resolved.push({ categoryId: slugCollision.id, confidence, isNovel: false });
        continue;
      }

      // Genuine novel category — create now.
      const newId = crypto.randomUUID();
      const now = Date.now();
      const name = nc.name.trim().slice(0, 100);
      const description = typeof nc.description === 'string'
        ? nc.description.trim().slice(0, 500)
        : null;
      try {
        await this.env.DB
          .prepare(
            `INSERT INTO categories (id, slug, name, description, locked, piece_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
          )
          .bind(newId, proposedSlug, name, description, now, now)
          .run();
      } catch {
        // Race — another run created the same slug. Re-read and reuse.
        const collision = await this.env.DB
          .prepare('SELECT id FROM categories WHERE slug = ? LIMIT 1')
          .bind(proposedSlug)
          .first<{ id: string }>();
        if (!collision) continue;
        if (resolved.some((r) => r.categoryId === collision.id)) continue;
        resolved.push({ categoryId: collision.id, confidence, isNovel: false });
        continue;
      }
      existingById.set(newId, {
        id: newId, name, slug: proposedSlug, description, pieceCount: 0,
      });
      existingBySlug.set(proposedSlug, {
        id: newId, name, slug: proposedSlug, description, pieceCount: 0,
      });
      resolved.push({
        categoryId: newId,
        confidence,
        isNovel: true,
        novelName: name,
      });
    }

    return { resolved };
  }
}

/** Parse Claude's text output into a raw assignments array. Returns
 *  an empty array on any parse failure rather than throwing — the
 *  caller treats empty as a retry trigger, not an error. */
function parseRawAssignments(text: string): RawAssignment[] {
  let parsed: { assignments?: RawAssignment[] };
  try {
    parsed = extractJson<typeof parsed>(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed.assignments) ? parsed.assignments : [];
}
