// CLI: npm run self-check [-- --campaign <id>]
// Runs the docs/04 §4 invariant checks over the event log ⇔ projections and
// exits 1 if any invariant is violated. Used by the restore drill (docs/16 §3)
// and, on a daily schedule, by the B7.3 self-check job.
import { loadDotenv } from '../config/dotenv';
import { createDb } from '../db/client';
import { selfCheckViolations } from '../db/repos/metricsRepo';

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const campaignFlag = process.argv.indexOf('--campaign');
  const campaignId = campaignFlag > -1 ? Number(process.argv[campaignFlag + 1]) : null;

  const { db, pool } = createDb(url);
  try {
    const violations = await selfCheckViolations(db, campaignId);
    if (violations.length === 0) {
      console.log('self-check OK - no invariant violations.');
      return;
    }
    console.error(`self-check FAILED - ${violations.length} invariant violation(s):`);
    for (const v of violations) console.error(`  - ${v.rule}: ${v.count}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
