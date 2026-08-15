// SmtpImapTransport (B8.1) — the live implementation of the MailTransport seam
// (docs/02 §4). Wired only by composition.ts under MAIL_TRANSPORT=smtp_imap;
// nothing downstream knows it is active. Three obligations, from docs/06 §5 and
// docs/07 §§1,4:
//
//  send      nodemailer, carrying OUR Message-ID (generated before the send, so
//            threading is anchored on an id we stored) and the In-Reply-To /
//            References chain verbatim. Failures map to the 4a/4b/4c branches
//            via classifySmtpError.
//  fetchNew  imapflow, `UID FETCH {highWater+1}:*` — then a client-side
//            `uid > highWater` filter, because an IMAP `n:*` range ALWAYS
//            returns the last message when n is beyond the highest UID
//            (verified against a real server; without the filter every poll
//            re-delivers the newest message forever).
//  verify    SMTP login + IMAP login round-trip for Test Connection / health.
//
// Reads are non-destructive: `source` fetches use BODY.PEEK, so \Seen is not
// set and the app never deletes or moves anything (docs/07 §1).
import nodemailer, { type Transporter } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import {
  TransportAuthError,
  type IncomingMessage,
  type MailboxConnection,
  type MailboxConnectionProvider,
  type MailboxVerifyConfig,
  type MailTransport,
  type OutboundMessage,
  type SendResult,
  type VerifyResult,
} from '../types';
import { classifySmtpError, rejectionError } from './errors';
import { toIncomingMessage } from './parse';

export interface SmtpImapOptions {
  /** Supplies host/port/credentials + the UID high-water mark (composition owns the DB). */
  connections: MailboxConnectionProvider;
  /**
   * Accept self-signed certs and don't require STARTTLS. For LOCAL test servers
   * (the GreenMail container) only — never against a real provider.
   */
  insecureTls?: boolean;
  /** Folder to poll. */
  mailbox?: string;
  /** Socket timeouts (ms) — a wedged connection must not wedge a job forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class SmtpImapTransport implements MailTransport {
  private readonly pools = new Map<number, { signature: string; transporter: Transporter }>();

  constructor(private readonly opts: SmtpImapOptions) {}

  // ── sending (docs/06 §5) ───────────────────────────────────────────────────

  async send(msg: OutboundMessage): Promise<SendResult> {
    const messageId = msg.headers.messageId;
    let conn: MailboxConnection | null;
    try {
      conn = await this.opts.connections.load(msg.mailboxId);
    } catch (err) {
      // Credential lookup failed (DB down, unseal failed): mailbox-scoped and
      // permanent enough that sending through it must stop.
      return {
        messageId,
        accepted: false,
        permanentError: `credentials unavailable: ${errText(err)}`,
        errorScope: 'mailbox',
      };
    }
    if (!conn) {
      return {
        messageId,
        accepted: false,
        permanentError: 'mailbox has no stored credentials',
        errorScope: 'mailbox',
      };
    }

    try {
      const info = await this.transporterFor(msg.mailboxId, conn).sendMail({
        from: conn.displayName
          ? { name: conn.displayName, address: conn.fromAddress }
          : conn.fromAddress,
        to: msg.to,
        subject: msg.subject,
        text: msg.bodyText,
        ...(msg.bodyHtml !== undefined && { html: msg.bodyHtml }),
        messageId, // OURS — never let the provider mint it (docs/07 §4)
        ...(msg.headers.inReplyTo !== undefined && { inReplyTo: msg.headers.inReplyTo }),
        ...(msg.headers.references !== undefined && { references: msg.headers.references }),
        // RFC 8058 one-click. Both headers or neither — Gmail ignores
        // List-Unsubscribe-Post without a List-Unsubscribe URL, and a
        // List-Unsubscribe without the Post header gets no native button.
        ...(msg.headers.listUnsubscribeUrl !== undefined && {
          headers: {
            'List-Unsubscribe': `<${msg.headers.listUnsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });

      // A resolved send can still carry a rejected recipient (multi-RCPT
      // partial failure); we always send to exactly one address.
      if (info.rejected.length > 0 || info.accepted.length === 0) {
        return failureResult(messageId, rejectionError(info.rejectedErrors));
      }
      return { messageId, accepted: true };
    } catch (err) {
      // The pooled connection may be poisoned (auth/socket) — drop it so the
      // next attempt reconnects rather than inheriting the failure.
      this.dropPool(msg.mailboxId);
      return failureResult(messageId, classifySmtpError(err));
    }
  }

  // ── receiving (docs/07 §1) ─────────────────────────────────────────────────

  async fetchNew(mailboxId: number): Promise<IncomingMessage[]> {
    const conn = await this.opts.connections.load(mailboxId);
    if (!conn) return [];

    const client = this.imapClient(conn);
    try {
      await client.connect();
    } catch (err) {
      throw this.imapError(err);
    }

    const messages: IncomingMessage[] = [];
    // One pass per configured folder, each against ITS OWN high-water mark —
    // IMAP UIDs are per-folder, so a shared mark would skip or re-deliver.
    const folders = conn.folders.length > 0 ? conn.folders : [{ name: 'INBOX', lastPollUid: 0 }];
    try {
      for (const folder of folders) {
        let lock;
        try {
          lock = await client.getMailboxLock(folder.name);
        } catch (err) {
          // A folder that does not exist on this provider (names differ:
          // "[Gmail]/Spam" vs "Junk") must not take down the whole poll —
          // INBOX still has to be read. Auth failures still propagate.
          if (err instanceof Error && /auth/i.test(err.message)) throw err;
          continue;
        }
        try {
          const highWater = folder.lastPollUid;
          for await (const m of client.fetch(
            { uid: `${highWater + 1}:*` },
            { uid: true, source: true, internalDate: true },
            { uid: true },
          )) {
            // The `n:*` range returns the LAST message when n > highest UID —
            // this filter is what makes fetchNew idempotent.
            if (m.uid <= highWater || !m.source) continue;
            messages.push(
              await toIncomingMessage(m.source, {
                uid: m.uid,
                mailboxId,
                folder: folder.name,
                // imapflow types INTERNALDATE loosely (string | Date).
                ...(m.internalDate && { internalDate: new Date(m.internalDate) }),
              }),
            );
          }
        } finally {
          lock.release();
        }
      }
    } catch (err) {
      throw this.imapError(err);
    } finally {
      await client.logout().catch(() => client.close());
    }

    // Sort within folder; the poller advances each folder's cursor separately.
    return messages.sort((a, b) => a.folder.localeCompare(b.folder) || a.uid - b.uid);
  }

  async initialPollUid(config: MailboxVerifyConfig, folder?: string): Promise<number> {
    const client = this.imapClient(config);
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder ?? this.opts.mailbox ?? 'INBOX');
      try {
        const mailbox = client.mailbox;
        return Math.max(0, (mailbox && mailbox.uidNext ? mailbox.uidNext : 1) - 1);
      } finally {
        lock.release();
      }
    } catch (err) {
      throw this.imapError(err);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  // ── Test Connection / health ───────────────────────────────────────────────

  async verify(config: MailboxVerifyConfig): Promise<VerifyResult> {
    const started = Date.now();
    let smtpOk = false;
    let imapOk = false;
    let error: string | undefined;

    const transporter = nodemailer.createTransport(this.smtpOptions(config, false));
    try {
      await transporter.verify();
      smtpOk = true;
    } catch (err) {
      error = `smtp: ${errText(err)}`;
    } finally {
      transporter.close();
    }

    const client = this.imapClient(config);
    try {
      await client.connect();
      imapOk = true;
      await client.logout();
    } catch (err) {
      error ??= `imap: ${errText(err)}`;
      client.close();
    }

    return {
      smtpOk,
      imapOk,
      roundTripMs: Date.now() - started,
      ...(error !== undefined && { error }),
    };
  }

  /** Close pooled SMTP connections (shutdown). */
  close(): void {
    for (const { transporter } of this.pools.values()) transporter.close();
    this.pools.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private transporterFor(mailboxId: number, conn: MailboxConnection): Transporter {
    const signature = `${conn.smtpHost}:${conn.smtpPort}:${conn.fromAddress}:${conn.password}`;
    const cached = this.pools.get(mailboxId);
    if (cached && cached.signature === signature) return cached.transporter;
    cached?.transporter.close(); // credentials changed (reconnect) — rebuild
    const transporter = nodemailer.createTransport(this.smtpOptions(conn, true));
    this.pools.set(mailboxId, { signature, transporter });
    return transporter;
  }

  private dropPool(mailboxId: number): void {
    const cached = this.pools.get(mailboxId);
    if (!cached) return;
    cached.transporter.close();
    this.pools.delete(mailboxId);
  }

  private smtpOptions(config: MailboxVerifyConfig, pool: boolean) {
    const timeout = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465, // implicit TLS; otherwise STARTTLS
      requireTLS: !this.opts.insecureTls && config.smtpPort !== 465,
      auth: { user: config.fromAddress, pass: config.password },
      ...(this.opts.insecureTls && { ignoreTLS: true, tls: { rejectUnauthorized: false } }),
      // One connection per mailbox: the scheduler paces sends itself (docs/06 §3).
      ...(pool && { pool: true, maxConnections: 1, maxMessages: 100 }),
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      logger: false,
    };
  }

  private imapClient(config: MailboxVerifyConfig): ImapFlow {
    const timeout = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapPort === 993,
      auth: { user: config.fromAddress, pass: config.password },
      logger: false, // imapflow's default logger prints message content
      emitLogs: false,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      ...(this.opts.insecureTls && { tls: { rejectUnauthorized: false } }),
    });
    // `logout()` can race a remote socket close. ImapFlow then emits a later
    // `error` event even though the polling call has already caught its
    // promise rejection; without a listener Node treats that event as fatal
    // and restarts the worker. The caller still receives operational errors
    // from connect/fetch/logout, while this listener safely absorbs only the
    // late close notification.
    client.on('error', () => undefined);
    return client;
  }

  /**
   * Permanent auth failure → TransportAuthError (the poller flips the mailbox to
   * auth_failed and redistributes, docs/07 §5). Anything else stays a plain
   * Error so pg-boss retries and last_poll_uid does not advance.
   */
  private imapError(err: unknown): Error {
    const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string };
    if (e.authenticationFailed === true || e.code === 'AUTHENTICATIONFAILED') {
      return new TransportAuthError(`imap authentication failed: ${errText(err)}`);
    }
    return err instanceof Error ? err : new Error(errText(err));
  }
}

function failureResult(
  messageId: string,
  failure: ReturnType<typeof classifySmtpError>,
): SendResult {
  if (failure.kind === 'transient') {
    return { messageId, accepted: false, transientError: failure.error };
  }
  return {
    messageId,
    accepted: false,
    permanentError: failure.error,
    errorScope: failure.scope,
  };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
