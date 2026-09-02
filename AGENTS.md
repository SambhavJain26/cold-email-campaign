# Cold Email Campaign — Agent Instructions

## Authority and reading order

This file is the canonical operating boundary and wins over `CLAUDE.md` on any disagreement.
Keep the two aligned when durable instructions change. `CLAUDE.md` is the detailed engineering
memory; do not copy its build history or finished-stage notes here.

Before operational or testing work, read in order:

1. `CLAUDE.md`
2. `docs/17-local-canary-runbook.md` — the durable, authoritative status and findings record
3. `docs/16-deployment-ops.md`
4. `PROGRESS.md` and `docs/00-INDEX.md` when selecting or locating work
5. `git status` and recent `git log`

Update the runbook only after an outcome is verified. Never leave completed work marked open or
call planned work implemented.

## Current operating boundary

The Spaceship production infrastructure is live, but the project remains in **pre-prospect-send
commissioning** until the operator completes the handoffs below:

- **The authorized feature scope** includes the completed operator-approved 2026-08-15 list plus
  the 2026-08-20 pre-domain safety backlog: mandatory reply stopping; reply dispositions and
  conservative suppression; guarded cross-campaign recontact; broader opt-out phrases; findings
  20–25; alert history and mailbox filters; arbitrary custom-field editing; copy-risk rubric
  improvements; local verification; and runbook/documentation reconciliation. Outside that list,
  work is limited to testing, verification, diagnosis, and documentation.
- The operator-approved Personalized Copy/two-tier/campaign-lead-filter release and its 2026-08-31
  import-wizard clarity follow-up are implemented, fully verified, pushed, and deployed on
  Spaceship; production is now at footer-remediation release `c31d73b` through migration `0019`.
  It replaces direct Manual Compose sending with sequence-only personalized steps, fixes current
  tiers at A/B, separates Nurture status, adds global-source/campaign-step copy snapshots and
  blockers, and adds exact Pool/Enrolled/Both filtering and bulk tiering. The follow-up replaces
  the misleading single Draft target campaign with
  per-allocation generic-copy step selection, requires an explicit destination for campaigns with
  multiple Personalized Copy steps, preserves direct `step_N_*` mapping, and adds a named
  no-activation/no-enrollment/no-send summary. Those were the verified deployment-time baseline
  facts; the later owner-controlled walkthrough changed live campaign/lead state under separate
  authorization.
- The 2026-09-01 owner-address walkthrough remediation is implemented, fully verified, pushed, and
  deployed on Spaceship at `8ed86a4`. It closes the observed metric, analytics,
  campaign-progress, campaign-context, Personalized Copy, import, timezone, unsubscribe, and
  rendering defects. No migration or live campaign/enrollment mutation was required. Gmail
  follow-up body-footer visibility remains open for a separately approved owner-address canary.
- The 2026-09-02 Gmail footer remediation is implemented, fully verified, pushed, and deployed at
  `c31d73b`. No migration, campaign/enrollment mutation, or send occurred. A new owner-controlled
  Gmail follow-up is still required to prove visibility. Deployment verification briefly observed
  DNSSEC `SERVFAIL` on both Spaceship-managed outreach domains. Registrar DS values exactly matched
  the served DNSKEY tags/digests, and Google, Cloudflare, Quad9, system resolution, and the complete
  public route matrix recovered without a configuration change. Keep DNSSEC enabled; treat this as
  a transient provider incident unless it recurs.
- The operator-approved 2026-08-25 ten-workstream implementation is complete and deployed through
  Stages 1–4: operational pagination; due-step Manual Compose; in-app reminders; verified
  timezone/folder controls; imported manual drafts; Auto Observation/sequence variables; staged
  activation ramps; later-step direct/eventual variant analytics; atomic multi-source cold-storage
  recycling with durable provenance; and the responsive/mobile redesign. The complete local gate
  is verified, and Spaceship was advanced to the pinned Stage 4 commit on 2026-08-25. No campaign
  activation, production enrollment, or send is authorized.
- The operator-approved 2026-08-30 campaign-pool/auto-enrollment/permanent-cap implementation is
  complete, verified, and deployed on Spaceship at `6ca1183`: exact import allocation, durable pool
  management, pool-only count enrollment, opt-in idempotent daily fair allocation, shared opener
  reservations, and permanent post-ramp caps. Auto-enrollment remains disabled because production
  has no campaigns or leads. Do not treat the deployment as authorization to activate/enroll/send.
- The approved Spaceship deployment, subpath support, sender-domain unsubscribe routing, and
  per-mailbox Google Workspace OAuth implementation are complete on `b8.3-local-canary`. Do not
  extend production scope, change DNS/Caddy, or configure a real mailbox beyond the approved
  commissioning steps without fresh operator authorization.
- Deploy only with explicit operator authorization for that deploy. Do not treat approval to edit,
  test, commit, or push as approval to deploy.
- Every outbound batch needs specific approval. Sending mail, activating or resuming a campaign,
  enrolling leads, altering live campaign state, starting a cohort, or contacting prospects are
  separately gated actions. Only send to operator-controlled addresses. Never create sends merely
  to test behavior.
- The controlled Gmail acceptance batch is complete and the test campaign is **paused**. Do not
  resume it or create another test send without new per-send approval.
- The two unsubscribe hosts, business postal address, and
  `https://unsubscribe.{sender_domain}` template are configured. The production Gmail body-link
  GET and confirm flow were verified with an owner-controlled address. The 2026-09-02
  owner-address follow-up canary verified that Gmail collapses the body footer on desktop behind
  **Show trimmed content** and on mobile behind **Show quoted text**. A local remediation candidate
  now uses a two-line presentation-table footer with the operator-approved 10px/blue-link/dark-gray
  treatment and no hidden variation; its non-Docker gate passes, but DB/GreenMail verification and
  a post-deployment Gmail canary remain pending. Gmail exposed no native unsubscribe control in
  the tested views, so RFC 8058 mailbox-client one-click remains unverified (the missing UI does
  not prove that the headers were absent).
- Work on the current `canary` branch. Do not branch off, push to `main`, or merge to
  `main` without explicit authorization. Make surgical edits, preserve unrelated dirty-worktree
  changes, and commit each completed task on the current branch.

## Secrets, data, and messaging safety

- Never ask the operator to paste passwords, app passwords, `SECRET_KEY`, `SESSION_KEY`, or
  `.env`/`.env.prod` contents. App passwords are entered in the Mailboxes UI and sealed with
  libsodium. Secrets never belong in chat, logs, command output, fixtures, or the repository.
- Preserve the append-only `events` ledger. Never update/delete past events, rewrite sent history,
  or route around its trigger and `app_rw` grants. Do not erase user data or alter live state for a
  test.
- Keep mail simple, compliant, and untracked: no pixels, click tracking, or tracking redirects.
  A recorded `STOP`/unsubscribe is permanently and globally suppressive.
- Use `apply_patch` for repository edits and preserve unrelated work. Reconcile code and docs
  rather than silently diverging.

## Test discipline

- Local Postgres and GreenMail: `docker compose up -d`.
- Run DB-backed Vitest projects **serially**. They share `coldemail_test`; parallel invocations can
  truncate each other's data and produce corrupt or misleading results.
- Fast iteration: `npx vitest run --project unit`.
- Important gates: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run test:golden`, `npm run test:mail`, and relevant API/integration/web suites. The locked
  golden suite is **47 tests**; never skip or casually regenerate it.
- The only correct projection drift command is
  `npx tsx apps/server/src/services/rebuildCli.ts --dry-run`. Require zero diffs after changes to
  events or projections; `checked 0 enrollments` proves only that the CLI ran.
- Complete serial local gate passed 2026-08-22: type/lint/format; unit 338; web 55;
  integration 159; API 116; GreenMail 29; golden exactly 47; mock E2E 51; real-backend E2E 1;
  populated test DB `checked 5 enrollments — 0 diff(s)`; self-check clean.
- Complete Stage 4 serial local gate passed 2026-08-25: type/lint/format; unit 341; web 56;
  integration 166; API 122; GreenMail 29; golden exactly 47; mock E2E 59; real-backend E2E 1;
  migration 0017 apply/down/apply; populated test DB `checked 5 enrollments — 0 diff(s)`;
  self-check clean; custom-format dump catalog and scratch restore/rebuild/dry-run/self-check pass.
- The 2026-08-25 pagination/settings UX hotfix passed type/lint/format, web 57, mock E2E 60,
  real-backend E2E 1, and a production Vite build. This frontend-only change did not alter events,
  projections, migrations, scheduler behavior, or mail transport.
- The 2026-08-30 campaign-pool gate passed type/lint/format; unit 342; web 58; integration 167;
  API 130; GreenMail 29; golden exactly 47; mock E2E 60; real-backend E2E 1; migration 0018
  apply/down/apply; populated `checked 5 enrollments — 0 diff(s)`; self-check clean; and a validated
  custom-format dump/scratch restore/rebuild/zero-drift/self-check. Concurrent daily claims and a
  timezone change that moves the local date backward are covered. The verified candidate was
  subsequently deployed to Spaceship under separate operator approval.
- The 2026-08-30 Personalized Copy/two-tier/campaign-filter gate passed type/lint/format; unit 345;
  web 58; integration 168; API 138; GreenMail 29; golden exactly 47; mock E2E 61;
  real-backend E2E 1; migration 0019 apply/down/apply; populated `checked 5 enrollments — 0
  diff(s)`; self-check clean; production build; and a validated custom-format dump with scratch
  restore/rebuild/zero-drift/self-check. The verified candidate was subsequently deployed to
  Spaceship under separate operator approval.
- The 2026-08-31 import-wizard clarity gate passed type/lint/format; unit 345; web 58;
  integration 168; API 140; GreenMail 29; golden exactly 47; mock E2E 62; real-backend E2E 1;
  production build; `checked 0 enrollments — 0 diff(s)`; and clean self-check. No migration,
  production mutation, activation, enrollment, or send was performed.
- The 2026-09-01 walkthrough-remediation gate passed type/lint/format; unit 345; web 58;
  integration 168; API 144; GreenMail 29; golden exactly 47; mock E2E 62; real-backend E2E 1;
  production build; populated `checked 5 enrollments — 0 diff(s)`; clean self-check; and a
  validated custom-format dump/scratch restore/rebuild/zero-drift/self-check. No migration,
  production mutation, push, or deployment was performed.

## Production deployments

Spaceship is the primary production deployment. Oracle remains paused and unchanged as the
temporary rollback/canary environment.

### Spaceship production

- SSH alias: `sambhavbuilds-vps` (`root@104.207.93.174`, port 22022)
- App: `/opt/email-campaign`; stack: `docker-compose.spaceship.yml` with `.env.prod`
- Public UI: `https://sambhavpmtech.com/email-campaign/`
- Internal gateway: `127.0.0.1:18080`; host Caddy is the only public 80/443 listener
- Deployed application release: `canary` at `8ed86a4`

The repository is private and the VPS currently has no GitHub deploy credential. Until a read-only
deploy key is deliberately installed, transfer a reviewed `git bundle`, fetch the pinned branch
from that bundle, and fast-forward locally; `git pull` from GitHub will fail non-interactively.
After explicit deploy authorization and a verified fast-forward, run:

```sh
cd /opt/email-campaign
sudo docker compose -f docker-compose.spaceship.yml --env-file .env.prod build
sudo docker compose -f docker-compose.spaceship.yml --env-file .env.prod up -d
```

Then verify container health, public HTTPS/redirect routing, a zero-drift projection dry run,
self-check, and a validated backup. Do not print `.env.prod`, resolved Compose output, container
environment, or the backup sidecar's crontab.

### Oracle rollback canary

- SSH: `ssh -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`
- App: `~/app`; stack: `docker-compose.prod.yml` with `.env.prod`
- UI tunnel: `ssh -L 8443:localhost:443 -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`, then
  `https://localhost:8443`
- Deployed branch: `b8.3-local-canary`

After explicit deploy authorization, use:

```sh
cd ~/app && git pull --ff-only
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Then verify container health, `https://localhost/health`, and a zero-drift projection dry run in
the app container.

**Never print resolved production environment output.** `crontab -l` in either backup sidecar embeds
the full `DATABASE_URL`, including its password; print only the schedule. `docker inspect` and
`docker compose config` also render secrets. This warning follows an actual credential exposure
and password rotation.

## Live deployment state

Spaceship production was deployed on 2026-08-22 and advanced through Stage 4, campaign pools, the
Personalized Copy/two-tier/campaign-filter release, import-wizard clarity, owner-walkthrough
remediation, and the 2026-09-02 footer remediation at `c31d73b`. The clean checkout is on the
one-word `canary` branch. Public DNSSEC validation and the route matrix are healthy: the app route
and direct SPA routes return 200; the bare app path canonicalizes; both outreach roots redirect
308 to `https://sambhavbuilds.com/`; unsubscribe roots return 404; and the portfolio returns 200.
A transient DNSSEC `SERVFAIL` observed during the rollout cleared without a configuration change.

- db/app/gateway/backup containers are healthy; only `127.0.0.1:18080` is published
- the 2026-08-31 deployment baseline was four healthy OAuth mailboxes, one global lead, two draft
  campaigns, and zero enrollments. A later separately authorized walkthrough added five
  operator-controlled leads across Atlas and Beacon and accepted 13 messages total; it also proved
  body-link unsubscribe, reply `STOP`, global suppression, and reply ingestion. No prospect was
  contacted. Inspect current live state before any operational action; do not infer it from the
  earlier dormant snapshot
- health and database checks pass; self-check is clean; projection dry-run is `0 diff(s)`
- migrations through `0019_personalized_copy_two_tiers` are applied; the 2026-08-31 pre/post dumps
  `coldemail-20260831-133754.dump` (1,042,810 bytes) and
  `coldemail-20260831-134549.dump` (1,043,586 bytes) passed `pg_restore --list`; the 0019
  pre-deploy dump
  `coldemail-20260830-181912.dump` (935,334 bytes) and post-deploy dump
  `coldemail-20260830-182500.dump` (948,884 bytes) passed `pg_restore --list`; the earlier 0018
  pre-deploy dump
  `coldemail-20260829-212720.dump` (799,599 bytes) and post-deploy dump
  `coldemail-20260829-213315.dump` (816,236 bytes) passed `pg_restore --list`; the local 0018
  scratch restore drill passed; Spaceship AutoBackup remains configured with a five-backup limit
- production Google OAuth credentials are configured on the VPS; never print or copy them
- the business postal address and unsubscribe template are configured; body-link confirmation is
  proven on an owner-controlled address. The 2026-09-02 owner-address canary verified the negative
  Gmail result: follow-up footer content is collapsed on desktop and mobile, and no native
  unsubscribe control appeared. The footer remediation is deployed; post-deployment Gmail
  verification remains pending, and RFC 8058 client one-click remains unverified

The Oracle bounded catch-up/never-burst canary passed on 2026-08-20 UTC and remains paused. The
accelerated settings were restored before the final deployment. Oracle is deployed on
`b8.3-local-canary` at `4e9e125` plus the later documentation-only wrap commit.

- `enforce_send_window=true`; `max_mailbox_daily_cap=50`
- `pause_min_sends=25`; `delivery_confirm_hours=1`; `send_jitter_pct=20`; `min_ramp_days=7`
- Both mailboxes are `ok`, have `daily_cap=5`, no `resume_cap`, and send Mon–Fri 10:00–18:00
- Both mailboxes poll `{INBOX,[Gmail]/Spam}`; keep that folder configuration
- Both controlled Gmail campaigns are paused; the catch-up campaign has four completed sends and
  four unsent enrollments that cannot run while it remains paused

The live catch-up evidence is four accepted owner-address sends in two paced waves, two per
mailbox, with a 925-second same-mailbox gap and a `catchup_backlog` alert after 10,833 seconds of
downtime. The post-deploy checks were clean: HTTPS/database health, self-check, `checked 24
enrollments — 0 diff(s)`, and a fresh validated backup. These results prove restart pacing, not
that any volume is safe. Finding 12's warmed-domain `List-Unsubscribe` question remains unanswered;
finding 11 is closed as unanswerable with this rig and must not be re-litigated.

## Damage-prone operational traps

- IMAP UIDs are folder-scoped. Cursors are keyed `(mailbox_id, folder)`. Changing `poll_folders`
  outside the API skips UIDNEXT seeding; seed `mailbox_poll_cursors` for every added folder in the
  same transaction or the next poll ingests that folder's entire history. Provider folder names
  differ (`[Gmail]/Spam` vs `Junk`).
- `enroll(campaign, count)` chooses tier A→B→C→untiered, oldest first; it does not preserve an
  intended set for legacy global campaigns. Pool-backed campaigns instead choose only their
  available pool by tier then allocation order and never fall back to global. Use `enrollByIds`
  when identities matter.
- Manual and automatic enrollment share the campaign's effective daily cap. Ramp stages transition
  to `steady_daily_enroll_cap`; after first activation that cap may be lowered but never raised.
  Shared room subtracts sent mail, due follow-ups, and unsent Step-1 opener reservations. Daily
  auto-enrollment is opt-in/pool-only, claimed once per application-local date, and never catches up
  missed quotas.
- The scheduler sends at most one message per mailbox per tick. Pace is
  `send_window_minutes / daily_cap`; ticking faster does not accelerate the cohort.
- `wait_days: 0` makes step 2 due as soon as step 1 lands. Pause after step 1 or the follow-up can
  outrun a human reply.
- A process that appends a send must start `Jobs`, or the delayed confirmation job is lost.
  `apps/server/test/ops/canary-drive.ts` and `canary-cohort.ts` write real state even when invoked
  as scripts.
- `delivery_confirm_hours` is immutable after the first `sent` event (API guard plus DB trigger).
- Unstarted work has no mailbox assignment and rotates normally. Started threads remain pinned;
  there is no redistribution function or pre-send redistribution claim.
- Public `/u/:token` routes stay outside session/CSRF. `GET` must never unsubscribe, one-click
  POST needs the scoped form parser, only token hashes are stored, and request logging must redact
  the URL without spreading the raw request or body. The token is a capability.
- Guardrails limit **configuration**, not behavior: values under a ceiling are permitted, not
  proven safe. Preflight is read-only and cannot establish warming, consent, or list quality;
  `ready` means only that nothing failed, and DKIM absence is `unknown`, never `fail`.
- `POST /leads` must continue through the same ingest preview/commit path as CSV so hygiene,
  deduplication, and the suppression re-check cannot diverge.

See `CLAUDE.md` for architecture and subsystem-specific engineering traps, and docs/17 for full
evidence, live outcomes, and the findings log.
