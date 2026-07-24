// Decision E end-to-end through the REAL poller + classifier: a suggestion
// lands on the ledger row and NOWHERE else. The invariant that matters is that
// it is advisory — the human_reply event's sentiment stays null until an
// operator appends `sentiment_tagged` (decision M).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../../src/db/client';
import { buildEvent } from '../../src/domain/events';
import { EventStore } from '../../src/services/eventStore';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { threadedReply } from '../../src/transport/mock/inbound';
import { Poller } from '../../src/poller/poller';
import { CapturingAlerts } from '../../src/alerts/types';
import { StaticSuggester, type SentimentSuggester } from '../../src/sentiment/types';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

const LEAD_EMAIL = 'sarah@acmerealty.com';
const OUR_MESSAGE_ID = '<ce-1-1-1737000000000@ourdomain.com>';

describe('sentiment suggestion (decision E)', () => {
  let db: Db;
  let pool: Pool;
  let clock: VirtualClock;
  let mock: MockTransport;

  const pollerWith = (suggester?: SentimentSuggester): Poller =>
    new Poller({
      db,
      store: new EventStore(db),
      transport: mock,
      clock,
      alerts: new CapturingAlerts(),
      ...(suggester && { sentiment: suggester }),
    });

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    clock = new VirtualClock('2026-01-20T15:00:00Z');
    mock = new MockTransport(clock);
  });

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('suggest', 'active')`);
    await pool.query(`INSERT INTO leads (email) VALUES ($1)`, [LEAD_EMAIL]);
    const sentAt = new Date('2026-01-18T15:00:00Z');
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, assigned_mailbox_id)
       VALUES (1, 1, 'NEW', 'template_auto', $1, 1)`,
      [sentAt],
    );
    await new EventStore(db).append(
      [
        buildEvent.enrolled({ leadId: 1, enrollmentId: 1, campaignId: 1, occurredAt: sentAt }),
        buildEvent.sent({
          leadId: 1,
          enrollmentId: 1,
          campaignId: 1,
          occurredAt: sentAt,
          stepNo: 1,
          mailboxId: 1,
          messageId: OUR_MESSAGE_ID,
          attributes: { content_hash: 'h' },
        }),
      ],
      {
        txWork: async (tx) => {
          await tx.execute(
            sql`INSERT INTO sent_messages (message_id, enrollment_id, lead_id, mailbox_id, step_no, content_hash, sent_at)
                VALUES (${OUR_MESSAGE_ID}, 1, 1, 1, 1, 'h', ${sentAt})`,
          );
        },
      },
    );
  });

  const queueReply = (bodyText: string): void => {
    mock.queueInbound(
      1,
      threadedReply({
        from: LEAD_EMAIL,
        bodyText,
        receivedAt: clock.now(),
        inReplyTo: OUR_MESSAGE_ID,
      }),
    );
  };

  const ledgerRow = async () =>
    (
      await pool.query(
        `SELECT classification, suggested_sentiment, snippet FROM incoming_messages ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0] as { classification: string; suggested_sentiment: string | null; snippet: string };

  const replyEvent = async () =>
    (
      await pool.query(
        `SELECT type, sentiment FROM events WHERE type = 'human_reply' ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0] as { type: string; sentiment: string | null };

  it('stores the suggestion on the ledger row and leaves the EVENT untagged', async () => {
    const suggester = new StaticSuggester('positive');
    queueReply('This sounds interesting — can you send some times this week?');

    await pollerWith(suggester).poll(1);

    expect((await ledgerRow()).suggested_sentiment).toBe('positive');
    // The suggestion is advisory: effective sentiment still comes from the log.
    expect(await replyEvent()).toEqual({ type: 'human_reply', sentiment: null });
    // It classifies the UNQUOTED reply text, not the raw MIME body.
    expect(suggester.calls[0]).toContain('send some times this week');
  });

  it('is off when no suggester is configured (ANTHROPIC_API_KEY unset)', async () => {
    queueReply('Maybe later, we just signed with someone else.');
    await pollerWith().poll(1);
    expect((await ledgerRow()).suggested_sentiment).toBeNull();
  });

  it('does not spend a call on a STOP reply — that sentiment is already known', async () => {
    const suggester = new StaticSuggester('positive');
    queueReply('STOP. Take me off this list.');

    await pollerWith(suggester).poll(1);

    expect(suggester.calls).toHaveLength(0);
    expect((await ledgerRow()).suggested_sentiment).toBeNull();
    // …and the STOP still did its job.
    const row = (await pool.query(`SELECT current_state FROM enrollments WHERE id = 1`))
      .rows[0] as { current_state: string };
    expect(row.current_state).toBe('UNSUBSCRIBED');
  });

  it('a throwing suggester never fails the poll cycle', async () => {
    const exploding: SentimentSuggester = {
      suggest: () => Promise.reject(new Error('anthropic is down')),
    };
    queueReply('Sure, tell me more.');

    const result = await pollerWith(exploding).poll(1);

    expect(result).toMatchObject({ polled: true, processed: 1 });
    const row = await ledgerRow();
    expect(row.classification).toBe('human_reply');
    expect(row.suggested_sentiment).toBeNull();
    expect((await replyEvent()).type).toBe('human_reply');
  });

  it('never suggests for auto-replies or bounces (bucket 3 only)', async () => {
    const suggester = new StaticSuggester('negative');
    mock.synthesizeInbound({ mailboxId: 1, kind: 'spam' });
    await pollerWith(suggester).poll(1);

    expect(suggester.calls).toHaveLength(0);
    const row = await ledgerRow();
    expect(row.classification).toBe('unrelated');
    expect(row.suggested_sentiment).toBeNull();
  });
});
