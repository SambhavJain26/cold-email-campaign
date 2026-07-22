// The MailTransport seam (build_plan §3.3): ALL email I/O goes through this
// interface. MockTransport (B3) serves stages B3-B7; SmtpImapTransport (B8)
// swaps in via the MAIL_TRANSPORT config flag in composition.ts - nothing
// downstream knows which is active. Shapes are refined in B3 alongside the
// mock; field semantics documented in docs/06 §5 and docs/07 §§1-4.

export interface OutboundMessage {
  mailboxId: number;
  to: string;
  subject: string;
  bodyText: string; // plain text only (walkthrough Stage 4: no HTML, no images)
  headers: {
    messageId: string; // app-generated BEFORE send - the threading anchor
    inReplyTo?: string;
    references?: string[];
  };
}

export interface SendResult {
  messageId: string;
  accepted: boolean;
  transientError?: string; // 4xx/connection - retry, nothing appended
  permanentError?: string; // 5xx - hard_bounce (recipient) or mailbox failure
}

export interface IncomingMessage {
  uid: number; // IMAP UID - idempotency key with mailboxId
  mailboxId: number;
  from: string;
  subject: string;
  headers: Record<string, string>; // lowercased header names
  bodyText: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  isDSN: boolean;
  dsnStatus?: string; // e.g. '5.1.1' / '4.2.2'
  dsnRecipient?: string;
  receivedAt: Date;
}

export interface MailboxVerifyConfig {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  fromAddress: string;
  password: string; // decrypted just-in-time; never logged
}

export interface VerifyResult {
  smtpOk: boolean;
  imapOk: boolean;
  roundTripMs?: number;
  error?: string;
}

export interface MailTransport {
  /** Sending side - used by the scheduler (docs/06 §5). */
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Receiving side - used by the poller; returns messages with UID > high-water mark (docs/07 §1). */
  fetchNew(mailboxId: number): Promise<IncomingMessage[]>;
  /** "Test Connection" + health monitoring. */
  verify(config: MailboxVerifyConfig): Promise<VerifyResult>;
}
