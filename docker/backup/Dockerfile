# Backup sidecar (docs/16 §2, §4): busybox cron running scripts/backup.sh
# nightly at 02:30. Postgres 16 client for pg_dump -Fc.
FROM alpine:3
RUN apk add --no-cache postgresql16-client tzdata
COPY scripts/backup.sh /usr/local/bin/backup.sh
COPY docker/backup/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
