-- Migration 0040: Clean up zombie pipeline_log orphan piece_categories rows.
--
-- Follow-up to migration 0039 (categoriser taxonomy cleanup). 0039 left
-- two old categories alive (resource-constraints-tradeoffs, systems-
-- under-stress) because they each had a piece_categories row pointing
-- at piece_id afdfb4e4-aa19-4cbc-9192-7ac66bc94d78 — a zombie pipeline
-- run from 2026-05-01 02:03 UTC that wedged at audio-publishing without
-- ever creating a daily_pieces row. The piece_categories rows are
-- definitionally orphan (no daily_pieces parent), and 0039's deletion
-- guard (id NOT IN (SELECT DISTINCT category_id FROM piece_categories))
-- spared the categories because of those orphans.
--
-- This migration:
--   1. Deletes ALL orphan piece_categories rows (any piece_id not in
--      daily_pieces). Sweeps not just the afdfb4e4 zombie but any other
--      from the open FOLLOWUPS "[open] 2026-05-07: Six zombie pipeline
--      runs..." entry.
--   2. Re-runs 0039's old-category deletion now that the orphans are
--      cleared. The two surviving slugs should drain.
--   3. Recomputes piece_count one more time as the drift-recovery hatch.
--
-- Forward-only. Non-destructive against any published piece — orphan
-- rows are deleted only when their piece_id has no daily_pieces parent.

-- 1. Delete orphan piece_categories rows.
DELETE FROM piece_categories
WHERE piece_id NOT IN (SELECT id FROM daily_pieces);

-- 2. Retry the old-category deletion now that orphans are cleared.
DELETE FROM categories
WHERE slug IN (
  'resource-constraints-tradeoffs',
  'systems-under-stress'
) AND id NOT IN (SELECT DISTINCT category_id FROM piece_categories);

-- 3. Recompute piece_count.
UPDATE categories SET
  piece_count = (SELECT COUNT(*) FROM piece_categories WHERE category_id = categories.id),
  updated_at = strftime('%s', 'now') * 1000;
