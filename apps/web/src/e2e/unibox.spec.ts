// Prospective review policy; legacy golden fixtures remain an independent cohort.
import { expect, test, type Page } from '@playwright/test';
import { login, navigate } from './helpers';

async function reader(page: Page) {
  await login(page);
  await navigate(page, 'Unibox');
  await page.getByRole('button', { name: 'Open Alex Rivera in Golden Pass 1' }).click();
}
async function reviewed(page: Page) {
  await page.getByLabel('Reviewed this message').check();
}
async function continueSequence(page: Page) {
  await reviewed(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('does not send an email');
  await page.getByRole('button', { name: 'Confirm Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
test('grouped lead list, complete reader, independent labels and sent conversation context', async ({
  page,
}) => {
  await reader(page);
  await expect(page.getByRole('region', { name: 'Lead review list' })).toContainText(
    '2 message(s)',
  );
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText(
    'Held for review',
  );
  await expect(page.getByText('Automation: No automation detected', { exact: true })).toBeVisible();
  await expect(page.getByText('Relationship: In-thread reply', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Please check back next week.', { exact: false }).first(),
  ).toBeVisible();
  await page.getByText('Quoted history', { exact: false }).click();
  await expect(page.getByText('> Previous message', { exact: false })).toBeVisible();
  await page.getByText('Sent conversation context').click();
  await page.getByText('Step 1 · An earlier conversation', { exact: false }).click();
  await expect(page.getByText('Saved sent message text.')).toBeVisible();
  await page.getByRole('region', { name: 'Message reader' }).evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: test.info().outputPath('unibox-desktop.png'), fullPage: true });
});
test('possible reply confirms the selected person, preserving automation and review actions', async ({
  page,
}) => {
  await login(page);
  await navigate(page, 'Unibox');
  await expect(page.getByText('1 lead conversations · 1 possible replies')).toBeVisible();
  await page.getByRole('button', { name: /Possible reply · other@apex.example/ }).click();
  await expect(page.getByRole('region', { name: 'Possible reply reader' })).toContainText(
    'has not been held because of this message',
  );
  await page.getByRole('button', { name: 'Confirm this is Alex Rivera' }).click();
  await expect(page.getByRole('dialog')).toContainText('other@apex.example');
  await expect(page.getByRole('dialog')).toContainText('alex@apex.example');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('1 lead conversations · 0 possible replies')).toBeVisible();
  await page.getByRole('button', { name: 'Open Alex Rivera in Golden Pass 1' }).click();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText(
    'Held for review',
  );
  await expect(page.getByLabel('All incoming messages (3)')).toBeVisible();
});
test('possible reply dismissal and Undo only change its review visibility on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await navigate(page, 'Unibox');
  await page.getByRole('button', { name: /Possible reply · other@apex.example/ }).click();
  await page.getByRole('button', { name: 'Not a campaign reply', exact: true }).click();
  await expect(page.getByText('Removed from Needs review. Sending state unchanged.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Returned to Needs review')).toBeVisible();
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Possible reply · other@apex.example/ }),
  ).toBeVisible();
});
test('automatic separate response keeps a review hold and does not gain human credit', async ({
  page,
}) => {
  await reader(page);
  await page.getByLabel('All incoming messages (2)').click();
  await page.getByRole('option', { name: /Automatic reply: Out of office/ }).click();
  await expect(page.getByText('Automation: Automatic detected', { exact: true })).toBeVisible();
  await expect(page.getByText('Relationship: Separate email', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText(
    'Held for review',
  );
  await expect(page.getByText('Confirmed authorship: Unsure')).toBeVisible();
});
test('Continue requires reviewed messages; acknowledgement changes visibility with Undo', async ({
  page,
}) => {
  await reader(page);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Acknowledge 0 reviewed/ })).toBeDisabled();
  await continueSequence(page);
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText('Running');
  await page.getByRole('button', { name: '✓ Acknowledge 1 reviewed' }).click();
  await expect(page.getByText('Acknowledged 1 reviewed message(s)')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Acknowledgement undone')).toBeVisible();
});
test('Stop is campaign-specific; correction returns to review', async ({ page }) => {
  await reader(page);
  await page.getByRole('button', { name: 'Stop sequence', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('does not globally suppress');
  await page.getByRole('button', { name: 'Confirm Stop sequence' }).click();
  await expect(page.getByRole('button', { name: 'Restore to review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore to review', exact: true }).click();
  await expect(page.getByLabel('Correction reason')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText(
    'Held for review',
  );
});
test('reader keeps sending actions clear and removes unrelated queues', async ({ page }) => {
  await reader(page);
  for (const name of [
    'Needs linking',
    'Unmatched emails',
    'Reminders',
    'My reminders',
    'Remind me',
    'Add reminder',
    'Review or correct association',
    'Check or change linked lead',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.getByText('Email details', { exact: true }).click();
  await expect(page.getByLabel('Who wrote this email?')).toBeVisible();
  await expect(
    page.getByText('This choice does not change when emails are sent.', { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('simplified-unibox.png'), fullPage: true });
});
test('Suppression has typed confirmation and ordinary Continue remains unavailable', async ({
  page,
}) => {
  await reader(page);
  await page.getByRole('button', { name: 'Suppress address', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirm Suppress address' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type alex@apex.example to confirm permanently').fill('alex@apex.example');
  await confirm.click();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText('Suppressed');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
});
test('deleting stored content keeps metadata and outreach state', async ({ page }) => {
  await reader(page);
  await page.getByRole('button', { name: 'Delete stored content', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('mailbox copy');
  await page.getByRole('button', { name: 'Confirm Delete stored content' }).click();
  await expect(page.getByText('Stored content deleted', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Message reader' })).toContainText(
    'Held for review',
  );
});
test('HTML reader executes no scripts and loads no remote resources', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracking.invalid')) external.push(request.url());
  });
  await reader(page);
  await page.getByRole('button', { name: 'HTML', exact: true }).click();
  await expect(page.locator('iframe[title="Email HTML content"]')).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Email HTML content"]')
      .getByText('Please check back next week.'),
  ).toBeVisible();
  expect(external).toEqual([]);
  expect(await page.evaluate(() => 'emailScriptRan' in window)).toBe(false);
});
test('campaign search stays focused on matched leads', async ({ page }) => {
  await reader(page);
  await page.getByLabel('Search leads').fill('missing-address');
  await expect(page.getByText('No leads in this view.', { exact: false })).toBeVisible();
  await page.getByLabel('Search leads').fill('Apex Realty');
  await expect(
    page.getByRole('button', { name: 'Open Alex Rivera in Golden Pass 1' }),
  ).toBeVisible();
});
test('phone reader is a dedicated usable view with Back navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await reader(page);
  await expect(page.getByRole('region', { name: 'Lead review list' })).toBeHidden();
  await page.getByRole('button', { name: 'Stop sequence', exact: true }).click();
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: '← Back to leads' }).click();
  await expect(page.getByRole('region', { name: 'Lead review list' })).toBeVisible();
});
test('Personalized Copy saves a lead source and exposes no direct-send action', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByPlaceholder('Search email, name, company…').fill('manual.eligible@example.com');
  await page.getByRole('table').getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/leads\/\d+$/);
  await page.getByRole('button', { name: 'Personalized Copy' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Nothing sends from this editor');
  await expect(dialog.getByText('Reusable lead copy · not assigned to a campaign')).toBeVisible();
  await dialog.getByLabel('Subject').fill('Following up personally');
  await dialog
    .getByLabel('Body')
    .fill('Hi Manual,\n\nThis is saved for a personalized sequence step.\n\nBest,\nSam');
  await dialog.getByRole('button', { name: /Save Draft · Reusable lead copy/ }).click();
  await expect(page.getByText('Source saved')).toBeVisible();

  await dialog.getByLabel('Copy scope').click();
  await page.getByRole('option', { name: 'Beacon import mapping · Personalized Step 3' }).click();
  await dialog
    .getByRole('button', { name: 'Copy reusable lead copy to Beacon import mapping · Step 3' })
    .click();
  await expect(page.getByText('Campaign copy saved')).toBeVisible();
  await expect(dialog.getByLabel('Copy scope')).toContainText(
    'Beacon import mapping · Personalized Step 3',
  );
  await dialog.getByLabel('Subject').fill('Step 3 stays in Beacon');
  await dialog.getByRole('button', { name: 'Save Draft · Beacon import mapping · Step 3' }).click();
  await expect(page.getByText('Campaign copy saved')).toBeVisible();
  await expect(dialog.getByLabel('Copy scope')).toContainText(
    'Beacon import mapping · Personalized Step 3',
  );
  await expect(dialog.getByLabel('Subject')).toHaveValue('Step 3 stays in Beacon');
  await expect(dialog.getByRole('button', { name: /send/i })).toHaveCount(0);
});
