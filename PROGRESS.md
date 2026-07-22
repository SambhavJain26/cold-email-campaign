# PROGRESS - Cold Email Campaign Tool

**The single tracking file.** Tick tasks here as they complete; task definitions live in [docs/14-build-stages-backend.md](docs/14-build-stages-backend.md) and [docs/15-build-stages-frontend.md](docs/15-build-stages-frontend.md); all design docs indexed at [docs/00-INDEX.md](docs/00-INDEX.md).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (note why in the log)

**Current focus:** → **B0** (in progress - B0.1-B0.2 done; next B0.3)

---

## Milestones

| | Milestone | Definition | Requires | Status |
|--|-----------|-----------|----------|--------|
| M0 | Docs complete | All docs/ written; decisions locked | - | ✅ 2026-07-22 |
| M1 | **Proven core** | Golden cohort passes at all 3 levels offline | B0-B3 | ☐ |
| M2 | **Operable workflow** | Real API serving F0-F3 screens | B4-B6, F0-F3 | ☐ |
| M3 | **Full product (offline)** | Walkthrough-replay e2e green; ops hardened | F4-F8, B7 | ☐ |
| M4 | **Live** | Canary checklist done; real cohort reconciles | B8 | ☐ |

---

## Backend track

### B0 - Foundation
- [x] B0.1 monorepo scaffold · [x] B0.2 tooling · [x] B0.3 compose+env · [x] B0.4 drizzle+test-db · [x] B0.5 config loader · [x] B0.6 Clock · [x] B0.7 MailTransport iface+stub · [x] B0.8 logging · [x] B0.9 fastify skeleton · [x] B0.10 CI
- **Gate:** ☐ clone→up→migrate→test green in CI

### B1 - Event log + state machine
- [ ] B1.1 core migration · [ ] B1.2 seeds · [ ] B1.3 event constructors · [ ] B1.4 reducer · [ ] B1.5 eventStore.append · [ ] B1.6 rebuild-projections · [ ] B1.7 golden fixture · [ ] B1.8 transition-matrix tests · [ ] B1.9 golden L1 + rebuild equivalence · [ ] B1.10 append-only enforcement test
- **Gate:** ☐ B1.8-B1.10 green

### B2 - Metrics engine
- [ ] B2.1-9 metric functions · [ ] B2.10 sentiment CTE · [ ] B2.11-14 groupings · [ ] B2.15 outcomes+selfCheck · [ ] B2.16 golden L2 · [ ] B2.17 edge tests · [ ] B2.18 fixture export → web mocks
- **Gate:** ☐ golden L2 + edges green; fixtures exported (unblocks F0)

### B3 - Mock transport + scheduler + poller ← core complete
- [ ] B3.1 transport migration · [ ] B3.2 MockTransport · [ ] B3.3 synthetic inbound · [ ] B3.4 scenario runner · [ ] B3.5 tz/windows · [ ] B3.6 pacing+rotation · [ ] B3.7 tick · [ ] B3.8 sendOne+confirm-delivery · [ ] B3.9 capacity+enroll · [ ] B3.10 poll cycle+ledger · [ ] B3.11 classifier · [ ] B3.12 STOP detection · [ ] B3.13 auto-pause · [ ] B3.14 health machine+redistribution · [ ] B3.15 alerts · [ ] B3.16 pg-boss wiring · [ ] B3.17 **golden L3 (flagship)** · [ ] B3.18 edge suite · [ ] B3.19 transport-swap test
- **Gate:** ☐ B3.17-19 green → **M1**

### B4 - Render engine
- [ ] B4.1 migration · [ ] B4.2 parser · [ ] B4.3 merge tags · [ ] B4.4 spintax · [ ] B4.5 mode slots · [ ] B4.6 footer+guard · [ ] B4.7 checks+score · [ ] B4.8 variant selection · [ ] B4.9 MIME/threading · [ ] B4.10 manual compose · [ ] B4.11 test suite · [ ] B4.12 threading e2e
- **Gate:** ☐ B4.11-12 + golden L3 still green

### B5 - Ingest
- [ ] B5.1 migration · [ ] B5.2 CSV parse · [ ] B5.3 hygiene+preview · [ ] B5.4 commit · [ ] B5.5 suppression-at-ingest · [ ] B5.6 bulk-tier · [ ] B5.7 recycle+hash guard · [ ] B5.8 1000→885 fixture test · [ ] B5.9 edge suite
- **Gate:** ☐ B5.8-9 green

### B6 - API layer
- [ ] B6.1 auth · [ ] B6.2 mailboxes · [ ] B6.3 leads · [ ] B6.4 imports · [ ] B6.5 sequences · [ ] B6.6 campaigns/capacity/recycle · [ ] B6.7 unibox · [ ] B6.8 manual-sends · [ ] B6.9 analytics · [ ] B6.10 settings/compliance · [ ] B6.11 alerts · [ ] B6.12 system · [ ] B6.13 shared schemas = contract · [ ] B6.14 API test suite
- **Gate:** ☐ B6.14 green → **M2** (with F0-F3)

### B7 - Hardening & ops *(parallel with F4+)*
- [ ] B7.1 secrets+log-redaction proof · [ ] B7.2 backups+restore drill · [ ] B7.3 self-check+rebuild-compare jobs · [ ] B7.4 alert webhook · [ ] B7.5 prod compose+runbook · [ ] B7.6 rotation/health/boot order · [ ] B7.7 clean-VPS dry-run
- **Gate:** ☐ drill+drift+dry-run pass → **M3** (with F8)

### B8 - Live transport
- [ ] B8.1 SmtpImapTransport · [ ] B8.2 flag-swap test · [ ] B8.3 canary mailbox · [ ] B8.4 real DSN/OOO pattern validation · [ ] B8.5 ramp caps + all mailboxes · [ ] B8.6 real cohort reconciliation
- **Gate:** ☐ canary checklist (docs/16 §5) → **M4 LIVE**

---

## Frontend track

### F0 - Foundation *(needs B2.18)*
- [ ] F0.1 scaffold · [ ] F0.2 api client · [ ] F0.3 query layer · [ ] F0.4 MSW+fixtures · [ ] F0.5 router+guard · [ ] F0.6 shared components · [ ] F0.7 playwright wiring
- **Gate:** ☐ boots in mock mode; shared-component tests green

### F1 - Shell & auth *(integrates after B6.1)*
- [ ] F1.1 login · [ ] F1.2 shell/nav/campaign-selector · [ ] F1.3 alerts bell · [ ] F1.4 conventions · [ ] F1.5 e2e

### F2 - Mailboxes & Settings *(B6.2, B6.10)*
- [ ] F2.1 table · [ ] F2.2 add/test-connection · [ ] F2.3 failure panels · [ ] F2.4 volume chart · [ ] F2.5 rules tab · [ ] F2.6 compliance editor · [ ] F2.7 account · [ ] F2.8 e2e

### F3 - Leads & Import *(B6.3, B6.4)*
- [ ] F3.1 leads table · [ ] F3.2 bulk-tier · [ ] F3.3 detail+timeline · [ ] F3.4 suppression UI · [ ] F3.5 import wizard · [ ] F3.6 e2e

### F4 - Sequences *(B6.5)*
- [ ] F4.1 list · [ ] F4.2 builder · [ ] F4.3 variants+validation · [ ] F4.4 preview+checks · [ ] F4.5 e2e

### F5 - Campaigns & Overview *(B6.6)*
- [ ] F5.1 list/create · [ ] F5.2 capacity+enroll · [ ] F5.3 completion panel · [ ] F5.4 overview · [ ] F5.5 catch-up banner · [ ] F5.6 e2e

### F6 - Unibox *(B6.7, B6.8)*
- [ ] F6.1 feed+tabs · [ ] F6.2 reply card actions · [ ] F6.3 thread view · [ ] F6.4 manual composer · [ ] F6.5 tag_only variant · [ ] F6.6 e2e

### F7 - Analytics & Cold Storage *(B6.9)*
- [ ] F7.1 variants · [ ] F7.2 steps · [ ] F7.3 tiers+promote · [ ] F7.4 health · [ ] F7.5 cold storage+recycle · [ ] F7.6 e2e

### F8 - System & full replay *(B6.12, closes M3)*
- [ ] F8.1 reply-detection debug · [ ] F8.2 job status · [ ] F8.3 a11y pass · [ ] F8.4 state sweep · [ ] F8.5 **walkthrough-replay e2e**

---

## Decisions needed from the operator (none currently)

*(When a task hits a genuine product decision, log it here with options + recommendation instead of guessing.)*

## Log

| Date | Entry |
|------|-------|
| 2026-07-22 | B0.5-B0.7: zod env loader (fail-loud); Clock seam (VirtualClock stepTo tick-stepping; 49-day fast-forward gate test); MailTransport interface + throwing stub; composition root with MAIL_TRANSPORT flag + test-override seam. 18 tests green. |
| 2026-07-22 | B0.3-B0.4: Postgres 16 via compose (port 5433, initdb creates test DB). Custom up/down SQL migration runner + CLI (drizzle-kit can't do downs - docs/03 §6 updated); drizzle-orm client stub; vitest split into unit/integration projects with test-DB globalSetup; apply→down→apply drill green on dev + test DBs. |
| 2026-07-22 | B0.2: ESLint 10 flat config with module-boundary rules (partitioned blocks - flat config is last-match-wins per rule; both partitions verified firing with temp violation files), Prettier, Vitest 4 + smoke test. format/lint/typecheck/test all green. |
| 2026-07-22 | B0.1: npm-workspaces monorepo scaffolded (`apps/server`, `apps/web` placeholder, `packages/shared`); base tsconfig (strict, ESM, bundler resolution); dir tree per docs/02 §1; typecheck + tsx smoke-run green. Node updated: machine runs 24 (current LTS), decision B now `>=22`. |
| 2026-07-22 | M0: full low-level documentation set written (docs/00-16 + this tracker). Decisions A-F confirmed (F kept automatic with escape hatch); new decisions G-Z locked - see [docs/01-decisions.md](docs/01-decisions.md). Notable resolutions: `sentiment_tagged` event added to preserve append-only (M); `delivered` via confirm-delivery job (N); `incoming_messages` ledger (O); content-hash recycle guard (Q); untiered-on-import (R). Next: B0.1. |
