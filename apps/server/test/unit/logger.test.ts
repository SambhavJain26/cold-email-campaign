import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/config/logger';

function captureLogger() {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const log = createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'test' }, dest);
  return { log, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('createLogger redaction', () => {
  it('redacts password/secret keys at top level and nested', () => {
    const { log, parsed } = captureLogger();
    log.info(
      { password: 'hunter2', mailbox: { password: 'app-pw', host: 'smtp.x.com' }, secret: 's' },
      'connecting',
    );
    const [line] = parsed();
    expect(line!.password).toBe('[REDACTED]');
    expect((line!.mailbox as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((line!.mailbox as Record<string, unknown>).host).toBe('smtp.x.com'); // non-secrets survive
    expect(line!.secret).toBe('[REDACTED]');
  });

  it('redacts cookie/authorization request headers and env key names', () => {
    const { log, parsed } = captureLogger();
    log.info({
      req: { headers: { cookie: 'session=abc', authorization: 'Bearer x', accept: 'json' } },
      SECRET_KEY: 'deadbeef',
    });
    const [line] = parsed();
    const headers = (line!.req as { headers: Record<string, unknown> }).headers;
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.accept).toBe('json');
    expect(line!.SECRET_KEY).toBe('[REDACTED]');
  });

  it('respects the configured level', () => {
    const { log, parsed } = captureLogger();
    log.debug({ x: 1 }, 'below level');
    log.info({ x: 2 }, 'at level');
    expect(parsed()).toHaveLength(1);
  });
});
