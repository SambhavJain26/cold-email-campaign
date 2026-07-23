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

// ── B6.7 unibox queries ──────────────────────────────────────────────────────

export interface UniboxRow {
  incomingMessageId: number;
  /** ISO-8601 UTC string (formatted in SQL - raw execute skips Date mapping). */
  receivedAt: string | null;
  snippet: string | null;
  bodyText: string | null;
  suggestedSentiment: string | null;
  enrollmentId: number;
  campaignId: number;
  stepNo: number | null;
  leadId: number;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadCompany: string | null;
  leadEmail: string;
  meetingBooked: boolean;
  effectiveSentiment: string | null;
  autoUnsubscribed: boolean;
  replyEventId: number | null;
}

// NOTE: raw db.execute bypasses drizzle's column mapping - timestamps come
// back as strings - so received_at is ISO-formatted in SQL, deterministically.
const uniboxSelect = sql`
  SELECT im.id AS incoming_message_id,
         to_char(im.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           AS received_at,
         im.snippet, im.body_text,
         im.suggested_sentiment,
         e.id AS enrollment_id, e.campaign_id, e.lead_id, e.meeting_booked,
         l.first_name AS lead_first_name, l.last_name AS lead_last_name,
         l.company AS lead_company, l.email AS lead_email,
         hr.id AS reply_event_id, hr.step_no,
         COALESCE(
           (SELECT st.sentiment::text FROM events st
             WHERE st.type = 'sentiment_tagged'
               AND (st.attributes->>'reply_event_id')::bigint = hr.id
             ORDER BY st.id DESC LIMIT 1),
           hr.sentiment::text) AS effective_sentiment,
         EXISTS (SELECT 1 FROM events u
                  WHERE u.type = 'unsubscribe' AND u.id = ANY(im.resulting_event_ids))
           AS auto_unsubscribed
  FROM incoming_messages im
  JOIN enrollments e ON e.id = im.matched_enrollment_id
  JOIN leads l ON l.id = e.lead_id
  LEFT JOIN events hr
    ON hr.type = 'human_reply'
   AND (hr.attributes->>'incoming_message_id')::bigint = im.id`;

interface RawUniboxRow {
  incoming_message_id: number;
  received_at: string | null;
  snippet: string | null;
  body_text: string | null;
  suggested_sentiment: string | null;
  enrollment_id: number;
  campaign_id: number;
  lead_id: number;
  meeting_booked: boolean;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_company: string | null;
  lead_email: string;
  reply_event_id: number | null;
  step_no: number | null;
  effective_sentiment: string | null;
  auto_unsubscribed: boolean;
  total?: number;
}

function toUniboxRow(r: RawUniboxRow): UniboxRow {
  return {
    incomingMessageId: r.incoming_message_id,
    receivedAt: r.received_at,
    snippet: r.snippet,
    bodyText: r.body_text,
    suggestedSentiment: r.suggested_sentiment,
    enrollmentId: r.enrollment_id,
    campaignId: r.campaign_id,
    stepNo: r.step_no,
    leadId: r.lead_id,
    leadFirstName: r.lead_first_name,
    leadLastName: r.lead_last_name,
    leadCompany: r.lead_company,
    leadEmail: r.lead_email,
    meetingBooked: r.meeting_booked,
    effectiveSentiment: r.effective_sentiment,
    autoUnsubscribed: r.auto_unsubscribed,
    replyEventId: r.reply_event_id,
  };
}

export async function listUnibox(
  db: DbLike,
  opts: {
    bucket: 'human' | 'auto_reply';
    sentiment?: string;
    mailboxId?: number;
    unhandled?: boolean;
    page: number;
    perPage: number;
  },
): Promise<{ items: UniboxRow[]; total: number }> {
  const classification = opts.bucket === 'human' ? 'human_reply' : 'auto_reply';
  const filters = [sql`im.classification = ${classification}`];
  if (opts.mailboxId !== undefined) filters.push(sql`im.mailbox_id = ${opts.mailboxId}`);
  // sentiment/unhandled filter on the COMPUTED effective sentiment → wrap
  const wrapped = sql`
    WITH u AS (${uniboxSelect} WHERE ${sql.join(filters, sql` AND `)})
    SELECT *, count(*) over()::int AS total FROM u
    ${
      opts.sentiment !== undefined
        ? sql`WHERE u.effective_sentiment = ${opts.sentiment}`
        : opts.unhandled === true
          ? sql`WHERE u.effective_sentiment IS NULL`
          : sql``
    }
    ORDER BY u.received_at DESC NULLS LAST, u.incoming_message_id DESC
    LIMIT ${opts.perPage} OFFSET ${(opts.page - 1) * opts.perPage}`;
  const res = await db.execute(wrapped);
  const rows = res.rows as unknown as RawUniboxRow[];
  return { items: rows.map(toUniboxRow), total: rows[0]?.total ?? 0 };
}

export async function getUniboxRow(db: DbLike, id: number): Promise<UniboxRow | null> {
  const res = await db.execute(sql`${uniboxSelect} WHERE im.id = ${id}`);
  const rows = res.rows as unknown as RawUniboxRow[];
  return rows[0] ? toUniboxRow(rows[0]) : null;
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
