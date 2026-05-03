/**
 * Categoriser thresholds — site-worker mirror of
 * `agents/src/shared/categoriser-thresholds.ts`.
 *
 * Canonical rule body in `content/categoriser-contract.md`; canonical
 * TypeScript constants in the agents-side file named above. The
 * site worker and agents worker are separate packages with no
 * shared imports, so both sides carry their own copy. Same pattern
 * as `src/lib/fact-check-thresholds.ts` ↔
 * `agents/src/shared/fact-check-thresholds.ts`. If the slug changes
 * here, the agents-side file (and migration 0027's seed row) must
 * change in the same commit.
 *
 * Asymmetric mirror — only the fallback slug crosses to the site
 * side. The 1–3 assignment cap and the 60 / 75 confidence floors are
 * agents-only rules (writer-side, enforced before the row hits
 * `piece_categories`); the site does not re-enforce them at render
 * time. Three site-side use-sites all import this constant: the
 * library chip bar (`src/lib/categories.ts` → excludes the fallback
 * category from `getCategories()` and 404s `getCategoryBySlug` for
 * the fallback slug); the made-drawer "Filed under" section
 * (`src/pages/api/daily/[date]/made.ts` → excludes the fallback so a
 * piece parked there reads as no-category-yet to readers); the
 * account subjects observation (`src/pages/account.astro` →
 * excludes the fallback from a reader's recently-read taxonomy).
 * `src/lib/categories.ts` re-exports `FALLBACK_SLUG` for back-compat
 * with existing call-sites.
 */

/** Reserved Categoriser fallback category slug (seeded by migration
 *  0027). Hidden from every reader-facing surface. A piece landing
 *  here is an operator review signal, not a reader-browseable
 *  category. */
export const FALLBACK_SLUG = 'patterns-yet-to-cluster';
