# Follow-up priority and protected capacity

Authorized for local implementation on 2026-10-09. No push, deployment or live operation.

## Accepted behavior

- Due steps 2–5 precede Email 1; within each group use effective due time then enrollment ID.
- Effective due time is the maximum of schedule, delay and snooze. Email 1 retries remain openers.
- Reserve each mailbox's outstanding active-campaign follow-ups before its next local midnight,
  including overdue work, excluding holds, suppression, erased/terminal leads and later delays.
- Unavailable copy retains its reservation; follow-ups never move mailboxes.
- Send openers only from spare mailbox capacity, rechecked under the mailbox lock before SMTP.
- Capacity is the sum of clamped mailbox spare allowances, subtracting assigned opener retries
  locally and unassigned pending openers once globally. Preserve ramp/pool/campaign limits.
- Reject excessive enrollment atomically. Retain the optional force field but reject true.
- Keep normal safety checks and pacing; carry backlogs forward without rewriting schedules.
- UI explains reserved follow-ups and exact enrollment allowance. No schema/event migration.

## Verification and checkpoints

- [ ] Shared reservation queries and enrollment allowance
- [ ] Scheduler ordering and final send protection
- [ ] API/UI explanation and override removal
- [ ] Meaningful ordering, reservations, retry, exclusion, concurrency and local-day tests
- [ ] Type/lint/format, relevant serial suites, build, locked 47 golden tests
- [ ] Populated canonical zero drift and self-check
- [ ] Verified runbook and release handoff

Golden historical cohort/expected outcomes stay locked. If necessary isolate historical policy
inside the fixture harness; production always enforces priority. No persisted queue. Existing
first-email backlogs remain queued. Follow-up demand may intentionally postpone first emails.

## Decisions

Operator chose to protect later-today follow-up slots and limit new enrollment to available
space (e.g. reject 20 when only five fit). Paused campaigns do not reserve live sending slots.
Future rollout requires separate authorization, fresh state checks and validated backups.
