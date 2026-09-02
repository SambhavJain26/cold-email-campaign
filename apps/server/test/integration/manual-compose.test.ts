// B4.10/B4.11: manual compose (Mode 1) — bespoke variant row, footer + checks
// on the literal path, recycle guard, and the sendOne handoff. Runs over the
// REAL composition graph (DbSequenceProvider + RenderEngine + MockTransport).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { compose, type AppServices } from '../../src/composition';
import { parseEnv } from '../../src/config/env';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { manualCompose, manualComposePrefill, manualSend } from '../../src/services/manualCompose';
import { createSequence } from '../../src/db/repos/sequencesRepo';
import { selectEligibleLeads } from '../../src/db/repos/leadsRepo';
import { contentHashOf } from '../../src/render/hash';
import { TEST_DATABASE_URL, resetCoreTables, seedMailboxes } from '../helpers/db';

const TEST_ADDRESS = '100 Test Street, Austin TX 78701'; // resetCoreTables seeds this

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

const SUBJECT = 'Loved your panel at the Austin summit';
const BODY =
  'Hey Jane,\n\nYour point about listing velocity in secondary markets stuck with me — ' +
  'we ran into exactly that pattern with two brokerages last quarter and found a workaround ' +
  'that does not involve more headcount. Happy to walk you through it if useful, no deck, ' +
  'just fifteen minutes of notes from the trenches.\n\nBest,\nSam';

describe('manual compose (B4.10)', () => {
  let services: AppServices;
  let pool: Pool;
  let clock: VirtualClock;
  let transport: MockTransport;

  beforeAll(() => {
    clock = new VirtualClock('2026-01-05T14:00:00Z'); // Mon 09:00 ET, inside window
    transport = new MockTransport(clock);
    services = compose(testConfig(), {
      clock,
      transport,
      databaseUrl: TEST_DATABASE_URL,
      jobPort: { scheduleConfirmDelivery: () => Promise.resolve() },
    });
    pool = services.pool;
  });
  afterAll(async () => {
    await resetCoreTables(pool);
    await pool.end();
  });

  const deps = () => ({
    db: services.db,
    clock,
    scheduler: services.scheduler,
    renderer: services.renderer,
  });

  /** Seed: 2-step DB sequence, campaign on it, human_written ACTIVE enrollment. */
  async function seed(): Promise<void> {
    await resetCoreTables(pool);
    await seedMailboxes(pool, 1);
    const seqId = await createSequence(services.db, {
      name: 'mode1',
      steps: [1, 2].map((stepNo) => ({
        stepNo,
        waitDays: stepNo === 1 ? 0 : 3,
        inThread: stepNo > 1,
        variants: [
          {
            label: 'A',
            subjectTemplate: `Template subject ${stepNo}`,
            bodyTemplate: `Template body ${stepNo} for {{first_name|there}}`,
            contentHash: contentHashOf(`Template subject ${stepNo}`, `Template body ${stepNo}`),
          },
        ],
      })),
    });
    await pool.query(
      `INSERT INTO campaigns (name, status, sequence_id) VALUES ('m1', 'active', $1)`,
      [seqId],
    );
    await pool.query(
      `INSERT INTO leads (email, first_name, company, state, tier) VALUES ('jane@acme.dev', 'Jane', 'Acme', 'TX', 'B')`,
    );
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, current_step_no, personalization_mode, enrolled_at, next_send_at)
       VALUES (1, 1, 'ACTIVE', 1, 'human_written', $1, $1)`,
      [clock.now()],
    );
  }

  beforeEach(seed);

  it('sends the bespoke text through the full pipeline: footer, hash, bespoke row, sent event', async () => {
    const result = await manualCompose(deps(), {
      enrollmentId: 1,
      subject: SUBJECT,
      bodyText: BODY,
    });
    expect(result.outcome).toBe('sent');
    expect(result.contentHash).toBe(contentHashOf(SUBJECT, BODY));

    // Delivered message: operator subject verbatim; footer appended, non-negotiable.
    const sent = transport.sentLog.filter((e) => e.result.accepted);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.msg.subject).toBe(SUBJECT);
    expect(sent[0]!.msg.bodyText.startsWith(BODY)).toBe(true);
    // Footer shape: opt-out and address on separate, visible lines.
    expect(sent[0]!.msg.bodyText).toContain(`\n\n`);
    expect(sent[0]!.msg.bodyText).not.toContain(`\n---\n`);
    expect(sent[0]!.msg.bodyText).toContain(`\n${TEST_ADDRESS}`);

    // Bespoke variant row: inactive + flagged, real hash (decision Q).
    const v = await pool.query(
      `SELECT active, attributes, content_hash FROM step_variants WHERE id = $1`,
      [result.variantId],
    );
    expect(v.rows[0]).toEqual({
      active: false,
      attributes: { bespoke: true },
      content_hash: result.contentHash,
    });

    // Sent event carries the bespoke hash + variant id; sent_messages row matches.
    const ev = await pool.query(`SELECT attributes FROM events WHERE type = 'sent'`);
    expect(ev.rows[0].attributes.content_hash).toBe(result.contentHash);
    expect(Number(ev.rows[0].attributes.variant_id)).toBe(result.variantId);
    const sm = await pool.query(`SELECT content_hash FROM sent_messages`);
    expect(sm.rows[0].content_hash).toBe(result.contentHash);
  });

  it('fatal pre-send checks block BEFORE anything is persisted', async () => {
    await expect(
      manualCompose(deps(), {
        enrollmentId: 1,
        subject: SUBJECT,
        bodyText: 'Quick look: https://my-site.dev', // URL in step 1 = fatal
      }),
    ).rejects.toThrow(/pre-send checks: url_in_step1/);
    const variants = await pool.query(`SELECT count(*)::int n FROM step_variants`);
    expect(variants.rows[0].n).toBe(2); // only the two template variants
    const ev = await pool.query(`SELECT count(*)::int n FROM events`);
    expect(ev.rows[0].n).toBe(0);
  });

  it('recycle guard: the same lead never gets identical content twice', async () => {
    await manualCompose(deps(), { enrollmentId: 1, subject: SUBJECT, bodyText: BODY });
    // …even via a second enrollment/campaign (the guard is keyed by lead+hash).
    await pool.query(`INSERT INTO campaigns (name, status, sequence_id)
                      SELECT 'm2', 'active', sequence_id FROM campaigns WHERE id = 1`);
    await pool.query(
      `INSERT INTO enrollments (lead_id, campaign_id, current_state, current_step_no, personalization_mode, enrolled_at, next_send_at)
       VALUES (1, 2, 'ACTIVE', 1, 'human_written', $1, $1)`,
      [clock.now()],
    );
    await expect(
      manualCompose(deps(), { enrollmentId: 2, subject: SUBJECT, bodyText: BODY }),
    ).rejects.toThrow(/recycle guard/);
  });

  it('enrollment-time recycle guard sees the bespoke hash (decision Q, via selectEligibleLeads)', async () => {
    await manualCompose(deps(), { enrollmentId: 1, subject: SUBJECT, bodyText: BODY });
    const hash = contentHashOf(SUBJECT, BODY);
    // A future sequence containing an identical template must exclude the lead…
    expect(await selectEligibleLeads(services.db, 999, [hash], 10)).toEqual([]);
    // …while an unrelated hash set does not.
    expect(await selectEligibleLeads(services.db, 999, ['other-hash'], 10)).toHaveLength(1);
  });

  it('refuses non-Mode-1 enrollments and suppressed leads', async () => {
    await pool.query(`UPDATE enrollments SET personalization_mode = 'template_auto' WHERE id = 1`);
    await expect(
      manualCompose(deps(), { enrollmentId: 1, subject: SUBJECT, bodyText: BODY }),
    ).rejects.toThrow(/Mode-1/);

    await pool.query(`UPDATE enrollments SET personalization_mode = 'human_written' WHERE id = 1`);
    await pool.query(`UPDATE leads SET is_suppressed = true WHERE id = 1`);
    await expect(
      manualCompose(deps(), { enrollmentId: 1, subject: SUBJECT, bodyText: BODY }),
    ).rejects.toThrow(/suppressed/);
  });

  it('prefills the enrollment actual due step instead of always using Step 1', async () => {
    await pool.query(`UPDATE enrollments SET current_step_no = 2, next_send_at = $1 WHERE id = 1`, [
      clock.now(),
    ]);
    const prefill = await manualComposePrefill({ db: services.db, renderer: services.renderer }, 1);
    expect(prefill.stepNo).toBe(2);
    expect(prefill.stepCount).toBe(2);
    expect(prefill.subject).toBe('Re: Template subject 2');
    expect(prefill.body).toContain('Template body 2 for Jane');
    expect(prefill.body).not.toContain('Template body 1');
    expect(prefill.draftId).toBeNull();
  });

  it('requires imported drafts to be reviewed, then marks the exact sent draft with message and event linkage', async () => {
    const imp = await pool.query(
      `INSERT INTO imports (filename, rows_total, counts)
       VALUES ('draft.csv', 1, '{"ok":1,"missing_first_name":0,"role_based":0,"invalid":0,"duplicate":0,"suppressed":0}')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO campaign_personalized_copies
         (lead_id, campaign_id, source_import_id, subject, body)
       VALUES (1, 1, $1, $2, $3)`,
      [imp.rows[0].id, SUBJECT, BODY],
    );
    const prefill = await manualComposePrefill({ db: services.db, renderer: services.renderer }, 1);
    expect(prefill).toMatchObject({
      draftId: 1,
      draftStatus: 'needs_review',
      draftSourceImportId: Number(imp.rows[0].id),
      subject: SUBJECT,
      body: BODY,
    });

    const sendInput = {
      leadId: 1,
      campaignId: 1,
      enrollmentId: 1,
      draftId: 1,
      subject: SUBJECT,
      bodyText: BODY,
    };
    await expect(
      manualSend(
        {
          ...deps(),
        },
        sendInput,
      ),
    ).rejects.toThrow(/marked ready/);

    await pool.query(`UPDATE campaign_personalized_copies SET status = 'ready' WHERE id = 1`);
    const result = await manualSend(
      {
        ...deps(),
      },
      sendInput,
    );
    expect(result.outcome).toBe('sent');
    const draft = await pool.query(
      `SELECT status, sent_message_id, sent_event_id, sent_at FROM campaign_personalized_copies WHERE id = 1`,
    );
    expect(draft.rows[0].status).toBe('sent');
    expect(draft.rows[0].sent_message_id).toBe(result.messageId);
    expect(draft.rows[0].sent_event_id).not.toBeNull();
    expect(draft.rows[0].sent_at).not.toBeNull();
  });
});
