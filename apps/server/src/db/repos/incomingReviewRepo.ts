import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import type { IncomingMessage } from '../../transport/types';
import type { IncomingReviewMessage, IncomingReviewRow } from '@coldemail/shared';

export interface ReviewTarget {
  id: number;
  lead_id: number;
  campaign_id: number;
  current_state: string;
  sent: boolean;
}
export interface MatchEvidence {
  leadId: number | null;
  primary: number | null;
  step: number | null;
  method: string;
  targets: ReviewTarget[];
  confidentSender: boolean;
}
export async function matchIncoming(db: DbLike, m: IncomingMessage): Promise<MatchEvidence> {
  const refs = [
    ...new Set(
      [m.inReplyTo, ...(m.references ?? []).slice().reverse()].filter((r): r is string => !!r),
    ),
  ];
  const hits = refs.length
    ? ((
        await db.execute(sql`SELECT sm.enrollment_id,sm.lead_id,sm.step_no,sm.message_id,l.email
    FROM sent_messages sm JOIN leads l ON l.id=sm.lead_id WHERE sm.message_id=ANY(${sql.param(refs)}::text[]) AND sm.sent_at<=${m.receivedAt} AND NOT l.is_erased`)
      ).rows as {
        enrollment_id: number;
        lead_id: number;
        step_no: number;
        message_id: string;
        email: string;
      }[])
    : [];
  if (new Set(hits.map((h) => h.enrollment_id)).size > 1)
    return {
      leadId: null,
      primary: null,
      step: null,
      method: 'conflicting_references',
      targets: [],
      confidentSender: false,
    };
  const hit = refs.map((ref) => hits.find((h) => h.message_id === ref)).find(Boolean);
  const exact = (
    await db.execute(sql`SELECT l.id FROM leads l WHERE l.email=${m.from.trim().toLowerCase()} AND NOT l.is_erased
    AND EXISTS(SELECT 1 FROM sent_messages sm WHERE sm.lead_id=l.id AND sm.sent_at<=${m.receivedAt})`)
  ).rows[0] as { id: number } | undefined;
  if (hit && exact && hit.lead_id !== exact.id)
    return {
      leadId: null,
      primary: null,
      step: null,
      method: 'conflicting_sender',
      targets: [],
      confidentSender: false,
    };
  const leadId = hit?.lead_id ?? exact?.id ?? null;
  if (!leadId)
    return {
      leadId: null,
      primary: null,
      step: null,
      method: 'unmatched',
      targets: [],
      confidentSender: false,
    };
  const all = (
    await db.execute(sql`SELECT e.id,e.lead_id,e.campaign_id,e.current_state,
    EXISTS(SELECT 1 FROM sent_messages sm WHERE sm.enrollment_id=e.id AND sm.sent_at<=${m.receivedAt}) AS sent
    FROM enrollments e WHERE e.lead_id=${leadId} ORDER BY e.id`)
  ).rows as unknown as ReviewTarget[];
  const contacted = all.filter((e) => e.sent);
  const primary = hit?.enrollment_id ?? (contacted.length === 1 ? contacted[0]!.id : null);
  return {
    leadId,
    primary,
    step: hit?.step_no ?? null,
    method: hit ? 'references' : 'exact_address',
    targets: all.filter(
      (e) => e.sent || ['NEW', 'ACTIVE'].includes(e.current_state) || e.id === primary,
    ),
    confidentSender: hit ? hit.email === m.from.trim().toLowerCase() : true,
  };
}

/** Message identity lock precedes sorted lead/enrollment locks; all duplicate deliveries share it. */
export async function lockIncoming(db: DbLike, key: string): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(5, hashtext(${key}))`);
}
export async function seenLocation(db: DbLike, m: IncomingMessage): Promise<boolean> {
  return (
    (
      await db.execute(sql`SELECT 1 FROM incoming_message_locations WHERE mailbox_id=${m.mailboxId} AND folder=${m.folder}
    AND uid_validity=${m.uidValidity ?? 'mock'} AND imap_uid=${m.uid}`)
    ).rows.length > 0
  );
}
export async function recordLocation(db: DbLike, m: IncomingMessage, id: number): Promise<void> {
  await db.execute(sql`INSERT INTO incoming_message_locations(mailbox_id,folder,uid_validity,imap_uid,incoming_message_id)
    VALUES(${m.mailboxId},${m.folder},${m.uidValidity ?? 'mock'},${m.uid},${id}) ON CONFLICT DO NOTHING`);
}
export async function saveContent(
  db: DbLike,
  id: number,
  m: IncomingMessage,
  newText: string,
  quoted: string,
): Promise<void> {
  const status = m.contentStatus ?? 'captured';
  await db.execute(sql`INSERT INTO incoming_message_content(incoming_message_id,body_text,body_html,new_text,quoted_text,snippet,capture_status)
    SELECT ${id},${status === 'captured' ? m.bodyText : null},${status === 'captured' ? (m.bodyHtml ?? null) : null},${status === 'captured' ? newText : null},${status === 'captured' ? quoted : null},${status === 'captured' ? newText.slice(0, 300) : null},${status}
    WHERE NOT EXISTS(SELECT 1 FROM incoming_messages WHERE id=${id} AND content_deleted_at IS NOT NULL)
    ON CONFLICT(incoming_message_id) DO NOTHING`);
}
export async function replaceRecoveredContent(
  db: DbLike,
  id: number,
  m: IncomingMessage,
  newText: string,
  quoted: string,
): Promise<void> {
  await db.execute(sql`INSERT INTO incoming_message_content(incoming_message_id,body_text,body_html,new_text,quoted_text,snippet,capture_status)
    VALUES(${id},${m.bodyText},${m.bodyHtml ?? null},${newText},${quoted},${newText.slice(0, 300)},'captured')
    ON CONFLICT(incoming_message_id) DO UPDATE SET body_text=excluded.body_text,body_html=excluded.body_html,new_text=excluded.new_text,quoted_text=excluded.quoted_text,snippet=excluded.snippet,capture_status='captured'`);
  await bumpMessage(db, id);
}
export async function linkTarget(
  db: DbLike,
  messageId: number,
  leadId: number,
  campaignId: number,
  enrollmentId: number | null,
  method: string,
): Promise<void> {
  await db.execute(sql`INSERT INTO incoming_message_links(incoming_message_id,lead_id,campaign_id,enrollment_id,matching_method)
    VALUES(${messageId},${leadId},${campaignId},${enrollmentId},${method}) ON CONFLICT(incoming_message_id,lead_id,campaign_id) DO UPDATE
    SET enrollment_id=excluded.enrollment_id,matching_method=excluded.matching_method,acknowledged_at=NULL`);
}
export async function activity(
  db: DbLike,
  id: number | null,
  operation: string,
  kind: string,
  now: Date,
  attrs: Record<string, unknown> = {},
  enrollmentId: number | null = null,
): Promise<void> {
  await db.execute(sql`INSERT INTO incoming_message_activity(incoming_message_id,operation_id,kind,enrollment_id,attributes,occurred_at)
    VALUES(${id},${operation},${kind},${enrollmentId},${JSON.stringify(attrs)}::jsonb,${now}) ON CONFLICT DO NOTHING`);
}
export async function operationExists(db: DbLike, operation: string): Promise<boolean> {
  return (
    (
      await db.execute(
        sql`SELECT 1 FROM incoming_message_activity WHERE operation_id=${operation} LIMIT 1`,
      )
    ).rows.length > 0
  );
}
export async function updateMessage(
  db: DbLike,
  id: number,
  primary: number | null,
  linkingStatus: string,
): Promise<void> {
  await db.execute(sql`UPDATE incoming_messages SET primary_enrollment_id=${primary},linking_status=${linkingStatus},review_revision=review_revision+1,
    relationship=CASE WHEN ${linkingStatus}='linked' THEN CASE WHEN matched_enrollment_id=${primary} AND relationship='in_thread' THEN 'in_thread' ELSE 'separate' END ELSE relationship END WHERE id=${id}`);
}
export async function setResultingEvents(
  db: DbLike,
  id: number,
  eventIds: number[],
): Promise<void> {
  await db.execute(
    sql`UPDATE incoming_messages SET resulting_event_ids=${sql.param(eventIds)}::bigint[] WHERE id=${id}`,
  );
}

const iso = (value: unknown): string | null =>
  value ? new Date(String(value)).toISOString() : null;
export async function readMessage(
  db: DbLike,
  id: number,
  campaignId?: number,
  leadId?: number,
  includeContent = true,
): Promise<IncomingReviewMessage | null> {
  const body = includeContent
    ? sql`c.body_text AS content_text,c.body_html,c.new_text,c.quoted_text`
    : sql`NULL::text AS content_text,NULL::text AS body_html,NULL::text AS new_text,NULL::text AS quoted_text`;
  const r = (
    await db.execute(sql`SELECT im.*,${body},c.snippet AS content_snippet,
    c.capture_status FROM incoming_messages im LEFT JOIN incoming_message_content c ON c.incoming_message_id=im.id
    WHERE im.id=${id} AND im.canonical_id IS NULL`)
  ).rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const links = (
    await db.execute(sql`SELECT lead_id,campaign_id,enrollment_id,matching_method,acknowledged_at
    FROM incoming_message_links WHERE incoming_message_id=${id} ORDER BY campaign_id`)
  ).rows as unknown as (IncomingReviewMessage['links'][number] & { acknowledged_at: unknown })[];
  const history = (
    await db.execute(
      sql`SELECT id,kind,occurred_at,attributes FROM incoming_message_activity WHERE incoming_message_id=${id} ORDER BY id`,
    )
  ).rows as Record<string, unknown>[];
  const authorship = history.filter((h) => h.kind === 'authorship').at(-1)?.attributes as
    | {
        authorship?: IncomingReviewMessage['authorship'];
        sentiment?: IncomingReviewMessage['sentiment'];
      }
    | undefined;
  const deleted = !!r.content_deleted_at;
  const covered = campaignId
    ? links.filter((l) => l.campaign_id === campaignId && (!leadId || l.lead_id === leadId))
    : links;
  return {
    id: Number(r.id),
    from_address: r.from_address as string | null,
    subject: r.subject as string | null,
    received_at: iso(r.received_at),
    automation: r.automation as IncomingReviewMessage['automation'],
    relationship: r.relationship as IncomingReviewMessage['relationship'],
    authorship: authorship?.authorship ?? 'unsure',
    sentiment: authorship?.authorship === 'human' ? (authorship.sentiment ?? null) : null,
    policy_version: String(r.policy_version),
    revision: Number(r.review_revision),
    linking_status: String(r.linking_status),
    primary_enrollment_id: r.primary_enrollment_id as number | null,
    body_text: deleted ? null : ((r.content_text ?? null) as string | null),
    body_html: deleted ? null : ((r.body_html ?? null) as string | null),
    new_text: deleted ? null : ((r.new_text ?? null) as string | null),
    quoted_text: deleted ? null : ((r.quoted_text ?? null) as string | null),
    snippet: deleted ? null : ((r.content_snippet ?? null) as string | null),
    capture_status: deleted
      ? 'deleted'
      : ((r.capture_status ?? 'legacy_preview') as IncomingReviewMessage['capture_status']),
    acknowledged:
      covered.length > 0
        ? covered.every((l) => !!l.acknowledged_at)
        : r.linking_status === 'unrelated' &&
          history
            .filter((h) =>
              ['acknowledged', 'returned', 'undo_acknowledgement'].includes(String(h.kind)),
            )
            .at(-1)?.kind === 'acknowledged',
    links: links.map(({ acknowledged_at: _, ...l }) => l),
    history: history.map((h) => ({
      id: Number(h.id),
      kind: String(h.kind),
      occurred_at: iso(h.occurred_at)!,
      attributes: h.attributes as Record<string, unknown>,
    })),
  };
}

const poolHolds = sql`ARRAY(SELECT h.id FROM events h WHERE h.lead_id=l.id AND h.campaign_id=k.campaign_id
  AND h.enrollment_id IS NULL AND h.type='incoming_review_required' AND NOT EXISTS(SELECT 1 FROM events d
    WHERE d.lead_id=l.id AND d.type='outreach_review_decided' AND d.attributes->'hold_event_ids' @> jsonb_build_array(h.id)) ORDER BY h.id)`;
const rowSelect = (now: Date) => sql`SELECT l.id AS lead_id,e.id AS enrollment_id,k.campaign_id,
  trim(concat_ws(' ',l.first_name,l.last_name)) AS name,l.email,l.company,c.name AS campaign_name,c.status AS campaign_status,
  CASE WHEN l.is_suppressed OR EXISTS(SELECT 1 FROM suppressions s WHERE s.email=l.email) THEN 'suppressed'
    WHEN e.id IS NULL THEN CASE WHEN cardinality(${poolHolds})>0 THEN 'held' ELSE 'not_enrolled' END WHEN e.current_state='BOUNCED' THEN 'bounced'
    WHEN e.current_state='COMPLETED' THEN 'completed' WHEN e.current_state IN('STOPPED','REPLIED','UNSUBSCRIBED') THEN 'stopped'
    WHEN cardinality(e.review_hold_ids)>0 THEN 'held' WHEN e.delayed_until>${now} THEN 'delayed' ELSE 'running' END AS sending_state,
  COALESCE(e.current_state::text,'NOT_ENROLLED') AS lifecycle,e.delayed_until,e.current_step_no AS next_step,e.assigned_mailbox_id,e.next_send_at,e.resume_due_at,
  CASE WHEN e.current_state='STOPPED' AND e.manual_stop_event_id IS NOT NULL THEN 'manual'
    WHEN e.current_state IN('STOPPED','REPLIED') THEN 'legacy' ELSE NULL END AS stop_origin,
  COALESCE((SELECT max(p.id) FROM events p WHERE p.enrollment_id=e.id),
    (SELECT max(p.id) FROM events p WHERE p.lead_id=l.id AND p.campaign_id=k.campaign_id AND p.enrollment_id IS NULL AND p.type IN('incoming_review_required','outreach_review_decided')),0) AS revision,COALESCE(e.review_hold_ids,${poolHolds}) AS hold_ids,
  count(*)::int AS message_count,count(*) FILTER(WHERE k.acknowledged_at IS NULL)::int AS unacknowledged_count,max(im.received_at) AS latest_received_at
  FROM incoming_message_links k JOIN incoming_messages im ON im.id=k.incoming_message_id AND im.canonical_id IS NULL
  JOIN leads l ON l.id=k.lead_id AND NOT l.is_erased JOIN campaigns c ON c.id=k.campaign_id
  LEFT JOIN enrollments e ON e.id=k.enrollment_id`;
export async function listRows(
  db: DbLike,
  opts: {
    lead_id?: number;
    campaign_id?: number;
    search?: string;
    view: string;
    mailbox_id?: number;
    sending_state?: string;
    page: number;
    per_page: number;
    now?: Date;
  },
): Promise<{ items: IncomingReviewRow[]; total: number }> {
  const filters = [sql`true`];
  if (opts.lead_id) filters.push(sql`k.lead_id=${opts.lead_id}`);
  if (opts.campaign_id) filters.push(sql`k.campaign_id=${opts.campaign_id}`);
  if (opts.mailbox_id)
    filters.push(
      sql`EXISTS(SELECT 1 FROM incoming_message_locations loc WHERE loc.incoming_message_id=im.id AND loc.mailbox_id=${opts.mailbox_id}) OR im.mailbox_id=${opts.mailbox_id}`,
    );
  if (opts.search)
    filters.push(
      sql`concat_ws(' ',l.first_name,l.last_name,l.email,l.company) ILIKE ${'%' + opts.search.replace(/[%_\\]/g, '\\$&') + '%'}`,
    );
  const views = [sql`true`];
  if (opts.view === 'needs_review') views.push(sql`unacknowledged_count>0`);
  if (opts.view === 'acknowledged') views.push(sql`unacknowledged_count=0`);
  if (opts.sending_state) views.push(sql`sending_state=${opts.sending_state}`);
  const res =
    await db.execute(sql`WITH rows AS (${rowSelect(opts.now ?? new Date())} WHERE ${sql.join(
      filters.map((f) => sql`(${f})`),
      sql` AND `,
    )}
    GROUP BY l.id,e.id,k.campaign_id,c.id) SELECT *,count(*) OVER()::int AS total FROM rows WHERE ${sql.join(views, sql` AND `)}
    ORDER BY latest_received_at DESC NULLS LAST,lead_id,campaign_id LIMIT ${opts.per_page} OFFSET ${(opts.page - 1) * opts.per_page}`);
  const rows = res.rows as Record<string, unknown>[];
  return {
    items: rows.map(
      ({ total: _, ...r }) =>
        ({
          ...r,
          hold_ids: (r.hold_ids as unknown[]).map(Number),
          delayed_until: iso(r.delayed_until),
          next_send_at: iso(r.next_send_at),
          resume_due_at: iso(r.resume_due_at),
          latest_received_at: iso(r.latest_received_at),
          revision: Number(r.revision),
        }) as unknown as IncomingReviewRow,
    ),
    total: Number(rows[0]?.total ?? 0),
  };
}
export async function messageIdsForRow(
  db: DbLike,
  leadId: number,
  campaignId: number,
): Promise<number[]> {
  return (
    await db.execute(sql`SELECT k.incoming_message_id AS id FROM incoming_message_links k JOIN incoming_messages im ON im.id=k.incoming_message_id
    WHERE k.lead_id=${leadId} AND k.campaign_id=${campaignId} AND im.canonical_id IS NULL ORDER BY im.received_at DESC NULLS LAST,im.id DESC`)
  ).rows.map((r) => Number(r.id));
}
export async function messageIdsForLead(db: DbLike, leadId: number): Promise<number[]> {
  return (
    await db.execute(
      sql`SELECT DISTINCT incoming_message_id AS id FROM incoming_message_links WHERE lead_id=${leadId}`,
    )
  ).rows.map((r) => Number(r.id));
}
export async function rowHistory(
  db: DbLike,
  enrollmentId: number,
): Promise<IncomingReviewMessage['history']> {
  const rows = (
    await db.execute(sql`SELECT id,type::text AS kind,occurred_at,attributes || CASE WHEN reason IS NOT NULL THEN jsonb_build_object('reason',reason) ELSE '{}'::jsonb END AS attributes FROM events WHERE enrollment_id=${enrollmentId}
    AND type IN('incoming_review_required','outreach_review_decided','sequence_stopped','sequence_restored','outreach_stopped','human_reply','unsubscribe','address_suppressed') ORDER BY id DESC`)
  ).rows;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    occurred_at: iso(r.occurred_at)!,
    attributes: r.attributes as Record<string, unknown>,
  }));
}
export async function needsLinking(
  db: DbLike,
  page: number,
  perPage: number,
  view = 'needs_review',
): Promise<{ items: IncomingReviewMessage[]; total: number }> {
  const acknowledged = sql`linking_status='unrelated' AND (SELECT a.kind FROM incoming_message_activity a WHERE a.incoming_message_id=incoming_messages.id AND a.kind IN('acknowledged','returned','undo_acknowledgement') ORDER BY a.id DESC LIMIT 1)='acknowledged'`;
  const rows = (
    await db.execute(sql`SELECT id,count(*) OVER()::int AS total FROM incoming_messages
    WHERE canonical_id IS NULL AND linking_status IN('needs_linking','unrelated') AND classification<>'bounce'
    ${view === 'all' ? sql`` : view === 'acknowledged' ? sql`AND (${acknowledged})` : sql`AND NOT COALESCE((${acknowledged}),false)`}
    ORDER BY received_at DESC NULLS LAST,id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`)
  ).rows as { id: number; total: number }[];
  return {
    items: (
      await Promise.all(rows.map((r) => readMessage(db, r.id, undefined, undefined, false)))
    ).filter((m): m is IncomingReviewMessage => !!m),
    total: rows[0]?.total ?? 0,
  };
}

export async function bumpMessage(db: DbLike, id: number): Promise<void> {
  await db.execute(
    sql`UPDATE incoming_messages SET review_revision=review_revision+1 WHERE id=${id}`,
  );
}
export async function lockMessage(db: DbLike, id: number): Promise<void> {
  await db.execute(sql`SELECT id FROM incoming_messages WHERE id=${id} FOR UPDATE`);
}
export async function unlinkMessage(db: DbLike, id: number): Promise<void> {
  // Keep the affected queue visible until its accidental hold receives an explicit decision.
  await db.execute(
    sql`UPDATE incoming_message_links SET matching_method='corrected_previous',acknowledged_at=NULL WHERE incoming_message_id=${id}`,
  );
}
export async function setAcknowledged(
  db: DbLike,
  id: number,
  campaignId: number | undefined,
  at: Date | null,
  leadId?: number,
): Promise<void> {
  await db.execute(
    sql`UPDATE incoming_message_links SET acknowledged_at=${at} WHERE incoming_message_id=${id} ${campaignId ? sql`AND campaign_id=${campaignId}` : sql``} ${leadId ? sql`AND lead_id=${leadId}` : sql``}`,
  );
}
export async function heldLinks(
  db: DbLike,
  id: number,
  campaignId?: number,
  leadId?: number,
): Promise<boolean> {
  return (
    (
      await db.execute(sql`SELECT 1 FROM incoming_message_links k LEFT JOIN enrollments e ON e.id=k.enrollment_id JOIN leads l ON l.id=k.lead_id
    WHERE k.incoming_message_id=${id} ${campaignId ? sql`AND k.campaign_id=${campaignId}` : sql``} ${leadId ? sql`AND k.lead_id=${leadId}` : sql``} AND cardinality(COALESCE(e.review_hold_ids,${poolHolds}))>0
    AND NOT l.is_suppressed AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.email=l.email) LIMIT 1`)
    ).rows.length > 0
  );
}
export async function sentContext(
  db: DbLike,
  enrollmentId: number,
): Promise<
  {
    message_id: string;
    step_no: number;
    sent_at: string;
    subject: string | null;
    body_text: string | null;
    conversation_id: string;
  }[]
> {
  const rows = (
    await db.execute(sql`SELECT sm.message_id,sm.step_no,sm.sent_at,sm.rendered_subject AS subject,sm.rendered_body_text AS body_text,
    COALESCE(sm.conversation_root_id,(SELECT root.message_id FROM sent_messages root JOIN enrollments e ON e.id=root.enrollment_id JOIN campaigns c ON c.id=e.campaign_id
      JOIN sequence_steps st ON st.sequence_id=c.sequence_id AND st.step_no=root.step_no WHERE root.enrollment_id=sm.enrollment_id
      AND root.step_no<=sm.step_no AND NOT st.in_thread ORDER BY root.step_no DESC LIMIT 1),sm.message_id) AS conversation_id
    FROM sent_messages sm WHERE sm.enrollment_id=${enrollmentId} ORDER BY sm.sent_at,sm.message_id`)
  ).rows as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, sent_at: iso(r.sent_at)! })) as ReturnType<
    typeof sentContext
  > extends Promise<infer T>
    ? T
    : never;
}
export async function linkCandidates(
  db: DbLike,
  campaignId: number,
  search: string,
): Promise<
  {
    lead_id: number;
    enrollment_id: number | null;
    name: string;
    email: string;
    company: string | null;
    state: string;
  }[]
> {
  return (
    await db.execute(sql`SELECT DISTINCT l.id AS lead_id,e.id AS enrollment_id,trim(concat_ws(' ',l.first_name,l.last_name)) AS name,l.email,l.company,
    CASE WHEN l.is_suppressed THEN 'Suppressed' WHEN e.id IS NULL THEN 'Not enrolled' WHEN cardinality(e.review_hold_ids)>0 THEN 'Held for review' ELSE e.current_state::text END AS state
    FROM leads l LEFT JOIN enrollments e ON e.lead_id=l.id AND e.campaign_id=${campaignId}
    LEFT JOIN campaign_lead_pool p ON p.lead_id=l.id AND p.campaign_id=${campaignId}
    WHERE NOT l.is_erased AND (e.id IS NOT NULL OR p.id IS NOT NULL)
    AND concat_ws(' ',l.first_name,l.last_name,l.email,l.company) ILIKE ${'%' + search.replace(/[%_\\]/g, '\\$&') + '%'}
    ORDER BY l.email LIMIT 50`)
  ).rows as Awaited<ReturnType<typeof linkCandidates>>;
}

export async function targetsForLead(db: DbLike, leadId: number): Promise<ReviewTarget[]> {
  return (
    await db.execute(
      sql`SELECT id,lead_id,campaign_id,current_state,false AS sent FROM enrollments WHERE lead_id=${leadId} ORDER BY id`,
    )
  ).rows as unknown as ReviewTarget[];
}

export async function deleteMessageContent(db: DbLike, id: number, at: Date): Promise<void> {
  await db.execute(sql`UPDATE incoming_message_content SET body_text=NULL,body_html=NULL,new_text=NULL,quoted_text=NULL,snippet=NULL,capture_status='deleted'
    WHERE incoming_message_id IN(SELECT id FROM incoming_messages WHERE id=${id} OR canonical_id=${id})`);
  await db.execute(sql`UPDATE incoming_messages SET body_text=NULL,snippet=NULL,review_revision=review_revision+CASE WHEN content_deleted_at IS NULL THEN 1 ELSE 0 END,content_deleted_at=COALESCE(content_deleted_at,${at})
    WHERE id=${id} OR canonical_id=${id}`);
}
export async function retentionCandidates(db: DbLike, now: Date): Promise<number[]> {
  return (
    await db.execute(sql`SELECT im.id FROM incoming_messages im JOIN settings s ON s.id=1
    WHERE im.canonical_id IS NULL AND im.content_deleted_at IS NULL AND im.linking_status IN('linked','unrelated') AND s.incoming_content_retention_days IS NOT NULL
    AND EXISTS(SELECT 1 FROM incoming_message_activity a WHERE a.incoming_message_id=im.id AND a.kind='acknowledged')
    AND (im.linking_status<>'unrelated' OR (SELECT a.kind FROM incoming_message_activity a WHERE a.incoming_message_id=im.id AND a.kind IN('acknowledged','returned','undo_acknowledgement') ORDER BY a.id DESC LIMIT 1)='acknowledged')
    AND NOT EXISTS(SELECT 1 FROM incoming_message_links k WHERE k.incoming_message_id=im.id AND (k.acknowledged_at IS NULL OR k.acknowledged_at+ s.incoming_content_retention_days*interval '1 day'>${now}))
    AND NOT EXISTS(SELECT 1 FROM incoming_message_links k JOIN enrollments e ON e.id=k.enrollment_id JOIN leads l ON l.id=k.lead_id
      WHERE k.incoming_message_id=im.id AND NOT l.is_suppressed AND EXISTS(SELECT 1 FROM events held WHERE held.id=ANY(e.review_hold_ids)
        AND (held.type='sequence_restored' OR held.attributes->>'incoming_message_id'=k.incoming_message_id::text)))
    AND NOT EXISTS(SELECT 1 FROM incoming_message_links k JOIN leads l ON l.id=k.lead_id WHERE k.incoming_message_id=im.id AND k.enrollment_id IS NULL
      AND NOT l.is_suppressed AND cardinality(${poolHolds})>0)
    AND COALESCE((SELECT max(a.occurred_at) FROM incoming_message_activity a WHERE a.incoming_message_id=im.id AND a.kind='acknowledged'),'infinity')+
      s.incoming_content_retention_days*interval '1 day'<=${now}
    ORDER BY im.id LIMIT 100`)
  ).rows.map((r) => Number(r.id));
}
export async function setRetention(db: DbLike, days: number | null): Promise<void> {
  await db.execute(sql`UPDATE settings SET incoming_content_retention_days=${days} WHERE id=1`);
}
export async function replayContentDeletion(
  db: DbLike,
  epoch: string,
  id: number,
  messageId: string | null,
  at: Date,
): Promise<void> {
  const matched =
    (
      await db.execute(sql`SELECT im.id FROM incoming_messages im JOIN settings s ON s.id=1 WHERE s.incoming_identity_epoch=${epoch}
    AND im.id=${id} AND im.message_id IS NOT DISTINCT FROM ${messageId}`)
    ).rows.length > 0;
  if (matched) await deleteMessageContent(db, id, at);
}
export async function incomingMessageIdentity(
  db: DbLike,
  id: number,
): Promise<{
  messageId: string | null;
  mailboxId: number;
  from: string | null;
  subject: string | null;
  receivedAt: Date | null;
  locations: { mailboxId: number; folder: string; uidValidity: string; uid: number }[];
} | null> {
  const row = (
    await db.execute(
      sql`SELECT message_id,mailbox_id,from_address,subject,received_at FROM incoming_messages WHERE id=${id}`,
    )
  ).rows[0];
  if (!row) return null;
  const locations = (
    await db.execute(
      sql`SELECT mailbox_id,folder,uid_validity,imap_uid FROM incoming_message_locations WHERE incoming_message_id=${id}`,
    )
  ).rows;
  return {
    messageId: row.message_id as string | null,
    mailboxId: Number(row.mailbox_id),
    from: row.from_address as string | null,
    subject: row.subject as string | null,
    receivedAt: row.received_at ? new Date(String(row.received_at)) : null,
    locations: locations.map((loc) => ({
      mailboxId: Number(loc.mailbox_id),
      folder: String(loc.folder),
      uidValidity: String(loc.uid_validity),
      uid: Number(loc.imap_uid),
    })),
  };
}
