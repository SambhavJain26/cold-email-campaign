// B3.4: the scenario runner harness — seeding, scripted outcomes, inline job
// queue, and time-stepping all work before any scheduler/poller exists.
// (Hooks are wired to the real tick/poll in B3.7/B3.10.)
import { afterEach, describe, expect, it } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import type { SequenceDef } from '../../src/domain/sequence';

const fourStep: SequenceDef = {
  id: 1,
  steps: [
    {
      stepNo: 1,
      waitDays: 0,
      inThread: false,
      variants: [{ id: 1, label: 'A', contentHash: 'h1' }],
    },
    {
      stepNo: 2,
      waitDays: 3,
      inThread: true,
      variants: [{ id: 2, label: 'A', contentHash: 'h2' }],
    },
    {
      stepNo: 3,
      waitDays: 4,
      inThread: true,
      variants: [{ id: 3, label: 'A', contentHash: 'h3' }],
    },
    {
      stepNo: 4,
      waitDays: 5,
      inThread: true,
      variants: [{ id: 4, label: 'A', contentHash: 'h4' }],
    },
  ],
};

describe('scenario runner skeleton', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  it('seeds mailboxes, campaign, settings, leads and enrolls in tier order', async () => {
    s = await scenario({ mailboxes: 4, dailyCap: 30, sequence: fourStep, seed: 7 });

    await s.importLeads(20, { tiers: { A: 5, B: 10, C: 5 } });
    const mb = await s.pool.query(`SELECT count(*)::int n FROM mailboxes WHERE status = 'ok'`);
    expect(mb.rows[0].n).toBe(4);

    const enrolled = await s.enroll({ count: 8 });
    expect(enrolled).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // A(1-5) then B(6-8)

    const states = await s.pool.query(
      `SELECT count(*)::int n FROM enrollments WHERE current_state = 'ACTIVE' AND next_send_at IS NOT NULL`,
    );
    expect(states.rows[0].n).toBe(8);
    await s.expectEnrollment('L0001', { state: 'ACTIVE' });
  });

  it('ticks fire at the configured cadence during advance; jobs run when due', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30 });

    const tickTimes: Date[] = [];
    s.hooks.tick = (now) => {
      tickTimes.push(now);
      return Promise.resolve();
    };

    const jobRuns: string[] = [];
    const start = s.clock.now();
    s.scheduleJob('confirm-delivery', new Date(start.getTime() + 45 * 60_000), () => {
      jobRuns.push('confirm');
      return Promise.resolve();
    });

    await s.advanceHours(2);
    expect(tickTimes).toHaveLength(4); // 30/60/90/120 min marks
    expect(jobRuns).toEqual(['confirm']); // fired once, at the 60-min step
  });

  it('scripted hard_bounce reacts to an accepted send with a queued DSN', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(2);
    s.onSend('L0001', { outcome: 'hard_bounce', dsn: '5.1.1' });

    // Simulate what sendOne will do: an accepted send through the transport.
    await s.mock.send({
      mailboxId: 1,
      to: leadEmail('L0001'),
      subject: 'hi',
      bodyText: 'hello',
      headers: { messageId: '<s1@scenario.dev>' },
    });

    await s.advanceHours(1); // DSN due 5 min after send → released to inbound queue
    const inbound = await s.mock.fetchNew(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.isDSN).toBe(true);
    expect(inbound[0]!.dsnStatus).toBe('5.1.1');
    expect(inbound[0]!.dsnRecipient).toBe(leadEmail('L0001'));
  });

  it('replyAfter arms on the FIRST accepted send and threads to its Message-ID', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(1);
    s.replyAfter('L0001', { days: 1, text: 'Sounds interesting.' });

    await s.mock.send({
      mailboxId: 1,
      to: leadEmail('L0001'),
      subject: 'hi',
      bodyText: 'hello',
      headers: { messageId: '<first@scenario.dev>' },
    });
    await s.advanceHours(12);
    expect(await s.mock.fetchNew(1)).toHaveLength(0); // not due yet

    await s.advanceHours(13);
    const inbound = await s.mock.fetchNew(1);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.inReplyTo).toBe('<first@scenario.dev>');
    expect(inbound[0]!.bodyText).toBe('Sounds interesting.');
  });
});
