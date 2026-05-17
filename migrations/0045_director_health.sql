-- 2026-05-17 — Cap-incident prevention. See docs/CAP-INCIDENT-2026-05-17.md.
--
-- Three additive structures that let us (a) emergency-stop the Director
-- DO via a D1 flag flip, (b) configure the runaway-detection threshold
-- from admin, (c) detect cross-DO-restart runaway operations (today's
-- incident: 8-hour silent plateau that no in-memory watchdog could have
-- caught because the DO was reset twice during pipeline runs).
--
-- Forward-only, non-destructive. Existing rows unaffected.

-- 1. Kill switch — flag read on every Director alarm + public method.
--    Operator flips via the admin dashboard or directly via:
--      wrangler d1 execute zeemish --remote --command \
--        "UPDATE admin_settings SET value='1' WHERE key='director_disabled';"
--    Resume by setting value='0'. Works during cap-blocked state because
--    D1 writes don't go through DO duration.
INSERT OR IGNORE INTO admin_settings(key, value, updated_at)
VALUES ('director_disabled', '0', strftime('%s','now')*1000);

-- 2. Max-operation-minutes threshold — used by the watchdog cron at
--    HH:30 to decide what counts as a stale operation. Default 15 min
--    (longest legitimate Director operation is the audio pipeline at
--    full retry budget, ~10-15 min). Operator can adjust via admin.
INSERT OR IGNORE INTO admin_settings(key, value, updated_at)
VALUES ('director_max_operation_minutes', '15', strftime('%s','now')*1000);

-- 3. Operation-health table — tracks active long-running operations
--    (triggerDailyPiece, runAudioPipeline, etc.) across DO restarts.
--    Director writes a row at every keepAlive() acquire, updates
--    last_heartbeat_at at 30s heartbeats (optional — best-effort),
--    marks completed=1 at dispose. Separate watchdog cron reads stale
--    'running' rows and auto-trips the kill switch if any operation
--    started > threshold-minutes ago without completion.
--
--    operation_id    — UUID minted at keepAlive() acquire
--    operation_type  — 'triggerDailyPiece' | 'runAudioPipeline' | 'retryAudio' | 'retryAudioBeat'
--    piece_id        — UUID if operation is piece-scoped, else null
--    started_at      — ms epoch at keepAlive acquire
--    last_heartbeat_at — ms epoch updated on each heartbeat alarm (optional)
--    completed_at    — ms epoch at dispose, null while running
--    status          — 'running' | 'completed' | 'aborted' | 'orphaned'
CREATE TABLE IF NOT EXISTS director_health (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  piece_id TEXT,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_director_health_status
  ON director_health(status, started_at);

CREATE INDEX IF NOT EXISTS idx_director_health_heartbeat
  ON director_health(last_heartbeat_at)
  WHERE status = 'running';
