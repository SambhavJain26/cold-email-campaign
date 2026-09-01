import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { campaignLeadPool, campaigns, importRows, imports, type ImportCounts } from '../schema';

export type ImportRow = typeof imports.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;
export type ImportRowFlag = ImportRowRow['flag'];

export async function createImport(
  db: DbLike,
  data: { filename: string; rowsTotal: number; counts: ImportCounts },
): Promise<number> {
  const [row] = await db.insert(imports).values(data).returning({ id: imports.id });
  return row!.id;
}

export async function getImport(db: DbLike, id: number): Promise<ImportRow | undefined> {
  const rows = await db.select().from(imports).where(eq(imports.id, id));
  return rows[0];
}

/** Remove an abandoned preview and its staged rows. Committed imports remain immutable. */
export async function discardImportPreview(db: DbLike, id: number): Promise<boolean> {
  const deleted = await db
    .delete(imports)
    .where(and(eq(imports.id, id), eq(imports.committed, false)))
    .returning({ id: imports.id });
  return deleted.length === 1;
}

export async function insertImportRows(
  db: DbLike,
  rows: Array<Omit<typeof importRows.$inferInsert, 'id' | 'leadId'>>,
): Promise<void> {
  // Chunked: a 50k-row file would otherwise blow Postgres' 65k bind-param cap.
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(importRows).values(rows.slice(i, i + CHUNK));
  }
}

/** Preview samples: first `limit` rows of one flag, in file order (docs/09 §2). */
export async function sampleRowsByFlag(
  db: DbLike,
  importId: number,
  flag: ImportRowFlag,
  limit: number,
): Promise<ImportRowRow[]> {
  return db
    .select()
    .from(importRows)
    .where(and(eq(importRows.importId, importId), eq(importRows.flag, flag)))
    .orderBy(asc(importRows.rowNo))
    .limit(limit);
}

/** Every persisted row carrying one of `flags`, in file order — the commit set. */
export async function listRowsByFlags(
  db: DbLike,
  importId: number,
  flags: ImportRowFlag[],
): Promise<ImportRowRow[]> {
  return db
    .select()
    .from(importRows)
    .where(and(eq(importRows.importId, importId), inArray(importRows.flag, flags)))
    .orderBy(asc(importRows.rowNo));
}

/** Batch lead_id backfill — one round trip per 10k rows, not one per row. */
export async function backfillLeadIds(
  db: DbLike,
  pairs: ReadonlyArray<{ rowId: number; leadId: number }>,
): Promise<void> {
  const CHUNK = 10_000;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK);
    await db.execute(sql`
      UPDATE import_rows AS ir SET lead_id = m.lead_id
      FROM unnest(
        ${sql.param(slice.map((p) => p.rowId))}::bigint[],
        ${sql.param(slice.map((p) => p.leadId))}::bigint[]
      ) AS m(row_id, lead_id)
      WHERE ir.id = m.row_id`);
  }
}

/** B6.4 GET /imports — history, newest first. */
export async function listImports(
  db: DbLike,
  page: number,
  perPage: number,
): Promise<{ items: ImportRow[]; total: number }> {
  const items = await db
    .select()
    .from(imports)
    .orderBy(sql`${imports.createdAt} DESC`, sql`${imports.id} DESC`)
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(imports);
  return { items, total: totals[0]?.n ?? 0 };
}

export interface ImportPoolAllocationSummary {
  campaignId: number;
  campaignName: string;
  total: number;
  available: number;
  enrolled: number;
  released: number;
}

/** Auditable per-campaign allocation totals for an import-history page. */
export async function poolAllocationsByImportIds(
  db: DbLike,
  importIds: readonly number[],
): Promise<Map<number, ImportPoolAllocationSummary[]>> {
  if (importIds.length === 0) return new Map();
  const rows = await db
    .select({
      importId: campaignLeadPool.sourceImportId,
      campaignId: campaignLeadPool.campaignId,
      campaignName: campaigns.name,
      total: sql<number>`count(*)::int`,
      available: sql<number>`count(*) FILTER (WHERE ${campaignLeadPool.status} = 'available')::int`,
      enrolled: sql<number>`count(*) FILTER (WHERE ${campaignLeadPool.status} = 'enrolled')::int`,
      released: sql<number>`count(*) FILTER (WHERE ${campaignLeadPool.status} = 'released')::int`,
    })
    .from(campaignLeadPool)
    .innerJoin(campaigns, eq(campaigns.id, campaignLeadPool.campaignId))
    .where(inArray(campaignLeadPool.sourceImportId, [...importIds]))
    .groupBy(campaignLeadPool.sourceImportId, campaignLeadPool.campaignId, campaigns.name)
    .orderBy(campaignLeadPool.sourceImportId, campaignLeadPool.campaignId);
  const result = new Map<number, ImportPoolAllocationSummary[]>();
  for (const row of rows) {
    if (row.importId === null) continue;
    const summaries = result.get(row.importId) ?? [];
    summaries.push(row);
    result.set(row.importId, summaries);
  }
  return result;
}

export async function markCommitted(
  db: DbLike,
  importId: number,
  mode: 'drop_flagged' | 'import_all',
): Promise<void> {
  await db
    .update(imports)
    .set({ committed: true, commitMode: mode })
    .where(eq(imports.id, importId));
}
