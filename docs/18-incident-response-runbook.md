# Incident Response Runbook

Operator procedures for failures during a campaign. Preserve the append-only event ledger, never
send a message merely to test a repair, and record the incident and resolution in the alert history.
If the safe state is unclear, pause the affected campaign first.

## 1. Mailbox failure

Applies to `auth_failed`, `imap_stale`, `provider_blocked`, `smtp_failing`, or a mailbox auto-pause.

1. Pause the affected campaign if there is any chance replies or opt-outs are not being ingested.
2. Open **Mailboxes** and **System → Alerts history**. Record the mailbox, first alert time, last
   successful poll, status reason, and sends since the last known-good poll.
3. For authentication failure, replace the mailbox credential through the UI; never place it in
   chat, logs, or a shell command. Run **Test connection** before resuming.
4. For stale IMAP, verify every configured poll folder exists at the provider. Do not edit
   `poll_folders` directly in SQL; the API must seed each folder cursor transactionally.
5. For provider blocking or SMTP failure, leave the mailbox paused until the provider condition is
   understood. Unassigned leads naturally rotate across healthy mailboxes; started threads remain
   pinned so threading is not broken.
6. Resume at a reduced cap, observe at least one normal poll cycle, then acknowledge the alert.
7. Run self-check and the projection dry-run. Expected result: no violations and zero diffs.

## 2. Bounce triage

1. Pause the campaign immediately if hard bounces rise unexpectedly or an auto-pause fires.
2. Separate recipient failures (for example `5.1.1`) from mailbox/provider authentication or
   connection failures. Do not treat a mailbox failure as a bad lead.
3. Confirm the DSN is linked to the correct sent `Message-ID`, enrollment, step, and mailbox.
4. Confirm a hard bounce created `hard_bounce`, terminated that enrollment, and globally suppressed
   the lead. Do not remove the suppression simply to retry another address guess.
5. Review list source, verification age, catch-all density, and the most recent import. Quarantine
   the affected source or batch before any resume.
6. Resume only after the cause is fixed, at a reduced cap. Record the before/after bounce rates and
   run self-check plus projection dry-run.

## 3. Spam complaint or informal “do not contact” reply

1. Treat the complaint as an opt-out even if it does not contain the word `STOP`.
2. In Unibox, disposition it as **Explicit opt-out**, **Not interested**, or **Wrong person** as
   applicable. These outcomes append a global unsubscribe suppression.
3. Confirm the lead is suppressed globally and the active enrollment is `UNSUBSCRIBED`. Never use
   the recontact acknowledgement to bypass suppression.
4. Pause the campaign if multiple complaints appear. Review targeting relevance, data source,
   identity/footer accuracy, volume, and copy before resuming.
5. Preserve the incoming message and ledger facts under the retention policy; do not edit sent
   history to make the complaint disappear.

## 4. Emergency campaign pause

1. Use the campaign **Pause** control. Do not rely on stopping a browser tab or worker process.
2. Confirm the campaign status is `paused` and that no new `sent` events appear after the pause
   time. Already accepted mail cannot be recalled.
3. If the risk spans campaigns, pause each affected campaign and pause unhealthy mailboxes.
4. Keep IMAP polling running when safe so replies, bounces, and opt-outs continue to be ingested.
5. Before resuming, document the cause, remediation, intended cohort, cap, and send window. A resume
   and every outbound batch still require the operator approval defined in `AGENTS.md`.

## 5. Unsubscribe endpoint outage

1. Pause every campaign whose sent or queued messages contain an unsubscribe link. Do not continue
   sending while recipients cannot exercise the link.
2. Verify public HTTPS reachability without using or logging a real recipient token. Check service
   health, TLS, routing, and application logs with URL/token redaction intact.
3. Do not rotate, print, or bulk-export tokens. They are capabilities; only their hashes belong in
   the database.
4. Restore the existing route and hostname. Changing `unsubscribe_base_url` does not repair links
   already sent and should not be used as an outage workaround.
5. Confirm `GET` remains confirmation-only and one-click `POST` still appends exactly one
   unsubscribe and suppression. Use offline/API tests unless a separately approved owner-address
   verification is required.
6. Resume only after public HTTPS, idempotency, suppression, logs, backup freshness, self-check, and
   projection dry-run are healthy.

## 6. Restore after personal-data erasure

Erasure is intentionally not undone in the live database. Restoring an old backup can resurrect
PII that the live system has erased, so recovery must replay erasures before service resumes.

1. Keep the restored environment isolated: no workers, SMTP, IMAP, public UI, or outbound network
   access.
2. Restore the database dump into the isolated environment and apply migrations.
3. Obtain the live erasure ledger maintained by the operator (lead identity/reference and erasure
   time). Do not copy erased PII into the ticket or runbook.
4. Reapply every erasure that occurred after the backup. Confirm profile, import rows, incoming
   message PII, and matching alert PII are redacted while non-identifying event lineage remains.
5. Run projection rebuild, projection dry-run, and self-check. Expected result: zero diffs and no
   invariant violations.
6. Only then replace the damaged environment and re-enable services. Record the backup timestamp,
   erasures replayed, verification output, and operator approval.

## Required incident record

For every incident record: start/end time; affected campaigns/mailboxes; alert IDs; last known-good
poll/send/backup; whether outbound was paused; lead/list scope; actions taken; self-check and
projection results; settings changed and restored; and the operator who approved resume.
