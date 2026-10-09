import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import type { IncomingMessage } from '../../transport/types';
import { candidateEvidence } from '../../poller/possibleReply';
import type { ReplyCandidate } from '@coldemail/shared';

const source = sql`SELECT e.id AS enrollment_id,l.id AS lead_id,e.campaign_id,l.email,
  concat_ws(' ',l.first_name,l.last_name) AS name,l.company,c.name AS campaign_name,c.status AS campaign_status,
  e.delayed_until,sm.message_id AS sent_message_id,sm.sent_at,sm.rendered_subject,
  CASE WHEN l.is_suppressed OR EXISTS(SELECT 1 FROM suppressions s WHERE s.email=l.email) THEN 'suppressed'
  WHEN e.current_state='BOUNCED' THEN 'bounced' WHEN e.current_state='COMPLETED' THEN 'completed'
  WHEN e.current_state IN('STOPPED','REPLIED','UNSUBSCRIBED') THEN 'stopped'
  WHEN cardinality(e.review_hold_ids)>0 THEN 'held' WHEN e.delayed_until>now() THEN 'delayed' ELSE 'running' END AS sending_state
  FROM sent_messages sm JOIN enrollments e ON e.id=sm.enrollment_id
  JOIN leads l ON l.id=e.lead_id JOIN campaigns c ON c.id=e.campaign_id`;
type Source = Omit<ReplyCandidate, 'subject_match' | 'company_match'> & {
  rendered_subject: string | null;
};
const dates = (r: Source): Source => ({
  ...r,
  sent_at: new Date(r.sent_at).toISOString(),
  delayed_until: r.delayed_until ? new Date(r.delayed_until).toISOString() : null,
});
export async function findReplyCandidates(
  db: DbLike,
  m: Pick<IncomingMessage, 'mailboxId' | 'from' | 'subject' | 'receivedAt'>,
): Promise<ReplyCandidate[]> {
  const rows = (
    await db.execute(sql`${source} WHERE NOT l.is_erased AND sm.mailbox_id=${m.mailboxId}
    AND sm.sent_at<=${m.receivedAt} AND sm.sent_at>=${new Date(m.receivedAt.getTime() - 30 * 86400000)} ORDER BY sm.sent_at DESC,e.id`)
  ).rows as unknown as Source[];
  const candidates = rows
    .map((r) => ({
      ...dates(r),
      ...candidateEvidence(m.from, m.subject, r.email, r.rendered_subject),
    }))
    .filter((r) => r.subject_match || r.company_match)
    .sort(
      (a, b) =>
        Number(b.subject_match) * 2 +
          Number(b.company_match) -
          (Number(a.subject_match) * 2 + Number(a.company_match)) ||
        b.sent_at.localeCompare(a.sent_at) ||
        a.enrollment_id - b.enrollment_id,
    );
  const seen = new Set<number>();
  return candidates
    .filter((r) => {
      if (seen.has(r.enrollment_id)) return false;
      seen.add(r.enrollment_id);
      return true;
    })
    .map(({ rendered_subject: _, ...r }) => r);
}
export async function saveReplyCandidates(db: DbLike, id: number, candidates: ReplyCandidate[]) {
  for (const c of candidates)
    await db.execute(sql`INSERT INTO incoming_reply_candidates(incoming_message_id,enrollment_id,sent_message_id,subject_match,company_match)
    VALUES(${id},${c.enrollment_id},${c.sent_message_id},${c.subject_match},${c.company_match}) ON CONFLICT DO NOTHING`);
}
export async function storedReplyCandidates(db: DbLike, id: number): Promise<ReplyCandidate[]> {
  const rows = (
    await db.execute(sql`${source} JOIN incoming_reply_candidates rc ON rc.sent_message_id=sm.message_id
    AND rc.enrollment_id=e.id WHERE rc.incoming_message_id=${id} AND NOT l.is_erased
    ORDER BY (rc.subject_match::int*2+rc.company_match::int) DESC,sm.sent_at DESC,e.id`)
  ).rows as unknown as Source[];
  // Evidence is immutable at identification; the lead's state above is current.
  const evidence = (
    await db.execute(
      sql`SELECT enrollment_id,subject_match,company_match FROM incoming_reply_candidates WHERE incoming_message_id=${id}`,
    )
  ).rows as unknown as { enrollment_id: number; subject_match: boolean; company_match: boolean }[];
  return rows.map((r) => {
    const e = evidence.find((e) => e.enrollment_id === r.enrollment_id)!;
    const { rendered_subject: _, ...c } = dates(r);
    return { ...c, subject_match: e.subject_match, company_match: e.company_match };
  });
}
export async function possibleMessageIds(
  db: DbLike,
  opts: { mailbox_id?: number; campaign_id?: number; view?: string } = {},
) {
  const acknowledged = sql`im.linking_status='unrelated' AND (SELECT a.kind FROM incoming_message_activity a WHERE a.incoming_message_id=im.id AND a.kind IN('acknowledged','returned','undo_acknowledgement') ORDER BY a.id DESC LIMIT 1)='acknowledged'`;
  return (
    await db.execute(sql`SELECT DISTINCT im.id FROM incoming_messages im JOIN incoming_reply_candidates rc ON rc.incoming_message_id=im.id
    JOIN enrollments e ON e.id=rc.enrollment_id JOIN leads l ON l.id=e.lead_id AND NOT l.is_erased
    WHERE im.canonical_id IS NULL AND im.linking_status IN('needs_linking','unrelated') AND im.classification<>'bounce'
    ${opts.campaign_id ? sql`AND e.campaign_id=${opts.campaign_id}` : sql``}
    ${opts.view === 'acknowledged' ? sql`AND COALESCE((${acknowledged}),false)` : opts.view === 'needs_review' ? sql`AND NOT COALESCE((${acknowledged}),false)` : sql``}
    ${opts.mailbox_id ? sql`AND (im.mailbox_id=${opts.mailbox_id} OR EXISTS(SELECT 1 FROM incoming_message_locations loc WHERE loc.incoming_message_id=im.id AND loc.mailbox_id=${opts.mailbox_id}))` : sql``}
    ORDER BY im.id`)
  ).rows as { id: number }[];
}
export async function candidateScanMessages(db: DbLike, now: Date, ids?: number[]) {
  return (
    await db.execute(sql`SELECT id,mailbox_id,from_address,subject,received_at FROM incoming_messages
    WHERE canonical_id IS NULL AND linking_status='needs_linking' AND classification<>'bounce'
    AND from_address IS NOT NULL AND received_at IS NOT NULL
    AND received_at>=${new Date(now.getTime() - 30 * 86400000)} AND received_at<=${now}
    ${ids ? sql`AND id=ANY(${sql.param(ids)}::bigint[])` : sql``} ORDER BY id`)
  ).rows as unknown as {
    id: number;
    mailbox_id: number;
    from_address: string;
    subject: string;
    received_at: Date;
  }[];
}
export async function mailboxFreshness(db: DbLike, now: Date) {
  const rows = (
    await db.execute(
      sql`SELECT id,display_name AS name,status,last_successful_poll_at AS checked FROM mailboxes ORDER BY id`,
    )
  ).rows as unknown as { id: number; name: string; status: string; checked: Date | null }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    last_checked_at: r.checked ? new Date(r.checked).toISOString() : null,
    stale: !r.checked || now.getTime() - new Date(r.checked).getTime() > 600000,
  }));
}
