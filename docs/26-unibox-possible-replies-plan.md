# Unibox possible replies — authorized local implementation

Approved 2026-10-10. Local on canary only. No push, deployment, production scan,
mailbox recovery, linking, hold, pause/resume, enrollment or sending is authorized.

## Behavior and decisions

Keep Needs review/All/Acknowledged. Integrate one Possible reply item per canonical
incoming message alongside grouped confirmed lead/campaign rows. No general unmatched
inbox, Reminders or bell/email/desktop alerts. Use separate Unibox counts.

Preserve reference/exact-address confident matching and its review/opt-out policy.
For other messages compare accepted outreach from the receiving mailbox, before receipt,
within 30 days, to non-erased leads including paused/terminal enrollments.
Suggest when a specific normalized subject or business registrable domain matches.
Strip repeated leading Re/Fw/Fwd/Auto Response/Automatic Reply/Out of Office prefixes,
lowercase and collapse whitespace without changing remaining wording. Subject evidence
requires three words/twelve letters; generic subjects don't qualify. Shared providers
including Gmail/Yahoo/AOL never produce domain evidence. Rank both evidence types,
then subject, then company; latest preceding send, enrollment ID break ties. Deduplicate
lead/campaign candidates. Never turn evidence into an automatic sending decision.

Save bounded complete content only for confirmed messages or qualifying candidates;
other traffic stays metadata-only. Candidate evidence is separate from confirmed links.
Suggestions create no domain events/holds/suppression or human-reply credit.
Keep deletion tombstones and existing safe rendering/5 MiB limit.

## UI and actions

Existing desktop/mobile reader layout. List sender, subject, received time, candidate
lead/campaign and evidence explanation. Campaign/mailbox/search filters include candidates;
state filter applies to confirmed rows only with an explanation. Sort newest-first.
Reader shows independent automation/relationship labels, captured content or Recover message,
candidate actual state and a prominent not-linked/not-held explanation.
One candidate: Confirm this is [name]. Several: explicitly select lead/campaign.
Confirmation identifies both addresses and explains unfinished sequences become held,
without sending. Reuse audited linking, locks, expected revision and operation ID;
recheck candidate eligibility at confirmation. No automatic alias learning/address changes.
Different-address opt-out never automatically suppresses the original lead.
Not a campaign reply immediately dismisses with Undo, visible in All/Acknowledged.
Return restores review visibility only. Acknowledged dismissed content uses configured
retention (30 days default); unresolved candidate content is retained.

Five-minute IMAP polling and 30-second foreground refresh unchanged. Show last successful
check for each mailbox; warn on authentication failure or >10 minutes stale. No timing guarantee.

## Backend and historical tooling

Add additive canonical-message/enrollment candidate evidence projection, no duplicate bodies.
Versioned mixed review queue, review summary/counts/freshness endpoints; preserve rows API.
Extend message detail with candidates, actual states and confirmation choices.
Reuse link/content recovery/deletion and add audited visibility operations where necessary.
Revision/idempotency protects confirmation, dismissal and Undo. Preserve append-only ledgers.

Explicit metadata-only scan: last 30 days, no bodies fetched, classification replay, cursor
advance, historical event rewrite or outreach-state change. Prepare separately authorized
Bruce 2140 -> enrollment 83 and Lori 2135 -> enrollment 217 repair: PEEK identity-verified
content recovery then audited confirmation/holds. Recovery failure still permits visible
metadata/confirmation. Never recover deleted content. Other old candidates recover on request.

## Stages and gates

- [x] Candidate matching/projection/contracts and additive migration
- [x] Selective capture, queue/summary, confirmation/dismissal services
- [x] Integrated accessible responsive UI/counts/freshness
- [x] Metadata scan and bounded repair tooling/documentation (workflow prepared; no live repair)
- [x] Serial DB/API/UI/browser gates, type/lint/format/build, locked golden exactly 47
- [x] Populated canonical zero drift/self-check and verified runbook

Test Bruce/Lori, shared domains/generic subjects, collisions/multiple campaigns, no suggestion
effects, held confirmation, automation analytics, duplicates/deletion/recovery, stale actions,
dismissal/Undo/retention, filters/counts/freshness and keyboard/mobile.

## Change log

2026-10-10: specification saved before implementation; live operations remain separate.

2026-10-10: implemented locally at `5ba304d`; all gates pass. API 182, integration 222,
unit/component 487, GreenMail 31, locked golden exactly 47, mock browser 73 and real
browser 4. Final targeted Unibox browser rerun passes 13. Typecheck/lint/format/build
pass; nine-enrollment canonical dry-run has zero differences and self-check is clean.
Migration preservation includes 0028–0033; populated candidate evidence survives its
down/apply fixture check. See docs/17 for evidence and initial stale-selector correction.
No push, deployment, production scan/recovery/linking or other live operation performed.

## Operator workflow prepared for a future authorized rollout

The metadata scanner is `apps/server/src/services/possibleRepliesCli.ts`. It defaults
to preview and reads only database metadata. With an explicitly selected database,
run `npx tsx apps/server/src/services/possibleRepliesCli.ts` to preview the last 30 days.
`--apply` persists candidate evidence; repeated invocations do not duplicate candidates.
Optional `--message=2140 --message=2135` restricts it to the two reported messages.
Never infer production authorization from these instructions. Migration and worker
startup do not invoke the scanner.

After separately authorized deployment and metadata application, Bruce and Lori can
be repaired independently in Unibox:

1. Verify message 2140 is from `bja6@aol.com` and proposes Bruce, enrollment 83.
   Verify message 2135 is from `pmaccounts@dennisrealty.com` and proposes Lori,
   enrollment 217. Confirm receipt times, receiving mailbox and preceding-send evidence.
2. Use **Recover message** for each selected message. Recovery reads without changing
   mailbox flags and checks identity; failure leaves the metadata item visible. Deleted
   content remains unavailable.
3. Confirm the person in the dialog only after checking both sender and lead addresses.
   This applies normal review holds, preserves any delay and does not resume campaigns.
   Linking is possible even if recovery failed.
4. Verify both messages now appear in their lead conversations, with their previous
   automation labels and unchanged authorship. Check actual states of all affected
   unfinished enrollments and unchanged accepted-send count.

No bulk confirmation, sender-alias learning, body recovery, historical-event replay,
campaign change or outbound test is part of this workflow. Other older candidates
remain metadata-only until individually recovered by the operator.

## API and storage implementation notes

Migration `0033` adds candidate evidence keyed by canonical message/enrollment, referring
to its accepted sent-message evidence. Its down operation preserves data for rollback.
No existing outreach event or projection vocabulary is changed.

- `GET /api/v1/unibox/review-queue/v1`: explicit `lead` and `possible` variants,
  campaign/mailbox/search/view filters, mixed pagination and separate counts.
- `GET /api/v1/unibox/review-summary/v1`: filtered counts and mailbox freshness.
- `GET /api/v1/unibox/messages/:id/possible-detail`: full removable content and candidates.
- `POST /api/v1/unibox/messages/:id/confirm-candidate`: existing audited linking with
  a fresh mailbox/time/evidence check under the lead/message locks.
- `POST /api/v1/unibox/messages/:id/candidate-visibility`: dismiss/return, exact message
  revision and operation ID; append-only activity facts, no outreach events.

Existing rows, linking, recovery, acknowledgement and content deletion APIs remain
compatible. The queue omits bodies; the selected reader loads content. The Unibox
navigation count refreshes in the foreground without emitting notifications. Undo uses
the revision produced by its dismissal and refuses to override a later decision.
