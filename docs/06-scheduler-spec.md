# Scheduler Spec — Tick, Pacing, Rotation, Capacity, Catch-up, Auto-pause

Implements spec Part 7 + Part 11, walkthrough Stages 5, 8. Lives in `apps/server/src/scheduler/`. Runs as pg-boss cron job `scheduler-tick` every `settings.scheduler_tick_minutes` (default 5). All time via `Clock`; all sends via `MailTransport`. The tick is **idempotent and crash-safe**: it holds a pg advisory lock (`pg_try_advisory_lock`) so overlapping ticks can't double-send; every send is committed (event appended) before the next is attempted.

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
    mb.paceReady   = now - mb.last_send_at >= minGap(mb) ± jitter    // §2
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

```
minGap(mb) = windowMinutes(mb.send_window) / mb.capToday          // 540/30 = 18 min
jitter     = uniform(-settings.send_jitter_pct%, +settings.send_jitter_pct%)   // seeded PRNG in tests
```

A mailbox sends at most one message per elapsed `minGap ± jitter`, so 30 sends spread across the whole window — humanlike spacing, and bursting is structurally impossible even after downtime.

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
    - auth/connection-level permanent: mailbox.status = 'auth_failed', alert, §6 redistribution
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

**`provider_blocked` trigger (implemented):** a run of `TRANSIENT_FAILURE_LIMIT` (5) consecutive transient send failures on one mailbox that ALL look like throttling (`scheduler/providerBlock.ts` — 421, 4.7.x, "rate", "throttl", "too many", "try again later", …) → `provider_blocked` + alert + redistribution. A single non-throttle failure in that run breaks the streak and the mailbox pauses as `smtp_failing` instead — the safer default, since only a real provider block warrants redistributing work away.

**Redistribution on `auth_failed` / `provider_blocked`:** enrollments assigned to the dead mailbox that have **not yet received step 1** (no `sent` events) get `assigned_mailbox_id = NULL` → next tick's rotation reassigns them. Enrollments mid-thread keep their assignment and simply wait (walkthrough Stage 7's explicit distinction).

**Resume:** operator action `POST /mailboxes/:id/resume { capPct }` sets `resume_cap = daily_cap × capPct / 100`, status `ok`. `resume_cap` clears back to null (full cap) automatically after 7 consecutive days with 0 hard bounces (checked in tick housekeeping).

## 7. Capacity & enrollment (walkthrough Stages 5, 8)

```
capacityToday(campaign):
  total        = Σ capToday over mailboxes status='ok'
  followupsDue = count ACTIVE enrollments with sent-count ≥ 1 AND next_send_at < endOfDay
  sentSoFar    = Σ sentToday
  roomForNew   = max(0, total - sentSoFar - followupsDue)
  rampCap      = campaign in ramp window (enrolled_at of campaign < ramp_days ago)
                   ? ramp_daily_enroll_cap - enrolledToday : ∞
  suggested    = min(roomForNew, rampCap)
```

`POST /campaigns/:id/enroll` (count-based) selects leads: not suppressed, not already enrolled in this campaign, **recycle guard passes (decision Q)**, tier ≠ nurture; ordered Tier A → B → C → untiered, oldest-imported first (walkthrough §11 priority list); appends `enrolled` per lead with `next_send_at = now` and `personalization_mode` from `tier_effort_config`. Rejects count > suggested unless `force: true`.

## 8. Tests (B3 — via scenario runner, docs/13)

Golden cohort full-pipeline (flagship); never-burst after a 14 h VirtualClock gap (assert ≤ cap/day after restart, oldest-first order, `catchup_backlog` alert emitted once); midnight cap reset across tz; window enforcement (unknown-tz lead never sent outside default window); soft-retry ≤2 then BOUNCED; Part-11 auto-pause example verbatim; auth-failed redistribution (unstarted moved, in-flight kept); pace gap statistics (no two sends from one mailbox closer than minGap×0.8); rotation balance (4 equal mailboxes end within ±1 send of each other).
