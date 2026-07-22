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
import { StaticSequenceProvider } from './scheduler/staticSequenceProvider';
import { StubRenderer } from './render/stub';
import type { JobPort } from './scheduler/types';
import { DbAlertSink } from './alerts/emitter';
import { systemRng, type Rng } from './util/rng';

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
  sequences: StaticSequenceProvider;
}

export interface ComposeOverrides {
  /** Tests inject VirtualClock, a scripted MockTransport, and the test pool here. */
  clock?: Clock;
  transport?: MailTransport;
  databaseUrl?: string;
  rng?: Rng;
  /** Tests inject an inline job queue instead of pg-boss. */
  jobPort?: JobPort;
}

export function compose(config: Config, overrides: ComposeOverrides = {}): AppServices {
  const clock = overrides.clock ?? new SystemClock();

  const transport =
    overrides.transport ??
    (config.MAIL_TRANSPORT === 'smtp_imap'
      ? new NotImplementedTransport('SmtpImapTransport arrives in B8')
      : new MockTransport(clock));

  const databaseUrl = overrides.databaseUrl ?? config.DATABASE_URL;
  const { db, pool } = createDb(databaseUrl);

  const store = new EventStore(db);
  const alerts = new DbAlertSink(db); // webhook wired at B7.4
  const sequences = new StaticSequenceProvider(); // DB-backed provider at B4
  const renderer = new StubRenderer(); // real render engine at B4
  const rng = overrides.rng ?? systemRng;

  // Late-bound JobPort: scheduler → jobs → scheduler is a cycle on paper;
  // in practice jobs only calls back into tick/poll handlers.
  const jobPort: JobPort = overrides.jobPort ?? {
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
    scheduler,
    poller,
    confirmDelivery: { db, store, clock },
    alerts,
  });

  return { config, clock, transport, db, pool, store, scheduler, poller, jobs, sequences };
}
