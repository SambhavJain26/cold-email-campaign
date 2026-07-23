import { expect, type Page } from '@playwright/test';

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
