import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { MIGRATIONS_DIR } from '../helpers/db';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { seedMailboxes } from '../helpers/db';
import { buildEvent } from '../../src/domain/events';
import { ingestIncoming } from '../../src/services/incomingReview';
import { readMessage } from '../../src/db/repos/incomingReviewRepo';
import {
  cleanAcknowledgedContent,
  reapplyDeletionManifest,
  recoverStoredContent,
  deleteStoredContent,
} from '../../src/services/incomingContent';
import type { IncomingMessage, MailTransport } from '../../src/transport/types';
import type { IncomingReviewRow } from '@coldemail/shared';

let h: ApiHarness, dir: string, manifest: string;
const incoming = (patch: Partial<IncomingMessage> = {}): IncomingMessage => ({
  mailboxId: 1,
  folder: 'INBOX',
  uid: 1,
  uidValidity: '100',
  from: 'lead@company.example',
  subject: 'Question',
  bodyText: 'Away for three days.\n\nPlease check back next week.',
  bodyHtml: '<p>Away for three days.</p><p>Please check back next week.</p>',
  headers: {},
  isDSN: false,
  receivedAt: h.clock.now(),
  messageId: '<incoming@company.example>',
  ...patch,
});
const rows = async () =>
  (await h.inject({ method: 'GET', url: '/api/v1/unibox/rows?view=all' })).json()
    .items as IncomingReviewRow[];
const action = async (campaign = 1, patch: Record<string, unknown> = {}) => {
  const row = (await rows()).find((r) => r.campaign_id === campaign)!;
  return h.inject({
    method: 'POST',
    url: `/api/v1/unibox/rows/${row.enrollment_id}/action`,
    payload: {
      operation_id: randomUUID(),
      expected_revision: row.revision,
      action: 'continue',
      hold_ids: row.hold_ids,
      reviewed_message_ids: [1],
      ...patch,
    },
  });
};
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'coldemail-review-'));
  manifest = path.join(dir, 'deletions.jsonl');
  h = await createApiHarness({}, { INCOMING_DELETION_MANIFEST_PATH: manifest });
  await h.pool.query(
    await readFile(path.join(MIGRATIONS_DIR, '0031_metric_event_projection.up.sql'), 'utf8'),
  );
});
afterAll(async () => {
  await h.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await h.reset();
  await seedMailboxes(h.pool, 1);
  await h.pool.query("INSERT INTO sequences(name) VALUES('Review sequence')");
  await h.pool.query(
    'INSERT INTO sequence_steps(sequence_id,step_no,wait_days,in_thread) VALUES(1,1,0,false),(1,2,3,true),(1,3,5,true)',
  );
  await h.pool.query(
    "INSERT INTO step_variants(step_id,label,subject_template,body_template,content_hash) SELECT id,'A','Hello','Checking in','h'||id FROM sequence_steps",
  );
  await h.pool.query("INSERT INTO leads(email,tier) VALUES('lead@company.example','B')");
  await h.pool.query(
    "INSERT INTO campaigns(name,status,sequence_id) VALUES('Primary','active',1),('Sibling','paused',1)",
  );
  await h.pool.query(
    "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES(1,1,'template_auto',now()),(1,2,'template_auto',now())",
  );
  const sentAt = new Date(h.clock.now().getTime() - 86400000);
  for (const id of [1, 2])
    await h.services.store.append(
      [buildEvent.enrolled({ leadId: 1, campaignId: id, enrollmentId: id, occurredAt: sentAt })],
      { patches: [{ enrollmentId: id, nextSendAt: h.clock.now() }] },
    );
  await h.services.store.append([
    buildEvent.sent({
      leadId: 1,
      campaignId: 1,
      enrollmentId: 1,
      mailboxId: 1,
      occurredAt: sentAt,
      stepNo: 1,
      messageId: '<sent@app.example>',
      attributes: { content_hash: 'h1', variant_id: 1 },
    }),
  ]);
  await h.pool.query(
    "INSERT INTO sent_messages(message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,rendered_subject,rendered_body_text,email_format,sent_at) VALUES('<sent@app.example>',1,1,1,1,'h1','Hello','Saved retry body','plain_text',$1)",
    [sentAt],
  );
  await ingestIncoming(h.services.db, h.services.store, incoming(), h.clock.now());
});
it('company suggestions recognize subdomains without affecting sending state', async () => {
  await h.pool.query("INSERT INTO leads(email,company,tier) VALUES('owner@acme.co.uk','Acme','B')");
  await h.pool.query(
    "INSERT INTO campaign_lead_pool(lead_id,campaign_id,status,allocation_order) VALUES(2,1,'available',1)",
  );
  const before = (await h.pool.query('SELECT review_hold_ids FROM enrollments ORDER BY id')).rows;
  const res = await h.inject({
    method: 'GET',
    url: '/api/v1/unibox/link-candidates?campaign_id=1&company_sender=other%40support.acme.co.uk',
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().items.map((item: { lead_id: number }) => item.lead_id)).toEqual([2]);
  expect((await h.pool.query('SELECT review_hold_ids FROM enrollments ORDER BY id')).rows).toEqual(
    before,
  );
});
it('groups rows and returns complete reader content and immutable sent context', async () => {
  expect((await rows()).map((r) => r.sending_state)).toEqual(['held', 'held']);
  const res = await h.inject({ method: 'GET', url: '/api/v1/unibox/rows/1/messages' });
  expect(res.statusCode).toBe(200);
  expect(res.json().messages[0].body_text).toBeNull();
  expect(res.json().sent[0].body_text).toBe('Saved retry body');
  expect(
    (await h.inject({ method: 'GET', url: '/api/v1/unibox/messages/1' })).json().body_text,
  ).toContain('\n\n');
  expect(
    (
      await h.inject({
        method: 'GET',
        url: '/api/v1/unibox/rows?campaign_id=2&search=company.example',
      })
    ).json().total,
  ).toBe(1);
});
it('held, delayed and suppressed work does not reserve follow-up or opener capacity', async () => {
  const { countFollowupsDue, countPendingOpenersDue } =
    await import('../../src/db/repos/enrollmentsRepo');
  const before = new Date(h.clock.now().getTime() + 86400000);
  // The no-transport fixture records the accepted-send event; assign its mailbox as the scheduler does.
  await h.pool.query('UPDATE enrollments SET assigned_mailbox_id=1 WHERE id=1');
  await h.pool.query("UPDATE campaigns SET status='active' WHERE id=2");
  expect(await countFollowupsDue(h.services.db, before)).toBe(0);
  expect(await countPendingOpenersDue(h.services.db, before)).toBe(0);
  await action(1);
  await action(2);
  expect(await countFollowupsDue(h.services.db, before)).toBe(1);
  expect(await countPendingOpenersDue(h.services.db, before)).toBe(1);
  await action(1, {
    action: 'delay',
    until: '2026-11-02T14:00:00.000Z',
    timezone: 'UTC',
    local_time: '2026-11-02T14:00',
  });
  expect(await countFollowupsDue(h.services.db, before)).toBe(0);
  await action(1, { action: 'suppress', confirm: 'lead@company.example' });
  expect(await countPendingOpenersDue(h.services.db, before)).toBe(0);
});
it('Continue preserves progress, releases one campaign only, and does not send', async () => {
  const before = (await h.pool.query('SELECT count(*) FROM sent_messages')).rows[0].count;
  expect((await action()).statusCode).toBe(200);
  const data = await rows();
  expect(data.find((r) => r.campaign_id === 1)?.sending_state).toBe('running');
  expect(data.find((r) => r.campaign_id === 2)?.sending_state).toBe('held');
  expect(
    (await h.pool.query('SELECT current_step_no FROM enrollments WHERE id=1')).rows[0]
      .current_step_no,
  ).toBe(2);
  expect((await h.pool.query('SELECT count(*) FROM sent_messages')).rows[0].count).toBe(before);
});
it('acknowledgement refuses held rows, covers exact IDs, and supports Undo', async () => {
  const operation = randomUUID();
  const payload = {
    operation_id: operation,
    action: 'acknowledge',
    messages: [{ id: 1, expected_revision: 0, campaign_id: 1 }],
  };
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/unibox/acknowledgements', payload }))
      .statusCode,
  ).toBe(409);
  await action();
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/unibox/acknowledgements', payload }))
      .statusCode,
  ).toBe(200);
  expect(
    (await h.inject({ method: 'GET', url: '/api/v1/unibox/rows?campaign_id=1' })).json().total,
  ).toBe(0);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'undo',
          undo_operation_id: operation,
          messages: [{ id: 1, expected_revision: 1, campaign_id: 1 }],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.inject({ method: 'GET', url: '/api/v1/unibox/rows?campaign_id=1' })).json().total,
  ).toBe(1);
});
it('a newer response defeats stale Continue and acknowledgement', async () => {
  const row = (await rows())[0]!;
  await ingestIncoming(
    h.services.db,
    h.services.store,
    incoming({ uid: 2, messageId: '<new@company.example>' }),
    h.clock.now(),
  );
  expect(
    (
      await h.inject({
        method: 'POST',
        url: `/api/v1/unibox/rows/${row.enrollment_id}/action`,
        payload: {
          operation_id: randomUUID(),
          expected_revision: row.revision,
          action: 'continue',
          hold_ids: row.hold_ids,
          reviewed_message_ids: [1],
        },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'acknowledge',
          messages: [{ id: 1, expected_revision: 0, campaign_id: 1 }],
        },
      })
    ).statusCode,
  ).toBe(409);
});
it('an accepted send invalidates an open Stop dialog checkpoint', async () => {
  await action();
  const row = (await rows()).find((r) => r.campaign_id === 1)!;
  await h.services.store.append([
    buildEvent.sent({
      leadId: 1,
      campaignId: 1,
      enrollmentId: 1,
      mailboxId: 1,
      occurredAt: h.clock.now(),
      stepNo: 2,
      messageId: '<next@app.example>',
      attributes: { content_hash: 'h2', variant_id: 2 },
    }),
  ]);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/rows/1/action',
        payload: {
          operation_id: randomUUID(),
          expected_revision: row.revision,
          action: 'stop',
          hold_ids: [],
        },
      })
    ).statusCode,
  ).toBe(409);
});
it('Stop is campaign-specific; correction returns to review and keeps the checkpoint', async () => {
  expect((await action(1, { action: 'stop' })).statusCode).toBe(200);
  expect((await action(2, { action: 'stop' })).statusCode).toBe(200);
  expect((await h.pool.query('SELECT * FROM suppressions')).rows).toHaveLength(0);
  expect(
    (await action(1, { action: 'correct_stop', reason: 'Clicked the wrong action.' })).statusCode,
  ).toBe(200);
  const row = (await rows()).find((r) => r.campaign_id === 1)!;
  expect(row.sending_state).toBe('held');
  expect(row.next_step).toBe(2);
  expect(
    (await h.pool.query('SELECT next_send_at FROM enrollments WHERE id=1')).rows[0].next_send_at,
  ).toEqual(h.clock.now());
});
it('permanent suppression requires typed email and survives acknowledge/delete', async () => {
  expect((await action(1, { action: 'suppress', confirm: 'wrong' })).statusCode).toBe(400);
  expect(
    (await action(1, { action: 'suppress', confirm: 'lead@company.example' })).statusCode,
  ).toBe(200);
  const { campaignCounts } = await import('../../src/db/repos/campaignsRepo');
  expect((await campaignCounts(h.services.db, 1)).finishedCount).toBe(1);
  const outcomes = (await h.inject({ method: 'GET', url: '/api/v1/campaigns/1/outcomes' })).json();
  expect(outcomes).toMatchObject({ SUPPRESSED: 1, ACTIVE: 0, total: 1 });
  expect(
    (await h.pool.query('SELECT current_state FROM enrollments WHERE id=1')).rows[0].current_state,
  ).toBe('ACTIVE');
  expect((await action()).statusCode).toBe(409);
  expect(
    (
      await h.inject({
        method: 'DELETE',
        url: '/api/v1/suppressions/lead%40company.example',
        payload: { confirm: 'lead@company.example' },
      })
    ).statusCode,
  ).toBe(410);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'acknowledge',
          messages: [{ id: 1, expected_revision: 0, campaign_id: 1 }],
        },
      })
    ).statusCode,
  ).toBe(200);
  const deleted = await h.inject({
    method: 'DELETE',
    url: '/api/v1/unibox/messages/1/content',
    payload: { operation_id: randomUUID(), expected_revision: 1 },
  });
  expect(deleted.statusCode).toBe(200);
  expect(deleted.json().capture_status).toBe('deleted');
  expect(deleted.json().snippet).toBeNull();
  expect((await h.pool.query('SELECT email FROM suppressions')).rows).toEqual([
    { email: 'lead@company.example' },
  ]);
  await ingestIncoming(
    h.services.db,
    h.services.store,
    incoming({ folder: 'Spam' }),
    h.clock.now(),
  );
  expect((await readMessage(h.services.db, 1))?.body_text).toBeNull();
});
it('meeting credit requires a confirmed human response in the primary campaign', async () => {
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/meeting-booked' })).statusCode,
  ).toBe(409);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/1/authorship',
        payload: { operation_id: randomUUID(), expected_revision: 0, authorship: 'human' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/enrollments/2/meeting-booked' })).statusCode,
  ).toBe(409);
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/meeting-booked' })).statusCode,
  ).toBe(200);
  expect(
    (await h.inject({ method: 'POST', url: '/api/v1/enrollments/1/meeting-booked' })).statusCode,
  ).toBe(200);
  expect(
    Number(
      (await h.pool.query("SELECT count(*) FROM events WHERE type='meeting_booked'")).rows[0].count,
    ),
  ).toBe(1);
});
it('linking and authorship are independent; only a confirmed human response counts', async () => {
  const { campaignCounts } = await import('../../src/db/repos/campaignsRepo');
  expect((await h.services.metrics.replyRate({ campaignId: 1 })).numerator).toBe(0);
  const automatic = await h.inject({
    method: 'POST',
    url: '/api/v1/unibox/messages/1/authorship',
    payload: { operation_id: randomUUID(), expected_revision: 0, authorship: 'automatic' },
  });
  expect(automatic.statusCode).toBe(200);
  expect(await campaignCounts(h.services.db, 1)).toMatchObject({
    deliveryConfirmedCount: 0,
    pendingDeliveryConfirmationCount: 1,
  });
  expect((await h.services.metrics.replyRate({ campaignId: 1 })).numerator).toBe(0);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/1/authorship',
        payload: {
          operation_id: randomUUID(),
          expected_revision: 1,
          authorship: 'human',
          sentiment: 'positive',
        },
      })
    ).statusCode,
  ).toBe(200);
  expect((await h.services.metrics.replyRate({ campaignId: 1 })).numerator).toBe(1);
  expect(await campaignCounts(h.services.db, 1)).toMatchObject({
    deliveryConfirmedCount: 1,
    pendingDeliveryConfirmationCount: 0,
  });
  expect((await h.services.metrics.replyRate({ campaignId: 2 })).numerator).toBe(0);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/1/authorship',
        payload: { operation_id: randomUUID(), expected_revision: 2, authorship: 'unsure' },
      })
    ).statusCode,
  ).toBe(200);
  expect((await h.services.metrics.replyRate({ campaignId: 1 })).numerator).toBe(0);
});
it('correcting a primary campaign moves confirmed human credit without duplicate metrics or projection drift', async () => {
  await h.inject({
    method: 'POST',
    url: '/api/v1/unibox/messages/1/authorship',
    payload: {
      operation_id: randomUUID(),
      expected_revision: 0,
      authorship: 'human',
      sentiment: 'positive',
    },
  });
  const beforeCorrection = h.clock.now();
  h.clock.advance({ hours: 1 });
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/1/link',
        payload: { operation_id: randomUUID(), expected_revision: 1, lead_id: 1, campaign_id: 2 },
      })
    ).statusCode,
  ).toBe(200);
  expect((await h.services.metrics.replyRate({ campaignId: 1 })).numerator).toBe(0);
  expect((await h.services.metrics.replyRate({ campaignId: 2 })).numerator).toBe(1);
  expect(
    (await h.services.metrics.replyRate({ campaignId: 1, asOf: beforeCorrection })).numerator,
  ).toBe(1);
  expect(
    (await h.pool.query('SELECT best_reply_sentiment FROM enrollments ORDER BY id')).rows,
  ).toEqual([{ best_reply_sentiment: null }, { best_reply_sentiment: 'positive' }]);
});
it('retention waits for acknowledgement in every association and manifests prevent restore resurrection', async () => {
  const later = new Date(h.clock.now().getTime() + 31 * 86400000);
  expect(await cleanAcknowledgedContent(h.services.db, later, manifest)).toBe(0);
  await action(1);
  await action(2);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'acknowledge',
          messages: [{ id: 1, expected_revision: 0, campaign_id: 1 }],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(await cleanAcknowledgedContent(h.services.db, later, manifest)).toBe(0);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'acknowledge',
          messages: [{ id: 1, expected_revision: 1, campaign_id: 2 }],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(await cleanAcknowledgedContent(h.services.db, later, manifest)).toBe(1);
  expect(await readFile(manifest, 'utf8')).not.toContain('Away for three days');
  // A restored old body is hidden again before workers/API may serve it.
  await h.pool.query('UPDATE incoming_messages SET content_deleted_at=NULL WHERE id=1');
  await h.pool.query(
    "UPDATE incoming_message_content SET body_text='restored old body',capture_status='captured' WHERE incoming_message_id=1",
  );
  await reapplyDeletionManifest(h.services.db, manifest);
  expect((await readMessage(h.services.db, 1))?.capture_status).toBe('deleted');
});

it('a changed sequence blocks accidental Stop correction without rewriting the stop', async () => {
  await action(1, { action: 'stop' });
  await action(2, { action: 'stop' });
  await h.pool.query('UPDATE sequence_steps SET wait_days=7 WHERE step_no=2');
  expect((await action(1, { action: 'correct_stop', reason: 'Accidental click' })).statusCode).toBe(
    409,
  );
  expect((await rows()).find((r) => r.campaign_id === 1)?.sending_state).toBe('stopped');
});
it('legacy restoration is explicit, preserves the remaining step and restores only to review', async () => {
  await action(2, { action: 'stop' });
  await h.services.store.append([
    buildEvent.humanReply({
      leadId: 1,
      campaignId: 1,
      enrollmentId: 1,
      occurredAt: h.clock.now(),
      stepNo: 1,
      attributes: { incoming_message_id: 1 },
    }),
  ]);
  expect((await rows()).find((r) => r.campaign_id === 1)?.sending_state).toBe('stopped');
  const restore = await action(1, {
    action: 'restore_legacy',
    reason: 'Reviewed the old away response. It was a temporary absence.',
  });
  expect(restore.statusCode).toBe(200);
  expect((await rows()).find((r) => r.campaign_id === 1)?.sending_state).toBe('held');
  expect(
    (await h.pool.query('SELECT current_step_no FROM enrollments WHERE id=1')).rows[0]
      .current_step_no,
  ).toBe(2);
  expect(
    Number(
      (await h.pool.query("SELECT count(*) FROM events WHERE type='human_reply'")).rows[0].count,
    ),
  ).toBe(1);
  expect(Number((await h.pool.query('SELECT count(*) FROM sent_messages')).rows[0].count)).toBe(1);
});
it('linking a terminal enrollment preserves its history without an unresolvable pool hold', async () => {
  await action(1, { action: 'stop' });
  await action(2, { action: 'stop' });
  const message = (await readMessage(h.services.db, 1))!;
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/1/link',
        payload: {
          operation_id: randomUUID(),
          expected_revision: message.revision,
          lead_id: 1,
          campaign_id: 1,
        },
      })
    ).statusCode,
  ).toBe(200);
  expect((await rows()).find((r) => r.campaign_id === 1)?.sending_state).toBe('stopped');
  expect(
    Number(
      (
        await h.pool.query(
          "SELECT count(*) FROM events WHERE type='incoming_review_required' AND enrollment_id IS NULL",
        )
      ).rows[0].count,
    ),
  ).toBe(0);
});
it('a pool-only link requires a review decision before acknowledgement or explicit recontact eligibility', async () => {
  await h.pool.query("INSERT INTO leads(email,tier) VALUES('pool@elsewhere.example','B')");
  await h.pool.query(
    "INSERT INTO campaign_lead_pool(lead_id,campaign_id,status,allocation_order) VALUES(2,1,'available',1)",
  );
  await ingestIncoming(
    h.services.db,
    h.services.store,
    incoming({ uid: 2, messageId: '<pool@elsewhere.example>', from: 'pool@elsewhere.example' }),
    h.clock.now(),
  );
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/messages/2/link',
        payload: { operation_id: randomUUID(), expected_revision: 0, lead_id: 2, campaign_id: 1 },
      })
    ).statusCode,
  ).toBe(200);
  const poolRow = (await rows()).find((r) => r.lead_id === 2)!;
  expect(poolRow.sending_state).toBe('held');
  expect(poolRow.enrollment_id).toBeNull();
  const { recontactStatusByLeadIds } = await import('../../src/db/repos/leadsRepo');
  expect((await recontactStatusByLeadIds(h.services.db, [2])).get(2)?.hasUndispositionedReply).toBe(
    true,
  );
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/acknowledgements',
        payload: {
          operation_id: randomUUID(),
          action: 'acknowledge',
          messages: [{ id: 2, expected_revision: 1, campaign_id: 1, lead_id: 2 }],
        },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await h.inject({
        method: 'POST',
        url: '/api/v1/unibox/lead-action',
        payload: {
          operation_id: randomUUID(),
          expected_revision: poolRow.revision,
          lead_id: 2,
          campaign_id: 1,
          action: 'continue',
          hold_ids: poolRow.hold_ids,
          reviewed_message_ids: [2],
        },
      })
    ).statusCode,
  ).toBe(200);
  expect((await recontactStatusByLeadIds(h.services.db, [2])).get(2)).toMatchObject({
    hasReply: true,
    hasUndispositionedReply: false,
  });
  expect((await h.pool.query('SELECT * FROM enrollments WHERE lead_id=2')).rows).toHaveLength(0);
});
it('content recovery changes neither cursor, outreach control nor reply outcomes; deletion wins an in-flight recovery', async () => {
  const before = (
    await h.pool.query('SELECT review_hold_ids,current_state FROM enrollments ORDER BY id')
  ).rows;
  const count = (await h.pool.query('SELECT count(*) FROM events')).rows[0].count;
  const cursor = (await h.pool.query('SELECT * FROM mailbox_poll_cursors')).rows;
  const transport = Object.create(h.services.transport) as MailTransport;
  transport.recoverIncoming = async () =>
    incoming({
      bodyText: 'Recovered full paragraphs.\n\nSecond paragraph.',
      contentStatus: 'captured',
    });
  await recoverStoredContent(
    h.services.db,
    transport,
    1,
    { operation_id: randomUUID(), expected_revision: 0 },
    h.clock.now(),
  );
  expect((await readMessage(h.services.db, 1))?.body_text).toContain('Second paragraph.');
  expect((await h.pool.query('SELECT count(*) FROM events')).rows[0].count).toBe(count);
  expect((await h.pool.query('SELECT * FROM mailbox_poll_cursors')).rows).toEqual(cursor);
  expect(
    (await h.pool.query('SELECT review_hold_ids,current_state FROM enrollments ORDER BY id')).rows,
  ).toEqual(before);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      started = resolve;
    });
  transport.recoverIncoming = async () => {
    started();
    await pending;
    return incoming({ contentStatus: 'captured' });
  };
  const revision = (await readMessage(h.services.db, 1))!.revision;
  const recovery = recoverStoredContent(
    h.services.db,
    transport,
    1,
    { operation_id: randomUUID(), expected_revision: revision },
    h.clock.now(),
  );
  const rejected = expect(recovery).rejects.toThrow('changed during recovery');
  await ready;
  await deleteStoredContent(
    h.services.db,
    1,
    { operation_id: randomUUID(), expected_revision: revision },
    h.clock.now(),
    manifest,
  );
  release();
  await rejected;
  expect((await readMessage(h.services.db, 1))?.capture_status).toBe('deleted');
});
