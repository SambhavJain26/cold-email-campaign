// B8.1 test rig: a REAL SMTP+IMAP server (GreenMail) in Docker — the same
// pattern as the Postgres test container, so the live transport is exercised
// end-to-end with no real mailboxes and no accounts.
//
//   docker compose up -d greenmail      # SMTP 3025 · IMAP 3143 · API 18080
//
// Accounts are declared in docker-compose.yml. The login is the FULL address
// (the way Gmail/Outlook work, and the way SmtpImapTransport derives it from
// `fromAddress`), so a wrong password is a genuine auth failure.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import type { MailboxConnection, MailboxConnectionProvider } from '../../../src/transport/types';

export const GREENMAIL = {
  host: process.env.GREENMAIL_HOST ?? '127.0.0.1',
  smtpPort: Number(process.env.GREENMAIL_SMTP_PORT ?? 3025),
  imapPort: Number(process.env.GREENMAIL_IMAP_PORT ?? 3143),
  apiUrl: process.env.GREENMAIL_API_URL ?? 'http://127.0.0.1:18080',
} as const;

export interface Account {
  address: string;
  password: string;
  displayName?: string;
}

/** Our sending mailboxes. */
export const CANARY: Account = {
  address: 'canary@coldemail.test',
  password: 'canarypw',
  displayName: 'Arjun Mehta',
};
export const SECOND: Account = {
  address: 'second@coldemail.test',
  password: 'secondpw',
  displayName: 'Priya Nair',
};
/** The "lead" — the outside world replying to us. */
export const LEAD: Account = { address: 'seed@lead.test', password: 'seedpw' };
/** A reporting MTA — used to deliver real DSNs into a canary inbox. */
export const DAEMON: Account = { address: 'mailer-daemon@mx.coldemail.test', password: 'daemonpw' };

/**
 * `folders` defaults to INBOX-only, matching a real mailbox's default (0012).
 * Pass extra names to exercise multi-folder polling (finding 13).
 */
export function connectionFor(
  account: Account,
  lastPollUid = 0,
  folders: string[] = ['INBOX'],
): MailboxConnection {
  return {
    smtpHost: GREENMAIL.host,
    smtpPort: GREENMAIL.smtpPort,
    imapHost: GREENMAIL.host,
    imapPort: GREENMAIL.imapPort,
    fromAddress: account.address,
    password: account.password,
    folders: folders.map((name) => ({ name, lastPollUid })),
    ...(account.displayName !== undefined && { displayName: account.displayName }),
  };
}

/** A mutable in-memory provider — the test's stand-in for the DB-backed one. */
export class StaticConnections implements MailboxConnectionProvider {
  private readonly rows = new Map<number, MailboxConnection>();

  set(mailboxId: number, conn: MailboxConnection | null): void {
    if (conn === null) this.rows.delete(mailboxId);
    else this.rows.set(mailboxId, conn);
  }

  /**
   * Move one folder's high-water mark the way the poller does after each
   * message. Per-folder on purpose (0012): advancing INBOX must not move Spam.
   */
  advanceUid(mailboxId: number, uid: number, folder = 'INBOX'): void {
    const row = this.rows.get(mailboxId);
    if (!row) return;
    this.rows.set(mailboxId, {
      ...row,
      folders: row.folders.map((f) => (f.name === folder ? { ...f, lastPollUid: uid } : f)),
    });
  }

  load(mailboxId: number): Promise<MailboxConnection | null> {
    return Promise.resolve(this.rows.get(mailboxId) ?? null);
  }
}

/** Purge every mailbox (users survive) — call in beforeEach for isolation. */
export async function resetGreenMail(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${GREENMAIL.apiUrl}/api/service/reset`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    throw new Error(
      `GreenMail not reachable at ${GREENMAIL.apiUrl} — run \`docker compose up -d greenmail\` (${(err as Error).message})`,
      { cause: err },
    );
  }
  if (!res.ok) throw new Error(`GreenMail reset failed: ${res.status}`);
}

export interface DeliverInput {
  as: Account;
  /** From-header override — a lead whose address has no GreenMail account. */
  from?: string;
  to: string;
  subject?: string;
  text?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  /** Raw RFC822 — used to deliver a real multipart/report DSN. */
  raw?: string;
}

/**
 * Inject mail into a mailbox from "outside" — a lead replying, an autoresponder,
 * a reporting MTA. Goes over real SMTP, so what the transport later fetches is a
 * real message the server stored, not a fixture.
 */
export async function deliver(input: DeliverInput): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: GREENMAIL.host,
    port: GREENMAIL.smtpPort,
    secure: false,
    auth: { user: input.as.address, pass: input.as.password },
    tls: { rejectUnauthorized: false },
    ignoreTLS: true,
  });
  try {
    await transporter.sendMail(
      input.raw !== undefined
        ? { envelope: { from: input.from ?? input.as.address, to: [input.to] }, raw: input.raw }
        : {
            from: input.from ?? input.as.address,
            to: input.to,
            subject: input.subject ?? 'no subject',
            text: input.text ?? 'body',
            ...(input.messageId !== undefined && { messageId: input.messageId }),
            ...(input.inReplyTo !== undefined && { inReplyTo: input.inReplyTo }),
            ...(input.references !== undefined && { references: input.references }),
            ...(input.headers !== undefined && { headers: input.headers }),
          },
    );
  } finally {
    transporter.close();
  }
}

export interface StoredMessage {
  uid: number;
  source: string;
}

/**
 * Move a message from INBOX into another folder, creating it if needed — the
 * test stand-in for a provider spam-filing a reply (finding 13). GreenMail has
 * no spam filter, so the only way to reproduce that failure mode is to do the
 * filing ourselves.
 */
export async function fileIntoFolder(account: Account, uid: number, folder: string): Promise<void> {
  const client = new ImapFlow({
    host: GREENMAIL.host,
    port: GREENMAIL.imapPort,
    secure: false,
    auth: { user: account.address, pass: account.password },
    logger: false,
  });
  await client.connect();
  try {
    await client.mailboxCreate(folder).catch(() => undefined); // already exists
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageMove({ uid: String(uid) }, folder, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Read an account's INBOX directly — used to assert what we actually SENT. */
export async function readInbox(account: Account): Promise<StoredMessage[]> {
  const client = new ImapFlow({
    host: GREENMAIL.host,
    port: GREENMAIL.imapPort,
    secure: false,
    auth: { user: account.address, pass: account.password },
    logger: false,
  });
  await client.connect();
  const out: StoredMessage[] = [];
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const m of client.fetch(
        { uid: '1:*' },
        { uid: true, source: true },
        { uid: true },
      )) {
        if (m.source) out.push({ uid: m.uid, source: m.source.toString('utf8') });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return out.sort((a, b) => a.uid - b.uid);
}

/** A real multipart/report DSN, the shape a provider sends (docs/07 §2.1). */
export function dsnMessage(input: {
  from: string;
  to: string;
  recipient: string;
  status: string;
  messageId?: string;
}): string {
  const boundary = '000000000000dsn42';
  const diagnostic = input.status.startsWith('5')
    ? `smtp; 550 ${input.status} The email account that you tried to reach does not exist`
    : `smtp; 452 ${input.status} The recipient's mailbox is over quota`;
  return [
    `From: Mail Delivery Subsystem <${input.from}>`,
    `To: ${input.to}`,
    `Subject: Delivery Status Notification (Failure)`,
    `Message-ID: ${input.messageId ?? `<dsn-${input.status}-${Date.now()}@mx.coldemail.test>`}`,
    `Date: ${new Date().toUTCString()}`,
    `Auto-Submitted: auto-replied`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/report; report-type=delivery-status; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    `** Address not found **`,
    ``,
    `Your message wasn't delivered to ${input.recipient}.`,
    ``,
    `--${boundary}`,
    `Content-Type: message/delivery-status`,
    ``,
    `Reporting-MTA: dns; mx.coldemail.test`,
    `Final-Recipient: rfc822; ${input.recipient}`,
    `Action: failed`,
    `Status: ${input.status}`,
    `Diagnostic-Code: ${diagnostic}`,
    ``,
    `--${boundary}--`,
    ``,
  ].join('\r\n');
}
