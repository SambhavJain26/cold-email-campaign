import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { ingestIncoming } from '../../src/services/incomingReview';
import { listRows, readMessage, needsLinking } from '../../src/db/repos/incomingReviewRepo';
import { incomingRowsResponseSchema, incomingMessageSchema } from '@coldemail/shared';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';
import type { IncomingMessage } from '../../src/transport/types';

let db: Db, pool: Pool, store: EventStore;
const now = new Date('2026-10-08T12:00:00Z');
const message = (patch: Partial<IncomingMessage> = {}): IncomingMessage => ({
  mailboxId: 1,
  folder: 'INBOX',
  uid: 1,
  uidValidity: '100',
  from: 'lead@company.example',
  subject: 'Question',
  bodyText: 'Away three days. Please check back next week.',
  headers: {},
  isDSN: false,
  receivedAt: now,
  messageId: '<in@company.example>',
  ...patch,
});
beforeAll(() => {
  ({ db, pool } = createDb(TEST_DATABASE_URL));
  store = new EventStore(db);
});
afterAll(async () => {
  await resetCoreTables(pool);
  await pool.end();
});
beforeEach(async () => {
  await resetCoreTables(pool);
  await seedMailboxes(pool, 1);
  await pool.query("INSERT INTO leads(email) VALUES('lead@company.example')");
  await pool.query(
    "INSERT INTO campaigns(name,status) VALUES('Contacted','active'),('Unsent','paused')",
  );
  await pool.query(
    "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES(1,1,'template_auto',now()),(1,2,'template_auto',now())",
  );
  for (const id of [1, 2])
    await store.append(
      [
        buildEvent.enrolled({
          leadId: 1,
          campaignId: id,
          enrollmentId: id,
          occurredAt: new Date('2026-10-01T12:00:00Z'),
        }),
      ],
      { patches: [{ enrollmentId: id, nextSendAt: now }] },
    );
  await store.append([
    buildEvent.sent({
      leadId: 1,
      campaignId: 1,
      enrollmentId: 1,
      mailboxId: 1,
      occurredAt: new Date('2026-10-01T12:00:00Z'),
      stepNo: 1,
      messageId: '<sent@app.example>',
      attributes: { content_hash: 'hash' },
    }),
  ]);
  await pool.query(
    "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,sent_at) VALUES('<sent@app.example>',1,1,1,1,'hash','2026-10-01T12:00:00Z')",
  );
});
it('separate exact-address response holds both campaigns, preserving progress and due times', async () => {
  await ingestIncoming(db, store, message(), now);
  const rows = (
    await pool.query(
      'SELECT current_state,current_step_no,next_send_at,review_hold_ids FROM enrollments ORDER BY id',
    )
  ).rows;
  expect(rows.map((r) => r.current_state)).toEqual(['ACTIVE', 'ACTIVE']);
  expect(rows.map((r) => r.current_step_no)).toEqual([2, 1]);
  expect(
    rows.every((r) => r.review_hold_ids.length === 1 && r.next_send_at.getTime() === now.getTime()),
  ).toBe(true);
  const listed = await listRows(db, { view: 'needs_review', page: 1, per_page: 50 });
  expect(listed.items).toHaveLength(2);
  incomingRowsResponseSchema.parse({ ...listed, page: 1, per_page: 50 });
  const stored = await readMessage(db, 1);
  incomingMessageSchema.parse(stored);
  expect(stored?.body_text).toContain('three days');
  expect(stored?.relationship).toBe('separate');
  expect(
    (await pool.query("SELECT * FROM events WHERE type IN ('human_reply','outreach_stopped')"))
      .rows,
  ).toHaveLength(0);
});
it('in-thread automation has independent labels and no human reply fact', async () => {
  await ingestIncoming(
    db,
    store,
    message({
      inReplyTo: '<sent@app.example>',
      headers: { 'auto-submitted': 'auto-replied' },
      subject: 'Automatic reply',
    }),
    now,
  );
  const stored = await readMessage(db, 1);
  expect(stored?.automation).toBe('automatic');
  expect(stored?.relationship).toBe('in_thread');
  expect(stored?.authorship).toBe('unsure');
});
it('company-address suggestions do not create holds; reference conflicts stay needs linking', async () => {
  await ingestIncoming(db, store, message({ from: 'other@company.example' }), now);
  expect((await needsLinking(db, 1, 50)).total).toBe(1);
  expect(
    (await pool.query('SELECT review_hold_ids FROM enrollments')).rows.every(
      (r) => r.review_hold_ids.length === 0,
    ),
  ).toBe(true);
});
async function contactSibling(): Promise<void> {
  const sentAt = new Date('2026-10-02T12:00:00Z');
  await store.append([
    buildEvent.sent({
      leadId: 1,
      campaignId: 2,
      enrollmentId: 2,
      mailboxId: 1,
      occurredAt: sentAt,
      stepNo: 1,
      messageId: '<sibling@app.example>',
      attributes: { content_hash: 'hash' },
    }),
  ]);
  await pool.query(
    "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,sent_at) VALUES('<sibling@app.example>',2,1,1,1,'hash',$1)",
    [sentAt],
  );
}
it('fresh exact-address mail holds multiple contacted campaigns without inventing primary or step attribution', async () => {
  await contactSibling();
  await ingestIncoming(db, store, message(), now);
  const stored = (await readMessage(db, 1))!;
  expect(stored.primary_enrollment_id).toBeNull();
  expect(stored.relationship).toBe('separate');
  expect(stored.history[0]!.attributes.replied_to_step).toBeNull();
  expect(
    (await listRows(db, { view: 'all', page: 1, per_page: 50 })).items.every(
      (row) => row.sending_state === 'held',
    ),
  ).toBe(true);
});
it('references to conflicting campaigns stay needs-linking without automatic outreach changes', async () => {
  await contactSibling();
  await ingestIncoming(
    db,
    store,
    message({ references: ['<sent@app.example>', '<sibling@app.example>'] }),
    now,
  );
  expect((await needsLinking(db, 1, 50)).total).toBe(1);
  expect(
    (await pool.query('SELECT review_hold_ids FROM enrollments')).rows.every(
      (row) => row.review_hold_ids.length === 0,
    ),
  ).toBe(true);
});
it('clear opt-out protects without acknowledgement; quoted history does not', async () => {
  await ingestIncoming(db, store, message({ bodyText: 'Hello\n> unsubscribe' }), now);
  expect((await pool.query('SELECT * FROM suppressions')).rows).toHaveLength(0);
  await ingestIncoming(
    db,
    store,
    message({
      uid: 2,
      messageId: '<out@company.example>',
      bodyText: 'Please remove me from your list.',
    }),
    now,
  );
  expect((await pool.query('SELECT email FROM suppressions')).rows).toEqual([
    { email: 'lead@company.example' },
  ]);
});
it('different sender reference never suppresses the recipient; duplicate locations are canonical', async () => {
  await ingestIncoming(
    db,
    store,
    message({
      from: 'other@company.example',
      inReplyTo: '<sent@app.example>',
      bodyText: 'unsubscribe',
    }),
    now,
  );
  expect((await pool.query('SELECT * FROM suppressions')).rows).toHaveLength(0);
  await ingestIncoming(
    db,
    store,
    message({
      from: 'other@company.example',
      folder: 'Spam',
      inReplyTo: '<sent@app.example>',
      bodyText: 'unsubscribe',
    }),
    now,
  );
  expect((await pool.query('SELECT * FROM incoming_messages')).rows).toHaveLength(1);
  expect((await pool.query('SELECT * FROM incoming_message_locations')).rows).toHaveLength(2);
});
it('conflicting envelopes sharing a Message-ID remain visible without guessed holds or suppression', async () => {
  await ingestIncoming(db, store, message({ from: 'other@company.example' }), now);
  await ingestIncoming(db, store, message({ uid: 2, bodyText: 'unsubscribe' }), now);
  expect((await needsLinking(db, 1, 50)).total).toBe(2);
  expect((await pool.query('SELECT * FROM suppressions')).rows).toHaveLength(0);
  expect(
    (await pool.query('SELECT review_hold_ids FROM enrollments')).rows.every(
      (r) => !r.review_hold_ids.length,
    ),
  ).toBe(true);
});
