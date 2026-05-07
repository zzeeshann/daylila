#!/usr/bin/env bash
#
# reset-today.sh — wipe today's daily piece(s) and optionally trigger a fresh pipeline run.
#
# Modes:
#   (no args)             → Full-day reset. Wipes every piece with today's
#                           date, clears 5 day-scoped D1 tables, and triggers
#                           a fresh pipeline run.
#   --piece-id <uuid>     → Single-piece reset. Wipes just the named piece:
#                           git rm the matching MDX, DELETE by piece_id from
#                           every piece-id-capable table, time-window scope
#                           for pipeline_log + observer_events. Does NOT
#                           trigger a new run unless --retrigger is also
#                           passed (single-piece re-run has no natural
#                           cron slot at multi-per-day cadence).
#   --retrigger           → (with --piece-id) fire /daily-trigger after the
#                           wipe. Same behavior as default mode's trigger.
#   --help                → Print this usage and exit.
#
# Tables touched (in piece-id mode):
#   daily_pieces          WHERE id = ?
#   daily_candidates      WHERE piece_id = ?   (0014)
#   audit_results         WHERE piece_id = ?   (0014)
#   daily_piece_audio     WHERE piece_id = ?   (0015 — PK rebuild)
#   zita_messages         WHERE piece_id = ?   (0014)
#   learnings             WHERE piece_id = ?   (0014 + 2026-04-22 writer)
#   engagement            WHERE piece_id = ?   (0017)
#   pipeline_log          run_date=<date> AND created_at BETWEEN <window>
#                         (run_date renamed from run_id in migration 0037,
#                          2026-05-07 — date-shape semantics intact;
#                          window = published_at ±20min)
#   observer_events       created_at BETWEEN <window>
#                         (no piece_id column; same window as pipeline_log)
#
# Requires:
#   - git checkout of zeemish-v2 at the repo root (script figures out its path)
#   - wrangler authenticated for the 'zeemish' D1 database
#   - ADMIN_SECRET env var (only needed when a trigger fires)
#
# Usage:
#   ADMIN_SECRET=sk_... ./scripts/reset-today.sh
#   ADMIN_SECRET=sk_... ./scripts/reset-today.sh --piece-id ab95f0f8-b419-4e2e-95a8-46ca0290957a
#   ADMIN_SECRET=sk_... ./scripts/reset-today.sh --piece-id <uuid> --retrigger

set -euo pipefail

# ── arg parsing ──────────────────────────────────────────────────────
PIECE_ID=""
RETRIGGER=0

usage() {
  sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --piece-id)
      if [[ $# -lt 2 ]]; then
        echo "✗ --piece-id requires a UUID argument" >&2
        exit 1
      fi
      PIECE_ID="$2"
      shift 2
      ;;
    --retrigger)
      RETRIGGER=1
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo "✗ Unknown arg: $1" >&2
      echo "  Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ── config ───────────────────────────────────────────────────────────
AGENTS_URL="${AGENTS_URL:-https://zeemish-agents.zzeeshann.workers.dev}"
DATE="$(date -u +%Y-%m-%d)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Trigger-needed secret check. In piece-id mode without --retrigger the
# secret isn't needed, so we don't require it.
needs_secret() {
  [[ -z "$PIECE_ID" ]] || [[ "$RETRIGGER" -eq 1 ]]
}

if needs_secret && [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo "✗ ADMIN_SECRET env var not set — source it from your secrets manager." >&2
  echo "  Example: export ADMIN_SECRET=\$(wrangler secret list ... )" >&2
  exit 1
fi

# ── dispatch ─────────────────────────────────────────────────────────

if [[ -n "$PIECE_ID" ]]; then
  # Defensive validation — must look like a UUID. Mismatched input would
  # otherwise SQL-bind as a string and wipe zero rows silently.
  if ! [[ "$PIECE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "✗ --piece-id must be a UUID (8-4-4-4-12 hex). Got: $PIECE_ID" >&2
    exit 1
  fi

  echo "Reset-piece: $PIECE_ID"
  echo "Repo: $REPO_ROOT"
  echo "Agents: $AGENTS_URL"
  echo ""

  # ── step 1: fetch piece metadata for scoping (date + published_at) ──
  echo "[1/4] Fetching piece metadata from D1..."
  meta_json=$(npx wrangler d1 execute zeemish --remote --json --command \
    "SELECT date, published_at FROM daily_pieces WHERE id = '$PIECE_ID' LIMIT 1")
  piece_date=$(echo "$meta_json" | node -e "
    const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'))[0]?.results ?? [];
    if (rows.length === 0) { process.stdout.write(''); }
    else { process.stdout.write(String(rows[0].date)); }
  ")
  published_at=$(echo "$meta_json" | node -e "
    const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'))[0]?.results ?? [];
    if (rows.length === 0) { process.stdout.write(''); }
    else { process.stdout.write(String(rows[0].published_at ?? '')); }
  ")

  if [[ -z "$piece_date" ]]; then
    echo "✗ No daily_pieces row found for piece_id $PIECE_ID. Bailing." >&2
    exit 1
  fi

  echo "      date: $piece_date"
  if [[ -n "$published_at" ]]; then
    echo "      published_at: $published_at"
  else
    echo "      published_at: NULL (pre-Phase-4 row — using unbounded window for pipeline_log)"
  fi
  echo ""

  # Time window for pipeline_log + observer_events scoping. 20min total
  # (same as Learner's LEARNER_PIPELINE_LOOKBACK_MS/LOOKAHEAD_MS — see
  # agents/src/learner.ts). Generous enough to cover stressed pipelines
  # (Anthropic/ElevenLabs latency spikes) without bleeding into other
  # same-date pieces at multi-per-day cadence where the tightest inter-
  # run gap is 60 min.
  if [[ -n "$published_at" ]]; then
    window_start=$((published_at - 600000))
    window_end=$((published_at + 600000))
  else
    window_start=0
    window_end=9999999999999
  fi

  # ── step 2: git rm matching MDX ─────────────────────────────────────
  echo "[2/4] Removing matching MDX file from git..."
  mdx_match=$(grep -l "pieceId: \"$PIECE_ID\"" content/daily-pieces/*.mdx 2>/dev/null || true)
  if [[ -z "$mdx_match" ]]; then
    echo "      (no MDX file contains pieceId $PIECE_ID — skipping git rm)"
  else
    echo "      - $mdx_match"
    git rm "$mdx_match"
    git commit -m "test: reset piece $PIECE_ID for pipeline re-test"
    git push
    echo "      Pushed. Auto-deploy will strip it live within ~30s."
  fi
  echo ""

  # ── step 3: clear D1 rows by piece_id + time window ─────────────────
  echo "[3/4] Clearing D1 rows scoped by piece_id + time window..."
  npx wrangler d1 execute zeemish --remote --command \
    "DELETE FROM daily_pieces WHERE id = '$PIECE_ID'; \
     DELETE FROM daily_candidates WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM audit_results WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM daily_piece_audio WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM zita_messages WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM learnings WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM engagement WHERE piece_id = '$PIECE_ID'; \
     DELETE FROM pipeline_log WHERE run_date = '$piece_date' AND created_at BETWEEN $window_start AND $window_end; \
     DELETE FROM observer_events WHERE created_at BETWEEN $window_start AND $window_end;"
  echo ""

  # ── step 4: optional fresh pipeline run ─────────────────────────────
  if [[ "$RETRIGGER" -eq 1 ]]; then
    echo "[4/4] Triggering fresh pipeline run (--retrigger)..."
    http_status=$(curl -sS -o /tmp/reset-today-response.json -w "%{http_code}" \
      -X POST "$AGENTS_URL/daily-trigger" \
      -H "Authorization: Bearer $ADMIN_SECRET")
    echo "      HTTP $http_status"
    echo "      Response: $(cat /tmp/reset-today-response.json)"
    echo ""
    if [[ "$http_status" != "202" && "$http_status" != "200" ]]; then
      echo "✗ Trigger failed." >&2
      exit 1
    fi
  else
    echo "[4/4] Skipping trigger (pass --retrigger to fire a fresh pipeline run)."
    echo ""
  fi

  echo "✓ Done. Piece $PIECE_ID cleared."
  echo "    Watch progress at: https://zeemish.io/dashboard/admin/"
  exit 0
fi

# ── full-day mode (default) ──────────────────────────────────────────
echo "Reset-today: $DATE"
echo "Repo: $REPO_ROOT"
echo "Agents: $AGENTS_URL"
echo ""

# ── step 1: git rm today's MDX ───────────────────────────────────────
echo "[1/3] Removing today's MDX file(s) from git..."
shopt -s nullglob
mdx_files=(content/daily-pieces/"$DATE"-*.mdx)
shopt -u nullglob

if [[ ${#mdx_files[@]} -eq 0 ]]; then
  echo "      (no MDX for $DATE — skipping)"
else
  for f in "${mdx_files[@]}"; do
    echo "      - $f"
    git rm "$f"
  done
  git commit -m "test: reset $DATE for pipeline re-test"
  git push
  echo "      Pushed. Auto-deploy will strip them live within ~30s."
fi
echo ""

# ── step 2: clear D1 rows ────────────────────────────────────────────
echo "[2/3] Clearing D1 rows for $DATE across 5 tables..."
# Note: observer_events.created_at is epoch-ms; use strftime in SQL so the
# cutoff is computed inside SQLite (avoids timezone drift from shell 'date').
npx wrangler d1 execute zeemish --remote --command \
  "DELETE FROM daily_pieces WHERE date = '$DATE'; \
   DELETE FROM daily_candidates WHERE date = '$DATE'; \
   DELETE FROM pipeline_log WHERE run_date = '$DATE'; \
   DELETE FROM audit_results WHERE task_id LIKE 'daily/$DATE%'; \
   DELETE FROM observer_events WHERE created_at >= (strftime('%s','now','start of day') * 1000);"
echo ""

# ── step 3: trigger a fresh pipeline run ─────────────────────────────
echo "[3/3] Triggering fresh pipeline run..."
http_status=$(curl -sS -o /tmp/reset-today-response.json -w "%{http_code}" \
  -X POST "$AGENTS_URL/daily-trigger" \
  -H "Authorization: Bearer $ADMIN_SECRET")

echo "      HTTP $http_status"
echo "      Response: $(cat /tmp/reset-today-response.json)"
echo ""

if [[ "$http_status" != "202" && "$http_status" != "200" ]]; then
  echo "✗ Trigger failed." >&2
  exit 1
fi

echo "✓ Done. Watch progress at:"
echo "    https://zeemish.io/dashboard/admin/"
echo "  Or curl:"
echo "    curl -s https://zeemish.io/api/dashboard/pipeline"
