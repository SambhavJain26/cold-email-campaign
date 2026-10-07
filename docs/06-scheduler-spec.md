# Scheduler Spec — Tick, Pacing, Rotation, Capacity, Catch-up, Auto-pause

> **Migration 0019 overlay:** template steps retain the renderer; personalized steps load a ready
> campaign-step copy and then use the same footer, checks, suppression/reply lock, pacing, windows,
> threading, transport, confirmation, retry, and event pipeline. Missing copy holds only the
> affected enrollment and never falls back. See [docs/22](22-personalized-copy-two-tier.md).

Implements spec Part 7 + Part 11, walkthrough Stages 5, 8. Lives in `apps/server/src/scheduler/`. Runs as pg-boss cron job `scheduler-tick` every minute when a mailbox has a configured range or legacy fixed interval, otherwise every `settings.scheduler_tick_minutes` (default 5). All time via `Clock`; all sends via `MailTransport`. The tick is **idempotent and crash-safe**: it holds a pg advisory lock (`pg_try_advisory_lock`) so overlapping ticks can't double-send; every send is committed (event appended) before the next is attempted.

---

## 1. The tick algorithm

```
tick(now = clock.now()):
  if !tryAdvisoryLock(SCHEDULER_LOCK): return           // previous tick still running
  settings = loadSettings()

  // A. housekeeping
  refreshMailboxHealth(now)          // §6: stale-poll check, auto-pause resume eligibility
  completeFinishedEnrollments(now)   // docs/04 §2.1 derivation

  // B. build per-mailbox budgets
  for mb in mailboxes where status = 'ok':
    mb.sentToday   = countSentEventsSince(mb, localMidnight(mb, now))
    mb.capToday    = mb.resume_cap ?? mb.daily_cap
    mb.paceReady   = mb.next_allowed_send_at IS NULL OR now >= mb.next_allowed_send_at // range; §2 for legacy
    mb.budget      = (mb.capToday - mb.sentToday) if mb.paceReady else 0

  // C. select due work, oldest-first  (never-burst = just this ordering + budgets)
  due = enrollments WHERE current_state='ACTIVE'
          AND next_send_at <= now
          AND (snoozed_until IS NULL OR snoozed_until <= now)
        ORDER BY next_send_at ASC                        // oldest overdue first (catch-up)

  for e in due:
    tz = resolveTimezone(e.lead)                         // §4
    if !insideWindow(mailboxWindowFor(e), now, tz): continue   // stays due; retried next tick
    mb = e.assigned_mailbox_id
           ? mailbox(e.assigned_mailbox_id)              // follow-up: FIXED mailbox (threading, Part 9)
           : pickMailbox()                               // opener: rotation, §3
    if mb is null or mb.budget == 0: continue            // rolls forward — this IS never-burst
    sendOne(e, mb, now)                                  // §5
    mb.budget -= 1; mb.paceReady = false
```

Rules encoded above, stated plainly:

- **Follow-ups always outrank new openers** — not by an explicit priority flag but because enrolled leads' `next_send_at` predates any enrollment the operator makes today, and enrollment itself is capacity-gated (§7).
- **A follow-up whose fixed mailbox is at cap/paused waits** (rolls forward). It is *never* rerouted (walkthrough Stage 7: rerouting breaks In-Reply-To threading).
- **Catch-up after downtime needs no special mode:** overdue rows are simply very old `next_send_at`s; oldest-first + budgets drain them at normal cap over days (spec Part 7's never-burst). If, at tick end, overdue-count > today's total remaining budget, emit one `catchup_backlog` alert (drives the walkthrough's "Scheduler Resumed After Downtime" panel; deduped to once per downtime episode).

## 2. Pacing (decision P)

### Operator-controlled randomized range (migration 0027)

Mailboxes → Edit offers **Minimum minutes** and **Maximum minutes**, whole numbers from 1 to
1440 with minimum strictly below maximum. Existing mailboxes and new forms start at **4–7**.
The range is independent of daily/resume caps and sending windows. After each accepted send,
draw one uniformly distributed integer-second delay within the inclusive range. Persist
`next_allowed_send_at`, `last_send_at`, the sent event and immutable message in one transaction.
The anchor is the actual accepted-send timestamp, not the beginning of the scheduler tick.

Checks, failed attempts and restarts reuse the saved deadline. Editing the range draws once from
the most recent recorded send; saving the same range or unrelated edits keeps the deadline.
No prior send means immediate eligibility inside the window. Range edits and sends hold the same
mailbox row lock; send-time checks revalidate the deadline, cap and window. One accepted send per
mailbox per tick prevents catch-up bursts. Windows, caps and processing can delay an actual send
beyond the selected gap; downtime does not accumulate send credits. Follow-ups keep assignments.

All-role create/edit refreshes minute cron, and boot restores it. Separate API/worker deployments
must restart the worker after spacing edits. Simulation uses the same cadence. Poll and auto-enroll
cadences are unchanged. Additive columns/deadlines survive rollback/reapply without a redraw.

### Legacy fixed interval (migration 0025)

Before migration 0027, **Time between emails (minutes)** set a per-mailbox minimum gap, from 1 to
1440 minutes, independently of the cap and window. With a four-minute interval, 20 messages take
at least 76 minutes from the first send; 25 take at least 96 minutes. Fixed intervals do not use
jitter or spread messages across the window. Remaining work carries forward when capped or when
the window closes. Follow-ups retain their assigned mailbox and all reply/suppression guards.

The gap is measured from the last accepted send, including after interval edits, retries, restarts
and downtime. One accepted send per mailbox per tick remains enforced. When any mailbox has a
fixed interval, the scheduler checks every minute; create/edit refreshes its cron immediately
and boot restores it. Poll cadence and auto-enrollment cadence are unchanged. Minute checks and
processing delays can make an actual gap longer than configured, never shorter. A separate
API/worker deployment must restart its worker after a spacing edit to refresh its schedule.

The legacy `send_interval_minutes` column remains readable for rollback compatibility. Older API
clients explicitly supplying it use fixed pacing with both range fields null. Current forms only
use ranges; omitted create fields default to 4–7. The following historical automatic calculation
applies only when both range fields and the legacy interval are null:

```
minGap(mb) = windowMinutes(mb.send_window) / mb.capToday          // 540/30 = 18 min
jitter     = uniform(-settings.send_jitter_pct%, +settings.send_jitter_pct%)   // seeded PRNG in tests
```

With an unset interval, the window and cap determine the legacy pacing target. Tick rounding and
jitter can reduce daily throughput below that cap. Fixed intervals above let the operator control
spacing directly while retaining the same cap and no-burst safeguards.

## 3. Opener rotation (`pickMailbox`)

Among mailboxes with `status='ok'` and `budget > 0`: pick lowest `sentToday / capToday` ratio; tie → least-recent `last_send_at`. On first send of an enrollment, write `assigned_mailbox_id` in the same transaction as the `sent` event — every later step threads from that mailbox.

## 4. Send windows & time zones (spec Part 7, decision X)

- `resolveTimezone(lead)`: `lead.state` → IANA zone via static US map (CT/MT split states mapped to their majority zone, documented in `scheduler/tzmap.ts`); null/unknown → `settings.default_timezone`. **Unknown never means send-now** — the default window still applies.
- `insideWindow(window, now, tz)`: convert `now` to `tz`; check day-of-week ∈ `window.days` and `start ≤ localTime < end`. Windows are the *mailbox's* configured hours evaluated in the *recipient's* zone (walkthrough Stage 0: "8:00–17:00 (recip.)").
- Daily caps reset at **mailbox-local midnight** — implemented as "count sent events since local midnight," so there is no reset cron and no drift (plan §4.2).

## 5. `sendOne` — the send transaction

```
1. step    = sequenceStep(e.current_step_no); variant = pickVariant(step)   // round-robin among active variants
2. msg     = render(variant, lead, e)                    // docs/08: merge tags, spintax, footer, threading headers
3. result  = transport.send(msg)
4a. accepted:
    tx {
      append sent(enrollment, step_no, mailbox, message_id, content_hash, variant_id)
      set assigned_mailbox_id if first send
      set next_send_at = (last step? NULL : now + nextStep.wait_days in recipient-tz-safe days)
      insert sent_messages row
    }
    schedule confirm-delivery job at now + settings.delivery_confirm_hours (decision N)
    mb.last_send_at = now
4b. transientError (4xx, connection): do NOT append anything; leave next_send_at unchanged;
    pg-boss send-attempt retries with backoff; after 5 failures → pause mailbox (status_reason='smtp_failing'), alert.
4c. permanentError:
    - recipient-level 5xx (mailbox doesn't exist at RCPT time): append hard_bounce directly (reducer → BOUNCED, suppression)
    - auth/connection-level permanent: mailbox.status = 'auth_failed', alert
```

`confirm-delivery(enrollmentId, stepNo)` job: if no `hard_bounce`/`soft_bounce` event exists for that (enrollment, step) → append `delivered`.

## 6. Mailbox health machine (spec Part 9 + Part 11)

```
ok ──(hard-bounce rule fires)──────────▶ auto_paused   ──(operator "Resume at 50%")──▶ ok (resume_cap = 50% of daily_cap)
ok ──(SMTP auth permanent failure)─────▶ auth_failed   ──(operator reconnects, verify OK)──▶ ok
ok ──(no successful poll > stale_poll_hours)─▶ imap_stale ──(poll succeeds)──▶ ok (automatic)
ok ──(provider rate-limit persists)────▶ provider_blocked ──(operator resume)──▶ ok
ok ◀─(operator manual pause/unpause)──▶ paused
```

**Auto-pause evaluation** runs post-commit on every `hard_bounce` append (event-driven, not per-tick):

```
sends = lifetimeSentCount(mb)
if hardBouncesInLastNSends(mb, 10) >= 3:                       → pause (absolute trigger)   // works at any volume
else if sends >= 25 and hardBouncesInLastNSends(mb, 50)/min(sends,50) > 4%: → pause (pct rule)
on pause: status='auto_paused', alert with both window numbers (walkthrough Stage 7 panel), paused_at=now
```

(Queries in docs/05 §5. The exact Part-11 example — 55 sends, 3-in-10 fires, 4-in-50 = 8% — is a locked test.)

**`provider_blocked` trigger (implemented):** a run of `TRANSIENT_FAILURE_LIMIT` (5) consecutive transient send failures on one mailbox that ALL look like throttling (`scheduler/providerBlock.ts` — 421, 4.7.x, "rate", "throttl", "too many", "try again later", …) → `provider_blocked` + alert. A single non-throttle failure in that run breaks the streak and pauses as `smtp_failing`.

**Assignment rule (finding 25):** a mailbox is assigned atomically with the first successful `sent` event. Unstarted work is already unassigned and normal rotation selects another healthy mailbox. Started threads remain pinned and wait, preserving threading. The impossible `redistributeUnstarted` path was removed.

**Resume:** operator action `POST /mailboxes/:id/resume { capPct }` sets `resume_cap = daily_cap × capPct / 100`, status `ok`. `resume_cap` clears back to null (full cap) automatically after 7 consecutive days with 0 hard bounces (checked in tick housekeeping).

## 7. Capacity & enrollment (walkthrough Stages 5, 8)

```
capacityToday(campaign):
  total        = Σ capToday over mailboxes status='ok'
  followupsDue = count ACTIVE enrollments with sent-count ≥ 1 AND next_send_at < endOfDay
  pendingOpeners = count ACTIVE step-1 enrollments reserved for today but not yet sent
  sentSoFar    = Σ sentToday
  roomForNew   = max(0, total - sentSoFar - followupsDue - pendingOpeners)
  rampDay      = calendar day since campaign.first_activated_at (day 1 on activation)
  rampStage    = staged range containing rampDay, or none after final stage
  effectiveCap = rampStage ? rampStage.cap : campaign.steady_daily_enroll_cap
  capRemaining = max(0, effectiveCap - enrolledToday)
  suggested    = min(roomForNew, capRemaining, poolAvailable when pool-backed)
```

Manual and automatic enrollments consume the same effective campaign cap. During the configured
ramp, the matching stage is the cap; beginning the next application-local date after the final
stage, `steady_daily_enroll_cap` applies forever. Unused capacity never carries forward. Draft
campaigns may edit the permanent cap within the global ceiling. After first activation it may be
lowered, but never raised; lowering below today's count simply leaves zero allowance today.

`POST /campaigns/:id/enroll` (count-based) selects leads: not suppressed, not erased, no prior
human reply, not already actively enrolled elsewhere, **recycle guard passes (decision Q)**,
tier ≠ nurture; ordered Tier A → B → C → untiered, oldest-imported first. Once a
campaign receives its first pool allocation, count-based enrollment selects only its available
pool in that tier order and then allocation order. An empty pool never falls back to unrelated
global leads. Existing campaigns that have never received an allocation retain the legacy global
selector. Explicit-ID recontact requires `allow_recontact:true`, a disposition for every reply,
and an elapsed `not_now` date. Suppression is never overrideable.

### 7.1 Optional daily auto-enrollment

`auto_enroll_enabled` is false by default and works only for pool-backed campaigns. Drafts may be
armed, but are never processed. Activation runs an armed campaign immediately; enabling on an
already active campaign requires an explicit acknowledgement and runs once against today's
remaining capacity. Paused and archived campaigns are skipped. Resume may run the still-enabled
preference, but disabling it does not remove existing enrollments.

The normal job cadence calls the coordinator. A persisted application-timezone calendar-date
claim makes the daily run idempotent across retries, concurrent workers, restarts, daylight-saving
transitions, and timezone changes. Claims advance monotonically, so moving the configured timezone
backward cannot resurrect an older unclaimed date. Restarting after missed days runs only the
current date; quotas do not accrue or burst. Under one global enrollment advisory lock, shared room is calculated once and divided
one lead per campaign per pass with a persisted round-robin cursor. Each candidate is rechecked
immediately before the atomic enrollment/event/projection/pool-consumption transaction. Every run
records its trigger, capacity snapshot, per-campaign eligibility/cap/enrollment results, skips, and
failure status.

## 8. Tests (B3 — via scenario runner, docs/13)

Golden cohort full-pipeline (flagship); never-burst after a 14 h VirtualClock gap; midnight cap reset; window enforcement; soft-retry ≤2 then BOUNCED; Part-11 auto-pause; failed-mailbox rotation for unassigned work with started threads pinned; pace-gap statistics; rotation balance.
