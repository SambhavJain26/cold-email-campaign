// B6.12 SIMULATED_CLOCK mode (docs/13 §5, mock builds only): drives the real
// scheduler + poller + confirm-delivery jobs across a virtual-time jump —
// the API-server twin of the scenario runner's advanceMs loop. Composition
// builds this ONLY when config.SIMULATED_CLOCK is set; the advance-clock
// route registers only when it exists.
import type { Db } from '../db/client';
import { durationMs, type Duration, type SteppableClock } from '../clock';
import type { Scheduler } from '../scheduler/scheduler';
import type { Poller } from '../poller/poller';
import { runConfirmDelivery, type ConfirmDeliveryDeps } from '../scheduler/confirmDelivery';
import type { ConfirmDeliveryJob, JobPort } from '../scheduler/types';
import type {
  ScriptableTransport,
  ScriptedSendOutcome,
  SynthesizeInboundInput,
  VerifyResult,
} from '../transport/types';
import { getSettings } from '../db/repos/settingsRepo';
import { listMailboxes, listMailboxesByStatus } from '../db/repos/mailboxesRepo';

/** In-process JobPort (pg-boss cron is meaningless against virtual time). */
export class InlineJobQueue implements JobPort {
  private jobs: ConfirmDeliveryJob[] = [];

  scheduleConfirmDelivery(job: ConfirmDeliveryJob): Promise<void> {
    this.jobs.push(job);
    return Promise.resolve();
  }

  takeDue(now: Date): ConfirmDeliveryJob[] {
    const due = this.jobs.filter((j) => j.runAt.getTime() <= now.getTime());
    this.jobs = this.jobs.filter((j) => j.runAt.getTime() > now.getTime());
    return due;
  }
}

export interface SimulationDeps {
  db: Db;
  clock: SteppableClock;
  scheduler: Scheduler;
  poller: Poller;
  queue: InlineJobQueue;
  confirmDelivery: ConfirmDeliveryDeps;
  /** The mock transport, as its scripting surface (docs/13 §5). */
  scripting: ScriptableTransport;
}

export class SimulationDriver {
  constructor(private readonly deps: SimulationDeps) {}

  // ── test-only transport scripting (docs/13 §5) ─────────────────────────────
  scriptInbound(input: SynthesizeInboundInput): { uid: number } | null {
    return this.deps.scripting.synthesizeInbound(input);
  }
  scriptSendOutcome(recipient: string, outcome: ScriptedSendOutcome): void {
    this.deps.scripting.onSend(recipient, outcome);
  }
  scriptVerify(fromAddress: string, result: VerifyResult): void {
    this.deps.scripting.onVerify(fromAddress, result);
  }

  /**
   * Step virtual time to now+duration in scheduler_tick_minutes increments;
   * each step runs due confirm-delivery jobs, a scheduler tick, and (at
   * poll_interval cadence) a poll of every non-auth_failed mailbox.
   */
  async advance(d: Duration): Promise<{ now: Date; ticks: number }> {
    const { db, clock, scheduler, poller, queue } = this.deps;
    const settings = await getSettings(db);
    const boxes = await listMailboxes(db);
    const tickMinutes = boxes.some(
      (mb) => mb.sendIntervalMinMinutes !== null || mb.sendIntervalMinutes !== null,
    )
      ? 1
      : settings.schedulerTickMinutes;
    const pollMinutes = settings.pollIntervalMinutes;
    const target = new Date(clock.now().getTime() + durationMs(d));
    let ticks = 0;
    let sinceLastPoll = Number.POSITIVE_INFINITY; // poll on the first step
    await clock.stepTo(target, { minutes: tickMinutes }, async (now) => {
      for (const job of queue.takeDue(now)) {
        await runConfirmDelivery(this.deps.confirmDelivery, {
          enrollmentId: job.enrollmentId,
          stepNo: job.stepNo,
          sentAt: job.sentAt,
          runAt: now,
        });
      }
      await scheduler.tick();
      ticks += 1;
      sinceLastPoll += tickMinutes;
      if (sinceLastPoll >= pollMinutes) {
        sinceLastPoll = 0;
        const boxes = await listMailboxesByStatus(db, [
          'ok',
          'paused',
          'auto_paused',
          'imap_stale',
          'provider_blocked',
        ]);
        for (const mb of boxes) await poller.poll(mb.id);
      }
    });
    return { now: clock.now(), ticks };
  }
}
