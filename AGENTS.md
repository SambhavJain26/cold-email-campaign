# Cold Email Campaign — Agent Instructions

## Current operating boundary

The project is in **pre-real-domain testing**. Until the operator explicitly changes that scope:

- Perform testing, verification, diagnosis, and documentation only.
- Do not implement domain/DNS work, a public unsubscribe endpoint, `List-Unsubscribe` headers,
  production mailbox configuration, Caddy/domain changes, or other deployment features.
- Do not start a real cohort or send new external campaign mail without explicit approval for that
  specific send.
- The approved, controlled Gmail acceptance batch is complete. The test campaign is paused; do
  not resume it or create additional test sends without new, per-send operator approval. Read the
  runbook for the authoritative recipient, outcome, and verification record.
- The unsubscribe URL design in `docs/16-deployment-ops.md` is a future deployment plan, not
  implemented functionality.

## Read first

For operational or testing work, read:

1. `docs/17-local-canary-runbook.md`
2. `docs/16-deployment-ops.md`
3. `git status` and recent `git log`

Treat the runbook as the durable status record. Update it when a finding is actually completed or
verified; never leave a completed task labelled open, and do not call a planned item implemented.

## Test discipline

- Local Postgres and GreenMail: `docker compose up -d`.
- Run DB-backed Vitest projects serially. Never run two DB-backed Vitest invocations concurrently;
  they share `coldemail_test` and can corrupt/flap each other.
- Fast iteration: `npx vitest run --project unit`.
- Important gates: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run test:golden`, `npm run test:mail`, and the relevant API/integration/web suites.
- Use the correct projection command: `npx tsx apps/server/src/services/rebuildCli.ts --dry-run`.
  Verify zero diffs after changes that affect events or projections.

## Oracle canary VM

- SSH: `ssh -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`
- App directory: `~/app`
- Stack: `docker-compose.prod.yml` with `.env.prod`
- UI tunnel: `ssh -L 8443:localhost:443 -i ~/.ssh/oracle_canary ubuntu@92.4.79.54`
- The current deployed branch is `b8.3-local-canary`.

Deploy only when the operator explicitly authorizes it. The standard deploy command is:

```sh
cd ~/app && git pull --ff-only
sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

After an authorized deploy, verify container health, `https://localhost/health`, and a zero-drift
projection dry run inside the app container. Do not expose credentials or `.env.prod` contents.

## Implementation and data safety

- Preserve the append-only event ledger; never delete or rewrite sent/event history.
- Do not erase user data, change live campaign state, or create sends merely to test behavior.
- Use `apply_patch` for repository edits. Preserve unrelated changes in a dirty working tree.
- Keep outbound email simple, compliant, and untracked. `STOP`/unsubscribe remains globally
  suppressive once a valid unsubscribe fact is recorded.
