// THE composition root (docs/02 §4): the only file that imports concrete
// Clock and MailTransport implementations. Everything else depends on the
// interfaces. Grows as stages land: db + eventStore (B1), scheduler/poller
// (B3), api (B6), jobs (B3/B7).
import type { Config } from './config/env';
import type { Clock } from './clock';
import { SystemClock } from './clock/system';
import type { MailTransport } from './transport/types';
import { NotImplementedTransport } from './transport/stub';

export interface AppServices {
  config: Config;
  clock: Clock;
  transport: MailTransport;
}

export interface ComposeOverrides {
  /** Tests inject VirtualClock and a scripted MockTransport here. */
  clock?: Clock;
  transport?: MailTransport;
}

export function compose(config: Config, overrides: ComposeOverrides = {}): AppServices {
  const clock = overrides.clock ?? new SystemClock();

  const transport =
    overrides.transport ??
    (config.MAIL_TRANSPORT === 'smtp_imap'
      ? new NotImplementedTransport('SmtpImapTransport arrives in B8')
      : new NotImplementedTransport('MockTransport arrives in B3'));

  return { config, clock, transport };
}
