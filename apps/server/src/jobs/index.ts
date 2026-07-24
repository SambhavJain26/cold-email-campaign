// pg-boss wiring (B3.16, docs/02 §2): cron scheduler-tick, per-mailbox
// imap-poll, delayed confirm-delivery. Everything here is THIN - the business
// logic lives in scheduler/, poller/, and runConfirmDelivery; in integration
// tests those run inline via the scenario runner's queue, and this file gets
// only a boot/schedule/execute smoke test.
import { PgBoss } from 'pg-boss';
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { Scheduler } from '../scheduler/scheduler';
import type { Poller } from '../poller/poller';
import { runConfirmDelivery, type ConfirmDeliveryDeps } from '../scheduler/confirmDelivery';
import { runSelfCheckJob, runRebuildCompareJob } from './integrity';
import type { ConfirmDeliveryJob, JobPort, SequenceProvider } from '../scheduler/types';
import type { AlertSink } from '../alerts/types';
import { getSettings } from '../db/repos/settingsRepo';
import { listMailboxesByStatus } from '../db/repos/mailboxesRepo';

export interface JobsDeps {
  connectionString: string;
  db: Db;
  clock: Clock;
  scheduler: Scheduler;
  poller: Poller;
  sequences: SequenceProvider;
  confirmDelivery: ConfirmDeliveryDeps;
  alerts: AlertSink;
  /** config.BACKUP_DIR - the daily self-check flags a missing/stale dump. */
  backupDir?: string;
}

const TICK_QUEUE = 'scheduler-tick';
const CONFIRM_QUEUE = 'confirm-delivery';
const SELFCHECK_QUEUE = 'self-check';
const REBUILD_COMPARE_QUEUE = 'rebuild-compare';
const pollQueue = (mailboxId: number) => `imap-poll-${mailboxId}`;

export class Jobs implements JobPort {
  private boss: PgBoss | null = null;
  /** Mailbox ids whose poll queue+worker are already registered this process. */
  private readonly registered = new Set<number>();

  constructor(private readonly deps: JobsDeps) {}

  /** Boot: start pg-boss, register queues + workers, install cron schedules. */
  async start(): Promise<void> {
    const { connectionString, db, scheduler, alerts } = this.deps;
    const boss = new PgBoss({ connectionString });
    boss.on('error', (err: unknown) => {
      void alerts.emit('job_failed', 'error', { error: String(err) });
    });
    await boss.start();
    this.boss = boss;

    const settings = await getSettings(db);
    const tickCron = `*/${Math.min(59, Math.max(1, settings.schedulerTickMinutes))} * * * *`;
    const pollCron = `*/${Math.min(59, Math.max(1, settings.pollIntervalMinutes))} * * * *`;

    await boss.createQueue(TICK_QUEUE);
    await boss.work(TICK_QUEUE, async () => {
      await scheduler.tick();
    });
    await boss.schedule(TICK_QUEUE, tickCron, undefined, { retryLimit: 1 });

    // Delayed confirm-delivery jobs (decision N).
    await boss.createQueue(CONFIRM_QUEUE);
    await boss.work<{ enrollmentId: number; stepNo: number; sentAtIso: string }>(
      CONFIRM_QUEUE,
      async (jobs) => {
        for (const job of jobs) {
          await runConfirmDelivery(this.deps.confirmDelivery, {
            enrollmentId: job.data.enrollmentId,
            stepNo: job.data.stepNo,
            sentAt: new Date(job.data.sentAtIso),
            runAt: new Date(),
          });
        }
      },
    );

    // Scheduled integrity safety jobs (B7.3, docs/16 §4). Both raise a
    // selfcheck_drift alert on failure rather than logging quietly.
    await boss.createQueue(SELFCHECK_QUEUE);
    await boss.work(SELFCHECK_QUEUE, async () => {
      await runSelfCheckJob({
        db,
        alerts,
        backupDir: this.deps.backupDir,
        now: () => this.deps.clock.now(),
      });
    });
    await boss.schedule(SELFCHECK_QUEUE, '0 3 * * *', undefined, { retryLimit: 1 }); // daily 03:00

    await boss.createQueue(REBUILD_COMPARE_QUEUE);
    await boss.work(REBUILD_COMPARE_QUEUE, async () => {
      await runRebuildCompareJob({
        db,
        sequences: this.deps.sequences,
        alerts,
        now: () => this.deps.clock.now(),
      });
    });
    await boss.schedule(REBUILD_COMPARE_QUEUE, '0 4 * * 0', undefined, { retryLimit: 1 }); // Sun 04:00

    // One poll queue per non-auth_failed mailbox (docs/07 §1). Mailboxes
    // added later re-register via registerMailboxPoll (B6 mailbox routes).
    const boxes = await listMailboxesByStatus(db, [
      'ok',
      'paused',
      'auto_paused',
      'imap_stale',
      'provider_blocked',
    ]);
    for (const mb of boxes) {
      await this.registerMailboxPoll(mb.id, pollCron);
    }
  }

  /**
   * Register (once) the poll cron for a mailbox. Called at boot for existing
   * mailboxes AND by the B6.2 routes when a mailbox is created or reconnected -
   * without that, a mailbox added through the UI is never polled until the
   * process restarts (its replies, bounces and STOPs stay invisible).
   *
   * No-op when pg-boss isn't running (ROLE=api, SIMULATED_CLOCK, tests): there
   * are no polls to schedule in those modes. Idempotent - registering twice
   * would attach a second worker to the same queue and double-poll.
   */
  async registerMailboxPoll(mailboxId: number, cron?: string): Promise<void> {
    if (!this.boss) return;
    if (this.registered.has(mailboxId)) return;
    this.registered.add(mailboxId);
    const boss = this.boss;
    const settings = await getSettings(this.deps.db);
    const queue = pollQueue(mailboxId);
    await boss.createQueue(queue);
    await boss.work(queue, async () => {
      await this.deps.poller.poll(mailboxId);
    });
    await boss.schedule(
      queue,
      cron ?? `*/${Math.min(59, Math.max(1, settings.pollIntervalMinutes))} * * * *`,
      undefined,
      { retryLimit: 3, retryBackoff: true },
    );
  }

  /** JobPort (docs/06 §5): schedule the delayed delivered-confirmation. */
  async scheduleConfirmDelivery(job: ConfirmDeliveryJob): Promise<void> {
    const boss = this.mustBoss();
    await boss.send(
      CONFIRM_QUEUE,
      {
        enrollmentId: job.enrollmentId,
        stepNo: job.stepNo,
        sentAtIso: job.sentAt.toISOString(),
      },
      { startAfter: job.runAt, retryLimit: 5, retryBackoff: true },
    );
  }

  /**
   * GET /system/status: the confirm-delivery backlog - the only queue where
   * "pending" is operationally meaningful. 0 when pg-boss isn't running
   * (ROLE=api, SIMULATED_CLOCK, tests).
   */
  async pendingCount(): Promise<number> {
    if (!this.boss) return 0;
    const stats = await this.boss.getQueueStats(CONFIRM_QUEUE);
    return stats.reduce((a, s) => a + s.queuedCount + s.deferredCount + s.activeCount, 0);
  }

  async stop(): Promise<void> {
    if (this.boss) {
      await this.boss.stop({ graceful: false });
      this.boss = null;
      this.registered.clear();
    }
  }

  private mustBoss(): PgBoss {
    if (!this.boss) throw new Error('Jobs.start() has not been called');
    return this.boss;
  }
}
