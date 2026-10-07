import { afterEach, describe, expect, it } from 'vitest';
import { scenario, type Scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';
import { Scheduler } from '../../src/scheduler/scheduler';
import { RenderEngine } from '../../src/render/engine';
import { listDue } from '../../src/db/repos/enrollmentsRepo';
import { getSettings } from '../../src/db/repos/settingsRepo';

describe('persisted randomized mailbox spacing', () => {
  let s: Scenario;
  afterEach(async () => {
    await s?.close();
  });
  const enable = async () =>
    s.pool.query('UPDATE mailboxes SET send_interval_min_minutes=4,send_interval_max_minutes=7');

  it('commits the deadline and accepted-send facts together, rolling all storage back on transaction failure', async () => {
    s = await scenario({ mailboxes: 1, sequence: testSequence(1, [0, 3]) });
    await enable();
    await s.importLeads(1);
    await s.enroll({ count: 1 });
    const due = (await listDue(s.db, s.clock.now()))[0]!;
    await expect(
      s.scheduler.sendOne(
        due,
        { id: 1, fromAddress: 'mb1@scenario.dev' },
        s.clock.now(),
        await getSettings(s.db),
        {
          acceptedTxWork: async () => {
            throw new Error('Injected transaction failure');
          },
        },
      ),
    ).rejects.toThrow('Injected transaction failure');
    expect(
      (await s.pool.query('SELECT last_send_at,next_allowed_send_at FROM mailboxes')).rows,
    ).toEqual([{ last_send_at: null, next_allowed_send_at: null }]);
    expect(
      (await s.pool.query("SELECT count(*)::int AS n FROM events WHERE type='sent'")).rows[0].n,
    ).toBe(0);
    expect((await s.pool.query('SELECT count(*)::int AS n FROM sent_messages')).rows[0].n).toBe(0);
    const startedAt = s.clock.now();
    const send = s.mock.send.bind(s.mock);
    s.mock.send = async (message) => {
      const accepted = await send(message);
      s.clock.advance({ minutes: 1 }); // simulate a slow accepted SMTP response
      return accepted;
    };
    expect((await s.scheduler.tick()).sent).toBe(1);
    const row = (
      await s.pool.query(
        "SELECT e.occurred_at,m.last_send_at,m.next_allowed_send_at,sm.sent_at FROM events e JOIN mailboxes m ON m.id=e.mailbox_id JOIN sent_messages sm ON sm.message_id=e.message_id WHERE e.type='sent'",
      )
    ).rows[0];
    expect(row.last_send_at).toEqual(row.occurred_at);
    expect(row.sent_at).toEqual(row.occurred_at);
    expect(row.sent_at.getTime() - startedAt.getTime()).toBe(60_000);
    expect(row.next_allowed_send_at.getTime() - row.sent_at.getTime()).toBeGreaterThanOrEqual(
      240_000,
    );
  });

  it.each([20, 25])(
    'fills four mailboxes at %i/day with varied gaps and carries remaining work to the next window',
    async (cap) => {
      s = await scenario({
        mailboxes: 4,
        dailyCap: cap,
        steadyDailyEnrollCap: 200,
        sequence: testSequence(1, [0, 3]),
        tickMinutes: 1,
        start: '2026-10-06T13:00:00Z',
        sendWindow: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      });
      await enable();
      await s.importLeads(cap * 4 + 4);
      await s.enroll({ count: cap * 4 + 4 });
      expect((await s.scheduler.tick()).sent).toBe(4);
      await s.advanceHours(4);
      const sent = s.mock.sentLog.filter((entry) => entry.result.accepted);
      expect(sent).toHaveLength(cap * 4);
      for (let id = 1; id <= 4; id++) {
        const messages = sent.filter((entry) => entry.msg.mailboxId === id);
        expect(messages).toHaveLength(cap);
        const gaps = messages
          .slice(1)
          .map((entry, index) => entry.at.getTime() - messages[index]!.at.getTime());
        expect(gaps.every((gap) => gap >= 240_000 && gap <= 420_000)).toBe(true);
        expect(new Set(gaps).size).toBeGreaterThan(1);
        const saved = (
          await s.pool.query(
            'SELECT last_send_at,next_allowed_send_at FROM mailboxes WHERE id=$1',
            [id],
          )
        ).rows[0];
        expect(saved.last_send_at).toEqual(messages.at(-1)!.at);
        const selectedGap = saved.next_allowed_send_at.getTime() - saved.last_send_at.getTime();
        expect(selectedGap).toBeGreaterThanOrEqual(240_000);
        expect(selectedGap).toBeLessThanOrEqual(420_000);
      }
      expect((await s.scheduler.tick()).sent).toBe(0);
      s.clock.set('2026-10-07T12:59:00Z');
      for (let id = 1; id <= 4; id++) await s.hooks.poll?.(id, s.clock.now());
      expect((await s.scheduler.tick()).sent).toBe(0);
      s.clock.set('2026-10-07T13:00:00Z');
      expect((await s.scheduler.tick()).sent).toBe(4);
      expect((await s.scheduler.tick()).sent).toBe(0);
    },
    90_000,
  );

  it('keeps the deadline on failed sends, checks and restart; concurrent ticks and downtime never burst', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 25,
      sequence: testSequence(1, [0, 3]),
      tickMinutes: 1,
      start: '2026-10-06T13:00:00Z',
    });
    await enable();
    await s.importLeads(5);
    await s.enroll({ count: 5 });
    s.mock.onSend('l0001@scenario.dev', {
      kind: 'transient',
      error: 'temporary connection failure',
    });
    expect((await s.scheduler.tick()).sent).toBe(0);
    const row = async () =>
      (await s.pool.query('SELECT last_send_at,next_allowed_send_at FROM mailboxes WHERE id=1'))
        .rows[0];
    expect(await row()).toEqual({ last_send_at: null, next_allowed_send_at: null });
    expect((await s.scheduler.tick()).sent).toBe(1);
    const saved = await row();
    const restarted = new Scheduler({
      db: s.db,
      pool: s.pool,
      store: s.store,
      transport: s.mock,
      clock: s.clock,
      rng: s.rng,
      sequences: s.sequences,
      renderer: new RenderEngine(),
      jobs: s.jobPort,
      alerts: s.alerts,
    });
    s.clock.advance({ minutes: 3 });
    expect((await restarted.tick()).sent).toBe(0);
    expect(await row()).toEqual(saved);
    s.clock.set(saved.next_allowed_send_at);
    s.mock.onSend('l0002@scenario.dev', {
      kind: 'transient',
      error: 'temporary connection failure',
    });
    expect((await restarted.tick()).sent).toBe(0);
    expect(await row()).toEqual(saved);
    s.clock.advance({ hours: 1 });
    await s.pool.query('UPDATE mailboxes SET resume_cap=2');
    const ticks = await Promise.all([s.scheduler.tick(), restarted.tick()]);
    expect(ticks.reduce((sum, tick) => sum + tick.sent, 0)).toBe(1);
    expect((await restarted.tick()).sent).toBe(0);
    expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(2);
  });
});
