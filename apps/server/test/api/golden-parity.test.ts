// B6.14 flagship: the API over the seeded golden DB reproduces the committed
// B2.18 fixtures byte-for-byte — schema ⇔ fixture ⇔ contract ⇔ live SQL all
// agree on the Part-10 numbers (8.3 / 3.2 / 4.6 / 2.0 / 17 / 885 …).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VirtualClock } from '../../src/clock/virtual';
import { ensureOperator } from '../../src/services/operatorAuth';
import { GOLDEN } from '../fixtures/golden/constants';
import { seedGoldenCohort } from '../helpers/goldenSeed';
import { createApiHarness, type ApiHarness } from './helpers/app';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/mocks/fixtures/golden',
);
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

describe('B6.14 golden parity — API === committed fixtures', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    // "now" = end of the golden campaign; every window computation matches
    // what the exporter used.
    h = await createApiHarness({ clock: new VirtualClock(GOLDEN.endOfCampaign) });
    await seedGoldenCohort(h.services.db, h.pool);
    // seedGoldenCohort resets core tables (incl. operator) — restore it
    await ensureOperator(h.services.db, h.config);
  }, 240_000);
  afterAll(async () => {
    await h.close();
  });

  it('GET /campaigns matches campaigns.json', async () => {
    const res = (await h.inject({ method: 'GET', url: '/api/v1/campaigns' })).json();
    expect(res).toEqual(fixture('campaigns.json'));
  });

  it('GET /campaigns/1/outcomes matches outcomes.json (40/18/47/780)', async () => {
    const res = (
      await h.inject({ method: 'GET', url: `/api/v1/campaigns/${GOLDEN.campaignId}/outcomes` })
    ).json();
    expect(res).toEqual(fixture('outcomes.json'));
  });

  it('GET /analytics/overview matches overview.json (every headline number)', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/overview?campaign_id=${GOLDEN.campaignId}`,
      })
    ).json();
    expect(res).toEqual(fixture('overview.json'));
  });

  it('GET /analytics/steps matches analytics-steps.json (13b)', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/steps?campaign_id=${GOLDEN.campaignId}`,
      })
    ).json();
    expect(res.items).toEqual(fixture('analytics-steps.json'));
  });

  it('GET /analytics/tiers matches analytics-tiers.json (13c) + promotable', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/tiers?campaign_id=${GOLDEN.campaignId}`,
      })
    ).json();
    expect(res.items).toEqual(fixture('analytics-tiers.json'));
    expect(res.promotable).toEqual({ tier_c_engaged: 8 }); // the 13c promote number
  });

  it('GET /analytics/health-trend matches health-trend.json (13d series)', async () => {
    const res = (
      await h.inject({
        method: 'GET',
        url: `/api/v1/analytics/health-trend?days=60&campaign_id=${GOLDEN.campaignId}`,
      })
    ).json();
    expect(res.items).toEqual(fixture('health-trend.json'));
  });

  it('GET /mailboxes/volume matches mailbox-volume.json (metric #5)', async () => {
    const res = (await h.inject({ method: 'GET', url: '/api/v1/mailboxes/volume?days=60' })).json();
    expect(res).toEqual(fixture('mailbox-volume.json'));
  });

  // NOTE: no rebuild zero-drift assertion here — the golden campaign has no
  // DB sequence (sequence_id NULL), so the endpoint's shape rule (lastStepNo
  // ∞ until B7.3's sequence-aware compare job) cannot derive its COMPLETED
  // sweep. Golden drift is locked by the L1 rebuild-equivalence test, which
  // folds with GOLDEN.shape.
});
