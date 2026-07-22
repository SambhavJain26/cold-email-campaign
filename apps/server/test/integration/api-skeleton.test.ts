// Fastify skeleton: /health against the real test DB + error envelope contract.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server';
import { AppError } from '../../src/api/errors';
import { createLogger } from '../../src/config/logger';
import { getTestPool } from '../helpers/db';

describe('api skeleton', () => {
  let app: FastifyInstance;
  let pool: Pool;

  beforeAll(async () => {
    pool = getTestPool();
    const silent = new Writable({ write: (_c, _e, cb) => cb() });
    app = buildServer({
      logger: createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' }, silent),
      pool,
    });
    // test-only routes exercising the central error mapping
    app.get('/boom-app-error', () => {
      throw new AppError('conflict', 409, 'already exists', { id: 7 });
    });
    app.get('/boom-unknown', () => {
      throw new Error('secret internal detail');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
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
});
