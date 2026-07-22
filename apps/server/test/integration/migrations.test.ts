// Migration runner mechanics against the real test DB - agnostic to how many
// migrations exist: asserts over the loaded set, drills down->up on the latest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from '../../src/db/migrate';
import { getTestPool, MIGRATIONS_DIR } from '../helpers/db';

describe('migration runner', () => {
  let pool: Pool;
  let names: string[];

  beforeAll(async () => {
    pool = getTestPool();
    names = (await loadMigrations(MIGRATIONS_DIR)).map((m) => m.name);
  });
  afterAll(async () => {
    // leave the test DB fully migrated for whatever runs next
    await migrateUp(pool, MIGRATIONS_DIR);
    await pool.end();
  });

  it('globalSetup applied every migration, in filename order', async () => {
    const status = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(status.map((s) => s.name)).toEqual(names);
    expect(status.every((s) => s.applied)).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(2); // 0000_init + 0001_core so far
  });

  it('rolls back the latest and re-applies cleanly (apply -> down -> apply drill)', async () => {
    const latest = names.at(-1)!;

    const reverted = await migrateDown(pool, MIGRATIONS_DIR, 1);
    expect(reverted).toEqual([latest]);
    const afterDown = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(afterDown.find((s) => s.name === latest)?.applied).toBe(false);

    const reapplied = await migrateUp(pool, MIGRATIONS_DIR);
    expect(reapplied).toEqual([latest]);
    const afterUp = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(afterUp.every((s) => s.applied)).toBe(true);
  });

  it('is idempotent - up on an up-to-date DB is a no-op', async () => {
    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual([]);
  });
});
