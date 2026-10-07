# Frontend Screens — Low-Level Spec

> **2026-10-07 controls:** Settings → Compliance → Sender signature adds **Include postal
> address**, off by default. Hidden addresses remain editable/saved; the sending domain moves
> below the role. With inclusion on, the domain follows the role with ` | ` and the address
> follows on the next line. Empty-address validation applies only when inclusion is on.
> Mailboxes → Edit replaces the fixed interval with **Minimum minutes / Maximum minutes**,
> default 4–7, whole minutes 1–1440 with min < max. The table displays the saved range; the form
> explains that windows, caps and processing can extend the actual gap. See docs/06 and docs/08.

> **Migration 0019 overlay:** the Leads screen adds Campaign + Pool/Enrolled/Both scope, exact bulk
> A/B/Untiered actions, and separate Nurture controls. Lead detail renames Manual Compose to
> Personalized Copy and removes all direct-send controls. Sequence steps choose Template or
> Personalized Copy; campaigns display fixed A=Researched/B=Auto behavior and copy coverage. See
> [docs/22](22-personalized-copy-two-tier.md).

Every screen: purpose, data (endpoints from [10-api-contract.md](10-api-contract.md)), regions, interactions, and edge states. Walkthrough section references in parentheses. Build order/tasks: [15-build-stages-frontend.md](15-build-stages-frontend.md).

Common to all screens: skeleton loading, inline error+retry, and a global alerts bell. The shared
campaign selector appears only on Overview. Leads and Analytics use explicit page-level campaign
filters; global screens do not carry a misleading campaign query between navigation links. Desktop/tablet collections remain semantic tables;
phones receive stacked cards and mobile filter Sheets with the same query, actions, empty/error
states, and pagination. The desktop sidebar is viewport-fixed; phones use a ten-section drawer.
Dialogs become full-screen or near-full-screen on phones, and no operational screen requires
page-level horizontal scrolling.

---

## 1. 📊 Overview `/overview` (walkthrough §11)

**Data:** `GET /analytics/overview?campaign_id` (poll 30 s), `GET /campaigns/:id/capacity`, `GET /alerts?unacked`.
**Regions:** (a) progress bar `contacted/total` + est-completion (contacted ÷ 7-day avg daily contacted); (b) 5 `MetricStat` tiles — reply, positive, meetings (+per-100), hard-bounce (✅/⚠️ vs 4% threshold), unsub (watch-flag arrow); (c) TODAY panel: follow-ups scheduled, room for new openers, suggested enrollments + **[Enroll next N]** button → `POST enroll {count:N}` → success toast "Enrolled N", capacity refetch; (d) watch-flag banners from `watch_flags`.
**Edge:** no campaign → EmptyState with "Create campaign" CTA. `capacity_exceeded` 409 → toast explaining ramp cap. Current enrollments finished → outcome summary card linking to Campaigns detail; the campaign itself can remain active for a later batch.

## 2. 📥 Leads `/leads`, detail `/leads/:id` (§Stage 2)

**Data:** `GET /leads` (filters in URL params), `GET /leads/:id`.
**Regions:** tier-distribution header (counts per tier from meta — the Stage-2 panel), **untiered banner** ("N leads need tiering → Bulk tag", decision R); filter row (tier, state, campaign, pool campaign, search, suppressed toggle); DataTable/card: email, name, company, location, TierBadge, StateBadge (latest enrollment), pool assignment, suppressed 🚫.
**Interactions:** row click → detail; checkbox select + select-all-matching-filter → BulkTierBar (choose tier → `POST bulk-tier` with ids or filter); detail page: editable tier/notes/`custom_observation` (+ other custom fields), **event timeline** (rendered from `timeline`, newest first, event-type icons), and Personalized Copy editor. The tier header comes from the same complete server predicate as the list and select-all-matching operation. Finished-step ACTIVE enrollments with no next send display **Finishing**, not a misleading actively-sending badge.
**Edge:** suppressed lead detail shows red banner (reason + date) and a "Remove suppression" link → `ConfirmTypedDialog` (must type the email) → `DELETE /suppressions/:email` (decision U).

## 3. Import wizard `/leads` → dialog (§Stage 1)

Three steps in a dialog: **Upload** (drag/drop CSV, client-side 10 MB check) → `POST /imports` → **Preview** — explained safe-address choices, personalized-email readiness/replacement, and repeatable **Campaign allocation** rows with campaign, exact count, and generic-copy destination. Allocation preview hides stale results while recalculating and shows requested/available/excluded/copy-binding/remaining-global totals before commit. `POST commit` is all-or-nothing when exact allocations drift. **Result** separately reports leads, sources, campaign copies, allocations, and the global remainder. Import History distinguishes durable committed history from preview-only attempts; an uncommitted preview has a safe **Discard** action.
**Edge:** `import_too_large` 413 → inline error; suppressed>0 → amber compliance note "these opted out previously — always excluded".

## 4. 📧 Mailboxes `/mailboxes` (§Stage 0, §Stage 7 failures, §11 volume)

**Data:** `GET /mailboxes` (poll 60 s), `GET /mailboxes/volume?days=30`.
**Regions:** table — address, status chip (`🟢 ok / ⏸ paused / 🟠 auto_paused / 🔴 auth_failed / ⚠️ imap_stale / 🚫 provider_blocked`), sent today `n/cap`, 7-day avg, HARD-BNC%, last poll; footer row TOTAL DAILY CAPACITY; volume trend chart (per-mailbox lines, 30 d) + imbalance warning banner when `imbalance: true` (§11).
**Interactions:** **+ Add Mailbox** dialog = walkthrough Stage-0 form (rhf+zod from shared schema; password field masked, never re-displayed) with **[Test Connection]** → `POST test-connection` → `✅ SMTP OK · ✅ IMAP OK · 4.2s` inline; edit (PATCH); pause/resume.
**Failure panels (the Stage-7 pending screens, driven by `status`):**
- `auth_failed` → red card: explanation, redistribution note, new-app-password input + **[Reconnect Mailbox]** → `POST reconnect`.
- `imap_stale` → amber card: last-poll time, risk copy, **[Retry connection now]** → `POST test-connection` then refetch.
- `auto_paused` → amber card: trigger detail from `status_reason` + the paired alert payload (both window numbers, likely cause), buttons **[Re-verify leads]** (links to Leads filtered to that mailbox's recent enrollments) and **[Resume at 50%]** → `POST resume {cap_pct:50}`.

## 5. ✍️ Sequences `/sequences`, builder `/sequences/:id` (§Stage 4)

**Data:** `GET/POST/PATCH /sequences`, `POST validate-template` (debounced 500 ms), `POST preview`.
**Regions:** list (name, steps, stop conditions, active-in-campaigns); builder — step list (step_no, wait_days stepper, in-thread toggle) matching the walkthrough card; per step: variant tabs (A/B/+); template editor (textarea, monospace) with live validation chips (tag errors, variation count) from `validate-template`; stop-condition toggles; sticky footer **[Save sequence]**.
**Preview panel** (right side): sequence-default/campaign-context selector + lead picker → `POST preview` → rendered subject/body with the footer visually separated + checklist. Template steps preview a saved variant. Personalized steps expose their own Preview action and, with campaign context, render that lead's exact campaign-step subject/body and readiness. Resolution details show the actual Tier A Researched or Tier B Auto mode, lead values, matched Auto Observation rule, sequence-variable sources/fallbacks, and spintax choices. Footer remains locked. Non-first steps with `wait_days=0` warn that they become immediately due and scheduler pacing is not a configured wait.
**Interactions:** remove step (walkthrough 13b "Remove Step 3") = delete step in builder + save; deactivate variant lives in Analytics (§12-8).
**Edge:** save with fatal template errors → 422 `sequence_invalid`, errors mapped to the offending step/variant tab.

## 6. 🚀 Campaigns `/campaigns`, detail `/campaigns/:id` (§Stage 5, §Stage 9)

**Data:** campaigns CRUD, capacity, lead pool, auto-enrollment history, outcomes, cold-storage, recycle.
**List:** name, status, sequence, enrolled/contacted, pending delivery confirmation, journey progress based on terminal enrollments, and a recycled-source badge when
campaign provenance exists. Detail shows every source name with its distinct contributed-lead
count; the deprecated single-source field is not the display source of truth.
**Detail regions:** (a) capacity meter with activation day, ramp/permanent cap, pending opener reservations, shared room, pool availability, and **[Enroll next N]**; (b) lead-pool panel with summary, paginated table/cards, add-next-N, release/reassign, permanent cap, auto-enrollment switch and run history; (c) enrollment breakdown; (d) current-enrollments-finished panel; (e) draft-only editor for staged ramp, fixed Tier A/B behavior, Auto Observation field/rules, and sequence-variable overrides. First activation freezes personalization/ramp configuration and prevents later permanent-cap increases; pause/resume does not restart the calendar. Finishing the current enrollments does not auto-pause or complete the campaign; it may stay active for a later imported batch.
**Edge:** enroll into `draft` campaign → blocked with "Activate first"; sequence missing → blocked. A pool-backed campaign with no eligible pool entries explains that it will not draw unrelated global leads. Enabling auto-enrollment on an active campaign requires a visible acknowledgement.

## 7. 💬 Unibox `/unibox` (§Stage 6)

**Data:** `GET /unibox` (poll 60 s), tabs `human` / `auto_reply` / `reminders`; mailbox and sentiment filters; **Needs outcome** filters replies without a disposition. Each tab defaults to 25 rows, offers 25/50/100 rows per page, and resets to page 1 when a filter or page size changes.
**Card per item:** every human reply shows the mandatory stopped-sequence caption and an outcome selector. `not_now` requires a future date and creates an in-app reminder; not-interested, wrong-person and explicit opt-out indicate global suppression. Sentiment remains a separate analytics tag. Meeting, reminder and thread actions remain available. Reminders can be filtered by Due today, Upcoming, or Overdue and completed/dismissed without restarting a sequence or authorizing contact.
**Auto-reply tab:** OOO items, caption "NOT counted as a reply. Sequence continues normally."
**Edge:** `tag_only` mode (settings) adds an explicit **[Unsubscribe lead]** button on negative-tagged cards → `POST enrollments/:id/unsubscribe`. Empty state: "No replies yet — they'll appear here the moment the poller sees them."

## 8. 📈 Analytics `/analytics` (§13)

Analytics has its own explicit campaign selector. Tabs: **Variants** (13a): sequence-step selector plus separate **Direct response** and **Eventual
outcome** tables. Direct follows the persisted replied-to step; eventual follows the whole variant
cohort through later replies and meetings. The recommended winner uses eventual meetings then
eventual positive rate and reports exact ties. The 300-send warning remains. Inactive history and
manual/bespoke variants stay visible, but bespoke rows are read-only and the final active automated
variant cannot be deactivated. The selector defaults to the first Template step; a selected Personalized Copy step explains that it has no variants. **Steps** (13b): sent/confirmed/pending/replies/reply%/positive results per step, visible immediately after sends, with verdict
chips + "(positives sum to N ✓)" footer + **[Remove step]** deep-link to builder. **Tiers** (13c): contacted/confirmed/pending plus the tier table + insights block + legacy **[Promote N
engaged Tier-C → Tier B]** → bulk-tier with server-provided lead set. **Health** (13d): 5
sparklines with current values + threshold ✅/⚠️, watch-rules status list.
All tables show the reconciliation footers ("meetings sum to 17 ✓") — computed client-side from the same response, rendering ✗ if they ever don't (a free UI-level self-check).

## 9. ♻️ Cold Storage `/cold-storage` (§Stage 9)

**Data:** paginated `GET /cold-storage`, recycle mutation.
**Regions:** guidance card (large-market copy, earliest-recycle date, pass history); table: lead, completed date, earliest recycle, eligible ✓/✗-in-N-days.
**Recycle flow:** **[Recycle into campaign…]** → select at least two source campaigns and one draft
target → run a read-only eligibility preview. The preview shows unique leads, cross-source
duplicates, rest/nurture/suppression/recontact/existing-target/content-conflict exclusions, eligible
count, and per-source contributions. Final confirmation recomputes all rules in one serializable
transaction; each eligible lead is enrolled once, content conflicts are skipped (never resent), and
the target remains draft. The result repeats the recomputed totals and full source provenance.

## 10. ⚙️ Settings `/settings` (§Stage 0 rules)

Tabs: **Rules** — deliverability toggles + bounce auto-pause params (the Stage-0 panel, numeric inputs with the spec's defaults and inline explainers) + timing (tick/poll/stale/delivery-confirm/jitter/rest-days) + `optout_detection` radio (with decision-F explainer) + searchable, backend-validated IANA default-timezone combobox. **Compliance** — the CAN-SPAM footer editor: physical address textarea + opt-out text input + live footer preview as it will render; empty address → blocking error explaining sends halt. **Account** — email, change password. Mailbox create/edit uses the same safe timezone selector plus authenticated folder discovery/multi-select and per-folder Test Connection results.
All PUTs full-row with zod validation; dirty-state guard on tab switch.

## 11. 🖥 System `/system` (pending screens: reply-detection view + job status)

**Reply-detection debug:** paginated `GET /incoming-messages` table (100/page) — time, mailbox, from, subject, classification chip (bounce/auto-reply/human/unrelated), DSN status, matched enrollment link, resulting events. Filter by classification/mailbox. This is the walkthrough's "How the IMAP Poller Classifies" made inspectable.
**Job status:** `GET /system/status` — scheduler last tick, transport mode, poller freshness, pending jobs, and projection dry-run. **Alerts history** uses the all-alerts view so acknowledged operational alerts remain reviewable.

## 12. Catch-up notice (pending screen; global)

`catchup_backlog` alert unacked → amber banner on Overview + Campaigns: downtime duration, sends due, the never-burst explanation (walkthrough Stage-5 panel), **[Acknowledge]** → `POST alerts/:id/ack`.

## 13. Login `/login`

Email + password → `POST auth/login`; error toast on 401/429; redirect to intended route.

## 14. Personalized Copy editor — dialog from Lead detail

The scope selector distinguishes **Reusable lead copy · not assigned to a campaign** from exact
`Campaign · Personalized Step N` snapshots. The editor shows subject/body, readiness, import
provenance, preview/risk checks, and target-named **Save Draft**, **Mark Ready**, and **Copy reusable
lead copy** actions. Mutation refetches retain the immutable campaign/step target; sent copy is
read-only. There is no mailbox picker or send action—delivery occurs only through sequence
enrollment and the scheduler.
