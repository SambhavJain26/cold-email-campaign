import { eq, inArray } from 'drizzle-orm';
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
  authType?: string;
  dailyCap?: number;
  sendWindow?: MailboxRow['sendWindow'];
  timezone?: string;
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
      | 'sendWindow'
      | 'displayName'
      | 'fromAddress'
      | 'smtpHost'
      | 'smtpPort'
      | 'imapHost'
      | 'imapPort'
      | 'authType'
      | 'timezone'
    >
  >,
): Promise<void> {
  await db.update(mailboxes).set(patch).where(eq(mailboxes.id, id));
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
