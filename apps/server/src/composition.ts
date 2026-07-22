// THE composition root (docs/02 §4): the only file that imports concrete
// Clock and MailTransport implementations. Everything else depends on the
// interfaces. Grows as stages land: db + eventStore (B1), scheduler/poller
// (B3), api (B6), jobs (B3/B7).
import type { Pool } from 'pg';
import type { Config } from './config/env';
import type { Clock } from './clock';
import { SystemClock } from './clock/system';
import type { MailTransport } from './transport/types';
import { NotImplementedTransport } from './transport/stub';
import { createDb, type Db } from './db/client';

export interface AppServices {
  config: Config;
  clock: Clock;
  transport: MailTransport;
  db: Db;
  pool: Pool;
}

export interface ComposeOverrides {
  /** Tests inject VirtualClock, a scripted MockTransport, and the test pool here. */
  clock?: Clock;
  transport?: MailTransport;
  databaseUrl?: string;
}

export function compose(config: Config, overrides: ComposeOverrides = {}): AppServices {
  const clock = overrides.clock ?? new SystemClock();

  const transport =
    overrides.transport ??
    (config.MAIL_TRANSPORT === 'smtp_imap'
      ? new NotImplementedTransport('SmtpImapTransport arrives in B8')
      : new NotImplementedTransport('MockTransport arrives in B3'));

  const { db, pool } = createDb(overrides.databaseUrl ?? config.DATABASE_URL);

  return { config, clock, transport, db, pool };
}
