// Launch guardrails at the API boundary (0011, docs/16 §8 item 2). The unit
// suite covers the policy; this covers that the two write paths actually
// consult it, and that raising the ceiling in Settings is the documented way
// through rather than a code change.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiHarness, type ApiHarness } from './helpers/app';

let h: ApiHarness;
let seqId: number;

const mailbox = (dailyCap: number) => ({
  display_name: 'Guardrail Box',
  from_address: `guard${dailyCap}@test.dev`,
  smtp_host: 'smtp.test.dev',
  imap_host: 'imap.test.dev',
  password: 'app-password',
  daily_cap: dailyCap,
});

async function putSettings(patch: Record<string, unknown>) {
  const current = (await h.inject({ method: 'GET', url: '/api/v1/settings' })).json();
  // PUT /settings is full-replace of the EDITABLE row: the response carries
  // updated_at plus the two legacy read-only stop flags, which the body rejects.
  const {
    updated_at: _updatedAt,
    stop_on_reply: _stopOnReply,
    stop_on_hard_bounce: _stopOnHardBounce,
    ...editable
  } = current;
  return h.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    payload: { ...editable, ...patch },
  });
}

beforeAll(async () => {
  h = await createApiHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  seqId = (
    await h.inject({
      method: 'POST',
      url: '/api/v1/sequences',
      payload: {
        name: 'Guardrail Seq',
        stop_on_reply: true,
        steps: [
          {
            step_no: 1,
            wait_days: 0,
            in_thread: true,
            variants: [
              {
                label: 'A',
                subject_template: 'A note for {{company|your team}}',
                body_template: 'Hi {{first_name|there}}, a short note about outreach that works.',
                active: true,
              },
            ],
          },
        ],
      },
    })
  ).json().id;
});

describe('mailbox daily cap ceiling', () => {
  it('accepts a cap at the default ceiling of 50', async () => {
    const res = await h.inject({ method: 'POST', url: '/api/v1/mailboxes', payload: mailbox(50) });
    expect(res.statusCode).toBe(200);
  });

  it('refuses one above it with a 422 that names the setting', async () => {
    const res = await h.inject({ method: 'POST', url: '/api/v1/mailboxes', payload: mailbox(51) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('max_mailbox_daily_cap');
  });

  it('refuses the same value on PATCH — the ceiling is not create-only', async () => {
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: mailbox(30),
    });
    const res = await h.inject({
      method: 'PATCH',
      url: `/api/v1/mailboxes/${created.json().id}`,
      payload: { daily_cap: 400 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('raising the ceiling in Settings is the way through', async () => {
    expect((await putSettings({ max_mailbox_daily_cap: 200 })).statusCode).toBe(200);
    const res = await h.inject({ method: 'POST', url: '/api/v1/mailboxes', payload: mailbox(150) });
    expect(res.statusCode).toBe(200);
  });
});

describe('campaign ramp ceiling', () => {
  const campaign = (ramp: { ramp_days: number; ramp_daily_enroll_cap: number }) => ({
    name: 'Guardrail Campaign',
    sequence_id: seqId,
    ramp_config: ramp,
    acknowledge_tier_a_manual: true,
  });

  it('accepts the shipped default ramp (7 days / 20 per day)', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: campaign({ ramp_days: 7, ramp_daily_enroll_cap: 20 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an enroll cap above the ceiling', async () => {
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: campaign({ ramp_days: 7, ramp_daily_enroll_cap: 500 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('max_ramp_daily_enroll_cap');
  });

  it('allows a zero-day ramp by default — min_ramp_days ships at 0', async () => {
    // Load-bearing: 0011 must not retroactively invalidate existing campaigns
    // or any fixture built before it.
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: campaign({ ramp_days: 0, ramp_daily_enroll_cap: 5 }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('enforces staged enrollment once min_ramp_days is set', async () => {
    expect((await putSettings({ min_ramp_days: 7 })).statusCode).toBe(200);
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      payload: campaign({ ramp_days: 2, ramp_daily_enroll_cap: 5 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('staged-enrollment window');
  });
});
