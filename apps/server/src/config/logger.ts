// Structured logging (docs/02 §6): pino JSON lines, child logger per module,
// secrets redacted at the logger level as defense-in-depth (the real guarantee
// is never passing secrets to log calls; B7.1 adds the grep-proof).
import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './env';

export type { Logger };

/** Secret-bearing key paths. pino wildcards match one level; common nestings listed explicitly. */
const REDACT_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'secret',
  '*.secret',
  'app_password',
  '*.app_password',
  'sealed',
  '*.sealed',
  'SECRET_KEY',
  'SESSION_KEY',
  'ANTHROPIC_API_KEY',
  '*.SECRET_KEY',
  '*.SESSION_KEY',
  '*.ANTHROPIC_API_KEY',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // pretty-print in dev only; prod and tests stay machine-readable JSON
    ...(config.NODE_ENV === 'development' && !destination
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}
