import { afterEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { scenario, type Scenario, leadEmail } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';
import { ingestIncoming } from '../../src/services/incomingReview';
import { applyReviewAction } from '../../src/services/incomingReviewActions';
import { getById } from '../../src/db/repos/enrollmentsRepo';

let s: Scenario;
afterEach(async () => {
  await s?.close();
});
async function start() {
  s = await scenario({
    mailboxes: 1,
    dailyCap: 20,
    sequence: testSequence(1, [0, 3, 4]),
    incomingPolicy: 'review',
    start: '2026-10-05T14:00:00Z',
    jitterPct: 0,
  });
  await s.pool.query("INSERT INTO sequences(name) VALUES('Review sequence')");
  await s.pool.query(
    'INSERT INTO sequence_steps(sequence_id,step_no,wait_days,in_thread) VALUES(1,1,0,false),(1,2,3,true),(1,3,4,true)',
  );
  await s.pool.query(
    "INSERT INTO step_variants(step_id,label,subject_template,body_template,content_hash) SELECT id,'A','Hello','Checking in','h'||id FROM sequence_steps",
  );
  await s.pool.query('UPDATE campaigns SET sequence_id=1 WHERE id=1');
  await s.importLeads(1);
  await s.enroll({ count: 1 });
  expect((await s.scheduler.tick()).sent).toBe(1);
}
async function receive(uid = 1) {
  await ingestIncoming(
    s.db,
    s.store,
    {
      uid,
      folder: 'INBOX',
      uidValidity: '100',
      mailboxId: 1,
      from: leadEmail('L0001'),
      subject: 'Away',
      bodyText: 'I am away for three days. Please check back next week.',
      headers: {},
      inReplyTo: s.mock.sentLog[0]!.msg.headers.messageId,
      messageId: `<incoming-${uid}@scenario.dev>`,
      isDSN: false,
      receivedAt: s.clock.now(),
    },
    s.clock.now(),
  );
}
async function decide(action: 'continue' | 'delay', extra: Record<string, string> = {}) {
  const row = (await getById(s.db, 1))!;
  const latest = (
    await s.pool.query('SELECT max(id) AS revision FROM events WHERE enrollment_id=1')
  ).rows[0].revision;
  await applyReviewAction(
    s.db,
    s.store,
    1,
    {
      operation_id: randomUUID(),
      expected_revision: Number(latest),
      action,
      hold_ids: row.reviewHoldIds,
      reviewed_message_ids: [1, 2],
      ...extra,
    },
    s.clock.now(),
  );
}
it('review holds do not expire, Continue keeps the next step and cannot catch up in a burst', async () => {
  await start();
  await receive();
  const saved = (await getById(s.db, 1))!;
  s.clock.set('2026-10-19T14:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  expect((await getById(s.db, 1))!.nextSendAt).toEqual(saved.nextSendAt);
  await decide('continue');
  expect(s.mock.sentLog).toHaveLength(1);
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect((await s.scheduler.tick()).sent).toBe(0);
  const after = (await getById(s.db, 1))!;
  expect(after.currentStepNo).toBe(3);
  expect(after.nextSendAt!.toISOString()).toBe('2026-10-23T14:00:00.000Z');
});
it('Delay preserves progress across pause/window boundaries and a new response adds an independent hold', async () => {
  await start();
  await receive();
  await decide('delay', {
    until: '2026-10-12T14:00:00.000Z',
    timezone: 'America/New_York',
    local_time: '2026-10-12T10:00',
  });
  s.clock.set('2026-10-09T14:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  await s.pool.query("UPDATE campaigns SET status='paused' WHERE id=1");
  s.clock.set('2026-10-12T14:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  await receive(2);
  await s.pool.query("UPDATE campaigns SET status='active' WHERE id=1");
  expect((await s.scheduler.tick()).sent).toBe(0);
  await decide('continue');
  expect((await s.scheduler.tick()).sent).toBe(1);
  expect((await getById(s.db, 1))!.currentStepNo).toBe(3);
});
it('a committed incoming response defeats scheduler work already selected as due', async () => {
  await start();
  s.clock.set('2026-10-08T14:00:00Z');
  const { listDue } = await import('../../src/db/repos/enrollmentsRepo');
  const due = await listDue(s.db, s.clock.now());
  expect(due).toHaveLength(1);
  await receive();
  expect((await s.scheduler.tick()).sent).toBe(0);
  expect(s.mock.sentLog).toHaveLength(1);
});
it('Continue after a new response retains the previously chosen future delay', async () => {
  await start();
  await receive();
  await decide('delay', {
    until: '2026-10-12T14:00:00.000Z',
    timezone: 'America/New_York',
    local_time: '2026-10-12T10:00',
  });
  s.clock.set('2026-10-09T14:00:00Z');
  await receive(2);
  await decide('continue');
  expect((await getById(s.db, 1))!.delayedUntil!.toISOString()).toBe('2026-10-12T14:00:00.000Z');
  expect((await s.scheduler.tick()).sent).toBe(0);
  s.clock.set('2026-10-12T14:00:00Z');
  expect((await s.scheduler.tick()).sent).toBe(1);
});
it('responses on completed enrollments do not reactivate them and guard future automatic recontact', async () => {
  await start();
  s.clock.set('2026-10-08T14:00:00Z');
  await s.scheduler.tick();
  s.clock.set('2026-10-12T14:00:00Z');
  await s.scheduler.tick();
  s.clock.set('2026-10-13T14:00:00Z');
  await s.scheduler.tick();
  await s.advanceHours(1);
  expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(3);
  expect((await getById(s.db, 1))!.currentState).toBe('COMPLETED');
  await receive();
  expect((await getById(s.db, 1))!.currentState).toBe('COMPLETED');
  expect((await getById(s.db, 1))!.reviewHoldIds).toEqual([]);
  const { heldLinks } = await import('../../src/db/repos/incomingReviewRepo');
  expect(await heldLinks(s.db, 1, 1, 1)).toBe(false);
  const { recontactStatusByLeadIds } = await import('../../src/db/repos/leadsRepo');
  expect((await recontactStatusByLeadIds(s.db, [1])).get(1)?.hasReply).toBe(true);
});
