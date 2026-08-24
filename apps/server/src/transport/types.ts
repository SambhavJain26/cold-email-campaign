// The MailTransport seam (build_plan §3.3): ALL email I/O goes through this
// interface. MockTransport (B3) serves stages B3–B7; SmtpImapTransport (B8)
// swaps in via the MAIL_TRANSPORT config flag in composition.ts — nothing
// downstream knows which is active. Shapes are refined in B3 alongside the
// mock; field semantics documented in docs/06 §5 and docs/07 §§1–4.

export interface OutboundMessage {
  mailboxId: number;
  to: string;
  subject: string;
  bodyText: string;
  /** Minimal multipart alternative; text remains the canonical representation. */
  bodyHtml?: string;
  headers: {
    messageId: string; // app-generated BEFORE send — the threading anchor
    inReplyTo?: string;
    references?: string[];
    /**
     * Public unsubscribe URL for this send. Transports emit BOTH
     * `List-Unsubscribe: <url>` and `List-Unsubscribe-Post:
     * List-Unsubscribe=One-Click` from it, so the pair can never disagree.
     * Absent = the feature is dormant and neither header is sent.
     */
    listUnsubscribeUrl?: string;
  };
}

export interface SendResult {
  messageId: string;
  accepted: boolean;
  transientError?: string; // 4xx/connection — retry, nothing appended
  permanentError?: string; // 5xx — hard_bounce (recipient) or mailbox failure
  /**
   * Which thing failed permanently (docs/06 §5 4c): 'recipient' = RCPT-time
   * 5xx → append hard_bounce; 'mailbox' = auth/connection-level permanent
   * → mailbox status auth_failed; unassigned work rotates elsewhere.
   */
  errorScope?: 'recipient' | 'mailbox';
}

export interface IncomingMessage {
  /**
   * IMAP UID. Scoped to a FOLDER, not a mailbox — so the idempotency key is
   * (mailboxId, folder, uid), and a cursor is meaningless without its folder.
   */
  uid: number;
  mailboxId: number;
  /** Which folder it was fetched from (0012). 'INBOX' unless configured. */
  folder: string;
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

/**
 * What a message BUILDER produces: everything except the fields the delivery
 * context owns. `folder` is one of those (0012) — a builder describes the
 * message, not where a provider happened to file it.
 */
export type SynthesizedMessage = Omit<IncomingMessage, 'uid' | 'mailboxId' | 'folder'>;

export interface MailboxVerifyConfig {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  fromAddress: string;
  authType?: 'app_password' | 'google_oauth';
  password?: string; // decrypted just-in-time; never logged
  accessToken?: string; // short-lived and memory-only; never logged
}

export interface VerifyResult {
  smtpOk: boolean;
  imapOk: boolean;
  roundTripMs?: number;
  error?: string;
}

export interface MailFolder {
  name: string;
  /** RFC 6154 special-use flag when the provider exposes one. */
  specialUse?: string;
}

/**
 * Thrown by fetchNew on a PERMANENT auth/credential failure (docs/07 §5):
 * the poller flips the mailbox to auth_failed. Transient
 * fetch errors are plain Errors — job retry/backoff handles those.
 */
export class TransportAuthError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'TransportAuthError';
  }
}

/**
 * What SmtpImapTransport needs to reach one mailbox (B8.1). `send`/`fetchNew`
 * are called with a mailboxId only, but transport/ may not touch the DB (docs/02
 * §1) — composition supplies this port over `mailboxes` + `mailbox_secrets`.
 */
export interface MailboxConnection extends MailboxVerifyConfig {
  /** From-header display name (`"Sarah Chen" <sarah@…>`). */
  displayName?: string;
  /**
   * One high-water mark per polled folder (0012). fetchNew returns messages
   * with UID **strictly greater** than the mark FOR THAT FOLDER; a single
   * mailbox-wide number cannot express this, because IMAP UIDs are per-folder.
   */
  folders: { name: string; lastPollUid: number }[];
}

export interface MailboxConnectionProvider {
  /** null when the mailbox row is gone or has no sealed secret. */
  load(mailboxId: number): Promise<MailboxConnection | null>;
}

export interface OAuthAccessTokenProvider {
  accessToken(mailboxId: number): Promise<string>;
}

export interface MailTransport {
  /** Sending side — used by the scheduler (docs/06 §5). */
  send(msg: OutboundMessage): Promise<SendResult>;
  /** Receiving side — used by the poller; returns messages with UID > high-water mark (docs/07 §1). */
  fetchNew(mailboxId: number): Promise<IncomingMessage[]>;
  /**
   * Highest UID already present in `folder` (UIDNEXT - 1), for first-poll
   * seeding. Applies per FOLDER: adding Spam later seeds that folder the same
   * way, or connecting it re-ingests its whole history (finding 16).
   */
  initialPollUid?(config: MailboxVerifyConfig, folder?: string): Promise<number>;
  /** Discover selectable provider folders without reading message content. */
  listFolders(config: MailboxVerifyConfig): Promise<MailFolder[]>;
  /** "Test Connection" + health monitoring. */
  verify(config: MailboxVerifyConfig): Promise<VerifyResult>;
  /** Release pooled connections on shutdown. Optional — the mock has none. */
  close?(): void | Promise<void>;
}

// ── SIMULATED_CLOCK scripting seam (docs/13 §5) ──────────────────────────────
// The real-backend walkthrough replay drives the running server over HTTP, so
// it needs to script the mock transport the way the in-process scenario runner
// does. This interface is the boundary-safe surface: MockTransport implements
// it; composition hands it to the SimulationDriver; the test-only system routes
// call it. Nothing outside SIMULATED_CLOCK touches it.

export type ScriptedSendOutcome =
  | { kind: 'accept' }
  | { kind: 'transient'; error?: string }
  | { kind: 'permanent_recipient'; error?: string }
  | { kind: 'permanent_mailbox'; error?: string };

export interface SynthesizeInboundInput {
  mailboxId: number;
  kind: 'reply' | 'ooo' | 'bounce' | 'spam';
  /** Recipient whose last accepted send we thread the reply/ooo onto. */
  to?: string;
  /** Sender address (defaults to `to` for a reply). */
  from?: string;
  subject?: string;
  bodyText?: string;
  /** DSN status for `bounce` (e.g. '5.1.1' hard, '4.2.2' soft). */
  dsnStatus?: string;
}

export interface ScriptableTransport {
  /** Build + queue a synthetic inbound message; null if no send to thread onto. */
  synthesizeInbound(input: SynthesizeInboundInput): { uid: number } | null;
  /** Queue the outcome of the next send to `recipient`. */
  onSend(recipient: string, outcome: ScriptedSendOutcome): void;
  /** Script the verify (Test Connection / health) result for a from-address. */
  onVerify(fromAddress: string, result: VerifyResult): void;
}
