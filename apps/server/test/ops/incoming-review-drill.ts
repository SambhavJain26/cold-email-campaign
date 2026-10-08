/** Disposable local release drill. No transport, live credentials or production URL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { createDb } from '../../src/db/client';
import { loadMigrations, migrateUp } from '../../src/db/migrate';
import { buildEvent } from '../../src/domain/events';
import { EventStore } from '../../src/services/eventStore';
import { ingestIncoming } from '../../src/services/incomingReview';
import { applyReviewAction } from '../../src/services/incomingReviewActions';
import { deleteStoredContent } from '../../src/services/incomingContent';
import { selfCheckViolations } from '../../src/db/repos/metricsRepo';
import { readMessage } from '../../src/db/repos/incomingReviewRepo';
import { MIGRATIONS_DIR, seedMailboxes, resetCoreTables } from '../helpers/db';

const database = 'coldemail_review_verification';
const restoreDatabase = 'coldemail_review_restore';
const base = 'postgres://coldemail:coldemail_dev@localhost:5433/';
const mode = process.argv[2] ?? 'seed';
const target = process.argv.includes('--restored') ? restoreDatabase : database;
const manifest = path.resolve('backups/incoming-review-drill/deletions.jsonl');
const now = new Date('2026-10-07T14:00:00Z');
const sentAt = new Date('2026-10-06T12:00:00Z');
const { db, pool } = createDb(base + target);

async function seed(): Promise<void> {
  assert.equal(target, database);
  const admin = new Pool({ connectionString: base + 'postgres' });
  try {
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
      await admin.query(`CREATE DATABASE ${database}`);
  } finally {
    await admin.end();
  }
  await migrateUp(pool, MIGRATIONS_DIR);
  if (process.argv.includes('--reset'))
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM leads WHERE email !~ '^drill[0-9]+@example[.]test$'",
          )
        ).rows[0].count,
      ),
      0,
      'Refuse to reset non-drill records.',
    );
  else
    assert.equal(
      Number((await pool.query('SELECT count(*) FROM leads')).rows[0].count),
      0,
      'Drill requires an empty disposable database.',
    );
  await resetCoreTables(pool);
  await mkdir(path.dirname(manifest), { recursive: true });
  await writeFile(manifest, '');
  await seedMailboxes(pool, 1);
  await pool.query(
    "UPDATE settings SET suppress_unsubs=true,incoming_stop_since='2026-10-07',delivery_confirm_hours=24 WHERE id=1",
  );
  await pool.query("INSERT INTO sequences(name) VALUES('Review release drill')");
  await pool.query(
    'INSERT INTO sequence_steps(sequence_id,step_no,wait_days,in_thread) VALUES(1,1,0,false),(1,2,3,true),(1,3,4,false)',
  );
  await pool.query(
    "INSERT INTO step_variants(step_id,label,subject_template,body_template,content_hash) SELECT id,'A','Hello','Fixture body','h'||id FROM sequence_steps",
  );
  await pool.query(
    "INSERT INTO campaigns(name,status,sequence_id) VALUES('Paused review verification','paused',1)",
  );
  const store = new EventStore(db);
  for (let id = 1; id <= 9; id++) {
    await pool.query("INSERT INTO leads(email,tier) VALUES($1,'B')", [`drill${id}@example.test`]);
    await pool.query(
      "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES($1,1,'template_auto',$2)",
      [id, sentAt],
    );
    const ids = { leadId: id, campaignId: 1, enrollmentId: id, occurredAt: sentAt };
    await store.append([buildEvent.enrolled(ids)], {
      patches: [{ enrollmentId: id, nextSendAt: sentAt, assignedMailboxId: 1 }],
    });
    for (let step = 1; step <= (id === 7 ? 3 : 1); step++) {
      const messageId = `<fixture-${id}-${step}@example.test>`;
      await store.append(
        [
          buildEvent.sent({
            ...ids,
            stepNo: step,
            mailboxId: 1,
            messageId,
            attributes: { content_hash: `h${step}`, variant_id: step },
          }),
        ],
        { patches: [{ enrollmentId: id, nextSendAt: new Date('2026-10-09T12:00:00Z') }] },
      );
      // Immutable synthetic accepted-send snapshots. No SMTP method is called.
      await pool.query(
        "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,email_format,sent_at,conversation_root_id) VALUES($1,$2,$2,1,$3,$4,'Saved subject','Saved immutable retry body','plain_text',$5,$1)",
        [messageId, id, step, `h${step}`, sentAt],
      );
    }
    const next = { ...ids, occurredAt: now };
    if (id <= 3) {
      await ingestIncoming(
        db,
        store,
        {
          uid: id,
          uidValidity: '100',
          folder: 'INBOX',
          mailboxId: 1,
          from: `drill${id}@example.test`,
          subject: 'Away',
          bodyText: 'Away for three days.\n\nCheck back next week.',
          bodyHtml: '<p>Away for three days.</p><p>Check back next week.</p>',
          messageId: `<incoming-drill${id}@example.test>`,
          headers: {},
          isDSN: false,
          receivedAt: now,
        },
        now,
      );
      if (id === 2 || id === 3) {
        const e = (await pool.query('SELECT * FROM enrollments WHERE id=$1', [id])).rows[0];
        const revision = Number(
          (await pool.query('SELECT max(id) AS id FROM events WHERE enrollment_id=$1', [id]))
            .rows[0].id,
        );
        await applyReviewAction(
          db,
          store,
          id,
          {
            operation_id: randomUUID(),
            expected_revision: revision,
            action: id === 2 ? 'delay' : 'stop',
            hold_ids: e.review_hold_ids.map(Number),
            reviewed_message_ids: [id],
            ...(id === 2
              ? {
                  until: '2026-10-12T14:00:00.000Z',
                  timezone: 'America/New_York',
                  local_time: '2026-10-12T10:00',
                }
              : {}),
          },
          now,
        );
      }
      if (id === 1)
        await store.append([
          buildEvent.authorshipConfirmed({
            ...next,
            sentiment: 'positive',
            stepNo: 1,
            attributes: { incoming_message_id: 1, authorship: 'human', operation_id: randomUUID() },
          }),
        ]);
    }
    if (id === 4)
      await store.append([
        buildEvent.outreachStopped({
          ...next,
          reason: 'Historical company-mail rule',
          attributes: {
            incoming_message_id: 1,
            sender: 'other@example.test',
            matching_method: 'company_domain',
            company_domain: 'example.test',
          },
        }),
      ]);
    if (id === 5)
      await store.append([buildEvent.humanReply({ ...next, stepNo: 1, sentiment: 'neutral' })]);
    if (id === 6) await store.append([buildEvent.hardBounce({ ...next, stepNo: 1 })]);
    if (id === 7) await store.append([buildEvent.delivered({ ...next, stepNo: 3 })]);
    if (id === 8)
      await store.append([
        buildEvent.addressSuppressed({
          ...next,
          attributes: { rule: 'explicit_optout', operation_id: randomUUID() },
        }),
      ]);
    if (id === 9) await store.append([buildEvent.unsubscribe({ ...next, source: 'manual' })]);
  }
  assert.deepEqual(await selfCheckViolations(db, null), []);
  console.log(
    'Seeded 9 event-backed enrollments: held, delayed, manual/legacy stop, legacy reply, bounce, completed, permanent suppression and unsubscribe. No transport calls.',
  );
}
async function verify(): Promise<void> {
  assert.equal(Number((await pool.query('SELECT count(*) FROM enrollments')).rows[0].count), 9);
  assert.deepEqual(await selfCheckViolations(db, null), []);
  const e = (
    await pool.query(
      'SELECT id,current_state,review_hold_ids,delayed_until FROM enrollments ORDER BY id',
    )
  ).rows;
  assert.equal(e[0].review_hold_ids.length, 1);
  assert.ok(e[1].delayed_until);
  assert.equal(e[2].current_state, 'STOPPED');
  assert.equal(e[3].current_state, 'STOPPED');
  assert.equal(e[4].current_state, 'REPLIED');
  assert.equal(e[5].current_state, 'BOUNCED');
  assert.equal(e[6].current_state, 'COMPLETED');
  assert.equal(Number((await pool.query('SELECT count(*) FROM suppressions')).rows[0].count), 3);
  assert.equal(
    Number(
      (
        await pool.query('SELECT count(*) FROM sent_messages WHERE rendered_body_text=$1', [
          'Saved immutable retry body',
        ])
      ).rows[0].count,
    ),
    11,
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM metric_events_at() WHERE type='human_reply'")).rows[0]
      .count,
    2,
  );
  if (mode === 'verify-deleted') {
    assert.equal((await readMessage(db, 1))?.capture_status, 'deleted');
    assert.equal((await readMessage(db, 1))?.body_text, null);
  }
  console.log(
    `${target}: populated state, immutable snapshots, suppression and confirmed metrics verified.`,
  );
}
async function migrationGate(): Promise<void> {
  const tables = [
    'events',
    'enrollments',
    'sent_messages',
    'suppressions',
    'incoming_messages',
    'incoming_message_content',
    'incoming_message_links',
    'incoming_message_activity',
    'incoming_message_locations',
  ];
  const snapshot = async () =>
    Promise.all(
      tables.map(
        async (table) =>
          (
            await pool.query(
              `SELECT COALESCE(jsonb_agg(t ORDER BY t::text),'[]'::jsonb) AS rows FROM (SELECT to_jsonb(x) AS t FROM ${table} x) q`,
            )
          ).rows[0].rows,
      ),
    );
  const before = await snapshot();
  const migrations = (await loadMigrations(MIGRATIONS_DIR)).filter((m) => m.name >= '0028');
  for (const m of [...migrations].reverse()) await pool.query(m.downSql);
  for (const m of migrations) await pool.query(m.upSql);
  assert.deepEqual(await snapshot(), before);
  await verify();
  console.log('0028–0032 preservation down/apply drill passed on populated state.');
}
try {
  if (mode === 'seed') await seed();
  else if (mode === 'migration') await migrationGate();
  else if (mode === 'delete') {
    const m = (await readMessage(db, 1))!;
    await deleteStoredContent(
      db,
      1,
      { operation_id: randomUUID(), expected_revision: m.revision },
      now,
      manifest,
    );
    console.log('Deleted incoming content after the dump; latest independent manifest retained.');
  } else await verify();
} finally {
  await pool.end();
}
