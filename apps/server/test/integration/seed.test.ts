// 0002_seed: single settings + compliance rows exist with spec defaults.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { getTestPool } from '../helpers/db';

describe('seeded settings', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = getTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('settings row 1 carries the spec Part 11 auto-pause defaults', async () => {
    const { rows } = await pool.query('SELECT * FROM settings');
    expect(rows).toHaveLength(1);
    const s = rows[0];
    expect(s.pause_min_sends).toBe(25);
    expect(Number(s.pause_hard_pct)).toBe(4.0);
    expect(s.pause_window_sends).toBe(50);
    expect(s.pause_absolute_bounces).toBe(3);
    expect(s.pause_absolute_span).toBe(10);
    expect(s.resume_cap_pct).toBe(50);
    expect(s.soft_retry_max).toBe(2);
    expect(s.delivery_confirm_hours).toBe(6);
    expect(s.optout_detection).toBe('auto');
    expect(s.default_timezone).toBe('America/New_York');
  });

  it('a second settings row is impossible (id = 1 check)', async () => {
    await expect(pool.query('INSERT INTO settings (id) VALUES (2)')).rejects.toThrow(/check/i);
  });

  it('compliance row exists with the reply-STOP opt-out text', async () => {
    const { rows } = await pool.query('SELECT * FROM compliance_settings');
    expect(rows).toHaveLength(1);
    expect(rows[0].optout_text).toMatch(/Reply STOP/i);
    expect(rows[0].physical_address).toBe(''); // must be filled before sends (docs/08 §4)
  });
});
