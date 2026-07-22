// B5.1: the 0005_ingest tables - enum, FKs (incl. the leads.import_id FK
// deferred from 0001), cascade, and the repo round-trip.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import {
  createImport,
  getImport,
  insertImportRows,
  listRowsByFlags,
  markCommitted,
  sampleRowsByFlag,
} from '../../src/db/repos/importsRepo';
import type { ImportCounts } from '../../src/db/schema';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const COUNTS: ImportCounts = {
  ok: 1,
  missing_first_name: 1,
  role_based: 1,
  invalid: 0,
  duplicate: 0,
  suppressed: 0,
};

describe('0005_ingest tables (B5.1)', () => {
  let db: Db;
  let pool: Pool;

  beforeAll(() => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });
  beforeEach(async () => {
    await resetCoreTables(pool);
  });

  it('imports + import_rows round-trip through the repo', async () => {
    const id = await createImport(db, { filename: 'leads.csv', rowsTotal: 3, counts: COUNTS });
    await insertImportRows(db, [
      { importId: id, rowNo: 1, raw: { email: 'a@x.dev' }, emailNormalized: 'a@x.dev', flag: 'ok' },
      {
        importId: id,
        rowNo: 2,
        raw: { email: 'b@x.dev' },
        emailNormalized: 'b@x.dev',
        flag: 'missing_first_name',
      },
      {
        importId: id,
        rowNo: 3,
        raw: { email: 'info@x.dev' },
        emailNormalized: 'info@x.dev',
        flag: 'role_based',
      },
    ]);

    expect((await getImport(db, id))?.counts).toEqual(COUNTS);
    expect(await sampleRowsByFlag(db, id, 'ok', 20)).toHaveLength(1);
    const committable = await listRowsByFlags(db, id, ['ok', 'missing_first_name']);
    expect(committable.map((r) => r.rowNo)).toEqual([1, 2]);

    await markCommitted(db, id, 'drop_flagged');
    expect(await getImport(db, id)).toMatchObject({ committed: true, commitMode: 'drop_flagged' });
  });

  it('leads.import_id is FK-enforced (deferred from 0001, added in 0005)', async () => {
    await expect(
      pool.query(`INSERT INTO leads (email, import_id) VALUES ('x@y.dev', 999)`),
    ).rejects.toThrow(/leads_import_id_fkey/);
  });

  it('deleting an import cascades its rows but not its leads', async () => {
    const id = await createImport(db, { filename: 'f.csv', rowsTotal: 1, counts: COUNTS });
    await pool.query(`INSERT INTO leads (email, import_id) VALUES ('kept@y.dev', $1)`, [id]);
    await insertImportRows(db, [
      { importId: id, rowNo: 1, raw: {}, emailNormalized: 'kept@y.dev', flag: 'ok' },
    ]);
    // leads.import_id blocks deleting a committed import (RESTRICT default) -
    // clear it first; import_rows then cascade.
    await pool.query(`UPDATE leads SET import_id = NULL`);
    await pool.query(`DELETE FROM imports WHERE id = $1`, [id]);
    expect((await pool.query(`SELECT count(*)::int n FROM import_rows`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM leads`)).rows[0].n).toBe(1);
  });
});
