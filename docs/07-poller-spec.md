# Poller Spec — IMAP Fetch, Classification, Threading, STOP Detection, Idempotency

## Possible replies policy (0033)

After confident matching fails, compare accepted sends on the receiving mailbox before receipt,
within 30 days, against non-erased leads. A specific normalized subject or registrable business
domain creates evidence only. Shared-provider domains cannot create company evidence. Rank both
evidence types, then subject, then company; latest preceding send and enrollment ID break ties.
Deduplicate each lead/campaign. Preserve paused/terminal candidates without reactivating them.
See docs/26 for exact subject normalization and minimum specificity.

Capture removable content for qualifying candidates as well as confident conversations. Other
unmatched traffic remains metadata-only. Suggestions append no holds/stops/suppression or human
metrics; the operator confirms the lead before existing audited linking applies review holds.
Different-address opt-out wording cannot automatically suppress the original lead.
Duplicates preserve canonical identity and deletion tombstones. Startup/migration do not scan
historical messages or fetch bodies. The CLI scan is explicit, metadata-only and bounded to 30 days.

Five-minute polling remains unchanged. Foreground Unibox checks every 30 seconds and displays
mailbox freshness; more than ten minutes without a successful check is warned, not guaranteed
delivery latency. Candidate items use Unibox counts only, without new alert notifications.

## Prospective human-review intake (2026-10-08; local candidate)

Production intake uses review policy; the historical terminal/company policy is selectable only
through an internal test harness to preserve the locked 47-test golden cohort. No migration or
startup fetches/replays old messages. New responses use references when unambiguous, otherwise an
exact contacted sender address with an accepted send before receipt. All unfinished enrollments
for that confidently identified address are held, including unsent siblings. Domains/subdomains
only supply manually reviewed candidate searches. Conflicting references/identity and unmatched
mail remain needs-linking, rather than disappearing through an enrollment inner join.

Intake commits message identity, removable full content, associations, holds or permanent clear
opt-out suppression, audit facts and folder cursor atomically. Equivalent Message-ID/envelope
copies add locations without reprocessing or restoring deleted text. Conflicting envelopes remain
visible. Folder epochs are recorded; changed UIDVALIDITY refuses automatic replay and requires
an explicitly authorized reconciliation.

MailParser streams attachment parts away except bounded delivery-status data, captures complete
text/HTML and converts HTML-only content to text. The combined decoded limit is 5 MiB; oversized
or unconvertible content is explicitly unavailable, never presented as complete truncation.
Opt-outs inspect extracted new text across the full body, excluding identified history/signatures;
uncertain extraction holds for review. Automated detection is independent of thread relationship
and never selects a continuation outcome. DSNs retain hard-bounce/limited-soft-retry protection.
Selected IMAP recovery uses PEEK and verifies identity; it is content-only and explicitly invoked.

## 2026-10-06 incoming-company stopping policy

Migration 0022 persists `settings.incoming_stop_since` at application time. Only newly ingested
messages received at or after that cutoff qualify; historical mail is not replayed. Any incoming
message, including fresh mail, acknowledgement or OOO, can stop previously contacted leads across
campaigns. Existing reply, bounce and explicit opt-out classification remains unchanged.

Sender and lead domains use pinned `tldts` public/private suffix boundaries: company subdomains
match, unrelated hosted tenants do not. A bundled reviewed shared-provider snapshot and local
extensions restrict shared/unknown/invalid domains to exact-address or thread matches. No runtime
download occurs. Never-contacted leads and pool-only leads remain untouched.

Policy stops append `outreach_stopped` with incoming-message ID, sender, method and company domain,
produce terminal `STOPPED`, and clear scheduling. Genuine classified human replies, hard bounces
and opt-outs keep their own outcomes; policy matches do not inflate those analytics. Under the
existing enrollment locks, terminal targets are rechecked before insertion. Events, incoming
ledger and cursor advancement commit atomically. Duplicate/concurrent decisions create no second
stop. A recorded policy stop blocks automatic and ordinary re-enrollment across campaigns.

Rollback preserves stop facts and the cutoff. Use a compatible release that understands STOPPED;
an older binary is not a safe rollback after new facts exist. See [runbook](17-local-canary-runbook.md).

Implements spec Part 6 (the four buckets) + Part 9 (failure states) + decision F (auto opt-out). Lives in `apps/server/src/poller/`. Runs as pg-boss job `imap-poll:<mailboxId>` every `settings.poll_interval_minutes` per non-`auth_failed` mailbox.

---

## 1. Poll cycle

```
poll(mailboxId, now = clock.now()):
  msgs = transport.fetchNew(mailboxId)          // UIDs > mailboxes.last_poll_uid
  for m in msgs (UID ascending):
    if exists incoming_messages(mailbox_id, m.uid): continue        // idempotency (ledger)
    if m.messageId and exists incoming_messages(message_id = m.messageId):
        record as duplicate (classification of original, resulting_event_ids=[]); continue
    result = classify(m)                        // §2
    tx {
      append result.events via eventStore       // may be [] for auto_reply-unmatched/unrelated
      insert incoming_messages row (classification, matched enrollment, event ids, snippet, suggested_sentiment)
      update mailboxes.last_poll_uid = m.uid
    }
  mailboxes.last_successful_poll_at = now
  if mailbox was 'imap_stale': status = 'ok' (auto-recover), info alert
on error:
  pg-boss retries with backoff; job failure does NOT advance last_poll_uid
  (stale detection is the scheduler's job: last_successful_poll_at older than stale_poll_hours → 'imap_stale' + pause sends + alert)
```

Fetching is read-only on the real mailbox: messages are never deleted or moved, and **`\Seen` is not set** — imapflow's `source` fetch uses `BODY.PEEK[]` (B8.1 settled the "configurable in B8" question: peek, always; the operator's own inbox must not have its unread state rewritten by the poller).

Folder configuration is discovered through the authenticated mail transport. `GET
/api/v1/mailboxes/:id/folders` returns selectable folder names and provider special-use metadata,
without fetching message content. A save is refused if any selected folder was verified as absent.
Every newly selected folder is inserted into `mailbox_poll_cursors` with that folder's current
`UIDNEXT` in the same transaction as the mailbox update, so enabling Spam/Junk never backfills its
old messages. The Google preset remains `INBOX` plus `[Gmail]/Spam`; other providers use their
discovered names.

**The `n:*` trap (B8.1).** `UID FETCH {last_poll_uid + 1}:*` does NOT return an empty set when the high-water mark is past the highest UID — IMAP clamps the range and returns the LAST message. `SmtpImapTransport.fetchNew` therefore filters `uid > last_poll_uid` client-side; without it every poll would re-deliver the newest message forever (the ledger would dedupe the events, but the poll would never be a no-op).

## 2. The classifier — strict order, first match wins (spec Part 6)

```
classify(m) → { classification, events[], matchedEnrollment? }

1. BOUNCE:
   trigger: m.isDSN (Content-Type: message/delivery-status)
            OR from matches /^(mailer-daemon|postmaster)@/i
   parse:   dsnStatus (e.g. '5.1.1' / '4.2.2'), dsnRecipient (Final-Recipient / Original-Recipient)
   match:   dsnRecipient → lead by normalized email → most recent ACTIVE-or-recent enrollment;
            refine step_no via sent_messages (latest send to that lead from this mailbox)
   events:  status 5.x.x → hard_bounce(reason=dsnStatus+text)
            status 4.x.x → soft_bounce(retry_no = prior soft count+1)
            soft-bounce side effect: next_send_at = now + softRetryDelay (default 4h) for the SAME step,
              unless retries exhausted (reducer terminals it)
   unmatched recipient → classification 'bounce', events [], logged (visible in debug screen)

2. AUTO-REPLY / OOO:
   trigger: header Auto-Submitted != 'no' (e.g. 'auto-replied')
            OR X-Autoreply/X-Autorespond present
            OR subject matches /(out of (the )?office|automatic reply|auto[- ]?reply|away from|on vacation|on leave|maternity|paternity)/i
   match:   threading (same as bucket 3); if matched → auto_reply event (sequence NOT stopped)
            if unmatched → classification 'auto_reply', events []

3. HUMAN REPLY:
   trigger: In-Reply-To or any References entry matches a sent_messages.message_id
            (NEVER subject-line matching — spec Part 6)
   events:  human_reply(step_no = matched send's step, sentiment = null,
                        attributes.incoming_message_id)
            + STOP detection (§3): may add unsubscribe
   side:    reducer → REPLIED (or UNSUBSCRIBED), next_send_at = NULL (sequence stops)
   AI suggestion (decision E): if enabled, suggest sentiment from snippet → stored on
            incoming_messages.suggested_sentiment only. Failure/timeout (3s) → null, never blocks.
            BUILT: `sentiment/anthropic.ts` behind the `SentimentSuggester` port
            (`sentiment/types.ts`), wired by composition iff ANTHROPIC_API_KEY is set. One
            Messages API call per matched human reply, `max_tokens: 64`, thinking disabled,
            structured output (`{sentiment}` enum) — every failure path resolves to null, and
            a STOP match skips the call because its sentiment is already known.

4. UNRELATED: none of the above → logged with events []. Ignored.
```

## 3. STOP / opt-out detection (decision F, spec Part 8)

Runs on bucket-3 matches when `settings.optout_detection = 'auto'`:

```
text     = unquotedText(bodyText)      // strip lines starting '>' , the footer of quoted original, signatures after '--'
window   = first 300 chars of text, lowercased
keywords = /\b(stop|unsubscribe|remove me|take me off|opt me out|opt out|do not (email|contact) me|no longer (email|contact))\b/
if match:
  events += unsubscribe(source='reply', matched_keyword)
  human_reply.sentiment = 'negative'      // known at insert time — decision M
```

Precedence in the reducer makes the terminal state UNSUBSCRIBED; suppression side effect fires in the same transaction (docs/04 §3). The Unibox still shows the reply with "auto-unsubscribed ✓" (walkthrough Stage 6, Tom Fisher card); the operator may still re-tag sentiment (appends `sentiment_tagged`) — the suppression stands regardless.

`tag_only` mode: skip this block entirely; unsubscribe fires only from a manual Negative-tag action _if_ the operator also clicks "unsubscribe" (separate button — tagging alone never suppresses).

## 3.1 Operator outcomes and reminders

Every human reply stops the sequence before it appears in Unibox. The operator can separately
record a reply disposition and sentiment. `not_now` requires a future calendar date and atomically
creates or updates an open `not_now` reminder. The same date remains the recontact permission
guard: completing or dismissing the reminder changes only the task, never the guard, never the
enrollment state, and never sends anything. Manual reminders are also non-sending tasks. The old
snooze endpoint is retained only for already-active enrollment scheduling and refuses replied
enrollments.

## 4. Threading contract (the hard requirement, spec Part 6)

- Every outbound message gets `Message-ID: <{uuid}@{mailbox-domain}>` — generated by the app, not the provider, so it is known before send and stored on the `sent` event + `sent_messages`.
- Continued-conversation steps set `In-Reply-To` to the previous message in that conversation and
  `References` to that conversation's prior Message-IDs in order. They reuse the nearest preceding
  new-conversation step's exact sent subject prefixed `Re: `. A later new-conversation step resets
  both the subject anchor and References boundary.
- Inbound matching checks `In-Reply-To` first, then walks `References` newest→oldest; first hit in `sent_messages` wins. This matches replies to _any_ step of the thread.

## 5. Failure states (spec Part 9)

| Detection                           | Action                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMAP auth error (permanent) on poll | mailbox `auth_failed`, pause sends, alert, redistribution per docs/06 §6                                                                                                                                                        |
| Poll failing transiently            | retries; `last_successful_poll_at` ages → scheduler flips `imap_stale` at `stale_poll_hours`, pauses sends (replies might be sitting undetected → sequences must not keep firing), alert. Auto-recovers on next successful poll |
| Parse crash on one message          | that message logged `unrelated` with `attributes.parse_error`; poll continues (one poison message never wedges the mailbox)                                                                                                     |

## 6. MockTransport obligations (what B3's mock must produce — plan §3.3)

The mock's scenario script drives synthetic inbound traffic **with real header shapes**, because the classifier must be exercised on the exact code paths reality will use:

- Replies: `In-Reply-To` pointing at the actual sent Message-ID recorded by the mock.
- Bounces: MIME `multipart/report; report-type=delivery-status` with `Status: 5.1.1` / `4.2.2` and `Final-Recipient`.
- OOO: `Auto-Submitted: auto-replied` header.
- Unrelated spam: no threading headers.
- Fixture corpus for unit tests (`test/fixtures/headers/`): real-world Gmail + Outlook DSN samples, Gmail vacation responder, Outlook automatic reply, a forwarded-with-changed-subject reply (must still match via References), a reply with References but no In-Reply-To.

## 7. Tests (B3)

Classifier unit tests over the fixture corpus (every bucket × every provider fixture); STOP matcher positive/negative cases ("STOP", "please remove me", vs "we should stop losing leads" — **note:** naive `stop` matching would false-positive here, so when the only match is the bare word "stop" the matcher requires the keyword in the first 300 chars _and_ unquoted text ≤ 40 words _and_ "stop" sitting in a standalone clause of ≤ 4 words ("STOP", "Please stop." — never mid-sentence; the ≤40-words rule alone would still false-positive on the short example above); longer texts require a stronger phrase); idempotency (same UID twice, same Message-ID from two mailboxes); soft→retry→recover→delivered; soft×3 → BOUNCED; late reply after COMPLETED upgrades to REPLIED; reply after UNSUBSCRIBED logs event, state unchanged; unmatched DSN logged not crashed; poison message isolation.
