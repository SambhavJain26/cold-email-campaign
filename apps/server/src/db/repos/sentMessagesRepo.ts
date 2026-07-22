import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbLike } from '../client';
import { sentMessages } from '../schema';

export type SentMessageRow = typeof sentMessages.$inferSelect;

export async function insertSentMessage(
  db: DbLike,
  row: typeof sentMessages.$inferInsert,
): Promise<void> {
  await db.insert(sentMessages).values(row);
}

/**
 * Threading walk (docs/07 §4): resolve candidate Message-IDs (In-Reply-To
 * first, then References newest→oldest) against our sent log. Returns rows
 * keyed by message_id; the caller applies the precedence order.
 */
export async function findSentByMessageIds(
  db: DbLike,
  messageIds: string[],
): Promise<Map<string, SentMessageRow>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(sentMessages)
    .where(inArray(sentMessages.messageId, messageIds));
  return new Map(rows.map((r) => [r.messageId, r]));
}

/** Bounce matching refinement (docs/07 §2.1): latest send to a lead from a mailbox. */
export async function latestSentToLead(
  db: DbLike,
  leadId: number,
  mailboxId?: number,
): Promise<SentMessageRow | undefined> {
  const where =
    mailboxId === undefined
      ? eq(sentMessages.leadId, leadId)
      : and(eq(sentMessages.leadId, leadId), eq(sentMessages.mailboxId, mailboxId));
  const rows = await db
    .select()
    .from(sentMessages)
    .where(where)
    .orderBy(desc(sentMessages.sentAt))
    .limit(1);
  return rows[0];
}

/** All prior message-ids of an enrollment's thread, oldest first (References chain). */
export async function listThreadMessageIds(
  db: DbLike,
  enrollmentId: number,
): Promise<SentMessageRow[]> {
  return db
    .select()
    .from(sentMessages)
    .where(eq(sentMessages.enrollmentId, enrollmentId))
    .orderBy(sentMessages.sentAt);
}
