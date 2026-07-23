// B6.10 settings/compliance + B6.11 alerts. Settings mutations append NO
// events; compliance refuses an empty physical address with 422.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAlert } from '../../src/db/repos/alertsRepo';
import { getComplianceSettings } from '../../src/db/repos/settingsRepo';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

describe('B6.10 settings + compliance', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('GET /settings returns the full seeded row in contract shape', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({
      stop_on_reply: true,
      soft_retry_max: 2,
      optout_detection: 'auto',
      pause_hard_pct: 4,
      resume_cap_pct: 50,
      default_timezone: 'America/New_York',
      cold_storage_rest_days: 60,
    });
    expect(typeof s.updated_at).toBe('string');
  });

  it('PUT /settings replaces the row and appends no events', async () => {
    const wm = await eventWatermark(h.pool);
    const current = (await h.inject({ method: 'GET', url: '/api/v1/settings' })).json();
    delete current.updated_at;
    const res = await h.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: { ...current, soft_retry_max: 3, pause_hard_pct: 5.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().soft_retry_max).toBe(3);
    expect(res.json().pause_hard_pct).toBe(5.5);
    await expectNoNewEvents(h.pool, wm);

    // restore the tunables this suite changed (shared serial DB discipline)
    await h.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: current,
    });
  });

  it('PUT /settings validates ranges - pause_hard_pct 30 → 400 validation', async () => {
    const current = (await h.inject({ method: 'GET', url: '/api/v1/settings' })).json();
    delete current.updated_at;
    const res = await h.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: { ...current, pause_hard_pct: 30 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
  });

  it('GET/PUT /compliance roundtrip; empty address → 422', async () => {
    const before = (await h.inject({ method: 'GET', url: '/api/v1/compliance' })).json();
    expect(before.physical_address).toBe('100 Test Street, Austin TX 78701');

    const updated = await h.inject({
      method: 'PUT',
      url: '/api/v1/compliance',
      payload: { physical_address: '1 Main St, Denver CO 80202', optout_text: before.optout_text },
    });
    expect(updated.statusCode).toBe(200);
    expect((await getComplianceSettings(h.services.db)).physicalAddress).toBe(
      '1 Main St, Denver CO 80202',
    );

    const empty = await h.inject({
      method: 'PUT',
      url: '/api/v1/compliance',
      payload: { physical_address: '   ', optout_text: before.optout_text },
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBe('validation');
    // the refused write changed nothing
    expect((await getComplianceSettings(h.services.db)).physicalAddress).toBe(
      '1 Main St, Denver CO 80202',
    );
  });
});

describe('B6.11 alerts', () => {
  let h: ApiHarness;

  beforeAll(async () => {
    h = await createApiHarness();
    await insertAlert(h.services.db, 'catchup_backlog', 'warning', { missedTicks: 14 });
    await insertAlert(h.services.db, 'mailbox_auto_paused', 'error', { mailboxId: 1 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('GET /alerts lists newest-first with pagination envelope', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/alerts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(50);
    expect(body.items.map((a: { kind: string }) => a.kind)).toEqual([
      'mailbox_auto_paused',
      'catchup_backlog',
    ]);
    expect(body.items[0].acknowledged_at).toBeNull();
  });

  it('ack removes an alert from the unacked view; unknown id → 404', async () => {
    const first = (await h.inject({ method: 'GET', url: '/api/v1/alerts' })).json().items[0];
    const ack = await h.inject({ method: 'POST', url: `/api/v1/alerts/${first.id}/ack` });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toEqual({ ok: true });

    const unacked = (await h.inject({ method: 'GET', url: '/api/v1/alerts?unacked=true' })).json();
    expect(unacked.total).toBe(1);
    expect(unacked.items[0].kind).toBe('catchup_backlog');

    // all-alerts view still shows it, now with acknowledged_at set
    const all = (await h.inject({ method: 'GET', url: '/api/v1/alerts' })).json();
    expect(all.total).toBe(2);
    const acked = all.items.find((a: { id: number }) => a.id === first.id);
    expect(acked.acknowledged_at).not.toBeNull();

    expect((await h.inject({ method: 'POST', url: '/api/v1/alerts/9999/ack' })).statusCode).toBe(
      404,
    );
  });
});
