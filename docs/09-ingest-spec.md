# Ingest Spec — CSV Import, Hygiene, Tiering, Suppression, Recycling

> **Migration 0019 overlay:** `manual_subject`/`manual_body` create global copy sources and
> `step_N_subject`/`step_N_body` can bind exact personalized steps. Copy cells alone decode `\n`;
> assignment snapshots are independent; current tiers are A/B/Untiered with separate Nurture
> status. See [docs/22](22-personalized-copy-two-tier.md).

Implements walkthrough Stages 1–2 + 9, plan Stage 5. Lives in `apps/server/src/ingest/`.

---

## 1. CSV contract

Parsed with `csv-parse` (streaming, BOM-tolerant, `,`/`;`/tab auto-detect). Header row required; header matching is case-insensitive with alias map:

| Canonical field | Accepted headers |
|---|---|
| `email` (required) | email, e-mail, email_address, work_email |
| `first_name` | first_name, firstname, first, given_name |
| `last_name` | last_name, lastname, last, surname |
| `company` | company, company_name, business, brokerage |
| `website` | website, url, domain, site |
| `city` / `state` / `phone` / `notes` | same + obvious aliases |
| `manual_subject` / `manual_body` | special paired Step-1 draft columns; both required |
| anything else | preserved into `custom_fields` under its lowercase_snake_case header (usable as merge tags) |

File limits: ≤ 10 MB, ≤ 50,000 rows; reject otherwise with `import_too_large`.

## 2. Hygiene pipeline (runs at upload → preview; nothing committed yet)

Per row, in order — **first matching flag wins**, later checks skipped:

| Order | Flag | Rule |
|---|---|---|
| 1 | `invalid` | fails syntactic check: one `@`, non-empty local part, domain has ≥1 dot, no spaces, total ≤ 254 chars, TLD ≥ 2 alpha. (No MX/SMTP verification in-app — external verification is an explicit non-goal; the auto-pause rule is the runtime backstop.) |
| 2 | `role_based` | local part ∈ {info, sales, admin, administrator, support, contact, contactus, office, hello, team, billing, hr, careers, jobs, marketing, press, media, help, enquiries, inquiries, mail, postmaster, webmaster, noreply, no-reply, donotreply, abuse, security, privacy, legal, accounts, accounting, frontdesk, reception} |
| 3 | `duplicate` | normalized email seen earlier in this file (first occurrence kept) **or** already exists in `leads` |
| 4 | `suppressed` | normalized email ∈ `suppressions` — **compliance-critical: shown in preview and always dropped, even under "Import all"** |
| 5 | `missing_first_name` | first_name empty — **importable** (fallback merge tags), counted separately in the preview |
| 6 | `ok` | — |

Preview response = counts per flag + 20 sample rows per flag (walkthrough Stage 1 panel). Preview rows persist in `import_rows` so commit is exact even if the operator commits later.

## 3. Commit

`POST /imports/:id/commit { mode, draft_campaign_id?, replace_existing_drafts?, allocations? }`

- `drop_flagged`: insert rows flagged `ok` + `missing_first_name`.
- `import_all`: additionally insert `role_based` + `invalid`-lite… **No.** `invalid` and `suppressed` are *never* imported under either mode (undeliverable / illegal); `import_all` only additionally admits `role_based`. The preview labels the buttons accordingly ("Import 885" vs "Import 945 incl. role-based").
- Inserted leads: `tier = NULL` (untiered, decision R), `import_id` set, `custom_fields` populated. `import_rows.lead_id` backfilled. Fixture test locks the walkthrough split: 1,000 → 60 role + 40 invalid + 15 dup → 885 committed with 82 missing-name among them.
- When paired manual-draft columns are detected, commit requires one target campaign. Drafts are
  Step 1 only, start `needs_review`, and never enroll/activate/send. Existing unsuppressed leads may
  receive a draft without overwriting profile data; suppressed/erased leads do not. Existing
  unsent-draft conflicts skip unless replacement is explicitly selected. Results report lead and
  draft counts separately.
- The optional `allocations` list reserves exact counts into distinct draft/paused campaign pools,
  or active campaigns with automatic enrollment off. Archived campaigns and active campaigns
  with automatic enrollment on are excluded. Preview and commit both enforce this rule; commit
  locks each campaign row until the transaction completes. Import does not enroll or send.
  `POST /imports/:id/allocation-preview` reports requested/allocatable counts, exclusions, safely
  linked existing leads, and the global remainder before commit. Candidates follow accepted CSV
  row order. A safely allocatable existing duplicate may be reserved without overwriting its lead
  profile. Suppressed, erased, nurture, actively enrolled, already reserved, recontact-blocked,
  and target-content-conflicting leads are excluded.
- Manual-draft leads are reserved to their chosen draft campaign first and count inside that
  campaign's requested total. A request below the safe draft minimum is refused. Commit rechecks
  everything under a serializable transaction: if every exact requested count can no longer be
  met, neither leads, drafts, nor allocations commit. Unallocated accepted leads remain global.

### 3.1 Campaign lead pools

A pool reserves candidates; it does not enroll, activate, or send. Pool history is durable with
`available`, `enrolled`, and `released` states, source import, allocation order, and resulting
enrollment. One lead can be available in only one campaign pool at a time. The campaign becomes
permanently pool-backed after its first allocation.

Draft/paused campaigns may add the next N safe global leads in Tier A → B → C →
untiered, oldest-first order, or release/reassign selected available entries. Enrolled entries
cannot be moved. At enrollment time all compliance, recontact, active-enrollment, and
duplicate-content checks run again; temporary ineligibility is reported rather than bypassed.

## 4. Tiering (walkthrough Stage 2)

- Manual: `PATCH /leads/:id { tier }` and `POST /leads/bulk-tier { leadIds | filter, tier }` (filter = same query params as the list endpoint, so "select all 120 matching" works without shipping 120 ids).
- `enrolled_tier` snapshots at enrollment; later tier edits (Tier-C→B promotion, walkthrough 13c) affect only future enrollments. The promotion suggestion ("9 engaged Tier-C leads") is an analytics-screen action calling bulk-tier.
- Nurture: excluded from auto-enroll selection (docs/06 §7); enrollable only via explicit `leadIds` with `force: true` (deliberate act).

## 5. Suppression enforcement summary (defense in depth)

1. Ingest: `suppressed` flag, never imported (this file §2).
2. Enrollment: selection query excludes `is_suppressed` (docs/06 §7).
3. Send: `sendOne` re-checks `is_suppressed` at send time (covers suppression landing mid-sequence).
4. Event append: `unsubscribe`/`hard_bounce` upsert `suppressions` transactionally (docs/04 §3).

Removal (false positives only): decision U — typed-confirmation, audit alert.

## 6. Cold storage & recycling (walkthrough Stage 9, plan Stage 5)

- **Cold storage view** = query: enrollments `COMPLETED`, lead not suppressed; per lead: earliest-recycle date = `terminal_at + settings.cold_storage_rest_days` (default 60).
- **Recycle action:** preview then commit two or more source campaigns into one *draft* target.
  Leads are deduplicated across sources; confirmation recomputes rest, nurture, suppression,
  recontact, existing-target, and content-hash checks before inserting anything. The legacy
  single-source request remains accepted. Old enrollments stay COMPLETED and historical events are
  untouched.
- **No-identical-resend guard (decision Q), enforced per lead at commit:** if any active target
  variant `content_hash` exists in that lead's `sent_messages.content_hash`, skip and report that
  lead. Other eligible leads still commit atomically; duplicate content is never resent.
- Provenance lives in `campaign_recycle_sources` and `recycle_enrollment_sources`. The legacy
  `campaigns.recycled_from_campaign_id` is populated only when provenance has exactly one source.

## 7. Tests (B5)

Fixture `real_estate_leads.csv` (1,000 rows) reproducing the exact walkthrough split; alias-header
and BOM/semicolon parse cases; suppressed-address re-import dropped under both modes;
dup-within-file keeps first; exact multi-campaign pool allocation and atomic preview/commit drift;
bulk-tier by filter; nurture excluded from auto-enroll; recycle: rest-day gate, hash-conflict block,
changed-sequence pass; `import_all` never admits invalid/suppressed.
