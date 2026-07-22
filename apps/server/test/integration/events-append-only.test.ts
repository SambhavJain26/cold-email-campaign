// B1.10: append-only on `events` is physically enforced - trigger blocks the
// owner; the app_rw role additionally lacks UPDATE/DELETE grants entirely.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { getTestPool, resetCoreTables } from '../helpers/db';

describe('events append-only enforcement', () => {
  let pool: Pool;
  let eventId: number;

  beforeAll(async () => {
    pool = getTestPool();
    await resetCoreTables(pool);
    const lead = await pool.query(
      `INSERT INTO leads (email) VALUES ('appendonly@test.dev') RETURNING id`,
    );
    const ev = await pool.query(
      `INSERT INTO events (type, occurred_at, lead_id) VALUES ('enrolled', now(), $1) RETURNING id`,
      [lead.rows[0].id],
    );
    eventId = ev.rows[0].id;
  });

  afterAll(async () => {
    // row DELETE on events is blocked by design - TRUNCATE is the reset path
    await resetCoreTables(pool);
    await pool.end();
  });

  it('trigger rejects UPDATE even for the table owner', async () => {
    await expect(
      pool.query(`UPDATE events SET reason = 'edited' WHERE id = $1`, [eventId]),
    ).rejects.toThrow(/append-only/);
  });

  it('trigger rejects DELETE even for the table owner', async () => {
    await expect(pool.query(`DELETE FROM events WHERE id = $1`, [eventId])).rejects.toThrow(
      /append-only/,
    );
  });

  it('app_rw lacks UPDATE/DELETE grants on events but can INSERT and SELECT', async () => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE app_rw');

      await expect(
        client.query(`UPDATE events SET reason = 'x' WHERE id = $1`, [eventId]),
      ).rejects.toThrow(/permission denied/);
      await expect(client.query(`DELETE FROM events WHERE id = $1`, [eventId])).rejects.toThrow(
        /permission denied/,
      );

      const sel = await client.query(`SELECT id FROM events WHERE id = $1`, [eventId]);
      expect(sel.rows).toHaveLength(1);

      const leadId = (await client.query(`SELECT lead_id FROM events WHERE id = $1`, [eventId]))
        .rows[0].lead_id;
      const ins = await client.query(
        `INSERT INTO events (type, occurred_at, lead_id) VALUES ('sent', now(), $1) RETURNING id`,
        [leadId],
      );
      expect(ins.rows[0].id).toBeGreaterThan(eventId);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it('other core tables remain writable for app_rw (only events is locked)', async () => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE app_rw');
      const res = await client.query(
        `UPDATE leads SET notes = 'writable' WHERE email = 'appendonly@test.dev' RETURNING id`,
      );
      expect(res.rows).toHaveLength(1);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});
