#!/usr/bin/env sh
# Backup sidecar entrypoint: install a nightly cron for backup.sh and run
# crond in the foreground. busybox cron does NOT inherit the container env, so
# the two values backup.sh needs are baked into the crontab line.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/coldemail}"
mkdir -p "$BACKUP_DIR"

printf '30 2 * * * DATABASE_URL="%s" BACKUP_DIR="%s" INCOMING_DELETION_MANIFEST_PATH="%s" /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1\n' \
  "$DATABASE_URL" "$BACKUP_DIR" "${INCOMING_DELETION_MANIFEST_PATH:-}" > /etc/crontabs/root
touch /var/log/backup.log
echo "backup sidecar: nightly 02:30 UTC → $BACKUP_DIR"

# Surface backup output through `docker compose logs backup`.
tail -F /var/log/backup.log &
exec crond -f -l 8
