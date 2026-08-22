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
  'GOOGLE_OAUTH_CLIENT_SECRET',
  '*.SECRET_KEY',
  '*.SESSION_KEY',
  '*.ANTHROPIC_API_KEY',
  '*.GOOGLE_OAUTH_CLIENT_SECRET',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

/**
 * Unsubscribe tokens are capabilities carried in the URL path, and Fastify's
 * default request logger writes the full URL on EVERY request — so without
 * this the token lands in plaintext logs the moment a recipient clicks. Path
 * redaction has to happen in a serializer rather than `redact` paths, because
 * the secret is inside a string value, not at a key.
 */
const UNSUBSCRIBE_PATH = /^(\/u\/)[^/?#]+/;
const OAUTH_CALLBACK_SECRETS = /([?&](?:code|state)=)[^&#]*/g;

function redactUrl(url: string): string {
  return url
    .replace(UNSUBSCRIBE_PATH, '$1[REDACTED]')
    .replace(OAUTH_CALLBACK_SECRETS, '$1[REDACTED]');
}

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      // Mirrors pino-http's default req shape EXACTLY — never spread the raw
      // request, which carries the parsed body (and therefore every password
      // ever POSTed) into the log line. B7.1's sentinel grep catches that.
      req(req: {
        method?: string;
        url?: string;
        ip?: string;
        headers?: Record<string, unknown>;
        socket?: { remotePort?: number };
      }) {
        // Pick fields explicitly. NEVER spread the raw request: it carries the
        // parsed body, so `{...req}` puts every POSTed password in the log
        // line (B7.1's sentinel grep catches that). `headers` is safe and is
        // kept deliberately — REDACT_PATHS scrubs cookie/authorization, and
        // dropping it would blind the request log for debugging.
        return {
          method: req.method,
          url: typeof req.url === 'string' ? redactUrl(req.url) : req.url,
          headers: req.headers,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
    // pretty-print in dev only; prod and tests stay machine-readable JSON
    ...(config.NODE_ENV === 'development' && !destination
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}
