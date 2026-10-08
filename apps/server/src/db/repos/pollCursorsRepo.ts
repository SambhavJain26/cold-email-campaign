// Per-(mailbox, folder) IMAP high-water marks (0012, finding 13).
//
// IMAP UIDs are scoped to a folder: UID 42 in INBOX and UID 42 in Spam are
// different messages. Every read and write here is therefore keyed by folder,
// and code that treats a cursor as mailbox-wide is a bug.
import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { mailboxPollCursors } from '../schema';

export interface PollCursor {
  folder: string;
  lastPollUid: number;
  uidValidity: string | null;
}

export async function listCursors(db: DbLike, mailboxId: number): Promise<PollCursor[]> {
  const rows = await db
    .select({
      folder: mailboxPollCursors.folder,
      lastPollUid: mailboxPollCursors.lastPollUid,
      uidValidity: mailboxPollCursors.uidValidity,
    })
    .from(mailboxPollCursors)
    .where(eq(mailboxPollCursors.mailboxId, mailboxId));
  return rows;
}

/**
 * Advance one folder's cursor. Monotonic on purpose: a message processed out of
 * order must never rewind the mark and re-deliver everything after it.
 */
export async function setCursor(
  db: DbLike,
  mailboxId: number,
  folder: string,
  lastPollUid: number,
  uidValidity?: string,
): Promise<void> {
  await db
    .insert(mailboxPollCursors)
    .values({ mailboxId, folder, lastPollUid, uidValidity })
    .onConflictDoUpdate({
      target: [mailboxPollCursors.mailboxId, mailboxPollCursors.folder],
      // GREATEST, not assignment: enforced in SQL rather than relying on the
      // caller processing in ascending UID order, because a rewind here would
      // silently re-deliver every message after the mark.
      set: {
        lastPollUid: sql`GREATEST(${mailboxPollCursors.lastPollUid}, excluded.last_poll_uid)`,
        ...(uidValidity !== undefined ? { uidValidity } : {}),
      },
    });
}

/**
 * Seed a folder that has never been polled. Initialising from UIDNEXT is what
 * stops connecting a mailbox from ingesting years of history (finding 16) —
 * and that hazard applies per FOLDER, so adding Spam later re-runs it.
 */
export async function seedCursorIfAbsent(
  db: DbLike,
  mailboxId: number,
  folder: string,
  lastPollUid: number,
): Promise<void> {
  await db
    .insert(mailboxPollCursors)
    .values({ mailboxId, folder, lastPollUid })
    .onConflictDoNothing({
      target: [mailboxPollCursors.mailboxId, mailboxPollCursors.folder],
    });
}

export async function getCursor(
  db: DbLike,
  mailboxId: number,
  folder: string,
): Promise<number | null> {
  const rows = await db
    .select({ lastPollUid: mailboxPollCursors.lastPollUid })
    .from(mailboxPollCursors)
    .where(and(eq(mailboxPollCursors.mailboxId, mailboxId), eq(mailboxPollCursors.folder, folder)));
  return rows[0]?.lastPollUid ?? null;
}
