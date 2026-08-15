// B6.14 meta-test: enumerate every registered route (onRoute hook) and assert
// the set equals the docs/10 contract manifest — no untested/undocumented
// route can appear, no contract route can silently vanish.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server';
import { compose, type AppServices } from '../../src/composition';
import { createLogger } from '../../src/config/logger';
import { TEST_DATABASE_URL } from '../helpers/db';
import { testConfig } from './helpers/app';

/** The contract manifest (docs/10) — METHOD + path of every v1 route. */
const CONTRACT_ROUTES = [
  'GET /health',
  // Public unsubscribe (docs/16 §8) — deliberately outside /api/v1 so it
  // inherits neither the session plugin nor the CSRF check.
  'GET /u/:token',
  'POST /u/:token',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/change-password',
  'GET /api/v1/mailboxes',
  'GET /api/v1/mailboxes/volume',
  'POST /api/v1/mailboxes',
  'PATCH /api/v1/mailboxes/:id',
  'POST /api/v1/mailboxes/:id/test-connection',
  'POST /api/v1/mailboxes/:id/pause',
  'POST /api/v1/mailboxes/:id/resume',
  'POST /api/v1/mailboxes/:id/reconnect',
  'GET /api/v1/leads',
  'GET /api/v1/leads/:id',
  'PATCH /api/v1/leads/:id',
  'POST /api/v1/leads/:id/erase',
  'POST /api/v1/leads/bulk-tier',
  'DELETE /api/v1/suppressions/:email',
  'POST /api/v1/imports',
  'POST /api/v1/imports/:id/commit',
  'GET /api/v1/imports',
  'GET /api/v1/sequences',
  'POST /api/v1/sequences',
  'PATCH /api/v1/sequences/:id',
  'DELETE /api/v1/sequences/:id',
  'POST /api/v1/sequences/:id/preview',
  'POST /api/v1/sequences/validate-template',
  'GET /api/v1/campaigns',
  'POST /api/v1/campaigns',
  'PATCH /api/v1/campaigns/:id',
  'DELETE /api/v1/campaigns/:id',
  'GET /api/v1/campaigns/:id/capacity',
  'POST /api/v1/campaigns/:id/enroll',
  'GET /api/v1/campaigns/:id/outcomes',
  'POST /api/v1/campaigns/:id/recycle',
  'GET /api/v1/cold-storage',
  'GET /api/v1/unibox',
  'GET /api/v1/unibox/:id',
  'POST /api/v1/unibox/:id/sentiment',
  'POST /api/v1/enrollments/:id/meeting-booked',
  'POST /api/v1/enrollments/:id/snooze',
  'POST /api/v1/enrollments/:id/unsubscribe',
  'POST /api/v1/manual-sends',
  'GET /api/v1/incoming-messages',
  'GET /api/v1/analytics/overview',
  'GET /api/v1/analytics/variants',
  'POST /api/v1/step-variants/:id/deactivate',
  'GET /api/v1/analytics/steps',
  'GET /api/v1/analytics/tiers',
  'GET /api/v1/analytics/health-trend',
  'GET /api/v1/settings',
  'PUT /api/v1/settings',
  'GET /api/v1/compliance',
  'PUT /api/v1/compliance',
  'GET /api/v1/alerts',
  'POST /api/v1/alerts/:id/ack',
  'GET /api/v1/system/preflight',
  'GET /api/v1/system/status',
  'POST /api/v1/system/rebuild-projections',
  // POST /api/v1/system/advance-clock exists ONLY under SIMULATED_CLOCK
].sort();

describe('B6.14 route coverage', () => {
  let app: FastifyInstance;
  let services: AppServices;
  const registered: string[] = [];

  beforeAll(async () => {
    const config = testConfig();
    services = compose(config, { databaseUrl: TEST_DATABASE_URL });
    const silent = new Writable({ write: (_c, _e, cb) => cb() });
    app = buildServer({
      logger: createLogger({ LOG_LEVEL: 'error', NODE_ENV: 'test' }, silent),
      services,
    });
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const m of methods) {
        if (m === 'HEAD' || m === 'OPTIONS') continue; // fastify auto-adds HEAD
        registered.push(`${m} ${route.url}`);
      }
    });
    await app.ready();
    // /health registers synchronously inside buildServer — before this test
    // could attach onRoute — so it's verified via hasRoute instead.
    if (app.hasRoute({ method: 'GET', url: '/health' })) registered.push('GET /health');
  });
  afterAll(async () => {
    await app.close();
    await services.pool.end();
  });

  it('registered routes === the docs/10 contract manifest', () => {
    expect([...new Set(registered)].sort()).toEqual(CONTRACT_ROUTES);
  });
});
