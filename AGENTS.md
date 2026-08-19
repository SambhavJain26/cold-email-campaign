# Cold Email Campaign — Agent Instructions

## Current operating boundary

The project is in **pre-real-domain testing**. Until the operator explicitly changes that scope:

- **Approved build scope (operator-approved plan, 2026-08-15) — the only feature work
  authorized:** the public unsubscribe endpoint with opaque tokens, `List-Unsubscribe` /
  one-click headers and the footer link; hard launch guardrails; the domain-readiness preflight;
  per-folder IMAP polling (finding 13); and single-lead creation (finding 10). Outside that list,
  the rule is unchanged: testing, verification, diagnosis, and documentation only.
- Do not implement domain/DNS work, production mailbox configuration, Caddy/domain changes, or
  other deployment features. Google Workspace OAuth is explicitly deferred until a real domain and
  inbox exist.
- The unsubscribe endpoint is being built **dormant**: with no `unsubscribe_base_url` configured
  it emits no link and no header, and the footer falls back to reply-`STOP` only. Do not point it
  at a real hostname, open a public port, or treat Gmail one-click as proven — that needs a
  publicly reachable URL and its own approval.
- Do not start a real cohort or send new external campaign mail without explicit approval for that
  specific send.
- The approved, controlled Gmail acceptance batch is complete. The test campaign is paused; do
  not resume it or create additional test sends without new, per-send operator approval. Read the
  runbook for the authoritative recipient, outcome, and verification record.
- The unsubscribe URL design in `docs/16-deployment-ops.md` §8 is the specification the approved
  build follows. The rest of that section — hard launch guardrails beyond the approved scope,
  Workspace OAuth, and every real-domain deployment step — remains a plan, not functionality.

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

## Unsubscribe endpoint (0010) — built dormant

- **Dormant unless `compliance_settings.unsubscribe_base_url` is set.** Empty (the default, and
  the only correct value until a real sending domain exists) means no body link, no
  `List-Unsubscribe` headers, and a reply-`STOP` footer. Do not set it without approval.
- `GET|POST /u/:token` register **outside `/api/v1`**, so they inherit neither the session plugin
  nor the CSRF check — Gmail's one-click POST carries neither, and its
  `application/x-www-form-urlencoded` body needs the scoped content-type parser or the button
  500s invisibly at Google.
- **The token is a capability and the token is the URL.** `config/logger.ts` redacts `/u/<token>`
  in its `req` serializer; that serializer must emit the default field set and never spread the
  raw request (which carries parsed bodies — B7.1's grep catches it). Only the sha256 is stored.
- `GET` must never unsubscribe (scanners prefetch links). An unknown token renders the same page
  as a valid one. Tokens are minted per send attempt and are NOT derived from `SECRET_KEY`.
- Gmail actually rendering its native button is **unproven and unprovable here** — it needs a
  publicly reachable HTTPS URL. Do not record the one-click flow as verified.

## Launch guardrails, preflight, folder polling (0011–0012)

- **Guardrails bound CONFIGURATION, not behaviour.** `max_mailbox_daily_cap` (50) is enforced on
  mailbox create and patch; `max_ramp_daily_enroll_cap` (25) on campaign create. `min_ramp_days`
  ships at **0 = not enforced** so the migration cannot invalidate existing campaigns — set it
  before a real launch. A value inside these ceilings is permitted, never safe.
- **The preflight is read-only and honest about its limits.** `ready` means nothing FAILED; it
  cannot see warming, list quality or consent. **DKIM reports `unknown`, never `fail`** — DNS
  cannot enumerate selectors, so a miss is not evidence of absence.
- **IMAP UIDs are folder-scoped.** Cursors live in `mailbox_poll_cursors` keyed
  `(mailbox_id, folder)`; a mailbox-wide high-water mark is a bug. Each folder seeds from its own
  UIDNEXT — adding a folder must never back-fill that folder's history (finding 16, per folder).
- `poll_folders` defaults to `INBOX` only. Adding the provider's spam folder is an explicit
  operator action, and the name differs per provider (`[Gmail]/Spam` vs `Junk`).
- `POST /leads` runs the **same** ingest preview+commit as a CSV upload. Never reimplement
  hygiene, dedup or the suppression re-check there.

## Canary operation (2026-08-16)

- **`enroll(campaign, count)` chooses leads by its own ordering** (tier A→B→C→untiered, oldest first), not by your
  intended set. A cohort built by count silently enrols the wrong leads — use `enrollByIds` when the set matters.
- **One send per mailbox per tick.** The pace gap is `send_window_minutes ÷ daily_cap`; drive a cohort faster by
  raising the cap, not by ticking harder.
- **`wait_days: 0` makes step 2 due the instant step 1 lands.** Pause the campaign after step 1, or the follow-up
  outruns any human reply and the reply-stops-sequence behaviour cannot be observed.
- **Changing `poll_folders` outside the API skips UIDNEXT seeding** — seed `mailbox_poll_cursors` for the new folder
  in the same transaction or the next poll ingests that folder's entire history. `capture-fixture --folders` prints
  each folder's UIDNEXT for exactly this.
- **Changing `delivery_confirm_hours` after completions have folded causes projection drift** until the new window
  elapses (finding 24). Run drift checks with the same value that was in force at fold time.
- Ops scripts live in `apps/server/test/ops/`: `canary-drive.ts` (tick/poll/confirm-now/self-check/status — starts
  `Jobs` for every command) and `canary-cohort.ts` (cohort setup through the real services). **Both write real state.**

## Implementation and data safety

- Preserve the append-only event ledger; never delete or rewrite sent/event history.
- Do not erase user data, change live campaign state, or create sends merely to test behavior.
- Use `apply_patch` for repository edits. Preserve unrelated changes in a dirty working tree.
- Keep outbound email simple, compliant, and untracked. `STOP`/unsubscribe remains globally
  suppressive once a valid unsubscribe fact is recorded.
