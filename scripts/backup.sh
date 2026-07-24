#!/usr/bin/env sh
# Nightly logical backup (docs/16 §2, §4). pg_dump -Fc (custom format:
# compressed, restorable with pg_restore into a fresh DB) to $BACKUP_DIR, then
# prune. Runs from the compose `backup` sidecar (cron 02:30) or by hand:
#   docker compose exec backup /backup.sh
#   BACKUP_DIR=./backups DATABASE_URL=... sh scripts/backup.sh
#
# Retention: daily dumps kept 14 days; every dump taken on a Sunday is also
# copied into weekly/ and kept 8 weeks. The event log is the source of truth,
# so a dump + rebuild-projections fully reconstructs state (docs/16 §3).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/coldemail}"
WEEKLY_DIR="$BACKUP_DIR/weekly"

mkdir -p "$BACKUP_DIR" "$WEEKLY_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP="$BACKUP_DIR/coldemail-$STAMP.dump"

# -Fc = custom format; restore with `pg_restore -d <db>`.
pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" -f "$DUMP"
echo "backup: wrote $DUMP ($(wc -c < "$DUMP") bytes)"

# Sunday (ISO weekday 7) → keep a weekly copy.
if [ "$(date -u +%u)" = "7" ]; then
  cp "$DUMP" "$WEEKLY_DIR/coldemail-$STAMP.dump"
  echo "backup: kept weekly copy"
fi

# Prune: dailies older than 14 days, weeklies older than 56 days (8 weeks).
find "$BACKUP_DIR" -maxdepth 1 -name 'coldemail-*.dump' -type f -mtime +14 -delete
find "$WEEKLY_DIR" -maxdepth 1 -name 'coldemail-*.dump' -type f -mtime +56 -delete
echo "backup: prune complete"
