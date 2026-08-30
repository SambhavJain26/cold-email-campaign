import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';

describe('campaign-scoped lead filtering and bulk actions', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
    await h.pool.query(`
      INSERT INTO campaigns (name, status, lead_selection_mode)
      VALUES ('Scoped Campaign', 'active', 'pool')`);
    await h.pool.query(`
      INSERT INTO leads (email, first_name, company, tier, outreach_status, is_suppressed)
      VALUES
        ('pool-only@scope.dev',     'Pool',     'Alpha', NULL, 'standard', false),
        ('enrolled-only@scope.dev', 'Enrolled', 'Beta',  'A',  'standard', false),
        ('both@scope.dev',          'Both',     'Gamma', 'B',  'standard', true),
        ('released-only@scope.dev', 'Released', 'Delta', NULL, 'standard', false),
        ('released-enrolled@scope.dev', 'History', 'Echo', NULL, 'standard', false),
        ('outside@scope.dev',       'Outside',  'Zeta',  NULL, 'standard', false)`);
    await h.pool.query(`
      INSERT INTO enrollments
        (campaign_id, lead_id, current_state, current_step_no, personalization_mode,
         enrolled_at, terminal_at)
      VALUES
        (1, 2, 'COMPLETED', 2, 'template_researched', now() - interval '10 days', now()),
        (1, 3, 'ACTIVE',    1, 'template_auto',       now(), NULL),
        (1, 5, 'REPLIED',   2, 'template_auto',       now() - interval '5 days', now())`);
    await h.pool.query(`
      INSERT INTO campaign_lead_pool
        (campaign_id, lead_id, allocation_order, status, enrollment_id, enrolled_at, released_at)
      VALUES
        (1, 1, 1, 'available', NULL, NULL, NULL),
        (1, 3, 2, 'available', NULL, NULL, NULL),
        (1, 4, 3, 'released',  NULL, NULL, now()),
        (1, 5, 4, 'released',  3, now() - interval '5 days', now())`);
  });

  afterAll(async () => {
    await h.close();
  });

  const emails = (body: { items: Array<{ email: string }> }) =>
    body.items.map((lead) => lead.email).sort();

  it('defines Pool, Enrolled, and Both precisely and preserves legacy enrolled-only omission', async () => {
    const pool = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?campaign_id=1&campaign_scope=pool' })
    ).json();
    expect(emails(pool)).toEqual(['both@scope.dev', 'pool-only@scope.dev']);
    expect(pool.untiered_count).toBe(1);

    const enrolled = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?campaign_id=1&campaign_scope=enrolled' })
    ).json();
    expect(emails(enrolled)).toEqual([
      'both@scope.dev',
      'enrolled-only@scope.dev',
      'released-enrolled@scope.dev',
    ]);

    const both = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?campaign_id=1&campaign_scope=both' })
    ).json();
    expect(emails(both)).toEqual([
      'both@scope.dev',
      'enrolled-only@scope.dev',
      'pool-only@scope.dev',
      'released-enrolled@scope.dev',
    ]);
    expect(both.total).toBe(4); // a lead in both sets appears once
    expect(both.untiered_count).toBe(2);

    const omittedScope = (
      await h.inject({ method: 'GET', url: '/api/v1/leads?campaign_id=1' })
    ).json();
    expect(emails(omittedScope)).toEqual(emails(enrolled));
    expect(emails(both)).not.toContain('released-only@scope.dev');
    expect(emails(both)).not.toContain('outside@scope.dev');
  });

  it('composes campaign membership with state, tier, search, and suppression', async () => {
    const active = (
      await h.inject({
        method: 'GET',
        url: '/api/v1/leads?campaign_id=1&campaign_scope=both&state=ACTIVE',
      })
    ).json();
    expect(emails(active)).toEqual(['both@scope.dev']);

    const searched = (
      await h.inject({
        method: 'GET',
        url: '/api/v1/leads?campaign_id=1&campaign_scope=both&tier=untiered&q=echo',
      })
    ).json();
    expect(emails(searched)).toEqual(['released-enrolled@scope.dev']);

    const suppressed = (
      await h.inject({
        method: 'GET',
        url: '/api/v1/leads?campaign_id=1&campaign_scope=both&suppressed=true',
      })
    ).json();
    expect(emails(suppressed)).toEqual(['both@scope.dev']);
  });

  it('uses the identical campaign predicate for select-all bulk tiering', async () => {
    const result = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-tier',
      payload: {
        filter: { campaign_id: 1, campaign_scope: 'both', tier: 'untiered' },
        tier: 'A',
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ updated: 2 });

    const rows = await h.pool.query(`SELECT email, tier FROM leads ORDER BY id`);
    expect(rows.rows).toEqual([
      { email: 'pool-only@scope.dev', tier: 'A' },
      { email: 'enrolled-only@scope.dev', tier: 'A' },
      { email: 'both@scope.dev', tier: 'B' },
      { email: 'released-only@scope.dev', tier: null },
      { email: 'released-enrolled@scope.dev', tier: 'A' },
      { email: 'outside@scope.dev', tier: null },
    ]);
  });

  it('moves and restores exactly the campaign-scoped set through Nurture', async () => {
    const moved = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-outreach-status',
      payload: {
        filter: { campaign_id: 1, campaign_scope: 'pool' },
        outreach_status: 'nurture',
      },
    });
    expect(moved.json()).toEqual({ updated: 2 });

    const poolNurture = (
      await h.inject({
        method: 'GET',
        url: '/api/v1/leads?campaign_id=1&campaign_scope=pool&outreach_status=nurture',
      })
    ).json();
    expect(emails(poolNurture)).toEqual(['both@scope.dev', 'pool-only@scope.dev']);
    expect(poolNurture.items.every((lead: { tier: string | null }) => lead.tier === null)).toBe(
      true,
    );

    const restored = await h.inject({
      method: 'POST',
      url: '/api/v1/leads/bulk-outreach-status',
      payload: { lead_ids: [1], outreach_status: 'standard' },
    });
    expect(restored.json()).toEqual({ updated: 1 });
    const restoredLead = (await h.inject({ method: 'GET', url: '/api/v1/leads/1' })).json();
    expect(restoredLead).toMatchObject({ outreach_status: 'standard', tier: null });
  });
});
