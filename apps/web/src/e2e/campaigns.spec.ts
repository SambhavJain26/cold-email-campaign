// F5.6 — campaigns: list, create → activate → enroll 20 with the capacity math,
// the Stage-9 completion panel, and the catch-up banner (docs/15 F5).
import { expect, test } from '@playwright/test';
import { enableFailureFixtures, login } from './helpers';

test('list shows the golden campaign with its enrolled/contacted counts', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Campaigns' }).click();

  const row = page.getByTestId('campaign-row-1');
  await expect(row).toContainText('Golden Pass 1');
  await expect(row).toContainText('active');
  await expect(row).toContainText('885');
  await expect(row).toContainText('867');
});

test('completion panel reconciles the terminal outcomes to the enrolled total', async ({
  page,
}) => {
  await login(page);
  await page.goto('/campaigns/1');

  // Live state breakdown: the golden cohort's terminal split.
  const breakdown = page.getByTestId('state-breakdown');
  await expect(breakdown).toContainText('47'); // REPLIED = 28 positive + 19 neutral
  await expect(breakdown).toContainText('18'); // BOUNCED
  await expect(breakdown).toContainText('40'); // UNSUBSCRIBED
  await expect(breakdown).toContainText('780'); // COMPLETED

  const panel = page.getByTestId('completion-panel');
  await expect(panel).toBeVisible();
  // 28 + 19 + 40 + 18 + 780 = 885 — the sum IS the report.
  await expect(page.getByTestId('outcomes-total')).toContainText('885 / 885');
  await expect(panel).toContainText('8.3%'); // reply rate off the same log
  await expect(panel).toContainText('may overlap');
  await expect(panel.getByRole('link', { name: 'Recycle cold storage' })).toBeVisible();
});

test('create → activate → enroll 20 → capacity math moves', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('button', { name: 'New Campaign' }).click();

  await page.getByLabel('Name').fill('Pass 2 — recycled');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByText('Campaign "Pass 2 — recycled" created')).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/\d+$/);

  // Drafts never send — enrolling is refused with the reason, not a dead button.
  await expect(page.getByTestId('enroll-blocked')).toContainText('Activate the campaign first');

  await page.getByRole('button', { name: 'Activate' }).click();
  const today = page.getByTestId('today-panel');
  await expect(today).toContainText('Room for new openers');
  await expect(page.getByTestId('suggested')).toHaveText('20');

  await page.getByRole('button', { name: 'Enroll next 20' }).click();
  await expect(page.getByText('Enrolled 20')).toBeVisible();
  // 120 room − 20 enrolled = 100 left today.
  await expect(today).toContainText('100');

  // Over-asking hits the ramp cap: 409 capacity_exceeded explains and offers the fit.
  await page.getByLabel('Enroll').fill('200');
  await page.getByRole('button', { name: 'Enroll next 200' }).click();
  await expect(page.getByTestId('ramp-note')).toContainText('allows 100 more');
  await expect(page.getByLabel('Enroll')).toHaveValue('100');

  // The list reflects the enrollment.
  await page.getByRole('button', { name: 'Back to list' }).click();
  const row = page.getByRole('row', { name: /Pass 2 — recycled/ });
  await expect(row).toContainText('20');
});

test('catch-up banner explains the backlog and acknowledges', async ({ page }) => {
  await enableFailureFixtures(page);
  await login(page);

  const banner = page.getByTestId('catchup-banner');
  await expect(banner).toContainText('41 sends came due during 14h offline');
  await expect(banner).toContainText('never bursts');

  await banner.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(banner).not.toBeVisible();
});
