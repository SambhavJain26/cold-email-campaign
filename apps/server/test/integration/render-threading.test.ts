// B4.12: threading e2e with REAL rendered templates through the mock -
// round-robin variants, Re: subjects that exactly match the step-1 render,
// header chains, byte-identical soft-retry resends, and a reply to step 2
// matching back through the poller.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import type { SequenceDef } from '../../src/domain/sequence';

// Step 1 has TWO variants (round-robin); bodies carry spintax so retry
// determinism is a real assertion, not a tautology.
const threeStep: SequenceDef = {
  id: 1,
  steps: [
    {
      stepNo: 1,
      waitDays: 0,
      inThread: false,
      variants: [
        {
          id: 11,
          label: 'A',
          contentHash: 'hash-1a',
          subjectTemplate: 'Alpha question about {{company|your listings}}',
          bodyTemplate:
            'Hi {{first_name|there}}, {{RANDOM|quick|small|brief}} thought on your listings - ' +
            'happy to share what we saw work elsewhere.\n\nBest,\nSam',
        },
        {
          id: 12,
          label: 'B',
          contentHash: 'hash-1b',
          subjectTemplate: 'Beta question about {{company|your listings}}',
          bodyTemplate:
            'Hey {{first_name|there}}, {{RANDOM|one|two|three}} observation on your pipeline - ' +
            'worth a look when you have a minute.\n\nBest,\nSam',
        },
      ],
    },
    {
      stepNo: 2,
      waitDays: 3,
      inThread: true,
      variants: [
        {
          id: 21,
          label: 'A',
          contentHash: 'hash-2',
          subjectTemplate: 'unused for in-thread sends',
          bodyTemplate: 'Hi {{first_name|there}}, circling back on my last note.\n\nBest,\nSam',
        },
      ],
    },
    {
      stepNo: 3,
      waitDays: 4,
      inThread: true,
      variants: [
        {
          id: 31,
          label: 'A',
          contentHash: 'hash-3',
          subjectTemplate: 'also unused',
          bodyTemplate: 'Hi {{first_name|there}}, last try - closing the loop.\n\nBest,\nSam',
        },
      ],
    },
  ],
};

describe('render threading e2e (B4.12)', () => {
  let s: Scenario;

  beforeAll(async () => {
    s = await scenario({ mailboxes: 1, dailyCap: 30, sequence: threeStep, tickMinutes: 15 });
    await s.importLeads(4);
    // L0004's step-1 send soft-bounces once, then the retry delivers.
    s.onSend('L0004', { outcome: 'soft_bounce_then_deliver', retries: 1 });
    // L0001 replies a day after their step-2 send (the 2nd accepted send).
    s.replyAfter('L0001', { days: 1, afterStep: 2, text: 'Sounds interesting - tell me more?' });
    await s.enroll({ count: 4 });
    await s.advanceDays(8); // step 1 (day 0), step 2 (+3), step 3 (+4), reply in between
  }, 120_000);

  afterAll(async () => {
    await s.close();
  });

  const sendsTo = (ref: string) => s.mock.sentTo(leadEmail(ref)).filter((e) => e.result.accepted);

  it('round-robin alternates step-1 variants A,B,A,B with matching variant_id attributes', async () => {
    const ev = await s.pool.query(
      `SELECT lead_id, attributes FROM events WHERE type = 'sent' AND step_no = 1 ORDER BY id LIMIT 4`,
    );
    expect(
      ev.rows.map((r: { attributes: { variant_id: number } }) => r.attributes.variant_id),
    ).toEqual([11, 12, 11, 12]);
    // rendered subjects follow the variants
    expect(sendsTo('L0001')[0]!.msg.subject).toBe('Alpha question about your listings');
    expect(sendsTo('L0002')[0]!.msg.subject).toBe('Beta question about your listings');
    expect(sendsTo('L0003')[0]!.msg.subject).toBe('Alpha question about your listings');
    expect(sendsTo('L0004')[0]!.msg.subject).toBe('Beta question about your listings');
  });

  it('follow-ups send `Re: {exact step-1 subject}` - never their own subject template', () => {
    for (const ref of ['L0002', 'L0003'] as const) {
      const sends = sendsTo(ref);
      expect(sends.length).toBeGreaterThanOrEqual(3);
      const step1Subject = sends[0]!.msg.subject;
      expect(sends[1]!.msg.subject).toBe(`Re: ${step1Subject}`);
      expect(sends[2]!.msg.subject).toBe(`Re: ${step1Subject}`);
      expect(sends[1]!.msg.subject).not.toContain('unused');
    }
  });

  it('header chain: step 2 replies to step 1; step 3 references both, same mailbox throughout', () => {
    const sends = sendsTo('L0002');
    const [one, two, three] = sends;
    expect(one!.msg.headers.inReplyTo).toBeUndefined();
    expect(two!.msg.headers.inReplyTo).toBe(one!.msg.headers.messageId);
    expect(two!.msg.headers.references).toEqual([one!.msg.headers.messageId]);
    expect(three!.msg.headers.inReplyTo).toBe(two!.msg.headers.messageId);
    expect(three!.msg.headers.references).toEqual([
      one!.msg.headers.messageId,
      two!.msg.headers.messageId,
    ]);
    expect(new Set(sends.map((e) => e.msg.mailboxId)).size).toBe(1);
  });

  it('soft-retry resends BYTE-IDENTICAL text on the SAME variant (seed + variant pinning)', async () => {
    const sends = sendsTo('L0004');
    // step-1 original + retry, then steps 2-3
    expect(sends.length).toBeGreaterThanOrEqual(2);
    const [original, retry] = sends;
    expect(retry!.msg.subject).toBe(original!.msg.subject);
    expect(retry!.msg.bodyText).toBe(original!.msg.bodyText);
    const ev = await s.pool.query(
      `SELECT attributes FROM events e JOIN leads l ON l.id = e.lead_id
       WHERE l.email = $1 AND e.type = 'sent' AND e.step_no = 1 ORDER BY e.id`,
      [leadEmail('L0004')],
    );
    expect(ev.rows).toHaveLength(2);
    expect(
      ev.rows.map((r: { attributes: { variant_id: number } }) => r.attributes.variant_id),
    ).toEqual([12, 12]);
  });

  it('a reply to the step-2 send matches through In-Reply-To and stops the sequence', async () => {
    await s.expectEnrollment('L0001', { state: 'REPLIED' });
    expect(sendsTo('L0001')).toHaveLength(2); // step 3 never went out
    const im = await s.pool.query(
      `SELECT classification, matched_enrollment_id FROM incoming_messages im
       WHERE im.from_address LIKE '%l0001%'`,
    );
    expect(im.rows[0].classification).toBe('human_reply');
    expect(im.rows[0].matched_enrollment_id).not.toBeNull();
  });
});
