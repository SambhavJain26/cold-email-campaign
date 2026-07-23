// F4.5 — sequences: list, build the walkthrough sequence (24 variations),
// fatal link-in-step-1 → fix → save, and the 422 sequence_invalid mapping.
import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const SUBJECT = '{{RANDOM|Quick question|Quick note}} about {{company}}'; // 2 variations
// 3 × 2 × 2 = 12 variations; 45 words expanded, so no body-length warning.
const BODY_CLEAN = `Hi {{first_name|there}},

{{RANDOM|Noticed|Saw|Spotted}} your recent listings around {{city}} and wanted to reach out. We help independent brokerages in {{market}} keep more of their pipeline moving without adding headcount, mostly by tightening the follow-up that already happens after every showing appointment.

{{RANDOM|Worth a quick chat|Open to fifteen minutes}} {{RANDOM|this week|next week}}?`;
const BODY_WITH_LINK = BODY_CLEAN.replace(
  'wanted to reach out.',
  'wanted to reach out. Details live at https://example.com/pricing.',
);

async function buildStepOne(page: Page, body: string) {
  const step1 = page.getByTestId('step-card-1');
  await step1.getByLabel('Subject').fill(SUBJECT);
  await step1.getByLabel('Body').fill(body);
}

test('list shows the fixture sequence with its steps, waits and stop conditions', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Sequences' }).click();

  const row = page.getByTestId('sequence-row-1');
  await expect(row).toContainText('Real Estate Outreach v2');
  await expect(row).toContainText('0 / 3 / 4 / 5 days');
  await expect(row).toContainText('reply');
  await expect(row).toContainText('hard bounce');
  await expect(row).toContainText('unsubscribe');

  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/sequences\/1$/);
  await expect(page.getByTestId('step-card-4')).toBeVisible();
});

test('build a sequence: 24 variations, fatal link in step 1, fix, save', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Sequences' }).click();
  await page.getByRole('button', { name: 'New Sequence' }).click();
  await expect(page).toHaveURL(/\/sequences\/new$/);

  // Save is blocked until the write-schema minimums are met.
  await expect(page.getByRole('button', { name: 'Save sequence' })).toBeDisabled();
  await expect(page.getByTestId('save-blockers')).toContainText('Sequence needs a name');

  await page.getByLabel('Sequence name').fill('Walkthrough Sequence');
  await buildStepOne(page, BODY_WITH_LINK);

  // Live validation chips (validate-template, debounced): 2 × 12 = 24.
  const step1 = page.getByTestId('step-card-1');
  await expect(step1.getByText('2 variations', { exact: true })).toBeVisible();
  await expect(step1.getByText('12 variations', { exact: true })).toBeVisible();

  // Step 2: the in-thread follow-up, 3 days later.
  await page.getByRole('button', { name: 'Add step' }).click();
  const step2 = page.getByTestId('step-card-2');
  await expect(step2.getByLabel('Wait')).toHaveValue('3');
  await step2.getByLabel('Subject', { exact: false }).fill('(re-anchored)');
  await step2.getByLabel('Body').fill('Hi {{first_name|there}} — floating this back up.');

  await page.getByRole('button', { name: 'Save sequence' }).click();
  await expect(page.getByText('Sequence created')).toBeVisible();
  await expect(page).toHaveURL(/\/sequences\/\d+$/);

  // Preview the saved step-1 variant against a real lead.
  await page.getByRole('button', { name: 'Preview step 1 variant A' }).click();
  const panel = page.getByTestId('preview-panel');
  await panel.getByRole('button', { name: /mike\.rodriguez1@example\.com/ }).click();
  await panel.getByRole('button', { name: 'Render preview' }).click();

  // The footer is a separate, locked block — never part of the editable body.
  await expect(panel.getByTestId('preview-footer')).toContainText('4517 Congress Ave');
  await expect(panel.getByTestId('preview-body')).not.toContainText('4517 Congress Ave');

  // 24 variations, and the URL is FATAL in step 1 (docs/08 §5 check #3).
  await expect(panel.getByTestId('preview-checks')).toContainText('24 variations');
  await expect(panel.getByTestId('preview-checks')).toContainText('step 1 must not contain URLs');
  await expect(panel.getByTestId('preview-score')).toContainText('8.0');

  // Fix the URL, save, re-render: clean checklist, variations unchanged.
  await buildStepOne(page, BODY_CLEAN);
  await page.getByRole('button', { name: 'Save sequence' }).click();
  await expect(page.getByText('Sequence saved')).toBeVisible();

  await panel.getByRole('button', { name: 'Render preview' }).click();
  await expect(panel.getByTestId('preview-checks')).not.toContainText(
    'step 1 must not contain URLs',
  );
  await expect(panel.getByTestId('preview-checks')).toContainText('All pre-send checks pass');
  await expect(panel.getByTestId('preview-score')).toContainText('10.0');
  await expect(panel.getByTestId('preview-checks')).toContainText('24 variations');

  // The new sequence is in the list with both steps.
  await page.getByRole('button', { name: 'Back to list' }).click();
  await expect(page.getByRole('link', { name: 'Walkthrough Sequence' })).toBeVisible();
});

test('a template parse error is refused by the server and mapped to its variant tab', async ({
  page,
}) => {
  await login(page);
  await page.goto('/sequences/1');

  const step1 = page.getByTestId('step-card-1');
  await step1.getByLabel('Subject').fill('Quick question about {{company');
  await page.getByRole('button', { name: 'Save sequence' }).click();

  // 422 sequence_invalid → the offending step/variant carries the message.
  await expect(
    step1.getByRole('alert').filter({ hasText: 'unclosed merge tag' }).first(),
  ).toBeVisible();
  await expect(step1.getByRole('tab', { name: /^A/ })).toContainText('•');

  await step1.getByLabel('Subject').fill('Quick question about {{company}}');
  await page.getByRole('button', { name: 'Save sequence' }).click();
  await expect(page.getByText('Sequence saved')).toBeVisible();
});
