# Deployment & Operations

Single always-on VPS (finalized decision). Docker Compose primary; systemd alternative. Implemented in B7; live cutover in B8.

---

## 1. Environment variables (complete list — zod-validated at boot, 02 §5)

| Var | Required | Default | Purpose |
|---|:--:|---|---|
| `DATABASE_URL` | ✅ | — | Postgres DSN (`app_rw` role in prod) |
| `SECRET_KEY` | ✅ | — | 32-byte hex; libsodium sealing of mailbox secrets |
| `SESSION_KEY` | ✅ | — | secure-session cookie key |
| `OPERATOR_EMAIL` / `OPERATOR_INITIAL_PASSWORD` | ✅ first boot | — | seeds `operator` row (password changeable in UI) |
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

Services: **db** (postgres:16, volume `pgdata`, healthcheck) · **app** (multi-stage node:22 image; entrypoint applies `db:migrate` then boots via `tsx`; API + pg-boss workers; `depends_on: db healthy`; `restart: unless-stopped`; binds `0.0.0.0:3001` **inside its container** — `expose`d, never published, so only caddy reaches it) · **caddy** (:80/:443, auto-TLS for `$DOMAIN`; **serves the built SPA** baked into its image at `/srv` with history-API fallback, and reverse-proxies `/api/*` + `/health` to the app; basic-auth *not* used — app auth is the gate) · **backup** (alpine+pg_dump cron sidecar running [`scripts/backup.sh`](../scripts/backup.sh): nightly 02:30 `pg_dump -Fc` to `BACKUP_DIR`, prune > 14 days; weekly copy kept 8 weeks).

> The SPA is served by Caddy (from the `web-build` stage), not Fastify — so the app image stays API/worker-only and there is no cross-container static volume. The bundle is built with `VITE_API_MODE=real` and calls same-origin `/api/v1`.

Systemd alternative ([`deploy/systemd/`](../deploy/systemd)): OS Postgres + OS Caddy + `coldemail.service` (Node, `EnvironmentFile=/etc/coldemail.env`, `ExecStartPre` runs migrations, app binds `127.0.0.1`) + `coldemail-backup.service`/`.timer` (nightly 02:30).

**Resilience wiring (B7.6):** (a) **boot-migration ordering** — migrations complete before the server listens, in both models (the app entrypoint / the systemd `ExecStartPre`), so the schema is never behind the code. (b) **Healthchecks** — `db` uses `pg_isready`; `app` uses a Docker `HEALTHCHECK` hitting `/health` (a `node`/`fetch` one-liner — no curl in the slim image) and **caddy waits for `app: service_healthy`**, so TLS only fronts a ready app. (c) **Log rotation** — every compose service uses the `json-file` driver capped at 10 MB × 5 files (≤ 50 MB/service), so container logs can't fill the disk; on systemd, journald rotates. Backup dumps are pruned by `backup.sh` (§4).

## 3. Runbook (operations, in order of likely need)

Incident procedures are centralized in [docs/18](18-incident-response-runbook.md): mailbox
failure, bounce triage, spam complaints, emergency campaign pause, unsubscribe endpoint outage,
and restore after personal-data erasure.

- **First deploy:** `cp .env.prod.example .env.prod`, generate `SECRET_KEY`/`SESSION_KEY`, set `POSTGRES_PASSWORD`/`OPERATOR_*`/`DOMAIN`, then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
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
- **App passwords / provider auth** — the transport does password auth only (`auth_type` is stored but unused; no OAuth). Gmail/Outlook need an app password with IMAP enabled.
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

## 8. Deferred shared-VPS deployment plan (recorded 2026-08-09)

Deployment is deliberately deferred until the B8.3-local Gmail validation is complete. The
production VPS has already been purchased, unboxed, and is running Ubuntu. It also hosts the
operator's other website, so this application will share the machine rather than receive a
dedicated VM.

- **Reverse proxy:** the operator is replacing the existing Nginx setup with **Caddy**. Keep the
  Compose/Caddy deployment design in this repository; Caddy will own public ports 80/443 and route
  sites by hostname. Do not run Nginx and Caddy concurrently on those ports.
- **Memory:** approximately **1.5 GiB RAM** is free after Ubuntu and the existing website. Create
  a **2 GiB swap file** before building or starting the Docker stack. Swap is disk-backed virtual
  memory: it reduces the risk of OOM kills during Node/Docker builds and under memory pressure, but
  it is slower than RAM and is **not a backup**.
- **Database backups:** retain the application's nightly `pg_dump` backup sidecar and its restore
  drill. Those dumps are useful for database-level recovery but, while stored on the same VM, do
  not protect against total VM loss.
- **VPS backups:** Spaceship Starlight AutoBackup is a separate off-site VM-backup layer. It is
  recommended before the app holds real campaign/business data (and would also protect the other
  website), but it can be deferred during throwaway local/Gmail canary testing. It does not replace
  database-level dumps or eventual independent off-VM archival copies.
- **Before real launch:** enable an off-VM recovery layer (Spaceship AutoBackup or an equivalent),
  verify a restore path, and arrange an independent copy of database backups. Do not treat a swap
  file as relevant to recovery.

### Unsubscribe URL and Gmail one-click plan — before real domains

The current canary footer keeps a reply-based opt-out (`STOP`) because the application does not
yet expose a public unsubscribe endpoint. Before sending from real domains, add this as a small,
separate deployment feature:

- **Host:** use a first-party HTTPS subdomain of the sending domain, such as
  `https://unsubscribe.<sending-domain>/u/<opaque-token>`. Do not use an IP address, a URL
  shortener, a third-party redirect, or an address/lead identifier in the URL.
- **Token:** generate a high-entropy opaque token, store only its hash, and resolve it server-side
  to the intended lead/enrollment. It must remain usable long enough to honour an opt-out and
  must never expose the recipient's email address in a URL, page title, logs, or analytics.
- **Browser flow:** `GET /u/<token>` renders a minimal confirmation page; `POST /u/<token>`
  immediately appends the unsubscribe fact and creates the global suppression. The GET must not
  unsubscribe by itself because security scanners and privacy tools may prefetch links.
- **Gmail one-click flow:** send `List-Unsubscribe: <https://…/u/<token>>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the same endpoint accepts Gmail's POST and
  suppresses immediately. This is the standards-based one-click mechanism for bulk promotional
  Gmail traffic, not merely a body hyperlink.
- **Footer:** retain “Reply STOP to unsubscribe” as the plaintext fallback, and add a clear,
  untracked `Unsubscribe` body link in the HTML alternative. Do not require login, an email form,
  a survey, or a preferences screen before honouring the request.
- **Caddy/ops:** add the route under the existing HTTPS app host/subdomain, monitor endpoint
  availability, and test normal browser POST, Gmail header POST, expired/invalid tokens, duplicate
  requests, and no-PII logging before enabling real-domain traffic.

### Operator-confirmed post-canary build order — not started (2026-08-13)

The controlled ten-day Gmail learning canary comes first. After it closes, the following is the
approved implementation order before any real-domain prospect send:

1. **Unsubscribe and one-click support** — implement and deploy the preceding plan, including the
   public endpoint, opaque tokens, clear body link, `List-Unsubscribe` headers, Gmail one-click
   POST handling, suppression, and endpoint/no-PII-log tests.
2. **Hard launch guardrails** — make conservative mailbox and campaign ceilings plus staged
   enrollment explicit and enforceable. The objective is to prevent an operator configuration error
   from creating an unsafe initial volume; it does not replace domain warming or recipient consent.
3. **Domain-readiness preflight** — provide an operator-facing readiness check for SPF, DKIM,
   DMARC/alignment, reply inbox/MX, compliance address, mailbox health, conservative caps, warming
   status, and unsubscribe deployment. The app may record/check readiness, but must not pretend it
   can configure DNS or establish reputation itself.
4. **Google Workspace OAuth** — replace the current app-password-only transport with individual
   OAuth authorization for each outreach inbox, server-side encrypted refresh-token storage,
   refresh/revocation handling, and a reconnect UI. Use the operator-owned internal Workspace OAuth
   client; keep the main-domain super-admin inbox out of the sending set; do not introduce
   domain-wide delegation initially.
5. **Controlled copy variation** — deterministic spintax, step variants, and copy-risk checks are
   already implemented. Audit and retain them; do not add artificial "unique every time" logic or
   treat variation as an anti-spam bypass. Outbound mail remains untracked: no pixels, click
   tracking, or tracking-domain redirect.

This is a deferred roadmap, not a claim that these capabilities exist today. It does not authorize
DNS changes, a deploy, or any real-domain sending.
