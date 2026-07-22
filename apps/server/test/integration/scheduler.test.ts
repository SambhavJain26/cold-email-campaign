// B3.7–B3.9: scheduler tick, sendOne error paths, confirm-delivery,
// capacity + enroll — real scheduler over MockTransport + VirtualClock.
import { afterEach, describe, expect, it } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import type { SequenceDef } from '../../src/domain/sequence';
import { capacityToday, enroll } from '../../src/services/enrollment';
import { buildEvent } from '../../src/domain/events';

const step = (stepNo: number, waitDays: number, hash: string): SequenceDef['steps'][number] => ({
  stepNo,
  waitDays,
  inThread: stepNo > 1,
  variants: [{ id: stepNo, label: 'A', contentHash: hash }],
});

const fourStep: SequenceDef = {
  id: 1,
  steps: [step(1, 0, 'h1'), step(2, 3, 'h2'), step(3, 4, 'h3'), step(4, 5, 'h4')],
};
const twoStep: SequenceDef = { id: 1, steps: [step(1, 0, 'h1'), step(2, 3, 'h2')] };

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
    s = await scenario({ mailboxes: 1, sequence: twoStep });
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
  });

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
    s.onSend('L0001', { outcome: 'smtp_transient', times: 5 });
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
  });
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
      roomForNew: 60,
      rampCap: 20,
      suggested: 20, // min(roomForNew, rampCap)
    });
  });

  it('enroll rejects count > suggested unless force', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 30,
      sequence: fourStep,
      ramp: { ramp_days: 7, ramp_daily_enroll_cap: 2 },
    });
    await s.importLeads(5);

    await expect(enroll(deps(s), s.campaignId, 3)).rejects.toThrow(/exceeds suggested capacity/);
    const ok = await enroll(deps(s), s.campaignId, 2);
    expect(ok.enrolled).toBe(2);
    const forced = await enroll(deps(s), s.campaignId, 3, { force: true });
    expect(forced.enrolled).toBe(3);
  });

  it('selection order: A → B → C → untiered, oldest first; nurture never auto-enrolled', async () => {
    s = await scenario({ mailboxes: 1, sequence: fourStep });
    // L1-2 untiered, L3-4 C, L5-6 B, L7-8 A, L9-10 nurture
    await s.importLeads(10);
    await s.pool.query(`UPDATE leads SET tier = 'C' WHERE id IN (3,4)`);
    await s.pool.query(`UPDATE leads SET tier = 'B' WHERE id IN (5,6)`);
    await s.pool.query(`UPDATE leads SET tier = 'A' WHERE id IN (7,8)`);
    await s.pool.query(`UPDATE leads SET tier = 'nurture' WHERE id IN (9,10)`);

    const r = await enroll(deps(s), s.campaignId, 20, { force: true });
    expect(r.leadIds).toEqual([7, 8, 5, 6, 3, 4, 1, 2]); // nurture (9,10) excluded

    const modes = await s.pool.query(
      `SELECT lead_id, personalization_mode FROM enrollments ORDER BY lead_id`,
    );
    const byLead = Object.fromEntries(
      modes.rows.map((row: { lead_id: number; personalization_mode: string }) => [
        row.lead_id,
        row.personalization_mode,
      ]),
    );
    expect(byLead[7]).toBe('human_written'); // A
    expect(byLead[5]).toBe('template_researched'); // B
    expect(byLead[3]).toBe('template_auto'); // C
    expect(byLead[1]).toBe('template_auto'); // untiered default
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
