import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { incomingMessages } from '../schema';

export type IncomingMessageRow = typeof incomingMessages.$inferSelect;
export type NewIncomingMessage = typeof incomingMessages.$inferInsert;

/**
 * Pre-allocate a ledger id from the identity sequence (non-transactional, so
 * safe outside the tx). Lets a human_reply event carry
 * attributes.incoming_message_id while the row itself is inserted later in
 * the SAME transaction as the event (docs/07 §1).
 */
export async function nextIncomingMessageId(db: DbLike): Promise<number> {
  const r = await db.execute(
    sql`SELECT nextval(pg_get_serial_sequence('incoming_messages', 'id'))::bigint AS id`,
  );
  return Number((r.rows[0] as { id: string | number }).id);
}

export async function insertIncomingMessage(
  db: DbLike,
  row: NewIncomingMessage & { id?: number },
): Promise<IncomingMessageRow> {
  const insert =
    row.id === undefined
      ? db.insert(incomingMessages).values(row)
      : db.insert(incomingMessages).overridingSystemValue().values(row);
  const rows = await insert.returning();
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
