# Testing Strategy — Fixtures, Scenario Runner, Golden Cohort, Gates

Implements plan §5. Test code layout: `apps/server/test/{unit,integration,fixtures,helpers}`, `apps/web/e2e`.

---

## 1. Layers & where they run

| Layer | Tooling | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | domain reducer, metrics SQL (against test DB), render, classifier, hygiene, tz, pacing math | every commit |
| Integration | Vitest + scenario runner | real scheduler+poller+eventStore over MockTransport+VirtualClock+test Postgres | every commit |
| API | Vitest + `fastify.inject` | every endpoint over seeded golden DB | every commit |
| E2E | Playwright | web ⇄ real backend (MockTransport) | pre-merge for F stages; full walkthrough replay at milestones |
| Mail | Vitest + GreenMail container | `SmtpImapTransport` against a REAL SMTP+IMAP server; plus a full scheduler+poller run over it | every commit (B8.1) |
| Live canary | manual + script | B8.3+ only — real providers (Gmail/Outlook quirks), not business rules | B8 |

Test DB: dockerized Postgres, one schema per worker (`vitest` globalSetup runs migrations; each file gets a transaction-rollback or truncate isolation helper `withTestDb`).

## 2. Fixture formats (`test/fixtures/`)

- **`golden/events.jsonl`** — the Part-10 cohort as raw events, one JSON per line: `{seq, type, lead_ref, step_no?, sentiment?, source?, occurred_day}` (`occurred_day` = campaign-day offset; loader maps to VirtualClock dates; `lead_ref` = L0001…L0885). Composition encoded: 18 hard-bounce-step-1; 9 soft-then-recover; 72 repliers (28 pos / 19 neu / 25 neg+unsub); 15 link-unsubs; 17 meetings ⊂ positives; remainder complete 4 steps. A generator script (`fixtures/golden/generate.ts`) builds it deterministically (seeded) and asserts its own composition before writing — the fixture is reviewed-in, not regenerated silently.
- **`golden/scenario.ts`** — the same cohort as a scenario script (level 3, §4).
- **`golden/api-fixtures/`** — JSON snapshots of key endpoint responses over the seeded cohort; **exported to `apps/web/src/mocks/fixtures/golden/`** (task B2.18) so MSW serves spec-true numbers.
- **`imports/real_estate_leads.csv`** — 1,000 rows reproducing the exact walkthrough split (60/40/15/82).
- **`headers/`** — real-shape MIME fixtures: gmail-dsn-5xx, gmail-dsn-4xx, outlook-dsn, gmail-vacation, outlook-autoreply, reply-in-reply-to, reply-references-only, reply-forwarded-subject-changed, spam-unrelated.

## 3. The golden cohort at three levels (plan §5.2 — the flagship regression)

1. **L1 (B1):** load `events.jsonl` → fold reducer → assert terminals 40/18/47/780, Σ=885; rebuild-projections equivalence.
2. **L2 (B2):** metric functions over that log → assert *every* Part-10 & §13 number: 8.3 / 3.2 / 4.6 / 2.0% / 17 / 2.0-per-100; variant table (13a), step table (13b: 867/612/540/498 delivered, 15/9/1/3 positives), tier table (13c: 255/447/165 contacted, 13/3/1 meetings), Day-34 partial (6.7 / 3.0 / 2.0 at 600 contacted).
3. **L3 (B3):** run `golden/scenario.ts` through real scheduler+poller over ~49 virtual days → assert the same, plus: no send outside windows, no cap violation on any mailbox-day, threading integrity invariant, every send ≥ minGap×0.8 apart per mailbox.

Any red here after any change = the math stopped closing. These tests are marked `@golden` and must never be skipped.

## 4. Scenario runner DSL (`test/helpers/scenario.ts`)

```ts
const s = await scenario({ mailboxes: 4, dailyCap: 30, sequence: fourStep, startDay: 'Mon' });
s.importLeads(885, { tiers: { A: 260, B: 455, C: 120, nurture: 50 } });
s.enroll({ count: 20, tier: 'A' });
s.onSend('L0042', { outcome: 'hard_bounce', dsn: '5.1.1' });          // scripted per-lead outcomes
s.onSend('L0007', { outcome: 'soft_bounce_then_deliver', retries: 1 });
s.replyAfter('L0101', { days: 2, text: 'Yeah we have this problem…' });
s.replyAfter('L0300', { days: 1, text: 'Remove me.' });               // exercises STOP auto-detect
s.oooAfter('L0150', { days: 0 });
await s.advanceDays(3);                                               // VirtualClock jump; ticks+polls run at
                                                                      //   configured intervals along the way
s.expectEnrollment('L0300', { state: 'UNSUBSCRIBED' });
s.expectMailboxSends('mb1', { day: 3, atMost: 30 });
s.expectMetric('replyRate', { num: 2, den: 60 });
await s.close();
```

`advanceDays/advanceHours` steps the clock in tick-interval increments, invoking scheduler tick + due pollers + due confirm-delivery jobs at each step (jobs run inline, not via pg-boss, in integration tests; pg-boss wiring has its own thin smoke test). All randomness (jitter, spintax, rotation ties) seeded from the scenario seed.

## 5. E2E: the walkthrough replay (`e2e/walkthrough.spec.ts`)

One long Playwright spec mirroring the campaign lifecycle against backend+MockTransport: add 4 mailboxes (Test Connection ✓) → import CSV (assert preview 885 split, commit) → bulk-tier → build sequence (assert 24 variations + score, fatal on link-in-step-1) → create campaign → enroll 20 (capacity meter asserts) → advance sim time (test-only endpoint `POST /system/advance-clock`, mock builds only) → replies appear in Unibox → tag sentiments, book meeting (Overview updates) → "Remove me" auto-unsubs → trip auto-pause (scripted bad batch; mailbox panel appears; resume at 50%) → auth-fail a mailbox (reconnect flow) → run to completion (outcome panel sums to total) → recycle guard blocks identical sequence.

Responsive acceptance adds parameterized Chromium coverage at 320, 375, 390, 430, and 768 px.
It asserts document/body/main widths never overflow, phone cards replace hidden tables, drawer and
filter focus is restored, Escape/focus trapping works, pagination reaches later pages, dialogs fit
the dynamic viewport, Manual Compose preserves unsaved text through viewport/keyboard resizing,
reduced-motion mode is honored, and visible actions meet 44 px targets. Representative Overview,
Leads, Unibox, Analytics, and System screens run `@axe-core/playwright`, including color contrast.

**Built (B7, closes M3):** [`apps/web/e2e-real/walkthrough.real.spec.ts`](../apps/web/e2e-real/walkthrough.real.spec.ts), run via `npm run e2e:real -w @coldemail/web` and CI job `e2e-real`. Its config ([`playwright.real.config.ts`](../apps/web/playwright.real.config.ts)) boots the Fastify app in `SIMULATED_CLOCK` mode on :3001 (its command migrates → resets the test DB → boots) plus the web app in real mode on :5174. The mock transport is scripted over HTTP through SIMULATED_CLOCK-only hooks (`POST /system/{script-inbound,script-send-outcome,script-verify}`, mapped to `MockTransport.synthesizeInbound`/`onSend`/`onVerify` via the `ScriptableTransport` seam). The first spec drives the highest-value real-backend path — login → mailbox add + Test Connection → CSV import → enroll → advance-clock sends → scripted positive reply + STOP → Unibox tag → Overview metrics → **outcomes reconcile 5/5** → System rebuild 0 diffs. It UI-drives the operator-facing screens and uses the real API (via the browser session) for arrange steps already covered by the mock e2e (sequence build, campaign create). Auto-pause/auth-fail/multi-step follow-ups are supported by the scripting hooks and are the natural next scenarios.

Plus small per-screen specs (login, settings validation, suppression-removal typed confirm).

## 5a. The mail rig — a real SMTP+IMAP server in Docker (B8.1)

`docker compose up -d greenmail` runs [GreenMail](https://greenmail-mail-test.github.io/greenmail/) (SMTP 3025 · IMAP 3143 · management API 18080) — the same "test container" pattern Postgres uses, so the live transport is exercised on every commit with **no real mailboxes and no accounts**. Run with `npm run test:mail` (vitest project `mail`, CI job `mail`).

Accounts are declared in `docker-compose.yml` as `<email>:<password>` (**not** the `<local>:<pw>@<domain>` form) so the login is the FULL address, the way Gmail/Outlook work and the way `SmtpImapTransport` derives it from `fromAddress`. Auth is NOT disabled — a wrong password is a genuine 535/AUTHENTICATIONFAILED, which is how the `auth_failed` paths get tested. `POST /api/service/reset` purges all mailboxes between tests (users survive).

Two suites:

- **`test/mail/smtp-imap-transport.test.ts`** — the transport alone, over a `StaticConnections` provider (no DB): verify round-trip · our Message-ID and the In-Reply-To/References chain survive the wire · the UID high-water mark is honoured · reads are non-destructive · real DSN / OOO / threaded-reply messages parse into the shapes the classifier reads · bad credentials → `TransportAuthError` (IMAP) and mailbox-scoped permanent failure (SMTP) · rotated credentials are picked up without a restart.
- **`test/mail/live-pipeline.test.ts`** — the offline dress rehearsal for the §5 canary: composition builds the transport from `MAIL_TRANSPORT=smtp_imap`, credentials come out of `mailbox_secrets`, the real scheduler sends over SMTP and the real poller fetches over IMAP → reply / STOP / hard-bounce classified, idempotent re-poll, and a rebuild-projections replay with **zero drift**.

What GreenMail can't do: reject a recipient with a 5xx (it accepts every address). That branch is covered by the pure `classifySmtpError` unit suite over nodemailer's real error shapes, and confirmed for real at B8.3 against a known-dead address.

## 6. Coverage gates & CI

- `domain/`: 100% branch (reducer table cells are enumerated tests). `render/`, poller classifier, hygiene: ≥95% line. Global server: ≥80%. Web: component tests for the shared interactive components; no numeric gate.
- CI pipeline (GitHub Actions, `ci.yml`): typecheck → lint → unit+integration (Postgres service) → API tests → web build → web component tests → e2e-mock. `@golden` suite is a separate required job, as are `e2e-real` (Postgres) and `mail` (Postgres + GreenMail services).
- Every bugfix lands with a failing-first regression test; every walkthrough number cited in code comments links back to spec part (`// spec P10: 72/867`).
