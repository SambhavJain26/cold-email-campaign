# Cold Email Tool - Event Model & State Machine Spec

**The single source of truth for the system's data model. Every metric, every screen number, and eventually the database schema derives from what's defined here. This document exists to make the walkthrough's numbers reconcile and to remove ambiguity before building.**

> **Why this document exists:** the walkthrough's numbers didn't add up because they were written screen-by-screen for illustration, not derived from one model. Almost every error traced to two undefined questions: *what events exist* and *how each metric is computed from them*. This spec answers both, then proves it with one worked cohort where the math closes exactly.

---

## Part 1 - The core principle that fixes everything

There are **two different kinds of number** in this system, and mixing them up caused every reconciliation error:

**A. Terminal outcomes - mutually exclusive.** At the end of a campaign, every lead lands in **exactly one** terminal bucket. These sum to the total. A lead is never in two buckets.

**B. Rates - event-based, can overlap.** A rate counts *events*, and one lead can contribute to several. A lead who replies "remove me" contributes to *both* the reply rate *and* the unsubscribe rate. That's not double-counting - they're different measurements of the same lead.

The rule: **outcome breakdowns must sum to the total (use terminal states); rates never have to sum to anything (use events).** Keep these two ideas separate and the math always closes.

---

## Part 2 - The event log (the atomic layer)

Everything is built on an append-only event log. Each row = one thing that happened to one lead at one time. Events are **facts**; they are never edited or deleted, only appended.

| Event type | Fired when | Key attributes |
|-----------|-----------|----------------|
| `enrolled` | Lead added to a campaign | campaign_id, tier, mailbox_id |
| `sent` | An email leaves via SMTP | step_no, mailbox_id, message_id |
| `delivered` | Send accepted, no bounce within window | step_no |
| `soft_bounce` | Temporary failure (mailbox full, greylist, 4xx) | step_no, reason |
| `hard_bounce` | Permanent failure (no such address, 5xx) | step_no, reason |
| `human_reply` | A genuine human reply detected | sentiment (pos/neu/neg), step_no |
| `auto_reply` | Auto-responder/OOO detected (NOT a human reply) | reason |
| `unsubscribe` | Lead asked to be removed (via reply or link) | source (reply/link) |
| `meeting_booked` | Arjun marks a call booked | - |
| `deal_won` / `deal_lost` | Optional: outcome of a booked meeting | - |

Two things worth noting immediately:
- **`auto_reply` is separate from `human_reply`.** An out-of-office is not interest. Conflating them inflates reply rate with noise. (How we tell them apart: Part 6.)
- **`unsubscribe` is its own event, independent of how it arrived.** A "remove me" email fires *both* a `human_reply` (sentiment negative) *and* an `unsubscribe`. A footer-link click fires only `unsubscribe`. This is the key modeling decision - see Part 4.

---

## Part 3 - The lead state machine

At any moment a lead is in exactly one **state**. Events drive transitions. This is what the "status" column on the Leads screen shows, and it's what makes terminal outcomes mutually exclusive.

```
                    ┌─────────┐
                    │   NEW   │  (imported, not yet enrolled)
                    └────┬────┘
                         │ enrolled
                         ▼
                    ┌─────────┐   soft_bounce (retry ≤2)
                    │ ACTIVE  │◄──────────┐
                    │(in seq.)│───────────┘
                    └────┬────┘
        ┌────────────────┼───────────────┬──────────────┐
        │ human_reply    │ hard_bounce   │ unsubscribe  │ all steps done,
        │                │ OR soft_bounce│              │ no human_reply
        │                │ retries       │              │
        ▼                ▼ exhausted     ▼              ▼
   ┌─────────┐      ┌──────────┐   ┌────────────┐  ┌──────────────┐
   │ REPLIED │      │ BOUNCED  │   │UNSUBSCRIBED│  │  COMPLETED   │
   │(engaged)│      │(terminal)│   │ (terminal) │  │ (no reply →  │
   └────┬────┘      └──────────┘   └────────────┘  │ cold storage)│
        │                                          └──────────────┘
        │ meeting_booked (milestone, stays REPLIED)
        │ then optional deal_won / deal_lost
        ▼
   (handled manually by Arjun)
```

**Terminal states (mutually exclusive - these sum to the total):**
- `REPLIED` - sent ≥1 human reply and did **not** unsubscribe. (Engaged: positive or neutral.)
- `UNSUBSCRIBED` - asked to be removed. **Takes precedence over REPLIED** - if a lead replies "remove me," they are UNSUBSCRIBED, not REPLIED, because unsubscribe is the more consequential terminal state.
- `BOUNCED` - hard bounce, or soft bounce with retries exhausted. Permanently removed.
- `COMPLETED` - finished all sequence steps with no human reply → moves to Cold Storage.

**Precedence rule (resolves the double-count bug):** when a lead could qualify for two terminal states, apply this priority: **UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED.** Each lead lands in the highest-priority terminal state it triggered. This guarantees the outcome breakdown sums to the total.

`ACTIVE` and `NEW` are non-terminal (in-flight). `meeting_booked` is a **milestone flag**, not a state - a lead with a booked meeting is still `REPLIED`.

---

## Part 4 - The decision you need to confirm: is unsubscribe a reply?

This was the ambiguity that broke the numbers. Here is the resolution the spec adopts (flag if you disagree):

**An unsubscribe is a separate event, but a "remove me" reply generates two events at once.** Concretely:

- A lead emails "please remove me" → fires `human_reply` (sentiment: negative) **and** `unsubscribe` (source: reply).
- A lead clicks the footer unsubscribe link → fires `unsubscribe` (source: link) only. No reply event.

**Consequences for the numbers:**
- **Reply rate** counts the "remove me" lead (they *did* reply). So reply rate includes negative replies.
- **Positive reply rate** does *not* count them (sentiment ≠ positive).
- **Unsubscribe rate** counts them.
- **Terminal state**: they're `UNSUBSCRIBED` (precedence over `REPLIED`), so the outcome breakdown counts them once.

This is why rates can overlap while outcomes don't. While unsubscribes could be excluded from reply rate entirely (i.e., treating "remove me" as an opt-out rather than a reply), the specification standard counts it as a reply because a human respondent actively authored the message.

> **[FINALIZED]** Unsubscribe counts as both a reply AND an unsubscribe event, with UNSUBSCRIBED taking precedence as the terminal state. Default confirmed.

---

## Part 5 - Every metric, defined exactly

Denominators matter. Here is each metric with its precise numerator and denominator, all derived from the event log.

**Contacted** = count of leads with ≥1 `delivered` event. (Not `sent` - a hard bounce on step 1 means they were never actually contacted.)

| Metric | Numerator | Denominator |
|--------|-----------|-------------|
| **Reply rate** | leads with ≥1 `human_reply` | contacted |
| **Positive reply rate** | leads whose best reply sentiment = positive | contacted |
| **Meetings booked** | count of `meeting_booked` | - (absolute) |
| **Meetings per 100 sent** | `meeting_booked` × 100 | contacted |
| **Hard-bounce rate** | `hard_bounce` events | `sent` events |
| **Soft-bounce rate** | `soft_bounce` events | `sent` events |
| **Unsubscribe rate** | `unsubscribe` events | contacted |
| **Step reply rate** | `human_reply` at step N | `delivered` at step N |
| **Auto-pause hard-bounce rate** | `hard_bounce` in window | last 50 `sent` for that mailbox |

Two deliberate choices: bounce rates use `sent` as denominator (bounces are about sending health), while reply/unsub rates use `contacted` (engagement is about people who actually got the email). Mixing these was another source of drift.

---

## Part 6 - Reply detection (the hardest part, previously hand-waved)

The walkthrough said "the IMAP poller detects replies" in one sentence. This is where homebuilt tools fail. Here's the real logic the system must implement.

**The IMAP poller, each cycle, classifies every new message in each mailbox into one of four buckets:**

1. **Bounce** - sender is `MAILER-DAEMON`/`postmaster`, OR the message is a DSN (`Content-Type: message/delivery-status`). Parse the status code: `5.x.x` → `hard_bounce`; `4.x.x` → `soft_bounce`. Extract the failed recipient to match the lead.

2. **Auto-reply / OOO** - has header `Auto-Submitted: auto-replied`, OR `X-Autoreply`, OR subject matches common OOO patterns ("out of office", "automatic reply", "away from"). Fires `auto_reply`, **not** `human_reply`. Does **not** stop the sequence (they didn't really engage) - though it may pause it briefly.

3. **Human reply** - everything else that threads to a sent message. Matched by `In-Reply-To` / `References` headers pointing at our `Message-ID`. This is the reliable match - **not** subject-line matching, which breaks when subjects change or get forwarded. Fires `human_reply`; **stops the sequence.**

4. **Unrelated** - doesn't thread to anything we sent. Ignored.

**Sentiment** on a human reply is set by Arjun's one click in the Unibox (positive/neutral/negative). Optionally an LLM can pre-suggest sentiment, but the human confirms - cost stays zero and accuracy stays high.

> **[FINALIZED]** Sentiment tagging = one-click human tag, with optional AI-suggested tag that the human confirms. Default confirmed.

**The critical dependency:** every `sent` email must store its `Message-ID`, and every follow-up must carry `In-Reply-To`/`References` so the whole thread (and any reply to any step) matches back to the right lead. This is a hard requirement on the sender, not just the poller.

---

## Part 7 - Scheduler behavior & missed-day handling (previously undefined)

The scheduler decides who gets sent each cycle. Undefined edge cases were a gap. Resolved rules:

**Normal operation:** every N minutes, find leads where `state = ACTIVE` and `next_send_at ≤ now` and their assigned mailbox is under its daily cap and inside its send window. Send, increment the mailbox's `sent_today`, set the lead's `next_send_at` to the next step's due time.

**Daily cap reset:** `sent_today` resets at each mailbox's local midnight.

**Missed-day / catch-up (matters if self-hosted on a laptop that isn't always on):** if the system was off and work piled up, on restart it must **never burst** to clear the backlog - that's a spam signal. Instead: overdue sends are processed at the **normal daily cap**, oldest-first, and anything that doesn't fit rolls to the next day. Sequence timing shifts later rather than firing all at once. **Recommendation: run on a cheap always-on VPS**, which makes this edge case rare. Flag: confirm self-hosted-laptop vs. VPS, because it changes how defensive the scheduler must be.

> **[FINALIZED]** Hosting = always-on VPS (not a personal laptop). Default confirmed. The scheduler is still built with the catch-up/never-burst logic described above as a safety net, but the VPS choice means it should rarely trigger in practice.

**Time zones (previously asserted, not solved):** scraped leads rarely have reliable time zones. Resolution: (a) infer from US state / area code when available; (b) when unknown, default to a single configured business-hours window in US Eastern (safe for most of the country); (c) never treat "unknown TZ" as "send now." This makes the recipient-local send window actually implementable.

---

## Part 8 - Compliance (CAN-SPAM), previously absent

US cold email has legal requirements. These are **features, not optional polish**:

- **Every email** must include a footer with a **valid physical mailing address** and a **clear unsubscribe mechanism**. This is required by CAN-SPAM. The footer is part of the template, always on.
- **Unsubscribe must actually work** - a clicked link or a "remove me" reply must suppress the lead permanently (the `unsubscribe` event + `UNSUBSCRIBED` terminal state already handle this).
- **No deceptive subject lines or false headers.** The "from" name and subject must not mislead.
- **Honor opt-outs promptly.** Suppression is immediate in this model.

Note the mild tension with cold-email deliverability advice ("no links in step 1"): the unsubscribe line can be a plain-text instruction ("reply STOP to opt out") rather than a tracked link, which satisfies the law without adding a spam-triggering link. Flag this as a design choice to confirm.

> **[FINALIZED]** Unsubscribe mechanism = plain-text "reply STOP to opt out" instruction (not a tracked link). Default confirmed.

---

## Part 9 - Failure states (previously only happy-path)

A tool run unattended must surface failures on-screen, not fail silently:

- **Mailbox auth expired** (app password revoked, OAuth token dead) → mark mailbox `🔴 AUTH FAILED`, pause its sends, alert. Redistribute load to healthy mailboxes (within their caps).
- **SMTP send rejected / rate-limited** by the provider → retry with backoff; if it persists, pause that mailbox and alert.
- **IMAP poll fails** → keep retrying; warn if a mailbox hasn't been polled in >X hours (replies could be missed → sequences wrongly continue).
- **Provider-level block** (e.g., Gmail temporarily limits the account) → treat like a paused mailbox; do not reroute *that account's in-flight threads* to a different mailbox (breaks threading), but stop enrolling new leads on it.

---

## Part 10 - The worked cohort (proof the math closes)

One campaign, **885 enrolled leads**, run to completion. Every number below derives from the model above and **reconciles exactly**.

### Raw event counts (illustrative but consistent)
- `enrolled`: 885
- `hard_bounce`: 18 (all on step 1 → these 18 never reached `delivered`)
- `soft_bounce`: 9 (all recovered on retry → those leads continued; not terminal)
- `contacted` (≥1 delivered): 885 − 18 = **867**
- `human_reply` (distinct leads): 72
 - sentiment positive: 28
 - sentiment neutral: 19
 - sentiment negative: 25 (all of these also fired `unsubscribe`)
- `unsubscribe` (distinct leads): 40 (25 via reply + 15 via link)
- `meeting_booked`: 17 (a subset of the 28 positive repliers)

### Terminal outcome breakdown (mutually exclusive - MUST sum to 885)

| Terminal state | Count | How derived |
|---------------|------:|-------------|
| `UNSUBSCRIBED` | 40 | all unsubscribes (precedence over replied) |
| `BOUNCED` | 18 | hard bounces |
| `REPLIED` (engaged) | 47 | 72 human-repliers − 25 who unsubscribed |
| `COMPLETED` (→ cold storage) | 780 | 885 − 40 − 18 − 47 |
| **TOTAL** | **885** | ✓ closes exactly |

Engaged repliers (47) = 28 positive + 19 neutral. The 25 negative repliers are in `UNSUBSCRIBED`, not here.

### Rates (event-based - do NOT need to sum)

| Metric | Calculation | Value |
|--------|-------------|------:|
| Reply rate | 72 ÷ 867 | **8.3%** |
| Positive reply rate | 28 ÷ 867 | **3.2%** |
| Unsubscribe rate | 40 ÷ 867 | **4.6%** |
| Hard-bounce rate | 18 ÷ 885 sent | **2.0%** |
| Meetings booked | absolute | **17** |
| Meetings per 100 | 17 ÷ 867 × 100 | **2.0** |

Note the reply rate (8.3%) is *higher* than positive + neutral engaged (47/867 = 5.4%) precisely because it includes the 25 negative "remove me" replies. That overlap is correct and intended - it's the difference between "how many humans wrote back" and "how many were interested."

### Mid-campaign snapshot (Day 34, cumulative-to-date - also consistent)
At 600 contacted so far: 40 human replies (18 positive), 12 meetings.
- Reply rate: 40 ÷ 600 = 6.7% (rising toward the final 8.3% as follow-ups land)
- Positive rate: 18 ÷ 600 = 3.0%
- Meetings per 100: 12 ÷ 600 × 100 = 2.0

These are cumulative partials of the same run - they trend toward the final numbers instead of contradicting them.

---

## Part 11 - The corrected bounce auto-pause example

The old alert was internally incoherent (3 bounces in 10 sends can't be 4.1% over 50). Corrected, coherent version:

- Rule: pause if hard-bounce rate > **4%** over last 50 sends, OR 3+ hard bounces in any 10-send span.
- Mailbox has sent **55**. In the **last 10 sends: 3 hard bounces** → absolute trigger fires.
- Over the **last 50 sends: 4 hard bounces = 8%** → also over the 4% threshold.
- Both conditions agree; the absolute trigger simply fired first. **8%, not 4.1%.** Now coherent.

Standardized threshold everywhere: **4%** hard-bounce (not "3%" in one place and "4%" in another).

---

## Part 12 - Open decisions [ALL FINALIZED]

Four genuine product decisions the spec made defaults for. All four are now confirmed:

1. **Unsubscribe counts as a reply** - CONFIRMED (yes, because a human wrote it).
2. **Hosting: always-on VPS** - CONFIRMED.
3. **Unsubscribe mechanism: plain-text "reply STOP"** - CONFIRMED (not a tracked link).
4. **Sentiment tagging: human one-click, optional LLM pre-suggestion** - CONFIRMED.

This spec is complete and is the direct blueprint for the database schema (tables map almost 1:1 to Parts 2-3).

---

## The one-paragraph summary

The system rests on an **append-only event log** (Part 2); each lead sits in exactly one **state** driven by those events (Part 3), with a strict **precedence rule** (UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED) that guarantees terminal outcomes are mutually exclusive and always sum to the total. **Rates are computed over events and may overlap** - which is why a "remove me" lead correctly counts toward both reply rate and unsubscribe rate without breaking any tally. Every metric has a defined numerator and denominator (Part 5); reply detection is real, header-based, and separates humans from auto-responders and bounces (Part 6); the scheduler degrades gracefully and never bursts (Part 7); compliance and failure states are first-class features (Parts 8-9). The worked 885-lead cohort (Part 10) proves the math closes exactly. All four open decisions are now finalized (Part 12).