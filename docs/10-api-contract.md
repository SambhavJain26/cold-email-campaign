# API Contract - v1 (frozen seam between backend and frontend)

All routes under `/api/v1`. JSON in/out. Session-cookie auth on everything except `POST /auth/login` and `GET /health`. Conventions per decision Z: error envelope `{"error":{"code","message","details?"}}`; lists return `{items, total, page, per_page}` with `?page=1&per_page=50` (max 200); timestamps ISO-8601 UTC. Executable schemas live in `packages/shared/src/api/` (decision H) - **a contract change edits this file and that package in the same commit.**

Shapes below in TS notation. `Metric = { numerator: number, denominator: number | null, value: number }` (docs/05 §2).

## Error codes (closed set)

`unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `validation` 400 · `conflict` 409 · `rate_limited` 429 · `capacity_exceeded` 409 · `recycle_sequence_conflict` 409 · `import_too_large` 413 · `mailbox_unhealthy` 409 · `sequence_invalid` 422 · `internal` 500

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
| GET `/mailboxes` | → `{items: Mailbox[]}` - `Mailbox = {id, display_name, from_address, smtp_host, smtp_port, imap_host, imap_port, daily_cap, effective_cap, send_window, status, status_reason, sent_today, hard_bounce_pct, seven_day_avg, last_successful_poll_at}` (no secrets, ever) |
| POST `/mailboxes` | `{display_name, from_address, smtp_host, smtp_port, imap_host, imap_port, auth_type, password, daily_cap, send_window}` → `Mailbox` - password sealed into `mailbox_secrets`, absent from response |
| PATCH `/mailboxes/:id` | any subset of the above (password optional) → `Mailbox` |
| POST `/mailboxes/:id/test-connection` | → `{smtp_ok, imap_ok, round_trip_ms?}` - calls `transport.verify` (mock: scripted; real: send+read-back) |
| POST `/mailboxes/:id/pause` / `/resume` | resume body `{cap_pct?: 50\|100}` → `Mailbox` - resume from `auto_paused` defaults 50 (walkthrough Stage 7) |
| POST `/mailboxes/:id/reconnect` | `{password}` → `Mailbox` - re-seal secret, verify, `auth_failed`→`ok` on success |
| GET `/mailboxes/volume?days=30` | → `{items: {mailbox_id, series: {date, sends}[]}[], imbalance: boolean}` (metric #5) |

## Leads & imports
| | |
|---|---|
| GET `/leads?tier=A\|B\|C\|nurture\|untiered&state=&campaign_id=&q=&suppressed=&page=` | → list of `Lead = {id, email, first_name, last_name, company, city, state, tier, is_suppressed, custom_fields, latest_enrollment?: {campaign_id, current_state, current_step_no}}` + `{untiered_count}` in meta |
| GET `/leads/:id` | → `Lead & {notes, timeline: EventView[]}` - full event history for the profile screen |
| PATCH `/leads/:id` | `{tier?, notes?, custom_fields?}` → `Lead` (edits `custom_observation` here) |
| POST `/leads/bulk-tier` | `{lead_ids?: number[], filter?: LeadFilter, tier}` → `{updated: number}` |
| POST `/imports` | multipart CSV → `{import_id, counts, samples: Record<flag, Row[]>}` (preview; nothing committed) |
| POST `/imports/:id/commit` | `{mode: 'drop_flagged'\|'import_all'}` → `{imported: number}` |
| GET `/imports` | → import history rows |
| DELETE `/suppressions/:email` | `{confirm: string}` (must equal the email) → `{ok}` - decision U; audit alert emitted |

## Sequences
| | |
|---|---|
| GET `/sequences` · POST `/sequences` · PATCH `/sequences/:id` | `Sequence = {id, name, stop_on_reply, stop_on_hard_bounce, stop_on_unsubscribe, steps: Step[]}`; `Step = {id, step_no, wait_days, in_thread, variants: Variant[]}`; `Variant = {id, label, subject_template, body_template, active}` - steps/variants are nested writes (replace-set semantics per save¹) |
| POST `/sequences/:id/preview` | `{lead_id, step_no, variant_id}` → `{subject, body, checks: {fatal[], warnings[], score, variations}}` - the Preview & Pre-send panel verbatim |
| POST `/sequences/validate-template` | `{template}` → `{tokens, errors, variations}` - live builder validation |

¹ Replace-set is literal only while the sequence has **zero sends**. Once sends exist (2026-07-23 operator decision): variants missing from a save are **retired** (`active=false`, rows kept - deleting would orphan variant analytics and punch holes in the content-hash recycle guard), and steps can be edited/added but not deleted or renumbered (violations → 422 `sequence_invalid`). Bespoke (Mode-1) variant rows are never touched by saves. Existing rows are matched by `id`; rows without `id` are inserted.

## Campaigns
| | |
|---|---|
| GET `/campaigns` · POST `/campaigns` `{name, sequence_id, tier_effort_config?, ramp_config?}` · PATCH `/campaigns/:id` (status: active/paused/archived) | `Campaign = {id, name, status, sequence_id, tier_effort_config, ramp_config, recycled_from_campaign_id, enrolled_count, contacted_count}` |
| GET `/campaigns/:id/capacity` | → `{total_daily_capacity, followups_due_today, sent_so_far_today, room_for_new, ramp_cap_remaining, suggested}` (docs/06 §7 - the capacity meter) |
| POST `/campaigns/:id/enroll` | `{count} \| {lead_ids, force?}` → `{enrolled, skipped: {reason, count}[]}` - 409 `capacity_exceeded` if count > suggested & !force; 409 `recycle_sequence_conflict` on hash guard |
| GET `/campaigns/:id/outcomes` | → `{UNSUBSCRIBED, BOUNCED, REPLIED: {positive, neutral}, COMPLETED, ACTIVE, NEW, total}` (Stage-9 completion panel) |
| POST `/campaigns/:id/recycle` | `{source_campaign_id}` → same shape as enroll |
| GET `/cold-storage?source_campaign_id=` | → `{items: {lead, completed_at, earliest_recycle_at, eligible: boolean}[]}` |

## Unibox
| | |
|---|---|
| GET `/unibox?bucket=human\|auto_reply&sentiment=&mailbox_id=&unhandled=&page=` | → `UniboxItem[] = {incoming_message_id, received_at, lead: {id, name, company}, campaign_id, step_no, snippet, effective_sentiment, suggested_sentiment, auto_unsubscribed: boolean, meeting_booked: boolean, enrollment_id}` - bucket `human` default; `auto_reply` is the OOO tab |
| GET `/unibox/:incoming_message_id` | → full item + body text + thread (prior sent messages) |
| POST `/unibox/:incoming_message_id/sentiment` | `{sentiment}` → item - appends `sentiment_tagged` (decision M) |
| POST `/enrollments/:id/meeting-booked` | → `{ok}` - appends `meeting_booked` (state unchanged) |
| POST `/enrollments/:id/snooze` | `{until}` → `{ok}` |
| POST `/enrollments/:id/unsubscribe` | → `{ok}` - manual unsubscribe (source `manual`), used with tag_only mode or by choice |
| POST `/manual-sends` | `{lead_id, campaign_id, mailbox_id?, subject, body}` → `{enrollment_id, message_id, checks}` - Mode-1 composer: enrolls if needed, renders (footer+checks), sends via transport, logs `sent`. 409 `mailbox_unhealthy` / fatal checks → 422 |

## Reply-detection debug (Stage-7 pending screen)
| | |
|---|---|
| GET `/incoming-messages?classification=&mailbox_id=&page=` | → `{id, mailbox_id, from_address, subject, classification, dsn_status, matched_enrollment_id, resulting_event_ids, processed_at}` - the 4-bucket view, straight off `incoming_messages` |

## Analytics
| | |
|---|---|
| GET `/analytics/overview?campaign_id=` | → `{progress: {contacted, total, pct}, reply_rate: Metric, positive_rate: Metric, meetings: {count, per_100}, hard_bounce_rate: Metric, soft_bounce_rate: Metric, unsubscribe_rate: Metric, capacity: Capacity, watch_flags: string[]}` |
| GET `/analytics/variants?sequence_id=&step_no=1` | → per-variant `{variant_id, label, subject_template, sent, reply_rate, positive_rate, meetings}` (13a) |
| POST `/step-variants/:id/deactivate` | → `{ok}` ("route all to B") |
| GET `/analytics/steps?sequence_id=` | → per-step `{step_no, delivered, positive_replies, positive_rate}` (13b) |
| GET `/analytics/tiers?campaign_id=` | → per-tier `{tier, contacted, reply_rate, positive_rate, meetings, mode}` + `{promotable: {tier_c_engaged: number}}` (13c) |
| GET `/analytics/health-trend?days=30` | → daily series + sparkline aggregates + watch-rule statuses (13d) |

## Settings, compliance, alerts, system
| | |
|---|---|
| GET/PUT `/settings` | full `settings` row (docs/03) - PUT validates ranges (e.g. `pause_hard_pct` 1-20) |
| GET/PUT `/compliance` | `{physical_address, optout_text}` - PUT with empty address → 422 (sends would halt) |
| GET `/alerts?unacked=true` · POST `/alerts/:id/ack` | `Alert = {id, kind, severity, payload, created_at, acknowledged_at}` - feeds banners: `catchup_backlog` → downtime panel; `mailbox_*` → failure panels |
| GET `/health` | → `{ok, db, version}` (unauthenticated) |
| GET `/system/status` | → `{scheduler_last_tick_at, transport_mode, pollers: {mailbox_id, last_successful_poll_at}[], pending_jobs}` |
| POST `/system/rebuild-projections` | `{dry_run: boolean}` → `{diffs: number, details?}` |

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
