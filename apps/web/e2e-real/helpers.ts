import { expect, type Page } from '@playwright/test';

// Real-backend e2e creds - must match playwright.real.config.ts serverEnv.
export const OPERATOR = { email: 'operator@e2e.dev', password: 'e2e-operator-pass-123' };

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OPERATOR.email);
  await page.getByLabel('Password').fill(OPERATOR.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview/);
}

type Method = 'post' | 'patch';

/** Hit the REAL backend through the browser origin (session cookie + CSRF). */
export async function api<T = unknown>(
  page: Page,
  method: Method,
  url: string,
  data: unknown = {},
): Promise<T> {
  const res = await page.request[method](url, {
    headers: { 'x-requested-with': 'fetch' },
    data,
  });
  if (!res.ok()) {
    throw new Error(`${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function advanceClock(
  page: Page,
  d: { days?: number; hours?: number; minutes?: number },
): Promise<void> {
  await api(page, 'post', '/api/v1/system/advance-clock', {
    days: d.days ?? 0,
    hours: d.hours ?? 0,
    minutes: d.minutes ?? 0,
  });
}
