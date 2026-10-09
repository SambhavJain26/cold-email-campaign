import { afterEach, expect, it, vi } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';
import { listDue } from '../../src/db/repos/enrollmentsRepo';
import { getMailbox as getById } from '../../src/db/repos/mailboxesRepo';
import { mailboxCapacity, reservedWork } from '../../src/db/repos/sendingCapacityRepo';
import { capacityToday, enroll, enrollByIds } from '../../src/services/enrollment';
import { startOfNextLocalDay } from '../../src/scheduler/window';
import { buildEvent } from '../../src/domain/events';

let s: Scenario;
afterEach(async () => {
  await s?.close();
});
const deps = () => ({ db: s.db, store: s.store, clock: s.clock, sequences: s.sequences });
async function setup(mailboxes = 1, cap = 3, count = 4) {
  s = await scenario({ mailboxes, dailyCap: cap, sequence: testSequence(1, [0, 3, 4, 4, 5]) });
  await s.importLeads(count);
  await s.enroll({ count });
}
async function additional(count: number, start: number) {
  for (let id = start; id < start + count; id++)
    await s.pool.query("INSERT INTO leads(email,tier) VALUES($1,'B')", [
      leadEmail(`L${String(id).padStart(4, '0')}`),
    ]);
}
// Projection-only setup isolates selection/reservation; send tests establish real sent evidence.
async function followup(id: number, step = 2, mailbox = 1, due = '2026-01-05T17:00:00Z') {
  await s.pool.query(
    'UPDATE enrollments SET current_step_no=$2,assigned_mailbox_id=$3,next_send_at=$4 WHERE lead_id=$1',
    [id, step, mailbox, due],
  );
}

it('prioritizes follow-ups by effective due time, not email number; deterministic ties', async () => {
  await setup(1, 10, 5);
  await followup(2, 5, 1, '2026-01-05T12:00:00Z');
  await followup(3, 2, 1, '2026-01-04T12:00:00Z');
  await followup(4, 3, 1, '2026-01-03T12:00:00Z');
  await s.pool.query("UPDATE enrollments SET delayed_until='2026-01-05T12:30:00Z' WHERE lead_id=4");
  await followup(5, 4, 1, '2026-01-05T12:00:00Z');
  expect((await listDue(s.db, s.clock.now())).map((e) => e.leadId)).toEqual([3, 2, 5, 4, 1]);
});

it('protects later-today follow-ups and counts an assigned Email 1 retry as an opener', async () => {
  await setup();
  await followup(1);
  await followup(2);
  await s.pool.query('UPDATE enrollments SET assigned_mailbox_id=1 WHERE lead_id=3');
  const cap = await capacityToday(deps(), 1);
  expect(cap).toMatchObject({ followupsDue: 2, pendingOpeners: 2, roomForNew: 0, suggested: 0 });
  const mb = await getById(s.db, 1);
  expect(await mailboxCapacity(s.db, mb!, s.clock.now())).toMatchObject({
    openerSlots: 1,
    newSlots: 0,
  });
});

it('clamps overloaded mailboxes separately, without consuming another mailbox spare allowance', async () => {
  await setup(2, 2, 4);
  await followup(1);
  await followup(2);
  await followup(3);
  expect(await capacityToday(deps(), 1)).toMatchObject({
    followupsDue: 3,
    pendingOpeners: 1,
    roomForNew: 1,
  });
  expect(await mailboxCapacity(s.db, (await getById(s.db, 1))!, s.clock.now())).toMatchObject({
    openerSlots: 0,
  });
  expect(await mailboxCapacity(s.db, (await getById(s.db, 2))!, s.clock.now())).toMatchObject({
    openerSlots: 2,
  });
});

it('excludes holds, future delay/snooze, suppression, erased and stopped work', async () => {
  await setup(1, 20, 8);
  for (let id = 1; id <= 8; id++) await followup(id);
  await s.pool.query('UPDATE enrollments SET review_hold_ids=ARRAY[123]::bigint[] WHERE lead_id=1');
  await s.pool.query("UPDATE enrollments SET delayed_until='2026-01-06T16:00:00Z' WHERE lead_id=2");
  await s.pool.query("UPDATE enrollments SET snoozed_until='2026-01-06T16:00:00Z' WHERE lead_id=3");
  await s.pool.query('UPDATE leads SET is_suppressed=true WHERE id=4');
  await s.pool.query('UPDATE leads SET is_erased=true WHERE id=5');
  await s.pool.query("UPDATE enrollments SET current_state='STOPPED' WHERE lead_id=6");
  await s.pool.query("INSERT INTO suppressions(email,reason) VALUES($1,'manual')", [
    leadEmail('L0007'),
  ]);
  expect((await capacityToday(deps(), 1)).followupsDue).toBe(1);
  await s.pool.query("UPDATE campaigns SET status='paused' WHERE id=1");
  expect(await capacityToday(deps(), 1)).toMatchObject({
    followupsDue: 0,
    pendingOpeners: 0,
    roomForNew: 20,
  });
});

it.each([
  ['America/New_York', '2026-03-08T06:30:00Z', '2026-03-09T04:00:00.000Z'],
  ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-02T05:00:00.000Z'],
  ['Asia/Kolkata', '2026-01-05T19:00:00Z', '2026-01-06T18:30:00.000Z'],
])('uses mailbox-local midnight including DST: %s %s', async (zone, now, end) => {
  await setup(1, 3, 2);
  s.clock.set(now);
  await s.pool.query('UPDATE mailboxes SET timezone=$1', [zone]);
  await followup(1, 2, 1, new Date(new Date(end).getTime() - 1).toISOString());
  await followup(2, 3, 1, end);
  expect(startOfNextLocalDay(s.clock.now(), zone).toISOString()).toBe(end);
  expect((await mailboxCapacity(s.db, (await getById(s.db, 1))!, s.clock.now())).followups).toBe(1);
});

it('rejects excessive enrollment and overrides without appending facts', async () => {
  await setup(1, 3, 2);
  await additional(2, 3);
  const before = await s.pool.query('SELECT count(*)::int n FROM events');
  await expect(enroll(deps(), 1, 2)).rejects.toThrow('Only 1 additional leads fit today');
  await expect(enrollByIds(deps(), 1, [3], { force: true })).rejects.toThrow(
    'Capacity overrides are unavailable',
  );
  expect((await s.pool.query('SELECT count(*)::int n FROM events')).rows).toEqual(before.rows);
});

it('concurrent enrollment requests cannot reserve the same last slot', async () => {
  await setup(1, 3, 2);
  await additional(2, 3);
  const results = await Promise.allSettled([enroll(deps(), 1, 1), enroll(deps(), 1, 1)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await capacityToday(deps(), 1)).roomForNew).toBe(0);
});

it('real scheduler sends a due follow-up before an older first email and calculates the next gap from acceptance', async () => {
  await setup(1, 5, 1);
  await s.scheduler.tick();
  await additional(1, 2);
  await s.enroll({ count: 1 });
  s.clock.advance({ days: 3 });
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect(s.mock.sentLog.at(-1)!.msg.to).toBe(leadEmail('L0001'));
  const row = (
    await s.pool.query('SELECT current_step_no,next_send_at FROM enrollments WHERE lead_id=1')
  ).rows[0];
  expect(row.current_step_no).toBe(3);
  expect(row.next_send_at.toISOString()).toBe(
    new Date(s.clock.now().getTime() + 4 * 86400000).toISOString(),
  );
});

it('real scheduler protects afternoon reservations and lets another mailbox send its first email', async () => {
  await setup(2, 1, 2);
  await followup(1, 2, 1);
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect(s.mock.sentLog[0]!.msg.mailboxId).toBe(2);
  expect(s.mock.sentLog[0]!.msg.to).toBe(leadEmail('L0002'));
});

it('final locked check prevents an opener when a reservation arrives after selection', async () => {
  await setup(1, 1, 2);
  const locked = s.store.withEnrollmentLock.bind(s.store);
  vi.spyOn(s.store, 'withEnrollmentLock').mockImplementationOnce(async (id, fn) => {
    await followup(2);
    return locked(id, fn);
  });
  expect((await s.scheduler.tick()).sent).toBe(0);
  expect(s.mock.sentLog).toHaveLength(0);
});

it('classifies a real Email 1 soft-bounce retry as an opener despite advanced progress', async () => {
  await setup(1, 5, 3);
  await s.scheduler.tick();
  s.clock.advance({ hours: 1 });
  await s.store.append(
    [
      buildEvent.softBounce({
        leadId: 1,
        enrollmentId: 1,
        campaignId: 1,
        mailboxId: 1,
        stepNo: 1,
        occurredAt: s.clock.now(),
        reason: 'temporary delivery failure',
        attributes: { retry_no: 1 },
      }),
    ],
    { patches: [{ enrollmentId: 1, nextSendAt: s.clock.now() }] },
  );
  await followup(2, 2, 1, s.clock.now().toISOString());
  const due = await listDue(s.db, s.clock.now());
  expect(due.map((e) => e.leadId)).toEqual([2, 3, 1]);
  expect(due.at(-1)).toMatchObject({ currentStepNo: 2, sendingStepNo: 1 });
  expect(
    await reservedWork(s.db, startOfNextLocalDay(s.clock.now(), 'America/New_York'), 1),
  ).toEqual({ followups: 1, openers: 1 });
});

it('keeps unavailable-copy follow-ups reserved rather than reallocating their slots', async () => {
  await setup(1, 1, 2);
  await followup(1, 2, 1, '2026-01-05T12:00:00Z');
  const seq = testSequence(1, [0, 3]);
  s.sequences.register(1, {
    ...seq,
    steps: seq.steps.map((st) => (st.stepNo === 2 ? { ...st, variants: [] } : st)),
  });
  expect((await reservedWork(s.db, new Date('2026-01-06T05:00:00Z'), 1)).followups).toBe(1);
  expect((await s.scheduler.tick()).sent).toBe(0);
});
