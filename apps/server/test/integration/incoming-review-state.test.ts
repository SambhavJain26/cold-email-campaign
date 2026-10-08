import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDb, type Db } from '../../src/db/client';
import { EventStore } from '../../src/services/eventStore';
import { buildEvent } from '../../src/domain/events';
import { rebuildProjections } from '../../src/services/rebuildProjections';
import { listDue } from '../../src/db/repos/enrollmentsRepo';
import { selfCheckViolations } from '../../src/db/repos/metricsRepo';
import { TEST_DATABASE_URL, resetCoreTables, MIGRATIONS_DIR } from '../helpers/db';

let db: Db;
let pool: Pool;
let store: EventStore;
const now = new Date('2026-10-08T12:00:00Z');
const ids = { leadId: 1, campaignId: 1, enrollmentId: 1, occurredAt: now };
beforeAll(() => {
  ({ db, pool } = createDb(TEST_DATABASE_URL));
  store = new EventStore(db);
});
afterAll(async () => {
  await resetCoreTables(pool);
  await pool.end();
});
beforeEach(async () => {
  await resetCoreTables(pool);
  await pool.query("INSERT INTO leads(email) VALUES('review@example.com')");
  await pool.query("INSERT INTO campaigns(name,status) VALUES('Review','active')");
  await pool.query(
    "INSERT INTO enrollments(lead_id,campaign_id,personalization_mode,enrolled_at) VALUES(1,1,'template_auto',now())",
  );
  await store.append([buildEvent.enrolled(ids)], {
    patches: [{ enrollmentId: 1, nextSendAt: now }],
  });
});

it('holds preserve the due checkpoint, delay remains a separate barrier, and replay matches', async () => {
  const [hold] = await store.append([
    buildEvent.reviewRequired({ ...ids, attributes: { incoming_message_id: 9 } }),
  ]);
  expect(await listDue(db, now)).toHaveLength(0);
  expect((await pool.query('SELECT next_send_at FROM enrollments')).rows[0].next_send_at).toEqual(
    now,
  );
  await store.append([
    buildEvent.reviewDecided({
      ...ids,
      attributes: {
        action: 'delay',
        hold_event_ids: [hold!],
        until: '2026-10-10T12:00:00Z',
        operation_id: 'delay',
      },
    }),
  ]);
  expect(await listDue(db, now)).toHaveLength(0);
  expect(await listDue(db, new Date('2026-10-11T12:00:00Z'))).toHaveLength(1);
  const audit = await rebuildProjections(db, {
    dryRun: true,
    now,
    deliveryConfirmMs: 86400000,
    shapeFor: () => ({ lastStepNo: 5, softRetryMax: 2, stopOnReply: true }),
  });
  expect(audit.checked).toBe(1);
  expect(audit.diffs).toEqual([]);
});

it('suppression does not depend on the old disable setting', async () => {
  await pool.query('UPDATE settings SET suppress_unsubs=false');
  try {
    await store.append([
      buildEvent.addressSuppressed({
        ...ids,
        attributes: { rule: 'explicit_optout', operation_id: 'optout' },
      }),
    ]);
    expect((await pool.query('SELECT email FROM suppressions')).rows).toEqual([
      { email: 'review@example.com' },
    ]);
    expect(await listDue(db, now)).toHaveLength(0);
  } finally {
    await pool.query('UPDATE settings SET suppress_unsubs=true');
  }
});

it('self-check detects missing hold facts and terminal enrollments retaining holds', async () => {
  const [hold] = await store.append([
    buildEvent.reviewRequired({ ...ids, attributes: { incoming_message_id: 9 } }),
  ]);
  expect(await selfCheckViolations(db, null)).toEqual([]);
  await pool.query('UPDATE enrollments SET review_hold_ids=ARRAY[99999999]::bigint[] WHERE id=1');
  expect((await selfCheckViolations(db, null)).map((item) => item.rule)).toContain(
    'review hold references a missing or incompatible fact',
  );
  await pool.query(
    "UPDATE enrollments SET current_state='STOPPED',review_hold_ids=ARRAY[$1]::bigint[] WHERE id=1",
    [hold],
  );
  expect((await selfCheckViolations(db, null)).map((item) => item.rule)).toContain(
    'terminal enrollment retains a review hold',
  );
});

it('migration rollback/reapply preserves control facts and append-only activity', async () => {
  await store.append([
    buildEvent.reviewRequired({ ...ids, attributes: { incoming_message_id: 9 } }),
  ]);
  await pool.query(
    "INSERT INTO incoming_message_activity(operation_id,kind,occurred_at) VALUES('audit','test',now())",
  );
  await pool.query(
    await readFile(path.join(MIGRATIONS_DIR, '0028_incoming_review.down.sql'), 'utf8'),
  );
  await pool.query(
    await readFile(path.join(MIGRATIONS_DIR, '0028_incoming_review.up.sql'), 'utf8'),
  );
  expect(
    (await pool.query('SELECT review_hold_ids FROM enrollments')).rows[0].review_hold_ids,
  ).toHaveLength(1);
  await expect(pool.query("UPDATE incoming_message_activity SET kind='changed'")).rejects.toThrow(
    'append-only',
  );
});
