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

- [ ] Candidate matching/projection/contracts and additive migration
- [ ] Selective capture, queue/summary, confirmation/dismissal services
- [ ] Integrated accessible responsive UI/counts/freshness
- [ ] Metadata scan and bounded repair tooling/documentation
- [ ] Serial DB/API/UI/browser gates, type/lint/format/build, locked golden exactly 47
- [ ] Populated canonical zero drift/self-check and verified runbook

Test Bruce/Lori, shared domains/generic subjects, collisions/multiple campaigns, no suggestion
effects, held confirmation, automation analytics, duplicates/deletion/recovery, stale actions,
dismissal/Undo/retention, filters/counts/freshness and keyboard/mobile.

## Change log

2026-10-10: specification saved before implementation; live operations remain separate.
