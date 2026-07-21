# Ingest Spec — CSV Import, Hygiene, Tiering, Suppression, Recycling

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

`POST /imports/:id/commit { mode: 'drop_flagged' | 'import_all' }`

- `drop_flagged`: insert rows flagged `ok` + `missing_first_name`.
- `import_all`: additionally insert `role_based` + `invalid`-lite… **No.** `invalid` and `suppressed` are *never* imported under either mode (undeliverable / illegal); `import_all` only additionally admits `role_based`. The preview labels the buttons accordingly ("Import 885" vs "Import 945 incl. role-based").
- Inserted leads: `tier = NULL` (untiered, decision R), `import_id` set, `custom_fields` populated. `import_rows.lead_id` backfilled. Fixture test locks the walkthrough split: 1,000 → 60 role + 40 invalid + 15 dup → 885 committed with 82 missing-name among them.

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
- **Recycle action:** `POST /campaigns/:id/recycle { source_campaign_id }` on a *draft* campaign: selects that source's cold-storage leads past their rest date and enrolls them (fresh enrollments; the old ones stay COMPLETED — per-campaign state machine is exactly what makes this work).
- **No-identical-resend guard (decision Q), enforced at enrollment:** block if any active variant `content_hash` in the target sequence ∈ that lead's received hashes (`sent_messages.content_hash`). API returns `recycle_sequence_conflict` listing the offending steps → the UI message "Do NOT resend the same emails" becomes a hard rule, not advice.
- Recycled enrollments tagged via `campaigns.recycled_from_campaign_id` (drives the "Recycled — Pass 2" label).

## 7. Tests (B5)

Fixture `real_estate_leads.csv` (1,000 rows) reproducing the exact walkthrough split; alias-header and BOM/semicolon parse cases; suppressed-address re-import dropped under both modes; dup-within-file keeps first; bulk-tier by filter; nurture excluded from auto-enroll; recycle: rest-day gate, hash-conflict block, changed-sequence pass; `import_all` never admits invalid/suppressed.
