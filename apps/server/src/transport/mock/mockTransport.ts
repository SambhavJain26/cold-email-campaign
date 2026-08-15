// MockTransport (B3.2, docs/07 §6): the scriptable, deterministic transport
// that serves every stage through B7. Sends are logged in memory; outcomes
// are scripted per recipient; inbound traffic is queued per mailbox with
// auto-incrementing UIDs — exactly the shape `fetchNew` returns in B8.
import type { Clock } from '../../clock';
import type {
  IncomingMessage,
  MailboxVerifyConfig,
  MailTransport,
  OutboundMessage,
  ScriptableTransport,
  SendResult,
  SynthesizeInboundInput,
  VerifyResult,
} from '../types';
import { dsnBounce, oooReply, threadedReply, unrelatedSpam } from './inbound';

/** Scripted result of the NEXT send to a recipient (docs/06 §5 branches). */
export type SendOutcome =
  | { kind: 'accept' }
  | { kind: 'transient'; error?: string } // 4b: 4xx/connection — nothing appended
  | { kind: 'permanent_recipient'; error?: string } // 4c: RCPT-time 5xx → hard_bounce
  | { kind: 'permanent_mailbox'; error?: string }; // 4c: auth/connection → auth_failed

export interface SentEntry {
  msg: OutboundMessage;
  at: Date;
  result: SendResult;
}

export class MockTransport implements MailTransport, ScriptableTransport {
  /** Every send attempt, in order — accepted or not. */
  readonly sentLog: SentEntry[] = [];

  private outcomes = new Map<string, SendOutcome[]>(); // recipient -> FIFO of scripted outcomes
  private inbound = new Map<number, IncomingMessage[]>(); // mailboxId -> queue
  private nextUid = new Map<number, number>(); // mailboxId -> next IMAP UID
  private verifyScript = new Map<string, VerifyResult>(); // fromAddress -> result
  private initialPollUids = new Map<string, number>(); // fromAddress -> existing UID high-water
  private fetchErrors = new Map<number, Error[]>(); // mailboxId -> FIFO of scripted fetch failures

  constructor(private readonly clock: Clock) {}

  // ── scripting API (tests / scenario runner) ────────────────────────────────

  /** Queue an outcome for the next unscripted send to `recipient` (FIFO; default accept). */
  onSend(recipient: string, outcome: SendOutcome): void {
    const key = recipient.toLowerCase();
    const q = this.outcomes.get(key) ?? [];
    q.push(outcome);
    this.outcomes.set(key, q);
  }

  /**
   * Queue an inbound message for a mailbox's next poll. The mock assigns the
   * ascending IMAP UID (the poller's idempotency key); pass `uid` only to
   * simulate a duplicate delivery of the same UID.
   */
  queueInbound(
    mailboxId: number,
    // `folder` is assigned here alongside uid/mailboxId (0012) so the message
    // builders stay focused on message shape. Defaults to INBOX; pass it
    // explicitly to simulate a provider spam-filing a reply (finding 13).
    msg: Omit<IncomingMessage, 'uid' | 'mailboxId' | 'folder'> & {
      uid?: number;
      folder?: string;
    },
  ): number {
    const uid = msg.uid ?? this.takeUid(mailboxId);
    const q = this.inbound.get(mailboxId) ?? [];
    q.push({ ...msg, uid, mailboxId, folder: msg.folder ?? 'INBOX' });
    this.inbound.set(mailboxId, q);
    return uid;
  }

  onVerify(fromAddress: string, result: VerifyResult): void {
    this.verifyScript.set(fromAddress.toLowerCase(), result);
  }

  /**
   * SIMULATED_CLOCK scripting (docs/13 §5): build a synthetic inbound message
   * with real header shapes and queue it. reply/ooo thread onto our last
   * accepted send to `to` (returns null if there is none yet); bounce/spam
   * stand alone. The synthetic-inbound builders are the same ones the scenario
   * runner uses, so the poller/classifier runs its exact production paths.
   */
  synthesizeInbound(input: SynthesizeInboundInput): { uid: number } | null {
    const now = this.clock.now();
    if (input.kind === 'bounce') {
      const recipient = input.to ?? input.from;
      if (!recipient) return null;
      return {
        uid: this.queueInbound(
          input.mailboxId,
          dsnBounce({ recipient, status: input.dsnStatus ?? '5.1.1', receivedAt: now }),
        ),
      };
    }
    if (input.kind === 'spam') {
      return {
        uid: this.queueInbound(
          input.mailboxId,
          unrelatedSpam({
            from: input.from ?? 'stranger@spam.example.net',
            receivedAt: now,
            subject: input.subject,
            bodyText: input.bodyText,
          }),
        ),
      };
    }
    // reply / ooo need a threading anchor — our last accepted send to `to`.
    if (!input.to) return null;
    const anchor = this.lastSentTo(input.to);
    if (!anchor) return null;
    const inReplyTo = anchor.msg.headers.messageId;
    const from = input.from ?? input.to;
    const msg =
      input.kind === 'ooo'
        ? oooReply({
            from,
            inReplyTo,
            references: [inReplyTo],
            receivedAt: now,
            subject: input.subject,
            bodyText: input.bodyText,
          })
        : threadedReply({
            from,
            inReplyTo,
            references: [inReplyTo],
            receivedAt: now,
            subject: input.subject,
            bodyText: input.bodyText ?? 'Sounds interesting — tell me more.',
          });
    return { uid: this.queueInbound(input.mailboxId, msg) };
  }

  /** Script the next fetchNew for a mailbox to throw (IMAP failure paths, docs/07 §5). */
  failNextFetch(mailboxId: number, error: Error): void {
    const q = this.fetchErrors.get(mailboxId) ?? [];
    q.push(error);
    this.fetchErrors.set(mailboxId, q);
  }

  /** Accepted sends to one recipient, oldest first. */
  sentTo(recipient: string): SentEntry[] {
    const key = recipient.toLowerCase();
    return this.sentLog.filter((e) => e.msg.to.toLowerCase() === key && e.result.accepted);
  }

  /** Last accepted send to a recipient — the threading anchor for synthetic replies. */
  lastSentTo(recipient: string): SentEntry | undefined {
    return this.sentTo(recipient).at(-1);
  }

  // ── MailTransport ──────────────────────────────────────────────────────────

  send(msg: OutboundMessage): Promise<SendResult> {
    const outcome = this.takeOutcome(msg.to);
    const result = this.resultFor(msg, outcome);
    this.sentLog.push({ msg, at: this.clock.now(), result });
    return Promise.resolve(result);
  }

  fetchNew(mailboxId: number): Promise<IncomingMessage[]> {
    const err = this.fetchErrors.get(mailboxId)?.shift();
    if (err) return Promise.reject(err);
    const q = this.inbound.get(mailboxId) ?? [];
    this.inbound.set(mailboxId, []);
    return Promise.resolve(q);
  }

  setInitialPollUid(address: string, uid: number): void {
    this.initialPollUids.set(address.toLowerCase(), uid);
  }

  initialPollUid(config: MailboxVerifyConfig): Promise<number> {
    return Promise.resolve(this.initialPollUids.get(config.fromAddress.toLowerCase()) ?? 0);
  }

  verify(config: MailboxVerifyConfig): Promise<VerifyResult> {
    const scripted = this.verifyScript.get(config.fromAddress.toLowerCase());
    return Promise.resolve(scripted ?? { smtpOk: true, imapOk: true, roundTripMs: 42 });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private takeUid(mailboxId: number): number {
    const uid = this.nextUid.get(mailboxId) ?? 1;
    this.nextUid.set(mailboxId, uid + 1);
    return uid;
  }

  private takeOutcome(recipient: string): SendOutcome {
    const q = this.outcomes.get(recipient.toLowerCase());
    return q?.shift() ?? { kind: 'accept' };
  }

  private resultFor(msg: OutboundMessage, outcome: SendOutcome): SendResult {
    const messageId = msg.headers.messageId;
    switch (outcome.kind) {
      case 'accept':
        return { messageId, accepted: true };
      case 'transient':
        return {
          messageId,
          accepted: false,
          transientError: outcome.error ?? '421 4.7.0 try again later',
        };
      case 'permanent_recipient':
        return {
          messageId,
          accepted: false,
          permanentError: outcome.error ?? '550 5.1.1 user unknown',
          errorScope: 'recipient',
        };
      case 'permanent_mailbox':
        return {
          messageId,
          accepted: false,
          permanentError: outcome.error ?? '535 5.7.8 authentication failed',
          errorScope: 'mailbox',
        };
    }
  }
}
