# Incoming-email handling and Unibox redesign

Approved for local implementation on **2026-10-08 IST**. This is the durable specification and
implementation checkpoint. Read this file after a context reset. Never infer a completed gate
from a checked implementation item: verified evidence belongs in docs/17.

## Authorization and settled decisions

**2026-10-08 operator follow-up supersedes the original extra UI scope:** remove Reminders and
Needs linking from Unibox and remove reminder/link-correction buttons from the reader. Keep the
three lead views: Needs review, All and Acknowledged. Do not capture new unmatched mailbox bodies,
HTML, extracted text or previews; retain minimal identity/location metadata for deduplication.
Existing records, events and old compatibility APIs remain intact; no bulk deletion is authorized.
Restoration and Stop correction use a simple Confirm with no correction-reason input.
Personalized legacy restoration verifies saved personalized-copy/sent evidence rather than
template variants. Reply-count confirmation remains optional under Email details with plain copy.
This follow-up is local implementation; a fresh deployment remains separately authorized.

**Deployment checkpoint:** application `8e65e46` was explicitly authorized and deployed after
confirmed Campaign 3 pause approval. Campaigns 2/3 remain paused. See docs/17 for verified evidence.
The personalized-restoration/usability follow-up is local work until separately deployed.
The local-only restrictions below describe the original implementation authorization.

- Work on `canary`, commit completed tasks, preserve unrelated changes.
- No push, deployment, production connection/mutation, campaign resume, enrollment, outbound
  send, mailbox change, production restoration or historical-message replay is authorized.
- Confident incoming responses permanently suppress clear opt-outs; everything else holds for
  human review. Automation detection describes a message and never selects its outreach outcome.
- Hold all unfinished enrollments for a confidently identified contacted address, including
  enrollments which have not sent their first email. Different company addresses are suggestions.
- A held row cannot be acknowledged until an outreach decision is confirmed. Suppressed rows can.
- Suppression is permanent, including manual mistakes. Retain the minimum normalized address
  suppression entry during lead erasure; retire ordinary unsuppression controls/routes.
- Default content retention is 30 days after eligible acknowledgement, configurable/disableable.
- New human-reply analytics require Human confirmation; linking alone never counts a reply.
- Future campaigns after Stop require explicit recontact, never automatic selection.
- Acknowledge acts immediately with Undo and covers explicit actually reviewed message IDs.
- Include guarded legacy STOPPED/REPLIED restoration to Held for review first.
- Include independently verified top navigation and explicit content-only IMAP recovery.

## Verified starting point and conflicts

Human replies currently emit `human_reply`, terminal REPLIED and clear scheduling. Automatic
classification checks headers/subjects, not meaning. Thread matching uses hidden references;
company stopping independently matches exact address/domain and emits terminal `outreach_stopped`
even for OOO. Raw prior stop/reply facts block later enrollment. Unibox inner-joins a matched
enrollment, lists individual messages, lacks campaign/search controls, and uses a static automatic
reply caption. Its full-body field falls back to a 300-character snippet because the poller does
not populate it. The transport drops HTML and disables HTML-to-text fallback. Cursor identities
are folder-specific but incoming UID deduplication is mailbox-wide, without UIDVALIDITY. Current
Not interested/Wrong person dispositions globally suppress. Desktop has a 208px sidebar and ten
destinations; mobile already has a navigation sheet.

Supersede prospectively: AGENTS mandatory terminal reply stopping, decision register pre-real
domain AA-AC, October 6 company stop policy, Decision U suppression removal, and erasure's removal
of suppression. Historical facts retain interpretation. The inbound standalone STOP/opt-out
remains permanently global; manual **Stop sequence** is a different campaign-specific event.

## State and transition specification

Keep lifecycle, outreach control, and review visibility independent. Global suppression overrides
all outreach controls. Add event-derived review holds/delay/checkpoint/revision fields rather than
making a review hold terminal. Use STOPPED for manual sequence stops but distinguish their event
origin from legacy company stops. Backend returns actual effective state and action availability.

| Trigger/action                    | Result                                              | Scheduling                                                   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| Confident non-opt-out response    | Held for review on unfinished affected enrollments  | Preserve next step/due time/mailbox/retries                  |
| Clear attributed opt-out          | Permanent global Suppressed                         | No future outreach                                           |
| Continue                          | Resolve exactly reviewed holds in selected campaign | Next unsent step eligible normally; no immediate send        |
| Delay                             | Resolve reviewed holds and set deadline             | Eligibility no earlier than both prior due time and deadline |
| Delay expiry                      | Time barrier expires only                           | All campaign/safety checks remain                            |
| New message                       | New unacknowledged review hold                      | Prior decisions cannot release it                            |
| Stop                              | End selected campaign sequence without suppression  | Preserve correction checkpoint                               |
| Correct Stop                      | Append correction, return to review hold            | Separate Continue/Delay required                             |
| Suppress                          | Permanent address block across campaigns            | No Continue or undo bypass                                   |
| Acknowledge/Undo/Return to review | Visibility only                                     | No scheduling change                                         |
| Delete content                    | Remove app incoming text only                       | No state/visibility change                                   |

Review holds never expire. One campaign decision never releases sibling holds. Messages on
stopped/completed/suppressed records stay reviewable without reactivation. Show lifecycle
exceptions honestly: Completed, Bounced, Not enrolled. Running also shows Campaign paused where
appropriate; do not claim the sequence is currently eligible merely because its control is running.

## Matching and opt-outs

1. Use valid In-Reply-To then References; retain actual replied-to step/conversation.
2. Exact fresh sender address requires an accepted lead send before incoming receipt. One relevant
   contacted enrollment is primary; multiple relevant campaigns require explicit primary selection.
   Hold all unfinished enrollments for that lead in either case, including header matches.
3. Company/subdomain matches create candidate suggestions only, with shared-provider exclusions.
4. Unmatched/conflicting identities go to Needs linking; no invented subject or step attribution.
5. Thread references do not prove a different sender's opt-out targets the original address.
   Ambiguous targets hold for review; never suppress addresses found only in quoted text.
6. Search campaign Pool/Enrolled leads by name/email/company. Link without enrollment or sending.
   Re-run hold/opt-out protections on confirmed linking. Audit link corrections; previously affected
   enrollments remain held until explicitly reviewed. Mark unrelated has no outreach/metric effect.
7. Separate primary message attribution from sibling safety holds so metrics never multiply.

Conservative new-text opt-out matching supports direct unsubscribe/remove-from-list/do-not-contact
requests and unambiguous standalone STOP, not unrelated clauses. Exclude identified quoted,
forwarded, signature/footer and HTML quotation sections. Remove the 300-character detection limit.
Extraction uncertainty holds rather than guesses. Apply to automated/separate confidently linked
messages too. No writable tag_only or disabled suppression bypass. Preserve legacy setting values
where needed for history. DSNs retain technical hard-bounce and limited soft-retry handling and
never count as human replies.

## Transactions and scheduling

Use shared lead/address locks alongside rebuild/enrollment/mailbox locks with one documented order
across sending, polling, review, suppression, linking and enrollment. Recompute affected enrollment
sets under lock. Message identity/content/links/holds/suppression/audit/cursor commit atomically.
Immediately before SMTP re-read campaign, address suppression, hold, delay, step, due time, assigned
mailbox, caps, windows and pacing. Discard pre-rendered stale work. Mutations use operation IDs,
expected revisions and explicit reviewed hold/message IDs; newer messages cause conflict/refresh.

Continue/Delay never call transport. Send only next eligible step, schedule its successor from
actual acceptance, preserve retry bodies and fixed mailbox. No catch-up burst. An already accepted
SMTP send cannot be recalled; committed holds prevent later sends. Uningested mailbox traffic
cannot be acted upon before polling detects it.

## Unibox walkthrough

Local controls: All campaigns/specific campaign, name/email/company search, Needs review (default),
All, Acknowledged, Needs linking, optional mailbox/sending-state filters, independent Reminders.
One lead/campaign row with identity/campaign/state/latest timestamp/message/unacknowledged counts.
Selecting shows all incoming messages, not only latest, with adjacent desktop reader.

Reader shows actual state, sender/subject/received time/timezone, context, complete paragraphs,
collapsed quotations, sent snapshot conversation groups and action history. Two independent labels:
Automation = Automatic detected / No automation detected / Uncertain; Relationship = In-thread
reply / Separate email / Unmatched. No automation detected is not confirmed human authorship.
Approximately 360px list and flexible reader; below 1024px use dedicated reader with Back,
preserving filters/scroll. Readable 16px body, existing components/tokens, keyboard/focus support.

Confirm Continue, Stop sequence, Suppress address, Delay and Delete stored content. Identify lead,
email/campaign/current state/next step/consequence. Suppress requires typed email and permanence
wording. Delay includes exact UTC-resolved date/time and IANA zone; reject past/invalid/unresolved
DST times. Independent Human/Automatic/Unsure confirmation; no automatic meaning decisions.
Continue disabled for suppression/bounce/completion/legacy terminal; restoration separate.

Acknowledge is immediate with Undo; backend rejects held/unresolved-link rows. Cover explicit
reviewed IDs, not moving latest watermark. Opening or outreach actions do not acknowledge. New
messages reopen review; concurrent holds reject stale acknowledgement. Undo covers its operation
only; later return to review appends visibility fact. Suppressed items acknowledge normally.

## Content and retention

Capture full text/HTML prospectively into removable storage, separate from new text/quote sections.
HTML-only has generated readable text. MailParser does not sanitize. DOMPurify narrow allowlist,
isolated sandboxed reader and restrictive CSP: no scripts/handlers/forms/frames/embeds/SVG/CSS
resources/images/media/remote fonts/automatic URL requests. Allow paragraphs/lists/emphasis/quotes/
simple tables. Explicit safe links open separately with no opener/referrer. Text/HTML selection.
Streaming parse discards attachments except DSN status data. Combined decoded body limit 5 MiB;
oversized marked explicitly, never silently presented as complete.

Delete body/HTML/derived text/quotes/snippets/previews and duplicate-copy content/cache; keep minimal
sender/subject/timestamps/location/message IDs, links, ack, labels, action history, tombstone, lead,
enrollment/suppression/sent/retry records. Deleted reader says Stored content deleted, no snippet
fallback. Original mailbox untouched. This is not general lead erasure.

Cleanup default 30 days, configurable and disableable. All queue associations acknowledged, no
unresolved linking/review dependence, elapsed period. Return to review cancels eligibility; later
ack restarts clock. New unacknowledged mail does not reset unrelated older content clocks. Holds
skip dependent content even for migrated acknowledged anomalies. Tombstones prevent resurrection
through repeat polling/deduplication/rebuild/recovery.

Legacy bodies say Full content not captured/Legacy preview only. Explicit selected-record recovery
uses PEEK and validates Message-ID/envelope. Legacy unknown folder/UIDVALIDITY searches configured
folders by Message-ID, never trusts old UID. Ambiguous/missing identity fails. Content-only recovery
never advances cursors, reclassifies, emits reply outcomes or changes state, and never restores
intentionally deleted content. No rollout recovery/backfill.

Immutable bounce reason diagnostic fragments, unsubscribe matched wording, company sender reasons
and operator reminder notes may retain excerpts. Never promise deleting every historical trace.
New audit events store codes/IDs/times, not arbitrary excerpts. Backups retain old bodies until
expiration; export deletion manifest and require restores to apply it before serving/working.

## Storage, event and public API changes

Add canonical messages/delivery locations; removable content/status; lead/enrollment associations
with primary campaign/evidence; per-message/per-row acknowledgements; event-derived enrollment
hold/delay/checkpoint/revision; retention settings; append-only incoming activity for unmatched
link/visibility/content facts (existing domain events require a lead). Cross-ledger atomic updates.

Domain facts: incoming review required; Continue/Delay decision; manual Stop/correction; guarded
legacy restoration; authorship confirmation/correction; lead-only permanent suppression. New
responses never emit legacy terminal human_reply or company outreach_stopped. Old reducers retain
historical meaning. Rebuild/self-check include controls/corrections/suppression and replay parity.

All endpoints below remain under /api/v1 with shared Zod schemas and docs/10 parity:

| Endpoint                                  | Purpose                                    |
| ----------------------------------------- | ------------------------------------------ |
| GET /unibox/rows                          | Grouped filtered/searchable/paginated rows |
| GET /unibox/rows/:enrollment_id/messages  | Incoming and sent context                  |
| GET /unibox/messages/:id                  | Matched/unmatched content and status       |
| GET /unibox/needs-linking                 | Candidates and unresolved messages         |
| POST /unibox/messages/:id/link            | Link/correct without enrolling             |
| POST /unibox/messages/:id/unrelated       | Resolve unrelated traffic                  |
| POST /unibox/rows/:enrollment_id/action   | Continue/Stop/Delay/correction/restoration |
| POST /unibox/messages/:id/authorship      | Human/Automatic/Unsure                     |
| POST /unibox/acknowledgements             | Explicit IDs / undo / return               |
| DELETE /unibox/messages/:id/content       | Tombstone/delete incoming text             |
| POST /unibox/messages/:id/recover-content | Explicit content-only recovery             |

Global suppress service supports pool-only linked leads. Mutations use operation ID/revision;
Continue/Delay precise hold IDs; conflicts return refresh requirement. Retire old suppressive
disposition semantics and unsuppression route. Legacy snooze uses audited Delay and cannot bypass
holds. Legacy unsubscribe routes use permanent suppression service.

Analytics require confirmed human new messages, independent of detection/link/ack/actions. Canonical
message dedupe and one primary campaign; sibling holds give no credit. Preserve header step; fresh
messages have no invented step. Authorship correction is appended. Historical human_reply analytics
unchanged; update sentiment/positive/meeting/delivery/variant/self-check for new confirmed facts.
Contacted denominator and immutable sent records unchanged. Show control counts independently.

## Historical compatibility and recontact

Migrations never release existing STOPPED/REPLIED/BOUNCED/COMPLETED/UNSUBSCRIBED. Legacy stopped
guards remain until explicit review; bounce/suppression never restorable, exhausted sequences never
restart. Unfinished work retains schedule; new intake uses review policy.

Restoration previews history/remaining step/mailbox, requires a simple confirmation, rejects
suppression/bounce/erasure/exhaustion/incompatible sequence/missing retries/conflicting unfinished
enrollment, references blockers, restores to hold, then requires second Continue/Delay. Reconstruct
legacy due timestamp from accepted send/wait/retry; unsafe reconstruction fails closed. Keep unique
lead/campaign constraint. No new Email 1 enrollment to correct a stop.

Future campaign requires explicit recontact after Stop/reviewed responses. All pool/allocation/
enrollment/recycle guards agree; force never overrides suppression/unresolved review. Erasure retains
minimal suppression record. Existing removed suppression not recreated by migration. Additive
migrations preserve legacy columns/vocabulary and mark old messages legacy without events/backfill.
Rollback after new facts must use review-aware code; old binaries ignoring holds are unsafe. No
down migration drops facts/tombstones/holds/suppression.

## Incremental checklist and verification

- [x] Stage 0: persisted approved spec, indexed, operating/decision boundaries reconciled.
- [x] Stage 1: state/contracts/additive schema; transition tests, apply/down/apply, legacy parity.
- [x] Stage 2: scheduler locks/guards/checkpoints; deterministic race/retry/no-burst tests.
- [x] Stage 3: identity/capture/matching/opt-outs; header/HTML/folder/dedupe fixtures.
- [x] Stage 4: actions/link/ack/permanent suppression/restoration; API concurrency/idempotency.
- [x] Stage 5: grouped UI/reader/confirmations/responsive; components/mock/real browser/accessibility.
- [x] Stage 6: retention/recovery/analytics/manifest; cleanup races/no inflation/restore drill.
- [x] Stage 7: independently verified app-wide top navigation.
- [x] Stage 8: full serial gates, populated replay/self-check/backup, docs and release handoff.

### Verified local stage outcomes

- 2026-10-08: Stage 1 introduces six prospective event types, optional event-derived control
  fields, shared action/reader contracts, removable content/location/link/activity tables, and
  preservation-only rollback. Typecheck passes; unit 396/396; existing event-store integration
  7/7; new state integration 3/3. The populated new-state replay checks one enrollment with
  zero projection differences. Apply/down/apply retains holds and append-only activity.
  No incoming records were replayed and no production operation occurred. At that checkpoint,
  later stages remained open; their final verified outcomes are recorded below.
- 2026-10-08 IST: Stages 2–8 are implemented and verified locally. Typecheck/lint/format pass;
  unit 413, web 71, integration 208, API 167, GreenMail 31, locked golden exactly 47, mock browser
  71 and real-backend browser 4 all pass. Final affected UI replay also passes 18/18. Real-mode
  production build and both Compose configurations pass. Populated migration preservation,
  nine-enrollment zero drift/self-check and backup restore with post-dump deletion reconciliation
  pass. Evidence, dump hash and deployment/rollback prerequisites are in docs/17 and docs/16.
  No implementation work remains open under this specification. Push, deployment and live
  restoration/recovery/enrollment/resume/send remain outside this authorization.

Required scenarios include human away reply holds; automatic threaded/fresh labels; all exact-address
unfinished holds; no company auto-action; conservative quotes/STOP; opt-out protection without ack;
Continue next step; Delay restart/pause/windows/caps/new response; Stop correction/recontact;
suppression no bypass; ack held/concurrent/unread; no auto metric on link; deletion no resurrection;
retention unresolved; legacy migration blocked; restoration progress/mailbox/retry; no HTML network
or script execution.

Run DB-backed suites serially. Final: typecheck/lint/format, relevant unit/web/API/integration,
GreenMail, mock+real browser, production build, migration drills, populated self-check, dump and
scratch restore. Exactly 47 locked golden tests, no expectation/fixture regeneration; historical
pipeline policy explicitly selected only through internal golden harness, production review-only;
separate new-policy end-to-end cohort. Canonical populated drift command:
`npx tsx apps/server/src/services/rebuildCli.ts --dry-run` (checked 0 is insufficient).

Future deployment separately authorized: paused-state/settings/watermarks/validated backups, coherent
API-worker-UI rollout, no restoration/mail, leave campaigns paused. No old ignoring-holds rollback.

## Top navigation and effort

Replace desktop sidebar with compact top bar; wide primary destinations visible/secondary More;
intermediate Overview/Leads/Campaigns/Unibox + More; mobile accessible sheet. Preserve transport,
alerts/session/logout/update banner/Overview selector/dirty forms. Unibox local controls below.
Separate route/keyboard/mobile/dirty-form/layout regression gate.

Planning estimates: core 15-23 working days, top nav 2-3, recovery 1-2, one engineer including
verification. Estimates are not delivery commitments; live operations outside authorization.

## Implementation checkpoint / change log

- 2026-10-08 operator simplification follow-up: backend `6bbbbdc` and UI `50e2218` implement
  the revised scope recorded at the top of this specification. Personalized restoration uses
  saved personalized evidence, confirmation has no reason input, extra queues/buttons are
  removed, and new unmatched bodies are not captured. Unit 413, web 71, full API 172 plus final
  focused API 25 (including old retry provenance), intake integration 8, focused browser 11 and locked golden 47 pass.
  Populated local nine-enrollment zero drift/self-check and real-mode subpath build pass.
  This is a verified local follow-up; no new deployment or live lead/content action occurred.

- 2026-10-08 IST deployment completed under explicit push/deploy and Campaign 3 pause approval:
  application `8e65e46`, all 33 migrations, authenticated Unibox/top navigation/notification UI,
  healthy services/routes, 187-enrollment zero drift/self-check and validated paused pre/post
  backups pass. Campaigns 2/3 remain paused, automatic enrollment off. Operational snapshots
  remain 649 events / 222 sends with unchanged progress, history, suppression and mailbox
  settings. The independent manifest was initialized only after a no-deletion-history check.
  No restoration/replay/recovery, review action, acknowledgement, notification clearing,
  enrollment, resume or outbound send occurred. This supersedes the undeployed checkpoint
  below; complete evidence and restore/rollback boundaries are in docs/17 and docs/16.

- Continue after a fresh response preserves an existing delay. Capacity reservations exclude
  held, horizon-delayed and suppressed work. Campaign progress includes permanently suppressed
  unfinished enrollments in a separate outcome bucket without rewriting lifecycle history.
- The reader presents the full email before outreach controls. Company suggestions recognize
  subdomains without changing sending state. Meeting credit requires confirmed primary-campaign
  human authorship; a link or sibling safety hold cannot produce credit.

- 2026-10-08 continued local work: scheduler/intake/actions/retention/analytics/Unibox/top navigation
  and notification clearing are implemented and all local gates above pass. The feature remains
  undeployed; a deployment is a separate authorized operation.
- Confirmations use the latest enrollment ledger revision, including accepted sends; context
  metadata is separate from selected full content. Terminal lifecycle states clear active holds
  while preserving the incoming review item and future recontact guard.
- Pool-only links create lead/campaign review facts. Continue resolves reviewed facts without
  enrollment; Stop/Delay are unavailable without a sequence. Unresolved review blocks force and
  explicit recontact until resolved; future enrollment still requires the existing explicit flag.
- Manual Stop records a sequence fingerprint. Correction rejects changed sequences; historical
  restoration requires verifiable sent-step variants/hashes and otherwise fails closed. Existing
  personalized histories use their saved sent snapshot and campaign copy identifiers/hashes,
  rather than template variant IDs. Missing/incompatible personalized evidence still blocks.
- Message-ID is a nonunique index after migration 0032 so conflicting envelopes can surface rather
  than wedge polling. Equivalent envelopes remain canonical under the shared identity lock.
- Primary-link corrections preserve previously confirmed authorship while moving campaign credit
  through append-only facts; as-of metrics retain the association valid at their cutoff.
- Production startup requires an existing deletion manifest. A future authorized deployment must
  explicitly bootstrap it after confirming no previous deletion history, and retain its independent
  volume plus latest backups. Missing/corrupt manifests must never silently initialize on restore.
- User additionally requested a cleaner notification menu: bounded scrolling and Clear all
  notifications acknowledge the captured through-ID, retaining history and newer notifications.

- Initial 2026-10-08 IST checkpoint: user authorized this plan for local implementation; work
  began at Stage 0. The completed checklist and final outcomes above supersede that checkpoint.
