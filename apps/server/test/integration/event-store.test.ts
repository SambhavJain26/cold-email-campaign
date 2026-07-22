// B1.5: eventStore.append — transactional projection updates + suppression
// side effects against the real test DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../src/db/client';
import type { Pool } from 'pg';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const at = (min: number) => new Date(Date.UTC(2026, 2, 2, 9, min));

describe('eventStore.append', () => {
  let db: Db;
  let pool: Pool;
  let store: EventStore;
  let leadId: number;
  let campaignId: number;
  let enrollmentId: number;

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
    leadId = (await pool.query(`INSERT INTO leads (email) VALUES ('es@test.dev') RETURNING id`))
      .rows[0].id;
    campaignId = (await pool.query(`INSERT INTO campaigns (name) VALUES ('t') RETURNING id`))
      .rows[0].id;
    enrollmentId = (
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
         VALUES ($1, $2, 'NEW', 'template_auto', now()) RETURNING id`,
        [leadId, campaignId],
      )
    ).rows[0].id;
  });

  const ids = () => ({ leadId, enrollmentId, campaignId });

  it('appends and projects: enrolled -> ACTIVE, sent advances step', async () => {
    await store.append([
      buildEvent.enrolled({ ...ids(), occurredAt: at(0) }),
      buildEvent.sent({
        ...ids(),
        occurredAt: at(1),
        stepNo: 1,
        mailboxId: 1,
        messageId: '<es1@x>',
        attributes: { content_hash: 'h1' },
      }),
    ]);
    const e = (await pool.query(`SELECT * FROM enrollments WHERE id = $1`, [enrollmentId])).rows[0];
    expect(e.current_state).toBe('ACTIVE');
    expect(e.current_step_no).toBe(2);
  });

  it('hard_bounce: BOUNCED projection + suppression row + lead flag, atomically', async () => {
    await store.append([
      buildEvent.enrolled({ ...ids(), occurredAt: at(0) }),
      buildEvent.hardBounce({ ...ids(), occurredAt: at(1), stepNo: 1, reason: '5.1.1' }),
    ]);
    const e = (await pool.query(`SELECT * FROM enrollments WHERE id = $1`, [enrollmentId])).rows[0];
    expect(e.current_state).toBe('BOUNCED');
    expect(e.next_send_at).toBeNull();
    const s = (await pool.query(`SELECT * FROM suppressions WHERE email = 'es@test.dev'`)).rows[0];
    expect(s.reason).toBe('hard_bounce');
    const l = (await pool.query(`SELECT * FROM leads WHERE id = $1`, [leadId])).rows[0];
    expect(l.is_suppressed).toBe(true);
  });

  it('"remove me": human_reply(neg) + unsubscribe in one append -> UNSUBSCRIBED once, both facts logged', async () => {
    await store.append([buildEvent.enrolled({ ...ids(), occurredAt: at(0) })]);
    await store.append([
      buildEvent.humanReply({ ...ids(), occurredAt: at(5), stepNo: 1, sentiment: 'negative' }),
      buildEvent.unsubscribe({
        ...ids(),
        occurredAt: at(5),
        source: 'reply',
        attributes: { matched_keyword: 'remove me' },
      }),
    ]);
    const e = (await pool.query(`SELECT * FROM enrollments WHERE id = $1`, [enrollmentId])).rows[0];
    expect(e.current_state).toBe('UNSUBSCRIBED'); // precedence over REPLIED
    expect(e.best_reply_sentiment).toBe('negative');
    const evs = await pool.query(`SELECT type FROM events WHERE enrollment_id = $1 ORDER BY id`, [
      enrollmentId,
    ]);
    expect(evs.rows.map((r) => r.type)).toEqual(['enrolled', 'human_reply', 'unsubscribe']);
    expect((await pool.query(`SELECT reason FROM suppressions`)).rows[0].reason).toBe(
      'unsubscribed',
    );
  });

  it('unsubscribed suppression reason is never downgraded by a later hard bounce', async () => {
    await store.append([
      buildEvent.enrolled({ ...ids(), occurredAt: at(0) }),
      buildEvent.unsubscribe({ ...ids(), occurredAt: at(1), source: 'link' }),
    ]);
    await store.append([buildEvent.hardBounce({ ...ids(), occurredAt: at(2), stepNo: 1 })]);
    const s = (await pool.query(`SELECT reason FROM suppressions WHERE email='es@test.dev'`))
      .rows[0];
    expect(s.reason).toBe('unsubscribed');
  });

  it('sentiment_tagged retag updates best_reply_sentiment without changing state', async () => {
    await store.append([buildEvent.enrolled({ ...ids(), occurredAt: at(0) })]);
    const [replyId] = await store.append([
      buildEvent.humanReply({ ...ids(), occurredAt: at(1), stepNo: 1, sentiment: 'negative' }),
    ]);
    await store.append([
      buildEvent.sentimentTagged({
        ...ids(),
        occurredAt: at(2),
        sentiment: 'positive',
        attributes: { reply_event_id: replyId!, tagged_by: 'human' },
      }),
    ]);
    const e = (await pool.query(`SELECT * FROM enrollments WHERE id = $1`, [enrollmentId])).rows[0];
    expect(e.current_state).toBe('REPLIED');
    expect(e.best_reply_sentiment).toBe('positive');
  });

  it('completeEligible: past last step + confirm window -> COMPLETED, terminal_at = lastSend+confirm', async () => {
    await store.append([
      buildEvent.enrolled({ ...ids(), occurredAt: at(0) }),
      ...[1, 2].map((n) =>
        buildEvent.sent({
          ...ids(),
          occurredAt: at(n),
          stepNo: n,
          mailboxId: 1,
          messageId: `<ce${n}@x>`,
          attributes: { content_hash: `h${n}` },
        }),
      ),
    ]);
    const shape = { lastStepNo: 2, softRetryMax: 2 };
    const confirmMs = 6 * 3_600_000;
    // too early: nothing completes
    expect(await store.completeEligible(shape, confirmMs, at(30))).toBe(0);
    // past the window
    const later = new Date(at(2).getTime() + confirmMs + 1);
    expect(await store.completeEligible(shape, confirmMs, later)).toBe(1);
    const e = (await pool.query(`SELECT * FROM enrollments WHERE id = $1`, [enrollmentId])).rows[0];
    expect(e.current_state).toBe('COMPLETED');
    expect(new Date(e.terminal_at).getTime()).toBe(at(2).getTime() + confirmMs);
  });

  it('append is atomic: a failing suppression rolls back the events too', async () => {
    // unsubscribe for a lead id that has no lead row -> suppressLead throws
    const bogus = buildEvent.unsubscribe({
      leadId: 999_999,
      enrollmentId,
      campaignId,
      occurredAt: at(0),
      source: 'link',
    });
    await expect(store.append([bogus])).rejects.toThrow();
    const count = (await pool.query(`SELECT count(*)::int AS n FROM events`)).rows[0].n;
    expect(count).toBe(0); // nothing landed
  });
});
