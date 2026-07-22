// B3.19: the transport seam holds - a second, trivial MailTransport swaps in
// via the composition override and the whole downstream pipeline (scheduler,
// eventStore, projections, confirm-delivery) behaves identically. This is the
// proof that B8's SmtpImapTransport is a one-line change.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { compose, type AppServices } from '../../src/composition';
import { parseEnv } from '../../src/config/env';
import { VirtualClock } from '../../src/clock/virtual';
import type {
  IncomingMessage,
  MailboxVerifyConfig,
  MailTransport,
  OutboundMessage,
  SendResult,
  VerifyResult,
} from '../../src/transport/types';
import { runConfirmDelivery } from '../../src/scheduler/confirmDelivery';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';
import { testSequence } from '../helpers/sequences';

/** A deliberately boring second transport: accepts everything, no inbound. */
class TrivialTransport implements MailTransport {
  readonly accepted: OutboundMessage[] = [];
  send(msg: OutboundMessage): Promise<SendResult> {
    this.accepted.push(msg);
    return Promise.resolve({ messageId: msg.headers.messageId, accepted: true });
  }
  fetchNew(_mailboxId: number): Promise<IncomingMessage[]> {
    return Promise.resolve([]);
  }
  verify(_config: MailboxVerifyConfig): Promise<VerifyResult> {
    return Promise.resolve({ smtpOk: true, imapOk: true });
  }
}

const twoStep = testSequence(1, [0, 3]);

function testConfig() {
  const r = parseEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    SECRET_KEY: 'a'.repeat(64),
    SESSION_KEY: 'b'.repeat(64),
    OPERATOR_EMAIL: 'op@example.com',
    OPERATOR_INITIAL_PASSWORD: 'longenough',
  });
  if (!r.success) throw new Error(r.issues.join('; '));
  return r.config;
}

describe('transport-swap (B3.19)', () => {
  let services: AppServices;
  let pool: Pool;
  let clock: VirtualClock;
  let transport: TrivialTransport;

  beforeAll(async () => {
    clock = new VirtualClock('2026-01-05T14:00:00Z'); // Mon 09:00 ET, inside window
    transport = new TrivialTransport();
    const sequences = new StaticSequenceProvider();
    sequences.register(1, twoStep);
    services = compose(testConfig(), {
      clock,
      transport, // ← the ONE line that changes at B8
      databaseUrl: TEST_DATABASE_URL,
      jobPort: { scheduleConfirmDelivery: () => Promise.resolve() }, // inline; confirm run manually below
      sequences,
    });
    pool = services.pool;
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('swap', 'active')`);
    await pool.query(`INSERT INTO leads (email) VALUES ('swap-lead@t.dev')`);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, next_send_at)
       VALUES (1, 1, 'ACTIVE', 'template_auto', $1, $1)`,
      [clock.now()],
    );
  });

  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  it('the scheduler sends through the swapped transport; downstream is unchanged', async () => {
    const result = await services.scheduler.tick();
    expect(result.ran).toBe(true);
    expect(result.sent).toBe(1);

    // The trivial transport saw the message…
    expect(transport.accepted).toHaveLength(1);
    expect(transport.accepted[0]!.to).toBe('swap-lead@t.dev');

    // …and every downstream artifact is identical to the MockTransport path.
    const ev = await pool.query(`SELECT type FROM events WHERE lead_id = 1 ORDER BY id`);
    expect(ev.rows.map((r: { type: string }) => r.type)).toEqual(['sent']);
    const sm = await pool.query(`SELECT step_no, mailbox_id FROM sent_messages`);
    expect(sm.rows).toEqual([{ step_no: 1, mailbox_id: 1 }]);
    const enr = await pool.query(
      `SELECT current_step_no, assigned_mailbox_id, next_send_at FROM enrollments WHERE id = 1`,
    );
    expect(enr.rows[0].current_step_no).toBe(2);
    expect(enr.rows[0].assigned_mailbox_id).toBe(1);
    expect(enr.rows[0].next_send_at).not.toBeNull();
  });

  it('confirm-delivery works identically over the swapped transport', async () => {
    clock.advance({ hours: 6, minutes: 1 });
    const appended = await runConfirmDelivery(
      { db: services.db, store: services.store, clock },
      { enrollmentId: 1, stepNo: 1, sentAt: new Date('2026-01-05T14:00:00Z'), runAt: clock.now() },
    );
    expect(appended).toBe(true);
    const ev = await pool.query(`SELECT type FROM events WHERE lead_id = 1 ORDER BY id`);
    expect(ev.rows.map((r: { type: string }) => r.type)).toEqual(['sent', 'delivered']);
  });
});
