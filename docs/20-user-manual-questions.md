# User Manual Companion: Plain-Language Answers and Product Notes

This document answers the questions raised after reading [the main user manual](19-user-manual.md).
It is a companion to that manual, not a replacement for it. The answers describe the application
as it works on 25 August 2026. Where an idea would require a product change, the answer says so
explicitly.

## How to read the status labels

- **Already supported** means the application can do this now.
- **Partly supported** means some necessary behavior exists, but there is an important limitation
  or confusing interface.
- **New feature** means this is a sensible proposal, but the application does not do it today.
- **Recommended correction** means the current wording or behavior is misleading enough that it
  should be changed before relying on it.

## 1. Lead CSVs, imported information, notes, suppression, and bulk tiering

This section covers questions 1, 5, 6, 8, 9, 15, and 21.

### 1.1 What CSV format can I upload?

**Already supported.** The only required column is `email`. A useful basic file looks like this:

```csv
email,first_name,last_name,company,website,city,state,phone,notes
alex@example.com,Alex,Shah,Acme Labs,https://acme.example,Austin,TX,+1-555-0100,"Runs partnerships; source checked 2026-08-25"
priya@example.com,Priya,Mehta,Northstar,https://northstar.example,Jaipur,Rajasthan,,"Met at the SaaS event"
```

The application recognizes these standard fields:

| Standard field | Accepted header examples |
| --- | --- |
| Email | `email`, `e-mail`, `email_address`, `work_email` |
| First name | `first_name`, `firstname`, `first`, `given_name` |
| Last name | `last_name`, `lastname`, `last`, `surname` |
| Company | `company`, `company_name`, `business`, `brokerage` |
| Website | `website`, `url`, `domain`, `site` |
| City | `city`, `town` |
| State/region | `state`, `province`, `region` |
| Phone | `phone`, `phone_number`, `mobile`, `telephone`, `tel` |
| Operator notes | `notes`, `note`, `comments`, `comment` |

Headers are case-insensitive. Spaces and punctuation are converted to lowercase underscores. For
example, `Recent Project` becomes the custom field `recent_project`.

Any unrecognized column is retained as a **custom field**, rather than discarded. This is how a
CSV can automatically supply personalized merge-tag values:

```csv
email,first_name,company,job_title,recent_project,custom_observation
alex@example.com,Alex,Acme Labs,VP Partnerships,Acme's Texas expansion,"I noticed Acme opened its Austin partner program."
priya@example.com,Priya,Northstar,Founder,Northstar's new pricing page,"Your new pricing page makes the enterprise direction very clear."
```

After import:

- `{{first_name|there}}` can become `Alex`.
- `{{job_title|team lead}}` can become `VP Partnerships`.
- `{{recent_project|recent work}}` can become `Acme's Texas expansion`.
- `{{custom_observation|something relevant}}` can use the researched sentence.

Technical limits and useful details:

- Maximum file size: **10 MB**.
- Maximum data rows: **50,000** per file.
- Comma, semicolon, and tab delimiters are detected automatically.
- UTF-8 files with a byte-order mark are accepted.
- Values may contain commas and line breaks when the value is enclosed in double quotes.
- A double quote inside a quoted value must be written twice: `""`.
- Blank cells are allowed, but a row without a valid email will be flagged during preview.
- The preview also identifies duplicates, role-based addresses, suppressed addresses, and missing
  first names. You choose what to commit after reviewing those flags.

### 1.2 What are notes and custom observations?

They serve different purposes.

**Notes are private operator context.** They help you remember why the lead is relevant or what to
check before writing. Notes appear in the lead detail and manual composer. They are not
automatically inserted into an email.

Example note:

> Source: conference attendee list supplied by our own team. Verify whether Alex still owns
> partnerships before sending.

**Custom observation is researched personalization.** It is intended to be inserted into a
sequence through `{{custom_observation|fallback text}}` when the enrollment uses the researched
personalization mode.

Example custom observation:

> I noticed Acme opened a second office in Austin last month.

That can produce:

> Hi Alex — I noticed Acme opened a second office in Austin last month.

Notes should contain operator instructions and provenance. Custom observations should contain
clean, recipient-facing wording. Do not put private remarks in `custom_observation`.

### 1.3 What does suppressed mean?

**Already supported.** A suppressed lead is on the application's global **do-not-contact list**.
The application must not send that email address another outbound message, no matter which
campaign the lead appears in.

Common reasons include:

- The person clicked unsubscribe or replied with an opt-out phrase.
- You recorded the reply outcome as `Not interested`, `Wrong person`, or `Explicit opt-out`.
- The address produced a hard bounce.
- An operator manually unsubscribed the lead.

Suppression is checked at several stages: import, enrollment, scheduling, and final event/send
processing. This prevents a lead who was enrolled yesterday but opted out today from receiving
tomorrow's follow-up.

The **Suppressed only** switch in Leads is just a filter. It means “show me only people currently
on the do-not-contact list.” Turning the filter off does not remove anyone's suppression.

Example: Priya opts out in Campaign A. Later, the same address is included in a CSV for Campaign B.
The import preview flags the address as suppressed, and the application will not enroll or send to
it.

### 1.4 Why can I not see “Remove suppression”?

**Already supported, but deliberately hidden until relevant.** The button appears on the detail
page of a lead who is currently suppressed. It is not shown on the general Leads table and it is
not shown for an unsuppressed lead.

Removing suppression requires typing the exact email address as confirmation. Use it only to
correct a genuine mistake—for example, an operator suppressed the wrong record. Do not use it to
override a real unsubscribe or a real hard bounce. The historical event remains in the audit
timeline even if the current suppression record is removed.

### 1.5 What is “Bulk tag,” and how is it useful?

The current label is confusing. It does **not** add free-form labels such as `SaaS`, `Founder`, or
`Jaipur`.

**Current behavior:** clicking **Bulk tag** filters the Leads screen to untiered leads. You can
then select the visible rows—or all leads matching the current filter—and assign Tier A, B, C,
Nurture, or Untiered in one operation.

Example:

1. Import 500 leads.
2. Filter the list to the group you want to tier.
3. Select the matching leads.
4. Assign them Tier A or B together.

**Recommended correction:** rename this control to **Review untiered leads** or **Bulk assign
tier**. If free-form labels are wanted later, that would be a separate **new feature** with a real
tag taxonomy and tag filters.

### 1.6 Can CSV research automatically prefill the manual composer?

**Yes. This is now implemented for Step 1.** Use two CSV columns rather than JSON:

```csv
email,first_name,company,manual_subject,manual_body,notes
alex@example.com,Alex,Acme Labs,"Idea for Acme","Hi Alex,

I noticed Acme opened its Austin partner program.

Would it be useful to compare notes?","Research reviewed on 2026-08-25"
```

The line breaks inside `manual_body` work because the entire value is inside double quotes. If the
body needs a quoted phrase, double the quote characters:

```csv
email,manual_body
alex@example.com,"Alex called the launch ""a major step"" in the interview.

Would comparing notes be useful?"
```

Both `manual_subject` and `manual_body` are required for a valid draft. After upload, select one
target campaign. The preview shows new/existing leads, valid/incomplete drafts, and conflicts with
an existing unsent draft. Conflicts skip by default; **Replace existing unsent drafts** is an
explicit option. Existing lead profile data is preserved, while suppressed or erased leads never
receive drafts.

The stored draft belongs to that lead, campaign, and Step 1. It starts as **needs review** and does
not enroll, activate, or send anything. In Manual Compose, use **Save Draft**, then **Mark Ready**.
Only a ready draft can use **Send & log as manual**. The compliance footer remains outside the CSV
body and is appended by the server.

## 2. Mailboxes: controls, table columns, timezones, and polled folders

This section covers questions 2, 7, 12, and 13.

### 2.1 Can I manually restart an auto-paused mailbox?

**Already supported.** When a mailbox is auto-paused, a warning panel appears on the Mailboxes
page. After investigating the recent hard bounces and re-verifying the affected addresses, click
**Resume at 50%**.

Example: a mailbox has a daily cap of 10. Resuming at 50% gives it an effective cap of 5 per day.
It does not immediately send five messages; send windows, pace gaps, campaign state, and due work
still apply. After seven consecutive clean days, the temporary reduced cap can clear
automatically.

Do not resume merely because the button exists. First determine whether the cause was a bad list,
an authentication problem, a provider block, or a configuration error. Acknowledging the alert
does not itself restart the mailbox.

A mailbox that you paused manually has an ordinary **Resume** action and normally returns at its
full configured cap. OAuth failures use **Reconnect Google**, because resuming cannot repair a
revoked credential.

### 2.2 What do “7-day avg” and “Last poll” mean?

| Column | Plain meaning | Example |
| --- | --- | --- |
| **7-day avg** | Average messages sent per calendar day by this mailbox across the last seven days, including zero-send days. | Daily sends of 2, 3, 0, 4, 1, 0, 4 give an average of 2.0. |
| **Last poll** | How long ago the application last successfully checked that mailbox through IMAP for replies and bounces. | `3 minutes ago` means reply detection was healthy three minutes ago. `never` means no successful poll has yet been recorded. |

The seven-day average helps spot rotation imbalance. If one inbox is carrying much more traffic
than the others, its reputation is taking disproportionate risk.

Last poll is about **incoming mail**, not outgoing sends. If it becomes older than the configured
stale-poll threshold, the mailbox is flagged because the system may be missing replies and could
otherwise continue following up with someone who has already answered.

### 2.3 What are `INBOX` and `[Gmail]/Spam`?

They are IMAP folder names that the application checks:

- `INBOX` is the normal inbox.
- `[Gmail]/Spam` is Gmail's provider-specific IMAP name for the Spam folder.

Both matter because a genuine reply can occasionally land in Spam. If the application checked
only `INBOX`, it might miss that reply and send another follow-up. For a Google mailbox, the
recommended value is:

```text
INBOX, [Gmail]/Spam
```

Other providers may call the second folder `Junk` or something else. The application reads these
folders without moving mail or marking it read.

### 2.4 Should timezone and folders be text inputs?

They are no longer fragile free-text controls. Mailbox and Settings timezones use the same
searchable IANA timezone control with friendly UTC offsets, and the backend rejects invalid names.

Mailbox folders use a multi-select. **Discover folders** asks the connected provider for its real
folder names and special-use information; Google starts with `INBOX` and `[Gmail]/Spam`. **Test
Connection** reports existence per selected folder, and a verified nonexistent folder cannot be
saved. Adding a valid folder seeds its cursor from that folder's current `UIDNEXT`, so the first
poll does not ingest old history.

## 3. Personalization, merge tags, modes, manual compose, and spintax

This section covers questions 10, 11, 14, 15, 16, 17, and 23, plus the composer part of question
21.

### 3.1 How merge tags work

**Already supported.** A merge tag is a placeholder in a sequence template. The application
replaces it separately for each lead at preview/send time.

Syntax:

```text
{{field_name|fallback text}}
```

For this template:

```text
Subject: Question about {{company|your team}}

Hi {{first_name|there}},

I noticed {{recent_project|some of your recent work}}.
```

these two leads receive different rendered text:

| Lead data | Rendered opening |
| --- | --- |
| `first_name=Alex`, `company=Acme`, `recent_project=Acme's Austin expansion` | `Hi Alex, I noticed Acme's Austin expansion.` |
| blank first name, `company=Northstar`, blank recent project | `Hi there, I noticed some of your recent work.` |

The template is not changed. The system creates a lead-specific result when it processes that
lead's enrollment, step, and variant.

Useful built-in values include `first_name`, `company`, `market`,
`custom_observation`, and `sender_physical_address`. Arbitrary imported CSV columns also become
merge tags after their headers are converted to lowercase underscores.

Reusable non-lead values use a separate namespace:

```text
{{sequence.competitors|other tools}}
{{sequence.offer_name|the service}}
```

Define defaults in the Sequence Builder. A draft campaign may override them. First activation
freezes `campaign override → sequence default`, so later sequence edits cannot silently alter an
active campaign. Variable values are literal strings and are not parsed again for nested tags or
spintax.

`market` is derived from recognized US state abbreviations/names. For example, `state=TX` can
produce `market=Texas`. For international segmentation, import an explicit custom column such as
`market` or `region_name` rather than assuming every state name can be derived.

The fallback after `|` is strongly recommended. If a required value is missing and no fallback is
provided, the pre-send checks treat that as fatal and block the send instead of sending a broken
placeholder.

### 3.2 Researched slot versus auto slot

Both modes use templates. The difference is where `{{custom_observation}}` comes from.

**Mode 2—researched slot (`template_researched`)** first uses that individual lead's
`custom_observation`.

Example lead field:

```text
custom_observation = I noticed Acme opened a partner office in Austin.
```

Template:

```text
{{custom_observation|I was looking at your recent work}}
```

Rendered result:

```text
I noticed Acme opened a partner office in Austin.
```

If the researched observation is empty, the renderer can fall back to a campaign segment rule and
raise a warning.

**Mode 2—auto slot (`template_auto`)** ignores the lead's individual
`custom_observation`. It uses the draft campaign's selected standard/custom lead field to choose an
exact-match observation rule, or the required `default` observation.

Conceptual example:

```json
{
  "TX": "I have been speaking with several Texas teams about this.",
  "CA": "I have been speaking with several California teams about this.",
  "default": "I have been speaking with teams in your market about this."
}
```

This is now configurable on the draft campaign detail page. Choose a field such as `state`, `city`,
`industry`, or any imported custom field, add key/value rules, and provide `default`. Matching
trims and ignores case. Activation is blocked if an Auto Slot template needs observations and the
field/rules/default are incomplete. Researched mode still prefers the lead's individual
`custom_observation`, then uses the campaign rule as fallback.

### 3.3 What “effort per tier” controls

Effort per tier does not replace the sequence and does not decide how many steps exist. It decides
**how the same sequence template will be personalized and sent for leads in each tier**.

Default example:

| Lead tier | Effort mode | What happens |
| --- | --- | --- |
| A | Human-written | Scheduler does not send it. You use Manual Compose. |
| B | Researched slot | Scheduler renders templates using that lead's researched observation/custom fields. |
| C | Auto slot | Scheduler renders templates using automatic segment data/fallbacks. |
| Untiered | Auto slot | Untiered count-enrollments use auto mode. |
| Nurture | Excluded from Enroll next N | Requires deliberate explicit handling. |

Suppose a sequence has:

1. Step 1: `Question about {{company|your team}}`
2. Step 2 after three days: `Worth discussing, {{first_name|there}}?`

Alex in Tier A and Priya in Tier B can be enrolled in the same campaign and therefore use those
same two steps. Alex's enrollment is marked human-written and waits for the manual composer.
Priya's enrollment is rendered and scheduled automatically with her researched values.

The mode is copied onto the enrollment when it is created. Changing a lead's tier afterward does
not silently change the effort mode of an existing enrollment. Campaign effort settings can be
edited while the campaign is draft, then freeze permanently on first activation.

### 3.4 What Manual Compose is

**Already supported.** Manual Compose is Mode 1: an operator writes
or reviews the final email for a human-written enrollment, while the application still handles
mailbox selection, safety checks, delivery, threading, logging, and analytics.

The normal workflow is:

1. Assign the lead to a tier mapped to `human_written`—normally Tier A.
2. Enroll the lead in an active campaign.
3. Open the lead detail and choose **Compose manually**.
4. Select the eligible campaign and mailbox rotation option.
5. Edit the subject/body.
6. Click **Send & log as manual**.

The server appends the compliance footer at send time. **Do not paste the footer into the editable
body.** If the screenshot shows a footer or footer guidance, it is explaining the locked output;
it is not asking you to duplicate it.

The acknowledgement at the bottom says:

> I reviewed this lead's prior replies and intentionally approve recontact.

Leave it unchecked for a new lead. Check it only when the lead has replied in the past, the reply
has a recorded outcome that permits later contact, and you have consciously decided this new
contact is appropriate. It cannot override a global suppression, an undispositioned reply, or a
future `Not now` date.

The server now resolves the enrollment's actual due step. The composer shows campaign, **Step N of
M**, due time, personalization mode, and thread context. Step 1 prefers an eligible saved campaign
draft; otherwise the lowest-ID active variant of the due step is rendered. Later steps therefore
start from their own template, while threading and mailbox pinning remain intact.

### 3.5 Does the application support spintax?

**Already supported.** Spintax creates small wording alternatives inside one variant:

```text
{{RANDOM|Hi|Hello|Hey}} {{first_name|there}},

{{RANDOM|I noticed|I saw}} {{recent_project|your recent work}}.
```

Possible results include:

```text
Hi Alex,
I noticed Acme's Austin expansion.
```

or:

```text
Hey Alex,
I saw Acme's Austin expansion.
```

The selection is deterministic for that enrollment, step, and variant. A retry therefore uses the
same wording instead of changing mid-thread. Different leads can receive different alternatives.

Spintax and variants are not the same:

- Use **spintax** for small wording changes that are not meaningful experiments.
- Use **variants** for genuinely different subjects, value propositions, or calls to action whose
  performance you want to compare.

Two separate `RANDOM` blocks with three and two choices have six possible combinations. The
application does not promise perfectly equal use of every combination, and spintax by itself does
not guarantee deliverability.

## 4. Sequences, campaigns, steps, variants, enrollment, and ramp

This section covers questions 3, 18, 19, 22, 23, and 24.

### 4.1 Relationship between sequences and campaigns

Think of a **sequence** as the reusable message plan and a **campaign** as one operational run.

```text
Sequence: "Agency founders — proof-led"
  Step 1 now
  Step 2 after 3 days
  Step 3 after 5 more days

Campaign: "Texas agencies — August"
  uses that sequence
  has its own enrolled leads, status, effort mapping, ramp, and results
```

Current relationship:

- One campaign uses exactly one sequence.
- One sequence can be reused by several campaigns.
- A campaign cannot combine several sequences.

Example: `Texas agencies—August` and `California agencies—September` can both use the sequence
`Agency founders—proof-led`, while keeping their enrollments and analytics separate.

Be careful when editing a shared sequence: future sends in every campaign using it see the active
sequence content. Historical sent messages remain recorded, but the template is shared.

### 4.2 How steps and variants work

A **step** is a scheduled position in the conversation. `wait_days` controls when that step becomes
due relative to enrollment or the previous send.

Example:

| Step | Wait | Meaning |
| --- | --- | --- |
| 1 | 0 days | First email becomes due after enrollment. |
| 2 | 3 days | Follow-up becomes due three days after step 1 is sent. |
| 3 | 5 days | Next follow-up becomes due five days after step 2 is sent. |

Later steps are threaded to the original conversation using email headers. A human reply stops
the remaining sequence.

A **variant** is an alternative version inside one step. Step 1 might have:

- Variant A: curiosity-led subject and short CTA.
- Variant B: proof-led subject and specific CTA.

When several variants are active, the scheduler assigns them round-robin for that campaign and
step, based on send counts. A soft-bounce retry stays pinned to the original variant. Variant
selection is independent at each step: receiving Step-1 Variant A does not guarantee Step-2
Variant A.

If you deactivate a variant, future sends stop using it; historical results remain.

### 4.3 What an enrollment is

An **enrollment** is the record connecting one lead to one campaign. It tracks that lead's current
step, next due time, campaign state, personalization mode, assigned mailbox after the first send,
and final outcome.

The same person can have one completed enrollment in an older campaign and a separate enrollment
in a later, permitted campaign with different content. Global suppression and recontact safeguards
are still checked.

### 4.4 Exactly what “Enroll next N” does

**Already supported.** It means “create campaign enrollments for the next N eligible leads.” It
does **not** mean “send N emails immediately.”

Selection order is:

1. Tier A
2. Tier B
3. Tier C
4. Untiered

Within each group, older imports are selected first. Nurture leads are excluded. Suppressed leads,
leads already in that campaign, disallowed prior repliers, and leads who would receive duplicate
content are also excluded.

Example: the eligible pool contains 3 Tier-A leads, 20 Tier-B leads, and 50 Tier-C leads. **Enroll
next 10** selects the 3 Tier-A leads and the 7 oldest Tier-B leads.

The button does not use whichever checkboxes happen to be selected on the Leads screen. It uses
the campaign's count-based priority order. An explicit-ID enrollment capability exists in the
backend, but the ordinary campaign **Enroll next N** control is the priority-based operation.

After enrollment:

- An active campaign can make auto-mode Step 1 due on the next scheduler check.
- A draft or paused campaign sends nothing.
- A human-written enrollment waits for Manual Compose.
- Mailbox capacity, daily caps, send windows, pace gaps, and follow-ups due today still limit what
  can send.

The capacity panel reserves room for due follow-ups before suggesting new enrollments. For
example, if healthy mailboxes have room for 20 sends today but 8 follow-ups are due, suggested room
for new leads cannot exceed 12 before applying the campaign ramp limit.

### 4.5 How ramp works today

Ramp limits **new enrollments**, not every send and not mailbox warm-up itself. Follow-ups from
already enrolled leads still consume mailbox capacity.

The schedule is now progressive and starts on **first activation**, not campaign creation:

| Campaign day | New-enrollment cap |
| ---: | ---: |
| 1 | 5 |
| 2 | 8 |
| 3 | 10 |
| 4 | 12 |
| 5–7 | 15 |
| After day 7 | No campaign ramp limit |

Pausing does not stop or restart this calendar. Draft campaigns may define custom contiguous stages
before first activation. First activation freezes the schedule permanently. The campaign detail
shows the current day/stage, enrolled today, remaining today, and upcoming stages. Mailbox caps,
pace gaps, send windows, follow-up reservations, and other safeguards always continue to apply.

Also remember that a ramp value inside the configured ceiling is merely permitted. It does not
prove that a real mailbox is warmed enough for that volume.

## 5. Metrics, positive replies, meetings, and variant performance

This section covers questions 4, 20, and 28.

### 5.1 How the main metrics are calculated

A **contacted lead** is a distinct lead with a recorded delivery or a human reply. The reply is
also accepted as evidence of contact when it arrives before the delayed delivery-confirmation job.
The same lead is counted once, even after several steps.

**Positive rate** is:

```text
distinct contacted leads with a positive human reply
---------------------------------------------------- × 100
              distinct contacted leads
```

Example: 100 distinct leads are contacted. Twelve reply, and five of those replies have effective
sentiment `positive`. Positive rate is `5 / 100 = 5%`, not `5 / 12 = 41.7%`.

The effective sentiment is the current sentiment on the reply; the latest operator tag overrides
an earlier suggestion/tag. Selecting the reply outcome **Interested** and tagging sentiment
**Positive** are related but separate actions. The outcome controls permission/workflow; the
sentiment powers analytics.

**Meetings booked** is the number of `meeting_booked` events recorded by the operator.

```text
meetings per 100 contacted = meeting events / contacted leads × 100
```

Example: 3 recorded meetings among 120 contacted leads gives `2.5 meetings per 100 contacted`.

### 5.2 What “Mark meeting booked” does

It records a durable meeting event for that enrollment, displays a meeting badge, and updates
analytics.

It does **not** create a Google Calendar event, send an invitation, email the lead, change the
reply outcome, or restart/stop a sequence—the human reply has already stopped it.

Use the button once when a real meeting has actually been agreed. The normal UI hides the action
after it has been recorded.

### 5.3 How to identify the best variant

Open Analytics, select the campaign, use the **Variants** tab, and choose the sequence step. The
**Direct response** table attributes replies that actually referenced that step. The **Eventual
outcome** table follows every enrollment that received the variant through later replies and
meetings. The application recommends waiting for roughly 300 sends per automated variant before
declaring a winner, because tiny samples are unstable.

Practical example:

| Variant | Sent | Reply rate | Positive rate | Meetings | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 320 | 7.8% | 2.8% | 5 | More replies, fewer useful outcomes. |
| B | 315 | 6.5% | 4.1% | 9 | Likely better if meetings/positive intent are the goal. |

Do not choose only from raw reply rate. A provocative subject can produce more negative replies.
Prefer the metric closest to the business outcome—usually meetings first, then positive rate—and
also inspect bounce/unsubscribe quality.

The winner recommendation uses eventual meetings, then eventual positive rate. It reports an exact
tie instead of choosing arbitrarily. Historical/deactivated variants remain visible;
manual/bespoke rows are read-only and excluded from the recommendation.

## 6. Unibox, reply detection, outcomes, sentiment, sequence stopping, and snooze

This section covers questions 25, 26, 27, 28, and 29.

### 6.1 What Unibox is for

Unibox is the application's shared reply work queue across all connected outreach mailboxes and
campaigns. Instead of opening each Gmail account separately, you can review matched human replies,
auto-replies, the thread, the lead, and the campaign context in one place.

For every human reply, the operator should normally do two different classifications:

1. **Reply outcome**—what the reply means for permission and next operational action.
2. **Sentiment**—positive, neutral, or negative for analytics.

They are intentionally separate. “Not now” may sound neutral but must create a future hold date.
“Wrong person” may be politely worded but should suppress that address. Conversely, “Interested”
should not be inferred solely from a green sentiment icon.

### 6.2 How human replies and auto-replies are distinguished

The classifier uses this strict order:

1. Bounce
2. Auto-reply
3. Human reply
4. Unrelated incoming mail

Bounce detection uses delivery-status information and known bounce senders. Auto-reply detection
uses headers such as `Auto-Submitted`, `X-Autoreply`, and `X-Autorespond`, plus common out-of-office
subject patterns.

To count as a human reply, the incoming message's `In-Reply-To` or `References` header must match a
Message-ID previously sent by this application. **Subject-line matching is never enough.** That
avoids treating unrelated mail with a similar subject as a lead reply.

No classifier is infallible: a provider can produce unusual headers. The System > Reply Detection
table exists so the operator can inspect how an incoming message was classified.

### 6.3 What the reply outcomes do

| Outcome | Meaning | Suppression/recontact effect |
| --- | --- | --- |
| Interested | They show interest. | No suppression; future recontact still requires deliberate handling because they replied. |
| Not interested | They declined. | Permanent global suppression. |
| Not now | Timing is wrong, but later contact may be acceptable. | Requires a **Do not contact before** date; blocked until then. |
| Wrong person | This address/person should not receive this outreach. | Permanent global suppression. |
| Referred me | They directed you to someone else. | No suppression of this person, but do not assume permission to contact a new person without a proper lead record/basis. |
| Explicit opt-out | They directly asked to stop. | Permanent global suppression. |
| Other | None of the specific outcomes fits. | No automatic suppression; later recontact requires conscious acknowledgement. |

The three sentiment choices have a narrower purpose:

- **Positive**: useful interest or favorable intent.
- **Neutral**: informational/ambiguous response.
- **Negative**: rejection or unfavorable response.

Sentiment changes analytics. Sentiment alone does not determine suppression. For example, tagging
a reply negative does not automatically replace the required reply outcome.

### 6.4 What “sequence stopped” means

Every matched human reply moves that enrollment to the terminal `REPLIED` state. The application
will not send any later steps from that campaign enrollment.

Example: a lead replies after Step 1 while Step 2 is due in three days. Step 2 and every later step
are cancelled for that enrollment. A message already accepted by SMTP before the reply was
detected cannot be recalled, which is why frequent IMAP polling and stale-poll protection matter.

An out-of-office auto-reply does not count as human engagement, so the sequence continues
normally.

### 6.5 Reminders replaced reply Snooze

This correction is now implemented locally. Human-reply cards no longer offer the misleading
Snooze action. They can create one or more in-app reminders with a calendar date and optional note;
**Not now** automatically creates or updates one for the do-not-contact date.

A reminder is only an operator task. It does not restart the stopped enrollment, send anything, or
authorize recontact. Completing it does not erase the **Do not contact before** guard. The Unibox
Reminders view groups open work into Due today, Upcoming, and Overdue and allows completion or
dismissal.

## 7. Cold storage, recycling, and combining old campaigns

This section covers questions 30, 31, and 32 where they concern cold storage. General pagination
is covered in section 10.

### 7.1 What “enrollment completed” means

Yes: for that lead in that particular campaign, the intended sequence reached its end without a
human reply, unsubscribe, or bounce becoming the stronger terminal outcome.

More precisely, the final step was sent and later considered delivered after the delivery-confirm
window passed without a bounce. The enrollment then becomes `COMPLETED`.

Example: a three-step sequence sends all three emails. No reply or bounce arrives. After the final
message's confirmation window, that campaign enrollment becomes completed. The unsuppressed lead
can appear in cold storage and becomes recyclable only after the configured rest period.

Completed does not mean the person engaged. It means the sequence finished. A late reply can still
arrive and be recorded afterward.

### 7.2 How recycling works

Recycling creates a **new enrollment in a draft target campaign**. The older enrollment remains
completed for history. The application enforces a rest period and blocks reuse of content that the
lead already received.

Safe example:

```text
Source: Campaign A — three-email problem-awareness sequence
Rest: 60 days
Target: Campaign B — new case-study sequence, currently draft
```

After recycling, review the target and activate it separately. Recycling itself should not be
treated as approval to send.

### 7.3 Can two source campaigns be recycled into one target campaign?

**Yes.** Choose **Recycle into campaign**, select at least two completed source campaigns and one
draft target, then run the read-only preview. It reports cross-source duplicates, every exclusion
category, eligible unique leads, and per-source candidate/eligible contributions.

On confirmation, the server recomputes the same rules in one transaction. A lead found in two
sources gets one target enrollment plus two provenance links. Content conflicts are skipped rather
than resent; source enrollments and events remain untouched. If eligibility changes between preview
and confirmation, the commit uses the safer current result.

## 8. Bounce auto-pause and the difference between hard and soft bounces

This section covers questions 33 and 35.

### 8.1 Why auto-pause exists

A sudden group of invalid addresses can damage a sending inbox quickly. Auto-pause stops that
mailbox before the application continues through the rest of a bad list.

There are two complementary rules.

#### Percentage-window rule

- **Min sends before rules**: how much lifetime volume is required before this percentage test is
  considered.
- **Hard-bounce % threshold**: the percentage that triggers the pause.
- **% window size**: how many of the most recent sends are examined.

Example settings:

```text
Min sends: 25
Threshold: 4%
Window size: 50 sends
```

Once the mailbox has at least 25 lifetime sends, the application examines up to its latest 50
sends. Three hard bounces among 50 sends is 6%, so it pauses. Exactly 2 among 50 is exactly 4%; the
current rule fires only when the percentage is **greater than** the threshold.

#### Absolute rule

- **Absolute bounces**: the number of recent hard bounces that triggers a pause.
- **Absolute span**: how many recent sends are examined.

Example:

```text
Absolute bounces: 3
Absolute span: 10 sends
```

Three hard bounces in the latest ten sends pauses the mailbox even if it has not yet reached the
percentage rule's minimum volume. This catches a dangerous early cluster that a percentage rule
with a sample-size gate might miss.

### 8.2 Hard bounce versus soft bounce

**Hard bounce:** a permanent failure, commonly a nonexistent/invalid recipient (`5.x.x` delivery
status). The enrollment stops and the email address is globally suppressed so other campaigns do
not keep trying it.

**Soft bounce:** a temporary failure, commonly a full mailbox, temporary server problem, or
transient deferral (`4.x.x`). The same step is retried after four hours, up to the configured
soft-bounce retry maximum. It keeps the same variant/content.

After the retry limit is exceeded, the enrollment becomes terminal `BOUNCED` so the campaign does
not retry forever. That does not turn the provider's temporary response into verified proof that
the address is permanently invalid, so it is different from a confirmed hard-bounce suppression.

## 9. Timing controls

This section covers question 34.

### 9.1 Scheduler tick

How often the application wakes its send loop and asks, “Is any enrollment due and allowed to
send?”

A five-minute tick does **not** mean one email every five minutes. The mailbox pace gap, daily cap,
send window, campaign status, suppression, and health checks can require a much longer wait.

Example: an inbox has a nine-hour send window and cap 5. Its base pace is about 108 minutes between
sends. Checking every five minutes cannot bypass that gap.

### 9.2 IMAP poll and stale poll

The manual may have made “state poll” sound like a separate item. The setting is **IMAP poll**:
how often the application checks connected mailboxes for replies and bounces.

**Stale poll** is the maximum time without a successful check before the system flags/pauses the
mailbox. This protects against sending follow-ups while inbound detection is broken.

### 9.3 Send jitter

The application first calculates a mailbox's base minimum gap:

```text
send-window minutes / effective daily cap
```

Jitter varies that gap randomly by the configured percentage. With a 100-minute base gap and 20%
jitter, a particular gap is approximately 80–120 minutes. Jitter makes timing less mechanical; it
never overrides the daily cap or send window.

### 9.4 Soft-bounce retries

This controls how many retry attempts are allowed after temporary delivery failures. With a value
of 2, the system can retry twice at four-hour intervals; a further soft bounce makes the
enrollment terminal rather than retrying indefinitely.

These timing settings exist for different reasons: scheduler responsiveness, reply safety,
natural pacing, and temporary-provider recovery. They should not be used to artificially speed up
mailboxes that are still warming.

## 10. System jobs, projections, long lists, navigation, and phones

This section covers questions 31 and 36–40.

### 10.1 What a job is

A job is a background piece of work executed by the server. It does not require your browser or
laptop to stay open.

Examples include running a scheduler tick, polling a mailbox for replies, confirming a sent
message as delivered after the waiting period, and running operational integrity work.

Jobs are kept in a PostgreSQL-backed queue. A pending job can be normal; a failed job means the
work exhausted its retry behavior or encountered a problem that needs investigation. The System
page makes job health visible.

### 10.2 What “Rebuild projections” means

The append-only event ledger is the durable history: enrolled, sent, delivered, human reply,
unsubscribe, meeting booked, and so on. A **projection** is the convenient current-state summary
derived from that history.

Bank-account analogy:

```text
Ledger entries: +₹1,000, -₹200, -₹100
Projection: current balance ₹700
```

For an enrollment:

```text
Events: enrolled → sent → delivered → human_reply
Projection: current state REPLIED, no next send
```

A projection dry-run replays the ledger and compares the result with stored current state. **Zero
differences** means they agree. A real rebuild repairs derived state from the immutable history; it
does not resend emails, delete events, or invent outcomes. Operators should normally use dry-run
for diagnosis and perform a write rebuild only through the controlled runbook.

### 10.3 Do long lists have pages today?

Yes. Operational pagination is deployed. The long working lists default to 25 rows and let you
choose 25, 50, or 100 from **Rows per page**.

| Screen | Current behavior |
| --- | --- |
| Leads | Defaults to 25 rows; 25/50/100 selector and page controls. |
| Import history | Paginated. |
| Unibox | Human, OOO, and Reminder views default to 25; 25/50/100 selector. |
| System > Reply Detection | Defaults to 25; 25/50/100 selector. |
| System > Alerts history | Defaults to 25, including acknowledged history; 25/50/100 selector. |
| Cold storage | Defaults to 25 from the standard list envelope; 25/50/100 selector. |
| Mailboxes/campaigns/sequences | Currently load their full operational lists. |

The shared control always shows the current range and total, numbered pages on wider screens, and
Previous/Next on phones. Filters are preserved across pages; changing a filter or page size resets
to page 1.

### 10.4 Should the left navigation stay fixed?

Yes. This is now implemented locally:

- Desktop: sticky/fixed-height sidebar with its own overflow only if the navigation itself is too
  tall; main content scrolls independently.
- Tablet/phone: no permanent sidebar width; a compact top bar opens the complete navigation in a
  left-side drawer.
- Preserve keyboard focus, screen-reader labels, and a visible active-page state.

The drawer closes after navigation and restores focus to the menu button. Campaign context remains
in the URL across both desktop and phone navigation.

### 10.5 Full phone redesign

The complete responsive redesign is now implemented locally. It includes:

1. A compact top bar and navigation drawer instead of the desktop sidebar.
2. Card/list presentations for Leads, Mailboxes, Unibox, Campaigns, and Alerts instead of forcing
   every desktop table onto a narrow screen.
3. Full-screen mobile dialogs for import, campaign creation, sequence editing, and manual compose.
4. Filters in a slide-over sheet with an obvious “filters active” indicator.
5. Sticky bottom actions for high-value tasks such as Save outcome, Send, and Enroll—but never in a
   way that causes accidental sending.
6. Touch targets of at least about 44 px, readable text, no hover-only controls, and safe spacing
   around destructive buttons.
7. Responsive charts with short labels and drill-down details.
8. The missing pagination/load-more behavior so phones do not render enormous lists.
9. Testing at common widths such as 320, 375, 390, 430, and 768 px, including on-screen keyboard
   behavior in the manual composer.

It remains the same web application; no separate native app is required. Parameterized Playwright
tests cover 320, 375, 390, 430, and 768 px, reduced motion, focus/Escape behavior, touch sizing,
unsaved Manual Compose text during keyboard-sized viewport changes, page overflow, and axe
accessibility scans including color contrast.

## 11. Implementation status from these questions

Stages 1–4 of the approved improvement plan are complete, verified, and deployed to Spaceship at
application commit `f58b977`. The final complete serial gate, proportional pagination/settings
hotfix gate, migration replay, populated projection check, self-check, and scratch restore drill all
pass. The production rollout also
passed migrations, health, public routing, dormant-send-state, zero-drift, and backup checks.

| Status | Improvement | Notes |
| --- | --- | --- |
| Deployed | Unibox/System pagination, due-step Manual Compose, reminders, safe timezone/folder controls | Stage 1 |
| Deployed | Imported manual drafts, Auto Observation rules, sequence variables, activation-based staged ramp | Stage 2 |
| Deployed | Later-step direct/eventual variant analytics and multi-source recycling | Stage 3 |
| Deployed | Phone-responsive navigation and complete mobile redesign | Stage 4 |

## 12. Question coverage map

This map confirms where each original doubt is answered.

| Questions | Answer section |
| --- | --- |
| 1, 5, 6, 8, 9, 15, 21 | Section 1 — Lead CSVs, data, suppression, tiers, imported drafts |
| 2, 7, 12, 13 | Section 2 — Mailboxes, timezones, folders, table columns |
| 10, 11, 14, 16, 17, 23 | Section 3 — Merge tags, modes, manual compose, spintax, effort |
| 3, 18, 19, 22, 24 | Section 4 — Campaign/sequence relationship, variants, enrollment, ramp |
| 4, 20, 28 | Section 5 — Metrics, meetings, variant performance |
| 25, 26, 27, 29 | Section 6 — Unibox, reply outcomes, stopping, snooze |
| 30, 32 | Section 7 — Completion and recycling |
| 33, 35 | Section 8 — Bounce auto-pause and bounce types |
| 34 | Section 9 — Timing controls |
| 31, 36, 37, 38, 39, 40 | Section 10 — Jobs, projections, pagination, navigation, mobile |
