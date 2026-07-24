// THE composition root (docs/02 §4): the only file that imports concrete
// Clock and MailTransport implementations. Everything else depends on the
// interfaces. Grows as stages land: db + eventStore (B1), scheduler/poller/
// jobs (B3), api (B6).
import type { Pool } from 'pg';
import type { Config } from './config/env';
import type { Clock } from './clock';
import { SystemClock } from './clock/system';
import type { MailTransport } from './transport/types';
import { NotImplementedTransport } from './transport/stub';
import { MockTransport } from './transport/mock/mockTransport';
import { createDb, type Db } from './db/client';
import { EventStore } from './services/eventStore';
import { Scheduler } from './scheduler/scheduler';
import { Poller } from './poller/poller';
import { Jobs } from './jobs';
import { DbSequenceProvider } from './scheduler/dbSequenceProvider';
import { RenderEngine } from './render/engine';
import type { JobPort, Renderer, SequenceProvider } from './scheduler/types';
import { DbAlertSink } from './alerts/emitter';
import { HttpAlertWebhook } from './alerts/webhook';
import { systemRng, type Rng } from './util/rng';
import { MetricsEngine } from './services/metrics';
import { InlineJobQueue, SimulationDriver } from './services/simulation';
import { isSteppable } from './clock';
import { VirtualClock } from './clock/virtual';

export interface AppServices {
  config: Config;
  clock: Clock;
  transport: MailTransport;
  db: Db;
  pool: Pool;
  store: EventStore;
  scheduler: Scheduler;
  poller: Poller;
  /** Started by main.ts when ROLE ∈ {worker, all}. */
  jobs: Jobs;
  sequences: SequenceProvider;
  /** The one engine instance - manualCompose (B4.10) and B6 previews share it. */
  renderer: Renderer;
  /** B6.9 analytics routes read through this. */
  metrics: MetricsEngine;
  /** Present ONLY when config.SIMULATED_CLOCK (B6.12 advance-clock). */
  simulation?: SimulationDriver;
}

export interface ComposeOverrides {
  /** Tests inject VirtualClock, a scripted MockTransport, and the test pool here. */
  clock?: Clock;
  transport?: MailTransport;
  databaseUrl?: string;
  rng?: Rng;
  /** Tests inject an inline job queue instead of pg-boss. */
  jobPort?: JobPort;
  /** Tests inject a StaticSequenceProvider instead of the DB-backed one. */
  sequences?: SequenceProvider;
}

export function compose(config: Config, overrides: ComposeOverrides = {}): AppServices {
  const clock =
    overrides.clock ?? (config.SIMULATED_CLOCK ? new VirtualClock() : new SystemClock());

  const transport =
    overrides.transport ??
    (config.MAIL_TRANSPORT === 'smtp_imap'
      ? new NotImplementedTransport('SmtpImapTransport arrives in B8')
      : new MockTransport(clock));

  const databaseUrl = overrides.databaseUrl ?? config.DATABASE_URL;
  const { db, pool } = createDb(databaseUrl);

  const store = new EventStore(db);
  const alerts = new DbAlertSink(
    db,
    config.ALERT_WEBHOOK_URL ? new HttpAlertWebhook(config.ALERT_WEBHOOK_URL) : undefined,
  );
  const sequences = overrides.sequences ?? new DbSequenceProvider(db); // 0003 tables (B4.1)
  const renderer = new RenderEngine(); // docs/08 - the only producer of outbound bodies
  const rng = overrides.rng ?? systemRng;

  // SIMULATED_CLOCK: pg-boss cron fires on wall time - meaningless against
  // virtual time - so confirm-delivery goes through an inline queue the
  // SimulationDriver drains during advance-clock (docs/13 §5).
  const inlineQueue = config.SIMULATED_CLOCK && !overrides.jobPort ? new InlineJobQueue() : null;

  // Late-bound JobPort: scheduler → jobs → scheduler is a cycle on paper;
  // in practice jobs only calls back into tick/poll handlers.
  const jobPort: JobPort = overrides.jobPort ??
    inlineQueue ?? {
      scheduleConfirmDelivery: (job) => jobs.scheduleConfirmDelivery(job),
    };

  const scheduler = new Scheduler({
    db,
    pool,
    store,
    transport,
    clock,
    rng,
    sequences,
    renderer,
    jobs: jobPort,
    alerts,
  });
  const poller = new Poller({ db, store, transport, clock, alerts });
  const jobs = new Jobs({
    connectionString: databaseUrl,
    db,
    clock,
    scheduler,
    poller,
    sequences,
    confirmDelivery: { db, store, clock },
    alerts,
    backupDir: config.BACKUP_DIR,
  });

  // SIMULATED_CLOCK forbids smtp_imap (env superRefine), so transport is the
  // MockTransport here - expose its scripting surface to the driver.
  const simulation =
    config.SIMULATED_CLOCK &&
    inlineQueue !== null &&
    isSteppable(clock) &&
    transport instanceof MockTransport
      ? new SimulationDriver({
          db,
          clock,
          scheduler,
          poller,
          queue: inlineQueue,
          confirmDelivery: { db, store, clock },
          scripting: transport,
        })
      : undefined;

  return {
    config,
    clock,
    transport,
    db,
    pool,
    store,
    scheduler,
    poller,
    jobs,
    sequences,
    renderer,
    metrics: new MetricsEngine(db),
    ...(simulation && { simulation }),
  };
}
