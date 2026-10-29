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

**2026-10-29 mailbox cap repair verified:** explicitly requested mailbox 2 restoration
changed only `resume_cap` 12→NULL; configured/effective capacity is 25/day and status remains
`ok`. Global resume percentage was already 100. Fresh production state has Campaigns 3/4
active, Campaign 2 paused, Campaign 1 archived. Validated pre/post backups, 551-enrollment
zero drift and clean self-check pass; see docs/17. No code deployment or campaign/status/
enrollment/history change was performed. Do not infer paused state from older checkpoints.
Mailbox action response-contract and saved recovery-percentage fixes are verified locally:
type/lint/format/build, web 6, API 13, browser 8 and locked golden exactly 47 pass.
No migration; code deployment and any campaign pause remain separately gated. See docs/17.

**2026-10-12 business-day scheduling deployed:** explicitly authorized push/deploy at `bc0f1e0`,
with separately authorized Campaign 3 pause. All 35 migrations, healthy services/routes,
production sequence/preview contracts, 222-enrollment zero drift/self-check and validated
pre/post backups pass. Stable paused snapshot remains 969 events / 346 sends; enrollment,
pending dates, holds/delays, retries, suppression, copy/settings and deletion manifest match.
Campaigns 2/3 remain paused; automatic enrollment off. Sequences remain elapsed_days with
their existing waits; no live preset/recalculation, resume, enrollment or outbound mail occurred.
Authenticated browser replay is unverified: computer-use policy stopped browser control because
the current URL could not be identified confidently. See docs/17. Live schedule application
and further operations remain separately gated.

**2026-10-12 business-day scheduling — verified locally:** docs/27 implemented on `canary`.
Opt-in weekday timing and editable 0/3/14/4/4 preset; guarded preview/apply recalculates
pending follow-ups with immutable facts/receipts, preserving holds/delays/retries/history.
Migration 0034 defaults to elapsed days and preserves policy/audit records on rollback.
Local gates, locked golden exactly 47 and populated nine-enrollment zero drift/self-check/
manifest-aware backup restore pass; see docs/17. No push/deploy, production schedule/campaign/
enrollment mutation, resume or external outbound mail occurred. Further live operations
remain separately gated. Preserve absent elapsed-mode runtime vocabulary for legacy Stop fingerprints.

**2026-10-10 Bruce/Lori repair completed:** explicitly authorized metadata scan restricted to
messages 2140/2135, full-content recovery and confirmed links to enrollments 83/217.
Both appear in Needs review as Held for review; automatic labels/authorship and all progress/
schedules/retry history preserved. Only review facts 893/894 appended; 894 events / 346 sends.
222-enrollment zero drift/self-check and validated pre/post backups pass. Campaigns 2/3 remain
paused, automatic enrollment off. No acknowledgement, sending decision, resume, enrollment or
outbound mail occurred. Other historical scans/recovery/linking require their own authorization.
See docs/17.
**2026-10-10 Possible replies deployed:** explicitly authorized push/deploy of release
`48d931d` (feature source `5ba304d`), plus separately confirmed Campaign 3 pause.
Campaigns 2/3 remain paused, automatic enrollment off. All 34 migrations, healthy services/
public routes, production queue/summary contracts, 222-enrollment zero drift/self-check and
validated pre/post backups pass. Stable post-pause snapshot remains 892 events / 346 sends;
enrollment, sent/retry history, suppression, settings and deletion manifest match. No historical
scan, Bruce/Lori recovery/linking, enrollment, resume or outbound mail occurred. Authenticated
Unibox replay passes after operator sign-in. See docs/17. Future live operations remain separately gated.

**2026-10-10 possible replies — verified locally:** source `5ba304d` on `canary`; follow docs/26.
Subject/company candidates appear in existing Unibox views; only explicit confirmation applies
review holds. Selective capture, counts/freshness, dismissal/Undo and metadata tooling pass local
gates, locked golden exactly 47 and nine-enrollment zero drift/self-check; see docs/17. No push/
deploy, live metadata scan, Bruce/Lori recovery/linking, campaign mutation or send is authorized
or performed. Preserve historical records, suppression and deletion-manifest safeguards.

**2026-10-09 follow-up priority deployed:** explicitly authorized push/deploy at `76292e9` on
`canary`, with separately authorized Campaign 3 pause. Campaigns 2/3 remain paused, automatic
enrollment off. Healthy services/routes, authenticated priority guidance, all 33 migrations,
213-enrollment zero drift/self-check and validated pre/post backups pass. Stable snapshot stays
810 events / 273 sends; full enrollment state, suppression, caps/windows/ranges and deletion
manifest unchanged. No enrollment, resume or outbound mail occurred. See docs/17. Future live
operations require their own authorization.

**2026-10-09 follow-up priority — verified locally:** follow docs/25-followup-priority-plan.md.
Due follow-ups precede openers by effective due time; shared mailbox-local reservations protect
later-today follow-ups and limit enrollment. Capacity overrides are rejected. Source f2e1ec5 and
2269f00 pass local gates, locked golden exactly 47 and populated nine-enrollment zero drift/
self-check; see docs/17. No migration or new event type. History and schedules are preserved.
No push, deployment, live enrollment, resume or outbound send authorized or performed.

**2026-10-08 personalized restoration follow-up deployed:** explicit operator approval pushed
and deployed application `3c90050` on `canary`. Campaigns 2/3 remain paused, automatic enrollment
off. All 33 migrations, healthy services/routes, authenticated simplified Unibox and Debra's
reason-free Confirm dialog pass. Production dry-run checks 187 enrollments with zero drift;
self-check clean. Stable snapshot remains 650 events / 222 sends; five suppressions, enrollment
progress, mailbox caps/windows/ranges and the independent deletion manifest are unchanged.
No restoration, acknowledgement, content deletion, enrollment, resume or send was performed.
See docs/17 for backup evidence. Future production actions require their own authorization.


- **2026-10-08 personalized restoration and Unibox simplification — verified locally:** the
  operator removed Reminders/Needs linking and reminder/link-correction reader controls from
  current UI scope. New unmatched mailbox traffic retains minimal identity metadata without
  saved body/HTML/extracted text/preview; preserve existing records and compatibility APIs.
  Personalized restoration verifies the saved sent snapshot and campaign copy rather than
  template variants. Restore/correct Stop uses a simple Confirm, without a user-entered reason;
  a standard confirmation fact retains ledger compatibility. Restore only to review, never
  automatically continue or send. Local commits `6bbbbdc`, `50e2218` and retry provenance
  `b9aed65`; focused/full gates,
  locked golden exactly 47 and nine-enrollment zero drift/self-check pass. See docs/17 and docs/24.
  This local checkpoint was subsequently deployed under explicit approval as recorded above; do not
  restore/resume/enroll/send or delete existing records as part of it.

- **2026-10-08 incoming review/Unibox deployment — verified:** operator explicitly authorized
  push/deploy and pausing Campaign 3. Application `8e65e46` is deployed on `canary`; all 33
  migrations, healthy services/public routes, authenticated Unibox/navigation/notifications,
  187-enrollment zero drift/self-check and validated paused pre/post backups pass. Campaigns 2/3
  remain paused, automatic enrollment off; operational snapshot remains 649 events / 222 sends.
  Existing enrollment progress, sent/retry history, four suppressions, caps/windows and actual
  5–10 minute mailbox ranges are unchanged. Independent deletion manifest was safely initialized
  only after verifying no previous deletion history. No historical recovery/replay/restoration,
  acknowledgement, notification clearing, enrollment, resume or outbound send occurred.
  Preserve manifest/restore safeguards and use only review-aware rollback code. See docs/17.

- **2026-10-08 incoming review/Unibox redesign — locally implemented and verified:** follow
  `docs/24-incoming-review-unibox-redesign-plan.md`. Prospectively replace automatic terminal
  human/company reply stopping with review holds and mandatory clear-opt-out suppression.
  Continue/Stop/Delay are campaign actions; Suppress is permanent globally, including manual
  mistakes. Retain minimal suppression during erasure. Preserve legacy event interpretation and
  blocked histories; restore eligible legacy enrollments only explicitly, to review hold first.
  This supersedes conflicting historical reply/disposition/removable-suppression scope below.
  Original implementation scope was local only. The later push/deploy authorization above
  supersedes that boundary; historical replay/restoration/enrollment/resume/send remain gated.
  All stages in docs/24 and local gates are complete; docs/17 records evidence. Production uses
  the review release above. Deployment requires the manifest/bootstrap/restore
  safeguards in docs/16 and review-aware rollback code; no old ignoring-holds binary is safe.

- **2026-10-08 IST signature/range/alias deployment:** separately authorized, pushed/deployed at
  `cd83228` on `canary`. All 28 migrations, healthy services, direct website aliases,
  app/OAuth/unsubscribe routes, 187-enrollment zero drift/self-check and validated pre/post backups
  pass. Address inclusion is off; saved address retained and role wording updated. Four healthy
  mailboxes use 4–7 minute ranges and minute checks, still 20/day. Campaigns 2/3 remain paused,
  automatic enrollment off; watermarks remain 506 events / 158 sends. Authenticated mailbox
  range/edit controls pass after operator sign-in without saving settings. No CSV operation,
  cap/window edit, resume, enrollment or send occurred. VPS disk is 42% used, 14 GiB available;
  about 935 MB build cache is reported reclaimable. No cleanup performed. See docs/17.

- **2026-10-07 signature/range/alias update — local only:** operator-authorized implementation
  starts Include postal address off, retains the saved address and uses the requested role/domain
  layout. Mailboxes use editable 4–7 minute ranges, with one persisted random deadline committed
  atomically per accepted send. Migrations 0026/0027 retain configuration/deadlines on rollback.
  The reviewed Caddy fragment directly serves the same portfolio build on both outreach domains
  and their www hosts, preserving app/OAuth/unsubscribe routing. Repository/browser/golden gates,
  five-enrollment zero drift/self-check and populated backup restore pass; docs/17 records evidence.
  No push, deployment, VPS/Caddy/DNS change, production settings/cap/campaign/enrollment change or
  outbound mail occurred. Production's last verified release remains `a6489a9`. Deployment needs
  separate authorization, a fresh paused-state check, captured settings/watermarks, validated backup
  and preserved Caddyfile. Leave campaigns paused after separately authorized rollout; resume is
  the operator's action. Do not infer paused state from this local verification or pause implicitly.

- **2026-10-07 fixed-spacing deployment:** separately authorized, pushed and deployed at
  `a6489a9` on `canary`. All 26 migrations, services/routes/caching, 113-enrollment zero drift,
  self-check and validated pre/post backups pass. Authenticated Mailboxes shows the interval column
  and edit control; no settings were saved. Campaign 3 remains active, auto-enrollment off;
  four healthy mailboxes remain 20/day with intervals unset, preserving legacy pacing until the
  operator chooses a value. Watermarks remain 422 events / 148 sent. No campaign, cap, interval,
  enrollment or send change occurred. See docs/17 for deployment evidence and operator handoff.

- **2026-10-07 fixed mailbox spacing — local only:** operator-authorized implementation adds
  **Time between emails (minutes)** per mailbox, independent of its window/cap and without jitter.
  Migration 0025 preserves existing pacing until an interval is saved and retains values on rollback.
  Four mailboxes at four minutes reach 20/25 each in focused scenarios, with caps, carry-forward,
  downtime and restart checks. Repository/browser/golden gates, populated zero drift/self-check
  and backup restore are verified in docs/17. An existing draft-review sign-off regression was
  also corrected without changing saved copy. No production setting, campaign, enrollment or send
  was changed; deployment and live spacing/cap changes require separate operator authorization.

- **2026-10-07 read-only send diagnosis:** Campaign 3 is active after operator actions,
  automatic enrollment off. October 6 sent 19/19/18/18: 24-minute base pacing plus 20% jitter
  and five-minute ticks exhausted the window. Six Ready, unsuppressed Step 1 leads remain due;
  five incoming-mail stops affect already-contacted leads. Watermarks are 422 events / 148 sent.
  No agent campaign/settings/enrollment/send change or pacing fix occurred. See docs/17.

- **2026-10-06 four-part deployment:** separately authorized, pushed and deployed at `b721684`
  on `canary`. All 25 migrations, services/routes/version caching, 93-enrollment zero drift,
  self-check and validated pre/post backup catalogs pass. Production Ready-copy rendering verifies
  exact signature lines and actual mailbox domain in text/HTML. Campaigns 2/3 remain paused with
  automatic enrollment off; watermarks stay 245 events / 74 sent messages. The policy cutoff is
  `2026-10-06T06:41:30.403034Z`. No production CSV operation, enrollment, resume or send occurred.
  Authenticated browser replay passes after operator sign-in: settings, all 100 preview leads,
  Ready follow-up rendering with the actual mailbox domain, and refresh without a false banner.
  Subsequently authorized VPS build-cache cleanup completed: cache is zero, actual disk recovery
  is 2.94 GB, disk usage fell from 47% to 35%, and services remain healthy. Data/backups are intact.
  See docs/17 for measurements, backups and remaining operational boundaries.

- **2026-10-06 four-part local release:** operator-authorized implementation on `canary`
  adds build-ID update detection, newly received company-mail stopping, protected CSV campaign
  copy updates, and the requested four-line signature without automatic opt-out body wording.
  This supersedes earlier instructions to retain the automatic footer. Existing unsubscribe
  headers/endpoints, explicit opt-out suppression, sent history and saved retry bodies remain.
  Local gates, populated replay/self-check and backup restore are verified in docs/17.
  The operator reports the campaign paused; no production mutation, CSV upload, outbound mail,
  activation/enrollment/resume, push or deployment occurred. Deployment needs separate explicit
  authorization, a fresh paused-state check and validated backup. At that checkpoint production
  remained `4b4e0c7`; the separately authorized deployment above supersedes that release status.
  STOPPED facts and the policy cutoff survive rollback; only use rollback code that understands
  the new vocabulary after such facts exist. Production CSV commit and resume remain separate.

- **2026-10-05 Sequence picker repair:** explicitly authorized, verified, pushed, and deployed
  at `4b4e0c7` on `canary`. Preview lead search now scopes available pooled and enrolled leads
  to the selected campaign and supports pagination. Live replay shows all 100 Campaign 3 leads
  and renders a Ready second-page copy. Health/routes, 22 migrations, 93-enrollment zero drift,
  self-check, and backup catalogs pass. Event/sent counts stay 208/58 through deployment; no
  campaign/enrollment/mailbox-setting change or send occurred. See docs/17.

- **2026-10-05 operator activation follow-up:** the operator reports activating Campaign 3 and
  enrolling its leads after the transfer below; the authenticated UI confirms it is active and
  a new-cohort Step 1 copy is already sent. The agent rendered that saved copy read-only to
  diagnose the Sequence picker. No agent activation, enrollment, campaign edit, or send occurred
  during this follow-up. Inspect current state before further operations; the transfer-time
  draft/zero-enrollment snapshot below is historical. Further mutations remain separately gated.

- **2026-10-05 authorized 100-lead campaign transfer:** created draft Campaign 3,
  **US Property Management — Batch 100**, on the existing five-email sequence, with all ramp
  stages and permanent cap at 100/day. Paused the completed pilot Campaign 2 and moved exactly
  its 100 Available leads through the guarded reassignment UI. Campaign 3 has 100 Available
  leads and 500 identical Ready copies; automatic enrollment is off and no activation or
  enrollment occurred. Campaign 2 retains its 12 historical enrollments and is paused.
  Health, 13-enrollment zero drift, self-check, and pre/post backup catalogs pass; watermarks
  remain 124 events / 54 sent messages. No outbound mail occurred. Existing mailbox caps of
  20/day each and the global campaign ceiling of 100 were observed, not changed. Activation,
  enrollment, auto-enrollment, and an outbound batch still require separate authorization.
  See docs/17 for exact reconciliation and pool provenance behavior.

- **2026-10-05 import campaign selector repair:** explicitly authorized, verified, and deployed
  at `988adc0` on `canary`. CSV allocations permit active campaigns with automatic enrollment
  off as well as draft/paused campaigns; archived and active auto-enrollment targets remain
  excluded. Preview/commit enforce the same guard, with a campaign row lock during commit.
  Production's saved 100-row Import 3 preview verifies 100 allocatable leads and 500 bound copies.
  Health/routes, 13-enrollment zero drift, self-check, and pre/post backup catalogs pass;
  watermarks remain 124 events / 54 sent messages. No live import, enrollment, or send occurred.
  The current audit reports six runtime dependency findings; remediation remains separate.
  See docs/17. This repair does not authorize a new cohort, enrollment, or outbound batch.

- **2026-09-27 plain-text email mode:** the operator-approved release is verified and deployed
  on Spaceship at `d6f3e1b`, with migration `0021`. New messages default to text/plain only; Minimal HTML
  remains optional. Drafts ending in `Best,` join the automatic signature on the next line, and
  the default role is `Automation Specialist`. Sequence previews show the complete text message.
  Both template and personalized retries retain their saved bodies and format; legacy HTML rows
  stay HTML. The full local gate and deployment evidence are in docs/17. Production migration,
  health/routes, 13-enrollment zero drift, self-check, and pre/post backup catalogs pass. The
  unsubscribe URL remains blank, the event/sent watermarks remain 104/44, and deployment emitted
  no mail. The operator subsequently authorized cleanup of the 17 unsent pilot sign-offs; the
  verified live-copy outcome is recorded in docs/17.

- **2026-09-27 automatic sender signature:** implemented locally with migration `0020`, editable
  global signature name/title, sending-mailbox plain-text domain, matching previews, and unchanged
  blank-URL/text versus configured-URL/link behavior. Verification and release handoffs are in
  docs/17. Explicitly authorized deployment completed at `767b964`; migration 0020, health/routes,
  13-enrollment zero drift, self-check, and pre/post backup catalogs pass. Live opt-out is text-only.
  At that deployment, 43 pilot copies were sent and 17 unsent copies retained `Sambhav`,
  which duplicated the new signature until the separately authorized cleanup recorded above and
  in docs/17. Sent history remains intact (44 total sends); deployment emitted no mail.

- **2026-09-23 footer plain-text and muted presentation update:** the operator-approved
  footer change softens text color from `#595959` to `#767676`, retaining 10px, 20px top
  separation, and 1.5 line height, and sets default opt-out copy to "Prefer I don't reach out?
  Just let me know or reply stop.". Previews and renderer reflect the muted gray. Typecheck, lint,
  format, unit 348/348, web 67/67, and production web build pass. No migration or send occurred.
  Live campaigns stay active; remaining steps pick up the new footer at send time.

- **2026-09-14 IST bounded prospect authorization:** the operator explicitly lifted the
  owner-address-only send restriction for **Campaign 2 / Import 2 lead IDs 2–13 only**, authorizing
  activation, enrollment, and their existing five-email pilot sequence. UI activation/enrollment
  succeeded; Campaign 2 is active, automatic enrollment remains off, and exactly 12 leads are
  ACTIVE with complete Ready copy. Mailboxes remain 3 total messages/day each, New York weekdays
  09:00–17:00. Zero-drift replay checks 13 enrollments; self-check and pre/post backup catalogs pass.
  No pilot mail had been sent at Sunday verification; sending awaits Monday's window. This narrow
  authorization supersedes the older keep-draft/owner-only statements for this cohort only.
  All other prospects, campaigns, new cohorts, auto-enrollment, and cap increases remain separately
  gated. Do not infer runtime receipt or mailbox balance from enrollment. See docs/17.

The Spaceship production infrastructure is live, but the project remains in **pre-prospect-send
commissioning** until the operator completes the handoffs below:

- **2026-09-13 pilot CSV import:** the operator-authorized UI import created 12 Tier B leads,
  60 reusable sources and 60 campaign-step copies. After explicit authorization, F-W35 was
  pushed and deployed at `9f1ada0`, and a guarded Import 2 transaction made all 60 sources and
  all 60 campaign copies Ready without changing content/history. Campaign 2 remains draft,
  auto-enrollment off, now pool-only, with 12 available leads and unchanged one historical
  enrollment/sent event. Zero drift, self-check, and the 859,826-byte backup catalog pass.
  F-W34 is implemented, fully verified, pushed, and deployed at `61a5b15`: personalized previews
  now use the scheduler's nearest preceding
  new-conversation selector, so Step 4/5 subjects follow Step 3. The regression reproduces the old
  mismatch and passes after the fix without changing saved copy or events. The complete local
  gate passes, including API 145/145, locked golden 47/47, and real-backend E2E 1/1. Production
  Step 4/5 previews both use the imported Step 3 subject. F-W35 changes future valid CSV copy to
  Ready automatically and removes the import readiness choice; the complete local gate passes
  (including 500/500 Ready sources and campaign copies). Production health/routes, 20 migrations,
  one-enrollment zero drift, self-check, runtime audit zero, and pre/post backup catalogs pass.
  Authenticated coverage shows 12 Ready and zero review/missing/blocked for every step.
  Keep the pilot draft; activation and every outbound batch remain separately gated.
  No activation, enrollment, or send was authorized or performed.

- **2026-09-13 CSV/mail runtime security update:** the separately approved dependency update is
  fully verified, pushed, and deployed at `baac951` on `canary`: csv-parse 7.0.2, Nodemailer
  9.1.1, Mailparser 3.9.20, and ImapFlow 1.6.0. The full serial gate, clean Linux image,
  zero-runtime audit, populated five-enrollment restore drill, production routes/health,
  one-enrollment zero drift, self-check, and validated pre/post backups pass. The authenticated
  campaign/mailbox UI loads; four healthy mailboxes remain 3/day, New York weekdays 09:00–17:00,
  Campaign 2 remains draft/auto-enrollment off with 12/day caps, and current leads remain zero.
  The saved bounce guards are 25 minimum sends, 4% over 50, 2 in 10, and 50% resume cap.
  Ten development/build audit findings and F-T01 remain separate; runtime findings are zero.
  No import, allocation, activation, enrollment, or send occurred. CSV import is the next
  operator handoff; activation and every outbound batch remain separately gated.

- **2026-09-13 conversation-scoped threading:** the operator-approved F-W33 fix is implemented,
  fully verified, pushed, and deployed at `33bad55` on `canary`. Continued steps now use the exact
  subject and message-ID chain of the nearest preceding new-conversation step, so
  new/continue/new/continue/continue produces two independent conversations. The complete local
  gate, production health/routes, zero drift, self-check, and validated pre/post backups pass; no
  lead or send was created. The runtime advisories found during that rollout are resolved by
  the separately verified and deployed CSV/mail update above. Do not run a forced audit rewrite.

- **2026-09-13 12-lead pilot staging:** production mailboxes 1–4 are `ok` and temporarily capped
  at 3 messages/day each with `America/New_York`, Monday–Friday 09:00–17:00 windows. Campaign
  **US Property Management** (`campaign_id=2`) remains `draft`, automatic enrollment is off, and
  every stage plus both permanent caps are 12/day. There are zero current leads; the single
  historical enrollment and sent event are unchanged. UI/database reconciliation, zero drift,
  self-check, and the 790,702-byte backup catalog pass. No import, pool allocation, activation,
  enrollment, or send is authorized by this staging change.

- **2026-09-04 unsubscribe presentation follow-up:** the operator-approved compact footer change
  is implemented, verified, pushed, and deployed at `0a2f3c0` on `canary`: the 10px two-line structure, 20px separation,
  `#595959` color, and 1.5 line height remain, while **Unsubscribe** is now bold, gray, and not
  underlined. The destination, plain-text URL, token flow, RFC 8058 headers, address, and Gmail
  trimming behavior are unchanged. Typecheck/lint/format, unit 346/346, web 67/67, focused
  renderer/UI tests, and the production web build pass. Deployment health/routes, served asset and
  renderer markers, 20 migrations, empty live state, zero drift, self-check, and pre/post backup
  catalogs pass. No mailbox, lead, campaign, enrollment, event, or send was created.

- **2026-09-04 operator-requested fresh workspace:** after the final five-lead owner-address
  canary completed, production's populated `coldemail` database was preserved intact as
  `coldemail_canary_archive_20260904` and a new empty `coldemail` database was initialized through
  all 20 migrations. The live workspace has zero leads, campaigns, sequences, enrollments, events,
  mailboxes, imports, suppressions, alerts, or message rows. The existing operator login and
  compliance address/unsubscribe configuration were carried forward. Defaults are now
  `America/New_York`, enforced send windows, automatic/global opt-out suppression, five-minute
  scheduler and poll intervals, 20% jitter, a 30/day mailbox configuration ceiling, a 15/day
  campaign-enrollment ceiling, and a mandatory seven-day ramp. The pre-reset and post-reset dumps
  both pass catalog validation; app/database health, running gateway/backup services, public
  app/portfolio routes, zero-drift, self-check, and authenticated empty-state Leads/Mailboxes UI
  pass. This reset is not authorization to add mailboxes, import leads, activate, enroll, or send.

- **2026-09-03 remaining UI findings:** operator-approved F-W26–F-W31 are implemented and
  verified, pushed, and deployed at `c75a385` on `canary`. They clarify lead-level confirmation,
  campaign provenance/default selection, Cold Storage source selection, sent-copy audit subjects,
  and personalized-preview prerequisites. The complete serial test gate and populated five-lead
  zero-drift/self-check/scratch restore pass; docs/17 records the evidence. No migration,
  scheduler, transport, footer/header, event-ledger, or production-state change was made.
  Production health/routes, ten-enrollment zero drift, self-check, backup catalogs, and unchanged
  24-send watermark pass. Authenticated UI replay is pending due to browser-tool
  `ERR_BLOCKED_BY_CLIENT`. Runtime `fast-uri` (high) and `fastify` (moderate) audit advisories
  are resolved in the separately authorized, locally verified Fastify 5.12.1 / fast-uri 3.1.7 and
  4.1.4 release deployed at `552fab8`. Its full test gate, clean Linux app image, zero-runtime
  audit, and populated restore drill pass. Eight development/build audit findings and F-T01's
  missing MSW copy-coverage fixture remain separate. Read-only authenticated Overview/Leads now
  loads; a post-deployment authenticated replay remains pending. Production routes/containers, 20
  migrations, zero drift, self-check, four mailboxes, zero sendable work/error alerts, unchanged
  24-send history, and pre/post backup catalogs pass. See docs/17. No new send batch is authorized
  by this dependency deployment; precisely bounded owner-address sends remain separately gated.

- **The authorized feature scope** includes the completed operator-approved 2026-08-15 list plus
  the 2026-08-20 pre-domain safety backlog: mandatory reply stopping; reply dispositions and
  conservative suppression; guarded cross-campaign recontact; broader opt-out phrases; findings
  20–25; alert history and mailbox filters; arbitrary custom-field editing; copy-risk rubric
  improvements; local verification; and runbook/documentation reconciliation. Outside that list,
  work is limited to testing, verification, diagnosis, and documentation.
- The operator-approved Personalized Copy/two-tier/campaign-lead-filter release and its 2026-08-31
  import-wizard clarity follow-up are implemented, fully verified, pushed, and deployed on
  Spaceship; production is now at Sequence-preview follow-up `a8c2e65` through migration `0019`.
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
  `c31d73b`. No migration, campaign/enrollment mutation, or send occurred. A separately authorized
  post-deployment owner-controlled follow-up proved that Gmail desktop still collapses the complete
  redesigned footer behind **Show trimmed content** and exposes no native unsubscribe control; the
  message landed in Promotions. The operator accepts Gmail trimming as a provider-controlled
  limitation, retains the footer and RFC 8058 headers unchanged, and does not want duplicate
  unsubscribe language inside the sales copy. Deployment verification briefly observed
  DNSSEC `SERVFAIL` on both Spaceship-managed outreach domains. Registrar DS values exactly matched
  the served DNSKEY tags/digests, and Google, Cloudflare, Quad9, system resolution, and the complete
  public route matrix recovered without a configuration change. Keep DNSSEC enabled; treat this as
  a transient provider incident unless it recurs.
- The F-W25/F-W32 Sequence-preview follow-up is implemented, verified, pushed, and deployed at
  `a8c2e65`. Configured unsubscribe-link previews use a permanently non-resolving `.invalid`
  placeholder without creating a capability token, and Sequence dirty state now compares the
  effective write payload with its saved baseline so reverted edits become clean. It changes no
  migration, scheduler, transport, footer/header behavior, production data, campaign, enrollment,
  or send state. Deployment health/routes, 20 migrations, zero drift, self-check, backup catalogs,
  the unchanged 24-message sent watermark, and an authenticated read-only UI replay pass.
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
  **Show trimmed content** and on mobile behind **Show quoted text**. The deployed remediation uses
  a two-line presentation-table footer with the operator-approved 10px/blue-link/dark-gray
  treatment and no hidden variation. A separately authorized post-deployment Aurora Step 3 was
  accepted exactly once; its immutable snapshot proves the production HTML/text renderer is
  correct, and the campaign was paused before Step 4. The operator's desktop observation proved the
  full redesigned footer remains behind **Show trimmed content**. This is now an accepted provider
  limitation rather than an open renderer defect. Gmail exposed no native unsubscribe control.
  Gmail's **Show original** source proves SPF/DKIM/DMARC
  passed, both RFC 8058 headers arrived, and the passing domain DKIM signature covered both. The
  native provider UI and resulting mailbox-client POST remain unverified because Gmail withheld
  the control. The Promotions placement is an observation, not proof of domain-reputation damage.
  The deployed UI clarification preserves the existing `in_thread` behavior but
  replaces its ambiguous switch with explicit **Continue existing conversation** and **Start new
  conversation** choices; it does not alter the footer, headers, renderer, scheduler, or sales copy.
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
- Deployed application release: `canary` at `cd83228`

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
remediation, the 2026-09-02 footer remediation at `c31d73b`, and the conversation-choice
clarification at `6c2c390`. The clean checkout is on the
one-word `canary` branch. Public DNSSEC validation and the route matrix are healthy: the app route
and direct SPA routes return 200; the bare app path canonicalizes; both outreach roots redirect
308 to `https://sambhavbuilds.com/`; unsubscribe roots return 404; and the portfolio returns 200.
A transient DNSSEC `SERVFAIL` observed during the rollout cleared without a configuration change.

- db/app/gateway/backup containers are healthy; only `127.0.0.1:18080` is published
- the 2026-08-31 deployment baseline was four healthy OAuth mailboxes, one global lead, two draft
  campaigns, and zero enrollments. Later separately authorized owner-address walkthroughs produced
  24 sent events total; the latest was exactly one Aurora Personalized Step 3 at 2026-09-02
  15:10:36 IST. Aurora was paused before the following scheduler tick and Step 4 remains held.
  Earlier runs proved body-link unsubscribe, reply `STOP`, global suppression, and reply ingestion.
  No prospect was contacted. Inspect current live state before any operational action; do not infer
  it from the earlier dormant snapshot
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
- production application and mailbox fallback timezones are `Asia/Kolkata`; all four mailboxes use
  the same Mon–Fri 10:00–18:00 send window as of the latest walkthrough
- the business postal address and unsubscribe template are configured; body-link confirmation is
  proven on an owner-controlled address. The 2026-09-02 owner-address canary verified the negative
  Gmail result: follow-up footer content is collapsed on desktop and mobile, and no native
  unsubscribe control appeared. The footer remediation is deployed and the post-deployment sent
  snapshot is correct; desktop post-deployment visibility failed and the operator accepted Gmail's
  client-side trimming. The received original verifies RFC 8058 header presence and DKIM coverage,
  while Gmail's native UI and client-initiated POST remain unverified

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
