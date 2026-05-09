-- 0043_engagement_widget_counters — adds three counter columns to
-- `engagement` for in-beat widget interaction signals.
--
-- PR #3 (2026-05-09). The three widgets <lesson-reveal> /
-- <lesson-compare> / <lesson-callout> each fire a one-shot CustomEvent
-- on first interaction or first viewport entry; <lesson-shell>
-- forwards them to /api/engagement/track with event_type
-- 'widget_reveal_opened' | 'widget_compare_viewed' | 'widget_callout_seen'.
-- This migration adds the counter columns the endpoint UPSERTs into.
--
-- Same per-piece-per-day shape as the existing views / completions /
-- audio_plays counters (added migrations 0006, 0017): one row per piece
-- per day, counter incremented per event. Per-listener granularity
-- lives in the existing audio_dwell_events log (migration 0035)
-- pattern — but for widget events Phase 1 (this PR) only needs the
-- counter density signal, not per-listener events. Phase 2 (FOLLOWUPS
-- [deferred] 2026-05-09 "Widget engagement signals to Learner") may
-- promote to a per-event log if the read-side needs it.
--
-- Forward-only, additive. NULL-defaulting to 0 via DEFAULT clause so
-- pre-deploy rows behave as "no widget interactions yet."
ALTER TABLE engagement ADD COLUMN widget_reveal_opens INTEGER DEFAULT 0;
ALTER TABLE engagement ADD COLUMN widget_compare_views INTEGER DEFAULT 0;
ALTER TABLE engagement ADD COLUMN widget_callouts_seen INTEGER DEFAULT 0;
