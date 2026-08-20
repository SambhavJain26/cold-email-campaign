// Bounded live catch-up/never-burst canary (docs/17 §6a).
//
// This script is intentionally operator-only. It creates a dedicated campaign
// against the already-proven owner Gmail plus-address family, never prints the
// recipient address, and constrains the scheduler to two accepted messages per
// mailbox. With two mailboxes, the hard upper bound is four accepted sends.
//
// Run only under the approved live-canary plan:
//   npx tsx test/ops/catchup-live-canary.ts prepare
//   npx tsx test/ops/catchup-live-canary.ts pause
//   npx tsx test/ops/catchup-live-canary.ts status
//   npx tsx test/ops/catchup-live-canary.ts restore
import { loadConfig } from '../../src/config/env';
import { compose } from '../../src/composition';
import { createSingleLead } from '../../src/ingest/service';
import { getLeadByEmail } from '../../src/db/repos/leadsRepo';
import { createSequence } from '../../src/db/repos/sequencesRepo';
import { createCampaign, patchCampaign } from '../../src/db/repos/campaignsRepo';
import { listMailboxes, patchMailbox } from '../../src/db/repos/mailboxesRepo';
import { updateSettings } from '../../src/db/repos/settingsRepo';
import { enrollByIds } from '../../src/services/enrollment';
import { contentHashOf } from '../../src/render/hash';
import type { Pool } from 'pg';

const CAMPAIGN_NAME = 'Catch-up Never-Burst Canary - 2026-08-20';
const SEQUENCE_NAME = 'Catch-up Never-Burst Sequence - 2026-08-20';
const ALIAS_TAG = 'catchup20260820';
const DUE_COUNT = 8;
const MAX_ACCEPTED_PER_MAILBOX = 2;

async function campaignId(pool: Pick<Pool, 'query'>): Promise<number | null> {
  const result = await pool.query('SELECT id FROM campaigns WHERE name = $1', [CAMPAIGN_NAME]);
  return result.rows[0]?.id === undefined ? null : Number(result.rows[0].id);
}

async function prepare(services: ReturnType<typeof compose>): Promise<void> {
  const { db, pool, clock, sequences, store } = services;
  if ((await campaignId(pool)) !== null)
    throw new Error('dedicated catch-up campaign already exists');

  const settings = (
    await pool.query(
      `SELECT enforce_send_window, max_mailbox_daily_cap, pause_min_sends,
              delivery_confirm_hours, send_jitter_pct
         FROM settings WHERE id = 1`,
    )
  ).rows[0];
  if (
    settings.enforce_send_window !== false ||
    Number(settings.max_mailbox_daily_cap) !== 3000 ||
    Number(settings.pause_min_sends) !== 5 ||
    Number(settings.delivery_confirm_hours) !== 1 ||
    Number(settings.send_jitter_pct) !== 0
  ) {
    throw new Error('live settings no longer match the recorded compressed-canary baseline');
  }

  const boxes = await listMailboxes(db);
  if (boxes.length !== 2)
    throw new Error(`expected exactly two canary mailboxes, found ${boxes.length}`);

  const sentToday = await pool.query(
    `SELECT m.id, count(e.id)::int AS sent
       FROM mailboxes m
       LEFT JOIN events e
         ON e.type = 'sent'
        AND (e.attributes->>'mailbox_id')::bigint = m.id
        AND e.occurred_at >= date_trunc('day', now() AT TIME ZONE m.timezone)
                              AT TIME ZONE m.timezone
      GROUP BY m.id ORDER BY m.id`,
  );
  if (sentToday.rows.some((row: { sent: number }) => Number(row.sent) !== 0)) {
    throw new Error(
      'a canary mailbox already sent today; the four-send cap cannot be proven safely',
    );
  }

  const seed = (
    await pool.query(
      `SELECT email FROM leads
        WHERE email ~ '^[^+@]+\\+[^@]+@gmail\\.com$'
          AND is_erased = false
        ORDER BY id LIMIT 1`,
    )
  ).rows[0]?.email as string | undefined;
  const match = seed?.match(/^([^+@]+)\+[^@]+(@gmail\.com)$/i);
  if (!match) throw new Error('no previously proven owner Gmail plus-address family found');

  const emails = Array.from({ length: DUE_COUNT }, (_, index) =>
    `${match[1]}+${ALIAS_TAG}${index + 1}${match[2]}`.toLowerCase(),
  );
  const leadIds: number[] = [];
  for (const [index, email] of emails.entries()) {
    const created = await createSingleLead(
      { db },
      {
        email,
        first_name: 'Owner',
        company: 'Oracle Canary',
        notes: `Approved catch-up canary alias ${index + 1}; owner-controlled only`,
      },
    );
    if (!created.created && created.reason !== 'duplicate') {
      throw new Error(`owner alias ${index + 1} was refused: ${created.reason ?? 'unknown'}`);
    }
    const lead = await getLeadByEmail(db, email);
    if (!lead) throw new Error(`owner alias ${index + 1} could not be loaded after ingest`);
    leadIds.push(lead.id);
  }

  const subject = 'Oracle restart pacing check';
  const body =
    'Hi Owner, this is an approved internal message used only to verify that overdue mail is paced after the Oracle canary restarts. No action is required.';
  const sequenceId = await createSequence(db, {
    name: SEQUENCE_NAME,
    stopOnReply: true,
    steps: [
      {
        stepNo: 1,
        waitDays: 0,
        inThread: false,
        variants: [
          {
            label: 'A',
            subjectTemplate: subject,
            bodyTemplate: body,
            contentHash: contentHashOf(subject, body),
            active: true,
          },
        ],
      },
    ],
  });
  const campaign = await createCampaign(db, {
    name: CAMPAIGN_NAME,
    sequenceId,
    tierEffortConfig: { A: 'template_auto', B: 'template_auto', C: 'template_auto' },
    rampConfig: { ramp_days: 0, ramp_daily_enroll_cap: 0 },
  });
  await patchCampaign(db, campaign.id, { status: 'active' });

  const enrolled = await enrollByIds({ db, clock, sequences, store }, campaign.id, leadIds, {
    force: true,
  });
  if (enrolled.enrolled !== DUE_COUNT || enrolled.skipped.length !== 0) {
    throw new Error(`expected ${DUE_COUNT} exact enrollments, got ${JSON.stringify(enrolled)}`);
  }

  // A 20-minute synthetic pacing window with resume_cap=2 yields a ten-minute
  // same-mailbox gap while enforce_send_window=false lets the canary run after
  // the normal 18:00 IST close. The resume cap also makes >4 accepts impossible.
  for (const box of boxes) {
    await patchMailbox(db, box.id, {
      status: 'ok',
      statusReason: null,
      pausedAt: null,
      resumeCap: MAX_ACCEPTED_PER_MAILBOX,
      sendWindow: { days: [1, 2, 3, 4, 5], start: '10:00', end: '10:20' },
    });
  }

  console.log(
    JSON.stringify({
      campaignId: campaign.id,
      sequenceId,
      ownerAliases: DUE_COUNT,
      mailboxCount: boxes.length,
      maxAccepted: boxes.length * MAX_ACCEPTED_PER_MAILBOX,
    }),
  );
}

async function pause(services: ReturnType<typeof compose>): Promise<void> {
  const id = await campaignId(services.pool);
  if (id === null) throw new Error('dedicated catch-up campaign not found');
  await patchCampaign(services.db, id, { status: 'paused' });
  console.log(JSON.stringify({ campaignId: id, status: 'paused' }));
}

async function status(services: ReturnType<typeof compose>): Promise<void> {
  const id = await campaignId(services.pool);
  if (id === null) throw new Error('dedicated catch-up campaign not found');
  const campaign = await services.pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
  const sends = await services.pool.query(
    `SELECT e.occurred_at, (e.attributes->>'mailbox_id')::int AS mailbox_id
       FROM events e
      WHERE e.campaign_id = $1 AND e.type = 'sent'
      ORDER BY e.occurred_at, e.id`,
    [id],
  );
  const alerts = await services.pool.query(
    `SELECT created_at, payload
       FROM alerts
      WHERE kind = 'catchup_backlog'
        AND created_at >= (SELECT created_at FROM campaigns WHERE id = $1)
      ORDER BY created_at`,
    [id],
  );
  console.log(
    JSON.stringify({
      campaignId: id,
      campaignStatus: campaign.rows[0]?.status,
      accepted: sends.rowCount,
      sends: sends.rows,
      catchupAlerts: alerts.rows,
    }),
  );
}

async function restore(services: ReturnType<typeof compose>): Promise<void> {
  await pause(services);
  await updateSettings(
    services.db,
    {
      enforceSendWindow: true,
      maxMailboxDailyCap: 50,
      pauseMinSends: 25,
      deliveryConfirmHours: 1,
      sendJitterPct: 20,
      minRampDays: 7,
    },
    services.clock.now(),
  );
  for (const box of await listMailboxes(services.db)) {
    await patchMailbox(services.db, box.id, {
      dailyCap: 5,
      sendWindow: { days: [1, 2, 3, 4, 5], start: '10:00', end: '18:00' },
      status: 'ok',
      statusReason: null,
      pausedAt: null,
      resumeCap: null,
    });
  }
  console.log(
    JSON.stringify({
      restored: true,
      enforceSendWindow: true,
      maxMailboxDailyCap: 50,
      mailboxDailyCap: 5,
      pauseMinSends: 25,
      deliveryConfirmHours: 1,
      sendJitterPct: 20,
      minRampDays: 7,
    }),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const services = compose(loadConfig(), {});
  try {
    if (command === 'prepare') await prepare(services);
    else if (command === 'pause') await pause(services);
    else if (command === 'status') await status(services);
    else if (command === 'restore') await restore(services);
    else throw new Error('usage: catchup-live-canary.ts prepare|pause|status|restore');
  } finally {
    await services.transport.close?.();
    await services.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
