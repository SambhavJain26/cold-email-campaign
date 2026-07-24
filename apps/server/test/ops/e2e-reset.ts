// Real-backend e2e DB reset (docs/13 §5). Run in the Playwright real-mode
// server command AFTER migrations and BEFORE boot: truncates the core tables
// and reseeds the operator from the same env the server boots with, so every
// run starts from a known-clean slate. Uses DATABASE_URL (the test DB).
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { ensureOperator } from '../../src/services/operatorAuth';
import { resetCoreTables } from '../helpers/db';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_INITIAL_PASSWORD;
  if (!url || !email || !password) {
    console.error('e2e-reset needs DATABASE_URL + OPERATOR_EMAIL + OPERATOR_INITIAL_PASSWORD');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    await resetCoreTables(pool);
    await ensureOperator(db, { OPERATOR_EMAIL: email, OPERATOR_INITIAL_PASSWORD: password });
    console.log('e2e-reset: core tables truncated + operator seeded');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
