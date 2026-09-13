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

  // The clear address choice and primary action carry the exact count.
  await expect(page.getByRole('button', { name: 'Import 885 leads' })).toBeVisible();
  await page.getByRole('radio', { name: /Include role-based addresses/ }).click();
  await expect(page.getByRole('button', { name: 'Import 945 leads' })).toBeVisible();

  await page.getByRole('radio', { name: /Safe addresses only/ }).click();
  await page.getByRole('button', { name: 'Import 885 leads' }).click();
  await expect(page.getByTestId('import-result')).toHaveText('885');
  await expect(page.getByText(/untiered \(decision R\)/)).toBeVisible();
});

test('generic personalized copy requires a destination for a multi-step campaign', async ({
  page,
}) => {
  await login(page);
  const campaignName = 'Beacon import mapping';

  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'personalized.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'email,first_name,manual_subject,manual_body\nlead@example.com,Lead,A subject,A body\n',
    ),
  });

  await expect(page.getByText('Personalized emails found in CSV')).toBeVisible();
  await expect(page.getByLabel('Draft target campaign')).toHaveCount(0);
  await expect(page.getByText(/Ready for sequence use automatically/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /Needs review/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add campaign allocation' }).click();
  await page.getByLabel('Allocation campaign 1').click();
  await page.getByRole('option', { name: campaignName }).click();
  await page.getByLabel('Allocation count 1').fill('1');

  await expect(page.getByLabel('Imported copy destination 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 885 leads' })).toBeDisabled();
  await expect(page.getByText(/Choose the Personalized Copy step/)).toBeVisible();

  await page.getByLabel('Imported copy destination 1').click();
  await page.getByRole('option', { name: 'Step 1 — Personalized Copy' }).click();
  await expect(page.getByText(/Beacon import mapping: first 1 accepted leads/)).toBeVisible();
  await expect(
    page.getByText(/This will not activate campaigns, enroll leads, or send email/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 885 leads' })).toBeEnabled();
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
