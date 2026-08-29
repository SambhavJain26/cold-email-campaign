import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMailboxes } from '../helpers/db';
import { createApiHarness, type ApiHarness } from './helpers/app';

const SEQUENCE = {
  name: 'Pool sequence',
  stop_on_reply: true,
  stop_on_hard_bounce: true,
  stop_on_unsubscribe: true,
  steps: [
    {
      step_no: 1,
      wait_days: 0,
      in_thread: true,
      variants: [
        {
          label: 'A',
          subject_template: 'Hello {{company|there}}',
          body_template: 'Hi {{first_name|there}}, checking in.',
          active: true,
        },
      ],
    },
  ],
};

function multipartCsv(content: string): { payload: Buffer; contentType: string } {
  const boundary = '----campaign-pool-test';
  return {
    payload: Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="pool.csv"\r\n' +
        'Content-Type: text/csv\r\n\r\n' +
        `${content}\r\n--${boundary}--\r\n`,
    ),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function createCampaign(h: ApiHarness, sequenceId: number, name: string) {
  const response = await h.inject({
    method: 'POST',
    url: '/api/v1/campaigns',
    payload: {
      name,
      sequence_id: sequenceId,
      acknowledge_tier_a_manual: true,
      steady_daily_enroll_cap: 15,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as { id: number };
}

describe('campaign pools, automatic enrollment, and permanent caps', () => {
  let h: ApiHarness;
  let sequenceId: number;

  beforeAll(async () => {
    h = await createApiHarness();
    await seedMailboxes(h.pool, 2, 30);
    const response = await h.inject({
      method: 'POST',
      url: '/api/v1/sequences',
      payload: SEQUENCE,
    });
    sequenceId = response.json().id as number;
  });

  afterAll(async () => h.close());

  it('allocates exact CSV counts in row order and leaves the remainder global', async () => {
    const campaignA = await createCampaign(h, sequenceId, 'Allocation A');
    const campaignB = await createCampaign(h, sequenceId, 'Allocation B');
    const rows = Array.from(
      { length: 1000 },
      (_, index) =>
        `pool${String(index + 1).padStart(4, '0')}@example.dev,Lead ${index + 1},Company ${index + 1}`,
    );
    const csv = ['email,first_name,company', ...rows].join('\n');
    const multipart = multipartCsv(csv);
    const preview = await h.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().counts.ok).toBe(1000);

    const allocationBody = {
      mode: 'drop_flagged' as const,
      allocations: [
        { campaign_id: campaignA.id, count: 100 },
        { campaign_id: campaignB.id, count: 100 },
      ],
    };
    const allocationPreview = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/allocation-preview`,
      payload: allocationBody,
    });
    expect(allocationPreview.statusCode, allocationPreview.body).toBe(200);
    expect(allocationPreview.json()).toMatchObject({
      available: 1000,
      remaining_global: 800,
      campaigns: [
        { campaign_id: campaignA.id, requested: 100, allocatable: 100 },
        { campaign_id: campaignB.id, requested: 100, allocatable: 100 },
      ],
    });

    const commit = await h.inject({
      method: 'POST',
      url: `/api/v1/imports/${preview.json().import_id}/commit`,
      payload: allocationBody,
    });
    expect(commit.statusCode, commit.body).toBe(200);
    expect(commit.json()).toMatchObject({
      imported: 1000,
      allocations_created: 200,
      remaining_global: 800,
    });

    const counts = await h.pool.query(
      `SELECT campaign_id, count(*)::int AS n
         FROM campaign_lead_pool WHERE status = 'available'
        GROUP BY campaign_id ORDER BY campaign_id`,
    );
    expect(counts.rows).toEqual([
      { campaign_id: campaignA.id, n: 100 },
      { campaign_id: campaignB.id, n: 100 },
    ]);
    const bounds = await h.pool.query(
      `SELECT min(l.email) AS first_email, max(l.email) AS last_email
         FROM campaign_lead_pool p JOIN leads l ON l.id = p.lead_id
        WHERE p.campaign_id = $1`,
      [campaignA.id],
    );
    expect(bounds.rows[0]).toEqual({
      first_email: 'pool0001@example.dev',
      last_email: 'pool0100@example.dev',
    });

    const filteredLeads = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/leads?pool_campaign_id=${campaignA.id}&page=1&per_page=100`,
      })
    ).json();
    expect(filteredLeads.total).toBe(100);
    expect(filteredLeads.items[0].pool_assignment).toMatchObject({
      campaign_id: campaignA.id,
      campaign_name: 'Allocation A',
      status: 'available',
    });

    const history = (await h.inject({ method: 'GET', url: '/api/v1/imports' })).json();
    expect(history.items[0].pool_allocations).toEqual([
      {
        campaign_id: campaignA.id,
        campaign_name: 'Allocation A',
        total: 100,
        available: 100,
        enrolled: 0,
        released: 0,
      },
      {
        campaign_id: campaignB.id,
        campaign_name: 'Allocation B',
        total: 100,
        available: 100,
        enrolled: 0,
        released: 0,
      },
    ]);
  });

  it('releases and atomically reassigns only available pool members', async () => {
    const campaigns = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    const campaignA = campaigns.items.find(
      (item: { name: string }) => item.name === 'Allocation A',
    );
    const campaignB = campaigns.items.find(
      (item: { name: string }) => item.name === 'Allocation B',
    );
    const pool = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${campaignA.id}/pool?page=1&per_page=50&status=available`,
      })
    ).json();
    const releaseLead = pool.items[0].lead.id as number;
    const reassignLead = pool.items[1].lead.id as number;

    const released = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignA.id}/pool/release`,
      payload: { lead_ids: [releaseLead] },
    });
    expect(released.statusCode, released.body).toBe(200);
    expect(released.json().changed).toBe(1);

    const reassigned = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignA.id}/pool/reassign`,
      payload: { lead_ids: [reassignLead], target_campaign_id: campaignB.id },
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);
    expect(reassigned.json().changed).toBe(1);
    const reservation = await h.pool.query(
      `SELECT campaign_id, status FROM campaign_lead_pool
        WHERE lead_id = $1 ORDER BY id`,
      [reassignLead],
    );
    expect(reservation.rows).toEqual([
      { campaign_id: campaignA.id, status: 'released' },
      { campaign_id: campaignB.id, status: 'available' },
    ]);
  });

  it('never falls back to unrelated global leads after a campaign becomes pool-backed', async () => {
    const campaign = await createCampaign(h, sequenceId, 'One-lead pool');
    const added = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaign.id}/pool/add`,
      payload: { count: 1 },
    });
    expect(added.statusCode, added.body).toBe(200);
    await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { status: 'active' },
    });
    const first = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaign.id}/enroll`,
      payload: { count: 1 },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().enrolled).toBe(1);

    const capacity = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${campaign.id}/capacity` })
    ).json();
    expect(capacity.pool_available).toBe(0);
    expect(capacity.suggested).toBe(0);
    const second = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaign.id}/enroll`,
      payload: { count: 1 },
    });
    expect(second.statusCode).toBe(409);
    expect(
      (
        await h.pool.query(`SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1`, [
          campaign.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('arms drafts only with acknowledgement and shares one cap between automatic and manual enrollment', async () => {
    const create = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: {
        name: 'Armed safely',
        sequence_id: sequenceId,
        acknowledge_tier_a_manual: true,
        ramp_stages: [{ start_day: 1, end_day: 7, cap: 2 }],
        steady_daily_enroll_cap: 2,
      },
    });
    expect(create.statusCode, create.body).toBe(200);
    const campaign = create.json();
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaign.id}/pool/add`,
          payload: { count: 3 },
        })
      ).statusCode,
    ).toBe(200);

    const unacknowledged = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}/auto-enrollment`,
      payload: { enabled: true },
    });
    expect(unacknowledged.statusCode).toBe(422);
    const armed = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}/auto-enrollment`,
      payload: { enabled: true, acknowledge_auto_enrollment: true },
    });
    expect(armed.statusCode, armed.body).toBe(200);
    expect(armed.json().run).toBeNull();
    expect(
      (
        await h.pool.query(`SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1`, [
          campaign.id,
        ])
      ).rows[0].n,
    ).toBe(0);

    const activated = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { status: 'active' },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    expect(
      (
        await h.pool.query(`SELECT count(*)::int AS n FROM enrollments WHERE campaign_id = $1`, [
          campaign.id,
        ])
      ).rows[0].n,
    ).toBe(2);
    const manualOverCap = await h.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaign.id}/enroll`,
      payload: { count: 1 },
    });
    expect(manualOverCap.statusCode).toBe(409);
    expect(manualOverCap.json().error.details.suggested).toBe(0);

    const paused = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { status: 'paused' },
    });
    expect(paused.json().auto_enroll_enabled).toBe(true);
  });

  it('runs once per local day and shares constrained capacity with a persistent fair cursor', async () => {
    await h.reset();
    await seedMailboxes(h.pool, 1, 3);
    const sequence = (
      await h.inject({ method: 'POST', url: '/api/v1/sequences', payload: SEQUENCE })
    ).json();
    const campaignA = await createCampaign(h, sequence.id, 'Auto A');
    const campaignB = await createCampaign(h, sequence.id, 'Auto B');
    for (let index = 1; index <= 8; index += 1) {
      await h.pool.query(`INSERT INTO leads (email, first_name, tier) VALUES ($1, $2, 'B')`, [
        `auto${index}@example.dev`,
        `Auto ${index}`,
      ]);
    }
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignA.id}/pool/add`,
          payload: { count: 4 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.inject({
          method: 'POST',
          url: `/api/v1/campaigns/${campaignB.id}/pool/add`,
          payload: { count: 4 },
        })
      ).statusCode,
    ).toBe(200);
    await h.pool.query(
      `UPDATE campaigns
          SET status = 'active', auto_enroll_enabled = true, first_activated_at = $1
        WHERE id = ANY($2::bigint[])`,
      [h.clock.now(), [campaignA.id, campaignB.id]],
    );

    const concurrent = await Promise.all([
      h.services.autoEnrollment.run('daily'),
      h.services.autoEnrollment.run('daily'),
    ]);
    const first = concurrent.find((result) => result !== null);
    expect(first?.enrolled).toBe(3);
    expect(concurrent.filter((result) => result === null)).toHaveLength(1);
    const firstCounts = await h.pool.query(
      `SELECT campaign_id, count(*)::int AS n FROM enrollments
        GROUP BY campaign_id ORDER BY campaign_id`,
    );
    expect(firstCounts.rows).toEqual([
      { campaign_id: campaignA.id, n: 2 },
      { campaign_id: campaignB.id, n: 1 },
    ]);

    // A timezone change that moves the local calendar backward must not
    // resurrect an older, previously unclaimed date as catch-up work.
    await h.pool.query(`UPDATE settings SET default_timezone = 'Pacific/Honolulu' WHERE id = 1`);
    expect(await h.services.autoEnrollment.run('daily')).toBeNull();
    await h.pool.query(`UPDATE settings SET default_timezone = 'America/New_York' WHERE id = 1`);

    await h.pool.query(
      `UPDATE enrollments SET current_state = 'COMPLETED', terminal_at = $1, next_send_at = NULL`,
      [h.clock.now()],
    );
    h.clock.advance({ days: 1 });
    const second = await h.services.autoEnrollment.run('daily');
    expect(second?.enrolled).toBe(3);
    const totalCounts = await h.pool.query(
      `SELECT campaign_id, count(*)::int AS n FROM enrollments
        GROUP BY campaign_id ORDER BY campaign_id`,
    );
    expect(totalCounts.rows).toEqual([
      { campaign_id: campaignA.id, n: 3 },
      { campaign_id: campaignB.id, n: 3 },
    ]);
    expect(await h.services.autoEnrollment.run('daily')).toBeNull();
  });

  it('uses the permanent cap after the ramp and refuses post-activation cap increases', async () => {
    const campaigns = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    const campaign = campaigns.items.find((item: { name: string }) => item.name === 'Auto A');
    const setPermanent = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { steady_daily_enroll_cap: 2 },
    });
    expect(setPermanent.statusCode, setPermanent.body).toBe(200);
    h.clock.advance({ days: 9 });
    const capacity = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${campaign.id}/capacity` })
    ).json();
    expect(capacity.ramp_stage).toBeNull();
    expect(capacity.ramp_cap_remaining).toBeNull();
    expect(capacity.effective_daily_enroll_cap).toBe(2);

    const raise = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { steady_daily_enroll_cap: 3 },
    });
    expect(raise.statusCode).toBe(409);
    const lower = await h.inject({
      method: 'PATCH',
      url: `/api/v1/campaigns/${campaign.id}`,
      payload: { steady_daily_enroll_cap: 1 },
    });
    expect(lower.statusCode, lower.body).toBe(200);
    expect(lower.json().steady_daily_enroll_cap).toBe(1);
  });
});
