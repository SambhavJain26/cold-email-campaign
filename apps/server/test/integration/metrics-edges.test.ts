// B2.17: denominator edges, rate overlap, sentiment resolution, variant
// attribution, and self-check drift detection — on a small synthetic cohort.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { MetricsEngine } from '../../src/services/metrics';
import { buildEvent } from '../../src/domain/events';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const at = (min: number) => new Date(Date.UTC(2026, 3, 1, 9, min));

describe('metrics edge cases', () => {
  let db: Db;
  let pool: Pool;
  let metrics: MetricsEngine;

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    metrics = new MetricsEngine(db);
    await resetCoreTables(pool);

    // 6 leads covering every edge
    for (let i = 1; i <= 6; i++) {
      await pool.query(`INSERT INTO leads (email) VALUES ('edge-${i}@t.dev')`);
    }
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('edges', 'active')`);
    for (let i = 1; i <= 6; i++) {
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
         VALUES ($1, 1, 'NEW', 'template_auto', now())`,
        [i],
      );
    }

    const store = new EventStore(db);
    const ids = (i: number) => ({ leadId: i, enrollmentId: i, campaignId: 1 });
    const sent = (i: number, min: number, variantId?: number) =>
      buildEvent.sent({
        ...ids(i),
        occurredAt: at(min),
        stepNo: 1,
        mailboxId: 1,
        messageId: `<edge-${i}-${min}@t>`,
        attributes: { content_hash: 'h1', ...(variantId ? { variant_id: variantId } : {}) },
      });
    const delivered = (i: number, min: number) =>
      buildEvent.delivered({ ...ids(i), occurredAt: at(min), stepNo: 1 });

    await store.append([
      // lead 1: hard bounce on step 1 -> sent-to but NOT contacted (the spec's exact point)
      buildEvent.enrolled({ ...ids(1), occurredAt: at(0) }),
      sent(1, 1),
      buildEvent.hardBounce({ ...ids(1), occurredAt: at(2), stepNo: 1 }),
      // lead 2: soft bounce then recovery -> IS contacted
      buildEvent.enrolled({ ...ids(2), occurredAt: at(0) }),
      sent(2, 3),
      buildEvent.softBounce({
        ...ids(2),
        occurredAt: at(4),
        stepNo: 1,
        attributes: { retry_no: 1 },
      }),
      sent(2, 5),
      delivered(2, 6),
      // lead 3: "remove me" -> counts in reply rate AND unsub rate, one terminal (variant A opener)
      buildEvent.enrolled({ ...ids(3), occurredAt: at(0) }),
      sent(3, 7, 1),
      delivered(3, 8),
      buildEvent.humanReply({ ...ids(3), occurredAt: at(9), stepNo: 1, sentiment: 'negative' }),
      buildEvent.unsubscribe({ ...ids(3), occurredAt: at(9), source: 'reply' }),
      // lead 4: three replies -> counts ONCE in reply rate
      buildEvent.enrolled({ ...ids(4), occurredAt: at(0) }),
      sent(4, 10),
      delivered(4, 11),
      buildEvent.humanReply({ ...ids(4), occurredAt: at(12), stepNo: 1 }),
      buildEvent.humanReply({ ...ids(4), occurredAt: at(13), stepNo: 1 }),
      buildEvent.humanReply({ ...ids(4), occurredAt: at(14), stepNo: 1 }),
    ]);

    // lead 5: auto-negative reply retagged NEUTRAL -> excluded from positive rate
    await store.append([
      buildEvent.enrolled({ ...ids(5), occurredAt: at(0) }),
      sent(5, 15),
      delivered(5, 16),
    ]);
    const [reply5] = await store.append([
      buildEvent.humanReply({ ...ids(5), occurredAt: at(17), stepNo: 1, sentiment: 'negative' }),
    ]);
    await store.append([
      buildEvent.sentimentTagged({
        ...ids(5),
        occurredAt: at(18),
        sentiment: 'neutral',
        attributes: { reply_event_id: reply5!, tagged_by: 'human' },
      }),
    ]);

    // lead 6: positive reply + meeting (variant B opener)
    await store.append([
      buildEvent.enrolled({ ...ids(6), occurredAt: at(0) }),
      sent(6, 19, 2),
      delivered(6, 20),
    ]);
    const [reply6] = await store.append([
      buildEvent.humanReply({ ...ids(6), occurredAt: at(21), stepNo: 1 }),
    ]);
    await store.append([
      buildEvent.sentimentTagged({
        ...ids(6),
        occurredAt: at(22),
        sentiment: 'positive',
        attributes: { reply_event_id: reply6!, tagged_by: 'human' },
      }),
      buildEvent.meetingBooked({ ...ids(6), occurredAt: at(23) }),
    ]);
  });

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  it('contacted excludes the hard-bounced lead but includes the soft-recovered one', async () => {
    expect(await metrics.contacted()).toBe(5); // leads 2-6, not 1
  });

  it('bounce denominators use leads sent-to (6), not sent events (8)', async () => {
    const hard = await metrics.hardBounceRate();
    expect(hard).toEqual({ numerator: 1, denominator: 6, value: 16.7 });
    const soft = await metrics.softBounceRate();
    expect(soft.denominator).toBe(6);
  });

  it('the remove-me lead overlaps reply and unsub rates but is one terminal', async () => {
    const reply = await metrics.replyRate();
    expect(reply.numerator).toBe(4); // leads 3,4,5,6 — lead 4 counted once despite 3 replies
    const unsub = await metrics.unsubscribeRate();
    expect(unsub).toEqual({ numerator: 1, denominator: 5, value: 20.0 });
    const state = (await pool.query(`SELECT current_state FROM enrollments WHERE id = 3`)).rows[0];
    expect(state.current_state).toBe('UNSUBSCRIBED');
  });

  it('positive rate honors retagging: only the genuinely-positive lead counts', async () => {
    const pos = await metrics.positiveReplyRate();
    expect(pos.numerator).toBe(1); // lead 6 only; lead 5 is effectively neutral
  });

  it('meetings per 100 uses contacted', async () => {
    expect(await metrics.meetings()).toEqual({ count: 1, per100: 20.0 });
  });

  it('variant analytics attribute cohorts to the opener variant', async () => {
    const rows = await metrics.variantAnalytics();
    const v1 = rows.find((r) => r.variantId === 1)!;
    const v2 = rows.find((r) => r.variantId === 2)!;
    expect(v1.sent).toBe(1);
    expect(v1.replyRate.numerator).toBe(1); // lead 3 replied
    expect(v1.meetings).toBe(0);
    expect(v2.meetings).toBe(1); // lead 6
    expect(v2.positiveRate.numerator).toBe(1);
  });

  it('asOf gives point-in-time values (before lead 6 was tagged positive)', async () => {
    const pos = await metrics.positiveReplyRate({ asOf: at(21) });
    expect(pos.numerator).toBe(0); // tag happened at minute 22
    const reply = await metrics.replyRate({ asOf: at(12) });
    expect(reply.numerator).toBe(2); // leads 3 and 4's first reply only
  });

  it('selfCheck is clean, then catches an injected inconsistency', async () => {
    expect(await metrics.selfCheck(1)).toEqual([]);
    await pool.query(`UPDATE enrollments SET current_state = 'COMPLETED' WHERE id = 3`);
    const violations = await metrics.selfCheck(1);
    expect(violations.map((v) => v.rule)).toContain('unsubscribe event without UNSUBSCRIBED state');
    await pool.query(`UPDATE enrollments SET current_state = 'UNSUBSCRIBED' WHERE id = 3`);
    expect(await metrics.selfCheck(1)).toEqual([]);
  });
});
