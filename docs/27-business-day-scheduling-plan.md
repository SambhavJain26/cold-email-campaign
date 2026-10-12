# Business-day follow-up scheduling

Operator-approved implementation scope: local `canary` only. Production deployment and
schedule application require their own authorization and a fresh preview. Never resume,
enroll or send as part of this release.

## Behavior

Sequences opt into `wait_day_mode=business_days`; legacy/default mode is `elapsed_days`
(exact 24-hour periods). The editable five-email preset sets waits 0/3/14/4/4 and
conversation choices new/continue/new/continue/continue. Existing step identities,
variants, copy and personalized bindings remain intact.

Count Monday–Friday after the preceding actual accepted send's local calendar date,
excluding that date. Holidays count. Recipient-state timezone mapping falls back to
the assigned sending mailbox timezone, then the global default. Positive waits become
eligible at local midnight on the target weekday; zero remains immediate. Calendar math
handles DST. The Tuesday example is Tuesday W1, Friday W1, Thursday W4, Wednesday W5,
Tuesday W6. Pacing/caps/windows/queue priority and holds govern actual sending, with no
promise of an exact SMTP instant. Existing send-window enforcement remains unchanged.

First-email enrollment and soft-bounce backoff are unchanged. After an accepted retry,
the next step uses that actual acceptance date. Restoration keeps explicit checkpoints;
only its missing-checkpoint fallback uses the shared follow-up calculation.

## Editing and applying

Ordinary saves affect dates calculated after future sends; they do not silently rewrite
existing pending dates. Omitted timing mode preserves an existing sequence's mode.
The builder labels elapsed/business waits, exposes the non-destructive preset, and offers
Preview pending dates for timing-only edits. Save copy/name/structure edits first.

Authenticated POST `/sequences/:id/schedule/preview` accepts `{wait_day_mode,steps}` where
steps contain `{step_no,wait_days,in_thread}` and must match the existing step set.
It lists all shared campaigns and every enrollment's old/proposed/effective due timestamps,
timezone, source send ID, hold status, exclusion or evidence error. Apply requires all active
shared campaigns paused, and every campaign with nonterminal enrollments paused.
Archived/completed historical references remain listed without implicitly reopening them.

POST `/sequences/:id/schedule/apply` adds `fingerprint` and UUID `operation_id`. Apply locks
the sequence, campaigns, sorted lead/enrollment identities and referenced mailboxes, rechecks
the preview, and atomically writes timing, scheduling audit facts, pending-date patches and
a durable idempotency receipt. Stale/missing evidence rejects the entire transaction.
Ordinary poll-freshness updates do not stale a preview. Unrelated lifecycle/configuration,
timezone, source-history, delay or hold changes do.

Eligible pending follow-ups include held/delayed/snoozed nonterminal enrollments; their
barriers, progress and fixed mailbox remain unchanged. Exclude unsent openers, terminal or
fully accepted sequences, suppressed/erased leads and pending soft-bounce retries. Verify
the exact preceding accepted message against its immutable snapshot. Overdue calculated
dates remain overdue; do not clamp to now. No transport is called by preview/apply.

Each changed enrollment appends `schedule_recalculated` with old/new due timestamps,
source accepted-event ID, resolved timezone, mode/wait and operation ID. Reducer treatment
is identity: no lifecycle, review revision or engagement change. EventStore applies the
new scheduling timestamp atomically. Receipts also cover operations with zero changed dates.
Sequences with schedule-change history cannot be deleted, even without campaign references.

## Compatibility and verification

Migration 0034 adds the elapsed default, scheduling vocabulary and immutable apply receipts.
It selects no production sequence and changes no saved due dates. Down is preservation-only;
do not use older code that ignores business modes or cannot parse scheduling facts.
The old zero-drift audit intentionally does not verify next_send_at. Require independent
timestamp assertions, populated replay/self-check and a manifest-aware backup/restore drill.

Required gates: type/lint/format/build, unit/web, API, integration, GreenMail, unchanged
locked golden exactly 47, and real-backend browser preview/apply using mock transport.
DB-backed Vitest invocations run serially. Verified outcomes belong in docs/17 only after
the gate actually passes.

## Local completion checkpoint — 2026-10-12

- [x] Compatibility migration and weekday calculation, including DST/millisecond handling.
- [x] Normal sending and restoration fallback; explicit checkpoints/retries preserved.
- [x] Authenticated fingerprint preview/apply, paused shared campaigns, immutable/idempotent audit.
- [x] Builder mode/preset, named prospect preview and inspected mobile real-backend flow.
- [x] Local gates, unchanged golden exactly 47, populated scheduling/replay/self-check and restore.

Docs/17 records exact outcomes. Production rollout/application remain separately authorized.
