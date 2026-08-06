# Local canary runbook (B8.3-local) — two-week validation on throwaway Gmail

**Branch:** `b8.3-local-canary` · **Prereq:** none of the real infrastructure (no domain, no
Workspace, no paid VPS).

Every remaining task (B8.3–B8.6 → M4) is blocked on real infrastructure, but most of what they
*prove* can be proven now against real Google servers using throwaway accounts. This runbook is
that pass. It answers one question — **does the machine behave correctly against a real mail
provider?** — and converts the answer into permanent offline coverage.

**Out of scope: deliverability.** Sending from `@gmail.com` inherits Google's reputation. Inbox
placement here says nothing about how warmed domains will perform. This validates the machine,
not the campaign. §6a's prerequisites still gate the real canary.

> **Run the domain / DNS / warming track in parallel, starting week 1.** Warming is 2–4 weeks of
> calendar time that cannot be compressed and does not depend on this outcome. Serialising the
> two tracks costs a month.

---

## 0. The rig

| Role | Account | Setup |
|---|---|---|
| Sender A | throwaway Gmail | 2SV → app password → **IMAP enabled** (Settings → Forwarding and POP/IMAP) |
| Sender B | throwaway Gmail | same — second mailbox is what makes rotation and redistribution testable |
| Seed recipient | throwaway Gmail | nothing. Browser access only; the app never connects to it |
| Dead address | — | not an account. A string, e.g. `zz-no-such-user-8471@gmail.com` |

Leads are **plus-addressed** off the seed (`seed+lead01@gmail.com`, …) so one inbox hosts ~20
distinct leads. Reply matching is header-based (`In-Reply-To` → stored `Message-ID`), never
sender-address matching — which is what makes this work, and what §2 verifies before anything
is built on it.

**Never commit an app password.** It is typed into the Mailboxes screen and sealed with
libsodium before it reaches the DB. `.env.prod` is gitignored; keep it that way.

---

## 1. Host and deploy (day 1)

Oracle Cloud **Always Free** ARM VM. Genuinely free with no expiry, and a real Linux box — so we
deploy the actual production stack and this doubles as a rehearsal of §7's clean-VPS drill on
real hardware.

**Verify before building anything — any one of these fails the host:**

- [ ] **Outbound 587 reaches `smtp.gmail.com`.** Most clouds block outbound 25; some block 587.
      *Highest-risk unknown — check first.* Fallback: run the rig on the laptop instead.
- [ ] **Outbound 993 reaches `imap.gmail.com`.**
- [ ] **The ARM images build.** `@node-rs/argon2` ships `linux-arm64-gnu` prebuilds and
      `libsodium-wrappers` is WASM, so this should be clean. Fallback: Oracle's x86 micro
      instances (1 GB RAM — tight but workable).

**Hostname/TLS:** no domain yet, so point a free DuckDNS subdomain at the VM's IP and set
`DOMAIN` to it — Caddy then gets a real Let's Encrypt cert through the existing config,
unchanged. Caddy's internal cert plus a browser warning is a fine fallback.

**Deploy** with `docker-compose.prod.yml` + `.env.prod`, `MAIL_TRANSPORT=mock` initially, and
re-run the §7 checklist on real hardware:

- [ ] All three images build
- [ ] Boot ordering: db healthy → app migrates + seeds operator → app healthy → caddy starts
- [ ] `GET /health` through Caddy → `{ok:true,db:true}`; app not reachable on the host
- [ ] SPA served with history fallback; login succeeds
- [ ] Backup sidecar cron installed

Only then set `MAIL_TRANSPORT=smtp_imap`. Leave `MAIL_TLS_INSECURE` unset — boot refuses it under
`NODE_ENV=production`, and it would send an app password over an unverified connection.

---

## 2. Rig setup and the go/no-go gate (days 1–2)

Add both senders through the UI (`smtp.gmail.com:587`, `imap.gmail.com:993`) → **Test
Connection** on each.

Tune for a compressed cycle:

| Setting | Value | Why |
|---|---|---|
| daily cap (per mailbox) | 5 | Keeps volume invisible to Google's abuse heuristics |
| `delivery_confirm_hours` | **1** | Integer minimum; gates every contacted-based metric |
| `poll_interval_minutes` | 5 | Default |
| sequence `wait_days` | 0 (one step at 1) | Integer; 0 keeps multi-step testable in minutes |

**The gate — one lead, before building the cohort:**

- [ ] Enroll a single `seed+lead01@gmail.com`, let it send
- [ ] Reply by hand from the seed inbox
- [ ] **`human_reply` binds to the right enrollment** — the plus-addressing assumption, on which
      the whole cohort design rests
- [ ] `Message-ID` intact in the seed's **raw** headers (Show original — never the Gmail UI)
- [ ] Re-poll appends nothing (UID high-water holds against Gmail's own IMAP)
- [ ] `[Gmail]/All Mail` duplication does not confuse the high-water logic

**If plus-addressing does not thread:** fall back to a handful of leads across genuinely distinct
recipient addresses. The cohort shrinks; nothing else changes.

---

## 3. Core walkthrough cohort (days 3–4)

~20 plus-addressed leads + 2 dead addresses. CSV import → bulk-tier → campaign → activate →
enroll. Then **four manual actions**; everything else is automatic.

| Action | Expected |
|---|---|
| Reply normally ×3 | `human_reply` → REPLIED, sequence stops |
| Reply "STOP" ×1 | `unsubscribe` → UNSUBSCRIBED + global suppression |
| Enable the seed's vacation responder, await next send | `auto_reply` → sequence **continues** |
| (nothing — the dead addresses) | `hard_bounce` ×2 → BOUNCED |

Verify:

- [ ] Unibox buckets each message correctly; tag sentiments
- [ ] After the 1-hour confirm window: reply rate and positive rate (÷ **contacted**), bounce
      rate (÷ **distinct leads sent-to**)
- [ ] Terminal outcomes sum to the cohort (REPLIED + BOUNCED + UNSUBSCRIBED + COMPLETED)
- [ ] `npm run rebuild-projections -- --dry-run` → **0 drift**

Note each inbound message's UID as it arrives — that is §4's input.

---

## 4. Capture fixtures and lock them offline (days 5–6) ← *the deliverable that lasts*

This is what makes the pass permanent rather than disposable, and it is most of **B8.4**.

```bash
npm run capture-fixture -w @coldemail/server -- --mailbox 1 --list
```

```bash
npm run capture-fixture -w @coldemail/server -- --mailbox 1 --uid 42 --name gmail-real-dsn-5xx --dry-run
```

The script pulls raw RFC822 over IMAP (BODY.PEEK — non-destructive, `last_poll_uid` untouched),
rewrites every personal address to a corpus-consistent placeholder while preserving the
provider identities the classifier matches on (`mailer-daemon`, `postmaster`), prints the
mapping, and **refuses to write if any address survives unscrubbed**. Always `--dry-run` first
and eyeball the mapping before committing.

Capture at minimum: `gmail-real-dsn-5xx`, `gmail-real-vacation`, `gmail-real-reply`.

Then wire them in:

- [ ] `test/helpers/emlFixtures.ts` — add names to `FixtureName` and `ALL_FIXTURES`
- [ ] `test/unit/header-fixtures.test.ts` — assert load-bearing fields (DSN status, final
      recipient, `Auto-Submitted`, threading headers), mirroring the existing `it.each` blocks
- [ ] Diff real wording against the hand-written fixtures; patch classifier patterns in
      `poller/` wherever Google's actual text differs from the guess

**Gate:** `npm test` fully green with the new fixtures and any pattern changes in, and
`npm run test:golden` untouched at **47**.

---

## 5. Failure cohorts (days 7–9)

Each needs its own cohort — they cannot share one with §3. Reset with `test/ops/e2e-reset.ts`.

- [ ] **Auto-pause on bounce rate** — cohort weighted toward dead addresses to cross the threshold
- [ ] **Mailbox rotation** across both senders
- [ ] **Redistribution** — pause one mailbox mid-run, confirm unstarted work moves
- [ ] **Suppression enforcement** at all four layers (ingest, selection, send, append)
- [ ] **Recycle hash guard** — re-enroll a completed cohort, confirm it blocks and names the steps
- [ ] `--dry-run` → 0 drift after each

---

## 6. Time-based scenarios (days 10–11)

These need the host up, which is why this is not on a laptop.

- [ ] **Stale-poll** — break IMAP credentials, leave past `stale_poll_hours` (6) → `imap_stale`
      + pause + alert; reconnect → polling resumes **without a restart**
- [ ] **Catch-up / never-burst** — stop the app several hours, restart, confirm the backlog is
      paced not dumped (expect a `catchup_backlog` alert)
- [ ] **Backup freshness** — daily self-check alerts on a dump older than 26h
- [ ] **`auth_failed` → reconnect** registers the mailbox poll at runtime

---

## 7. Wrap (days 12–14)

Slack, deliberately — something will surprise us, and Gmail's IMAP is the likeliest source.

- [ ] `PROGRESS.md`: tick B8.3-local, add a dated log entry
- [ ] `docs/16` §5: mark which canary lines are now proven against real Google, and which still
      require warmed domains
- [ ] Merge to `main`: **fixtures, classifier patches, the capture script** — yes. Throwaway
      settings values and host-specific scratch — no.

---

## What this cannot test — no amount of time helps

| | Why | Already covered |
|---|---|---|
| `provider_blocked` | Needs 5 consecutive throttles. Cannot make Google rate-limit at 5/day, and trying is exactly the abuse signal to avoid | `scheduler/providerBlock.ts` unit + scenario |
| Soft bounce / greylisting | Gmail does not greylist predictably | Offline classifier suites |
| Deliverability | Structural — `@gmail.com` borrows Google's reputation | The real canary, §5 + §6a |
| Real multi-day cadence (0/3/4/5) | Would consume the window to prove what `VirtualClock` proves in ms | Golden L3 |

## Account hygiene

- Use each sender manually in a browser first, let it sit a day, **then** point the app at it. A
  brand-new account doing programmatic SMTP is the pattern that draws scrutiny.
- Hold caps at 5/day.
- Capture the bounce DSN a handful of times — **never in a loop**. Repeatedly mailing a
  nonexistent address is a spam signal.
- Only ever send to addresses you control. Realistic worst case is a browser security challenge,
  not deletion — but do not use an account you care about as a sender.
