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

## 0. Findings log — everything the canary has surfaced

**The durable record.** Task chips are not persisted; this table is. Nothing here is a
theoretical review comment — every row is something that stopped, misled, or silently blocked a
real operator during the pass. **Everything marked OPEN must be resolved before the real
campaign**, not before M4 necessarily, but before a paying prospect receives anything.

| # | Finding | Class | Status |
|---|---|---|---|
| 1 | Ops CLIs (`operator:set-password`, `rotate-secrets`, `self-check`) were documented as runnable "from the repo root". They aren't — no root proxy, so the **documented lockout-recovery path did not work**. | docs wrong | ✅ fixed — `-w @coldemail/server`, commit `d588de5` |
| 2 | The compliance footer address is published to every recipient; docs never warned against using a home address, and it's legally required so it can't just be omitted. | docs gap | ✅ documented — docs/16 §6a, commit `590e75a` |
| 3 | **Nothing tells the operator why sends aren't happening.** The window was closed; the scheduler ticked 23 times, correctly did nothing, and emitted no alert, no banner, no log line. Diagnosable only by reading the DB. | **observability** | 🔴 OPEN — highest priority |
| 4 | `mailboxes.send_window` is not editable anywhere in the UI — `mailbox-dialog.tsx` explicitly `.omit()`s it. Every mailbox is pinned to `08:00–17:00 Mon–Fri`. API supports changing it; no screen does. | UI gap | 🔴 OPEN |
| 5 | **No per-mailbox timezone exists at all.** `send_window` carries only start/end/days; the timezone is the single global `settings.default_timezone`. An operator cannot align sending hours to prospect business hours. | design gap | 🔴 OPEN |
| 6 | Campaign status `archived` is reachable via `PATCH /campaigns/:id`, styled in the badge, and handled by the enroll panel — but **no UI control ever sets it**. Dead branches for a state the operator can't reach. | UI gap | 🔴 OPEN |
| 7 | No delete for campaigns or sequences, even at **zero events** where deletion is provably safe. Combined with `tier_effort_config`/`ramp_config` being create-only, a mis-configured campaign is permanently useless *and* permanently undeletable. | UX gap | 🔴 OPEN |
| 8 | No data-subject erasure path (GDPR Art. 17 / DPDP 2023). Suppression deliberately *retains* the email forever, so it is not erasure. | **legal** | 🔴 OPEN |
| 9 | Tier A defaults to **Mode 1 (human-written)**, which the scheduler never sends — it waits for the manual composer. A new operator accepting defaults gets a campaign that silently never sends. Correct behaviour, invisible consequence. | UX trap | 🔴 OPEN |
| 10 | Leads are import-only (no `POST /leads`). Deliberate — the ingest path owns hygiene, dedup and suppression — but adding one lead means hand-writing a CSV. | minor | 🟡 accepted, revisit |
| 11 | **First real send landed in SPAM — cause UNDETERMINED, and this rig cannot determine it.** Three hypotheses were advanced and each was falsified by the next round of sends: (a) the unconditional footer + omitted `List-Unsubscribe`, killed when identical content reached the inbox; (b) per-account reputation, killed when the "bad" account delivered 3 of 5; (c) the subject line `"quick question"`, which filtered twice and then reached the inbox on a later send with the same subject. **The experiment was contaminated by its own observer**: marking the earlier messages "Not spam" and adding never-spam filters — done on this runbook's own instruction — is direct training signal for Gmail's per-recipient model, so every subsequent send ran against a filter that had just been retrained. Gmail spam placement is not a deterministic function of message content; it is an adaptive per-recipient model weighing explicit feedback, engagement, sender↔recipient history, cross-user aggregates, and volume/recency. Seven-plus sends in two hours between a pair with no prior history is itself a pattern change. **Methodological conclusion: n=1 recipient, an adaptive filter, and an observer training it cannot yield a causal answer.** Real deliverability measurement needs seed lists across providers, meaningful volume, and a purpose-built placement tool — which is week-5 work on warmed domains, not this. | deliverability (unmeasurable here) | 🟢 closed as **not answerable with this instrument** — reinforces the runbook's opening statement that deliverability is out of scope. Do not re-litigate it on the canary rig. |
| 12 | The `List-Unsubscribe` question (docs/14 B8.6 "decision revisit", docs/08 §75) remains **genuinely open** — finding 11 shows it is not what triggered *this* filtering, but says nothing about how it performs on real warmed domains at volume, which is the case the deferral was actually about. Do not treat finding 11 as having answered it. | decision | 🟡 open, deferred to the real canary |
| 13 | **The poller reads `INBOX` only.** Anything Gmail files into Spam is invisible to it — so a reply landing in a *sender* mailbox's spam folder makes the reply-detection path appear broken when it is not. For the canary this needs a "never send to Spam" filter in all three accounts. For production it is a real failure mode worth documenting: a provider silently spam-filing a reply looks identical to a poller bug. | operational | 🟡 mitigated in the rig, document for prod |
| 14 | **The deliverability score's spam lexicon models the wrong era.** `render/spamwords.ts` is the entire vocabulary behind check #9 and decision W's rubric: `['free!!!', 'guarantee', 'act now', 'risk-free', '100% free', 'click here']`. That is a 1990s bulk-mail word list. It contains **zero** burned cold-email phrases — `quick question`, `just following up`, `circling back`, `touching base`, `hope this finds you well`, `reaching out`, `pick your brain`, `15 minutes`, `per my last email`. An operator can therefore write the most template-smelling subject in the industry and the checker will score it clean, which is worse than having no checker: it manufactures false confidence. **Note carefully — this stands on its own as a fact about the code, and is NOT evidence-backed by finding 11**, which turned out to be unmeasurable. The justification is that the lexicon is self-evidently stale, not that any particular phrase was proven to cause filtering. Structurally cheap: decision W says the rubric is DATA and the file header says to tune the lexicon, not `checks.ts`. Worth considering separately whether the subject deserves its own weighting — check #9 currently flattens subject and body into one string (`content = subject + "\n" + body`) and scores a hit identically wherever it appears — but that change should be justified on its own merits, not on this canary's contaminated data. | product gap | 🔴 OPEN — fix before the real campaign |

**The pattern worth naming:** findings 4, 5, 6 and 9 are all the same shape — *the backend
implements it, the API exposes it, the UI never surfaces it, and the operator gets no feedback.*
The offline suites cannot catch this class because they drive the API directly and never look at
a screen. That is precisely the value this canary adds, and it argues for a **UI-coverage audit
of every settings-shaped field** before the real campaign.

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

- [x] **Outbound 587 reaches `smtp.gmail.com`** — ✅ 2026-08-07. Socket open AND a full
      STARTTLS handshake completes with a valid Google cert chain (`CN = smtp.gmail.com`,
      GTS Root R1), so a real SMTP server answers — not just an open port.
- [x] **Outbound 993 reaches `imap.gmail.com`** — ✅ 2026-08-07.
- [x] **Architecture** — ✅ x86_64, so the ARM-prebuild question is moot.

**Provisioned host (2026-08-07):** `coldemail-canary`, Mumbai (`ap-mumbai-1`, single-AD),
Ubuntu 24.04 (`2026.07.17-0`), **VM.Standard.E2.1.Micro — Always Free**, 1 OCPU / 954 MB,
46.6 GB boot. SSH key `~/.ssh/oracle_canary`.

> **Two Oracle traps hit during provisioning, both recorded so they don't cost time twice:**
>
> 1. **`VM.Standard.A1.Flex` (free ARM, 4 OCPU / 24 GB) is out of capacity** in Mumbai and
>    can't be worked around — Mumbai is single-AD, and Always Free resources only exist in the
>    tenancy's home region, so neither "try another AD" nor "try another region" applies.
>    Fell back to the x86 micro. Retry A1 later if a roomier box is wanted.
> 2. **"Create new VCN" locks the "Automatically assign public IPv4 address" toggle** and the
>    instance is created with **no public IP** — the Review page says `Public IPv4 address: No`,
>    which is the only place it's stated plainly. Reproduced on a completely clean wizard, so
>    it's Oracle behaviour, not a mis-click. Fix after creation: instance → Networking →
>    Attached VNICs → primary VNIC → IP administration → row menu → Edit → **Ephemeral public
>    IP** → Update.
>
> **1 GB RAM needs swap.** A 2 GB `/swapfile` is configured and persisted in `/etc/fstab`.
> Postgres will also need tuning down (`shared_buffers`, `max_connections`) before the stack
> runs comfortably.

**Hostname/TLS:** no domain yet, so point a free DuckDNS subdomain at the VM's IP and set
`DOMAIN` to it — Caddy then gets a real Let's Encrypt cert through the existing config,
unchanged. Caddy's internal cert plus a browser warning is a fine fallback.

**Deploy** with `docker-compose.prod.yml` + `.env.prod`, `MAIL_TRANSPORT=mock` initially, and
re-run the §7 checklist on real hardware — **all green 2026-08-07**:

- [x] All three images build (`app`, `caddy`, `backup`) — the Vite build survives 1 GB + swap
- [x] Boot ordering: db healthy → app migrates + seeds operator → app healthy → caddy starts
- [x] `GET /health` through Caddy TLS → `{"ok":true,"db":true,"version":"0.0.0"}`
- [x] App **not** reachable on the host (`:3001` refused; only caddy publishes)
- [x] SPA served (`/` → 200 html) with history fallback (`/leads` → 200 html)
- [x] Login through Caddy → `{"ok":true}` 200
- [x] Backup sidecar cron installed (`30 2 * * *`)

**Access is via SSH tunnel, not a public port** — `DOMAIN=localhost` so Caddy serves the
tunnelled host. Nothing is exposed to the internet, which matters because Gmail app passwords
are typed into this UI. iptables 80/443 are open and persisted, but the Oracle VCN security
list is deliberately left closed; opening it (4 clicks) plus setting `DOMAIN` to the public IP
is all that direct access would need.

```
ssh -i ~/.ssh/oracle_canary -L 8443:localhost:443 ubuntu@<PUBLIC_IP>   # then https://localhost:8443
```

> **Operational lesson (2026-08-07):** never `crontab -l` the backup sidecar in shared output —
> the cron line embeds `DATABASE_URL` **including the Postgres password in plaintext**. Print
> the schedule only (`grep -o '^[0-9* ]*'`). Doing this once already forced a password rotation
> (`ALTER USER` + `.env.prod` + `up -d`). The same caution applies to `docker inspect` and
> `docker compose config`, both of which render resolved env.

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
