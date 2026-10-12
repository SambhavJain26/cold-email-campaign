/** Bounded disposable local schedule and restore drill. Never connects to production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDb } from '../../src/db/client';
import { migrateUp } from '../../src/db/migrate';
import { MIGRATIONS_DIR, seedMailboxes, resetCoreTables } from '../helpers/db';
import { buildEvent } from '../../src/domain/events';
import { EventStore } from '../../src/services/eventStore';
import { previewScheduleChange, applyScheduleChange } from '../../src/services/sequenceSchedule';
import { selfCheckViolations } from '../../src/db/repos/metricsRepo';

const base = 'postgres://coldemail:coldemail_dev@localhost:5433/';
const database = process.argv.includes('--restored')
  ? 'coldemail_schedule_restore'
  : 'coldemail_schedule_verification';
const mode = process.argv[2] ?? 'verify';
const now = new Date('2026-10-12T12:00:00Z');
const proposal = {
  wait_day_mode: 'business_days' as const,
  steps: [0, 3, 14, 4, 4].map((wait_days, i) => ({
    step_no: i + 1,
    wait_days,
    in_thread: i !== 0 && i !== 2,
  })),
};

if (mode === 'seed') {
  assert.equal(database, 'coldemail_schedule_verification');
  const admin = new Pool({ connectionString: base + 'postgres' });
  if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
    await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
}
const { db, pool } = createDb(base + database);
try {
  if (mode === 'seed') {
    await migrateUp(pool, MIGRATIONS_DIR);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM leads WHERE email !~ '^schedule-drill[0-9]+@example[.]test$'",
          )
        ).rows[0].count,
      ),
      0,
    );
    if (!process.argv.includes('--reset'))
      assert.equal(Number((await pool.query('SELECT count(*) FROM leads')).rows[0].count), 0);
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query("UPDATE mailboxes SET timezone='America/New_York' WHERE id=1");
    await pool.query("INSERT INTO sequences(name) VALUES('Schedule verification')");
    await pool.query(
      'INSERT INTO sequence_steps(sequence_id,step_no,wait_days,in_thread) VALUES(1,1,0,false),(1,2,3,true),(1,3,4,false),(1,4,4,true),(1,5,5,true)',
    );
    await pool.query(
      "INSERT INTO step_variants(step_id,label,subject_template,body_template,content_hash) SELECT id,'A','Hello','Saved immutable body','hash' FROM sequence_steps",
    );
    await pool.query(
      "INSERT INTO campaigns(name,status,sequence_id) VALUES('Paused verification','paused',1)",
    );
    const store = new EventStore(db);
    for (let id = 1; id <= 9; id++) {
      await pool.query("INSERT INTO leads(email,tier) VALUES($1,'B')", [
        `schedule-drill${id}@example.test`,
      ]);
      await pool.query(
        "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES($1,1,'template_auto','2026-10-06')",
        [id],
      );
      const ids = {
        leadId: id,
        campaignId: 1,
        enrollmentId: id,
        occurredAt: new Date('2026-10-06T18:00:00Z'),
      };
      await store.append([buildEvent.enrolled(ids)], {
        patches: [{ enrollmentId: id, nextSendAt: ids.occurredAt, assignedMailboxId: 1 }],
      });
      if (id === 8) continue;
      for (let step = 1; step <= (id === 9 ? 2 : 1); step++) {
        const at = step === 1 ? ids.occurredAt : new Date('2026-10-09T18:00:00Z');
        const messageId = `<schedule-drill-${id}-${step}>`;
        await store.append(
          [
            buildEvent.sent({
              ...ids,
              occurredAt: at,
              stepNo: step,
              mailboxId: 1,
              messageId,
              attributes: { content_hash: 'hash', variant_id: step },
            }),
          ],
          {
            patches: [
              {
                enrollmentId: id,
                nextSendAt: new Date(at.getTime() + (step === 1 ? 3 : 4) * 86400000),
              },
            ],
          },
        );
        await pool.query(
          "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,email_format,sent_at,conversation_root_id) VALUES($1,$2,$2,1,$3,'hash','Hello','Saved immutable body','plain_text',$4,$1)",
          [messageId, id, step, at],
        );
      }
      if (id === 2)
        await store.append([
          buildEvent.reviewRequired({
            ...ids,
            occurredAt: now,
            attributes: { incoming_message_id: 999 },
          }),
        ]);
      if (id === 3)
        await store.append([
          buildEvent.reviewDecided({
            ...ids,
            occurredAt: now,
            attributes: {
              action: 'delay',
              hold_event_ids: [],
              until: '2026-10-20T12:00:00Z',
              operation_id: 'drill-delay',
            },
          }),
        ]);
      if (id === 4)
        await pool.query("UPDATE enrollments SET snoozed_until='2026-10-21' WHERE id=4");
      if (id === 5)
        await store.append(
          [
            buildEvent.softBounce({
              ...ids,
              occurredAt: now,
              stepNo: 1,
              attributes: { retry_no: 1 },
            }),
          ],
          { patches: [{ enrollmentId: id, nextSendAt: new Date(now.getTime() + 4 * 3600000) }] },
        );
      if (id === 6)
        await store.append([buildEvent.hardBounce({ ...ids, occurredAt: now, stepNo: 1 })]);
      if (id === 7)
        await store.append([buildEvent.unsubscribe({ ...ids, occurredAt: now, source: 'manual' })]);
    }
    const before = (await pool.query('SELECT * FROM enrollments ORDER BY id')).rows;
    const originalHistory = (await pool.query('SELECT * FROM events ORDER BY id')).rows;
    const sent = (await pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows;
    const preview = await previewScheduleChange(db, 1, proposal);
    assert.equal(preview.can_apply, true);
    const body = { ...proposal, fingerprint: preview.fingerprint, operation_id: randomUUID() };
    assert.equal((await applyScheduleChange(db, store, 1, body, now)).changed, 5);
    assert.equal((await applyScheduleChange(db, store, 1, body, now)).changed, 5);
    const after = (await pool.query('SELECT * FROM enrollments ORDER BY id')).rows;
    for (let i = 0; i < 9; i++) {
      const { next_send_at: _old, ...a } = before[i];
      const { next_send_at: _new, ...b } = after[i];
      assert.deepEqual(a, b);
      if ([5, 6, 7, 8].includes(i + 1))
        assert.deepEqual(before[i].next_send_at, after[i].next_send_at);
    }
    assert.deepEqual(
      (
        await pool.query('SELECT * FROM events WHERE id<=$1 ORDER BY id', [
          originalHistory.at(-1).id,
        ])
      ).rows,
      originalHistory,
    );
    assert.deepEqual(
      (await pool.query('SELECT * FROM sent_messages ORDER BY message_id')).rows,
      sent,
    );
  }
  assert.deepEqual(await selfCheckViolations(db, null), []);
  const rows = (await pool.query('SELECT id,next_send_at FROM enrollments ORDER BY id')).rows;
  assert.equal(rows.length, 9);
  for (const id of [1, 2, 3, 4])
    assert.equal(rows[id - 1].next_send_at.toISOString(), '2026-10-09T04:00:00.000Z');
  assert.equal(rows[8].next_send_at.toISOString(), '2026-10-29T04:00:00.000Z');
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM events WHERE type='schedule_recalculated'")).rows[0]
        .count,
    ),
    5,
  );
  console.log(
    'Nine-enrollment schedule assertions, history preservation, idempotency and self-check pass.',
  );
} finally {
  await pool.end();
}
