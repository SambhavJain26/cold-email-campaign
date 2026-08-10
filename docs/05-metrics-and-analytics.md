# Metrics & Analytics Engine — Exact Queries

Implements spec Part 5 (formulas), Part 10 (golden numbers), walkthrough §13 (analytics screens) and §15 (metric reference). Public API in `apps/server/src/services/metrics/`; the SQL lives in `db/repos/metrics*` (repos are the SQL boundary — docs/02 §1). **Denominator law: campaign bounce rates ÷ distinct `leads sent-to` (≥1 `sent` event — Part 10's 18÷885=2.0% only reconciles this way, since the log holds ~3,315 sent *events* incl. follow-ups); reply/positive/unsub/meetings rates ÷ `contacted` leads (≥1 `delivered` or `human_reply`). A human reply therefore counts immediately, even before the later delivery-confirmation job runs. Per-mailbox auto-pause windows (§5) remain over send events per Part 11 — that is a different, operational metric.**

All queries take `(campaignId?)` — null = all campaigns — and are covered by the `ev_campaign` / `ev_mailbox` indexes.

---

## 1. Base building blocks

```sql
-- contacted: leads with ≥1 delivered OR human_reply (NOT merely sent)
-- golden: 885 - 18 = 867
SELECT count(DISTINCT lead_id) FROM events
WHERE type IN ('delivered', 'human_reply')
  AND ($1::bigint IS NULL OR campaign_id = $1);

-- sent event count (denominator for bounce rates)          -- golden: 885+ (incl. follow-ups; step-1 sent = 885)
SELECT count(*) FROM events WHERE type = 'sent' AND ...;
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

| Function | Numerator SQL | Denominator | Golden value |
|----------|--------------|-------------|-------------:|
| `replyRate` | `count(DISTINCT lead_id) FROM events WHERE type='human_reply'` | contacted | 72/867 = **8.3%** |
| `positiveReplyRate` | `count(DISTINCT lead_id) FROM reply_sentiment WHERE sentiment='positive'` | contacted | 28/867 = **3.2%** |
| `meetingsBooked` | `count(*) FROM events WHERE type='meeting_booked'` | — | **17** |
| `meetingsPer100` | meetings × 100 | contacted | **2.0** |
| `hardBounceRate` | `count(*) type='hard_bounce'` | leads sent-to | 18/885 = **2.0%** |
| `softBounceRate` | `count(*) type='soft_bounce'` | leads sent-to | 9/885 = **1.0%** |
| `unsubscribeRate` | `count(DISTINCT lead_id) type='unsubscribe'` | contacted | 40/867 = **4.6%** |
| `progress` | contacted | `count(*) enrollments` | 867/885 |
| `stepReplyRate(n)` | `count(DISTINCT lead_id) human_reply WHERE step_no=n` | `count(DISTINCT lead_id) delivered WHERE step_no=n` | walkthrough 13b |

Every function returns `{ numerator, denominator, value }` so screens can show "72 / 867 = 8.3%" verbatim.

## 3. Terminal-outcome breakdown + self-check (spec Part 1)

```sql
SELECT current_state, count(*) FROM enrollments
WHERE campaign_id = $1 GROUP BY current_state;
```

`selfCheck(campaignId)` asserts invariant #1 of docs/04 §4 (states sum to enrolled-event count) **and** cross-checks projections against the log (each UNSUBSCRIBED enrollment has an `unsubscribe` event, etc.). Returns a list of violations; the daily `self-check` job alerts (`selfcheck_drift`, severity `error`) if non-empty.

## 4. Analytics groupings (walkthrough §13)

**13a — per variant:** join `events sent` → `attributes->>'variant_id'` → aggregate sent count / reply / positive / meetings per variant of a given step. Meetings attribute to the variant of the **step-1 send** of that enrollment (the opener determines the cohort — matches walkthrough's A/Z framing).

**13b — per step:** delivered / distinct positive repliers / positive% per `step_no` (the "kill Step 3" table). Uses `stepReplyRate` with the `reply_sentiment` CTE filtered to positive.

**13c — per tier:** group by `enrollments.enrolled_tier` (snapshot, not the lead's current tier — historical accuracy per plan §4.1): contacted, reply%, positive%, meetings, mode. NULL tier renders as "untiered".

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

plus cumulative rate series computed in TS (rates need running contacted denominators). **Watch rules** (walkthrough 13d) evaluated in TS: reply-rate 30-day drop ≥30% → warning; unsub-rate slope positive over 14 days → warning. Both surface as `alerts` rows.

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

Every metric accepts `asOf` (filters `occurred_at <= asOf`, including `sentiment_tagged` resolution), so mid-campaign snapshots are the same queries with a cutoff. The walkthrough's Day-34 panel (600 contacted / 6.7% / 3.0% / 2.0) is illustrative — the golden fixture's timeline differs — so golden L2 asserts the *property* instead: at a mid-campaign cutoff, each metric equals the value computed independently from the fixture events up to that cutoff, and the final values equal Part 10 exactly.

## 7. Test matrix (B2)

- Golden cohort: every table above vs Part 10 / §13 numbers, exact.
- Denominator edges: hard-bounce-on-step-1 lead is not `contacted`; soft-bounced-then-recovered lead **is** (delivered on retry); a lead with 3 replies counts once in reply rate.
- Overlap: the 25 "remove me" leads appear in reply rate AND unsub rate; terminal breakdown counts them once (UNSUBSCRIBED).
- Sentiment resolution: reply auto-tagged negative then human-retagged neutral → counted neutral (latest `sentiment_tagged` wins).
- Self-check: inject an enrollment whose state contradicts its events → violation reported.
