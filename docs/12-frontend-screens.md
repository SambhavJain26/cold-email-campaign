# Frontend Screens - Low-Level Spec

Every screen: purpose, data (endpoints from [10-api-contract.md](10-api-contract.md)), regions, interactions, and edge states. Walkthrough section references in parentheses. Build order/tasks: [15-build-stages-frontend.md](15-build-stages-frontend.md).

Common to all screens: skeleton loading, inline error+retry, campaign selector in top bar scopes campaign-aware screens, alerts bell global.

---

## 1. 📊 Overview `/overview` (walkthrough §11)

**Data:** `GET /analytics/overview?campaign_id` (poll 30 s), `GET /campaigns/:id/capacity`, `GET /alerts?unacked`.
**Regions:** (a) progress bar `contacted/total` + est-completion (contacted ÷ 7-day avg daily contacted); (b) 5 `MetricStat` tiles - reply, positive, meetings (+per-100), hard-bounce (✅/⚠️ vs 4% threshold), unsub (watch-flag arrow); (c) TODAY panel: follow-ups scheduled, room for new openers, suggested enrollments + **[Enroll next N]** button → `POST enroll {count:N}` → success toast "Enrolled N", capacity refetch; (d) watch-flag banners from `watch_flags`.
**Edge:** no campaign → EmptyState with "Create campaign" CTA. `capacity_exceeded` 409 → toast explaining ramp cap. Campaign complete → outcome summary card linking to Campaigns detail (§12-9 panel).

## 2. 📥 Leads `/leads`, detail `/leads/:id` (§Stage 2)

**Data:** `GET /leads` (filters in URL params), `GET /leads/:id`.
**Regions:** tier-distribution header (counts per tier from meta - the Stage-2 panel), **untiered banner** ("N leads need tiering → Bulk tag", decision R); filter row (tier, state, campaign, search, suppressed toggle); DataTable: email, name, company, location, TierBadge, StateBadge (latest enrollment), suppressed 🚫.
**Interactions:** row click → detail; checkbox select + select-all-matching-filter → BulkTierBar (choose tier → `POST bulk-tier` with ids or filter); detail page: editable tier/notes/`custom_observation` (+ other custom fields), **event timeline** (rendered from `timeline`, newest first, event-type icons), Manual Compose button (§12-14).
**Edge:** suppressed lead detail shows red banner (reason + date) and a "Remove suppression" link → `ConfirmTypedDialog` (must type the email) → `DELETE /suppressions/:email` (decision U).

## 3. Import wizard `/leads` → dialog (§Stage 1)

Three steps in a dialog: **Upload** (drag/drop CSV, client-side 10 MB check) → `POST /imports` → **Preview** - the walkthrough panel verbatim: counts per flag with expandable 20-row samples, explainer copy ("Role-based + invalid bounce more…"), two buttons labeled with exact counts (`Drop flagged & import 885` / `Import all incl. role-based`; invalid+suppressed never importable - shown struck-through) → `POST commit` → **Result** (imported count, link to untiered filter).
**Edge:** `import_too_large` 413 → inline error; suppressed>0 → amber compliance note "these opted out previously - always excluded".

## 4. 📧 Mailboxes `/mailboxes` (§Stage 0, §Stage 7 failures, §11 volume)

**Data:** `GET /mailboxes` (poll 60 s), `GET /mailboxes/volume?days=30`.
**Regions:** table - address, status chip (`🟢 ok / ⏸ paused / 🟠 auto_paused / 🔴 auth_failed / ⚠️ imap_stale / 🚫 provider_blocked`), sent today `n/cap`, 7-day avg, HARD-BNC%, last poll; footer row TOTAL DAILY CAPACITY; volume trend chart (per-mailbox lines, 30 d) + imbalance warning banner when `imbalance: true` (§11).
**Interactions:** **+ Add Mailbox** dialog = walkthrough Stage-0 form (rhf+zod from shared schema; password field masked, never re-displayed) with **[Test Connection]** → `POST test-connection` → `✅ SMTP OK · ✅ IMAP OK · 4.2s` inline; edit (PATCH); pause/resume.
**Failure panels (the Stage-7 pending screens, driven by `status`):**
- `auth_failed` → red card: explanation, redistribution note, new-app-password input + **[Reconnect Mailbox]** → `POST reconnect`.
- `imap_stale` → amber card: last-poll time, risk copy, **[Retry connection now]** → `POST test-connection` then refetch.
- `auto_paused` → amber card: trigger detail from `status_reason` + the paired alert payload (both window numbers, likely cause), buttons **[Re-verify leads]** (links to Leads filtered to that mailbox's recent enrollments) and **[Resume at 50%]** → `POST resume {cap_pct:50}`.

## 5. ✍️ Sequences `/sequences`, builder `/sequences/:id` (§Stage 4)

**Data:** `GET/POST/PATCH /sequences`, `POST validate-template` (debounced 500 ms), `POST preview`.
**Regions:** list (name, steps, stop conditions, active-in-campaigns); builder - step list (step_no, wait_days stepper, in-thread toggle) matching the walkthrough card; per step: variant tabs (A/B/+); template editor (textarea, monospace) with live validation chips (tag errors, variation count) from `validate-template`; stop-condition toggles; sticky footer **[Save sequence]**.
**Preview panel** (right side): lead picker (search) → `POST preview` → rendered subject/body with the footer visually separated + the pre-send checklist verbatim (✅/⚠️/❌ per check, score badge, variation count). Footer block is read-only with a lock icon + link to Compliance settings (non-removability made visible).
**Interactions:** remove step (walkthrough 13b "Remove Step 3") = delete step in builder + save; deactivate variant lives in Analytics (§12-8).
**Edge:** save with fatal template errors → 422 `sequence_invalid`, errors mapped to the offending step/variant tab.

## 6. 🚀 Campaigns `/campaigns`, detail `/campaigns/:id` (§Stage 5, §Stage 9)

**Data:** campaigns CRUD, capacity, outcomes, cold-storage, recycle.
**List:** name, status, sequence, enrolled/contacted, progress bar, Pass-2 badge when `recycled_from_campaign_id`.
**Detail regions:** (a) capacity meter card = walkthrough Day-13/Day-20 panel (total/follow-ups/room/ramp note/suggested + enroll-from-tier note + **[Enroll next N]**); (b) enrollment breakdown by state (live outcome counts); (c) **completion panel** when all enrollments terminal: the Stage-9 report - terminal outcomes table summing to total ✓, event-based rates block (with the "may overlap" caption), and two CTAs: **[Recycle cold storage]** (→ recycle flow §12-9) and **[Import fresh leads]** (→ import wizard); (d) ramp/tier-effort config (the §8 deferred-decision knobs) - **editable at creation only**: `PATCH /campaigns` carries `name`/`status` alone (docs/10), so the form lives in the create dialog and the detail page shows the values read-only. Changing effort/ramp means a new campaign.
**Edge:** enroll into `draft` campaign → blocked with "Activate first"; sequence missing → blocked.

## 7. 💬 Unibox `/unibox` (§Stage 6)

**Data:** `GET /unibox` (poll 60 s), tabs `human` / `auto_reply`; sentiment filter chips.
**Card per item** (walkthrough verbatim): lead name - company, relative time, snippet, "↳ sequence auto-stopped ✓", suggested tag (greyed, "AI-assisted") when present, **Tag row** `[🟢][⚪][🔴]` one-click (optimistic) → `POST sentiment`; **[📅 Mark meeting booked]** → `POST meeting-booked` (hidden once true → shows ✓ badge); **[Snooze…]** date picker → `POST snooze`; auto-unsubscribed items show "→ auto-unsubscribed ✓ · counts toward reply AND unsub rate" caption. Card click → thread view (sent steps + reply body).
**Auto-reply tab:** OOO items, caption "NOT counted as a reply. Sequence continues normally."
**Edge:** `tag_only` mode (settings) adds an explicit **[Unsubscribe lead]** button on negative-tagged cards → `POST enrollments/:id/unsubscribe`. Empty state: "No replies yet - they'll appear here the moment the poller sees them."

## 8. 📈 Analytics `/analytics` (§13)

Tabs: **Variants** (13a): table per step-1 variant - sent, reply%, pos%, meetings; winner row highlighted (max meetings, tie → pos%); small-sample caption when sent < 300/variant; **[Deactivate A, route all to B]** → `POST step-variants/:id/deactivate` + confirm dialog. **Steps** (13b): delivered/pos-replies/pos% per step with verdict chips (WEAK when pos% < 0.5% and delivered ≥ 200) + "(positives sum to N ✓)" footer + **[Remove step]** deep-link to builder. **Tiers** (13c): the tier table + insights block + **[Promote N engaged Tier-C → Tier B]** → bulk-tier with server-provided lead set. **Health** (13d): 5 sparklines with current values + threshold ✅/⚠️, watch-rules status list.
All tables show the reconciliation footers ("meetings sum to 17 ✓") - computed client-side from the same response, rendering ✗ if they ever don't (a free UI-level self-check).

## 9. ♻️ Cold Storage `/cold-storage` (§Stage 9)

**Data:** `GET /cold-storage`, recycle mutation.
**Regions:** guidance card (large-market copy, earliest-recycle date, pass history); table: lead, completed date, earliest recycle, eligible ✓/✗-in-N-days.
**Recycle flow:** **[Recycle into campaign…]** → dialog: pick/create target draft campaign → warns if target sequence shares content hashes ("identical to Pass 1 - change the message first", from 409 `recycle_sequence_conflict`) → confirm → enroll result summary.

## 10. ⚙️ Settings `/settings` (§Stage 0 rules)

Tabs: **Rules** - deliverability toggles + bounce auto-pause params (the Stage-0 panel, numeric inputs with the spec's defaults and inline explainers) + timing (tick/poll/stale/delivery-confirm/jitter/rest-days) + `optout_detection` radio (with decision-F explainer) + default timezone select. **Compliance** - the CAN-SPAM footer editor (pending screen): physical address textarea + opt-out text input + live footer preview as it will render; empty address → blocking error explaining sends halt. **Account** - email, change password.
All PUTs full-row with zod validation; dirty-state guard on tab switch.

## 11. 🖥 System `/system` (pending screens: reply-detection view + job status)

**Reply-detection debug:** `GET /incoming-messages` table - time, mailbox, from, subject, classification chip (bounce/auto-reply/human/unrelated), DSN status, matched enrollment link, resulting events. Filter by classification/mailbox. This is the walkthrough's "How the IMAP Poller Classifies" made inspectable.
**Job status:** `GET /system/status` - scheduler last tick, transport mode chip (`MOCK` amber / `LIVE` green - always visible here and in the top bar while mock), per-mailbox poller freshness, pending jobs; **[Rebuild projections (dry-run)]** → results dialog.

## 12. Catch-up notice (pending screen; global)

`catchup_backlog` alert unacked → amber banner on Overview + Campaigns: downtime duration, sends due, the never-burst explanation (walkthrough Stage-5 panel), **[Acknowledge]** → `POST alerts/:id/ack`.

## 13. Login `/login`

Email + password → `POST auth/login`; error toast on 401/429; redirect to intended route.

## 14. Manual composer (Mode 1) - dialog from Lead detail / Leads row (§Stage 3)

Lead context header (company, tier, notes - the validation-phase profile card); campaign picker (defaults to active); mailbox display "auto-rotated: {suggested}" (server picks unless overridden); subject + body editors prefilled from the campaign sequence's step-1 template rendered for this lead (starting point to deviate from - Mode 1's definition); live checks strip (from preview endpoint); **[Send & log as manual]** → `POST /manual-sends` → toast + timeline refresh.
**Edge:** all mailboxes at cap/unhealthy → 409 `mailbox_unhealthy` → explanatory dialog. Fatal checks → 422 with checks listed.
