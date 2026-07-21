# Documentation Index — Cold Email Campaign Tool

**This folder is the complete low-level build documentation.** The three root-level documents ([build_plan.md](../build_plan.md), [event_model_spec.md](../event_model_spec.md), [campaign_walkthrough_v2.md](../campaign_walkthrough_v2.md)) define *what* the system is and the high-level build order. The files here go one level deeper: every table column, every algorithm, every endpoint, every screen, every task — detailed enough that development can start at task B0.1 and proceed without further design work.

Progress is tracked in [PROGRESS.md](../PROGRESS.md) at the repo root.

---

## Document map

| # | File | What it covers | Read before starting |
|---|------|----------------|----------------------|
| 00 | this file | Map + reading order + glossary | — |
| 01 | [01-decisions.md](01-decisions.md) | **Decision register** — every choice made (A–Z), rationale, swap cost | Everything |
| 02 | [02-architecture.md](02-architecture.md) | Monorepo layout, process model, module boundaries, composition root, config | B0 |
| 03 | [03-database-schema.md](03-database-schema.md) | Full SQL DDL: every table, column, index, trigger, seed | B1 |
| 04 | [04-domain-events-state.md](04-domain-events-state.md) | Event catalog (per-type attributes), the `applyEvent` reducer, invariants, rebuild | B1 |
| 05 | [05-metrics-and-analytics.md](05-metrics-and-analytics.md) | Exact SQL for every metric + analytics groupings + self-check | B2 |
| 06 | [06-scheduler-spec.md](06-scheduler-spec.md) | Tick algorithm, pacing, rotation, capacity, catch-up, time zones, auto-pause | B3 |
| 07 | [07-poller-spec.md](07-poller-spec.md) | IMAP poll loop, 4-bucket classifier, threading, STOP detection, idempotency, failure states | B3 |
| 08 | [08-render-engine-spec.md](08-render-engine-spec.md) | Merge-tag grammar, spintax grammar, footer, pre-send checks, deliverability score rubric | B4 |
| 09 | [09-ingest-spec.md](09-ingest-spec.md) | CSV contract, hygiene rules, tiering, suppression, recycling guard | B5 |
| 10 | [10-api-contract.md](10-api-contract.md) | **The frozen API contract** — every endpoint, shapes, errors, events emitted | B6, F0 |
| 11 | [11-frontend-architecture.md](11-frontend-architecture.md) | React app structure, state management, API client, MSW mocks, design system | F0 |
| 12 | [12-frontend-screens.md](12-frontend-screens.md) | Screen-by-screen spec: layout, components, data, interactions, edge states | F1–F8 |
| 13 | [13-testing-strategy.md](13-testing-strategy.md) | Fixture formats, scenario-runner DSL, golden cohort tests, coverage gates | B1+ |
| 14 | [14-build-stages-backend.md](14-build-stages-backend.md) | **Backend track**: stages B0–B8, task-level breakdown with IDs | day 1 |
| 15 | [15-build-stages-frontend.md](15-build-stages-frontend.md) | **Frontend track**: stages F0–F8, task-level breakdown with IDs | day 1 |
| 16 | [16-deployment-ops.md](16-deployment-ops.md) | Env vars, Docker Compose, backups, runbook, canary checklist | B7–B8 |

## Reading order

1. **Before writing any code:** 01 (decisions) → 02 (architecture) → 14 + 15 (the two stage plans) → skim 10 (API contract).
2. **Before each backend stage:** the subsystem doc(s) listed in its stage entry in 14.
3. **Before each frontend stage:** 11 once, then the relevant screens in 12.
4. **Continuously:** [PROGRESS.md](../PROGRESS.md) — tick tasks as they complete; log blockers.

## How the two tracks interlock

The build is contract-first. [10-api-contract.md](10-api-contract.md) is the seam between backend and frontend:

- The **backend track (B0–B8)** builds correctness-critical logic first (B0–B3), then workflow (B4–B5), then implements the contract (B6), then hardens (B7) and goes live (B8).
- The **frontend track (F0–F8)** starts from the contract alone: F0 stands up the app with MSW request mocks that serve golden-cohort fixture data shaped exactly per the contract. Every frontend stage is buildable against mocks and *integrates* (mocks off, real API on) once the matching B6 route group lands.
- **Milestones** (M1–M4) are defined in [PROGRESS.md](../PROGRESS.md). Solo-dev recommended order: B0→B3 uninterrupted (the proven core), then B4→B6, then F0→F8, then B7, B8.

## Glossary

| Term | Meaning |
|------|---------|
| **Event** | One immutable row in `events` — the only source of truth |
| **Projection** | Derived state (enrollment state, `sent_messages`, counters) rebuildable from events |
| **Enrollment** | One lead's participation in one campaign; the state machine lives here |
| **Contacted** | Lead with ≥1 `delivered` event (not merely `sent`) |
| **Terminal state** | `REPLIED / BOUNCED / UNSUBSCRIBED / COMPLETED` — mutually exclusive, sums to total |
| **Golden cohort** | The spec Part 10 worked 885-lead dataset, used as a locked regression test |
| **Scenario runner** | Test harness driving real scheduler+poller over `MockTransport` + `VirtualClock` |
| **Pace budget** | Per-mailbox minimum gap between sends (window ÷ cap, ±jitter) — the never-burst mechanism |
| **Mode 1 / Mode 2** | Human-written bespoke email / template-filled (researched or auto slot) |
