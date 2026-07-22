import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { importRows, imports, type ImportCounts } from '../schema';

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
