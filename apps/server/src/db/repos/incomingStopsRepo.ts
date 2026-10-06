import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';

export async function contactedStopTargets(db: DbLike, receivedAt: Date) {
  const result = await db.execute(sql`
    SELECT e.id, e.lead_id, e.campaign_id, l.email
    FROM enrollments e JOIN leads l ON l.id=e.lead_id
    WHERE e.current_state IN ('NEW','ACTIVE') AND NOT l.is_erased
      AND EXISTS (SELECT 1 FROM sent_messages sm WHERE sm.lead_id=l.id AND sm.sent_at <= ${receivedAt})
  `);
  return result.rows as Array<{ id: number; lead_id: number; campaign_id: number; email: string }>;
}

export async function threadLeadId(db: DbLike, enrollmentId?: number): Promise<number | undefined> {
  if (enrollmentId === undefined) return undefined;
  const result = await db.execute(sql`SELECT lead_id FROM enrollments WHERE id=${enrollmentId}`);
  return result.rows[0] ? Number(result.rows[0].lead_id) : undefined;
}

export async function liveStopTargets(db: DbLike, enrollmentIds: number[]): Promise<Set<number>> {
  const result = await db.execute(
    sql`SELECT id FROM enrollments WHERE id = ANY(${sql.param(enrollmentIds)}::bigint[]) AND current_state IN ('NEW','ACTIVE')`,
  );
  return new Set(result.rows.map((row) => Number(row.id)));
}
