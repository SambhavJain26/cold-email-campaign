// F8.1/F8.2 — System: the reply-detection debug view (4-bucket classifier) and
// the job-status panel with the rebuild dry-run dialog (docs/15 F8).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('reply-detection shows all four classifier buckets and filters', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'System' }).click();

  // A human reply, an OOO auto-reply, a DSN bounce, and an unmatched stray.
  await expect(page.getByTestId('incoming-row-100')).toContainText('human');
  await expect(page.getByTestId('incoming-row-200')).toContainText('auto-reply');
  const bounce = page.getByTestId('incoming-row-900');
  await expect(bounce).toContainText('bounce');
  await expect(bounce).toContainText('5.1.1'); // DSN status
  const stray = page.getByTestId('incoming-row-901');
  await expect(stray).toContainText('unrelated');
  await expect(stray).toContainText('unmatched');
  const rowsPerPage = page.getByRole('combobox', {
    name: 'Reply detection pagination rows per page',
  });
  await expect(rowsPerPage).toContainText('25');
  const replyPagination = page.getByRole('navigation', { name: 'Reply detection pagination' });
  await expect(replyPagination.locator('..')).toContainText(/1–\d+ of \d+/);
  await rowsPerPage.click();
  await page.getByRole('option', { name: '50' }).click();
  await expect(rowsPerPage).toContainText('50');

  // Filtering to bounce leaves only the DSN row.
  await page.getByRole('button', { name: 'bounce', exact: true }).click();
  await expect(page.getByTestId('incoming-row-900')).toBeVisible();
  await expect(page.getByTestId('incoming-row-100')).toHaveCount(0);
});

test('job status shows transport, pollers, and a clean rebuild dry-run', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'System' }).click();

  await expect(page.getByTestId('transport-mode')).toHaveText('MOCK');
  await expect(page.getByTestId('last-tick')).not.toBeEmpty();
  // One poller row per mailbox.
  await expect(page.getByTestId('poller-freshness').getByRole('row')).toHaveCount(4);

  await page.getByRole('button', { name: 'Rebuild projections (dry-run)' }).click();
  await page.getByRole('button', { name: 'Run dry run' }).click();
  await expect(page.getByTestId('rebuild-result')).toContainText(
    '0 diffs — projections match the event log',
  );
});
