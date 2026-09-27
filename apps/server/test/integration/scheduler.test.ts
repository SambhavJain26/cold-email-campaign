// B3.7–B3.9: scheduler tick, sendOne error paths, confirm-delivery,
// capacity + enroll — real scheduler over MockTransport + VirtualClock.
import { afterEach, describe, expect, it } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import { capacityToday, enroll } from '../../src/services/enrollment';
import { buildEvent } from '../../src/domain/events';
import { testSequence } from '../helpers/sequences';
import { createSequence, loadSequenceDef } from '../../src/db/repos/sequencesRepo';
import { createOrReplaceCampaignPersonalizedCopy } from '../../src/db/repos/manualDraftsRepo';
import { contentHashOf } from '../../src/render/hash';

const fourStep = testSequence(1, [0, 3, 4, 5]);
const twoStep = testSequence(1, [0, 3]);

const eventTypes = async (s: Scenario, leadId: number): Promise<string[]> => {
  const r = await s.pool.query(`SELECT type FROM events WHERE lead_id = $1 ORDER BY id`, [leadId]);
  return r.rows.map((row: { type: string }) => row.type);
};

describe('scheduler (B3.7/B3.8)', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  it('sends step 1 to due enrollments: one per mailbox per tick, oldest first', async () => {
    s = await scenario({ mailboxes: 1, dailyCap: 30, sequence: fourStep });
    await s.importLeads(3);
    await s.enroll({ count: 3 });

    await s.advanceHours(2);

    const sent = s.mock.sentLog.filter((e) => e.result.accepted);
    expect(sent).toHaveLength(3);
    const mailbox = (await s.pool.query(`SELECT from_address FROM mailboxes WHERE id = 1`)).rows[0];
    for (const entry of sent) {
      const domain = mailbox.from_address.split('@')[1];
      expect(entry.msg.bodyText).toContain(`\nSambhav Jain\nAutomation Specialist\n${domain}\n\n`);
      expect(entry.msg.bodyHtml).toBeUndefined();
      expect(entry.msg.bodyText).not.toContain('[sender domain');
    }
    // oldest-first: enrollments share next_send_at, so id order breaks the tie
    expect(sent.map((e) => e.msg.to)).toEqual([
      leadEmail('L0001'),
      leadEmail('L0002'),
      leadEmail('L0003'),
    ]);

    const rows = await s.pool.query(
      `SELECT current_step_no, assigned_mailbox_id, next_send_at FROM enrollments ORDER BY id`,
    );
    for (const r of rows.rows) {
      expect(r.current_step_no).toBe(2);
      expect(r.assigned_mailbox_id).toBe(1);
      expect(r.next_send_at).not.toBeNull(); // step 2 scheduled +3d
    }
    const sm = await s.pool.query(`SELECT count(*)::int n FROM sent_messages`);
    expect(sm.rows[0].n).toBe(3);
  });

  it('reply-first enrollment lock suppresses a concurrently due follow-up', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep });
    await s.importLeads(1);
    await s.enroll({ count: 1 });

    let markReplyLockHeld!: () => void;
    const replyLockHeld = new Promise<void>((resolve) => {
      markReplyLockHeld = resolve;
    });
    let releaseReply!: () => void;
    const releaseReplyGate = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    const reply = s.store.withEnrollmentLock(1, async (tx) => {
      markReplyLockHeld();
      await releaseReplyGate;
      await s.store.appendUnderEnrollmentLock(tx, 1, [
        buildEvent.humanReply({
          leadId: 1,
          enrollmentId: 1,
          campaignId: s.campaignId,
          occurredAt: s.clock.now(),
          stepNo: 1,
        }),
      ]);
    });
    await replyLockHeld;

    // The scheduler can discover the old due snapshot, but it cannot make the
    // SMTP decision until the reply transaction releases this same lock.
    const tick = s.scheduler.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseReply();
    await reply;
    const result = await tick;

    expect(result.sent).toBe(0);
    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(0);
    await s.expectEnrollment('L0001', { state: 'REPLIED' });
  });

  it('walks a 2-step sequence to COMPLETED: sent → delivered ×2 → derived completion', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.importLeads(1);
    await s.enroll({ count: 1 });

    await s.advanceDays(5);

    expect(await eventTypes(s, 1)).toEqual([
      'enrolled',
      'sent', // step 1, Mon
      'delivered', // +6h confirm
      'sent', // step 2, Thu
      'delivered',
    ]);
    await s.expectEnrollment('L0001', { state: 'COMPLETED' });
  }, 30_000);

  it('threading: follow-up carries In-Reply-To/References to the step-1 Message-ID', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.importLeads(1);
    await s.enroll({ count: 1 });

    await s.advanceDays(4);

    const sends = s.mock.sentTo(leadEmail('L0001'));
    expect(sends).toHaveLength(2);
    const [first, second] = sends;
    expect(first!.msg.headers.inReplyTo).toBeUndefined();
    expect(second!.msg.headers.inReplyTo).toBe(first!.msg.headers.messageId);
    expect(second!.msg.headers.references).toEqual([first!.msg.headers.messageId]);
    // follow-up went out the SAME mailbox
    expect(second!.msg.mailboxId).toBe(first!.msg.mailboxId);
  }, 30_000);

  it('window enforcement: PT lead waits for 08:00 Pacific; default-tz lead sends immediately', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(2); // L0001, L0002
    await s.pool.query(`UPDATE leads SET state = 'CA' WHERE id = 1`); // PT
    await s.enroll({ count: 2 });

    // start = 13:00Z = 08:00 ET = 05:00 PT
    await s.advanceHours(2); // → 15:00Z (07:00 PT)
    const toPT = () => s.mock.sentTo(leadEmail('L0001'));
    const toET = () => s.mock.sentTo(leadEmail('L0002'));
    expect(toET()).toHaveLength(1); // ET lead inside window
    expect(toPT()).toHaveLength(0); // PT lead still outside

    await s.advanceHours(2); // → 17:00Z (09:00 PT)
    expect(toPT()).toHaveLength(1);
    expect(toPT()[0]!.at.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-01-05T16:00:00Z'));
  });

  it('runs two personalized-root conversations and holds only missing copy', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep, tickMinutes: 30, jitterPct: 0 });
    const sequenceId = await createSequence(s.db, {
      name: 'mixed personalized path',
      steps: [
        { stepNo: 1, waitDays: 0, inThread: false, contentSource: 'personalized', variants: [] },
        {
          stepNo: 2,
          waitDays: 1,
          inThread: true,
          contentSource: 'template',
          variants: [
            {
              label: 'A',
              subjectTemplate: 'Research note',
              bodyTemplate: 'Hi {{first_name|there}},\n\n{{custom_observation}}\n\nBest,\nSam',
              contentHash: contentHashOf('Research note', '{{custom_observation}}'),
            },
          ],
        },
        { stepNo: 3, waitDays: 1, inThread: false, contentSource: 'personalized', variants: [] },
        {
          stepNo: 4,
          waitDays: 1,
          inThread: true,
          contentSource: 'template',
          variants: [
            {
              label: 'A',
              subjectTemplate: 'Last note',
              bodyTemplate: 'Hi {{first_name|there}},\n\nClosing the loop.\n\nBest,\nSam',
              contentHash: contentHashOf('Last note', 'Closing the loop.'),
            },
          ],
        },
        {
          stepNo: 5,
          waitDays: 1,
          inThread: true,
          contentSource: 'template',
          variants: [
            {
              label: 'A',
              subjectTemplate: 'Unused follow-up subject',
              bodyTemplate: 'Hi {{first_name|there}},\n\nOne final thought.\n\nBest,\nSam',
              contentHash: contentHashOf('Unused follow-up subject', 'One final thought.'),
            },
          ],
        },
      ],
    });
    await s.pool.query(`UPDATE campaigns SET sequence_id = $1 WHERE id = $2`, [
      sequenceId,
      s.campaignId,
    ]);
    const def = await loadSequenceDef(s.db, sequenceId);
    expect(def).not.toBeNull();
    s.sequences.register(s.campaignId, def!);
    const step1Id = def!.steps[0]!.id!;
    const step3Id = def!.steps[2]!.id!;

    await s.importLeads(2);
    await s.pool.query(
      `UPDATE leads
          SET tier = 'A', first_name = CASE id WHEN 1 THEN 'Ada' ELSE 'Ben' END,
              custom_fields = jsonb_build_object('custom_observation', 'A researched signal')`,
    );
    for (const leadId of [1, 2]) {
      const subject = `Personal opener ${leadId}`;
      const body = `Hi ${leadId === 1 ? 'Ada' : 'Ben'},\n\nA genuinely personal opener for lead ${leadId}.\n\nBest,\nSam`;
      await createOrReplaceCampaignPersonalizedCopy(s.db, {
        leadId,
        campaignId: s.campaignId,
        sequenceStepId: step1Id,
        stepNo: 1,
        subject,
        body,
        contentHash: contentHashOf(subject, body),
        status: 'ready',
        replace: false,
      });
    }
    const lead2Step3Subject = 'A second personal thought for Ben';
    const lead2Step3Body = 'Hi Ben,\n\nOne more note written only for you.\n\nBest,\nSam';
    await createOrReplaceCampaignPersonalizedCopy(s.db, {
      leadId: 2,
      campaignId: s.campaignId,
      sequenceStepId: step3Id,
      stepNo: 3,
      subject: lead2Step3Subject,
      body: lead2Step3Body,
      contentHash: contentHashOf(lead2Step3Subject, lead2Step3Body),
      status: 'ready',
      replace: false,
    });

    expect(await s.enroll({ count: 2 })).toEqual([1, 2]);
    await s.advanceHours(60);

    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(2);
    expect(s.mock.sentTo(leadEmail('L0002'))).toHaveLength(3);
    expect(s.mock.sentTo(leadEmail('L0001'))[1]!.msg.bodyText.includes('A researched signal')).toBe(
      true,
    );
    const blockedAlerts = () =>
      s.alerts.emitted.filter((alert) => alert.kind === 'personalized_copy_blocked');
    expect(blockedAlerts()).toHaveLength(1);
    expect(blockedAlerts()[0]!.payload).toMatchObject({ leadId: 1, stepNo: 3, reason: 'missing' });

    await s.scheduler.tick();
    expect(blockedAlerts()).toHaveLength(1); // one alert for the active blocker episode

    const lead1Step3Subject = 'A second personal thought for Ada';
    const lead1Step3Body = 'Hi Ada,\n\nOne more note written only for you.\n\nBest,\nSam';
    await createOrReplaceCampaignPersonalizedCopy(s.db, {
      leadId: 1,
      campaignId: s.campaignId,
      sequenceStepId: step3Id,
      stepNo: 3,
      subject: lead1Step3Subject,
      body: lead1Step3Body,
      contentHash: contentHashOf(lead1Step3Subject, lead1Step3Body),
      status: 'ready',
      replace: false,
    });
    await s.advanceDays(7); // crosses the weekend and allows both continued steps to send

    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(5);
    expect(s.mock.sentTo(leadEmail('L0002'))).toHaveLength(5);
    const sent = await s.pool.query(
      `SELECT lead_id, step_no, rendered_subject, rendered_body_text, content_source,
              personalized_copy_id
         FROM sent_messages ORDER BY lead_id, step_no`,
    );
    expect(sent.rows).toHaveLength(10);
    expect(
      sent.rows.find(
        (row: { lead_id: number; step_no: number }) => row.lead_id === 1 && row.step_no === 1,
      ),
    ).toMatchObject({
      rendered_subject: 'Personal opener 1',
      content_source: 'personalized',
    });
    expect(
      sent.rows.find(
        (row: { lead_id: number; step_no: number }) => row.lead_id === 1 && row.step_no === 3,
      ),
    ).toMatchObject({
      rendered_subject: 'A second personal thought for Ada',
      content_source: 'personalized',
    });
    expect(
      sent.rows.find(
        (row: { lead_id: number; step_no: number }) => row.lead_id === 1 && row.step_no === 3,
      ).personalized_copy_id,
    ).not.toBeNull();
    const lead1Sends = s.mock.sentTo(leadEmail('L0001'));
    const [one, two, three, four, five] = lead1Sends;
    expect(two!.msg.subject).toBe('Re: Personal opener 1');
    expect(two!.msg.headers.inReplyTo).toBe(one!.msg.headers.messageId);
    expect(two!.msg.headers.references).toEqual([one!.msg.headers.messageId]);
    expect(three!.msg.subject).toBe(lead1Step3Subject);
    expect(three!.msg.headers.inReplyTo).toBeUndefined();
    expect(three!.msg.headers.references).toBeUndefined();
    expect(four!.msg.subject).toBe(`Re: ${lead1Step3Subject}`);
    expect(four!.msg.headers.inReplyTo).toBe(three!.msg.headers.messageId);
    expect(four!.msg.headers.references).toEqual([three!.msg.headers.messageId]);
    expect(five!.msg.subject).toBe(`Re: ${lead1Step3Subject}`);
    expect(five!.msg.headers.inReplyTo).toBe(four!.msg.headers.messageId);
    expect(five!.msg.headers.references).toEqual([
      three!.msg.headers.messageId,
      four!.msg.headers.messageId,
    ]);
    expect(
      (await s.pool.query(`SELECT count(*)::int n FROM personalized_copy_blockers`)).rows[0].n,
    ).toBe(0);
  }, 30_000);

  it.each(['plain_text', 'minimal_html'] as const)(
    'personalized %s retry preserves its signature snapshot after settings change',
    async (format) => {
      s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
      await s.pool.query('UPDATE compliance_settings SET email_format=$1 WHERE id=1', [format]);
      const sequenceId = await createSequence(s.db, {
        name: 'Signature retry',
        steps: [
          { stepNo: 1, waitDays: 0, inThread: false, contentSource: 'personalized', variants: [] },
          { stepNo: 2, waitDays: 3, inThread: true, contentSource: 'personalized', variants: [] },
        ],
      });
      await s.pool.query('UPDATE campaigns SET sequence_id=$1 WHERE id=$2', [
        sequenceId,
        s.campaignId,
      ]);
      const def = (await loadSequenceDef(s.db, sequenceId))!;
      s.sequences.register(s.campaignId, def);
      await s.importLeads(1);
      for (const step of def.steps) {
        const subject = `Note ${step.stepNo}`;
        const body = `Hi there,\n\nA personal note for this step.`;
        await createOrReplaceCampaignPersonalizedCopy(s.db, {
          leadId: 1,
          campaignId: s.campaignId,
          sequenceStepId: step.id!,
          stepNo: step.stepNo,
          subject,
          body,
          contentHash: contentHashOf(subject, body),
          status: 'ready',
          replace: false,
        });
      }
      s.onSend('L0001', { outcome: 'soft_bounce_then_deliver', retries: 1 });
      await s.enroll({ count: 1 });
      await s.advanceHours(1);
      const original = s.mock.sentTo(leadEmail('L0001'))[0]!.msg;
      expect(original.bodyText).toContain('\nSambhav Jain\n');
      expect(Boolean(original.bodyHtml)).toBe(format === 'minimal_html');
      await s.pool.query(
        "UPDATE compliance_settings SET signature_name='Updated Name', signature_role_line='Updated Role', email_format=$1 WHERE id=1",
        [format === 'plain_text' ? 'minimal_html' : 'plain_text'],
      );
      await s.advanceDays(6);
      const sends = s.mock.sentTo(leadEmail('L0001'));
      expect(sends).toHaveLength(3);
      expect(sends[1]!.msg.bodyText).toBe(original.bodyText);
      expect(sends[1]!.msg.bodyHtml).toBe(original.bodyHtml);
      expect(sends[2]!.msg.bodyText).toContain('\nUpdated Name\n');
      expect(sends[2]!.msg.bodyText).toContain('\nUpdated Role\n');
      expect(Boolean(sends[2]!.msg.bodyHtml)).toBe(format === 'plain_text');
    },
    30_000,
  );

  it.each(['plain_text', 'minimal_html'] as const)(
    'template %s retry reuses its original complete snapshot',
    async (format) => {
      s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
      await s.pool.query('UPDATE compliance_settings SET email_format=$1 WHERE id=1', [format]);
      await s.pool.query(
        "UPDATE compliance_settings SET unsubscribe_base_url='https://unsubscribe.example.com' WHERE id=1",
      );
      await s.importLeads(1);
      s.onSend('L0001', { outcome: 'soft_bounce_then_deliver', retries: 1 });
      await s.enroll({ count: 1 });
      await s.advanceHours(1);
      const original = s.mock.sentTo(leadEmail('L0001'))[0]!.msg;
      await s.pool.query(
        "UPDATE compliance_settings SET signature_name='Changed', email_format=$1 WHERE id=1",
        [format === 'plain_text' ? 'minimal_html' : 'plain_text'],
      );
      await s.advanceDays(6);
      const sends = s.mock.sentTo(leadEmail('L0001'));
      expect(sends.length).toBeGreaterThanOrEqual(2);
      expect(sends[1]!.msg.bodyText).toBe(original.bodyText);
      expect(sends[1]!.msg.bodyHtml).toBe(original.bodyHtml);
      expect(sends[1]!.msg.headers.listUnsubscribeUrl).toBe(original.headers.listUnsubscribeUrl);
      const snapshots = await s.pool.query(
        'SELECT email_format, rendered_body_html FROM sent_messages WHERE step_no=1 ORDER BY sent_at',
      );
      expect(snapshots.rows).toHaveLength(2);
      for (const row of snapshots.rows) {
        expect(row.email_format).toBe(format);
        expect(row.rendered_body_html).toBe(original.bodyHtml ?? null);
      }
    },
    30_000,
  );

  it('legacy template retries without saved bodies retain the HTML rendering fallback', async () => {
    s = await scenario({ mailboxes: 1, sequence: twoStep, tickMinutes: 30 });
    await s.pool.query("UPDATE compliance_settings SET email_format='minimal_html' WHERE id=1");
    await s.importLeads(1);
    s.onSend('L0001', { outcome: 'soft_bounce_then_deliver', retries: 1 });
    await s.enroll({ count: 1 });
    await s.advanceHours(1);
    await s.pool.query(
      'UPDATE sent_messages SET rendered_subject=NULL, rendered_body_text=NULL, rendered_body_html=NULL',
    );
    await s.pool.query("UPDATE compliance_settings SET email_format='plain_text' WHERE id=1");
    await s.advanceDays(2);
    const sends = s.mock.sentTo(leadEmail('L0001'));
    expect(sends).toHaveLength(2);
    expect(sends[1]!.msg.bodyHtml).toContain('<strong>Sambhav Jain</strong>');
    expect(sends[1]!.msg.subject).toBe(sends[0]!.msg.subject);
  }, 30_000);

  it('daily cap: 2/day drains 5 due enrollments across 3 days, never bursting', async () => {
    s = await scenario({ mailboxes: 1, dailyCap: 2, sequence: fourStep, tickMinutes: 30 });
    await s.importLeads(5);
    await s.enroll({ count: 5 });

    // Advance in 20h hops so each assertion lands BEFORE the next day's window opens.
    await s.advanceHours(20); // Mon 13:00Z → Tue 09:00Z (window opens 13:00Z)
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(2);
    await s.advanceHours(24); // covers Tue window
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(4);
    await s.advanceHours(24); // covers Wed window
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(5);
  }, 30_000);

  it('pacing: no two sends from one mailbox closer than minGap × 0.8', async () => {
    s = await scenario({ mailboxes: 1, dailyCap: 30, sequence: fourStep, tickMinutes: 5 });
    await s.importLeads(10);
    await s.enroll({ count: 10 });

    await s.advanceHours(9);
    const times = s.mock.sentLog.filter((e) => e.result.accepted).map((e) => e.at.getTime());
    expect(times.length).toBe(10);
    const minGap = (540 / 30) * 60_000; // 18 min
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(minGap * 0.8);
    }
  });

  it('4b transient error: nothing appended, retried next tick, mailbox recovers', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(1);
    s.onSend('L0001', { outcome: 'smtp_transient', times: 1 });
    await s.enroll({ count: 1 });

    await s.advanceHours(2);

    expect(s.mock.sentLog).toHaveLength(2); // failed attempt + retry
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(1);
    expect(await eventTypes(s, 1)).toEqual(['enrolled', 'sent']); // failure appended nothing
  });

  it('4b: five consecutive transient failures pause the mailbox (smtp_failing) + alert', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(1);
    // A NON-throttle failure: an unbroken run of rate-limit answers means the
    // provider is blocking us and takes the provider_blocked branch instead
    // (docs/06 §6, covered in provider-blocked.test.ts).
    s.onSend('L0001', {
      outcome: 'smtp_transient',
      times: 5,
      error: '451 4.3.0 Temporary system problem',
    });
    await s.enroll({ count: 1 });

    await s.advanceHours(3);

    const mb = await s.pool.query(`SELECT status, status_reason FROM mailboxes WHERE id = 1`);
    expect(mb.rows[0]).toEqual({ status: 'paused', status_reason: 'smtp_failing' });
    expect(s.alerts.emitted.some((a) => a.kind === 'mailbox_smtp_failing')).toBe(true);
    expect(await eventTypes(s, 1)).toEqual(['enrolled']); // never sent
  });

  it('4c recipient 5xx at RCPT time: hard_bounce appended directly, lead suppressed', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(1);
    s.mock.onSend(leadEmail('L0001'), { kind: 'permanent_recipient' });
    await s.enroll({ count: 1 });

    await s.advanceHours(1);

    expect(await eventTypes(s, 1)).toEqual(['enrolled', 'hard_bounce']);
    await s.expectEnrollment('L0001', { state: 'BOUNCED' });
    const sup = await s.pool.query(`SELECT reason FROM suppressions WHERE email = $1`, [
      leadEmail('L0001'),
    ]);
    expect(sup.rows[0].reason).toBe('hard_bounce');
  });

  it('4c mailbox auth failure: auth_failed + alert; work continues on the survivor', async () => {
    s = await scenario({ mailboxes: 2, sequence: fourStep, tickMinutes: 5 });
    await s.importLeads(2);
    // The first send attempt to L0001 hits a mailbox-level permanent failure.
    s.mock.onSend(leadEmail('L0001'), { kind: 'permanent_mailbox' });
    await s.enroll({ count: 2 });

    await s.advanceHours(3);

    const dead = await s.pool.query(`SELECT id FROM mailboxes WHERE status = 'auth_failed'`);
    expect(dead.rows).toHaveLength(1);
    expect(s.alerts.emitted.some((a) => a.kind === 'mailbox_auth_failed')).toBe(true);

    // Both leads still got their step 1 — rotation routed around the dead box.
    expect(s.mock.sentTo(leadEmail('L0001'))).toHaveLength(1);
    expect(s.mock.sentTo(leadEmail('L0002'))).toHaveLength(1);
    const survivor = s.mock.sentTo(leadEmail('L0001'))[0]!.msg.mailboxId;
    expect(survivor).not.toBe(dead.rows[0].id);
  });

  it('snoozed enrollments are not due until snoozed_until passes', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(1);
    await s.enroll({ count: 1 });
    const until = new Date(s.clock.now().getTime() + 26 * 3_600_000);
    await s.pool.query(`UPDATE enrollments SET snoozed_until = $1 WHERE id = 1`, [until]);

    await s.advanceDays(1);
    expect(s.mock.sentLog).toHaveLength(0);
    await s.advanceDays(1);
    expect(s.mock.sentLog.filter((e) => e.result.accepted)).toHaveLength(1);
  }, 30_000);
});

describe('capacity + enroll (B3.9)', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  const deps = (sc: Scenario) => ({
    db: sc.db,
    store: sc.store,
    clock: sc.clock,
    sequences: sc.sequences,
  });

  it('capacityToday follows the docs/06 §7 formula', async () => {
    s = await scenario({
      mailboxes: 2,
      dailyCap: 30,
      sequence: fourStep,
      ramp: { ramp_days: 7, ramp_daily_enroll_cap: 20 },
    });
    await s.importLeads(10);

    const cap = await capacityToday(deps(s), s.campaignId);
    expect(cap).toEqual({
      total: 60,
      sentSoFar: 0,
      followupsDue: 0,
      pendingOpeners: 0,
      roomForNew: 60,
      rampCap: 20,
      rampDay: 1,
      rampStage: { start_day: 1, end_day: 7, cap: 20 },
      enrolledToday: 0,
      effectiveDailyCap: 20,
      campaignCapRemaining: 20,
      poolAvailable: null,
      suggested: 20, // min(roomForNew, rampCap)
    });
  });

  it('enroll rejects count above the permanent campaign allowance even with force', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 30,
      sequence: fourStep,
      ramp: { ramp_days: 7, ramp_daily_enroll_cap: 2 },
    });
    await s.importLeads(5);

    await expect(enroll(deps(s), s.campaignId, 3)).rejects.toThrow(
      /exceeds the current enrollment allowance/,
    );
    const ok = await enroll(deps(s), s.campaignId, 2);
    expect(ok.enrolled).toBe(2);
    await expect(enroll(deps(s), s.campaignId, 1, { force: true })).rejects.toThrow(
      /current enrollment allowance 0/,
    );
  });

  it('selection order is A → B; untiered and nurture cannot enroll', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    // L1-4 untiered, L5-6 B, L7-8 A, L9-10 nurture.
    await s.importLeads(10);
    await s.pool.query(`UPDATE leads SET tier = NULL WHERE id IN (1,2,3,4)`);
    await s.pool.query(`UPDATE leads SET tier = 'B' WHERE id IN (5,6)`);
    await s.pool.query(`UPDATE leads SET tier = 'A' WHERE id IN (7,8)`);
    await s.pool.query(
      `UPDATE leads SET tier = NULL, outreach_status = 'nurture' WHERE id IN (9,10)`,
    );

    const r = await enroll(deps(s), s.campaignId, 15, { force: true });
    expect(r.leadIds).toEqual([7, 8, 5, 6]);

    const modes = await s.pool.query(
      `SELECT lead_id, personalization_mode FROM enrollments ORDER BY lead_id`,
    );
    const byLead = Object.fromEntries(
      modes.rows.map((row: { lead_id: number; personalization_mode: string }) => [
        row.lead_id,
        row.personalization_mode,
      ]),
    );
    expect(byLead[7]).toBe('template_researched'); // A
    expect(byLead[5]).toBe('template_auto'); // B
    expect(byLead[3]).toBeUndefined();
    expect(byLead[1]).toBeUndefined();
  });

  it('recycle guard (decision Q): a lead who already received a matching content_hash is skipped', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(3);

    // L0001 received hash h1 in a previous campaign
    await s.pool.query(`INSERT INTO campaigns (name, status) VALUES ('Pass 0', 'completed')`);
    const enr = await s.pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
       VALUES (1, 2, 'ACTIVE', 'template_auto', $1) RETURNING id`,
      [s.clock.now()],
    );
    await s.store.append([
      buildEvent.sent({
        leadId: 1,
        enrollmentId: enr.rows[0].id,
        campaignId: 2,
        occurredAt: s.clock.now(),
        stepNo: 1,
        mailboxId: 1,
        messageId: '<old-1@scenario.dev>',
        attributes: { content_hash: 'h1' },
      }),
    ]);

    const r = await enroll(deps(s), s.campaignId, 10, { force: true });
    expect(r.leadIds).toEqual([2, 3]); // L0001 blocked by the hash guard
  });

  it('suppressed leads are never enrolled', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    await s.importLeads(3);
    await s.pool.query(`UPDATE leads SET is_suppressed = true WHERE id = 2`);
    const r = await enroll(deps(s), s.campaignId, 10, { force: true });
    expect(r.leadIds).toEqual([1, 3]);
  });
});
