import { expect, type Page } from '@playwright/test';

/** Exercise the responsive navigation, including destinations inside More. */
export async function navigate(page: Page, label: string) {
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  const link = page.getByRole('link', { name: label, exact: true });
  if (await link.isVisible()) {
    await link.click();
    return;
  }
  const more = page.getByRole('button', { name: 'More navigation' });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await link.click();
  }
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('operator@example.com');
  await page.getByLabel('Password').fill('golden-cohort');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

export async function enableFailureFixtures(page: Page) {
  await page.addInitScript(() => localStorage.setItem('mock:failures', '1'));
}
