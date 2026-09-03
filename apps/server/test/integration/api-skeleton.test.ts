// Fastify skeleton: /health against the real test DB + error envelope contract.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildServer } from '../../src/api/server';
import { registerZodCompilers } from '../../src/api/plugins/zodCompilers';
import { AppError } from '../../src/api/errors';
import { createLogger } from '../../src/config/logger';
import { compose, type AppServices } from '../../src/composition';
import { testConfig } from '../api/helpers/app';
import { TEST_DATABASE_URL } from '../helpers/db';

describe('api skeleton', () => {
  let app: FastifyInstance;
  let services: AppServices;

  beforeAll(async () => {
    const config = testConfig();
    services = compose(config, { databaseUrl: TEST_DATABASE_URL });
    const silent = new Writable({ write: (_c, _e, cb) => cb() });
    app = buildServer({
      logger: createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' }, silent),
      services,
    });
    // test-only routes exercising the central error mapping
    app.get('/boom-app-error', () => {
      throw new AppError('conflict', 409, 'already exists', { id: 7 });
    });
    app.get('/boom-unknown', () => {
      throw new Error('secret internal detail');
    });
    app.get('/request-origin', (req) => ({
      host: req.host,
      hostname: req.hostname,
      protocol: req.protocol,
      ip: req.ip,
    }));
    // Exercise the application's actual compiler with the root-primitive shape
    // described in GHSA-w2qp-rph6-63g4. The handler must receive parsed data.
    void app.register(async (probe) => {
      registerZodCompilers(probe);
      probe.post(
        '/validated-primitive',
        { schema: { body: z.coerce.number().int().min(1).max(10) } },
        (req) => ({ value: req.body, type: typeof req.body }),
      );
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await services.pool.end();
  });

  it('GET /health reports ok with db reachable and a version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, version: '0.0.0' });
  });

  it('AppError maps to its envelope with status, code, details', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-app-error' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'conflict', message: 'already exists', details: { id: 7 } },
    });
  });

  it('unknown errors become 500 internal without leaking the message', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-unknown' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
  });

  it('unknown routes get the not_found envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('passes a coerced root primitive to the handler as its validated type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/validated-primitive',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify('10'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: 10, type: 'number' });
  });

  it('rejects a root primitive outside the validated bound', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/validated-primitive',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify('11'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('does not trust spoofed forwarding headers on the application origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/request-origin',
      remoteAddress: '127.0.0.1',
      headers: {
        host: 'app.internal',
        'x-forwarded-host': 'attacker.invalid',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.20',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      host: 'app.internal',
      hostname: 'app.internal',
      protocol: 'http',
      ip: '127.0.0.1',
    });
  });
});
