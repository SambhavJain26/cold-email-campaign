import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

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
