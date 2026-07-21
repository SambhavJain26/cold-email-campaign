# Backend Build Stages — B0–B8 (task level)

The backend track. Task IDs here are mirrored in [PROGRESS.md](../PROGRESS.md) (tick there, not here). Each stage ends with its **gate** — all listed tests green — before the next begins. Read-before docs listed per stage. Frontend track: [15-build-stages-frontend.md](15-build-stages-frontend.md).

---

## B0 — Foundation & scaffolding *(docs: 02)*

| ID | Task |
|----|------|
| B0.1 | Init npm-workspaces monorepo (`apps/server`, `apps/web` placeholder, `packages/shared`); root tsconfig base; `git init` |
| B0.2 | Tooling: ESLint (+ import-boundary rules per 02 §1), Prettier, Vitest config |
| B0.3 | `docker-compose.yml` (Postgres 16 dev service) + `.env.example` |
| B0.4 | Drizzle + drizzle-kit wiring; empty migration; `db:migrate`/`db:rollback` scripts; test-DB helper (`withTestDb`) |
| B0.5 | Config loader: zod-parsed env (02 §5), fail-loud boot |
| B0.6 | `Clock` interface + `SystemClock` + `VirtualClock` (advance, set; tick-stepping helper) |
| B0.7 | `MailTransport` interface (types only) + throwing stub; composition root skeleton with `MAIL_TRANSPORT` flag |
| B0.8 | pino logging setup with redaction paths |
| B0.9 | Fastify skeleton: `/health`, error-handler plugin (envelope), request logging |
| B0.10 | CI: typecheck + lint + test + migration up/down drill |

**Gate:** clone → `docker compose up -d` → migrate → `npm test` green; VirtualClock unit test passes; CI green.

## B1 — Event log + state machine *(docs: 03 §1–2/4, 04)*

| ID | Task |
|----|------|
| B1.1 | Migration `0001_core`: enums, `events` (+trigger, `app_rw` grants), `leads`, `campaigns`, `enrollments`, indexes |
| B1.2 | Migration `0002_seed`: settings, compliance_settings, operator |
| B1.3 | `domain/events.ts`: constructors + per-type attribute validation |
| B1.4 | `domain/reducer.ts`: `applyEvent` + precedence + soft-retry counting + `bumpSentiment` |
| B1.5 | `eventStore.append`: transactional append + projection update + suppression side effects (04 §3) |
| B1.6 | `rebuild-projections` CLI incl. completion derivation + `--dry-run` diff |
| B1.7 | Golden fixture generator + `events.jsonl` (13 §2) reviewed in |
| B1.8 | Unit: full transition matrix (04 §2.2 — every cell) |
| B1.9 | Golden L1 test: terminals 40/18/47/780 ✓; rebuild equivalence ✓ |
| B1.10 | DB test: UPDATE/DELETE on events physically rejected |

**Gate:** B1.8–B1.10 green.

## B2 — Metrics & analytics engine *(docs: 05)*

| ID | Task |
|----|------|
| B2.1–.9 | One function+query per metric: contacted, replyRate, positiveReplyRate, meetings(+per100), hardBounceRate, softBounceRate, unsubRate, progress, stepReplyRate |
| B2.10 | `reply_sentiment` CTE helper (decision M resolution) |
| B2.11–.14 | Groupings: variants (13a), steps (13b), tiers (13c), health-trend + watch rules (13d) + mailbox volume |
| B2.15 | Terminal-outcome breakdown + `selfCheck` violations |
| B2.16 | Golden L2 test: every Part-10/§13 number + Day-34 partial |
| B2.17 | Denominator/overlap/sentiment-resolution edge tests (05 §7) |
| B2.18 | API-fixture exporter → `apps/web/src/mocks/fixtures/golden/` (unblocks F0) |

**Gate:** B2.16–.17 green; fixtures exported.

## B3 — Mock transport, scheduler, poller *(docs: 06, 07, 03 §3)* — **core complete here**

| ID | Task |
|----|------|
| B3.1 | Migration `0004_transport_tables`: mailboxes, mailbox_secrets, sent_messages, incoming_messages |
| B3.2 | `MockTransport`: deterministic Message-IDs, send log, scripted outcomes, `verify` |
| B3.3 | Mock synthetic inbound generator (threaded replies, DSN MIME, OOO) using `headers/` fixture shapes |
| B3.4 | Scenario runner DSL (13 §4) |
| B3.5 | Timezone resolution (`tzmap.ts`, decision X) + `insideWindow` |
| B3.6 | Pacing (`minGap` + seeded jitter) + rotation `pickMailbox` |
| B3.7 | Scheduler tick (06 §1): advisory lock, budgets, due-selection, completion derivation |
| B3.8 | `sendOne` transaction + error paths (4a/4b/4c) + `confirm-delivery` job (decision N) |
| B3.9 | Capacity calculator + enroll selection/ordering (06 §7) as service functions |
| B3.10 | Poller cycle + `incoming_messages` ledger + idempotency (07 §1) |
| B3.11 | Classifier: bounce (DSN parse) → auto-reply → human (threading walk) → unrelated |
| B3.12 | STOP detection (07 §3) + `tag_only` switch |
| B3.13 | Auto-pause engine (event-driven, 06 §6) + resume logic + `resume_cap` auto-clear |
| B3.14 | Mailbox health machine: auth_failed / imap_stale / provider_blocked + redistribution rule |
| B3.15 | Alert emitter + alerts table wiring (`0006_ops` migration) |
| B3.16 | pg-boss wiring: tick cron, per-mailbox polls, confirm-delivery, retry policies (thin smoke test) |
| B3.17 | Golden L3 full-pipeline test (flagship) |
| B3.18 | Edge suite: never-burst catch-up, midnight reset, window/tz, soft≤2, Part-11 pause example, redistribution, imap-stale, poison message |
| B3.19 | Transport-swap test (second trivial transport; downstream unchanged) |

**Gate:** B3.17–.19 green. *Milestone M1.*

## B4 — Render engine *(docs: 08, 03 §3 sequences)*

B4.1 migration `0003_sequences` · B4.2 template parser/tokenizer · B4.3 merge-tag expansion + fallbacks · B4.4 spintax + seeding + variation count · B4.5 slot resolution per personalization mode (incl. `auto_observations` segment rule) · B4.6 footer appender + empty-address global guard · B4.7 pre-send checks + score rubric · B4.8 variant selection (round-robin) wired into scheduler · B4.9 MIME/threading header builder · B4.10 manual-compose service (Mode 1) · B4.11 snapshot+determinism+checks test suite (08 §7) · B4.12 threading e2e through mock (reply to step 2 matches).

**Gate:** B4.11–.12 green; golden L3 still green (now rendering real templates).

## B5 — Ingest *(docs: 09)*

B5.1 migration `0005_ingest` · B5.2 CSV streaming parse + alias headers · B5.3 hygiene pipeline + preview persistence · B5.4 commit modes · B5.5 suppression-at-ingest + re-import test · B5.6 bulk-tier (ids + filter) · B5.7 recycle eligibility + content-hash guard · B5.8 fixture CSV + exact-split test · B5.9 full edge suite (09 §7).

**Gate:** B5.8–.9 green.

## B6 — API layer *(docs: 10; shared schemas in lockstep)*

B6.1 auth (argon2id, secure-session, rate limit, CSRF header) · B6.2 mailboxes routes + test-connection + reconnect/pause/resume + volume · B6.3 leads + suppression removal · B6.4 imports · B6.5 sequences + preview + validate-template · B6.6 campaigns + capacity + enroll + outcomes + recycle + cold-storage · B6.7 unibox + sentiment + meeting + snooze + manual unsubscribe · B6.8 manual-sends · B6.9 analytics endpoints · B6.10 settings + compliance · B6.11 alerts + ack · B6.12 system (status, rebuild, incoming-messages, test-only advance-clock) · B6.13 `packages/shared` schemas complete = contract (10) verbatim · B6.14 API test suite over seeded golden DB (every endpoint; every mutation's emitted events asserted).

**Gate:** B6.14 green; web `VITE_API_MODE=real` works for all F stages built so far. *Milestone M2 (with F0–F3).*

## B7 — Hardening & ops *(docs: 16)* — can run parallel to F4+

B7.1 secrets sealing (libsodium) end-to-end + no-secret-in-logs test · B7.2 backup script (nightly pg_dump, retention) + restore runbook + drill · B7.3 self-check job (daily) + rebuild-compare job (weekly) + drift alert test · B7.4 alert webhook (decision V) · B7.5 prod compose profile (app+Postgres+Caddy) + systemd alternative + runbook doc · B7.6 log rotation, healthcheck wiring, boot-migration ordering · B7.7 clean-VPS deploy dry-run.

**Gate:** restore drill + drift-alert test + dry-run deploy all pass. *Milestone M3 (with F8).*

## B8 — Live transport *(docs: 16 §5 canary)*

B8.1 `SmtpImapTransport`: nodemailer send (message-id ours), imapflow fetchNew (UID high-water), mailparser DSN/headers, verify round-trip · B8.2 config-flag swap test (offline suite still green) · B8.3 canary: 1 real mailbox → seed addresses; verify round-trip/threading/reply/bounce/OOO/STOP live · B8.4 DSN/OOO pattern adjustments from real Gmail/Outlook messages (fixtures updated → offline suite re-run) · B8.5 conservative caps/windows; enable remaining mailboxes · B8.6 small real cohort; reconcile against model; `List-Unsubscribe` header decision revisit.

**Gate:** canary checklist complete; real-cohort numbers reconcile. *Milestone M4 — live.*
