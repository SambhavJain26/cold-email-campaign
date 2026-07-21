# Cold Email Tool - Master Build Plan

**From empty codebase to a fully functional, production-ready product, in nine iterative stages.**

This document is the implementation counterpart to the two design documents:

- **Event Model & State Machine spec** - the data-model rulebook (events, states, metric formulas, the worked 885-lead cohort).
- **Campaign Walkthrough v2** - the screen-by-screen product behaviour.

Where those two say *what* the system is, this says *how it gets built, in what order, and how each piece is proven correct - including before any real mailbox exists.*

---

## 0. How to read this document

- **Sections 1-4** are the decisions and the shape of the system: assumptions you can override, the tech stack (with reasoning), the architecture, and the data model. Read these once.
- **Section 5** is the testing spine - the mock transport + virtual clock + "golden cohort" strategy that lets every feature be built and tested *now*, with live email deferred. This is the single most important idea in the plan; the whole staging depends on it.
- **Section 6** is the stage-by-stage build plan (Stages 0-9). Each stage lists **what's built**, **how it's tested**, **definition of done**, and **what it depends on**. Build them in order.
- **Sections 7-9** are traceability (spec → code), the deferred product decisions and how the design keeps them cheap to revisit, and ops/deploy appendices.

A guiding rule throughout: **correctness-critical logic is built and proven first and offline; the UI and the real-email integration come last.** By the time a real inbox is connected, every rule in the spec has already been verified against the spec's own worked numbers.

---

## 1. Assumptions & decisions you can override

You asked me to choose where the spec left things open. Here is every choice I made that could reasonably go another way. If any is wrong, tell me and I'll adjust the affected stages - none of these are baked so deep that changing them is expensive, and I note the swap cost for each.

| # | Decision | What I assumed | Override cost |
|---|----------|----------------|---------------|
| A | **Deployment shape** | Single-operator tool (just you), one always-on VPS, not multi-tenant SaaS. Drives a simple monolith + one datastore. | Low now, high later. If you ever want multi-user, it's a Stage-0 change (tenant IDs on every table). Cheap to design for, expensive to retrofit - see §7. |
| B | **Primary language/runtime** | **TypeScript on Node.js.** One language across API, background workers, and dashboard. Chosen for the reasons in §2. | Medium. If you're stronger in Python, the *architecture is identical*; only the concrete libraries in §2 swap. Say the word and I'll re-issue §2 + the "what's built" lists in Python (FastAPI + SQLAlchemy + APScheduler/Celery + aioimaplib). |
| C | **Datastore** | **PostgreSQL only.** No Redis, no separate broker. Background jobs run on a Postgres-backed queue. | Low. Swapping the job queue to Redis/BullMQ later is a single module. |
| D | **Dashboard** | **React + Vite SPA** talking to a JSON API. The screens are genuinely app-like (live metrics, interactive Unibox). | Medium. If you'd rather minimise JS, a server-rendered + htmx dashboard hits the same API contract; only Stage 7 changes. |
| E | **Sentiment AI pre-suggestion** | Optional, behind an interface, defaulting to the Anthropic API (you already have access). Human always confirms, so the system is fully functional with the AI turned off. | Trivial. It's an optional adapter; off by default costs nothing. |
| F | **"STOP" opt-out detection** | Automated: a human reply whose body matches opt-out keywords fires `unsubscribe` immediately (compliance: honour opt-outs promptly), *in addition to* `human_reply`, without waiting for you to tag it. You still tag sentiment. This reconciles the plain-text-STOP mechanism (spec Part 8) with human sentiment tagging (Part 6). | Low. If you'd rather opt-out only fire when you tag "Negative," it's a one-line switch in the poller. |

**Two items you flagged as pending - how this plan handles them:**

1. **Spec sections not yet drawn as screens** (reply-detection view, missed-day/catch-up notice, CAN-SPAM footer editor, mailbox failure states). These are **built as real UI in Stage 7** - the plan treats them as first-class screens, not afterthoughts. I list exactly which screens in that stage. I am **not** editing the walkthrough or spec; I'm building the screens the spec implies.
2. **The deferred judgment call** (whether strong Tier-A conversion should later shift effort toward human-written email and shrink automation). The plan makes the tiering **ratios and the tier→effort-mode mapping configuration, not hardcoded logic** (§7). When real data arrives, that decision becomes a settings change, not a code change. It stays undecided, exactly as you asked.

---

## 2. Tech stack (with reasoning)

The stack is chosen for **one solo maintainer, one VPS, tiny scale** (~120 sends/day, ~1,000 leads/campaign, a handful of campaigns), where the *hard* parts are (a) correctness of the event/state/metrics model and (b) robust IMAP/SMTP handling. Priorities, in order: **fewest moving parts**, **one language end-to-end**, **mature email libraries**, **a datastore that suits an append-only log + analytical queries**, and **a large enough ecosystem that future help is easy to find.**

| Concern | Choice | Why this, over the obvious alternative |
|---------|--------|----------------------------------------|
| **Language / runtime** | TypeScript on Node.js (LTS) | One language for API, workers, and dashboard → no context-switching for a solo dev. Node is async-native, which suits long-lived scheduler/poller loops. TS's static types are worth a lot on a system where an event's shape and a state transition must be exactly right. *vs Python:* Python is equally capable for the logic, but you'd typically add a JS frontend anyway (two languages) and a separate worker system (Celery + broker = more moving parts). If Python is your stronger language, see override B. |
| **Web/API framework** | Fastify | Fast, first-class TypeScript, built-in schema validation, clean plugin model. *vs Express:* Express works identically at this scale and is more widely known - if you already know Express, use it; nothing in the plan depends on Fastify specifics. |
| **Database** | PostgreSQL | The event log wants real transactions (append event **and** update projections atomically), good indexing (partial/compound indexes for the bounce-window and metric queries), and strong aggregate-query support (every metric is essentially a `GROUP BY` over events). *vs SQLite:* SQLite would technically run at this scale, but Postgres gives you concurrent workers, `JSONB` for flexible event attributes, and room to grow with no rewrite. |
| **DB access / migrations** | Drizzle ORM | Thin, TypeScript-first, SQL-transparent - you see the queries, which matters when the metrics *are* the product. Versioned migrations included. *vs Prisma:* Prisma has lovely DX but hides SQL and is heavier; for an event-log-centric design where exact queries matter, Drizzle's transparency wins. Prisma is a fine substitute if you prefer it. |
| **Background jobs / scheduling** | pg-boss (Postgres-backed queue + cron) | Runs the scheduler tick and per-mailbox IMAP polls as scheduled jobs, with **retries + exponential backoff built in** - which is exactly what the spec's "SMTP retry with backoff" and "IMAP keep retrying" requirements need. Crucially, it uses **Postgres as the broker**, so there's **no Redis to run** → one datastore on one VPS. *vs BullMQ+Redis:* more capable, but adds a second service to operate. *vs a bare `setInterval`:* no durability, retries, or crash recovery. |
| **Email transport (deferred to Stage 9)** | nodemailer (SMTP send), imapflow (modern IMAP), mailparser (MIME + DSN parsing) | These are the most maintained Node options and directly serve the hardest requirement (Part 6 reply detection): imapflow exposes the `In-Reply-To`/`References` headers we thread on; mailparser handles MIME and `message/delivery-status` DSN bodies for bounce parsing. **They are only wired in at Stage 9**, entirely behind the transport interface (§4.3). |
| **Dashboard** | React + Vite + a light chart lib (Recharts or uPlot) | The screens are app-like: a live-updating Overview, an interactive Unibox with one-click tagging, filters, capacity meters, sparkline health trends. React keeps the whole stack in TypeScript. Sparklines/charts are simple enough for a light lib. *vs server-rendered + htmx:* a legitimate lighter-weight path; if you prefer minimal JS, only Stage 7 changes (override D). |
| **Input validation / shared types** | Zod | Validates untrusted input (CSV rows, mailbox config, API payloads) at the boundary and generates TS types, so the same shapes are enforced at runtime and compile time. |
| **Testing** | Vitest + Playwright | Vitest (fast, TS-native) for unit/integration and the simulation harness; Playwright for end-to-end UI tests driven against the mock-transport backend. |
| **Secrets at rest** | libsodium (`sodium-native`) sealed storage, key from environment | Mailbox app-passwords/tokens are encrypted at rest and never logged. (You enter your own mailbox credentials in the UI; storing them encrypted is standard and required for a tool that sends on your behalf.) |
| **Deploy / process management** | Docker Compose (app + Postgres) on the VPS; systemd as the no-Docker alternative | Compose gives a reproducible single-VPS deploy (one `docker compose up`); systemd is the lighter path if you'd rather not run Docker. Either way: no cloud dependencies, no managed services. |

**Repository layout** (single repo, clear module seams so the stages map to folders):

```
/src
  /domain         # pure logic, no I/O: event types, the state-machine reducer, metric formulas
  /db             # Drizzle schema, migrations, repositories (the only place SQL lives)
  /transport      # MailTransport interface + MockTransport + (Stage 9) SmtpImapTransport
  /clock          # Clock interface + SystemClock + VirtualClock
  /scheduler      # the send tick (Part 7)
  /poller         # IMAP poll + reply detection/classification (Part 6)
  /render         # merge-tags + spintax + CAN-SPAM footer + pre-send checks
  /ingest         # CSV import + hygiene + suppression + tiering
  /api            # Fastify routes, Zod schemas, auth
  /jobs           # pg-boss job definitions + wiring
  /config         # env + settings loading
/web              # React + Vite dashboard
/test
  /unit
  /integration    # scenario runner over MockTransport + VirtualClock
  /fixtures       # the Part-10 golden cohort, import fixtures, header fixtures
  /e2e            # Playwright
```

---

## 3. System overview & architecture

### 3.1 What we're building

A single-operator web application with two long-running background workers, one relational datastore, and a browser dashboard:

```
                          ┌──────────────────────────────────────┐
                          │            Browser dashboard          │
                          │  Overview · Leads · Mailboxes ·        │
                          │  Sequences · Campaigns · Unibox ·      │
                          │  Analytics · Cold Storage · Settings   │
                          └───────────────────┬──────────────────┘
                                              │ JSON API (Fastify, Zod)
                          ┌───────────────────▼──────────────────┐
                          │              Application core         │
                          │                                       │
   ┌───────────┐  events  │  ┌─────────────┐   ┌──────────────┐  │
   │ Scheduler │─────────▶│  │  Event log   │   │ State machine │  │
   │  (tick)   │          │  │ (append-only │──▶│  (pure        │  │
   └─────┬─────┘          │  │  = truth)    │   │  reducer)     │  │
         │ send           │  └──────┬───────┘   └──────┬───────┘  │
   ┌─────▼─────┐          │         │ projections       │          │
   │           │          │  ┌──────▼───────┐   ┌──────▼───────┐  │
   │  Mail     │◀────────▶│  │ Metrics engine│   │  Projections  │  │
   │ Transport │  poll    │  │ (queries)     │   │ (lead state,  │  │
   │ (abstract)│─────────▶│  └──────────────┘   │  sent_messages│  │
   └───────────┘  events  │                     │  suppressions)│  │
         ▲                │  ┌──────────────┐   └──────────────┘  │
   ┌─────┴─────┐          │  │ Render engine │                     │
   │  Poller   │          │  │ + compliance  │        PostgreSQL    │
   │ (IMAP)    │          │  └──────────────┘                      │
   └───────────┘          └──────────────────────────────────────┘

   MailTransport is an interface. Now: MockTransport (offline, scriptable).
   Later (Stage 9): SmtpImapTransport (real). Nothing else changes when swapped.
```

### 3.2 The one architectural idea everything rests on: event-sourced-lite

The spec already dictates this, so the plan commits to it fully:

- **The event log is the single source of truth.** Every fact - `enrolled`, `sent`, `delivered`, `soft_bounce`, `hard_bounce`, `human_reply`, `auto_reply`, `unsubscribe`, `meeting_booked`, `deal_won/lost` - is an append-only row. Events are never edited or deleted (spec Part 2).
- **Lead state is a projection.** A lead's current state (`NEW/ACTIVE/REPLIED/BOUNCED/UNSUBSCRIBED/COMPLETED`) is *derived* by feeding that lead's events, in order, through a **pure reducer** `applyEvent(state, event) → state` that encodes Part 3 and the precedence rule (`UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED`).
- **Metrics are queries.** Every metric in Part 5 is an aggregate query over events, with the exact numerator/denominator the spec defines.

**Write path (transactional):** append the event **and** update the affected projections (the enrollment's state, `sent_messages`, `suppressions`, cached counters) in **one database transaction**. Either all of it lands or none of it does.

**Read path:** the dashboard reads projections for current state and runs aggregate queries for metrics. Fast, because projections are precomputed.

**Why this specific hybrid** (rather than pure event replay on every read, or a plain CRUD design):

1. **Correctness is provable.** Because state and metrics are *derivations* of the log, and the log is immutable, the spec's precedence and mutual-exclusivity guarantees are properties of a pure function - unit-testable with no I/O.
2. **It's rebuildable.** A `rebuild-projections` command replays the entire log to reconstruct every projection from scratch. This is your disaster-recovery and your correctness audit in one: if a projection ever drifts from the log, you rebuild. It also *proves* the log is truly the source of truth.
3. **It's the reason live email can be deferred.** Since all logic is driven by events, and events can be produced by a *mock* transport just as well as a real one, the entire system can be exercised and verified offline (§5).

A periodic **self-check job** asserts the invariant the spec guarantees - `UNSUBSCRIBED + BOUNCED + REPLIED + COMPLETED == total enrolled` per campaign - and alerts on any drift. If the math ever stops closing, you know immediately.

### 3.3 The transport abstraction (the key to deferring live email)

All email I/O goes through one interface. Nothing in the domain, scheduler, poller, metrics, or UI knows whether email is real or simulated.

```
interface MailTransport {
  // Sending side (used by the scheduler)
  send(msg: OutboundMessage): Promise<SendResult>
  //   OutboundMessage: { mailboxId, to, subject, body, headers: {messageId, inReplyTo?, references?} }
  //   SendResult:      { messageId, accepted: boolean, transientError?, permanentError? }

  // Receiving side (used by the poller)
  fetchNew(mailboxId): Promise<IncomingMessage[]>
  //   IncomingMessage: raw-ish { uid, from, subject, headers, bodyText, isDSN, dsnStatus?, dsnRecipient? }

  // Connection check (used by "Test Connection" and health monitoring)
  verify(mailboxConfig): Promise<{ smtpOk: boolean, imapOk: boolean, roundTripMs?: number }>
}
```

- **`MockTransport`** (built Stage 3, used through Stage 8): assigns deterministic `Message-ID`s on send; records every send; and, driven by a **scenario script**, decides each send's outcome (delivered / hard bounce / soft bounce) and emits synthetic incoming messages with *correct headers* - replies threaded via `In-Reply-To` pointing at the real sent `Message-ID`, DSN bounces with `message/delivery-status` bodies and `5.x.x`/`4.x.x` codes, OOO auto-responders with `Auto-Submitted: auto-replied`. This lets us test **the exact code paths** the real transport will drive.
- **`SmtpImapTransport`** (built Stage 9): the same three methods, implemented with nodemailer + imapflow + mailparser.

Because the interface is identical, **swapping mock → real is a one-line change in the composition root** (a config flag picks the implementation). No downstream code changes. This is the concrete mechanism behind your requirement: *plug in real mailboxes later via configuration, without redesigning or rewriting anything.*

### 3.4 The virtual clock (the key to testing multi-day sequences instantly)

Sequences have waits of 0/3/4/5 days; daily caps reset at local midnight; the "stale poll" alert fires after N hours. Testing these against wall-clock time is impossible. So **all time goes through a `Clock` interface:**

```
interface Clock { now(): Date; }
```

- **`SystemClock`** in production.
- **`VirtualClock`** in tests: `now()` returns a controllable time you can fast-forward. The scenario runner advances it (e.g. "jump 3 days") so a full multi-week campaign runs through the scheduler and poller in **milliseconds**, deterministically.

Together, `MockTransport` + `VirtualClock` + the scenario runner (§5) let a whole campaign - enrollment, rotation, follow-ups, bounces, replies, unsubscribes, meetings, catch-up, auto-pause - run end-to-end offline and be asserted against the spec's numbers.

---

## 4. Data model / schema

The schema maps almost 1:1 to the spec, as the spec intends. Types below are conceptual (Drizzle definitions in Stage 1). Everything derives from, or is a projection of, the **`events`** table.

### 4.1 Core tables

**`events`** - the append-only log (spec Part 2). *The source of truth.*

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigserial PK | monotonic order |
| `type` | enum | `enrolled, sent, delivered, soft_bounce, hard_bounce, human_reply, auto_reply, unsubscribe, meeting_booked, deal_won, deal_lost` |
| `occurred_at` | timestamptz | event time (from the `Clock`) |
| `lead_id` | fk → leads | always set |
| `enrollment_id` | fk → enrollments | set for everything after `enrolled` |
| `campaign_id` | fk → campaigns | denormalised for fast metric grouping |
| `step_no` | int null | on `sent/delivered/bounce/human_reply` |
| `mailbox_id` | fk null | on `enrolled/sent/bounce` |
| `message_id` | text null | on `sent` - **the threading anchor** (Part 6 hard requirement) |
| `sentiment` | enum null | on `human_reply`: `positive/neutral/negative` (null until tagged) |
| `source` | enum null | on `unsubscribe`: `reply/link` |
| `reason` | text null | on bounces / auto_reply (DSN code, OOO pattern, etc.) |
| `attributes` | jsonb | anything extra, future-proofing |

**Append-only is enforced, not just intended:** the application DB role is granted `INSERT/SELECT` on `events` but **not** `UPDATE/DELETE`, and a trigger raises on any attempt. Facts stay facts.

Indexes: `(enrollment_id, occurred_at)`, `(lead_id)`, `(campaign_id, type)`, `(mailbox_id, type, occurred_at)` - the last one powers the rolling-window bounce queries (Part 11) efficiently.

**`leads`** - the durable person/company, and **permanent** cross-campaign suppression.

| Column | Notes |
|--------|-------|
| `id` PK | |
| `email` (normalised, unique) | |
| `first_name`, `company`, `notes` | `first_name` may be null → falls back to `{{first_name\|there}}` |
| `custom_fields` jsonb | scraped extras used by merge tags |
| `tier` | `A/B/C/nurture` - current tier; may change between passes (Tier-C→B promotion) |
| `is_suppressed` bool + `suppression_reason` (`unsubscribed/hard_bounce`) + `suppressed_at` | permanent, spans all campaigns |
| `source`, `imported_at`, `import_id` | provenance |

Suppression lives on the lead (and mirrored in `suppressions`, below) because it is **permanent and campaign-independent** - an unsubscribed or hard-bounced address must never be contacted again, in *any* campaign, including future imports.

**`campaigns`** - a "pass" (Pass 1 speed-to-lead, Pass 2 listing-automation, etc.).

| Column | Notes |
|--------|-------|
| `id` PK, `name`, `status`, `created_at` | |
| `sequence_id` fk | which sequence this campaign runs |
| `tier_effort_config` jsonb | tier → personalization-mode mapping + tiering ratios (kept as **config** so the deferred judgment call in §7 is a settings change) |
| `ramp_config` jsonb | e.g. cap new enrollments at 20/day during ramp week |

**`enrollments`** - a lead's participation in one campaign. **The state machine operates here** (so a lead can be `COMPLETED` in Pass 1 and `ACTIVE` in Pass 2 - this is how recycling works).

| Column | Notes |
|--------|-------|
| `id` PK, `lead_id` fk, `campaign_id` fk | |
| `current_state` | `NEW/ACTIVE/REPLIED/BOUNCED/UNSUBSCRIBED/COMPLETED` - **projection** of this enrollment's events |
| `current_step_no` | which sequence step is next |
| `next_send_at` timestamptz null | when the scheduler should next act |
| `assigned_mailbox_id` fk | **fixed at first send** - all follow-ups thread from the same mailbox (Part 9: never reroute in-flight threads) |
| `enrolled_tier` | tier captured at enrollment (historical accuracy even if the lead's tier later changes) |
| `personalization_mode` | `human_written / template_researched / template_auto` (Modes 1 & 2) |
| `best_reply_sentiment` null | `positive/neutral/negative` - best across this enrollment's replies; feeds positive-rate |
| `meeting_booked` bool | milestone flag, **not** a state (spec Part 3) - a lead with a meeting stays `REPLIED` |
| `enrolled_at`, `terminal_at` null | |

### 4.2 Supporting tables

**`sequences`** - `id, name, stop_on_reply, stop_on_hard_bounce, stop_on_unsubscribe` (the stop conditions from the Sequence Builder).

**`sequence_steps`** - `id, sequence_id, step_no, wait_days, subject_template, body_template, in_thread`. The CAN-SPAM footer is **not** stored per step; it's rendered on at send time from `compliance_settings` so it "cannot be removed by the user" (walkthrough Stage 4).

**`step_variants`** - `id, step_id, label (A/B/…), subject_template, body_template, active`. Sending picks an active variant (round-robin/weighted); analytics group by variant (Analytics 13a).

**`sent_messages`** - a projection/index for reply matching: `message_id PK, enrollment_id, mailbox_id, step_no, sent_at`. Derivable from `sent` events, but materialised so the poller can resolve an incoming `In-Reply-To` → the right enrollment in one indexed lookup. Rebuilt by `rebuild-projections`.

**`suppressions`** - `email (normalised) PK, reason, created_at`. A global opt-out/bounce list keyed by **email**, so that even a *re-import* of the same address is auto-suppressed at ingest. Compliance-critical.

**`mailboxes`** - the sending accounts (walkthrough Stage 0).

| Column | Notes |
|--------|-------|
| `id, display_name, from_address` | |
| `smtp_host, smtp_port, imap_host, imap_port, auth_type` | |
| `secret_ref` | pointer to the encrypted app-password/token (never stored or logged in plaintext) |
| `daily_cap` | e.g. 30 |
| `send_window` jsonb | days + start/end + how tz is resolved |
| `status` | `ok / paused / auth_failed / imap_stale / provider_blocked` (Part 9) |
| `resume_cap` null | for "resume at 50% of prior cap" |
| `last_successful_poll_at` | drives the stale-poll alert |

`sent_today` is **derived** from `sent` events since the mailbox's local midnight (canonical, drift-free), with an optional cached counter for speed. Deriving it means "daily cap reset at local midnight" (Part 7) needs no cron job - it's just "count today's sends."

**`compliance_settings`** - single row: `physical_address`, `optout_text` ("Reply STOP…"), from-name rules. This is the footer content and the CAN-SPAM guarantee.

**`settings`** - single row of global rules mapping to the Settings screen: deliverability toggles (stop-on-reply, stop-on-hard-bounce, soft-retry-≤2, suppress-unsubs, never-send-outside-window), and the **bounce auto-pause** parameters standardised from Part 11 - `min_sends_before_pct = 25`, `hard_bounce_pct_threshold = 4`, `rolling_window = 50`, `absolute_trigger = 3 in 10`, `resume_at_pct = 50` - plus scheduler tick interval, poll interval, stale-poll hours, and `default_timezone = US/Eastern`.

**`imports`** / **`import_rows`** - record each CSV import and its hygiene outcome (rows in, dropped-by-reason counts, committed count) for the Import Preview screen and an audit trail.

**Cold Storage is not a table** - it's a query: enrollments with `current_state = COMPLETED` whose leads are not suppressed. This matches the walkthrough's "holding pen, not a trash can."

### 4.3 The state machine as a pure reducer

The heart of correctness. A single pure function, no I/O:

```
applyEvent(state: EnrollmentState, event: Event): EnrollmentState
```

It encodes Part 3's transitions and the precedence rule. Terminal states carry a priority (`UNSUBSCRIBED=4 > BOUNCED=3 > REPLIED=2 > COMPLETED=1`); an event that would move an enrollment to a terminal state only "wins" if its priority ≥ the current terminal priority. So a lead already `REPLIED` who then sends "remove me" moves to `UNSUBSCRIBED`; nothing overrides `UNSUBSCRIBED`. `meeting_booked` sets the milestone flag and does **not** change state. Soft bounces increment a retry counter and only become terminal `BOUNCED` when retries (≤2) are exhausted; hard bounce is immediately terminal.

Because it's `(state, event) → state` with no side effects, the same function serves three jobs: (1) live projection updates, (2) `rebuild-projections` (fold the reducer over a lead's whole event history), and (3) exhaustive unit tests of every transition and every precedence collision. This is why the spec's guarantees become *proven properties* rather than hopes.

---

## 5. Testing strategy - how everything is proven before real email exists

This section is the reason the staging works. Read it before the stages.

### 5.1 The four test layers

1. **Unit tests (pure logic, no I/O).** The state-machine reducer (every transition + precedence collision), the metric formulas (numerator/denominator against hand-computed inputs), the render engine (merge-tag fallbacks, spintax expansion + variation counting, footer presence), the bounce-parsing and header-classification functions (fed fixture headers). Fast, deterministic, run on every commit.

2. **Integration tests via the scenario runner** (`MockTransport` + `VirtualClock`). A *scenario* is a script: enroll N leads, and for each send declare the outcome the mock inbox will produce (deliver / hard bounce / soft-then-recover / human reply with sentiment / OOO / unsubscribe / book meeting), plus time jumps. The runner drives the **real** scheduler and **real** poller over virtual time; only the transport and clock are simulated. Then it asserts the resulting event log, terminal-state breakdown, and metrics.

3. **End-to-end UI tests (Playwright).** Drive the actual dashboard against a backend running on `MockTransport`, replaying the walkthrough's clicks (import, tier, build sequence, enroll, tag in Unibox, book meeting, handle a bounce) and asserting the screens show the expected numbers.

4. **Live canary checklist (Stage 9 only).** A short manual + scripted validation that the real transport's behaviour (header formats, DSN codes, provider quirks) matches what the mock encoded. Because logic is already proven, this layer only validates *integration with real providers*, not business rules.

### 5.2 The golden cohort - the spec's Part 10 as a locked regression test

The spec hands us a **fully reconciled 885-lead cohort**. That's gold: it's a known-good end-to-end result. So it becomes the flagship automated test, used at three increasing levels of realism:

- **Stage 1 (raw events):** feed the 885-lead event sequence directly as synthetic events; assert terminal states = `UNSUBSCRIBED 40 / BOUNCED 18 / REPLIED 47 / COMPLETED 780`, summing to 885. Proves the reducer + precedence.
- **Stage 2 (metrics):** run the metric engine over that same log; assert **every** number in Part 10 and Part 13: reply 8.3%, positive 3.2%, unsub 4.6%, hard-bounce 2.0%, meetings 17 = 2.0/100 - *and* the Day-34 mid-campaign snapshot (reply 6.7%, positive 3.0%, meetings/100 2.0). Proves the formulas and denominators (contacted vs sent).
- **Stage 3 (full pipeline):** script the cohort through `MockTransport` - 18 hard bounces on step 1, 9 soft-then-recover, 72 human replies (28 pos / 19 neu / 25 neg, the 25 negatives also unsubscribing), 40 unsubscribes (25 reply + 15 link), 17 meetings - run the scheduler + poller over virtual time, then assert the log, terminal states, and all metrics match Part 10 **exactly**. Proves sequencing, rotation, tiering, threading, reply detection, bounce classification, the state machine, and metrics **all working together**, with zero real email.

If any future change breaks the math, this test goes red. The spec's "the math closes exactly" becomes a guarantee the CI enforces forever.

### 5.3 Edge-case scenarios (also offline, via the runner)

Beyond the golden cohort, the scenario runner covers the spec's previously-undefined edges: never-burst catch-up after simulated downtime (assert cap respected, timing shifts, no burst); daily-cap reset at local midnight; send-window enforcement across time zones (state/area-code inference, US-Eastern default, "unknown ≠ send now"); soft-bounce retry ≤2 then terminal; the **exact Part 11 auto-pause example** (55 sends, 3 hard in last 10 fires the absolute trigger; 4 in last 50 = 8% also over threshold); and the failure states (auth-failed → redistribute *new* sends but keep in-flight threads; IMAP-stale → pause that mailbox).

---

## 6. Stage-by-stage build plan

Nine stages. Each is independently buildable and testable, and builds on the last. The ordering front-loads correctness-critical logic (Stages 1-3), then workflow (4-6), then UI (7), then hardening (8), then real email (9).

---

### Stage 0 - Foundation & scaffolding

**Goal:** a running, testable skeleton with the two crucial abstractions defined.

**What's built**
- Repo, TypeScript config, Fastify app with a `/health` endpoint, ESLint/Prettier, Vitest, CI (typecheck + test on every push).
- Docker Compose for Postgres; Drizzle wired with an initial empty migration; `migrate up`/`down` scripts.
- The **`Clock`** interface with `SystemClock` + `VirtualClock`.
- The **`MailTransport`** interface (§3.3) with a stub implementation (throws "not implemented") so the seams exist from day one.
- Config loading (env) + a place for `settings`/`compliance_settings` seeds.

**How it's tested**
- `npm test` runs green; `/health` returns OK; migrations apply and roll back cleanly; `VirtualClock` fast-forwards correctly in a trivial test.

**Definition of done**
- Anyone can clone, `docker compose up`, migrate, and run tests. The `Clock` and `MailTransport` interfaces compile and are referenced nowhere-yet but ready.

**Depends on:** nothing.

---

### Stage 1 - Event log + lead state machine (the core)

**Goal:** the source of truth and the state machine, proven against the golden cohort at the raw-event level.

**What's built**
- Tables: `events` (append-only, with the trigger + role grants that forbid UPDATE/DELETE), `leads`, `campaigns`, `enrollments`.
- The pure reducer `applyEvent(state, event)` (§4.3): all Part 3 transitions + the precedence rule + soft-bounce retry counting.
- The **transactional event-append service**: append event **and** update the enrollment projection in one transaction.
- The **`rebuild-projections`** command: replay the log to reconstruct every enrollment's state from scratch.

**How it's tested**
- Unit: every transition and every precedence collision (e.g. `REPLIED` then `unsubscribe` → `UNSUBSCRIBED`; soft×3 → `BOUNCED`; `meeting_booked` keeps `REPLIED`).
- Golden cohort (raw-event level): load the 885-lead event fixture; assert terminal breakdown = 40/18/47/780, total 885.
- Rebuild equivalence: run live projections, then `rebuild-projections`, and assert the two match exactly (proves the log is the true source).

**Definition of done**
- Precedence and mutual-exclusivity are unit-proven; the 885 cohort reconciles from raw events; projections rebuild identically from the log; the `events` table physically rejects edits/deletes.

**Depends on:** Stage 0.

---

### Stage 2 - Metrics & analytics engine

**Goal:** every metric formula from Part 5, proven to reproduce Part 10 and Part 13 exactly.

**What's built**
- A query function per metric, each documenting its exact numerator/denominator: `contacted` (≥1 `delivered`), reply rate, positive reply rate, meetings + meetings/100, hard-bounce rate, soft-bounce rate, unsubscribe rate, step reply rate, and the auto-pause rolling-window counts. Denominators are enforced per spec: **bounce rates over `sent`; reply/unsub rates over `contacted`.**
- Analytics groupings: per-variant (13a), per-step (13b), per-tier (13c), and the health-trend time series (13d).
- Terminal-outcome breakdown query + the **self-check** (`sum of terminal states == total enrolled`).

**How it's tested**
- Golden cohort (metrics level): run all metrics over the 885 log; assert every Part 10 number and the Day-34 snapshot.
- Denominator tests: a fabricated hard-bounce-on-step-1 lead is **not** counted as `contacted` (spec's exact point); soft bounces never affect bounce-rate-over-sent incorrectly.
- Self-check test: inject a deliberately inconsistent event set and assert the invariant check catches it.

**Definition of done**
- Every number in Parts 10 and 13 reproduces from the event log; the outcome/rate distinction (overlap allowed for rates, mutual exclusivity for outcomes) holds in code.

**Depends on:** Stage 1.

---

### Stage 3 - Mock transport, scheduler, poller (the full pipeline, offline)

**Goal:** the whole send/receive engine, proven end-to-end through simulation - the stage that makes "no real inboxes yet" real.

**What's built**
- **`MockTransport`** (§3.3): deterministic `Message-ID`s; scriptable per-send outcomes; synthetic incoming messages with correct headers (threaded replies, DSN bounces with `5.x.x`/`4.x.x`, OOO with `Auto-Submitted`).
- **The scenario runner** (§5.1) over `MockTransport` + `VirtualClock`.
- **Scheduler tick** (Part 7): due-selection (`ACTIVE` + `next_send_at ≤ now` + healthy mailbox under cap + inside recipient-local window); round-robin opener assignment; **follow-ups fixed to the enrollment's `assigned_mailbox_id`** for threading; never-burst catch-up (cap enforcement *is* the never-burst guarantee - overflow rolls forward, oldest-first); ramp caps; the capacity meter (Σ caps − follow-ups due = room for new).
- **IMAP poller + reply detection** (Part 6): the 4-bucket classifier (bounce / auto-reply / human / unrelated), threading match via `sent_messages`, DSN parsing, OOO detection, **opt-out/STOP detection → `unsubscribe` + immediate suppression**, and **idempotent processing** (dedupe by processed UID/Message-ID so nothing is double-counted).
- Time-zone resolution (state/area-code → tz; else US-Eastern; unknown never means "send now").
- Bounce auto-pause (Part 11): sample gate 25, hard-only >4% over last 50, absolute 3-in-10; resume at 50%.

**How it's tested**
- **Golden cohort (full-pipeline level):** the flagship test in §5.2 - script the entire 885-lead cohort through the mock transport, run scheduler + poller over virtual time, assert the log, terminal states, and every metric match Part 10 exactly.
- Edge scenarios (§5.3): catch-up/never-burst; midnight cap reset; window/tz enforcement; soft-retry-≤2; the exact Part 11 auto-pause example; auth-failed redistribution (new sends move, in-flight threads don't); IMAP-stale pause.
- **Transport-swap test:** a second trivial transport implementation proves that swapping implementations changes nothing downstream (the Stage 9 guarantee, verified now).

**Definition of done**
- A full campaign reconciles end-to-end against the spec's numbers with no real email; every previously-undefined edge case passes; the transport is provably swappable.

**Depends on:** Stages 1-2. *This is the milestone where the core product is functionally complete and correct - everything after is workflow, presentation, hardening, and the real-email adapter.*

---

### Stage 4 - Sequences, personalization, compliance rendering

**Goal:** turn stored templates into correctly-rendered, compliant, correctly-threaded messages.

**What's built**
- Tables: `sequences`, `sequence_steps`, `step_variants`.
- **Render engine:** merge tags with fallbacks (`{{first_name|there}}`, `{{company|your team}}`, `{{custom_observation|…}}`, `{{market|US}}`, `{{sender_physical_address}}`); spintax (`{{RANDOM|a|b|c}}`, one pick per render, seedable for deterministic tests) with **unique-variation counting** for the pre-send check.
- **Personalization modes:** Mode 1 (human-written - the manual composer produces a bespoke body, threaded so any follow-ups still match); Mode 2 (template-filled: *researched slot* fills `custom_observation` per lead; *auto slot* falls back to a market-segment rule).
- **CAN-SPAM footer** (Part 8): appended to **every** step at render time from `compliance_settings`, not removable; opt-out honoring already wired in Stage 3.
- **Pre-send checks** (walkthrough Stage 4): all merge tags have fallbacks; spintax valid + variation count; plain-text/no-links-in-step-1; footer present (address + opt-out); a deliverability score.

**How it's tested**
- Render snapshots (lead + template → expected output), including the missing-`first_name` fallback path.
- Footer-always-present test (a template that tries to omit it still renders it).
- Missing-fallback detection; spintax validity + exact variation count (the "24 unique variations" style check).
- Threading test: rendered Mode-1 and Mode-2 messages pushed through `MockTransport` produce correct `Message-ID`/`In-Reply-To`, and a scripted reply threads back to the right enrollment.

**Definition of done**
- Templates render with correct fallbacks/spintax; the compliance footer cannot be omitted; pre-send checks match the walkthrough; both personalization modes send correctly-threaded messages through the mock transport.

**Depends on:** Stages 1-3.

---

### Stage 5 - Import, hygiene, tiering, suppression, recycling

**Goal:** get leads into the system cleanly and safely, and support the recycle/fresh model.

**What's built**
- CSV import with hygiene (role-based `info@/sales@`, invalid/malformed, duplicates, missing `first_name`), an Import Preview (counts by reason), and Drop-flagged vs Import-all.
- **Suppression enforcement at ingest:** any address in `suppressions` (unsubscribed or hard-bounced, ever) is auto-excluded - even on re-import.
- **Tiering** (A/B/C/nurture) with the parked-nurture rule (nurture leads are never auto-enrolled), and the tier→personalization-mode mapping read from `tier_effort_config`.
- **Recycling:** re-enroll cold-storage leads into a new campaign as fresh enrollments; a **no-identical-resend guarantee** (track which sequence/step content each lead has already received via events, so Pass 2 must use a different message).
- `imports`/`import_rows` audit records.

**How it's tested**
- Import fixture reproduces the walkthrough's exact split: 1,000 → 885 (60 role-based, 40 invalid, 15 dup, 82 missing-name **kept**).
- Suppressed-address exclusion (import a list containing a previously-unsubscribed email → it's dropped).
- Tier distribution matches; nurture leads never appear in auto-enrollment selection.
- Recycle test: a `COMPLETED` lead re-enrolled into Pass 2 cannot be sent the identical Pass-1 email.

**Definition of done**
- The import example reconciles exactly; suppression is enforced across imports; tiering + parked-nurture behave; recycling never double-sends.

**Depends on:** Stages 1-4.

---

### Stage 6 - API layer

**Goal:** expose everything the dashboard needs, tested against the seeded golden cohort.

**What's built**
- Fastify JSON API with Zod-validated inputs, covering: mailboxes (CRUD + status + Test-Connection endpoint that calls `transport.verify`), leads/enrollments (list + filter by tier/status), campaigns (create, enroll, capacity), sequences/steps/variants, the **Unibox feed** + tag-sentiment + mark-meeting actions, analytics endpoints (per-variant/step/tier + health trend), settings, compliance settings, and an alerts feed (mailbox failures, stale polls, auto-pause).
- **Auth:** single-operator login (session + password) - the app must not be publicly reachable unauthenticated on a VPS. (Note: per operational safety, credential entry and any destructive action are gated; the API never logs secrets.)

**How it's tested**
- API integration tests over the seeded 885 cohort: analytics endpoints return the Part 10 numbers; the Unibox feed shows the right replies.
- Action tests: tag-sentiment appends a correctly-shaped `human_reply` sentiment and updates positive-rate; mark-meeting appends `meeting_booked` and updates meetings/100 without changing state; enroll appends `enrolled` and respects capacity/ramp caps.

**Definition of done**
- Every screen's data is served by a tested endpoint; every write action produces the correct event(s) and the correct state/metric change.

**Depends on:** Stages 1-5.

---

### Stage 7 - Dashboard UI

**Goal:** the full operator experience - including the spec sections that were never drawn as screens.

**What's built**
- React + Vite dashboard implementing the nine screens (Overview, Leads, Mailboxes, Sequences, Campaigns, Unibox, Analytics, Cold Storage, Settings) against the Stage-6 API, with the walkthrough's exact numbers and interactions (capacity meter, one-click Unibox tagging with optional AI suggestion, mark-meeting, tier filters, sparkline health trends).
- **The pending screens the spec implied but the walkthrough hadn't mocked**, now built for real:
  - **Reply-detection view** - the 4-bucket classifier's output (bounce / auto-reply / human / unrelated), including the separate auto-reply/OOO tab.
  - **Missed-day / catch-up notice** - the "Scheduler Resumed After Downtime" panel (never-burst explanation).
  - **CAN-SPAM footer editor** - editing `compliance_settings` (physical address + opt-out text), with the guarantee it's always appended.
  - **Mailbox failure states** - the `AUTH FAILED` reconnect panel, the `IMAP Poll Stale` panel, and the auto-pause panel, driven by real `status` values.

**How it's tested**
- Component tests for the interactive pieces (Unibox tagging, capacity meter, filters).
- Playwright e2e against the mock-transport backend: replay the walkthrough - import → tier → build sequence → enroll → tag replies → book a meeting → handle a bounce/auth-failure - and assert the screens show the expected numbers and state changes.

**Definition of done**
- All nine screens plus the four previously-unmocked screens render real data; the walkthrough's clicks and decisions are reproducible in the UI against the simulated backend.

**Depends on:** Stage 6.

---

### Stage 8 - Hardening, ops, observability

**Goal:** make it safe to run unattended for weeks.

**What's built**
- Secrets encryption at rest (libsodium; key from env) and a guarantee secrets are never logged.
- Append-only enforcement verified in production config (trigger + role grants on `events`).
- Backups (scheduled `pg_dump`) + a documented restore procedure.
- Structured logging + an **alerts channel** (email/Telegram/console) for the Part 9 failures (auth-failed, stale poll, provider block) and auto-pause events.
- The periodic **self-check job** (outcomes sum to total; alert on drift) and a scheduled **projection-rebuild-and-compare** sanity check.
- SMTP retry/backoff and IMAP retry parameters made configurable; the stale-poll threshold surfaced in Settings.
- Deploy: Docker Compose (app + Postgres) with a documented runbook; systemd unit as the no-Docker alternative.

**How it's tested**
- Restore-from-backup drill (restore into a clean DB, assert data intact).
- Projection-rebuild equals live state on a populated DB.
- Drift self-check catches an injected inconsistency and fires an alert.
- A clean-VPS deploy dry-run validates the runbook.

**Definition of done**
- The system runs unattended, surfaces failures loudly, backs itself up, and can rebuild all state from the event log. Nothing fails silently.

**Depends on:** Stages 1-7 (can begin in parallel with 7 for the non-UI parts).

---

### Stage 9 - Going live: real SMTP/IMAP transport (the deferred piece)

**Goal:** connect real mailboxes - by configuration only - and validate that reality matches what the mock encoded.

**What's built**
- **`SmtpImapTransport`** implementing the same `MailTransport` interface with nodemailer (SMTP), imapflow (IMAP), mailparser (MIME/DSN). A config flag in the composition root selects it. **No other code changes.**
- Mailbox setup wired to real `verify` (the "Test Connection" round-trip: send via SMTP, read back via IMAP - the Stage-0 walkthrough screen, now real).
- A **staged live rollout**, not a big-bang cutover:
  1. Connect **one** real mailbox in canary mode; send to a couple of your own seed addresses; verify round-trip, threading, human-reply detection, and bounce handling against reality.
  2. Validate DSN/OOO parsing against **real** provider messages (Gmail/Outlook DSNs and auto-responders) and adjust patterns/codes if a provider differs from the fixtures.
  3. Tune caps/windows conservatively.
  4. Enable the remaining mailboxes.
  5. Run a **small real cohort** and reconcile its live numbers against the model.

**How it's tested**
- The entire offline suite (Stages 1-8) still passes unchanged - because it's transport-agnostic, it keeps guarding the logic.
- The live canary checklist (§5.1 layer 4): real round-trip, real reply threads back to the right enrollment, real hard/soft bounce classifies correctly, real OOO doesn't stop a sequence, a real "STOP" suppresses immediately.
- A small real cohort's metrics reconcile against the model (the same reconciliation the golden cohort does, now on live data).

**Definition of done**
- Real mailboxes plug in via config alone; the canary confirms real round-trip + reply/bounce/OOO/opt-out handling; a real cohort's numbers reconcile. Because all business logic was proven in Stages 1-8, this stage validated **integration with real providers**, not correctness of the rules.

**Depends on:** Stages 1-8. This is deliberately last and deliberately thin - the design work that makes it thin was done in Stage 3.

---

## 7. Spec → build traceability

Proof the schema and modules map closely to the Event Model spec, as required.

| Spec / walkthrough element | Where it lives in the build |
|---|---|
| Part 2 - event log (10 event types) | `events` table (§4.1); enum matches 1:1; append-only enforced |
| Part 3 - lead state machine | `enrollments.current_state` projection + `applyEvent` reducer (§4.3, Stage 1) |
| Part 3/4 - precedence `UNSUB > BOUNCED > REPLIED > COMPLETED` | priority ordering inside `applyEvent`; proven by golden cohort (Stage 1) |
| Part 4 - unsubscribe = reply + unsubscribe | two events emitted; terminal via precedence; verified in metrics (Stage 2) |
| Part 5 - every metric formula | metrics engine, one query per metric, denominators enforced (Stage 2) |
| Part 6 - reply detection (4 buckets, threading) | poller + `sent_messages` index (Stage 3) |
| Part 7 - scheduler, catch-up, time zones | scheduler tick (Stage 3) |
| Part 8 - CAN-SPAM footer + opt-out | render engine + `compliance_settings` + opt-out detection (Stages 3-4, UI in 7) |
| Part 9 - failure states | mailbox `status` machine + alerts (Stage 3 logic, Stage 7 UI, Stage 8 alerts) |
| Part 10 - worked 885 cohort | the golden regression test at three levels (Stages 1-3) |
| Part 11 - bounce auto-pause thresholds | `settings` params + scheduler check; exact example is a test (Stage 3) |
| Walkthrough Stage 0 - mailbox setup / Test Connection | `mailboxes` + `transport.verify` (schema Stage 1; real in Stage 9) |
| Walkthrough Stage 1 - import hygiene (1,000→885) | ingest module; exact split is a test (Stage 5) |
| Walkthrough Stage 2 - tiering | `leads.tier` + `tier_effort_config` (Stage 5) |
| Walkthrough Stages 3-4 - modes + sequence + preview | render engine + `sequences/steps/variants` (Stage 4) |
| Walkthrough Stages 5,8 - capacity/ramp/rotation | scheduler capacity meter (Stage 3) |
| Walkthrough Stage 6 - Unibox | Unibox feed + tag/meeting actions (API Stage 6, UI Stage 7) |
| Walkthrough Stage 9 - recycle vs fresh | recycling + no-double-send (Stage 5) |
| Walkthrough Stage 10 - analytics | analytics groupings (Stage 2 logic, Stage 7 UI) |

---

## 8. Deferred product decisions - kept cheap to revisit

The spec deliberately left one judgment call open (Tier-A conversion → shift toward human-written Mode 1, shrink Tier-C automation). The design keeps it a **settings change, not a code change**, so it stays undecided until real data speaks:

- **Tiering ratios** (currently 29/51/14/6) and the **tier → personalization-mode mapping** live in `campaigns.tier_effort_config`, not in code. Shifting effort toward Mode 1 later = editing config for the next campaign.
- **Per-tier effort minutes** and which tier uses which mode are data, not branches. No redeploy needed to rebalance.
- Because analytics already slice **meetings and positive-rate by tier and by mode** (Stage 2), you'll have exactly the evidence the deferred decision needs - the plan surfaces the signal without pre-committing to the answer.

Similarly, override choices A-F in §1 are isolated behind seams (transport interface, clock interface, optional AI adapter, config-driven thresholds) so revisiting any of them touches one module, not the system.

---

## 9. Appendix - configuration, deploy, and operational notes

**Environment / config**
- DB connection, encryption key (for `secret_ref`), scheduler tick interval, IMAP poll interval, stale-poll hours, default time zone (US/Eastern), alert-channel settings, and a `MAIL_TRANSPORT=mock|smtp_imap` flag (the one switch that goes live at Stage 9).

**Deploy (recommended)**
- Docker Compose on the VPS: two services (app, Postgres) + a volume for Postgres data + a mounted backup directory. `docker compose up -d`; migrations run on boot. The scheduler and poller run as pg-boss jobs inside the app process (or a second worker process sharing the codebase). *No Redis, no managed services, no cloud dependencies.*
- Alternative (no Docker): Postgres from the OS package, the app under a systemd unit, backups via a cron `pg_dump`.

**Operational guarantees baked in**
- Nothing fails silently (Part 9 statuses + alerts, Stage 8).
- The math is continuously self-checked (outcomes sum to total; drift alerts, Stage 8).
- All state is rebuildable from the event log (`rebuild-projections`, Stage 1) - your disaster recovery and your correctness audit are the same command.
- Secrets encrypted at rest, never logged (Stage 8).
- Append-only facts physically enforced (Stage 1).

**Build order at a glance**

```
0 Foundation ──▶ 1 Event log + state machine ──▶ 2 Metrics
                                                    │
                          3 Mock transport + scheduler + poller  ◀── core complete here
                                                    │
   4 Sequences/render/compliance ──▶ 5 Import/tiering/recycle ──▶ 6 API ──▶ 7 Dashboard UI
                                                    │
                                        8 Hardening/ops/observability
                                                    │
                                        9 Real SMTP/IMAP (config-only swap)
```

By the end of Stage 3, the product is functionally complete and provably correct against the spec's own reconciled numbers - with no real inbox in sight. Stages 4-8 add the workflow, presentation, and operational safety around that proven core. Stage 9 connects reality, and because the seam was designed in from Stage 0, it's a configuration change plus a careful canary - not a rewrite.
