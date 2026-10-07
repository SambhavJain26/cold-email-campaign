import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('real signature toggle and randomized mailbox range persist without sending', async ({
  page,
}) => {
  await login(page);
  const complianceResponse = await page.request.get('/api/v1/compliance');
  expect(complianceResponse.ok()).toBe(true);
  const original = await complianceResponse.json();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Compliance' }).click();
  const toggle = page.getByRole('switch', { name: 'Include postal address' });
  if (await toggle.isChecked()) await toggle.click();
  await page.getByLabel('Role line').fill('Property Management Automation Specialist');
  await page.getByLabel('Physical address').fill('Saved address for toggle verification');
  await page.getByRole('button', { name: 'Save compliance' }).click();
  await expect(page.getByText('Sender signature saved')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Compliance' }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel('Physical address')).toHaveValue(
    'Saved address for toggle verification',
  );
  await expect(page.getByTestId('footer-preview')).not.toContainText('Saved address');
  const saved = await (await page.request.get('/api/v1/compliance')).json();
  expect(saved.include_postal_address).toBe(false);
  await toggle.click();
  await expect(page.getByTestId('footer-preview')).toContainText(
    'Saved address for toggle verification',
  );
  // Discard this unsaved switch change before visiting Mailboxes.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  await page.getByRole('button', { name: 'Add Mailbox' }).click();
  await expect(page.getByLabel('Minimum minutes')).toHaveValue('4');
  await expect(page.getByLabel('Maximum minutes')).toHaveValue('7');
  await page.getByLabel('Display name').fill('Range verification');
  await page.getByLabel('From address').fill('range-verification@outreach.test');
  await page.getByRole('button', { name: 'Add mailbox' }).click();
  const row = page.getByRole('row').filter({ hasText: 'range-verification@outreach.test' });
  await expect(row.getByText('4–7 min', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Minimum minutes').fill('3');
  await page.getByLabel('Maximum minutes').fill('6');
  await page.getByLabel('Daily cap').fill('25');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByText('3–6 min', { exact: true })).toBeVisible();
  await page.reload();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Minimum minutes')).toHaveValue('3');
  await expect(page.getByLabel('Maximum minutes')).toHaveValue('6');
  await expect(page.getByLabel('Daily cap')).toHaveValue('25');
  await page.keyboard.press('Escape');
  const mailbox = (await (await page.request.get('/api/v1/mailboxes')).json()).items.find(
    (item: { from_address: string }) => item.from_address === 'range-verification@outreach.test',
  );
  expect(mailbox).toMatchObject({
    sent_today: 0,
    next_allowed_send_at: null,
    send_interval_min_minutes: 3,
    send_interval_max_minutes: 6,
  });
  const restore = await page.request.put('/api/v1/compliance', {
    headers: { 'x-requested-with': 'fetch' },
    data: original,
  });
  expect(restore.ok()).toBe(true);
});
