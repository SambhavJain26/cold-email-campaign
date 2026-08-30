# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file and [AGENTS.md](AGENTS.md) must stay aligned.** AGENTS.md is the canonical statement of the operating boundary, test discipline, Oracle procedure, and data-safety rules; the sections below reproduce it. When an operational instruction or durable current-state fact changes, edit **both** files in the same commit. On any disagreement between the two, AGENTS.md wins.

---

## Current operating boundary

Spaceship production infrastructure is live, but the project remains in **pre-prospect-send
commissioning**:

- **Approved build scope — the only feature work authorized:** the completed 2026-08-15 list (public unsubscribe/one-click, launch guardrails, domain-readiness preflight, per-folder polling, and single-lead creation) plus the operator-approved 2026-08-20 pre-domain safety backlog: mandatory reply stopping; reply dispositions and conservative suppression; guarded cross-campaign recontact; broader opt-out phrases; findings #20–25; alert history and mailbox filters; arbitrary custom-field editing; copy-risk rubric improvements; local verification; and runbook/documentation reconciliation. Outside that list, the rule is unchanged: testing, verification, diagnosis, and documentation only.
- **2026-08-25 implementation status:** the operator-approved ten-workstream run is complete and
  deployed through Stages 1–4: operational pagination; due-step Manual Compose; in-app reminders;
  verified timezone/folder controls; imported manual drafts; Auto Observation and namespaced
  sequence variables; activation-based staged ramps; later-step direct/eventual variant analytics;
  atomic multi-source cold-storage recycling with durable provenance; and the responsive/mobile
  redesign. The complete serial gate and restore drill pass, and Spaceship is pinned to the Stage 4
  commit. This does not authorize activation, production enrollment, or any send.
- **2026-08-30 production release:** exact import-to-campaign pools, durable pool management,
  opt-in idempotent/fair daily enrollment, strengthened shared opener reservation, and permanent
  post-ramp campaign caps are implemented, fully verified, and deployed on Spaceship at `6ca1183`.
  Production still has no campaigns or leads; deployment does not authorize activation,
  enrollment, or sending.
- The operator-approved Spaceship deployment, subpath support, sender-domain unsubscribe routing,
  and individual Google Workspace OAuth implementation are complete. Do not extend production
  scope or change DNS/Caddy/mailboxes outside the approved commissioning steps without fresh
  authorization.
- The public unsubscribe hosts, business postal address, and sender-domain unsubscribe template are
  configured. The production Gmail body link and one-click behavior still need the separately
  approved owner-address canary.
- Do not start a real cohort or send new external campaign mail without explicit approval for that specific send. This covers sending mail, activating or resuming a campaign, enrolling leads, altering live campaign state, and contacting prospects — each needs its own approval.
- The approved, controlled Gmail acceptance batch is complete. The test campaign is paused; do not resume it or create additional test sends without new, per-send operator approval. Read the runbook for the authoritative recipient, outcome, and verification record.
- The deployed production facts and remaining operator handoffs are recorded in
  [docs/16-deployment-ops.md](docs/16-deployment-ops.md) §8 and docs/17. The OAuth client, one
  account-matched OAuth mailbox, business address, and unsubscribe template are configured; do not
  call the production body link or one-click behavior proven until that live canary passes.
- **Never ask the operator to paste passwords, app passwords, `SECRET_KEY`/`SESSION_KEY`, or `.env`/`.env.prod` contents.** App passwords are typed into the Mailboxes screen and sealed with libsodium; secrets never belong in chat, logs, or the repo.
- Do not deploy unless the operator explicitly authorizes it (see Production deployments below).

## Read first

For operational or testing work, read, in order:

1. [docs/17-local-canary-runbook.md](docs/17-local-canary-runbook.md)
2. [docs/16-deployment-ops.md](docs/16-deployment-ops.md)
3. `git status` and recent `git log`

Treat the runbook as the **durable status record** — task chips and chat summaries are not persisted, it is. Update it only after an outcome has actually been verified: never leave a completed task labelled open, and never call a planned item implemented.

## Working rules

- **Keep this file current, and keep AGENTS.md in step.** When you learn something durable — a better approach, a good practice, a lesson from a mistake — add it here. When something here is outdated, remove it. Terse: facts only, no filler.
- **First inspect and report the current state before proposing changes.** For a question, explain the feature using the actual code/UI/data model rather than from memory.
- **Smallest safe implementation**, tested proportionally, with UI/database behavior verified where relevant. Update the runbook only for verified results.
- **Commit after every completed task**, on the current working branch (`canary`) — do not branch off or push to `main`, and do not merge to `main` without explicit authorization. Pushing to `origin canary` is fine; deploying is a separate, separately-authorized step.
- Make surgical patch-style edits and **preserve unrelated changes in a dirty working tree**.

## Test discipline

- Local Postgres and GreenMail: `docker compose up -d`.
- **Run DB-backed Vitest projects serially. Never run two DB-backed Vitest invocations concurrently** — they share `coldemail_test` and can corrupt/flap each other (a parallel run's truncates corrupt a long-running golden replay mid-flight).
- Fast iteration: `npx vitest run --project unit`.
- Important gates: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:golden`, `npm run test:mail`, and the relevant API/integration/web suites.
- Projection drift check — use this exact command: `npx tsx apps/server/src/services/rebuildCli.ts --dry-run` (exit 1 on drift). Verify **zero diffs** after any change affecting events or projections.
- The 2026-08-25 frontend-only pagination/settings UX hotfix passed type/lint/format, web 57,
  mock E2E 60, real-backend E2E 1, and a production Vite build. It changed no event, projection,
  migration, scheduler, or mail-transport behavior.
- The 2026-08-30 campaign-pool gate passed type/lint/format; unit 342; web 58; integration 167;
  API 130; GreenMail 29; golden exactly 47; mock E2E 60; real-backend E2E 1; migration 0018
  apply/down/apply; populated five-enrollment zero drift; clean self-check; and scratch restore.
  Concurrent daily claims and a timezone change that moves the local date backward are covered.

## Production deployments

Spaceship is the primary live deployment. Oracle remains paused and unchanged as the temporary
rollback/canary environment.

### Spaceship production

- SSH alias: `sambhavbuilds-vps` (`root@104.207.93.174`, port 22022)
- App directory: `/opt/email-campaign`
- Stack: `docker-compose.spaceship.yml` with `.env.prod`
- UI: `https://sambhavpmtech.com/email-campaign/`
- Internal gateway: `127.0.0.1:18080`; host Caddy alone owns public 80/443
- Deployed branch: `canary`; application code remains `6ca1183` with later documentation commits

The private repository currently has no GitHub deploy credential on the VPS. Until a read-only
deploy key is deliberately installed, transfer a reviewed `git bundle`, fetch the pinned branch
from it, and fast-forward locally; a non-interactive GitHub pull will fail. Deploy only with
explicit authorization:

```sh
cd /opt/email-campaign
sudo docker compose -f docker-compose.spaceship.yml --env-file .env.prod build
sudo docker compose -f docker-compose.spaceship.yml --env-file .env.prod up -d
```

Verify containers, public health/routing, projection dry-run, self-check, and a validated backup.
Never print `.env.prod`, resolved Compose output, container environment, or backup crontab.

### Oracle rollback canary

- SSH: `ssh -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`
- App directory: `~/app`
- Stack: `docker-compose.prod.yml` with `.env.prod`
- UI tunnel: `ssh -L 8443:localhost:443 -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`, then open `https://localhost:8443`
- Deployed branch: `b8.3-local-canary`

Deploy **only** when the operator explicitly authorizes it. The standard deploy command is:

```sh
cd ~/app && git pull --ff-only
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

After an authorized deploy, verify container health, `https://localhost/health`, and a zero-drift projection dry run inside the app container. Do not expose credentials or `.env.prod` contents.

> **Never print resolved production env in shared output.** `crontab -l` on the backup sidecar embeds `DATABASE_URL` including the Postgres password in plaintext (this already forced one password rotation — docs/17 §1); print the schedule only. `docker inspect` and `docker compose config` render resolved env too.

## Implementation and data safety

- **Preserve the append-only event ledger; never delete or rewrite sent/event history.** This is enforced physically (a trigger blocks UPDATE/DELETE and `app_rw` lacks the grants) — do not route around it.
- Do not erase user data, change live campaign state, or create sends merely to test behavior.
- Keep outbound email simple, compliant, and untracked — no pixels, click tracking, or tracking-domain redirects. `STOP`/unsubscribe remains globally suppressive once a valid unsubscribe fact is recorded.

---

## Current state: Spaceship deployed, commissioning incomplete

**2026-08-09 correction (still governing):** live canary operation exposed **code** remediation, not just operations. The earlier claim that all remaining work is "operations, not code" was wrong. Findings #3–9, #14–16, and #19 were completed on `b8.3-local-canary`.

**Where B8.3-local stands (see docs/17 for the authoritative evidence):**

- **Remediation closed and locally verified:** findings #3–9 (blocker visibility; mailbox send-window days/times + required IANA per-mailbox timezone; campaign archive/delete + safe sequence delete with typed confirmation; typed-email PII erasure; explicit Tier-A manual-mode acknowledgement), #14 (transparent cold-email cliché rubric over subject *and* body — a warning rubric, not a deliverability predictor), #15 (the reply/send race — enrollment lock + send-time projection re-read inside the append transaction, poll cron staggered off the tick), #16 (IMAP cursor initialized from UIDNEXT so connecting a mailbox no longer ingests years of history), #19 (matching plain-text + minimal escaped HTML parts, verified by GreenMail).
- **Controlled live-provider gate completed 2026-08-14** on owner-operated Gmail only. Campaign *Gmail Learning Canary - Aug 2026* / sequence *Gmail Learning Canary - Gate 1*: two approved sends, one normal reply → `REPLIED`, one `STOP` → `human_reply` + `unsubscribe` (`matched_keyword: "stop"`) → `UNSUBSCRIBED` + global suppression. Delivery confirmation, UI analytics/outcomes, and DB projections all verified. **The campaign is paused** to prevent accidental enrollment. No prospects, real-domain mailboxes, DNS, or production-domain work.
- **Final canary wrap completed 2026-08-21:** the bounded owner-address catch-up scenario accepted four sends in two paced waves (two per mailbox, 925-second same-mailbox gap) after 10,833 seconds of app downtime and emitted `catchup_backlog`. The campaign was paused at the bound. Accelerated settings were restored, both mailboxes are healthy at cap 5 with no resume cap, and both Gmail test campaigns are paused.
- **Oracle rollback canary:** `4e9e125` plus its documentation-only wrap; both campaigns remain
  paused. Health, self-check, backup, and `checked 24 enrollments — 0 diff(s)` are clean.
- **Spaceship production:** deployed 2026-08-22 and advanced through the verified
  campaign-pool/auto-enrollment/permanent-cap release `6ca1183` on 2026-08-30. It has four
  `google_oauth` mailboxes in `ok` state and zero campaigns/leads/enrollments, available pooled
  leads, auto-enrollment-enabled campaigns, active campaigns, or sendable enrollments. DNS, TLS,
  the `/email-campaign/` SPA/API subpath, outreach
  redirects, and the two isolated unsubscribe hosts are live. Containers and health are green;
  migration 0018, self-check, and zero drift pass; both deployment dumps passed catalog validation
  and the local scratch restore drill passed; Spaceship AutoBackup has a five-backup limit. The
  portfolio remained online.
- **2026-08-30 branch transition:** after explicit operator approval, local/GitHub and Spaceship
  moved to the one-word `canary` branch. Spaceship was rebuilt from documentation wrap `0299e42`;
  migrations, routes, self-check, zero drift, dormant state, and fresh backups all passed. The
  application code remained `6ca1183`; Oracle and `main` were unchanged.
- **Still open, deliberately:** obtain separate authorization for the one-message owner-address
  send/reply/unsubscribe canary. The business address, sender-domain unsubscribe template,
  production Internal Google OAuth credentials, and four account-matched OAuth mailboxes are
  configured.
  Finding #12 still needs warmed-domain evidence; provider DSN/OOO fixture capture remains deferred.

**Build history:** M0 (docs), **B0–B7** (foundation → event log → metrics → mock transport/scheduler/poller → render → ingest → API layer → hardening/ops), **F0–F8** (full web track) and **B8.1–B8.2** (live `SmtpImapTransport` + the `MAIL_TRANSPORT` flag swap) are complete — **M1 proven core** ✅, **M2 operable workflow** ✅, **M3 full product (offline)** ✅. A post-M3 audit against docs/14/15 + the decision register (2026-07-25) closed the four specified-but-unbuilt items — decision E, `provider_blocked`, runtime mailbox poll registration, the password-reset CLI (sweep facts below). **Check [PROGRESS.md](PROGRESS.md) for the current task pointer before starting work** — but note its "no code work is outstanding" framing predates the 2026-08-09 correction.

Dev loop assumes: Node ≥22, Docker running (`docker compose up -d` → Postgres 16 on port **5433**; `greenmail` for the mail suite), `.env` copied from `.env.example` (generated keys). Prod stack: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` (B7.5). Real-backend e2e: `npm run e2e:real -w @coldemail/web` (boots server SIMULATED_CLOCK + web real-mode; needs Docker Postgres).

Seams to know about: `SequenceProvider` (DB-backed `DbSequenceProvider` in prod composition; tests inject `StaticSequenceProvider` via the `sequences` compose override), `Renderer` (`render/engine.ts` — pure/sync; the CALLER loads `RenderContext`: mode, custom_fields, auto_observations, compliance row, threadSubject), `JobPort` (scenario inline queue in tests; pg-boss in prod). The scenario runner (`apps/server/test/helpers/scenario.ts`) is the integration-test entry point: real scheduler+poller+eventStore over MockTransport+VirtualClock.

B4 facts that bite: the renderer ECHOES `variant.contentHash` (hash computed at variant-SAVE time via `render/hash.ts` — decision Q), so fixture hashes like `'sha-stepN'` stay stable across template edits. Empty `compliance_settings.physical_address` refuses ALL sends (`compliance_missing_address` alert) — `resetCoreTables` seeds a test address; blank it explicitly to test the guard. Soft-retries pin the ORIGINAL variant (round-robin would change the resent text). In-thread follow-ups re-render the step-1 subject for `Re:` from the first sent event's `attributes.variant_id`. Fatal pre-send checks → `render_failed` outcome: nothing appended, enrollment stays due. Automated and manual mail now carries **matching plain-text and minimal escaped HTML parts** (finding #19) with a small but legible compliance footer — a change to one part must change the other.

Sweep facts that bite (2026-07-25): **decision E is live** — `SentimentSuggester` port (`sentiment/types.ts`) + `AnthropicSentimentSuggester` (official `@anthropic-ai/sdk`), composed iff `ANTHROPIC_API_KEY` is set; it writes `incoming_messages.suggested_sentiment` ONLY (the `human_reply` event's sentiment stays null until `sentiment_tagged` — decision M), skips STOP replies, and returns null on every failure. Thinking is DISABLED on that call on purpose (it's on by default on the current model and shares `max_tokens`). eslint bans importing the adapter outside composition. **`provider_blocked` is now reachable**: 5 consecutive THROTTLE answers (`scheduler/providerBlock.ts`) → provider_blocked + alert + redistribution; any non-throttle failure in the run → the old `paused/smtp_failing`. The MockTransport's default transient text (`421 4.7.0 try again later`) IS a throttle string — scenario tests that want smtp_failing must pass `onSend(..., {outcome:'smtp_transient', error:'451 4.3.0 …'})`. **`Jobs.registerMailboxPoll` must be called by the routes** (create + auth_failed→ok reconnect): boot only registers the mailboxes that exist then, so a UI-added mailbox would otherwise never be polled; it is idempotent and a no-op before `start()`. `npm run operator:set-password -w @coldemail/server -- --password '…'` (or `NEW_PASSWORD=…`) is the locked-out recovery path. `ROLE=worker` no longer listens on HTTP.

B8 facts that bite: `SmtpImapTransport` (`transport/smtpImap/`) gets host/credentials/UID-high-water from an injected `MailboxConnectionProvider` (transport/ may not touch the DB) — `DbMailboxConnectionProvider` unseals the password per call, so a reconnect takes effect without a restart (the SMTP pool is keyed by a credential signature). **IMAP's `UID FETCH n:*` returns the LAST message when `n` is past the highest UID** — `fetchNew` MUST filter `uid > lastPollUid` client-side or every poll re-delivers the newest message. **A new or legacy-zero `last_poll_uid` is initialized from UIDNEXT** at create/reconnect (finding #16) — a zero default would ingest the mailbox's entire history (12,581 messages back to 2022 on the real canary). **mailparser puts the `message/delivery-status` part in `attachments`, not `text`** — `parse.ts` rebuilds `bodyText` from both parts or every DSN is unparseable. Unknown SMTP errors classify TRANSIENT on purpose (never terminal a lead on a guess); 5xx at RCPT/DATA (`EENVELOPE`/`EMESSAGE`) is recipient-scoped, everything else 5xx is mailbox-scoped. A late ImapFlow connection-close event could restart the worker — fixed in `5ae3265`. Test rig = **GreenMail in Docker** (`docker compose up -d greenmail`; `npm run test:mail`): user spec must be `<email>:<password>` so the login is the full address; auth is deliberately NOT disabled; `POST :18080/api/service/reset` purges between tests; the image has no curl/wget/nc (healthcheck uses bash `/dev/tcp`). GreenMail accepts EVERY recipient, so a 5xx-recipient rejection can only be proven at the real canary.

Live-operation facts that bite (B8.3-local): **`scheduler-tick` and `imap-poll-*` used to share `*/5 * * * *`**, so a reply and its follow-up could interleave 193 ms apart with `stop_on_reply = true`. The offline suites structurally cannot catch this — the scenario runner drives jobs through an inline queue, so poll and tick never run concurrently. Fixed by an enrollment lock + a send-time projection re-read inside the append transaction, plus a staggered poll cron; keep both. **Reply stopping is per sequence** — with `stop_on_reply` disabled a human reply records metrics while later steps stay active; hard bounces and STOP/unsubscribe always end sending. `contacted` is the distinct-lead union of `delivered` and `human_reply` (a reply can precede its confirm window). Scheduler blockers are **database-backed episodes** so a worker restart cannot duplicate their alerts. Same-value `sentiment_tagged` is server-idempotent and the selected UI tag is disabled — genuine retagging still appends a new fact. A one-off operational script that appends a send **must start `Jobs`**, or the delayed confirm-delivery job is silently never scheduled (this happened live; the missing job had to be restored by hand). Canary evidence queries must group sends by the dedicated `events.mailbox_id` column, not `attributes.mailbox_id`; the latter produced a false burst failure during the final wrap. In the production backup container the executable is `/usr/local/bin/backup.sh`, not `/backup.sh`.

Guardrail / preflight / folder facts that bite (0011–0012): **launch guardrails are ceilings on CONFIGURATION, not on behaviour** — `max_mailbox_daily_cap` (50) is checked on mailbox create AND patch; every draft campaign ramp-stage save is checked against `max_ramp_daily_enroll_cap` and `min_ramp_days`; `min_ramp_days=0` means not enforced and preflight reports that as not-launch-ready. The **preflight's DNS resolver is an injected port** (`services/preflight.ts` + `services/dnsResolver.ts`, wired in composition, `dns` on `AppServices`) so the report is unit-testable offline — **DKIM reports `unknown`, never `fail`**, because selectors cannot be enumerated over DNS and a miss is not evidence of absence. **IMAP UIDs are FOLDER-scoped** (0012): `mailbox_poll_cursors` is keyed `(mailbox_id, folder)`, `IncomingMessage.folder` is what the poller advances against, and `MailboxConnection.folders` replaced `lastPollUid` — treating a cursor as mailbox-wide is a bug. `mailboxes.last_poll_uid` is RETAINED (not dropped) purely so 0012's backfill is reversible. Folder discovery validates selected names, and every newly selected folder seeds from its OWN UIDNEXT in the save transaction (finding #16 applies per folder — adding Spam later would otherwise ingest that folder's whole history). `POST /leads` (finding #10) builds a one-row CSV and runs the SAME `createImportPreview`+`commitImport` as an upload in `drop_flagged` mode — never reimplement hygiene there; the cost is one `imports` row per lead, kept deliberately.

Canary-operation facts that bite (2026-08-16 §3 cohort): **`enroll(campaign, count)` picks leads by its OWN ordering** (tier A→B→C→untiered, oldest first) — it does NOT take your intended set, so a cohort built by count silently enrols the wrong leads; use `enrollByIds` when the set matters. **The scheduler sends at most ONE message per mailbox per tick** (`attempted` set) and the pace gap is `send_window_minutes ÷ daily_cap`, so driving a cohort fast means raising the cap, not ticking harder. **With `wait_days: 0`, step 2 is due the instant step 1 lands** — pause the campaign after step 1 or the follow-up outruns any human reply. **`capture-fixture` had never successfully written a fixture** before 2026-08-16: its leak guard flagged its own placeholders, quoted-printable soft breaks hid addresses from both the scrub and the guard, and Message-IDs were rewritten into address shapes. Its pure parts are now unit-tested (`test/unit/capture-fixture-scrub.test.ts`) — the tool talked only to live IMAP before, which is exactly how it stayed broken.

Unsubscribe facts that bite (0010, docs/16 §8): the feature is **dormant unless `compliance_settings.unsubscribe_base_url` is set** — empty means no link, no headers, footer falls back to `optout_text`. `GET|POST /u/:token` register **outside `/api/v1`** (like `/health`) so they inherit neither session nor CSRF — Gmail's one-click POST carries neither, and it sends `application/x-www-form-urlencoded`, for which **Fastify registers no parser by default** (without the scoped parser the button 500s, invisibly, at Google). **Fastify's default request logger serialises the full URL and the token IS the URL** — `config/logger.ts` has a `req` serializer that redacts `/u/<token>`; it must emit the default `{method,url,host,remoteAddress,remotePort}` shape and **never spread the raw request**, which carries parsed bodies (B7.1's sentinel grep catches that). Tokens are minted **per send attempt**, not per enrollment: only the sha256 is stored, so a raw token is unrecoverable and a soft-retry mints a fresh one — every token for an enrollment stays redeemable. Tokens are deliberately NOT derived from `SECRET_KEY` (rotation would kill the link in every delivered email). `GET` must never unsubscribe (scanners prefetch); an unknown token renders the SAME page as a valid one (no enumeration oracle). `UNSUBSCRIBE_SOURCES` already contained `'link'`, so the event needed no contract change. Footer shape is now `{opt-out clause} | {address}` on one line, and **both representations live in `render/footer.ts`** (`appendFooter` + `footerHtml`) so text and HTML cannot drift (finding #19).

Real-backend e2e facts that bite (docs/13 §5): the SIMULATED_CLOCK server scripts its MockTransport over HTTP via the `ScriptableTransport` seam (`transport/types`) — `POST /system/{script-inbound,script-send-outcome,script-verify}` map to `MockTransport.synthesizeInbound`/`onSend`/`onVerify` through `SimulationDriver`; routes register ONLY under SIMULATED_CLOCK (inline zod, not the contract). `synthesizeInbound` threads reply/ooo onto the last accepted send to `to` (null if none yet — script inbound AFTER the send-producing advance). `playwright.real.config.ts` boots app :3001 (migrate → `test/ops/e2e-reset.ts` truncate+reseed → boot) + web :5174 real-mode; `api()` helper hits the real backend through the browser session (`x-requested-with` CSRF). **Two traps:** advance-THEN-read a completion loop (a straggler COMPLETES a tick after its confirm window); and a null-sentiment REPLIED lead is UNCOUNTED in the Stage-9 outcomes split — pick unibox cards by unique reply text, never `.first()`.

B7 facts that bite: `SECRET_KEY` rotation is `rotateSecrets` (`services/rotateSecrets.ts`, CLI `npm run rotate-secrets -w @coldemail/server -- --new-key <hex>`) — decrypt-with-old + re-seal-with-new for ALL `mailbox_secrets` in ONE `db.transaction`; unseal throwing on a wrong old key aborts the whole tx (never commit a half-rotated set). The no-secret-in-logs proof (`test/api/secret-redaction.test.ts`) captures the app's log stream at `trace` and greps for sentinel passwords/keys — logger redaction (`config/logger.ts`) is defense-in-depth, the real guarantee is never passing secrets to log calls. `createApiHarness` takes an optional 3rd arg `{destination, level}` for log capture (default silent/`error`). Backups: `scripts/backup.sh` (`pg_dump -Fc` → `$BACKUP_DIR`, 14d/8wk retention) + `scripts/restore-drill.sh` (dump→restore→`rebuild-projections`→`--dry-run` 0 diffs→`self-check` 0 violations, gated in CI via `test/ops/seed-golden.ts`). `self-check` CLI (`services/selfCheckCli.ts`) is shape-independent. Two scheduled integrity jobs (`jobs/integrity.ts`, wired in `jobs/index.ts`): daily `runSelfCheckJob` (invariants + backup-freshness: newest `$BACKUP_DIR/coldemail-*.dump` >26h old → alert) and weekly `runRebuildCompareJob` (dry-run diff → alert); both emit `selfcheck_drift` (kind is `z.string()` in shared, so payload `check: invariants|backup_stale|rebuild_compare` needs no contract change). **`loadCampaignShapes(db, sequences, softRetryMax)` replaced the `lastStepNo: Infinity` stub** in `rebuildCli`/`system.ts`/the compare job — completion is now shape-derived per campaign (sequence-less → Infinity fallback). A lead past its last step with the confirm window elapsed FOLDS to COMPLETED (`terminal_at = last sent + deliveryConfirmMs`); hand-seeding it ACTIVE now shows as rebuild drift.

B6 facts that bite: routes validate with the SHARED zod schemas via hand-rolled validator/serializer compilers (`api/plugins/zodCompilers.ts`) — responses are RE-VALIDATED at serialization, so a contract-violating response is a 500 (`.strict()` everywhere; that's also the no-secret-leak tripwire). Zod-4 ZodError doesn't extend Error → `RequestValidationError` carries request failures to the errorHandler. Raw `db.execute` bypasses drizzle's column mapping — timestamptz come back as STRINGS (format ISO in SQL via `to_char … AT TIME ZONE 'UTC'`). Sequence saves: replace-set is literal only at zero sends; after sends dropped variants RETIRE (active=false) and steps can't be deleted/renumbered (`SequenceEditConflictError` → 422; docs/10 footnote ¹). `GET /leads?state=` filters **enrollment** state via EXISTS (scoped to the same enrollment when `campaign_id` is supplied), NOT the postal `leads.state` column — finding #17, where a green api suite had frozen the wrong reading. The API test harness (`test/api/helpers/app.ts`) rebuilds Cookie headers from the RAW Set-Cookie segment (res.cookies decodes secure-session's `payload;nonce`). `SIMULATED_CLOCK=true` swaps in VirtualClock + inline jobs + `POST /system/advance-clock` (mock builds only; boot refuses otherwise). The B2.18 fixtures are byte-locked to the API by the golden-parity suite — regenerate via `npm run golden:export` ONLY together with a deliberate contract/schema change, in the same commit; the parity fixture is **real-data-only**, so mock-only relationships and the Mode-1 demo campaign belong in the mock DB, never in it.

F8 facts that bite: the shadcn `ui/dialog.tsx` primitives must be `forwardRef` — on React 18 Radix forwards a ref into Overlay/Content/Title/Description/Trigger/Close and a plain function component drops it (console warning on every dialog); same conversion as input/textarea/button (F1). Mock state mutations must keep the analytics fixtures INTERNALLY consistent — a positive tag moves both the campaign total AND `db.steps`, or the reconciliation footer correctly renders ✗. The frontend walkthrough replay (`e2e/journey.spec.ts`) is a single-session, in-app-nav-only journey; the REAL-backend replay (docs/13 §5, server + MockTransport + advance-clock) is a B7 deliverable and is what closes M3.

F7 facts that bite: `/analytics/variants` is SEQUENCE-scoped while every other analytics route is campaign-scoped — the Variants tab needs its own sequence picker (the golden campaign has `sequence_id: null`). Sent **manual-send** variants appear as clearly labelled read-only analytics rows and must stay out of the editable A/B deactivation decision (the sequence builder intentionally hides those historical artifacts). "Engaged Tier-C" = `{tier:'C', state:'REPLIED', campaign_id}` passed as a bulk-tier FILTER, never an id list. The campaign outcomes split is mutually exclusive: its `neutral` field means the **neutral/negative/untagged non-positive remainder**, not just explicitly-neutral sentiment — narrowing it makes terminal replies vanish from the sum. The reconciliation footers (`features/analytics/reconciliation.ts`) compare each table's own sum against the overview's campaign figure and render ✗ on drift — they are a free self-check, so don't "fix" a ✗ by loosening the comparison.

F6 facts that bite: optimistic unibox updates must patch BOTH shapes cached under `['unibox', …]` — the paginated list and the thread-view detail row (`patchUniboxCaches` in `api/mutations/unibox.ts`). `POST /unibox/:id/sentiment` returns the updated **item** (`uniboxItemSchema`), not `{ok:true}` — parsing it with `okResponseSchema` toasted "request failed" on every success and drove seven undeletable duplicate `sentiment_tagged` events (finding #18). Seeding a form from fetched data needs a QUERY plus a `key`-remounted child (`useSequencePreview` + the composer form) — the builder's button-triggered preview mutation can't do it without setState-in-effect. In mock-mode e2e, `page.goto()` REBUILDS the MSW state from fixtures: any assertion that spans screens (tag → Overview rate) must use in-app nav links.

F5 facts that bite: campaign effort, Auto Observation rules, sequence-variable overrides, and ramp stages are editable only while the campaign is `draft`. First activation snapshots resolved variables, fixes `first_activated_at`, and permanently freezes personalization/ramp configuration; pause/resume never restarts or unlocks it. The default staged caps are days 1/2/3/4/5–7 = 5/8/10/12/15, after which `steady_daily_enroll_cap` applies (default 15). That cap may be lowered after activation but never raised. Components shared by two features (`EnrollPanel`, `CatchupBanner`) must live in `components/shared/` — the eslint rule forbids `features/*` importing each other. The catch-up never-burst copy appears in BOTH the alerts bell and the banner, so any e2e asserting it must scope to one of them.

Pool/auto-enrollment facts that bite (0018): the first pool allocation permanently changes a
campaign's selector from `global` to `pool`; an empty/ineligible pool must never fall back. Pool
allocation is not enrollment and does not consume capacity. Import allocations are exact and
serializable: preview/commit drift aborts leads, drafts, and reservations together. Manual drafts
reserve first inside—not in addition to—the requested campaign count. Enrollment row, projection,
append-only `enrolled` event, and pool consumption share the EventStore transaction. Manual and
automatic enrollment use one advisory capacity lock and the same effective cap; shared room also
subtracts unsent Step-1 opener reservations. Daily auto-enrollment is opt-in, pool-only, claimed by
application-local date, and deliberately never accumulates downtime quotas. Fairness resumes after
the persisted last-served campaign.

F4 facts that bite: the builder's `step_no` is POSITIONAL — `toWriteBody` stamps index+1 at save (`features/sequences/draft.ts`), and retired variants (`active:false`) must stay in the draft: omitting them from a replace-set save DELETES them at zero sends. There is no GET /sequences/:id in the contract — the builder finds its row in the list response. Sequence variables use `{{sequence.key|fallback}}`; defaults belong to the sequence, draft campaigns may override them, and first activation freezes the resolved snapshot. Values are literal and never recursively parsed. Preview renders SAVED templates (unsaved edits are not previewed), supports sequence-default or campaign context, and shows the resolution trace. The panel splits the footer off the body at the engine's final blank line (`\n\n`) — always split from the end so earlier message paragraphs remain body content. `variations` = subject × body spintax counts (`variationCount` multiplies both parses).

F3 facts that bite: `POST /auth/login` returns `{ok:true}` (the session cookie carries identity) — NOT `{email}`; `/auth/me` is the only identity source. The dev-DB operator is seeded ONCE by `ensureOperator` at first boot; editing `OPERATOR_INITIAL_PASSWORD` in `.env` afterward does nothing (the stored argon2 hash stays), so a full real-mode login needs a reseed (delete the `operator` row or the DB). To seed a component's local state from a fetched row without setState-in-effect (banned by the react-hooks compiler rule), lift the editable piece into a child component and `key={row.id}` it so a new identity remounts with fresh `useState` initializers. Leads tier totals come from per_page=1 probes of `/leads?tier=X` (no counts meta in the contract) — they can't drift from the list.

F2 facts that bite: mutation-level `onSuccess` must NOT return the `invalidateQueries` promise — React Query awaits it before per-call callbacks, and if the refetch unmounts the calling component (failure panels that disappear on success), the caller's `mutate()` callbacks are silently skipped. Convention: `onSuccess: () => void qc.invalidateQueries(…)`. The react-hooks compiler rules (eslint) ban setState-inside-useEffect and ref-access-during-render — reset dialog-local state in event handlers (onOpenChange), track cross-component dirty state with guarded useState, not refs.

F1 facts that bite: the shadcn registry now emits **React-19-style components (ref as a prop)** — on React 18 those refs are SILENTLY dropped (RHF `register()` sees `undefined` for every field; Radix `asChild` anchors lose their node). `ui/input.tsx`, `ui/textarea.tsx`, `ui/button.tsx` are converted to `forwardRef` — do the same for any newly-added primitive that receives external refs. Campaign context = URL `?campaign=` (read via `useCampaignParam()` from `components/layout/campaign-selector.tsx`; AppShell NavLinks preserve it) — the selector must **not** clear a valid deep link while the campaigns query is still loading, or Overview/Leads/Analytics silently switch to the first campaign. Mutation failures already toast globally (MutationCache in `queryClient.ts`) — don't double-toast in screens; e2e asserting an error message must scope to `role=alert` or the toast region or strict mode trips on the duplicate.

F0 facts that bite: `apps/web` runs mock-first — MSW serves the full docs/10 contract from golden-fixture-derived state (`src/mocks/db.ts`); `VITE_API_MODE=real` disables the worker and proxies /api→:3001 (server PORT default). Mock session persists in sessionStorage `mock:auth`; failure fixtures (mailbox 3 auth_failed, 4 auto_paused, catchup alerts) toggle via localStorage `mock:failures`='1' — both read at db-build time, so toggling needs a reload. ALL server calls go through `api/client.ts` (zod-parses every response with the shared schema — client-side decision-H tripwire; 401 → central redirect, `skipUnauthorizedHandler` for /auth/me + login). Visible operational data refreshes every 30 seconds and operator actions invalidate dependent live views immediately. Version locks (decision S): react-router-dom **6** (not 7), recharts **2**, React **18**. jsdom tests: RTL auto-cleanup needs vitest globals (off) — setup.ts calls `cleanup()` per test; Radix dialogs leave `pointer-events:none` on body — setup scrubs it, and user-event inside open dialogs needs `pointerEventsCheck: 0`. Playwright: fresh contexts start logged out; never addInitScript-clear the session (re-runs on every navigation).

B5 facts that bite: `listDue` only serves enrollments of `campaigns.status='active'` — a draft recycle target stays silent until activated; test campaigns must be inserted `'active'`. `imports.counts.ok` is the IMPORTABLE-CLEAN display number (ok-flag + missing_first_name) per docs/03's example — row flags stay disjoint. `invalid`/`suppressed` rows are never imported under either commit mode, and suppression is re-checked at commit time. Ingest alias-map keys are the POST-snake_case header form ('e-mail' → 'e_mail'). Recycle's hash guard blocks the WHOLE action (`RecycleSequenceConflictError` lists offending steps); nurture is excluded from all bulk enrollment paths.

## Where to look first

- **[docs/00-INDEX.md](docs/00-INDEX.md)** — the map of all documentation and the reading order. Start here.
- **[docs/17-local-canary-runbook.md](docs/17-local-canary-runbook.md)** — the durable status record for the current phase, including the findings log (§0) that every remediation traces back to.
- **[PROGRESS.md](PROGRESS.md)** — task IDs (B0.1, F3.2, …) and checkboxes. **Tick tasks here as you complete them and add a dated log entry.** Task definitions live in [docs/14-build-stages-backend.md](docs/14-build-stages-backend.md) (backend B0–B8) and [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md) (frontend F0–F8).
- **[docs/01-decisions.md](docs/01-decisions.md)** — the decision register (A–Z, all locked). Before changing an architectural choice, edit this file first with the rationale. Decisions marked 🔧 are meant to be flipped via config/settings; 🔒 require a documented change here.

The three root design docs (`build_plan.md`, `event_model_spec.md`, `campaign_walkthrough_v2.md`) define *what* the system is. The `docs/` folder defines *how* it gets built. When code and docs disagree, treat it as a bug in one of them — reconcile, don't silently diverge.

## What this product is

A single-operator cold-email campaign tool for one freelancer on one always-on VPS (not multi-tenant SaaS). It sends sequenced cold emails across a few warmed mailboxes within safe daily caps, detects replies/bounces/opt-outs via IMAP, and reports a small set of zero-cost metrics. The hard parts are (a) correctness of the event/state/metrics model and (b) robust SMTP/IMAP handling.

## The one architectural idea everything rests on: event-sourced-lite

Read [docs/04-domain-events-state.md](docs/04-domain-events-state.md) and [docs/03-database-schema.md](docs/03-database-schema.md) before touching domain logic. The model:

- **The `events` table is the only source of truth.** It is append-only — enforced physically (a trigger blocks UPDATE/DELETE, and the app's DB role lacks those grants). Never design a feature that mutates a past event; append a new one.
- **Lead state is a projection**, derived by folding a pure reducer `applyEvent(state, event) → state` (in `apps/server/src/domain/`, no I/O) over an enrollment's events. Terminal-state precedence is `UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED`. `meeting_booked` is a milestone flag, not a state.
- **Metrics are queries** over the log, each with an exact numerator/denominator ([docs/05-metrics-and-analytics.md](docs/05-metrics-and-analytics.md)). The denominator law is load-bearing: **campaign bounce rates ÷ distinct leads sent-to (Part 10's 18÷885); reply/positive/unsub/meeting rates ÷ `contacted` leads** (contacted = the distinct-lead union of `delivered` and `human_reply`, never `sent`). Per-mailbox auto-pause windows count send *events* (Part 11) — a different metric.
- **The state machine lives on `enrollments`, not `leads`** — a lead can be `COMPLETED` in Pass 1 and `ACTIVE` in Pass 2. This per-campaign state is what makes recycling work.
- All writes go through **one transactional chokepoint** (`eventStore.append`): it appends the event(s) *and* updates the affected projections in a single Postgres transaction. Nothing else writes `events` or `enrollments.current_state`. Concurrency guards (the reply/send race, finding #15) belong here too.
- `rebuild-projections` replays the whole log to reconstruct every projection — this is both disaster recovery and the correctness audit. If a projection ever drifts from the log, rebuild.

### Two abstractions that let the whole system be built and tested offline

Everything before Stage B8 runs with **no real email**. This is deliberate and is the reason the staging works:

- **`MailTransport`** interface — all email I/O goes through it. `MockTransport` (scriptable, deterministic Message-IDs, synthetic inbound with *real* header shapes) is used through B7; `SmtpImapTransport` (nodemailer/imapflow/mailparser) is wired in only at B8. Swapping them is a one-line change in the composition root (`MAIL_TRANSPORT=mock|smtp_imap`). Nothing downstream knows which is active.
- **`Clock`** interface — `SystemClock` in prod, `VirtualClock` in tests. Multi-day sequences (0/3/4/5-day waits, midnight cap resets, stale-poll timers) are tested by fast-forwarding virtual time so a full ~49-day campaign runs in milliseconds.

**What these abstractions structurally cannot catch:** anything that depends on two real pg-boss workers running concurrently on real crons (finding #15), and each provider's own DSN/OOO wording. That is what the canary is for.

## The golden cohort — the load-bearing regression test

The spec's Part 10 defines a fully reconciled **885-lead cohort** (terminal outcomes 40/18/47/780; reply 8.3%, positive 3.2%, unsub 4.6%, hard-bounce 2.0%, 17 meetings). It is a locked regression at three levels: raw events (B1), metrics (B2), and full pipeline through the mock transport + virtual clock (B3). These tests are tagged `@golden` and **must never be skipped** — if a change turns them red, the math stopped closing and that is the signal, not noise. See [docs/13-testing-strategy.md](docs/13-testing-strategy.md).

## Build order and the contract seam

The build is **contract-first and two-track**. [docs/10-api-contract.md](docs/10-api-contract.md) is the frozen seam between backend and frontend; its executable form is the Zod schemas in `packages/shared` — **a contract change edits both the doc and that package in the same commit.**

- Backend (B0–B8) front-loads correctness: event log + state machine (B1) → metrics (B2) → mock transport + scheduler + poller (B3, *core complete here*) → render/compliance (B4) → ingest (B5) → API (B6) → hardening (B7) → real transport (B8).
- Frontend (F0–F8) builds against MSW mocks fed by golden-cohort fixtures (exported by task B2.18), and integrates against real routes as each B6 group lands. Dependency matrix at the bottom of [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md).

## Planned tech stack (see [docs/02-architecture.md](docs/02-architecture.md))

npm-workspaces monorepo: `apps/server` (TypeScript/Node ≥22 — dev on 24, Fastify, Drizzle ORM, pg-boss jobs), `apps/web` (React 18 + Vite + Tailwind + shadcn/ui + TanStack Query), `packages/shared` (Zod DTO schemas — the runtime form of the API contract). PostgreSQL 16 only — **no Redis, no broker**; background work (scheduler tick, IMAP polls, confirm-delivery, self-check) runs as pg-boss jobs in the same Node process (`ROLE=all|api|worker`).

### Module boundaries to respect (`apps/server/src/`)

`domain/` is pure — it imports nothing from db/api/transport and never reads the wall clock. `db/repos/` is the only place SQL/Drizzle lives. `scheduler/`, `poller/`, `render/`, `ingest/`, `services/` depend on `domain` + `db/repos` + the *interfaces* `transport/types`, `clock` and `sentiment/types` — never concrete transports, clocks or the Anthropic adapter. Only `composition.ts` imports concrete implementations (`transport/mock`, `transport/smtpImap`, `clock/system`, `clock/virtual`, `sentiment/anthropic`). These boundaries are enforced by ESLint import rules; don't route around them.

## Commands (verified)

- `docker compose up -d` — dev Postgres 16 (`coldemail-postgres`, port 5433, dbs `coldemail` + `coldemail_test`); `docker compose up -d greenmail` — the B8.1 SMTP/IMAP test server (`coldemail-greenmail`, SMTP 3025 / IMAP 3143 / API 18080)
- `npm run test:mail` — the live-transport suite against GreenMail (`mail` vitest project; also needs Postgres)
- `npm run db:migrate` / `db:rollback` / `db:status` — in-repo SQL migration runner (paired `.up.sql`/`.down.sql` in `apps/server/src/db/migrations/`; drizzle-kit is diff-generation assist only)
- `npm test` — all Vitest projects (unit / web / integration / api / mail / golden); every project except unit+web needs the Postgres container, and `mail` also needs greenmail. **Never run two DB-backed invocations concurrently.** `npx vitest run --project unit` = fast, no DB. `npm run test:golden` = the locked 885-lead regression (never skip)
- Ops CLIs live in `apps/server/package.json` and have **no root proxy** — they need `-w @coldemail/server` (finding #1: docs previously said "run from the repo root", which fails and broke the documented lockout-recovery path): `npm run rotate-secrets -w @coldemail/server -- --new-key <hex>` · `npm run self-check -w @coldemail/server` · `npm run operator:set-password -w @coldemail/server -- --password '<pw>'` (or `NEW_PASSWORD=…`, which keeps it out of shell history). On the VM, prefix with `docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T app`.
- `npm run capture-fixture -w @coldemail/server -- --mailbox <id> --folders | --list | --uid <n> --name <name> [--dry-run] [--keep-quoted]` — pull a REAL provider message off IMAP into `test/fixtures/headers/`. Lives in `test/ops/` (NOT `src/`) because it needs concrete ImapFlow, which the src boundary rules ban outside `transport/`. Non-destructive (BODY.PEEK, cursors untouched). `--folders` prints each IMAP folder AND its UIDNEXT — that number is what a new `poll_folders` entry's cursor must be seeded to. Always `--dry-run` first and eyeball the mapping. Adding a fixture also means extending `FixtureName`+`ALL_FIXTURES` in `test/helpers/emlFixtures.ts` and asserting it in `test/unit/header-fixtures.test.ts`.
- `npx tsx apps/server/test/ops/canary-drive.ts tick | poll [id] | confirm-now | self-check | status` — drive the canary on demand instead of waiting on 5-minute crons. **Starts `Jobs` for every command** (a send with no pg-boss running loses its confirm-delivery job). `confirm-now` pulls pg-boss's `start_after` forward — the column is `start_after`, NOT `startafter`.
- `npx tsx apps/server/test/ops/canary-cohort.ts add-lead | import | create-sequence | create-campaign | resume | redistribute | capacity | enroll | recycle` — cohort setup through the real SERVICES, not HTTP. **Writes real campaign state; canary only.**
- `npx tsx apps/server/src/services/rebuildCli.ts --dry-run` — the projection drift check (exit 1 on drift); this is the canonical form. Golden fixture: regenerate via `npx tsx test/fixtures/golden/write.ts` in `apps/server` — but only deliberately; a determinism test locks generator ⇔ committed `events.jsonl`
- `npm run typecheck` / `lint` / `format` / `format:check` — lint enforces the module boundaries (`eslint.config.mjs`; blocks are a partition — see Tooling lessons)
- `npm run dev -w @coldemail/server` — tsx watch boot (needs `.env`)
- `npm run dev -w @coldemail/web` — Vite on :5173, MSW mock mode by default; `npx vitest run --project web` = jsdom component tests (no DB); `npm run e2e -w @coldemail/web` = Playwright mock-mode e2e (boots its own dev server)
- CI (`.github/workflows/ci.yml`): `ci` job (typecheck + lint + format:check + migration drill + unit/integration/api), `golden` job (the locked regression) and `e2e-real` job on Postgres services; `mail` job (Postgres + GreenMail services); `web` job (build + component tests + Playwright e2e, no DB).

## Conventions worth knowing before you write domain code

- **Append-only means append-only.** Sentiment tagging is a separate `sentiment_tagged` event (not an UPDATE of `human_reply.sentiment`) precisely because events are immutable — see decision M. A client bug that retries a "failed" tag writes undeletable duplicates (finding #18), which is why same-value tags are now server-idempotent.
- **`delivered` is fired by a scheduled `confirm-delivery` job** at send + `delivery_confirm_hours` (default 6), not at SMTP-accept time — decision N. Any code path that appends a `sent` must have `Jobs` running so the confirm job is actually scheduled.
- **Opt-out (STOP) auto-suppresses immediately** on a keyword-matched human reply (decision F), with a `settings.optout_detection = 'auto'|'tag_only'` escape hatch. Suppression is permanent, global (keyed by email), and enforced at four layers (ingest, enrollment selection, send time, event append). Suppression deliberately *retains* the email forever, so it is **not** erasure — the typed-email erasure path (finding #8) is the GDPR Art. 17 / DPDP route: it tombstones the lead, removes suppression, redacts exposed PII, and excludes the lead from operational metrics.
- **Recycling never re-sends an identical message:** every `sent` event stores a `content_hash` of the template; enrollment is blocked if a lead would receive a hash they already got — decision Q.
- **Reply threading is header-based** (`In-Reply-To`/`References` → the stored `Message-ID`), never subject-line matching. Follow-ups are fixed to the enrollment's originally-assigned mailbox and are never rerouted — rerouting breaks threading.
- **The poller reads the folders in `mailboxes.poll_folders`** (default `['INBOX']` — finding #13, fixed by 0012). Adding the provider's spam folder is an explicit operator action; a provider silently spam-filing a reply is otherwise indistinguishable from a poller bug. Changing `poll_folders` OUTSIDE the API means seeding `mailbox_poll_cursors` for the new folder in the SAME transaction, or the next poll ingests that folder's whole history (finding #16 applies per folder).
- Imported leads start **untiered (`tier = NULL`)**, not defaulted — decision R.
- Per-mailbox timezone is required (IANA) and capacity resets at **mailbox-local** midnight. Known recipient locations stay recipient-local; unknown locations fall back to mailbox timezone, then the global default.

## Tooling lessons

- **ESLint flat config does not merge rule options across matching blocks — last match wins per rule.** The boundary rules in `eslint.config.mjs` therefore *partition* `apps/server/src` (domain / db / transport+clock+composition / rest); keep the partition exhaustive when adding blocks, and verify new rules actually fire with a temp violation file.
- **Drizzle `sql` templates expand a bare interpolated array into a tuple** (`($1,$2,…)`) — which can't cast to `text[]`. Use `sql.param([...])` to keep it one array placeholder.
- **`resetCoreTables` truncates core tables but NOT the seeded `settings` row** — a test that mutates settings leaks into later runs. The scenario runner's `init()` restores the tunables it owns; do the same in any new DB-backed suite that edits settings.
- **The test DB is shared and serial** — never run two DB-backed vitest invocations concurrently (a parallel run's truncates corrupt a long-running golden replay mid-flight).
- **Vitest hook timeouts do not inherit a project's test timeout.** DB projects kept the 10-second default while their tests had larger budgets, so under load a suite timed out *during setup* and silently skipped every case. Keep hook budgets matched to their project.
- **A green test suite can freeze the wrong answer** (findings #17, #18). When a UI-visible behaviour is broken but the suite is green, suspect that the test asserts the implementation's reading of an ambiguous contract rather than the contract itself.
- Migrations may land out of filename order across stages (0004 before 0003, 0006 before 0005): the runner applies pending-by-filename, so this is fine — but a later-numbered migration must never depend on an earlier-numbered one that hasn't landed yet.
- The Bash tool's working directory persists between calls on this machine — use absolute paths or re-`cd` to the repo root.
