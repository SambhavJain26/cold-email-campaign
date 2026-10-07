import { eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { mailboxes, mailboxSecrets } from '../schema';

export type MailboxRow = typeof mailboxes.$inferSelect;
export type MailboxStatus = MailboxRow['status'];

export interface NewMailbox {
  displayName: string;
  fromAddress: string;
  smtpHost: string;
  smtpPort?: number;
  imapHost: string;
  imapPort?: number;
  authType?: 'app_password' | 'google_oauth';
  dailyCap?: number;
  sendIntervalMinutes?: number;
  sendIntervalMinMinutes?: number | null;
  sendIntervalMaxMinutes?: number | null;
  sendWindow?: MailboxRow['sendWindow'];
  timezone?: string;
  /** Folders to poll (0012). Omitted → the column default, INBOX only. */
  pollFolders?: string[];
  status?: MailboxStatus;
}

export async function createMailbox(db: DbLike, mb: NewMailbox): Promise<MailboxRow> {
  const rows = await db.insert(mailboxes).values(mb).returning();
  return rows[0]!;
}

export async function getMailbox(db: DbLike, id: number): Promise<MailboxRow | undefined> {
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.id, id));
  return rows[0];
}

export async function listMailboxes(db: DbLike): Promise<MailboxRow[]> {
  return db.select().from(mailboxes).orderBy(mailboxes.id);
}

/** PostgreSQL is the runtime consumer of persisted timezone identifiers. */
export async function databaseAcceptsTimezone(db: DbLike, timezone: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${timezone}) AS accepted`,
  );
  return (result.rows[0] as { accepted?: boolean } | undefined)?.accepted === true;
}

export async function listMailboxesByStatus(
  db: DbLike,
  statuses: MailboxStatus[],
): Promise<MailboxRow[]> {
  return db
    .select()
    .from(mailboxes)
    .where(inArray(mailboxes.status, statuses))
    .orderBy(mailboxes.id);
}

/** Partial column update — status transitions, pacing anchor, poll bookkeeping, B6.2 edits. */
export async function patchMailbox(
  db: DbLike,
  id: number,
  patch: Partial<
    Pick<
      MailboxRow,
      | 'status'
      | 'statusReason'
      | 'resumeCap'
      | 'pausedAt'
      | 'lastSendAt'
      | 'lastSuccessfulPollAt'
      | 'lastPollUid'
      | 'dailyCap'
      | 'sendIntervalMinutes'
      | 'sendIntervalMinMinutes'
      | 'sendIntervalMaxMinutes'
      | 'nextAllowedSendAt'
      | 'sendWindow'
      | 'displayName'
      | 'fromAddress'
      | 'smtpHost'
      | 'smtpPort'
      | 'imapHost'
      | 'imapPort'
      | 'authType'
      | 'timezone'
      | 'pollFolders'
    >
  >,
): Promise<void> {
  await db.update(mailboxes).set(patch).where(eq(mailboxes.id, id));
}

/** Shared with accepted sends: editing pacing waits for any in-flight send. */
export async function lockMailbox(db: DbLike, id: number): Promise<MailboxRow | undefined> {
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).for('update');
  return rows[0];
}

/** Seal-then-store is the caller's job (secrets/seal.ts) — this repo only moves bytes. */
export async function upsertMailboxSecret(
  db: DbLike,
  mailboxId: number,
  sealed: Buffer,
  at: Date,
): Promise<void> {
  await db
    .insert(mailboxSecrets)
    .values({ mailboxId, sealed, updatedAt: at })
    .onConflictDoUpdate({ target: mailboxSecrets.mailboxId, set: { sealed, updatedAt: at } });
}

export async function getMailboxSecret(db: DbLike, mailboxId: number): Promise<Buffer | null> {
  const rows = await db
    .select({ sealed: mailboxSecrets.sealed })
    .from(mailboxSecrets)
    .where(eq(mailboxSecrets.mailboxId, mailboxId));
  return rows[0]?.sealed ?? null;
}

/** Every sealed secret — the input set for key rotation (secrets/rotateSecrets.ts). */
export async function listMailboxSecrets(
  db: DbLike,
): Promise<{ mailboxId: number; sealed: Buffer }[]> {
  return db
    .select({ mailboxId: mailboxSecrets.mailboxId, sealed: mailboxSecrets.sealed })
    .from(mailboxSecrets)
    .orderBy(mailboxSecrets.mailboxId);
}
