# Architecture - Repo Layout, Process Model, Module Boundaries

Refines [build_plan.md](../build_plan.md) §3 into the concrete shape the code takes. Decisions referenced by letter live in [01-decisions.md](01-decisions.md).

---

## 1. Monorepo layout (decision G)

```
email_campaign/
├── package.json                # workspaces: ["apps/*", "packages/*"]
├── docker-compose.yml          # postgres (dev) / app+postgres (prod profile)
├── .env.example
├── PROGRESS.md
├── docs/
├── packages/
│   └── shared/                 # ZERO runtime deps except zod
│       ├── src/
│       │   ├── api/            # Zod schemas for every API DTO (decision H)
│       │   │   ├── auth.ts  mailboxes.ts  leads.ts  imports.ts
│       │   │   ├── sequences.ts campaigns.ts unibox.ts analytics.ts
│       │   │   ├── settings.ts alerts.ts common.ts (pagination, error envelope)
│       │   ├── domain/         # event types, enrollment states, enums - shared vocabulary
│       │   └── index.ts
│       └── package.json
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── domain/         # PURE. No I/O, no imports from other layers.
│   │   │   │   ├── events.ts           # event constructors + validation
│   │   │   │   ├── reducer.ts          # applyEvent(state, event) → state
│   │   │   │   ├── precedence.ts       # terminal priority
│   │   │   │   └── invariants.ts       # self-check predicates
│   │   │   ├── db/
│   │   │   │   ├── schema/             # Drizzle table definitions (mirror docs/03)
│   │   │   │   ├── migrations/         # drizzle-kit output, committed
│   │   │   │   └── repos/              # ONLY place SQL/Drizzle queries live
│   │   │   ├── services/
│   │   │   │   ├── eventStore.ts       # transactional append + projection update
│   │   │   │   ├── rebuildProjections.ts
│   │   │   │   └── metrics/            # one function per metric (docs/05)
│   │   │   ├── transport/
│   │   │   │   ├── types.ts            # MailTransport interface
│   │   │   │   ├── mock/               # MockTransport + scenario scripting
│   │   │   │   └── smtpImap/           # Stage B8 only
│   │   │   ├── clock/                  # Clock, SystemClock, VirtualClock
│   │   │   ├── scheduler/              # tick, pacing, rotation, capacity (docs/06)
│   │   │   ├── poller/                 # fetch loop, classifier, threading (docs/07)
│   │   │   ├── render/                 # merge tags, spintax, footer, checks (docs/08)
│   │   │   ├── ingest/                 # CSV, hygiene, tiering, recycle (docs/09)
│   │   │   ├── api/                    # Fastify plugins: one file per route group
│   │   │   │   ├── auth.ts mailboxes.ts leads.ts imports.ts sequences.ts
│   │   │   │   ├── campaigns.ts unibox.ts analytics.ts settings.ts
│   │   │   │   ├── alerts.ts system.ts
│   │   │   │   └── plugins/ (session, errorHandler, requireAuth, csrfHeader)
│   │   │   ├── jobs/                   # pg-boss job definitions + registration
│   │   │   ├── alerts/                 # alert emitter (db row + optional webhook)
│   │   │   ├── config/                 # env parsing (zod), settings loader
│   │   │   ├── composition.ts          # THE composition root (see §4)
│   │   │   └── main.ts
│   │   ├── test/
│   │   │   ├── unit/  integration/  fixtures/
│   │   │   └── helpers/ (scenario runner, test db)
│   │   └── package.json
│   └── web/
│       ├── src/                        # see docs/11
│       ├── e2e/                        # Playwright
│       └── package.json
```

**Import direction rules (enforced by ESLint `no-restricted-imports`):**

- `domain/` imports nothing from the app (only `packages/shared` types). It is pure functions.
- `db/repos` may import `domain`. Nothing imports Drizzle outside `db/`.
- `scheduler/`, `poller/`, `render/`, `ingest/`, `services/` import `domain`, `db/repos`, `transport/types`, `clock` - never concrete transports.
- `api/` imports services/repos + `packages/shared` schemas. No business logic in route handlers beyond orchestration.
- Only `composition.ts` imports concrete implementations (`SystemClock`, `MockTransport` vs `SmtpImapTransport`, pg-boss).

## 2. Process model (decision Y)

One Node process, three logical roles, selected by `ROLE` env (default `all`):

| Role | Runs |
|------|------|
| `api` | Fastify HTTP server |
| `worker` | pg-boss: `scheduler-tick` (cron `*/5 * * * *`), `imap-poll:<mailboxId>` (every 5 min per active mailbox), `confirm-delivery` (delayed jobs), `self-check` (daily 03:00), `rebuild-compare` (weekly), `backup-reminder` check |
| `all` | Both (production default on the single VPS) |

pg-boss provides retry/backoff for every job: SMTP transient failures retry `retryLimit: 5, retryBackoff: true`; poll failures retry and, past `settings.stale_poll_hours`, flip mailbox status to `imap_stale` (spec Part 9).

## 3. Write path / read path

**Write path - the only way facts enter the system:**

```
action (API handler, scheduler, poller)
  → eventStore.append(events[], txWork?)   // ONE Postgres transaction:
      1. INSERT events (append-only table)
      2. reducer → UPDATE enrollments projection (state, step, next_send_at, flags)
      3. UPDATE side projections (sent_messages, suppressions, mailbox status/counters)
      4. any extra txWork (e.g. incoming_messages row linking to the event)
  → post-commit hooks: alert emitter, auto-pause evaluation
```

`eventStore.append` is the single chokepoint; nothing else writes `events` or `enrollments.current_state`. It takes the `Clock` for `occurred_at`.

**Read path:** API handlers read projections (`enrollments`, `sent_messages`, `mailboxes`, `incoming_messages`) for current state and run the metric queries (docs/05) for numbers. No API call ever replays events.

## 4. Composition root

`composition.ts` builds the object graph exactly once:

```ts
export function compose(cfg: Config) {
  const clock: Clock = cfg.NODE_ENV === 'test' ? /* injected by tests */ : new SystemClock();
  const transport: MailTransport =
    cfg.MAIL_TRANSPORT === 'smtp_imap' ? new SmtpImapTransport(secrets, logger)
                                       : new MockTransport(clock);
  const db = createDb(cfg.DATABASE_URL);
  const eventStore = new EventStore(db, clock);
  const scheduler = new Scheduler({ db, eventStore, transport, clock, render, settings });
  const poller = new Poller({ db, eventStore, transport, clock, settings, sentimentSuggester });
  const app = buildApi({ db, eventStore, scheduler, poller, transport, settings });
  return { app, scheduler, poller, boss: buildJobs(...) };
}
```

`MAIL_TRANSPORT=mock|smtp_imap` is the one flag that goes live at B8 (plan §9). Tests call `compose` with `VirtualClock` and a scripted `MockTransport` - the scenario runner (docs/13) is a thin wrapper around this.

## 5. Configuration layers

| Layer | Source | Examples | Changes require |
|-------|--------|----------|-----------------|
| **Env** (secrets + wiring) | `.env` / process env, parsed by zod at boot - boot fails loudly on invalid | `DATABASE_URL`, `SECRET_KEY` (sodium, 32B hex), `SESSION_KEY`, `MAIL_TRANSPORT`, `ROLE`, `ANTHROPIC_API_KEY?`, `ALERT_WEBHOOK_URL?`, `OPERATOR_INITIAL_PASSWORD` | restart |
| **Settings** (operator-tunable) | `settings` DB row, edited in UI | caps defaults, bounce auto-pause params, tick/poll intervals, `delivery_confirm_hours`, `stale_poll_hours`, `default_timezone`, `optout_detection`, deliverability toggles | none (read per tick) |
| **Compliance** | `compliance_settings` row | physical address, opt-out text | none |
| **Per-campaign** | `campaigns.tier_effort_config`, `ramp_config` | tier→mode mapping, ramp caps | none |

Full env table: [16-deployment-ops.md](16-deployment-ops.md) §1.

## 6. Error handling & logging

- **Logging:** pino, JSON lines, one child logger per module (`scheduler`, `poller`, `api`, `jobs`). Secrets are redacted by pino `redact` paths (`*.password`, `*.secret`, `req.headers.cookie`). Every send/poll/append logs at `info` with ids, never bodies.
- **API errors:** central Fastify error handler maps thrown `AppError(code, status, message, details)` to the envelope (decision Z). Unknown errors → 500 `internal`, logged with stack, never leaked.
- **Job errors:** thrown → pg-boss retry; on final failure → `alerts` row severity `error`.
- **Alert emitter:** `alerts.emit(kind, severity, payload)` inserts an `alerts` row and fire-and-forgets the webhook (decision V). Kinds: `mailbox_auto_paused`, `mailbox_auth_failed`, `imap_stale`, `provider_blocked`, `selfcheck_drift`, `catchup_backlog`, `suppression_removed`, `job_failed`.

## 7. Security posture (single-operator VPS)

- Session cookie auth on every `/api/v1/*` route except `/auth/login`, `/health` (decision I).
- Mailbox secrets sealed with libsodium `crypto_secretbox` using `SECRET_KEY`; stored in `mailbox_secrets`; decrypted only inside `transport/smtpImap` at connect time; never serialized into API responses or logs.
- `events` table: DB role `app_rw` has INSERT/SELECT only; UPDATE/DELETE revoked *and* trigger-blocked (docs/03 §4).
- HTTPS is terminated by Caddy on the VPS (docs/16); the app listens on localhost only.
