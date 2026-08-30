import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth,
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    mainClient: document.querySelector('main')?.clientWidth ?? 0,
    mainScroll: document.querySelector('main')?.scrollWidth ?? 0,
  }));
  expect(sizes.documentScroll, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.documentClient);
  expect(sizes.bodyScroll, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.bodyClient);
  expect(sizes.mainScroll, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.mainClient);
}

async function openMobileSection(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Cold Email' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name }).click();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
}

for (const width of WIDTHS) {
  test(`responsive shell and primary screens fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (width < 768) {
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await openMobileSection(page, 'Leads');
      await expect(page.getByTestId('mobile-card-list')).toBeVisible();
      await expect(page.getByRole('table')).toBeHidden();
      await expectNoHorizontalOverflow(page);

      await openMobileSection(page, 'Mailboxes');
      await expect(page.getByTestId('mobile-card-list')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await openMobileSection(page, 'Analytics');
      await expect(page.getByRole('region', { name: 'Direct response' })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await openMobileSection(page, 'Settings');
      await expectNoHorizontalOverflow(page);
    } else {
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
      await page.getByRole('link', { name: 'Leads' }).click();
      await expect(page.getByRole('table')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Analytics' }).click();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test('phone filters, pagination, dialogs, forms, cards, and details remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await openMobileSection(page, 'Leads');

  const filters = page.getByRole('button', { name: 'Filters' });
  await filters.click();
  await expect(page.getByRole('dialog').getByLabel('Tier filter')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(filters).toBeFocused();

  const pagination = page.getByRole('navigation', { name: 'Leads pagination' });
  await expect(pagination).toBeVisible();
  await pagination.getByLabel('Next').click();
  await expect(page.getByText(/26–50 of/)).toBeVisible();

  await page.getByRole('button', { name: 'Import CSV' }).click();
  const importDialog = page.getByRole('dialog');
  await expect(importDialog.getByRole('heading', { name: 'Import leads' })).toBeVisible();
  const dialogBox = await importDialog.boundingBox();
  expect(dialogBox?.width).toBeLessThanOrEqual(390);
  expect(dialogBox?.height).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');

  await page.goto('/leads/1');
  await expect(page).toHaveURL(/\/leads\/1$/);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const compose = page.getByRole('button', { name: 'Personalized Copy' });
  await compose.click();
  const body = page.getByLabel('Body');
  await body.fill('Unsaved mobile draft\nwith a second line.');
  await page.setViewportSize({ width: 390, height: 520 });
  await expect(body).toHaveValue('Unsaved mobile draft\nwith a second line.');
  await page.keyboard.press('Escape');
  await expect(compose).toBeFocused();
});

test('representative phone screens pass automated accessibility checks and touch sizing', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  for (const section of ['Overview', 'Leads', 'Unibox', 'Analytics', 'System'] as const) {
    if (section !== 'Overview') await openMobileSection(page, section);
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${section}: ${JSON.stringify(results.violations)}`).toEqual([]);
    await expectNoHorizontalOverflow(page);
  }

  const undersized = await page
    .locator('button:visible, [role="button"]:visible')
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label: element.getAttribute('aria-label') ?? element.textContent,
            width: box.width,
            height: box.height,
          };
        })
        .filter((box) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44)),
    );
  expect(undersized).toEqual([]);
});
