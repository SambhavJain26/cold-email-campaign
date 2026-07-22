// Vitest globalSetup for the integration project: bring the test DB to the
// latest schema before any test runs. Requires `docker compose up -d`.
import { migrateUp } from '../../src/db/migrate';
import { getTestPool, MIGRATIONS_DIR } from './db';

export default async function setup(): Promise<void> {
  const pool = getTestPool();
  try {
    await migrateUp(pool, MIGRATIONS_DIR);
  } catch (err) {
    throw new Error(
      `Test DB not reachable/migratable - is docker compose up? (${(err as Error).message})`,
      { cause: err },
    );
  } finally {
    await pool.end();
  }
}
