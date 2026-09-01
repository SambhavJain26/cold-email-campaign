// F1.5 — login → navigate all (still-empty) screens; shell behaviors.
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@example.com');
  await page.getByLabel('Password').fill('golden-cohort');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

const SCREENS = [
  ['Leads', /\/leads/],
  ['Mailboxes', /\/mailboxes/],
  ['Sequences', /\/sequences/],
  ['Campaigns', /\/campaigns/],
  ['Unibox', /\/unibox/],
  ['Analytics', /\/analytics/],
  ['Cold Storage', /\/cold-storage/],
  ['Settings', /\/settings/],
  ['System', /\/system/],
  ['Overview', /\/overview/],
] as const;

test('every nav entry reaches its screen inside the shell', async ({ page }) => {
  await login(page);
  for (const [label, url] of SCREENS) {
    await page.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
  }
});

test('the shared campaign selector is scoped to Overview', async ({ page }) => {
  await login(page);
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).click();
  await page.getByRole('option', { name: /Golden Pass 1/ }).click();
  await expect(page).toHaveURL(/\?campaign=1$/);

  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole('combobox', { name: 'Campaign', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Analytics campaign' })).toContainText(
    'Golden Pass 1',
  );
});

test('a valid deep-linked campaign survives the initial campaigns load', async ({ page }) => {
  await login(page);
  await page.goto('/analytics?campaign=2');

  await expect(page).toHaveURL(/\/analytics\?campaign=2$/);
  await expect(page.getByRole('combobox', { name: 'Campaign' })).toContainText(
    'Manual Send Fixture',
  );
});

test('transport chip announces mock mode', async ({ page }) => {
  await login(page);
  await expect(page.getByText('mock', { exact: true })).toBeVisible();
});

test('alerts bell: failure fixtures show a badge; ack decrements it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mock:failures', '1'));
  await login(page);

  const badge = page.getByTestId('alerts-count');
  await expect(badge).toHaveText('3');

  await page.getByRole('button', { name: 'Alerts' }).click();
  // Scope to the popover: F5's catch-up BANNER carries the same never-burst copy
  // on this screen, so an unscoped match trips strict mode.
  const popover = page.getByRole('dialog');
  await expect(popover.getByText('Mailbox 3 authentication failed')).toBeVisible();
  await expect(popover.getByText(/never bursts/)).toBeVisible(); // catch-up copy

  await page.getByRole('button', { name: 'Ack' }).first().click();
  await expect(badge).toHaveText('2');
});

test('logout returns to /login and the guard holds', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/unibox');
  await expect(page).toHaveURL(/\/login$/);
});
