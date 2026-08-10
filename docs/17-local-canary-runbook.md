# Local canary runbook (B8.3-local) — two-week validation on throwaway Gmail

## Pre-cohort readiness update (2026-08-09)

The 20-lead Gmail cohort remains paused until the pre-canary remediation gate is green. The operator-facing Gmail setup checklist includes a filter on every canary account that **never sends mail to Spam**. Production reply monitoring currently reads `INBOX` only; provider Spam folders are intentionally out of scope for this phase.

Before deployment, run the complete local verification gate, including the migration up/down drill and `rebuild-projections --dry-run` with zero diffs. After the Oracle rebuild, repeat the dry-run on the live container before any canary send.

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
real operator during the pass. The detailed table below is the current action list and is updated
as work closes.

### Current remediation status — local gate complete

| Findings | Current status | Evidence / remaining action |
|---|---|---|
| #3–9 | ✅ implemented and locally verified | Blocker visibility; mailbox schedules/timezones; archive/delete guards; PII erasure; explicit Tier A manual workflow. |
| #14 | ✅ implemented and locally verified | Transparent cold-email cliché rubric, including subject lines. |
| #15–16 | ✅ implemented and locally verified | Reply-first lock regression and UIDNEXT cursor initialization coverage. |
| #19 | ✅ implemented and locally verified | GreenMail verifies minimal `multipart/alternative` text + HTML. |
| #13 | ⚠️ intentionally bypassed for this controlled test | Operator elected to proceed without Gmail’s “never send it to Spam” filters. Messages or replies placed in Spam may be invisible because monitoring reads `INBOX` only. |
| All code findings | ✅ deployed to Oracle | Commit `95de5a3` deployed on 2026-08-10; containers healthy, HTTPS `/health` returned 200, and production `rebuild-projections --dry-run` returned 0 diffs. |

| # | Finding report | Class | Current status |
|---|---|---|---|
| 1 | Ops CLIs (`operator:set-password`, `rotate-secrets`, `self-check`) were documented as runnable "from the repo root". They aren't — no root proxy, so the **documented lockout-recovery path did not work**. | docs wrong | ✅ fixed — `-w @coldemail/server`, commit `d588de5` |
| 2 | The compliance footer address is published to every recipient; docs never warned against using a home address, and it's legally required so it can't just be omitted. | docs gap | ✅ documented — docs/16 §6a, commit `590e75a` |
| 3 | **Nothing tells the operator why sends aren't happening.** The window was closed; the scheduler ticked 23 times, correctly did nothing, and emitted no alert, no banner, no log line. Diagnosable only by reading the DB. | **observability** | ✅ completed locally — blockers are visible in Overview/System and alert once per episode |
| 4 | `mailboxes.send_window` is not editable anywhere in the UI — `mailbox-dialog.tsx` explicitly `.omit()`s it. Every mailbox is pinned to `08:00–17:00 Mon–Fri`. API supports changing it; no screen does. | UI gap | ✅ completed locally — days and start/end are editable |
| 5 | **No per-mailbox timezone exists at all.** `send_window` carries only start/end/days; the timezone is the single global `settings.default_timezone`. An operator cannot align sending hours to prospect business hours. | design gap | ✅ completed locally — required IANA mailbox timezone and local-midnight caps |
| 6 | Campaign status `archived` is reachable via `PATCH /campaigns/:id`, styled in the badge, and handled by the enroll panel — but **no UI control ever sets it**. Dead branches for a state the operator can't reach. | UI gap | ✅ completed locally — typed-confirm archive control stops scheduling |
| 7 | No delete for campaigns or sequences, even at **zero events** where deletion is provably safe. Combined with `tier_effort_config`/`ramp_config` being create-only, a mis-configured campaign is permanently useless *and* permanently undeletable. | UX gap | ✅ completed locally — typed deletion, refused when history/dependencies exist |
| 8 | No data-subject erasure path (GDPR Art. 17 / DPDP 2023). Suppression deliberately *retains* the email forever, so it is not erasure. | **legal** | ✅ completed locally — typed erasure tombstones/redacts PII and excludes metrics |
| 9 | Tier A defaults to **Mode 1 (human-written)**, which the scheduler never sends — it waits for the manual composer. A new operator accepting defaults gets a campaign that silently never sends. Correct behaviour, invisible consequence. | UX trap | ✅ completed locally — acknowledgement, count, and manual-composer route shown |
| 10 | Leads are import-only (no `POST /leads`). Deliberate — the ingest path owns hygiene, dedup and suppression — but adding one lead means hand-writing a CSV. | minor | 🟡 accepted, revisit |
| 11 | **First real send landed in SPAM — cause UNDETERMINED, and this rig cannot determine it.** Three hypotheses were advanced and each was falsified by the next round of sends: (a) the unconditional footer + omitted `List-Unsubscribe`, killed when identical content reached the inbox; (b) per-account reputation, killed when the "bad" account delivered 3 of 5; (c) the subject line `"quick question"`, which filtered twice and then reached the inbox on a later send with the same subject. **The filter state was moving throughout, and no send was independent of the ones before it.** (An earlier version of this row blamed "Not spam" marking; the operator had *not* marked anything — that explanation was wrong and is corrected here. Getting the contamination mechanism itself wrong is a fair illustration of how many uncontrolled variables are in play.) What is certain: Gmail placement is not a deterministic function of message content but an adaptive per-recipient model weighing engagement, sender↔recipient history, cross-user aggregates and volume/recency. Every send in this series added history to a pair that previously had none, and the operator opened and read each message to see where it landed — itself an engagement signal. Seven-plus sends in two hours between a previously-silent pair is a pattern change on its own. **Methodological conclusion: n=1 recipient, an adaptive filter, and an observer training it cannot yield a causal answer.** Real deliverability measurement needs seed lists across providers, meaningful volume, and a purpose-built placement tool — which is week-5 work on warmed domains, not this. | deliverability (unmeasurable here) | 🟢 closed as **not answerable with this instrument** — reinforces the runbook's opening statement that deliverability is out of scope. Do not re-litigate it on the canary rig. |
| 12 | The `List-Unsubscribe` question (docs/14 B8.6 "decision revisit", docs/08 §75) remains **genuinely open** — finding 11 shows it is not what triggered *this* filtering, but says nothing about how it performs on real warmed domains at volume, which is the case the deferral was actually about. Do not treat finding 11 as having answered it. | decision | 🟡 open, deferred to the real canary |
| 13 | **The poller reads `INBOX` only.** Anything Gmail files into Spam is invisible to it — so a reply landing in a *sender* mailbox's spam folder makes the reply-detection path appear broken when it is not. For the canary this needs a "never send to Spam" filter in all three accounts. For production it is a real failure mode worth documenting: a provider silently spam-filing a reply looks identical to a poller bug. | operational | 🟡 mitigated in the rig, document for prod |
| 15 | **RACE: a lead who replied still received the follow-up.** `human_reply` at `08:05:15.207`, `sent` (step 2) at `08:05:15.400` — 193 ms later, with `stop_on_reply = true`. The follow-up really went out (`<ce-1-2-1786089915400@gmail.com>`). Cause: `scheduler-tick` and `imap-poll-*` are both registered on `*/5 * * * *`, so **they are scheduled to run in the same minute, every time** — this is a designed-in collision, not a rare interleaving. The scheduler read the enrollment as ACTIVE-and-due, rendered, sent over SMTP and appended `sent`, while the poller was concurrently matching the reply and appending `human_reply`. The scheduler's read preceded the reply's commit. **The offline suites structurally cannot catch this** — the scenario runner drives jobs through an inline queue, so poll and tick never execute concurrently and the interleaving cannot occur. Only real pg-boss workers on real crons expose it. Worst-case production impact is the most embarrassing failure a cold-email tool has: a prospect replies and is immediately auto-followed-up, which is exactly what `stop_on_reply` exists to prevent. Fix direction: re-check enrollment state inside the send transaction immediately before append (the eventStore append is already the single transactional chokepoint, so the guard belongs there), and/or stagger the two crons. | **correctness / concurrency** | ✅ completed locally — enrollment lock + send-time projection re-read; poll cron staggered |
| 16 | **Connecting a mailbox ingests its entire history.** `mailboxes.last_poll_uid` defaults to `0`, so the first poll of a real mailbox fetches every message it has ever received — here **12,581 messages going back to 2022-06-10**, four years of unrelated personal mail, stored in `incoming_messages` with full subjects and sender addresses. 44 historical Amazon/Internshala notifications were classified `auto_reply` and 2 old Gmail DSNs as `bounce`; none produced events because no enrollment matched (that guard held correctly), but the rows are all persisted. Consequences: needless DB bloat, a very slow first poll, and — more seriously — a large volume of unrelated third-party PII pulled into the product's database, which interacts badly with finding 8 (no erasure path). Fix direction: initialise `last_poll_uid` to the mailbox's current `UIDNEXT` at creation/reconnect so polling starts from "now" rather than from the beginning of time. | **data hygiene / privacy** | ✅ completed locally — initialize from UIDNEXT on create and legacy-zero reconnect |
| 17 | **The Leads state filter returned zero rows for every state — frontend and backend disagreed about what `state=` means, and the api suite froze the wrong answer.** `leadsRepo.leadFilterWhere` did `eq(leads.state, filter.state)` — `leads.state` is the **postal** column from the CSV (`Maharashtra`), while the UI's dropdown sends `ENROLLMENT_STATES` values (`REPLIED`, …). docs/10 specified only a bare `state=` with no enumeration, so each side resolved the ambiguity differently. **The api test locked in the backend's reading** by asserting `GET /leads?state=TX` — so 72 green api tests coexisted with a filter that could never match anything the UI sent. docs/12 §Leads settles it: the table has a `location` column *and* a separate `StateBadge (latest enrollment)`, and the filter row sits beside tier/campaign/suppressed. Fixed: filter on `enrollments.current_state` via EXISTS, scoped to the **same** enrollment when `campaign_id` is also supplied; contract disambiguated; tests rewritten to assert enrollment semantics *and* that a postal value no longer matches. | **correctness (contract ambiguity)** | ✅ fixed |
| 18 | **Sentiment tagging reported failure on every success, and the retries wrote junk into an append-only log.** `POST /unibox/:id/sentiment` returns the updated **item** (contract docs/10; route declares `response: { 200: uniboxItemSchema }`), but the client parsed it with `okResponseSchema`. Server returned 200 and appended the event; the client's zod parse rejected the body and the global mutation handler toasted "request failed". The operator clicked seven times, producing **seven duplicate `sentiment_tagged` events** that can never be deleted. Note the client-side decision-H tripwire worked exactly as designed — it caught a genuine client/server disagreement; the client was simply the wrong side. Fixed: parse `uniboxItemSchema`. | **correctness (schema mismatch)** | ✅ fixed |
| 19 | **Every email is 100% plain text, so the footer/signature cannot be visually de-emphasized — and it reads worse than comparable real cold emails as a result.** Confirmed end to end: `render/footer.ts` appends the compliance footer as plain text (`\n\n---\n{address}\n{optout}`), and the scheduler's `sendMail` call passes only `text: msg.bodyText` to nodemailer — there is no `html:` field anywhere in the send path. In plain text every character renders identically, so the unsubscribe line and address are exactly as visually prominent as the message body; a human reader clocks it immediately as automated. **This is very likely a deliberate deliverability choice** (plain text avoids images, tracking pixels, embedded fonts, and hidden-text tricks that spam filters key on) — but it is a false tradeoff. Commercial cold-email tools (Smartlead, Instantly, Apollo, lemlist) send **multipart** email: the same message carries a plain-text part *and* a minimal HTML part side by side (nodemailer supports this natively — passing both `text` and `html` produces `multipart/alternative`); the client renders whichever it prefers, almost always the HTML one. The HTML stays deliberately plain — no images, no tracking, no complex layout — just enough CSS (e.g. `font-size:11px;color:#888`) to de-emphasize the footer the way a real signature block does. What spam filters actually penalize is image-heavy HTML, tracking pixels, excessive links and hidden-text tricks, not the mere presence of minimal inline CSS. **Legal constraint to design around:** CAN-SPAM requires the opt-out and sender identification to be "clear and conspicuous" — de-emphasized-but-legible is standard practice and compliant; genuinely hidden (1px, white-on-white) would not be. | product / deliverability | ✅ completed locally — matching text + minimal escaped HTML, verified by GreenMail |
| 14 | **The deliverability score's spam lexicon models the wrong era.** `render/spamwords.ts` is the entire vocabulary behind check #9 and decision W's rubric: `['free!!!', 'guarantee', 'act now', 'risk-free', '100% free', 'click here']`. That is a 1990s bulk-mail word list. It contains **zero** burned cold-email phrases — `quick question`, `just following up`, `circling back`, `touching base`, `hope this finds you well`, `reaching out`, `pick your brain`, `15 minutes`, `per my last email`. An operator can therefore write the most template-smelling subject in the industry and the checker will score it clean, which is worse than having no checker: it manufactures false confidence. **Note carefully — this stands on its own as a fact about the code, and is NOT evidence-backed by finding 11**, which turned out to be unmeasurable. The justification is that the lexicon is self-evidently stale, not that any particular phrase was proven to cause filtering. Structurally cheap: decision W says the rubric is DATA and the file header says to tune the lexicon, not `checks.ts`. Worth considering separately whether the subject deserves its own weighting — check #9 currently flattens subject and body into one string (`content = subject + "\n" + body`) and scores a hit identically wherever it appears — but that change should be justified on its own merits, not on this canary's contaminated data. | product gap | ✅ completed locally — transparent cliché rubric in subject/body; warning only |

**The pattern worth naming:** findings 4, 5, 6 and 9 are all the same shape — *the backend
implements it, the API exposes it, the UI never surfaces it, and the operator gets no feedback.*
The offline suites cannot catch this class because they drive the API directly and never look at
a screen. That is precisely the value this canary adds, and it argues for a **UI-coverage audit
of every settings-shaped field** before the real campaign.

### Pre-canary remediation implementation notes (2026-08-09)

The completed items above are deployed and the Oracle check is recorded. The Gmail cohort remains
paused until the #13 account filters are set.

- **#3:** Scheduler blockers are exposed in System and Overview and emitted once per active
  blocker episode; the alert names the cause and next action.
- **#4–5:** Mailbox send days, start/end time, and a required IANA timezone are editable. Known
  recipient locations remain recipient-local; unknown locations use mailbox timezone, then global
  default. Capacity resets at mailbox-local midnight.
- **#6–7:** Campaign archive/delete and safe sequence delete controls use typed confirmation.
  Deletes refuse once append-only history or another dependency exists.
- **#8:** Typed-email erasure tombstones a lead, removes suppression, redacts exposed PII and
  excludes the lead from operational metrics. Backups expire on their normal retention schedule;
  an erasure must be replayed before a restored copy resumes service.
- **#9:** Tier A manual mode must be acknowledged at campaign creation, is visible in campaign
  guidance, and appears as an explicit scheduler blocker with its affected count.
- **#14:** The copy-risk rubric now transparently reports common cold-email cliché phrases in
  subject or body. It remains a warning rubric, not a deliverability predictor.
- **#15–16:** Enrollment locks serialize reply and send decisions; IMAP initializes a new or
  legacy-zero cursor from UIDNEXT so historical mailbox content is not ingested.
- **#19:** Automated and manual mail now carries matching plain-text and minimal escaped HTML
  parts, with a small but legible compliance footer.

**Still an operator pre-cohort task (#13):** add Gmail's “never send it to Spam” filter to every
canary account. The product monitors `INBOX`, not a provider Spam folder.

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
