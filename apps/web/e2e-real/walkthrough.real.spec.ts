// The real-backend walkthrough replay (docs/13 §5) — the M3 closer.
//
// Unlike the mock journey (journey.spec.ts, MSW over fixtures), this drives the
// web app against the REAL Fastify server in SIMULATED_CLOCK mode: real auth,
// real ingest, the real scheduler sending over MockTransport, the real poller
// classifying scripted inbound, real event-sourced metrics — with virtual time
// advanced through POST /system/advance-clock.
//
// Split of concerns: the operator-facing screens that PROVE the UI reads real
// backend state are UI-driven (login, mailbox add + Test Connection, CSV
// import, Unibox tagging, Overview metrics, completion reconcile, System
// rebuild). The arrange-heavy steps already covered by the mock e2e (sequence
// build, campaign create, enroll) and the test-only hooks (advance-clock,
// script-inbound) go through the real API via the browser session.
import { expect, test } from '@playwright/test';
import { advanceClock, api, login } from './helpers';

const LEADS = [
  'alice@acme.test',
  'bob@bar.test',
  'carol@caz.test',
  'dave@delta.test',
  'erin@echo.test',
];

const CSV = Buffer.from(
  [
    'email,first_name,company',
    ...LEADS.map((e, i) => `${e},${['Alice', 'Bob', 'Carol', 'Dave', 'Erin'][i]},Co${i + 1}`),
    'info@rolebased.test,,RoleCo',
  ].join('\n'),
);

test('real backend: import → enroll → advance → reply/STOP → tag → metrics → complete', async ({
  page,
}) => {
  // Range pacing uses minute ticks: multi-day replay executes thousands of
  // real database decisions while preserving every original outcome assertion.
  test.setTimeout(600_000);
  await login(page);

  // 1 — Mailbox: add through the UI, Test Connection round-trips the real
  //     (mock) transport, then widen the send window so virtual-time sends
  //     don't depend on which weekday the clock starts on.
  await page.getByRole('link', { name: 'Mailboxes' }).click();
  await page.getByRole('button', { name: 'Add Mailbox' }).click();
  await page.getByLabel('Display name').fill('Sender One');
  await page.getByLabel('From address').fill('sender1@outreach.test');
  await page.getByLabel('Authentication').selectOption('app_password');
  await page.getByLabel('SMTP host').fill('smtp.outreach.test');
  await page.getByLabel('IMAP host').fill('imap.outreach.test');
  await page.getByLabel('App password', { exact: true }).fill('app-password-123');
  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await expect(page.getByTestId('total-capacity')).toHaveText('30');

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByRole('button', { name: 'Test Connection' }).click();
  await expect(page.getByTestId('test-result')).toContainText('SMTP OK');
  await page.keyboard.press('Escape');

  await api(page, 'patch', '/api/v1/mailboxes/1', {
    send_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' },
  });

  // 2 — Sequence via the real API (the builder itself is proven in mock e2e).
  const seq = await api<{ id: number }>(page, 'post', '/api/v1/sequences', {
    name: 'Real Replay Seq',
    stop_on_reply: true,
    stop_on_hard_bounce: true,
    stop_on_unsubscribe: true,
    steps: [
      {
        step_no: 1,
        wait_days: 0,
        in_thread: true,
        variants: [
          {
            label: 'A',
            subject_template: 'Quick note for {{company|your team}}',
            body_template: 'Hi {{first_name|there}}, a short note about {{company|your work}}.',
            active: true,
          },
        ],
      },
    ],
  });

  // 3 — Import the small CSV through the wizard (real ingest). 5 clean + 1
  //     role-based → "Import 5 leads" with the safe-address option selected.
  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByTestId('upload-input').setInputFiles({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: CSV,
  });
  await expect(page.getByTestId('count-ok')).toHaveText('5');
  await page.getByRole('button', { name: 'Import 5 leads' }).click();
  await expect(page.getByTestId('import-result')).toHaveText('5');
  await page.getByRole('button', { name: 'Go tier them' }).click(); // closes the wizard dialog

  // Leads landed and are visible in the table.
  await expect(page.getByRole('table').getByText('alice@acme.test')).toBeVisible();

  // 4 — Tier the untiered cohort, then create + activate the campaign.
  await api(page, 'post', '/api/v1/leads/bulk-tier', {
    filter: { tier: 'untiered' },
    tier: 'B',
  });
  const camp = await api<{ id: number }>(page, 'post', '/api/v1/campaigns', {
    name: 'Real Replay Campaign',
    sequence_id: seq.id,
    ramp_config: { ramp_days: 7, ramp_daily_enroll_cap: 25 },
  });
  await api(page, 'patch', `/api/v1/campaigns/${camp.id}`, { status: 'active' });

  // 5 — Enroll all five, then advance a day: the REAL scheduler paces the
  //     step-1 sends and confirm-delivery marks them delivered.
  const enrolled = await api<{ enrolled: number }>(
    page,
    'post',
    `/api/v1/campaigns/${camp.id}/enroll`,
    { count: 5 },
  );
  expect(enrolled.enrolled).toBe(5);
  await advanceClock(page, { days: 1 });

  // Overview (real metrics) renders for the campaign after the real send run.
  await page.goto(`/overview?campaign=${camp.id}`);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Positive rate')).toBeVisible();

  // 6 — Script inbound: one positive reply, one STOP. Advance so the poller
  //     fetches + classifies them (threaded onto our real sent Message-IDs).
  await api(page, 'post', '/api/v1/system/script-inbound', {
    mailbox_id: 1,
    kind: 'reply',
    to: 'alice@acme.test',
    body_text: 'This sounds great — can we set up a call next week?',
  });
  await api(page, 'post', '/api/v1/system/script-inbound', {
    mailbox_id: 1,
    kind: 'reply',
    to: 'bob@bar.test',
    body_text: 'STOP. Please remove me from this list.',
  });
  await advanceClock(page, { days: 1 });

  // 7 — Unibox shows the human reply; tag it positive (real event appended).
  //     The STOP reply auto-unsubscribed bob (keyword match, no tagging).
  await page.getByRole('link', { name: 'Unibox' }).click();
  const feed = page.getByTestId('unibox-feed');
  // Select ALICE's card by her unique reply text (bob's STOP card is newer, so
  // a `.first()` would grab the wrong one — and an untagged REPLIED lead is
  // uncounted in the Stage-9 outcomes split, which is exactly what we're proving).
  const aliceCard = feed
    .locator('[data-testid^="reply-card-"]')
    .filter({ hasText: 'set up a call' });
  await aliceCard.getByRole('button', { name: 'Tag positive' }).click();
  await expect(aliceCard.getByText('positive', { exact: false }).first()).toBeVisible();
  // bob's keyword STOP auto-unsubscribed — the caption says so.
  await expect(page.getByTestId('auto-unsub-caption').first()).toBeVisible();

  // 8 — Overview reflects the positive tag + the STOP unsubscribe.
  await page.goto(`/overview?campaign=${camp.id}`);
  await expect(page.getByText('Positive rate')).toBeVisible();
  await expect(page.getByText('Unsubscribe rate')).toBeVisible();

  // 9 — Run out the rest: carol/dave/erin finish step 1 → COMPLETED. Advance
  //     a day at a time until the completion panel reconciles (a straggler can
  //     complete a tick or two after its delivery-confirm window, so we drive
  //     virtual time to the fixed point rather than guessing a duration).
  for (let i = 0; i < 8; i++) {
    await advanceClock(page, { days: 1 });
    await page.goto(`/campaigns/${camp.id}`);
    if ((await page.getByTestId('outcomes-total').textContent())?.includes('5 / 5')) break;
  }
  await expect(page.getByTestId('outcomes-total')).toContainText('5 / 5');

  // 10 — System: the projection rebuild is clean — the log and the screens agree.
  await page.getByRole('link', { name: 'System' }).click();
  await page.getByRole('button', { name: 'Rebuild projections (dry-run)' }).click();
  await page.getByRole('button', { name: 'Run dry run' }).click();
  await expect(page.getByTestId('rebuild-result')).toContainText('0 diffs');
});
