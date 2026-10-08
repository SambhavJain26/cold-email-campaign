# Local canary runbook (B8.3-local) — two-week validation on throwaway Gmail

## 2026-10-08 IST incoming review push/deploy — prechecks pass, pause approval pending

The operator authorized push and deployment of the verified redesign. GitHub `origin/canary`
advanced from `2d9bc29` to candidate `84403e4`. Production remains clean at `cd83228`; no source
fast-forward, service restart, migration or manifest initialization has occurred yet.

Fresh prechecks contradict the previous deployment-time paused snapshot: Campaign 3 is active,
Campaign 2 paused and Campaign 1 archived; automatic enrollment is off. There are **649 events /
max ID 649 / 222 sent messages**, 187 enrollments (164 ACTIVE, 8 STOPPED, 10 COMPLETED,
2 BOUNCED, 3 UNSUBSCRIBED), 1,911 incoming records and four suppressions. All four mailboxes are
healthy at **20/day, 5–10 minute ranges**, unchanged New York weekday 09:00–17:00 windows.
Canonical replay checks **187 enrollments — 0 diff(s)**; self-check is clean; 28 migrations
are applied. New incoming content/activity/location tables and manifest volume do not yet exist.
These checks do not initialize cursors, fetch history, change sending state or send mail.

Fresh backup `coldemail-20261008-094214.dump` is **2,479,266 bytes** and passes its **342-line**
pg_restore catalog. Reviewed candidate bundle is staged at `/tmp/incoming-review-20261008.bundle`,
with matching local/VPS SHA-256
`1cfedf24d058e0a88afad99388f10258432792e403279b5d72b530c551a23b02`.
It requires production base `cd83228` and pins `84403e4`. The Linux app image additionally builds
with production pruning and its entrypoint shell syntax passes; runtime audit remains the six
previously documented advisories. VPS disk has 14 GiB free (42% used); no cleanup occurred.

An explicit pause decision was requested because AGENTS.md forbids implicitly pausing an active
campaign. **Permission has not arrived. Do not infer approval from elapsed time or deploy while
this prerequisite remains unresolved.** If authorized, pause only Campaign 3 through its guarded
application action, capture a new stable snapshot/backup, verify no deletion history before
bootstrapping the empty independent manifest, fast-forward/build/deploy coherently, run migration,
route/health/UI, populated drift/self-check and post-backup checks, and leave campaigns paused.
Preserve actual mailbox settings and legacy stops; do not restore/replay/enroll/resume/send.

## 2026-10-08 IST incoming review/Unibox — verified local implementation

The approved specification is persisted in docs/24. The candidate prospectively holds confidently
matched responses for human review, except clear new-text opt-outs permanently suppress the address.
Automation detection and relationship are independent labels. Exact-address responses hold all
unfinished sibling enrollments; company/domain matches are suggestions, and uncertain messages stay
in Needs linking. Legacy terminal events and broad historical stop guards remain intact.
Local code commits on `canary`: `900be21` (backend), `c12deb3` (Unibox), and `72a2398`
(navigation/notifications), following state/schema `2ef2612` and specification `bd0e396`.

Continue, campaign Stop, Delay and global permanent Suppress are separate audited actions. Continue
preserves progress, retry bodies and any prior delay. Correction/restoration returns only to review,
with sequence/suppression/bounce/checkpoint guards and a separate subsequent Continue/Delay decision.
Shared locks, latest ledger revisions and final send checks protect incoming/action/send races.
Held/delayed/suppressed work does not reserve eligible capacity. Suppressed unfinished work appears
in a separate campaign outcome bucket without rewriting lifecycle history. New human metrics and
meeting credit require explicit primary-campaign confirmation.

Unibox has campaign/search/state/mailbox filters, grouped lead/campaign rows, complete selected
content, incoming history, immutable sent conversation context, safe isolated HTML, collapsed quotes,
confirmations, acknowledgement/Undo, Needs linking, deletion and explicit content-only recovery.
Acknowledgement changes visibility only and refuses unresolved holds. Retention defaults to 30 days
after eligible acknowledgement, configurable/off. The reader puts the email before outreach controls.
Desktop navigation is a compact top bar, with More and the existing mobile sheet. Notifications have
bounded scrolling and **Clear all notifications**: captured through-ID acknowledgement preserves
history and any newer notifications. No repeated notification confirmation is introduced.

Final verified local gates:

| Gate | Result |
| --- | --- |
| Typecheck, lint, formatting, diff whitespace | Pass |
| Unit | 413/413 |
| Web components | 71/71 |
| Integration | 208/208, 34 files |
| API | 167/167, 24 files, repeated after final accounting refinements |
| Locked golden | Exactly 47/47, unchanged cohort/fixtures; historical harness policy only |
| GreenMail | 31/31, including PEEK and UIDVALIDITY |
| Mock browser | 71/71; final Unibox/navigation/notifications replay 18/18 |
| Real-backend browser | 4/4, local MockTransport/virtual clock, including the new review flow |
| Production web build | Real API mode, `/email-campaign/`, no MSW chunk |
| Compose configuration | Production and Spaceship profiles validate with dummy local values |

Database-backed suites ran serially. Initial component runs under heavy concurrent CPU load hit
the existing 5-second UI timeout; the standalone one-worker web suite passes without changing
timeouts. The new capacity assertion initially exposed an incomplete no-transport fixture mailbox
assignment, which was corrected to match accepted-send scheduling. The expanded outcomes panel's
component expectation was updated without changing golden numbers. The final full API suite passes
after the accounting refinements. All stages in docs/24 are complete locally.

The dedicated local `coldemail_review_verification` cohort contains nine event-backed enrollments:
held, delayed, manual stop, legacy company stop, legacy reply, bounce, completion and suppressed
histories. Migration **0028–0032 preservation down/apply** keeps all snapshotted data and facts.
Canonical `npx tsx apps/server/src/services/rebuildCli.ts --dry-run` checks **9 enrollments —
0 diff(s)** on source and scratch restore; an actual rebuild rewrites zero projections and both
self-checks are clean. Eleven saved sent/retry snapshots, three suppression entries and confirmed
metrics survive. No transport is called by this drill.

Custom-format dump `backups/incoming-review-drill/verified.dump` is **145,307 bytes**, its **355-entry**
catalog validates, and it restores into `coldemail_review_restore`. SHA-256:
`729aea5e8996b4158213aed3639376f23c9563defdc294eeaf2294def8d5079a`.
Content was deleted after taking that dump. Reapplying the latest independent deletion manifest
to the older scratch restore removes the restored text before serving it. Deleted status, retained
state/suppression/snapshots, zero drift and self-check then pass. These ignored local artifacts are
verification evidence, not production backups.

Deployment remains separately authorized. It must bootstrap an existing manifest only after
checking that no previous deletion history exists, retain the independent volume/latest manifest,
apply migrations coherently and use review-aware rollback code. Restores must reapply the latest
manifest before API/workers; dump-time copies cannot protect later deletions. Existing immutable
message-derived excerpts and expired-backup handling limit deletion to stored incoming content.
See docs/16 for the restore/startup procedure. There is no automatic historical recovery/replay.

Runtime audit still reports **six existing advisories (3 moderate, 3 high)**; dependency remediation
is separate. The build retains its existing large-chunk warning. Neither is claimed resolved.
Only disposable local fixtures, MockTransport and GreenMail were used. No production connection,
settings/campaign/enrollment/mailbox mutation, restoration, replay, external send, push or deployment
occurred. Production's last verified release remains the separately deployed `cd83228`; its prior
paused state and 506/158 watermarks are historical facts, not a fresh live inspection.

## 2026-10-08 IST reported email-link redirect — read-only provider verification

The operator reported that clicking Gmail's blue `sambhavpmops.com` signature domain reached
`sambhavbuilds.com`. Fresh HTTP checks show root/www HTTP 308 only to HTTPS on the same hostname;
HTTPS root/www return 200 without a Location header. The active host Caddyfile directly serves
the shared website build. Public A records for both outreach roots and pmops www resolve to
`104.207.93.174`; pmops has no AAAA answer and uses Spaceship's launch1/launch2 nameservers.

At the operator's request, authenticated Spaceship Advanced DNS was inspected for both outreach
domains. Root/www A records point to the VPS. Each URL Redirect tab has an empty destination and
zero subdomain redirect records. No provider setting, DNS record or server configuration changed.
A fresh in-app browser visit to `http://sambhavpmops.com/` loads the complete website at
`https://sambhavpmops.com/`, retaining that hostname and relative internal navigation links.

The operator supplied the copied Gmail destination: `http://sambhavpmops.com/`, matching the
successful fresh-browser test exactly. The reported redirect to the main domain is not reproduced.
A previously cached permanent redirect is the likely explanation, not a confirmed cause in the
operator's Gmail browser. A private-window test can confirm whether that browser's stored state
is responsible. No email was sent, campaign resumed or immutable message changed.

Subsequent operator clarification: typing the exact HTTP URL in the same browser also stays on
pmops, while clicking Gmail's blue link reaches the main domain. This weakens the general cached
HTTP-redirect hypothesis; it is not an established diagnosis. The remaining investigation must
inspect the actual Gmail click path. After the operator opened Gmail, the visible Amnon message's
signature anchor was inspected: its destination and Google's redirect query both point to
`http://sambhavpmops.com`. Clicking that actual anchor opened the website at
`https://sambhavpmops.com/`, retaining the hostname. The operator reports both Amnon and Sean
messages redirect only in their separate Chrome browser, and neither redirects in the in-app
browser. That Chrome profile is not exposed to the available browser tools.

Chromium's cross-site navigation cache partitioning makes a cached redirect compatible with the
different direct-navigation result, but it remains an unconfirmed explanation. The next operator
test is clearing only Chrome's cached images/files, then reloading Gmail and clicking again.
No provider/server change is justified by the verified results. The operator's Chrome issue remains
unresolved; do not claim it fixed based on the successful in-app click. No mail or live app state
was changed during this diagnosis.

## 2026-10-08 IST authorized signature/range/alias production deployment

The operator explicitly authorized deployment. Fresh prechecks found clean production `a6489a9`,
Campaigns 2/3 paused, Campaign 1 archived, automatic enrollment off, and four healthy mailboxes
at 20/day with no resume cap and unchanged New York weekday 09:00–17:00 windows. Watermarks were
**506 events / max ID 506 / 158 sent messages**. Pre-deployment replay checked **187 enrollments —
zero diffs**, with clean self-check. No campaign pause/resume was performed.

`origin/canary` was pushed to `cd83228`. Reviewed incremental bundle SHA-256
`dd78b18e3de706599296d5476636d6297626ab285fd4067b774804fa54d2e4d1` matched on the VPS, which
fast-forwarded to `cd8322821f16ec0a6e4790af6964a1d6e81b74bd`. Compose build/up succeeded.
All **28 migrations** are applied. Address inclusion is false; the saved postal address is retained
and role is **Property Management Automation Specialist**. Mailboxes 1–4 now use **4–7**; previous
last-send timestamps remain `2026-10-07T16:00:29.103Z`. Migration deadlines are anchored there with
delays **321/321/309/339 seconds**, within bounds. Scheduler cron is `* * * * *`; poll and automatic
enrollment schedules are unchanged. Caps remain 20/day.

Previous Caddy configuration is preserved at
`/etc/caddy/Caddyfile.before-signature-alias-20261007-183058`. The main-domain block was kept
byte-for-byte. The complete merged Caddyfile validated, was atomically installed and reloaded;
Caddy is active. Public HTTPS passes for main/www and both outreach/www hosts: identical website
HTML, direct 200 without redirects, cached assets and SPA navigation. Alias hostnames remain.
Application/settings/mailboxes/campaigns/login return 200/no-store; bare app redirects 308;
authenticated API rejects requests without a session and OAuth routes resolve. Both unsubscribe
roots return 404 and non-mutating invalid-token GETs return generic 200. No DNS/mail record changed.
Served application version is `e61ea8e8-49f8-4655-b294-23dd5c582b5c`.

App/database are healthy; gateway/backup running. Post-deployment replay checks **187 enrollments —
zero diffs**, self-check clean. Pre-backup `coldemail-20261007-183058.dump` is **2,240,092 bytes**;
post-backup `coldemail-20261007-183315.dump` is **2,241,303 bytes**. Both pass **342-line** catalogs.
Policy cutoff remains `2026-10-06T06:41:30.403034Z`. Campaign states, auto-enrollment, caps/windows
and **506/158** watermarks remain unchanged; deployment emitted no mail.

At 18:33 UTC, VPS root disk is **42% used**, **9.6 GiB used / 14 GiB available** on 24 GiB.
RAM is **690 / 1,968 MiB used**, **1,277 MiB available**; swap **108 / 2,047 MiB**.
Post-build load is **1.39 / 0.58 / 0.28**. App uses about 180 MiB, database 53 MiB, gateway
33 MiB and backup 2 MiB, with low sampled CPU. Docker reports **1.936 GB** build cache and
**935.4 MB reclaimable**. Cleanup is possible under a separate instruction; none was performed.
Running images and database/backup volumes are retained.

After operator sign-in, authenticated Mailboxes shows four healthy connected mailboxes with
**4–7 min**, 20/day each and total capacity 80. Edit verifies minimum 4, maximum 7, cap 20,
unchanged windows and eligibility guidance. The dialog was closed without saving.
Settings → Compliance verifies the address toggle off, retained postal address, requested role,
adjacent four-line preview with the domain below the role, and disabled Save (no changes).
The Mailboxes tab is left open for the operator.
No CSV operation, cap increase, enrollment, campaign resume or outbound mail occurred.
Leave both campaigns paused for operator review and resumption.

## 2026-10-07 signature controls, randomized spacing and website aliases — verified locally

The operator-authorized three-part update is implemented on `canary`. Settings → Sender signature
now has **Include postal address**, initially off. Hidden addresses remain saved/editable; the
actual sending mailbox domain occupies the line below **Property Management Automation Specialist**.
When enabled, the role/domain share one line and the configured address follows immediately.
Text, HTML and previews agree, with adjacent lines and one Best sign-off. Address validation and
send/preflight blockers apply only when enabled. Migration 0026 changes the former default role,
preserves custom roles and retains the stored address. Sent messages and saved retry snapshots,
unsubscribe headers/endpoints and suppression remain intact; manually supplied body text is retained.

Application workstreams are committed as `23a4f18` (signature controls) and `74a54be`
(persisted random spacing); `63b6816` contains the hosting configuration and local rehearsal.

Mailboxes → Edit replaces the fixed interval with **Minimum minutes / Maximum minutes**. Migration
0027 and new forms default to **4–7 minutes**, with whole-minute bounds 1–1440 and minimum below
maximum. Each accepted send draws one uniformly distributed inclusive integer-second delay;
its deadline, actual acceptance timestamp, sent event and message commit atomically. Ordinary
checks, failures and restarts do not redraw. A changed range draws once anchored to the latest
accepted send under the same mailbox row lock; identical saves and cap changes preserve it.
No history is immediately eligible within its window. Minute checks, assignments, caps, windows,
reply stopping and carry-forward remain enforced. Old fixed columns and new settings/deadlines
survive rollback/reapply. Separate API/worker installations need a worker restart after range edits.

Real browser verification found that Edit submitted unchanged folder settings, unnecessarily
attempting OAuth discovery on an unconnected mailbox. The dialog now omits unchanged folders;
actual folder changes retain discovery and cursor-seeding guards. Authenticated range editing,
reload persistence and zero sends on that mailbox pass against the real backend.

The reviewed Caddy fragment serves the existing `/var/www/sambhavbuilds/dist` directly on
`sambhavpmtech.com`, `sambhavpmops.com` and both www hosts, retaining each website hostname.
The main-domain block is unchanged. App/API/OAuth routing, app canonicalization and both
unsubscribe hosts remain. No additional website installation, DNS or mail-record change is needed.
Production Caddy configuration validation and the local Docker rehearsal pass for all four
website hosts, SPA navigation, two assets per host, immutable caching, application/OAuth proxying
and unsubscribe routing. The repeatable rehearsal is `scripts/verify-alias-hosting.mjs`.

Verified gates: typecheck, lint and formatting; unit/web **462**; API **149**; GreenMail **29**;
locked golden **47 without regeneration**; full mock browser **67**; real-backend browser **3**;
real-API `/email-campaign/` production build. Full integration **189/189** passed before the last
two regression additions; the affected scheduler/random-spacing suites then passed **28/28**,
covering **191 distinct integration tests** in total. The latest slow-SMTP atomic-storage test
passes separately. After the dialog correction, focused UI **3**, mailbox browser **6**, the full
real-backend replay, typecheck/lint and production build pass again. Unit/web uses two workers
to avoid desktop-load timeouts; the existing long virtual-clock API/browser replays have bounded
larger timeouts, with their assertions unchanged. No golden fixture was regenerated.

Migration apply/down/reapply preserves toggles, customized roles and deadlines and rejects invalid
ranges. Four-mailbox scenarios reach **80/100 accepted mock sends** at **20/25 each**, with varied
bounded gaps, no cap overflow, daily carry-forward, persisted restart/failure deadlines, concurrent
tick protection and no downtime bursts. Template and personalized retries retain saved bodies.

A fresh local fixture contains **five event-backed enrollments, seven events and two accepted
mock sends**, with 4–7 ranges and the hidden-address signature. Projection dry run reports
**checked 5 enrollments — 0 diff(s)** and self-check is clean. Dump
`backups/signature-range-20261007.dump` is **126,313 bytes**, passes a **332-line** catalog and has
SHA-256 `ce930cd7ae6c5b811f43248c8bdc5ce716c80c2d7fa442dae6dfda9c71efa736`.
Restoring to fresh local `coldemail_signature_range_restore_20261007`, rebuilding and rerunning
dry-run/self-check gives five enrollments, zero rewrites/diffs and no invariant violations.
Both mailbox deadlines, signature toggle/role/address, all **28 migrations** and ledger/sent counts
match the source exactly. The dump, snapshot and scratch database are retained locally.

**Operational boundary:** this release is local only. No push, deployment, VPS/Caddy/DNS change,
production setting/cap/campaign/enrollment edit, CSV operation, resume or outbound mail occurred.
Production's last verified release remains `a6489a9`; its active-campaign snapshot below is
historical, not a current paused-state assertion. Deployment requires separate authorization,
a fresh check that outreach is paused, captured live settings/watermarks, a validated database
backup and preserved Caddyfile. After rollout verify services/routes/migrations, authenticated
controls, projection consistency, backup catalogs and VPS usage, leaving campaigns paused for
operator review and resumption. Do not pause or resume implicitly.

## 2026-10-07 authorized fixed-spacing production deployment

The operator separately authorized deployment of the verified spacing candidate. Fresh read-only
prechecks found clean production `b721684`, Campaign 3 active after operator actions, Campaign 2
paused, Campaign 1 archived, all auto-enrollment off. Four mailboxes were healthy, 20/day, no resume
cap, New York weekdays 09:00–17:00. Deployment ran before the 13:00 UTC / **18:30 IST** window
opening, guarded against crossing that boundary. No campaign pause/resume or setting edit occurred.

`origin/canary` was pushed to `a6489a9`. Reviewed bundle SHA-256
`c39fa8f9abf606d640a64aae8ef107f4ad16e3b712b61250c8144921322f26fe` matched on both hosts;
production fetched it and fast-forwarded to `a6489a9d4fa67e98ab48b9f593edb91fe8a4f343`.
Compose build/up succeeded. App/database are healthy, gateway/backup running. All **26 migrations**
are applied, including 0025. Projection dry run checks **113 enrollments — zero diffs**;
self-check is clean. Policy cutoff remains `2026-10-06T06:41:30.403034Z`.

Pre-backup `coldemail-20261007-105027.dump` is **2,226,522 bytes**; post-backup
`coldemail-20261007-105255.dump` is **2,226,947 bytes**. Both pass **342-line** restore catalogs.
Public health returns `{ok:true,db:true}`; app/mailboxes/campaigns/login/sequences return 200;
bare app and outreach roots redirect 308; portfolio returns 200; unsubscribe roots return 404.
HTML/version responses are `no-store`; hashed assets use one-year immutable caching. Served build
version is `155ef1ec-22f9-404e-8e88-ad511f85a158`, and the live asset contains the interval control.

After operator sign-in, authenticated Mailboxes shows all four healthy mailboxes with **0/20**,
**Send interval: Not set**, and total capacity 80. Opening Edit verifies the blank **Time between
emails (minutes)** control beside Daily cap, with minimum-gap/window guidance. The dialog was closed
without edits/saving; refreshing does not show a false update notice. Local proof is saved at
`backups/spacing-live-control.png`; the Mailboxes tab is left open for the operator.

Campaign state, auto-enrollment, mailbox caps/windows and watermarks remain unchanged:
**422 events / max ID 422 / 148 sent messages**. Existing interval values are null and scheduler
cron remains `*/5 * * * *`; saving a chosen interval switches the all-role scheduler to minute checks.
The operator can set four minutes independently on each mailbox, and later choose 25/day separately.
No production CSV operation, enrollment, activation/resume, interval/cap edit or send was performed.
Root disk is **38% used**, approximately **15 GiB available** after rebuilding; no cleanup was run.

## 2026-10-07 operator-controlled mailbox spacing — verified locally

The operator rejected spreading sends across the window and requested a directly editable gap.
Mailboxes → Edit now offers **Time between emails (minutes)**, from 1 to 1440, with a table column
showing the saved value. Fixed spacing is independent of the daily cap/window and ignores jitter.
The form shows minimum batch duration and warns when the configured gap cannot fit the cap into
the window. Four-minute spacing takes at least 76 minutes for 20 messages or 96 for 25, measured
from the first send; checks/processing can make the actual gap longer. Follow-ups keep their mailbox,
and existing suppression, reply locks, retry snapshots, daily/resume caps and windows remain enforced.

Migration 0025 adds nullable `send_interval_minutes`, with database/API integer bounds. Existing
mailboxes retain legacy pacing until the operator saves an interval; unrelated edits leave it unset.
New mailbox forms default to five minutes. The scheduler checks every minute when any fixed interval
is configured; all-role create/edit refreshes the cron immediately and restart restores it. Separate
API/worker installations must restart the worker after editing spacing. Poll and auto-enrollment
cadences are unchanged. Rollback keeps the additive column and operator values; no ledger changes.

Verification passes: typecheck, lint, formatting; unit/web **458**; API **147**; GreenMail **29**;
locked golden **47 without regeneration**; mailbox browser flows **6**; real-backend browser **2**;
real-API `/email-campaign/` production build. Focused fixed-spacing/migration/jobs checks pass **14**.
Full integration checked **185** tests: **184 passed**, with one existing imported-draft prefill
regression. Rendering removed the original sign-off before returning editable copy. Commit
`6302dfc` preserves the exact saved draft body in prefill; the complete affected suite then passes
**7/7**, including immutable source and sent-draft event linkage. No fixture expectations were weakened.

Fixed-spacing scenarios prove four mailboxes reach **80/100 accepted mock sends** at four-minute
intervals, stop at **20/25 each**, and carry remaining openers to the next allowed day. Interval edits
measure from the last recorded accepted send; downtime does not burst and resume caps remain enforced.
Job smoke verifies minute cron after editing and after stop/start. Migration apply/down/apply retains
four-minute values, rejects invalid values and preserves the existing incoming-stop cutoff/history.

The disposable database is seeded with **five event-backed enrollments**: projection dry run reports
**zero diffs**, self-check clean. Both test mailboxes are set to four minutes for backup verification.
`backups/mailbox-spacing-20261007.dump` is **111,935 bytes**, with a **274-line** valid catalog.
It restores into the newly created disposable `coldemail_spacing_restore_20261007` database; both
intervals remain four minutes, five-enrollment dry run has zero diffs, and self-check is clean.
The dump and scratch database are retained locally. No production operation or outbound send occurred.

At this local checkpoint implementation was on `canary`, not deployed or pushed. Production remained `b721684`; the earlier
read-only diagnosis below records Campaign 3 active after operator actions. Deployment needs separate
authorization, fresh live-state/watermark checks and a validated backup. Saving production intervals,
raising caps, enrollment and campaign resume remain separate operational actions. The proposed slot
approach was discarded before this implementation; it is not part of the candidate. The separately
authorized deployment above supersedes this checkpoint's release status.

## 2026-10-07 read-only 74-of-80 send diagnosis

The operator asked why the October 6 mailbox-local day sent 19/19/18/18 instead of 20 each.
Authenticated Mailboxes and read-only production SQL confirm all four mailboxes are healthy,
20/day with no resume cap, New York weekdays 09:00–17:00. Scheduler is five minutes and jitter
20%. The eight-hour window yields a nominal 24-minute gap, randomized 19.2–28.8 minutes and
reevaluated every tick. Actual average gaps were **26.11/26.39/27.65/27.65 minutes**. All first
sends were 13:00:07 UTC; last sends 20:50–20:55 UTC. A window-closed alert at 21:00:09 UTC and
23 pacing-delay episodes explain the shortfall. No error/provider/auth/copy-block alert is recorded.
This is a pacing/tick capacity limitation: 20 is a ceiling, not a guaranteed daily throughput.

Campaign 3 is now **active**, automatic enrollment off, following operator actions after the
deployment snapshot. Its 80 October 5 enrollments plus 20 October 6 enrollments total 100:
20 sent on October 5, 74 on October 6, and **six remain ACTIVE at Step 1**, enrollment/lead IDs
108–113, due, unsuppressed, not erased or snoozed, with Ready Step 1 copies and zero copy blockers.
These openers have no assigned mailbox until accepted sending. Five contacted leads are STOPPED
after incoming mail; all had already sent Step 1 and do not explain the six unsent openers.
The next window opens October 7 **18:30 IST**, subject to unchanged eligibility/runtime state.
Watermarks are **422 events / max ID 422 / 148 sent messages**. No campaign, setting, copy,
enrollment, scheduler tick or outbound send was changed/triggered by the agent. No pacing fix
or deployment was performed; any implementation is a separate task.

## 2026-10-06 authorized VPS build-cache cleanup

After the deployment assessment below, the operator explicitly requested reclaiming the cache.
`docker builder prune --all --force` removed all 66 unused cache objects; Docker reports 3.492 GB
reclaimed and build cache is now zero. Actual root-filesystem recovery is **2,938,626,048 bytes
(2.94 GB)**: used space fell from **11,516,358,656** to **8,577,732,608 bytes**, usage **47% to
35%**, and available space rose to **16,288,657,408 bytes (16.29 GB)**. Shared-layer accounting
explains the difference between Docker's total and filesystem recovery. All four service images,
four running containers and two active volumes remain. App/database remain healthy; gateway and
backup remain running without restart. Public health/application routes return HTTP 200.
Campaigns 2/3 remain paused, automatic enrollment off, and watermarks remain **245/245/74**.
No image, container, volume, database, backup, log or journal pruning was performed. Future builds
will regenerate their cache. Application release remains `b721684`.

## 2026-10-06 four-part production deployment and VPS assessment

The operator separately authorized deployment and a post-deployment VPS usage/cleanup assessment.
Production was clean at `4b4e0c71d`; Campaigns 2/3 were paused, automatic enrollment off, Campaign 1
archived. Watermarks were **245 events / max ID 245 / 74 sent messages**. The reviewed bundle for
`b721684` matched SHA-256 `a64372c1a91e963838b61ef520003b381d22664a8962312bc5f924e23b075642`
on both hosts. `origin/canary` was pushed, production fast-forwarded, and Compose build/up passed.
Paused state was rechecked immediately before up. No production CSV upload/import, campaign edit,
enrollment, resume or outbound send occurred.

Pre-backup `coldemail-20261006-063954.dump` (**2,096,380 bytes**) and post-backup
`coldemail-20261006-064227.dump` (**2,096,925 bytes**) each pass a **342-line** restore catalog.
All **25 migrations** are applied; persistent policy cutoff is
**2026-10-06 06:41:30.403034 UTC**. Signature operator configuration exactly matches the requested
name, role and address. App/database are healthy and gateway/backup are running. Projection replay
checks **93 enrollments — zero diffs**; self-check is clean. Post-deployment watermarks remain
**245/245/74** and Campaigns 2/3 remain paused with automatic enrollment off.

Public health/app/Sequence/Leads/portfolio routes return 200; bare app and outreach roots retain
308 redirects; both unsubscribe roots return 404. HTML and version metadata are no-store, hashed
JS is immutable, missing JS returns 404, and served version
`c828875b-b8f6-4f0c-ae07-c6fd03b63393` matches the loaded bundle. A read-only production Ready-copy
render verifies exact signature lines/actual mailbox domain in both text and HTML without saving
copy or issuing a send. The browser initially required operator sign-in; one normal initial-credential
probe returned 401, with no reset or further attempt. The operator subsequently signed in.
**Authenticated browser replay passes.** Compliance shows the exact migrated name, role and address,
adjacent Best/name lines, and no obsolete opt-out wording control. Sequence 2 scoped to paused
Campaign 3 reports all 100 preview leads; Mary's unsent Ready Step 2 renders successfully with
`sambhavpmtech.com` after the role, one signature/address and no automatic opt-out body text.
A fresh reload loads the authenticated sequence without a false update banner. The browser was
left on Campaigns, both Campaigns 2/3 paused. A final database check confirms automatic enrollment
off and unchanged **245/245/74** watermarks. No form was saved, CSV uploaded, campaign resumed or
send issued. The operator confirms their revised CSV will supply the opt-out instruction.

VPS snapshot after builds at 06:42 UTC: **1 vCPU**, CPU **1–2%** in the two fresh one-second samples
(98–99% idle), RAM **751,190,016 / 2,063,601,664 bytes** used (**36%**), with
**1,312,411,648 bytes available**. Swap uses **117,764,096 / 2,147,479,552 bytes** with zero swap I/O
in those samples. Root disk uses **11,516,100,608 / 24,883,167,232 bytes**, **47%**, with
**13,350,289,408 bytes available**. App container is **164.1 MiB**, database **72.99 MiB**, gateway
**12.63 MiB**, backup **2.75 MiB**. Post-build load averages 0.82/0.51/0.22 include build history;
fresh CPU samples demonstrate current low utilization.

Docker reports **3.492 GB** build cache, **3.387 GB reclaimable**. This is the main safe cleanup
candidate once explicitly authorized; pruning it affects future build speed, not running services
or database/backup volumes. Actual physical recovery may differ because layers are shared. Docker
also misleadingly reports active images as 100% reclaimable; **all four images are active**, so
do not count those as disposable. Docker's containerd store is 4.6G in addition to 1.3G under
`/var/lib/docker`. Logs total 773M, journals 555.3M; older journals could be trimmed after choosing
retention. APT archives are only 8.4M (most of the 120M cache directory is metadata), app checkout
138M, temporary files 14M. No urgent cleanup is necessary at 47% disk usage. **No cleanup was
performed**, beyond removing the agent-created in-container verification helpers. Database,
backup volumes, production dumps and service images were preserved. `docker buildx` is unavailable
on this host; built-in Compose builds and `docker system df` work normally.

Application release remains pinned to `b721684`; subsequent documentation commits do not require
an image rebuild. Revised production CSV commit and campaign resume remain separate operator steps.

## 2026-10-06 four-part local release — verified, not deployed

The operator authorized implementation on `canary` while their production campaign remains
paused. Deployment, production CSV import and campaign resume are separate steps. No production
connection/mutation, push, enrollment, activation, resume or outbound mail occurred. Local browser
walkthrough sends use the mock transport only. Production remains the previously verified
`4b4e0c7`; the operator's paused-state report must be independently checked before a deployment.

Completed workstreams:

- `29736b3`: build-generated version ID shared by the bundle and static `version.json`, startup
  and minute polling with set/clear comparison, failed-request tolerance, dirty-form confirmation
  and manual refresh only. HTML/version use no-store; hashed assets use immutable caching.
- `b3c0573`: append-only incoming-company stops with terminal STOPPED, private/public suffix
  boundaries, exact/thread fallback for shared providers, cross-campaign contacted-only stopping,
  migration-time cutoff and re-enrollment guards. Thread/reply/bounce/opt-out classification and
  analytics remain distinct. Incoming records, stop facts and cursor commit atomically under
  enrollment locks; duplicate and concurrent stops recheck terminal state.
- `8ddb8e5`: upload choice and dedicated preview/commit APIs for draft/paused campaign copy
  updates. Preview has 100-entry pages and complete result counts. A mixed 100-member cohort
  protects sent Email 1 and retries, replaces later unsent copies Ready, skips outside rows,
  rejects stale/conflicting/partial inputs, requires generic destinations and preserves progress.
  Sources update only with eligible replacements; committed history records campaign and counts.
- `189c29e`: four adjacent signature lines, actual mailbox domain after the role, postal address
  directly below, and no automatic opt-out body text/link. Editable name/role/address remain;
  migration 0023 explicitly updates defaults and operator configuration. Header/endpoints and
  explicit suppression remain; sent/retry bodies and formats stay immutable. New signature-only
  retry bodies mint a fresh configured header token; legacy saved links retain their header URL.
- `dcd9bc6`: missing asset URLs return 404 rather than cached SPA HTML; repeated mounts/malformed
  metadata and confirmed/discarded dirty refreshes are tested. Fresh mail arriving after the
  poll's clock snapshot still qualifies. Pool enrollment and recycling also honor prior stops.

Pinned dependencies/data: `tldts` **7.4.16**; **14,346** shared-provider domains from
`Kikobeats/free-email-domains` revision `ea1dfe996d6ba0a9198dfd7dc1cf946e4f1e15d3`, with
MIT attribution and a local extension list. Regional/shared providers, unknown/invalid domains,
company subdomains and unrelated hosted tenants are covered. Updates are reviewed/bundled;
there is no runtime provider-list download.

Verified gates: typecheck, lint, formatting; **389 unit**, **68 web**, **180 integration** and
**147 API** tests; subsequent focused integration runs **33** (migration/company-stop/scheduler)
and **15** (final stop/pool/recycling); **29 GreenMail** and exactly **47 locked golden** tests,
without fixture regeneration. **66 mock-browser** and **2 real-backend browser** flows pass.
The real CSV flow verifies saved preview content, unmatched-row history, draft status and zero
enrollments. Subpath production build and real local Caddy checks pass: app/sequence HTML and
version JSON 200/no-store, hashed JS 200/immutable, missing JS 404, metadata ID equals bundle ID.
Root Caddy configuration also validates. An initial browser assertion used `search` instead of
the API's `q`; correcting the test's intended lead lookup resolved it.
The clean Linux app image builds from the locked install and its production runtime passes
company-subdomain and regional shared-provider normalization checks.
Final signature polish (`4b18d3d`) covers blank lines between a legacy Best/name and repeated signoffs;
the complete unit suite and latest renderer mounted into that Linux runtime pass exact-whitespace
checks. New messages retain one Best/name pair with adjacent signature lines.

Migrations **0022–0024** apply/down/apply successfully. Rollback retains cutoff, STOPPED/event
vocabulary, operator values and committed copy-update history; **do not run an older binary that
cannot understand STOPPED after stop facts exist**. Use a compatible forward rollback and retain
the ledger. No historical message replay is performed.

The incoming-stop cohort replays **8 enrollments — zero diffs** with clean self-check. Final
browser-populated state replays **5 enrollments — zero diffs**, self-check clean. Local custom
dump `backups/fourpart-20261006.dump` is **127,683 bytes**, with a validated **332-line** catalog
and SHA-256 `1fa6cbb9a8d4a5d8d6f52bcf7ac9f7da534f2df01599efab137ffded8f3aec99`.
Scratch restore, rebuild (zero rewrites), five-enrollment zero-drift and self-check pass; the
temporary scratch database was removed. The local dump remains ignored by Git.

Deployment handoff: obtain separate authorization, verify campaigns still paused, capture current
event/sent watermarks and validated backup, bundle the complete reviewed candidate, then apply
all 25 migrations. Confirm stored cutoff once, services/routes/version/cache behavior,
projection consistency, self-check, backup catalogs and authenticated update/copy/signature UI.
Do not upload/commit a production CSV without the revised file and operational instruction.
Leave campaign resume to the operator after copy review. Historical entries below describe their
own deployment-time state and do not authorize further operations.

## 2026-10-05 Sequence campaign lead picker repair — deployed at `4b4e0c7`

After the transfer below, the operator reported activating Campaign 3 and enrolling leads.
Authenticated Sequence UI confirms **US Property Management — Batch 100** is active. The old
picker requested only the first eight global leads, ignoring the selected campaign, and exposed
no pagination. Its disabled Render button also correctly required choosing Preview on a step card.

The local frontend fix requests `campaign_id` with `campaign_scope=both`, covering available pool
and enrolled leads, and adds eight-row pagination plus loading/error feedback. Campaign, search,
and page changes clear the selected lead and previous render. Sequence defaults retains global
search. No backend, migration, scheduler, or mail behavior changes.

Typecheck, lint, format, **425 unit/web tests**, **5 Sequence browser tests**, **47 locked golden
tests**, and the real-API
`/email-campaign/` production web build pass. The new 100-lead browser regression covers both
membership types, excludes an unrelated global lead, pages beyond eight, renders a selected lead,
searches the last enrolled lead, and clears selection/render on context changes.
The first golden attempt could not connect because Docker Desktop was stopped; after starting
Docker and the local Compose services, the complete locked suite passes without fixture changes.

Live read-only workaround verification selected Step 1 Preview, Campaign 3, searched a known
new-cohort address, and rendered its saved personalized copy with the complete signature/footer.
The copy was already marked sent by the operator-activated campaign; this preview did not send
mail or change campaign, enrollment, copy, or event state. Screenshot evidence:
`C:/Users/jains/AppData/Local/Temp/new-campaign-preview-proof.jpg`.

The operator explicitly authorized deployment. Reviewed bundle SHA-256
`5a9d406d9624179944eec6a0e1bbbd233451395ceee3e0c643be3f1a2eef57e9` matched on both hosts;
production fast-forwarded from `988adc0` to `4b4e0c7` and Compose build/up succeeded. The release
is pushed to `origin/canary`. App/database health, running services, all 22 migrations, public
app/sequence/asset/portfolio routes, canonical/host redirects, and unsubscribe-root 404s pass.
Projection replay checks **93 enrollments — 0 diffs**; self-check has no invariant violations.
Pre/post backups `coldemail-20261005-162432.dump` (**1,976,320 bytes**) and
`coldemail-20261005-162644.dump` (**1,976,533 bytes**) each pass **342-line** restore catalogs.

Campaign 3 remains active, automatic enrollment off, cap 100, **80 enrolled / 20 available**;
Campaign 2 remains paused. Event count/max ID **208/208** and sent count **58** match before/after
deployment. The deployment emitted no mail and changed no campaign/enrollment/mailbox settings.
Authenticated UI replay shows **1–8 of 100**, then **9–16 of 100**, and successfully renders a Ready
second-page lead's complete Step 1 copy. Deployment screenshot:
`C:/Users/jains/AppData/Local/Temp/deployed-preview-picker-proof.jpg`. Existing six runtime audit
findings (four high, two moderate) remain the separately recorded dependency follow-up.

## 2026-10-05 authorized new campaign and 100-lead pool transfer

The operator explicitly requested a new campaign, transfer of the 100 waiting leads from Campaign
2, and a daily enrollment cap of 100 or higher. Read-only checks found the global campaign ceiling
already set to **100**, mailbox ceiling **30**, and minimum ramp days **0**; the four healthy
mailboxes were already configured for **20 messages/day each**. These existing settings were not
changed. Higher configuration ceilings are not evidence of deliverability safety.

Through the authenticated in-app browser, created **US Property Management — Batch 100**
(`campaign_id=3`) as a draft using the same **US Personalized — Five Emails** sequence
(`sequence_id=2`). Its five ramp stages retain the seven-day schedule, with each stage cap **100**
and permanent enrollment cap **100**. Automatic enrollment remains off and first activation is
null. Paused the already-finished Campaign 2 to enable its guarded pool reassignment UI, then
selected only Available entries and reassigned two pages of **50** leads each to Campaign 3.
No activation, resume, enrollment, or outbound batch was authorized or performed.

Reconciliation confirms Campaign 2 retains **12 enrolled / 100 released / 0 available**, while
Campaign 3 has **100 available / 0 enrolled** and is pool-backed. The sorted lead-ID digest before
and after transfer matches `d3620eb9dd6decc6e753933fc001ef22`, proving the exact waiting set moved.
Campaign 3 has **100 Ready copies per step**, **500/500** total, with subject, body, content hash,
and source-copy ID identical to Campaign 2's corresponding copies. Reassignment records target
pool source-import IDs as null (the UI labels these Global); the original released pool rows and
copy/source relationships retain the original provenance. Original campaign copies/history remain
intact. The new campaign has zero enrollments; event count/max ID remain **124/124** and sent
messages **54**. The UI confirms all five steps have 100 Ready and zero review/missing/blocked.

Production health, **13-enrollment zero drift**, and self-check pass. Pre-change
`coldemail-20261005-155421.dump` (**1,893,982 bytes**) and post-change
`coldemail-20261005-155830.dump` (**1,969,346 bytes**) both pass **342-line** restore catalogs.
The UI currently suggests **80** new enrollments from shared mailbox capacity; a campaign ceiling
of 100 does not bypass mailbox caps or follow-up reservations. No code release, migration,
mailbox/global-setting change, or email send was part of this transfer. Campaign 3 is ready for a
separately authorized activation/enrollment handoff; Campaign 2 remains paused.

## 2026-10-05 VPS usage review and authorized build-cache cleanup

Read-only inspection found the 24 GB root filesystem at **9.6 GB used / 14 GB available (42%)**,
inode use **9%**, and about **1.2 GiB** memory available. The single CPU was **86–99% idle** during
sampling, with no active swap-in/out. All four application containers were running; app/database
health passed. Database and backup volumes used approximately **103 MB / 74 MB**. Docker reported
about **1 GB** reclaimable build cache; journal files used about **547 MB** and were retained.

The operator explicitly authorized build-cache cleanup. With the deployment build completed,
`docker builder prune --force --filter until=1h` removed only unused cache older than one hour and
reclaimed **902.9 MB**. Root usage fell to **8.7 GB used / 15 GB available (38%)**. Docker retained
all **four active images**, **four running containers**, both database/backup volumes, and recent
build cache (**1.31 GB** total remaining, **97.84 MB** reported reclaimable). All services remained
running and internal app/database health passed after cleanup. No logs, backups, application data,
campaign settings, or sent history were changed. Future builds may take longer without the cache.

## 2026-10-05 import campaign selector repair — deployed at `988adc0`

The operator reported that **Choose campaign** did not respond while importing 100 leads and
explicitly requested a fix and deployment. Production inspection found only an archived campaign
and active **US Property Management**, with automatic enrollment off. The selector silently
filtered both out, and allocation preview/commit rejected active campaigns as well.

The repair permits CSV allocation to draft/paused campaigns or active campaigns with automatic
enrollment off. Archived campaigns and active campaigns with automatic enrollment on remain
excluded. Preview and commit enforce the same rule; commit locks each campaign row until its
transaction completes. The selector shows loading, fetch-error, and no-available-campaign messages
instead of an unexplained empty menu. Other pool editing operations retain their existing guards.

Verified locally: typecheck, lint, format check, unit/web **425/425**, API **146/146**, import
browser checks **5/5**, and the real-API subpath production web build. The 100-lead API regression
proves **500/500** reusable sources and **500/500** campaign copies Ready in an active campaign,
with zero enrollments and no appended events. Enabling automatic enrollment between preview and
commit rejects both preview and commit with 409 and rolls back created leads. Browser coverage
proves active campaign selection, exact count preview, an enabled import action, empty-state
guidance, generic copy destination selection, and the existing upload/commit flow. No migration or
golden fixture change is required. The existing large-bundle build warning remains.

The remaining serial gate also passes: integration **177/177**, GreenMail **29/29**, and locked
golden exactly **47/47** (253 tests across 34 files). No fixtures were regenerated.

Read-only production prechecks report **13 enrollments, 0 diffs**, clean self-check, **124** events
and **54** sent messages. All enrollments are terminal (**10 completed / 3 unsubscribed**), with
no next-send timestamps. Campaign 2 remains active, automatic enrollment off, with **13** leads
and **13** pool entries. Pre-deploy `coldemail-20261005-151001.dump` (**1,706,919 bytes**) passes a
**342-line** restore catalog. No live import, allocation, enrollment, campaign mutation, or send
was performed during diagnosis and local verification.

Under the operator's explicit deploy authorization, `origin/canary` and the clean VPS checkout
advanced to `988adc0`. The reviewed bundle's local/remote SHA-256 matched
`137b0ced5748c1551cc09ab2b2272de89f305d9d5911a12da28175e6dab16e92`.
App, gateway, and backup images built and services restarted successfully. App/database health,
the public app/direct SPA/redirect/portfolio/unsubscribe-root matrix, and served selector/backend
eligibility markers pass. No migration was added; **22** remain applied. Production reports
**13 enrollments, 0 diffs** and clean self-check. Event count/max ID remain **124/124**, sent
messages **54**, leads/pool entries **13/13**, and all existing enrollments terminal. Campaign 2
remains active, pool-backed, automatic enrollment off. Post-deploy
`coldemail-20261005-152324.dump` (**1,708,996 bytes**) passes a **342-line** restore catalog.

A read-only service probe against the operator's already-saved **Import 3 / 100-row** preview
confirms Campaign 2 **100 requested / 100 allocatable**, Personalized Steps **1–5**, **500** copies
bound, zero unassigned copies, and no generic destination required. The probe created no import,
allocation, enrollment, event, or send. Authenticated production visual replay was not performed;
local browser interaction and the live saved-import service path are both verified. Deployment
emitted no mail. Oracle, `main`, DNS, and campaign/mailbox settings are unchanged.

The build's current audit reports **16** findings before pruning and **6 runtime findings** after
pruning (**4 high / 2 moderate**), superseding the September zero-runtime audit snapshot. Runtime
packages are `@fastify/busboy`, `fast-uri`, `fastify`, `ip-address`, `mailparser`, and `nodemailer`.
This repair changes no dependency versions or lockfile. Dependency remediation is a separate
follow-up; no forced audit rewrite was run. Nodemailer's advertised fix includes a major upgrade.

## 2026-09-27 VPS usage review and bounded cache cleanup

Read-only inspection found the 24 GB root filesystem at **9.6 GB used / 14 GB available (42%)**,
inode use **9%**, and about **1.3 GiB** memory available. Docker had four active images, four
running containers, two active volumes (database and backups), and about **922 MB** reclaimable
build cache. The backup volume held about **71 MB**. `/var/log` used about **867 MB**, including
about **529 MB** of journal files plus authentication records; these logs were retained for
incident review. Temporary deployment bundles used about **30 MB** and were also retained.

With no build running, `docker builder prune --force --filter until=1h` removed only unused build
cache older than one hour and reclaimed **867 MB**. The root filesystem then reported **8.8 GB
used / 15 GB available (38%)**. Docker retained all four active images and containers, both
volumes, and recent build cache. All four services remained up, app/database health stayed green,
and public HTTPS health returned 200. This cache cleanup changes no application data, backups,
campaign state, or sent history; a future image build may take longer without the removed cache.

## 2026-09-27 authorized cleanup of 17 unsent pilot sign-offs

The operator separately authorized correction of Campaign 2's 17 Ready personalized copies.
Read-only inspection found one exact terminal `\n\nSambhav` in each body and no terminal `Best,`.
The 17 linked reusable sources were distinct, Ready, identical to their campaign copies, and not
linked to any sent copy. Their existing campaign content hashes matched the application formula.
The campaign was active with automatic enrollment off; New York time was Sunday 06:51, outside
the configured send window. No campaign pause or send was introduced.

After a validated pre-change custom-format dump, one guarded transaction locked the two copy
tables, required the exact 17 Ready matches plus unchanged 104-event/44-message watermarks, and
replaced only terminal `Sambhav` with `Best,` in those 17 campaign bodies and their 17 linked
source bodies. It recomputed the campaign content hashes and preserved subjects, other body text,
Ready statuses, import/source links, all sent copies, and sent-message snapshots. The transaction
verified all 17 paired rows before commit. Post-commit checks show **17/17** `Best,` endings,
**0** old endings, **17/17** source matches and valid content hashes, and **43 sent / 17 Ready**
campaign-copy statuses. A read-only production renderer probe checked every Ready body against
both sender domains: **34/34** contain one `Sambhav Jain` identity immediately below `Best,`,
followed by the configured opt-out text and full address. No email was sent.

The sent-message body digest remained `a1d5688c82ccfef79b38aee824c17bac` and the sent-copy
body digest remained `c543a2ed2478933a53c95b8f558ebc47`; the event count/max ID stayed
**104/104** and sent messages stayed **44**. Production reports `checked 13 enrollments — 0
diff(s)` and clean self-check. Pre-change `coldemail-20260927-104958.dump` (**1,715,746 bytes**)
and post-change `coldemail-20260927-105359.dump` (**1,716,533 bytes**) both pass **342-line**
restore catalogs. No code release, migration, activation, enrollment, mailbox change, or outbound
mail was part of this cleanup.

## 2026-09-27 plain-text email mode — deployed at `d6f3e1b`

The operator-approved release adds migration `0021_plain_text_mode`. Compliance gains a global
`email_format` defaulting to `plain_text`; Minimal HTML remains selectable. The migration changes
only the exact previous default role line to `Automation Specialist`, preserving custom wording,
and marks existing sent rows `minimal_html` without rewriting their bodies. Plain-text sends omit
the HTML MIME part. The renderer preserves internal draft line breaks, joins a terminal `Best,`
directly to the signature, and leaves one blank line before the opt-out/address block. It never
inserts `Best,`. The actual mailbox supplies the unlinked domain text; blank unsubscribe URL uses
the saved opt-out sentence, and configured URL appears as text in plain-text mode. Minimal HTML
retains both alternatives and its existing styling.

Template and personalized retries reuse complete saved subject/body/format snapshots, including
the original unsubscribe URL. Legacy HTML snapshots stay HTML; legacy template rows without saved
bodies use their previous HTML fallback. Sequence previews expose the entire text alternative in
one whitespace-preserving block, identify the selected format, retain the preview mailbox and
domain placeholder, and use the nonfunctional `.invalid` URL when applicable. Compliance preview
reflects the selected format. Existing saved draft bodies and sent history are untouched.

Verified locally: typecheck, lint, formatting, unit/web **425/425**, API **146/146** with final
focused settings/sequence checks **16/16**, serial integration **177/177** including migration
apply/down/apply and retry cases, GreenMail **29/29** including MIME-part inspection, locked golden
**47/47**, focused Settings/Sequence browser tests **9/9**, real-backend walkthrough **1/1**, and
production web build. Read-only local projection dry-run reports **0 enrollments, 0 diffs**;
self-check has no invariant violations. The empty local projection database does not establish a
populated replay result. No golden fixtures were regenerated. The existing large-bundle build
warning remains.

The operator separately authorized deployment. A reviewed Git bundle fast-forwarded the clean
Spaceship checkout from `767b964` to `d6f3e1b`; local and remote SHA-256 matched
`9b2f8d87a5121740a98122bd508b6aba64bcf985d0a0dec677842d115b485302`.
`origin/canary` also advanced. The production app and gateway images built; the pruned app runtime
audit reports zero vulnerabilities (10 development/build advisories remain). The app restarted
healthy and applied `0021`, giving **22** migrations. Live Compliance reports `plain_text`,
`Automation Specialist`, and a blank unsubscribe URL. All **44** historical sent rows are marked
`minimal_html`; their stored bodies were not rewritten. Served UI assets contain the format choice
and complete-preview markers. Internal health and the public app, direct SPA, outreach redirect,
portfolio, and unsubscribe-root route checks pass.

Pre-deploy `coldemail-20260927-101936.dump` (**1,711,415 bytes**) and post-deploy
`coldemail-20260927-102428.dump` (**1,712,486 bytes**) both pass **342-line** restore catalogs.
Production reports `checked 13 enrollments — 0 diff(s)` and clean self-check before and after.
Event count/max ID remain **104/104**, with **44** sent messages. Campaign 2 remains active with
automatic enrollment off and **43 sent / 17 Ready** campaign copies. No mail was emitted and no
campaign, mailbox, saved copy, or historical message was altered. The 17 Ready bodies still have
manual `Sambhav` sign-offs at deployment; their later authorized cleanup is recorded above.
Oracle and `main` are unchanged.

## 2026-09-27 automatic sender signature — deployed at `767b964`

Operator-approved signature support adds migration `0020_sender_signature`, initializing the
global name to **Sambhav Jain** and title/company line to **Automation Specialist | Sambhav Builds**.
Both are editable, required single-line Compliance settings. The scheduler supplies the actual
sending mailbox domain; rendering appends identity to template and personalized bodies without
editing saved source copy. HTML uses a bold name and body-size identity with no domain anchor;
the existing 10px `#767676` compliance block stays 20px below it. Plain text carries matching
content. Empty unsubscribe URL still uses saved opt-out wording; configured URL still uses the
link and existing headers. Personalized soft-bounce retries retain their immutable snapshot;
subsequent new steps use current signature settings.

Sequence previews accept optional `mailbox_id`, reject unknown IDs, and use an explicit placeholder
when omitted. A preview selector does not assign sending mailboxes and clears stale results when
changed. Compliance preview includes identity. The retired Manual Compose prefill strips the
automatically appended identity and compliance blocks, preserving the editable body.

Verified: typecheck, lint, formatting, unit **350/350**, web **67/67**, API **146/146** plus
the updated sequences/settings checks **16/16**, GreenMail **29/29**, locked golden exactly
**47/47**, Settings/Sequence browser tests **9/9**, real-backend walkthrough **1/1**, production
real-API/subpath web build, migration runner including apply/down/apply **5/5**, populated
`checked 5 enrollments — 0 diff(s)`, and clean self-check. The initial integration run passed
**170/171**; its Manual Compose prefill failure was fixed and that file passed **7/7**. Updated
scheduler coverage then passed **19/19**, including mailbox-domain output and signature-setting
changes across a personalized retry. No golden fixtures were regenerated. A parallel unit/web
rerun hit worker-start timeouts; the complete single-worker rerun passed **417/417**. Docker was
started locally after initial unavailable/starting-up checks. The existing large web bundle
warning remains. The final full serial integration rerun passed **172/172** across 28 files.

Read-only production review confirmed blank `unsubscribe_base_url` and the exact saved sentence
**Prefer I don't reach out? Just let me know or reply stop.** It also verified all **60/60**
Campaign 2 / lead IDs 2–13 bodies end with a standalone **Sambhav**. Appending the new signature
would duplicate that sign-off. Saved bodies and sent history remain untouched as requested;
cleanup of eligible unsent copy needed separate authorization. The operator subsequently authorized
deployment. That release preserved all saved bodies; the later authorized cleanup is recorded above.

The reviewed bundle advanced `origin/canary` and the clean Spaceship checkout to `767b964`.
Local and remote SHA-256 matched
`a36a9f81c06856df1261c0cfcda2f44e5d6e620255db58a61134ce1770721bdc`.
Production images built successfully; the pruned runtime audit reports zero vulnerabilities
(10 existing development/build advisories remain). Migration `0020` applied, giving **21** applied
migrations. The new signature defaults and blank unsubscribe URL are verified in the live database.
App/database health, the full public route/redirect matrix, served signature/preview UI markers,
and a pure renderer probe in the live container for both outreach domains pass. The probe verifies
bold identity, no anchors in text-only mode, and exactly one compliance clause without sending.
The browser reaches login; authenticated visual replay was not performed in this session.

Pre-deploy `coldemail-20260927-074000.dump` (**1,742,678 bytes**) and post-deploy
`coldemail-20260927-074510.dump` (**1,743,591 bytes**) both pass **342-line** restore catalogs.
Production reports `checked 13 enrollments — 0 diff(s)` and clean self-check before and after.
Event count/max ID remain **104/104**, with **44** sent events/messages. Campaign 2 remains active,
automatic enrollment off; its copies remain **43 sent / 17 Ready unsent**. Deployment emitted no
mail and changed no campaign, mailbox, saved copy, or historical message. At that point the 17
unsent bodies still ended in `Sambhav`; the later authorized cleanup is recorded above.

## 2026-09-14 IST — explicitly authorized 12-prospect pilot launched

The operator explicitly approved lifting the owner-address-only restriction **for Campaign 2's
12 imported prospects only**, activating US Property Management, and enrolling those leads into
the existing five-email sequence. This is not authorization for additional prospects, imports,
campaigns, automatic enrollment, cap increases, or a wider cohort.

Read-only launch checks confirmed the exact Import 2 available-pool lead IDs **2–13**, no
suppressed/erased/untiered/Nurture candidates, and all 60 campaign copies Ready. The five steps
retain personalized content with waits **0/3/4/4/5 days** and conversation flags
**new/continue/new/continue/continue**. All four mailboxes are healthy, capped at **3 total
messages/day each**, with America/New_York Monday–Friday **09:00–17:00**, 20% jitter, five-minute
scheduler/poll intervals, enforced windows, reply stopping, and global unsubscribe suppression.

Activation and enrollment were performed through the authenticated UI and its normal API guards.
The success notifications reported active and **Enrolled 12**. Database reconciliation confirms
exactly leads 2–13 enrolled in Campaign 2; the UI shows **ACTIVE 12**, pool **enrolled 12 /
available 0**, 12 reserved openers, automatic enrollment Off, and full Ready copy coverage.
Production reports `checked 13 enrollments — 0 diff(s)` and self-check has no invariant violations.
No pilot sent event exists at verification: production UTC was Sunday 2026-09-13 18:45, New York
Sunday 14:45, so mail must wait for Monday's sending window. Started-thread mailbox assignments
will be created by the scheduler; enrollment does not prove exactly three opener assignments per
mailbox. Runtime send pacing/receipt/reply outcomes remain unobserved for this prospect pilot.

Pre-launch `coldemail-20260913-184514.dump` (**872,744 bytes**) and post-launch
`coldemail-20260913-184602.dump` (**873,193 bytes**) both pass **342-line** restore catalogs.
No settings, copy content, historical events, DNS, portfolio, or deployment changed.

## 2026-09-13 F-W35 — valid CSV copy must be Ready automatically

The 12-lead pilot exposed an unusable workflow: 60 complete imported emails were left Needs review,
which would require 500 manual approvals for a 100-lead, five-step batch. The operator stopped the
manual process and changed the product rule: every complete, non-conflicting CSV subject/body pair
must be Ready automatically. Needs review remains meaningful only for operator-written drafts and
content edited after import; incomplete or conflicting pairs remain invalid and unsendable.

The interrupted UI action is precisely reconciled: all 60 reusable sources remain Needs review;
only Campaign 2 / Lead 2 / Steps 1–2 became Ready, and the other 58 campaign copies remain Needs
review. No activation, enrollment, or send occurred. The local F-W35 implementation hard-codes
valid import sources to Ready, lets campaign bindings inherit that status, removes the import
readiness selector, and states the automatic behavior in the preview and confirmation. The retired
`mark_valid_copy_ready` request field remains accepted for older clients but is ignored, so an old
client sending `false` cannot recreate the problem.

The complete local gate finished on 2026-09-14: typecheck, lint, format check, unit **348/348**,
web **67/67**, API **146/146**, integration **171/171**, GreenMail **29/29**, locked golden
exactly **47/47**, mock E2E **63/63**, real-backend E2E **1/1**, and the real-API subpath
production build. The new scale regression imports 100 leads with five personalized pairs each
and proves all **500/500** reusable sources and **500/500** campaign copies are Ready in one
transaction, even with the old request field explicitly set to false; no events are appended.
Generic and step-specific bindings, invalid pairs, keep/replace policy, and manual edit readiness
remain covered. The populated disposable database reports `checked 5 enrollments — 0 diff(s)`
and self-check reports no invariant violations. No schema migration is required. Existing F-T01
mock copy-coverage proxy warnings and the large frontend bundle warning remain separate.

After explicit operator authorization, `origin/canary` and Spaceship fast-forwarded to
`9f1ada0` through a reviewed bundle with matching local/remote SHA-256. Deployment completed
on 2026-09-14 IST (2026-09-13 UTC). A scoped, guarded transaction changed Import 2's **60**
reusable sources and **58** remaining unsent Campaign 2 copies to Ready; its two already-Ready
copies were preserved. It checked campaign draft/automatic-enrollment-off state, exact row counts,
complete matching source/campaign content, unsuppressed/unerased leads, absent sent linkage,
and unchanged event/enrollment watermarks before committing. Source-content digest
`41a4e30a8c9a24fcd01d292537581ce6` and campaign-content digest
`ed5505ecd52d614081bd61c4e3d0d07d` remained unchanged.

Authenticated browser verification confirms all 12 available pool leads Ready and every one of
Steps 1–5 showing **12 ready / 0 review / 0 missing / 0 blocked**. Campaign 2 remains draft,
automatic enrollment off, and zero pilot enrollments. Four mailboxes remain healthy at 3/day.
All four stack services are running; app/database health, all 20 migrations, the public app/direct
routes, canonical and outreach redirects, expected unsubscribe-root 404s, and portfolio 200 pass.
The internal health endpoint is `/email-campaign/health`; bare gateway `/health` correctly returns
404 under the subpath configuration. Production reports `checked 1 enrollments — 0 diff(s)` and
clean self-check, zero failed jobs/open error alerts/copy blockers, and zero runtime audit findings.
Events remain **4**, maximum ID **4**, with **1** historical sent event and **1** historical
enrollment. No activation, enrollment, or send occurred; DNS and the portfolio were untouched.
Pre-deploy `coldemail-20260913-183626.dump` (**871,752 bytes**) and post-deploy/normalization
`coldemail-20260913-184058.dump` (**872,365 bytes**) both pass **342-line** restore catalogs.
Keep the pilot draft; activation and every outbound batch remain separately gated.

## 2026-09-13 12-lead import, tiering, and preview verification

The operator selected `test_leads.csv` in the authenticated UI and authorized completing the
remaining import process. Preview reported 12 clean addresses, 60 complete step-specific copies,
and zero invalid, duplicate, suppressed, incomplete, or conflicting rows/copies. Safe-address mode,
Needs review, and Keep existing were retained under the behavior then deployed. One allocation
reserved all 12 accepted leads in
**US Property Management**; direct `step_N_subject/body` mapping bound all 60 campaign-step copies.
The result reported 12 imported/allocated, 60 drafts created, zero remaining global leads, and
zero replaced/skipped/invalid drafts. Campaign-scoped selection then bulk-tiered the 12 leads B;
the UI confirms 12 Tier B, zero untiered. All five steps are personalized, so tiering does not
replace their saved copy with a template or Auto Observation.

Campaign coverage reports 12 Needs review, zero ready/missing/blocked for each of Steps 1–5.
Read-only database reconciliation confirms 60 reusable sources, 60 bound copies, Campaign 2
draft with automatic enrollment off and pool-only selection, and unchanged historical
enrollment/sent-event watermarks of one. Projection dry-run checks one enrollment with zero diffs
and self-check passes. Backup `coldemail-20260913-170109.dump` (859,826 bytes) passes catalog
validation. No activation, enrollment, or send occurred, and no copy was marked ready.

**F-W34 — deployed at `61a5b15`, sequence-preview conversation subject:** authenticated sequence previews render
all five imported bodies for one lead and a distinct first-step subject/body for a second lead.
Step 3's new-conversation subject is correct, but Step 4/5 previews incorrectly use `Re:` plus
Step 1's subject, rather than Step 3's. Code inspection confirms `api/sequences.ts` still looks up
Step 1 when selecting the personalized preview's opener. The scheduler already uses the nearest
preceding new-conversation step (F-W33); this is a verified preview-path mismatch, not evidence of
an actual misthreaded send. All sampled previews report passing pre-send checks and retain Needs
review. The full 60-preview review is not complete.

The separately operator-approved fix replaces the preview's Step-1-only lookup with the same
pure `conversationRootStepNo` selector already used by the scheduler. For personalized roots,
Steps 2/4/5 now preview `Re:` plus the subject of Steps 1/3/3 respectively. No scheduler,
transport, footer, header, schema, copy-readiness, or production-state behavior is changed.
An added API regression first failed on Step 4 (`Re: First idea` instead of `Re: Another idea`),
then all nine sequence API tests passed after the fix. It verifies all five subjects and literal
bodies, unchanged complete saved-copy rows and event watermark, and no borrowing of the first
conversation's subject when the second opener's copy is absent. Deployment and live full-copy
review remain separate handoffs; the pilot is still draft and nothing was sent.

The complete local verification gate passes: typecheck, lint, format check, unit **348/348**,
web **67/67**, API **145/145**, integration **171/171**, GreenMail **29/29**, locked golden
exactly **47/47**, mock E2E **63/63**, real-backend E2E **1/1**, and the real-API subpath
production build. Mock E2E retains the already-recorded F-T01 missing-copy-coverage-fixture proxy
warnings while all assertions pass. A populated disposable database reports `checked 5
enrollments — 0 diff(s)` and self-check reports no invariant violations. No migration or live
production operation was required.

After explicit authorization, `origin/canary` and Spaceship fast-forwarded to `61a5b15` through a
reviewed bundle whose SHA-256 matched locally and remotely. Pre-deploy
`coldemail-20260913-172408.dump` (862,875 bytes) and post-deploy
`coldemail-20260913-173113.dump` (863,814 bytes) both pass 342-line restore-catalog validation.
All four stack services are running and the app/database health check passes; all 20 migrations
remain applied. Production projection replay reports `checked 1 enrollments — 0 diff(s)`,
self-check is clean, and failed jobs, open error alerts, and personalized-copy blockers are zero.
The public app, Leads, Sequence 2, health, canonical redirect, both outreach redirects, and
portfolio routes pass; both unsubscribe-host roots retain the expected 404.

An authenticated read-only production replay for the imported Mike lead verifies Step 4 and Step
5 both render `Re: adding a portfolio`, the exact Step 3 new-conversation subject. Both retained
Needs review and passed all pre-send checks at 10/10. Production remained 12 current Tier B leads,
60 campaign copies, 12 available pool rows, Campaign 2 draft, automatic enrollment off, and zero
active campaigns. The one historical enrollment and sent event remained unchanged, and no email
was sent. The later interrupted readiness attempt and F-W35 decision are recorded above.

## 2026-09-13 CSV and mail dependency security remediation — deployed at `baac951`

The operator authorized resolving the newly reported runtime advisories, testing, and deployment
before importing the 12-lead pilot. Server dependencies are pinned to `csv-parse` **7.0.2**,
`nodemailer` **9.1.1**, `mailparser` **3.9.20**, and `imapflow` **1.6.0**. The lockfile removes
the older transitive Nodemailer copies; no forced audit rewrite, application behavior change,
schema migration, or production-data mutation is part of this release.

Two added unit regressions verify the upstream duplicate-`__proto__` CSV-column protection and
round-trip all five personalized subject/body pairs with quoted commas and multiline cells.
The complete serial gate passes: typecheck, lint, format check, unit **348/348**, web **67/67**,
integration **171/171**, API **144/144**, GreenMail **29/29**, locked golden **47/47**,
mock E2E **63/63**, real-backend E2E **1/1**, and the real-API subpath production build. The
GreenMail and scheduler suites retain coverage of reply ingestion, STOP/bounces, threading,
RFC 8058 headers, pacing, immutable copies, and missing-copy holds. Mock E2E still emits the
previously recorded F-T01 missing-copy-coverage-fixture proxy warnings; the suite itself passes.

A clean Linux `npm ci` / pruned app image builds and imports the real SMTP/IMAP transport and
CSV parser. Both local and pruned-image runtime audits report **zero vulnerabilities**. The full
repository audit separately reports **10 development/build findings** (7 moderate, 3 high):
`@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `@vitest/mocker`, `brace-expansion`,
`drizzle-kit`, `esbuild`, `nanoid`, `postcss`, `undici`, and `vitest`. This is not a claim that
the complete development dependency graph is clean or that future advisories cannot appear.

The populated disposable test database reports `checked 5 enrollments — 0 diff(s)` and a clean
self-check. Its 110,754-byte custom-format dump passes a 274-line catalog check and restores
into the new disposable `coldemail_security_restore_20260913` database. Rebuild, a second
five-enrollment zero-diff dry-run, and self-check all pass; only that verified scratch database
was removed afterward.

The verified change was committed/pushed and deployed at `baac951` through a SHA-256-matched
reviewed Git bundle and clean fast-forward. Pre-deploy `coldemail-20260913-135104.dump`
(799,518 bytes) and post-deploy `coldemail-20260913-135407.dump` (799,922 bytes) both pass
342-line catalog validation. The running pruned app reports zero runtime advisories and the exact
four pinned versions. App/database health, all four stack containers, all 20 migrations,
`checked 1 enrollments — 0 diff(s)`, self-check, zero failed jobs, and zero open error alerts pass.
Public app/direct SPA routes return 200, the bare app path and outreach roots redirect 308,
the portfolio returns 200, and both unsubscribe-host roots retain 404. DNS, host Caddy, and the
portfolio stack were not changed.

Post-deployment authenticated campaign and mailbox UI loads and agrees with the database. System
shows a fresh scheduler tick and four healthy pollers. Domain readiness reports no blocking
failures: compliance, mailbox health/caps, SPF, DKIM, DMARC, and MX pass for both outreach domains.
The sole warning is the explicitly operator-selected zero-day minimum ramp, not a changed setting.
All four mailbox polls are fresh and healthy. The pilot caps, draft state, automatic-enrollment-off
setting, global/bounce settings, zero current leads, and single historical enrollment/sent-event
watermarks are unchanged. The operator may now import the 12-lead CSV and allocate it to
**US Property Management**, keeping the campaign draft until all 60 personalized copies,
tiering, and rendered previews have been checked. This release did not authorize or create a
prospect send.

Read-only authenticated UI and database checks confirm the existing pilot setup: all four
mailboxes are `ok`, 3 messages/day each, New York Monday–Friday 09:00–17:00, with INBOX and
Gmail Spam polling. Campaign **US Property Management** remains draft, automatic enrollment off,
and every stage/permanent cap is 12/day. Sequence **US Personalized — Five Emails** retains five
Personalized Copy steps, waits 0/3/4/4/5 calendar days, and new/continue/new/continue/continue
conversation choices. Rendered lead-copy previews necessarily await import. The operator's saved
bounce guards are 25 minimum sends, 4% over 50 sends, 2 bounces in 10 sends, and 50% resume cap.
There are zero current leads and the historical enrollment/sent-event watermarks remain one.
No import, allocation, activation, enrollment, or send occurred.

## 2026-09-13 12-lead pilot limits

After deploying the conversation-threading remediation, the operator authorized preparation for a
12-lead pilot but did not authorize import, activation, enrollment, or sending. Through the
authenticated production UI, all four connected OAuth mailboxes were reduced from 25/day to
**3/day each** while retaining `America/New_York`, Monday–Friday, 09:00–17:00, and `ok` status.
Production therefore has a configured aggregate mailbox capacity of 12 messages/day, including
follow-ups.

Campaign **US Property Management** (`campaign_id=2`) remains `draft` with automatic enrollment
off. All five draft ramp-stage caps, the draft permanent cap, and the pool permanent cap are now
**12/day**, creating a flat pilot allowance rather than a staged ramp. The Settings UI was checked
without further mutation: send-window enforcement, automatic/global opt-out suppression,
five-minute scheduler and IMAP polling, 20% jitter, New York default timezone, the physical address,
and the sender-domain unsubscribe URL remain configured. The broader 30/day mailbox and 100/day
campaign configuration ceilings remain unchanged; the lower saved mailbox and campaign values are
the effective pilot limits.

Read-only production reconciliation confirms zero non-erased leads, the unchanged single historical
enrollment and sent event, `checked 1 enrollments — 0 diff(s)`, and a clean self-check. No lead,
pool reservation, enrollment, or send was created. Post-change backup
`coldemail-20260913-123947.dump` is 790,702 bytes and its `pg_restore --list` catalog validates.

## 2026-09-13 US personalized outreach preparation and threading remediation

The operator authorized application preparation before importing real lead batches. Through the
authenticated UI, all four connected OAuth mailboxes were saved at 25/day, Monday–Friday,
09:00–17:00, with `America/New_York` fallback timezone. Read-only production reconciliation
confirms identical windows/caps and `ok` status for mailbox IDs 1–4. Global capacity is 100
messages/day including follow-ups, not 100 new leads/day or a guaranteed send quota.

Sequence **US Personalized — Five Emails** (`sequence_id=2`) was created with five Personalized
Copy steps, no template variants, waits 0/3/4/4/5 calendar days, and conversation flags
new/continue/new/continue/continue. Campaign **US Property Management** (`campaign_id=2`) was
created against it and remains `draft`, with automatic enrollment off. At the operator's explicit
request to start at 25/mailbox on day one, every stage and the permanent enrollment cap were saved
at 100/day: this is a flat allowance, not a gradual ramp. Its selection mode remains
`global` until a real import allocation creates its pool; normal pool allocation switches it to
`pool`. No synthetic lead or pool reservation was created to force that transition.

The Settings UI confirms New York default timezone, enforced windows, automatic/global opt-out
suppression, five-minute scheduler and IMAP polling, 20% jitter, existing bounce guards, 30/day
mailbox ceiling and the configured business address/sender-domain unsubscribe footer. The global
enrollment configuration ceiling was raised to 100/day and minimum ramp set to zero, as explicitly
requested. Read-only production reconciliation verifies these saved values, the flat campaign
stage/permanent caps, and unchanged draft/automatic-enrollment-off state. Other settings were retained.

**F-W33 — second conversation threading:** the defect was reproduced: every continued step used
the enrollment's first sent subject and included all previous sequence-message IDs. The scheduler
now anchors each continued step to the nearest preceding new-conversation step. Its exact sent
subject supplies `Re:`, `In-Reply-To` targets the latest message within that conversation, and
`References` contains only that conversation's prior message IDs. A new five-step personalized-root
integration case proves new/continue/new/continue/continue produces two independent conversations,
including exact Step 3 snapshot subject reuse and Step 4/5 reference boundaries.

The local release gate passes: typecheck, lint, format check, unit 346/346, web 67/67, integration
171/171, API 144/144, GreenMail 29/29, locked golden exactly 47, mock E2E 63/63,
real-backend E2E 1/1, production web build, zero projection drift, and clean self-check. Production
was pushed and deployed at `33bad55` after an independently validated 789,419-byte pre-deploy
custom-format backup. The app, database, backup, and gateway containers are up; application health,
the public app/direct-route/redirect/portfolio/unsubscribe-host matrix, `checked 1 enrollments — 0
diff(s)`, and self-check pass. A 789,616-byte post-deploy dump passes catalog validation. The
historical sent/enrollment watermarks remain one and no current lead exists, proving the deployment
sent no mail or created operational records.

The clean production image audit also surfaced newly published runtime advisories that are outside
this threading change: direct `csv-parse` (<7.0.2) and `nodemailer` (<=9.1.0), with the latter also
reported through `imapflow`/`mailparser`. They must be assessed and updated under a separate tested
dependency change before prospect activation; no forced audit rewrite was performed during this
release.

Rendered personalized previews await imported lead/campaign/step copy. Database reconciliation
confirms zero non-erased leads, only the prior single historical enrollment, and an unchanged
single sent event. No CSV was imported and no activation, enrollment, or send occurred.

## 2026-09-06 single-message unsubscribe check cleanup

After the operator-controlled single-message unsubscribe check completed, the operator explicitly
approved the supported cleanup path for its live records. Campaign **Unsubscribe Check**
(`campaign_id=1`) was already paused and was archived through the authenticated Campaign UI. Its
test lead was then erased through the authenticated Lead privacy flow. The Leads UI now reports
zero current leads, while the Campaigns UI shows the campaign as `archived` with no available
action.

Read-only production reconciliation confirms zero non-erased leads and one erased lineage row. The
single historical `sent` event and its `sent_messages` row remain, as required by the append-only
audit model, while all three rendered subject/text/HTML snapshot fields are null after erasure.
The referenced sequence remains present because it is part of that immutable history. The one
OAuth mailbox was not removed and its fallback timezone remains `America/New_York`. No campaign
was activated or resumed, no lead was enrolled, and no email was sent during cleanup.

## 2026-09-04 unsubscribe presentation follow-up — deployed at `0a2f3c0`

The operator approved a presentation-only refinement based on a supplied footer reference. The
canonical HTML footer and both operator previews now keep the existing two-line 10px structure,
20px top separation, 1.5 line height, and `#595959` text color, but render **Unsubscribe** bold and
without an underline in the same gray as the postal address. The clickable anchor, destination,
plain-text full URL, address, capability-token flow, RFC 8058 headers, and public unsubscribe
behavior are unchanged. This does not attempt to influence Gmail's accepted trimming behavior.

Verification passes: focused renderer 26/26; focused Compliance preview 6/6; full unit 346/346;
full web 67/67; typecheck, lint, and format; and the production Vite build. The existing large-chunk
build warning remains non-fatal. No migration, database, campaign, lead, mailbox, enrollment,
event, send, DNS/Caddy, or production-state change occurred during local verification.

After explicit push/deploy authorization, `origin/canary` advanced to `0a2f3c0`. A reviewed bundle
had matching local/remote SHA-256
`e24505f264116691c1fa174d139195b87c9bab9e6484c0ea4c89505d7951452b` and fast-forwarded the clean
VPS checkout from `552fab8` to the exact candidate. The app image built and its production prune
reported zero vulnerabilities. The first gateway build stopped before recreation on a transient
Docker Hub TLS handshake timeout; an unchanged retry succeeded, after which the stack was
recreated normally.

Post-deploy verification: app/database health passes and gateway/backup services are running;
internal and public `/email-campaign/health` return `{ok:true,db:true}`; the SPA and direct
Sequences route return 200; both outreach roots retain their portfolio redirects; both
unsubscribe roots return 404; and the portfolio returns 200. The checkout and renderer carry the
exact new gray/bold/non-underlined marker, and the served frontend asset contains the matching
preview wording. All 20 migrations through `0019` remain applied. The live workspace remains at
zero leads, campaigns, sequences, enrollments, events, mailboxes, sent messages, and sendable work;
New York safeguards are unchanged. Projection dry-run reports `checked 0 enrollments — 0 diff(s)`
and self-check is clean. Pre-deploy dump `coldemail-20260904-174221.dump` (162,674 bytes) and
post-deploy dump `coldemail-20260904-174656.dump` (162,878 bytes) both pass `pg_restore --list`.
Temporary local and VPS bundles were removed. No email was sent and the portfolio was unaffected.

A subsequent operator-requested recheck reran typecheck, lint, format, all unit **346/346**, all
web **67/67**, and a fresh production frontend build successfully. Local Docker remained closed,
so DB-backed API/integration/GreenMail suites were not redundantly restarted for this
presentation-only diff. Read-only production reconciliation independently confirmed exact local/
VPS footer-source SHA-256 parity, the deployed gray/bold/non-underlined renderer marker, the served
preview marker, healthy app/database containers with running gateway/backup services, 20
migrations, zero operational records/open error alerts/sendable work, preserved New York
safeguards, `checked 0 enrollments — 0 diff(s)`, clean self-check, the expected public route
matrix, and a valid post-deploy backup catalog. No regression or unexpected state change was found.

## 2026-09-04 operator-requested production workspace reset

After the final five-lead owner-address canary and recipient-action reconciliation, the operator
explicitly requested a one-time completely fresh live workspace before importing real leads. All
five campaigns and four mailboxes were first paused, auto-enrollment was disabled, and sendable
work was verified as zero. A pre-reset custom-format backup
`coldemail-20260904-110328.dump` (1,599,917 bytes) passed `pg_restore --list`.

The populated production database was not truncated and its append-only event history was not
rewritten. Instead, it was renamed intact to `coldemail_canary_archive_20260904`, and a new empty
`coldemail` database was created and migrated through all 20 migrations ending at
`0019_personalized_copy_two_tiers`. The current operator row and the configured compliance address,
footer text, and sender-domain unsubscribe template were carried forward without exposing their
contents. The temporary transfer file containing the operator password hash was removed after
verification.

The live database now contains zero leads, campaigns, sequences, enrollments, events, mailboxes,
imports, suppressions, alerts, sent messages, incoming messages, or Personalized Copy sources. The
authenticated Leads UI shows `0 total`; Mailboxes shows `Nothing here yet` and total daily capacity
zero. The prior test analytics remain recoverable only from the archived database and validated
pre-reset dump; they are deliberately absent from the live application.

Real-outreach defaults are now: `America/New_York`; send-window enforcement on; automatic opt-out
detection and global unsubscribe suppression on; scheduler and IMAP poll every five minutes; 20%
send jitter; maximum configurable mailbox cap 30/day; maximum campaign enrollment cap 15/day; and
a mandatory seven-day ramp. These are safety ceilings, not recommended day-one volume; each newly
connected mailbox should still begin at the operator's deliberately chosen low cap.

Post-reset verification: app/database health passes and gateway/backup services are running;
public app health, the SPA, and the unrelated `sambhavbuilds.com` portfolio return 200; projection
dry-run reports `checked 0 enrollments — 0 diff(s)`; self-check is clean; and post-reset dump
`coldemail-20260904-110609.dump` (146,619 bytes) passes `pg_restore --list`. No code, image, DNS,
Caddy, portfolio, or Oracle change occurred. Creating mailboxes, importing real leads, activating,
enrolling, and sending remain separately operator-controlled actions.

## 2026-09-04 final canary cohort staging — five leads imported, no send state

After the runtime dependency deployment was verified, the operator authorized preparation of five
fresh owner-controlled aliases for the final canary. The browser's file chooser was not available
to automation, so the same five CSV rows were submitted individually through **Add lead**. That UI
uses the normal one-row ingest preview/commit path; it does not bypass hygiene, deduplication, or
suppression checks.

Read-only production reconciliation verified that the five exact aliases are lead IDs 12–16 with
`source=csv_import`, `tier=NULL`, `outreach_status=standard`, and `is_suppressed=false`. They have
zero `campaign_lead_pool` rows and zero enrollments. The database now contains 16 leads in total,
including the 11 pre-existing records. The sent-event watermark remains 24, auto-enrollment remains
disabled, and there are zero due enrollments belonging to an active campaign. One older calendar-due
row belongs to the paused Aurora canary and is therefore not sendable. No campaign was assigned,
tiered, enrolled, activated, resumed, or sent as part of this staging step.

The Gmail aliases are suitable for the next bounded setup. The university-domain plus alias must be
treated as unproven until an owner-controlled delivery is accepted; do not infer provider support
from successful lead ingestion. Campaign assignment, tiering, enrollment, activation, and the exact
outbound batch remain separately gated.

The operator then authorized the remaining setup, still stopping before enrollment, activation,
or delivery. Production now has draft campaign and sequence **Final Canary Sep3** (`campaign_id=5`,
`sequence_id=5`). The five-step path is Personalized Copy → two-variant researched/Auto template →
Personalized Copy → two-variant new-conversation template → two-variant threaded template with
two-way `{{RANDOM|...|...}}` spintax. All waits are zero days; delivery pacing comes from the
mailbox schedule rather than the wait fields. Campaign Auto Observation uses the `company` field
with a readable default. Auto-enrollment remains off.

The five exact fresh leads are the only **available** pool rows: IDs 12–14 are Tier A and IDs 15–16
are Tier B. Tier A rows have researched `custom_observation` values. Each lead has ready campaign
copy for Personalized Steps 1 and 3, producing coverage of 5 ready / 0 review / 0 missing / 0
blocked at both steps. A count-only pool allocation initially selected two older eligible leads;
those rows were released before any enrollment and remain as intentional audit history. This is a
usability finding: exact-ID pool addition is safer than count-only "next safe" selection for a
named canary cohort.

Campaign-context previews caught and corrected two authoring errors before activation: the
supported researched/Auto slot is `{{custom_observation}}`, not `{{observation}}`, and supported
spintax is `{{RANDOM|a|b}}`, not `{a|b}`. Final previews verified ready Personalized Steps 1 and 3,
Tier A researched resolution, Tier B Auto Observation resolution, both variants at Steps 2, 4,
and 5, two actual Step 5 expansions per variant, threaded `Re:` subjects, the Step 4 independent
subject, and the compliance footer. No fatal render check remains; the only copy note is that these
deliberately short canary bodies are below the advisory 40-word target.

Final read-only reconciliation: campaign 5 is `draft`, pool-only, steady cap 15, with five
available and two released audit rows; it has zero enrollments and zero sent messages. The global
sent-message watermark remains 24 and there are zero due enrollments attached to an active
campaign. Scheduler tick is five minutes, send jitter is 0%, and all four healthy mailboxes use
Asia/Kolkata, daily cap 50, and the temporary Mon–Fri 00:00–04:10 canary window. Those temporary
settings are staged for the separately approved live canary and must be restored after it.

### Live outcome — 25-message owner-controlled journey completed

The operator explicitly authorized activation, exact enrollment of the five staged aliases, and
the bounded owner-address send. Campaign 5 activated at 00:59 IST and enrolled exactly lead IDs
12–16: three `template_researched` and two `template_auto`. The first scheduler wave at 01:00:38
assigned four leads across the four healthy mailboxes. The fifth lead shared mailbox 2 and began at
01:10:08. All five leads completed all five steps by 02:10:08, producing exactly 25 accepted sends:
5/10/5/5 by mailbox and 5 per lead. No mailbox sent twice in one tick; the minimum observed
same-mailbox gap was exactly 300 seconds for every mailbox. The shared mailbox serialized its two
threads, so some per-lead gaps were ten minutes rather than five.

Immutable snapshots reconcile as 10 Personalized Copy and 15 template messages, five at every
step. No subject, text body, or HTML body is missing, and every snapshot contains the unsubscribe
footer and postal address. Each automated step distributed variants A/B as 3/2. All 25 messages
have durable `sent` and `delivered` events. Overview shows 5/5 contacted and Campaign complete;
Analytics shows 5/5 confirmed at every step, Tier A contacted 3 and Tier B contacted 2, and the
expected 25-message health total. The operator reported that the recipient accounts received the
messages. Recipient-side unsubscribe/reply classification checks remain pending.

After completion, campaign 5 was paused and auto-enrollment remained off. The temporary settings
were restored through the UI: all four mailboxes are healthy at 5/day, Mon–Fri 10:00–18:00
Asia/Kolkata, and send jitter is back to 20%. Projection reconciliation returned `checked 15
enrollments — 0 diff(s)`; self-check reported no invariant violations; all four containers are up,
app/db health is green, and public `/health` returned 200. There is no remaining sendable work in
this campaign.

**New presentation finding:** the Analytics Tier insight says Tier A is "doing the work" when the
campaign has zero meetings, and recommends reconsidering Legacy Tier C even though the current
campaign has no Tier C and current enrollment supports only A/B. The underlying counts reconcile;
the generated advice should be suppressed or made conditional when its denominator is zero or the
legacy tier is absent.

## 2026-09-03 runtime dependency remediation — deployed at `552fab8`

The operator approved fixing the runtime audit findings before the final owner-address canary.
Fastify is updated from **5.10.0 to 5.12.1**; all locked `fast-uri` copies are updated from
3.1.5/4.1.2 to **3.1.7/4.1.4**. The related Fastify `process-warning` dependency advances to 5.1.0.
No automatic `npm audit fix --force`, schema migration, send-logic change, production mutation,
push, deployment, activation, enrollment, or real send was performed.

Assessment: the application uses a custom Zod compiler rather than the default Ajv pipeline and
does not configure numeric `trustProxy`. New integration checks prove parsed root-primitive
coercion, rejection outside the validated bound, and rejection of spoofed forwarded origin headers
under the actual server defaults. `fast-uri` is transitive through Fastify's schema tooling; the
application source has no direct import. These observations narrow the known exposure but are not
a blanket claim of non-exploitability. Primary advisories:
[root primitive validation](https://github.com/advisories/GHSA-w2qp-rph6-63g4),
[proxy trust](https://github.com/advisories/GHSA-3m5p-2c4r-xxw2), and
[URI normalization](https://github.com/advisories/GHSA-f65p-4m7j-42xc).

Verified gate: typecheck/lint/format; unit **346/346**; web **67/67**; API **144/144**;
integration **171/171** (including three new probes); GreenMail **29/29**; locked golden exactly
**47/47**; mock-browser E2E **63/63**; real-backend E2E **1/1**; real-API production Vite build
for `/email-campaign/`; populated **checked 5 enrollments — 0 diff(s)**; and clean self-check.
DB-backed suites ran serially. The custom-format local dump
`/tmp/dependency-security-20260903.dump` in `coldemail-postgres` passed its 321-entry catalog check
and restored into a newly created `coldemail_dependency_restore_20260903` database. The restored
five-enrollment cohort also passed zero drift and self-check. Only that disposable restore database
was dropped afterward; the dump and original test database remain.

A clean Linux `Dockerfile` app-target build (`coldemail-security-candidate:20260903`) passed
`npm ci`, production pruning, and a network-disabled import of the production server through tsx.
Both the local `npm audit --omit=dev --json` and the production-image prune audit report **zero
runtime findings**. The full development/build dependency graph still reports **eight affected
packages (five moderate, three high)**: `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`,
`drizzle-kit`, `esbuild`, `brace-expansion`, `nanoid`, `postcss`, and `undici`. They remain a separate
assessed/tooling-update task; some suggested fixes are breaking changes or downgrades. This release
does not claim that the full repository audit is clean or that future advisories cannot appear.

Verification caveats and findings:

- Local parallel browser/web runs encountered worker/test timeouts under memory pressure. The
  complete isolated web run and one-worker browser rerun pass. The real-backend server also exceeded
  its 90-second startup budget while the image build was completing; the isolated rerun passed at
  the unchanged timeout. These are not claimed as successful initial runs.
- Two existing browser selectors were ambiguous: `Cold Storage` also matched `Recycle cold
  storage`, and `Campaign` also matched the sent-today progress label. Exact accessible-role/name
  selectors now resolve those tests without changing product behavior; the full 63-test rerun passes.
- **F-T01 — open, mock harness:** the MSW handler set lacks
  `GET /campaigns/:id/personalized-copy-coverage`. Mock campaign-detail visits therefore log proxy
  connection refusals despite the covered flows passing. Add a contract-faithful fixture and
  assertion separately; do not claim mock E2E verifies this coverage card. Real API coverage tests
  are part of the passing API suite.
- The production frontend build retains its existing large-chunk warning; it is not a build failure.

A pre-candidate read-only authenticated live visit loaded Overview and Leads successfully,
including the default Atlas selector and lead-level delivery wording. It confirmed existing
suppression on prior owner test recipients; no suppression or lead history was cleared.

After explicit push/deploy authorization, `origin/canary` advanced to `552fab8`. A 4,495,921-byte
reviewed bundle had matching local/remote SHA-256
`9da472b2cbd8f82041dab5c5597f5a32c4824b035bd8b321e7870e012acfd204`, verified as complete, and
fast-forwarded the clean Spaceship checkout from `17cf93d` to that exact commit. App, gateway, and
backup images rebuilt and the stack recreated. The production prune reported zero vulnerabilities.
No migration was added.

Preflight sent watermark was 24, with zero due/future active work and auto-enrollment disabled.
Post-deployment: four healthy containers; internal health `{ok:true,db:true}`; deployed Fastify
5.12.1 and fast-uri 3.1.7/4.1.4; all 20 migrations through `0019`; `checked 10 enrollments — 0
diff(s)`; clean self-check; four `ok` mailboxes; zero open error alerts/copy blockers; and the same
24-message watermark with zero due/future active work. SPA/Sequence routes return 200; the bare
app path and both outreach roots retain their expected 308 redirects; both unsubscribe roots
return 404; and the portfolio returns 200. Pre/post dumps
`coldemail-20260903-182915.dump` (1,472,596 bytes) and
`coldemail-20260903-183420.dump` (1,473,229 bytes) each passed a 331-entry restore-catalog check.
The temporary VPS bundle was removed. No lead, campaign, enrollment, mailbox, DNS/Caddy, Oracle,
or sent state changed. A fresh authenticated post-deployment UI replay remains pending because the
previous in-app tab was no longer available after the environment transition.

Each precisely bounded live send batch still requires separate authorization.
The proposed canary ceiling is **20 total messages**, not a guarantee of five per mailbox: normal
rotation assigns openers, started threads remain pinned, and reply/STOP/unsubscribe/missing-copy
tests deliberately prevent subsequent sends. New aliases must not bypass recorded opt-outs.

## 2026-09-03 shared-VPS cache cleanup — verified

After the operator explicitly approved cache-only cleanup while protecting the portfolio,
`docker builder prune --all --force` removed unused build cache (Docker reported 10.29 GB),
and `apt-get clean` reduced downloaded package archives from 388 MiB to 24 KiB. Root filesystem
usage fell from 74% (17 GB used, 6.3 GB available) to 33% (7.5 GB used, 16 GB available).
Cache accounting includes shared layers, so Docker's reclaimed total is not an independent
filesystem-space measurement. Build cache is now zero; all four running images/containers and
both data volumes remain. No image/container/volume pruning, file deletion, log trimming, service
restart, deployment, or application-state change was performed beyond these two cache operations.

Before/after checks: portfolio `https://sambhavbuilds.com/` returned 200; email UI returned 200
after cleanup; email health returned `{ok:true,db:true}` before and after. Host Caddy remained
active and all four container IDs stayed unchanged. Database, backups, portfolio/application
files, configuration, certificates, swap, and logs were untouched. Removed caches can be
regenerated/downloaded; future image builds may take longer.

## 2026-09-03 six-finding release — deployed at `c75a385`

After explicit push/deploy authorization, `origin/canary` advanced to `c75a385` and a reviewed
bundle fast-forwarded the clean Spaceship checkout from `321f283` to that exact release. The local
and remote SHA-256 both matched
`b514ce6ffc73bb26fb719cecd91028230703c246251a02e352225f264e9d75a1`.
App, gateway, and backup images rebuilt and the stack recreated; no migration was added.

Verified: running containers with healthy app/database; public health `{ok:true,db:true}`; SPA and
Overview/Leads/Cold Storage/Sequences routes 200; bare subpath 308 canonicalization; both outreach
roots 308 to the portfolio; both unsubscribe roots 404; portfolio 200. Public assets contain the
new lead-level status, campaign-source, Cold Storage selector, sent-subject, and preview-prompt
markers. All 20 migrations through `0019` remain applied; production reports `checked 10
enrollments — 0 diff(s)` and clean self-check. Four mailboxes remain `ok`; failed jobs, active
NEW/ACTIVE work, available pool rows, and auto-enrollment-enabled campaigns are zero. The sent
ledger remains **24**, with unchanged last-send time **2026-09-02 15:10:35.874 IST**.

Pre/post dumps `coldemail-20260903-111201.dump` (1,464,831 bytes) and
`coldemail-20260903-111439.dump` (1,465,495 bytes) passed `pg_restore --list`. No campaign,
enrollment, mailbox, DNS/Caddy, Oracle, or `main` changes were made and no email was sent.
Authenticated post-deploy UI replay remains pending: the in-app browser had no existing tab and
opening the application returned `net::ERR_BLOCKED_BY_CLIENT`. This is a browser-tool limitation;
the public route and served-asset checks passed, but are not claimed as an authenticated UI replay.

**Dependency follow-up — resolved locally, deployment pending:** npm's build audit reported ten total dependency findings. The
separate runtime audit (`npm audit --omit=dev --json`) reports two affected packages: high-severity
`fast-uri` URI-normalization/host-confusion advisories and moderate-severity `fastify` validation/
proxy advisories. The lockfile is unchanged from the prior deployed release. No exploitability
claim or blanket safety claim is made; assess exposure and update the dependencies with a fresh
test gate before prospect launch. No automatic audit fix was applied during this pinned rollout.
The verified runtime update and remaining development-tool findings are recorded above; this
historical deployed-release audit must not be mistaken for the candidate's zero-runtime audit.

## 2026-09-03 remaining six UI findings — verified locally, not deployed

The operator-approved F-W26–F-W31 fixes are complete and locally verified on `canary`.
Overview explicitly labels delivery status as lead-level and names its default campaign. Leads
shows selected-campaign pool provenance (including enrolled/released history) or Direct enrollment,
instead of mislabeling enrolled campaign leads Global. Cold Storage has a visible URL-backed source
campaign selector. Sent Personalized Copy shows both the saved audit subject and the exact stored
send subject, with an explicit unavailable label for historical null snapshots. Personalized
Sequence preview asks for a lead rather than calling the step an unsaved variant.

Verified serial gate: typecheck/lint/format; unit **346/346**; web **67/67**; API **144/144**;
integration **168/168**; GreenMail **29/29**; locked golden exactly **47/47**; mock-browser E2E
**63/63**; real-backend E2E **1/1**; production Vite build; populated `checked 5 enrollments — 0
diff(s)`; clean self-check; and a custom-format backup catalog/scratch restore with the same
five-enrollment zero-drift and self-check results. The first complete browser run caught a default
selector interaction regression; it was corrected and the full suite rerun successfully. Web tests
also pass with a 20-second CLI test budget after a load-related default-timeout failure.

The standalone golden seeder is not a valid input to the generic shape-loading CLI without its
fixture-specific campaign shape: it stores no sequence, while its completion helper uses an
explicit golden shape. A supplemental run therefore reported shape-dependent differences. No
production projection was changed; the normal real-backend five-lead cohort supplied the final
populated check. The locked golden fixtures and their 47-test gate were not modified.

No migration, event-ledger, scheduler, transport, footer/header, or sending behavior changed.
At that local checkpoint production remained at `a8c2e65`, and no push, deployment, production
mutation, or outbound mail had occurred. The subsequent authorized deployment is recorded above.

## 2026-09-02 owner-address follow-up visibility and reply canary

### Post-remediation live retest — provider behavior accepted; headers verified

After separate action-time approval for exactly one owner-controlled message, Aurora Canary was
resumed long enough for its untouched control (`jainsambhav2605+canary-sep2-a@gmail.com`) to send
Personalized Step 3 through the normal production scheduler. The message was accepted once at
2026-09-02 15:10:36 IST from mailbox 2. Aurora was immediately paused; the enrollment advanced to
Step 4 but remained ACTIVE-and-held, and the next scheduler boundary left the sent ledger at
exactly 24 events. No Step 4 message leaked and no prospect address was used.

The immutable sent snapshot proves the production renderer used `content_source=personalized`,
the expected in-thread `Re:` subject, the 10px two-line presentation table, `#1155cc` link color,
an HTTPS Unsubscribe URL, and no `Reply STOP` footer text or leading body whitespace. The lead
timeline updated immediately. Analytics correctly exposed Step 3 as 1 sent, 0 confirmed, and 1
pending before the six-hour confirmation job. Public health is 200, all four mailboxes remain
healthy, projection dry-run is 0 diffs, self-check has no invariant violations, and there are no
open error-severity alerts.

The operator then inspected the received message and Gmail's **Show original** source on desktop.
Gmail kept the complete
two-line footer behind the three-dot **Show trimmed content** control; after expansion, the blue
Unsubscribe link and postal address rendered exactly as intended. Gmail exposed no native
unsubscribe control beside the sender, and the message landed in Promotions. This proves that the
presentation-table remediation did not defeat Gmail's repeated/footer-content trimming heuristic.
The original source proves SPF, DKIM, and DMARC all passed; both `List-Unsubscribe` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` reached Gmail; and the valid domain DKIM
signature's `h=` list covers both headers. It also proves the expected multipart text/HTML body,
TLS transport, and thread headers. RFC 8058 transport/header conformance is therefore verified on
the live message, while Gmail's native UI and resulting client-initiated POST remain unverified
because Gmail withheld the control. A single Promotions placement is not evidence of
domain-reputation damage. The operator accepts Gmail's trimming as a client-controlled limitation;
post-remediation mobile visibility is no longer a launch gate. F-W17 is closed as an accepted
provider behavior, not as a claim that Gmail can be forced to show the footer.

The walkthrough normalized the application default timezone and all four mailbox fallbacks to
`Asia/Kolkata`, with a consistent Mon–Fri 10:00–18:00 send window. Aurora and Comet remain paused;
Atlas and Beacon are active but have only terminal current enrollments. The scheduler correctly
raised a durable `send_blocked_send_window_closed` warning while the earlier midnight-only mailbox
window was closed; it remains open for operator acknowledgement as historical evidence.

### Post-remediation UI findings — status

| ID | Verified behavior | Required improvement |
|---|---|---|
| F-W25 | Sequence preview rendered the fallback “Reply STOP” footer although Compliance was configured with the sender-domain Unsubscribe URL; the actual scheduled message used the correct link-only footer. | **Fixed and deployed:** configured link mode now renders through the real footer with a permanently non-resolving `.invalid` preview URL. Preview creates no unsubscribe capability token. |
| F-W26 | Analytics showed the new Step 3 message as pending immediately, but Overview still said “3 delivery confirmed · 0 awaiting confirmation” because it classifies contacted leads by whether they have any earlier confirmed message. | **Fixed, verified, and deployed:** explicit lead-level wording distinguishes these values from Analytics message-level confirmation. Release `c75a385`. |
| F-W27 | Leads → Aurora → Enrolled/Both returned the correct three leads, but the Pool column labeled every enrolled pool lead “Global” because the list DTO exposes only currently-available pool assignments. | **Fixed, verified, and deployed:** Campaign source shows selected-campaign pool status or Direct enrollment; API covers enrolled/released provenance. Release `c75a385`. |
| F-W28 | Cold Storage silently defaulted to Atlas after the global header selector was removed. Beacon's finished lead appeared only by manually adding `?campaign=2`; no visible source-campaign control exists. | **Fixed, verified, and deployed:** visible Source campaign selector updates the URL and resets pagination. Release `c75a385`. |
| F-W29 | The sent Aurora Step 3 record was correctly immutable, but its Personalized Copy editor preview displayed the saved audit subject (`A second Northstar angle`) rather than the actual in-thread subject (`Re: Aanya, a quick Northstar idea`). | **Fixed, verified, and deployed:** separately labeled audit and actually-sent subjects, using the immutable snapshot; historical missing snapshots are explicit. Release `c75a385`. |
| F-W30 | A bare Overview route rendered the default campaign's metrics while the selector still displayed “Select campaign…”; selecting a campaign corrected the value. | **Fixed, verified, and deployed:** the selector names the default campaign; explicit selection still writes the URL and deep links remain intact. Release `c75a385`. |
| F-W31 | During Sequence preview, selecting a campaign before selecting a lead briefly showed “This variant is new — save the sequence before previewing it” for an existing Personalized Copy step. | **Fixed, verified, and deployed:** personalized preview asks for a lead; only genuinely new template variants receive the unsaved-variant prompt. Release `c75a385`. |
| F-W32 | In the deployed Sequence builder, changing a later step from **Continue existing conversation** to **Start new conversation** and then restoring the original choice still left the **Unsaved changes** banner visible. | **Fixed and deployed:** dirty state is derived from the effective write payload versus its saved baseline, so a full revert clears the warning and each successful save establishes the new baseline. |

The F-W25/F-W32 remediation is deployed at application commit `a8c2e65`. It changes no database
schema, scheduler, mail transport, footer styling, RFC 8058 header behavior, campaign,
enrollment, or sent state. Verification passes: typecheck/lint/format; unit 346/346; web 63/63;
API 144/144; focused Sequence API 8/8; GreenMail 29/29; locked golden exactly 47/47; mock-browser
E2E 62/62; focused Sequence browser E2E 3/3; production Vite build; `checked 0 enrollments — 0
diff(s)`; and clean self-check. The full integration project encountered varying existing
30-second scenario timeouts under unusually slow local Docker execution; fresh isolated reruns of
the affected poller 20/20, scheduler 18/18, and event-store 7/7 files all pass under their normal
limits, so no deterministic integration regression was reproduced.

After explicit operator authorization, `canary` was pushed and a reviewed 4,456,075-byte Git
bundle with matching local/remote SHA-256 fast-forwarded the clean Spaceship checkout from
`c1b9a94` to exact application commit `a8c2e65`. The app, gateway, and backup images rebuilt and
the stack recreated without a migration. All containers, app-direct and subpath health, the SPA,
direct Sequences route, canonical/outreach redirects, unsubscribe-host isolation, and portfolio
route pass. All 20 migrations through `0019` remain applied; production reports `checked 10
enrollments — 0 diff(s)` and clean self-check. Auto-enrollment, available pool, active due/future
work, failed jobs, open error alerts, and Personalized Copy blockers are zero. The sent ledger
remained 24 with the same 2026-09-02 15:10:35 IST watermark, proving deployment emitted no mail.
Pre/post dumps `coldemail-20260902-173809.dump` (1,344,276 bytes) and
`coldemail-20260902-174523.dump` (1,344,955 bytes) passed `pg_restore --list`. The deployed
container source contains the inert preview URL marker. An authenticated production browser replay
then changed Beacon Step 2 to **Start new conversation**, observed **Unsaved changes**, reverted to
the saved **Continue existing conversation** choice, and observed the warning clear. The same
read-only pass rendered Beacon Step 2 variant A and showed the blue underlined **Unsubscribe**
treatment plus address, with no fallback “reply STOP” text. The temporary choice was reverted and
was never saved. Oracle, `main`, DNS/Caddy, campaign, enrollment, mailbox, and sending state were
unchanged.

The separately authorized owner-address Gmail canary produced a negative result for follow-up
footer visibility. The footer was present in each message body, but Gmail collapsed it on both
clients: desktop displayed the three-dot **Show trimmed content** control and mobile displayed
**Show quoted text**. In both clients the operator had to expand the collapsed content to reach
the Unsubscribe link and postal address. The later post-remediation desktop result was unchanged.
After live header verification, the operator accepted this as Gmail-controlled presentation:
the application delivered the complete body footer, and no safe HTML structure can guarantee that
Gmail will expand repeated content in a thread.

Gmail did not display a native unsubscribe control beside the sender or in the message header in
the tested desktop/mobile views. The later post-remediation **Show original** evidence proves that
both RFC 8058 headers were present and covered by the passing domain DKIM signature. Because Gmail
offered no native control, only the provider UI and mailbox-client POST remain unverified. The
body-link unsubscribe, reply `STOP`, and an
ordinary interested reply were exercised; the live UI showed the corresponding `UNSUBSCRIBED`,
auto-unsubscribe/sequence-stop, and `REPLIED`/sequence-stop outcomes. No prospect address was used.

Final operator-approved presentation at that 2026-09-02 checkpoint: retain the compact **10px** footer size; render only
**Unsubscribe** as a conventional blue, underlined link (`#1155cc`); use `#595959` for the postal
address; keep a 1.5 line height; and keep 20px of top separation. The footer and RFC 8058 headers
remain unchanged. Do not duplicate unsubscribe language inside the sales copy and do not use
invisible-character or filter-evasion tricks. Threaded follow-ups may be trimmed by Gmail; an
operator who prioritizes footer visibility can instead start that step as a new conversation. The
2026-09-04 local presentation follow-up above supersedes only the link's color, weight, and
underline once deployed.

The local remediation candidate is implemented across the renderer, plain-text fallback, Settings
preview, Sequence preview, and mock API. It renders opt-out and address on separate lines; HTML
uses a one-cell presentation table 20px below the body at 10px/1.5 line height, with a blue
underlined Unsubscribe link and `#595959` address. It contains no blockquote/signature marker,
hidden content, or invisible-character variation. The complete serial local gate passes:
typecheck/lint/format; unit 346/346; web 60/60 (the unrelated OAuth UI test required its existing
timing allowance); integration 168/168; API 144/144; GreenMail 29/29; locked golden exactly 47/47;
mock-browser E2E 62/62; real-backend E2E 1/1; and the production Vite build. The disposable
event-backed projection fixture reports `checked 5 enrollments — 0 diff(s)` and self-check reports
no invariant violations. The later live result proved that this rendering is correct but cannot
control Gmail's thread presentation.

After explicit operator authorization, `canary` was pushed and a SHA-256-matched Git bundle
fast-forwarded the clean Spaceship checkout to `c31d73b`. App, gateway, and backup images rebuilt;
no migration was added. All containers and internal health pass. Direct-IP HTTPS verifies the app
and direct SPA routes at 200, canonical and outreach redirects at 308, and both unsubscribe roots
at 404; the served assets contain the new footer marker. Production remains at 20 migrations
through `0019`, with four healthy mailboxes, zero failed jobs/open alerts/personalized blockers,
zero available pool leads or auto-enrollment, and zero due/future work in active campaigns.
Projection dry-run reports `checked 10 enrollments — 0 diff(s)` and self-check is clean. The
sent-event count and watermark remained 23 and 2026-09-02 01:30:35 IST, proving deployment emitted
no mail. Pre/post dumps `coldemail-20260902-082320.dump` (1,320,418 bytes) and
`coldemail-20260902-083432.dump` (1,321,580 bytes) passed catalog validation.

The same verification briefly encountered DNSSEC `SERVFAIL` for both Spaceship-managed outreach
domains. Inspection in Spaceship proved DNSSEC was enabled automatically, and the registrar DS
records exactly matched the authoritative DNSKEY key tags and SHA-256 digests for each domain.
Fresh Google/Cloudflare query types then validated, followed by Google and Cloudflare A lookups,
Quad9, system resolution, and the complete public route matrix. No DNS setting was changed; DNSSEC
remained enabled. Record this as a transient provider incident, not a stale-DS repair, unless it
recurs with contradictory evidence.

Read-only production reconciliation after the recipient actions found both canary campaigns
paused. Aurora Canary has two `UNSUBSCRIBED` enrollments and one untouched control waiting at Step
3; Comet Canary has one `REPLIED` enrollment and one untouched control waiting at Step 3. Further
pre-fix mail would add little evidence while the footer defect is known, so the remaining controls
stay paused for post-remediation verification.

## 2026-09-01 owner-address walkthrough remediation — verified and deployed

The first complete Spaceship operator walkthrough used five operator-controlled recipients only:
three Atlas leads received one message each and two Beacon leads received five messages each, for
13 SMTP-accepted messages total. Beacon's per-lead gaps were 299–301 seconds and no enrollment
received two steps on the same scheduler tick. The walkthrough also proved a body-link
unsubscribe, a `STOP` reply that produced global suppression, and two replies to Beacon Step 2.
No prospect address was used.

The resulting remediation candidate closes findings F-W01–F-W16 and F-W18–F-W24 locally. It adds
release-update notice, discardable preview imports, authoritative allocation loading states,
post-bulk-tier guidance, exact filter-scoped tier totals, immutable campaign/step Personalized Copy
editing, authoritative lead-form refresh, tier-faithful and Personalized Copy sequence previews,
zero-day warnings, PostgreSQL-valid timezone canonicalization, Overview-only shared campaign
context, one consistent sent-recipient definition of Contacted, separate delivery-confirmed and
pending values, immediate sent-cohort analytics, template-step variant defaults, Finishing journey
presentation, and true journey-finished campaign progress. Campaigns remain active after the
current cohort finishes so later import batches can be added deliberately.

The public unsubscribe page now uses `Confirm, and I won’t send you any more emails.` and a
redeemed valid token renders the completed state without another form. Public resubscribe remains
deliberately absent because unsubscribe is a durable global suppression. The visible footer keeps
only Unsubscribe and the plain postal address; inbound `STOP` recognition remains active. HTML
paragraphs now have explicit email-safe margins and the first paragraph has no top gap.

Finding F-W17 is closed as an accepted provider limitation. The requested footer wording/layout is
implemented and synthetic text/HTML/GreenMail coverage passes, but the post-deployment real-Gmail
desktop follow-up still hid the repeated footer behind `Show trimmed content`. The received
original proves correct live RFC 8058 headers plus DKIM coverage. Gmail showed no native control,
so its provider UI and client-initiated POST remain unverified. The operator chose not to duplicate
unsubscribe language inside the sales copy or use filter-evasion tricks. Sequence steps now expose
the existing delivery choice plainly: **Continue existing conversation** or **Start new
conversation**; the latter uses its own subject without reply headers and is more likely, but not
guaranteed, to keep the footer visible.

The corresponding sequence-builder clarification is implemented locally without changing the
database, API contract, scheduler, renderer, transport, or saved `in_thread` values. Step 1 now
states that it always starts a conversation. Later steps replace the ambiguous **Reply in thread**
switch with accessible choice cards for **Continue existing conversation** and **Start new
conversation**, including the effective subject/header and Gmail-footer tradeoff. The footer and
RFC 8058 headers remain unchanged, and no duplicate opt-out sentence is inserted into sales copy.
Verification passes: full typecheck, lint, and format check; web 62/62; focused renderer unit
26/26; sequence browser E2E 3/3; and the production web build. No Docker, database, migration,
production mutation, campaign action, enrollment, or send was required.

After explicit operator authorization, `canary` was pushed and a reviewed 4,435,092-byte Git
bundle with matching local/remote SHA-256 fast-forwarded the clean Spaceship checkout from
`47a2422` to exact application commit `6c2c390`. The app, gateway, and backup images rebuilt and
the stack recreated without a migration. All containers and internal health pass; the application,
direct Sequence route, health route, canonical/outreach redirects, unsubscribe-host isolation, and
portfolio route pass; and the served production asset contains **Continue existing conversation**.
All 20 migrations through `0019` remain applied. Production reports `checked 10 enrollments — 0
diff(s)`, clean self-check, four healthy mailboxes, zero failed jobs, and zero sendable active work.
The sent ledger remained at 24 events with the same 2026-09-02 15:10:35 IST watermark, proving the
deployment emitted no mail. Pre/post dumps `coldemail-20260902-122531.dump` (1,353,563 bytes) and
`coldemail-20260902-123021.dump` (1,354,270 bytes) passed `pg_restore --list`. Campaign,
enrollment, mailbox, DNS/Caddy, Oracle, and `main` state were not changed.

A post-deployment read-only browser pass verified that Step 1 explains its new-conversation
behavior; every later Beacon step exposes both conversation choices with the intended descriptions;
the saved threaded choice loads selected; temporarily choosing a new conversation changes the
subject label; and the saved threaded preview renders `Re: <Step 1 subject>`. At a 390px viewport,
the page had no horizontal overflow, and the browser console reported no warnings or errors. The
pass made no save, campaign action, enrollment, or send. It reconfirmed open finding F-W25 (preview
still shows the fallback Reply STOP footer) and added F-W32 for dirty state that remains after a
conversation-choice change is reverted.

Final local gate: typecheck/lint/format; unit 345/345; web 58/58; integration 168/168; API 144/144;
GreenMail 29/29; locked golden exactly 47/47; mock browser 62/62; real-backend browser 1/1;
production Vite build; populated `checked 5 enrollments — 0 diff(s)`; clean self-check; and a
validated custom-format dump with scratch restore/rebuild/zero-drift/self-check. The initial real
browser attempt was blocked before its test because Docker Desktop was closed; Docker was started
locally and the complete journey passed. No schema migration was added. This implementation made
no activation, enrollment, or send during local verification.

After explicit operator authorization, `canary` was pushed and the production read-only preflight
found two active campaigns but all five enrollments terminal: zero NEW/ACTIVE, due, or future
scheduled enrollments; zero available pool leads; auto-enrollment disabled; and zero legacy due
work. Pre-deploy dump `coldemail-20260901-064856.dump` (1,170,101 bytes) passed
`pg_restore --list`. A reviewed bundle whose SHA-256 matched locally and remotely fast-forwarded
the clean VPS checkout from `ef5174e` to exact application commit `8ed86a4`; app, gateway, and
backup images rebuilt and the stack recreated successfully.

Post-deploy evidence: all containers and internal/public health pass; the SPA, direct routes,
canonical/outreach redirects, unsubscribe-host isolation, invalid-token page, and portfolio route
pass; the served asset contains the update banner, pending-confirmation, Personalized Copy, and
global-capacity markers. All 20 migrations through `0019` remain applied; four of four mailboxes
are healthy; failed jobs, open alerts, personalized-copy blockers, and due work are zero;
`checked 5 enrollments — 0 diff(s)` and self-check pass. The latest `sent` event remained the
walkthrough message at 2026-08-31 22:35:24 IST, proving the deployment created no mail. Post-deploy
dump `coldemail-20260901-065547.dump` (1,170,993 bytes) passed `pg_restore --list`. Oracle, `main`,
DNS, Caddy, campaign state, enrollment state, and mailbox configuration were unchanged.

## 2026-08-31 import-wizard clarity follow-up — verified and deployed

The import preview no longer mixes a single Draft target campaign with multi-campaign allocation.
It now separates address admission, personalized-email readiness/replacement, and campaign pool
assignment. Each allocation exposes its generic copy destination: one Personalized Copy step
resolves automatically, multiple steps require an explicit choice, no personalized step leaves the
copy reusable-only, and exact `step_N_*` columns continue to map directly. The final preview names
campaigns and states exact ordered counts, readiness, destinations, remaining global leads, and
that importing does not activate, enroll, or send.

The API accepts optional per-allocation `generic_copy_step_no`, validates that it identifies a
Personalized Copy step, reports binding outcomes during preview, and rejects a multi-step generic
mapping atomically when the choice is missing. There is no database migration and no event,
scheduler, mail-transport, or production-state change.

Verified locally: typecheck/lint/format; unit 345/345; web 58/58; integration 168/168; API 140/140;
GreenMail 29/29; locked golden 47/47; mock browser 62/62; real-backend browser 1/1; production Vite
build; `checked 0 enrollments — 0 diff(s)`; clean self-check. The initial real-browser run stopped
only on the deliberately renamed import button; after updating that stale selector, the complete
walkthrough passed.

After separate operator approval, `canary` was pushed and the production safety preflight found
two draft campaigns, one global lead, four healthy OAuth mailboxes, and no pool rows, enrollments,
active campaigns, auto-enrollment, legacy human-written campaigns, or due work. Pre-deploy dump
`coldemail-20260831-133754.dump` (1,042,810 bytes) passed `pg_restore --list`. A reviewed Git bundle
whose SHA-256 matched locally and remotely fast-forwarded the clean checkout from `eb2ec7d` to
`a15f70d`; the app, gateway, and backup images rebuilt successfully.

Post-deploy evidence: all four containers and internal/public health pass; SPA/login/direct Leads
routes, canonical/outreach redirects, unsubscribe-host isolation, and the portfolio route pass; the
served asset contains the new address-admission, personalized-email, and exact-summary markers.
Production remains at 20 migrations through `0019_personalized_copy_two_tiers`; self-check is clean,
the projection dry-run is `checked 0 enrollments — 0 diff(s)`, failed jobs are zero, and the dormant
state is unchanged. Post-deploy dump `coldemail-20260831-134549.dump` (1,043,586 bytes) passed
`pg_restore --list`. No campaign was activated, no lead was enrolled, and no email was sent;
Oracle, `main`, DNS, Caddy, settings, and mailbox configuration were unchanged.

## 2026-08-30 Personalized Copy/two-tier release — verified and deployed

The operator-approved migration `0019` release is complete on local branch `canary`: Manual
Compose direct sending is retired in favor of sequence-only Personalized Copy steps; current lead
tiers are A/B with Nurture as a separate outreach status; global imported copy binds to independent
campaign-step snapshots; missing/unreviewed copy fails closed with durable per-enrollment blockers;
and the Leads screen has exact Campaign Pool/Enrolled/Both filtering shared by “all matching” bulk
tiering. The authoritative behavior and deployment gate are in [docs/22](22-personalized-copy-two-tier.md).

Verified local gate: typecheck/lint/format; unit 345/345; web 58/58; integration 168/168; API
138/138; GreenMail 29/29; golden exactly 47/47; mock E2E 61/61; real-backend E2E 1/1; production
Vite build; migration 0019 apply/down/apply; event-backed five-enrollment projection dry-run with
zero diffs; and clean self-check. A fresh 110,760-byte custom-format dump passed catalog listing,
restored into the explicitly named `coldemail_0019_restore_drill` database, and passed projection
rebuild, five-enrollment zero-drift dry-run, and self-check. The scratch database and temporary dump
were removed.

After separate operator approval, local `canary` was pushed and Spaceship passed a pre-deploy
zero-legacy/dormant-state check. A reviewed Git bundle with matching local/remote SHA-256
fast-forwarded the clean checkout from `f89274f` to `eb2ec7d`. Pre-deploy dump
`coldemail-20260830-181912.dump` (935,334 bytes) passed `pg_restore --list`; the app, gateway, and
backup images rebuilt successfully; and migration `0019_personalized_copy_two_tiers` applied before
the app became healthy.

Post-deploy evidence: app/database health and all four containers pass; internal and public health,
SPA/login/direct Leads routes, canonical/outreach redirects, unsubscribe-host isolation, and the
portfolio route pass; the served asset contains Personalized Copy, Campaign membership scope, and
Nurture actions. Production reports `checked 0 enrollments — 0 diff(s)`, clean self-check, zero
failed jobs/open alerts/events/sent messages, zero personalized blockers, zero legacy human-written
campaigns/enrollments, four healthy OAuth mailboxes, one preserved unassigned global lead, and zero
campaigns/enrollments/active or sendable work/pool availability/auto-enrollment. Post-deploy dump
`coldemail-20260830-182500.dump` (948,884 bytes) passed `pg_restore --list`.

No campaign was activated, no lead was enrolled, and no email was sent. Oracle, `main`, DNS, Caddy,
and mailbox configuration were unchanged. The bounded owner-address canary remains separately
operator-gated.

## 2026-08-30 branch transition — verified and deployed

After explicit operator approval, the clean local checkout and GitHub moved to the one-word
`canary` branch at documentation wrap `0299e42`. Spaceship received a reviewed Git bundle, switched
from `b8.3-local-canary` to `canary`, rebuilt, and recreated the production stack. Application code
remained `6ca1183`.

All four containers run; app/database health, migrations through 0018, the public route matrix,
self-check, and `checked 0 enrollments — 0 diff(s)` pass. Production retains four healthy OAuth
mailboxes and zero campaigns, leads, enrollments, available pooled leads, active campaigns,
auto-enrollment-enabled campaigns, open alerts, or failed jobs. Pre/post dumps
`coldemail-20260830-090245.dump` (903,838 bytes) and `coldemail-20260830-090758.dump` (904,427 bytes)
passed `pg_restore --list`. No email was sent and Oracle, `main`, DNS, Caddy, and mailbox
configuration were unchanged.

## 2026-08-30 campaign pools, auto-enrollment, and permanent caps — verified and deployed

The operator-approved campaign-selection improvement is complete on `b8.3-local-canary` and is
deployed on Spaceship at `6ca1183`. CSV imports can preview and atomically reserve exact lead counts
into multiple campaign pools while leaving the remainder global. Existing safe leads retain their
stored profile data;
manual-draft leads reserve first inside the requested total; every exclusion is rechecked at
commit. Once a campaign is pool-backed, manual or automatic count enrollment draws only from its
available pool. Draft/paused campaigns can add, release, or reassign available reservations while
preserving history.

Auto-enrollment is opt-in, pool-only, disabled by default, and skips non-active campaigns. A
persisted application-local-date claim prevents duplicate daily runs and missed dates never accrue.
Multiple campaigns share capacity through a persistent fair round-robin cursor under the same
global enrollment lock. Manual and automatic enrollment now share the effective campaign cap and
the strengthened room calculation subtracts sent messages, due follow-ups, and already-reserved
unsent Step-1 openers. Ramp stages transition to a permanent daily cap (default: final ramp stage);
after activation the permanent cap may be lowered but never raised.

Verified evidence:

- migration `0018_campaign_pools_auto_enrollment` passed apply/down/apply and its legacy-cap
  backfill test;
- typecheck, lint, and format pass; unit **342**; web **58**; integration **167**; API **130**;
  GreenMail SMTP/IMAP **29**; locked golden exactly **47**; mock-browser E2E **60**;
  real-backend E2E **1**;
- focused tests cover exact 100/100/800 allocation, deterministic order, existing-profile
  preservation, draft-first reservation, preview/commit rollback, pool-only selection,
  release/reassign, immediate activation/enable runs, concurrent-worker idempotency, monotonic
  local-date claims across timezone changes, fair allocation, shared caps, permanent-cap
  transition/lower-only behavior, and local-date/DST helpers;
- the populated event-backed test database reports `checked 5 enrollments — 0 diff(s)` and
  self-check reports no invariant violations;
- a fresh custom-format dump passed `pg_restore --list`, restored into the explicitly named
  `coldemail_0018_restore_drill` scratch database, and passed rebuild, five-enrollment zero-drift
  comparison, and self-check; the scratch database and temporary dump were removed;
- user-manual screenshots **24–26** document the desktop pool, phone pool cards, and exact import
  allocation preview.

After separate operator approval, the clean production checkout fast-forwarded by reviewed bundle
from `f58b977` to `6ca1183`; `0018_campaign_pools_auto_enrollment` is applied. All four containers,
internal/public health, the SPA/direct-route/redirect/unsubscribe/portfolio matrix, and the served
feature markers pass. Production reports `checked 0 enrollments — 0 diff(s)` and a clean self-check.
It has four healthy Google OAuth mailboxes but zero campaigns, leads, enrollments, active campaigns,
available pooled leads, or auto-enrollment-enabled campaigns. Pre-deploy dump
`coldemail-20260829-212720.dump` (799,599 bytes) and post-deploy dump
`coldemail-20260829-213315.dump` (816,236 bytes) passed `pg_restore --list`. No campaign was
activated, no lead was enrolled, and no email was sent. Oracle, `main`, DNS, Caddy, and mailbox
configuration were unchanged.

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
is complete. At that 2026-08-10 release, `contacted` was the distinct-lead union of `delivered` and
`human_reply`; the 2026-09-01 remediation at the top of this runbook supersedes that definition
with distinct accepted-send recipients. Campaign analytics and lead state are correctly scoped,
visible operational data refreshes every 30 seconds, and operator actions invalidate dependent live views immediately.
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
business postal address/template, and four healthy OAuth mailboxes are configured. The bounded
owner-address canary remains a separately approved operator handoff. No prospect sending is
authorized by this record alone.

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
| 19 | **Every email was originally 100% plain text, so the footer/signature could not be visually de-emphasized.** The corrected send path provides matching plain-text and minimal escaped HTML alternatives with no images or tracking. The original 10px gray one-line paragraph was collapsed by Gmail follow-up threads; the 2026-09-02 deployed remediation changed it to two lines in an email-safe presentation table, with a blue underlined Unsubscribe link and a dark-gray address. The post-deployment sent snapshot and Gmail original verify the renderer, headers, and DKIM coverage, but the live Gmail desktop message still put the entire redesigned footer behind **Show trimmed content**; presentation alone cannot control Gmail's thread UI. The operator accepted this provider limitation, retained the footer unchanged, rejected duplicate in-copy opt-out language, and made the existing new-conversation choice explicit in the sequence builder. **Legal constraint:** the line must remain clear and conspicuous; it is de-emphasized but not hidden in the MIME content. | product / deliverability | 🟢 closed — correct delivery verified; Gmail trimming accepted; explicit conversation choice added |
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
