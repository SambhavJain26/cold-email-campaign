import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import '../../src/db/pg-types';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test';

export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
);

export function getTestPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

/**
 * Wipe core tables between tests. `events` is append-only (trigger blocks
 * row DELETE even for the owner) — TRUNCATE is the sanctioned reset path:
 * statement-level, owner-only (app_rw has no TRUNCATE grant).
 */
export async function resetCoreTables(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE events, enrollments, suppressions, campaigns, leads RESTART IDENTITY CASCADE',
  );
}
