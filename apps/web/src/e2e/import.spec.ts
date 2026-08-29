// F3.6 (import half) — the 3-step wizard reproduces the walkthrough 1000→885 split.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const CSV = Buffer.from(
  'email,first_name,last_name,company,city,state\n' +
    'sarah.chen@example.com,Sarah,Chen,Apex Realty,Austin,TX\n',
);

test('upload → the exact preview split → commit 885 → result', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();

  await page
    .getByTestId('upload-input')
    .setInputFiles({ name: 'real_estate_leads.csv', mimeType: 'text/csv', buffer: CSV });

  // The walkthrough panel verbatim: 885 clean / 82 nameless / 60 role / 40 invalid / 15 dup.
  await expect(page.getByTestId('count-ok')).toHaveText('885');
  await expect(page.getByTestId('count-missing_first_name')).toHaveText('82');
  await expect(page.getByTestId('count-role_based')).toHaveText('60');
  await expect(page.getByTestId('count-invalid')).toHaveText('40');
  await expect(page.getByTestId('count-duplicate')).toHaveText('15');

  // Never-importable rows are struck through.
  await expect(page.getByText('Invalid', { exact: false }).first()).toHaveClass(/line-through/);

  // Expandable samples.
  await page.getByRole('button', { name: 'samples' }).first().click();
  await expect(page.getByText(/row \d+:/).first()).toBeVisible();

  // The selected mode's commit button carries the exact count.
  await expect(page.getByRole('button', { name: 'Drop flagged & import 885' })).toBeVisible();
  await page.getByLabel('Import mode').click();
  await page.getByRole('option', { name: 'Include role-based addresses' }).click();
  await expect(
    page.getByRole('button', { name: 'Import all incl. role-based (945)' }),
  ).toBeVisible();

  await page.getByLabel('Import mode').click();
  await page.getByRole('option', { name: 'Drop role-based and invalid' }).click();
  await page.getByRole('button', { name: 'Drop flagged & import 885' }).click();
  await expect(page.getByTestId('import-result')).toHaveText('885');
  await expect(page.getByText(/untiered \(decision R\)/)).toBeVisible();
});

test('oversize file is rejected client-side before upload', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();

  await page.getByTestId('upload-input').setInputFiles({
    name: 'huge.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 97), // 10 MB + 1 byte of 'a'
  });
  await expect(page.getByText('File exceeds the 10 MB import cap.')).toBeVisible();
});
