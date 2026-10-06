import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { COPY_UPDATE_STATUSES, type CopyUpdatePreview } from '@coldemail/shared';
import type { Db, DbLike } from '../client';
import { importRows, imports, campaignPersonalizedCopies } from '../schema';
import { getImport } from './importsRepo';
import { getCampaign, lockCampaignForImport } from './campaignsRepo';
import { loadSequenceDef } from './sequencesRepo';
import {
  createOrReplaceCampaignPersonalizedCopy,
  createOrReplacePersonalizedCopySource,
  personalizedCopySourcesForLeads,
  clearPersonalizedCopyBlockersForLeadStep,
} from './manualDraftsRepo';
import { acquireRebuildLockShared, lockEnrollment } from './locksRepo';
import { contentHashOf } from '../../render/hash';
import { AppError } from '../../api/errors';
import type { ParsedRow } from '../../ingest/parse';

type Request = { campaign_id: number; generic_copy_step_no?: number; page?: number };
type Change = {
  leadId: number;
  slotNo: number;
  stepId: number;
  stepNo: number;
  subject: string;
  body: string;
};
type Member = {
  id: number;
  email: string;
  suppressed: boolean;
  erased: boolean;
  enrollment_id: number | null;
  state: string | null;
  step_no: number | null;
  retries: number | null;
};

async function plan(db: DbLike, importId: number, request: Request) {
  const imp = await getImport(db, importId);
  if (!imp) throw AppError.notFound('import');
  if (imp.committed) throw new AppError('conflict', 409, 'Import is already committed');
  const campaign = await getCampaign(db, request.campaign_id);
  if (!campaign || !['draft', 'paused'].includes(campaign.status))
    throw new AppError('conflict', 409, 'Choose a draft or paused campaign for copy updates');
  const sequence = campaign.sequenceId ? await loadSequenceDef(db, campaign.sequenceId) : null;
  if (!sequence) throw new AppError('validation', 422, 'Campaign needs a saved sequence');
  const steps = sequence.steps.filter((step) => step.contentSource === 'personalized');
  if (
    request.generic_copy_step_no !== undefined &&
    !steps.some((step) => step.stepNo === request.generic_copy_step_no)
  )
    throw new AppError('validation', 422, 'Choose a Personalized Copy step');
  const staged = await db
    .select()
    .from(importRows)
    .where(eq(importRows.importId, importId))
    .orderBy(importRows.rowNo);
  const memberResult = await db.execute(sql`
    SELECT l.id,l.email,l.is_suppressed AS suppressed,l.is_erased AS erased,
      e.id AS enrollment_id,e.current_state AS state,e.current_step_no AS step_no,e.soft_bounce_retries AS retries
    FROM leads l LEFT JOIN enrollments e ON e.lead_id=l.id AND e.campaign_id=${campaign.id}
    WHERE e.id IS NOT NULL OR EXISTS (SELECT 1 FROM campaign_lead_pool p WHERE p.lead_id=l.id AND p.campaign_id=${campaign.id} AND p.status='available')
    ORDER BY l.id,e.id
  `);
  const members = memberResult.rows as Member[];
  const byEmail = new Map(members.map((member) => [member.email, member]));
  const copies = await db
    .select()
    .from(campaignPersonalizedCopies)
    .where(eq(campaignPersonalizedCopies.campaignId, campaign.id))
    .orderBy(campaignPersonalizedCopies.id);
  const sources = await personalizedCopySourcesForLeads(
    db,
    members.map((member) => Number(member.id)),
  );
  const sent = await db.execute(
    sql`SELECT sm.lead_id, sm.step_no FROM sent_messages sm JOIN enrollments e ON e.id=sm.enrollment_id WHERE e.campaign_id=${campaign.id} ORDER BY sm.message_id`,
  );
  const sentKeys = new Set(sent.rows.map((row) => `${row.lead_id}:${row.step_no}`));
  const rawConflicts = new Map<string, string>();
  const conflictingEmails = new Set<string>();
  for (const row of staged) {
    if (!row.emailNormalized) continue;
    const raw = row.raw as { copy_slots?: ParsedRow['copySlots']; copy_conflicts?: string[] };
    const copy = JSON.stringify(raw.copy_slots ?? {});
    if (
      raw.copy_conflicts?.length ||
      (rawConflicts.has(row.emailNormalized) && rawConflicts.get(row.emailNormalized) !== copy)
    )
      conflictingEmails.add(row.emailNormalized);
    rawConflicts.set(row.emailNormalized, copy);
  }
  const counts = Object.fromEntries(
    COPY_UPDATE_STATUSES.map((status) => [status, 0]),
  ) as CopyUpdatePreview['counts'];
  const entries: CopyUpdatePreview['entries'] = [];
  const changes: Change[] = [];
  const seen = new Set<string>();
  const add = (
    row: (typeof staged)[number],
    step: number | null,
    status: (typeof COPY_UPDATE_STATUSES)[number],
    reason: string,
  ) => {
    counts[status]++;
    entries.push({ row_no: row.rowNo, email: row.emailNormalized, step_no: step, status, reason });
  };
  for (const row of staged) {
    const email = row.emailNormalized;
    const raw = row.raw as { copy_slots?: ParsedRow['copySlots'] };
    if (!email || row.flag === 'invalid' || conflictingEmails.has(email)) {
      add(row, null, 'invalid', 'Invalid address or conflicting duplicate copy');
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const member = byEmail.get(email);
    if (!member) {
      add(row, null, 'unmatched', 'Not an enrolled or available pooled campaign member');
      continue;
    }
    if (member.suppressed || member.erased || row.flag === 'suppressed') {
      add(row, null, 'suppressed', 'Suppressed or erased lead');
      continue;
    }
    const resolvedCopies = new Map<number, string>();
    for (const [slot, copy] of Object.entries(raw.copy_slots ?? {})) {
      if (!copy.subject && !copy.body) continue;
      const stepNo =
        copy.targetStepNo ??
        request.generic_copy_step_no ??
        (steps.length === 1 ? steps[0]!.stepNo : null);
      if (stepNo === null)
        throw new AppError('validation', 422, 'Choose the destination step for generic copy');
      const step = steps.find((candidate) => candidate.stepNo === stepNo);
      if (!step?.id || !copy.subject || !copy.body) {
        add(
          row,
          stepNo,
          'invalid',
          'A saved personalized step and complete subject/body pair are required',
        );
        continue;
      }
      const resolvedContent = JSON.stringify([copy.subject, copy.body]);
      if (resolvedCopies.has(stepNo)) {
        if (resolvedCopies.get(stepNo) !== resolvedContent)
          add(row, stepNo, 'invalid', 'Conflicting columns map to the same campaign step');
        continue;
      }
      resolvedCopies.set(stepNo, resolvedContent);
      const existing = copies.find(
        (candidate) =>
          Number(candidate.leadId) === Number(member.id) && candidate.sequenceStepId === step.id,
      );
      const isRetry = Number(member.retries) > 0 && Number(member.step_no) === stepNo;
      if (isRetry) {
        add(row, stepNo, 'retry_protected', 'Saved retry payload must be preserved');
        continue;
      }
      if (
        existing?.status === 'sent' ||
        sentKeys.has(`${member.id}:${stepNo}`) ||
        (member.step_no !== null && stepNo < Number(member.step_no))
      ) {
        add(row, stepNo, 'sent_protected', 'This step was already sent');
        continue;
      }
      if (
        existing?.subject === copy.subject &&
        existing.body === copy.body &&
        existing.status === 'ready'
      ) {
        add(row, stepNo, 'unchanged', 'Copy already matches');
        continue;
      }
      add(row, stepNo, 'changed', existing ? 'Replace unsent copy' : 'Create missing unsent copy');
      changes.push({
        leadId: Number(member.id),
        slotNo: Number(slot),
        stepId: step.id,
        stepNo,
        subject: copy.subject,
        body: copy.body,
      });
    }
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        request: {
          campaign_id: request.campaign_id,
          ...(request.generic_copy_step_no !== undefined
            ? { generic_copy_step_no: request.generic_copy_step_no }
            : {}),
        },
        campaign,
        sequence,
        staged,
        members,
        copies,
        sources,
        sent: sent.rows,
      }),
    )
    .digest('hex');
  return {
    preview: {
      campaign_id: campaign.id,
      fingerprint,
      counts,
      entries: entries.slice(((request.page ?? 1) - 1) * 100, (request.page ?? 1) * 100),
      total_entries: entries.length,
    },
    changes,
    members,
  };
}

export async function previewCopyUpdate(db: Db, importId: number, request: Request) {
  return (await plan(db, importId, request)).preview;
}

export async function commitCopyUpdate(
  db: Db,
  importId: number,
  request: Request & { fingerprint: string },
  now: Date,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM imports WHERE id=${importId} FOR UPDATE`);
    const campaign = await lockCampaignForImport(tx, request.campaign_id);
    if (!campaign) throw AppError.notFound('campaign');
    await acquireRebuildLockShared(tx);
    const enrolled = await tx.execute(
      sql`SELECT id FROM enrollments WHERE campaign_id=${campaign.id} ORDER BY id`,
    );
    for (const row of enrolled.rows) await lockEnrollment(tx, Number(row.id));
    // Hold the saved inputs and membership stable through the fingerprint check
    // and replacement. Existing UI copy/suppression edits serialize on these rows.
    await tx.execute(
      sql`SELECT l.id FROM leads l WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.lead_id=l.id AND e.campaign_id=${campaign.id}) OR EXISTS (SELECT 1 FROM campaign_lead_pool p WHERE p.lead_id=l.id AND p.campaign_id=${campaign.id} AND p.status='available') ORDER BY l.id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM campaign_lead_pool WHERE campaign_id=${campaign.id} ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT id FROM campaign_personalized_copies WHERE campaign_id=${campaign.id} ORDER BY id FOR UPDATE`,
    );
    await tx.execute(
      sql`SELECT s.id FROM personalized_copy_sources s WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.lead_id=s.lead_id AND e.campaign_id=${campaign.id}) OR EXISTS (SELECT 1 FROM campaign_lead_pool p WHERE p.lead_id=s.lead_id AND p.campaign_id=${campaign.id} AND p.status='available') ORDER BY s.id FOR UPDATE`,
    );
    if (campaign.sequenceId) {
      await tx.execute(sql`SELECT id FROM sequences WHERE id=${campaign.sequenceId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM sequence_steps WHERE sequence_id=${campaign.sequenceId} ORDER BY id FOR UPDATE`,
      );
    }
    const prepared = await plan(tx, importId, {
      campaign_id: request.campaign_id,
      ...(request.generic_copy_step_no !== undefined
        ? { generic_copy_step_no: request.generic_copy_step_no }
        : {}),
    });
    if (prepared.preview.fingerprint !== request.fingerprint)
      throw new AppError(
        'conflict',
        409,
        'Campaign or saved copy changed; refresh the update preview',
      );
    if (prepared.preview.counts.invalid)
      throw new AppError(
        'validation',
        422,
        'Correct invalid or conflicting CSV rows before updating',
      );
    for (const change of prepared.changes) {
      const source = await createOrReplacePersonalizedCopySource(tx, {
        leadId: change.leadId,
        slotNo: change.slotNo,
        targetStepNo: change.stepNo,
        sourceImportId: importId,
        subject: change.subject,
        body: change.body,
        status: 'ready',
        replace: true,
        at: now,
      });
      await createOrReplaceCampaignPersonalizedCopy(tx, {
        leadId: change.leadId,
        campaignId: campaign.id,
        sequenceStepId: change.stepId,
        stepNo: change.stepNo,
        sourceCopyId: source.source.id,
        sourceImportId: importId,
        subject: change.subject,
        body: change.body,
        contentHash: contentHashOf(change.subject, change.body),
        status: 'ready',
        replace: true,
        at: now,
      });
      await clearPersonalizedCopyBlockersForLeadStep(tx, change.leadId, campaign.id, change.stepId);
    }
    await tx
      .update(imports)
      .set({
        committed: true,
        commitMode: 'update_copy',
        copyUpdate: { campaign_id: campaign.id, counts: prepared.preview.counts },
      })
      .where(and(eq(imports.id, importId), eq(imports.committed, false)));
    return prepared.preview;
  });
}
