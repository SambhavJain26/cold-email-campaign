# Decision Register

Every design decision, in one place. Decisions **A-F** come from [build_plan.md](../build_plan.md) §1 and are now **confirmed and locked**. Decisions **G-Z** are new low-level choices made to take the plan from "architecture" to "start typing" - each has a rationale and a swap cost so revisiting any of them is a bounded change, not archaeology.

Status meaning: 🔒 locked (change requires editing this file first) · 🔧 default (safe to flip via config/settings without touching docs).

---

## Confirmed from the build plan (§1 A-F)

| ID | Decision | Status |
|----|----------|--------|
| A | Single-operator monolith, one VPS, one datastore. Not multi-tenant. | 🔒 |
| B | **TypeScript on Node.js ≥22 (LTS)** end-to-end (API, workers, dashboard). Dev/CI run Node 24 (current LTS); `engines: ">=22"`. | 🔒 |
| C | **PostgreSQL 16 only.** pg-boss for jobs/cron. No Redis, no broker. | 🔒 |
| D | **React SPA** (Vite) talking to a JSON API. | 🔒 |
| E | Sentiment AI pre-suggestion: optional adapter on the Anthropic API. **Auto-enabled iff `ANTHROPIC_API_KEY` is set**, otherwise silently off. Suggestion is stored on the incoming message, never auto-applied - the human always confirms. | 🔒 |
| F | **STOP/opt-out replies auto-suppress immediately** (see below). | 🔒 |

### Decision F - sanity check performed, kept as automatic

The alternative was: opt-out only fires when the operator tags the reply Negative. Kept automatic because:

1. **CAN-SPAM requires honoring opt-outs promptly.** Human tagging can lag hours or days (weekend, vacation); in that gap the scheduler would keep sending follow-ups to someone who explicitly opted out - real legal exposure.
2. **The asymmetry of errors favors automatic.** False positive (keyword match on a non-opt-out) = one lost lead, recoverable via suppression removal (see decision U). False negative in manual mode = continued mail to an opt-out = the one outcome the system must never produce.
3. **A lead whose reply matches STOP keywords is essentially never a viable prospect anyway.**

Escape hatches built in: `settings.optout_detection = 'auto' | 'tag_only'` (the one-line flip the plan promised), and `DELETE /api/v1/suppressions/:email` with explicit confirmation for false positives.

---

## New decisions (G-Z)

| ID | Decision | Rationale | Swap cost |
|----|----------|-----------|-----------|
| G | **Repo: npm workspaces monorepo** - `apps/server`, `apps/web`, `packages/shared`. No pnpm/turbo/nx. | npm ships with Node - zero extra tooling for a solo dev. Three packages give the one seam that matters: shared types. | Trivial - pnpm is a drop-in later. |
| H | **`packages/shared` holds the Zod schemas for every API DTO.** Server validates requests/responses with them; web infers TS types from them. [10-api-contract.md](10-api-contract.md) is the human-readable form; `shared` is its executable form. They must never diverge - a contract change edits both in one commit. | One source of truth for shapes at compile time *and* runtime. | - |
| I | **Auth: single `operator` row.** Password hashed with argon2id. Session = `@fastify/secure-session` cookie (sodium-sealed, HttpOnly, `SameSite=Strict`, `Secure` in prod). Login rate-limited 5/min/IP. Mutating routes additionally require header `X-Requested-With: fetch` (CSRF belt-and-braces). First-boot password comes from env `OPERATOR_INITIAL_PASSWORD`; changeable in Settings. | Simplest thing that is actually safe on a public VPS. | Low - swap to OAuth/passkeys later touches only `api/auth`. |
| J | **IDs: Postgres `bigint identity` PKs everywhere; `events.id` is `bigserial`** (monotonic append order). API exposes numeric ids. No UUIDs. | Single-node, single-operator - distributed-ID machinery buys nothing. | Medium if multi-tenant ever happens (per plan §1A, that's a known cliff). |
| K | **Time: `timestamptz` (UTC) in DB; ISO-8601 `Z` strings in the API; formatting client-side.** Mailbox send windows and lead time zones stored as IANA names. | One representation, converted only at the edge. | - |
| L | **Email normalization = trim + lowercase the full address.** No plus-tag stripping, no dot-stripping. Uniqueness and suppression matching use the normalized value. | `jain+re@x.com` and `jain@x.com` can genuinely be different inboxes; stripping risks suppressing the wrong person - or worse, *not* suppressing the right one. | 🔧 one function (`normalizeEmail`) if evidence says otherwise. |
| M | **Sentiment tagging is a new event type: `sentiment_tagged`** (attrs: `reply_event_id`, `sentiment`, `tagged_by: human\| - `). Resolves a contradiction in the build plan: it said `human_reply.sentiment` is "null until tagged" *and* that `events` physically rejects UPDATE - both can't hold. Rule: `human_reply.sentiment` is set **only when known at insert time** (auto STOP-detection inserts `negative`); all later tagging/re-tagging appends `sentiment_tagged`. Effective sentiment of a reply = latest `sentiment_tagged` for it, else the `human_reply.sentiment` column. This adds a 12th event type to the spec's 11 (it's projection-relevant only - it never changes enrollment state). | Preserves append-only as physics, keeps a full audit of re-tags. | - |
| N | **`delivered` is appended by a `confirm-delivery` job** scheduled at send + `settings.delivery_confirm_hours` (default **6**). If no bounce event exists for that (enrollment, step) at fire time → append `delivered`. A bounce arriving *after* a `delivered` is still processed normally (reducer precedence handles it). | The spec defines delivered as "accepted, no bounce within window" but never said who fires it. A delayed job is deterministic, testable on the virtual clock, and needs no provider webhooks. | 🔧 hours configurable. |
| O | **Every fetched inbound message is logged to an `incoming_messages` table** (mailbox, UID, Message-ID, classification, matched enrollment, resulting event). This is (a) the poller's idempotency ledger - unique on `(mailbox_id, imap_uid)`, dedupe on Message-ID - and (b) the data source for the Reply-Detection debug screen (walkthrough's 4-bucket view). | One table serves correctness and observability. | - |
| P | **Send pacing: per-mailbox minimum gap = `window_minutes / daily_cap`, jittered ±20%.** (30/day over a 9 h window ≈ one send per ~18 min.) Scheduler tick every 5 min (pg-boss cron). Never-burst is *emergent*: cap + pace make bursting impossible; no special catch-up code path beyond oldest-first ordering. | Matches how deliverability-safe senders behave; simple to reason about and test. | 🔧 both knobs in `settings`. |
| Q | **Recycle no-identical-resend guard = content hashes.** Every `sent` event stores `content_hash` = sha256 of the step-variant's `(subject_template + '\0' + body_template)` (pre-personalization). Enrolling a lead into a campaign is **blocked** if any active variant hash in its sequence matches a hash that lead already received. | Guards the *guarantee* (never the identical message twice) at the only place it can be enforced - enrollment time. Hashing templates, not rendered output, means spintax can't smuggle a "different" copy through. | - |
| R | **Imported leads get `tier = NULL` ("untiered"), not a default tier.** Auto-enrollment ordering treats untiered *after* Tier C; the Leads screen shows an "N untiered" banner driving the bulk-tiering flow. Nurture is never auto-enrolled (per spec). | Forcing a wrong default (everything = C) silently mis-prioritizes; a visible triage queue matches the walkthrough's Stage-2 behavior (Arjun tiers deliberately). | 🔧 could default to C with one migration. |
| S | **Frontend stack (locked list):** React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query v5, React Router v6, react-hook-form + zod resolver, Recharts, lucide-react, MSW for mocks. **No Redux/Zustand** - server state lives in TanStack Query; the only global client state is the session (one React context) and toasts (shadcn `sonner`). | Every listed piece is boring, documented, and TS-native. The app is CRUD + tables + one inbox - it does not need a state framework. | Medium - per plan §1D, htmx remains the escape route (only F-track changes). |
| T | **No websockets/SSE. Polling via TanStack Query `refetchInterval`:** Overview 30 s, Unibox 60 s, Mailboxes 60 s, Alerts 30 s, everything else on-focus refetch. | At 120 sends/day, realtime infra is pure cost. Polling against indexed projections is milliseconds. | Low - an SSE channel can be added in `api/` later without touching screens (Query invalidation hook). |
| U | **Suppression removal exists but is deliberately loud:** `DELETE /suppressions/:email` requires body `{ confirm: "<the email>" }`, is audit-logged as an `alerts` row, and is UI-gated behind a typed-confirmation dialog. | False-positive STOP matches need an undo; compliance needs it to be rare and traceable. | - |
| V | **Alerts: `alerts` table + in-app feed always; optional outbound webhook** (`ALERT_WEBHOOK_URL`, generic JSON POST - works with Telegram/Slack/ntfy relays). No SMTP self-mail for alerts (the mail path being broken is exactly when alerts matter). | - | 🔧 env var. |
| W | **Deliverability score = deterministic local rubric** (defined in [08-render-engine-spec.md](08-render-engine-spec.md) §5), 0-10, no external API calls. | The walkthrough shows "9.1/10"; a transparent rubric is debuggable and free. | 🔧 rubric table is data. |
| X | **Time-zone resolution:** `leads.state` (US state code) → IANA zone via a static map; else `settings.default_timezone` (seed: `America/New_York`). Unknown never means "send now" (spec Part 7). Area-code inference **dropped** - scraped phone data is too dirty to trust; state covers the real cases. | Simpler and safer than the spec's optional area-code path. | 🔧 add area-code map later as a pure function. |
| Y | **Process model: one Node process** runs Fastify + pg-boss workers (scheduler tick, per-mailbox polls, confirm-delivery, self-check). Env `ROLE=all\|api\|worker` exists from day 1 so the same image can split into two processes later without code change. | One thing to run, one thing to monitor, on one VPS. | Low - the seam is pre-built. |
| Z | **API conventions:** REST under `/api/v1`; error envelope `{ "error": { "code", "message", "details?" } }` with a closed set of codes; offset pagination `?page=&per_page=` (default 50, max 200); all list endpoints return `{ items, total, page, per_page }`. | Boring and sufficient at this scale. | - |

---

## Deliberately still open (kept as configuration, per plan §8)

| Item | Where it lives | When to revisit |
|------|----------------|-----------------|
| Tier ratios (29/51/14/6) and tier→mode mapping | `campaigns.tier_effort_config` (JSONB, seeded per campaign) | After ≥1 full real pass |
| Shift effort toward Mode 1 / shrink Tier-C automation | Same config + analytics-by-tier already surface the evidence | Same |
| Bounce auto-pause thresholds (25 / 4% / 50 / 3-in-10 / 50%) | `settings` row, editable in the Settings screen | Only if real providers behave differently |
| Send window defaults, tick/poll intervals, stale-poll hours | `settings` row | Live tuning in B8 |
