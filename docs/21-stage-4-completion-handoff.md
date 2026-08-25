# Stage 4 completion handoff

**Recorded:** 2026-08-25

**Branch:** `b8.3-local-canary`

**Stage commits:** Stage 3 `8930060`; Stage 4 `f273109`

**Status:** procedure completed successfully; Stage 4 was subsequently deployed to Spaceship on
2026-08-25 after separate explicit approval

**Purpose:** preserve how Stage 4 was completed without requiring a later reconstruction

## 1. Operating boundary

This handoff covers only local verification, documentation reconciliation, the Stage 4 commit, and
the push to `b8.3-local-canary`.

Do not:

- deploy to Spaceship or Oracle;
- activate or resume a campaign;
- enroll production leads;
- send test or real mail;
- change DNS, Caddy, OAuth credentials, mailboxes, or live application state;
- merge or push to `main`.

Deployment was separately approval-gated at this checkpoint. It was subsequently approved and
completed as recorded in docs/17. The local Docker Postgres and GreenMail containers are disposable
test infrastructure, not production services.

## 2. Current implementation state

Stage 3 was committed and pushed before this run. Stage 4 is complete locally and is included in
the commit containing this record.

The Stage 4 working tree contains:

- the `100dvh` application shell, fixed desktop sidebar, mobile top bar, and Sheet navigation;
- campaign-context-preserving navigation, skip link, semantic landmarks, and focus restoration;
- shared phone-card/desktop-table rendering and responsive filter Sheets;
- responsive Leads, Mailboxes, Sequences, Campaigns, Unibox, Analytics, Cold Storage, System,
  Settings, Overview, login, and detail screens;
- phone-sized dialogs and forms, sticky action areas, and 44 px touch targets;
- accessible chart summaries, labelled progress bars, and reduced-motion handling;
- parameterized mobile Playwright and axe coverage at 320, 375, 390, 430, and 768 px;
- refreshed desktop screenshots `01`–`18` and new mobile screenshots `19`–`23`;
- draft updates to the frontend architecture, screen specification, testing strategy, user manual,
  and companion guide.

Preserve the current dirty working tree. Do not reset, checkout, clean, or regenerate files before
reviewing `git status` and `git diff`.

## 3. Verification already completed in this run

The following results are verified as the complete Stage 4 gate:

| Check | Verified result |
|---|---:|
| Typecheck | pass |
| ESLint | pass |
| Prettier check | pass |
| Unit | 341 passed |
| Web component | 56 passed |
| Integration | 166 passed |
| API | 122 passed |
| GreenMail SMTP/IMAP | 29 passed |
| Locked golden suite | exactly 47 passed |
| Dedicated mobile/accessibility Playwright spec | 7 passed |
| Complete mock-browser Playwright suite | 59 passed |
| Real-backend Playwright walkthrough | 1 passed |
| Migration 0017 | apply/down/apply passed |
| Populated projection comparison | 5 enrollments, 0 differences |
| Self-check | no invariant violations |
| Backup/restore drill | catalog, restore, rebuild, dry-run, and self-check passed |

The first complete mock-browser run exposed responsive selector ambiguity and a Stage 3 verdict
wording assertion. Those test assumptions were corrected, the focused reruns passed, and the final
complete 59-test rerun passed. A multi-page axe scan also received an explicit 60-second budget so
four-worker load cannot misclassify a clean but 30-second scan as a failure.

## 4. Resume checklist

Run these read-only checks first:

```powershell
git branch --show-current
git log -3 --oneline
git status --short
git diff --stat
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Required observations:

- branch is `b8.3-local-canary`;
- `8930060` is in the recent history;
- the uncommitted Stage 4 files and screenshots are still present;
- `coldemail-postgres` and `coldemail-greenmail` are healthy, or can be started with
  `docker compose up -d`;
- there is no temporary `capture-manual-screenshots.spec.ts` file.

Confirm the last point with:

```powershell
Test-Path apps/web/src/e2e/capture-manual-screenshots.spec.ts
```

It must return `False`.

## 5. Finish the verification gate

### 5.1 Rerun the complete mock-browser suite

```powershell
npm run e2e -w @coldemail/web
```

Acceptance result: all **59** tests pass. This full rerun is mandatory even though the affected
journey and mailbox specs already passed in isolation.

If it fails:

1. Preserve the failure output and inspect the Playwright error context.
2. Fix only the scoped regression.
3. Rerun the affected spec while iterating.
4. Rerun all 59 tests before marking mock E2E complete.

### 5.2 Run the real-backend browser walkthrough

The local Postgres container must be healthy on port 5433. The Playwright configuration starts and
stops its own simulated-clock Fastify server and Vite server.

```powershell
npm run e2e:real -w @coldemail/web
```

Acceptance result: **1** real-backend walkthrough passes. It must finish with the real API,
event-ledger workflow, outcome reconciliation, and System projection check green. The transport is
mocked; this command sends no real email.

### 5.3 Run migration `0017` apply/down/apply

Use only the disposable `coldemail_test` database:

```powershell
$env:DATABASE_URL = 'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test'
npm run db:migrate -w @coldemail/server
npm run db:rollback -w @coldemail/server -- 1
npm run db:migrate -w @coldemail/server
npm run db:status -w @coldemail/server
```

Acceptance result:

- the database begins fully migrated;
- exactly the latest migration, `0017_multi_source_recycling`, rolls back;
- the same migration reapplies successfully;
- final status shows every migration applied.

If a rollback or reapply fails, do not continue to the commit. Return the disposable test database
to fully migrated state, diagnose the migration, and repeat the complete apply/down/apply drill.

### 5.4 Populate projections, run zero-drift comparison, and self-check

The projection proof must contain enrollments; `checked 0 enrollments` is not sufficient.

```powershell
$env:DATABASE_URL = 'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test'
npx tsx apps/server/test/ops/seed-projection-check.ts
npx tsx apps/server/src/services/rebuildCli.ts --dry-run
npx tsx apps/server/src/services/selfCheckCli.ts
```

Acceptance result:

- seeding reports 5 event-backed enrollments;
- projection dry-run reports `checked 5 enrollments — 0 diff(s)`;
- self-check reports no invariant violations.

Do not run a write rebuild against this primary evidence cohort to hide drift. Any non-zero dry-run
result is a real blocker that must be diagnosed.

### 5.5 Run a scratch-database backup and restore drill

This Windows-safe procedure uses the local Postgres container’s client tools and an explicitly
named disposable database. It never connects to Spaceship or Oracle.

Create and validate a dump inside the container:

```powershell
docker exec coldemail-postgres pg_dump -Fc --no-owner --no-privileges -U coldemail -d coldemail_test -f /tmp/coldemail-stage4.dump
docker exec coldemail-postgres pg_restore --list /tmp/coldemail-stage4.dump
```

Create the explicitly named scratch database and restore the dump:

```powershell
docker exec coldemail-postgres psql -U coldemail -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS coldemail_stage4_restore WITH (FORCE)"
docker exec coldemail-postgres psql -U coldemail -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE coldemail_stage4_restore"
docker exec coldemail-postgres pg_restore --no-owner --no-privileges -U coldemail -d coldemail_stage4_restore /tmp/coldemail-stage4.dump
```

Rebuild only the restored scratch database, then prove the fold is stable and invariants hold:

```powershell
$env:DATABASE_URL = 'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_stage4_restore'
npm run rebuild-projections -w @coldemail/server
npx tsx apps/server/src/services/rebuildCli.ts --dry-run
npx tsx apps/server/src/services/selfCheckCli.ts
```

Acceptance result:

- `pg_restore --list` succeeds;
- restore succeeds without errors;
- write rebuild succeeds on the scratch database only;
- the following dry-run reports 0 differences;
- self-check reports no violations.

After recording the evidence, remove only the explicitly named scratch database and dump:

```powershell
docker exec coldemail-postgres psql -U coldemail -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS coldemail_stage4_restore WITH (FORCE)"
docker exec coldemail-postgres rm -f /tmp/coldemail-stage4.dump
```

Restore `DATABASE_URL` before any later local DB command:

```powershell
$env:DATABASE_URL = 'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test'
```

### 5.6 Final static and web checks after any fixes

If any code changed while resolving the remaining tests, rerun:

```powershell
npm run typecheck
npm run lint
npm run format:check
npx vitest run --project web
```

If backend/domain code changes, repeat every affected DB-backed suite and the projection checks,
not merely the failing test.

## 6. Reconcile durable documentation

> Historical checkpoint: the instructions in this section describe the local completion boundary
> before the separately approved 2026-08-25 Spaceship rollout. They were completed as written; the
> later deployment evidence is in docs/17.

Only after every remaining acceptance result is verified, update these files with evidence from
the actual completed run:

1. `AGENTS.md`
   - state that Stages 1–4 are complete locally;
   - remove the instruction that Stage 4 remains unimplemented;
   - keep deployment, activation, enrollment, and sending separately gated;
   - record the new final serial-gate counts.
2. `CLAUDE.md`
   - align its current-status and engineering-memory sections with Stage 4 completion;
   - retain all production safety and infrastructure facts.
3. `PROGRESS.md`
   - add the Stage 4 implementation and verification evidence;
   - set the current focus to separately approved production deployment/commissioning, not more
     Stage 4 implementation.
4. `docs/17-local-canary-runbook.md`
   - add a dated Stage 4 locally verified section above Stage 3;
   - list the exact test counts, zero projection differences, self-check, migration drill, and
     restore drill;
   - explicitly say Stage 4 is not deployed.
5. `docs/16-deployment-ops.md`
   - record the new local candidate as awaiting a separate production deployment approval;
   - do not change the verified live production commit until a deployment actually occurs.
6. `docs/11-frontend-architecture.md`, `docs/12-frontend-screens.md`, and
   `docs/13-testing-strategy.md`
   - review the existing Stage 4 drafts for accuracy against the final code and tests.
7. `docs/19-user-manual.md`
   - verify mobile navigation, cards, filters, dialogs, reminders, direct/eventual analytics, and
     multi-source recycling are described in operator language;
   - retain the distinction between the local candidate and currently deployed production;
   - keep screenshots `01`–`23` linked with meaningful alt text.
8. `docs/20-user-manual-questions.md`
   - remove any remaining text that calls pagination, reminders, fixed navigation, or mobile
     usability merely proposed;
   - update its status summary from “final gate remains” to locally complete only after the gate.
9. `docs/00-INDEX.md`
   - keep this handoff listed as document 21.

Documentation rules:

- report only exact verified counts;
- do not claim deployment, production acceptance, live OAuth verification, or real-email sending;
- do not replace the known Spaceship deployed commit `680f47e` until a separately approved deploy;
- do not alter Oracle’s paused rollback status;
- use “implemented locally” or “local deployment candidate” where appropriate.

After documentation edits, run:

```powershell
npm run format:check
git diff --check
```

## 7. Review the complete Stage 4 change set

Before staging:

```powershell
git status --short
git diff --stat
git diff -- apps/web/src docs AGENTS.md CLAUDE.md PROGRESS.md
git diff -- apps/web/package.json package-lock.json
```

Review points:

- `@axe-core/playwright` is the only intended new dependency;
- no production environment, secret, credential, test token, or generated Playwright artifact is
  present;
- no temporary screenshot-capture spec remains;
- all screenshots are intentional user-manual assets;
- no unrelated user change is staged;
- no API/backend behavior was silently added during Stage 4;
- mobile and desktop layouts use the same query and action logic.

The dependency install reported three existing audit findings (one moderate and two high). Do not
run an automatic `npm audit fix` as part of this scope; record or address them separately after
reviewing whether the fixes are breaking.

## 8. Commit and push Stage 4

Stage only the approved Stage 4 implementation, tests, documentation, screenshots, and lockfile:

```powershell
git add apps/web package-lock.json docs AGENTS.md CLAUDE.md PROGRESS.md
git status --short
git diff --cached --stat
```

Then commit:

```powershell
git commit -m "feat: complete responsive mobile redesign"
```

Push only the current branch:

```powershell
git push origin b8.3-local-canary
```

Verify the handoff state:

```powershell
git status --short
git rev-parse --short HEAD
git rev-list --left-right --count origin/b8.3-local-canary...HEAD
git log -3 --oneline
```

Acceptance result:

- working tree is clean;
- local and remote branch divergence is `0 0`;
- the Stage 4 commit follows Stage 3 commit `8930060`;
- `main` is untouched.

## 9. Completion report

The final report should state:

- Stage 3 commit and Stage 4 commit IDs;
- exact test counts and all gate results;
- migration `0017` apply/down/apply result;
- populated projection result and self-check result;
- scratch restore-drill result;
- documentation and screenshots updated;
- branch pushed and synchronized;
- no production/Oracle deployment, live campaign change, enrollment, or email send occurred during
  this local completion procedure;
- production deployment was still separately approval-gated at this checkpoint and was approved
  later.

## 10. Blocker policy

If any required assertion fails:

- do not claim Stage 4 complete;
- do not commit a known failing state merely to preserve it—the working tree already preserves it;
- do not push a completion commit;
- do not work around projection drift by rewriting primary evidence;
- do not expand into production diagnosis or infrastructure changes;
- record the exact failing command, output summary, affected files, and safest next action.

Sections 4–8 are retained as the exact procedure that completed this stage. All assertions passed.
This procedure did not itself authorize or perform deployment; the later, separately approved
Spaceship rollout is recorded in docs/17.
