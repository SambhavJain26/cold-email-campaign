// The poll cycle (B3.10, docs/07 §1): fetch → dedupe → classify → one tx per
// message (events + incoming_messages ledger row + last_poll_uid). A poison
// message never wedges the mailbox; job failure never advances last_poll_uid.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import { TransportAuthError, type MailTransport, type IncomingMessage } from '../transport/types';
import type { AlertSink } from '../alerts/types';
import type { EventStore } from '../services/eventStore';
import { evaluateAutoPause } from '../services/autoPause';
import { getSettings } from '../db/repos/settingsRepo';
import { getMailbox, patchMailbox } from '../db/repos/mailboxesRepo';
import { redistributeUnstarted } from '../db/repos/enrollmentsRepo';
import {
  existsByUid,
  findByMessageId,
  insertIncomingMessage,
  nextIncomingMessageId,
  type NewIncomingMessage,
} from '../db/repos/incomingMessagesRepo';
import { classify, type ClassificationResult } from './classifier';

export interface PollerDeps {
  db: Db;
  store: EventStore;
  transport: MailTransport;
  clock: Clock;
  alerts: AlertSink;
}

export interface PollResult {
  polled: boolean;
  processed: number;
  duplicates: number;
  byClass: Record<string, number>;
}

export class Poller {
  constructor(private readonly deps: PollerDeps) {}

  async poll(mailboxId: number): Promise<PollResult> {
    const { db, transport, clock, alerts } = this.deps;
    const result: PollResult = { polled: false, processed: 0, duplicates: 0, byClass: {} };

    const mb = await getMailbox(db, mailboxId);
    // auth_failed mailboxes are not polled (docs/07 header); everything else
    // is - polling is how imap_stale recovers.
    if (!mb || mb.status === 'auth_failed') return result;
    result.polled = true;

    const now = clock.now();
    const settings = await getSettings(db);

    let msgs: IncomingMessage[];
    try {
      msgs = (await transport.fetchNew(mailboxId)).sort((a, b) => a.uid - b.uid);
    } catch (err) {
      if (err instanceof TransportAuthError) {
        // Permanent IMAP auth failure (docs/07 §5): pause sends, alert,
        // redistribute unstarted enrollments (docs/06 §6).
        await patchMailbox(db, mailboxId, {
          status: 'auth_failed',
          statusReason: err.message,
          pausedAt: now,
        });
        await alerts.emit('mailbox_auth_failed', 'error', {
          mailboxId,
          error: err.message,
          via: 'imap_poll',
        });
        await redistributeUnstarted(db, mailboxId);
        return result;
      }
      // Transient failure: rethrow - job retry/backoff owns it; last_poll_uid
      // did NOT advance, and staleness detection is the scheduler's job.
      throw err;
    }

    for (const m of msgs) {
      // Idempotency 1: (mailbox, UID) already in the ledger.
      if (await existsByUid(db, mailboxId, m.uid)) continue;

      // Idempotency 2: same Message-ID already processed (e.g. via another
      // mailbox) - record as duplicate of the original, no events.
      const original = m.messageId ? await findByMessageId(db, m.messageId) : undefined;
      if (original) {
        // The unique im_msgid index belongs to the ORIGINAL row - the
        // duplicate record carries message_id NULL and points at nothing.
        await this.recordOnly(
          { ...m, messageId: undefined },
          now,
          {
            classification: original.classification,
            events: [],
            matchedEnrollmentId: original.matchedEnrollmentId ?? undefined,
            snippet: original.snippet ?? '',
          },
          undefined,
        );
        result.duplicates += 1;
        continue;
      }

      const rowId = await nextIncomingMessageId(db);
      let classified: ClassificationResult;
      try {
        classified = await classify(db, m, { settings, now, incomingMessageId: rowId });
      } catch (err) {
        // Poison message isolation (docs/07 §5): log as unrelated, continue.
        classified = {
          classification: 'unrelated',
          events: [],
          snippet: `[parse_error] ${String(err).slice(0, 200)}`,
        };
      }

      if (classified.events.length > 0) {
        // Events + ledger row + UID high-water land in ONE transaction; the
        // row's resultingEventIds come from the just-inserted event ids.
        await this.deps.store.append(classified.events, {
          patches: classified.patches,
          txWork: async (tx, eventIds) => {
            await insertIncomingMessage(tx, {
              ...this.rowFor(m, now, classified),
              id: rowId,
              resultingEventIds: eventIds,
            });
            await patchMailbox(tx, mailboxId, { lastPollUid: m.uid });
          },
        });
      } else {
        await this.recordOnly(m, now, classified, rowId);
      }
      result.processed += 1;
      result.byClass[classified.classification] =
        (result.byClass[classified.classification] ?? 0) + 1;

      // Post-commit hook (docs/06 §6): every hard_bounce append re-evaluates
      // the sending mailbox's auto-pause windows.
      const hardBounce = classified.events.find((e) => e.type === 'hard_bounce');
      if (hardBounce && 'mailboxId' in hardBounce && hardBounce.mailboxId !== undefined) {
        await evaluateAutoPause({ db, alerts }, hardBounce.mailboxId, now);
      }
    }

    await patchMailbox(db, mailboxId, { lastSuccessfulPollAt: now });
    if (mb.status === 'imap_stale') {
      await patchMailbox(db, mailboxId, { status: 'ok', statusReason: null });
      await alerts.emit('imap_recovered', 'info', { mailboxId });
    }
    return result;
  }

  /** Ledger row without events (unrelated / unmatched / duplicate) + UID, one tx. */
  private async recordOnly(
    m: IncomingMessage,
    now: Date,
    c: Pick<ClassificationResult, 'classification' | 'matchedEnrollmentId' | 'snippet' | 'events'>,
    id?: number,
  ): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await insertIncomingMessage(tx, { ...this.rowFor(m, now, c), id });
      await patchMailbox(tx, m.mailboxId, { lastPollUid: m.uid });
    });
  }

  private rowFor(
    m: IncomingMessage,
    now: Date,
    c: Pick<ClassificationResult, 'classification' | 'matchedEnrollmentId' | 'snippet'>,
  ): NewIncomingMessage {
    return {
      mailboxId: m.mailboxId,
      imapUid: m.uid,
      messageId: m.messageId ?? null,
      inReplyTo: m.inReplyTo ?? null,
      fromAddress: m.from,
      subject: m.subject,
      receivedAt: m.receivedAt,
      processedAt: now,
      classification: c.classification,
      matchedEnrollmentId: c.matchedEnrollmentId ?? null,
      resultingEventIds: [],
      dsnStatus: m.dsnStatus ?? null,
      snippet: c.snippet,
    };
  }
}
