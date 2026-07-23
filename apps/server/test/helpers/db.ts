import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import '../../src/db/pg-types';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test';

export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/db/migrations',
);

export function getTestPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

/**
 * Wipe core tables between tests. `events` is append-only (trigger blocks
 * row DELETE even for the owner) — TRUNCATE is the sanctioned reset path:
 * statement-level, owner-only (app_rw has no TRUNCATE grant).
 */
export async function resetCoreTables(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE events, enrollments, suppressions, campaigns, leads,
             incoming_messages, sent_messages, mailbox_secrets, mailboxes,
             step_variants, sequence_steps, sequences, import_rows, imports,
             operator, alerts
     RESTART IDENTITY CASCADE`,
  );
  // compliance_settings survives TRUNCATE (single seeded row) and its seed
  // default physical_address is '' — which trips the B4 global send guard
  // (docs/08 §4). Restore a test address so every DB suite can send; suites
  // testing the guard itself blank it explicitly.
  await pool.query(
    `UPDATE compliance_settings SET physical_address = '100 Test Street, Austin TX 78701' WHERE id = 1`,
  );
}

/**
 * Seed n mailboxes (ids 1..n after RESTART IDENTITY). Events referencing
 * mailbox_id are FK-checked since 0004 — any test appending sent/bounce
 * events needs these rows first.
 */
export async function seedMailboxes(pool: Pool, n: number, dailyCap = 30): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await pool.query(
      `INSERT INTO mailboxes (display_name, from_address, smtp_host, imap_host, daily_cap)
       VALUES ($1, $2, 'smtp.test.dev', 'imap.test.dev', $3)`,
      [`Test Mailbox ${i}`, `mb${i}@test.dev`, dailyCap],
    );
  }
}
