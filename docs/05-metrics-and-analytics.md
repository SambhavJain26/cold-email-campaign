# Metrics & Analytics Engine — Exact Queries

## Confirmed-human metrics (2026-10-08; local candidate)

For new review-policy messages, detection, linking, acknowledgement and outreach decisions do
not produce human-reply credit. Only explicit Human confirmation does. Automatic and Unsure
confirmations are excluded. metric_events_at(cutoff) projects the latest confirmation into the
existing metric queries without modifying events. Existing historical human_reply analytics
remain unchanged.

One canonical message has one primary campaign attribution; sibling safety holds add no reply
credit. Separate messages have no invented replied-to step. Linking corrections preserve
confirmed authorship and append facts that move campaign credit and clear the former enrollment's
sentiment contribution. As-of queries use the association and confirmation valid at that cutoff.
Sent/denominator history is unchanged. Sentiment corrections are explicit facts, not body-derived
meaning guesses. Meeting facts remain durable operator outcomes, including after an authorship
correction; self-check recognizes a prior explicit human confirmation.

Campaign delivery-confirmation counts use the same confirmed-human projection. Unfinished
enrollments blocked by a globally suppressed address count as finished for campaign progress and
appear in an additive `SUPPRESSED` outcome bucket. Existing terminal outcomes keep their historical
bucket, without double counting or changing lifecycle events. Human reply rates remain independent
of these sending outcomes. Recording a new meeting requires effective confirmed-human credit in
that campaign; sibling safety holds do not qualify.

Implements spec Part 5 (formulas), Part 10 (golden numbers), walkthrough §13 (analytics screens) and §15 (metric reference). Public API in `apps/server/src/services/metrics/`; the SQL lives in `db/repos/metrics*` (repos are the SQL boundary — docs/02 §1). **Denominator law: `contacted` means a distinct lead with at least one accepted `sent` event. Reply, positive, unsubscribe, meeting-per-100, and campaign bounce rates all use this stable accepted-recipient cohort. Part 10 therefore reconciles reply as 72÷885=8.1%, unsubscribe as 40÷885=4.5%, and hard bounce as 18÷885=2.0%. Follow-up send events do not multiply the denominator. Per-mailbox auto-pause windows (§5) remain over individual send events per Part 11 — that is a different operational metric.**

All queries take `(campaignId?)` — null = all campaigns — and are covered by the `ev_campaign` / `ev_mailbox` indexes.

---

## 1. Base building blocks

```sql
-- contacted: distinct leads with ≥1 accepted sent event
-- golden: 885
SELECT count(DISTINCT lead_id) FROM events
WHERE type = 'sent'
  AND ($1::bigint IS NULL OR campaign_id = $1);

-- delivery-confirmed: delivered, reply, or link/reply unsubscribe proves receipt
-- pending: contacted minus any delivered/hard-bounce/reply/unsubscribe resolution
```

**Effective sentiment per reply** (decision M) — reusable CTE:

```sql
WITH reply_sentiment AS (
  SELECT hr.id AS reply_event_id, hr.lead_id, hr.campaign_id, hr.step_no,
         COALESCE(
           (SELECT st.sentiment FROM events st
             WHERE st.type = 'sentiment_tagged'
               AND (st.attributes->>'reply_event_id')::bigint = hr.id
             ORDER BY st.id DESC LIMIT 1),
           hr.sentiment) AS sentiment
  FROM events hr WHERE hr.type = 'human_reply'
)
```

## 2. The metric functions

| Function            | Numerator SQL                                                             | Denominator                   |      Golden value |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------- | ----------------: |
| `replyRate`         | `count(DISTINCT lead_id) FROM events WHERE type='human_reply'`            | contacted                     | 72/885 = **8.1%** |
| `positiveReplyRate` | `count(DISTINCT lead_id) FROM reply_sentiment WHERE sentiment='positive'` | contacted                     | 28/885 = **3.2%** |
| `meetingsBooked`    | `count(*) FROM events WHERE type='meeting_booked'`                        | —                             |            **17** |
| `meetingsPer100`    | meetings × 100                                                            | contacted                     |           **1.9** |
| `hardBounceRate`    | `count(*) type='hard_bounce'`                                             | leads sent-to                 | 18/885 = **2.0%** |
| `softBounceRate`    | `count(*) type='soft_bounce'`                                             | leads sent-to                 |  9/885 = **1.0%** |
| `unsubscribeRate`   | `count(DISTINCT lead_id) type='unsubscribe'`                              | contacted                     | 40/885 = **4.5%** |
| `progress`          | contacted                                                                 | `count(*) enrollments`        |           885/885 |
| `stepReplyRate(n)`  | `count(DISTINCT lead_id) human_reply WHERE step_no=n`                     | distinct leads sent at step N |   walkthrough 13b |

Every rate function returns `{ numerator, denominator, value }` so screens can show "72 / 885 = 8.1%" verbatim. Overview additionally reports delivery-confirmed and pending-confirmation counts; a hard bounce resolves pending status without being counted as confirmed delivery.

## 3. Terminal-outcome breakdown + self-check (spec Part 1)

```sql
SELECT current_state, count(*) FROM enrollments
WHERE campaign_id = $1 GROUP BY current_state;
```

`selfCheck(campaignId)` asserts invariant #1 of docs/04 §4 (states sum to enrolled-event count) **and** cross-checks projections against the log (each UNSUBSCRIBED enrollment has an `unsubscribe` event, etc.). Returns a list of violations; the daily `self-check` job alerts (`selfcheck_drift`, severity `error`) if non-empty.

## 4. Analytics groupings (walkthrough §13)

**13a — per variant at any selected step:** join selected-step `sent` events through
`attributes->>'variant_id'` and build one enrollment cohort per variant.

- **Direct response:** sent/delivery-confirmed at that step; a reply counts only when the persisted
  `human_reply.step_no` points to that step's sent message. Its denominator is the sent variant
  cohort, so early replies are visible immediately and cannot produce a rate above 100%.
- **Eventual outcome:** denominator is every distinct enrollment that received the selected
  variant. Any human reply after that send, including a thread match to a later step, counts toward
  eventual reply/positive results; meetings are distinct enrollments with a later
  `meeting_booked` event.
- Both views resolve the latest `sentiment_tagged` value. Erased leads are excluded. Bespoke and
  inactive historical variants remain visible, but bespoke rows are excluded from winner selection.
  Winner order is eventual meetings, then eventual positive rate; an exact tie is reported as a tie.

**13b — per step:** sent / delivery-confirmed / pending confirmation / replies / reply% / distinct positive repliers / positive% per `step_no` (the "kill Step 3" table). Rows anchor on `sent`, so the first six hours are not an empty screen.

**13c — per tier:** group by `enrollments.enrolled_tier` (snapshot, not the lead's current tier — historical accuracy per plan §4.1): contacted/sent, delivery-confirmed, pending confirmation, reply%, positive%, meetings, mode. NULL tier renders as "untiered".

**13d — health trend:** per-day time series over the last N days (default 30):

```sql
SELECT date_trunc('day', occurred_at) d,
       count(*) FILTER (WHERE type='sent')        sent,
       count(*) FILTER (WHERE type='human_reply') replies,
       count(*) FILTER (WHERE type='hard_bounce') hard,
       count(*) FILTER (WHERE type='unsubscribe') unsubs
FROM events WHERE occurred_at >= $now - interval '30 days'
GROUP BY 1 ORDER BY 1;
```

plus cumulative rate series computed in TS (rates use running distinct sent-recipient denominators). **Watch rules** (walkthrough 13d) evaluated in TS: reply-rate 30-day drop ≥30% → warning; unsub-rate slope positive over 14 days → warning. Both surface as `alerts` rows.

**Per-mailbox volume (metric #5):**

```sql
SELECT mailbox_id, date_trunc('day', occurred_at) d, count(*) sends
FROM events WHERE type='sent' AND occurred_at >= $now - interval '$days days'
GROUP BY 1, 2;
```

7-day average + imbalance flag in TS: `max(avg) > 1.5 × min(avg)` across `ok` mailboxes → "rotation imbalance" warning (walkthrough §11).

## 5. Auto-pause window queries (spec Part 11 — used by scheduler, defined here for testability)

```sql
-- last-N sends for a mailbox with hard-bounce correlation
WITH last_sends AS (
  SELECT id, message_id FROM events
  WHERE mailbox_id = $1 AND type = 'sent'
  ORDER BY id DESC LIMIT $N            -- N = 50 (pct rule) or 10 (absolute rule)
)
SELECT count(*) FROM events b
JOIN last_sends s ON b.type = 'hard_bounce'
  AND b.enrollment_id = (SELECT enrollment_id FROM sent_messages WHERE message_id = s.message_id)
  AND b.step_no = (SELECT step_no FROM sent_messages WHERE message_id = s.message_id);
```

A hard bounce "belongs to" the send it bounced (matched via the DSN → sent_message), so the window is over **sends**, not time — exactly the spec's "3+ hard bounces in any 10-send span" and "rate over last 50 sends". Lifetime send count gates the pct rule (`≥ pause_min_sends`).

## 6. Mid-campaign correctness

Every metric accepts `asOf` (filters `occurred_at <= asOf`, including `sentiment_tagged` resolution), so mid-campaign snapshots are the same queries with a cutoff. The walkthrough's Day-34 panel (600 contacted / 6.7% / 3.0% / 2.0) is illustrative — the golden fixture's timeline differs — so golden L2 asserts the _property_ instead: at a mid-campaign cutoff, each metric equals the value computed independently from the fixture events up to that cutoff, and the final values equal Part 10 exactly.

## 7. Test matrix (B2)

- Golden cohort: every table above vs Part 10 / §13 numbers, exact.
- Denominator edges: a hard-bounce-on-step-1 lead is contacted once its send is accepted and then moves out of pending confirmation; a soft-bounced-then-recovered lead remains one contacted lead; a lead with 3 replies counts once in reply rate.
- Overlap: the 25 "remove me" leads appear in reply rate AND unsub rate; terminal breakdown counts them once (UNSUBSCRIBED).
- Sentiment resolution: reply auto-tagged negative then human-retagged neutral → counted neutral (latest `sentiment_tagged` wins).
- Self-check: inject an enrollment whose state contradicts its events → violation reported.
