// Scheduled integrity jobs (B7.3, docs/16 §4). Nothing here fails silently:
// an invariant violation, a projection that no longer folds from the log, or a
// missing/stale backup each raises a `selfcheck_drift` alert (error severity).
// The runners are plain functions (like runConfirmDelivery) so they can be
// driven directly in tests with a CapturingAlerts sink.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client';
import { getSettings } from '../db/repos/settingsRepo';
import { selfCheckViolations, type SelfCheckViolation } from '../db/repos/metricsRepo';
import { rebuildProjections, type RebuildResult } from '../services/rebuildProjections';
import { loadCampaignShapes } from '../services/campaignShapes';
import type { SequenceProvider } from '../scheduler/types';
import type { AlertSink } from '../alerts/types';

// Backup runs nightly ~02:30 and the self-check ~03:00, so the newest dump is
// normally < 1h old; older than this means a nightly backup was missed.
const BACKUP_STALE_MS = 26 * 3_600_000;

/** mtime age of the newest `coldemail-*.dump` in `dir`, or null if none/no dir. */
export function latestBackupAgeMs(dir: string, now: Date): number | null {
  let newest = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('coldemail-') || !name.endsWith('.dump')) continue;
      newest = Math.max(newest, statSync(path.join(dir, name)).mtimeMs);
    }
  } catch {
    return null; // dir missing/unreadable — treat as no backup
  }
  return newest === 0 ? null : now.getTime() - newest;
}

export interface SelfCheckJobDeps {
  db: Db;
  alerts: AlertSink;
  /** config.BACKUP_DIR — omit to skip the backup-freshness check. */
  backupDir?: string;
  now: () => Date;
}

export interface SelfCheckJobResult {
  violations: SelfCheckViolation[];
  backupStale: boolean;
}

/** Daily: event-log ⇔ projection invariants (docs/04 §4) + backup freshness. */
export async function runSelfCheckJob(deps: SelfCheckJobDeps): Promise<SelfCheckJobResult> {
  const violations = await selfCheckViolations(deps.db, null);
  if (violations.length > 0) {
    await deps.alerts.emit('selfcheck_drift', 'error', { check: 'invariants', violations });
  }

  let backupStale = false;
  if (deps.backupDir) {
    const age = latestBackupAgeMs(deps.backupDir, deps.now());
    backupStale = age === null || age > BACKUP_STALE_MS;
    if (backupStale) {
      await deps.alerts.emit('selfcheck_drift', 'error', {
        check: 'backup_stale',
        backup_dir: deps.backupDir,
        age_hours: age === null ? null : Math.round(age / 3_600_000),
      });
    }
  }
  return { violations, backupStale };
}

export interface RebuildCompareJobDeps {
  db: Db;
  sequences: SequenceProvider;
  alerts: AlertSink;
  now: () => Date;
}

/** Weekly: replay the log and diff derived state against the stored projections. */
export async function runRebuildCompareJob(deps: RebuildCompareJobDeps): Promise<RebuildResult> {
  const settings = await getSettings(deps.db);
  const shapeFor = await loadCampaignShapes(deps.db, deps.sequences, settings.softRetryMax);
  const result = await rebuildProjections(deps.db, {
    dryRun: true,
    shapeFor,
    deliveryConfirmMs: settings.deliveryConfirmHours * 3_600_000,
    now: deps.now(),
  });
  if (result.diffs.length > 0) {
    await deps.alerts.emit('selfcheck_drift', 'error', {
      check: 'rebuild_compare',
      diffs: result.diffs.length,
      sample: result.diffs.slice(0, 10).map((d) => ({
        enrollment_id: d.enrollmentId,
        field: d.field,
        stored: d.stored,
        derived: d.derived,
      })),
    });
  }
  return result;
}
