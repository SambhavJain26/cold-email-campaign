// Migration runner mechanics against the real test DB — agnostic to how many
// migrations exist: asserts over the loaded set, drills down->up on the latest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from '../../src/db/migrate';
import { getTestPool, MIGRATIONS_DIR, resetCoreTables } from '../helpers/db';

describe('migration runner', () => {
  let pool: Pool;
  let names: string[];

  beforeAll(async () => {
    pool = getTestPool();
    names = (await loadMigrations(MIGRATIONS_DIR)).map((m) => m.name);
  });
  afterAll(async () => {
    // leave the test DB fully migrated for whatever runs next
    await migrateUp(pool, MIGRATIONS_DIR);
    await pool.end();
  });

  it('globalSetup applied every migration, in filename order', async () => {
    const status = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(status.map((s) => s.name)).toEqual(names);
    expect(status.every((s) => s.applied)).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(2); // 0000_init + 0001_core so far
  });

  it('rolls back the latest and re-applies cleanly (apply -> down -> apply drill)', async () => {
    const latest = names.at(-1)!;

    const reverted = await migrateDown(pool, MIGRATIONS_DIR, 1);
    expect(reverted).toEqual([latest]);
    const afterDown = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(afterDown.find((s) => s.name === latest)?.applied).toBe(false);

    const reapplied = await migrateUp(pool, MIGRATIONS_DIR);
    expect(reapplied).toEqual([latest]);
    const afterUp = await migrationStatus(pool, MIGRATIONS_DIR);
    expect(afterUp.every((s) => s.applied)).toBe(true);
  });

  it('plain text migration changes only the old default role and preserves custom wording', async () => {
    const migration = (await loadMigrations(MIGRATIONS_DIR)).find(
      (m) => m.name === '0021_plain_text_mode',
    )!;
    await pool.query(migration.downSql);
    await pool.query(
      "UPDATE compliance_settings SET signature_role_line='Automation Specialist | Sambhav Builds'",
    );
    await pool.query(migration.upSql);
    expect(
      (await pool.query('SELECT email_format, signature_role_line FROM compliance_settings'))
        .rows[0],
    ).toEqual({ email_format: 'plain_text', signature_role_line: 'Automation Specialist' });
    await pool.query("UPDATE compliance_settings SET signature_role_line='Custom role'");
    await pool.query(migration.downSql);
    await pool.query(migration.upSql);
    expect(
      (await pool.query('SELECT signature_role_line FROM compliance_settings')).rows[0]
        .signature_role_line,
    ).toBe('Custom role');
    await expect(
      pool.query("UPDATE compliance_settings SET email_format='invalid'"),
    ).rejects.toThrow();
    await resetCoreTables(pool);
  });

  it('four-part rollback preserves the policy cutoff and copy-update history', async () => {
    const rollbackNames = names.slice(names.indexOf('0022_incoming_outreach_stop'));
    const cutoff = (await pool.query('SELECT incoming_stop_since FROM settings WHERE id=1')).rows[0]
      .incoming_stop_since;
    const importId = (
      await pool.query(
        "INSERT INTO imports (filename, rows_total, counts, copy_update) VALUES ('history.csv',0,'{}','{\"campaign_id\":1}') RETURNING id",
      )
    ).rows[0].id;
    expect(await migrateDown(pool, MIGRATIONS_DIR, rollbackNames.length)).toEqual(
      [...rollbackNames].reverse(),
    );
    expect(
      (await pool.query('SELECT incoming_stop_since FROM settings WHERE id=1')).rows[0]
        .incoming_stop_since,
    ).toEqual(cutoff);
    expect(
      (await pool.query('SELECT copy_update FROM imports WHERE id=$1', [importId])).rows[0]
        .copy_update,
    ).toEqual({ campaign_id: 1 });
    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual(rollbackNames);
    expect(
      (await pool.query('SELECT incoming_stop_since FROM settings WHERE id=1')).rows[0]
        .incoming_stop_since,
    ).toEqual(cutoff);
    expect(
      (await pool.query('SELECT copy_update FROM imports WHERE id=$1', [importId])).rows[0]
        .copy_update,
    ).toEqual({ campaign_id: 1 });
    expect(
      (
        await pool.query(
          'SELECT signature_name, signature_role_line, physical_address FROM compliance_settings WHERE id=1',
        )
      ).rows[0],
    ).toEqual({
      signature_name: 'Sambhav Jain',
      signature_role_line: 'PM Systems & Automation Specialist',
      physical_address: '17, Radhaswami Nagar, Jaipur 302020, IN',
    });
    await resetCoreTables(pool);
  });

  it('preserves operator intervals on rollback/reapply and rejects invalid intervals', async () => {
    await resetCoreTables(pool);
    const row = await pool.query(
      "INSERT INTO mailboxes (display_name,from_address,smtp_host,imap_host) VALUES ('Interval','interval@test.dev','smtp.test.dev','imap.test.dev') RETURNING id,send_interval_minutes",
    );
    expect(row.rows[0].send_interval_minutes).toBeNull();
    await pool.query('UPDATE mailboxes SET send_interval_minutes=4 WHERE id=$1', [row.rows[0].id]);
    for (const invalid of [0, -1, 1441]) {
      await expect(
        pool.query('UPDATE mailboxes SET send_interval_minutes=$1', [invalid]),
      ).rejects.toThrow();
    }
    expect(await migrateDown(pool, MIGRATIONS_DIR, 1)).toEqual(['0025_mailbox_send_interval']);
    expect(
      (await pool.query('SELECT send_interval_minutes FROM mailboxes')).rows[0]
        .send_interval_minutes,
    ).toBe(4);
    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual(['0025_mailbox_send_interval']);
    expect(
      (await pool.query('SELECT send_interval_minutes FROM mailboxes')).rows[0]
        .send_interval_minutes,
    ).toBe(4);
    await resetCoreTables(pool);
  });

  it('backfills legacy single-source campaign and enrollment provenance', async () => {
    const targetMigration = '0017_multi_source_recycling';
    const targetIndex = names.indexOf(targetMigration);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    await migrateDown(pool, MIGRATIONS_DIR, names.length - targetIndex);
    const source = (
      await pool.query(
        `INSERT INTO campaigns (name, status) VALUES ('legacy source', 'completed') RETURNING id`,
      )
    ).rows[0].id as number;
    const target = (
      await pool.query(
        `INSERT INTO campaigns (name, status, recycled_from_campaign_id)
         VALUES ('legacy target', 'draft', $1) RETURNING id`,
        [source],
      )
    ).rows[0].id as number;
    const lead = (
      await pool.query(
        `INSERT INTO leads (email, tier) VALUES ('legacy-backfill@test.dev', 'B') RETURNING id`,
      )
    ).rows[0].id as number;
    const sourceEnrollment = (
      await pool.query(
        `INSERT INTO enrollments
           (lead_id, campaign_id, current_state, personalization_mode, enrolled_at, terminal_at)
         VALUES ($1, $2, 'COMPLETED', 'template_researched', now() - interval '100 days',
                 now() - interval '70 days') RETURNING id`,
        [lead, source],
      )
    ).rows[0].id as number;
    const targetEnrollment = (
      await pool.query(
        `INSERT INTO enrollments
           (lead_id, campaign_id, current_state, personalization_mode, enrolled_at)
         VALUES ($1, $2, 'NEW', 'template_researched', now()) RETURNING id`,
        [lead, target],
      )
    ).rows[0].id as number;

    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual(names.slice(targetIndex));
    expect(
      (
        await pool.query(
          `SELECT target_campaign_id, source_campaign_id FROM campaign_recycle_sources
           WHERE target_campaign_id = $1`,
          [target],
        )
      ).rows,
    ).toEqual([{ target_campaign_id: target, source_campaign_id: source }]);
    expect(
      (
        await pool.query(
          `SELECT target_enrollment_id, source_campaign_id, source_enrollment_id
           FROM recycle_enrollment_sources WHERE target_enrollment_id = $1`,
          [targetEnrollment],
        )
      ).rows,
    ).toEqual([
      {
        target_enrollment_id: targetEnrollment,
        source_campaign_id: source,
        source_enrollment_id: sourceEnrollment,
      },
    ]);
    await resetCoreTables(pool);
  });

  it('backfills the permanent cap from the final legacy ramp stage', async () => {
    const targetMigration = '0018_campaign_pools_auto_enrollment';
    const targetIndex = names.indexOf(targetMigration);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    await migrateDown(pool, MIGRATIONS_DIR, names.length - targetIndex);
    const campaignId = (
      await pool.query(
        `INSERT INTO campaigns (name, status, ramp_stages)
         VALUES ('legacy ramp', 'draft',
                 '[{"start_day":1,"end_day":2,"cap":4},{"start_day":3,"end_day":7,"cap":11}]')
         RETURNING id`,
      )
    ).rows[0].id as number;

    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual(names.slice(targetIndex));
    expect(
      (
        await pool.query(
          `SELECT lead_selection_mode, auto_enroll_enabled, steady_daily_enroll_cap
             FROM campaigns WHERE id = $1`,
          [campaignId],
        )
      ).rows,
    ).toEqual([
      {
        lead_selection_mode: 'global',
        auto_enroll_enabled: false,
        steady_daily_enroll_cap: 11,
      },
    ]);
    await resetCoreTables(pool);
  });

  it('is idempotent — up on an up-to-date DB is a no-op', async () => {
    expect(await migrateUp(pool, MIGRATIONS_DIR)).toEqual([]);
  });
});
