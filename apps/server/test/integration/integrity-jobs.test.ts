// B7.3 — the scheduled integrity jobs and their drift alerts (docs/16 §4).
// Seeds the golden cohort, normalises projections with the SAME shape lookup
// the jobs use, then proves each job is silent on a consistent DB and raises a
// single selfcheck_drift alert the moment something diverges.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { CapturingAlerts } from '../../src/alerts/types';
import { DbSequenceProvider } from '../../src/scheduler/dbSequenceProvider';
import { loadCampaignShapes } from '../../src/services/campaignShapes';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { getSettings } from '../../src/db/repos/settingsRepo';
import { runRebuildCompareJob, runSelfCheckJob } from '../../src/jobs/integrity';
import { seedGoldenCohort } from '../helpers/goldenSeed';
import { resetCoreTables, TEST_DATABASE_URL } from '../helpers/db';

const { db, pool } = createDb(TEST_DATABASE_URL);
const sequences = new DbSequenceProvider(db);
const NOW = new Date('2026-03-01T00:00:00Z');

/** WRITE-rebuild the projections so stored == derived under the job's shapeFor. */
async function normalize(): Promise<void> {
  const settings = await getSettings(db);
  const shapeFor = await loadCampaignShapes(db, sequences, settings.softRetryMax);
  await rebuildProjections(db, {
    dryRun: false,
    shapeFor,
    deliveryConfirmMs: settings.deliveryConfirmHours * 3_600_000,
    now: NOW,
  });
}

describe('B7.3 integrity jobs', () => {
  beforeAll(async () => {
    await seedGoldenCohort(db, pool);
    await normalize();
  }, 60_000);

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  describe('daily self-check', () => {
    it('stays silent on a consistent DB', async () => {
      const alerts = new CapturingAlerts();
      const res = await runSelfCheckJob({ db, alerts, now: () => NOW });
      expect(res.violations).toHaveLength(0);
      expect(alerts.emitted).toHaveLength(0);
    });

    it('raises one selfcheck_drift on an invariant violation', async () => {
      // enrollment 1 is REPLIED (has a human_reply, no unsubscribe); force it
      // UNSUBSCRIBED → the "UNSUBSCRIBED without unsubscribe event" invariant.
      await pool.query(`UPDATE enrollments SET current_state = 'UNSUBSCRIBED' WHERE id = 1`);
      const alerts = new CapturingAlerts();
      const res = await runSelfCheckJob({ db, alerts, now: () => NOW });

      expect(res.violations.length).toBeGreaterThan(0);
      expect(alerts.emitted).toHaveLength(1);
      expect(alerts.emitted[0]).toMatchObject({ kind: 'selfcheck_drift', severity: 'error' });
      expect(alerts.emitted[0]!.payload.check).toBe('invariants');

      await normalize(); // restore consistency for the next test
    });
  });

  describe('backup freshness', () => {
    it('flags a missing/empty backup dir as stale', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'coldemail-bk-'));
      const alerts = new CapturingAlerts();
      const res = await runSelfCheckJob({ db, alerts, backupDir: dir, now: () => NOW });

      expect(res.backupStale).toBe(true);
      expect(alerts.emitted.some((e) => e.payload.check === 'backup_stale')).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });

    it('is satisfied by a recent dump', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'coldemail-bk-'));
      writeFileSync(path.join(dir, 'coldemail-20260301-000000.dump'), 'x'); // mtime ≈ now
      const alerts = new CapturingAlerts();
      const res = await runSelfCheckJob({ db, alerts, backupDir: dir, now: () => new Date() });

      expect(res.backupStale).toBe(false);
      expect(alerts.emitted.some((e) => e.payload.check === 'backup_stale')).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('weekly rebuild-compare', () => {
    it('stays silent when projections fold from the log', async () => {
      const alerts = new CapturingAlerts();
      const res = await runRebuildCompareJob({ db, sequences, alerts, now: () => NOW });
      expect(res.diffs).toHaveLength(0);
      expect(alerts.emitted).toHaveLength(0);
    });

    it('raises one selfcheck_drift when a projection drifts from the log', async () => {
      await pool.query(
        `UPDATE enrollments SET soft_bounce_retries = soft_bounce_retries + 5 WHERE id = 1`,
      );
      const alerts = new CapturingAlerts();
      const res = await runRebuildCompareJob({ db, sequences, alerts, now: () => NOW });

      expect(res.diffs.length).toBeGreaterThan(0);
      expect(alerts.emitted).toHaveLength(1);
      expect(alerts.emitted[0]).toMatchObject({ kind: 'selfcheck_drift', severity: 'error' });
      expect(alerts.emitted[0]!.payload.check).toBe('rebuild_compare');

      await normalize();
    });
  });
});
