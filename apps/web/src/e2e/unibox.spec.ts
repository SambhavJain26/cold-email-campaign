// F6.6 — unibox: tag → overview positive rate moves, meeting booked, the STOP
// card's auto-unsub caption, the OOO tab, thread view, tag_only unsubscribe,
// and the Mode-1 manual composer (docs/15 F6).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('feed lists human replies with suggested tags and auto-stop caption', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Unibox' }).click();

  const feed = page.getByTestId('unibox-feed');
  await expect(feed).toContainText('sequence stopped after this reply');
  // Untagged items carry the AI-assisted suggestion, greyed.
  await expect(feed.getByText('(AI-assisted)').first()).toBeVisible();

  // The STOP reply auto-unsubscribed and says so, with the double-count caveat.
  await expect(page.getByTestId('auto-unsub-caption').first()).toContainText(
    'counts toward reply AND unsubscribe rate',
  );
});

test('auto-reply tab explains OOO items are not replies', async ({ page }) => {
  await login(page);
  await page.goto('/unibox');

  await page.getByRole('tab', { name: 'Auto-replies (OOO)' }).click();
  await expect(page.getByTestId('auto-reply-caption').first()).toContainText(
    'NOT counted as a reply. Sequence continues normally.',
  );
  await expect(page.getByTestId('unibox-feed')).toContainText('Out of office');
});

test('tagging positive moves the Overview positive rate', async ({ page }) => {
  await login(page);
  // In-app navigation only: a full page load rebuilds the MSW state from the
  // fixtures, which would throw away the tag we are asserting on.
  await expect(page.getByText('Positive rate').locator('..')).toContainText('3.2%');

  await page.getByRole('link', { name: 'Unibox' }).click();
  // Card 105 is untagged and carries a suggestion — confirm it as positive.
  const card = page.getByTestId('reply-card-105');
  await card.getByRole('button', { name: 'Tag positive' }).click();
  // Optimistic: the confirmed tag replaces the suggestion immediately.
  await expect(card.getByText('positive', { exact: false }).first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Tag positive' })).toBeDisabled();

  await page.getByRole('link', { name: 'Overview' }).click();
  // 28 → 29 positives over the same 867 contacted = 3.3%.
  await expect(page.getByText('Positive rate').locator('..')).toContainText('3.3%');
});

test('meeting booked hides the button and badges the card', async ({ page }) => {
  await login(page);
  await page.goto('/unibox');

  const card = page.getByTestId('reply-card-101');
  await card.getByRole('button', { name: 'Mark meeting booked' }).click();
  await expect(card.getByTestId('meeting-badge')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mark meeting booked' })).toHaveCount(0);
});

test('thread view shows the sent steps and the reply body', async ({ page }) => {
  await login(page);
  await page.goto('/unibox');

  await page
    .getByRole('button', { name: /Open thread with/ })
    .first()
    .click();
  await expect(page.getByTestId('thread-steps')).toContainText('Step 1');
  await expect(page.getByTestId('thread-body')).not.toBeEmpty();
});

test('tag_only mode adds the explicit unsubscribe on negative cards', async ({ page }) => {
  await login(page);

  // Flip decision F's escape hatch in Settings, then the card grows the button.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Tag only').check();
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.getByRole('link', { name: 'Unibox' }).click();
  await expect(page.getByTestId('tag-only-mode')).toBeVisible();

  // Card 102 is tagged negative in the fixtures.
  const card = page.getByTestId('reply-card-102');
  await expect(card.getByTestId('manual-unsubscribe')).toBeVisible();
  await card.getByTestId('manual-unsubscribe').click();
  await expect(page.getByText('Lead unsubscribed and suppressed')).toBeVisible();
});

test('manual composer prefills the enrollment due step and sends as a manual send', async ({
  page,
}) => {
  await login(page);

  // A campaign with a sequence, so there is something to prefill from.
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await page.getByRole('button', { name: 'New Campaign' }).click();
  await page.getByLabel('Name').fill('Manual send target');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page).toHaveURL(/\/campaigns\/\d+$/);

  // exact: true — this is the only nav click made FROM a campaign detail page,
  // which also renders "Open campaign leads". Substring matching (Playwright's
  // default) hits both and trips strict mode.
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await page.getByPlaceholder('Search email, name, company…').fill('manual.eligible@example.com');
  await page.getByRole('table').getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/leads\/\d+$/);
  await page.getByRole('button', { name: 'Manual compose' }).click();

  // Scope to the dialog — the top bar has its own campaign selector.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Campaign')).toContainText('Manual Send Fixture');

  // Prefilled by the server for THIS enrollment's current due step.
  await expect(dialog.getByText(/Step \d+ of 4/)).toBeVisible();
  await expect(dialog.getByLabel('Subject')).toHaveValue(/Quick question about/);
  await expect(dialog.getByLabel('Body')).toHaveValue(/Hi /);
  await expect(page.getByTestId('composer-checks')).toBeVisible();

  await dialog.getByLabel('Subject').fill('Following up personally');
  await page.getByRole('button', { name: 'Send & log as manual' }).click();
  await expect(page.getByText('Sent and logged as a manual send')).toBeVisible();
});

test('Not now creates an operator reminder without restarting the sequence', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Unibox' }).click();

  const card = page.getByTestId('reply-card-101');
  await card.getByLabel('Reply outcome').click();
  await page.getByRole('option', { name: 'Not now — hold until date' }).click();
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await card.getByLabel('Do not contact before').fill(tomorrow);
  await card.getByRole('button', { name: 'Save outcome' }).click();
  await expect(page.getByText('Reply outcome recorded')).toBeVisible();

  await page.getByRole('tab', { name: /Reminders/ }).click();
  await expect(page.getByText(/Follow up after this lead's requested date/)).toBeVisible();
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText(/Follow up after this lead's requested date/)).toBeHidden();
});
