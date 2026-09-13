# Personalized Copy, Two Tiers, and Campaign Lead Filtering

**Status:** implemented, verified, pushed, and deployed on Spaceship. The migration `0019` release
landed on 2026-08-30 and the import-wizard clarity application release `a15f70d` followed on
2026-08-31. Campaign activation, enrollment, and sending still require separate operator
authorization. The follow-up changed no schema, campaign state, enrollment, or sending logic.

**Post-walkthrough corrections (2026-09-01):** the owner-address production walkthrough exposed
clarity and early-metric defects around this model. Deployed application commit `8ed86a4` now keeps
Personalized Copy scope fixed across Copy-from-Source/save refetches, names the exact target on
actions, previews personalized steps from the Sequence screen, derives campaign preview mode from
the selected lead's A/B tier, warns on zero-day follow-ups, and explains personalized steps have no
variants in Analytics. These corrections are application-only and add no migration.

This document is the authoritative specification for migration `0019` and supersedes older
current-behavior descriptions of Manual Compose, human-written delivery mode, Tier C as a current
lead choice, and Nurture as a tier. Historical records and legacy labels remain readable.

## 1. Current content model

Sequence steps choose one content source:

- `template`: one or more active variants. Tier A renders the researched-observation path; Tier B
  renders the campaign's Auto Observation rules.
- `personalized`: no variants. The scheduler loads the ready subject/body snapshot for that exact
  lead, campaign, and stable sequence-step ID.

Personalized copy is sequence content, not a tier or a special send mode. Every send goes through
the sequence scheduler and therefore retains suppression, reply stopping, pacing, caps, send
windows, mailbox pinning, threading, footer, risk checks, transport confirmation, and event
logging. The retired manual-send endpoint returns `410 Gone` with sequence-only guidance.

Current lead choices are Tier A, Tier B, or Untiered. Nurture is the separate
`outreach_status=nurture` hold. New enrollments snapshot fixed modes: A =
`template_researched`, B = `template_auto`. Untiered and Nurture leads cannot enroll. Historical
Tier C, Nurture-tier, and `human_written` rows remain available to analytics with Legacy labels;
legacy human-written due work stays held.

## 2. Personalized-copy storage and lifecycle

`personalized_copy_sources` stores globally imported or operator-written copy by lead and slot.
`campaign_personalized_copies` stores independent snapshots by lead, campaign, and sequence-step
ID. Copy-on-assignment occurs when import allocation or campaign-pool membership can identify the
target personalized step. A later source edit never rewrites a bound campaign snapshot.

Complete subject/body pairs begin as `needs_review`. Operators can save a draft, mark valid copy
ready, or explicitly copy/re-copy from a source. Editing content resets it to `needs_review`.
Incomplete pairs are invalid. A sent campaign copy is immutable. PII erasure scrubs source copy,
campaign copy, and rendered sent snapshots while preserving event lineage.

Personalized Step 1 must be ready before enrollment. A later personalized step may be completed
after enrollment; if it becomes due without ready copy, only that enrollment is held. Durable
`personalized_copy_blocked` alerts distinguish missing, needs-review, invalid-copy, and content
conflict episodes. Supplying valid ready copy clears the active episode. No Auto Observation or
template fallback can replace missing personalized copy.

`sent_messages` stores the exact rendered subject, text body, HTML body, content source, and
personalized-copy ID for new sends. Soft-bounce retries reuse this immutable snapshot. In-thread
steps retain their saved subject for audit but send `Re: <exact conversation-start subject>`.
A later step configured to start a new conversation resets both this subject anchor and the MIME
References boundary for the continued steps that follow it.

## 3. CSV import

Generic source columns remain supported:

```csv
email,manual_subject,manual_body
alex@example.com,A specific subject,"Hi Alex\n\nI noticed the Austin launch."
```

Step-specific columns bind directly when the numbered sequence step is personalized:

```csv
email,step_1_subject,step_1_body,step_3_subject,step_3_body
alex@example.com,First subject,"First body",A later angle,"Later body"
```

`manual_subject`/`manual_body` form the default source slot. For every campaign allocation, the
wizard shows where that generic pair will go. A campaign with exactly one personalized step binds
it automatically. A campaign with multiple personalized steps requires an explicit target step
before commit; the UI and API never guess. A campaign with no personalized step keeps the pair as
reusable lead copy only. `step_N_*` pairs map directly to compatible Personalized Copy steps and do
not need the generic destination selector. Incompatible mappings remain unassigned and are
reported. Conflicting generic and Step 1 values are reported rather than silently prioritized.

Within personalized-copy cells, an unescaped `\n` becomes a real line break and `\\n` remains the
literal characters `\n`. This decoding does not affect normal lead/custom fields. RFC-compliant
quoted multiline CSV cells continue to work.

Imports report created, replaced, skipped, invalid, assigned, conflicting, and unassigned copy.
Existing source and bound copy wins unless replacement is explicitly requested. The representative
1,000-row flow is atomic: all 1,000 global leads and sources can be created, 100 allocated/bound to
Campaign 1, 100 allocated/bound to Campaign 2, and 800 left globally unassigned.

The preview presents three decisions in order: safe-address admission, imported-copy review and
replacement status, then campaign/count/copy destination per allocation. Its final summary uses
campaign names and states exact row order, copy readiness, step bindings, global remainder, and
that import does not activate, enroll, or send.

## 4. Leads page and exact bulk actions

The Leads page has a visible Campaign filter. Selecting a campaign adds a scope selector:

- `Pool`: currently available pool members only.
- `Enrolled`: every enrollment state for that campaign.
- `Both`: the deduplicated union, and the visible default.

Released-only pool rows are excluded unless that lead independently has an enrollment. The filter
composes with current tier/Untiered, Nurture status, enrollment state, search, suppression, and
pagination. Listing and “select all matching” share the same server predicate, so bulk changes
apply exactly to the displayed Campaign + scope cohort.

Bulk actions set Tier A, Tier B, or Untiered, and separately set Nurture or restore from Nurture.
Restoring from Nurture returns the lead to Untiered. The untiered banner/count is filter-scoped and
preserves campaign membership scope when it opens bulk tiering. The tier header is returned by the
same complete server filter predicate as the list and select-all-matching action. If a successful
bulk action makes the active filter empty, the page explains why and offers a one-click return to
the campaign cohort.

The lead Edit card keeps arbitrary custom fields, Custom Observation, Notes, suppression, PII
erasure, and the event timeline. Its Personalized Copy editor selects **Reusable lead copy · not
assigned to a campaign** or a Campaign + Personalized Step and exposes subject/body, provenance,
readiness, preview/risk checks, target-named Save Draft/Mark Ready/Copy actions. Sent copy is
read-only. Its preview labels **Saved copy subject (audit)** separately from **Subject actually
sent**, loaded from the immutable sent-message snapshot (`sent_subject` in the campaign-copy list
DTO). Historical null snapshots are explicitly unavailable rather than reconstructed. Campaign-
filtered Leads displays that campaign's pool provenance, including enrolled/released rows, or
**Direct enrollment** when no matching pool record exists. Authoritative lead edits remount the form if tier/status/custom fields/notes changed, so
an unrelated save cannot submit a stale tier after bulk editing.

## 5. Campaign and sequence behavior

The sequence editor requires variants for template steps and forbids variants for personalized
steps. A step's content source cannot change after that sequence has sent mail. Campaign screens
show the fixed A = Researched and B = Auto behavior, preserve Auto Observation configuration, and
show per-personalized-step coverage: ready, needs review, missing, blocked, and total. Enrollment
preview returns candidate-level blockers. Sequence preview renders exact campaign-step
Personalized Copy without inventing a variant; campaign-context template preview exposes the
selected lead's resolved Tier A/Tier B mode. Non-first zero-day waits are explicitly labeled as
immediately due.

Campaign pool additions and reassignment apply copy-on-assignment without overwriting existing
campaign copy unless replacement is explicit. Untiered leads may be reserved in pools and show an
`untiered` blocker, but cannot enroll until assigned A or B. Nurture leads remain excluded.

## 6. Compatibility and deployment gate

The API accepts `campaign_id` plus `campaign_scope=pool|enrolled|both`; omitted scope preserves the
legacy enrolled-only meaning. `pool_campaign_id` remains temporarily supported. Personalized-copy
APIs cover source and campaign-step create/edit/ready/copy/list/preview operations. Old manual
prefill, draft, and send endpoints return `410 Gone`.

Import allocation bodies accept optional `generic_copy_step_no`. Preview responses expose each
campaign's personalized step numbers, resolved/required generic destination, and bound/unassigned
copy totals. `draft_campaign_id` remains accepted for older clients but is absent from the current
allocation UI.

Migration `0019_personalized_copy_two_tiers` preserves IDs, provenance, readiness, sent linkage,
timestamps, historical enrollment snapshots, and a reversible backup of previous current tiers.
The 2026-08-30 deployment verified zero legacy human-written campaigns/enrollments, validated
pre/post backups, applied migration 0019, and repeated health, zero-drift, self-check, route, and
dormant-send-state checks. Future deployments must repeat the same gates. Deployment never implies
activation, enrollment, or send permission.
