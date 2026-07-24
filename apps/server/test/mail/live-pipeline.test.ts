// B8.1: the WHOLE pipeline over the live transport - the offline dress
// rehearsal for the docs/16 §5 canary, minus a real provider. Nothing is
// mocked: composition builds SmtpImapTransport from `MAIL_TRANSPORT=smtp_imap`,
// credentials are unsealed out of `mailbox_secrets`, the scheduler sends over
// real SMTP, and the poller fetches over real IMAP and classifies what a real
// server actually stored.
//
// Requires: `docker compose up -d` (Postgres) and `docker compose up -d greenmail`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { compose, type AppServices } from '../../src/composition';
import { parseEnv } from '../../src/config/env';
import { VirtualClock } from '../../src/clock/virtual';
import { SmtpImapTransport } from '../../src/transport/smtpImap/smtpImapTransport';
import { StaticSequenceProvider } from '../../src/scheduler/staticSequenceProvider';
import { runConfirmDelivery } from '../../src/scheduler/confirmDelivery';
import { sealSecret } from '../../src/secrets/seal';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { loadCampaignShapes } from '../../src/services/campaignShapes';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';
import { testSequence } from '../helpers/sequences';
import {
  CANARY,
  DAEMON,
  LEAD,
  deliver,
  dsnMessage,
  readInbox,
  resetGreenMail,
} from './helpers/greenmail';
import { GREENMAIL } from './helpers/greenmail';

const SECRET_KEY = 'a'.repeat(64);
const MAILBOX_ID = 1;
const CAMPAIGN_ID = 1;

/** The three leads: one replies, one says STOP, one is dead. */
const REPLY_LEAD = { id: 1, email: LEAD.address };
const STOP_LEAD = { id: 2, email: 'stop@lead.test' };
const DEAD_LEAD = { id: 3, email: 'dead@lead.test' };

function liveConfig() {
  const r = parseEnv({
    DATABASE_URL: TEST_DATABASE_URL,
    SECRET_KEY,
    SESSION_KEY: 'b'.repeat(64),
    OPERATOR_EMAIL: 'op@example.com',
    OPERATOR_INITIAL_PASSWORD: 'longenough',
    MAIL_TRANSPORT: 'smtp_imap', // ← the live switch (docs/16 §1)
    MAIL_TLS_INSECURE: 'true', // local GreenMail: self-signed / no STARTTLS
    NODE_ENV: 'test',
  });
  if (!r.success) throw new Error(r.issues.join('; '));
  return r.config;
}

describe('live pipeline over SmtpImapTransport (B8.1)', () => {
  let services: AppServices;
  let pool: Pool;
  let clock: VirtualClock;
  const confirmJobs: { enrollmentId: number; stepNo: number; sentAt: Date; runAt: Date }[] = [];

  beforeAll(async () => {
    await resetGreenMail();
    clock = new VirtualClock('2026-01-05T14:00:00Z'); // Mon 09:00 ET - inside the window
    const sequences = new StaticSequenceProvider();
    sequences.register(CAMPAIGN_ID, testSequence(1, [0, 3]));

    services = compose(liveConfig(), {
      clock,
      databaseUrl: TEST_DATABASE_URL,
      sequences,
      jobPort: {
        scheduleConfirmDelivery: (job) => {
          confirmJobs.push(job);
          return Promise.resolve();
        },
      },
    });
    pool = services.pool;

    await resetCoreTables(pool);
    // A mailbox pointing at the GreenMail container, password sealed exactly
    // the way the API seals it (so DbMailboxConnectionProvider is exercised).
    await pool.query(
      `INSERT INTO mailboxes (display_name, from_address, smtp_host, smtp_port, imap_host, imap_port, daily_cap, send_window)
       VALUES ('Arjun Mehta', $1, $2, $3, $4, $5, 200, $6)`,
      [
        CANARY.address,
        GREENMAIL.host,
        GREENMAIL.smtpPort,
        GREENMAIL.host,
        GREENMAIL.imapPort,
        JSON.stringify({ days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }),
      ],
    );
    await pool.query(`INSERT INTO mailbox_secrets (mailbox_id, sealed) VALUES ($1, $2)`, [
      MAILBOX_ID,
      await sealSecret(CANARY.password, SECRET_KEY),
    ]);
    await pool.query(`INSERT INTO campaigns (name, status) VALUES ('Live canary', 'active')`);
    for (const lead of [REPLY_LEAD, STOP_LEAD, DEAD_LEAD]) {
      await pool.query(
        `INSERT INTO leads (email, first_name, company) VALUES ($1, 'Sam', 'Acme')`,
        [lead.email],
      );
      await pool.query(
        `INSERT INTO enrollments (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, next_send_at)
         VALUES ($1, $2, 'ACTIVE', 'template_auto', $3, $3)`,
        [lead.id, CAMPAIGN_ID, clock.now()],
      );
    }
    await pool.query(
      `UPDATE settings SET send_jitter_pct = 0, optout_detection = 'auto' WHERE id = 1`,
    );
  });

  afterAll(async () => {
    if (services.transport instanceof SmtpImapTransport) services.transport.close();
    await resetCoreTables(pool);
    await pool.end();
  });

  it('composition wires the REAL transport from MAIL_TRANSPORT=smtp_imap', () => {
    expect(services.transport).toBeInstanceOf(SmtpImapTransport);
  });

  it('the scheduler sends real SMTP mail; the message lands with OUR Message-ID', async () => {
    // Pacing is per-mailbox (window ÷ cap), so step the clock like reality does.
    let sent = 0;
    for (let i = 0; i < 40 && sent < 3; i++) {
      sent += (await services.scheduler.tick()).sent;
      clock.advance({ minutes: 5 });
    }
    expect(sent).toBe(3);

    const events = await pool.query(`SELECT type, lead_id FROM events ORDER BY id`);
    expect(events.rows.map((r: { type: string }) => r.type)).toEqual(['sent', 'sent', 'sent']);

    const stored = await pool.query(
      `SELECT sm.message_id, l.email FROM sent_messages sm JOIN leads l ON l.id = sm.lead_id ORDER BY sm.sent_at`,
    );
    expect(stored.rows).toHaveLength(3);

    // What the server actually holds for the reply lead is OUR message, byte for
    // byte on the threading anchor - the whole reply-matching model rests on it.
    const ourId = stored.rows.find((r: { email: string }) => r.email === REPLY_LEAD.email)!
      .message_id as string;
    const inbox = await readInbox(LEAD);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.source).toContain(`Message-ID: ${ourId}`);
    expect(inbox[0]!.source).toContain('From: Arjun Mehta <canary@coldemail.test>');

    // confirm-delivery is scheduled per send (decision N) - run them.
    expect(confirmJobs).toHaveLength(3);
    clock.advance({ hours: 6, minutes: 1 });
    for (const job of confirmJobs) {
      await runConfirmDelivery({ db: services.db, store: services.store, clock }, job);
    }
    const delivered = await pool.query(
      `SELECT count(*)::int AS n FROM events WHERE type = 'delivered'`,
    );
    expect(delivered.rows[0].n).toBe(3);
  });

  it('a real reply over IMAP is classified human_reply and stops the sequence', async () => {
    const ourId = await messageIdFor(REPLY_LEAD.id);
    await deliver({
      as: LEAD,
      to: CANARY.address,
      subject: 'Re: Quick question about Acme',
      text: 'Sounds interesting - can you send a couple of times this week?',
      inReplyTo: ourId,
      references: [ourId],
    });

    const result = await services.poller.poll(MAILBOX_ID);
    expect(result).toMatchObject({ polled: true, processed: 1, byClass: { human_reply: 1 } });

    const enrollment = await stateOf(REPLY_LEAD.id);
    expect(enrollment.current_state).toBe('REPLIED');
    expect(enrollment.next_send_at).toBeNull(); // the sequence stopped

    const row = await pool.query(
      `SELECT classification, matched_enrollment_id, message_id, in_reply_to, array_length(resulting_event_ids, 1) AS events
       FROM incoming_messages ORDER BY id DESC LIMIT 1`,
    );
    expect(row.rows[0]).toMatchObject({
      classification: 'human_reply',
      in_reply_to: ourId,
      events: 1,
    });

    // The UID high-water mark advanced - this is what makes the next poll cheap.
    const mb = await pool.query(`SELECT last_poll_uid FROM mailboxes WHERE id = $1`, [MAILBOX_ID]);
    expect(Number(mb.rows[0].last_poll_uid)).toBeGreaterThan(0);
  });

  it('a real STOP reply auto-suppresses the lead (decision F)', async () => {
    const ourId = await messageIdFor(STOP_LEAD.id);
    await deliver({
      as: LEAD,
      from: STOP_LEAD.email,
      to: CANARY.address,
      subject: 'Re: Quick question about Acme',
      text: 'STOP. Take me off this list.',
      inReplyTo: ourId,
      references: [ourId],
    });

    await services.poller.poll(MAILBOX_ID);

    expect((await stateOf(STOP_LEAD.id)).current_state).toBe('UNSUBSCRIBED');
    const suppression = await pool.query(
      `SELECT email, reason FROM suppressions WHERE email = $1`,
      [STOP_LEAD.email],
    );
    expect(suppression.rows).toHaveLength(1);
  });

  it('a real DSN over IMAP is parsed and hard-bounces the lead', async () => {
    await deliver({
      as: DAEMON,
      to: CANARY.address,
      raw: dsnMessage({
        from: DAEMON.address,
        to: CANARY.address,
        recipient: DEAD_LEAD.email,
        status: '5.1.1',
      }),
    });

    const result = await services.poller.poll(MAILBOX_ID);
    expect(result.byClass).toMatchObject({ bounce: 1 });
    expect((await stateOf(DEAD_LEAD.id)).current_state).toBe('BOUNCED');

    const bounce = await pool.query(`SELECT reason FROM events WHERE type = 'hard_bounce'`);
    expect(bounce.rows).toHaveLength(1);
    expect(bounce.rows[0].reason).toMatch(/^5\.1\.1/);
  });

  it('polling again fetches nothing and appends nothing (UID high-water + ledger)', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM events`);
    const result = await services.poller.poll(MAILBOX_ID);
    expect(result).toMatchObject({ polled: true, processed: 0, duplicates: 0 });
    const after = await pool.query(`SELECT count(*)::int AS n FROM events`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('the log tells the whole story - a rebuild replay finds ZERO drift', async () => {
    const events = await pool.query(`SELECT type, count(*)::int AS n FROM events GROUP BY type`);
    const byType = Object.fromEntries(
      events.rows.map((r: { type: string; n: number }) => [r.type, r.n]),
    );
    expect(byType).toMatchObject({
      sent: 3,
      delivered: 3,
      human_reply: 2,
      unsubscribe: 1,
      hard_bounce: 1,
    });

    // The correctness audit: fold the log the live run produced and compare it
    // to the projections that run wrote. Real transport, same invariant.
    const rebuild = await rebuildProjections(services.db, {
      dryRun: true,
      shapeFor: await loadCampaignShapes(services.db, services.sequences, 2),
      deliveryConfirmMs: 6 * 3_600_000,
      now: clock.now(),
    });
    expect(rebuild.diffs).toEqual([]);
    expect(rebuild.checked).toBe(3);
  });

  async function messageIdFor(leadId: number): Promise<string> {
    const r = await pool.query(
      `SELECT message_id FROM sent_messages WHERE lead_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [leadId],
    );
    return r.rows[0].message_id as string;
  }

  async function stateOf(
    leadId: number,
  ): Promise<{ current_state: string; next_send_at: Date | null }> {
    const r = await pool.query(
      `SELECT current_state, next_send_at FROM enrollments WHERE lead_id = $1`,
      [leadId],
    );
    return r.rows[0];
  }
});
