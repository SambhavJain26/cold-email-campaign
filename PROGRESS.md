# PROGRESS — Cold Email Campaign Tool

**The single tracking file.** Tick tasks here as they complete; task definitions live in [docs/14-build-stages-backend.md](docs/14-build-stages-backend.md) and [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md); all design docs indexed at [docs/00-INDEX.md](docs/00-INDEX.md).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (note why in the log)

**Current focus:** → **B4** (render engine; B0–B3 complete, **M1 proven core** ✅)

---

## Milestones

| | Milestone | Definition | Requires | Status |
|--|-----------|-----------|----------|--------|
| M0 | Docs complete | All docs/ written; decisions locked | — | ✅ 2026-07-22 |
| M1 | **Proven core** | Golden cohort passes at all 3 levels offline | B0–B3 | ✅ 2026-07-22 |
| M2 | **Operable workflow** | Real API serving F0–F3 screens | B4–B6, F0–F3 | ☐ |
| M3 | **Full product (offline)** | Walkthrough-replay e2e green; ops hardened | F4–F8, B7 | ☐ |
| M4 | **Live** | Canary checklist done; real cohort reconciles | B8 | ☐ |

---

## Backend track

### B0 — Foundation
- [x] B0.1 monorepo scaffold · [x] B0.2 tooling · [x] B0.3 compose+env · [x] B0.4 drizzle+test-db · [x] B0.5 config loader · [x] B0.6 Clock · [x] B0.7 MailTransport iface+stub · [x] B0.8 logging · [x] B0.9 fastify skeleton · [x] B0.10 CI
- **Gate:** ✅ 2026-07-22 — CI green (typecheck, lint, format, migration drill, 25 tests on Postgres service); VirtualClock gate test passes; live boot smoke verified

### B1 — Event log + state machine
- [x] B1.1 core migration · [x] B1.2 seeds · [x] B1.3 event constructors · [x] B1.4 reducer · [x] B1.5 eventStore.append · [x] B1.6 rebuild-projections · [x] B1.7 golden fixture · [x] B1.8 transition-matrix tests · [x] B1.9 golden L1 + rebuild equivalence · [x] B1.10 append-only enforcement test
- **Gate:** ✅ 2026-07-22 — B1.8/B1.9/B1.10 green; golden L1 at both levels (pure fold + live eventStore append + rebuild zero-drift); @golden is a separate required CI job

### B2 — Metrics engine
- [x] B2.1–9 metric functions · [x] B2.10 sentiment CTE · [x] B2.11–14 groupings · [x] B2.15 outcomes+selfCheck · [x] B2.16 golden L2 · [x] B2.17 edge tests · [x] B2.18 fixture export → web mocks
- **Gate:** ✅ 2026-07-22 — golden L2 green (every Part-10/§13 number through SQL); edge suite green; contract-shaped fixtures exported to apps/web/src/mocks/fixtures/golden/ (F0 unblocked)

### B3 — Mock transport + scheduler + poller ← core complete
- [x] B3.1 transport migration · [x] B3.2 MockTransport · [x] B3.3 synthetic inbound · [x] B3.4 scenario runner · [x] B3.5 tz/windows · [x] B3.6 pacing+rotation · [x] B3.7 tick · [x] B3.8 sendOne+confirm-delivery · [x] B3.9 capacity+enroll · [x] B3.10 poll cycle+ledger · [x] B3.11 classifier · [x] B3.12 STOP detection · [x] B3.13 auto-pause · [x] B3.14 health machine+redistribution · [x] B3.15 alerts · [x] B3.16 pg-boss wiring · [x] B3.17 **golden L3 (flagship)** · [x] B3.18 edge suite · [x] B3.19 transport-swap test
- **Gate:** ✅ 2026-07-22 — B3.17–19 green → **M1** (golden suite 47 tests: L1 + L2 + L3 full-pipeline replay)

### B4 — Render engine
- [x] B4.1 migration · [ ] B4.2 parser · [ ] B4.3 merge tags · [ ] B4.4 spintax · [ ] B4.5 mode slots · [ ] B4.6 footer+guard · [ ] B4.7 checks+score · [ ] B4.8 variant selection · [ ] B4.9 MIME/threading · [ ] B4.10 manual compose · [ ] B4.11 test suite · [ ] B4.12 threading e2e
- **Gate:** ☐ B4.11–12 + golden L3 still green

### B5 — Ingest
- [ ] B5.1 migration · [ ] B5.2 CSV parse · [ ] B5.3 hygiene+preview · [ ] B5.4 commit · [ ] B5.5 suppression-at-ingest · [ ] B5.6 bulk-tier · [ ] B5.7 recycle+hash guard · [ ] B5.8 1000→885 fixture test · [ ] B5.9 edge suite
- **Gate:** ☐ B5.8–9 green

### B6 — API layer
- [ ] B6.1 auth · [ ] B6.2 mailboxes · [ ] B6.3 leads · [ ] B6.4 imports · [ ] B6.5 sequences · [ ] B6.6 campaigns/capacity/recycle · [ ] B6.7 unibox · [ ] B6.8 manual-sends · [ ] B6.9 analytics · [ ] B6.10 settings/compliance · [ ] B6.11 alerts · [ ] B6.12 system · [ ] B6.13 shared schemas = contract · [ ] B6.14 API test suite
- **Gate:** ☐ B6.14 green → **M2** (with F0–F3)

### B7 — Hardening & ops *(parallel with F4+)*
- [ ] B7.1 secrets+log-redaction proof · [ ] B7.2 backups+restore drill · [ ] B7.3 self-check+rebuild-compare jobs · [ ] B7.4 alert webhook · [ ] B7.5 prod compose+runbook · [ ] B7.6 rotation/health/boot order · [ ] B7.7 clean-VPS dry-run
- **Gate:** ☐ drill+drift+dry-run pass → **M3** (with F8)

### B8 — Live transport
- [ ] B8.1 SmtpImapTransport · [ ] B8.2 flag-swap test · [ ] B8.3 canary mailbox · [ ] B8.4 real DSN/OOO pattern validation · [ ] B8.5 ramp caps + all mailboxes · [ ] B8.6 real cohort reconciliation
- **Gate:** ☐ canary checklist (docs/16 §5) → **M4 LIVE**

---

## Frontend track

### F0 — Foundation *(needs B2.18)*
- [ ] F0.1 scaffold · [ ] F0.2 api client · [ ] F0.3 query layer · [ ] F0.4 MSW+fixtures · [ ] F0.5 router+guard · [ ] F0.6 shared components · [ ] F0.7 playwright wiring
- **Gate:** ☐ boots in mock mode; shared-component tests green

### F1 — Shell & auth *(integrates after B6.1)*
- [ ] F1.1 login · [ ] F1.2 shell/nav/campaign-selector · [ ] F1.3 alerts bell · [ ] F1.4 conventions · [ ] F1.5 e2e

### F2 — Mailboxes & Settings *(B6.2, B6.10)*
- [ ] F2.1 table · [ ] F2.2 add/test-connection · [ ] F2.3 failure panels · [ ] F2.4 volume chart · [ ] F2.5 rules tab · [ ] F2.6 compliance editor · [ ] F2.7 account · [ ] F2.8 e2e

### F3 — Leads & Import *(B6.3, B6.4)*
- [ ] F3.1 leads table · [ ] F3.2 bulk-tier · [ ] F3.3 detail+timeline · [ ] F3.4 suppression UI · [ ] F3.5 import wizard · [ ] F3.6 e2e

### F4 — Sequences *(B6.5)*
- [ ] F4.1 list · [ ] F4.2 builder · [ ] F4.3 variants+validation · [ ] F4.4 preview+checks · [ ] F4.5 e2e

### F5 — Campaigns & Overview *(B6.6)*
- [ ] F5.1 list/create · [ ] F5.2 capacity+enroll · [ ] F5.3 completion panel · [ ] F5.4 overview · [ ] F5.5 catch-up banner · [ ] F5.6 e2e

### F6 — Unibox *(B6.7, B6.8)*
- [ ] F6.1 feed+tabs · [ ] F6.2 reply card actions · [ ] F6.3 thread view · [ ] F6.4 manual composer · [ ] F6.5 tag_only variant · [ ] F6.6 e2e

### F7 — Analytics & Cold Storage *(B6.9)*
- [ ] F7.1 variants · [ ] F7.2 steps · [ ] F7.3 tiers+promote · [ ] F7.4 health · [ ] F7.5 cold storage+recycle · [ ] F7.6 e2e

### F8 — System & full replay *(B6.12, closes M3)*
- [ ] F8.1 reply-detection debug · [ ] F8.2 job status · [ ] F8.3 a11y pass · [ ] F8.4 state sweep · [ ] F8.5 **walkthrough-replay e2e**

---

## Decisions needed from the operator (none currently)

*(When a task hits a genuine product decision, log it here with options + recommendation instead of guessing.)*

## Log

| Date | Entry |
|------|-------|
| 2026-07-22 | B4 checkpoint 1 (B4.1): 0003_sequences migration lands by filename-order backfill (after 0004/0006 — the runner doesn't care) — sequences/sequence_steps/step_variants per docs/03 §3 + campaigns.sequence_id FK deferred from 0001; `attributes jsonb DEFAULT '{}'` added to step_variants (docs/03 reconciled with docs/08 §3's bespoke flag). Drizzle mirror, sequencesRepo (loadSequenceDef = steps by step_no + ACTIVE variants by label; createSequence; insertBespokeVariant = active=false + {bespoke:true}), render/hash.ts contentHashOf (decision Q — first real sha256 in the codebase), DbSequenceProvider wired in composition (ComposeOverrides gains `sequences` seam; AppServices.sequences now the interface type). Tests/scenario keep StaticSequenceProvider. 236 unit+integration, 47 golden. Next: B4.2. |
| 2026-07-22 | **B3 COMPLETE — M1 PROVEN CORE.** B3.17 golden L3 flagship: the Part-10 cohort scripted as live scenario (golden/scenario.ts reuses constants' id layout) and driven through the REAL scheduler+poller+eventStore over MockTransport+VirtualClock for 47 virtual days (30 enroll-days × 30/day + 17-day tail; tick 9 min = exact 18-min pace slots at jitter 0; ~3.3k sends). Reproduces terminals 40/18/47/780, every L2 headline (8.3/3.2/4.6/2.0/1.0/17/2.0-per-100, 13b delivered 867/831/801/789 + repliers 30/25/10/7 + positives 15/9/1/3, 13c per-tier), PLUS pipeline invariants L1/L2 can't see: zero out-of-window sends, zero mailbox-day cap violations, pace floor ≥ minGap×0.8, threading integrity, never-rerouted follow-ups, classifier saw exactly 27 bounces + 72 replies + 0 unrelated, rebuild zero-drift after the live run. completeEligible gained an exact SQL prefilter (ACTIVE past last step) to keep per-tick sweeps cheap. B3.18 edges (never-burst 14h-downtime catch-up w/ single alert, ET-local-midnight cap accounting across UTC midnight, rotation balance ±1) + B3.19 transport-swap (TrivialTransport via composition override — downstream identical; compose gains jobPort override). 224 unit+integration, 47 golden. Next: B4.1. |
| 2026-07-22 | B3 checkpoint 4 (B3.13–B3.16, built 15→13→14→16): 0006_ops migration (alerts + alert_severity) + DbAlertSink (webhook seam for B7.4); auto-pause engine — docs/05 §5 window queries on events alone (last-N sends correlated to bounces by enrollment+step), Part-11 example locked verbatim (55 sends: 3-in-10 absolute fires, 4-in-50 = 8%), pct rule volume-gated, alert carries both windows; resumeMailbox (50% cap) + 7-clean-days auto-clear proven; health machine rounded out — TransportAuthError on fetchNew → auth_failed + redistribution (transient fetch errors rethrow to job retry), imap_stale flip→auto-recover cycle tested, redistribution keeps mid-thread assignments; pg-boss 12 wired (tick cron, per-mailbox poll queues, delayed confirm-delivery as the JobPort impl) + boot/schedule/execute smoke on the real thing; composition root now builds the full worker graph (real MockTransport at MAIL_TRANSPORT=mock) and main.ts starts jobs for ROLE≠api. 248 tests; golden green. Next: B3.17 golden L3. |
| 2026-07-22 | B3 checkpoint 3 (B3.10–B3.12): poller complete. Poll cycle with (mailbox,UID) + Message-ID idempotency (duplicate rows carry message_id NULL — im_msgid belongs to the original); ledger id PRE-allocated via identity nextval so human_reply.attributes.incoming_message_id and the row land in ONE tx (OVERRIDING SYSTEM VALUE insert); 4-bucket classifier (DSN→hard/soft w/ +4h same-step retry; auto-reply threaded but non-stopping; human via In-Reply-To→References walk; poison→unrelated+parse_error, never wedges); STOP matcher (unquote, 300-char window, bare-"stop" needs ≤40 words AND ≤4-word standalone clause — docs/07 §7 amended: its ≤40-words-only rule false-positived on its own example) + tag_only skip. Fixture corpus exercised bucket×provider; flows: reply-stops-sequence, auto-unsub+suppression, soft→retry→recover→delivered, soft×3→BOUNCED, late-reply-upgrades-COMPLETED, reply-after-UNSUB logged-not-changed. Lesson: settings row survives resetCoreTables — scenario init now restores mutated tunables. 224 tests; golden green. Next: B3.13 (checkpoint 4 order: B3.15 alerts infra first). |
| 2026-07-22 | B3 checkpoint 2 (B3.5–B3.9): scheduler complete against MockTransport. tzmap (51 states, majority-zone splits) + Intl-based insideWindow/startOfLocalDay (no reset cron); pacing minGap±jitter + rotation (ratio → last_send_at → seeded rng); Scheduler.tick (session advisory lock (2,0), housekeeping incl. imap-stale flip + resume_cap 7-day clear + per-campaign completeEligible, budgets from sent-event counts, oldest-first due loop, catchup_backlog deduped per episode); sendOne (4a/4b/4c: tx append+sent_messages+patches, 5×transient→paused/smtp_failing, RCPT-5xx→hard_bounce, auth→auth_failed+redistribution); confirm-delivery keyed to sentAt so soft-retry attempts don't veto; capacity+enroll service (ramp caps, tier ordering, recycle hash guard in SQL — drizzle lesson: bare array in sql`` expands to a tuple, use sql.param). EventStore.append gains {patches, txWork} (terminal fold beats stale nextSendAt). Seams: SequenceProvider (static), Renderer (stub), JobPort (inline queue), AlertSink (capturing). 161 tests; golden L1/L2 green. Next: B3.10. |
| 2026-07-22 | B3 checkpoint 1 (B3.1–B3.4): 0004_transport_tables migration (mailboxes, secrets, sent_messages, incoming_messages + the FKs deferred from 0001 — golden/edge seeds now insert mailboxes first); Drizzle mirrors + mailboxes/sentMessages/incomingMessages repos; MockTransport (FIFO scripted outcomes per recipient, per-mailbox UID queues, scriptable verify) — SendResult gains `errorScope: recipient\|mailbox` for the 4c split; synthetic inbound builders + 9-file `headers/` fixture corpus + test-side eml parser; scenario runner harness (seeded PRNG seam in `util/rng`, pure `domain/sequence` SequenceDef, inline job queue, tick/poll hook seams for B3.7/B3.10). 124 unit+integration tests, golden L1/L2 green. Next: B3.5. |
| 2026-07-22 | **B2 COMPLETE.** MetricsEngine + metricsRepo (campaign+asOf scoping, sentiment CTE, groupings, selfCheck); watch rules pure; golden L2 exact (8.3/3.2/4.6/2.0/1.0/17/2.0-per-100 + 13b/13c tables); denominator reconciliation: campaign bounce rates ÷ leads sent-to (Part 10's 18/885); B2.18 fixtures exported for MSW. 125 tests. Next: B3.1. |
| 2026-07-22 | **B1 COMPLETE.** Checkpoint 2 (B1.5–B1.7, B1.9): eventStore.append chokepoint (fold-full-history projections, advisory locks, atomic suppression side effects); rebuild-projections + CLI (drift detect/repair proven); golden fixture — 7,691 events, 885 leads, deterministic generator with self-asserting composition (fold reproduced Part 10's 40/18/47/780 on first run); golden L1 green at pure-fold AND live-DB levels; @golden CI job added. Fixture reconciliations documented in test/fixtures/golden/constants.ts (tier totals, delivered-per-step derived honestly; walkthrough 13b/13c screen numbers were illustrative). 97 tests. |
| 2026-07-22 | B1 checkpoint 1 (B1.1–B1.4, B1.8, B1.10): 0001_core + 0002_seed migrations (append-only trigger + app_rw grants proven by tests; suppressions moved up from 0005; operator seed → B6 boot); Drizzle mirrors; shared domain vocabulary; zod event constructors; pure reducer + derived completion. Doc fix: docs/04 matrix — REPLIED + bounce upgrades to BOUNCED per spec precedence (footnote had it backwards). 73 tests. |
| 2026-07-22 | **B0 COMPLETE.** B0.8–B0.10: pino logging with proven redaction; Fastify skeleton (/health with db ping, error-envelope contract, graceful boot/shutdown — live smoke passed); GitHub Actions CI green (one formatting fix after format:check landed). 25 tests. Next: B1.1 (0001_core migration). |
| 2026-07-22 | B0.5–B0.7: zod env loader (fail-loud); Clock seam (VirtualClock stepTo tick-stepping; 49-day fast-forward gate test); MailTransport interface + throwing stub; composition root with MAIL_TRANSPORT flag + test-override seam. 18 tests green. |
| 2026-07-22 | B0.3–B0.4: Postgres 16 via compose (port 5433, initdb creates test DB). Custom up/down SQL migration runner + CLI (drizzle-kit can't do downs — docs/03 §6 updated); drizzle-orm client stub; vitest split into unit/integration projects with test-DB globalSetup; apply→down→apply drill green on dev + test DBs. |
| 2026-07-22 | B0.2: ESLint 10 flat config with module-boundary rules (partitioned blocks — flat config is last-match-wins per rule; both partitions verified firing with temp violation files), Prettier, Vitest 4 + smoke test. format/lint/typecheck/test all green. |
| 2026-07-22 | B0.1: npm-workspaces monorepo scaffolded (`apps/server`, `apps/web` placeholder, `packages/shared`); base tsconfig (strict, ESM, bundler resolution); dir tree per docs/02 §1; typecheck + tsx smoke-run green. Node updated: machine runs 24 (current LTS), decision B now `>=22`. |
| 2026-07-22 | M0: full low-level documentation set written (docs/00–16 + this tracker). Decisions A–F confirmed (F kept automatic with escape hatch); new decisions G–Z locked — see [docs/01-decisions.md](docs/01-decisions.md). Notable resolutions: `sentiment_tagged` event added to preserve append-only (M); `delivered` via confirm-delivery job (N); `incoming_messages` ledger (O); content-hash recycle guard (Q); untiered-on-import (R). Next: B0.1. |
