// Import workflow (docs/09 §2–§3): upload → hygiene preview (persisted in
// import_rows so a later commit is exact) → commit in one of two modes.
// `invalid` and `suppressed` rows are NEVER imported under either mode;
// `import_all` only additionally admits `role_based`.
import type { DbLike } from '../db/client';
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
import { existingEmails, insertImportedLeads, type NewImportedLead } from '../db/repos/leadsRepo';
import { suppressedAmong } from '../db/repos/suppressionsRepo';
import type { ImportCounts } from '../db/schema';
import { flagRows, normalizeEmail } from './hygiene';
import { parseCsv, type CanonicalField, type ParsedRow } from './parse';

export interface IngestDeps {
  db: DbLike;
}

export type CommitMode = 'drop_flagged' | 'import_all';

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
      raw: { fields: r.fields, custom_fields: r.customFields },
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
  return { importId, rowsTotal: parsed.length, counts, samples };
}

export interface CommitResult {
  inserted: number;
  /** Rows admitted by the mode but skipped at commit time (created since preview, or newly suppressed). */
  skipped: number;
}

export async function commitImport(
  deps: IngestDeps,
  input: { importId: number; mode: CommitMode },
): Promise<CommitResult> {
  const { db } = deps;
  const imp = await getImport(db, input.importId);
  if (!imp) throw new Error(`import ${input.importId} not found`);
  if (imp.committed) throw new Error(`import ${input.importId} already committed`);

  const admitted: ImportRowFlag[] =
    input.mode === 'import_all'
      ? ['ok', 'missing_first_name', 'role_based']
      : ['ok', 'missing_first_name'];
  const rows = await listRowsByFlags(db, input.importId, admitted);

  // Compliance re-check at commit time: an address suppressed AFTER the
  // preview must still never be imported (docs/09 §2 #4).
  const nowSuppressed = await suppressedAmong(
    db,
    rows.map((r) => r.emailNormalized!),
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
    toInsert.push({
      rowId: r.id,
      lead: {
        email,
        firstName: f.first_name ?? null,
        lastName: f.last_name ?? null,
        company: f.company ?? null,
        website: f.website ?? null,
        city: f.city ?? null,
        state: f.state ?? null,
        phone: f.phone ?? null,
        notes: f.notes ?? null,
        customFields: rawRow.custom_fields ?? {},
        importId: input.importId,
      },
    });
  }

  const insertedByEmail = await insertImportedLeads(
    db,
    toInsert.map((t) => t.lead),
  );
  const pairs = toInsert.flatMap((t) => {
    const leadId = insertedByEmail.get(t.lead.email);
    return leadId === undefined ? [] : [{ rowId: t.rowId, leadId }];
  });
  await backfillLeadIds(db, pairs);

  await markCommitted(db, input.importId, input.mode);
  return { inserted: pairs.length, skipped: rows.length - pairs.length };
}

/** Re-export the parse contract for API-layer use (B6.4). */
export type { ParsedRow };
