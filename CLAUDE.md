# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules

- **Keep this file current.** When you learn something new — a better approach, a good practice, a lesson from a mistake — add it here. When something here is outdated or no longer used, remove it. Write and edit this file tersely: facts only, no filler.
- **Commit and push after every completed task.** Branch off `main` if not already on it; push to `origin main`.

## Current state: implementation underway

M0 (docs), B0–B6 (foundation → event log → metrics → mock transport/scheduler/poller → render engine → ingest → API layer) are complete — **M1 proven core** ✅; M2 needs F0–F3 on top of the finished B6. **Check [PROGRESS.md](PROGRESS.md) for the current task pointer before starting work.** Dev loop assumes: Node ≥22, Docker running (`docker compose up -d` → Postgres 16 on port **5433**), `.env` copied from `.env.example` (generated keys).

Seams to know about: `SequenceProvider` (DB-backed `DbSequenceProvider` in prod composition; tests inject `StaticSequenceProvider` via the `sequences` compose override), `Renderer` (`render/engine.ts` — pure/sync; the CALLER loads `RenderContext`: mode, custom_fields, auto_observations, compliance row, threadSubject), `JobPort` (scenario inline queue in tests; pg-boss in prod). The scenario runner (`apps/server/test/helpers/scenario.ts`) is the integration-test entry point: real scheduler+poller+eventStore over MockTransport+VirtualClock.

B4 facts that bite: the renderer ECHOES `variant.contentHash` (hash computed at variant-SAVE time via `render/hash.ts` — decision Q), so fixture hashes like `'sha-stepN'` stay stable across template edits. Empty `compliance_settings.physical_address` refuses ALL sends (`compliance_missing_address` alert) — `resetCoreTables` seeds a test address; blank it explicitly to test the guard. Soft-retries pin the ORIGINAL variant (round-robin would change the resent text). In-thread follow-ups re-render the step-1 subject for `Re:` from the first sent event's `attributes.variant_id`. Fatal pre-send checks → `render_failed` outcome: nothing appended, enrollment stays due.

B6 facts that bite: routes validate with the SHARED zod schemas via hand-rolled validator/serializer compilers (`api/plugins/zodCompilers.ts`) — responses are RE-VALIDATED at serialization, so a contract-violating response is a 500 (`.strict()` everywhere; that's also the no-secret-leak tripwire). Zod-4 ZodError doesn't extend Error → `RequestValidationError` carries request failures to the errorHandler. Raw `db.execute` bypasses drizzle's column mapping — timestamptz come back as STRINGS (format ISO in SQL via `to_char … AT TIME ZONE 'UTC'`). Sequence saves: replace-set is literal only at zero sends; after sends dropped variants RETIRE (active=false) and steps can't be deleted/renumbered (`SequenceEditConflictError` → 422; docs/10 footnote ¹). The API test harness (`test/api/helpers/app.ts`) rebuilds Cookie headers from the RAW Set-Cookie segment (res.cookies decodes secure-session's `payload;nonce`). `SIMULATED_CLOCK=true` swaps in VirtualClock + inline jobs + `POST /system/advance-clock` (mock builds only; boot refuses otherwise). The B2.18 fixtures are byte-locked to the API by the golden-parity suite — regenerate via `npm run golden:export` ONLY together with a deliberate contract/schema change, in the same commit.

B5 facts that bite: `listDue` only serves enrollments of `campaigns.status='active'` — a draft recycle target stays silent until activated; test campaigns must be inserted `'active'`. `imports.counts.ok` is the IMPORTABLE-CLEAN display number (ok-flag + missing_first_name) per docs/03's example — row flags stay disjoint. `invalid`/`suppressed` rows are never imported under either commit mode, and suppression is re-checked at commit time. Ingest alias-map keys are the POST-snake_case header form ('e-mail' → 'e_mail'). Recycle's hash guard blocks the WHOLE action (`RecycleSequenceConflictError` lists offending steps); nurture is excluded from all bulk enrollment paths.

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
- **Metrics are queries** over the log, each with an exact numerator/denominator ([docs/05-metrics-and-analytics.md](docs/05-metrics-and-analytics.md)). The denominator law is load-bearing: **campaign bounce rates ÷ distinct leads sent-to (Part 10's 18÷885); reply/positive/unsub/meeting rates ÷ `contacted` leads** (contacted = ≥1 `delivered`, not `sent`). Per-mailbox auto-pause windows count send *events* (Part 11) — a different metric.
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

## Commands (verified)

- `docker compose up -d` — dev Postgres 16 (`coldemail-postgres`, port 5433, dbs `coldemail` + `coldemail_test`)
- `npm run db:migrate` / `db:rollback` / `db:status` — in-repo SQL migration runner (paired `.up.sql`/`.down.sql` in `apps/server/src/db/migrations/`; drizzle-kit is diff-generation assist only)
- `npm test` — all Vitest projects (unit / integration / golden); DB-backed projects need the Postgres container. `npx vitest run --project unit` = fast, no DB. `npm run test:golden` = the locked 885-lead regression (never skip)
- `npm run rebuild-projections -- --dry-run` — projection drift check (exit 1 on drift). Golden fixture: regenerate via `npx tsx test/fixtures/golden/write.ts` in `apps/server` — but only deliberately; a determinism test locks generator ⇔ committed `events.jsonl`
- `npm run typecheck` / `lint` / `format` — lint enforces the module boundaries (`eslint.config.mjs`; blocks are a partition — see Tooling lessons)
- `npm run dev -w @coldemail/server` — tsx watch boot (needs `.env`)
- CI (`.github/workflows/ci.yml`): `ci` job (typecheck + lint + format:check + migration drill + unit/integration) and `golden` job (the locked regression), both on Postgres services.

## Conventions worth knowing before you write domain code

- **Append-only means append-only.** Sentiment tagging is a separate `sentiment_tagged` event (not an UPDATE of `human_reply.sentiment`) precisely because events are immutable — see decision M.
- **`delivered` is fired by a scheduled `confirm-delivery` job** at send + `delivery_confirm_hours` (default 6), not at SMTP-accept time — decision N.
- **Opt-out (STOP) auto-suppresses immediately** on a keyword-matched human reply (decision F), with a `settings.optout_detection = 'auto'|'tag_only'` escape hatch. Suppression is permanent, global (keyed by email), and enforced at four layers (ingest, enrollment selection, send time, event append).
- **Recycling never re-sends an identical message:** every `sent` event stores a `content_hash` of the template; enrollment is blocked if a lead would receive a hash they already got — decision Q.
- **Reply threading is header-based** (`In-Reply-To`/`References` → the stored `Message-ID`), never subject-line matching. Follow-ups are fixed to the enrollment's originally-assigned mailbox and are never rerouted — rerouting breaks threading.
- Imported leads start **untiered (`tier = NULL`)**, not defaulted — decision R.

## Tooling lessons

- **ESLint flat config does not merge rule options across matching blocks — last match wins per rule.** The boundary rules in `eslint.config.mjs` therefore *partition* `apps/server/src` (domain / db / transport+clock+composition / rest); keep the partition exhaustive when adding blocks, and verify new rules actually fire with a temp violation file.
- **Drizzle `sql` templates expand a bare interpolated array into a tuple** (`($1,$2,…)`) — which can't cast to `text[]`. Use `sql.param([...])` to keep it one array placeholder.
- **`resetCoreTables` truncates core tables but NOT the seeded `settings` row** — a test that mutates settings leaks into later runs. The scenario runner's `init()` restores the tunables it owns; do the same in any new DB-backed suite that edits settings.
- **The test DB is shared and serial** — never run two DB-backed vitest invocations concurrently (a parallel run's truncates corrupt a long-running golden replay mid-flight).
- Migrations may land out of filename order across stages (0004 before 0003, 0006 before 0005): the runner applies pending-by-filename, so this is fine — but a later-numbered migration must never depend on an earlier-numbered one that hasn't landed yet.
- The Bash tool's working directory persists between calls on this machine — use absolute paths or re-`cd` to the repo root.
