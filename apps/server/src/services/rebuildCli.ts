// CLI: npm run rebuild-projections [-- --dry-run] [--campaign <id>]
// Exit 1 on --dry-run with diffs (drift detected) — used by the weekly
// rebuild-compare job (B7) and CI sanity checks.
import { loadDotenv } from '../config/dotenv';
import { createDb } from '../db/client';
import { getSettings } from '../db/repos/settingsRepo';
import { rebuildProjections } from './rebuildProjections';

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const campaignFlag = process.argv.indexOf('--campaign');
  const campaignId = campaignFlag > -1 ? Number(process.argv[campaignFlag + 1]) : null;

  const { db, pool } = createDb(url);
  try {
    const settings = await getSettings(db);
    const result = await rebuildProjections(db, {
      dryRun,
      campaignId,
      // Sequences land in B4; until the DB lookup exists, no enrollment can
      // have finished a sequence, so completion derivation is inert.
      shapeFor: () => ({
        lastStepNo: Number.POSITIVE_INFINITY,
        softRetryMax: settings.softRetryMax,
      }),
      deliveryConfirmMs: settings.deliveryConfirmHours * 3_600_000,
      now: new Date(),
    });

    console.log(`checked ${result.checked} enrollments — ${result.diffs.length} diff(s)`);
    for (const d of result.diffs) {
      console.log(
        `  enrollment ${d.enrollmentId}: ${d.field} stored=${String(d.stored)} derived=${String(d.derived)}`,
      );
    }
    if (!dryRun) console.log(`rewrote ${result.written} projection(s)`);
    if (dryRun && result.diffs.length > 0) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
