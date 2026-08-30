// F7.6 — analytics 13a–13d against the golden fixtures, plus cold storage and
// the recycle hash guard (docs/15 F7).
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

async function openTab(page: Page, name: string) {
  await page.getByRole('link', { name: 'Analytics' }).click();
  await page.getByRole('tab', { name }).click();
}

test('13a variants: the golden split, winner on meetings, deactivate flow', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Analytics' }).click();

  await expect(page.getByTestId('variant-row-A')).toContainText('443');
  await expect(page.getByRole('region', { name: 'Eventual outcome' })).toContainText('10');
  await expect(page.getByTestId('variant-row-B')).toContainText('442');
  await expect(page.getByTestId('variants-verdict')).toContainText(
    'Variant A leads on eventual meetings',
  );

  await page
    .getByRole('region', { name: 'Eventual outcome' })
    .getByRole('row')
    .filter({ hasText: 'B' })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Historical results remain visible');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(page.getByText('Variant B deactivated')).toBeVisible();
});

test('13b steps: delivered/positives per step, WEAK verdict, positives reconcile', async ({
  page,
}) => {
  await login(page);
  await openTab(page, 'Steps');

  await expect(page.getByTestId('step-row-1')).toContainText('867');
  await expect(page.getByTestId('step-row-1')).toContainText('1.7%');
  await expect(page.getByTestId('step-row-2')).toContainText('831');
  await expect(page.getByTestId('step-row-3')).toContainText('801');
  await expect(page.getByTestId('step-row-4')).toContainText('789');

  // Step 3: 1 positive over 801 delivered = 0.1% → dead weight.
  await expect(page.getByTestId('step-row-3')).toContainText('WEAK');
  // 15 + 9 + 1 + 3 = 28, and 28 is the campaign's positive count.
  await expect(page.getByTestId('steps-reconciliation')).toContainText(
    'positives sum to 28 — campaign total 28 ✓',
  );
});

test('13c tiers: current A/B plus legacy C analytics reconcile', async ({ page }) => {
  await login(page);
  await openTab(page, 'Tiers');

  await expect(page.getByTestId('tier-row-A')).toContainText('255');
  await expect(page.getByTestId('tier-row-A')).toContainText('13'); // meetings
  await expect(page.getByTestId('tier-row-B')).toContainText('447');
  await expect(page.getByTestId('tier-row-C')).toContainText('165');
  await expect(page.getByTestId('tier-row-C')).toContainText('Legacy');

  // 13 + 3 + 1 = 17 meetings; 255 + 447 + 165 = 867 contacted.
  const reconciliation = page.getByTestId('tiers-reconciliation');
  await expect(reconciliation).toContainText('meetings sum to 17 — campaign 17 ✓');
  await expect(reconciliation).toContainText('contacted sum to 867 — campaign 867 ✓');

  await expect(page.getByTestId('tier-insights')).toContainText('13 of 17 meetings');

  await expect(
    page.getByText(/Current lead tier controls use only Tier A and Tier B/),
  ).toBeVisible();
});

test('13d health: sparklines with thresholds and the watch-rule status', async ({ page }) => {
  await login(page);
  await openTab(page, 'Health');

  const rows = page.getByTestId('health-rows');
  await expect(rows).toContainText('Hard-bounce rate');
  await expect(rows).toContainText('threshold 4%');
  await expect(rows).toContainText('Unsubscribe rate');
  await expect(page.getByTestId('sparkline').first()).toBeVisible();

  await expect(page.getByTestId('watch-rules')).toContainText('healthy. No action needed.');
});

test('cold storage previews multi-source exclusions before confirmation', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Cold Storage' }).click();
  await expect(page.getByText(/of \d+ finished leads are ready/)).toBeVisible();
  await expect(page.getByTestId('next-eligible')).toBeVisible();

  // A draft whose sequence is the one the cohort already received.
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('button', { name: 'New Campaign' }).click();
  await page.getByLabel('Name').fill('Pass 2 — same message');
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/campaigns\/\d+$/);

  await page.getByRole('link', { name: 'Cold Storage' }).click();
  await page.getByRole('button', { name: 'Recycle into campaign…' }).click();
  await page.getByText('Manual Send Fixture', { exact: true }).click();
  await page.getByLabel('Target campaign (draft only)').click();
  await page.getByRole('option', { name: 'Pass 2 — same message' }).click();
  await page.getByRole('button', { name: 'Preview eligibility' }).click();

  const preview = page.getByTestId('recycle-preview');
  await expect(preview).toContainText('Final confirmation');
  await expect(preview).toContainText('Cross-source duplicates');
  await expect(preview).toContainText('Prior-content conflicts');
  await expect(preview).toContainText('Per-source contribution');
});

test('recycling into a campaign with a new sequence succeeds', async ({ page }) => {
  await login(page);

  // A genuinely different message for pass 2.
  await page.getByRole('link', { name: 'Sequences' }).click();
  await page.getByRole('button', { name: 'New Sequence' }).click();
  await page.getByLabel('Sequence name').fill('Listing automation angle');
  const step1 = page.getByTestId('step-card-1');
  await step1.getByLabel('Subject').fill('{{company}} listings');
  await step1
    .getByLabel('Body')
    .fill('Hi {{first_name|there}} — different angle this time: listing automation.');
  await page.getByRole('button', { name: 'Save sequence' }).click();
  await expect(page.getByText('Sequence created')).toBeVisible();

  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('button', { name: 'New Campaign' }).click();
  await page.getByLabel('Name').fill('Pass 2 — new angle');
  await page.getByLabel('Sequence').click();
  await page.getByRole('option', { name: /Listing automation angle/ }).click();
  await page.getByRole('button', { name: 'Create campaign' }).click();

  await page.getByRole('link', { name: 'Cold Storage' }).click();
  await page.getByRole('button', { name: 'Recycle into campaign…' }).click();
  await page.getByText('Manual Send Fixture', { exact: true }).click();
  await page.getByLabel('Target campaign (draft only)').click();
  await page.getByRole('option', { name: 'Pass 2 — new angle' }).click();
  await page.getByRole('button', { name: 'Preview eligibility' }).click();
  await page.getByRole('button', { name: 'Confirm recycle' }).click();

  await expect(page.getByTestId('recycle-result')).toContainText(
    'Enrolled 120 unique eligible leads',
  );
  await expect(page.getByTestId('recycle-result')).toContainText('Still resting');
});
