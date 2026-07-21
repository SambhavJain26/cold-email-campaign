# Deployment & Operations

Single always-on VPS (finalized decision). Docker Compose primary; systemd alternative. Implemented in B7; live cutover in B8.

---

## 1. Environment variables (complete list - zod-validated at boot, 02 §5)

| Var | Required | Default | Purpose |
|---|:--:|---|---|
| `DATABASE_URL` | ✅ | - | Postgres DSN (`app_rw` role in prod) |
| `SECRET_KEY` | ✅ | - | 32-byte hex; libsodium sealing of mailbox secrets |
| `SESSION_KEY` | ✅ | - | secure-session cookie key |
| `OPERATOR_EMAIL` / `OPERATOR_INITIAL_PASSWORD` | ✅ first boot | - | seeds `operator` row (password changeable in UI) |
| `MAIL_TRANSPORT` | ✅ | `mock` | `mock` \| `smtp_imap` - **the one switch that goes live (B8)** |
| `ROLE` | | `all` | `all` \| `api` \| `worker` (decision Y) |
| `PORT` / `HOST` | | `3000` / `127.0.0.1` | app listens localhost-only; Caddy fronts it |
| `ANTHROPIC_API_KEY` | | unset | unset = sentiment suggestion silently off (decision E) |
| `ALERT_WEBHOOK_URL` | | unset | generic JSON POST per alert (decision V) |
| `NODE_ENV` | | `production` | |
| `LOG_LEVEL` | | `info` | pino |
| `BACKUP_DIR` | | `/var/backups/coldemail` | pg_dump target |

Everything operator-tunable at runtime lives in the `settings` row, not env (02 §5).

## 2. Production Docker Compose (profile `prod`)

Services: **db** (postgres:16, volume `pgdata`, healthcheck) · **app** (multi-stage node:22 image; runs `db:migrate` then boot; `depends_on: db healthy`; `restart: unless-stopped`; serves built SPA statically from Fastify) · **caddy** (:80/:443, auto-TLS, reverse-proxy to app; basic-auth *not* used - app auth is the gate; Caddy adds TLS + rate-limit headroom) · **backup** (alpine+pg_dump cron sidecar: nightly 02:30 `pg_dump -Fc` to `BACKUP_DIR`, prune > 14 days; weekly copy kept 8 weeks).

Systemd alternative (documented in runbook): OS Postgres + `coldemail.service` (Node, `EnvironmentFile=/etc/coldemail.env`) + `coldemail-backup.timer`.

## 3. Runbook (operations, in order of likely need)

- **Deploy/update:** `git pull && docker compose --profile prod build app && docker compose --profile prod up -d` - migrations run on boot; scheduler catch-up handles the downtime window (never-burst; expect a `catchup_backlog` alert if > a few hours).
- **Backup now:** `docker compose exec backup /backup.sh`. **Restore drill (quarterly + B7.2 test):** restore latest dump into a scratch DB, run `rebuild-projections --dry-run`, expect 0 diffs, run `selfCheck` - data proven intact, not just present.
- **Rotate `SECRET_KEY`:** run `npm run rotate-secrets -- --new-key <hex>` (decrypts+re-seals all `mailbox_secrets` in one tx), then update env, restart.
- **Password reset (locked out):** `npm run operator:set-password` on the VPS.
- **Disaster recovery:** restore dump → boot → `rebuild-projections` → reconcile via self-check. The event log *is* the recovery source (plan §9).
- **Logs:** `docker compose logs -f app | npx pino-pretty`; alerts feed mirrors everything actionable.

## 4. Observability & scheduled safety jobs (B7)

| Job | Schedule | Action on failure |
|---|---|---|
| `self-check` | daily 03:00 | invariant violations → `selfcheck_drift` alert (error) |
| `rebuild-compare` | weekly Sun 04:00 | projection diff → `selfcheck_drift` alert |
| backup | nightly 02:30 | missing/stale dump detected by self-check → alert |
| stale-poll sweep | in scheduler tick | mailbox → `imap_stale` + pause + alert |

Nothing fails silently: every pg-boss final failure emits `job_failed`.

## 5. B8 live-canary checklist (condensed from plan Stage 9)

1. One real mailbox, `MAIL_TRANSPORT=smtp_imap`, caps=5/day, seed addresses only.
2. Verify: Test-Connection round-trip · Message-ID/threading intact in real headers · reply from seed address → classified human, sequence stops · reply "STOP" → suppressed immediately · send to a known-dead address → DSN parsed hard, auto-pause math sane · seed OOO autoresponder → auto_reply, sequence continues · soft-bounce path (greylisting) if reproducible.
3. Diff real Gmail/Outlook DSN/OOO messages against `headers/` fixtures; patch patterns; offline suite re-run (B8.4).
4. Raise caps conservatively (10 → 20 → 30 over a week); enable remaining mailboxes; enroll a small real cohort; reconcile its metrics against the model (the golden-cohort reconciliation, now on reality).
5. Only then: full-volume operation. Revisit `List-Unsubscribe` header option.

## 6. Security checklist (B7 gate)

- [ ] App unreachable except via Caddy TLS; `/api` 401s without session; login rate-limited
- [ ] `events` UPDATE/DELETE rejected as `app_rw` in prod DB (verified, not assumed)
- [ ] No secret material in logs (grep test over a full simulated run: B7.1)
- [ ] Mailbox passwords absent from every API response (contract tests assert)
- [ ] Backups exist, restore drill passed, `SECRET_KEY`/`SESSION_KEY` stored outside the repo (VPS env file, mode 600)
