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
  /** ISO-8601 UTC string (formatted in SQL — raw execute skips Date mapping). */
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
  enrollmentState: string;
  effectiveSentiment: string | null;
  disposition: string | null;
  recontactAfter: string | null;
  autoUnsubscribed: boolean;
  leadSuppressed: boolean;
  replyEventId: number | null;
}

// NOTE: raw db.execute bypasses drizzle's column mapping — timestamps come
// back as strings — so received_at is ISO-formatted in SQL, deterministically.
const uniboxSelect = sql`
  SELECT im.id AS incoming_message_id,
         to_char(im.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           AS received_at,
         im.snippet, im.body_text,
         im.suggested_sentiment,
         e.id AS enrollment_id, e.campaign_id, e.lead_id, e.meeting_booked, e.current_state AS enrollment_state,
         l.first_name AS lead_first_name, l.last_name AS lead_last_name,
         l.company AS lead_company, l.email AS lead_email,
         l.is_suppressed AS lead_suppressed,
         hr.id AS reply_event_id, hr.step_no,
         COALESCE(
           (SELECT st.sentiment::text FROM events st
             WHERE st.type = 'sentiment_tagged'
               AND (st.attributes->>'reply_event_id')::bigint = hr.id
             ORDER BY st.id DESC LIMIT 1),
           hr.sentiment::text) AS effective_sentiment,
         (SELECT rd.attributes->>'disposition' FROM events rd
            WHERE rd.type = 'reply_dispositioned'
              AND (rd.attributes->>'reply_event_id')::bigint = hr.id
            ORDER BY rd.id DESC LIMIT 1) AS disposition,
         (SELECT rd.attributes->>'recontact_after' FROM events rd
            WHERE rd.type = 'reply_dispositioned'
              AND (rd.attributes->>'reply_event_id')::bigint = hr.id
            ORDER BY rd.id DESC LIMIT 1) AS recontact_after,
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
  enrollment_state: string;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_company: string | null;
  lead_email: string;
  reply_event_id: number | null;
  step_no: number | null;
  effective_sentiment: string | null;
  disposition: string | null;
  recontact_after: string | null;
  auto_unsubscribed: boolean;
  lead_suppressed: boolean;
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
    enrollmentState: r.enrollment_state,
    effectiveSentiment: r.effective_sentiment,
    disposition: r.disposition,
    recontactAfter: r.recontact_after,
    autoUnsubscribed: r.auto_unsubscribed,
    leadSuppressed: r.lead_suppressed,
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
  // Sentiment/disposition filters are computed from append-only events, so wrap.
  const wrapped = sql`
    WITH u AS (${uniboxSelect} WHERE ${sql.join(filters, sql` AND `)})
    SELECT *, count(*) over()::int AS total FROM u
    ${
      opts.sentiment !== undefined
        ? sql`WHERE u.effective_sentiment = ${opts.sentiment}`
        : opts.unhandled === true
          ? sql`WHERE u.disposition IS NULL`
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

/** B6.12 reply-detection debug list — straight off the ledger (decision O). */
export async function listIncoming(
  db: DbLike,
  opts: {
    classification?: IncomingMessageRow['classification'];
    mailboxId?: number;
    page: number;
    perPage: number;
  },
): Promise<{ items: IncomingMessageRow[]; total: number }> {
  const conds = [
    ...(opts.classification !== undefined
      ? [eq(incomingMessages.classification, opts.classification)]
      : []),
    ...(opts.mailboxId !== undefined ? [eq(incomingMessages.mailboxId, opts.mailboxId)] : []),
  ];
  const where = conds.length > 0 ? and(...conds) : undefined;
  const items = await db
    .select()
    .from(incomingMessages)
    .where(where)
    .orderBy(sql`${incomingMessages.processedAt} DESC`, sql`${incomingMessages.id} DESC`)
    .limit(opts.perPage)
    .offset((opts.page - 1) * opts.perPage);
  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(incomingMessages)
    .where(where);
  return { items, total: totals[0]?.n ?? 0 };
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
