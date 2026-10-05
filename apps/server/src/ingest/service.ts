// Import workflow (docs/09 §2–§3): upload → hygiene preview (persisted in
// import_rows so a later commit is exact) → commit in one of two modes.
// `invalid` and `suppressed` rows are NEVER imported under either mode;
// `import_all` only additionally admits `role_based`.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import {
  backfillLeadIds,
  createImport,
  getImport,
  insertImportRows,
  listRowsByFlags,
  markCommitted,
  sampleRowsByFlag,
  type ImportRowFlag,
} from '../db/repos/importsRepo';
import {
  existingEmails,
  insertImportedLeads,
  leadsByEmails,
  type NewImportedLead,
} from '../db/repos/leadsRepo';
import {
  createOrReplaceCampaignPersonalizedCopy,
  createOrReplacePersonalizedCopySource,
  unsentManualDraftLeadIds,
  type PersonalizedCopySourceRow,
} from '../db/repos/manualDraftsRepo';
import { suppressedAmong } from '../db/repos/suppressionsRepo';
import type { ImportCounts } from '../db/schema';
import { flagRows, normalizeEmail } from './hygiene';
import { parseCsv, type CanonicalField, type ParsedRow } from './parse';
import type { SequenceProvider } from '../scheduler/types';
import {
  allocateExactPools,
  poolEligibility,
  PoolAllocationError,
  type PoolAllocationRequest,
} from '../services/campaignPools';
import { getCampaign } from '../db/repos/campaignsRepo';
import { contentHashOf } from '../render/hash';

interface StoredImportRaw {
  fields: Partial<Record<CanonicalField, string>>;
  custom_fields: Record<string, string>;
  copy_slots?: ParsedRow['copySlots'];
  copy_conflicts?: string[];
}

function copySlotsOf(raw: StoredImportRaw): NonNullable<ParsedRow['copySlots']> {
  if (raw.copy_slots) return raw.copy_slots;
  if (!raw.fields.manual_subject && !raw.fields.manual_body) return {};
  return {
    1: {
      subject: raw.fields.manual_subject,
      body: raw.fields.manual_body,
      targetStepNo: null,
    },
  };
}

export interface IngestDeps {
  db: Db;
  clock?: Clock;
  sequences?: SequenceProvider;
}

export type CommitMode = 'drop_flagged' | 'import_all';

export interface ImportAllocationRequest extends PoolAllocationRequest {
  /** Destination for generic manual_subject/manual_body copy in this campaign. */
  genericCopyStepNo?: number;
}

const SAMPLE_LIMIT = 20;

export interface ImportPreview {
  importId: number;
  rowsTotal: number;
  /**
   * Per the docs/03 counts contract: `ok` is the IMPORTABLE-CLEAN display
   * number (ok-flag + missing_first_name rows — the "Import 885" button);
   * `missing_first_name` is its overlapping sub-count. Row flags stay
   * disjoint in import_rows.
   */
  counts: ImportCounts;
  samples: Partial<Record<ImportRowFlag, Array<{ rowNo: number; email: string | null }>>>;
  draftCounts: {
    newLeads: number;
    existingLeads: number;
    validDrafts: number;
    invalidDrafts: number;
  };
}

export async function createImportPreview(
  deps: IngestDeps,
  input: { filename: string; content: Buffer },
): Promise<ImportPreview> {
  const { db } = deps;
  const parsed = await parseCsv(input.content);

  const candidates = [...new Set(parsed.map((r) => normalizeEmail(r.fields.email ?? '')))];
  const flagged = flagRows(parsed, {
    existingLeadEmails: await existingEmails(db, candidates),
    suppressedEmails: await suppressedAmong(db, candidates),
  });

  const raw = (f: ImportRowFlag): number => flagged.filter((r) => r.flag === f).length;
  const counts: ImportCounts = {
    ok: raw('ok') + raw('missing_first_name'), // importable-clean display number
    missing_first_name: raw('missing_first_name'),
    role_based: raw('role_based'),
    invalid: raw('invalid'),
    duplicate: raw('duplicate'),
    suppressed: raw('suppressed'),
  };

  const importId = await createImport(db, {
    filename: input.filename,
    rowsTotal: parsed.length,
    counts,
  });
  await insertImportRows(
    db,
    flagged.map((r) => ({
      importId,
      rowNo: r.rowNo,
      raw: {
        fields: r.fields,
        custom_fields: r.customFields,
        copy_slots: r.copySlots,
        copy_conflicts: r.copyConflicts,
      },
      emailNormalized: r.emailNormalized === '' ? null : r.emailNormalized,
      flag: r.flag,
    })),
  );

  const samples: ImportPreview['samples'] = {};
  for (const flag of Object.keys(counts) as ImportRowFlag[]) {
    const rows = await sampleRowsByFlag(db, importId, flag, SAMPLE_LIMIT);
    if (rows.length > 0) {
      samples[flag] = rows.map((r) => ({ rowNo: r.rowNo, email: r.emailNormalized }));
    }
  }
  const copyPairs = parsed.flatMap((row) => Object.values(row.copySlots ?? {}));
  return {
    importId,
    rowsTotal: parsed.length,
    counts,
    samples,
    draftCounts: {
      newLeads: flagged.filter((row) => row.flag !== 'duplicate').length,
      existingLeads: flagged.filter((row) => row.flag === 'duplicate').length,
      validDrafts: flagged.reduce(
        (sum, row) =>
          sum +
          (row.flag === 'suppressed' ||
          row.flag === 'invalid' ||
          (row.copyConflicts?.length ?? 0) > 0
            ? 0
            : Object.values(row.copySlots ?? {}).filter((copy) => copy.subject && copy.body)
                .length),
        0,
      ),
      invalidDrafts:
        copyPairs.filter((copy) => !copy.subject || !copy.body).length +
        parsed.reduce((sum, row) => sum + (row.copyConflicts?.length ?? 0), 0),
    },
  };
}

export interface CommitResult {
  inserted: number;
  /** Rows admitted by the mode but skipped at commit time (created since preview, or newly suppressed). */
  skipped: number;
  draftsCreated: number;
  draftsReplaced: number;
  draftsSkipped: number;
  invalidDrafts: number;
  allocationsCreated: number;
  remainingGlobal: number;
  sourcesCreated: number;
  sourcesReplaced: number;
  sourcesSkipped: number;
  copiesBound: number;
  copyConflicts: number;
  copiesUnassigned: number;
}

export async function commitImport(
  deps: IngestDeps,
  input: {
    importId: number;
    mode: CommitMode;
    draftCampaignId?: number;
    replaceExistingDrafts?: boolean;
    allocations?: readonly ImportAllocationRequest[];
  },
): Promise<CommitResult> {
  const { db } = deps;
  const imp = await getImport(db, input.importId);
  if (!imp) throw new Error(`import ${input.importId} not found`);
  if (imp.committed) throw new Error(`import ${input.importId} already committed`);

  return db.transaction(
    async (tx) => {
      const admitted: ImportRowFlag[] =
        input.mode === 'import_all'
          ? ['ok', 'missing_first_name', 'role_based']
          : ['ok', 'missing_first_name'];
      const rows = await listRowsByFlags(tx, input.importId, admitted);
      const allRows = await listRowsByFlags(tx, input.importId, [
        'ok',
        'missing_first_name',
        'role_based',
        'invalid',
        'duplicate',
        'suppressed',
      ]);

      // Compliance re-check at commit time: an address suppressed AFTER the
      // preview must still never be imported (docs/09 §2 #4).
      const nowSuppressed = await suppressedAmong(
        tx,
        allRows.flatMap((row) => (row.emailNormalized ? [row.emailNormalized] : [])),
      );

      const toInsert: Array<{ rowId: number; lead: NewImportedLead }> = [];
      for (const r of rows) {
        const email = r.emailNormalized!;
        if (nowSuppressed.has(email)) continue;
        const rawRow = r.raw as {
          fields: Partial<Record<CanonicalField, string>>;
          custom_fields: Record<string, string>;
        };
        const f = rawRow.fields;
        const { manual_subject: _subject, manual_body: _body, ...leadFields } = f;
        toInsert.push({
          rowId: r.id,
          lead: {
            email,
            firstName: leadFields.first_name ?? null,
            lastName: leadFields.last_name ?? null,
            company: leadFields.company ?? null,
            website: leadFields.website ?? null,
            city: leadFields.city ?? null,
            state: leadFields.state ?? null,
            phone: leadFields.phone ?? null,
            notes: leadFields.notes ?? null,
            customFields: rawRow.custom_fields ?? {},
            importId: input.importId,
          },
        });
      }

      const insertedByEmail = await insertImportedLeads(
        tx,
        toInsert.map((t) => t.lead),
      );
      const leadMap = await leadsByEmails(
        tx,
        allRows.flatMap((row) => (row.emailNormalized ? [row.emailNormalized] : [])),
      );
      const insertedRowIds = new Set(
        toInsert.filter(({ lead }) => insertedByEmail.has(lead.email)).map(({ rowId }) => rowId),
      );
      const pairs = allRows.flatMap((row) => {
        const leadId = row.emailNormalized ? leadMap.get(row.emailNormalized)?.id : undefined;
        const carriesDraft =
          Object.keys(copySlotsOf(row.raw as unknown as StoredImportRaw)).length > 0;
        const wasInserted = insertedRowIds.has(row.id);
        const carriesAllocation = (input.allocations?.length ?? 0) > 0;
        return leadId === undefined || (!wasInserted && !carriesDraft && !carriesAllocation)
          ? []
          : [{ rowId: row.id, leadId }];
      });
      await backfillLeadIds(tx, pairs);

      const sourceCandidates = allRows.flatMap((row) => {
        const raw = row.raw as unknown as StoredImportRaw;
        const lead = row.emailNormalized ? leadMap.get(row.emailNormalized) : undefined;
        return Object.entries(copySlotsOf(raw)).map(([slotNo, copy]) => ({
          row,
          lead,
          slotNo: Number(slotNo),
          copy,
          conflicted: (raw.copy_conflicts?.length ?? 0) > 0,
        }));
      });
      const invalidDrafts = sourceCandidates.filter(
        (candidate) => candidate.conflicted || !candidate.copy.subject || !candidate.copy.body,
      ).length;
      const validSources = sourceCandidates.filter(
        (candidate) =>
          !candidate.conflicted &&
          Boolean(candidate.copy.subject && candidate.copy.body) &&
          Boolean(candidate.lead && !candidate.lead.isSuppressed && !candidate.lead.isErased) &&
          !nowSuppressed.has(candidate.row.emailNormalized!),
      );
      let sourcesCreated = 0;
      let sourcesReplaced = 0;
      let sourcesSkipped = sourceCandidates.length - invalidDrafts - validSources.length;
      const savedSources: Array<{
        leadId: number;
        source: PersonalizedCopySourceRow;
        targetStepNo: number | null;
      }> = [];
      for (const candidate of validSources) {
        const saved = await createOrReplacePersonalizedCopySource(tx, {
          leadId: candidate.lead!.id,
          slotNo: candidate.slotNo,
          targetStepNo: candidate.copy.targetStepNo,
          sourceImportId: input.importId,
          subject: candidate.copy.subject!,
          body: candidate.copy.body!,
          status: 'ready',
          replace: input.replaceExistingDrafts ?? false,
          at: deps.clock?.now(),
        });
        if (saved.result === 'created') sourcesCreated += 1;
        else if (saved.result === 'replaced') sourcesReplaced += 1;
        else sourcesSkipped += 1;
        savedSources.push({
          leadId: candidate.lead!.id,
          source: saved.source,
          targetStepNo: candidate.copy.targetStepNo,
        });
      }

      const allocationRequests = input.allocations ?? [];
      let allocationsCreated = 0;
      const admittedForAllocation = new Set<ImportRowFlag>([
        'ok',
        'missing_first_name',
        ...(input.mode === 'import_all' ? (['role_based'] as ImportRowFlag[]) : []),
        'duplicate',
      ]);
      const candidateLeadIds = allRows
        .filter((row) => admittedForAllocation.has(row.flag))
        .flatMap((row) => {
          const leadId = row.emailNormalized ? leadMap.get(row.emailNormalized)?.id : undefined;
          return leadId === undefined || nowSuppressed.has(row.emailNormalized!) ? [] : [leadId];
        })
        .filter((id, index, all) => all.indexOf(id) === index);
      let remainingGlobal = candidateLeadIds.length;
      const campaignAssignments = new Map<number, number[]>();
      if (allocationRequests.length > 0) {
        if (!deps.clock || !deps.sequences) {
          throw new Error('campaign allocation requires clock and sequence dependencies');
        }
        const allocated = await allocateExactPools(tx, deps.sequences, {
          requests: allocationRequests,
          candidateLeadIds,
          sourceImportId: input.importId,
          bindPersonalizedCopy: false,
          now: deps.clock.now(),
        });
        for (const assignment of allocated.byCampaign) {
          campaignAssignments.set(assignment.campaignId, assignment.leadIds);
        }
        allocationsCreated = allocated.allocatedLeadIds.length;
        remainingGlobal = Math.max(0, candidateLeadIds.length - allocationsCreated);
      } else if (input.draftCampaignId !== undefined) {
        campaignAssignments.set(input.draftCampaignId, [
          ...new Set(savedSources.map((saved) => saved.leadId)),
        ]);
      }

      let copiesBound = 0;
      let draftsReplaced = 0;
      let draftsSkipped = 0;
      const assignedSourceIds = new Set<number>();
      if (campaignAssignments.size > 0 && !deps.sequences) {
        throw new Error('campaign copy binding requires sequence dependencies');
      }
      for (const [campaignId, assignedLeadIds] of campaignAssignments) {
        const sequence = await deps.sequences!.sequenceFor(campaignId);
        const personalizedSteps = sequence.steps.filter(
          (step) => step.contentSource === 'personalized' && step.id !== undefined,
        );
        const assigned = new Set(assignedLeadIds);
        const assignedSources = savedSources.filter((source) => assigned.has(source.leadId));
        const requestedGenericStepNo = allocationRequests.find(
          (request) => request.campaignId === campaignId,
        )?.genericCopyStepNo;
        if (
          requestedGenericStepNo !== undefined &&
          !personalizedSteps.some((step) => step.stepNo === requestedGenericStepNo)
        ) {
          throw new PoolAllocationError(
            `campaign ${campaignId} step ${requestedGenericStepNo} must be a Personalized Copy step`,
          );
        }
        if (
          assignedSources.some((source) => source.targetStepNo === null) &&
          personalizedSteps.length > 1 &&
          requestedGenericStepNo === undefined
        ) {
          throw new PoolAllocationError(
            `choose a Personalized Copy step for generic imported copy in campaign ${campaignId}`,
          );
        }
        for (const saved of assignedSources) {
          const target =
            saved.targetStepNo === null
              ? requestedGenericStepNo !== undefined
                ? personalizedSteps.find((step) => step.stepNo === requestedGenericStepNo)
                : personalizedSteps.length === 1
                  ? personalizedSteps[0]
                  : undefined
              : personalizedSteps.find((step) => step.stepNo === saved.targetStepNo);
          if (!target?.id) continue;
          const result = await createOrReplaceCampaignPersonalizedCopy(tx, {
            leadId: saved.leadId,
            campaignId,
            sequenceStepId: target.id,
            stepNo: target.stepNo,
            sourceCopyId: saved.source.id,
            sourceImportId: input.importId,
            subject: saved.source.subject,
            body: saved.source.body,
            contentHash: contentHashOf(saved.source.subject, saved.source.body),
            status: saved.source.status,
            replace: input.replaceExistingDrafts ?? false,
            at: deps.clock?.now(),
          });
          if (result === 'created') copiesBound += 1;
          else if (result === 'replaced') draftsReplaced += 1;
          else draftsSkipped += 1;
          assignedSourceIds.add(saved.source.id);
        }
      }
      const copiesUnassigned = savedSources.filter(
        (saved) => !assignedSourceIds.has(saved.source.id),
      ).length;
      const draftsCreated = copiesBound;

      await markCommitted(tx, input.importId, input.mode);
      return {
        inserted: insertedByEmail.size,
        skipped: rows.length - insertedByEmail.size,
        draftsCreated,
        draftsReplaced,
        draftsSkipped,
        invalidDrafts,
        allocationsCreated,
        remainingGlobal,
        sourcesCreated,
        sourcesReplaced,
        sourcesSkipped,
        copiesBound,
        copyConflicts: sourceCandidates.filter((candidate) => candidate.conflicted).length,
        copiesUnassigned,
      };
    },
    { isolationLevel: 'serializable' },
  );
}

export interface AllocationPreviewResult {
  available: number;
  existingLeads: number;
  remainingGlobal: number;
  exclusions: Record<string, number>;
  campaigns: Array<{
    campaignId: number;
    requested: number;
    allocatable: number;
    draftReserved: number;
    personalizedSteps: number[];
    genericCopies: number;
    resolvedGenericCopyStepNo: number | null;
    genericCopyStepRequired: boolean;
    copiesBound: number;
    copiesUnassigned: number;
  }>;
}

export async function previewImportAllocations(
  deps: Required<Pick<IngestDeps, 'db' | 'clock' | 'sequences'>>,
  input: {
    importId: number;
    mode: CommitMode;
    requests: readonly ImportAllocationRequest[];
    draftCampaignId?: number;
  },
): Promise<AllocationPreviewResult> {
  const rows = await listRowsByFlags(deps.db, input.importId, [
    'ok',
    'missing_first_name',
    'role_based',
    'invalid',
    'duplicate',
    'suppressed',
  ]);
  const campaignIds = input.requests.map((request) => request.campaignId);
  if (new Set(campaignIds).size !== campaignIds.length) {
    throw new PoolAllocationError('each target campaign may appear only once');
  }
  for (const id of campaignIds) {
    const campaign = await getCampaign(deps.db, id);
    if (
      !campaign ||
      !(
        ['draft', 'paused'].includes(campaign.status) ||
        (campaign.status === 'active' && !campaign.autoEnrollEnabled)
      )
    ) {
      throw new PoolAllocationError(
        `campaign ${id} must be draft, paused, or active with automatic enrollment off`,
      );
    }
  }
  const emails = rows.flatMap((row) => (row.emailNormalized ? [row.emailNormalized] : []));
  const leadMap = await leadsByEmails(deps.db, emails);
  const admitted = new Set<ImportRowFlag>([
    'ok',
    'missing_first_name',
    ...(input.mode === 'import_all' ? (['role_based'] as ImportRowFlag[]) : []),
    'duplicate',
  ]);
  const candidates = rows
    .filter((row) => admitted.has(row.flag))
    .map((row) => {
      const raw = row.raw as unknown as StoredImportRaw;
      return {
        key: row.emailNormalized!,
        leadId: row.emailNormalized ? leadMap.get(row.emailNormalized)?.id : undefined,
        copyTargets:
          (raw.copy_conflicts?.length ?? 0) > 0
            ? []
            : Object.values(copySlotsOf(raw)).flatMap((copy) =>
                copy.subject && copy.body ? [copy.targetStepNo] : [],
              ),
      };
    })
    .filter((row, index, all) => all.findIndex((other) => other.key === row.key) === index);

  const used = new Set<string>();
  const exclusions: Record<string, number> = {};
  const campaignResults: AllocationPreviewResult['campaigns'] = [];
  for (const request of input.requests) {
    const remaining = candidates.filter((candidate) => !used.has(candidate.key));
    const existingIds = remaining.flatMap((candidate) =>
      candidate.leadId === undefined ? [] : [candidate.leadId],
    );
    const checked = await poolEligibility(
      deps.db,
      deps.sequences,
      request.campaignId,
      existingIds,
      deps.clock.now(),
    );
    const existingEligible = new Set(checked.eligible.map((lead) => lead.id));
    for (const reason of checked.reasons.values())
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    const eligible = remaining.filter(
      (candidate) => candidate.leadId === undefined || existingEligible.has(candidate.leadId),
    );
    const pinned =
      request.campaignId === input.draftCampaignId
        ? eligible.filter((candidate) => candidate.copyTargets.length > 0)
        : [];
    const ordered = [...pinned, ...eligible.filter((candidate) => !pinned.includes(candidate))];
    const selected = ordered.slice(0, request.count);
    selected.forEach((candidate) => used.add(candidate.key));
    const sequence = await deps.sequences.sequenceFor(request.campaignId);
    const personalizedSteps = sequence.steps
      .filter((step) => step.contentSource === 'personalized' && step.id !== undefined)
      .map((step) => step.stepNo);
    if (
      request.genericCopyStepNo !== undefined &&
      !personalizedSteps.includes(request.genericCopyStepNo)
    ) {
      throw new PoolAllocationError(
        `campaign ${request.campaignId} step ${request.genericCopyStepNo} must be a Personalized Copy step`,
      );
    }
    const selectedCopyTargets = selected.flatMap((candidate) => candidate.copyTargets);
    const genericCopies = selectedCopyTargets.filter((stepNo) => stepNo === null).length;
    const resolvedGenericCopyStepNo =
      request.genericCopyStepNo ?? (personalizedSteps.length === 1 ? personalizedSteps[0]! : null);
    const genericCopyStepRequired =
      genericCopies > 0 && personalizedSteps.length > 1 && resolvedGenericCopyStepNo === null;
    const copiesBound =
      selectedCopyTargets.filter((stepNo) => stepNo !== null && personalizedSteps.includes(stepNo))
        .length + (resolvedGenericCopyStepNo === null ? 0 : genericCopies);
    campaignResults.push({
      campaignId: request.campaignId,
      requested: request.count,
      allocatable: selected.length,
      draftReserved: selected.filter((candidate) => candidate.copyTargets.length > 0).length,
      personalizedSteps,
      genericCopies,
      resolvedGenericCopyStepNo,
      genericCopyStepRequired,
      copiesBound,
      copiesUnassigned: Math.max(0, selectedCopyTargets.length - copiesBound),
    });
  }
  return {
    available: candidates.length,
    existingLeads: candidates.filter((candidate) => candidate.leadId !== undefined).length,
    remainingGlobal: Math.max(0, candidates.length - used.size),
    exclusions,
    campaigns: campaignResults,
  };
}

export async function previewImportDrafts(
  deps: IngestDeps,
  input: { importId: number; campaignId: number },
): Promise<{
  newLeads: number;
  existingLeads: number;
  validDrafts: number;
  invalidDrafts: number;
  existingDraftConflicts: number;
}> {
  const rows = await listRowsByFlags(deps.db, input.importId, [
    'ok',
    'missing_first_name',
    'role_based',
    'invalid',
    'duplicate',
    'suppressed',
  ]);
  const leads = await leadsByEmails(
    deps.db,
    rows.flatMap((row) => (row.emailNormalized ? [row.emailNormalized] : [])),
  );
  const draftRows = rows.flatMap((row) =>
    Object.values(copySlotsOf(row.raw as unknown as StoredImportRaw)).map((copy) => ({
      row,
      copy,
    })),
  );
  const valid = draftRows.filter(({ row, copy }) => {
    const raw = row.raw as unknown as StoredImportRaw;
    const lead = row.emailNormalized ? leads.get(row.emailNormalized) : undefined;
    return Boolean(
      copy.subject &&
      copy.body &&
      (raw.copy_conflicts?.length ?? 0) === 0 &&
      row.flag !== 'invalid' &&
      row.flag !== 'suppressed' &&
      (!lead || (!lead.isSuppressed && !lead.isErased)),
    );
  });
  const existingValidLeadIds = valid.flatMap(({ row }) => {
    const lead = row.emailNormalized ? leads.get(row.emailNormalized) : undefined;
    return lead ? [lead.id] : [];
  });
  const conflicts = await unsentManualDraftLeadIds(deps.db, input.campaignId, existingValidLeadIds);
  return {
    newLeads: rows.filter((row) => row.flag !== 'duplicate').length,
    existingLeads: rows.filter((row) => row.flag === 'duplicate').length,
    validDrafts: valid.length,
    invalidDrafts: draftRows.length - valid.length,
    existingDraftConflicts: conflicts.size,
  };
}

/** Re-export the parse contract for API-layer use (B6.4). */
export type { ParsedRow };

// ── single-lead creation (finding 10) ────────────────────────────────────────

/**
 * Adding one lead used to mean hand-writing a CSV. That was deliberate — the
 * ingest path owns normalization, dedup, hygiene flags and the commit-time
 * suppression re-check — but it made a routine action absurd.
 *
 * So this does NOT reimplement any of that. It builds a one-row CSV and runs
 * the SAME preview + commit the upload path runs, which is the only way to be
 * certain the two cannot diverge. The cost is one `imports` row per lead,
 * which is honest: it really is an import, and it keeps the audit trail whole.
 */
export interface SingleLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  website?: string;
  city?: string;
  state?: string;
  phone?: string;
  notes?: string;
}

export interface SingleLeadResult {
  created: boolean;
  /** Populated when created is false — the hygiene flag that refused the row. */
  reason?: ImportRowFlag;
}

/** RFC 4180: wrap in quotes and double any embedded quote. */
function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function createSingleLead(
  deps: IngestDeps,
  input: SingleLeadInput,
): Promise<SingleLeadResult> {
  const columns = Object.keys(input) as (keyof SingleLeadInput)[];
  const header = columns.join(',');
  const row = columns.map((c) => csvCell(input[c] ?? '')).join(',');
  const content = Buffer.from(`${header}\n${row}\n`, 'utf8');

  const preview = await createImportPreview(deps, {
    filename: `single-lead:${input.email}`,
    content,
  });

  // drop_flagged is the strict mode: role-based addresses are refused too, so
  // a single add can never be laxer than the bulk path's safe default.
  const result = await commitImport(deps, { importId: preview.importId, mode: 'drop_flagged' });
  if (result.inserted === 1) return { created: true };

  const rows = await listRowsByFlags(deps.db, preview.importId, [
    'invalid',
    'duplicate',
    'suppressed',
    'role_based',
    'ok',
    'missing_first_name',
  ]);
  return { created: false, reason: rows[0]?.flag ?? 'invalid' };
}
