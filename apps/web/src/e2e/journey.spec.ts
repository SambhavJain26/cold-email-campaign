// F8.5 — the walkthrough replay as the operator experiences it in the UI: one
// session, in-app navigation only (a full reload would rebuild the MSW state),
// touching every screen handoff the campaign_walkthrough_v2 describes.
//
// The REAL-backend replay (server + MockTransport + advance-clock, docs/13 §5)
// is the M3 closer paired with B7 — this is the frontend-side proof that the
// screens connect into one coherent flow.
import { expect, test } from '@playwright/test';
import { login, navigate } from './helpers';

test('operator journey: leads → sequence → campaign → enroll → unibox → analytics → recycle', async ({
  page,
}) => {
  await login(page);

  // 1 — Leads: the golden cohort is present in the table.
  await page.getByRole('link', { name: 'Leads' }).click();
  const leadsTable = page.getByRole('table');
  await expect(leadsTable).toBeVisible();
  await expect(leadsTable.getByText('mike.rodriguez1@example.com')).toBeVisible();

  // 2 — Sequences: the fixture sequence is inspectable end to end.
  await navigate(page, 'Sequences');
  await page.getByTestId('sequence-row-1').getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('step-card-1')).toBeVisible();
  await expect(page.getByTestId('step-card-4')).toBeVisible();

  // 3 — Campaigns: the golden campaign shows its enrolled/contacted counts.
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await expect(page.getByTestId('campaign-row-1')).toContainText('885');
  await page.getByTestId('campaign-row-1').getByRole('link', { name: 'Golden Pass 1' }).click();

  // 4 — Completion panel: terminal outcomes reconcile to the enrolled total.
  await expect(page.getByTestId('outcomes-total')).toContainText('885 / 885');

  // Review decisions preserve outreach progress and do not themselves create human metrics.
  await page.getByRole('link', { name: 'Unibox' }).click();
  await page.getByRole('button', { name: 'Open Alex Rivera in Golden Pass 1' }).click();
  await page.getByLabel('Reviewed this message').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Continue' }).click();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText('Running');
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('Positive rate').locator('..')).toContainText('3.2%');

  // 7 — Analytics: the 13a–13c reconciliation footers all close.
  await navigate(page, 'Analytics');
  await expect(page.getByTestId('variants-verdict')).toContainText('leads on eventual meetings');
  await page.getByRole('tab', { name: 'Steps' }).click();
  // 29 after the positive tag above — the per-step sum moves WITH the campaign
  // total, so the self-check stays green (not a stale 28 ✗).
  await expect(page.getByTestId('steps-reconciliation')).toContainText('campaign total 28 ✓');
  await page.getByRole('tab', { name: 'Tiers' }).click();
  await expect(page.getByTestId('tiers-reconciliation')).toContainText('meetings sum to 17');

  // 8 — Cold storage: rested leads are ready for a second pass.
  await navigate(page, 'Cold Storage');
  await expect(page.getByText(/of \d+ finished leads are ready/)).toBeVisible();

  // 9 — System: the projection rebuild is clean — the log and the screens agree.
  await navigate(page, 'System');
  await page.getByRole('button', { name: 'Rebuild projections (dry-run)' }).click();
  await page.getByRole('button', { name: 'Run dry run' }).click();
  await expect(page.getByTestId('rebuild-result')).toContainText('0 diffs');
});

test('accessibility: primary landmarks and labelled controls (F8.3)', async ({ page }) => {
  await login(page);

  // Landmarks: a labelled primary nav and a main region.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();

  // Every nav entry is a named link reachable by role.
  for (const label of ['Overview', 'Leads', 'Unibox']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible();
  }

  // Dialogs expose an accessible title (Personalized Copy, opened from a lead).
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('table').getByRole('row').nth(1).click();
  await page.getByRole('button', { name: 'Personalized Copy' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personalized Copy' })).toBeVisible();
  // Escape closes it — keyboard-operable.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('empty and error states render inline, never a blank screen (F8.4)', async ({ page }) => {
  await login(page);

  // Filter the leads table to an impossible combination → the EmptyState.
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByPlaceholder('Search email, name, company…').fill('zzz-no-such-lead-zzz');
  await expect(page.getByText('No leads', { exact: false })).toBeVisible();

  // The reply-detection filter with no matches also shows an inline empty state.
  await navigate(page, 'System');
  await page.getByRole('button', { name: 'unrelated', exact: true }).click();
  await expect(page.getByTestId('incoming-row-901')).toBeVisible();
  await expect(page.getByTestId('incoming-row-100')).toHaveCount(0);
});
