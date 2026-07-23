// Suppression side effects (docs/04 §3). Reason precedence on conflict:
// 'unsubscribed' is never downgraded (compliance-critical), otherwise the
// newest reason wins.
import { eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { leads, suppressions } from '../schema';

export type SuppressionReason = 'unsubscribed' | 'hard_bounce' | 'manual';

/** Which of these normalized emails are suppressed (ingest layer, docs/09 §5.1). */
export async function suppressedAmong(db: DbLike, emails: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 10_000;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const rows = await db
      .select({ email: suppressions.email })
      .from(suppressions)
      .where(inArray(suppressions.email, [...emails.slice(i, i + CHUNK)]));
    for (const r of rows) found.add(r.email);
  }
  return found;
}

/**
 * Decision U: suppression removal — deliberately loud, typed-confirm at the
 * API layer, audit alert emitted by the route. Deletes the suppression row
 * and clears the lead projection flags. Events are NEVER touched (the
 * historical unsubscribe/hard_bounce stays in the log). Returns false if the
 * email wasn't suppressed.
 */
export async function removeSuppression(db: DbLike, email: string, at: Date): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const deleted = await db
    .delete(suppressions)
    .where(eq(suppressions.email, normalized))
    .returning({ email: suppressions.email });
  if (deleted.length === 0) return false;
  await db
    .update(leads)
    .set({ isSuppressed: false, suppressionReason: null, suppressedAt: null, updatedAt: at })
    .where(eq(leads.email, normalized));
  return true;
}

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
