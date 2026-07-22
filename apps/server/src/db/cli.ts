// CLI: npm run db:migrate | db:rollback | db:status  (from root or apps/server)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadDotenv } from '../config/dotenv';
import { migrateDown, migrateUp, migrationStatus } from './migrate';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (create .env from .env.example)');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const cmd = process.argv[2] ?? 'up';
  try {
    switch (cmd) {
      case 'up': {
        const ran = await migrateUp(pool, MIGRATIONS_DIR);
        console.log(ran.length ? `applied: ${ran.join(', ')}` : 'already up to date');
        break;
      }
      case 'down': {
        const steps = Number(process.argv[3] ?? '1');
        const reverted = await migrateDown(pool, MIGRATIONS_DIR, steps);
        console.log(reverted.length ? `reverted: ${reverted.join(', ')}` : 'nothing to revert');
        break;
      }
      case 'status': {
        for (const s of await migrationStatus(pool, MIGRATIONS_DIR)) {
          console.log(`${s.applied ? '[x]' : '[ ]'} ${s.name}`);
        }
        break;
      }
      default:
        console.error(`unknown command: ${cmd} (expected up|down|status)`);
        process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
