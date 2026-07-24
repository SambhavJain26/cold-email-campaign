// Seed the reconciled 885-lead golden cohort into a target DB, migrations and
// all. Gives the restore drill (scripts/restore-drill.sh) real, fully-folded
// data to prove the dump/restore round-trip against - dumping an empty DB
// would prove nothing.
//
//   npx tsx apps/server/test/ops/seed-golden.ts postgres://…/coldemail_drill
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema';
import { migrateUp } from '../../src/db/migrate';
import { seedGoldenCohort } from '../helpers/goldenSeed';
import { MIGRATIONS_DIR } from '../helpers/db';

async function main(): Promise<void> {
  const url = process.argv[2] ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('usage: tsx seed-golden.ts <DATABASE_URL>');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    await migrateUp(pool, MIGRATIONS_DIR);
    const n = await seedGoldenCohort(db, pool);
    console.log(`seeded golden cohort into ${url.replace(/:[^:@/]*@/, ':***@')} (${n} events)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
