import { expect, test } from '@playwright/test';
import { api, advanceClock, login } from './helpers';

test('real builder previews and applies business-day timing without sending or clearing holds', async ({
  page,
}) => {
  await login(page);
  const mailbox = await api<{ id: number }>(page, 'post', '/api/v1/mailboxes', {
    display_name: 'Business day browser sender',
    from_address: 'business-sender@outreach.test',
    smtp_host: 'smtp.outreach.test',
    imap_host: 'imap.outreach.test',
    password: 'mock-only-password',
  });
  await api(page, 'patch', `/api/v1/mailboxes/${mailbox.id}`, {
    send_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' },
    timezone: 'America/New_York',
  });
  const sequence = await api<{ id: number }>(page, 'post', '/api/v1/sequences', {
    name: 'Business day browser sequence',
    steps: [0, 3, 4, 4, 5].map((wait_days, i) => ({
      step_no: i + 1,
      wait_days,
      in_thread: i !== 0 && i !== 2,
      variants: [
        {
          label: 'A',
          subject_template: `Browser subject ${i + 1}`,
          body_template: `Hello {{first_name|there}}, browser email ${i + 1}`,
          active: true,
        },
      ],
    })),
  });
  const campaign = await api<{ id: number }>(page, 'post', '/api/v1/campaigns', {
    name: 'Business day browser cohort',
    sequence_id: sequence.id,
  });
  const upload = await page.request.post('/api/v1/imports', {
    headers: { 'x-requested-with': 'fetch' },
    multipart: {
      file: {
        name: 'business-days.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('email,first_name,company\nbusiness-days@acme.test,Robin,Acme'),
      },
    },
  });
  expect(upload.ok()).toBe(true);
  await api(page, 'post', `/api/v1/imports/${(await upload.json()).import_id}/commit`, {
    mode: 'import_all',
    allocations: [{ campaign_id: campaign.id, count: 1 }],
  });
  await api(page, 'post', '/api/v1/leads/bulk-tier', {
    filter: { campaign_id: campaign.id, campaign_scope: 'pool' },
    tier: 'B',
  });
  await api(page, 'patch', `/api/v1/campaigns/${campaign.id}`, { status: 'active' });
  await api(page, 'post', `/api/v1/campaigns/${campaign.id}/enroll`, { count: 1 });
  await advanceClock(page, { hours: 2 });
  const leads = (
    await (
      await page.request.get(`/api/v1/leads?campaign_id=${campaign.id}&campaign_scope=enrolled`)
    ).json()
  ).items;
  expect(leads[0].latest_enrollment.current_step_no).toBe(2);
  await api(page, 'patch', `/api/v1/campaigns/${campaign.id}`, { status: 'paused' });
  const before = await (await page.request.get(`/api/v1/leads/${leads[0].id}`)).json();
  await page.goto(`/sequences/${sequence.id}`);
  await page.getByRole('button', { name: 'Use five-email business-day preset' }).click();
  await expect(page.getByRole('radio', { name: 'Business days (Monday–Friday)' })).toBeChecked();
  await page.getByRole('button', { name: 'Preview pending dates' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Business day browser cohort (paused)');
  await expect(dialog).toContainText('Robin');
  await expect(dialog).toContainText('1 pending dates will change');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: '../../backups/business-days-preview-mobile.png' });
  await expect(
    dialog.getByRole('button', { name: 'Apply timing and pending dates' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply timing and pending dates' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Business days (Monday–Friday)' })).toBeChecked();
  const saved = (await (await page.request.get('/api/v1/sequences')).json()).items.find(
    (s: { id: number }) => s.id === sequence.id,
  );
  expect(saved.steps.map((s: { wait_days: number }) => s.wait_days)).toEqual([0, 3, 14, 4, 4]);
  const after = await (await page.request.get(`/api/v1/leads/${leads[0].id}`)).json();
  expect(after.latest_enrollment.current_step_no).toBe(before.latest_enrollment.current_step_no);
  expect(after.timeline.filter((e: { type: string }) => e.type === 'sent')).toHaveLength(
    before.timeline.filter((e: { type: string }) => e.type === 'sent').length,
  );
  await page.screenshot({ path: '../../backups/business-days-mobile.png', fullPage: true });
});
