# Cold Email Campaign - Detailed End-to-End Walkthrough (v2)

**A screen-by-screen, day-by-day account of a freelancer running a complete cold email campaign through the dashboard. This documents exactly what the user sees, clicks, reads, and decides at every stage - so the finished product is fully understood before architecture begins.**

> **What changed in v2:**
> 1. **Leads are re-tiered by likelihood-to-close, not company size.** Big companies are deprioritized until there's proof; best-fit small/mid firms get the most effort.
> 2. **Two personalization modes, not three** - "human-written" vs. "template-filled" - because the old Tier 1 / Tier 2 distinction was blurry.
> 3. **The bounce auto-pause rule is fixed** - a minimum-sample gate, hard-bounce-only logic, and a rolling window replace the naive "1 of 6 = 17%" trigger.
> 4. **Five new metrics added throughout:** positive reply rate, meetings booked (conversion), hard/soft bounce split, unsubscribe rate, and per-mailbox volume over time.
>
> **Companion document:** all numbers here now derive from the **Event Model & State Machine spec** - the single source of truth that defines every event, lead state, and metric formula, and proves the 885-lead math closes exactly. Read that spec alongside this walkthrough; where a number appears here, its derivation lives there.
>
> **[NOTE: the four open decisions referenced throughout this document are now FINALIZED: unsubscribe counts as both a reply and unsubscribe event; hosting is an always-on VPS; unsubscribe mechanism is plain-text "reply STOP"; sentiment tagging is one-click human with optional AI suggestion. Screens below should be read with these as settled, not pending.]**

---

## Table of contents

1. The person, the goal, the constraints
2. The dashboard's screens
3. Stage 0 - Onboarding & mailbox setup
4. Stage 1 - Importing & cleaning the list
5. Stage 2 - Tiering by likelihood-to-close (corrected)
6. Stage 3 - Manual validation phase
7. Stage 4 - Building the sequence & the two personalization modes (corrected)
8. Stage 5 - Semi-automated ramp
9. Stage 6 - Handling replies (+ positive reply rate & meetings)
10. Stage 7 - Handling bounces & the fixed auto-pause rule (corrected)
11. Stage 8 - Full-volume daily rhythm
12. Stage 9 - Full pass completes: recycle vs. fresh
13. Stage 10 - Continuous analytics & optimization
14. The complete lifecycle timeline
15. Reference: every metric the dashboard tracks

---

## 1. The person, the goal, the constraints

**Arjun** is a freelancer selling **AI automation to US real estate businesses** - systems that answer inbound leads instantly, auto-generate listing content, and follow up with cold leads automatically.

| Attribute | Value |
|-----------|-------|
| Leads | 1,000 scraped (real estate owners/brokers/managers, US) |
| Social proof | **None** - no testimonials, no case studies, only personal projects |
| Mailboxes | 4, already warmed, on secondary domains |
| Main domain | Never used for cold outreach |
| Metrics tracked | Reply rate, **positive reply rate**, **meetings booked**, bounce rate (**hard/soft split**), **unsubscribe rate**, **per-mailbox volume** |
| Edge | Sells AI automation → can *demonstrate* value with a Loom instead of citing proof |
| Hosting | Always-on VPS (finalized) |

**The stage-defining fact:** Arjun's #1 goal is landing his **first 1-3 clients**. That single fact drives the biggest change in v2 - who he prioritizes.

---

## 2. The dashboard's screens

```
┌──────────────────────────────────────────────────────────────┐
│  COLD EMAIL DASHBOARD                          arjun@arjun.dev│
├──────────────────────────────────────────────────────────────┤
│  📊 Overview     ← reply% / positive% / meetings / bounce%    │
│  📥 Leads        ← the 1,000; filter by tier/status           │
│  📧 Mailboxes    ← the 4 accounts; health, caps, volume trend │
│  ✍️  Sequences    ← build steps, merge tags, spintax, A/Z      │
│  🚀 Campaigns    ← enroll leads, capacity meter, progress     │
│  💬 Unibox       ← every reply; tag sentiment, book meetings   │
│  📈 Analytics    ← per-variant / per-step / per-tier tables    │
│  ♻️  Cold Storage ← non-repliers held for recycling            │
│  ⚙️  Settings     ← send windows, bounce rules, thresholds     │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Stage 0 - Onboarding & mailbox setup (Day 0)

Arjun opens **📧 Mailboxes** → **+ Add Mailbox**:

```
┌─ Add Mailbox ────────────────────────────────┐
│ Display name:   Arjun (AI Automations)       │
│ From address:   arjun@getarjun.com           │
│ SMTP host:      smtp.gmail.com    Port: 587  │
│ IMAP host:      imap.gmail.com    Port: 993  │
│ Auth:           [App Password ▼]             │
│ Password:       ••••••••••••••••             │
│ Daily cap:      30                           │
│ Send window:    Mon-Fri, 8:00-17:00 (recip.) │
│         [ Test Connection ]  [ Save ]        │
└──────────────────────────────────────────────┘
```

**Test Connection** sends a test email via SMTP and reads it back via IMAP: **✅ SMTP OK · ✅ IMAP OK · round-trip 4.2s**. He repeats for all 4. The screen now shows:

```
MAILBOX                    STATUS    SENT TODAY   CAP   HARD-BNC%
────────────────────────────────────────────────────────────────
arjun@getarjun.com          🟢 OK        0 / 30    30    0.0%
arjun@arjun-ai.com          🟢 OK        0 / 30    30    0.0%
arjun@arjunautomations.com  🟢 OK        0 / 30    30    0.0%
arjun@hello-arjun.com       🟢 OK        0 / 30    30    0.0%
────────────────────────────────────────────────────────────────
TOTAL DAILY CAPACITY: 120 sends/day (openers + follow-ups)
```

Note the column is now **HARD-BNC%** - the fixed bounce logic (Stage 7) evaluates hard bounces, not all bounces.

In **⚙️ Settings**, the automated rules - now with the corrected bounce logic:

```
DELIVERABILITY RULES
─────────────────────────────────────────────────────────────
□ Stop sequence immediately on reply             [ON]
□ Stop sequence immediately on hard bounce       [ON]
□ Retry soft bounces up to 2x, then stop         [ON]
□ Suppress unsubscribes permanently              [ON]
□ Never send outside send window                 [ON]

BOUNCE AUTO-PAUSE (corrected - see Stage 7)
─────────────────────────────────────────────────────────────
□ Minimum sends before % rule applies:   25   ← sample gate
□ Pause if HARD-bounce rate > 4% over last 50 sends  [ON]
□ Absolute trigger: pause if 3+ hard bounces in any
  10-send span (works even at low volume)         [ON]
□ Resume paused mailbox at 50% of prior cap        [ON]
```

---

## 4. Stage 1 - Importing & cleaning the list (Day 0)

**📥 Leads → Import CSV.** On upload, automatic hygiene runs *before* committing:

```
┌─ Import Preview: real_estate_leads.csv ──────────────────┐
│  Rows in file:                        1,000              │
│                                                          │
│  ⚠️  Issues detected:                                     │
│    • Role-based (info@, sales@):              60         │
│    • Invalid / malformed:                     40         │
│    • Duplicates:                              15         │
│    • Missing first_name:                      82         │
│                                                          │
│  ✅ Clean & ready to import:                   885        │
│                                                          │
│  Role-based + invalid bounce more and rarely convert.    │
│  Dropping them protects your bounce rate and reputation. │
│                                                          │
│  [ Drop flagged & import 885 ]  [ Import all 1,000 ]     │
└──────────────────────────────────────────────────────────┘
```

He clicks **Drop flagged & import 885**. The 82 missing first names stay - they'll use `{{first_name|there}}`.

---

## 5. Stage 2 - Tiering by likelihood-to-close (CORRECTED)

**This is the biggest change in v2.** The old plan tiered by company size and told Arjun to spend his best effort on the *biggest* brokerages (old "Tier 1"). That was wrong for his stage. Here's the corrected thinking, shown as an in-dashboard note:

```
┌─ 💡 How to prioritize when you have NO proof yet ────────┐
│                                                          │
│ Your goal right now = land your FIRST 1-3 clients.       │
│                                                          │
│ Big brokerages have gatekeepers, procurement, long       │
│ cycles, and will ask "who else have you done this for?"  │
│ - a question you can't answer yet.                       │
│                                                          │
│ Owner-operated small/mid firms are better FIRST clients: │
│  • the owner IS the decision-maker                       │
│  • they move fast                                        │
│  • they care "does it work?" not "where's your logo wall"│
│                                                          │
│ → Tier by LIKELIHOOD-TO-CLOSE, not company size.         │
│ → Sweet spot: big enough to feel the pain & afford the   │
│   fix, small enough that the owner decides. Not micro,   │
│   not enterprise.                                        │
│ → Park big names in "Nurture later - once I have proof." │
└──────────────────────────────────────────────────────────┘
```

### The corrected tiers (by likelihood-to-close)

Arjun re-sorts his 885 leads:

```
┌─ Leads ──────────────────────────── Filter ▼  Bulk Tag ▼ ─┐
│ TIER DISTRIBUTION (by likelihood-to-close)                │
│ ──────────────────────────────────────────────           │
│ 🟢 Tier A  best-fit, reachable, fast     260  (29%)      │
│ 🟡 Tier B  decent fit                    455  (51%)      │
│ ⚪ Tier C  long shots / thin data        120  (14%)      │
│ 🔵 Nurture big names (park for later)     50   (6%)      │
│ ──────────────────────────────────────────────           │
│ TOTAL                                    885              │
└───────────────────────────────────────────────────────────┘
```

| Tier | Who they are | Why this priority |
|------|-------------|-------------------|
| 🟢 **Tier A** | Owner-operated small/mid firms with a visible automation gap and a reachable decision-maker | **Most likely to become client #1** - gets the most effort |
| 🟡 **Tier B** | Solid-fit firms, decent data | Good personalization, standard sequence |
| ⚪ **Tier C** | Thin data or borderline fit | Lighter touch, lower priority |
| 🔵 **Nurture** | Big brokerages / enterprise | **Parked.** Revisit once he has 2-3 real results to cite - *then* they're worth the effort because he can finally answer the gatekeeper question |

**Key principle carried through the whole doc:** tiers are a **time-rationing tool**, not a "who deserves personalization" judgment. Early on, when volume is low, *everyone* can get real personalization. Tiers only decide *who gets Arjun's scarce hand-writing time first* once he's sending 100+/day and can't hand-write them all.

> **[Open judgment call - intentionally deferred]:** Should Tier A's strong conversion performance eventually push Arjun to shift *more* effort into human-written Mode 1 and shrink the automated Tier C tier? This is left exactly as-is for now. Revisit once real campaign data shows how the system performs in practice.

---

## 6. Stage 3 - Manual validation phase (Days 1-10)

**Goal: learn what message makes a real estate owner reply. Do NOT scale yet.**

Banner:
> 💡 **Validation phase.** Send 25-40 hand-written emails to your best-fit (Tier A) leads first. Don't automate until a batch clears ~5% reply rate - and watch **positive** replies, not just any reply. You're spending your best leads to learn your winning angle.

### Day 1 - 25 hand-written Tier-A emails

A Tier-A lead profile with the manual composer:

```
┌─ Lead: Danielle Cortez ──────────────────────────────────┐
│ Company:  Cortez & Vale Realty (Austin, TX) · ~12 agents │
│ Email:    danielle@cortezvale.com                        │
│ Tier:     🟢 Tier A (owner-operated, clear gap)          │
│ Notes:    Owner runs the office. Contact form, no        │
│           auto-responder. Listings updated daily.        │
│                                                          │
│ ── Manual Compose ──────────────────────────────         │
│ Mailbox (auto-rotated): arjun@getarjun.com               │
│ Subject: quick question, Cortez & Vale                   │
│                                                          │
│ Hi Danielle -                                            │
│ went through cortezvale.com - inquiries come in via your │
│ contact form but there's no instant reply. In Austin's   │
│ market that's hours of dead time on a hot lead.          │
│                                                          │
│ I build AI systems that reply to every inbound lead in   │
│ under a minute, 24/7, and book the showing automatically.│
│                                                          │
│ Worth me sending a 2-min video of how it'd work for you? │
│ - Arjun                                                  │
│           [ Send & log as manual ]                       │
└──────────────────────────────────────────────────────────┘
```

The dashboard auto-rotates mailboxes, logs each as `sent`, spaces them across the window.

### Days 2-10 - replies, judged by SENTIMENT not just count

By Day 10:

```
┌─ Overview: Validation Batch ─────────────────────────────┐
│  Sent:              25                                   │
│  Bounced:            1   (hard: 1, soft: 0) = 4.0%       │
│  Replied:            3   (12.0%)                         │
│  ├ 🟢 Positive:      2   → POSITIVE RATE 8.0%            │
│  ├ ⚪ Neutral:       1   ("not right now")               │
│  └ 🔴 Negative:      0                                   │
│  Meetings booked:    1   → 4.0% of sent                 │
└──────────────────────────────────────────────────────────┘
```

**Why positive rate matters here:** 12% reply rate looks great, but the number that tells him the *offer* works is the **8% positive rate** and the **1 booked meeting**. A batch could hit 12% replies that are all "remove me" - that would be a failing campaign wearing a passing number. The speed-to-lead angle produced both positives → that's his winner.

He sends the interested leads a Loom (proof-by-demonstration, replacing case studies).

---

## 7. Stage 4 - Building the sequence & the two personalization modes (CORRECTED)

Offer validated. Arjun builds the reusable sequence in **✍️ Sequences**.

### The sequence (4 steps, later trimmed by analytics)

```
┌─ Sequence: "RE Speed-to-Lead v1" ────────────────────────┐
│ STEP 1 - Opener            Wait: 0 days   [in-thread ✓]  │
│ STEP 2 - Value drop (Loom) Wait: 3 days   [in-thread ✓]  │
│ STEP 3 - Nudge             Wait: 4 days   [in-thread ✓]  │
│ STEP 4 - Breakup           Wait: 5 days   [in-thread ✓]  │
│ Stop conditions: reply ✓  hard bounce ✓  unsubscribe ✓  │
└──────────────────────────────────────────────────────────┘
```

### The opener (merge tags + spintax)

```
Subject: {{RANDOM|quick question|quick idea}} about {{company|your team}}'s inbound leads

{{RANDOM|Hi|Hey|Hello}} {{first_name|there}} - 
{{RANDOM|noticed|saw}} {{custom_observation|your listings move fast in your market}}.

Most {{market|US}} brokers I talk to lose leads because inbound
inquiries sit for hours before anyone replies. I build AI systems
that respond to every lead in under a minute, 24/7.

{{RANDOM|Worth me sending|Happy to send}} a 2-min video of how it'd
work for {{company|your team}}?
 -  Arjun

---
{{sender_physical_address}}
Don't want future emails? Reply STOP and I'll remove you immediately.
```

**[NEW - CAN-SPAM compliance footer, now shown]:** every email template includes a plain-text footer with a real physical mailing address and a "reply STOP" opt-out instruction - no tracked link (protects deliverability, satisfies the law). This footer is baked into every step of every sequence and cannot be removed by the user; the Sequence Builder appends it automatically at save time.

### The two personalization modes (CORRECTED)

The old doc had three tiers that filled `{{custom_observation}}` in confusingly similar ways - the old "Tier 1" and "Tier 2" were both "a human researches and writes a specific detail," which made them nearly identical. **v2 collapses this into two clear modes based on *how templated the email is*:**

```
┌─ Personalization Mode ───────────────────────────────────┐
│                                                          │
│ MODE 1 - HUMAN-WRITTEN  (fully bespoke)                  │
│   The WHOLE email is custom: structure, framing, CTA,    │
│   sometimes a Loom recorded for that specific company.   │
│   The template is just a starting point he deviates from.│
│   ~10-15 min each. Used for: Tier A (his best-fit leads).│
│                                                          │
│ MODE 2 - TEMPLATE-FILLED  (fixed skeleton + slots)       │
│   The email skeleton is identical for everyone. Only the │
│   variable slots change. Two sub-flavors:                │
│    • researched slot: a human fills {{custom_observation}}│
│      with a real detail (~2-3 min). Used for Tier B.     │
│    • auto slot: {{custom_observation}} falls back to a   │
│      segment rule by market (~0 min). Used for Tier C.   │
│                                                          │
│ → Only TWO real modes: "I wrote this" vs "the system     │
│   filled it in." No blurry middle tier.                  │
└──────────────────────────────────────────────────────────┘
```

So the mapping is now clean:

| Tier | Personalization mode | Effort |
|------|---------------------|--------|
| 🟢 Tier A | **Mode 1 - human-written** (whole email bespoke) | 10-15 min |
| 🟡 Tier B | **Mode 2 - template-filled, researched slot** | 2-3 min |
| ⚪ Tier C | **Mode 2 - template-filled, auto slot** | ~0 min |

The distinction that was missing before: **Mode 1 rewrites the entire email; Mode 2 keeps a fixed skeleton and only swaps variables.** That's a real, buildable difference - not the vague "spend a bit less time" the old doc implied.

### Preview & pre-send checks

```
┌─ Preview: as seen by "Marcus Webb, Webb Realty (Miami)" ─┐
│ Subject: quick idea about Webb Realty's inbound leads    │
│ Hey Marcus - saw your team lists 30+ new Miami           │
│ properties a month...                                    │
│                                                          │
│ ...                                                       │
│ ---                                                       │
│ Arjun's AI Automations, 447 Oak Street, Austin, TX 78701  │
│ Don't want future emails? Reply STOP and I'll remove you  │
│ immediately.                                              │
│                                                          │
│ ── Pre-send checks ──────────────────────────            │
│ ✅ All merge tags have fallbacks                         │
│ ✅ Spintax renders valid (24 unique variations)          │
│ ✅ Plain text, no images, no links in step 1             │
│ ✅ CAN-SPAM footer present (address + opt-out)           │
│ 📊 Deliverability score: 9.1 / 10                        │
│    [ Send test to myself ]   [ Save sequence ]           │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Stage 5 - Semi-automated ramp (Days 13-20)

**🚀 Campaigns → New Campaign "RE Pass 1".** The capacity meter governs enrollment:

```
┌─ Capacity Today (Day 13) ────────────────────────────────┐
│  Total daily capacity:            120 sends              │
│  Follow-ups scheduled today:        0 sends              │
│  Room for NEW openers today:      120 sends              │
│  ⚠️  Ramp week: cap new enrollments at 20/day.           │
│  Suggested new enrollments:        20                    │
│  Enroll from: [🟢 Tier A first ▼]                        │
│         [ Enroll next 20 leads ]                         │
└──────────────────────────────────────────────────────────┘
```

By Day 20, follow-ups eat into capacity:

```
┌─ Capacity Today (Day 20) ────────────────────────────────┐
│  Total daily capacity:            120 sends              │
│  Follow-ups scheduled today:       68 sends  ← growing   │
│  Room for NEW openers today:       52 sends              │
│  Suggested new enrollments:        30                    │
└──────────────────────────────────────────────────────────┘
```

The scheduler now runs autonomously: checks who's due, round-robin assigns a mailbox (skipping any at cap), sends in-window, threads follow-ups.

**[NEW - missed-day / catch-up behavior, now shown]:** if the VPS scheduler was ever offline (deployment, restart, outage) and sends piled up, it does **not** burst to clear the backlog on restart:

```
┌─ ⚠️ Scheduler Resumed After Downtime ────────────────────┐
│ System was offline 14 hours (last run: Day 19, 11:40pm). │
│ 22 sends were due during downtime.                        │
│                                                          │
│ Per safety rule: NOT bursting these now - that's a spam  │
│ signal. Instead:                                          │
│  • Overdue sends queued oldest-first, at normal daily cap │
│  • Remainder rolls to tomorrow                            │
│  • Sequence timing shifts later, not compressed           │
│                                                          │
│ Today's capacity unaffected: still 120 sends/day max.    │
│                    [ Acknowledge ]                        │
└──────────────────────────────────────────────────────────┘
```

Since Arjun runs on an always-on VPS (finalized decision), this screen should rarely appear in practice - it exists as a safety net, not a normal occurrence.

---

## 9. Stage 6 - Handling replies (+ positive reply rate & meetings booked)

The IMAP poller detects replies continuously. **[NEW - reply classification logic, now shown]:** every incoming message is sorted into one of four buckets before anything else happens:

```
┌─ ⚙️ How the IMAP Poller Classifies Incoming Mail ────────┐
│                                                          │
│ 1. BOUNCE - from MAILER-DAEMON/postmaster, or a          │
│    delivery-status message. Status 5.x.x → hard_bounce.  │
│    Status 4.x.x → soft_bounce.                            │
│                                                          │
│ 2. AUTO-REPLY / OOO - has "Auto-Submitted: auto-replied"  │
│    header, or subject matches "out of office" patterns.  │
│    Logged as auto_reply. Does NOT stop the sequence -     │
│    they haven't actually engaged yet.                     │
│                                                          │
│ 3. HUMAN REPLY - threads to a sent Message-ID via         │
│    In-Reply-To/References headers (NOT subject-line       │
│    matching, which breaks on forwards/edits). Fires       │
│    human_reply. STOPS the sequence immediately.           │
│                                                          │
│ 4. UNRELATED - doesn't thread to anything sent. Ignored.  │
└──────────────────────────────────────────────────────────┘
```

This runs silently in the background - Arjun only ever sees the results (bucket 3, surfaced in the Unibox below). On a reply, the dashboard flips status → **Replied**, cancels remaining steps, and surfaces it in **💬 Unibox**. **The Unibox is where two of the five new metrics get captured** - with one click each.

```
┌─ 💬 Unibox ──────────────────── 4 mailboxes, one feed ───┐
│ FILTER: [ All ▼ ] [🟢 Positive][⚪ Neutral][🔴 Neg]      │
│                                                          │
│ Marcus Webb - Webb Realty              2m ago            │
│ "Yeah we have this problem. What's setup + cost?"        │
│ ↳ sequence auto-stopped ✓                                │
│    Suggested tag: 🟢 Positive (AI-assisted)  [confirm ▼] │
│    Tag: [🟢 Positive ✓] [⚪][🔴]   ← 1-click, human final│
│    [ 📅 Mark meeting booked ]      ← 1-click conversion  │
│                                                          │
│ Priya Nair - Nair Group                18m ago           │
│ "Not right now, reach back in Q3."                       │
│    Suggested tag: ⚪ Neutral (AI-assisted)  [confirm ▼]  │
│    Tag: [🟢][⚪ Neutral ✓][🔴]     [ Snooze to Q3 ]      │
│                                                          │
│ Tom Fisher - Fisher Homes              1h ago            │
│ "Remove me."                                             │
│    Tag: [🔴 Negative ✓]  → auto-unsubscribed ✓           │
│    Fires BOTH events: human_reply (negative) AND         │
│    unsubscribe. Terminal state = UNSUBSCRIBED (wins).    │
│    Counts toward reply rate AND unsubscribe rate.        │
└──────────────────────────────────────────────────────────┘
```

**[Sentiment tagging - finalized]:** the AI suggests a sentiment tag based on the reply text, shown greyed-out as a starting point, but Arjun always makes the final one-click confirmation. This keeps accuracy high and cost at zero (no dependency on the AI being right, since a human always confirms).

**Metric #1 - Positive reply rate.** Every reply gets a one-click sentiment tag (positive/neutral/negative). The dashboard derives positive rate = positive replies ÷ contacted. This is the single most valuable addition: "remove me" and "send pricing" both count as replies, but only one matters. Positive rate tells Arjun whether he's attracting the *right* interest, not just any reaction. **Cost: zero** - it's a label on data he's already handling.

**Metric #2 - Meetings booked (conversion).** When a conversation turns into a call, Arjun clicks **📅 Mark meeting booked** on that lead. The dashboard computes **meetings per 100 emails sent**, sliceable by tier and by angle. This is the metric that pays rent - reply rate can look great while nothing converts. **Cost: zero** - it's a status field.

**[NEW - auto-reply / OOO handling shown]:** if a lead's inbox sends an out-of-office instead of a real reply, the Unibox shows it separately and does not stop the sequence:

```
┌─ 💬 Unibox - Auto-Replies (separate tab) ────────────────┐
│ Sarah Kim - Kim Realty Group            3h ago            │
│ ⚙️ Auto-reply detected: "I'm out of office until..."      │
│    NOT counted as a reply. Sequence continues normally.   │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Stage 7 - Handling bounces & the FIXED auto-pause rule (CORRECTED)

The old rule - "pause any mailbox over 3% bounce rate" - was broken at low volume. **1 bounce out of 6 sends = 17%**, which looks catastrophic but tells you nothing; a single stale scraped address does that. Judging an inbox on 6 emails is statistically meaningless. Here's the corrected logic.

### The three-part fixed rule

```
┌─ ⚙️ Bounce Auto-Pause Logic (fixed) ─────────────────────┐
│                                                          │
│ 1. SAMPLE GATE                                           │
│    The percentage rule does NOT apply until a mailbox    │
│    has sent at least 25 emails. Below that, a bad early  │
│    batch can't falsely trip a pause.                     │
│                                                          │
│ 2. HARD-BOUNCE-ONLY, ROLLING WINDOW                      │
│    Once past 25 sends: pause if HARD-bounce rate over    │
│    the LAST 50 sends exceeds 4%. Soft bounces (mailbox   │
│    full, temporary) are excluded - they're not a         │
│    reputation threat and are retried up to 2x.           │
│    Rolling window = an inbox that had a rough start      │
│    isn't punished forever once it recovers.              │
│                                                          │
│ 3. ABSOLUTE SAFETY TRIGGER (works even at low volume)    │
│    Pause immediately if 3+ HARD bounces occur in any     │
│    10-send span - regardless of percentage or sample.    │
│    Rationale: 3 "address doesn't exist" in a row = a bad │
│    data batch worth stopping for, even at low volume.    │
└──────────────────────────────────────────────────────────┘
```

### Why hard vs. soft matters here (Metric #3)

**Metric #3 - Hard/soft bounce split.** Arjun already detects bounces via IMAP; separating them costs nothing and changes his response:
- **Hard bounce** (address doesn't exist) → bad data → remove the lead immediately, and it's the *only* type that counts toward auto-pause.
- **Soft bounce** (mailbox full, greylisting, temporary) → retryable → retry up to 2x, never counts against the mailbox.

Lumping them together made the old data look worse than reality and would have made Arjun delete recoverable leads. **Cost: zero** - it's a `bounce_type` field on data he's already parsing.

### What it looks like when it fires (correctly this time)

Early on, mailbox 3 had 1 bounce in its first 6 sends. **The old rule would have paused it. The fixed rule does nothing** - sample gate not met (6 < 25). Correct.

Later, at Day 18, mailbox 3 has sent 55 emails and hit its 3rd hard bounce inside a 10-send span (a bad batch of unverified leads got enrolled):

```
┌─ ⚠️ Mailbox Auto-Paused (absolute trigger) ─────────────┐
│ arjun@arjunautomations.com                               │
│ Triggered by: 3 HARD bounces in last 10 sends            │
│ (Rolling hard-bounce rate: 4 in last 50 = 8% - also      │
│  over the 4% threshold; absolute trigger fired first.)   │
│                                                          │
│ Likely cause: unverified batch enrolled Day 17.          │
│ Sends from this mailbox paused to protect the other 3.   │
│  1. Re-verify leads enrolled since Day 17                │
│  2. Remove invalid addresses                             │
│  3. Resume at 50% cap (15/day) once clean                │
│      [ Re-verify now ]   [ Resume at 15/day ]            │
└──────────────────────────────────────────────────────────┘
```

This is now a *meaningful* pause on a *real* signal (3 confirmed dead addresses in a row after 55 sends), not a panic over 1-of-6 noise. Arjun re-verifies, drops 6 bad addresses, resumes at half cap; the mailbox settles under 2% hard-bounce over the next two days.

**[NEW - mailbox failure states beyond bounces, now shown]:** bounces aren't the only way a mailbox can fail. The system also watches for infrastructure-level failures:

```
┌─ 🔴 Mailbox Auth Failed ──────────────────────────────────┐
│ arjun@hello-arjun.com                                     │
│                                                            │
│ Google revoked this app password (or OAuth token expired).│
│ All sends from this mailbox are PAUSED immediately.        │
│                                                            │
│ Its pending leads have been redistributed across the       │
│ other 3 healthy mailboxes (within their daily caps) so     │
│ follow-ups aren't lost.                                    │
│                                                            │
│ To fix: generate a new app password in Google Account      │
│ settings and re-enter it below.                            │
│                                                            │
│ New app password: [________________]                       │
│              [ Reconnect Mailbox ]                          │
└────────────────────────────────────────────────────────────┘
```

```
┌─ ⚠️ IMAP Poll Stale ───────────────────────────────────────┐
│ arjun@arjun-ai.com has not been successfully polled in     │
│ 6 hours (last successful poll: Day 22, 9:14am).             │
│                                                            │
│ Risk: replies to this mailbox may be sitting undetected,   │
│ and sequences could keep sending to leads who already       │
│ replied.                                                     │
│                                                            │
│ Sends from this mailbox are PAUSED until polling resumes.   │
│              [ Retry connection now ]                       │
└────────────────────────────────────────────────────────────┘
```

Note the important distinction in how redistribution works: for an **auth failure**, pending *new* sends move to healthy mailboxes. But for a mailbox with **active in-flight threads** (a lead mid-sequence who already got step 1 from that mailbox), those threads are **not** rerouted to a different mailbox - doing so would break the reply-threading (a follow-up from a different address looks like spam, and In-Reply-To matching gets confused). Those leads simply wait for that specific mailbox to be reconnected.

---

## 11. Stage 8 - Full-volume daily rhythm (Days 21-49)

Every morning, the Overview - now carrying the new metrics:

```
┌─ 📊 Overview - RE Pass 1 ──────────────── Day 34 ────────┐
│  PROGRESS                                                │
│  ████████████████░░░░░░░  612 / 885 contacted (69%)      │
│  Est. full pass complete in 9 days                       │
│                                                          │
│  CORE METRICS (cumulative, 600 contacted so far)        │
│  Reply rate:        6.7%   ▲ rising toward final 8.3%   │
│  Positive rate:     3.0%   ← the one that signals fit   │
│  Meetings booked:   12     (2.0 per 100 sent)           │
│  Hard-bounce rate:  1.9%   ✅ under 4% threshold         │
│  Unsubscribe rate:  3.8%   ← watch (climbing)            │
│                                                          │
│  TODAY                                                   │
│  Follow-ups scheduled:   74                              │
│  Room for new openers:   46                              │
│  Suggested enrollments:  32                              │
│         [ Enroll next 32 leads ]                         │
└──────────────────────────────────────────────────────────┘
```

**Contact-priority logic** (who "next 32" is), now tier-A-first:

```
1. Follow-ups ALWAYS run first (already counted above)
2. Among NEW leads:  🟢 Tier A → 🟡 Tier B → ⚪ Tier C
   (🔵 Nurture/big names are NOT auto-enrolled - parked)
3. Within a tier: oldest-uploaded first
```

**Metric #5 - Per-mailbox volume over time.** The Mailboxes screen now shows a volume trend, catching rotation imbalance:

```
MAILBOX                    SENT TODAY   7-DAY AVG   HARD-BNC%
──────────────────────────────────────────────────────────────
arjun@getarjun.com          28 / 30       27.4        1.4%
arjun@arjun-ai.com          30 / 30       29.1        0.8%   ← doing more
arjun@arjunautomations.com  22 / 30       18.2        1.9%   ← lagging (was paused)
arjun@hello-arjun.com       27 / 30       26.8        1.2%
──────────────────────────────────────────────────────────────
⚠️  Rotation imbalance: mailbox 2 running ~60% hotter than
    mailbox 3. Rebalance so no single inbox carries the load.
```

This is a **free byproduct** of the daily-cap counter he already keeps - logging it over time reveals imbalance and shows true throughput. **Cost: zero.**

---

## 12. Stage 9 - Full pass completes: recycle vs. fresh (Day ~49)

Progress hits **885 / 885**. Outcome breakdown:

```
┌─ 📊 RE Pass 1 - COMPLETE ────────────────────────────────┐
│  TERMINAL OUTCOMES (mutually exclusive - sum to 885)    │
│  ⛔ Unsubscribed (suppressed):       40                  │
│  🔴 Bounced - hard (removed):        18                  │
│  🟢 Replied / engaged:               47                  │
│      ├ 🟢 Positive:      28                              │
│      └ ⚪ Neutral:       19                              │
│  ⚪ Completed, ZERO reply:           780                 │
│  ─────────────────────────────────────────              │
│  TOTAL                               885   ✓            │
│                                                          │
│  RATES (event-based - may overlap, don't sum)           │
│  Reply rate:        72 / 867 contacted = 8.3%           │
│    (incl. 25 "remove me" replies that also unsub'd)     │
│  Positive rate:     28 / 867          = 3.2%           │
│  Unsubscribe rate:  40 / 867          = 4.6%           │
│  Hard-bounce rate:  18 / 885 sent     = 2.0%           │
│  📅 Meetings booked: 17               = 2.0 per 100     │
│  (9 soft bounces occurred + recovered - not terminal)   │
│                                                          │
│  → 780 non-repliers → ♻️ Cold Storage                   │
│  → 58 permanently removed (40 unsub + 18 hard bounce)   │
│  [ Recycle cold storage (60-day rest) ]                 │
│  [ Import fresh leads → new campaign ]                  │
└──────────────────────────────────────────────────────────┘
```

### Discarded ≠ deleted

The 780 non-repliers are **not thrown away** - they didn't bite on *angle #1*, but they're valid businesses held in **♻️ Cold Storage** (a holding pen, not a trash can). Only the **58 permanently removed** (40 unsubscribes + 18 hard bounces) are gone for good; re-contacting those would burn reputation. Note the two kinds of number here: the **terminal outcomes** (40 + 18 + 47 + 780) sum exactly to 885, while the **rates** above are event-based and overlap on purpose - the 25 "remove me" leads count toward both reply rate and unsubscribe rate. (Full model: see the Event Model & State Machine spec.)

### The dashboard's guidance

```
┌─ ♻️ Cold Storage - 780 leads ────────────────────────────┐
│ 💡 US real estate AI is a LARGE market.                 │
│    → Hit everyone once, recycle after 60-90 days with a  │
│      DIFFERENT angle. (Small markets need longer         │
│      sequences instead - not your situation.)            │
│    ⚠️  Do NOT resend the same emails. Same leads, fresh  │
│       message, fresh subject line.                       │
│    Earliest recycle: Day 109.                            │
│    Pass 1 = speed-to-lead ✓ done                        │
│    Pass 2 = listing/marketing automation ← queued       │
└──────────────────────────────────────────────────────────┘
```

### What Arjun does - BOTH in parallel

- **Path A - Recycle (Day ~109):** the 780 cold-storage leads → a **Pass 2** campaign with a **new angle** (listing/marketing automation). Tagged "Recycled - Pass 2"; the dashboard *never* sends a lead the identical email twice.
- **Path B - Fresh leads (now):** knowing his winning angle, he scrapes **1,000 new leads** and runs them through the proven "RE Speed-to-Lead v1" immediately - no re-validation.

**The answer to the recycle-vs-fresh question: he does both.** Recycle old non-repliers on a 60-90 day cycle with new angles, *and* feed fresh leads to keep the funnel full. The dashboard guarantees no dead lead is re-contacted and no message is double-sent.

---

## 13. Stage 10 - Continuous analytics & optimization

**📈 Analytics** is where Arjun turns data into decisions. Every table below is now judged on **positive rate and meetings**, not raw replies.

### 13a - Variant comparison (now ranked by positive rate + meetings)

```
┌─ 📈 Variant Comparison - Opener ─────────────────────────┐
│ VARIANT   SUBJECT              SENT  REPLY  POS.  MTGS   │
│ ──────────────────────────────────────────────────────  │
│ A  "quick question about        200   5.5%  2.0%   3    │
│     {company}'s inbound leads"                           │
│ B  "{first_name}, losing        200   7.0%  4.0%   8    │
│     leads after hours?"                                  │
│ ──────────────────────────────────────────────────────  │
│ 🏆 Variant B wins - and note it wins BIGGER on positive │
│    rate + meetings (8 vs 3) than on raw reply. That gap  │
│    is what matters: B attracts better-fit interest.      │
│ ⚠️  200/variant is a small sample; trust big gaps, not   │
│    small wobbles. (These 400 leads are the early A/Z     │
│    cohort - a subset of the 867; the 11 meetings here    │
│    are part of the campaign's 17 total.)                 │
│         [ Deactivate A, route all to B ]                 │
└──────────────────────────────────────────────────────────┘
```

The lesson v2 makes explicit: if he'd judged on **reply rate alone** (5.5 vs 7.0), B looks moderately better. Judged on **meetings** (3 vs 8), B is *dramatically* better. The new metrics change the decision.

### 13b - Sequence step analysis (kill the weak step)

```
┌─ 📈 Sequence Analysis - RE Speed-to-Lead v1 ─────────────┐
│ STEP              DELIV.  POS-REPLIES   POS%   VERDICT   │
│ ──────────────────────────────────────────────────────  │
│ 1 - Opener        867       15        1.7%   ✅ strong   │
│ 2 - Value (Loom)  612        9        1.5%   ✅ converts │
│ 3 - Nudge         540        1        0.2%   ⚠️ WEAK     │
│ 4 - Breakup       498        3        0.6%   ✅ keep     │
│ ──────────────────────────────────────────────────────  │
│ (positives sum to 28 - matches campaign total ✓)        │
│ 💡 Step 3 positive rate 0.2% is dead weight. Removing it │
│    tightens the sequence without losing real interest.   │
│         [ Remove Step 3 from sequence ]                  │
└──────────────────────────────────────────────────────────┘
```

He removes Step 3 (4 steps → 3). Discipline: **kill the weak step, don't pile on more follow-ups.**

### 13c - Tier performance (by likelihood-to-close + conversion)

```
┌─ 📈 Tier Performance ────────────────────────────────────┐
│ TIER            CONTACT REPLY  POS%  MTGS  EFFORT MODE   │
│ ──────────────────────────────────────────────────────  │
│ 🟢 Tier A       255   13.0%  8.5%   13   10-15m  human   │
│ 🟡 Tier B       447    7.0%  2.5%    3   2-3m    tmpl    │
│ ⚪ Tier C       165    3.5%  1.2%    1   ~0m     auto    │
│ ──────────────────────────────────────────────────────  │
│ (meetings sum to 17 ✓ · contacted sums to 867 ✓)        │
│ 💡 Insights:                                             │
│  • Tier A (best-fit small/mid) produced 13 of 17         │
│    meetings - nearly ALL conversions. Validates          │
│    tiering by likelihood-to-close, not size.             │
│  • Tier C barely converts; consider recycling those      │
│    with a sharper segment message vs. more effort.       │
│  • 9 Tier-C leads gave a positive/neutral reply →        │
│    promote to Tier B (Mode 2 researched) next pass.      │
│  [ Promote 9 engaged Tier-C → Tier B ]                  │
└──────────────────────────────────────────────────────────┘
```

The corrected tiering *proves itself in the data*: his best-fit small/mid firms (Tier A) drove 13 of 17 meetings - almost every conversion - exactly the outcome the "don't over-prioritize big names" correction predicted.

**[Note - deferred decision, unchanged]:** Tier A's outsized conversion performance here could argue for shifting even more effort toward human-written Mode 1 and shrinking Tier C automation. Per Arjun's decision, this is left as-is for now - the tiering ratios (29% / 51% / 14% / 6%) stay fixed. Revisit once more campaigns' worth of real data exists.

### 13d - Deliverability & health trend (new metrics as early warnings)

```
┌─ 📈 Health Trend (30 days) ──────────────────────────────┐
│ Reply rate:        ▁▂▃▄▅▅▆  6.1%  ✅ up                 │
│ Positive rate:     ▁▂▂▃▃▄▄  3.4%  ✅ up                 │
│ Meetings/100:      ▁▁▂▂▂▃▃  2.3   ✅ up                 │
│ Hard-bounce rate:  ▂▂▁▂▂▁▁  1.6%  ✅ under threshold    │
│ Unsub rate:        ▁▁▂▁▁▁▁  1.1%  ✅ stable             │
│                                                          │
│ ⚠️  Watch rules:                                         │
│  • Reply rate ↓30% over 30 days → message fatiguing /    │
│    list quality dropping → refresh angle or leads.       │
│  • Unsub rate CLIMBING → targeting/message annoying      │
│    people. This often rises BEFORE deliverability        │
│    visibly drops - treat it as an early warning.         │
│ Status: healthy. No action needed.                      │
└──────────────────────────────────────────────────────────┘
```

**Metric #4 - Unsubscribe rate** earns its place here: it's a leading indicator. A climbing unsub rate warns Arjun his targeting or message is irritating people *before* his bounce/reply numbers visibly slip. He's already suppressing unsubs for compliance; tracking the *rate* turns that into a diagnostic. **Cost: zero.**

### The decisions Arjun made this cycle

Using reply rate, **positive rate, meetings, hard/soft bounce split, unsub rate, and per-mailbox volume**:

1. ✅ Kept **Variant B** - won decisively on *meetings*, not just replies.
2. ✅ **Removed dead Step 3** (judged on positive rate).
3. ✅ **Doubled down** on speed-to-lead angle.
4. ✅ **Queued** listing-automation angle for the recycle pass.
5. ✅ **Promoted 9** engaged Tier-C leads to Tier B.
6. ✅ **Confirmed** the re-tiering: Tier A drove 13 of 17 meetings.
7. ✅ **Rebalanced** mailbox rotation (mailbox 2 was overworked).
8. ✅ **Paused + re-verified** mailbox 3 - correctly, on 3 hard bounces after 55 sends, not on early noise.
9. ✅ **Scheduled** cold-storage recycling for Day 109; **launched** a fresh 1,000-lead campaign.

---

## 14. The complete lifecycle timeline

| Days | Phase | Arjun's actions | Dashboard's automations |
|------|-------|-----------------|------------------------|
| **0** | Prep | Connect 4 mailboxes, import + clean (1,000→885), **tier by likelihood-to-close** (A/B/C + park big names) | Test SMTP/IMAP, flag bad addresses, set caps + fixed bounce rules |
| **1-10** | Manual validation | Hand-write 25 Tier-A emails, judge on **positive rate + meetings** | Rotate sends, log events, compute positive rate (8%) |
| **10-12** | Build sequence | 4-step sequence, **two personalization modes** (human-written / template-filled), 2 variants, CAN-SPAM footer | Preview, spam-check, thread follow-ups, auto-append compliance footer |
| **13-20** | Semi-auto ramp | Enroll Tier A at 20/day | Schedule, round-robin, respect caps + windows, never burst on catch-up |
| **ongoing** | Reply handling | Tag sentiment + **book meetings** in Unibox | Classify bounce/auto-reply/human/unrelated, auto-stop sequences, one feed, derive positive rate |
| **ongoing** | Bounce handling | Re-verify on a *real* trigger | **Fixed rule**: sample gate + hard-only + rolling window + absolute trigger |
| **ongoing** | Failure handling | Reconnect auth-failed mailboxes | Detect auth failures / stale polls, pause + redistribute, alert |
| **21-49** | Full volume | Enroll ~32/day, Tier A first | Prioritize follow-ups, track per-mailbox volume, flag imbalance |
| **~49** | Pass complete | Decide recycle + fresh | Sort outcomes, move 780 to cold storage, remove 58 dead |
| **49+** | Optimize & scale | Kill Step 3, keep Variant B, promote leads, launch fresh batch | Per-variant/step/tier analytics on positive rate + meetings |
| **~109** | Recycle | Run cold storage with NEW angle | Tag "Pass 2", guarantee no identical resend |

---

## 15. Reference: every metric the dashboard tracks

All derive from a simple event log (`sent`, `replied` + `sentiment`, `hard_bounce`, `soft_bounce`, `unsubscribed`, `meeting_booked` per lead per step) - **no open tracking, no click tracking, no pixels, no cost.**

| Metric | Numerator ÷ Denominator | New in v2? | Why it matters |
|--------|---------|:---------:|----------------|
| **Reply rate** | human-reply leads ÷ contacted | | Baseline engagement (contacted = ≥1 delivered) |
| **Positive reply rate** | positive-reply leads ÷ contacted | ✅ | Signals *right* interest, not just any reaction - the single most valuable add |
| **Meetings booked / 100** | meetings ÷ contacted × 100 | ✅ | The metric that pays rent; reply rate can lie |
| **Hard-bounce rate** | hard_bounce ÷ sent | ✅ | Remove lead + counts to auto-pause |
| **Soft-bounce rate** | soft_bounce ÷ sent | ✅ | Retry ≤2x; never counts to auto-pause |
| **Unsubscribe rate** | unsubscribe ÷ contacted | ✅ | Leading indicator - climbs *before* deliverability drops |
| **Per-mailbox volume (trend)** | sends per mailbox over time | ✅ | Catches rotation imbalance; shows true throughput |
| **Progress** | contacted ÷ total | | Pass completion |
| **Capacity today** | Σ(caps) − follow-ups due | | Safe new-enrollment number |
| **Step reply rate** | human-reply at step N ÷ delivered at step N | | Kill weak steps |

> **Terminal outcomes vs. rates:** the outcome breakdown (UNSUBSCRIBED / BOUNCED / REPLIED / COMPLETED) is **mutually exclusive and sums to the total**; the rates above are **event-based and may overlap** (a "remove me" lead counts in both reply rate and unsubscribe rate). This is the distinction that makes every number reconcile - see the Event Model & State Machine spec.

Every one of the five additions is a **status field or a label** on data the system already touches - no new infrastructure, no tracking injection, no cost.

---

## The one-paragraph summary

Arjun tiers his leads **by likelihood-to-close, not company size** - putting his best-fit small/mid firms first and parking big names until he has proof. He starts **human-written and personal** to learn his winning angle (judging success by **positive replies and booked meetings**, not raw reply count), then scales that lesson through a **template-filled** sequence across his 885 leads - rotating 4 warmed mailboxes within safe caps, **auto-stopping** on reply or hard bounce, and **auto-pausing** a mailbox only on a *statistically real* bounce signal (sample gate + hard-bounce-only + rolling window), never on early noise. When the pass finishes, non-repliers rest in **cold storage** and return in 60 days with a **fresh angle** while new leads flow through the proven sequence. Six clean, zero-cost metrics - reply rate, positive rate, meetings, hard/soft bounce, unsub rate, per-mailbox volume - let him **kill what fails and double down on what works**, without ever burning a lead or a domain. All four architectural decisions (unsubscribe-as-reply, VPS hosting, plain-text opt-out, human-confirmed sentiment) are finalized, and the system is designed so failure states (auth expiry, stale polling, scheduler downtime) are surfaced, not hidden.