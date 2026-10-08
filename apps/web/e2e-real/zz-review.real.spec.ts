import { expect, test } from '@playwright/test';
import { api, advanceClock, login } from './helpers';
import { navigate } from '../src/e2e/helpers';

test('real review policy: away hold, confirmed Continue, acknowledgement, fresh automatic hold, Delay and deletion', async ({
  page,
}) => {
  test.setTimeout(180000);
  await login(page);
  const sequence = await api<{ id: number }>(page, 'post', '/api/v1/sequences', {
    name: 'Review browser sequence',
    steps: [
      {
        step_no: 1,
        wait_days: 0,
        in_thread: false,
        variants: [
          {
            label: 'A',
            subject_template: 'A question',
            body_template: 'Hello {{first_name}}',
            active: true,
          },
        ],
      },
      {
        step_no: 2,
        wait_days: 10,
        in_thread: true,
        variants: [
          {
            label: 'A',
            subject_template: 'Following up',
            body_template: 'Checking in',
            active: true,
          },
        ],
      },
    ],
  });
  const campaign = await api<{ id: number }>(page, 'post', '/api/v1/campaigns', {
    name: 'Review browser cohort',
    sequence_id: sequence.id,
  });
  const upload = await page.request.post('/api/v1/imports', {
    headers: { 'x-requested-with': 'fetch' },
    multipart: {
      file: {
        name: 'review.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('email,first_name,company\nreview-reader@acme.test,Casey,Acme'),
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
  expect(
    (
      await api<{ enrolled: number }>(page, 'post', `/api/v1/campaigns/${campaign.id}/enroll`, {
        count: 1,
      })
    ).enrolled,
  ).toBe(1);
  await advanceClock(page, { hours: 2 });
  await api(page, 'post', '/api/v1/system/script-inbound', {
    mailbox_id: 1,
    kind: 'reply',
    to: 'review-reader@acme.test',
    body_text: 'I am away for three days.\n\nPlease check back next week.',
  });
  await advanceClock(page, { minutes: 10 });
  await navigate(page, 'Unibox');
  await page.getByLabel('Unibox campaign').click();
  await page.getByRole('option', { name: 'Review browser cohort', exact: true }).click();
  await page.getByRole('button', { name: 'Open Casey in Review browser cohort' }).click();
  const reader = page.getByRole('region', { name: 'Message reader' });
  await expect(reader).toContainText('Held for review');
  await expect(reader).toContainText('Please check back next week.');
  await expect(page.getByRole('button', { name: '✓ Acknowledge 0 reviewed' })).toBeDisabled();
  await page.getByLabel('Reviewed this message').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Continue', exact: true }).click();
  await expect(reader).toContainText('Running');
  await page.getByRole('button', { name: '✓ Acknowledge 1 reviewed' }).click();
  await expect(page.getByText('Acknowledged 1 reviewed message(s)')).toBeVisible();
  let rows = (
    await (await page.request.get(`/api/v1/unibox/rows?campaign_id=${campaign.id}&view=all`)).json()
  ).items;
  expect(rows[0]).toMatchObject({
    sending_state: 'running',
    next_step: 2,
    unacknowledged_count: 0,
  });
  const context = await (
    await page.request.get(`/api/v1/unibox/rows/${rows[0].enrollment_id}/messages`)
  ).json();
  expect(context.sent).toHaveLength(1);
  await api(page, 'post', '/api/v1/system/script-inbound', {
    mailbox_id: 1,
    kind: 'ooo',
    to: 'review-reader@acme.test',
  });
  await advanceClock(page, { minutes: 10 });
  await page.reload();
  await page.getByRole('button', { name: 'Open Casey in Review browser cohort' }).click();
  await expect(reader).toContainText('Held for review');
  await expect(reader).toContainText('Automatic detected');
  await expect(reader).toContainText('In-thread reply');
  await page.getByLabel('Reviewed this message').check();
  await page.getByRole('button', { name: 'Delay', exact: true }).click();
  await page.getByLabel('Continuation date and time').fill('2099-01-12T10:00');
  await page.getByLabel('IANA timezone').fill('Etc/UTC');
  await expect(page.getByRole('dialog')).toContainText('2099-01-12T10:00:00.000Z');
  await page.getByRole('button', { name: 'Confirm Delay', exact: true }).click();
  await expect(reader).toContainText('Delayed until');
  await page.getByRole('button', { name: 'Delete stored content', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Delete stored content' }).click();
  await expect(reader).toContainText('Stored content deleted');
  rows = (
    await (await page.request.get(`/api/v1/unibox/rows?campaign_id=${campaign.id}&view=all`)).json()
  ).items;
  expect(rows[0]).toMatchObject({
    sending_state: 'delayed',
    next_step: 2,
    delayed_until: '2099-01-12T10:00:00.000Z',
  });
  await api(page, 'patch', `/api/v1/campaigns/${campaign.id}`, { status: 'paused' });
});
