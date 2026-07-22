# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- **Keep this file current.** When you learn something new — a better approach, a good practice, a lesson from a mistake — add it here. When something here is outdated or no longer used, remove it. Write and edit this file tersely: facts only, no filler.
- **Commit and push after every completed task.** Branch off `main` if not already on it; push to `origin main`.

## Current state: documentation-complete, pre-implementation

This repo currently contains **only design and build documentation — no code has been written yet.** Milestone M0 (docs) is done; the next action is task **B0.1** (scaffold the monorepo). Do not assume `package.json`, build tooling, or a test runner exist until B0 lands. When you add them, follow the stack and layout already specified in the docs rather than choosing your own.

## Where to look first

- **[docs/00-INDEX.md](docs/00-INDEX.md)** — the map of all documentation and the reading order. Start here.
- **[PROGRESS.md](PROGRESS.md)** — the single source of truth for what's built. Every task has an ID (B0.1, F3.2, …) and a checkbox. **Tick tasks here as you complete them and add a dated log entry.** Task definitions live in [docs/14-build-stages-backend.md](docs/14-build-stages-backend.md) (backend B0–B8) and [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md) (frontend F0–F8).
- **[docs/01-decisions.md](docs/01-decisions.md)** — the decision register (A–Z, all locked). Before changing an architectural choice, edit this file first with the rationale. Decisions marked 🔧 are meant to be flipped via config/settings; 🔒 require a documented change here.

The three root design docs (`build_plan.md`, `event_model_spec.md`, `campaign_walkthrough_v2.md`) define *what* the system is. The `docs/` folder defines *how* it gets built. When code and docs disagree, treat it as a bug in one of them — reconcile, don't silently diverge.

## What this product is

A single-operator cold-email campaign tool for one freelancer on one always-on VPS (not multi-tenant SaaS). It sends sequenced cold emails across a few warmed mailboxes within safe daily caps, detects replies/bounces/opt-outs via IMAP, and reports a small set of zero-cost metrics. The hard parts are (a) correctness of the event/state/metrics model and (b) robust SMTP/IMAP handling.

## The one architectural idea everything rests on: event-sourced-lite

Read [docs/04-domain-events-state.md](docs/04-domain-events-state.md) and [docs/03-database-schema.md](docs/03-database-schema.md) before touching domain logic. The model:

- **The `events` table is the only source of truth.** It is append-only — enforced physically (a trigger blocks UPDATE/DELETE, and the app's DB role lacks those grants). Never design a feature that mutates a past event; append a new one.
- **Lead state is a projection**, derived by folding a pure reducer `applyEvent(state, event) → state` (in `apps/server/src/domain/`, no I/O) over an enrollment's events. Terminal-state precedence is `UNSUBSCRIBED > BOUNCED > REPLIED > COMPLETED`. `meeting_booked` is a milestone flag, not a state.
- **Metrics are queries** over the log, each with an exact numerator/denominator ([docs/05-metrics-and-analytics.md](docs/05-metrics-and-analytics.md)). The denominator law is load-bearing: **bounce rates ÷ `sent` events; reply/positive/unsub/meeting rates ÷ `contacted` leads** (contacted = ≥1 `delivered`, not `sent`).
- **The state machine lives on `enrollments`, not `leads`** — a lead can be `COMPLETED` in Pass 1 and `ACTIVE` in Pass 2. This per-campaign state is what makes recycling work.
- All writes go through **one transactional chokepoint** (`eventStore.append`): it appends the event(s) *and* updates the affected projections in a single Postgres transaction. Nothing else writes `events` or `enrollments.current_state`.
- `rebuild-projections` replays the whole log to reconstruct every projection — this is both disaster recovery and the correctness audit. If a projection ever drifts from the log, rebuild.

### Two abstractions that let the whole system be built and tested offline

Everything before Stage B8 runs with **no real email**. This is deliberate and is the reason the staging works:

- **`MailTransport`** interface — all email I/O goes through it. `MockTransport` (scriptable, deterministic Message-IDs, synthetic inbound with *real* header shapes) is used through B7; `SmtpImapTransport` (nodemailer/imapflow/mailparser) is wired in only at B8. Swapping them is a one-line change in the composition root (`MAIL_TRANSPORT=mock|smtp_imap`). Nothing downstream knows which is active.
- **`Clock`** interface — `SystemClock` in prod, `VirtualClock` in tests. Multi-day sequences (0/3/4/5-day waits, midnight cap resets, stale-poll timers) are tested by fast-forwarding virtual time so a full ~49-day campaign runs in milliseconds.

## The golden cohort — the load-bearing regression test

The spec's Part 10 defines a fully reconciled **885-lead cohort** (terminal outcomes 40/18/47/780; reply 8.3%, positive 3.2%, unsub 4.6%, hard-bounce 2.0%, 17 meetings). It is a locked regression at three levels: raw events (B1), metrics (B2), and full pipeline through the mock transport + virtual clock (B3). These tests are tagged `@golden` and **must never be skipped** — if a change turns them red, the math stopped closing and that is the signal, not noise. See [docs/13-testing-strategy.md](docs/13-testing-strategy.md).

## Build order and the contract seam

The build is **contract-first and two-track**. [docs/10-api-contract.md](docs/10-api-contract.md) is the frozen seam between backend and frontend; its executable form is the Zod schemas in `packages/shared` — **a contract change edits both the doc and that package in the same commit.**

- Backend (B0–B8) front-loads correctness: event log + state machine (B1) → metrics (B2) → mock transport + scheduler + poller (B3, *core complete here*) → render/compliance (B4) → ingest (B5) → API (B6) → hardening (B7) → real transport (B8).
- Frontend (F0–F8) builds against MSW mocks fed by golden-cohort fixtures (exported by task B2.18), and integrates against real routes as each B6 group lands. Dependency matrix at the bottom of [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md).
- **Recommended solo order:** B0→B6, then F0→F8, then B7, B8.

## Planned tech stack (see [docs/02-architecture.md](docs/02-architecture.md))

npm-workspaces monorepo: `apps/server` (TypeScript/Node ≥22 — dev on 24, Fastify, Drizzle ORM, pg-boss jobs), `apps/web` (React 18 + Vite + Tailwind + shadcn/ui + TanStack Query), `packages/shared` (Zod DTO schemas — the runtime form of the API contract). PostgreSQL 16 only — **no Redis, no broker**; background work (scheduler tick, IMAP polls, confirm-delivery, self-check) runs as pg-boss jobs in the same Node process (`ROLE=all|api|worker`).

### Module boundaries to respect (`apps/server/src/`)

`domain/` is pure — it imports nothing from db/api/transport and never reads the wall clock. `db/repos/` is the only place SQL/Drizzle lives. `scheduler/`, `poller/`, `render/`, `ingest/`, `services/` depend on `domain` + `db/repos` + the *interfaces* `transport/types` and `clock` — never concrete transports. Only `composition.ts` imports concrete implementations. These boundaries are enforced by ESLint import rules; don't route around them.

## Commands

**None exist yet** — tooling arrives in B0. The docs specify what they will be; once B0.10 lands, expect (subject to what B0 actually sets up):

- `docker compose up -d` — start Postgres (dev)
- `npm run db:migrate` / `npm run db:rollback` — Drizzle migrations (applied on boot in prod)
- `npm test` — Vitest unit + integration (needs the Postgres test DB)
- The `@golden` suite is a separate required CI job; the walkthrough-replay Playwright e2e (`apps/web/e2e/walkthrough.spec.ts`) is the flagship UI test.
- `npm run rebuild-projections -- --dry-run` — projection drift check / correctness audit

When you scaffold these, add the real, verified invocations here and to [docs/00-INDEX.md](docs/00-INDEX.md).

## Conventions worth knowing before you write domain code

- **Append-only means append-only.** Sentiment tagging is a separate `sentiment_tagged` event (not an UPDATE of `human_reply.sentiment`) precisely because events are immutable — see decision M.
- **`delivered` is fired by a scheduled `confirm-delivery` job** at send + `delivery_confirm_hours` (default 6), not at SMTP-accept time — decision N.
- **Opt-out (STOP) auto-suppresses immediately** on a keyword-matched human reply (decision F), with a `settings.optout_detection = 'auto'|'tag_only'` escape hatch. Suppression is permanent, global (keyed by email), and enforced at four layers (ingest, enrollment selection, send time, event append).
- **Recycling never re-sends an identical message:** every `sent` event stores a `content_hash` of the template; enrollment is blocked if a lead would receive a hash they already got — decision Q.
- **Reply threading is header-based** (`In-Reply-To`/`References` → the stored `Message-ID`), never subject-line matching. Follow-ups are fixed to the enrollment's originally-assigned mailbox and are never rerouted — rerouting breaks threading.
- Imported leads start **untiered (`tier = NULL`)**, not defaulted — decision R.
