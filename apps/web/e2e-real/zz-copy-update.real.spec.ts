import { expect, test } from '@playwright/test';
import { api, login } from './helpers';

test('real backend: CSV update mode changes campaign copy and skips outside rows without enrollment', async ({
  page,
}) => {
  await login(page);
  const sequence = await api<{ id: number }>(page, 'post', '/api/v1/sequences', {
    name: 'Copy update browser sequence',
    stop_on_reply: true,
    steps: [
      { step_no: 1, wait_days: 0, in_thread: false, content_source: 'personalized', variants: [] },
    ],
  });
  const campaign = await api<{ id: number }>(page, 'post', '/api/v1/campaigns', {
    name: 'Copy update browser campaign',
    sequence_id: sequence.id,
  });
  const original = Buffer.from(
    'email,step_1_subject,step_1_body\ncopy-update@company.test,Original subject,Original body',
  );
  const uploaded = await page.request.post('/api/v1/imports', {
    headers: { 'x-requested-with': 'fetch' },
    multipart: { file: { name: 'original.csv', mimeType: 'text/csv', buffer: original } },
  });
  expect(uploaded.ok()).toBe(true);
  const importId = (await uploaded.json()).import_id;
  await api(page, 'post', `/api/v1/imports/${importId}/commit`, {
    mode: 'import_all',
    allocations: [{ campaign_id: campaign.id, count: 1 }],
  });
  const before = (await (await page.request.get('/api/v1/campaigns')).json()).items.find(
    (item: { id: number }) => item.id === campaign.id,
  );
  expect(before).toMatchObject({ id: campaign.id, status: 'draft', enrolled_count: 0 });
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'revised.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'email,step_1_subject,step_1_body\ncopy-update@company.test,Revised subject,Revised body\noutside@other.test,Outside subject,Outside body',
    ),
  });
  await page.getByRole('radio', { name: 'Update existing campaign copy' }).click();
  await page.getByLabel('Copy update campaign').click();
  await page.getByRole('option', { name: 'Copy update browser campaign', exact: true }).click();
  await expect(page.getByText(/Not an enrolled or available pooled campaign member/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Update existing campaign copy', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Update existing campaign copy', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Campaign copy updated: 1 replacements' }),
  ).toBeVisible();
  const after = (await (await page.request.get('/api/v1/campaigns')).json()).items.find(
    (item: { id: number }) => item.id === campaign.id,
  );
  expect(after).toEqual(before);
  const history = await (await page.request.get('/api/v1/imports')).json();
  expect(history.items[0].copy_update).toMatchObject({
    campaign_id: campaign.id,
    counts: { changed: 1, unmatched: 1 },
  });
  const leadsResponse = await page.request.get('/api/v1/leads?q=copy-update%40company.test');
  expect(leadsResponse.ok()).toBe(true);
  const updatedLead = (await leadsResponse.json()).items.find(
    (item: { email: string }) => item.email === 'copy-update@company.test',
  );
  expect(updatedLead).toBeDefined();
  const leadId = updatedLead.id;
  const rendered = await api<{ subject: string; body: string }>(
    page,
    'post',
    `/api/v1/sequences/${sequence.id}/preview`,
    { campaign_id: campaign.id, lead_id: leadId, step_no: 1 },
  );
  expect(rendered.subject).toBe('Revised subject');
  expect(rendered.body).toContain('Revised body\n\nBest,\nSambhav Jain\n');
  expect(rendered.body).not.toContain('Unsubscribe:');
});
