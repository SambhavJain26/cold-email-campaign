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

- [x] Shared reservation queries and enrollment allowance
- [x] Scheduler ordering and final send protection
- [x] API/UI explanation and override removal
- [x] Meaningful ordering, reservations, retry, exclusion, concurrency and local-day tests
- [x] Type/lint/format, relevant serial suites, build, locked 47 golden tests
- [x] Populated canonical zero drift and self-check
- [x] Verified runbook and release handoff

Golden historical cohort/expected outcomes stay locked. If necessary isolate historical policy
inside the fixture harness; production always enforces priority. No persisted queue. Existing
first-email backlogs remain queued. Follow-up demand may intentionally postpone first emails.

## Decisions

Operator chose to protect later-today follow-up slots and limit new enrollment to available
space (e.g. reject 20 when only five fit). Paused campaigns do not reserve live sending slots.
Future rollout requires separate authorization, fresh state checks and validated backups.

## Implementation notes

Retry classification derives the actual outgoing step from the last accepted send and subsequent
soft-bounce facts, matching the sender rather than assuming current_step_no is the outgoing step.
Reservations live in the SQL repository boundary and are shared by enrollment and the sender.
The final send check refreshes the clock while holding the decision lock, then checks the current
mailbox-local day. Locked golden replay explicitly uses fixture-only historical queue policy.
Final focused backend 43 tests and populated nine-enrollment zero drift/self-check pass.
Typecheck, lint, formatting, unit 413, web 71, full integration 221, API 175, GreenMail 31,
campaign browser 4 and the real-API production web build pass. Locked golden exactly 47 passes
without cohort or expected-result changes. Verified evidence and local release boundary are
recorded in docs/17. Source commits are f2e1ec5 and 2269f00; nothing is pushed or deployed.

## Deployment outcome — 2026-10-09

Subsequent explicit push/deploy authorization and separate Campaign 3 pause authorization
advanced production to `76292e9`. All production gates pass: 213-enrollment zero drift,
self-check, healthy services/routes, authenticated priority guidance and validated backups.
Campaigns 2/3 remain paused, automatic enrollment off. Stable 810-event / 273-send snapshot,
full enrollment state and deletion manifest remain unchanged. See docs/17 for evidence.
