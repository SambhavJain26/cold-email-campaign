// F2.8 — mailboxes: table + add + failure panels render + actions (docs/15 F2).
import { expect, test } from '@playwright/test';
import { enableFailureFixtures, login } from './helpers';

test('table shows all mailboxes with chips and the capacity total', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();

  // Addresses also appear in the chart legend — scope to the table.
  const table = page.getByRole('table');
  await expect(table.getByText('sales1@coldmail-domain1.com')).toBeVisible();
  await expect(table.getByText('sales4@coldmail-domain2.com')).toBeVisible();
  await expect(page.getByTestId('total-capacity')).toHaveText('120');
  await expect(table.getByText('🟢').first()).toBeVisible();
  await expect(page.getByTestId('volume-chart')).toBeVisible();
});

test('randomized spacing persists through editing and cap changes', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  const row = page.getByRole('row').filter({ hasText: 'sales1@coldmail-domain1.com' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Minimum minutes').fill('4');
  await dialog.getByLabel('Maximum minutes').fill('7');
  await dialog.getByLabel('Daily cap').fill('25');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText('4–7 min', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByLabel('Minimum minutes')).toHaveValue('4');
  await expect(dialog.getByLabel('Maximum minutes')).toHaveValue('7');
  await expect(dialog.getByLabel('Daily cap')).toHaveValue('25');
  await expect(dialog.getByText(/25 emails have 96–168 minutes/)).toBeVisible();
});

test('add mailbox: dialog validates, saves, and the totals move', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  await page.getByRole('button', { name: 'Add Mailbox' }).click();

  // Empty submit → shared-schema validation errors, nothing saved.
  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await expect(
    page.getByText('Too small: expected string to have >=1 characters').first(),
  ).toBeVisible();

  await page.getByLabel('Display name').fill('Sales 5');
  await page.getByLabel('From address').fill('sales5@coldmail-domain3.com');
  await page.getByLabel('Authentication').selectOption('app_password');
  await page.getByLabel('SMTP host').fill('smtp.fastmail.com');
  await page.getByLabel('IMAP host').fill('imap.fastmail.com');
  await page.getByLabel('App password', { exact: true }).fill('app-password-123');
  await page.getByRole('button', { name: 'Add mailbox' }).click();

  await expect(page.getByRole('table').getByText('sales5@coldmail-domain3.com')).toBeVisible();
  await expect(page.getByTestId('total-capacity')).toHaveText('150');
});

test('edit dialog test-connection shows the inline result', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByTestId('test-result')).toContainText('✅ SMTP OK · ✅ IMAP OK');
});

test('auth_failed panel reconnects with a new app password', async ({ page }) => {
  await enableFailureFixtures(page);
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();

  const panel = page.getByTestId('auth-failed-3');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/follow-ups remain queued/)).toBeVisible();

  // No password → button disabled.
  await expect(panel.getByRole('button', { name: 'Reconnect Mailbox' })).toBeDisabled();
  await panel.getByLabel(/New app password/).fill('fresh-app-password');
  await panel.getByRole('button', { name: 'Reconnect Mailbox' }).click();

  await expect(panel).not.toBeVisible();
  await expect(page.getByText('reconnected')).toBeVisible();
});

test('auto_paused panel resumes at 50%', async ({ page }) => {
  await enableFailureFixtures(page);
  await login(page);
  await page.getByRole('link', { name: 'Mailboxes' }).click();

  const panel = page.getByTestId('auto-paused-4');
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/3 hard bounces in last 10 sends/).first()).toBeVisible();

  await panel.getByRole('button', { name: 'Resume at 50%' }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByText('resumed at 50% cap')).toBeVisible();
});
