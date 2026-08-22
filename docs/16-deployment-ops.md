# Deployment & Operations

Single always-on VPS (finalized decision). Docker Compose primary; systemd alternative. Implemented
in B7 and cut over to Spaceship production on 2026-08-22.

---

## 1. Environment variables (complete list — zod-validated at boot, 02 §5)

| Var | Required | Default | Purpose |
|---|:--:|---|---|
| `DATABASE_URL` | ✅ | — | Postgres DSN (`app_rw` role in prod) |
| `SECRET_KEY` | ✅ | — | 32-byte hex; libsodium sealing of mailbox secrets |
| `SESSION_KEY` | ✅ | — | secure-session cookie key |
| `OPERATOR_EMAIL` / `OPERATOR_INITIAL_PASSWORD` | ✅ first boot | — | seeds `operator` row (password changeable in UI) |
| `PUBLIC_APP_URL` | ✅ for OAuth | — | canonical public origin/path, currently `https://sambhavpmtech.com/email-campaign` |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | for Google OAuth | unset | operator-owned Workspace Internal OAuth client; enter only on the VPS |
| `MAIL_TRANSPORT` | ✅ | `mock` | `mock` \| `smtp_imap` — **the one switch that goes live (B8)** |
| `MAIL_TLS_INSECURE` | | `false` | accept self-signed certs / skip STARTTLS on the mail servers. **Local test rig only** (the GreenMail container); boot refuses it with `NODE_ENV=production` |
| `ROLE` | | `all` | `all` \| `api` \| `worker` (decision Y). `api` = HTTP only (no pg-boss); `worker` = jobs only and **does not listen**, so a worker container needs no `/health` probe |
| `PORT` / `HOST` | | `3001` / `127.0.0.1` | app listens localhost-only; Caddy fronts it |
| `ANTHROPIC_API_KEY` | | unset | unset = sentiment suggestion silently off (decision E) |
| `ALERT_WEBHOOK_URL` | | unset | generic JSON POST per alert (decision V) |
| `NODE_ENV` | | `production` | |
| `LOG_LEVEL` | | `info` | pino |
| `BACKUP_DIR` | | `/var/backups/coldemail` | pg_dump target |
| `SIMULATED_CLOCK` | | `false` | test-only (docs/13 §5): VirtualClock + inline jobs + `POST /system/advance-clock`; boot refuses it with `smtp_imap` or `NODE_ENV=production` |

Everything operator-tunable at runtime lives in the `settings` row, not env (02 §5).

## 2. Production Docker Compose (profile `prod`)

Concrete files: [`docker-compose.prod.yml`](../docker-compose.prod.yml) + the multi-stage [`Dockerfile`](../Dockerfile) (targets `app` and `caddy`) + [`docker/Caddyfile`](../docker/Caddyfile) + [`docker/backup/`](../docker/backup) + [`.env.prod.example`](../.env.prod.example).

The live shared-VPS variant uses [`docker-compose.spaceship.yml`](../docker-compose.spaceship.yml),
[`docker/Caddyfile.spaceship`](../docker/Caddyfile.spaceship), and the host-Caddy fragment under
[`deploy/spaceship/`](../deploy/spaceship/). It builds the SPA at `/email-campaign/`, binds its
internal gateway only to `127.0.0.1:18080`, and leaves host Caddy as the sole public listener.

Services: **db** (postgres:16, volume `pgdata`, healthcheck) · **app** (multi-stage node:22 image; entrypoint applies `db:migrate` then boots via `tsx`; API + pg-boss workers; `depends_on: db healthy`; `restart: unless-stopped`; binds `0.0.0.0:3001` **inside its container** — `expose`d, never published, so only caddy reaches it) · **caddy** (:80/:443, auto-TLS for `$DOMAIN`; **serves the built SPA** baked into its image at `/srv` with history-API fallback, and reverse-proxies `/api/*` + `/health` to the app; basic-auth *not* used — app auth is the gate) · **backup** (alpine+pg_dump cron sidecar running [`scripts/backup.sh`](../scripts/backup.sh): nightly 02:30 `pg_dump -Fc` to `BACKUP_DIR`, prune > 14 days; weekly copy kept 8 weeks).

> The SPA is served by Caddy (from the `web-build` stage), not Fastify — so the app image stays API/worker-only and there is no cross-container static volume. The bundle is built with `VITE_API_MODE=real` and calls same-origin `/api/v1`.

Systemd alternative ([`deploy/systemd/`](../deploy/systemd)): OS Postgres + OS Caddy + `coldemail.service` (Node, `EnvironmentFile=/etc/coldemail.env`, `ExecStartPre` runs migrations, app binds `127.0.0.1`) + `coldemail-backup.service`/`.timer` (nightly 02:30).

**Resilience wiring (B7.6):** (a) **boot-migration ordering** — migrations complete before the server listens, in both models (the app entrypoint / the systemd `ExecStartPre`), so the schema is never behind the code. (b) **Healthchecks** — `db` uses `pg_isready`; `app` uses a Docker `HEALTHCHECK` hitting `/health` (a `node`/`fetch` one-liner — no curl in the slim image) and **caddy waits for `app: service_healthy`**, so TLS only fronts a ready app. (c) **Log rotation** — every compose service uses the `json-file` driver capped at 10 MB × 5 files (≤ 50 MB/service), so container logs can't fill the disk; on systemd, journald rotates. Backup dumps are pruned by `backup.sh` (§4).

## 3. Runbook (operations, in order of likely need)

Incident procedures are centralized in [docs/18](18-incident-response-runbook.md): mailbox
failure, bounce triage, spam complaints, emergency campaign pause, unsubscribe endpoint outage,
and restore after personal-data erasure.

- **First deploy:** `cp .env.prod.example .env.prod`, generate `SECRET_KEY`/`SESSION_KEY`, set `POSTGRES_PASSWORD`/`OPERATOR_*`/`DOMAIN`, then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
- **Spaceship deploy/update:** from `/opt/email-campaign`, run
  `docker compose -f docker-compose.spaceship.yml --env-file .env.prod up -d --build`; validate a
  candidate host Caddyfile before atomic reload. Never print `.env.prod`, resolved Compose output,
  container environment, or the backup sidecar crontab.
- **Deploy/update:** `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` — the app entrypoint applies migrations before it listens; scheduler catch-up handles the downtime window (never-burst; expect a `catchup_backlog` alert if > a few hours).
- **Backup now:** `docker compose exec backup /usr/local/bin/backup.sh` (or `BACKUP_DIR=./backups sh scripts/backup.sh`). **Restore drill (quarterly + the automated B7.2 gate in CI):** `DATABASE_URL=… BACKUP_DIR=… sh scripts/restore-drill.sh` — dumps, restores into a scratch DB, runs `rebuild-projections` then `--dry-run` (expect 0 diffs = the fold is deterministic), then `self-check` (expect 0 invariant violations). Data proven intact, not just present. Uses `pg_dump`/`pg_restore`/`psql` from PATH.
- **Ops CLIs need `-w @coldemail/server`** — they live in `apps/server/package.json` and there is no root proxy, so the bare root form fails (verified on the VM 2026-08-07). In the compose stack, prefix with `docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T app`.
- **Rotate `SECRET_KEY`:** run `npm run rotate-secrets -w @coldemail/server -- --new-key <hex>` (decrypts+re-seals all `mailbox_secrets` in one tx), then update env, restart.
- **Password reset (locked out):** `NEW_PASSWORD='…' npm run operator:set-password -w @coldemail/server` on the VPS (or `-- --password '…'`; the env form keeps it out of shell history). `ensureOperator` seeds the row only at first boot, so editing `OPERATOR_INITIAL_PASSWORD` afterwards does nothing — this CLI is the recovery path.
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

**Already proven offline (B8.1/B8.2, docs/13 §5a)** against a real SMTP+IMAP server in Docker, so the canary is about *providers*, not about the code: SMTP send with our Message-ID · In-Reply-To/References intact on the wire · IMAP fetch honouring the UID high-water mark (and re-polling appending nothing) · real DSN → hard/soft bounce · real OOO → auto_reply · real threaded reply → human_reply and STOP → suppression · bad credentials → `auth_failed` · the whole scheduler+poller pipeline over the live transport with a zero-drift rebuild. The two things a local server cannot give: a 5xx recipient rejection, and each provider's own DSN/OOO wording.

**Final local-canary evidence (2026-08-20 UTC):** Oracle has proven, against real Google servers
with owner-operated accounts only, the lines of §5 step 2 that do not need a dead address or a
provider DSN — Test-Connection round-trip, our Message-ID and threading intact in real headers,
a threaded reply classified human with the sequence stopping, and a `STOP` reply suppressing
immediately (`unsubscribe` with `matched_keyword: "stop"` → `UNSUBSCRIBED` + global suppression).
`delivered` fired on its scheduled confirm job, a re-poll processed zero new messages, and the
UI's analytics, outcomes and capacity agreed with the database. The final catch-up test then
accepted four owner-address messages in two paced waves after 10,833 seconds of downtime: two per
mailbox, 925 seconds apart per mailbox, with a `catchup_backlog` alert and no new failed jobs.
Containers and HTTPS/database health are green, self-check is clean, a fresh custom-format backup
passed `pg_restore --list`, and the final production projection check returned `checked 24
enrollments — 0 diff(s)`. Accelerated settings were restored and verified; both mailboxes are `ok`
at cap 5 with no resume cap. **Both test campaigns are paused**; resuming either or sending anything
further needs new per-send operator approval.

This does **not** prove real-domain deliverability, a 5xx recipient rejection, or provider DSN/OOO
wording. Those
remain gated on explicit authorization to send new external mail — see docs/17 §§3, 5 and 6.

1. One real mailbox, `MAIL_TRANSPORT=smtp_imap`, caps=5/day, seed addresses only.
2. Verify: Test-Connection round-trip · Message-ID/threading intact in real headers · reply from seed address → classified human, sequence stops · reply "STOP" → suppressed immediately · send to a known-dead address → DSN parsed hard, auto-pause math sane · seed OOO autoresponder → auto_reply, sequence continues · soft-bounce path (greylisting) if reproducible.
3. Diff real Gmail/Outlook DSN/OOO messages against `headers/` fixtures; patch patterns; offline suite re-run (B8.4).
4. Raise caps conservatively (10 → 20 → 30 over a week); enable remaining mailboxes; enroll a small real cohort; reconcile its metrics against the model (the golden-cohort reconciliation, now on reality).
5. Only then: full-volume operation. Revisit `List-Unsubscribe` header option.

## 6. Security checklist (B7 gate) — verified

- [x] App unreachable except via Caddy TLS; `/api` 401s without session; login rate-limited — §7 dry-run (app is `expose`d, not published) + the B6.1 auth suite
- [x] `events` UPDATE/DELETE rejected as `app_rw` in prod DB (verified, not assumed) — `test/integration/events-append-only.test.ts`
- [x] No secret material in logs (grep test over a full simulated run: B7.1) — `test/api/secret-redaction.test.ts`
- [x] Mailbox passwords absent from every API response (contract tests assert) — `test/api/mailboxes.test.ts` (`.strict()` response schemas are the tripwire)
- [x] Backups exist, restore drill passed, `SECRET_KEY`/`SESSION_KEY` stored outside the repo (VPS env file, mode 600) — `scripts/restore-drill.sh`, gated in CI

## 6a. Pre-canary prerequisites (operator, before B8.3)

The canary in §5 assumes warmed mailboxes on authenticated domains — the walkthrough's "4 mailboxes, already warmed, on secondary domains". None of this is code; all of it must exist before `MAIL_TRANSPORT=smtp_imap` sends anything real:

- **Secondary sending domains** — never the primary business domain. A deliverability mistake burns the domain, not just the mailbox.
- **SPF, DKIM, DMARC** published for each sending domain, and verified with a mail tester before the first send. Missing DKIM alone is enough to land in spam regardless of content.
- **Warming** — each mailbox aged and ramped by a warming service or by hand over ~2–4 weeks before it carries campaign volume. The app's ramp (`ramp_days` / `ramp_daily_enroll_cap`) governs *enrollment*, not mailbox reputation.
- **Provider authentication** — each mailbox can use a sealed app password or individual Google
  OAuth. Google OAuth needs the operator-owned Internal Workspace client, exact callback
  `https://sambhavpmtech.com/email-campaign/oauth/google/callback`, and per-mailbox consent. No
  domain-wide delegation is used. OAuth mailboxes stay `setup_required` and unsendable until the
  account-matched authorization succeeds.
- **Reverse DNS + a real reply-to inbox** the operator actually reads: replies are the product.
- **A non-residential postal address** for `compliance_settings.physical_address`. It is legally required in commercial email (CAN-SPAM for US recipients; CASL and GDPR/ePrivacy impose comparable identification duties) and the renderer refuses ALL sends while it is empty — but it is published to every recipient, so **never use a home address**. Use a PO Box, a virtual-mailbox/CMRA address, a registered business address, or a coworking address. A missing or obviously fake footer address is also a negative deliverability signal. *(For the B8.3-local canary a placeholder is fine — the only recipients are addresses the operator owns.)*

## 7. Clean-VPS deploy dry-run (B7.7) — verified 2026-07-24

Full stack built and brought up from a clean state (`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`), all checks green:

- [x] All three images build (`app`, `caddy`, `backup`).
- [x] Boot ordering holds: `db` healthy → `app` runs migrations + seeds the operator → `app` healthy → `caddy` starts.
- [x] `GET /health` through Caddy TLS → `{ ok: true, db: true }`; the app is **not** reachable on the host (only Caddy publishes 80/443; app is `expose`d).
- [x] Caddy serves the SPA (`GET /` → `index.html`) with history-API fallback (`GET /leads` → `index.html`).
- [x] Login through Caddy → app succeeds (`POST /api/v1/auth/login` → `{ ok: true }`).
- [x] Backup sidecar installs the nightly 02:30 cron; a live `backup.sh` writes a valid `pg_dump -Fc` to the `backups` volume and prunes.

Remaining for a full **M3** close: the real-backend walkthrough replay (§5, `e2e/walkthrough.spec.ts` — Playwright web ⇄ real server + MockTransport + `advance-clock`), which the frontend track deferred here from F8.

## 8. Spaceship shared-VPS production — deployed 2026-08-22

Production is live at `https://sambhavpmtech.com/email-campaign/` on the existing Spaceship VM.
The portfolio at `sambhavbuilds.com` remained online throughout. Code is pinned to `de8d158` on
`b8.3-local-canary`; `main` was not merged. Oracle remains paused and unchanged as the temporary
rollback environment.

- **Reverse proxy:** host Caddy is the only public 80/443 listener. The container gateway binds
  only `127.0.0.1:18080`; Postgres and the app port are not published.
- **Memory:** a persistent 2 GiB swap file was added before building. Swap reduces OOM risk but is
  not a backup.
- **Routing:** `/email-campaign` canonicalizes to `/email-campaign/`; direct SPA routes and the
  subpath API work. Other outreach-domain paths redirect 308 to the portfolio homepage. Each
  unsubscribe host proxies only `/u/*` and returns 404 elsewhere.
- **DNS/TLS:** authoritative DNS returns `104.207.93.174` for the six approved A records. Existing
  MX/SPF/DKIM/DMARC/site-verification records were not changed. Public TLS passed on every host.
- **Database recovery:** the nightly logical-backup sidecar is active. A fresh custom-format dump
  passed `pg_restore --list`; a scratch restore, projection rebuild/dry-run, and self-check passed,
  and the scratch database was removed.
- **VM recovery:** Spaceship AutoBackup is active on its seven-day trial with a five-backup limit.
  It complements rather than replaces the logical PostgreSQL dumps and eventual independent copy.

### Unsubscribe URL and Gmail one-click — deployed, commissioning pending

The hash-only token implementation and both public hosts are deployed. Production still has an
empty `unsubscribe_base_url`, so no link or headers are emitted until the operator saves the valid
business postal address and `https://unsubscribe.{sender_domain}`. After that, mail from each
sender domain resolves to its matching unsubscribe host. `GET` confirms without unsubscribing;
`POST` creates permanent global suppression; invalid/expired tokens reveal no recipient data.
Reply `STOP` remains the fallback. The first owner-address link and RFC 8058 one-click proof needs
separate send authorization.

### Post-canary build order — implemented, operator handoffs remain

Public unsubscribe/one-click, hard launch guardrails, domain-readiness preflight, individual Google
Workspace OAuth, controlled variants, and copy-risk checks are implemented and locally verified.
OAuth uses authorization code + PKCE, hashed one-time state, encrypted refresh tokens, account
matching, XOAUTH2 SMTP/IMAP, reconnect/revoke, and `auth_failed` pausing; it does not use domain-wide
delegation.

Production OAuth is not configured yet. The operator must create the Internal Workspace client,
enter its client ID/secret directly on the VPS, trust it if required, and approve each outreach
mailbox. The compliance address/template, first mailbox Test Connection, and bounded owner-address
send/reply/unsubscribe canary also remain. None of this authorizes prospect mail.
