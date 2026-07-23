// F2.8 — settings: rules save, dirty guard, compliance block, account (docs/15 F2).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('rules tab saves the full row and clears the dirty flag', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  const pct = page.getByLabel('Hard-bounce % threshold');
  await expect(pct).toHaveValue('5');
  await pct.fill('8');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).not.toBeVisible();
  await expect(pct).toHaveValue('8');
});

test('dirty-state guard blocks tab switch until confirmed', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Hard-bounce % threshold').fill('9');

  // Dismiss the confirm → stay on Rules.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('tab', { name: 'Account' }).click();
  await expect(page.getByRole('button', { name: 'Save rules' })).toBeVisible();

  // Accept it → tab switches, edit discarded.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('tab', { name: 'Account' }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
});

test('compliance: empty address blocks saving with the explanation', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Compliance' }).click();

  await expect(page.getByTestId('footer-preview')).toContainText('4517 Congress Ave');

  await page.getByLabel('Physical address').fill('');
  await expect(page.getByTestId('empty-address-block')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save compliance' })).toBeDisabled();

  await page.getByLabel('Physical address').fill('900 New Address Rd, Austin, TX 78702');
  await expect(page.getByTestId('empty-address-block')).not.toBeVisible();
  await expect(page.getByTestId('footer-preview')).toContainText('900 New Address Rd');
  await page.getByRole('button', { name: 'Save compliance' }).click();
  await expect(page.getByText('Compliance footer saved')).toBeVisible();
});

test('account tab changes the password', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Account' }).click();

  // The email also lives in the top bar — scope to the tab content.
  await expect(page.locator('main').getByText('operator@example.com')).toBeVisible();
  await page.getByLabel('Current password').fill('golden-cohort');
  await page.getByLabel('New password (min 8 chars)').fill('a-longer-password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
});
