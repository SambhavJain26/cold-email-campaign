import { afterEach, expect, it } from 'vitest';
import { scenario, type Scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';
import { buildEvent } from '../../src/domain/events';

let s: Scenario;
afterEach(async () => {
  await s?.close();
});
it('schedules at weekday midnight and sends that morning through pacing, caps and holds', async () => {
  const sequence = { ...testSequence(1, [0, 3, 14, 4, 4]), waitDayMode: 'business_days' as const };
  sequence.steps[2]!.inThread = false;
  s = await scenario({
    mailboxes: 1,
    dailyCap: 1,
    sequence,
    start: '2026-10-06T18:00:00Z',
    jitterPct: 0,
  });
  await s.pool.query(
    "UPDATE mailboxes SET timezone='America/New_York',send_interval_min_minutes=5,send_interval_max_minutes=10 WHERE id=1",
  );
  await s.importLeads(1);
  await s.enroll({ count: 1 });
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect(
    (
      await s.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')
    ).rows[0].next_send_at.toISOString(),
  ).toBe('2026-10-09T04:00:00.000Z');
  s.clock.set('2026-10-08T18:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  s.clock.set('2026-10-09T04:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0); // window closed
  const [hold] = await s.store.append([
    buildEvent.reviewRequired({
      leadId: 1,
      enrollmentId: 1,
      campaignId: 1,
      occurredAt: s.clock.now(),
      attributes: { incoming_message_id: 1 },
    }),
  ]);
  s.clock.set('2026-10-09T13:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  await s.store.append([
    buildEvent.reviewDecided({
      leadId: 1,
      enrollmentId: 1,
      campaignId: 1,
      occurredAt: s.clock.now(),
      attributes: { action: 'continue', hold_event_ids: [hold!], operation_id: 'test-continue' },
    }),
  ]);
  expect((await s.scheduler.tick()).sent).toBe(1); // 9 AM, not the preceding 2 PM
  expect(
    (
      await s.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')
    ).rows[0].next_send_at.toISOString(),
  ).toBe('2026-10-29T04:00:00.000Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  s.clock.set('2026-10-29T13:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect(s.mock.sentLog.at(-1)!.msg.headers.inReplyTo).toBeUndefined(); // Thread 2
  expect(
    (
      await s.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')
    ).rows[0].next_send_at.toISOString(),
  ).toBe('2026-11-04T05:00:00.000Z');
});
