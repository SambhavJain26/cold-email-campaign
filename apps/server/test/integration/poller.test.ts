// B3.10–B3.12: poll cycle + ledger + idempotency; classifier over the
// headers/ fixture corpus; STOP auto-unsubscribe; retry/terminal flows.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../../src/db/client';
import { buildEvent } from '../../src/domain/events';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { Poller } from '../../src/poller/poller';
import { CapturingAlerts } from '../../src/alerts/types';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';
import { loadHeaderFixture } from '../helpers/emlFixtures';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';

const twoStep = testSequence(1, [0, 3]);
const fourStep = testSequence(1, [0, 3, 4, 5]);

describe('classifier over the fixture corpus (B3.11)', () => {
  let db: Db;
  let pool: Pool;
  let clock: VirtualClock;
  let mock: MockTransport;
  let poller: Poller;

  // Fixture cast: email → (lead id, our sent message-ids referenced by the fixture)
  const cast: Record<string, { sent: { id: string; step: number }[] }> = {
    'john.smith@acmerealty.com': { sent: [{ id: '<f-john-1@ourdomain.com>', step: 1 }] },
    'maria.garcia@sunsethomes.com': { sent: [{ id: '<f-maria-1@ourdomain.com>', step: 1 }] },
    'sarah.jones@contoso.com': { sent: [{ id: '<f-sarah-1@ourdomain.com>', step: 1 }] },
    'dave@wilsonproperties.com': { sent: [{ id: '<fixture-sent-1@ourdomain.com>', step: 1 }] },
    'karen@millerhomes.com': { sent: [{ id: '<fixture-sent-2@ourdomain.com>', step: 1 }] },
    'mike@chenrealty.com': { sent: [{ id: '<fixture-sent-3@ourdomain.com>', step: 1 }] },
    'lisa@parkestates.com': {
      sent: [
        { id: '<fixture-sent-4@ourdomain.com>', step: 1 },
        { id: '<fixture-sent-5@ourdomain.com>', step: 2 },
      ],
    },
    'robert@kimproperties.com': { sent: [{ id: '<fixture-sent-6@ourdomain.com>', step: 1 }] },
  };

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    clock = new VirtualClock('2026-01-20T15:00:00Z');
    mock = new MockTransport(clock);
    poller = new Poller({
      db,
      store: new EventStore(db),
      transport: mock,
      clock,
      alerts: new CapturingAlerts(),
    });

    await resetCoreTables(pool);
    await seedMailboxes(pool, 2);
    await pool.query(`UPDATE settings SET optout_detection = 'auto' WHERE id = 1`);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('fixture', 'active')`);
    // Real event history per lead (enrolled + sent) — the eventStore fold
    // recomputes projections from events, so SQL-only state would be undone.
    const store = new EventStore(db);
    const sentAt = new Date('2026-01-18T15:00:00Z');
    let leadId = 0;
    for (const [email, info] of Object.entries(cast)) {
      leadId += 1;
      await pool.query(`INSERT INTO leads (email) VALUES ($1)`, [email]);
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, assigned_mailbox_id)
         VALUES ($1, 1, 'NEW', 'template_auto', $2, 1)`,
        [leadId, sentAt],
      );
      await store.append(
        [
          buildEvent.enrolled({
            leadId,
            enrollmentId: leadId,
            campaignId: 1,
            occurredAt: sentAt,
          }),
          ...info.sent.map((s, i) =>
            buildEvent.sent({
              leadId,
              enrollmentId: leadId,
              campaignId: 1,
              occurredAt: new Date(sentAt.getTime() + i * 3_600_000),
              stepNo: s.step,
              mailboxId: 1,
              messageId: s.id,
              attributes: { content_hash: 'h' },
            }),
          ),
        ],
        {
          txWork: async (tx) => {
            for (const [i, s] of info.sent.entries()) {
              await tx.execute(
                sql`INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
                    VALUES (${s.id}, ${leadId}, ${leadId}, 1, ${s.step}, 'h', ${new Date(sentAt.getTime() + i * 3_600_000)})`,
              );
            }
          },
        },
      );
    }
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  const pollOne = async (fixture: Parameters<typeof loadHeaderFixture>[0]) => {
    const uid = mock.queueInbound(1, loadHeaderFixture(fixture));
    await poller.poll(1);
    const row = (
      await pool.query(`SELECT * FROM incoming_messages WHERE mailbox_id = 1 AND imap_uid = $1`, [
        uid,
      ])
    ).rows[0];
    return row;
  };

  /** Events the CLASSIFIER produced (setup seeds enrolled+sent history). */
  const eventsOf = async (email: string) => {
    const r = await pool.query(
      `SELECT e.type, e.step_no FROM events e JOIN leads l ON l.id = e.lead_id
       WHERE l.email = $1 AND e.type NOT IN ('enrolled', 'sent') ORDER BY e.id`,
      [email],
    );
    return r.rows as { type: string; step_no: number | null }[];
  };

  it('gmail 5xx DSN → bounce, hard_bounce event, BOUNCED + suppression', async () => {
    const row = await pollOne('gmail-dsn-5xx');
    expect(row.classification).toBe('bounce');
    expect(row.dsn_status).toBe('5.1.1');
    expect(row.resulting_event_ids).toHaveLength(1);
    expect(await eventsOf('john.smith@acmerealty.com')).toEqual([
      { type: 'hard_bounce', step_no: 1 },
    ]);
    const st = await pool.query(
      `SELECT current_state FROM enrollments e JOIN leads l ON l.id = e.lead_id WHERE l.email = 'john.smith@acmerealty.com'`,
    );
    expect(st.rows[0].current_state).toBe('BOUNCED');
    const sup = await pool.query(
      `SELECT 1 FROM suppressions WHERE email = 'john.smith@acmerealty.com'`,
    );
    expect(sup.rows).toHaveLength(1);
  });

  it('gmail 4xx DSN → soft_bounce with retry_no, same-step retry scheduled +4h', async () => {
    const row = await pollOne('gmail-dsn-4xx');
    expect(row.classification).toBe('bounce');
    expect(row.dsn_status).toBe('4.2.2');
    expect(await eventsOf('maria.garcia@sunsethomes.com')).toEqual([
      { type: 'soft_bounce', step_no: 1 },
    ]);
    const enr = await pool.query(
      `SELECT current_state, soft_bounce_retries, next_send_at FROM enrollments e JOIN leads l ON l.id = e.lead_id WHERE l.email = 'maria.garcia@sunsethomes.com'`,
    );
    expect(enr.rows[0].current_state).toBe('ACTIVE');
    expect(enr.rows[0].soft_bounce_retries).toBe(1);
    const expected = new Date(clock.now().getTime() + 4 * 3_600_000);
    expect(new Date(enr.rows[0].next_send_at).getTime()).toBe(expected.getTime());
  });

  it('outlook DSN → hard bounce for the Exchange-style recipient', async () => {
    const row = await pollOne('outlook-dsn');
    expect(row.classification).toBe('bounce');
    expect(row.dsn_status).toBe('5.1.10');
    expect(await eventsOf('sarah.jones@contoso.com')).toEqual([
      { type: 'hard_bounce', step_no: 1 },
    ]);
  });

  it.each([['gmail-vacation'], ['outlook-autoreply']] as const)(
    '%s → auto_reply event; sequence NOT stopped',
    async (fixture) => {
      const row = await pollOne(fixture);
      expect(row.classification).toBe('auto_reply');
      expect(row.matched_enrollment_id).not.toBeNull();
      const email =
        fixture === 'gmail-vacation' ? 'dave@wilsonproperties.com' : 'karen@millerhomes.com';
      expect(await eventsOf(email)).toEqual([{ type: 'auto_reply', step_no: null }]);
      const st = await pool.query(
        `SELECT current_state FROM enrollments e JOIN leads l ON l.id = e.lead_id WHERE l.email = $1`,
        [email],
      );
      expect(st.rows[0].current_state).toBe('ACTIVE'); // OOO is not engagement
    },
  );

  it('reply with In-Reply-To → human_reply, REPLIED, incoming_message_id linked', async () => {
    const row = await pollOne('reply-in-reply-to');
    expect(row.classification).toBe('human_reply');
    expect(await eventsOf('mike@chenrealty.com')).toEqual([{ type: 'human_reply', step_no: 1 }]);
    const ev = await pool.query(`SELECT attributes, sentiment FROM events WHERE id = $1`, [
      row.resulting_event_ids[0],
    ]);
    expect(Number(ev.rows[0].attributes.incoming_message_id)).toBe(Number(row.id));
    expect(ev.rows[0].sentiment).toBeNull(); // no STOP keywords in this reply
    const st = await pool.query(
      `SELECT current_state, next_send_at FROM enrollments e JOIN leads l ON l.id = e.lead_id WHERE l.email = 'mike@chenrealty.com'`,
    );
    expect(st.rows[0].current_state).toBe('REPLIED');
    expect(st.rows[0].next_send_at).toBeNull(); // sequence stopped
  });

  it('References-only reply matches newest→oldest (step 2 wins)', async () => {
    const row = await pollOne('reply-references-only');
    expect(row.classification).toBe('human_reply');
    expect(await eventsOf('lisa@parkestates.com')).toEqual([{ type: 'human_reply', step_no: 2 }]);
  });

  it('forwarded reply with changed subject still matches via References', async () => {
    const row = await pollOne('reply-forwarded-subject-changed');
    expect(row.classification).toBe('human_reply');
    expect(await eventsOf('robert@kimproperties.com')).toEqual([
      { type: 'human_reply', step_no: 1 },
    ]);
  });

  it('spam with no threading headers → unrelated, zero events', async () => {
    const row = await pollOne('spam-unrelated');
    expect(row.classification).toBe('unrelated');
    expect(row.resulting_event_ids).toHaveLength(0);
    expect(row.matched_enrollment_id).toBeNull();
  });

  it('idempotency: the same UID delivered twice is processed once', async () => {
    const fixture = loadHeaderFixture('spam-unrelated');
    const uid = mock.queueInbound(1, { ...fixture, messageId: '<dup-uid@spam.example.net>' });
    await poller.poll(1);
    mock.queueInbound(1, { ...fixture, messageId: '<dup-uid@spam.example.net>', uid });
    await poller.poll(1);
    const rows = await pool.query(
      `SELECT count(*)::int n FROM incoming_messages WHERE imap_uid = $1 AND mailbox_id = 1`,
      [uid],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('idempotency: same Message-ID via a second mailbox → duplicate record, no events', async () => {
    const reply = loadHeaderFixture('reply-in-reply-to'); // already processed above
    mock.queueInbound(2, reply);
    const before = (await pool.query(`SELECT count(*)::int n FROM events`)).rows[0].n;
    await poller.poll(2);
    const after = (await pool.query(`SELECT count(*)::int n FROM events`)).rows[0].n;
    expect(after).toBe(before); // no double human_reply
    const dup = await pool.query(
      `SELECT classification, resulting_event_ids FROM incoming_messages WHERE mailbox_id = 2`,
    );
    expect(dup.rows[0].classification).toBe('human_reply');
    expect(dup.rows[0].resulting_event_ids).toHaveLength(0);
  });

  it('poison message: a crashing parse is logged unrelated and never wedges the poll', async () => {
    const broken = {
      ...loadHeaderFixture('spam-unrelated'),
      messageId: '<poison@spam.example.net>',
      bodyText: undefined as unknown as string, // force a classify crash
    };
    const uid = mock.queueInbound(1, broken);
    mock.queueInbound(1, {
      ...loadHeaderFixture('spam-unrelated'),
      messageId: '<after-poison@spam.example.net>',
    });
    await poller.poll(1); // must not throw
    const rows = await pool.query(
      `SELECT imap_uid, classification, snippet FROM incoming_messages WHERE mailbox_id = 1 AND imap_uid >= $1 ORDER BY imap_uid`,
      [uid],
    );
    expect(rows.rows).toHaveLength(2); // poison AND the message after it
    expect(rows.rows[0].classification).toBe('unrelated');
    expect(rows.rows[0].snippet).toMatch(/parse_error/);
  });
});

describe('poller flows through the scenario runner (B3.10/B3.12)', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  const eventTypes = async (leadId: number): Promise<string[]> => {
    const r = await s.pool.query(`SELECT type FROM events WHERE lead_id = $1 ORDER BY id`, [
      leadId,
    ]);
    return r.rows.map((row: { type: string }) => row.type);
  };

  it('a human reply stops the sequence: REPLIED, no further steps sent', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.replyAfter('L0001', { days: 1, text: 'Yeah we have this problem. What does it cost?' });
    await s.enroll({ count: 1 });

    await s.advanceDays(6);

    await s.expectEnrollment('L0001', { state: 'REPLIED' });
    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(1); // step 2 never went out
    expect(await eventTypes(1)).toEqual(['enrolled', 'sent', 'delivered', 'human_reply']);
  }, 30_000);

  it('"Remove me." auto-unsubscribes: negative sentiment + suppression (decision F)', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.replyAfter('L0001', { days: 1, text: 'Remove me.' });
    await s.enroll({ count: 1 });

    await s.advanceDays(3);

    await s.expectEnrollment('L0001', { state: 'UNSUBSCRIBED' });
    expect(await eventTypes(1)).toEqual([
      'enrolled',
      'sent',
      'delivered',
      'human_reply',
      'unsubscribe',
    ]);
    const hr = await s.pool.query(
      `SELECT sentiment FROM events WHERE lead_id = 1 AND type = 'human_reply'`,
    );
    expect(hr.rows[0].sentiment).toBe('negative');
    const un = await s.pool.query(
      `SELECT source, attributes FROM events WHERE lead_id = 1 AND type = 'unsubscribe'`,
    );
    expect(un.rows[0].source).toBe('reply');
    expect(un.rows[0].attributes.matched_keyword).toBe('remove me');
    const sup = await s.pool.query(`SELECT reason FROM suppressions WHERE email = $1`, [
      leadEmail('L0001'),
    ]);
    expect(sup.rows[0].reason).toBe('unsubscribed');
  }, 30_000);

  it('tag_only mode: the same reply lands as REPLIED, no auto-unsubscribe', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(1);
    await s.pool.query(`UPDATE settings SET optout_detection = 'tag_only' WHERE id = 1`);
    s.replyAfter('L0001', { days: 1, text: 'Remove me.' });
    await s.enroll({ count: 1 });

    await s.advanceDays(3);

    await s.expectEnrollment('L0001', { state: 'REPLIED' });
    expect(await eventTypes(1)).toEqual(['enrolled', 'sent', 'delivered', 'human_reply']);
    const sup = await s.pool.query(`SELECT 1 FROM suppressions`);
    expect(sup.rows).toHaveLength(0);
  }, 30_000);

  it('OOO does not stop the sequence: auto_reply logged, step 2 still sent', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.oooAfter('L0001', { days: 0 });
    await s.enroll({ count: 1 });

    await s.advanceDays(5);

    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(2); // both steps out
    const types = await eventTypes(1);
    expect(types).toContain('auto_reply');
    await s.expectEnrollment('L0001', { state: 'COMPLETED' });
  }, 30_000);

  it('soft bounce → 4h retry → recover → delivered (docs/07 §7)', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.onSend('L0001', { outcome: 'soft_bounce_then_deliver', retries: 1 });
    await s.enroll({ count: 1 });

    await s.advanceDays(6);

    expect(await eventTypes(1)).toEqual([
      'enrolled',
      'sent', // step 1, attempt 1
      'soft_bounce', // 4.2.2
      'sent', // step 1, retry (+4h)
      'delivered', // retry's confirm window
      'sent', // step 2
      'delivered',
    ]);
    await s.expectEnrollment('L0001', { state: 'COMPLETED' });
    // both step-1 sends carry step_no 1
    const steps = await s.pool.query(
      `SELECT step_no FROM events WHERE lead_id = 1 AND type = 'sent' ORDER BY id`,
    );
    expect(steps.rows.map((r: { step_no: number }) => r.step_no)).toEqual([1, 1, 2]);
  }, 30_000);

  it('soft ×3 exhausts retries → BOUNCED, nothing further scheduled', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.onSend('L0001', { outcome: 'soft_bounce_then_deliver', retries: 3 });
    await s.enroll({ count: 1 });

    await s.advanceDays(4);

    await s.expectEnrollment('L0001', { state: 'BOUNCED' });
    const enr = await s.pool.query(`SELECT next_send_at, soft_bounce_retries FROM enrollments`);
    expect(enr.rows[0].next_send_at).toBeNull();
    const softs = await s.pool.query(
      `SELECT count(*)::int n FROM events WHERE type = 'soft_bounce'`,
    );
    expect(softs.rows[0].n).toBe(3); // retry_no 3 > soft_retry_max 2 → terminal
    const sup = await s.pool.query(`SELECT 1 FROM suppressions`);
    expect(sup.rows).toHaveLength(0); // soft bounces never suppress
  }, 30_000);

  it('late reply after COMPLETED upgrades the terminal to REPLIED', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.replyAfter('L0001', { days: 12, text: 'Sorry for the delay — still interested!' });
    await s.enroll({ count: 1 });

    await s.advanceDays(8);
    await s.expectEnrollment('L0001', { state: 'COMPLETED' });

    await s.advanceDays(6); // the day-12 reply arrives
    await s.expectEnrollment('L0001', { state: 'REPLIED' });
  }, 30_000);

  it('reply after UNSUBSCRIBED logs the event but the state stands', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(1);
    s.replyAfter('L0001', { days: 1, text: 'unsubscribe' });
    await s.enroll({ count: 1 });
    await s.advanceDays(2);
    await s.expectEnrollment('L0001', { state: 'UNSUBSCRIBED' });

    // A second, friendlier reply threads in later.
    const sent = s.mock.lastSentTo(leadEmail('L0001'))!;
    s.mock.queueInbound(1, {
      from: leadEmail('L0001'),
      subject: 'Re: actually…',
      headers: {
        'message-id': '<second-thoughts@ext.example.com>',
        'in-reply-to': sent.msg.headers.messageId,
      },
      bodyText: 'Actually, tell me more?',
      messageId: '<second-thoughts@ext.example.com>',
      inReplyTo: sent.msg.headers.messageId,
      isDSN: false,
      receivedAt: s.clock.now(),
    });
    await s.advanceHours(1);

    const replies = await s.pool.query(
      `SELECT count(*)::int n FROM events WHERE type = 'human_reply'`,
    );
    expect(replies.rows[0].n).toBe(2); // logged
    await s.expectEnrollment('L0001', { state: 'UNSUBSCRIBED' }); // precedence stands
  }, 30_000);
});
