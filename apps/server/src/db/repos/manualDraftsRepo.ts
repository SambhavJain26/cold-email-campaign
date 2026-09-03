import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import {
  campaignPersonalizedCopies,
  campaigns,
  personalizedCopyBlockers,
  personalizedCopySources,
  sentMessages,
  sequenceSteps,
} from '../schema';
import { contentHashOf } from '../../render/hash';

export type ManualDraftRow = typeof campaignPersonalizedCopies.$inferSelect;
export type PersonalizedCopySourceRow = typeof personalizedCopySources.$inferSelect;
export type PersonalizedCopyBlockerReason =
  'missing' | 'needs_review' | 'invalid_copy' | 'content_conflict';

export async function activePersonalizedCopyBlockerCount(db: DbLike): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n FROM personalized_copy_blockers
  `);
  return Number((result.rows[0] as { n?: number | string } | undefined)?.n ?? 0);
}

export async function getManualDraft(db: DbLike, id: number): Promise<ManualDraftRow | undefined> {
  return (
    await db.select().from(campaignPersonalizedCopies).where(eq(campaignPersonalizedCopies.id, id))
  )[0];
}

export async function listPersonalizedCopiesForLead(db: DbLike, leadId: number) {
  const sources = await db
    .select()
    .from(personalizedCopySources)
    .where(eq(personalizedCopySources.leadId, leadId))
    .orderBy(asc(personalizedCopySources.slotNo));
  const copies = await db
    .select({
      copy: campaignPersonalizedCopies,
      step: sequenceSteps,
      campaign: campaigns,
      sentRenderedSubject: sentMessages.renderedSubject,
    })
    .from(campaignPersonalizedCopies)
    .leftJoin(sequenceSteps, eq(campaignPersonalizedCopies.sequenceStepId, sequenceSteps.id))
    .innerJoin(campaigns, eq(campaignPersonalizedCopies.campaignId, campaigns.id))
    .leftJoin(sentMessages, eq(campaignPersonalizedCopies.sentMessageId, sentMessages.messageId))
    .where(eq(campaignPersonalizedCopies.leadId, leadId))
    .orderBy(asc(campaignPersonalizedCopies.campaignId), asc(campaignPersonalizedCopies.stepNo));
  return { sources, copies };
}

export async function getPersonalizedCopySource(
  db: DbLike,
  leadId: number,
  slotNo = 1,
): Promise<PersonalizedCopySourceRow | undefined> {
  return (
    await db
      .select()
      .from(personalizedCopySources)
      .where(
        and(eq(personalizedCopySources.leadId, leadId), eq(personalizedCopySources.slotNo, slotNo)),
      )
  )[0];
}

export async function personalizedCopySourcesForLeads(
  db: DbLike,
  leadIds: readonly number[],
): Promise<PersonalizedCopySourceRow[]> {
  if (leadIds.length === 0) return [];
  return db
    .select()
    .from(personalizedCopySources)
    .where(inArray(personalizedCopySources.leadId, [...new Set(leadIds)]))
    .orderBy(asc(personalizedCopySources.leadId), asc(personalizedCopySources.slotNo));
}

export async function createOrReplacePersonalizedCopySource(
  db: DbLike,
  input: {
    leadId: number;
    slotNo: number;
    targetStepNo?: number | null;
    sourceImportId: number | null;
    subject: string;
    body: string;
    status: 'needs_review' | 'ready';
    replace: boolean;
    at?: Date;
  },
): Promise<{ result: 'created' | 'replaced' | 'skipped'; source: PersonalizedCopySourceRow }> {
  const existing = await getPersonalizedCopySource(db, input.leadId, input.slotNo);
  if (existing && !input.replace) return { result: 'skipped', source: existing };
  if (existing) {
    const [source] = await db
      .update(personalizedCopySources)
      .set({
        sourceImportId: input.sourceImportId,
        targetStepNo: input.targetStepNo ?? null,
        subject: input.subject,
        body: input.body,
        status: input.status,
        updatedAt: input.at ?? new Date(),
      })
      .where(eq(personalizedCopySources.id, existing.id))
      .returning();
    return { result: 'replaced', source: source! };
  }
  const [source] = await db
    .insert(personalizedCopySources)
    .values({
      leadId: input.leadId,
      slotNo: input.slotNo,
      targetStepNo: input.targetStepNo ?? null,
      sourceImportId: input.sourceImportId,
      subject: input.subject,
      body: input.body,
      status: input.status,
    })
    .returning();
  return { result: 'created', source: source! };
}

export async function getCampaignPersonalizedCopy(
  db: DbLike,
  leadId: number,
  campaignId: number,
  sequenceStepId: number,
): Promise<ManualDraftRow | undefined> {
  return (
    await db
      .select()
      .from(campaignPersonalizedCopies)
      .where(
        and(
          eq(campaignPersonalizedCopies.leadId, leadId),
          eq(campaignPersonalizedCopies.campaignId, campaignId),
          eq(campaignPersonalizedCopies.sequenceStepId, sequenceStepId),
        ),
      )
  )[0];
}

export async function campaignPersonalizedCopyReadiness(
  db: DbLike,
  campaignId: number,
  sequenceStepId: number,
  leadIds: readonly number[],
): Promise<Map<number, PersonalizedCopyBlockerReason | null>> {
  const unique = [...new Set(leadIds)];
  const result = new Map<number, PersonalizedCopyBlockerReason | null>(
    unique.map((leadId) => [leadId, 'missing']),
  );
  if (unique.length === 0) return result;
  const rows = await db
    .select()
    .from(campaignPersonalizedCopies)
    .where(
      and(
        eq(campaignPersonalizedCopies.campaignId, campaignId),
        eq(campaignPersonalizedCopies.sequenceStepId, sequenceStepId),
        inArray(campaignPersonalizedCopies.leadId, unique),
      ),
    );
  for (const copy of rows) {
    result.set(
      copy.leadId,
      copy.status !== 'ready'
        ? 'needs_review'
        : !copy.subject.trim() || !copy.body.trim()
          ? 'invalid_copy'
          : null,
    );
  }
  return result;
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
      .from(campaignPersonalizedCopies)
      .where(
        and(
          eq(campaignPersonalizedCopies.leadId, leadId),
          eq(campaignPersonalizedCopies.campaignId, campaignId),
          eq(campaignPersonalizedCopies.stepNo, stepNo),
          ne(campaignPersonalizedCopies.status, 'sent'),
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
    .select({ leadId: campaignPersonalizedCopies.leadId })
    .from(campaignPersonalizedCopies)
    .where(
      and(
        eq(campaignPersonalizedCopies.campaignId, campaignId),
        inArray(campaignPersonalizedCopies.leadId, [...new Set(leadIds)]),
        ne(campaignPersonalizedCopies.status, 'sent'),
      ),
    );
  return new Set(rows.map((row) => row.leadId));
}

export async function createOrReplaceCampaignPersonalizedCopy(
  db: DbLike,
  input: {
    leadId: number;
    campaignId: number;
    sequenceStepId: number;
    stepNo: number;
    sourceCopyId?: number | null;
    sourceImportId?: number | null;
    subject: string;
    body: string;
    contentHash: string;
    status: 'needs_review' | 'ready';
    replace: boolean;
    at?: Date;
  },
): Promise<'created' | 'replaced' | 'skipped'> {
  const existing = await getCampaignPersonalizedCopy(
    db,
    input.leadId,
    input.campaignId,
    input.sequenceStepId,
  );
  if (existing?.status === 'sent' || (existing && !input.replace)) return 'skipped';
  if (existing) {
    await db
      .update(campaignPersonalizedCopies)
      .set({
        subject: input.subject,
        body: input.body,
        contentHash: input.contentHash,
        sourceCopyId: input.sourceCopyId,
        sourceImportId: input.sourceImportId,
        status: input.status,
        updatedAt: input.at ?? new Date(),
      })
      .where(eq(campaignPersonalizedCopies.id, existing.id));
    return 'replaced';
  }
  await db.insert(campaignPersonalizedCopies).values({
    leadId: input.leadId,
    campaignId: input.campaignId,
    sequenceStepId: input.sequenceStepId,
    stepNo: input.stepNo,
    sourceCopyId: input.sourceCopyId,
    sourceImportId: input.sourceImportId,
    subject: input.subject,
    body: input.body,
    contentHash: input.contentHash,
    status: input.status,
  });
  return 'created';
}

/** Backwards-compatible imported Step-1 wrapper. */
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
  const step = (
    await db.execute(sql`
      SELECT ss.id, ss.step_no
      FROM campaigns c JOIN sequence_steps ss ON ss.sequence_id = c.sequence_id
      WHERE c.id = ${input.campaignId} AND ss.step_no = 1`)
  ).rows[0] as { id: number | string; step_no: number } | undefined;
  if (!step) throw new Error(`campaign ${input.campaignId} has no sequence Step 1`);
  return createOrReplaceCampaignPersonalizedCopy(db, {
    ...input,
    sequenceStepId: Number(step.id),
    stepNo: step.step_no,
    sourceCopyId: null,
    contentHash: contentHashOf(input.subject, input.body),
    status: 'needs_review',
  });
}

export async function patchManualDraft(
  db: DbLike,
  id: number,
  patch: {
    subject?: string;
    body?: string;
    contentHash?: string;
    status?: 'needs_review' | 'ready';
  },
): Promise<ManualDraftRow | undefined> {
  return (
    await db
      .update(campaignPersonalizedCopies)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(campaignPersonalizedCopies.id, id), ne(campaignPersonalizedCopies.status, 'sent')),
      )
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
    .update(campaignPersonalizedCopies)
    .set({
      status: 'sent',
      sentMessageId: messageId,
      sentEventId,
      sentAt: at,
      updatedAt: at,
    })
    .where(eq(campaignPersonalizedCopies.id, id));
}

export async function setPersonalizedCopyBlocker(
  db: DbLike,
  input: {
    enrollmentId: number;
    sequenceStepId: number;
    campaignId: number;
    leadId: number;
    reason: PersonalizedCopyBlockerReason;
    at: Date;
  },
): Promise<boolean> {
  const changed = await db.execute(sql`
    INSERT INTO personalized_copy_blockers
      (enrollment_id, sequence_step_id, campaign_id, lead_id, reason, created_at, updated_at)
    VALUES (${input.enrollmentId}, ${input.sequenceStepId}, ${input.campaignId}, ${input.leadId},
            ${input.reason}, ${input.at}, ${input.at})
    ON CONFLICT (enrollment_id, sequence_step_id) DO UPDATE
      SET reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at
      WHERE personalized_copy_blockers.reason IS DISTINCT FROM EXCLUDED.reason
    RETURNING reason`);
  return changed.rows.length > 0;
}

export async function clearPersonalizedCopyBlocker(
  db: DbLike,
  enrollmentId: number,
  sequenceStepId: number,
): Promise<void> {
  await db
    .delete(personalizedCopyBlockers)
    .where(
      and(
        eq(personalizedCopyBlockers.enrollmentId, enrollmentId),
        eq(personalizedCopyBlockers.sequenceStepId, sequenceStepId),
      ),
    );
}

export async function clearPersonalizedCopyBlockersForLeadStep(
  db: DbLike,
  leadId: number,
  campaignId: number,
  sequenceStepId: number,
): Promise<void> {
  await db
    .delete(personalizedCopyBlockers)
    .where(
      and(
        eq(personalizedCopyBlockers.leadId, leadId),
        eq(personalizedCopyBlockers.campaignId, campaignId),
        eq(personalizedCopyBlockers.sequenceStepId, sequenceStepId),
      ),
    );
}

export interface PersonalizedCopyCoverageRow {
  stepNo: number;
  ready: number;
  needsReview: number;
  missing: number;
  blocked: number;
  total: number;
}

export async function personalizedCopyCoverage(
  db: DbLike,
  campaignId: number,
): Promise<{ steps: PersonalizedCopyCoverageRow[]; blockedCount: number }> {
  const result = await db.execute(sql`
    WITH target_leads AS (
      SELECT DISTINCT e.lead_id
      FROM campaigns c
      JOIN enrollments e ON e.campaign_id = c.id
      WHERE c.id = ${campaignId}
      UNION
      SELECT DISTINCT p.lead_id
      FROM campaigns c
      JOIN campaign_lead_pool p ON p.campaign_id = c.id AND p.status = 'available'
      WHERE c.id = ${campaignId} AND c.lead_selection_mode = 'pool'
    ), personalized_steps AS (
      SELECT ss.id, ss.step_no
      FROM campaigns c
      JOIN sequence_steps ss ON ss.sequence_id = c.sequence_id
      WHERE c.id = ${campaignId} AND ss.content_source = 'personalized'
    )
    SELECT ps.step_no,
           count(tl.lead_id)::int AS total,
           count(cpc.id) FILTER (WHERE cpc.status IN ('ready', 'sent'))::int AS ready,
           count(cpc.id) FILTER (WHERE cpc.status = 'needs_review')::int AS needs_review,
           (count(tl.lead_id) - count(cpc.id))::int AS missing,
           count(DISTINCT pcb.enrollment_id)::int AS blocked
      FROM personalized_steps ps
      LEFT JOIN target_leads tl ON TRUE
      LEFT JOIN campaign_personalized_copies cpc
        ON cpc.campaign_id = ${campaignId}
       AND cpc.sequence_step_id = ps.id
       AND cpc.lead_id = tl.lead_id
      LEFT JOIN personalized_copy_blockers pcb
        ON pcb.campaign_id = ${campaignId} AND pcb.sequence_step_id = ps.id
     GROUP BY ps.id, ps.step_no
     ORDER BY ps.step_no`);
  const steps = (result.rows as unknown as Array<Record<string, number | string>>).map((row) => ({
    stepNo: Number(row.step_no),
    ready: Number(row.ready),
    needsReview: Number(row.needs_review),
    missing: Number(row.missing),
    blocked: Number(row.blocked),
    total: Number(row.total),
  }));
  return { steps, blockedCount: steps.reduce((sum, step) => sum + step.blocked, 0) };
}
