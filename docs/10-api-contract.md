# API Contract — v1 (frozen seam between backend and frontend)

> **Migration 0019 additive contract:** sequence writes include
> `content_source=template|personalized`; Personalized Copy source/campaign-step APIs replace manual
> draft/send APIs; Leads accepts `campaign_id` plus `campaign_scope=pool|enrolled|both`; current
> tier writes allow A/B/null and use separate `outreach_status`. Legacy manual endpoints return
> `410 Gone`. See [docs/22](22-personalized-copy-two-tier.md).

All routes under `/api/v1` **except** `GET /health`, public Google callback
`GET /oauth/google/callback`, and the public unsubscribe pair `GET|POST /u/:token`. The production
gateway prefixes the app/API/callback with `/email-campaign` while leaving unsubscribe hosts at
`/u/:token`. Public routes inherit neither session auth nor the API CSRF-header check. JSON in/out
except the callback and unsubscribe HTML. Session-cookie auth on everything except
`POST /auth/login`, `GET /health`, the callback, and `/u/:token`. Conventions per decision Z: error
envelope `{"error":{"code","message","details?"}}`; lists return `{items, total, page, per_page}`
with `?page=1&per_page=50` (max 200); timestamps ISO-8601 UTC. Executable schemas live in
`packages/shared/src/api/` (decision H) — **a contract change edits this file and that package in
the same commit.**

Shapes below in TS notation. `Metric = { numerator: number, denominator: number | null, value: number }` (docs/05 §2).

## Error codes (closed set)

`unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `validation` 400 · `conflict` 409 · `rate_limited` 429 · `capacity_exceeded` 409 · `import_too_large` 413 · `mailbox_unhealthy` 409 · `sequence_invalid` 422 · `internal` 500. `recycle_sequence_conflict` remains a deprecated client-code compatibility value; current recycling reports content conflicts in its preview/commit breakdown instead of failing the whole action.

---

## Auth
| Method & path | Body → Response | Notes |
|---|---|---|
| POST `/auth/login` | `{email, password}` → `{ok: true}` + session cookie | 5/min/IP rate limit |
| POST `/auth/logout` | → `{ok: true}` | |
| GET `/auth/me` | → `{email}` | 401 if no session |
| POST `/auth/change-password` | `{current, next}` → `{ok}` | |

## Mailboxes
| | |
|---|---|
| GET `/mailboxes` | → `{items: Mailbox[]}` — `Mailbox` includes `auth_type: 'app_password'\|'google_oauth'` and `oauth_connected`, plus identity, connection metadata, caps, windows, health and poll fields. No password, refresh token, access token, or OAuth state is ever returned. |
| POST `/mailboxes` | common connection/cap/window/folder fields plus `auth_type`. `app_password` requires `password`, which is sealed. `google_oauth` requires no password and starts `setup_required`, which the scheduler cannot select. Guardrails and per-folder UIDNEXT seeding still apply. |
| PATCH `/mailboxes/:id` | any subset of the above (password optional) → `Mailbox` |
| GET `/mailboxes/:id/folders` | → `{items: {name, special_use?}[]}` — authenticated read-only discovery; no message content or credentials |
| POST `/mailboxes/:id/test-connection` | → `{smtp_ok, imap_ok, round_trip_ms?, folders: {name, exists, special_use?}[]}` — calls `transport.verify` and checks every configured folder |
| POST `/mailboxes/:id/pause` / `/resume` | resume body `{cap_pct?: 50\|100}` → `Mailbox` — resume from `auto_paused` defaults 50 (walkthrough Stage 7) |
| POST `/mailboxes/:id/reconnect` | `{password}` → `Mailbox` — re-seal secret, verify, `auth_failed`→`ok` on success |
| POST `/mailboxes/:id/oauth/google/start` | → `{authorization_url}` — creates short-lived hashed one-time state plus PKCE; requests offline access. Requires the production OAuth client configuration. |
| GET `/oauth/google/callback` | **Not under `/api/v1`.** Validates state/expiry/replay and PKCE, requires a refresh token, verifies the Google account equals the mailbox address, stores only the encrypted refresh credential, and redirects to Mailboxes. Production path is `/email-campaign/oauth/google/callback`. |
| POST `/mailboxes/:id/oauth/google/disconnect` | → `Mailbox` — best-effort Google revoke, deletes the sealed refresh credential, clears in-memory access, and returns the mailbox to `setup_required`. Use the start endpoint again to reconnect. |
| GET `/mailboxes/volume?days=30` | → `{items: {mailbox_id, series: {date, sends}[]}[], imbalance: boolean}` (metric #5) |

## Leads & imports
| | |
|---|---|
| GET `/leads?tier=A\|B\|C\|nurture\|untiered&state=NEW\|ACTIVE\|REPLIED\|BOUNCED\|UNSUBSCRIBED\|COMPLETED&campaign_id=&pool_campaign_id=&q=&suppressed=&page=` | → list of `Lead = {id, email, first_name, last_name, company, city, state, tier, is_suppressed, custom_fields, pool_assignment?, latest_enrollment?}` + `{untiered_count}` in meta. `pool_campaign_id` filters durable pool membership. |

> **`state` is the ENROLLMENT state machine, not `leads.state`** (the postal column, which is returned in the DTO but is not filterable). The parameter was originally written as a bare `state=`; the frontend read it as the enrollment state and the backend implemented it against `leads.state`, so every state filter in the UI silently returned zero rows while the api suite — which asserted `state=TX` — stayed green. Disambiguated 2026-08-07 (docs/17 §0 finding 17). When `campaign_id` is also supplied, both must match the **same** enrollment.

| GET `/leads/:id` | → `Lead & {notes, timeline: EventView[]}` — full event history for the profile screen |
| POST `/leads` | `{email, first_name?, last_name?, company?, website?, city?, state?, phone?, notes?}` → `{created, reason?}`. Finding 10. Runs the **same** preview+commit as a CSV upload (one-row CSV, `drop_flagged` mode) so normalization, dedup, hygiene and the commit-time suppression re-check cannot diverge from the bulk path — `created:false` carries the refusing flag (`invalid\|duplicate\|suppressed\|role_based`). Costs one `imports` row per lead, deliberately: it really is an import, and the audit trail stays whole |
| PATCH `/leads/:id` | `{tier?, notes?, custom_fields?}` → `Lead` (edits `custom_observation` here) |
| POST `/leads/bulk-tier` | `{lead_ids?: number[], filter?: LeadFilter, tier}` → `{updated: number}` |
| POST `/imports` | multipart CSV → `{import_id, counts, samples, personalized_copy}` (preview; nothing committed) |
| POST `/imports/:id/allocation-preview` | `{mode, allocations:[{campaign_id,count,generic_copy_step_no?}]}` → requested/allocatable campaign totals, exclusions, copy-binding outcomes, safe existing leads, and global remainder. Read-only. A multi-personalized-step campaign requires an explicit generic destination; a one-step campaign resolves it automatically. |
| POST `/imports/:id/commit` | `{mode, copy_readiness?, replace_existing_copy?, allocations?}` → separate lead/source/campaign-copy/allocation counts and global remainder. Exact allocations and destinations are rechecked and committed atomically; drift aborts the whole commit. Legacy draft fields remain accepted for old clients only. |
| POST `/imports/:id/copy-update-preview` | `{campaign_id,generic_copy_step_no?,page?}` → fingerprint, complete status counts, total entries, and up to 100 entries per page. Requires a draft/paused campaign; matches enrolled or available pooled leads only. Sent/retry snapshots are protected. |
| POST `/imports/:id/copy-update-commit` | Same selection plus `fingerprint` → atomic eligible unsent replacements marked Ready and immutable `update_copy` import history. Rechecks status, membership, copy and sent/retry inputs under locks; stale preview → 409, invalid/conflicting rows → 422. Creates no leads, allocations, enrollments or sends. |

| GET `/imports` | → import history rows including durable per-campaign pool allocation summaries and preview-only attempts |
| DELETE `/imports/:id` | → `{ok}` for an uncommitted preview and its staged rows. Committed import history returns 409 and is immutable. |
| DELETE `/suppressions/:email` | `{confirm: string}` (must equal the email) → `{ok}` — decision U; audit alert emitted |
| GET `/leads/:id/personalized-copies` | → reusable sources plus campaign/step snapshots, readiness, provenance, hashes, and sent state |
| PUT `/leads/:id/personalized-copy-sources/:slot` | save draft or mark ready for reusable lead copy; never sends |
| PUT `/leads/:id/campaigns/:campaignId/steps/:stepNo/personalized-copy` | save/ready/copy-from-source for an exact personalized step; sent copy is immutable |

Import allocation targets may be draft, paused, or active with automatic enrollment off.
Archived campaigns and active campaigns with automatic enrollment on return 409. Preview and
commit enforce the same rule, and commit holds a campaign row lock through allocation. Import
never activates, enrolls, or sends. Request and response schemas are unchanged.

## Sequences
| | |
|---|---|
| GET `/sequences` · POST `/sequences` · PATCH `/sequences/:id` | `Sequence` includes `variable_defaults`; steps/variants remain nested replace-set writes¹ |
| POST `/sequences/:id/preview` | `{lead_id, step_no, variant_id?, campaign_id?, mailbox_id?}` → complete text `body`, `email_format`, checks, readiness for personalized content, and a resolution trace containing the resolved Tier A researched/Tier B auto mode. Template preview requires a variant. Personalized preview requires campaign context and loads that lead's exact campaign-step copy. Optional mailbox selects the signature domain for preview only; omitted uses an explicit domain placeholder and unknown IDs return 404. |
| POST `/sequences/validate-template` | `{template}` → `{tokens, errors, variations}` — live builder validation |

¹ Replace-set is literal only while the sequence has **zero sends**. Once sends exist (2026-07-23 operator decision): variants missing from a save are **retired** (`active=false`, rows kept — deleting would orphan variant analytics and punch holes in the content-hash recycle guard), and steps can be edited/added but not deleted or renumbered (violations → 422 `sequence_invalid`). Bespoke (Mode-1) variant rows are never touched by saves. Existing rows are matched by `id`; rows without `id` are inserted.

## Campaigns
| | |
|---|---|
| GET `/campaigns` · POST `/campaigns` · PATCH `/campaigns/:id` | Campaign includes fixed A=Researched/B=Auto behavior, staged ramp, permanent daily cap, first activation, Auto Observation, variable overrides/frozen snapshot, lead-selection mode, pool summary, auto-enrollment status/last run, provenance, and counts: enrolled, contacted (accepted recipients), delivery-confirmed, pending confirmation, finished, and finishing. Personalization/ramp patches are draft-only; an activated permanent cap can decrease but not increase. |
| GET `/campaigns/:id/capacity` | → capacity plus `ramp_day`, current `ramp_stage`, `effective_daily_enroll_cap`, `campaign_cap_remaining`, `pending_openers_today`, shared `room_for_new`, `pool_available`, and `enrolled_today` |
| POST `/campaigns/:id/enroll` | `{count} \| {lead_ids, force?, allow_recontact?}` → `{enrolled, skipped: {reason, count}[]}`. Pool-backed count enrollment draws only from its available pool; legacy global campaigns retain the global selector. Manual and automatic enrollment share the effective daily cap. Explicit recontact requires `allow_recontact:true`, completed reply disposition, and an elapsed `not_now` date; suppression is never overrideable. |
| GET `/campaigns/:id/pool?status=&page=&per_page=` | → paginated pool entries plus total/available/enrolled/released/temporarily-ineligible/source-import summary |
| POST `/campaigns/:id/pool/add` | `{count, source_import_id?}` → `{changed, skipped}`; reserves the next safe global leads by tier then age |
| POST `/campaigns/:id/pool/release` | `{lead_ids}` → `{changed, skipped}`; available entries only |
| POST `/campaigns/:id/pool/reassign` | `{lead_ids, target_campaign_id}` → `{changed, skipped}`; atomically moves eligible available entries between draft/paused campaigns |
| PATCH `/campaigns/:id/auto-enrollment` | `{enabled, acknowledge_auto_enrollment?}` → `{campaign, run}`. Enabling an active campaign requires acknowledgement and performs one bounded immediate run. |
| GET `/campaigns/:id/auto-enrollment/runs?page=&per_page=` | → paginated run audit history |
| GET `/campaigns/:id/outcomes` | → `{UNSUBSCRIBED, BOUNCED, REPLIED: {positive, neutral}, COMPLETED, ACTIVE, NEW, total}` (Stage-9 completion panel) |
| POST `/campaigns/:id/recycle/preview` | `{source_campaign_ids:[at least two unique ids]}` → read-only `{breakdown, sources}` with unique leads, duplicates, every exclusion category, eligible count, and per-source candidate/eligible counts |
| POST `/campaigns/:id/recycle` | `{source_campaign_ids:[at least two unique ids]}` → recomputed atomic `{enrolled, skipped, breakdown, sources}`. Legacy `{source_campaign_id}` remains accepted. Conflicting content is skipped and reported; source enrollments/history stay untouched. |
| GET `/cold-storage?source_campaign_id=&page=&per_page=` | → `{items: {lead, completed_at, earliest_recycle_at, eligible: boolean}[], total, page, per_page}` |

## Unibox
| | |
|---|---|
| GET `/unibox?bucket=human\|auto_reply&sentiment=&mailbox_id=&unhandled=&page=` | → `UniboxItem[]` including `disposition`, `recontact_after`, and `lead_suppressed`. `unhandled=true` means a human reply still lacks an operator disposition. |
| GET `/unibox/:incoming_message_id` | → `UniboxItem & {body_text, thread: {message_id, step_no, sent_at}[]}` — full reply text from `incoming_messages.body_text` (0007) |
| POST `/unibox/:incoming_message_id/sentiment` | `{sentiment}` → item — appends `sentiment_tagged` (decision M) |
| POST `/unibox/:incoming_message_id/disposition` | `{disposition, recontact_after?}` → item — appends `reply_dispositioned`. `not_now` requires a future date; `not_interested`, `wrong_person`, and `explicit_unsubscribe` append global unsubscribe suppression atomically. |
| GET `/reminders?view=due_today\|upcoming\|overdue\|all&status=open\|done\|dismissed&page=` | → paginated reminder list plus `open_count` |
| POST `/unibox/:incoming_message_id/reminders` | `{due_date, note?}` → `{ok}` — creates an in-app task only |
| PATCH `/reminders/:id` | `{due_date?, note?, status?}` → `{ok}` — edit, complete, or dismiss; never changes contact permission or sends |
| POST `/enrollments/:id/meeting-booked` | → `{ok}` — appends `meeting_booked` (state unchanged) |
| POST `/enrollments/:id/snooze` | `{until}` → `{ok}` — backward-compatible ACTIVE-enrollment scheduling only; replied enrollments must use reminders |
| POST `/enrollments/:id/unsubscribe` | → `{ok}` — manual unsubscribe (source `manual`), used with tag_only mode or by choice |
| Legacy manual prefill/draft/send routes | Return `410 Gone` with sequence-only Personalized Copy guidance. Historical rows remain readable through current history/copy views. |

## Reply-detection debug (Stage-7 pending screen)
| | |
|---|---|
| GET `/incoming-messages?classification=&mailbox_id=&page=` | → `{id, mailbox_id, from_address, subject, classification, dsn_status, matched_enrollment_id, resulting_event_ids, processed_at}` — the 4-bucket view, straight off `incoming_messages` |

## Analytics
| | |
|---|---|
| GET `/analytics/overview?campaign_id=` | → `{progress: {contacted, total, pct}, delivery_confirmation:{confirmed,pending}, reply_rate: Metric, positive_rate: Metric, meetings: {count, per_100}, hard_bounce_rate: Metric, soft_bounce_rate: Metric, unsubscribe_rate: Metric, capacity: Capacity, watch_flags: string[]}`. Contacted is the distinct accepted-send cohort. |
| GET `/analytics/variants?campaign_id=&step_no=` | → every automated, inactive historical, and sent bespoke variant for the selected step. Explicit `direct` metrics use replies whose persisted thread match points to that step; `eventual` metrics follow the complete enrollment cohort through later replies/meetings. Legacy top-level fields remain aliases. |
| POST `/step-variants/:id/deactivate` | → `{ok}`; transactionally refuses bespoke variants and the final active automated variant for that step. Historical results remain visible. |
| GET `/analytics/steps?sequence_id=` | → `{items: {step_no, sent, delivered, pending_delivery_confirmation, replies, reply_rate, positive_replies, positive_rate}[]}` (13b) — also accepts `?campaign_id=`. Rows anchor on sent cohorts, so early replies appear before delayed confirmation. |
| GET `/analytics/tiers?campaign_id=` | → per-tier `{tier, contacted, delivered, pending_delivery_confirmation, reply_rate, positive_rate, meetings, mode}` + legacy promotion metadata (13c) |
| GET `/analytics/health-trend?days=30&campaign_id?=` | → `{items: DailySeries[], totals, watch_flags: {rule, message}[]}` (13d — executable form per B6.13) |

## Settings, compliance, alerts, system
| | |
|---|---|
| GET/PUT `/settings` | full `settings` row. PUT validates ranges; `delivery_confirm_hours` is immutable after the first `sent` event so replay cannot drift (finding 24). |
| GET/PUT `/compliance` | `{email_format, physical_address, optout_text, signature_name, signature_role_line, unsubscribe_base_url}` — `email_format` is `plain_text` (default) or `minimal_html`. Signature fields are required trimmed single lines, with maximum lengths 100 and 160. PUT with empty address → 422 (sends would halt). `unsubscribe_base_url` is `''` (text opt-out), a fixed `https://` origin, or `https://unsubscribe.{sender_domain}`. The placeholder resolves from the mailbox From domain before `/u/<token>` is appended. |
| GET `/alerts?unacked=true` · POST `/alerts/:id/ack` | `Alert = {id, kind, severity, payload, created_at, acknowledged_at}` — feeds banners: `catchup_backlog` → downtime panel; `mailbox_*` → failure panels |
| GET `/health` | → `{ok, db, version}` (unauthenticated) |
| GET `/u/:token` | **Not under `/api/v1`.** Unauthenticated, no CSRF, and never unsubscribes. A valid active token shows `Confirm, and I won’t send you any more emails.`; a valid token for an already-unsubscribed enrollment shows the completed state with no form. Unknown tokens remain generic (no enumeration oracle). |
| POST `/u/:token` | **Not under `/api/v1`.** Unauthenticated, no CSRF — Gmail's RFC 8058 one-click POST carries neither cookie nor custom header. Appends `unsubscribe` with `source: 'link'` and creates the global suppression; idempotent when the enrollment is already `UNSUBSCRIBED`. Returns HTML, not JSON. Never logs the token, email or lead id |
| GET `/system/status` | → `{scheduler_last_tick_at, transport_mode, pollers: {mailbox_id, last_successful_poll_at}[], pending_jobs}` |
| GET `/system/preflight` | → `{ready, checks: {id, label, status, detail}[]}` where `status` is `pass\|warn\|fail\|unknown`. Read-only domain-readiness report (docs/16 §8 item 3): SPF/DMARC/DKIM/MX per distinct sending domain plus compliance address, mailbox health, caps and staged enrollment. `ready` means nothing **failed** — it is not a deliverability promise, and DKIM reports `unknown` rather than `fail` because selectors cannot be enumerated over DNS |
| POST `/system/rebuild-projections` | `{dry_run: boolean}` → `{diffs: number, details?}` |

## Pre-canary contract additions

| Endpoint / DTO | Contract |
|---|---|
| Mailbox create, patch, response | `timezone`: canonicalized IANA timezone and validated against both runtime Intl and PostgreSQL `pg_timezone_names`; mailbox-local midnight resets its daily capacity. `Asia/Calcutta` is stored as `Asia/Kolkata`. |
| GET `/system/status` | Adds `send_blockers: {code, message}[]`; empty when no due work is blocked. |
| POST `/leads/:id/erase` | `{confirm: current_email}`; irreversible PII anonymization, with an unsubscribe event for active work. |
| DELETE `/campaigns/:id` | `{confirm: campaign_name}`; 409 if any event, enrollment, or dependency remains. |
| DELETE `/sequences/:id` | `{confirm: sequence_name}`; 409 if campaign or sent-content history remains. |
| Outbound transport/render | Canonical text plus an optional matching escaped HTML alternative (`multipart/alternative` in SMTP). |

## Events emitted per mutating endpoint (traceability)

| Endpoint | Events appended |
|---|---|
| enroll / recycle | `enrolled` ×N |
| manual-send | (`enrolled`?) + `sent` |
| sentiment | `sentiment_tagged` |
| meeting-booked | `meeting_booked` |
| enrollment unsubscribe | `unsubscribe(source=manual)` |
| commit import / bulk-tier / settings / mailboxes / sequences | none (not lead-history facts) |

Scheduler and poller event emissions: docs/06 §5, docs/07 §2.
