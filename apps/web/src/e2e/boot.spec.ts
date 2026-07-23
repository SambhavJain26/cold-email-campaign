// F0 gate spec: boots in mock mode; login-guarded shell (docs/15 F0.7).
import { expect, test } from '@playwright/test';

// Each test gets a fresh browser context, so the sessionStorage-backed mock
// session always starts logged out - no explicit reset needed.

test('unauthenticated visit is guarded to /login', async ({ page }) => {
  await page.goto('/overview');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('login lands on Overview inside the shell with all nav entries', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@example.com');
  await page.getByLabel('Password').fill('golden-cohort');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/overview$/);
  // The 9 walkthrough entries + System (docs/11 §2).
  for (const entry of [
    'Overview',
    'Leads',
    'Mailboxes',
    'Sequences',
    'Campaigns',
    'Unibox',
    'Analytics',
    'Cold Storage',
    'Settings',
    'System',
  ]) {
    await expect(page.getByRole('link', { name: entry })).toBeVisible();
  }
});

test('wrong password shows the envelope error and stays on /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@example.com');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Envelope message shows twice by design: inline alert + the F1.4 mutation toast.
  await expect(page.getByRole('alert').getByText('authentication required')).toBeVisible();
  await expect(page.getByLabel(/Notifications/).getByText('authentication required')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('session survives reload and navigation works', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@example.com');
  await page.getByLabel('Password').fill('golden-cohort');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.reload();
  await expect(page).toHaveURL(/\/overview$/); // still authed - no bounce to /login

  await page.getByRole('link', { name: 'Unibox' }).click();
  await expect(page).toHaveURL(/\/unibox$/);
});
