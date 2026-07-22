// Migration runner mechanics against the real test DB: status → down → up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { migrateDown, migrateUp, migrationStatus } from '../../src/db/migrate';
import { getTestPool, MIGRATIONS_DIR } from '../helpers/db';

describe('migration runner', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = getTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('reports 0000_init applied by globalSetup', async () => {
    const status = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(status).toEqual([{ name: '0000_init', applied: true }]);
  });

  it('rolls back and re-applies cleanly (apply → down → apply drill)', async () => {
    const reverted = await migrateDown(pool, MIGRATIONS_DIR, 1);
    expect(reverted).toEqual(['0000_init']);
    expect(await migrationStatus(pool, MIGRATIONS_DIR)).toEqual([
      { name: '0000_init', applied: false },
    ]);

    const reapplied = await migrateUp(pool, MIGRATIONS_DIR);
    expect(reapplied).toEqual(['0000_init']);
    expect(await migrationStatus(pool, MIGRATIONS_DIR)).toEqual([
      { name: '0000_init', applied: true },
    ]);
  });

  it('is idempotent - up on an up-to-date DB is a no-op', async () => {
    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual([]);
  });
});
