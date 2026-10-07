# Decision Register

## Incoming human-review redesign (2026-10-08; authorized local implementation)

The approved specification in docs/24 supersedes pre-real-domain AA–AC, operator-workflow BB,
Decision U and conflicting October 6 company stopping **for new intake only**. New matched
responses hold for operator review unless conservative new-text opt-out detection mandates
permanent global suppression. Human authorship confirmation is metric-only; Continue/Stop/Delay
are separate campaign decisions. Suppression is permanent and survives erasure as a minimal
normalized-address block. Old events retain their meaning, with explicit audited restoration to
review hold for eligible STOPPED/REPLIED histories. Review visibility and removable incoming
content are independent. No implementation/deployment verification is implied by this decision.

> **Current decision overlay (migration 0019):** sequence steps, not tiers, choose Template or
> Personalized Copy; current tiers are A/B/Untiered; Nurture is a separate outreach status; all
> sends are scheduler-only. [Docs/22](22-personalized-copy-two-tier.md) supersedes conflicting
> Mode 1/Manual Compose/Tier C current-behavior entries below while preserving them as history.

## Personalized Copy decisions (2026-08-30)

| ID | Decision | Rationale |
|----|----------|-----------|
| PC1 | Personalized copy is a sequence-step content source, never a lead tier or delivery mode. | The same lead can receive personalized Steps 1 and 3 with different copy while template steps remain category-driven. |
| PC2 | All mail sends through the scheduler; old manual-send routes return 410. | One delivery pipeline preserves reply locks, suppression, pacing, caps, threading, footer/checks, transport confirmation, and events. |
| PC3 | Current tiers are A/B/null; Nurture is a separate outreach status. | Tier represents template observation behavior; Nurture represents “do not enroll.” Historical snapshots remain unchanged. |
| PC4 | Imported copy first becomes a global lead/slot source, then copy-on-assignment creates an independent campaign-step snapshot. | A 1,000-lead source file can feed exact campaign subsets without later global edits rewriting campaign copy. |
| PC5 | Complete imported copy starts `needs_review`; missing/unreviewed personalized copy fails closed for only that lead. | Human-authored content needs an explicit readiness decision and must never silently fall back to unrelated template text. |
| PC6 | Template steps require variants; personalized steps forbid variants; sent sequences cannot change a step's source. | Every personalized lead copy is its variation, and immutable sent semantics protect audit/history. |
| PC7 | Campaign lead filtering has exact Pool, Enrolled, and deduplicated Both scopes; listing and bulk “all matching” share one predicate. | Operators can bulk-tier the intended campaign cohort without accidentally changing global leads. |
| PC8 | `\n` decoding applies only to personalized-copy CSV cells; `\\n` remains literal. | Spreadsheet-friendly bodies gain predictable newlines without mutating ordinary lead/custom fields. |

## Pre-canary remediation decisions (2026-08-09)

| ID | Decision | Rationale |
|----|----------|-----------|
| AA | **Mailbox-local operational time.** Recipient state resolves first; otherwise use the selected mailbox IANA timezone, then the global default. A mailbox daily cap resets at midnight in that mailbox's timezone. | It keeps prospect-local windows intact while making unknown-location behavior and capacity accounting predictable. |
| AB | **Lead erasure is irreversible anonymization.** Active work receives an append-only unsubscribe marked `data_erasure`; direct PII in lead, import, inbound-message, and matching alert records is redacted. Erased leads are excluded from operational analytics and may later be re-imported. Backups expire on their ordinary retention schedule; a restored backup must replay erasures before service resumes. | Preserves audit lineage without retaining usable personal data. |
| AC | **Outbound mail is minimal multipart/alternative.** Plain text remains canonical; a safely escaped matching HTML alternative has only paragraphs, line breaks, and a muted legible compliance footer. No images, pixels, hidden text, external assets, or branding treatment. | Provides compatible modern rendering without adding tracking or deliverability-risky markup. |

Every design decision, in one place. Decisions **A–F** come from [build_plan.md](../build_plan.md) §1 and are now **confirmed and locked**. Decisions **G–Z** are new low-level choices made to take the plan from "architecture" to "start typing" — each has a rationale and a swap cost so revisiting any of them is a bounded change, not archaeology.

Status meaning: 🔒 locked (change requires editing this file first) · 🔧 default (safe to flip via config/settings without touching docs).

---

## Confirmed from the build plan (§1 A–F)

| ID | Decision | Status |
|----|----------|--------|
| A | Single-operator monolith, one VPS, one datastore. Not multi-tenant. | 🔒 |
| B | **TypeScript on Node.js ≥22 (LTS)** end-to-end (API, workers, dashboard). Dev/CI run Node 24 (current LTS); `engines: ">=22"`. | 🔒 |
| C | **PostgreSQL 16 only.** pg-boss for jobs/cron. No Redis, no broker. | 🔒 |
| D | **React SPA** (Vite) talking to a JSON API. | 🔒 |
| E | Sentiment AI pre-suggestion: optional adapter on the Anthropic API. **Auto-enabled iff `ANTHROPIC_API_KEY` is set**, otherwise silently off. Suggestion is stored on the incoming message, never auto-applied — the human always confirms. | 🔒 |
| F | **STOP/opt-out replies auto-suppress immediately** (see below). | 🔒 |

### Decision F — sanity check performed, kept as automatic

The alternative was: opt-out only fires when the operator tags the reply Negative. Kept automatic because:

1. **CAN-SPAM requires honoring opt-outs promptly.** Human tagging can lag hours or days (weekend, vacation); in that gap the scheduler would keep sending follow-ups to someone who explicitly opted out — real legal exposure.
2. **The asymmetry of errors favors automatic.** False positive (keyword match on a non-opt-out) = one lost lead, recoverable via suppression removal (see decision U). False negative in manual mode = continued mail to an opt-out = the one outcome the system must never produce.
3. **A lead whose reply matches STOP keywords is essentially never a viable prospect anyway.**

Escape hatches built in: `settings.optout_detection = 'auto' | 'tag_only'` (the one-line flip the plan promised), and `DELETE /api/v1/suppressions/:email` with explicit confirmation for false positives.

---

## New decisions (G–Z)

| ID | Decision | Rationale | Swap cost |
|----|----------|-----------|-----------|
| G | **Repo: npm workspaces monorepo** — `apps/server`, `apps/web`, `packages/shared`. No pnpm/turbo/nx. | npm ships with Node — zero extra tooling for a solo dev. Three packages give the one seam that matters: shared types. | Trivial — pnpm is a drop-in later. |
| H | **`packages/shared` holds the Zod schemas for every API DTO.** Server validates requests/responses with them; web infers TS types from them. [10-api-contract.md](10-api-contract.md) is the human-readable form; `shared` is its executable form. They must never diverge — a contract change edits both in one commit. | One source of truth for shapes at compile time *and* runtime. | — |
| I | **Auth: single `operator` row.** Password hashed with argon2id. Session = `@fastify/secure-session` cookie (sodium-sealed, HttpOnly, `SameSite=Strict`, `Secure` in prod). Login rate-limited 5/min/IP. Mutating routes additionally require header `X-Requested-With: fetch` (CSRF belt-and-braces). First-boot password comes from env `OPERATOR_INITIAL_PASSWORD`; changeable in Settings. | Simplest thing that is actually safe on a public VPS. | Low — swap to OAuth/passkeys later touches only `api/auth`. |
| J | **IDs: Postgres `bigint identity` PKs everywhere; `events.id` is `bigserial`** (monotonic append order). API exposes numeric ids. No UUIDs. | Single-node, single-operator — distributed-ID machinery buys nothing. | Medium if multi-tenant ever happens (per plan §1A, that's a known cliff). |
| K | **Time: `timestamptz` (UTC) in DB; ISO-8601 `Z` strings in the API; formatting client-side.** Mailbox send windows and lead time zones stored as IANA names. | One representation, converted only at the edge. | — |
| L | **Email normalization = trim + lowercase the full address.** No plus-tag stripping, no dot-stripping. Uniqueness and suppression matching use the normalized value. | `jain+re@x.com` and `jain@x.com` can genuinely be different inboxes; stripping risks suppressing the wrong person — or worse, *not* suppressing the right one. | 🔧 one function (`normalizeEmail`) if evidence says otherwise. |
| M | **Sentiment tagging is a new event type: `sentiment_tagged`** (attrs: `reply_event_id`, `sentiment`, `tagged_by: human\|—`). Resolves a contradiction in the build plan: it said `human_reply.sentiment` is "null until tagged" *and* that `events` physically rejects UPDATE — both can't hold. Rule: `human_reply.sentiment` is set **only when known at insert time** (auto STOP-detection inserts `negative`); all later tagging/re-tagging appends `sentiment_tagged`. Effective sentiment of a reply = latest `sentiment_tagged` for it, else the `human_reply.sentiment` column. This adds a 12th event type to the spec's 11 (it's projection-relevant only — it never changes enrollment state). | Preserves append-only as physics, keeps a full audit of re-tags. | — |
| N | **`delivered` is appended by a `confirm-delivery` job** scheduled at send + `settings.delivery_confirm_hours` (default **6**). If no bounce event exists for that (enrollment, step) at fire time → append `delivered`. A bounce arriving *after* a `delivered` is still processed normally (reducer precedence handles it). | The spec defines delivered as "accepted, no bounce within window" but never said who fires it. A delayed job is deterministic, testable on the virtual clock, and needs no provider webhooks. | 🔧 hours configurable. |
| O | **Every fetched inbound message is logged to an `incoming_messages` table** (mailbox, UID, Message-ID, classification, matched enrollment, resulting event). This is (a) the poller's idempotency ledger — unique on `(mailbox_id, imap_uid)`, dedupe on Message-ID — and (b) the data source for the Reply-Detection debug screen (walkthrough's 4-bucket view). | One table serves correctness and observability. | — |
| P | **Send pacing: per-mailbox minimum gap = `window_minutes / daily_cap`, jittered ±20%.** (30/day over a 9 h window ≈ one send per ~18 min.) Scheduler tick every 5 min (pg-boss cron). Never-burst is *emergent*: cap + pace make bursting impossible; no special catch-up code path beyond oldest-first ordering. | Matches how deliverability-safe senders behave; simple to reason about and test. | 🔧 both knobs in `settings`. |
| Q | **Recycle no-identical-resend guard = content hashes.** Every `sent` event stores `content_hash` = sha256 of the step-variant's `(subject_template + '\0' + body_template)` (pre-personalization). Enrolling a lead into a campaign is **blocked** if any active variant hash in its sequence matches a hash that lead already received. | Guards the *guarantee* (never the identical message twice) at the only place it can be enforced — enrollment time. Hashing templates, not rendered output, means spintax can't smuggle a "different" copy through. | — |
| R | **Imported leads get `tier = NULL` ("untiered"), not a default tier.** Auto-enrollment ordering treats untiered *after* Tier C; the Leads screen shows an "N untiered" banner driving the bulk-tiering flow. Nurture is never auto-enrolled (per spec). | Forcing a wrong default (everything = C) silently mis-prioritizes; a visible triage queue matches the walkthrough's Stage-2 behavior (Arjun tiers deliberately). | 🔧 could default to C with one migration. |
| S | **Frontend stack (locked list):** React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query v5, React Router v6, react-hook-form + zod resolver, Recharts, lucide-react, MSW for mocks. **No Redux/Zustand** — server state lives in TanStack Query; the only global client state is the session (one React context) and toasts (shadcn `sonner`). | Every listed piece is boring, documented, and TS-native. The app is CRUD + tables + one inbox — it does not need a state framework. | Medium — per plan §1D, htmx remains the escape route (only F-track changes). |
| T | **No websockets/SSE. Polling via TanStack Query `refetchInterval`:** Overview 30 s, Unibox 60 s, Mailboxes 60 s, Alerts 30 s, everything else on-focus refetch. | At 120 sends/day, realtime infra is pure cost. Polling against indexed projections is milliseconds. | Low — an SSE channel can be added in `api/` later without touching screens (Query invalidation hook). |
| U | **Suppression removal exists but is deliberately loud:** `DELETE /suppressions/:email` requires body `{ confirm: "<the email>" }`, is audit-logged as an `alerts` row, and is UI-gated behind a typed-confirmation dialog. | False-positive STOP matches need an undo; compliance needs it to be rare and traceable. | — |
| V | **Alerts: `alerts` table + in-app feed always; optional outbound webhook** (`ALERT_WEBHOOK_URL`, generic JSON POST — works with Telegram/Slack/ntfy relays). No SMTP self-mail for alerts (the mail path being broken is exactly when alerts matter). | — | 🔧 env var. |
| W | **Deliverability score = deterministic local rubric** (defined in [08-render-engine-spec.md](08-render-engine-spec.md) §5), 0–10, no external API calls. | The walkthrough shows "9.1/10"; a transparent rubric is debuggable and free. | 🔧 rubric table is data. |
| X | **Time-zone resolution:** `leads.state` (US state code) → IANA zone via a static map; else `settings.default_timezone` (seed: `America/New_York`). Unknown never means "send now" (spec Part 7). Area-code inference **dropped** — scraped phone data is too dirty to trust; state covers the real cases. | Simpler and safer than the spec's optional area-code path. | 🔧 add area-code map later as a pure function. |
| Y | **Process model: one Node process** runs Fastify + pg-boss workers (scheduler tick, per-mailbox polls, confirm-delivery, self-check). Env `ROLE=all\|api\|worker` exists from day 1 so the same image can split into two processes later without code change. | One thing to run, one thing to monitor, on one VPS. | Low — the seam is pre-built. |
| Z | **API conventions:** REST under `/api/v1`; error envelope `{ "error": { "code", "message", "details?" } }` with a closed set of codes; offset pagination `?page=&per_page=` (default 50, max 200); all list endpoints return `{ items, total, page, per_page }`. | Boring and sufficient at this scale. | — |

## Pre-real-domain safety decisions (2026-08-20)

| ID | Decision | Rationale | Swap cost |
|---|---|---|---|
| AA | **Every sequence stops on every human reply.** `stop_on_reply=false` is removed from the writable contract and rejected at the database boundary. | A reply followed by an automated follow-up is the highest-cost outreach failure. Metrics-only reply continuation is not worth that risk. | Low |
| AB | **Every human reply receives an append-only operator disposition.** `not_interested`, `wrong_person`, and `explicit_unsubscribe` append `unsubscribe` in the same transaction and therefore suppress globally. `not_now` requires a future recontact date. | Sentiment describes tone; it is not permission. A separate audited fact makes recontact intent explicit. | Medium |
| AC | **A prior human reply blocks automatic cross-campaign enrollment.** Deliberate recontact uses explicit lead IDs plus an explicit override; `not_now` remains blocked until its date, and suppressed dispositions cannot be overridden. | Stopping one enrollment must not silently make the same person eligible for another campaign. | Medium |
| AD | **`delivery_confirm_hours` becomes immutable after the first `sent` event.** | Completion replay currently depends on the active setting. Freezing it once history exists prevents finding #24 without rewriting append-only history. | Low |
| AE | **Remove `redistributeUnstarted` and claims of pre-send redistribution.** Unassigned work already rotates across healthy mailboxes; started threads remain pinned. | Finding #25 proves the old predicate describes an impossible production state. Honest rotation is safer than inventing premature assignment. | Low |

## Operator-workflow decisions (2026-08-25)

| ID | Decision | Rationale | Swap cost |
|---|---|---|---|
| BA | **Operational collections use numbered server pagination.** Unibox, reminders, alerts, reply detection, and cold storage retain their filters while paging and reset to page 1 when a filter changes. | New work must remain discoverable when operational history grows beyond one screen. | Low |
| BB | **Human-reply follow-up uses in-app reminders, not enrollment snoozes.** A `not_now` outcome creates an open reminder and an independent do-not-contact guard. Completing a reminder never authorizes or sends mail. | An operator task and permission to contact are different facts and must never be conflated. | Medium |
| BC | **Manual Compose begins from the enrollment's actual due step.** The server resolves the current active human-written enrollment, step template, thread, and pinned mailbox; it never silently creates an enrollment. | Later-step manual work must preserve both the intended copy and conversation thread. | Medium |
| BD | **Timezones and IMAP folders are verified selections.** Timezones are validated IANA names. Folder names come from authenticated discovery, and adding one atomically seeds its cursor from UIDNEXT. | Prevents typo-driven scheduling failures and accidental ingestion of old mailbox history. | Medium |
| BE | **Variant analytics separates direct response from eventual enrollment outcome at every step.** Direct attribution uses the persisted replied-to step; eventual attribution follows the selected-step cohort through later replies, effective sentiment changes, and meetings. | Later-step copy can influence a later outcome without falsely claiming that the reply directly answered the earlier message. | Medium |
| BF | **Cold-storage recycling is multi-source, previewed, and atomically revalidated.** One target enrollment is created per eligible lead, every qualifying source enrollment is preserved as provenance, and content conflicts are skipped rather than resent. | Operators can combine old cohorts without overwriting source history, trusting stale previews, or turning one conflict into an all-or-nothing failure. | Medium |

---

## Deliberately still open (kept as configuration, per plan §8)

| Item | Where it lives | When to revisit |
|------|----------------|-----------------|
| Tier ratios (29/51/14/6) and tier→mode mapping | `campaigns.tier_effort_config` (JSONB, seeded per campaign) | After ≥1 full real pass |
| Shift effort toward Mode 1 / shrink Tier-C automation | Same config + analytics-by-tier already surface the evidence | Same |
| Bounce auto-pause thresholds (25 / 4% / 50 / 3-in-10 / 50%) | `settings` row, editable in the Settings screen | Only if real providers behave differently |
| Send window defaults, tick/poll intervals, stale-poll hours | `settings` row | Live tuning in B8 |
