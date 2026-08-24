import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DbLike } from '../client';
import { manualCampaignDrafts } from '../schema';

export type ManualDraftRow = typeof manualCampaignDrafts.$inferSelect;

export async function getManualDraft(db: DbLike, id: number): Promise<ManualDraftRow | undefined> {
  return (await db.select().from(manualCampaignDrafts).where(eq(manualCampaignDrafts.id, id)))[0];
}

export async function getUnsentManualDraft(
  db: DbLike,
  leadId: number,
  campaignId: number,
  stepNo = 1,
): Promise<ManualDraftRow | undefined> {
  return (
    await db
      .select()
      .from(manualCampaignDrafts)
      .where(
        and(
          eq(manualCampaignDrafts.leadId, leadId),
          eq(manualCampaignDrafts.campaignId, campaignId),
          eq(manualCampaignDrafts.stepNo, stepNo),
          ne(manualCampaignDrafts.status, 'sent'),
        ),
      )
  )[0];
}

export async function unsentManualDraftLeadIds(
  db: DbLike,
  campaignId: number,
  leadIds: readonly number[],
): Promise<Set<number>> {
  if (leadIds.length === 0) return new Set();
  const rows = await db
    .select({ leadId: manualCampaignDrafts.leadId })
    .from(manualCampaignDrafts)
    .where(
      and(
        eq(manualCampaignDrafts.campaignId, campaignId),
        inArray(manualCampaignDrafts.leadId, [...new Set(leadIds)]),
        ne(manualCampaignDrafts.status, 'sent'),
      ),
    );
  return new Set(rows.map((row) => row.leadId));
}

export async function createOrReplaceManualDraft(
  db: DbLike,
  input: {
    leadId: number;
    campaignId: number;
    sourceImportId: number;
    subject: string;
    body: string;
    replace: boolean;
  },
): Promise<'created' | 'replaced' | 'skipped'> {
  const existing = await getUnsentManualDraft(db, input.leadId, input.campaignId, 1);
  if (existing && !input.replace) return 'skipped';
  if (existing) {
    await db
      .update(manualCampaignDrafts)
      .set({
        subject: input.subject,
        body: input.body,
        sourceImportId: input.sourceImportId,
        status: 'needs_review',
        updatedAt: new Date(),
      })
      .where(eq(manualCampaignDrafts.id, existing.id));
    return 'replaced';
  }
  await db.insert(manualCampaignDrafts).values({
    leadId: input.leadId,
    campaignId: input.campaignId,
    sourceImportId: input.sourceImportId,
    stepNo: 1,
    subject: input.subject,
    body: input.body,
  });
  return 'created';
}

export async function patchManualDraft(
  db: DbLike,
  id: number,
  patch: { subject?: string; body?: string; status?: 'needs_review' | 'ready' },
): Promise<ManualDraftRow | undefined> {
  return (
    await db
      .update(manualCampaignDrafts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(manualCampaignDrafts.id, id), ne(manualCampaignDrafts.status, 'sent')))
      .returning()
  )[0];
}

export async function markManualDraftSent(
  db: DbLike,
  id: number,
  messageId: string,
  sentEventId: number | null,
  at: Date,
): Promise<void> {
  await db
    .update(manualCampaignDrafts)
    .set({
      status: 'sent',
      sentMessageId: messageId,
      sentEventId,
      sentAt: at,
      updatedAt: at,
    })
    .where(eq(manualCampaignDrafts.id, id));
}
