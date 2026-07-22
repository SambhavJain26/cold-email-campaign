import { eq, inArray } from 'drizzle-orm';
import type { DbLike } from '../client';
import { mailboxes } from '../schema';

export type MailboxRow = typeof mailboxes.$inferSelect;
export type MailboxStatus = MailboxRow['status'];

export interface NewMailbox {
  displayName: string;
  fromAddress: string;
  smtpHost: string;
  smtpPort?: number;
  imapHost: string;
  imapPort?: number;
  dailyCap?: number;
  sendWindow?: MailboxRow['sendWindow'];
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

/** Partial column update - status transitions, pacing anchor, poll bookkeeping. */
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
    >
  >,
): Promise<void> {
  await db.update(mailboxes).set(patch).where(eq(mailboxes.id, id));
}
