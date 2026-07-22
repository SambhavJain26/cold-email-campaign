import { and, eq } from 'drizzle-orm';
import type { DbLike } from '../client';
import { incomingMessages } from '../schema';

export type IncomingMessageRow = typeof incomingMessages.$inferSelect;
export type NewIncomingMessage = typeof incomingMessages.$inferInsert;

export async function insertIncomingMessage(
  db: DbLike,
  row: NewIncomingMessage,
): Promise<IncomingMessageRow> {
  const rows = await db.insert(incomingMessages).values(row).returning();
  return rows[0]!;
}

/** Idempotency check 1 (docs/07 §1): same (mailbox, UID) already processed. */
export async function existsByUid(db: DbLike, mailboxId: number, uid: number): Promise<boolean> {
  const rows = await db
    .select({ id: incomingMessages.id })
    .from(incomingMessages)
    .where(and(eq(incomingMessages.mailboxId, mailboxId), eq(incomingMessages.imapUid, uid)))
    .limit(1);
  return rows.length > 0;
}

/** Idempotency check 2: same inbound Message-ID seen via another mailbox/UID. */
export async function findByMessageId(
  db: DbLike,
  messageId: string,
): Promise<IncomingMessageRow | undefined> {
  const rows = await db
    .select()
    .from(incomingMessages)
    .where(eq(incomingMessages.messageId, messageId))
    .limit(1);
  return rows[0];
}
