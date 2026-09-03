// F3.6 (leads half) — table, filters, bulk-tier, detail, suppression removal.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('tier header shows the golden distribution and the untiered banner', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();

  await expect(page.getByTestId('tier-count-A')).toHaveText('255');
  await expect(page.getByTestId('tier-count-B')).toHaveText('612');
  await expect(page.getByTestId('tier-count-C')).toHaveCount(0);
  await expect(page.getByTestId('untiered-banner')).toContainText('18 leads need tiering');
});

test('bulk-tier the untiered cohort clears the banner', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();

  await page.getByTestId('untiered-banner').getByRole('button', { name: 'Bulk tag' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(19); // 18 + header

  await page.getByLabel('Select page').check();
  const bar = page.getByTestId('bulk-tier-bar');
  await expect(bar).toContainText('18 selected');

  await bar.getByLabel('Bulk tier').click();
  await page.getByRole('option', { name: '🟡 Tier B' }).click();
  await bar.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByText('18 leads re-tiered')).toBeVisible();
  await expect(page.getByTestId('untiered-banner')).not.toBeVisible();
  await expect(page.getByTestId('tier-count-B')).toHaveText('0');
  await expect(page.getByText(/They no longer match the current tier/)).toBeVisible();
  await page.getByRole('button', { name: 'Show campaign leads' }).click();
  await expect(page.getByTestId('tier-count-B')).toHaveText('630');
});

test('Campaign filter exposes Pool, Enrolled, and Both membership scopes', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();

  await page.getByLabel('Campaign filter').click();
  await page.getByRole('option', { name: 'Golden Pass 1' }).click();
  await expect(page.getByLabel('Campaign membership scope')).toHaveText('Both');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(26);
  await expect(page.getByRole('navigation', { name: 'Leads pagination' })).toContainText('36');
  await expect(page.getByRole('table')).toContainText('Direct enrollment');

  await page.getByLabel('Campaign membership scope').click();
  await page.getByRole('option', { name: 'Pool' }).click();
  await expect(page.getByText('No leads match this filter')).toBeVisible();

  await page.getByLabel('Campaign membership scope').click();
  await page.getByRole('option', { name: 'Enrolled' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(26);
  await expect(page.getByRole('navigation', { name: 'Leads pagination' })).toContainText('36');
});

test('select-all-matching applies the FILTER body, not ids', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();

  await page.getByLabel('Tier filter').click();
  await page.getByRole('option', { name: '🟡 Tier B' }).click();

  await page.getByLabel('Select page').check();
  await page.getByTestId('select-all-matching').click();
  await expect(page.getByTestId('bulk-tier-bar')).toContainText('612 matching leads');

  await page.getByLabel('Bulk tier').click();
  await page.getByRole('option', { name: '🟡 Tier B' }).click();
  await page.getByTestId('bulk-tier-bar').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('612 leads re-tiered')).toBeVisible();
});

test('lead detail: timeline renders, edits save', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('table').getByRole('row').nth(1).click();

  await expect(page).toHaveURL(/\/leads\/\d+$/);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('timeline').getByText('enrolled')).toBeVisible();
  await expect(page.getByTestId('timeline').getByText('sent').first()).toBeVisible();

  await page.getByLabel('Notes').fill('Spoke at the Austin meetup — warm.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Lead updated')).toBeVisible();
});

test('suppressed lead: typed-confirm removal (decision U)', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();

  await page.getByLabel('Suppressed only').click();
  await page.getByRole('table').getByRole('row').nth(1).click();

  const banner = page.getByTestId('suppression-banner');
  await expect(banner).toContainText('opted out');
  await banner.getByText('Remove suppression').click();

  const confirm = page.getByRole('button', { name: 'Remove suppression' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/to confirm/).fill('not-the-email');
  await expect(confirm).toBeDisabled();

  const email = await page.locator('main p.text-sm.text-muted-foreground').first().textContent();
  await page.getByLabel(/to confirm/).fill(email!.trim());
  await confirm.click();

  await expect(page.getByText('Suppression removed')).toBeVisible();
  await expect(banner).not.toBeVisible();
});
