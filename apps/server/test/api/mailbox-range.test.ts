import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { lockMailbox, patchMailbox } from '../../src/db/repos/mailboxesRepo';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

describe('mailbox randomized range API', () => {
  let h: ApiHarness;
  const rng = vi.fn(() => 0.5);
  beforeAll(async () => {
    h = await createApiHarness({ rng });
  });
  afterAll(async () => {
    await h.close();
  });

  it('defaults new mailboxes to 4–7, validates both values and leaves never-used mailboxes immediately eligible', async () => {
    const response = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: { display_name: 'Range', from_address: 'range@test.dev', auth_type: 'google_oauth' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      send_interval_min_minutes: 4,
      send_interval_max_minutes: 7,
      next_allowed_send_at: null,
    });
    for (const payload of [
      { send_interval_min_minutes: 4 },
      { send_interval_min_minutes: 4, send_interval_max_minutes: 4 },
      { send_interval_min_minutes: 7, send_interval_max_minutes: 4 },
      { send_interval_min_minutes: 0, send_interval_max_minutes: 7 },
      { send_interval_min_minutes: 1.5, send_interval_max_minutes: 7 },
      { send_interval_min_minutes: 4, send_interval_max_minutes: 1441 },
      { send_interval_min_minutes: 4, send_interval_max_minutes: null },
    ])
      expect(
        (await h.inject({ method: 'PATCH', url: '/api/v1/mailboxes/1', payload })).statusCode,
      ).toBe(400);
    expect(
      (
        await h.inject({
          method: 'PATCH',
          url: '/api/v1/mailboxes/1',
          payload: { send_interval_min_minutes: 2, send_interval_max_minutes: 3 },
        })
      ).json(),
    ).toMatchObject({ next_allowed_send_at: null });
    expect(rng).not.toHaveBeenCalled();
  });

  it('waits for an in-flight send row lock and draws once from the newly committed last-send anchor', async () => {
    const wm = await eventWatermark(h.pool);
    const at = new Date('2026-10-07T13:00:00Z');
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = h.services.db.transaction(async (tx) => {
      await lockMailbox(tx, 1);
      await patchMailbox(tx, 1, {
        lastSendAt: at,
        nextAllowedSendAt: new Date(at.getTime() + 150_000),
      });
      locked();
      await hold;
    });
    await ready;
    const request = h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { send_interval_min_minutes: 4, send_interval_max_minutes: 7 },
    });
    let waiting = false;
    try {
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        waiting = (
          await h.pool.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%mailboxes%for update%') AS waiting",
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await sending;
    expect(waiting).toBe(true);
    const result = await request;
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ next_allowed_send_at: '2026-10-07T13:05:30.000Z' });
    expect(rng).toHaveBeenCalledTimes(1);
    const same = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { send_interval_min_minutes: 4, send_interval_max_minutes: 7, daily_cap: 25 },
    });
    expect(same.json()).toMatchObject({
      next_allowed_send_at: '2026-10-07T13:05:30.000Z',
      daily_cap: 25,
    });
    expect(rng).toHaveBeenCalledTimes(1);
    await expectNoNewEvents(h.pool, wm);
  });
});
