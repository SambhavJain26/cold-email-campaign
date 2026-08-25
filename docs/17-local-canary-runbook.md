# Local canary runbook (B8.3-local) — two-week validation on throwaway Gmail

## 2026-08-25 pagination/settings UX hotfix — verified and deployed

After explicit operator approval, Spaceship production was fast-forwarded by reviewed Git bundle
from the Stage 4 rollout to `f58b977`; `main` was not merged and Oracle was not changed. The fix
makes Leads, all Unibox views, Alerts History, Reply Detection, and Cold Storage default to 25
items with operator-selectable 25/50/100 page sizes. It also removes the accidental vertical
tab-strip scrollbar/arrows and makes the timezone result list respond to mouse-wheel scrolling.

Verified evidence:

- the frontend-only proportional gate passed typecheck, lint, formatting, web **57**,
  mock-browser E2E **60**, real-backend E2E **1**, and the production Vite build;
- a fresh pre-deploy dump and post-deploy dump both passed `pg_restore --list`;
- all four containers are running and app/db health is green; migrations remain applied through
  `0017_multi_source_recycling`;
- the SPA, login, direct Settings route, health endpoint, outreach redirects, unsubscribe-host
  isolation, and portfolio route matrix pass;
- the served production asset contains the new page-size, pagination-label, and timezone-wheel
  code; self-check reports no invariant violations and production reports
  `checked 0 enrollments — 0 diff(s)`;
- production still contains one `google_oauth` mailbox in `ok` state and zero campaigns, leads,
  enrollments, active campaigns, or active enrollments;
- post-deploy dump `coldemail-20260825-121851.dump` is 294,643 bytes and passed
  `pg_restore --list`; the postal address and sender-domain unsubscribe template remain configured.

No campaign was activated, no lead was enrolled, and no email was sent. DNS, host Caddy, OAuth
credentials, live mailbox configuration, Oracle, and `main` were not changed.

## 2026-08-25 ten-workstream production rollout — verified

After explicit operator deployment approval, Spaceship production was fast-forwarded by reviewed
Git bundle from `4cd572b9` to the complete Stage 4 commit `f273109`; `main` was not merged and Oracle
was not changed. A pre-deploy custom-format dump passed `pg_restore --list`. The app, gateway, and
backup images were rebuilt and recreated while the existing Postgres container remained healthy.

Verified post-deploy evidence:

- migrations `0015_operational_workflows`, `0016_personalization_ramp_drafts`, and
  `0017_multi_source_recycling` are applied;
- db and app containers are healthy; backup and gateway are running; only
  `127.0.0.1:18080` is published by the stack;
- internal health returns `{ok:true,db:true}`; self-check reports no invariant violations; the
  production projection dry-run reports `checked 0 enrollments — 0 diff(s)`;
- `/email-campaign/`, login, and a direct SPA campaign route return 200; the bare app path
  canonicalizes with 308; other outreach-domain paths redirect 308 to the portfolio; both
  unsubscribe-host roots return 404; the portfolio returns 200;
- production contains one `google_oauth` mailbox in `ok` state and zero campaigns, leads,
  enrollments, active campaigns, or sendable enrollments;
- post-deploy dump `coldemail-20260825-113839.dump` is 292,812 bytes and passed
  `pg_restore --list`.

No campaign was activated, no lead was enrolled, and no email was sent. The production Gmail body
link and RFC 8058 one-click behavior remain unproven until a separately approved owner-address
canary. Oracle remains the paused rollback environment.

## 2026-08-25 ten-workstream implementation — Stage 4 verified locally

The responsive/mobile redesign is complete locally without changing the established desktop visual
language. The application shell uses `100dvh`, a viewport-fixed desktop sidebar, independent main
scrolling, and a compact phone top bar with a focus-restoring ten-section Sheet. Operational
collections share desktop tables and phone cards; complex filters move into phone Sheets; dialogs
and forms fit dynamic phone viewports; charts provide accessible summaries; touch targets are at
least 44 px; and reduced-motion, keyboard, focus, Escape, and screen-reader behavior are covered.
The user manual contains refreshed desktop screenshots 01–18 and mobile screenshots 19–23.

The complete serial local gate passed: typecheck, lint, and format; unit **341**; web **56**;
integration **166**; API **122**; GreenMail SMTP/IMAP **29**; locked golden exactly **47**;
mock-browser E2E **59**; real-backend E2E **1**. Migration `0017_multi_source_recycling` passed
apply/down/apply. The event-backed populated test cohort returned `checked 5 enrollments — 0
diff(s)` and self-check reported no invariant violations. A custom-format local test dump passed
`pg_restore --list`, restored into an explicitly named scratch database, and passed projection
rebuild, a five-enrollment zero-drift dry-run, and self-check; the scratch database and dump were
removed.

Stages 1–4 were completed and verified locally at this checkpoint. They were subsequently deployed
to Spaceship under the separately approved rollout recorded above. No campaign was activated, no
lead was enrolled, and no email was sent; Oracle was not changed.

## 2026-08-25 ten-workstream implementation — Stage 3 verified locally

The operator explicitly continued the implementation after Stage 2. Stage 3 is complete locally.
Variant analytics now work for every sequence step and separate replies matched to that step's sent
message from later outcomes in the same enrollment cohort. Effective operator sentiment tags and
distinct meetings are included; historical and bespoke rows remain visible, while bespoke rows and
the final active automated variant cannot be deactivated. Cold Storage can preview and atomically
combine two or more source campaigns, rechecks all eligibility at confirmation, skips content
conflicts, deduplicates leads, and records both campaign- and enrollment-level provenance.

No production campaign was activated, no production lead was enrolled, no email was sent, and
production and Oracle were not changed. Migration `0017_multi_source_recycling` passed
apply/down/apply. Verified gates: typecheck, lint, format; unit **341**; web **56**; API **122**;
integration **166**; affected mock-browser E2E **6**. The event-backed populated test cohort
returned `checked 5 enrollments — 0 diff(s)` and self-check reported no invariant violations.
Stage 4 and the final complete serial gate remain; this stage is not deployed.

## 2026-08-25 ten-workstream implementation — Stage 2 verified locally

The operator explicitly stopped the current implementation run after Stage 2. Stage 2 is complete
locally: campaign-scoped Step-1 CSV drafts with review/ready/sent lifecycle; server-resolved
due-step Manual Compose; Auto Observation field/rule configuration; namespaced sequence defaults
with draft campaign overrides and first-activation snapshots; resolution-trace previews; and
activation-based ramp stages with the default 5/8/10/12/15 schedule.

No campaign was activated in production, no lead was enrolled for outreach, no email was sent, and
production and Oracle were not changed. Migration `0016_personalization_ramp_drafts` passed
apply/down/apply on the disposable test database. Verified gates: typecheck, lint, format; unit
**341**; web **55**; API **119**; integration **162**; GreenMail **29**; locked golden exactly
**47**; mock-browser E2E **52**; real-backend E2E **1**. The event-backed populated test cohort
returned `checked 5 enrollments — 0 diff(s)` and self-check reported no invariant violations.
Stages 3–4 remained separately gated at this checkpoint; this stage was not deployed.

## 2026-08-25 ten-workstream implementation — Stage 1 verified locally

The operator approved four implementation stages with a single, separately approved production
deployment after the final gate. Stage 1 is complete locally: numbered pagination for Unibox,
reminders, alerts, reply detection, and cold storage; server-resolved due-step Manual Compose;
non-sending operator reminders with automatic `not_now` tasks; strict IANA timezone controls; and
authenticated IMAP-folder discovery/validation with transactionally seeded UIDNEXT cursors.

No campaign was activated, no lead was enrolled for outreach, no email was sent, and production and
Oracle were not changed. Migration `0015_operational_workflows` passed down/up on the disposable
test database. Verified gates: typecheck, lint, format; unit **338**; web **55**; API **118**;
integration **159**; affected mock-browser journeys **19**. The event-backed populated test cohort
returned `checked 5 enrollments — 0 diff(s)` and self-check reported no invariant violations.
Stages 2–4 and the final full serial gate remain open; this stage is not deployed.

## 2026-08-22 Spaceship production commissioning gate

The operator-approved production build is deployed at
`https://sambhavpmtech.com/email-campaign/` from `b8.3-local-canary` commit `680f47e`; `main` was
not merged. Oracle was not changed and remains the paused rollback canary.

Verified production evidence:

- the existing portfolio and Caddyfile were backed up; a persistent 2 GiB swap file and Docker
  Engine/Compose were installed; the app lives at `/opt/email-campaign`;
- authoritative DNS returns `104.207.93.174` for the apex, `www`, and `unsubscribe` names on both
  outreach domains; existing Google MX/SPF/DKIM/DMARC/site-verification records were untouched;
- the db, app, internal gateway, and backup containers are healthy. Only
  `127.0.0.1:18080` is published by the stack; host Caddy remains the only public 80/443 listener;
- `/email-campaign` redirects 308 to its trailing-slash form; the SPA, login, direct campaign and
  mailbox routes, and health path return 200. Other outreach-domain paths redirect 308 to the
  portfolio homepage. Unsubscribe hosts return 404 outside `/u/*`; invalid-token GETs return the
  generic non-enumerating confirmation page;
- the clean production database contains zero mailboxes, campaigns, leads, and enrollments, so it
  cannot send. HTTPS/database health, self-check, and `checked 0 enrollments — 0 diff(s)` pass;
- `coldemail-20260822-132521.dump` passed `pg_restore --list`. It restored to a scratch database;
  projection rebuild/dry-run and self-check passed there; the scratch database was removed;
- Spaceship AutoBackup is active on its seven-day trial with a verified five-backup limit.

The Google OAuth implementation and production client credentials are configured; the values were
verified only for non-empty presence and were never printed. The valid business postal address and
sender-domain unsubscribe template are also configured. The first OAuth mailbox connection and Test
Connection, and the separately approved one-message owner-address send/reply/unsubscribe canary,
remain. The credential restart passed health, self-check, and `checked 0 enrollments — 0 diff(s)`;
no outbound mail was sent.

## 2026-08-22 local pre-production completion gate

Reply recontact safety and findings 20–25 are implemented on `b8.3-local-canary`. Migration 0013
passed its apply/down/apply drill. The complete serial local gate passed: typecheck, lint and format;
unit **338**; web **55**; integration **159**; API **116**; GreenMail SMTP/IMAP **29**; locked
golden **47**; mock-browser E2E **51**; real-backend E2E **1**. The exact projection command against
the populated test database returned `checked 5 enrollments — 0 diff(s)` and self-check reported no
invariant violations. The real-backend fixture was corrected to obey the existing launch guardrails
(`ramp_days=7`, cap 25).

The separately approved live wrap completed on 2026-08-20 UTC. The bounded catch-up scenario sent
only four messages to owner-controlled addresses, paused at the bound, restored the safe settings,
deployed `4e9e125`, and passed health, self-check, backup, reconciliation, and zero-drift checks.
See §§6–7 for the exact evidence.

## UI data-consistency remediation (2026-08-10)

The UI consistency implementation is deployed to Oracle and its database-backed verification gate
is complete. `contacted` is now the distinct-lead union of `delivered` and
`human_reply`, campaign analytics and lead state are correctly scoped, visible operational data
refreshes every 30 seconds, and operator actions invalidate dependent live views immediately.
Mailbox charts are chronological, zero-filled, timezone-aware all-campaign series. Scheduler
blockers are database-backed episodes, so worker restarts cannot duplicate their alerts.

Reply stopping is per sequence. With `stop_on_reply` disabled, a human reply records metrics while
later steps remain active; hard bounces and STOP/unsubscribe always end sending. The manual
composer offers only active manual-sendable enrollments and healthy mailboxes. Database-backed
suites, migration up/down, and the local projection dry-run are green. The Oracle controlled-Gmail
replay is complete, including reply, reply-before-delivery, and STOP suppression paths.

### Oracle controlled Gmail result — completed (2026-08-10)

The three-lead live campaign now reconciles to three contacted leads: two normal replies are in
`REPLIED`, and the third replied with `STOP`, creating an `unsubscribe` event with
`matched_keyword: "stop"`, an `UNSUBSCRIBED` enrollment, and a global `unsubscribed` suppression.
Both mailbox poll timestamps advanced after the result was ingested. A late ImapFlow connection-close
event found during this confirmation could restart the worker; it is fixed in commit `5ae3265`, whose
focused real SMTP/IMAP suite passed before the Oracle redeploy.

### No-send regression and UI/data audit — completed (2026-08-10)

With no new external campaign mail authorized, the remaining pre-real-domain pass was run locally
and against Oracle without enrolling or activating a new cohort. Migration `0009` was rolled back
and reapplied; local and Oracle `rebuild-projections --dry-run` checks returned 0 diffs (Oracle:
4 enrollments). The full current regression gate passed: web 54, unit 287, integration 159, API 82,
SMTP/IMAP GreenMail 33, golden 47, mock UI E2E 50, and real-backend UI E2E 1. The mock UI sweep
initially exposed stale fixture coverage after the UI-consistency changes: the Golden campaign was
missing its sequence relation, the settings mock discarded read-only legacy fields on PUT, and the
manual composer fixture did not model an active Mode-1 enrollment. Those test-harness defects are
fixed and the complete sweep is green.

Oracle remains healthy on `daef77a`: app and database health checks are green, no post-redeploy
application error appears in the logs, and nightly database dumps exist through 2026-08-10. Direct
read-only reconciliation reports the original one-lead gate plus the three-account campaign as 4
contacted leads total: `REPLIED` 3, `UNSUBSCRIBED` 1, and one global `unsubscribed` suppression.
The three-account campaign itself remains exactly two normal replies and one STOP suppression.

The unchecked cohort, failure-cohort, and time-based **live** scenarios below are intentionally
still open. They require new external mail or a new active cohort and must not be run without
explicit authorization; their no-send code paths are covered by the serial integration, API, mail,
golden, and UI gates above.

### Day 2 Gate 1 readiness check — completed (2026-08-13)

The Oracle stack remains healthy: Caddy's HTTPS `/health` returned `{ ok: true, db: true }`, and
the production projection comparison returned `checked 4 enrollments — 0 diff(s)`. Both registered
Gmail sender mailboxes passed a fresh non-sending Test Connection (SMTP and IMAP both successful;
4.43 s and 4.12 s respectively). Both are `ok`, have recent successful IMAP polls, a daily cap of
5, `Asia/Kolkata` timezone, and an enforced Monday–Friday 10:00–18:00 local send window.

The requested isolated assets already exist without activation: **Gmail Learning Canary - Gate 1**
is a one-step sequence with one active variant and reply stopping enabled; **Gmail Learning Canary
- Aug 2026** is a draft campaign with zero enrollments and zero contacted leads. Its current shared
mailbox capacity is 10 total sends, with 0 sent and 0 follow-ups due today; its 10-day ramp caps
new enrollments at 2 per day. No activation, enrollment, or outbound message was performed during
this check.

### Accelerated full-system QA — local and Oracle read-only gate complete (2026-08-13)

The operator replaced the planned ten-day cadence with an accelerated, feature-by-feature pass.
The no-send portion is complete. Local Postgres and GreenMail were used for the full current gate:
TypeScript, formatting, and lint are clean; unit 287, web component 47, integration 159, API 77,
golden 47, real SMTP/IMAP 23, mock-browser E2E 50, and real-backend browser E2E 1 all pass.
The real-backend journey covers import, enrollment, virtual-time send, reply and STOP ingestion,
sentiment tagging, metrics, and terminal completion. The local projection dry-run returned 0 diffs.

This pass found and locally fixed three test/operation quality defects:

1. DB-project hooks retained Vitest's 10-second default even though their tests had larger budgets;
   under sustained load the metrics suite timed out during setup and skipped all eight cases. Hook
   budgets now match their DB projects, and the full 159-test serial integration run passes.
2. A mock-only manual-send campaign had been written into the committed golden API fixture, making
   full API parity contradict the real golden database seed. The parity fixture is real-data-only
   again; mock-only relationships and the Mode-1 demo campaign are constructed in the mock DB.
3. Re-clicking an already-selected Unibox sentiment could append a redundant `sentiment_tagged`
   fact. Same-value tags are now server-idempotent and the selected UI tag is disabled; genuine
   retagging still appends a new fact. Focused API and Unibox browser coverage pass.

Oracle remains deployed on `daef77a`; none of these local fixes has been deployed. The live stack
is healthy and its projection dry-run remains 0 diffs across 4 enrollments. A local read-only UI
snapshot of Oracle data (with mailbox secrets and the operator row excluded) was inspected across
Overview, Leads, Mailboxes, Sequences, Campaigns, Unibox, Analytics, Cold Storage, Settings, and
System. Visible counts, states, capacities, mailbox health/polls, settings, draft Gate-1 assets,
replies, STOP suppression, and analytics agree with the copied database. No Oracle state was
changed and no new Gmail message was sent during this gate.

### Accelerated controlled live-provider gate — completed (2026-08-14)

The operator approved one precisely reviewed two-message batch using only owned Gmail accounts.
Commit `ef5071d` was deployed first; HTTPS health, database health, and a four-enrollment
zero-drift projection check passed before activation. Campaign **Gmail Learning Canary - Aug
2026** used the one-step **Gmail Learning Canary - Gate 1** sequence, a 10-day/2-per-day ramp,
Tier-A `human_written` enrollment snapshots, and one explicitly selected healthy sender per lead.
The visible lead tiers were restored to C immediately after enrollment.

Exactly these sends were accepted and written once to the append-only ledger:

- enrollment 5: `worksambhav26@gmail.com` to the controlled `+lead02` recipient, subject
  **Controlled QA check A**, Message-ID `<ce-5-1-1786643649013@gmail.com>`;
- enrollment 6: `sambhavcopywriting@gmail.com` to the controlled `+lead03` recipient, subject
  **Controlled QA check B**, Message-ID `<ce-6-1-1786643840813@gmail.com>`.

The first one-off operational invocation sent and committed message A before refusing to schedule
its delayed confirmation because that standalone process had not started `Jobs`. The ledger and
`sent_messages` table were checked before any retry, so A was not duplicated. Its one missing
confirmation job was restored, the normal job queue was started for B, and both exact jobs were
then advanced to run immediately for this accelerated test. Both completed once and appended one
`delivered` event per enrollment.

Manual mailbox polls ingested exactly one reply per mailbox with zero duplicates. `received`
threaded through `In-Reply-To` to enrollment 5 and produced `human_reply` -> `REPLIED`. `STOP`
threaded to enrollment 6 and atomically produced `human_reply` plus `unsubscribe` with
`matched_keyword: "stop"` -> `UNSUBSCRIBED`, negative effective sentiment, and a global
`unsubscribed` suppression for the controlled `+lead03` address. A second poll processed zero new
messages. The campaign reconciled to 2/2 contacted, 2/2 replies, one unsubscribe, zero bounces,
step 1 delivered/replied 2/2, and Tier A human-written contacted/replied 2/2. After Asia/Kolkata
midnight, the UI correctly reset daily capacity to 0/10 sent, room 10, and ramp room 2.

The copied-data UI pass exposed three additional visibility defects, all fixed in `12bd0cc`:

1. The campaign outcomes endpoint counted only explicitly positive/neutral REPLIED sentiment, so
   untagged or negative terminal replies disappeared from the mutually exclusive completion sum.
   Its UI `neutral` field now means the documented neutral/negative/untagged non-positive remainder.
2. The global campaign selector cleared a valid `?campaign=4` deep link while the campaigns query
   was still loading, silently switching Overview/Leads/Analytics to the first campaign.
3. Variant analytics measured bespoke manual-send variants in the database but omitted them from
   the UI because the sequence builder intentionally hides those historical artifacts. Sent manual
   variants now appear as clearly labelled read-only analytics rows and cannot enter the editable
   A/B deactivation decision.

The focused and full regression gates passed: API 77, web component 47, golden 47, focused shell
browser 6, plus TypeScript, lint, and formatting. A sanitized Oracle snapshot excluded mailbox
secrets and the operator row; its final screen-level verification passed across campaign outcomes
and capacity, both lead rows, suppression visibility, both Unibox cards, variants, steps, tiers,
and Overview. The snapshot database, dump, logs, and temporary scripts were removed afterward.
Commit `12bd0cc` is deployed; HTTPS and database health are green, the deployed data returns the
correct two terminal outcomes and two 1/1 manual variant rows, and the final production projection
check returned `checked 6 enrollments — 0 diff(s)`. The completed test campaign is paused to prevent
accidental future enrollment. No prospect, external-domain, DNS, or real-domain work was performed.

### Compressed canary settings — restored after final scenario (2026-08-20 UTC)

The accelerated §§3–7 run deliberately traded safety margin for speed under explicit approval.
Those temporary values were restored after §6. The pre-change snapshot remains on the VM as a
restricted recovery artifact.

| Setting | Accelerated value | Restored value |
|---|---:|---:|
| `settings.enforce_send_window` | `false` | **`true`** |
| `settings.max_mailbox_daily_cap` | 3000 | **50** |
| `settings.pause_min_sends` | 5 | **25** |
| `settings.delivery_confirm_hours` | compressed | **1** |
| `settings.send_jitter_pct` | 0 | **20** |
| `settings.min_ramp_days` | 0 | **7** |
| `mailboxes.daily_cap` (both) | 3000 | **5** |
| mailbox state | mailbox 1 auto-paused; mailbox 2 resume cap 1500 | **both `ok`; no resume cap** |
| send window | unenforced | **Mon–Fri 10:00–18:00** |
| `mailboxes.poll_folders` | `{INBOX,[Gmail]/Spam}` | **unchanged; keep this finding 13 fix** |

> **Trap hit while doing this, worth not repeating.** `poll_folders` was first set with plain SQL,
> which skips the UIDNEXT seeding the API route performs — so the next poll would have ingested
> both accounts' entire Spam folders (144 and 13 messages) as third-party PII. Caught and reverted
> before the 5-minute cron fired. **Changing `poll_folders` outside the API means seeding
> `mailbox_poll_cursors` for the new folder in the same transaction**; `capture-fixture --folders`
> now prints each folder's UIDNEXT for exactly this purpose. Finding 16 applies per folder, and it
> is easy to forget that a manual edit bypasses the guard that normally handles it.

### Post-canary real-domain implementation backlog — completed 2026-08-22

After the controlled ten-day Gmail learning canary is complete, and before any real-domain
prospect send, the operator has approved this implementation sequence:

1. Public opaque-token unsubscribe endpoint, body link, and `List-Unsubscribe` / one-click
   headers; retain reply `STOP` as a fallback.
2. Hard launch guardrails: review and enforce conservative mailbox/campaign ceilings and staged
   enrollment so a configuration mistake cannot create an unsafe initial ramp.
3. Domain-readiness preflight: surface the operator checks for authenticated sending domains,
   reply inboxes, compliance address, mailbox health, conservative caps, and unsubscribe readiness.
   DNS and warming remain operator work, not app-managed configuration.
4. Per-mailbox Google Workspace OAuth connection flow with encrypted refresh-token storage and a
   clear reconnect state. Start with individual authorization for the outreach inboxes; do not use
   domain-wide delegation initially.
5. Retain and audit the existing deterministic spintax/variant support and copy-risk checks. They
   provide controlled wording variation and review, not a promise to evade spam filters or make
   every message unique.

All five items are implemented and locally verified. The Spaceship deployment, DNS, routing, and
public unsubscribe hosts are live as recorded above. Production OAuth client configuration,
business postal address/template, one OAuth mailbox Test Connection, and the bounded owner-address
canary remain operator handoffs. No prospect sending is authorized by this record alone.

## Pre-cohort readiness update (2026-08-09)

The 20-lead Gmail cohort remains paused until the pre-canary remediation gate is green. The operator-facing Gmail setup checklist includes a filter on every canary account that **never sends mail to Spam**. Production reply monitoring currently reads `INBOX` only; provider Spam folders are intentionally out of scope for this phase.

Before deployment, run the complete local verification gate, including the migration up/down drill and `rebuild-projections --dry-run` with zero diffs. After the Oracle rebuild, repeat the dry-run on the live container before any canary send.

**Branch:** `b8.3-local-canary`. This paragraph describes the historical Oracle phase; the real
domains and Spaceship VPS now exist and the production deployment is recorded at the top of this
runbook. The remaining commissioning work is the Workspace OAuth client, business address and
unsubscribe template, one mailbox Test Connection, and the separately authorized owner-address
canary.

**Out of scope: deliverability.** Sending from `@gmail.com` inherits Google's reputation. Inbox
placement here says nothing about how warmed domains will perform. This validates the machine,
not the campaign. §6a's prerequisites still gate the real canary.

> **Run the domain / DNS / warming track in parallel, starting week 1.** Warming is 2–4 weeks of
> calendar time that cannot be compressed and does not depend on this outcome. Serialising the
> two tracks costs a month.

---

## 0. Findings log — everything the canary has surfaced

**The durable record.** Task chips are not persisted; this table is. Nothing here is a
theoretical review comment — every row is something that stopped, misled, or silently blocked a
real operator during the pass. The detailed table below is the current action list and is updated
as work closes.

### Current remediation status — local gate complete

| Findings | Current status | Evidence / remaining action |
|---|---|---|
| #3–9 | ✅ implemented and locally verified | Blocker visibility; mailbox schedules/timezones; archive/delete guards; PII erasure; explicit Tier A manual workflow. |
| #14 | ✅ implemented and locally verified | Transparent cold-email cliché rubric, including subject lines. |
| #15–16 | ✅ implemented and locally verified | Reply-first lock regression and UIDNEXT cursor initialization coverage. |
| #19 | ✅ implemented and locally verified | GreenMail verifies minimal `multipart/alternative` text + HTML. |
| #13 | ✅ fixed and live-configured | Per-folder polling is deployed; both live mailboxes poll `{INBOX,[Gmail]/Spam}` with folder-scoped cursors. |
| Earlier pre-canary release | ✅ deployed to Oracle | Commit `95de5a3` deployed on 2026-08-10; containers healthy, HTTPS `/health` returned 200, and production `rebuild-projections --dry-run` returned 0 diffs. |
| UI data-consistency release | ✅ deployed and live-verified | Commit `556c9b2` deployed on 2026-08-10; all containers are healthy, HTTPS `/health` returned 200, and production `rebuild-projections --dry-run` returned 0 diffs across 4 enrollments. The controlled Gmail campaign verified normal replies, reply-before-delivery accounting, and STOP suppression. |

| # | Finding report | Class | Current status |
|---|---|---|---|
| 1 | Ops CLIs (`operator:set-password`, `rotate-secrets`, `self-check`) were documented as runnable "from the repo root". They aren't — no root proxy, so the **documented lockout-recovery path did not work**. | docs wrong | ✅ fixed — `-w @coldemail/server`, commit `d588de5` |
| 2 | The compliance footer address is published to every recipient; docs never warned against using a home address, and it's legally required so it can't just be omitted. | docs gap | ✅ documented — docs/16 §6a, commit `590e75a` |
| 3 | **Nothing tells the operator why sends aren't happening.** The window was closed; the scheduler ticked 23 times, correctly did nothing, and emitted no alert, no banner, no log line. Diagnosable only by reading the DB. | **observability** | ✅ completed locally — blockers are visible in Overview/System and alert once per episode |
| 4 | `mailboxes.send_window` is not editable anywhere in the UI — `mailbox-dialog.tsx` explicitly `.omit()`s it. Every mailbox is pinned to `08:00–17:00 Mon–Fri`. API supports changing it; no screen does. | UI gap | ✅ completed locally — days and start/end are editable |
| 5 | **No per-mailbox timezone exists at all.** `send_window` carries only start/end/days; the timezone is the single global `settings.default_timezone`. An operator cannot align sending hours to prospect business hours. | design gap | ✅ completed locally — required IANA mailbox timezone and local-midnight caps |
| 6 | Campaign status `archived` is reachable via `PATCH /campaigns/:id`, styled in the badge, and handled by the enroll panel — but **no UI control ever sets it**. Dead branches for a state the operator can't reach. | UI gap | ✅ completed locally — typed-confirm archive control stops scheduling |
| 7 | No delete for campaigns or sequences, even at **zero events** where deletion is provably safe. Combined with `tier_effort_config`/`ramp_config` being create-only, a mis-configured campaign is permanently useless *and* permanently undeletable. | UX gap | ✅ completed locally — typed deletion, refused when history/dependencies exist |
| 8 | No data-subject erasure path (GDPR Art. 17 / DPDP 2023). Suppression deliberately *retains* the email forever, so it is not erasure. | **legal** | ✅ completed locally — typed erasure tombstones/redacts PII and excludes metrics |
| 9 | Tier A defaults to **Mode 1 (human-written)**, which the scheduler never sends — it waits for the manual composer. A new operator accepting defaults gets a campaign that silently never sends. Correct behaviour, invisible consequence. | UX trap | ✅ completed locally — acknowledgement, count, and manual-composer route shown |
| 10 | Leads are import-only (no `POST /leads`). Deliberate — the ingest path owns hygiene, dedup and suppression — but adding one lead means hand-writing a CSV. | minor | 🟡 accepted, revisit |
| 11 | **First real send landed in SPAM — cause UNDETERMINED, and this rig cannot determine it.** Three hypotheses were advanced and each was falsified by the next round of sends: (a) the unconditional footer + omitted `List-Unsubscribe`, killed when identical content reached the inbox; (b) per-account reputation, killed when the "bad" account delivered 3 of 5; (c) the subject line `"quick question"`, which filtered twice and then reached the inbox on a later send with the same subject. **The filter state was moving throughout, and no send was independent of the ones before it.** (An earlier version of this row blamed "Not spam" marking; the operator had *not* marked anything — that explanation was wrong and is corrected here. Getting the contamination mechanism itself wrong is a fair illustration of how many uncontrolled variables are in play.) What is certain: Gmail placement is not a deterministic function of message content but an adaptive per-recipient model weighing engagement, sender↔recipient history, cross-user aggregates and volume/recency. Every send in this series added history to a pair that previously had none, and the operator opened and read each message to see where it landed — itself an engagement signal. Seven-plus sends in two hours between a previously-silent pair is a pattern change on its own. **Methodological conclusion: n=1 recipient, an adaptive filter, and an observer training it cannot yield a causal answer.** Real deliverability measurement needs seed lists across providers, meaningful volume, and a purpose-built placement tool — which is week-5 work on warmed domains, not this. | deliverability (unmeasurable here) | 🟢 closed as **not answerable with this instrument** — reinforces the runbook's opening statement that deliverability is out of scope. Do not re-litigate it on the canary rig. |
| 12 | The `List-Unsubscribe` question (docs/14 B8.6 "decision revisit", docs/08 §75) remains **genuinely open** — finding 11 shows it is not what triggered *this* filtering, but says nothing about how it performs on real warmed domains at volume, which is the case the deferral was actually about. Do not treat finding 11 as having answered it. | decision | 🟢 **built 2026-08-15, still unanswered.** The mechanism now exists: opaque-token endpoint, `List-Unsubscribe` + one-click POST headers, body link, all shipped **dormant** (no `unsubscribe_base_url` ⇒ no header, no link, reply-`STOP` only). GreenMail proves both headers reach the wire. What is still open is the original *question* — whether it helps on warmed domains at volume — and that remains unanswerable without real domains. Building it does not answer it; do not record this row as closed. |
| 13 | **The poller reads `INBOX` only.** Anything Gmail files into Spam is invisible to it — so a reply landing in a *sender* mailbox's spam folder makes the reply-detection path appear broken when it is not. For the canary this needs a "never send to Spam" filter in all three accounts. For production it is a real failure mode worth documenting: a provider silently spam-filing a reply looks identical to a poller bug. | operational | ✅ **fixed 2026-08-15 (0012).** `mailboxes.poll_folders` (default `['INBOX']`) plus a cursor per (mailbox, folder), because IMAP UIDs are **folder-scoped** — one high-water mark cannot span INBOX and Spam. Each folder seeds from its own UIDNEXT, so adding one never back-fills history (finding 16 applies per folder). A folder name that does not exist on the provider is skipped rather than failing the poll, since names differ (`[Gmail]/Spam` vs `Junk`). GreenMail proves the bug and the fix: a reply moved out of INBOX is invisible to INBOX-only polling and found once the folder is configured. **The operator must still add the folder name** — the default stays INBOX-only. |
| 15 | **RACE: a lead who replied still received the follow-up.** `human_reply` at `08:05:15.207`, `sent` (step 2) at `08:05:15.400` — 193 ms later, with `stop_on_reply = true`. The follow-up really went out (`<ce-1-2-1786089915400@gmail.com>`). Cause: `scheduler-tick` and `imap-poll-*` are both registered on `*/5 * * * *`, so **they are scheduled to run in the same minute, every time** — this is a designed-in collision, not a rare interleaving. The scheduler read the enrollment as ACTIVE-and-due, rendered, sent over SMTP and appended `sent`, while the poller was concurrently matching the reply and appending `human_reply`. The scheduler's read preceded the reply's commit. **The offline suites structurally cannot catch this** — the scenario runner drives jobs through an inline queue, so poll and tick never execute concurrently and the interleaving cannot occur. Only real pg-boss workers on real crons expose it. Worst-case production impact is the most embarrassing failure a cold-email tool has: a prospect replies and is immediately auto-followed-up, which is exactly what `stop_on_reply` exists to prevent. Fix direction: re-check enrollment state inside the send transaction immediately before append (the eventStore append is already the single transactional chokepoint, so the guard belongs there), and/or stagger the two crons. | **correctness / concurrency** | ✅ completed locally — enrollment lock + send-time projection re-read; poll cron staggered |
| 16 | **Connecting a mailbox ingests its entire history.** `mailboxes.last_poll_uid` defaults to `0`, so the first poll of a real mailbox fetches every message it has ever received — here **12,581 messages going back to 2022-06-10**, four years of unrelated personal mail, stored in `incoming_messages` with full subjects and sender addresses. 44 historical Amazon/Internshala notifications were classified `auto_reply` and 2 old Gmail DSNs as `bounce`; none produced events because no enrollment matched (that guard held correctly), but the rows are all persisted. Consequences: needless DB bloat, a very slow first poll, and — more seriously — a large volume of unrelated third-party PII pulled into the product's database, which interacts badly with finding 8 (no erasure path). Fix direction: initialise `last_poll_uid` to the mailbox's current `UIDNEXT` at creation/reconnect so polling starts from "now" rather than from the beginning of time. | **data hygiene / privacy** | ✅ completed locally — initialize from UIDNEXT on create and legacy-zero reconnect |
| 17 | **The Leads state filter returned zero rows for every state — frontend and backend disagreed about what `state=` means, and the api suite froze the wrong answer.** `leadsRepo.leadFilterWhere` did `eq(leads.state, filter.state)` — `leads.state` is the **postal** column from the CSV (`Maharashtra`), while the UI's dropdown sends `ENROLLMENT_STATES` values (`REPLIED`, …). docs/10 specified only a bare `state=` with no enumeration, so each side resolved the ambiguity differently. **The api test locked in the backend's reading** by asserting `GET /leads?state=TX` — so 72 green api tests coexisted with a filter that could never match anything the UI sent. docs/12 §Leads settles it: the table has a `location` column *and* a separate `StateBadge (latest enrollment)`, and the filter row sits beside tier/campaign/suppressed. Fixed: filter on `enrollments.current_state` via EXISTS, scoped to the **same** enrollment when `campaign_id` is also supplied; contract disambiguated; tests rewritten to assert enrollment semantics *and* that a postal value no longer matches. | **correctness (contract ambiguity)** | ✅ fixed |
| 18 | **Sentiment tagging reported failure on every success, and the retries wrote junk into an append-only log.** `POST /unibox/:id/sentiment` returns the updated **item** (contract docs/10; route declares `response: { 200: uniboxItemSchema }`), but the client parsed it with `okResponseSchema`. Server returned 200 and appended the event; the client's zod parse rejected the body and the global mutation handler toasted "request failed". The operator clicked seven times, producing **seven duplicate `sentiment_tagged` events** that can never be deleted. Note the client-side decision-H tripwire worked exactly as designed — it caught a genuine client/server disagreement; the client was simply the wrong side. Fixed: parse `uniboxItemSchema`. | **correctness (schema mismatch)** | ✅ fixed |
| 19 | **Every email was originally 100% plain text, so the footer/signature could not be visually de-emphasized.** The corrected send path provides matching plain-text and minimal escaped HTML alternatives with no images, tracking, or complex layout. The footer now follows one blank paragraph (no visible `---` divider); HTML renders at `10px`, `#767676`, `line-height:1.5`, with a 16px top gap, while plain text carries the same words after a blank line. The unsubscribe link inherits the same gray and remains underlined. **Legal constraint:** the line must remain clear and conspicuous; it is de-emphasized but not hidden. | product / deliverability | ✅ completed locally — matching text + minimal escaped HTML, verified by unit/web/GreenMail coverage |
| 14 | **The deliverability score's spam lexicon models the wrong era.** `render/spamwords.ts` is the entire vocabulary behind check #9 and decision W's rubric: `['free!!!', 'guarantee', 'act now', 'risk-free', '100% free', 'click here']`. That is a 1990s bulk-mail word list. It contains **zero** burned cold-email phrases — `quick question`, `just following up`, `circling back`, `touching base`, `hope this finds you well`, `reaching out`, `pick your brain`, `15 minutes`, `per my last email`. An operator can therefore write the most template-smelling subject in the industry and the checker will score it clean, which is worse than having no checker: it manufactures false confidence. **Note carefully — this stands on its own as a fact about the code, and is NOT evidence-backed by finding 11**, which turned out to be unmeasurable. The justification is that the lexicon is self-evidently stale, not that any particular phrase was proven to cause filtering. Structurally cheap: decision W says the rubric is DATA and the file header says to tune the lexicon, not `checks.ts`. Worth considering separately whether the subject deserves its own weighting — check #9 currently flattens subject and body into one string (`content = subject + "\n" + body`) and scores a hit identically wherever it appears — but that change should be justified on its own merits, not on this canary's contaminated data. | product gap | ✅ completed locally — transparent cliché rubric in subject/body; warning only |
| 20 | Acknowledged alert history was inaccessible in the UI. | **observability** | ✅ fixed 2026-08-20 — System now shows all/open alert history with acknowledgement state and action. |
| 21 | Unibox and incoming-message `mailbox_id` filters existed only in the API. | UI gap | ✅ fixed 2026-08-20 — both screens now provide a mailbox selector. |
| 25 | `redistributeUnstarted` searched for an impossible assigned-without-send state. | **correctness** | ✅ fixed 2026-08-20 — function, calls, impossible-state test, canary command, and redistribution claims removed. Unassigned work rotates normally; started threads remain pinned. |
| 24 | Changing `delivery_confirm_hours` after sends could make completion replay disagree temporarily. | **correctness** | ✅ fixed 2026-08-20 — API guard plus database trigger make the setting immutable after the first `sent` event, including concurrent-write races. |
| 23 | **A red browser test was recorded as a green gate, twice.** The mock Playwright suite contains **51** tests, but the 2026-08-10 and 2026-08-13 gate records both say "mock UI E2E 50" — the missing one, `unibox.spec.ts` "manual composer prefills from step 1", has been failing since commit `95de5a3`. Cause: that commit added an **Open campaign leads** link to the campaign detail page, and the test navigates away with `getByRole('link', { name: 'Leads' })`. Playwright matches accessible names by substring, so the selector resolves to two elements and trips strict mode. The failure is a selector collision, not a product defect — but it went unnoticed because "50 passed" was transcribed as the whole result rather than 50 **of 51**. Fixed with `exact: true` at the one call site that navigates from a campaign detail page; the other sixteen nav clicks in the suite start from pages that do not render the second link. **The lesson is about the record, not the selector: a suite total must be written down as passed/total, or a red test hides inside a green-looking number.** | **test integrity** | ✅ fixed — found by the 2026-08-15 audit pass |
| 22 | Arbitrary imported `custom_fields` were display-only. | UI gap | ✅ fixed 2026-08-20 — lead detail can add, rename, edit, and remove arbitrary fields with unique-name validation. |

**The pattern worth naming:** findings 4, 5, 6 and 9 are all the same shape — *the backend
implements it, the API exposes it, the UI never surfaces it, and the operator gets no feedback.*
The offline suites cannot catch this class because they drive the API directly and never look at
a screen. That is precisely the value this canary adds, and it argues for a **UI-coverage audit
of every settings-shaped field** before the real campaign.

### UI-coverage audit — completed (2026-08-15)

The audit the paragraph above asks for has now been run: every request-body and query field in
`packages/shared/src/api/` was walked against the screens in `apps/web/src/features/`. It found
**three** gaps, recorded as findings 20–22. All three are the same shape as 4/5/6/9 and none is
a correctness defect; finding 20 is the one worth fixing before real campaigns, because the
alert feed is the operator's only record of why sending stopped.

The negative result is the more useful half, because it bounds the class. These surfaces were
checked and are **fully covered** — every writable field reachable from a screen:

- **Settings** — all 17 `PUT /settings` fields plus both compliance fields (`rules-tab.tsx`,
  `compliance-tab.tsx`). The class that produced findings 4 and 5 is closed.
- **Mailboxes** — every connection/cap/window/folder field. The later production implementation
  added the missing `auth_type` surface plus Google connect, reconnect, disconnect, failure, and
  setup-required states; focused UI/API tests cover them.
- **Campaigns** — create (name, sequence, `tier_effort_config`, `ramp_config`,
  `acknowledge_tier_a_manual`), patch (name/status), typed-confirm delete, enrol, recycle.
- **Sequences** — write body, typed-confirm delete, preview, and live `validate-template`.
- **Leads** — tier, notes, `custom_observation`, bulk-tier by ids *and* by filter, typed-confirm
  suppression removal and erasure; list filters tier/state/campaign/q/suppressed.
- **Imports** — both `drop_flagged` and `import_all` commit modes.
- **Unibox** — bucket, sentiment filter, untagged-only, sentiment tagging, snooze, manual send.
- **System** — rebuild dry-run, incoming-message classification filter.

This audit is diagnosis only; no behaviour was changed and no fix is implied by this record.

### Copy-variation audit — completed (2026-08-15)

docs/16 §8 item 5 asks that the existing spintax/variant/copy-risk features be audited and
retained rather than replaced with "unique every time" logic. This is that audit.

**What exists, and is sound.** Spintax `{a|b|c}` is picked by `seededPick` (`render/spintax.ts`)
from a per-send RNG seeded `fnv1a(enrollmentId:stepNo:variantId)` (`render/seed.ts`), so a send
is **deterministic and reproducible** — a soft-bounce retry re-renders byte-identically, which is
what makes retries safe and the golden replay stable. Step variants give A/B copy per step, and
each variant's `contentHash` (computed at save time, decision Q, echoed never recomputed) is what
blocks recycling from re-sending an identical message. `{{custom_observation}}` resolves per
personalization mode with a segment-rule fallback and an `observation_fallback` warning
(`render/slots.ts`). **No change recommended to any of this** — it is controlled, auditable
variation, not filter evasion, which is exactly what the build order asks for.

**Four observations on the copy-risk rubric (check #9).** None is a correctness defect; the
rubric is a warning surface by design and is documented as such.

1. **`quick question` is not in the lexicon.** Finding 14 lists it *first* among burned
   cold-email phrases, and it is the subject line at the centre of finding 11's narrative. The
   remediation added seven cliché phrases (`render/spamwords.ts`) but not that one; `just
   checking in` is also absent. Cheapest possible fix — the file header says the lexicon is data.
2. **Three phrases from the original list were dropped** — `free!!!`, `guarantee`, `100% free`.
   Plausibly deliberate, since finding 14's whole argument is that the old list modelled the
   wrong era. But `free!!!` and `100% free` are still live signals in commercial mail, so this
   should be a recorded decision rather than a silent loss.
3. **The subject is still not weighted separately.** Check #9 flattens
   `subject + "\n" + body` into one string and scores a hit identically wherever it lands
   (`render/checks.ts:46,101-109`). Finding 14 raised this and explicitly deferred it as needing
   its own justification — that deferral still stands, and is worth revisiting on the merits,
   because in cold email a cliché in the subject line costs more than the same phrase in the body.
4. **The score is forgiving.** Spam hits penalise `0.4 + 0.3 × (hits − 1)`, and each other
   warning class is capped at `0.8`, so a message carrying five cliché phrases still scores 8.4
   out of 10. That is defensible for a warning rubric and indefensible if anyone reads the number
   as a deliverability prediction — which is precisely what finding 14 warned about. The number
   should either bite harder or be presented less like a grade.

Diagnosis only. Items 1–4 are proposals; none has been implemented.

### Public unsubscribe endpoint — built dormant (2026-08-15)

Migration `0010`. Opaque-token endpoint (`GET|POST /u/:token`, registered outside `/api/v1` so it
inherits neither the session plugin nor the CSRF check), `List-Unsubscribe` + RFC 8058 one-click
headers, and a footer link. **Ships dormant:** with `compliance_settings.unsubscribe_base_url`
empty — its default and the only correct value until a real sending domain exists — no link and
no header are emitted and the footer carries the operator's `optout_text` reply-`STOP` wording.

Two production defects were found by writing the tests, neither of which any existing suite could
have caught:

1. **Gmail's one-click POST would have returned 500.** Fastify registers no
   `application/x-www-form-urlencoded` parser by default, and that is exactly the content type
   RFC 8058 specifies. The failure would have been invisible from here — it happens at Google.
2. **The capability token was written to the logs on every click.** Fastify's default request
   logger serialises the full URL, and the token *is* the URL. docs/16 §8 forbids this explicitly.
   Fixed with a path-redacting `req` serializer in `config/logger.ts`. The first attempt at that
   fix spread the raw request object and dumped request bodies — including passwords — into the
   log stream; B7.1's sentinel grep (`test/api/secret-redaction.test.ts`) caught it immediately.

Design notes worth keeping: tokens are minted **per send attempt**, not per enrollment, because
storing only the sha256 makes a raw token unrecoverable, so a soft-retry cannot reuse the original
— every token issued for an enrollment therefore stays redeemable, which is also what an
honour-the-opt-out window requires. Tokens are deliberately **not** derived from `SECRET_KEY`:
rotating that key would silently kill the unsubscribe link in every already-delivered email. The
footer's plain-text and HTML forms live adjacent in `render/footer.ts` so they cannot drift
(finding 19), with a test asserting they stay semantically identical.

Gate: unit 293, web 52, integration 159, API 87, GreenMail 25, golden **47** (unchanged), mock
browser 51/51, migration `0010` down/up/down clean. The local projection dry-run reports
`checked 0 enrollments` against an empty dev database and proves only that the CLI runs.

**Not proven and not provable here:** Gmail actually rendering its native unsubscribe button and
POSTing to the endpoint. That needs a publicly reachable HTTPS URL, which the Oracle canary
deliberately does not have. Do not record the one-click flow as verified.

### Pre-canary remediation implementation notes (2026-08-09)

The completed items above are deployed and the Oracle check is recorded. The Gmail cohort remains
paused until the #13 account filters are set.

- **#3:** Scheduler blockers are exposed in System and Overview and emitted once per active
  blocker episode; the alert names the cause and next action.
- **#4–5:** Mailbox send days, start/end time, and a required IANA timezone are editable. Known
  recipient locations remain recipient-local; unknown locations use mailbox timezone, then global
  default. Capacity resets at mailbox-local midnight.
- **#6–7:** Campaign archive/delete and safe sequence delete controls use typed confirmation.
  Deletes refuse once append-only history or another dependency exists.
- **#8:** Typed-email erasure tombstones a lead, removes suppression, redacts exposed PII and
  excludes the lead from operational metrics. Backups expire on their normal retention schedule;
  an erasure must be replayed before a restored copy resumes service.
- **#9:** Tier A manual mode must be acknowledged at campaign creation, is visible in campaign
  guidance, and appears as an explicit scheduler blocker with its affected count.
- **#14:** The copy-risk rubric now transparently reports common cold-email cliché phrases in
  subject or body. It remains a warning rubric, not a deliverability predictor.
- **#15–16:** Enrollment locks serialize reply and send decisions; IMAP initializes a new or
  legacy-zero cursor from UIDNEXT so historical mailbox content is not ingested.
- **#19:** Automated and manual mail now carries matching plain-text and minimal escaped HTML
  parts, with a small but legible compliance footer.

**Still an operator pre-cohort task (#13):** add Gmail's “never send it to Spam” filter to every
canary account. The product monitors `INBOX`, not a provider Spam folder.

---

## 0. The rig

| Role | Account | Setup |
|---|---|---|
| Sender A | throwaway Gmail | 2SV → app password → **IMAP enabled** (Settings → Forwarding and POP/IMAP) |
| Sender B | throwaway Gmail | same — second mailbox is what makes rotation and redistribution testable |
| Seed recipient | throwaway Gmail | nothing. Browser access only; the app never connects to it |
| Dead address | — | not an account. A string, e.g. `zz-no-such-user-8471@gmail.com` |

Leads are **plus-addressed** off the seed (`seed+lead01@gmail.com`, …) so one inbox hosts ~20
distinct leads. Reply matching is header-based (`In-Reply-To` → stored `Message-ID`), never
sender-address matching — which is what makes this work, and what §2 verifies before anything
is built on it.

**Never commit an app password.** It is typed into the Mailboxes screen and sealed with
libsodium before it reaches the DB. `.env.prod` is gitignored; keep it that way.

---

## 1. Host and deploy (day 1)

Oracle Cloud **Always Free** ARM VM. Genuinely free with no expiry, and a real Linux box — so we
deploy the actual production stack and this doubles as a rehearsal of §7's clean-VPS drill on
real hardware.

**Verify before building anything — any one of these fails the host:**

- [x] **Outbound 587 reaches `smtp.gmail.com`** — ✅ 2026-08-07. Socket open AND a full
      STARTTLS handshake completes with a valid Google cert chain (`CN = smtp.gmail.com`,
      GTS Root R1), so a real SMTP server answers — not just an open port.
- [x] **Outbound 993 reaches `imap.gmail.com`** — ✅ 2026-08-07.
- [x] **Architecture** — ✅ x86_64, so the ARM-prebuild question is moot.

**Provisioned host (2026-08-07):** `coldemail-canary`, Mumbai (`ap-mumbai-1`, single-AD),
Ubuntu 24.04 (`2026.07.17-0`), **VM.Standard.E2.1.Micro — Always Free**, 1 OCPU / 954 MB,
46.6 GB boot. SSH key `~/.ssh/oracle_canary`.

> **Two Oracle traps hit during provisioning, both recorded so they don't cost time twice:**
>
> 1. **`VM.Standard.A1.Flex` (free ARM, 4 OCPU / 24 GB) is out of capacity** in Mumbai and
>    can't be worked around — Mumbai is single-AD, and Always Free resources only exist in the
>    tenancy's home region, so neither "try another AD" nor "try another region" applies.
>    Fell back to the x86 micro. Retry A1 later if a roomier box is wanted.
> 2. **"Create new VCN" locks the "Automatically assign public IPv4 address" toggle** and the
>    instance is created with **no public IP** — the Review page says `Public IPv4 address: No`,
>    which is the only place it's stated plainly. Reproduced on a completely clean wizard, so
>    it's Oracle behaviour, not a mis-click. Fix after creation: instance → Networking →
>    Attached VNICs → primary VNIC → IP administration → row menu → Edit → **Ephemeral public
>    IP** → Update.
>
> **1 GB RAM needs swap.** A 2 GB `/swapfile` is configured and persisted in `/etc/fstab`.
> Postgres will also need tuning down (`shared_buffers`, `max_connections`) before the stack
> runs comfortably.

**Hostname/TLS:** no domain yet, so point a free DuckDNS subdomain at the VM's IP and set
`DOMAIN` to it — Caddy then gets a real Let's Encrypt cert through the existing config,
unchanged. Caddy's internal cert plus a browser warning is a fine fallback.

**Deploy** with `docker-compose.prod.yml` + `.env.prod`, `MAIL_TRANSPORT=mock` initially, and
re-run the §7 checklist on real hardware — **all green 2026-08-07**:

- [x] All three images build (`app`, `caddy`, `backup`) — the Vite build survives 1 GB + swap
- [x] Boot ordering: db healthy → app migrates + seeds operator → app healthy → caddy starts
- [x] `GET /health` through Caddy TLS → `{"ok":true,"db":true,"version":"0.0.0"}`
- [x] App **not** reachable on the host (`:3001` refused; only caddy publishes)
- [x] SPA served (`/` → 200 html) with history fallback (`/leads` → 200 html)
- [x] Login through Caddy → `{"ok":true}` 200
- [x] Backup sidecar cron installed (`30 2 * * *`)

**Access is via SSH tunnel, not a public port** — `DOMAIN=localhost` so Caddy serves the
tunnelled host. Nothing is exposed to the internet, which matters because Gmail app passwords
are typed into this UI. iptables 80/443 are open and persisted, but the Oracle VCN security
list is deliberately left closed; opening it (4 clicks) plus setting `DOMAIN` to the public IP
is all that direct access would need.

```
ssh -i ~/.ssh/oracle_canary -L 8443:localhost:443 ubuntu@<PUBLIC_IP>   # then https://localhost:8443
```

> **Operational lesson (2026-08-07):** never `crontab -l` the backup sidecar in shared output —
> the cron line embeds `DATABASE_URL` **including the Postgres password in plaintext**. Print
> the schedule only (`grep -o '^[0-9* ]*'`). Doing this once already forced a password rotation
> (`ALTER USER` + `.env.prod` + `up -d`). The same caution applies to `docker inspect` and
> `docker compose config`, both of which render resolved env.

Only then set `MAIL_TRANSPORT=smtp_imap`. Leave `MAIL_TLS_INSECURE` unset — boot refuses it under
`NODE_ENV=production`, and it would send an app password over an unverified connection.

---

## 2. Rig setup and the go/no-go gate (days 1–2)

Add both senders through the UI (`smtp.gmail.com:587`, `imap.gmail.com:993`) → **Test
Connection** on each.

Tune for a compressed cycle:

| Setting | Value | Why |
|---|---|---|
| daily cap (per mailbox) | 5 | Keeps volume invisible to Google's abuse heuristics |
| `delivery_confirm_hours` | **1** | Integer minimum; gates every contacted-based metric |
| `poll_interval_minutes` | 5 | Default |
| sequence `wait_days` | 0 (one step at 1) | Integer; 0 keeps multi-step testable in minutes |

**The gate — one lead, before building the cohort:**

- [ ] Enroll a single `seed+lead01@gmail.com`, let it send
- [ ] Reply by hand from the seed inbox
- [ ] **`human_reply` binds to the right enrollment** — the plus-addressing assumption, on which
      the whole cohort design rests
- [ ] `Message-ID` intact in the seed's **raw** headers (Show original — never the Gmail UI)
- [ ] Re-poll appends nothing (UID high-water holds against Gmail's own IMAP)
- [ ] `[Gmail]/All Mail` duplication does not confuse the high-water logic

**If plus-addressing does not thread:** fall back to a handful of leads across genuinely distinct
recipient addresses. The cohort shrinks; nothing else changes.

---

## 3. Core walkthrough cohort (days 3–4)

**Status:** ✅ completed through the controlled Gmail cohorts and reconciliation recorded above.

~20 plus-addressed leads + 2 dead addresses. CSV import → bulk-tier → campaign → activate →
enroll. Then **four manual actions**; everything else is automatic.

| Action | Expected |
|---|---|
| Reply normally ×3 | `human_reply` → REPLIED, sequence stops |
| Reply "STOP" ×1 | `unsubscribe` → UNSUBSCRIBED + global suppression |
| Enable the seed's vacation responder, await next send | `auto_reply` → sequence **continues** |
| (nothing — the dead addresses) | `hard_bounce` ×2 → BOUNCED |

Verify:

- [x] Unibox buckets each message correctly; tag sentiments
- [x] After the confirm window: reply rate and positive rate (÷ **contacted**), bounce
      rate (÷ **distinct leads sent-to**)
- [x] Terminal outcomes sum to the cohort (REPLIED + BOUNCED + UNSUBSCRIBED + COMPLETED)
- [x] `npm run rebuild-projections -- --dry-run` → **0 drift**

Note each inbound message's UID as it arrives — that is §4's input.

---

## 4. Capture fixtures and lock them offline (days 5–6) ← *the deliverable that lasts*

This is what makes the pass permanent rather than disposable, and it is most of **B8.4**.

```bash
npm run capture-fixture -w @coldemail/server -- --mailbox 1 --list
```

```bash
npm run capture-fixture -w @coldemail/server -- --mailbox 1 --uid 42 --name gmail-real-dsn-5xx --dry-run
```

The script pulls raw RFC822 over IMAP (BODY.PEEK — non-destructive, `last_poll_uid` untouched),
rewrites every personal address to a corpus-consistent placeholder while preserving the
provider identities the classifier matches on (`mailer-daemon`, `postmaster`), prints the
mapping, and **refuses to write if any address survives unscrubbed**. Always `--dry-run` first
and eyeball the mapping before committing.

Capture at minimum: `gmail-real-dsn-5xx`, `gmail-real-vacation`, `gmail-real-reply`.

**2026-08-20 disposition:** the real Gmail reply fixture is captured and locked. A real Gmail
hard-bounce DSN and vacation/OOO fixture are formally deferred because no matching existing
message has been identified for read-only capture. Do not create a bounce or enable/send to an
autoresponder merely to obtain a fixture; capture them later only from pre-existing mail or under
a separately approved owner-address test.

Then wire them in:

- [~] `test/helpers/emlFixtures.ts` — real reply present; DSN/OOO deferred as above
- [~] `test/unit/header-fixtures.test.ts` — reply assertions present; DSN/OOO deferred
      recipient, `Auto-Submitted`, threading headers), mirroring the existing `it.each` blocks
- [~] Diff real wording against the hand-written fixtures; no DSN/OOO source message yet
      `poller/` wherever Google's actual text differs from the guess

**Gate:** `npm test` fully green with the new fixtures and any pattern changes in, and
`npm run test:golden` untouched at **47**.

---

## 5. Failure cohorts (days 7–9)

Each needs its own cohort — they cannot share one with §3. Reset with `test/ops/e2e-reset.ts`.

**Status:** ✅ completed or superseded by the findings log. The old redistribution scenario was
invalid: unstarted work is never assigned, so rotation already selects a healthy mailbox.

- [x] **Auto-pause on bounce rate**
- [x] **Mailbox rotation** across both senders
- [x] **Failed-mailbox behavior** — unassigned work rotates; started threads remain pinned
- [x] **Suppression enforcement** at all four layers (ingest, selection, send, append)
- [x] **Recycle hash guard** blocks repeated content and names the steps
- [x] `--dry-run` → 0 drift

---

## 6. Time-based scenarios (days 10–11)

These need the host up, which is why this is not on a laptop.

- [x] **Stale-poll** — break IMAP credentials, leave past `stale_poll_hours` (6) → `imap_stale`
      + pause + alert; reconnect → polling resumes **without a restart**
- [x] **Catch-up / never-burst** — stop the app several hours, restart, confirm the backlog is
      paced not dumped (expect a `catchup_backlog` alert)
- [x] **Backup freshness** — daily self-check alerts on a dump older than 26h
- [x] **`auth_failed` → reconnect** registers the mailbox poll at runtime

### §6a Catch-up/never-burst result (completed 2026-08-20 UTC)

The operator approved one dedicated campaign, owner-controlled recipients only, at most four sends,
and an immediate pause at the bound. The app was intentionally unavailable for **10,833 seconds**
so overdue work existed at restart.

1. Record a database snapshot plus current settings, mailbox states/caps, campaign state, event
   watermark, and projection dry-run (must be zero diffs).
2. With workers stopped, create or prepare only the approved owner-address cohort so its sends are
   overdue by several hours. Keep the API/public service state unchanged unless included in approval.
3. Restart workers once. Record every scheduler tick and accepted-send timestamp; stop/pause at the
   approved maximum even if backlog remains.
4. Prove: a `catchup_backlog` alert exists; no mailbox emits more than one message per tick; every
   same-mailbox gap respects `minGap × (1 - jitter)`; daily/resume caps are not exceeded; timestamps
   span paced ticks rather than one restart burst.
5. Pause the campaign, reconcile enrollment/mailbox/alert/event state, and run self-check plus the
   projection dry-run (both clean/zero-diff required).
6. Only after the evidence is saved, restore the pre-canary safety settings from the recorded
   snapshot and verify them read-only. `delivery_confirm_hours` must be restored before deploying
   migration 0013, because it becomes immutable after sends exist.

**Verified result:** four sends were accepted in two waves, one per mailbox per scheduler tick.
Each mailbox sent exactly twice; the same-mailbox gap was **925 seconds**, so there was no restart
burst. One `catchup_backlog` alert was recorded. The campaign remained paused with four completed
and four unsent enrollments. Before and after restoration/deployment, projection dry-runs returned
`checked 24 enrollments — 0 diff(s)` and self-check found no violations. The final deployment was
healthy at `4e9e125`; the safe values in the table above were verified read-only. A new custom-format
backup (`coldemail-20260820-202421.dump`, 2,340,613 bytes) was created and its catalog passed
`pg_restore --list`; there were no failed jobs created during the scenario.

**Verifier corrections:** the first evidence query incorrectly grouped by
`attributes.mailbox_id`; canonical mailbox identity is `events.mailbox_id`, which is why that query
falsely reported four sends on one mailbox and a zero gap. The production backup script is installed
at `/usr/local/bin/backup.sh`, not `/backup.sh`. Corrected evidence is preserved in the restricted
Oracle log.

---

## 7. Wrap (days 12–14)

Slack, deliberately — something will surprise us, and Gmail's IMAP is the likeliest source.

- [x] `PROGRESS.md`: tick B8.3-local, add a dated log entry
- [x] `docs/16` §5: mark which canary lines are now proven against real Google, and which still
      require warmed domains
- [ ] Merge to `main`: **fixtures, classifier patches, the capture script** — yes. Throwaway
      settings values and host-specific scratch — no.

The branch is prepared and pushed for review. Merge to `main` remains deliberately unchecked
because no merge approval was given.

---

## What this cannot test — no amount of time helps

| | Why | Already covered |
|---|---|---|
| `provider_blocked` | Needs 5 consecutive throttles. Cannot make Google rate-limit at 5/day, and trying is exactly the abuse signal to avoid | `scheduler/providerBlock.ts` unit + scenario |
| Soft bounce / greylisting | Gmail does not greylist predictably | Offline classifier suites |
| Deliverability | Structural — `@gmail.com` borrows Google's reputation | The real canary, §5 + §6a |
| Real multi-day cadence (0/3/4/5) | Would consume the window to prove what `VirtualClock` proves in ms | Golden L3 |

## Account hygiene

- Use each sender manually in a browser first, let it sit a day, **then** point the app at it. A
  brand-new account doing programmatic SMTP is the pattern that draws scrutiny.
- Hold caps at 5/day.
- Capture the bounce DSN a handful of times — **never in a loop**. Repeatedly mailing a
  nonexistent address is a spam signal.
- Only ever send to addresses you control. Realistic worst case is a browser security challenge,
  not deletion — but do not use an account you care about as a sender.
