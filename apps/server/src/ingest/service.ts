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
