// Suppression side effects (docs/04 §3). Reason precedence on conflict:
// 'unsubscribed' is never downgraded (compliance-critical), otherwise the
// newest reason wins.
import { eq, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { leads, suppressions } from '../schema';

export type SuppressionReason = 'unsubscribed' | 'hard_bounce' | 'manual';

export async function suppressLead(
  db: DbLike,
  leadId: number,
  reason: SuppressionReason,
  at: Date,
): Promise<void> {
  const row = (await db.select({ email: leads.email }).from(leads).where(eq(leads.id, leadId)))[0];
  if (!row) throw new Error(`suppressLead: lead ${leadId} not found`);

  await db
    .insert(suppressions)
    .values({ email: row.email, reason, leadId, createdAt: at })
    .onConflictDoUpdate({
      target: suppressions.email,
      set: {
        reason: sql`CASE WHEN ${suppressions.reason} = 'unsubscribed'
                    THEN ${suppressions.reason} ELSE excluded.reason END`,
      },
    });

  await db
    .update(leads)
    .set({
      isSuppressed: true,
      suppressionReason: sql`CASE WHEN ${leads.suppressionReason} = 'unsubscribed'
                             THEN ${leads.suppressionReason} ELSE ${reason}::suppression_reason END`,
      suppressedAt: sql`COALESCE(${leads.suppressedAt}, ${at})`,
      updatedAt: at,
    })
    .where(eq(leads.id, leadId));
}
