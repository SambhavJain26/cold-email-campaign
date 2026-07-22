// Synthetic inbound generator (B3.3, docs/07 §6): builders that produce
// IncomingMessage values with REAL header shapes - the classifier must be
// exercised on the exact code paths reality will use. The raw-MIME fixture
// corpus lives in test/fixtures/headers/; these builders are the scenario
// runner's programmatic equivalent.
import type { IncomingMessage } from '../types';

let extSeq = 0;
/** Deterministic external Message-ID for synthetic inbound mail. */
export function nextExternalMessageId(domain = 'ext.example.com'): string {
  extSeq += 1;
  return `<synthetic-${extSeq}@${domain}>`;
}
/** Tests that assert exact ids can reset the counter. */
export function resetExternalMessageIds(): void {
  extSeq = 0;
}

export interface ReplyInput {
  from: string;
  subject?: string;
  bodyText: string;
  receivedAt: Date;
  /** The sent message being replied to - its Message-ID becomes In-Reply-To. */
  inReplyTo: string;
  /** Full thread chain, oldest first (defaults to just inReplyTo). */
  references?: string[];
  messageId?: string;
  /** Drop In-Reply-To, keep References only (a real Outlook-ism the walk must handle). */
  referencesOnly?: boolean;
}

/** A human reply threading back to one of our sent Message-IDs (docs/07 §4). */
export function threadedReply(r: ReplyInput): Omit<IncomingMessage, 'uid' | 'mailboxId'> {
  const messageId = r.messageId ?? nextExternalMessageId();
  const references = r.references ?? [r.inReplyTo];
  const headers: Record<string, string> = {
    'message-id': messageId,
    references: references.join(' '),
  };
  if (!r.referencesOnly) headers['in-reply-to'] = r.inReplyTo;
  return {
    from: r.from,
    subject: r.subject ?? 'Re: quick question',
    headers,
    bodyText: r.bodyText,
    messageId,
    inReplyTo: r.referencesOnly ? undefined : r.inReplyTo,
    references,
    isDSN: false,
    receivedAt: r.receivedAt,
  };
}

export interface DsnInput {
  /** The address that bounced (Final-Recipient). */
  recipient: string;
  /** DSN status code - '5.1.1' hard, '4.2.2' soft, … */
  status: string;
  receivedAt: Date;
  /** Reporting MTA's mailer-daemon address. */
  from?: string;
  diagnostic?: string;
}

/** A delivery-status notification with the multipart/report shape (docs/07 §2.1). */
export function dsnBounce(d: DsnInput): Omit<IncomingMessage, 'uid' | 'mailboxId'> {
  const messageId = nextExternalMessageId('mx.example.com');
  const diagnostic =
    d.diagnostic ??
    (d.status.startsWith('5')
      ? `smtp; 550 ${d.status} The email account that you tried to reach does not exist`
      : `smtp; 452 ${d.status} The recipient's inbox is full`);
  return {
    from: d.from ?? 'mailer-daemon@mx.example.com',
    subject: 'Delivery Status Notification (Failure)',
    headers: {
      'message-id': messageId,
      'content-type': 'multipart/report; report-type=delivery-status; boundary="0000dsn"',
      'auto-submitted': 'auto-replied',
    },
    bodyText:
      `Final-Recipient: rfc822; ${d.recipient}\n` +
      `Action: failed\nStatus: ${d.status}\nDiagnostic-Code: ${diagnostic}\n`,
    messageId,
    isDSN: true,
    dsnStatus: d.status,
    dsnRecipient: d.recipient,
    receivedAt: d.receivedAt,
  };
}

export interface OooInput {
  from: string;
  receivedAt: Date;
  /** Threading back to our send, when the responder threads (most do). */
  inReplyTo?: string;
  references?: string[];
  subject?: string;
  bodyText?: string;
}

/** An out-of-office auto-reply (`Auto-Submitted: auto-replied`, docs/07 §2.2). */
export function oooReply(o: OooInput): Omit<IncomingMessage, 'uid' | 'mailboxId'> {
  const messageId = nextExternalMessageId();
  return {
    from: o.from,
    subject: o.subject ?? 'Automatic reply: quick question',
    headers: {
      'message-id': messageId,
      'auto-submitted': 'auto-replied',
      ...(o.inReplyTo ? { 'in-reply-to': o.inReplyTo } : {}),
      ...(o.references ? { references: o.references.join(' ') } : {}),
    },
    bodyText: o.bodyText ?? 'I am out of the office until Monday with limited access to email.',
    messageId,
    inReplyTo: o.inReplyTo,
    references: o.references,
    isDSN: false,
    receivedAt: o.receivedAt,
  };
}

/** Unrelated inbound mail - no threading headers; the classifier must ignore it. */
export function unrelatedSpam(input: {
  from: string;
  receivedAt: Date;
  subject?: string;
  bodyText?: string;
}): Omit<IncomingMessage, 'uid' | 'mailboxId'> {
  const messageId = nextExternalMessageId('spam.example.net');
  return {
    from: input.from,
    subject: input.subject ?? 'Grow your business 10x with our SEO service',
    headers: { 'message-id': messageId },
    bodyText: input.bodyText ?? 'We noticed your website and can help you rank #1 on Google.',
    messageId,
    isDSN: false,
    receivedAt: input.receivedAt,
  };
}
