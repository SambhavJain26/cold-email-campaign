// B7.4 — DbAlertSink ⇄ webhook wiring (decision V). The alert row is the
// durable record; the webhook is a best-effort forward of {kind, severity,
// ...payload} that must never break the emit.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { DbAlertSink, type AlertWebhook } from '../../src/alerts/emitter';
import { listUnacked } from '../../src/db/repos/alertsRepo';
import { resetCoreTables, TEST_DATABASE_URL } from '../helpers/db';

const { db, pool } = createDb(TEST_DATABASE_URL);

describe('DbAlertSink webhook wiring (B7.4)', () => {
  beforeEach(async () => {
    await resetCoreTables(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('inserts the alert AND forwards {kind, severity, ...payload} to the webhook', async () => {
    const calls: Record<string, unknown>[] = [];
    const webhook: AlertWebhook = {
      post: (p) => {
        calls.push(p);
        return Promise.resolve();
      },
    };
    await new DbAlertSink(db, webhook).emit('selfcheck_drift', 'error', {
      check: 'invariants',
      n: 3,
    });

    const rows = await listUnacked(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('selfcheck_drift');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: 'selfcheck_drift',
      severity: 'error',
      check: 'invariants',
      n: 3,
    });
  });

  it('still inserts and resolves when the webhook rejects (never fatal)', async () => {
    const webhook: AlertWebhook = { post: () => Promise.reject(new Error('relay down')) };
    await expect(
      new DbAlertSink(db, webhook).emit('job_failed', 'error', { error: 'x' }),
    ).resolves.toBeUndefined();
    expect(await listUnacked(db)).toHaveLength(1);
  });

  it('inserts with no webhook configured', async () => {
    await expect(new DbAlertSink(db).emit('imap_stale', 'warning', {})).resolves.toBeUndefined();
    expect(await listUnacked(db)).toHaveLength(1);
  });
});
