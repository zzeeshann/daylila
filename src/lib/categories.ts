/**
 * Category helpers for the library filter surface (Area 2 sub-task 2.4).
 *
 * Reads from two tables Sub-task 2.1 shipped: `categories` (taxonomy)
 * and `piece_categories` (piece → category join with confidence).
 * Writes are owned by Categoriser (agents worker) and the admin UI
 * (sub-task 2.5) — this module is read-only.
 *
 * Mirrors the shape of src/lib/learnings.ts.
 */

import { FALLBACK_SLUG } from './categoriser-thresholds';

/** Reserved Categoriser fallback category slug (seeded by migration
 *  0027). Hidden from every reader-facing surface — the chip bar, the
 *  filtered library route, the per-piece "Filed under" drawer
 *  section. A piece landing here is an operator review signal, not
 *  a reader-browseable category. Canonical at
 *  `src/lib/categoriser-thresholds.ts`; agents-side mirror at
 *  `agents/src/shared/categoriser-thresholds.ts`. Re-exported here
 *  for back-compat with existing call-sites (e.g.
 *  `src/pages/account.astro`). */
export { FALLBACK_SLUG } from './categoriser-thresholds';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pieceCount: number;
}

/**
 * Every category that has at least one piece assigned, sorted by
 * piece_count DESC then name ASC. Rendered as the chip bar on
 * /library/. Empty categories are filtered out — they can exist
 * transiently after a sub-task 2.5 merge (source category just went
 * to piece_count=0 and is about to be deleted), or before the admin
 * sweeps them. Either way they shouldn't appear in the reader-facing
 * chip bar because clicking one would show an empty list.
 */
export async function getCategories(db: D1Database): Promise<Category[]> {
  try {
    const res = await db
      .prepare(
        `SELECT id, slug, name, description, piece_count
         FROM categories
         WHERE piece_count > 0 AND slug != ?
         ORDER BY piece_count DESC, name ASC`,
      )
      .bind(FALLBACK_SLUG)
      .all<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
        piece_count: number;
      }>();
    return res.results.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      pieceCount: r.piece_count,
    }));
  } catch {
    return [];
  }
}

/**
 * Look up a single category by slug. Returns null on 404. Used by
 * the filtered library route to (a) render the category header,
 * (b) decide between "show empty state" and "404". An existing
 * category with piece_count=0 still resolves here (same-session
 * admin merge artefact — the caller chooses what to do).
 */
export async function getCategoryBySlug(
  db: D1Database,
  slug: string,
): Promise<Category | null> {
  // Reserved fallback slug is never reader-facing — 404 instead.
  if (slug === FALLBACK_SLUG) return null;
  try {
    const row = await db
      .prepare(
        `SELECT id, slug, name, description, piece_count
         FROM categories WHERE slug = ? LIMIT 1`,
      )
      .bind(slug)
      .first<{
        id: string;
        slug: string;
        name: string;
        description: string | null;
        piece_count: number;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      pieceCount: row.piece_count,
    };
  } catch {
    return null;
  }
}

/**
 * Every piece_id in a given category's slug. The filtered library
 * page joins this against the content collection (via MDX
 * frontmatter `pieceId`) to show only the matching pieces.
 * Returns an empty array on DB error or missing category — callers
 * render an empty state rather than a 500.
 */
export async function getPieceIdsInCategory(
  db: D1Database,
  slug: string,
): Promise<Set<string>> {
  try {
    const res = await db
      .prepare(
        `SELECT pc.piece_id
         FROM piece_categories pc
         JOIN categories c ON c.id = pc.category_id
         WHERE c.slug = ?`,
      )
      .bind(slug)
      .all<{ piece_id: string }>();
    return new Set(res.results.map((r) => r.piece_id));
  } catch {
    return new Set();
  }
}
