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

The project is in **pre-real-domain testing**. Until the operator explicitly changes that scope:

- **The only authorized feature scope** is the completed operator-approved 2026-08-15 list plus
  the 2026-08-20 pre-domain safety backlog: mandatory reply stopping; reply dispositions and
  conservative suppression; guarded cross-campaign recontact; broader opt-out phrases; findings
  20–25; alert history and mailbox filters; arbitrary custom-field editing; copy-risk rubric
  improvements; local verification; and runbook/documentation reconciliation. Outside that list,
  work is limited to testing, verification, diagnosis, and documentation.
- Do not implement or perform domain/DNS work, production mailbox configuration, public
  Caddy/domain changes, other deployment features, or Google Workspace OAuth. OAuth is deferred
  until a real domain and inbox exist.
- Deploy only with explicit operator authorization for that deploy. Do not treat approval to edit,
  test, commit, or push as approval to deploy.
- Every outbound batch needs specific approval. Sending mail, activating or resuming a campaign,
  enrolling leads, altering live campaign state, starting a cohort, or contacting prospects are
  separately gated actions. Only send to operator-controlled addresses. Never create sends merely
  to test behavior.
- The controlled Gmail acceptance batch is complete and the test campaign is **paused**. Do not
  resume it or create another test send without new per-send approval.
- The unsubscribe endpoint must remain **dormant**: empty `unsubscribe_base_url` means no body
  link or headers and a reply-`STOP` footer. Do not configure a hostname, expose a public port, or
  claim Gmail one-click is verified; that needs a publicly reachable HTTPS URL and separate
  approval.
- Work on the current `b8.3-local-canary` branch. Do not branch off, push to `main`, or merge to
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
- Complete serial local gate passed 2026-08-20: type/lint/format; unit 331; web 52;
  integration 158; API 112; GreenMail 29; golden exactly 47; mock E2E 51; real-backend E2E 1;
  populated test DB `checked 5 enrollments — 0 diff(s)`; self-check clean.

## Oracle canary procedure

The Oracle VM is the only live deployment.

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

**Never print resolved production environment output.** `crontab -l` in the backup sidecar embeds
the full `DATABASE_URL`, including its password; print only the schedule. `docker inspect` and
`docker compose config` also render secrets. This warning follows an actual credential exposure
and password rotation.

## Live canary state — final wrap complete

The bounded catch-up/never-burst canary passed on 2026-08-20 UTC and the accelerated settings were
restored before the final deployment. Oracle is deployed on `b8.3-local-canary` at `4e9e125` plus
the later documentation-only wrap commit.

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
  intended set. Use `enrollByIds` when identities matter.
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
