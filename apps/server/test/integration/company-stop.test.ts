import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../src/db/client';
import { buildEvent } from '../../src/domain/events';
import { EventStore } from '../../src/services/eventStore';
import { Poller } from '../../src/poller/poller';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { CapturingAlerts } from '../../src/alerts/types';
import { recontactStatusByLeadIds, selectEligibleLeads } from '../../src/db/repos/leadsRepo';
import { poolEligibility } from '../../src/services/campaignPools';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { selfCheckViolations } from '../../src/db/repos/metricsRepo';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

describe('incoming company stops', () => {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const clock = new VirtualClock('2026-10-06T12:00:00Z');
  const transport = new MockTransport(clock);
  const store = new EventStore(db);
  const poller = new Poller({ db, store, clock, transport, alerts: new CapturingAlerts() });
  beforeAll(async () => {
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query("UPDATE settings SET incoming_stop_since='2026-10-06T10:00:00Z' WHERE id=1");
    await pool.query(
      "INSERT INTO campaigns (name,status) VALUES ('One','paused'),('Two','paused')",
    );
    for (const [i, email] of [
      'lead@company.co.uk',
      'never@company.co.uk',
      'one@gmail.com',
      'two@gmail.com',
    ].entries()) {
      const leadId = i + 1;
      await pool.query('INSERT INTO leads (email) VALUES ($1)', [email]);
      for (const campaignId of [1, 2]) {
        const eid = Number(
          (
            await pool.query(
              "INSERT INTO enrollments (lead_id,campaign_id,current_state,personalization_mode,enrolled_at) VALUES ($1,$2,'NEW','template_auto','2026-10-06T09:00:00Z') RETURNING id",
              [leadId, campaignId],
            )
          ).rows[0].id,
        );
        await store.append([
          buildEvent.enrolled({
            leadId,
            campaignId,
            enrollmentId: eid,
            occurredAt: new Date('2026-10-06T09:00:00Z'),
          }),
        ]);
        if (i !== 1 && campaignId === 1) {
          const messageId = `<sent-${leadId}@test.dev>`;
          await store.append(
            [
              buildEvent.sent({
                leadId,
                campaignId,
                enrollmentId: eid,
                stepNo: 1,
                mailboxId: 1,
                messageId,
                occurredAt: new Date('2026-10-06T09:30:00Z'),
                attributes: { content_hash: 'h' },
              }),
            ],
            {
              txWork: async (tx) => {
                await tx.execute(
                  sql`INSERT INTO sent_messages (message_id,enrollment_id,lead_id,mailbox_id,step_no,content_hash,sent_at) VALUES (${messageId},${eid},${leadId},1,1,'h','2026-10-06T09:30:00Z')`,
                );
              },
            },
          );
        }
      }
    }
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });
  function incoming(
    from: string,
    id: string,
    receivedAt = '2026-10-06T11:00:00Z',
    headers: Record<string, string> = {},
  ) {
    transport.queueInbound(1, {
      from,
      subject: 'Ticket received',
      bodyText: 'We received your request.',
      isDSN: false,
      headers,
      messageId: id,
      receivedAt: new Date(receivedAt),
    });
  }
  it('ignores history, then atomically stops contacted company leads across campaigns without reply analytics', async () => {
    incoming('help@support.company.co.uk', '<history@company.co.uk>', '2026-10-06T09:59:00Z');
    await poller.poll(1);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM events WHERE type='outreach_stopped'"))
        .rows[0].n,
    ).toBe(0);
    incoming('help@support.company.co.uk', '<ack@company.co.uk>', undefined, {
      'auto-submitted': 'auto-replied',
    });
    await poller.poll(1);
    expect(
      (await pool.query('SELECT current_state FROM enrollments WHERE lead_id=1 ORDER BY id')).rows,
    ).toEqual([{ current_state: 'STOPPED' }, { current_state: 'STOPPED' }]);
    expect(
      (await pool.query('SELECT current_state FROM enrollments WHERE lead_id=2 ORDER BY id')).rows,
    ).toEqual([{ current_state: 'ACTIVE' }, { current_state: 'ACTIVE' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM events WHERE type IN ('human_reply','unsubscribe')",
        )
      ).rows[0].n,
    ).toBe(0);
    const ledger = (
      await pool.query(
        "SELECT resulting_event_ids FROM incoming_messages WHERE message_id='<ack@company.co.uk>'",
      )
    ).rows[0];
    expect(ledger.resulting_event_ids).toHaveLength(2);
    incoming('help@company.co.uk', '<ack@company.co.uk>');
    await poller.poll(1);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM events WHERE type='outreach_stopped'"))
        .rows[0].n,
    ).toBe(2);
  });
  it('shared providers stop only the exact contacted address, including acknowledgements', async () => {
    incoming('stranger@gmail.com', '<stranger@gmail.com>');
    await poller.poll(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM enrollments WHERE lead_id IN (3,4) AND current_state='STOPPED'",
        )
      ).rows[0].n,
    ).toBe(0);
    incoming('one@gmail.com', '<auto@gmail.com>', undefined, { 'auto-submitted': 'auto-replied' });
    await poller.poll(1);
    expect(
      (await pool.query('SELECT current_state FROM enrollments WHERE lead_id=3 ORDER BY id')).rows,
    ).toEqual([{ current_state: 'STOPPED' }, { current_state: 'STOPPED' }]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM enrollments WHERE lead_id=4 AND current_state='STOPPED'",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('serializes competing stop decisions and preserves the terminal fact', async () => {
    const enrollmentId = Number(
      (await pool.query('SELECT id FROM enrollments WHERE lead_id=4 AND campaign_id=1')).rows[0].id,
    );
    const stop = buildEvent.outreachStopped({
      leadId: 4,
      enrollmentId,
      campaignId: 1,
      occurredAt: clock.now(),
      reason: 'Concurrent incoming decision',
      attributes: {
        incoming_message_id: 1,
        sender: 'two@gmail.com',
        matching_method: 'exact_address',
        company_domain: null,
      },
    });
    const results = await Promise.all([store.append([stop]), store.append([stop])]);
    expect(results.flat()).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM events WHERE enrollment_id=$1 AND type='outreach_stopped'",
          [enrollmentId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query('SELECT current_state,next_send_at FROM enrollments WHERE id=$1', [
          enrollmentId,
        ])
      ).rows[0],
    ).toEqual({ current_state: 'STOPPED', next_send_at: null });
    expect((await recontactStatusByLeadIds(db, [4])).get(4)?.hasStop).toBe(true);
    expect((await selectEligibleLeads(db, 999, [], 100)).map((lead) => lead.id)).not.toContain(4);
    const targetCampaignId = Number(
      (
        await pool.query(
          "INSERT INTO campaigns(name,status) VALUES ('Future pool','draft') RETURNING id",
        )
      ).rows[0].id,
    );
    const eligibility = await poolEligibility(
      db,
      { sequenceFor: async () => ({ id: 1, stopOnReply: true, steps: [] }) },
      targetCampaignId,
      [3],
      clock.now(),
    );
    expect(eligibility.reasons.get(3)).toBe('prior_incoming_email_stop');
    const replay = await rebuildProjections(db, {
      dryRun: true,
      shapeFor: () => ({ lastStepNo: Infinity, softRetryMax: 3 }),
      deliveryConfirmMs: 3_600_000,
      now: clock.now(),
    });
    expect(replay.checked).toBe(8);
    expect(replay.diffs).toEqual([]);
    expect(await selfCheckViolations(db, null)).toEqual([]);
  });
});
