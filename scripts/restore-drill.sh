#!/usr/bin/env sh
# Restore drill (docs/16 §3, the B7.2 gate). Proves a backup is not merely
# present but RESTORABLE and INTACT by replaying the exact disaster-recovery
# runbook (docs/16 §5) against a throwaway scratch DB: take a fresh dump →
# restore → rebuild-projections (rebuild the projections from the restored
# log) → rebuild-projections --dry-run (0 diffs = the fold is deterministic) →
# self-check (0 invariant violations). Any non-zero step fails the drill.
#
#   DATABASE_URL=postgres://…/coldemail BACKUP_DIR=./backups sh scripts/restore-drill.sh
#
# Requires pg client tools (pg_dump/pg_restore/psql) on PATH - present on the
# VPS, the alpine backup sidecar, and CI's ubuntu runner.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/coldemail}"
SCRATCH_DB="${SCRATCH_DB:-coldemail_restore_drill}"
export BACKUP_DIR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# scratch URL = source URL with the db name swapped (no query string in ours).
BASE_URL="${DATABASE_URL%/*}"
SCRATCH_URL="$BASE_URL/$SCRATCH_DB"

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "drill: 1/5 taking a fresh backup"
sh "$SCRIPT_DIR/backup.sh" >/dev/null
DUMP="$(ls -1t "$BACKUP_DIR"/coldemail-*.dump | head -n1)"
echo "drill: restoring $DUMP"

echo "drill: 2/5 recreating scratch DB $SCRATCH_DB"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH_DB"
pg_restore --no-owner --no-privileges -d "$SCRATCH_URL" "$DUMP"

echo "drill: 3/5 rebuild-projections (recover projections from the restored log)"
DATABASE_URL="$SCRATCH_URL" npm --prefix "$REPO_ROOT" run -w @coldemail/server rebuild-projections

echo "drill: 4/5 rebuild-projections --dry-run (expect 0 diffs - deterministic fold)"
DATABASE_URL="$SCRATCH_URL" npm --prefix "$REPO_ROOT" run -w @coldemail/server rebuild-projections -- --dry-run

echo "drill: 5/5 self-check (expect 0 violations)"
DATABASE_URL="$SCRATCH_URL" npm --prefix "$REPO_ROOT" run -w @coldemail/server self-check

echo "drill: PASS - dump restored, projections fold deterministically, invariants hold"
