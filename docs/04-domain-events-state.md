# Domain — Event Catalog, State Machine Reducer, Invariants

Implements spec Parts 2–4. This layer (`apps/server/src/domain/`) is **pure**: no I/O, no dates from the wall clock, no imports from db/api/transport. Everything here is exhaustively unit-testable.

---

## 1. Event catalog (who emits what, when)

| Event | Emitted by | When | State-relevant |
|-------|-----------|------|:--:|
| `enrolled` | API (enroll action, recycle action, manual-compose first send) | Lead added to a campaign | ✅ NEW→ACTIVE |
| `sent` | Scheduler (after SMTP accept) / manual composer | Message handed to transport successfully | advances step |
| `delivered` | `confirm-delivery` job (decision N) | send + `delivery_confirm_hours`, no bounce recorded for that (enrollment, step) | no transition (feeds `contacted`) |
| `soft_bounce` | Poller (DSN 4.x.x) | Temporary failure | retry counter; terminal `BOUNCED` when retries exhausted |
| `hard_bounce` | Poller (DSN 5.x.x) / scheduler (permanent SMTP 5xx recipient rejection at send time) | Permanent failure | ✅ → BOUNCED + suppression |
| `human_reply` | Poller (bucket 3) | Threaded human reply | ✅ → REPLIED |
| `auto_reply` | Poller (bucket 2) | OOO/auto-submitted | none (sequence continues) |
| `unsubscribe` | Poller (STOP match, `source=reply`) / API (manual, `source=manual`) / link handler if ever built (`source=link`) | Opt-out | ✅ → UNSUBSCRIBED + suppression |
| `meeting_booked` | API (Unibox click) | Operator marks meeting | milestone flag only |
| `deal_won` / `deal_lost` | API (optional) | Deal outcome | none |
| `sentiment_tagged` | API (Unibox tag click) | Operator confirms/changes sentiment | updates `best_reply_sentiment` projection only |
| `reply_dispositioned` | API (Unibox outcome) | Operator records the reviewed outcome for one human reply | permission/audit fact; suppressive outcomes append `unsubscribe` in the same transaction |

**Event constructors** (`domain/events.ts`) validate per-type required fields (see docs/03 §2 attributes table) and are the only way the rest of the app creates event objects — malformed events are unrepresentable.

## 2. The reducer

```ts
// domain/reducer.ts — THE core function. (state, event) → state. No side effects.

export interface EnrollmentSnapshot {
  state: EnrollmentState;              // 'NEW'|'ACTIVE'|'REPLIED'|'BOUNCED'|'UNSUBSCRIBED'|'COMPLETED'
  currentStepNo: number;
  softBounceRetries: number;
  bestReplySentiment: Sentiment | null;
  meetingBooked: boolean;
  terminalAt: Date | null;
  // replySentiments: Map<eventId, Sentiment|null> — working memory for sentiment_tagged resolution
}

const TERMINAL_PRIORITY = { UNSUBSCRIBED: 4, BOUNCED: 3, REPLIED: 2, COMPLETED: 1 } as const;

export function applyEvent(s: EnrollmentSnapshot, e: DomainEvent, ctx: SequenceShape): EnrollmentSnapshot {
  switch (e.type) {
    case 'enrolled':      return { ...s, state: 'ACTIVE', currentStepNo: 1 };

    case 'sent':          return isTerminal(s.state) ? s
                               : { ...s, currentStepNo: e.stepNo + 1 };
      // NOTE: completion is NOT triggered by `sent` of the last step — see completion rule §2.1

    case 'delivered':     return s;                       // metrics-only

    case 'soft_bounce': {
      const retries = s.softBounceRetries + 1;
      if (retries > ctx.softRetryMax)                     // default 2 → third soft = terminal
        return toTerminal(s, 'BOUNCED', e.occurredAt);
      return { ...s, softBounceRetries: retries };        // stays ACTIVE; scheduler re-queues the SAME step
    }

    case 'hard_bounce':   return toTerminal(s, 'BOUNCED', e.occurredAt);
    case 'human_reply':   return toTerminal(bumpSentiment(s, e), 'REPLIED', e.occurredAt);
    case 'unsubscribe':   return toTerminal(s, 'UNSUBSCRIBED', e.occurredAt);
    case 'meeting_booked':return { ...s, meetingBooked: true };            // stays REPLIED (spec Part 3)
    case 'sentiment_tagged': return bumpSentiment(s, e);                   // never changes state
    case 'auto_reply': case 'deal_won': case 'deal_lost': return s;
  }
}

function toTerminal(s: EnrollmentSnapshot, t: TerminalState, at: Date): EnrollmentSnapshot {
  // Precedence (spec Part 3): a terminal event only wins if its priority ≥ current terminal priority.
  if (isTerminal(s.state) && TERMINAL_PRIORITY[t] < TERMINAL_PRIORITY[s.state]) return s;
  return { ...s, state: t, terminalAt: isTerminal(s.state) ? s.terminalAt : at };
}
```

`bumpSentiment` keeps the **best** sentiment across all of the enrollment's replies (`positive > neutral > negative > null`), resolving each reply's effective sentiment as: latest `sentiment_tagged` for that reply, else the `human_reply.sentiment` column (decision M).

### 2.1 Completion rule

`COMPLETED` has no triggering event of its own. The **scheduler** (not the reducer) detects "all steps sent and final step's `delivered` confirmed (or `delivery_confirm_hours` elapsed) with the enrollment still ACTIVE" and appends a synthetic-free transition by… nothing — instead, completion is a *derived transition*: when the scheduler finds an ACTIVE enrollment whose `currentStepNo > lastStepNo` and whose last step's confirm window has passed, it sets the projection to `COMPLETED` via `eventStore.complete(enrollmentId)`, which appends **no event** but is deterministic from existing events. To keep rebuild-from-log exact, `rebuild-projections` applies the same derivation (it knows the sequence shape and the clock time of the rebuild). *Consequence:* an enrollment can sit ACTIVE for up to `delivery_confirm_hours` after its last send — matching the spec's "finished all steps with no human reply."

### 2.2 Transition matrix (unit-test checklist — every cell is a test)

| current \ event | enrolled | sent | soft×(≤max) | soft×(>max) | hard | human_reply | unsubscribe | meeting | sentiment_tagged |
|---|---|---|---|---|---|---|---|---|---|
| NEW | ACTIVE | – | – | – | – | – | – | – | – |
| ACTIVE | ∅ | step+1 | ACTIVE (retry++) | BOUNCED | BOUNCED | REPLIED | UNSUBSCRIBED | flag | proj |
| REPLIED | ∅ | ∅¹ | ∅ | **BOUNCED**² | **BOUNCED**² | REPLIED (best sentiment) | **UNSUBSCRIBED** | flag | proj |
| BOUNCED | ∅ | ∅ | ∅ | ∅ | BOUNCED | ∅³ | **UNSUBSCRIBED** | flag | proj |
| UNSUBSCRIBED | ∅ | ∅ | ∅ | ∅ | ∅ | ∅³ | UNSUBSCRIBED | flag | proj |
| COMPLETED | ∅ | ∅ | ∅ | BOUNCED⁴ | BOUNCED⁴ | REPLIED⁴ | UNSUBSCRIBED⁴ | flag | proj |

∅ = no change. ¹ scheduler must never send to terminal states — but if a race lands a `sent` after a reply, state is unharmed. ² BOUNCED (3) outranks REPLIED (2), so a post-reply bounce upgrades — per the spec's "highest-priority terminal state it triggered". Rare (sequences stop on reply) but possible when the last sent message bounces late. ³ replies from bounced/unsubscribed leads still log the event (facts are facts) but can't downgrade the state — REPLIED (2) < BOUNCED (3)/UNSUBSCRIBED (4). ⁴ higher priority than COMPLETED → late events upgrade it (e.g. a reply arriving after sequence end still counts — this is intended and matches the precedence rule).

## 3. Suppression side effects (transactional, not in the reducer)

`eventStore.append` applies these in the same transaction, when `settings` toggles are on:

| Event | Side effect |
|-------|------------|
| `hard_bounce` | upsert `suppressions(email, 'hard_bounce')`; `leads.is_suppressed = true` |
| `unsubscribe` | upsert `suppressions(email, 'unsubscribed')` (reason `unsubscribed` **wins** over an existing `hard_bounce` row); `leads.is_suppressed = true` |
| `sent` | insert `sent_messages` row |
| `human_reply` (with stop_on_reply) | `next_send_at = NULL` (reducer already made state terminal) |

## 4. Invariants (`domain/invariants.ts` — used by tests and the self-check job)

1. **Closure:** per campaign, `|UNSUBSCRIBED| + |BOUNCED| + |REPLIED| + |COMPLETED| + |ACTIVE| + |NEW| == |enrolled events|`; once a campaign is `completed`, ACTIVE = NEW = 0 and terminals sum to total (golden cohort: 40+18+47+780 = 885).
2. **Precedence:** no enrollment with an `unsubscribe` event is in any state but UNSUBSCRIBED; none with `hard_bounce` (and no unsubscribe) in any state but BOUNCED.
3. **Reply integrity:** every REPLIED enrollment has ≥1 `human_reply`; every `meeting_booked` enrollment has ≥1 `human_reply`.
4. **Threading integrity:** every `sent` event has a unique `message_id` and a matching `sent_messages` row.
5. **Suppression integrity:** every lead with a terminal `unsubscribe`/`hard_bounce` event has `is_suppressed = true` and a `suppressions` row.
6. **Step monotonicity:** `sent.step_no` per enrollment is strictly increasing by 1 from 1 — except a soft-bounce retry, which repeats the same `step_no` (with `attributes.retry_no` increasing).

## 5. `rebuild-projections`

CLI: `npm run rebuild-projections [-- --campaign <id>] [--dry-run]`

```
1. BEGIN; take an advisory lock (blocks eventStore.append during rebuild)
2. SELECT events ORDER BY enrollment_id, id
3. Fold applyEvent per enrollment (initial = NEW snapshot); apply §2.1 completion derivation
4. Recompute next_send_at from last `sent` + sequence wait_days (ACTIVE only)
5. Rebuild sent_messages from `sent` events; rebuild suppressions/leads.is_suppressed from terminal events
6. --dry-run: diff against live projections, print discrepancies, exit 1 if any, ROLLBACK
   otherwise: overwrite projections, COMMIT
```

The weekly `rebuild-compare` job (B7) runs `--dry-run` and emits a `selfcheck_drift` alert on any diff. **Rebuild equivalence is also a Stage-B1 test:** run a scenario live, snapshot projections, wipe them, rebuild, assert identical.
