// API test harness (B6.14, docs/13 §1): the real compose() graph over the
// test DB + VirtualClock, exercised via fastify.inject — no listening socket.
// inject() lazily logs in and auto-attaches the session cookie + CSRF header.
import { Writable } from 'node:stream';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { parseEnv, type Config } from '../../../src/config/env';
import { createLogger } from '../../../src/config/logger';
import { buildServer } from '../../../src/api/server';
import { compose, type AppServices, type ComposeOverrides } from '../../../src/composition';
import { ensureOperator } from '../../../src/services/operatorAuth';
import { VirtualClock } from '../../../src/clock/virtual';
import { resetCoreTables, TEST_DATABASE_URL } from '../../helpers/db';

export const TEST_OPERATOR = {
  email: 'operator@test.dev',
  password: 'correct-horse-battery',
};

/**
 * Extract the `session=<encoded>` pair from a response's raw Set-Cookie
 * header. NOTE: res.cookies[].value is DECODED — secure-session values
 * contain `;` (payload;nonce), so reconstructing from it corrupts the
 * Cookie header. Always take the raw encoded segment.
 */
export function sessionCookieFrom(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const all = Array.isArray(header) ? header : header ? [header] : [];
  const raw = all.find((h) => h.startsWith('session='));
  if (!raw) throw new Error('no session Set-Cookie in response');
  return raw.split(';')[0]!;
}

export function testConfig(env: Record<string, string> = {}): Config {
  const parsed = parseEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    SECRET_KEY: 'ab'.repeat(32),
    SESSION_KEY: 'cd'.repeat(32),
    OPERATOR_EMAIL: TEST_OPERATOR.email,
    OPERATOR_INITIAL_PASSWORD: TEST_OPERATOR.password,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    ...env,
  });
  if (!parsed.success) throw new Error(`testConfig invalid: ${parsed.issues.join('; ')}`);
  return parsed.config;
}

export interface ApiHarness {
  app: FastifyInstance;
  services: AppServices;
  clock: VirtualClock;
  pool: Pool;
  config: Config;
  /** TRUNCATE core tables (incl. operator) + re-seed the operator row. */
  reset(): Promise<void>;
  /** POST /auth/login as the test operator; returns the Cookie header value. */
  login(): Promise<string>;
  /** inject() with session cookie + X-Requested-With attached (logs in on first use). */
  inject(opts: InjectOptions): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function createApiHarness(
  overrides: ComposeOverrides = {},
  env: Record<string, string> = {},
): Promise<ApiHarness> {
  const config = testConfig(env);
  const clock = (overrides.clock as VirtualClock | undefined) ?? new VirtualClock();
  const services = compose(config, {
    databaseUrl: TEST_DATABASE_URL,
    jobPort: { scheduleConfirmDelivery: () => Promise.resolve() },
    ...overrides,
    clock,
  });
  const silent = new Writable({ write: (_c, _e, cb) => cb() });
  const app = buildServer({
    logger: createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' }, silent),
    services,
  });
  await app.ready();
  await resetCoreTables(services.pool);
  await ensureOperator(services.db, config);

  // The sealed session cookie is stateless — it survives reset() (which only
  // re-creates the identical operator row), so cache it across the file.
  let cookie: string | null = null;

  const login = async (): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'fetch' },
      payload: { email: TEST_OPERATOR.email, password: TEST_OPERATOR.password },
    });
    if (res.statusCode !== 200) {
      throw new Error(`harness login failed: ${res.statusCode} ${res.body}`);
    }
    cookie = sessionCookieFrom(res);
    return cookie;
  };

  return {
    app,
    services,
    clock,
    pool: services.pool,
    config,
    reset: async () => {
      await resetCoreTables(services.pool);
      await ensureOperator(services.db, config);
    },
    login,
    inject: async (opts) => {
      const c = cookie ?? (await login());
      const res = await app.inject({
        ...opts,
        headers: { 'x-requested-with': 'fetch', cookie: c, ...(opts.headers ?? {}) },
      });
      return res;
    },
    close: async () => {
      await app.close();
      await services.pool.end();
    },
  };
}
