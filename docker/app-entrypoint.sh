#!/usr/bin/env sh
# App container entrypoint (docs/16 §2): apply pending migrations, then boot.
# Migrations run to completion BEFORE the server listens, so the schema is
# never behind the code. On ROLE=all the same process also runs the pg-boss
# workers (scheduler tick, polls, confirm-delivery, integrity jobs).
set -eu

echo "entrypoint: applying migrations"
npm run db:migrate -w @coldemail/server

echo "entrypoint: starting server (ROLE=${ROLE:-all}, transport=${MAIL_TRANSPORT:-mock})"
exec npm run start -w @coldemail/server
