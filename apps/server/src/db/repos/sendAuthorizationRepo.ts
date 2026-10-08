import { sql } from 'drizzle-orm';
import type { DbLike } from '../client';
export async function lockSendingCampaign(db: DbLike, campaignId: number): Promise<void> {
  await db.execute(sql`SELECT id FROM campaigns WHERE id=${campaignId} FOR SHARE`);
}

/** Campaign SHARE lock serializes status edits with the final SMTP decision. Lead lock is held by EventStore. */
export async function sendAuthorized(
  db: DbLike,
  leadId: number,
  campaignId: number,
): Promise<boolean> {
  const result = await db.execute(sql`SELECT c.status,l.is_suppressed,l.is_erased,
    EXISTS(SELECT 1 FROM suppressions s WHERE s.email=l.email) AS address_suppressed
    FROM campaigns c JOIN leads l ON l.id=${leadId} WHERE c.id=${campaignId} FOR SHARE OF c,l`);
  const row = result.rows[0] as
    | { status: string; is_suppressed: boolean; is_erased: boolean; address_suppressed: boolean }
    | undefined;
  return (
    !!row &&
    row.status === 'active' &&
    !row.is_suppressed &&
    !row.is_erased &&
    !row.address_suppressed
  );
}
