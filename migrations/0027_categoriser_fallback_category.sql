-- 0027 — seed reserved Categoriser fallback category.
--
-- Used ONLY by CategoriserAgent's last-resort path: when both Claude
-- attempts (initial + retry) return empty / all-sub-floor assignment
-- arrays, the agent writes a piece_categories row pointing at this
-- category so the user-stated rule "every piece must have a category"
-- holds.
--
-- The row is:
-- - Locked (`locked=1`) so admin merge/delete UI never touches it.
-- - Filtered out of the Categoriser context list at agent-side
--   (Claude must never see it as a "reuse target").
-- - Filtered out of the public library chip bar at site-side
--   (`src/lib/categories.ts` `getCategories()`).
--
-- A piece landing here is an operator review signal — observer event
-- `logCategoriserFallback` fires at warn severity. If it ever gets
-- piece_count > ~1 in normal operation, the prompt or taxonomy needs
-- tuning.
--
-- Idempotent — safe to re-apply (INSERT OR IGNORE on the slug).
-- Migration is additive; rollback is a single DELETE on the slug
-- after rewiring the agent to its pre-fix shape.

INSERT OR IGNORE INTO categories (
  id,
  slug,
  name,
  description,
  locked,
  piece_count,
  created_at,
  updated_at
) VALUES (
  'fallback-patterns-yet-to-cluster',
  'patterns-yet-to-cluster',
  'Patterns Yet to Cluster',
  'Pieces awaiting taxonomy convergence — the system couldn''t confidently place them in an existing category and didn''t propose a durable new one. Operator review queue.',
  1,
  0,
  1714339200000,
  1714339200000
);
